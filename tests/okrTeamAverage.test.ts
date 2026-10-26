// 팀 OKR 달성률 = 팀원별 달성률 평균, 미작성 0% (2026-10-26 사용자 "A팀은 1명만 썼는데 C팀(2명 작성)보다 높다 · 3명인 팀과 4명인 팀의 차이")
import { describe, expect, it } from "vitest";
import { achievementRate, emptyReport, type OkrCycle, type OkrReport } from "../src/okr";
import {
  kpiCount, kpiRanges, okrKpi, okrMemberShares, okrMonthWeekFacts, okrShareAverage, okrTeamMembers, okrWeekMemberRows, okrWeekResult,
  type KpiFacts, type OkrWeekFacts, type RosterMember,
} from "../src/kpi/kpiCompute";
import { okrPeopleForTeam, okrView } from "../src/kpi/homeKpiModel";
import { ALL_KPI_SOURCES, type KpiBundle } from "../src/kpi/kpiData";
import { KPI_BY_ID, parseKpiTargets } from "../src/kpi/kpiDefs";
import { headlineNumbers, teamBoardFromParts } from "../src/kpi/teamBoard";

const TODAY = "2026-10-23"; // 금요일 = 10월 3주차
const R = kpiRanges(TODAY);
const ctx = { today: TODAY, teamOf: () => "" };
const goals = [1, 2].map((no) => ({ no, pillar: "P", bottleneck: "", objective: `목표${no}`, criteria: "" }));
const weeks = [1, 2, 3, 4].map((n) => ({ id: `2026-10-W${n}`, weekNo: n, label: `${n}주` }));
const rep = (cycle: string, team: string, member: string, js: string[]): OkrReport => ({
  ...emptyReport(cycle, team, member), rows: js.map((j, i) => ({ no: i + 1, actual: "", judgment: j, reason: "", plan: "", evidence: "" })),
});
const W3 = "2026-10-W3";
// A 4명(한 명만 100%), C 3명(100%·50%·미작성) — 사용자 사례 그대로
const roster: RosterMember[] = [
  { name: "가", team: "A" }, { name: "나", team: "A" }, { name: "다", team: "A" }, { name: "라", team: "A" },
  { name: "마", team: "C" }, { name: "바", team: "C" }, { name: "사", team: "C" },
  { name: "팀장님", team: "A", title: "팀장" },
];
const reports = [rep(W3, "A", "가", ["완료", "완료"]), rep(W3, "C", "마", ["완료", "해당없음"]), rep(W3, "C", "바", ["완료", "미흡"])];
const w: OkrWeekFacts = { id: W3, weeks, goals, reports };
const bundleOf = (facts: KpiFacts): KpiBundle => {
  const at = Date.UTC(2026, 9, 23, 3);
  return { today: TODAY, ranges: R, facts, sources: Object.fromEntries([...ALL_KPI_SOURCES].map((s) => [s, { status: "ok", at }])), settings: parseKpiTargets(""), unhandledInfo: null, loadedAt: at };
};

describe("팀 달성률 = 팀원별 평균(미작성 0%)", () => {
  it("4명 팀에 1명만 100% → 25% (종전 = 쓴 사람 판정만 → 100%)", () => {
    expect(okrWeekResult(w, W3, { team: "A" }, roster).pct).toBe(25);
  });
  it("3명 팀 100%·50%·미작성 → 50%", () => {
    expect(okrWeekResult(w, W3, { team: "C" }, roster).pct).toBe(50);
  });
  it("그래서 1명만 쓴 A(25%)가 2명 쓴 C(50%)보다 낮다 — byTeam 도 같은 숫자", () => {
    const r = okrWeekResult(w, W3, undefined, roster);
    expect(r.byTeam).toEqual([{ team: "A", pct: 25 }, { team: "B", pct: null }, { team: "C", pct: 50 }, { team: "D", pct: null }]);
  });
  it("전체 = A~D 구성원 7명 평균(사람마다 같은 무게): (100 + 100 + 50) / 7 = 36", () => {
    expect(okrWeekResult(w, W3, undefined, roster).pct).toBe(36);
    expect(kpiCount("K19", { okr: { cycle: null, quarter: null, reports: [], week: w }, roster }, {}, R.week, ctx)).toEqual({ n: 36, d: 100 });
    expect(kpiCount("K19", { okr: { cycle: null, quarter: null, reports: [], week: w }, roster }, { team: "A" }, R.week, ctx)).toEqual({ n: 25, d: 100 });
  });
  it("명단에 없는 보고자도 구성원(분모)에 든다 · 팀장은 빠진다", () => {
    const extra = { ...w, reports: [...reports, rep(W3, "A", "외부", ["미흡", "미흡"])] };
    expect(okrTeamMembers(extra, "A", roster).sort()).toEqual(["가", "나", "다", "라", "외부"].sort());
    expect(okrWeekResult(extra, W3, { team: "A" }, roster).pct).toBe(20); // (100 + 0×4) / 5
    // 홈 팀원 목록(okrPeopleForTeam)과 같은 집합 — "미작성 n명" 과 분모가 어긋나지 않는다
    const b = bundleOf({ okr: { cycle: null, quarter: null, reports: [], week: extra }, roster });
    expect(okrPeopleForTeam(b, "A").map((p) => p.name).sort()).toEqual(okrTeamMembers(extra, "A", roster).sort());
  });
  it("명단이 없으면 보고자만으로(종전 화면이 명단을 못 읽었을 때)", () => {
    expect(okrWeekResult(w, W3, { team: "C" }).pct).toBe(75); // 마 100·바 50
  });
  it("그 팀에 판정이 하나도 없으면 null(미작성 팀) — 0% 로 그리지 않는다, 판정 수·미작성 팀은 종전대로", () => {
    const r = okrWeekResult(w, W3, undefined, roster);
    expect(r.missingTeams).toEqual(["B", "D"]);
    expect(r.counts["완료"] + r.counts["해당없음"] + r.counts["미흡"]).toBe(4); // 파트 판정 행(A 2 + C 2, 종전 그대로)
    expect(okrShareAverage([{ team: "A", name: "가", done: 0, judged: 0 }])).toBeNull();
  });
  it("개인 선택은 종전과 같다(그 사람 판정 비율)", () => {
    const me = okrWeekResult(w, W3, { team: "C", member: "바" }, roster);
    expect(me.pct).toBe(achievementRate(okrWeekMemberRows(goals, reports, W3, "바", "C")));
    expect(me.pct).toBe(50);
    expect(kpiCount("K19", { okr: { cycle: null, quarter: null, reports: [], week: w }, roster }, { author: "바" }, R.week, ctx)).toEqual({ n: 1, d: 2 });
  });
});

