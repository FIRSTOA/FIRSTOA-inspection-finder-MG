/**
 * 홈 KPI 지난 기간 보기 — 구현 C(2026-10-26 docs/tasks/home-period-nav-2026-10-26.md 6절).
 * 파생 묶음(bundleAt·pastBundle) · 열린 건 "지금" · 대비 숨김 · 끝난 분기 · 할 일 판정(cursorPlan) · LRU 3 · 늦은 응답 무시 · 팀 카드 미처리 = 지금.
 */
import { describe, expect, it } from "vitest";
import { kpiRanges, type KpiFacts } from "../src/kpi/kpiCompute";
import { ALL_KPI_SOURCES, type KpiBundle } from "../src/kpi/kpiData";
import { parseKpiTargets, type KpiSource } from "../src/kpi/kpiDefs";
import {
  bundleAt, cursorPlan, lruPut, pastBundle, prevRangeOf, quarterGoalView, readRangeOf, requestGate, tableRowsFor,
} from "../src/kpi/homeKpiModel";
import { teamBoardView } from "../src/kpi/teamBoard";
import type { UnhandledRow } from "../src/homeUnhandled";

const TODAY = "2026-10-28"; // 수요일 — 이번 주 10/26~11/1, 지난주 10/19~10/25
const teamOf = (a: string) => ({ 한왕주: "C", 이민구: "C", 가: "A" } as Record<string, string>)[a] || "미지정";
const un = (team: UnhandledRow["team"], key: string): UnhandledRow => ({ key, source: "reception", kind: "CS접수", team, date: "2026-10-20", vendor: "", title: "", assignee: "", status: "", ageDays: 3 });
const FACTS: KpiFacts = {
  roster: [{ name: "한왕주", team: "C" }, { name: "이민구", team: "C" }, { name: "가", team: "A" }],
  itPractice: [
    { author: "한왕주", date: "2026-10-20" }, { author: "이민구", date: "2026-10-21" }, { author: "가", date: "2026-10-24" }, // 지난주 3
    { author: "한왕주", date: "2026-10-27" }, // 이번 주 1
  ],
  unhandled: [un("A", "1"), un("C", "2")],
  workin: [{ team: "C", label: "G5", kind: "quarter" }, { team: "C", label: "G1", kind: "quarter" }],
};
const bundleOf = (facts: KpiFacts = FACTS, sources: Iterable<KpiSource> = ALL_KPI_SOURCES): KpiBundle => ({
  today: TODAY, ranges: kpiRanges(TODAY), facts,
  sources: Object.fromEntries([...sources].map((s) => [s, { status: "ok", at: 1 }])),
  settings: parseKpiTargets(""), unhandledInfo: null, loadedAt: 1,
});
const ctx = { teamOf, period: "week" as const };
const csValue = (b: KpiBundle, id: "K21" | "K16") => tableRowsFor(b, ctx, [id])[0].cells[0].value;

describe("파생 묶음 bundleAt", () => {
  it("offset 0 이면 같은 객체(cachedView 캐시 유지)", () => {
    const b = bundleOf();
    expect(bundleAt(b, TODAY, { period: "week", offset: 0 })).toBe(b);
    expect(pastBundle(b, TODAY, { period: "week", offset: 0 }, { kind: "now" })).toBe(b);
  });
  it("−1주 파생 묶음은 지난주 범위로 센다(같은 원본, 새 객체)", () => {
    const b = bundleOf();
    const d = bundleAt(b, TODAY, { period: "week", offset: -1 });
    expect(d).not.toBe(b);
    expect(d.ranges.week).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(d.ranges.weekElapsedRate).toBe(100);
    expect(d.today).toBe(TODAY);
    expect(csValue(b, "K21")).toBe(1);
    expect(csValue(d, "K21")).toBe(3);
    expect(d.window).toEqual(readRangeOf(b)); // 원래 읽은 범위
  });
  it("주·월 커서는 분기 칸을 메인 묶음 것 그대로(워킨맵은 메인 분기만 읽었다)", () => {
    const b = bundleOf();
    const d = bundleAt(b, TODAY, { period: "month", offset: -1 }); // 9월 = 3분기 달
    expect(d.ranges.month).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(d.ranges.quarter).toEqual(b.ranges.quarter);
  });
});

