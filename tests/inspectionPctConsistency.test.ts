// 홈 "분기 점검 %" 숫자 맞춤(2026-10-31 사용자 "홈에 분기점검 31% 라는데 팀 카드인가 어디에는 33%. 왜 다르지?").
// 10-30 실데이터(workin_map_places 4분기 quarter·monthly, visible 전부 true) 라벨 분포를 그대로 고정한다.
//   · 머리 띠 "분기 점검" = 달성표 K2 CS 전체 칸 = 5팀 완료 단위 합 / 대상 단위 합(가중) → 1,439/4,364 = 32.97% → 33
//   · 팀 카드 "정기점검" = 달성표 K2 팀 칸 = 분기 블록 팀 줄 → C팀 460/1,469 = 31.3% → 31
//   · 팀 % 다섯 개의 단순 평균(34·52·31·21·15 → 30.6 → 31)은 어느 화면에도 없다 — 전체는 가중 합이다
// 계산 버그가 아니라 범위(CS 전체 vs 팀) 차이임을 고정한다. 셈이 한 곳(workinProgress.teamWorkinProgress)에서 갈라지면 여기서 깨진다.
import { describe, expect, it } from "vitest";
import { kpiRanges, workinPace, type KpiFacts } from "../src/kpi/kpiCompute";
import { ALL_KPI_SOURCES, type KpiBundle } from "../src/kpi/kpiData";
import { parseKpiTargets } from "../src/kpi/kpiDefs";
import { quarterGoalView, tableRowsFor } from "../src/kpi/homeKpiModel";
import { headlineNumbers, teamBoardView, TEAM_INSPECTION_KPI } from "../src/kpi/teamBoard";
import type { WorkinPlaceLite } from "../src/workinProgress";

type Dist = Record<string, Record<"quarter" | "monthly", Record<string, number>>>;
// 2026-10-30 마감(= 10-31 조회, 10-31 변경 0건) 팀·종류·라벨별 곳 수
const END_1030: Dist = {
  A: { quarter: { G1: 56, G12: 1, G2: 81, G3: 67, G4: 77, G5: 301, G6: 264, G7: 36 }, monthly: {} },
  B: { quarter: { G1: 56, G12: 1, G2: 56, G3: 44, G4: 50, G5: 462, G6: 203, G7: 21 }, monthly: {} },
  C: { quarter: { G1: 50, G12: 2, G2: 40, G3: 53, G4: 55, G5: 303, G6: 399, G7: 45 }, monthly: { G1: 19, G2: 155 } },
  D: { quarter: { G1: 77, G2: 57, G3: 68, G4: 58, G5: 161, G6: 297, G7: 36 }, monthly: { G8: 1 } },
  E: { quarter: { G1: 70, G12: 15, G2: 143, G3: 96, G5: 38 }, monthly: {} },
};
const placesOf = (d: Dist): WorkinPlaceLite[] =>
  Object.entries(d).flatMap(([team, kinds]) => Object.entries(kinds).flatMap(([kind, labels]) =>
    Object.entries(labels).flatMap(([label, n]) => Array.from({ length: n }, () => ({ team, kind, label })))));

const TODAY = "2026-10-30";
const bundleOf = (facts: KpiFacts): KpiBundle => {
  const at = Date.UTC(2026, 9, 30, 6);
  return { today: TODAY, ranges: kpiRanges(TODAY), facts, sources: Object.fromEntries([...ALL_KPI_SOURCES].map((s) => [s, { status: "ok", at }])), settings: parseKpiTargets(""), unhandledInfo: null, loadedAt: at };
};
const roster = (["A", "B", "C", "D", "E"] as const).flatMap((team) => [1, 2, 3].map((i) => ({ name: `${team}${i}`, team })));

describe("홈 분기 점검 % — 10-30 실데이터", () => {
  const b = bundleOf({ workin: placesOf(END_1030), roster });
  const ctx = { teamOf: () => "", period: "week" as const };

  it("머리 띠 = K2 CS 전체 칸 = 33(가중 합 1,439/4,364)", () => {
    const all = workinPace(b.facts.workin!, b.ranges, roster)[0];
    expect([all.done, all.total]).toEqual([1439, 4364]);
    expect(headlineNumbers(b).inspectionPct).toBe(33);
    const row = tableRowsFor(b, ctx, [TEAM_INSPECTION_KPI!])[0];
    const cs = row.cells.find((c) => c.scope === "CS")!;
    expect([cs.value, cs.target]).toEqual([1439, 4364]);
  });

  it("팀 카드 정기점검 = K2 팀 칸 = 분기 블록 팀 줄(C팀 31)", () => {
    const cards = teamBoardView(b, "week", () => "");
    const q = quarterGoalView(b)!;
    const want = { A: 34, B: 52, C: 31, D: 21, E: 15 } as const;
    for (const [team, p] of Object.entries(want)) expect(cards.find((c) => c.team === team)?.inspectionPct).toBe(p);
    expect(q.teams.map((t) => Math.round(t.pct))).toEqual(Object.values(want)); // 분기 블록 팀 줄(A·B·C·D·CSS 순)
    expect(q.teams[2]).toMatchObject({ done: 460, total: 1469 });
  });

  it("팀 % 단순 평균(31)은 전체(33)와 다르다 — 전체는 팀 평균이 아니라 단위 합", () => {
    const cards = teamBoardView(b, "week", () => "");
    const mean = cards.reduce((s, c) => s + (c.inspectionPct ?? 0), 0) / cards.length;
    expect(Math.round(mean)).toBe(31);
    expect(headlineNumbers(b).inspectionPct).toBe(33);
  });

  it("같은 날 분기 블록 점선 '기간 경과' 도 33(달력 30/92일) — 진행 % 와 다른 숫자", () => {
    expect(Math.round(quarterGoalView(b)!.elapsed * 100)).toBe(33);
  });
});
