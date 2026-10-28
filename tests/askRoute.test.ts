import { describe, expect, it } from "vitest";
import { askRoute, evidenceGroups, followUpContext, peopleIn, periodIn, teamsIn, toAskAnswerView, usageLineOf, vendorOfRow } from "../src/askRoute";

const MEMBERS = [
  { name: "이민구", team: "C", active: true },
  { name: "박영현", team: "A", active: true },
  { name: "지경민", team: "IT", active: true },
  { name: "퇴사자", team: "B", active: false },
];

describe("askRoute — 설계안 8절 라우트", () => {
  it("이민구 10월 OKR 분석 → 분석, 사람·팀", () => {
    const r = askRoute("이민구 10월 OKR 분석해줘", MEMBERS);
    expect(r.kind).toBe("analysis");
    expect(r.people).toEqual([{ name: "이민구", team: "C" }]);
    expect(r.teams).toEqual(["C"]);
    expect(r.period).toBe("month");
    expect(r.note).toContain("OKR·사람 분석");
    expect(r.note).toContain("이민구(C)");
  });
  it("이민구 OKR 작성 잘 되었는지 → 분석", () => {
    expect(askRoute("이민구 OKR 작성 잘 되었는지, 어느 부분이 잘되고 안 되었는지 분석해줘", MEMBERS).kind).toBe("analysis");
  });
  it("C팀 이번 달 점검 누락 업체 → 분석, 팀 C", () => {
    const r = askRoute("C팀 이번 달 점검 누락 업체", MEMBERS);
    expect(r.kind).toBe("analysis");
    expect(r.teams).toEqual(["C"]);
    expect(r.people).toEqual([]);
  });
  it("C팀 미수 리스트 → 전체 질문", () => {
    expect(askRoute("C팀 미수 중 CS가 체크할 곳 리스트 줘", MEMBERS).kind).toBe("data");
  });
  it("잡플러스 → 검색, 잡플러스 AS 몇 번 → 업체 질문 시도", () => {
    expect(askRoute("잡플러스", MEMBERS).kind).toBe("search");
    expect(askRoute("B6945", MEMBERS).kind).toBe("search");
    expect(askRoute("잡플러스 AS 몇 번 터졌어?", MEMBERS).kind).toBe("entity");
    expect(askRoute("무암 언제부터 임대했고 기기 이동 이력 있어?", MEMBERS).kind).toBe("entity");
  });
  it("X3220 세로줄 원인 → 지식 질문(분석 아님)", () => {
    const r = askRoute("X3220 세로줄 생기면 원인이 뭐야?", MEMBERS);
    expect(r.kind).toBe("data");
    expect(r.note).toContain("지식");
  });
  it("앱에서 자가 반납 → 지식 질문", () => {
    expect(askRoute("자가 반납은 앱에서 어떻게 해?", MEMBERS).kind).toBe("data");
  });
  it("미수 3개월 이상 중 방문 안 한 곳 → 조건 질문(업체 찾기 건너뜀)", () => {
    expect(askRoute("미수 3개월 이상 중 방문 안 한 곳", MEMBERS).kind).toBe("data");
  });
  it("재계약 진행률 낮은 팀 원인 → 분석 + KPI 꾸러미", () => {
    const r = askRoute("재계약 진행률 낮은 팀과 원인 알려줘", MEMBERS);
    expect(r.kind).toBe("analysis");
    expect(r.packs).toEqual(["kpi"]);
  });
  it("B팀 KPI 빨강 → 분석 + 꾸러미, 팀 B", () => {
    const r = askRoute("B팀 KPI 중 빨강인 것과 이유", MEMBERS);
    expect(r.kind).toBe("analysis");
    expect(r.packs).toEqual(["kpi"]);
    expect(r.teams).toEqual(["B"]);
    expect(r.period).toBe("week");
  });
  it("지경민 접수 처리 패턴 → 사람 분석", () => {
    const r = askRoute("지경민 접수 처리 패턴 알려줘", MEMBERS);
    expect(r.kind).toBe("analysis");
    expect(r.people[0].name).toBe("지경민");
  });
  it("업체 ○○ 로 적으면 사람 아님", () => {
    expect(peopleIn("업체 이민구 AS 몇 번?", MEMBERS)).toEqual([]);
  });
  it("퇴사자(비활성)는 사람으로 안 잡음", () => {
    expect(peopleIn("퇴사자 이번 달 뭐 했어?", MEMBERS)).toEqual([]);
  });
  it("방식 고정은 그대로, 단서는 뽑는다", () => {
    const r = askRoute("C팀 KPI 현황", MEMBERS, "data");
    expect(r.kind).toBe("data");
    expect(r.teams).toEqual(["C"]);
    expect(r.packs).toEqual(["kpi"]);
    expect(askRoute("잡플러스", MEMBERS, "analysis").kind).toBe("analysis");
  });
  it("팀·기간 단서", () => {
    expect(teamsIn("CSS팀하고 a팀 비교")).toEqual(["E", "A"]);
    expect(periodIn("4분기 재계약")).toBe("quarter");
    expect(periodIn("이번 주 순위")).toBe("week");
  });
});

describe("응답 → 답 카드", () => {
  const res = {
    answer: "결론", mode: "analysis", model: "gpt-5.5", calls: ["a", "b", "c"], ms: 24_400,
    cost: { usd: 0.214, priced: true, model: "gpt-5.5" },
    limits: { rounds: 16, maxRounds: 16, maxUsd: 1.5, stopped: "rounds" as const, note: "왕복 상한" },
    evidence: [
      { id: "e1", tool: "okr_member_report", title: "OKR 주차별 판정", columns: ["주차", "목표", "판정"], rows: [{ 주차: "W4", 목표: 4, 판정: "" }], count: 1, truncated: false },
      { id: "e2", tool: "query_rows", table: "misu", rows: [{ 업체명: "잡플러스", 개월: 3 }], count: 300, truncated: true },
    ],
  };
  it("evidence → 묶음, 판정 칸 노랑, 잘림 표시", () => {
    const g = evidenceGroups(res);
    expect(g).toHaveLength(2);
    expect(g[0].warnWhenEmpty).toBe("판정");
    expect(g[1].title).toContain("전체 300 중");
  });
  it("옛 응답(rows·table)도 묶음 하나로", () => {
    expect(evidenceGroups({ rows: [{ a: 1 }], table: "jeomgeom" })[0].title).toBe("jeomgeom");
  });
  it("usageLine·limit·body", () => {
    expect(usageLineOf(res)).toBe("gpt-5.5 · 조회 3번 · $0.21 · 24초");
    const v = toAskAnswerView("q", res, "본문");
    expect(v.mode).toBe("analysis");
    expect(v.body).toBe("본문");
    expect(v.limit).toEqual({ reason: "rounds", calls: 3, usd: 0.214 });
    expect(v.basis).toContain("왕복 상한");
  });
  it("이어서 묻기 요약은 1,500자 안", () => {
    const c = followUpContext("질문", "가".repeat(5000));
    expect(c.length).toBeLessThanOrEqual(1500);
    expect(c).toContain("앞 질문: 질문");
  });
  it("업체 칸", () => {
    expect(vendorOfRow({ _업체명: "무암" })).toBe("무암");
    expect(vendorOfRow({ 주차: "W1" })).toBe("");
  });
});
