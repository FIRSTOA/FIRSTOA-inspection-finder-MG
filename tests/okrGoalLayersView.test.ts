// OKR 행의 주인 층 — 화면 몫(okrLayerView.ts, 2026-10-25 저녁, docs/tasks/okr-rows-per-layer-2026-10-25.md 4·5절)
// 추가 scope(보는 화면 = 주인) · 2026-10-25 밤 재정정: 내 행은 내 탭에만(접힘 복구) · 그 탭을 연 누구나 전용 행 수정·삭제 · 팀원 집계 빗금
import { describe, expect, it } from "vitest";
import { OKR_PILLARS, addGoalRow, goalsForView, removeGoalRow, visibleGoals, type OkrGoal } from "../src/okr";
import { addNoteOf, canEditRow, judgmentLockOf, layerChipLabel, layerFoldOf, ownerViewOf, rowAppliesTo, scopeForView, viewLayer, viewOf } from "../src/okrLayerView";
import { goalEditTarget } from "../src/okrGoalConfirm";

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
  // 2026-10-25 밤 재정정: 내 행은 내 탭에만 — 다른 사람 탭·파트 종합·통합집계 표에는 없다(통합집계·파트 종합은 접힘)
  it("추가한 행(번호 101+)은 그 탭에만 보이고, 다른 파트·다른 사람·통합집계 표에는 없다", () => {
    const g = layered();
    expect(g.filter((x) => x.scope).map((x) => x.no)).toEqual(expect.arrayContaining([101, 102, 103, 104, 105]));
    const seen = (v: { team?: "A" | "B"; member?: string }) => goalsForView(g, v).map((x) => x.no).filter((n) => n > 100).sort((a, b) => a - b);
    expect(seen({})).toEqual([]);
    expect(seen({ team: "A" })).toEqual([101]);
    expect(seen({ team: "A", member: "홍길동" })).toEqual([101, 102]);
    expect(seen({ team: "A", member: "김철수" })).toEqual([101, 103]);
    expect(seen({ team: "B" })).toEqual([104]);
  });
  it("보이는 행엔 판정 잠금이 없다(judgmentLockOf 는 안전장치)", () => {
    const g = layered();
    for (const v of [{}, { team: "A" as const }, { team: "A" as const, member: "홍길동" }, { team: "B" as const, member: "박영수" }]) {
      expect(goalsForView(g, v).filter((x) => judgmentLockOf(x, v))).toEqual([]);
    }
    expect(judgmentLockOf(g.find((x) => x.no === 102)!, { team: "A", member: "김철수" })).toBe("홍길동 전용 — 본인이 판정");
  });
});

describe("그 사람 탭을 연 다른 사용자가 수정·삭제 가능", () => {
  const g = layered();
  it("홍길동 탭({team:A, member:홍길동})에 보이는 전용 행은 누가 열었든 × ·행 자체 수정 — 화면 view 는 탭 기준이라 여는 사람과 무관", () => {
    const v = viewOf("A", "홍길동");
    const withX = visibleGoals(goalsForView(g, v)).filter((x) => canEditRow(x, v)).map((x) => x.no);
    expect(withX).toEqual([101, 102]); // 공통 행 × 없음, A 전용·홍길동 전용 ×
    expect(goalEditTarget(g.find((x) => x.no === 102), v)).toBe("own");
    expect(goalEditTarget(g.find((x) => x.no === 101), v)).toBe("own");
    expect(goalEditTarget(g.find((x) => x.no === 1), v)).toBe("layer");
    expect(removeGoalRow(g, 102, false, v).goals.some((x) => x.no === 102)).toBe(false);
  });
  it("통합집계 = 공통 행 전부 ×, 접힘 [정리]는 그 행 주인 탭(ownerViewOf)으로", () => {
    expect(visibleGoals(goalsForView(g, {})).filter((x) => canEditRow(x, {})).map((x) => x.no)).toEqual(nine().map((x) => x.no));
    const by = (no: number) => g.find((x) => x.no === no)!;
    expect(ownerViewOf(by(1))).toEqual({});
    expect(ownerViewOf(by(101))).toEqual({ team: "A" });
    expect(ownerViewOf(by(102))).toEqual({ team: "A", member: "홍길동" });
    expect(removeGoalRow(g, 102, false, ownerViewOf(by(102))).goals.some((x) => x.no === 102)).toBe(false);
  });
});

describe("표 아래 접힘 개수(2026-10-25 밤 재정정으로 되살림)", () => {
  it("통합집계 = 파트 전용 2행 · 개인 전용 3행, A~ 순·파트 전용 먼저", () => {
    const fold = layerFoldOf(layered(), {});
    expect([fold.teamRows, fold.memberRows]).toEqual([2, 3]);
    expect(fold.groups.map((x) => `${x.team}|${x.member || ""}|${x.goals.length}`)).toEqual(["A||1", "A|김철수|1", "A|홍길동|1", "B||1", "B|박영수|1"]);
  });
  it("A파트 종합 = 그 파트 사람들의 개인 전용만, 파트원 탭은 접힘 없음", () => {
    const fold = layerFoldOf(layered(), { team: "A" });
    expect([fold.teamRows, fold.memberRows]).toEqual([0, 2]);
    expect(fold.groups.map((x) => x.member)).toEqual(["김철수", "홍길동"]);
    expect(layerFoldOf(layered(), { team: "A", member: "홍길동" }).groups).toEqual([]);
    expect(layerFoldOf(nine(), {}).groups).toEqual([]);
  });
  it("보관 행은 접힘에서 빠지고, 명단에 없는 이름은 주인 없음(orphan)", () => {
    const g = removeGoalRow(layered(), 103, true).goals;
    const fold = layerFoldOf(g, {}, (t) => (t === "A" ? ["홍길동"] : []));
    expect(fold.memberRows).toBe(2);
    expect(fold.groups.find((x) => x.member === "홍길동")?.orphan).toBe(false);
    expect(fold.groups.find((x) => x.member === "박영수")?.orphan).toBe(true);
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
