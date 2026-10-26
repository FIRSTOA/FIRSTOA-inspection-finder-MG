/**
 * K35 재계약 진행(2026-10-26 사용자 지시) — 워킨맵 재계약 색 기준: G5 = 완료, G6 = 진행중, G7 = 전략영업(분모 제외).
 * 분포 = 같은 날 4분기 실측(workin_map_places kind renewal): B G1 12·G2 16·G3 29·G5 3·G7 57 / C G1 20·G2 22·G3 29·G7 28 /
 * D G1 8·G2 13·G3 11·G7 23 / E G1 3·G2 12·G3 4 / A 0행.
 */
import { describe, expect, it } from "vitest";
import { renewalProgress, workinRenewalQuery, type WorkinRenewalLite } from "../src/workinProgress";
import { RENEWAL_DONE_LABELS, RENEWAL_LABEL_DESC } from "../src/workinPlaces";
import { KPI_DEFS, mainKpiIds, parseKpiTargets, type KpiSource } from "../src/kpi/kpiDefs";
import { kpiCount, kpiProgress, kpiRanges, renewalKpi, type KpiFacts } from "../src/kpi/kpiCompute";
import type { KpiBundle } from "../src/kpi/kpiData";
import { tableRows, tableRowsFor, HEAVY_SOURCES } from "../src/kpi/homeKpiModel";
import { teamBoardKpiIds, teamBoardView, mergeTeamCardsWithSnapshot, TEAM_RENEWAL_KPI } from "../src/kpi/teamBoard";

const TODAY = "2026-10-26";
const DIST: Record<string, Record<string, number>> = {
  B: { G1: 12, G2: 16, G3: 29, G5: 3, G7: 57 },
  C: { G1: 20, G2: 22, G3: 29, G7: 28 },
  D: { G1: 8, G2: 13, G3: 11, G7: 23 },
  E: { G1: 3, G2: 12, G3: 4 },
};
let seq = 0;
const ROWS: WorkinRenewalLite[] = Object.entries(DIST).flatMap(([team, labels]) =>
  Object.entries(labels).flatMap(([label, n]) => Array.from({ length: n }, () => ({ id: ++seq, team, label }))));
const teamOf = () => "";
const ranges = kpiRanges(TODAY);

function bundleOf(facts: KpiFacts, sources: KpiSource[] = ["workinRenewal", "roster"]): KpiBundle {
  const at = Date.UTC(2026, 9, 26, 3);
  return {
    today: TODAY, ranges, facts, sources: Object.fromEntries(sources.map((s) => [s, { status: "ok", at }])),
    settings: parseKpiTargets(""), unhandledInfo: null, loadedAt: at,
  };
}

describe("재계약 진행 셈(renewalProgress)", () => {
  it("실측 분포: B 3/60(5%) · C 0/71 · D 0/32 · E 0/19 · A 대상 0 → rate null", () => {
    const p = renewalProgress(ROWS);
    expect(p.map((t) => [t.team, t.done, t.total, t.rate])).toEqual([
      ["A", 0, 0, null], ["B", 3, 60, 5], ["C", 0, 71, 0], ["D", 0, 32, 0], ["E", 0, 19, 0],
    ]);
  });
  it("G7 만 분모에서 빠지고 G6·G12·라벨 없음은 분모에 든다, 완료는 G5 만", () => {
    const p = renewalProgress([
      { team: "A", label: "G7" }, { team: "A", label: "G6" }, { team: "A", label: "G12" }, { team: "A", label: "" }, { team: "A", label: "G5" },
    ], ["A"]);
    expect(p[0]).toMatchObject({ done: 1, total: 4, rate: 25 });
  });
  it("조회 = kind renewal · 그 분기", () => {
    expect(workinRenewalQuery(4)).toBe("select=id,team,label&kind=eq.renewal&quarter=eq.4&order=id.asc");
  });
});

