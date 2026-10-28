// 서비스접수 미처리 = 시트 상태 기준(C3): 상태 규칙(엣지 사본 ↔ 프런트 사본 대조) + 엣지 순수 로직(행 읽기·잇기·자가 치유 후보)
import { describe, expect, it } from "vitest";
import * as front from "../src/receptionSheetState";
import {
  healCandidates, linkRows, openRowsOf, parseSheetRows, receptionIdOfDupKey, SHEET_LAYOUTS, sheetDate, sheetStateClass,
  syncedReceptionIds, isCancelState, maskPhones, sheetRowDetail, linkCopierRows, listRowsOf, sheetTime,
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

// 2026-10-27 경영지원접수 실측: 사람이 넣은 행은 C열(년월)이 비고 B열에 "10월 26일"·"12/5" 만 → 425행 날짜가 비어
// '90일 넘음'으로 접히지 않고 2025년 행까지 미처리 숫자에 들어갔다. 아래(최신) → 위로 연도를 붙인다.
const NOW = new Date("2026-10-27T03:00:00Z"); // KST 2026-10-27 12:00
function mgmtRow(cells: Record<number, string>): string[] {
  const row = Array(26).fill("");
  for (const [c, v] of Object.entries(cells)) row[Number(c) - 1] = v;
  return row;
}
const mgmtValues = (rows: Array<Record<number, string>>): string[][] => [
  mgmtRow({ 1: "-", 2: "날짜", 3: "년월", 5: "접수자", 7: "진행중/처리완료/보류/취소" }),
  mgmtRow({}),
  ...rows.map((r) => mgmtRow({ 5: "박민", ...r })),
];
const datesOf = (bs: Array<string | [string, string]>, now = NOW) =>
  parseSheetRows(SHEET_LAYOUTS.mgmt, mgmtValues(bs.map((b) => (Array.isArray(b) ? { 2: b[0], 3: b[1] } : { 2: b }))), now).rows.map((r) => r.date);

describe("경영지원 C열 빈 행 연도 추정", () => {
  it("12월 → 1월 경계·'12/5'·앱 행(C열 있음)·맨 아래 10월 26일", () => {
    expect(datesOf(["12/5", "12월 22일", "1월 5일", "7월 13일", ["10월 20일", "2610"], "10월 26일"]))
      .toEqual(["2025-12-05", "2025-12-22", "2026-01-05", "2026-07-13", "2026-10-20", "2026-10-26"]);
  });
  it("두 해 걸친 시트(달마다 행이 있음): 2025-05 → 2026-10", () => {
    const months = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const want = months.map((m, i) => `${i < 8 ? 2025 : 2026}-${String(m).padStart(2, "0")}-05`);
    expect(datesOf(months.map((m) => `${m}월 5일`))).toEqual(want);
  });
  it("맨 아래 달이 이번 달보다 크면 작년, 오늘 뒤 날짜는 버림", () => {
    expect(datesOf(["11월 3일"])).toEqual(["2025-11-03"]);
    expect(datesOf(["10월 26일", "10월 30일"])).toEqual(["2026-10-26", ""]);
  });
  it("한 줄만 순서가 어긋나도 위 행 연도가 밀리지 않는다", () => {
    expect(datesOf(["10월 1일", "3월 5일", "10월 10일"])).toEqual(["2026-10-01", "2026-03-05", "2026-10-10"]);
    expect(datesOf(["2월 1일", "12월 3일", "2월 10일"])).toEqual(["2026-02-01", "", "2026-02-10"]);
  });
  it("C열 오타로 미래가 된 날짜(9912 → 2099)는 C열을 버리고 다시 추정", () => {
    expect(datesOf([["12월 30일", "9912"], ["1월 5일", "2601"]])).toEqual(["2025-12-30", "2026-01-05"]);
  });
  it("읽을 수 없는 B열은 그대로 빈칸, C열이 있으면 기존 규칙", () => {
    expect(datesOf(["접수", "10월 26일"])).toEqual(["", "2026-10-26"]);
    expect(datesOf([["10월 20일", "26년"]])).toEqual([""]);
  });
});

describe("전화번호 가림(공개 엣지 응답)", () => {
  it("휴대·유선·대표번호는 가운데(대표번호는 뒤) 가림, 시리얼·금액·날짜는 그대로", () => {
    expect(maskPhones("김담당대리 010-1234-5678")).toBe("김담당대리 010-****-5678");
    expect(maskPhones("01012345678 / 02-123-4567 / 031 234 5678 / 070.1234.5678")).toBe("010-****-5678 / 02-****-4567 / 031 **** 5678 / 070.****.5678");
    expect(maskPhones("대표 1588-1234")).toBe("대표 1588-****");
    expect(maskPhones("가나컴퍼니-010-1234-5678 ID문의")).toBe("가나컴퍼니-010-****-5678 ID문의"); // 업체명에 하이픈으로 붙은 번호(영업 시트 실측 꼴)
    for (const keep of ["0A6XBJKRC000B6B", "X0101234567", "₩ 59,000", "2026-10-26", "22454 22455", "순 7222,7351", "26.10.26~29.10.25"]) expect(maskPhones(keep)).toBe(keep);
  });
  it("목록 행: 업체·요약·내용 원문에 번호가 남지 않는다", () => {
    const long = "재계약 요청\n담당 김담당대리 010-1234-5678\n메일 ys_bycon@naver.com 길게 길게 길게 길게 길게 길게";
    const { rows } = parseSheetRows(SHEET_LAYOUTS.mgmt, mgmtValues([{ 2: "10월 26일", 16: "가나상사 02-123-4567", 25: long }]), NOW);
    const json = JSON.stringify(rows);
    expect(json).not.toMatch(/1234-5678|123-4567/);
    expect(rows[0].vendor).toBe("가나상사 02-****-4567");
    expect(rows[0].content).toContain("010-****-5678");
  });
  it("상세 한 행: 키맨 열은 이름은 남기고 번호만 가림, 전화 열은 통째로 뺌", () => {
    const header = mgmtRow({ 1: "-", 2: "날짜", 7: "진행중/처리완료/보류/취소", 16: "업체명", 20: "키맨", 24: "전화번호", 25: "접수내용" });
    const row = mgmtRow({ 1: "1781", 2: "10월 26일", 16: "민원119", 20: "010-9876-5432 박대표대표이사", 24: "02-555-1234", 25: "연락 031-777-8888" });
    const d = sheetRowDetail(SHEET_LAYOUTS.mgmt, header, row, 1787);
    expect(d.cells.find((c) => c.label === "키맨")?.value).toBe("010-****-5432 박대표대표이사");
    expect(d.cells.some((c) => c.label === "전화번호")).toBe(false);
    expect(d.content).toBe("연락 031-****-8888");
    expect(JSON.stringify(d)).not.toMatch(/9876-5432|555-1234|777-8888/);
  });
});

// 2026-10-28 프런트 사본(src/receptionSheetState.ts)에 엣지 순수 함수를 옮겼다 — 영업·경영 표본은 엣지와 같은 결과·같은 숫자여야 한다.
describe("프런트 사본 대조(영업·경영 표본 숫자 불변)", () => {
  it("영업 탭 읽기·잇기·미처리 행이 엣지와 같다", () => {
    const edge = parseSheetRows(SHEET_LAYOUTS.sales, SALES_VALUES, NOW);
    const mine = front.parseSheetRows(front.SHEET_LAYOUTS.sales, SALES_VALUES, NOW);
    expect(mine).toEqual(edge);
    expect(mine.rows.map((r) => r.sheetRow)).toEqual([7, 8, 9]);
    const jobs = [
      { category: "reception_sales", sheet_row: 7, _dupKey: "dept:rec-1:append", author: "손영근" },
      { category: "reception_sales", sheet_row: 8, _dupKey: "dept:rec-2:append", author: "다른사람" },
    ];
    const links = front.linkRows(mine.rows, jobs, [], "2026-10");
    expect([...links.entries()]).toEqual([["sales:7", "rec-1"]]);
    expect(front.healCandidates(mine.rows, links)).toEqual([{ id: "rec-1", to: "완료" }]);
    expect(front.openRowsOf(mine.rows, links).map((r) => r.sheetRow)).toEqual([8, 9]);
    expect(front.openRowsOf(mine.rows, links)).toEqual(openRowsOf(edge.rows, linkRows(edge.rows, jobs, [], "2026-10")));
  });
  it("경영 C열 빈 행 연도 추정이 엣지와 같다", () => {
    const values = mgmtValues(["12/5", "12월 22일", "1월 5일", "7월 13일", "10월 20일", "10월 26일", "10월 30일"].map((b) => ({ 2: b })));
    expect(front.parseSheetRows(front.SHEET_LAYOUTS.mgmt, values, NOW).rows.map((r) => r.date))
      .toEqual(parseSheetRows(SHEET_LAYOUTS.mgmt, values, NOW).rows.map((r) => r.date));
  });
  it("copier 파싱·CS 잇기·목록 모드·미처리(copier 제외)가 엣지와 같다", () => {
    const row = (cells: Record<number, string>) => { const r = Array(56).fill(""); for (const [c, v] of Object.entries(cells)) r[Number(c) - 1] = v; return r; };
    const values = [
      row({ 1: "순", 2: "날짜", 3: "년월", 4: "접수시간", 5: "접수자", 6: "퍼스트순", 8: "업체명", 19: "제목", 20: "내용", 56: "처리완료" }), row({}), row({}),
      row({ 1: "1", 2: "10월 1일", 3: "2610", 4: "9:06", 5: "김광태", 6: "19655", 8: "가나상사", 19: "용지걸림", 20: "고객 010-1234-5678", 56: "완료" }),
      row({ 1: "2", 2: "10월 1일", 3: "2610", 4: "오후 1:40", 5: "김광태", 6: "19655", 8: "가나상사" }),
      row({ 1: "3", 2: "10월 3일", 3: "2610", 5: "지경민", 8: "㈜새거래처 본점" }),
    ];
    const edge = parseSheetRows(SHEET_LAYOUTS.copier, values, NOW);
    const mine = front.parseSheetRows(front.SHEET_LAYOUTS.copier, values, NOW);
    expect(mine).toEqual(edge);
    expect(mine.rows.map((r) => [r.sheetRow, r.cls, r.time])).toEqual([[8, "record", "09:06"], [9, "record", "13:40"], [10, "record", undefined]]);
    const db = [
      { id: "a1", receipt_date: "2026-10-01", first_no: "19655", lease_no: null, author: "김광태", vendor: "가나" },
      { id: "n1", receipt_date: "2026-10-03", first_no: null, lease_no: null, author: "지경민", vendor: "새거래처 본점" },
    ];
    const myLinks = front.linkCopierRows(mine.rows, db);
    expect(myLinks).toEqual(linkCopierRows(edge.rows, db));
    const all = front.combineLinks(new Map(), myLinks).links;
    expect(front.listRowsOf(mine.rows, all, "2026-10-01", "2026-10-31")).toEqual(listRowsOf(edge.rows, all, "2026-10-01", "2026-10-31"));
    expect(front.openRowsOf(mine.rows, all)).toEqual([]);
    expect(openRowsOf(edge.rows, all)).toEqual([]);
    const bad = values.map((r) => [...r]);
    bad[0][5] = "퍼스트번호";
    expect(front.parseSheetRows(front.SHEET_LAYOUTS.copier, bad, NOW)).toEqual(parseSheetRows(SHEET_LAYOUTS.copier, bad, NOW));
    for (const t of ["9:06", "09:06:00", "오후 2:05", "오전 12:10", "13:00 PM", "25:00", ""]) expect(front.sheetTime(t)).toBe(sheetTime(t));
  });
  it("전화번호 가림이 엣지와 같다", () => {
    for (const v of ["김담당대리 010-1234-5678", "대표 1588-1234", "0A6XBJKRC000B6B", "02-123-4567"]) expect(front.maskPhones(v)).toBe(maskPhones(v));
  });
});
