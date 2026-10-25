// OKR 행의 주인 층 — 화면 몫(okrLayerView.ts, 2026-10-25 저녁, docs/tasks/okr-rows-per-layer-2026-10-25.md 4·5절)
// 추가 scope(보는 화면 = 주인) · 2026-10-25 밤: 모두 보임 + 판정 잠금 · × 는 전용 행 누구나 · 접힘 없음 · 팀원 집계 빗금
import { describe, expect, it } from "vitest";
import { OKR_PILLARS, addGoalRow, goalsForView, removeGoalRow, visibleGoals, type OkrGoal } from "../src/okr";
import { addNoteOf, canEditRow, judgmentLockOf, layerChipLabel, ownerViewOf, rowAppliesTo, scopeForView, viewLayer, viewOf } from "../src/okrLayerView";

const P1 = OKR_PILLARS[0].full;
const P2 = OKR_PILLARS[1].full;
const nine = (): OkrGoal[] => OKR_PILLARS.flatMap((p, pi) => [1, 2, 3].map((n) => ({ no: pi * 3 + n, pillar: p.full, bottleneck: `병목 ${pi + 1}-${n}`, objective: `목표 ${pi * 3 + n}`, criteria: "" })));
// 공통 9 + A 전용 101 + 홍길동(A) 102 + 김철수(A) 103 + B 전용 104 + 박영수(B) 105
const layered = (): OkrGoal[] => {
  let g = nine();
  g = addGoalRow(g, P1, [], scopeForView(viewOf("A", ""))).goals;
  g = addGoalRow(g, P2, [], scopeForView(viewOf("A", "홍길동"))).goals;
  g = addGoalRow(g, P2, [], scopeForView(viewOf("A", "김철수"))).goals;
  g = addGoalRow(g, P1, [], scopeForView(viewOf("B", "__sum__"))).goals;
  g = addGoalRow(g, P1, [], scopeForView(viewOf("B", "박영수"))).goals;
  return g;
};

describe("보는 화면 → 새 행의 주인(onAdd scope)", () => {
  it("통합집계 = 공통, 파트 종합·팀원 집계 = 파트 전용, 파트원 = 개인 전용", () => {
    expect(viewOf(null, "홍길동")).toEqual({});
    expect(viewOf("A", "")).toEqual({ team: "A" });
    expect(viewOf("A", "__sum__")).toEqual({ team: "A" });
    expect(viewOf("A", "홍길동")).toEqual({ team: "A", member: "홍길동" });
    expect(scopeForView({})).toBeUndefined();
    expect(scopeForView({ team: "A" })).toEqual({ team: "A" });
    expect(scopeForView({ team: "A", member: "홍길동" })).toEqual({ team: "A", member: "홍길동" });
    expect([viewLayer({}), viewLayer({ team: "C" }), viewLayer({ team: "C", member: "x" })]).toEqual(["common", "team", "member"]);
  });
  // 2026-10-25 밤 사용자 정정("다른 사람도 보이게 — 구글시트처럼"): 예전 "다른 파트·다른 사람·통합집계 표에는 없다"를
  //   "모든 화면에 보이되, 판정 대상이 아닌 화면에선 판정 칸이 잠긴다(judgmentLockOf)" 로 고쳐 씀.
  it("추가한 행(번호 101+)은 모든 화면에 보이고, 판정 칸은 주인 쪽에서만 열린다", () => {
    const g = layered();
    expect(g.filter((x) => x.scope).map((x) => x.no)).toEqual(expect.arrayContaining([101, 102, 103, 104, 105]));
    expect(goalsForView(g).map((x) => x.no).filter((n) => n > 100).sort((a, b) => a - b)).toEqual([101, 102, 103, 104, 105]);
    const open = (v: { team?: "A" | "B"; member?: string }) => goalsForView(g).filter((x) => x.no > 100 && !judgmentLockOf(x, v)).map((x) => x.no).sort((a, b) => a - b);
    expect(open({})).toEqual([]);
    expect(open({ team: "A" })).toEqual([101]);
    expect(open({ team: "A", member: "홍길동" })).toEqual([101, 102]);
    expect(open({ team: "B" })).toEqual([104]);
    expect(open({ team: "B", member: "박영수" })).toEqual([104, 105]);
  });
  it("잠금 글 — 개인 전용은 '본인이 판정', 파트 전용은 '그 파트가 판정', 공통은 늘 열림", () => {
    const g = layered();
    const by = (no: number) => g.find((x) => x.no === no)!;
    expect(judgmentLockOf(by(102), { team: "A", member: "김철수" })).toBe("홍길동 전용 — 본인이 판정");
    expect(judgmentLockOf(by(102), { team: "A" })).toBe("홍길동 전용 — 본인이 판정"); // 파트 종합에서도 잠김
    expect(judgmentLockOf(by(101), { team: "B", member: "박영수" })).toBe("A파트 전용 — A파트가 판정");
    expect(judgmentLockOf(by(1), { team: "B", member: "박영수" })).toBe("");
    expect(judgmentLockOf(by(102), { team: "A", member: "홍길동" })).toBe("");
  });
});

