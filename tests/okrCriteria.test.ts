import { describe, expect, it } from "vitest";
import { criteriaToCarry, emptyReport, mergeResultRows, overlayCriteria, putCriteria, remapReports, type OkrGoal, type OkrResultRow } from "../src/okr";

const row = (no: number, actual: string, judgment = ""): OkrResultRow => ({ no, actual, judgment, reason: "", plan: "", evidence: "" });
describe("주차 번호 정리 — 같은 사람 행 둘 합치기", () => {
  it("비면 채워진 쪽, 둘 다 있으면 먼저 것 뒤에 덧붙이고 판정은 먼저 것", () => {
    const keep = [row(1, "계약서 5건", "부분달성"), row(5, "교육 2회", "완료"), row(8, "", "")];
    const incoming = [row(1, "추가 2건", "완료"), row(6, "미수 3건", "미흡"), row(8, "점검 10곳", "완료")];
    const out = mergeResultRows(keep, incoming);
    expect(out.map((r) => r.no)).toEqual([1, 5, 6, 8]);
    expect(out[0]).toMatchObject({ actual: "계약서 5건\n추가 2건", judgment: "부분달성" });
    expect(out[1]).toMatchObject({ actual: "교육 2회", judgment: "완료" });
    expect(out[2]).toMatchObject({ actual: "미수 3건", judgment: "미흡" });
    expect(out[3]).toMatchObject({ actual: "점검 10곳", judgment: "완료" });
  });
  it("같은 글이면 두 번 붙이지 않는다", () => {
    expect(mergeResultRows([row(2, "같은 글", "완료")], [row(2, "같은 글", "미흡")])[0]).toMatchObject({ actual: "같은 글", judgment: "완료" });
  });
});

const g = (no: number, objective: string, criteria: string): OkrGoal => ({ no, pillar: "Pillar 1.\nAI", bottleneck: "", objective, criteria });
const common = [g(1, "A", "a0"), g(2, "B", "b0"), g(3, "C", "c0")];

// 2026-10-01 사용자: 목표는 통합집계 하나, 달성기준은 파트 종합 → 개인 순으로 덮어쓰되 고친 번호만
describe("OKR 달성기준 덧씌우기", () => {
  it("파트가 2번만 고치면 2번 달성기준만 바뀌고 목표는 공통 그대로", () => {
    const part = overlayCriteria(common, [{ ...g(2, "옛 목표 글", "b-part") }]);
    expect(part.map((x) => x.criteria)).toEqual(["a0", "b-part", "c0"]);
    expect(part.map((x) => x.objective)).toEqual(["A", "B", "C"]); // 파트 칸에 남은 옛 목표 글은 무시
  });
  it("개인이 3번만 고치면 1·2번은 파트 것, 3번은 개인 것", () => {
    const part = overlayCriteria(common, [g(2, "", "b-part")]);
    const me = overlayCriteria(part, [g(3, "", "c-me")]);
    expect(me.map((x) => x.criteria)).toEqual(["a0", "b-part", "c-me"]);
  });
  it("색 html은 덮어쓰는 쪽 것만 — 공통의 criteria 색은 버리고 objective 색은 남긴다", () => {
    const base = [{ ...g(1, "A", "a0"), html: { objective: "<span>A</span>", criteria: "<span>a0</span>" } }];
    expect(overlayCriteria(base, [{ ...g(1, "", "a1") }])[0].html).toEqual({ objective: "<span>A</span>" });
    expect(overlayCriteria(base, [{ ...g(1, "", "a1"), html: { criteria: "<b>a1</b>" } }])[0].html).toEqual({ objective: "<span>A</span>", criteria: "<b>a1</b>" });
  });
  it("전주 불러오기: 지금 기본과 다른 번호만 가져온다(같은 건 위 단계 것이 계속 흐르게), 빈 건 제외", () => {
    const prev = [g(1, "A", "a0"), g(2, "B", "b-last"), g(3, "C", "")];
    expect(criteriaToCarry(prev, common).map((x) => [x.no, x.criteria])).toEqual([[2, "b-last"]]);
  });
  it("putCriteria는 같은 번호를 바꿔 넣고 번호순으로", () => {
    expect(putCriteria([g(3, "", "c"), g(1, "", "a")], [g(1, "", "a2"), g(2, "", "b")]).map((x) => `${x.no}:${x.criteria}`)).toEqual(["1:a2", "2:b", "3:c"]);
  });
  it("목표 삽입·삭제로 번호가 바뀌면 기록의 달성기준 칸도 같이 옮긴다", () => {
    const r = { ...emptyReport("2026-10-W1", "A", "홍길동"), rows: [{ no: 2, actual: "x", judgment: "완료", reason: "", plan: "", evidence: "" }], goals: [g(2, "", "b-me"), g(3, "", "c-me")] };
    const remap = new Map([[1, 1], [3, 2]]); // 2번 삭제
    const out = remapReports([r], remap)[0];
    expect(out.rows).toEqual([]);
    expect(out.goals?.map((x) => [x.no, x.criteria])).toEqual([[2, "c-me"]]);
  });
});
