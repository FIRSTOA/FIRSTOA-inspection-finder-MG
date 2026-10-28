// OKR 작성 품질 검사 9가지(설계 5-3, 2026-10-29) — 통합검색 okr_member_report 가 쓰는 순수 함수
import { describe, expect, it } from "vitest";
import { okrWritingChecks, okrWritingSummary, type OkrGoal, type OkrReport, type OkrResultRow } from "../supabase/functions/_shared/ask/okr-rules.ts";

const g = (no: number, extra: Partial<OkrGoal> = {}): OkrGoal => ({ no, pillar: "Pillar 2.\n매출증대 · 안정", bottleneck: "", objective: `목표${no}`, criteria: `월 기준 ${no}`, ...extra });
const row = (no: number, r: Partial<OkrResultRow>): OkrResultRow => ({ no, actual: "", judgment: "", reason: "", plan: "", evidence: "", ...r });
const rep = (id: string, rows: OkrResultRow[], goals?: OkrGoal[]): OkrReport => ({ cycle_id: id, team: "C", member: "이민구", header: { leader: "", author: "", headcount: "", submitted: "" }, rows, ...(goals ? { goals } : {}) });
const who = { member: "이민구", team: "C" };
const checksOf = (issues: ReturnType<typeof okrWritingChecks>, no: number) => issues.filter((i) => i.no === no).map((i) => i.check).sort((a, b) => a - b);
const split = (nos: number[]) => nos.map((no) => g(no, { criteria: `쪼갠 기준 ${no}` }));

describe("okrWritingChecks", () => {
  it("잘 쓴 행은 검사에 걸리지 않는다", () => {
    const issues = okrWritingChecks([{ id: "2026-10-W1", goals: [g(1)], report: rep("2026-10-W1", [row(1, { actual: "10건 중 10건(100%)", judgment: "완료", evidence: "일지 링크" })], split([1])) }], who);
    expect(issues).toEqual([]);
  });

  it("1 판정 없음 · 기록 없는 주는 no 0", () => {
    const a = okrWritingChecks([{ id: "W4", goals: [g(1), g(4)], report: rep("W4", [row(1, { actual: "3건", judgment: "완료", evidence: "x" }), row(4, { actual: "진행 중" })], split([1, 4])) }], who);
    expect(checksOf(a, 4)).toEqual([1]);
    expect(checksOf(a, 1)).toEqual([]);
    const b = okrWritingChecks([{ id: "W2", goals: [g(1)], report: null }], who);
    expect(b).toEqual([expect.objectContaining({ no: 0, check: 1, text: "그 주 기록 없음" })]);
  });

  it("2 숫자 없음 · 3 사유 빈칸 · 4 개선계획 빈칸 · 7 근거 빈칸", () => {
    const a = okrWritingChecks([{ id: "W1", goals: [g(1), g(2)], report: rep("W1", [row(1, { actual: "거의 다 함", judgment: "부분달성", evidence: "e" }), row(2, { actual: "2건", judgment: "미흡", reason: "인력 부족" })], split([1, 2])) }], who);
    expect(checksOf(a, 1)).toEqual([2, 3]);
    expect(checksOf(a, 2)).toEqual([4, 7]);
  });

  it("5 해당없음인데 '대상 0건' 없음(근거 빈칸 7 은 따로 안 셈)", () => {
    const a = okrWritingChecks([{ id: "W1", goals: [g(1), g(2)], report: rep("W1", [row(1, { actual: "없음", judgment: "해당없음" }), row(2, { actual: "0", judgment: "해당없음", evidence: "대상 0건" })], split([1, 2])) }], who);
    expect(checksOf(a, 1)).toEqual([5]);
    expect(checksOf(a, 2)).toEqual([]);
  });

  it("6 글 속 %·등급과 고른 판정이 다름", () => {
    const a = okrWritingChecks([{ id: "W1", goals: [g(1)], report: rep("W1", [row(1, { actual: "14건 중 11건 (79%)", judgment: "완료", evidence: "e" })], split([1])) }], who);
    expect(checksOf(a, 1)).toEqual([6]);
    expect(a[0].text).toContain("미흡");
  });

  it("8 앞 주와 같은 실제결과(복붙, 공백 차이 무시)", () => {
    const r1 = rep("W1", [row(1, { actual: "고객 5곳 방문 5건", judgment: "완료", evidence: "e" })], split([1]));
    const r2 = rep("W2", [row(1, { actual: "고객 5곳  방문 5건", judgment: "완료", evidence: "e" })], split([1]));
    const a = okrWritingChecks([{ id: "W1", goals: [g(1)], report: r1 }, { id: "W2", goals: [g(1)], report: r2 }], who);
    expect(a.map((i) => [i.week, i.check])).toEqual([["W2", 8]]);
  });

  it("9 쪼갠 달성기준 없음 — 파트 종합 덮어쓰기·층 전용 행은 통과", () => {
    const report = rep("W1", [row(1, { actual: "1건", judgment: "완료", evidence: "e" }), row(2, { actual: "1건", judgment: "완료", evidence: "e" }), row(101, { actual: "1건", judgment: "완료", evidence: "e" })]);
    const a = okrWritingChecks([{ id: "W1", goals: [g(1), g(2), g(101, { scope: { team: "C", member: "이민구" } })], report, teamGoals: split([2]) }], who);
    expect(a.map((i) => [i.no, i.check])).toEqual([[1, 9]]);
  });

  it("남의 전용 행·보관 행은 보지 않고, 요약은 1~9 전부", () => {
    const report = rep("W1", [row(1, { actual: "1건", judgment: "완료", evidence: "e" })], split([1]));
    const a = okrWritingChecks([{ id: "W1", goals: [g(1), g(5, { hidden: true }), g(102, { scope: { team: "C", member: "다른사람" } })], report }], who);
    expect(a).toEqual([]);
    expect(okrWritingSummary([{ week: "W1", no: 1, check: 3, label: "", judgment: "미흡", text: "" }])).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 });
  });
});