describe("열린 건(K12·K16·K17·K18) — 지난 기간이면 지금 값 + 지금 칩, 상태색 없음", () => {
  it("−1주: K16 행 nowChip·status none, 값은 지금 그대로", () => {
    const b = bundleOf();
    const d = bundleAt(b, TODAY, { period: "week", offset: -1 });
    const row = tableRowsFor(d, ctx, ["K16"])[0];
    expect(row.nowChip).toBe(true);
    expect(row.status).toBe("none");
    expect(row.cells.every((c) => c.status === "none")).toBe(true);
    expect(row.cells[0].value).toBe(csValue(b, "K16"));
    expect(row.cells[0].value).not.toBeNull();
  });
  it("이번 기간이면 지금 칩 없음", () => {
    expect(tableRowsFor(bundleOf(), ctx, ["K16"])[0].nowChip).toBeUndefined();
  });
});

describe("대비(지난 기간 대비) — 직전 기간을 안 읽었으면 숨김", () => {
  it("−1주: 직전 주(10/12~10/18 전체)는 읽은 범위 안 → '전 주'", () => {
    const d = bundleAt(bundleOf(), TODAY, { period: "week", offset: -1 });
    expect(prevRangeOf(d.ranges, "week", readRangeOf(d))).toEqual({ range: { from: "2026-10-12", to: "2026-10-18" }, label: "전 주" });
  });
  it("−7주: 직전 주(8/31~9/6)가 읽은 범위(9/1~) 밖 → null(trend 없음)", () => {
    const d = bundleAt(bundleOf(), TODAY, { period: "week", offset: -7 });
    expect(d.ranges.week.from).toBe("2026-09-07");
    expect(prevRangeOf(d.ranges, "week", readRangeOf(d))).toBeNull();
  });
  it("이번 주는 옛 동작 그대로(지난주 같은 요일까지)", () => {
    const b = bundleOf();
    expect(prevRangeOf(b.ranges, "week", readRangeOf(b))).toEqual(prevRangeOf(b.ranges, "week"));
  });
});

describe("할 일 판정 cursorPlan · 합치기 pastBundle", () => {
  const want = new Set<KpiSource>(["field", "expansion", "events", "workin", "blog", "itPractice", "okr", "unhandled", "roster"]);
  it("−1~−7주·지난달 = 메모리(derive), 2달 전·지난 분기 = 추가 조회(load)", () => {
    const b = bundleOf();
    expect(cursorPlan(b, TODAY, { period: "week", offset: 0 }, want).kind).toBe("now");
    expect(cursorPlan(b, TODAY, { period: "week", offset: -7 }, want).kind).toBe("derive");
    expect(cursorPlan(b, TODAY, { period: "month", offset: -1 }, want).kind).toBe("derive");
    const m2 = cursorPlan(b, TODAY, { period: "month", offset: -2 }, want);
    expect(m2.kind).toBe("load");
    if (m2.kind === "load") {
      expect(m2.range).toEqual({ from: "2026-08-01", to: "2026-08-31" });
      expect([...m2.sources].sort()).toEqual(["events", "expansion", "field", "itPractice", "okr", "roster"]); // 워킨맵·블로그·미처리는 안 읽는다
    }
    const q = cursorPlan(b, TODAY, { period: "quarter", offset: -1 }, want);
    expect(q.kind === "load" && q.sources.has("workin")).toBe(true);
  });
  it("지난달(9월)은 OKR 달이 달라 OKR 만 작은 추가 조회(okrKey)", () => {
    const p = cursorPlan(bundleOf(), TODAY, { period: "month", offset: -1 }, want);
    expect(p.kind === "derive" && p.okrKey).toBeTruthy();
    const w = cursorPlan(bundleOf(), TODAY, { period: "week", offset: -1 }, want);
    expect(w.kind === "derive" && w.okrKey).toBeNull(); // 같은 달 주차
  });
  it("load: 읽기 전엔 그 원본이 비어(기다림), 읽은 뒤엔 그 값 · 블로그 등 메모리 원본은 메인 것", () => {
    const b = bundleOf();
    const cursor = { period: "month" as const, offset: -2 };
    const plan = cursorPlan(b, TODAY, cursor, want);
    const waiting = pastBundle(b, TODAY, cursor, plan);
    expect(waiting.sources.itPractice).toBeUndefined();
    expect(waiting.facts.itPractice).toBeUndefined();
    expect(waiting.sources.blog).toEqual(b.sources.blog);
    expect(waiting.window).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    const loaded: KpiBundle = { ...bundleOf({ itPractice: [{ author: "가", date: "2026-08-10" }] }, ["itPractice"]) };
    const done = pastBundle(b, TODAY, cursor, plan, { loaded });
    expect(done.facts.itPractice).toEqual([{ author: "가", date: "2026-08-10" }]);
    expect(done.facts.roster).toEqual(FACTS.roster); // 명단을 새로 못 읽었으면 지금 명단
    expect(tableRowsFor(done, { teamOf, period: "month" }, ["K21"])[0].cells[0].value).toBe(1);
  });
});

