/**
 * 분기 점검 진행률(팀별) — 워킨맵 '팀별 진행률'과 같은 셈법을 함수 하나로 꺼낸 것(홈 KPI 현황판 K2, 2026-10-23).
 * 원래 Home.tsx loadTelemetry 안에 묻혀 있던 식을 그대로 옮겼다(값이 바뀌면 안 된다 — tests/kpiCompute.test.ts 고정).
 *   · 분기점검(kind quarter): 1곳 = 1단위, G5(점검 완료)·G12(다음분기 이관)이면 완료
 *   · 매월점검(kind monthly): 1곳 = 3단위, G2 = 1 · G3 = 2 · G5/G12 = 3 완료
 * 조회는 workin_map_places 분기 전량(3천 행+) — selectRows 는 1,000행에서 잘리므로 반드시 selectAllRowsFast(kpiData.ts).
 */
export type WorkinPlaceLite = { team: string; label: string; kind: string };
export type WorkinTeamProgress = { team: string; done: number; total: number };

export const WORKIN_TEAMS = ["A", "B", "C", "D", "E"] as const;

/** 매월점검 1곳의 완료 단위(0~3) */
export function monthlyUnits(label: string): number {
  return label === "G2" ? 1 : label === "G3" ? 2 : label === "G5" || label === "G12" ? 3 : 0;
}

/** 팀별 완료 단위 / 대상 단위 */
export function teamWorkinProgress(places: WorkinPlaceLite[], teams: readonly string[] = WORKIN_TEAMS): WorkinTeamProgress[] {
  return teams.map((team) => {
    const rows = places.filter((w) => w.team === team);
    const quarterly = rows.filter((w) => w.kind === "quarter"), monthly = rows.filter((w) => w.kind === "monthly");
    return {
      team,
      total: quarterly.length + monthly.length * 3,
      done: quarterly.filter((w) => w.label === "G5" || w.label === "G12").length + monthly.reduce((s, w) => s + monthlyUnits(w.label), 0),
    };
  });
}

/** workin_map_places 조회 쿼리(분기·보이는 곳만, 홈과 같은 조건) */
export function workinProgressQuery(quarter: number): string {
  return `select=team,label,kind&quarter=eq.${quarter}&kind=in.(quarter,monthly)&visible=not.is.false&order=id.asc`;
}
