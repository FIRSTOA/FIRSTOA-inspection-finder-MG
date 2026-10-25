import { describe, expect, it } from "vitest";
import {
  BACK_LIMIT, anchorOf, canStep, coveredBy, cursorLabel, cursorRange, isEnded, maxBack, step, type PeriodCursor,
} from "../src/kpi/periodCursor";
import { kpiCount, kpiLoadFrom, kpiRanges, kpiRangesAt, kpiTargetFor, workinPace, type ReceptionWeekRow, type RosterMember } from "../src/kpi/kpiCompute";
import { weekCompletionRate } from "../src/deptReception";

// 2026-10-26 지난 기간 보기(docs/tasks/home-period-nav-2026-10-26.md 6절 구현 A)
const MON = "2026-10-26"; // 월요일
const SUN = "2026-10-25"; // 일요일
const Q_FIRST = "2026-10-01"; // 분기 첫날(목)
const wk = (offset: number): PeriodCursor => ({ period: "week", offset });
const mo = (offset: number): PeriodCursor => ({ period: "month", offset });
const qt = (offset: number): PeriodCursor => ({ period: "quarter", offset });

describe("periodCursor 주", () => {
  it("월요일 기준 −1 = 10/19~10/25, −7 = 9/7~9/13, −8 은 막힘", () => {
    expect(cursorRange(MON, wk(0))).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(cursorRange(MON, wk(-1))).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(cursorRange(MON, wk(-7))).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(canStep(wk(-7), -1, MON)).toBe(false);
    expect(step(wk(-7), -1, MON)).toEqual(wk(-7));
    expect(step(wk(-6), -1, MON)).toEqual(wk(-7));
    // 이번 주에서 앞으로는 못 간다
    expect(canStep(wk(0), 1, MON)).toBe(false);
    expect(step(wk(0), 1, MON)).toEqual(wk(0));
    expect(step(wk(-1), 1, MON)).toEqual(wk(0));
    expect(maxBack("week", MON)).toBe(BACK_LIMIT.week);
  });
  it("−7 주는 kpiRanges.weeks8[0] 과 같다", () => {
    const r = kpiRanges(MON);
    expect(cursorRange(MON, wk(-7))).toEqual({ from: r.weeks8[0].from, to: r.weeks8[0].to });
  });
  it("일요일·분기 첫날에서도 맞다", () => {
    expect(cursorRange(SUN, wk(0))).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(cursorRange(SUN, wk(-1))).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(cursorRange(Q_FIRST, wk(0))).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(cursorRange(Q_FIRST, wk(-1))).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });
  it("라벨: 이번 주 / 지난주 / n월 n주차(OKR 번호)", () => {
    expect(cursorLabel(MON, wk(0))).toBe("이번 주");
    expect(cursorLabel(MON, wk(-1))).toBe("지난주 10/19~10/25");
    expect(cursorLabel(MON, wk(-2))).toBe("10월 2주차(10/12~10/18)");
    expect(cursorLabel(MON, wk(-6))).toBe("9월 2주차(9/14~9/20)");
    // 9/28 주는 월요일이 9월이라 9월 4주차(okr.currentWeekOf 와 같은 번호)
    expect(cursorLabel(MON, wk(-4))).toBe("9월 4주차(9/28~10/4)");
  });
});