describe("끝난 분기 — 필요량·기준일 숨김", () => {
  it("지난 분기(3분기) 파생: need null, 남은 영업일 0, '분기 마감'", () => {
    const d = bundleAt(bundleOf(), TODAY, { period: "quarter", offset: -1 });
    expect(d.ranges.quarter).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    const q = quarterGoalView(d)!;
    expect(q.endLabel).toMatch(/^분기 마감/);
    expect(q.bizDaysLeft).toBe(0);
    expect(q.teams.every((t) => t.need === null)).toBe(true);
    expect(quarterGoalView(bundleOf())!.endLabel).toMatch(/^분기 말일/);
  });
});

describe("팀 카드 — 지난 기간이어도 미처리는 지금", () => {
  it("파생 묶음에 미처리가 없어도 now 묶음의 미처리 수", () => {
    const now = bundleOf();
    const past = pastBundle(now, TODAY, { period: "month", offset: -2 }, cursorPlan(now, TODAY, { period: "month", offset: -2 }, new Set<KpiSource>(["itPractice", "unhandled"])));
    const noUnhandled: KpiBundle = { ...past, facts: { ...past.facts, unhandled: undefined } };
    const cards = teamBoardView(noUnhandled, "month", teamOf, "end", undefined, now);
    expect(cards.find((c) => c.team === "C")?.unhandled).toBe(1);
    expect(cards.find((c) => c.team === "A")?.unhandled).toBe(1);
    expect(teamBoardView(noUnhandled, "month", teamOf, "end").find((c) => c.team === "C")?.unhandled).toBeNull();
  });
});

describe("추가 묶음 캐시 LRU 3 · 늦은 응답 무시", () => {
  it("넷째를 넣으면 가장 오래된 것부터 버리고, 다시 넣은 키는 최근으로", () => {
    let m = new Map<string, number>();
    m = lruPut(m, "a", 1); m = lruPut(m, "b", 2); m = lruPut(m, "c", 3);
    m = lruPut(m, "a", 10); // a 를 최근으로
    m = lruPut(m, "d", 4); // b 가 밀려남
    expect([...m.keys()]).toEqual(["c", "a", "d"]);
    expect(m.get("a")).toBe(10);
  });
  it("원래 Map 은 바꾸지 않는다(React 상태)", () => {
    const m = new Map([["x", 1]]);
    lruPut(m, "y", 2);
    expect([...m.keys()]).toEqual(["x"]);
  });
  it("커서를 두 번 빨리 바꾸면 마지막 요청만 반영", async () => {
    const gate = requestGate();
    const applied: string[] = [];
    const run = (name: string, ms: number) => {
      const t = gate.begin();
      return new Promise<void>((r) => setTimeout(() => { if (gate.isLatest(t)) applied.push(name); r(); }, ms));
    };
    await Promise.all([run("첫 요청(느림)", 20), run("둘째 요청(빠름)", 1)]);
    expect(applied).toEqual(["둘째 요청(빠름)"]);
  });
});
