import { describe, expect, it } from "vitest";
import { elapsedMinutes, nowRoundedDown5, suggestDuration } from "../src/field/arrivalTime";

// KST 시각을 만드는 도우미 — 기기 시간대와 무관하게 +09:00 로 고정
const kst = (hm: string) => new Date(`2026-10-27T${hm}:00+09:00`);

describe("nowRoundedDown5", () => {
  it("14:07 → 14:05", () => {
    expect(nowRoundedDown5(kst("14:07"))).toEqual({ hour: "14", minute: "05" });
  });
  it("정각·5분 배수는 그대로, 한 자리 시는 0 채움", () => {
    expect(nowRoundedDown5(kst("09:00"))).toEqual({ hour: "09", minute: "00" });
    expect(nowRoundedDown5(kst("10:55"))).toEqual({ hour: "10", minute: "55" });
  });
  it("UTC 로는 전날인 아침 8시 전에도 KST 시각", () => {
    expect(nowRoundedDown5(new Date("2026-10-26T22:59:00Z"))).toEqual({ hour: "07", minute: "55" });
  });
});

describe("elapsedMinutes", () => {
  it("도착 10:20, 지금 11:05 → 45분", () => {
    expect(elapsedMinutes("10", "20", kst("11:05"))).toBe(45);
  });
  it("분이 비면 0분으로 본다", () => {
    expect(elapsedMinutes("10", "", kst("10:30"))).toBe(30);
  });
  it("시가 비었거나 이상하면 null", () => {
    expect(elapsedMinutes("", "20", kst("11:00"))).toBeNull();
    expect(elapsedMinutes("ab", "20", kst("11:00"))).toBeNull();
    expect(elapsedMinutes("25", "00", kst("11:00"))).toBeNull();
  });
  it("도착이 지금보다 뒤(자정 넘김)면 null", () => {
    expect(elapsedMinutes("23", "50", kst("00:10"))).toBeNull();
  });
});

describe("suggestDuration", () => {
  it("흐른 분을 5분 단위로 올림", () => {
    expect(suggestDuration("10", "20", kst("11:03"))).toBe(45);
    expect(suggestDuration("10", "20", kst("10:21"))).toBe(5);
  });
  it("0분이면 숨김(null)", () => {
    expect(suggestDuration("10", "20", kst("10:20"))).toBeNull();
  });
  it("8시간 초과면 숨김, 정확히 8시간은 보임", () => {
    expect(suggestDuration("08", "00", kst("16:00"))).toBe(480);
    expect(suggestDuration("08", "00", kst("16:01"))).toBeNull();
  });
});
