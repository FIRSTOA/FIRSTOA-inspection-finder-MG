// OKR 엑셀 내려받기(구현 B) — 파일명·옛 분기 숨김·폰 안내 순수 함수 (2026-10-28)
import { describe, expect, it } from "vitest";
import { canExportOkrQuarter, downloadAdvice, monthRange } from "../src/okrExcelExport";
import { okrExcelFileName } from "../src/okrExcel";
import { topFilterItems } from "../src/okr";

describe("okrExcelFileName(okrExcel 것을 그대로 씀)", () => {
  it("OKR_{연}Q{분기}_{KST 날짜}.xlsx", () => {
    expect(okrExcelFileName(2026, 4, "2026-10-28")).toBe("OKR_2026Q4_2026-10-28.xlsx");
    expect(okrExcelFileName(2027, 1, "2027-01-02")).toBe("OKR_2027Q1_2027-01-02.xlsx");
  });
});

describe("canExportOkrQuarter — 옛 구조(2026-09 까지) 분기면 단추 숨김", () => {
  it("2026 Q3 이전은 숨김, Q4 부터 보임", () => {
    expect(canExportOkrQuarter(2026, 3)).toBe(false);
    expect(canExportOkrQuarter(2026, 1)).toBe(false);
    expect(canExportOkrQuarter(2025, 4)).toBe(false);
    expect(canExportOkrQuarter(2026, 4)).toBe(true);
    expect(canExportOkrQuarter(2027, 1)).toBe(true);
  });
  it("화면 필터(topFilterItems legacy)와 같은 기준", () => {
    for (const [y, q] of [[2025, 4], [2026, 1], [2026, 2], [2026, 3], [2026, 4], [2027, 1]]) {
      expect(canExportOkrQuarter(y, q)).toBe(!topFilterItems([], "2026-10-28", { year: y, quarter: q })[0].legacy);
    }
  });
});

describe("downloadAdvice", () => {
  it("아이폰·카톡 인앱이면 PC 권장 안내, PC·안드로이드 크롬은 없음", () => {
    expect(downloadAdvice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toContain("PC 에서 받는 걸 권장");
    expect(downloadAdvice("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile KAKAOTALK 10.4.0")).toContain("PC 에서 받는 걸 권장");
    expect(downloadAdvice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("");
    expect(downloadAdvice("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile")).toBe("");
  });
});

describe("monthRange — 명단 범위(그 달 1일~말일)", () => {
  it("말일·윤년", () => {
    expect(monthRange(2026, 11)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange(2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthRange(2028, 2)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
