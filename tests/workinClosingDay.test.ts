// 매월점검 마감일 = 워킨맵 장소 이름 맨 앞 숫자(1~31) — 워킨맵 마감일순 정렬·AS 방문 판단이 같이 쓴다(2026-10-31)
import { describe, expect, it } from "vitest";
import { monthlyClosingDay } from "../src/workinPlaces";

describe("monthlyClosingDay", () => {
  it("이름 맨 앞 숫자를 마감일로 읽는다", () => {
    expect(monthlyClosingDay("20V웍스피어 유한책임회사")).toBe(20);
    expect(monthlyClosingDay(" 5SS아무개")).toBe(5);
    expect(monthlyClosingDay("31V말일마감")).toBe(31);
  });
  it("숫자 없음·범위 밖이면 null", () => {
    expect(monthlyClosingDay("V웍스피어")).toBeNull();
    expect(monthlyClosingDay("0V회사")).toBeNull();
    expect(monthlyClosingDay("45V회사")).toBeNull();
    expect(monthlyClosingDay("")).toBeNull();
  });
});
