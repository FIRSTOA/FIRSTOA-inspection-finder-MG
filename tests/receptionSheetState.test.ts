// 서비스접수 미처리 = 시트 상태 기준(C3): 상태 규칙(엣지 사본 ↔ 프런트 사본 대조) + 엣지 순수 로직(행 읽기·잇기·자가 치유 후보)
import { describe, expect, it } from "vitest";
import * as front from "../src/receptionSheetState";
import {
  healCandidates, linkRows, openRowsOf, parseSheetRows, receptionIdOfDupKey, SHEET_LAYOUTS, sheetDate, sheetStateClass,
  syncedReceptionIds, isCancelState,
} from "../supabase/functions/reception-sheet-open/state.ts";

// 2026-10-22 실측 상태 값(설계안 4절)
const SAMPLES: Array<[string, "done" | "hold" | "open"]> = [
  ["처리완료", "done"], ["취소", "done"], ["취소됨", "done"], ["접수취소", "done"], ["발송완료", "done"], ["중복/처리완료", "done"],
  ["해지방이관", "done"], ["해지방어방 이관", "done"], ["전략팀이관", "done"], ["방문이관", "done"], ["A/S이관", "done"], ["AS이관", "done"],
  ["a/s이관", "done"], ["재접수", "done"], ["자체해결", "done"], ["AS접수", "done"], ["A/S 접수", "done"], ["as접수", "done"],
  ["보류", "hold"], [" 보류 ", "hold"],
  ["", "open"], ["   ", "open"], ["진행중", "open"], ["처리중", "open"], ["처리예정", "open"], ["전달예정", "open"], ["미처리", "open"],
  ["부재중", "open"], ["채널보냄", "open"], ["문의중", "open"], ["복귀후 카톡준다고함", "open"], ["전자계약서미작성", "open"], ["접수", "open"],
];

describe("시트 상태 규칙", () => {
  it.each(SAMPLES)("%s → %s (두 사본 같음)", (value, want) => {
    expect(sheetStateClass(value)).toBe(want);
    expect(front.sheetStateClass(value)).toBe(want);
  });

  it("취소 계열 구분", () => {
    for (const v of ["취소", "접수취소", "취소됨", "처리완료", "이관"]) expect(front.isCancelState(v)).toBe(isCancelState(v));
    expect(isCancelState("접수취소")).toBe(true);
    expect(isCancelState("처리완료")).toBe(false);
  });

  const DATES: Array<[string, string, string]> = [
    ["2610", "10월 20일", "2026-10-20"],
    ["2610", "10월 2일", "2026-10-02"],
    ["2601", "12월 31일", "2025-12-31"],
    ["2512", "1월 2일", "2026-01-02"],
    ["", "10월 20일", ""],
    ["26년", "10월 20일", ""],
    ["2610", "2026. 10. 21", "2026-10-21"],
    ["xx", "2026-09-30", "2026-09-30"],
    ["2602", "2월 30일", ""],
    ["2610", "", ""],
  ];
  it.each(DATES)("날짜 %s + %s → %s (두 사본 같음)", (c, b, want) => {
    expect(sheetDate(c, b)).toBe(want);
    expect(front.sheetDate(c, b)).toBe(want);
  });

  it("공란 표기", () => {
    expect(front.sheetStateLabel("")).toBe("상태 비어 있음");
    expect(front.sheetStateLabel(" 진행중 ")).toBe("진행중");
  });
});

// 영업 탭 모형: 5행 머리, 6행 원본 번호, 7행~ 데이터(A~W 23칸)
function salesRow(cells: Record<number, string>): string[] {
  const row = Array(23).fill("");
  for (const [c, v] of Object.entries(cells)) row[Number(c) - 1] = v;
  return row;
}
const SALES_VALUES: string[][] = [
  salesRow({ 1: "순번", 2: "접수일", 5: "접수자", 7: "진행중/처리완료/보류/취소" }),
  salesRow({ 12: "31" }),
  salesRow({ 1: "5846", 2: "10월 20일", 3: "2610", 4: "10:01", 5: "손영근", 6: "박영업", 7: "처리완료", 15: "C", 16: "㈜세안이엔씨", 18: "해지", 22: "010-1111-2222", 23: "해지 문의" }),
  salesRow({ 1: "5847", 2: "10월 21일", 3: "2610", 4: "11:00", 5: "김수인", 6: "", 7: "", 15: "A", 16: "가나상사", 18: "재계약", 22: "010-3333-4444", 23: "재계약 상담 요청이 들어왔습니다 길게 길게 길게 길게 길게 길게 길게 길게" }),
  salesRow({ 1: "5848", 2: "7월 1일", 3: "2607", 5: "이영업", 7: "보류", 16: "다라" }),
  salesRow({ 1: "5849" }), // 순번만 있는 빈 줄
];

