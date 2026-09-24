import { describe, expect, it } from "vitest";
import {
  achievementRate, actionMembers, actionTeams, cycleLabel, emptyReport, gradeFromPercent, judgmentCounts, monthCycleId, okrWeeksInMonth, okrWorkWeek,
  bottleneckLabel, defaultGoalTemplate, memberReports, mergeMemberActuals, needsReasonPlan, pillarIndex, pillarLabel, renumberGoals, sortGoalsByPillar, splitPillar, weekCycleId, worstJudgment, worstOfJudgments, type OkrReport,
} from "../src/okr";

describe("OKR 종합판정 제안(worstJudgment) — 실제결과 글에서 가장 나쁜 등급 하나", () => {
  it("괄호 안 등급 낱말 중 가장 나쁜 것을 고른다(작성가이드 7번)", () => {
    const actual = "계약서 작성 확인률 : 8건 중 5건 (62.5%, 미흡)\n1주일 이내 작성완료 확인 이행률 : 8건 중 4건 (50%, 미흡)\n월말 최종 확인 : 완료 (100%, 완료)";
    expect(worstJudgment(actual)).toBe("미흡");
  });
  it("'판정: 부분달성' 같은 표기도 읽고, 미달성은 미흡으로 본다", () => {
    expect(worstJudgment("1. 계약서 확인 (판정: 완료)\n2. 7일 이내 확인 (판정: 부분달성)")).toBe("부분달성");
    expect(worstJudgment("인원별 참여율 : 4명 중 0명 (0%, 미달성)")).toBe("미흡");
  });
  it("등급 낱말이 없으면 %로 매긴다 — 100 완료 · 80~99 부분달성 · 1~79 미흡 · 0 미착수", () => {
    expect(worstJudgment("취합률 : 10건 중 10건 (100%)")).toBe("완료");
    expect(worstJudgment("취합률 : 10건 중 9건 (90%)\n적용률 : 100%")).toBe("부분달성");
    expect(worstJudgment("답글 : 0개 (0%)")).toBe("미착수");
    expect(gradeFromPercent(79)).toBe("미흡");
    expect(gradeFromPercent(80)).toBe("부분달성");
  });
  it("해당없음만 있으면 해당없음, 아무 단서도 없으면 빈 값", () => {
    expect(worstJudgment("계약 종료 대상 0건 (해당없음)")).toBe("해당없음");
    expect(worstJudgment("대상 0건 (해당없음)\n재확인 : 2건 중 1건 (50%, 미흡)")).toBe("미흡");
    expect(worstJudgment("아직 안 적음")).toBe("");
    expect(worstJudgment("")).toBe("");
  });
  it("'완료율' 같은 낱말 속 '완료'는 등급으로 세지 않는다", () => {
    // '측정 완료율: 100%'의 '완료'는 항목 이름 — 등급 낱말이 따로 없으니 %로 판단 → 완료
    expect(worstJudgment("개선 전/후 소요시간 측정 완료율 : 3건 중 2건 (66%)")).toBe("미흡");
  });
});

describe("OKR 통합집계", () => {
  const report = (team: string, judgments: string[]): OkrReport => ({ ...emptyReport("2026-08", team), rows: judgments.map((j, i) => ({ no: i + 1, actual: "", judgment: j, reason: "", plan: "", evidence: "" })) });
  const reports = [report("A", ["완료", "부분달성", "미흡"]), report("B", ["미착수", "완료", "해당없음"]), report("C", ["완료", "", "미흡"])];
  it("조치 필요 파트는 미흡·미착수만(부분달성은 제외 — 8월 통합집계 기준)", () => {
    expect(actionTeams(reports, 1)).toEqual(["B"]);
    expect(actionTeams(reports, 2)).toEqual([]);
    expect(actionTeams(reports, 3)).toEqual(["A", "C"]);
  });
  it("판정 집계와 달성률 — 완료·해당없음을 달성으로, 미기재는 분모에서 뺀다", () => {
    expect(judgmentCounts(reports[1].rows)).toMatchObject({ 미착수: 1, 완료: 1, 해당없음: 1, 미흡: 0 });
    expect(achievementRate(reports[1].rows)).toBe(67);
    expect(achievementRate(reports[2].rows)).toBe(50);
    expect(achievementRate([])).toBeNull();
  });
});

