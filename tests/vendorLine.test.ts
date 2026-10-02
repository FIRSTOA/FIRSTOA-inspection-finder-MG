import { describe, expect, it } from "vitest";
import { extractVendorFromText, pickLabelValue } from "../src/vendorLine";

const form = `작성자: 이호준
구분: 점검
레벨: 1
업체명:
부서명:
지역: B
키맨/접수자: 홍길동 010-1234-5678`;

describe("라벨 줄 값 읽기", () => {
  it("업체명 줄이 비어 있으면 빈 값 — 다음 줄(부서명:)을 집어 오지 않는다", () => {
    expect(extractVendorFromText(form)).toBe("");
    expect(pickLabelValue(form, "부서명")).toBe("");
  });
  it("채워진 줄은 그 줄 값만", () => {
    expect(extractVendorFromText(form.replace("업체명:", "업체명: 유팡(디어반) "))).toBe("유팡(디어반)");
    expect(pickLabelValue(form, "지역")).toBe("B");
    expect(pickLabelValue(form, "구분")).toBe("점검");
  });
  it("전각 콜론·앞 공백·없는 라벨", () => {
    expect(extractVendorFromText("  업체명： 크리액티브")).toBe("크리액티브");
    expect(extractVendorFromText("등급: A")).toBe("");
  });
});
