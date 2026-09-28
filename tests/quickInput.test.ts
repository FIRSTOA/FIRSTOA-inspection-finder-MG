import { describe, expect, it } from "vitest";
import { parseQuickVendorInput } from "../src/quickInput";

describe("짧은 수기 입력(구분 단어 + 업체명)", () => {
  it("오버홀 + 업체명 한 줄", () => {
    expect(parseQuickVendorInput("오버홀 테스트업체")).toEqual({ kind: "오버홀", vendor: "테스트업체" });
  });
  it("두 줄·순서 바뀜·A/S 표기·셋팅 표기", () => {
    expect(parseQuickVendorInput("오버홀\n주식회사 테스트")).toEqual({ kind: "오버홀", vendor: "주식회사 테스트" });
    expect(parseQuickVendorInput("테스트업체 A/S")).toEqual({ kind: "AS", vendor: "테스트업체" });
    expect(parseQuickVendorInput("셋팅 한빛학원")).toEqual({ kind: "세팅", vendor: "한빛학원" });
  });
  it("양식·일정·컴팩트 입력·업체명만 적은 것은 건드리지 않는다", () => {
    expect(parseQuickVendorInput("구분: 점검\n업체명: 테스트")).toBeNull();
    expect(parseQuickVendorInput("테스트업체 010-1234-5678")).toBeNull();
    expect(parseQuickVendorInput("12N주식회사 바심-분기마감\nD320 / 376330911641")).toBeNull();
    expect(parseQuickVendorInput("테스트업체")).toBeNull();
    expect(parseQuickVendorInput("오버홀")).toBeNull();
    expect(parseQuickVendorInput("오버홀\n테스트\n3층")).toBeNull();
  });
});