describe("OKR 팀원 기록 → 파트 종합", () => {
  const mk = (team: string, member: string, actual: string, judgment: string): OkrReport => ({ ...emptyReport("2026-09", team, member), rows: [{ no: 1, actual, judgment, reason: "", plan: "", evidence: "" }] });
  const reports = [mk("C", "", "", ""), mk("C", "이홍진", "블로그 답글 : 5개 (100%, 완료)", "완료"), mk("C", "이민구", "블로그 답글 : 2개\n댓글 1개 (40%, 미흡)", "미흡"), mk("C", "한OO", "", ""), mk("A", "김정민", "…", "완료")];
  it("팀원 기록은 파트 종합 행을 빼고 그 파트 것만, 이름순", () => {
    expect(memberReports(reports, "C").map((r) => r.member)).toEqual(["이민구", "이홍진", "한OO"]);
  });
  it("실제결과를 '• 이름: 내용'으로 합치고 여러 줄은 이름 아래 들여쓴다(빈 기록은 뺌)", () => {
    expect(mergeMemberActuals(memberReports(reports, "C"), 1)).toBe("• 이민구:\n  블로그 답글 : 2개\n  댓글 1개 (40%, 미흡)\n• 이홍진: 블로그 답글 : 5개 (100%, 완료)");
    expect(mergeMemberActuals(memberReports(reports, "C"), 2)).toBe("");
  });
  it("파트 종합판정 제안 = 팀원 판정 중 가장 나쁜 것", () => {
    expect(worstOfJudgments(["완료", "미흡", ""])).toBe("미흡");
    expect(worstOfJudgments(["해당없음", ""])).toBe("해당없음");
    expect(worstOfJudgments(["", ""])).toBe("");
  });
  it("통합집계 조치 필요 파트는 파트 종합 행만 본다(팀원 개인 미흡은 안 올라감)", () => {
    expect(actionTeams(reports, 1)).toEqual([]);
  });
  it("조치 필요 파트 옆에 그 파트에서 미흡·미착수인 팀원 이름을 붙인다", () => {
    const withPart = [{ ...mk("C", "", "…", "미흡") }, ...reports.slice(1), mk("B", "", "…", "미착수"), mk("B", "권태혁", "…", "미착수"), mk("B", "박OO", "…", "완료")];
    expect(actionMembers(withPart, 1)).toEqual({ B: ["권태혁"], C: ["이민구"] });
  });
});

describe("OKR 기간·목표 도우미", () => {
  it("Pillar 셀을 번호와 이름으로 나눈다", () => {
    expect(splitPillar("Pillar 1.\nAI · 효율성 · 비용절감")).toEqual({ num: "Pillar 1", name: "AI · 효율성 · 비용절감" });
    expect(splitPillar("매출")).toEqual({ num: "", name: "매출" });
  });
  it("근무 주(월~금)와 그 달의 주차 — 9월 1일이 든 주가 1주차, 9/7~9/11이 2주차", () => {
    expect(okrWorkWeek("2026-09-09")).toEqual({ start: "2026-09-07", end: "2026-09-11" });
    expect(okrWorkWeek("2026-09-13")).toEqual({ start: "2026-09-07", end: "2026-09-11" }); // 일요일은 지난 주
    const weeks = okrWeeksInMonth(2026, 9);
    expect(weeks[0]).toEqual({ weekNo: 1, start: "2026-08-31", end: "2026-09-04" });
    expect(weeks[1]).toEqual({ weekNo: 2, start: "2026-09-07", end: "2026-09-11" });
    expect(weeks.length).toBe(5);
  });
  it("기간 id와 이름", () => {
    expect(monthCycleId(2026, 8)).toBe("2026-08");
    expect(weekCycleId(2026, 9, 2)).toBe("2026-09-W2");
    expect(cycleLabel({ kind: "week", year: 2026, month: 9, week_no: 2 })).toBe("2026년 9월 2주차");
    expect(cycleLabel({ kind: "month", year: 2026, month: 8, week_no: null })).toBe("2026년 8월");
  });
  it("목표 삭제 후 번호를 1부터 다시 매긴다", () => {
    const goals = renumberGoals([{ no: 1, pillar: "", bottleneck: "", objective: "a", criteria: "" }, { no: 3, pillar: "", bottleneck: "", objective: "c", criteria: "" }]);
    expect(goals.map((g) => g.no)).toEqual([1, 2]);
  });
});

describe("OKR Pillar 3종 · 병목현상 번호", () => {
  it("저장된 Pillar 글을 3개 중 하나로 알아본다(번호 우선, 없으면 낱말)", () => {
    expect(pillarIndex("Pillar 1.\nAI · 효율성 · 비용절감")).toBe(0);
    expect(pillarIndex("매출증대·안정")).toBe(1);
    expect(pillarIndex("Pillar 3.\n나의 성장 · 소통")).toBe(2);
    expect(pillarIndex("")).toBe(-1);
    expect(pillarLabel("Pillar 2.\n매출증대 · 안정")).toBe("매출증대 · 안정");
  });
  it("병목현상 번호는 같은 Pillar 안에서 몇 번째인지", () => {
    const goals = defaultGoalTemplate();
    expect(goals).toHaveLength(9);
    expect(bottleneckLabel(goals, 1)).toBe("병목현상 1");
    expect(bottleneckLabel(goals, 5)).toBe("병목현상 2"); // Pillar 2의 두 번째
    expect(bottleneckLabel(goals, 9)).toBe("병목현상 3");
  });
  it("Pillar 순 정렬 — 미정은 맨 뒤, 번호 다시 매김", () => {
    const sorted = sortGoalsByPillar([
      { no: 1, pillar: "Pillar 3.\n나의 성장 · 소통", bottleneck: "", objective: "c", criteria: "" },
      { no: 2, pillar: "", bottleneck: "", objective: "x", criteria: "" },
      { no: 3, pillar: "Pillar 1.\nAI", bottleneck: "", objective: "a", criteria: "" },
    ]);
    expect(sorted.map((g) => `${g.no}${g.objective}`)).toEqual(["1a", "2c", "3x"]);
  });
  it("완료·해당없음이 아니면 사유·개선계획 필수", () => {
    expect(needsReasonPlan("부분달성")).toBe(true);
    expect(needsReasonPlan("미착수")).toBe(true);
    expect(needsReasonPlan("완료")).toBe(false);
    expect(needsReasonPlan("해당없음")).toBe(false);
    expect(needsReasonPlan("")).toBe(false);
  });
});
