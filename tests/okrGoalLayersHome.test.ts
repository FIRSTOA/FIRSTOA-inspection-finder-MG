import { describe, expect, it } from "vitest";
import { emptyReport, type OkrGoal, type OkrReport } from "../src/okr";
import { okrWeekMemberRows, okrWeekResult } from "../src/kpi/kpiCompute";

// 홈 % = 그 팀에 보이는 행(공통 + 파트 전용 + 팀원 개인 전용) 중 판정 있는 것
const W = "2026-10-W4";
const g = (no: number, scope?: { team: string; member?: string }) => ({ no, pillar: "P", bottleneck: "", objective: `목표${no}`, criteria: "", ...(scope ? { scope } : {}) }) as unknown as OkrGoal;
const rep = (team: string, member: string, rows: Array<[number, string]>): OkrReport => ({
  ...emptyReport(W, team, member),
  rows: rows.map(([no, judgment]) => ({ no, actual: "", judgment, reason: "", plan: "", evidence: "" })),
});

describe("홈 OKR % — 행의 주인(층)", () => {
  const common = [g(1), g(2)];
  const reports = [rep("A", "", [[1, "완료"], [2, "완료"]]), rep("B", "", [[1, "완료"], [2, "완료"]])];

  it("공통 행만 있으면 결과 불변", () => {
    const r = okrWeekResult({ id: W, weeks: [], goals: common, reports });
    expect(r.byTeam).toEqual([{ team: "A", pct: 100 }, { team: "B", pct: 100 }, { team: "C", pct: null }, { team: "D", pct: null }]);
  });
  it("A 전용 행 판정은 A % 에만 들어가고 B 에는 안 들어간다", () => {
    const goals = [...common, g(101, { team: "A" })];
    const rs = [rep("A", "", [[1, "완료"], [2, "완료"], [101, "미흡"]]), reports[1]];
    const r = okrWeekResult({ id: W, weeks: [], goals, reports: rs });
    expect(r.byTeam.find((x) => x.team === "A")?.pct).toBe(67);
    expect(r.byTeam.find((x) => x.team === "B")?.pct).toBe(100);
  });
  it("개인 전용 행은 그 사람·그 팀에만", () => {
    const goals = [...common, g(102, { team: "A", member: "한X" })];
    const rs = [reports[0], rep("A", "한X", [[1, "완료"], [2, "완료"], [102, "미흡"]]), reports[1], rep("B", "박X", [[1, "완료"], [2, "완료"]])];
    const w = { id: W, weeks: [], goals, reports: rs };
    expect(okrWeekResult(w).byTeam.find((x) => x.team === "A")?.pct).toBe(67); // 팀원 중 가장 나쁜 것(미흡)
    expect(okrWeekResult(w).byTeam.find((x) => x.team === "B")?.pct).toBe(100);
    expect(okrWeekMemberRows(goals, rs, W, "한X", "A").map((x) => x.no)).toEqual([1, 2, 102]);
    expect(okrWeekMemberRows(goals, rs, W, "박X", "B").map((x) => x.no)).toEqual([1, 2]);
  });
});