describe("홈 OKR 박스·팀 카드·머리 숫자 = 같은 숫자", () => {
  const b = bundleOf({ okr: { cycle: null, quarter: null, reports: [], week: w }, roster });
  it("링 %·팀 칩 %·주별 막대 pct 가 같은 정의", () => {
    const all = okrView(b)!;
    expect(all.pct).toBe(36);
    expect(all.teamLines?.map((l) => [l.team, l.pct, l.missing])).toEqual([["A", 25, 3], ["B", null, 0], ["C", 50, 1], ["D", null, 0]]);
    expect(all.weeks.find((x) => x.id === W3)?.pct).toBe(36);
    const a = okrView(b, { team: "A" })!;
    expect(a.pct).toBe(25);
    expect(a.weeks.map((x) => x.pct)).toEqual(weeks.map((x) => okrWeekResult(w, x.id, { team: "A" }, roster).pct));
  });
  it("팀 카드 okrPct·머리 띠 OKR % 도 같은 숫자", () => {
    const cards = teamBoardFromParts({ rows: null, unhandled: null, roster, okrWeek: w });
    expect(cards.find((c) => c.team === "A")?.okrPct).toBe(25);
    expect(cards.find((c) => c.team === "C")?.okrPct).toBe(50);
    expect(headlineNumbers(b).okrPct).toBe(36);
  });
});

describe("월 범위(달성표 K19 [월]) — 그 달 주차 전부, 개인 = 그 달 자기 행 비율", () => {
  const cycle: OkrCycle = { id: "2026-10", kind: "month", title: "", year: 2026, month: 10, week_no: null, start_date: "2026-10-01", end_date: "2026-10-31", parent_id: null, goals, feedback: {}, goals_origin: "leader" };
  // 가: 2주 완료·미흡 + 3주 완료·완료 = 3/4 · 나·다·라 미작성 → A = 75/4 = 19
  const monthReports = [...reports, rep("2026-10-W2", "A", "가", ["완료", "미흡"])];
  const mw: OkrWeekFacts = { id: W3, weeks, goals, reports: monthReports };
  const okr = { cycle, quarter: null, reports: [rep("2026-10", "A", "", ["완료", "완료"])], week: mw };
  it("팀 = 팀원 월 비율 평균, 전체 = 7명 평균", () => {
    expect(okrMemberShares(mw, "A", roster, weeks.map((x) => x.id)).find((s) => s.name === "가")).toEqual({ team: "A", name: "가", done: 3, judged: 4 });
    expect(kpiCount("K19", { okr, roster }, { team: "A" }, R.month, ctx)).toEqual({ n: 19, d: 100 });
    expect(kpiCount("K19", { okr, roster }, {}, R.month, ctx)).toEqual({ n: 32, d: 100 }); // (75 + 100 + 50) / 7 = 32.1
    const v = okrKpi(okr, R, undefined, roster);
    expect(v.value).toBe(32);
    expect(v.byTeam.map((t) => [t.team, t.value])).toEqual([["A", 19], ["B", null], ["C", 50], ["D", null]]);
  });
  it("주차 기록이 없는 옛 달(8·9월)은 월 파트 종합 판정 비율 그대로", () => {
    const legacy = { cycle, quarter: null, reports: [rep("2026-10", "A", "", ["완료", "미흡"])], week: { ...mw, reports: [] } };
    expect(okrMonthWeekFacts(legacy)).toBeNull();
    expect(kpiCount("K19", { okr: legacy, roster }, { team: "A" }, R.month, ctx)).toEqual({ n: 1, d: 2 });
    expect(okrKpi(legacy, R, undefined, roster).value).toBe(50);
  });
  it("주차 묶음이 다른 달이면 월 범위에 쓰지 않는다", () => {
    expect(okrMonthWeekFacts({ ...okr, cycle: { ...cycle, id: "2026-11" } })).toBeNull();
  });
});

describe("K25 이름 — 새 K35 '재계약 진행'과 겹치지 않게", () => {
  it("K25 = 재계약 기록", () => {
    expect(KPI_BY_ID.K25.name).toBe("재계약 기록");
    expect(KPI_BY_ID.K35.name).toBe("재계약 진행");
  });
});
