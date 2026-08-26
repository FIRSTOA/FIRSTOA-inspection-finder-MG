import { describe, expect, it } from "vitest";
import { sheetVendorName, stripGradePrefix } from "../src/vendorName";

describe("stripGradePrefix", () => {
  it("순번+등급 접두를 뗀다 (25V · 25#V · 4N · 30SS · 15NN)", () => {
    expect(stripGradePrefix("25V(주) 드림엔지니어링삼성동현장타 업체와 6:4 청구발행매월마감")).toBe("(주) 드림엔지니어링삼성동현장타 업체와 6:4 청구발행매월마감");
    expect(stripGradePrefix("25#V㈜세안이엔씨삼성서울병원 리모델링 2차")).toBe("㈜세안이엔씨삼성서울병원 리모델링 2차");
    expect(stripGradePrefix("4N주식회사 그리드엔터테인먼트")).toBe("주식회사 그리드엔터테인먼트");
    expect(stripGradePrefix("30SS제이드자산운용")).toBe("제이드자산운용");
    expect(stripGradePrefix("15NN티엠에스글로벌")).toBe("티엠에스글로벌");
  });
  it("등급 접두가 아닌 숫자·영문 머리는 건드리지 않는다", () => {
    expect(stripGradePrefix("3M코리아")).toBe("3M코리아");
    expect(stripGradePrefix("(주) 드림엔지니어링")).toBe("(주) 드림엔지니어링");
    expect(stripGradePrefix("NH농협")).toBe("NH농협");
  });
  it("엑셀 잔재 개행(_x000d_)을 공백으로 편다", () => {
    expect(stripGradePrefix("25V㈜세안이엔씨P4 PH2 북SUP_x000d_\n평택P4-PH1 북SUP현장매월마감")).toBe("㈜세안이엔씨P4 PH2 북SUP 평택P4-PH1 북SUP현장매월마감");
  });
});

describe("sheetVendorName", () => {
  it("시트 원문 업체명(지점 포함)을 우선한다", () => {
    expect(sheetVendorName({ _업체명: "(주) 드림엔지니어링", 거래처명: "(주) 드림엔지니어링", 업체명: "25V(주) 드림엔지니어링삼성동현장타 업체와 6:4 청구발행매월마감" }))
      .toBe("(주) 드림엔지니어링삼성동현장타 업체와 6:4 청구발행매월마감");
  });
  it("원문 업체명이 없으면 거래처명 → _업체명", () => {
    expect(sheetVendorName({ _업체명: "㈜세안이엔씨", 거래처명: "㈜세안이엔씨" })).toBe("㈜세안이엔씨");
    expect(sheetVendorName({ _업체명: "㈜세안이엔씨" })).toBe("㈜세안이엔씨");
    expect(sheetVendorName(null)).toBe("");
  });
});
