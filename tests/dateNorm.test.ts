import { describe, expect, it } from "vitest";
import { displayDateCell, kstYear, normalizeDateFields, normalizeDateKeep, normalizeDateText } from "../src/dateNorm";
import { normalizeCatForm, isCatDateKey } from "../src/categoryForms";
import { buildMisuVisitRow } from "../src/misuVisitApi";
import { emptyMisuVisitDraft } from "../src/misuVisit";

describe("normalizeDateText — 실제 섞여 있던 꼴(2026-10-24)", () => {
  it("형식 8가지", () => {
    expect(normalizeDateText("2026-11-15")).toBe("2026-11-15");                     // 1. 표준
    expect(normalizeDateText("26-11-15")).toBe("2026-11-15");                       // 2. 2자리 연도
    expect(normalizeDateText("26,11,30")).toBe("2026-11-30");                       // 3. 쉼표
    expect(normalizeDateText("26년10월22일")).toBe("2026-10-22");                    // 4. 한글(2자리)
    expect(normalizeDateText("2026년 3월 5일")).toBe("2026-03-05");                  //    한글(4자리·공백)
    expect(normalizeDateText("2024. 5. 23")).toBe("2024-05-23");                    // 5. 점+공백
    expect(normalizeDateText("Thu Aug 24 2023 00:00:00 GMT+0900 (Korean Standard Time)")).toBe("2023-08-24"); // 6. 시트 Date 글자
    expect(normalizeDateText("6월 19일", { baseYear: 2026 })).toBe("2026-06-19");    // 7. 연도 없음 + 기준 해
    expect(normalizeDateText("2026-09-30T16:00:00.000Z")).toBe("2026-10-01");       // 8. UTC 시각 글자 → KST 날짜
    expect(normalizeDateText("2026/10/21")).toBe("2026-10-21");
    expect(normalizeDateText("2026.10.2")).toBe("2026-10-02");
    expect(normalizeDateText("2026-10-29(목)")).toBe("2026-10-29");                  // 꼬리 허용
  });

  it("formCount.looseYmd 와 같은 결과(교체 대비)", () => {
    expect(normalizeDateText("2026-10-01T08:52:15.000Z")).toBe("2026-10-01");
    expect(normalizeDateText("26-07-13")).toBe("2026-07-13");
    expect(normalizeDateText("6월 19일")).toBeNull(); // baseYear 없으면 못 읽음(looseYmd 는 "")
  });

  it("깨진 값은 null", () => {
    for (const bad of ["", "   ", "미정", "차주 중", "2026-02-30", "2026-13-01", "26-00-10", "2026-10-291", "10,000,000", "1899-01-01", "Foo Bar 12 2023", "13월 5일", "abc"]) {
      expect(normalizeDateText(bad, { baseYear: 2026 })).toBeNull();
    }
    expect(normalizeDateText(null)).toBeNull();
    expect(normalizeDateText(undefined)).toBeNull();
  });
});

describe("저장값 정규화 — 전후", () => {
  it("normalizeDateKeep: 읽히면 바꾸고 못 읽으면 원래 글자", () => {
    expect(normalizeDateKeep(" 26-11-15 ")).toBe("2026-11-15");
    expect(normalizeDateKeep("미정")).toBe("미정");
    expect(normalizeDateKeep("6월 19일")).toBe("6월 19일");
    expect(normalizeDateKeep("6월 19일", { baseYear: 2027 })).toBe("2027-06-19");
  });

  it("normalizeDateFields: 날짜 칸만 바꾼다", () => {
    const before = { 계약종료일: "26,11,30", 방문일: "26년10월22일", 업체명: "26-11-15 상사", 제안일자: "10-22 홍길동" };
    const after = normalizeDateFields(before, { baseYear: 2026 });
    expect(after).toEqual({ 계약종료일: "2026-11-30", 방문일: "2026-10-22", 업체명: "26-11-15 상사", 제안일자: "10-22 홍길동" });
    expect(before.계약종료일).toBe("26,11,30"); // 원본 객체는 그대로
  });

  it("재계약·불만·초과조정 양식: 저장 직전 정규화", () => {
    expect(isCatDateKey("recontract", "계약종료일")).toBe(true);
    expect(isCatDateKey("recontract", "제안일자")).toBe(false);
    expect(isCatDateKey("recontract", "업체명")).toBe(false);
    const re = normalizeCatForm("recontract", { 계약종료일: "26-11-15", 다음확인일: "차주 중", 업체명: "가나상사" }, { baseYear: 2026 });
    expect(re).toEqual({ 계약종료일: "2026-11-15", 다음확인일: "차주 중", 업체명: "가나상사" });
    expect(normalizeCatForm("bulman", { 방문일: "6월 19일", 다음확인일: "2024. 5. 23" }, { baseYear: 2026 })).toEqual({ 방문일: "2026-06-19", 다음확인일: "2024-05-23" });
    expect(normalizeCatForm("overage-adjust", { 방문일: "26,11,30" })).toEqual({ 방문일: "2026-11-30" });
  });

  it("미수 방문: promise_date 저장값", () => {
    const d = { ...emptyMisuVisitDraft({}, new Date("2026-10-24T03:00:00Z")), promise_date: "11월 5일" };
    const row = buildMisuVisitRow(d, { missing: [], text: "", room: "", albumId: "" });
    expect(row.promise_date).toBe("2026-11-05");
    const row2 = buildMisuVisitRow({ ...d, promise_date: "2026-11-05" }, { missing: [], text: "", room: "", albumId: "" });
    expect(row2.promise_date).toBe("2026-11-05");
    const row3 = buildMisuVisitRow({ ...d, promise_date: "월말" }, { missing: [], text: "", room: "", albumId: "" });
    expect(row3.promise_date).toBe("월말");
  });
});

describe("조회 탭 표시", () => {
  it("날짜 칸만 정규화해 보여 준다", () => {
    expect(displayDateCell("26-11-15", "계약종료일")).toBe("2026-11-15");
    expect(displayDateCell("2026-09-30T15:00:00.000Z", "날짜")).toBe("2026-10-01");
    expect(displayDateCell("6월 19일", "방문일")).toBe("6월 19일");
    expect(displayDateCell("26-11-15", "비고")).toBe("26-11-15");
  });

  it("kstYear: 12/31 밤(UTC) 은 KST 다음 해", () => {
    expect(kstYear("2026-12-31T16:00:00Z")).toBe(2027);
    expect(kstYear(new Date("2026-06-01T00:00:00Z"))).toBe(2026);
  });
});
