// 통합검색 분석 도구(2026-10-29): OKR 규칙을 _shared/ask/okr-rules.ts 로 옮기고 src 는 다시 내보낸다 — 같은 함수·같은 결과여야 한다
import { describe, expect, it } from "vitest";
import * as srcOkr from "../src/okr";
import * as srcKpi from "../src/kpi/kpiCompute";
import * as srcIt from "../src/itSheet";
import * as rules from "../supabase/functions/_shared/ask/okr-rules.ts";
import * as itShared from "../supabase/functions/_shared/ask/it-sheet.ts";
import type { OkrGoal, OkrReport } from "../src/okr";

const goals: OkrGoal[] = [1, 2, 3].map((no) => ({ no, pillar: "Pillar 1.\nAI · 효율성 · 비용절감", bottleneck: `병목 ${no}`, objective: `목표 ${no}`, criteria: `기준 ${no}` }));
const rep = (cycle_id: string, team: string, member: string, js: string[]): OkrReport => ({
  cycle_id, team, member, header: { leader: "", author: "", headcount: "", submitted: "" },
  rows: js.map((judgment, i) => ({ no: i + 1, actual: `${i + 1}건`, judgment, reason: "", plan: "", evidence: "" })),
});
const reports = [
  rep("2026-10-W1", "C", "이민구", ["완료", "미흡", "해당없음"]),
  rep("2026-10-W2", "C", "이민구", ["완료", "완료", ""]),
  rep("2026-10-W1", "C", "지경민", ["미착수", "", ""]),
  rep("2026-10-W1", "A", "홍길동", ["완료", "완료", "완료"]),
  rep("2026-10-W1", "C", "", ["완료", "", ""]),
];
const roster = [{ name: "이민구", team: "C" }, { name: "지경민", team: "C" }, { name: "박미작", team: "C" }, { name: "팀장님", team: "C", title: "팀장" }, { name: "홍길동", team: "A" }];
const w = { id: "2026-10-W1", weeks: [{ id: "2026-10-W1", weekNo: 1, label: "1주" }, { id: "2026-10-W2", weekNo: 2, label: "2주" }], goals, reports };

describe("OKR 규칙 재수출 패리티", () => {
  it("src/okr·kpiCompute·itSheet 가 내보내는 함수는 _shared 의 같은 함수다", () => {
    for (const name of ["normalizeJudgment", "achievementRate", "worstJudgment", "needsReasonPlan", "goalAppliesTo", "goalsApplyingTo", "monthScreenGoals", "goalsForTeamTotal", "isLegacyMonthId", "weeksOfMonth", "lastJudgmentInMonth", "okrWritingChecks"]) {
      expect((srcOkr as Record<string, unknown>)[name], name).toBe((rules as Record<string, unknown>)[name]);
    }
    for (const name of ["okrWeekMemberRows", "okrMemberShares", "okrShareAverage", "okrWeekResult", "okrTeamMembers", "okrWeekTeamRows", "okrWeekMembers"]) {
      expect((srcKpi as Record<string, unknown>)[name], name).toBe((rules as Record<string, unknown>)[name]);
    }
    for (const name of ["parseCsv", "rowsFromCsv", "searchRows", "buildQuiz", "dedupeLinks", "valueByPrefix", "IT_TABS"]) {
      expect((srcIt as Record<string, unknown>)[name], name).toBe((itShared as Record<string, unknown>)[name]);
    }
    expect(srcOkr.JUDGMENT_INFO).toBe(rules.JUDGMENT_INFO);
  });

  it("K19 셈 — 개인·팀 평균(미작성 0%)·전체 평균이 화면 규칙 그대로", () => {
    const shares = srcKpi.okrMemberShares(w, "C", roster, ["2026-10-W1", "2026-10-W2"]);
    // 이민구 판정 5개 중 완료·해당없음 4 → 80%, 지경민 1개 중 0 → 0%, 박미작 판정 0 = 미작성 0%, 팀장 제외
    expect(shares.map((s) => [s.name, s.done, s.judged])).toEqual([["이민구", 4, 5], ["지경민", 0, 1], ["박미작", 0, 0]]);
    expect(srcKpi.okrShareAverage(shares)).toBe(27);
    expect(rules.okrShareAverage(rules.okrMemberShares(w, "C", roster, ["2026-10-W1", "2026-10-W2"]))).toBe(27);
    const r = srcKpi.okrWeekResult(w, "2026-10-W1", { team: "ALL" }, roster);
    expect(r.missingTeams).toEqual(["B", "D"]);
    expect(r.byTeam.find((x) => x.team === "A")?.pct).toBe(100);
    expect(srcKpi.okrShareAverage([{ team: "C", name: "x", done: 0, judged: 0 }])).toBeNull();
  });

  it("판정 낱말·글 속 % 판정·주차", () => {
    expect(srcOkr.normalizeJudgment("미달성")).toBe("미흡");
    expect(rules.worstJudgment("14건 중 11건 (79%, 미흡)")).toBe("미흡");
    expect(rules.worstJudgment("처리율 85%")).toBe("부분달성");
    expect(srcOkr.isLegacyMonthId("2026-09")).toBe(true);
    expect(srcOkr.isLegacyMonthId("2026-10")).toBe(false);
    expect(rules.weeksOfMonth(2026, 10).map((x) => x.start)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  });
});