describe("K35 지표", () => {
  it("kpiCount: 전체 3/182, 팀 = 그 팀, 개인은 못 셈", () => {
    const f: KpiFacts = { workinRenewal: ROWS };
    expect(kpiCount("K35", f, {}, ranges.quarter, { today: TODAY, teamOf })).toEqual({ n: 3, d: 182 });
    expect(kpiCount("K35", f, { team: "B" }, ranges.quarter, { today: TODAY, teamOf })).toEqual({ n: 3, d: 60 });
    expect(kpiCount("K35", f, { team: "A" }, ranges.quarter, { today: TODAY, teamOf })).toEqual({ n: 0, d: 0 });
    expect(kpiCount("K35", f, { author: "누구" }, ranges.quarter, { today: TODAY, teamOf })).toBeNull();
    expect(kpiCount("K35", {}, {}, ranges.quarter, { today: TODAY, teamOf })).toBeNull(); // 못 읽음 ≠ 0
  });
  it("kpiProgress: A 팀(대상 0)은 값 null(0%·달성 아님), 나머지는 완료/대상", () => {
    const rows = kpiProgress("K35", { workinRenewal: ROWS }, { ranges, period: "quarter", settings: parseKpiTargets(""), teamOf });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect([by["전체"].actual, by["전체"].target, by["전체"].rate]).toEqual([3, 182, 2]);
    expect([by.B.actual, by.B.target, by.B.rate]).toEqual([3, 60, 5]);
    expect([by.A.actual, by.A.rate]).toEqual([null, null]);
  });
  it("renewalKpi(KpiValue): 전체 2%, A 팀 value null", () => {
    const v = renewalKpi(ROWS, ranges);
    expect([v.value, v.numerator, v.denominator]).toEqual([2, 3, 182]);
    expect(v.byTeam.find((t) => t.team === "A")).toMatchObject({ value: null, denominator: 0, target: null });
    expect(v.byTeam.find((t) => t.team === "B")).toMatchObject({ value: 5, numerator: 3, denominator: 60 });
  });
  it("정의: K2 바로 다음 · 분기 · 전체·팀 · 주요 목표, IT 퀴즈(K34)는 주요 목표에서 빠짐", () => {
    const ids = KPI_DEFS.map((d) => d.id);
    expect(ids.indexOf("K35")).toBe(ids.indexOf("K2") + 1);
    const d = KPI_DEFS.find((x) => x.id === "K35")!;
    expect([d.period, d.periods, d.scopes, d.targetBasis, d.main, d.loads]).toEqual(["quarter", ["quarter"], ["all", "team"], "workin", true, ["workinRenewal"]]);
    expect(mainKpiIds(parseKpiTargets("").targets)).toEqual(["K2", "K35", "K33", "K7", "K10", "K20", "K21"]);
    expect(HEAVY_SOURCES.has("workinRenewal")).toBe(true); // 첫 숫자 단계는 워킨맵 표를 안 읽는다
  });
});

describe("달성표·팀 카드", () => {
  const b = bundleOf({ workinRenewal: ROWS, roster: [] });
  const ctx = { teamOf, period: "week" as const };
  it("달성표: K35 는 K2 다음 줄, A 칸 값 null(—), B 칸 3/60", () => {
    const rows = tableRows(b, ctx);
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf("K35")).toBe(ids.indexOf("K2") + 1);
    const k35 = rows.find((r) => r.id === "K35")!;
    expect(k35.cellState).toBe("ready");
    expect(k35.cells.find((c) => c.scope === "CS")).toMatchObject({ value: 3, target: 182 });
    expect(k35.cells.find((c) => c.scope === "B")).toMatchObject({ value: 3, target: 60, status: "behind" });
    expect(k35.cells.find((c) => c.scope === "A")).toMatchObject({ value: null });
    expect(k35.teamBars.map((t) => [t.team, t.value, t.target])).toEqual([["A", 0, 0], ["B", 3, 60], ["C", 0, 71], ["D", 0, 32], ["CSS", 0, 19]]);
  });
  it("팀 카드 renewalPct: B 5 · C 0 · A null(대상 없음 → —)", () => {
    expect(TEAM_RENEWAL_KPI).toBe("K35");
    expect(teamBoardKpiIds(b.settings.targets)).toContain("K35");
    const cards = teamBoardView(b, "week", teamOf);
    const pctOf = (t: string) => cards.find((c) => c.team === t)!.renewalPct;
    expect([pctOf("A"), pctOf("B"), pctOf("C"), pctOf("D"), pctOf("E")]).toEqual([null, 5, 0, 0, 0]);
  });
  it("기다림: 재계약 원본을 아직 안 읽었으면 그 칸만 '…', 옛 캐시(renewalPct 없음)는 덮지 않음, 새 캐시는 채움", () => {
    const empty = bundleOf({}, ["roster"]);
    const live = teamBoardView(empty, "week", teamOf, "end", new Set<KpiSource>(["workinRenewal", "roster"]));
    expect(live[1].wait?.renewal).toBe(true);
    const oldSnap = live.map((c) => { const { renewalPct: _r, ...rest } = c; void _r; return { ...rest, wait: undefined }; });
    expect(mergeTeamCardsWithSnapshot(live, oldSnap).cards[1].wait?.renewal).toBe(true);
    const newSnap = live.map((c) => ({ ...c, renewalPct: 7, wait: undefined }));
    const merged = mergeTeamCardsWithSnapshot(live, newSnap).cards[1];
    expect([merged.renewalPct, merged.wait?.renewal, merged.stale]).toEqual([7, false, true]);
  });
  it("tableRowsFor 로 K35 만 세도 같은 행", () => {
    expect(tableRowsFor(b, ctx, ["K35"]).map((r) => r.id)).toEqual(["K35"]);
  });
});

describe("워킨맵 재계약 라벨 뜻(2026-10-26)", () => {
  it("G6 = 진행중(방문 대상에 남음), G7 = 전략영업(빠짐), G5·G12 빠짐", () => {
    expect(RENEWAL_LABEL_DESC.G6).toBe("진행중");
    expect(RENEWAL_LABEL_DESC.G7).toBe("전략영업(관리 밖)");
    expect([...RENEWAL_DONE_LABELS].sort()).toEqual(["G12", "G5", "G7"]);
  });
});