describe("periodCursor 월·분기", () => {
  it("월 −1 = 9월, −5 까지, 라벨", () => {
    expect(cursorRange(MON, mo(-1))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(cursorLabel(MON, mo(0))).toBe("이번 달");
    expect(cursorLabel(MON, mo(-1))).toBe("9월");
    expect(cursorRange(MON, mo(-5))).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    expect(canStep(mo(-5), -1, MON)).toBe(false);
  });
  it("1월에서 −1 = 작년 12월(연도 붙임)", () => {
    expect(cursorRange("2026-01-15", mo(-1))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(cursorLabel("2026-01-15", mo(-1))).toBe("2025년 12월");
  });
  it("분기는 올해 안: 10/26 → 최대 −3, 2/10 → 0", () => {
    expect(maxBack("quarter", MON)).toBe(3);
    expect(cursorRange(MON, qt(-1))).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(cursorRange(MON, qt(-3))).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(cursorLabel(MON, qt(0))).toBe("4분기");
    expect(cursorLabel(MON, qt(-1))).toBe("3분기");
    expect(canStep(qt(-3), -1, MON)).toBe(false);
    expect(maxBack("quarter", "2026-02-10")).toBe(0);
    expect(canStep(qt(0), -1, "2026-02-10")).toBe(false);
    expect(step(qt(0), -1, "2026-02-10")).toEqual(qt(0));
    expect(maxBack("quarter", "2026-05-01")).toBe(1);
  });
});

describe("anchorOf·isEnded", () => {
  it("offset 0 = 오늘, 그 밖 = 그 기간 말일", () => {
    expect(anchorOf(MON, wk(0))).toBe(MON);
    expect(anchorOf(MON, mo(0))).toBe(MON);
    expect(anchorOf(MON, wk(-1))).toBe("2026-10-25");
    expect(anchorOf(SUN, wk(-1))).toBe("2026-10-18");
    expect(anchorOf(MON, mo(-1))).toBe("2026-09-30");
    expect(anchorOf("2026-03-31", mo(-1))).toBe("2026-02-28");
    expect(anchorOf(MON, qt(-1))).toBe("2026-09-30");
    expect(anchorOf(MON, qt(-2))).toBe("2026-06-30");
  });
  it("끝난 기간만 마감", () => {
    expect(isEnded(MON, wk(0))).toBe(false);
    expect(isEnded(SUN, wk(0))).toBe(false); // 일요일 = 이번 주 말일, 아직 안 끝남
    expect(isEnded(MON, wk(-1))).toBe(true);
    expect(isEnded(MON, mo(-1))).toBe(true);
    expect(isEnded(MON, qt(0))).toBe(false);
    expect(isEnded(MON, qt(-1))).toBe(true);
  });
});

describe("kpiRangesAt", () => {
  it("anchor = today 이면 kpiRanges(today) 와 깊이 같다", () => {
    for (const t of [MON, SUN, Q_FIRST, "2026-01-01", "2026-12-31", "2026-03-15"]) expect(kpiRangesAt(t, t)).toEqual(kpiRanges(t));
  });
  it("끝난 기간은 경과율 100, today·todayRange·last7 은 진짜 오늘", () => {
    const r = kpiRangesAt(MON, anchorOf(MON, wk(-1)));
    expect(r.week).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(r.weekElapsedRate).toBe(100);
    expect(r.today).toBe(MON);
    expect(r.todayRange).toEqual({ from: MON, to: MON });
    expect(r.last7).toEqual({ from: "2026-10-20", to: MON });
    // 끝난 주의 대비 = 직전 주 전체
    expect(r.prevWeekToDate).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    const q = kpiRangesAt(MON, anchorOf(MON, qt(-1)));
    expect(q.quarter).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect([q.quarterNo, q.quarterElapsedRate, q.monthElapsedRate]).toEqual([3, 100, 100]);
  });
  it("끝난 기간이면 목표 toDate = full", () => {
    const r = kpiRangesAt(MON, anchorOf(MON, wk(-1)));
    const t = kpiTargetFor("K7", { perPersonBizDay: 1 }, { range: r.week, period: "week", today: r.today, scope: "team", headcount: 3, teamCount: 5, holidays: [] });
    expect(t.full).not.toBeNull();
    expect(t.toDate).toBe(t.full);
  });
});

describe("coveredBy", () => {
  it("지난 1~7주·지난달은 메모리, 2달 전·지난 분기는 추가 조회", () => {
    for (const today of [MON, SUN, Q_FIRST, "2026-12-31", "2026-01-05"]) {
      const main = kpiRanges(today);
      const from = kpiLoadFrom(main), to = main.quarter.to;
      // offset 0 은 메인 묶음 그대로라 따지지 않는다(12/31 은 이번 주가 다음 해로 넘어가 분기 말 밖)
      for (let k = -1; k >= -7; k--) expect(coveredBy(from, to, cursorRange(today, wk(k)))).toBe(true);
      expect(coveredBy(from, to, cursorRange(today, mo(-1)))).toBe(true);
    }
    const main = kpiRanges(MON);
    const from = kpiLoadFrom(main), to = main.quarter.to;
    expect(from).toBe("2026-09-01");
    expect(coveredBy(from, to, cursorRange(MON, mo(-2)))).toBe(false);
    expect(coveredBy(from, to, cursorRange(MON, qt(-1)))).toBe(false);
  });
});

describe("K29 = 넘긴 범위의 주", () => {
  const rows: ReceptionWeekRow[] = [
    { status: "완료", receipt_date: "2026-10-26" }, { status: "접수", receipt_date: "2026-10-27" },
    { status: "완료", receipt_date: "2026-10-20" }, { status: "원격완료", receipt_date: "2026-10-21" }, { status: "진행중", receipt_date: "2026-10-25" },
  ];
  const ctx = { today: MON, teamOf: () => "A" };
  it("이번 주 값은 그대로", () => {
    const w = weekCompletionRate(rows, MON);
    expect(kpiCount("K29", { receptionWeek: rows }, {}, kpiRanges(MON).week, ctx)).toEqual({ n: w.done, d: w.total });
    expect(kpiCount("K29", { receptionWeek: rows }, {}, kpiRanges(MON).week, ctx)).toEqual({ n: 1, d: 2 });
  });
  it("지난주 범위를 넘기면 지난주 접수", () => {
    expect(kpiCount("K29", { receptionWeek: rows }, {}, cursorRange(MON, wk(-1)), ctx)).toEqual({ n: 2, d: 3 });
  });
});

describe("workinPace 끝난 분기", () => {
  const roster: RosterMember[] = [{ name: "가", team: "C" }, { name: "나", team: "C" }];
  const places = [{ team: "C", label: "G5", kind: "quarter" }, { team: "C", label: "G1", kind: "quarter" }];
  it("필요량은 null, 완료·대상·% 는 낸다", () => {
    const c = workinPace(places, kpiRangesAt(MON, anchorOf(MON, qt(-1))), roster).find((p) => p.team === "C")!;
    expect([c.done, c.total, c.rate]).toEqual([1, 2, 50]);
    expect([c.toEnd.need3, c.toEnd.need4, c.toEnd.needHead, c.toEarly.needHead]).toEqual([null, null, null, null]);
  });
  it("이번 분기는 필요량을 그대로 낸다", () => {
    const c = workinPace(places, kpiRanges(MON), roster).find((p) => p.team === "C")!;
    expect(c.toEnd.needHead).toBeGreaterThan(0);
  });
});