describe("× 단추 = 전용 행은 어느 화면에서든, 공통 행은 통합집계에서만", () => {
  const g = layered();
  const withX = (v: { team?: "A" | "B"; member?: string }) => visibleGoals(goalsForView(g)).filter((x) => canEditRow(x, v)).map((x) => x.no).sort((a, b) => a - b);
  it("통합집계 = 전부, 파트 탭(파트 종합·파트원) = 전용 행 전부(누구 것이든)", () => {
    expect(withX({})).toEqual([...nine().map((x) => x.no), 101, 102, 103, 104, 105]);
    expect(withX({ team: "A" })).toEqual([101, 102, 103, 104, 105]);
    expect(withX({ team: "A", member: "홍길동" })).toEqual([101, 102, 103, 104, 105]);
    expect(withX({ team: "B", member: "박영수" })).toEqual([101, 102, 103, 104, 105]);
  });
  it("ownerViewOf — 그 행 주인 화면", () => {
    const by = (no: number) => g.find((x) => x.no === no)!;
    expect(ownerViewOf(by(1))).toEqual({});
    expect(ownerViewOf(by(101))).toEqual({ team: "A" });
    expect(ownerViewOf(by(102))).toEqual({ team: "A", member: "홍길동" });
    expect(removeGoalRow(g, 102, false, { team: "B", member: "박영수" }).goals.some((x) => x.no === 102)).toBe(false);
  });
});

describe("칩·추가 줄 글·팀원 집계 빗금", () => {
  it("주인 칩 — 공통 없음, 파트 전용 'A파트', 개인 전용 이름", () => {
    const g = layered();
    const by = (no: number) => g.find((x) => x.no === no)!;
    expect(layerChipLabel(by(1))).toBe("");
    expect(layerChipLabel(by(101))).toBe("A파트");
    expect(layerChipLabel(by(102))).toBe("홍길동");
    expect([addNoteOf({}), addNoteOf({ team: "A" }), addNoteOf({ team: "A", member: "홍길동" }, "홍길동"), addNoteOf({ team: "A", member: "홍길동" })]).toEqual(["모든 파트 공통", "A파트 전용", "내 전용", "홍길동 전용"]);
  });
  it("팀원 집계 칸 — 그 사람(그 파트)의 판정 대상만 값, 남의 전용·다른 파트 전용은 빗금", () => {
    const g = layered();
    const by = (no: number) => g.find((x) => x.no === no)!;
    expect(rowAppliesTo(by(1), "A", "김철수")).toBe(true);
    expect(rowAppliesTo(by(101), "A", "김철수")).toBe(true);
    expect(rowAppliesTo(by(102), "A", "홍길동")).toBe(true);
    expect(rowAppliesTo(by(102), "A", "김철수")).toBe(false);
    expect(rowAppliesTo(by(104), "A", "김철수")).toBe(false); // 다른 파트 전용
  });
});
