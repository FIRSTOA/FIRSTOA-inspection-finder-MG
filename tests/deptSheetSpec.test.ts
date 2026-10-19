import { describe, expect, it } from "vitest";
import {
  buildAppendValues, buildLeaseValues, buildUpdateValues, DEPT_SHEET_SPECS, isDeptSheetCategory, kstStamp,
  nextSeq, parseSourceIndex, verifyDeptHeaders,
} from "../supabase/functions/field-sheet-sync/dept-sheet-spec.ts";

// 같은 내용의 Deno 테스트: supabase/functions/field-sheet-sync/dept-sheets_test.ts (npx deno test 로 실행)
const sales = DEPT_SHEET_SPECS.reception_sales;
const mgmt = DEPT_SHEET_SPECS.reception_mgmt;
const MGMT_ROW6: string[] = Array(57).fill("");
Object.entries({ 12: "25", 13: "31", 14: "19", 16: "79", 20: "35", 21: "62개월", 22: "28", 30: "18", 31: "80", 32: "38", 33: "33", 34: "34", 35: "38", 36: "₩ 14", 37: "₩ 15", 38: "1900. 1. 8", 39: "1900. 1. 9", 40: "11", 42: "32", 43: "51", 44: "30", 45: "48", 46: "52", 47: "53", 48: "#N/A", 49: "44", 50: "27", 51: "58", 52: "46", 53: "36", 54: "35", 55: "45", 56: "#N/A" })
  .forEach(([col, v]) => { MGMT_ROW6[Number(col) - 1] = v; });

describe("부서 시트 사양", () => {
  it("열 수와 category", () => {
    expect(sales.columns).toHaveLength(33);
    expect(mgmt.columns).toHaveLength(57);
    expect(isDeptSheetCategory("reception_sales")).toBe(true);
    expect(isDeptSheetCategory("reception_copier")).toBe(false);
  });

  it("경영 '자산번호' 중복 열을 번호로 구분하고 6행 번호와 맞다", () => {
    expect(mgmt.columns.filter((c) => c.header === "자산번호").map((c) => c.col)).toEqual([20, 54]);
    for (const c of mgmt.columns) if (c.kind === "lease") expect(parseSourceIndex(MGMT_ROW6[c.col - 1])).toBe(c.src);
  });

  it("6행 서식값 해석(원화·개월·날짜 일련번호·#N/A)", () => {
    expect(parseSourceIndex("₩ 14")).toBe(14);
    expect(parseSourceIndex("62개월")).toBe(62);
    expect(parseSourceIndex("1900. 1. 8")).toBe(9);
    expect(parseSourceIndex("#N/A")).toBe(0);
  });

  it("머리 한 칸 밀림은 throw", () => {
    const row5 = mgmt.columns.map((c) => c.header);
    expect(() => verifyDeptHeaders(mgmt, row5)).not.toThrow();
    expect(() => verifyDeptHeaders(mgmt, ["", ...row5])).toThrow(/시트 머리 변경: A열 기대 '-' 실제 ''/);
  });

  it("순번은 사람 줄이 섞여도 숫자 최댓값 + 1, 날짜는 KST", () => {
    expect(nextSeq(["1", "2", "", "메모", "1,759"])).toBe(1760);
    expect(kstStamp(new Date("2026-10-18T23:30:00Z"))).toEqual({ date: "10월 19일", yymm: "2610", time: "08:30" });
  });

  it("업체로 접수(순 없음)면 업체명·지역·등급·주소만 앱 값", () => {
    const data = { route: "전화", field: "청구관련", symptom: "문의", vendor: "가나다", region: "수도권A", grade: "S", address: "서울" };
    const v = buildAppendValues(mgmt, { data, author: "김수인", submittedAt: new Date("2026-10-19T01:00:00Z"), seq: 1760 });
    expect([v[11], v[14], v[15], v[16], v[43]]).toEqual([undefined, "S", "수도권A", "가나다", "서울"]);
    expect(v[7]).toBe("진행중");
    expect(v[13]).toBeUndefined();
  });

  it("임대리스트 고정 값과 갱신 값", () => {
    const headers = Array.from({ length: 90 }, (_, i) => `H${i + 1}`);
    const values = Array.from({ length: 90 }, (_, i) => `v${i + 1}`);
    const lease = buildLeaseValues(mgmt, MGMT_ROW6, headers, values, { H35: "고친자산" });
    expect([lease[20], lease[54], lease[48]]).toEqual(["고친자산", "고친자산", undefined]);
    expect(buildUpdateValues(sales, { status: "완료", handled: "끝" })).toEqual({ 7: "처리완료", 24: "끝" });
  });
});
