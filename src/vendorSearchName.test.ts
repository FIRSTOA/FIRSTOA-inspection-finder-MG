import { describe, expect, it } from "vitest";
import { vendorSearchName } from "./ids";

describe("vendorSearchName", () => {
  it("이름 속 숫자는 남긴다", () => {
    expect(vendorSearchName("카페24")).toContain("카페24");
  });
  it("날짜·대수 꼬리는 자른다", () => {
    expect(vendorSearchName("세원기술단 10.1부터")).toBe("세원기술단");
    expect(vendorSearchName("세원기술단 3대")).toBe("세원기술단");
    expect(vendorSearchName("(주)세원기술단 - 본사")).toBe("세원기술단");
  });
});