describe("엣지 순수 로직", () => {
  it("영업 탭 읽기: 마커 없는 줄 제외, 행 번호·날짜·분류, 전화번호 없음", () => {
    const { rows, error } = parseSheetRows(SHEET_LAYOUTS.sales, SALES_VALUES);
    expect(error).toBe("");
    expect(rows.map((r) => r.sheetRow)).toEqual([7, 8, 9]);
    expect(rows[0]).toMatchObject({ kind: "영업팀", date: "2026-10-20", author: "손영근", cls: "done", vendor: "㈜세안이엔씨", region: "C" });
    expect(rows[1]).toMatchObject({ cls: "open", state: "", field: "재계약" });
    expect(rows[1].summary.length).toBeLessThanOrEqual(41);
    expect(rows[2].cls).toBe("hold");
    expect(JSON.stringify(rows)).not.toContain("010-");
  });

  it("머리가 바뀌면 그 탭은 error 로 빠진다", () => {
    const bad = SALES_VALUES.map((r) => [...r]);
    bad[0][6] = "상태";
    const out = parseSheetRows(SHEET_LAYOUTS.sales, bad);
    expect(out.rows).toEqual([]);
    expect(out.error).toContain("시트 머리 변경");
  });

  it("원격 탭: L열 한조처리에 IT 가 있으면 IT", () => {
    const row = (cells: Record<number, string>) => { const r = Array(23).fill(""); for (const [c, v] of Object.entries(cells)) r[Number(c) - 1] = v; return r; };
    const values = [
      row({ 7: "처리여부", 12: "한조\n처리" }), row({}), row({}), row({}),
      row({ 2: "10월 21일", 3: "2610", 7: "", 10: "x", 11: "원격1", 12: "IT", 17: "강남", 18: "IT회사" }),
      row({ 2: "10월 21일", 3: "2610", 7: "부재중", 10: "x", 12: "", 17: "부산", 18: "원격회사" }),
    ];
    const { rows, error } = parseSheetRows(SHEET_LAYOUTS.remote, values);
    expect(error).toBe("");
    expect(rows.map((r) => [r.sheetRow, r.kind, r.cls])).toEqual([[5, "IT", "open"], [6, "원격이관", "open"]]);
  });

  it("잇기: 영업은 잡 sheet_row + 접수자 일치, 원격은 이번 달 + 상호 앞 6자", () => {
    const { rows } = parseSheetRows(SHEET_LAYOUTS.sales, SALES_VALUES);
    const jobs = [
      { category: "reception_sales", sheet_row: 7, _dupKey: "dept:rec-1:append", author: "손영근" },
      { category: "reception_sales", sheet_row: 8, _dupKey: "dept:rec-2:append", author: "다른사람" }, // 행 밀림 — 인정 안 함
    ];
    const remoteRows = [{ source: "remote" as const, kind: "원격이관" as const, sheetRow: 6, seq: "", date: "2026-10-21", author: "", handler: "", state: "처리완료", cls: "done" as const, vendor: "(주)원격회사 본점", field: "", region: "", summary: "" }];
    const remotes = [
      { id: "rem-1", type: "원격이관", vendor: "원격회사", receipt_date: "2026-10-21", sheet_row: 6 },
      { id: "rem-2", type: "원격이관", vendor: "원격회사", receipt_date: "2026-09-30", sheet_row: 6 }, // 지난달 — 인정 안 함
    ];
    const links = linkRows([...rows, ...remoteRows], jobs, remotes, "2026-10");
    expect([...links.entries()]).toEqual([["sales:7", "rec-1"], ["remote:6", "rem-1"]]);
    expect(syncedReceptionIds(jobs)).toEqual(["rec-1", "rec-2"]);
    expect(receptionIdOfDupKey("dept:abc:append")).toBe("abc");
    expect(receptionIdOfDupKey("other")).toBe("");
    // 자가 치유 후보: 이어진 행 중 완료만(세안이엔씨 → 완료)
    expect(healCandidates([...rows, ...remoteRows], links)).toEqual([{ id: "rec-1", to: "완료" }, { id: "rem-1", to: "완료" }]);
    // 돌려주는 행: 미처리·보류만
    expect(openRowsOf(rows, links).map((r) => r.sheetRow)).toEqual([8, 9]);
  });
});
