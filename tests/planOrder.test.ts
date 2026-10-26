import { describe, expect, it } from "vitest";
import { explicitOrder, mergeVisibleOrder, moveId, moveWithinGroup } from "../src/planOrder";

describe("moveId", () => {
  it("앞으로·뒤로 옮긴다", () => {
    expect(moveId(["a", "b", "c", "d"], "c", 0)).toEqual(["c", "a", "b", "d"]);
    expect(moveId(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveId(["a", "b", "c", "d"], "a", 3)).toEqual(["b", "c", "d", "a"]);
  });
  it("범위 밖 자리는 처음·끝으로 맞춘다", () => {
    expect(moveId(["a", "b", "c"], "b", -5)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", 99)).toEqual(["a", "c", "b"]);
  });
  it("없는 id 는 그대로(복사본)", () => {
    const list = ["a", "b"];
    const out = moveId(list, "z", 0);
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
  });
});

describe("moveWithinGroup", () => {
  // 김: a b c · 이: d e · 미배정: f
  const list = ["a", "b", "c", "d", "e", "f"];
  const group: Record<string, string> = { a: "김", b: "김", c: "김", d: "이", e: "이", f: "미배정" };
  const g = (id: string) => group[id];
  it("같은 사람 안에서는 옮겨진다", () => {
    expect(moveWithinGroup(list, g, "c", 0)).toEqual(["c", "a", "b", "d", "e", "f"]);
    expect(moveWithinGroup(list, g, "d", 4)).toEqual(["a", "b", "c", "e", "d", "f"]);
  });
  it("다른 사람 자리로 가면 같은 배열을 그대로 돌려준다", () => {
    expect(moveWithinGroup(list, g, "c", 4)).toBe(list);
    expect(moveWithinGroup(list, g, "d", 1)).toBe(list);
    expect(moveWithinGroup(list, g, "f", 0)).toBe(list);
  });
  it("묶음 끝 자리(바로 뒤)는 허용", () => {
    expect(moveWithinGroup(list, g, "a", 2)).toEqual(["b", "c", "a", "d", "e", "f"]);
  });
});

describe("explicitOrder", () => {
  it("명시 순서가 앞, 새 일정은 지금 순서대로 뒤", () => {
    expect(explicitOrder(["x", "a", "y", "b"], ["b", "a"])).toEqual(["b", "a", "x", "y"]);
  });
  it("목록에 없는 명시 id 는 빼고, 중복은 한 번만", () => {
    expect(explicitOrder(["a", "b"], ["z", "b", "b"])).toEqual(["b", "a"]);
    expect(explicitOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("mergeVisibleOrder", () => {
  it("화면 순서 뒤에 안 보이던 명시 순서를 남긴다", () => {
    expect(mergeVisibleOrder(["c", "a"], ["a", "h1", "c", "h2"])).toEqual(["c", "a", "h1", "h2"]);
  });
});
