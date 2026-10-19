// deno test supabase/functions/field-sheet-sync/dept-sheets_test.ts
// 순수 함수만 검사한다(시트 API 호출 없음). 행 조립·년월·순번·머리 검증·6행 번호 해석.
import assert from "node:assert/strict";
const assertEquals = (actual: unknown, expected: unknown, message?: string) => assert.deepStrictEqual(actual, expected, message);
const assertThrows = (fn: () => unknown, _type: unknown, includes: string) =>
  assert.throws(fn, (e: unknown) => e instanceof Error && e.message.includes(includes));
import {
  buildAppendValues, buildLeaseValues, buildUpdateValues, DEPT_SHEET_SPECS, fingerprintCols, kstStamp,
  lastFilledRow, nextSeq, normFingerprint, parseSourceIndex, sheetStatusText, verifyDeptHeaders,
} from "./dept-sheet-spec.ts";

const sales = DEPT_SHEET_SPECS.reception_sales;
const mgmt = DEPT_SHEET_SPECS.reception_mgmt;

// 2026-10-19 CSV 사본 5행 그대로
const SALES_ROW5 = ["순번", "접수일", "년월", "접수시간", "접수자", "처리자", "진행중/처리완료/보류/취소", "승인여부", "외근요청\n여부", "2차\n담당자", "2차\n체크여부", "순", "임대여부", "등급", "지역", "업체명", "접수유형", "접수분야", "자산번호", "미수개월수", "업체담당자", "전화번호", "접수내용", "처리내용", "모델명", "기본금액", "연평균", "계약일", "종료일", "남은개월", "기본매수", "초과장당금액", "주소"];
const MGMT_ROW5 = ["-", "날짜", "년월", "접수시간", "접수자", "처리자", "진행중/처리완료/보류/취소", "", "PC판촉여부", "외근요청여부\n(외근요청)", "순", "담당자", "임대여부", "등급", "지역", "업체명", "접수유형", "접수분야", "계약서구분", "자산번호", "미수개월수", "일반전화", "업체담당자", "전화번호", "접수내용", "처리내용", "발송여부", "작성여부", "반영여부", "특이사항", "확장성", "모델명", " 품목", " 제조사", "기종", "기본금액", "연평균", "계약일", "종료일", "남은개월", "자동연장여부", "교체일", "주소", "기기상태", "관리\n담당자", "시/도", "시/구", "방문주기", "납품담당", "키맨", "추가조건", "장비소유주", "시리얼번호(기번)", "자산번호", "위탁/유지보수및기타사항", "기본매수", "초과장당금액"];
// 6행 표시값(FORMATTED) — UNFORMATTED 로 읽으면 숫자가 오지만 표시값도 해석돼야 한다
const MGMT_ROW6 = ["", "", "", "", "", "", "", "", "", "", "", "25", "31", "19", "", "79", "", "", "", "35", "62개월", "28", "", "", "", "", "", "", "", "18", "80", "38", "33", "34", "38", "₩ 14", "₩ 15", "1900. 1. 8", "1900. 1. 9", "11", "", "32", "51", "30", "48", "52", "53", "#N/A", "44", "27", "58", "46", "36", "35", "45", "#N/A", ""];

Deno.test("열 수·마지막 열", () => {
  assertEquals(sales.columns.length, 33);
  assertEquals(mgmt.columns.length, 57);
  assertEquals(sales.columns.map((c) => c.col), Array.from({ length: 33 }, (_, i) => i + 1));
  assertEquals(mgmt.columns.map((c) => c.col), Array.from({ length: 57 }, (_, i) => i + 1));
});

Deno.test("머리 검증: 실측 5행 통과, 한 칸 밀리면 throw", () => {
  verifyDeptHeaders(sales, SALES_ROW5);
  verifyDeptHeaders(mgmt, MGMT_ROW5);
  const shifted = ["", ...SALES_ROW5];
  assertThrows(() => verifyDeptHeaders(sales, shifted), Error, "시트 머리 변경: A열 기대 '순번' 실제 ''");
  const renamed = [...MGMT_ROW5]; renamed[29] = "메모";
  assertThrows(() => verifyDeptHeaders(mgmt, renamed), Error, "AD열 기대 '특이사항' 실제 '메모'");
});

Deno.test("경영 '자산번호' 두 열은 번호로 구분", () => {
  const assetCols = mgmt.columns.filter((c) => c.header === "자산번호").map((c) => c.col);
  assertEquals(assetCols, [20, 54]);
});

Deno.test("6행 번호 해석: ₩ 14 / 62개월 / 1900. 1. 8 / #N/A / 숫자", () => {
  assertEquals(parseSourceIndex("₩ 14"), 14);
  assertEquals(parseSourceIndex("62개월"), 62);
  assertEquals(parseSourceIndex("11 개월"), 11);
  assertEquals(parseSourceIndex("1900. 1. 8"), 9); // 시트 일련번호(1899-12-30=0)
  assertEquals(parseSourceIndex("1900. 1. 9"), 10);
  assertEquals(parseSourceIndex("#N/A"), 0);
  assertEquals(parseSourceIndex(""), 0);
  assertEquals(parseSourceIndex(79), 79);
  assertEquals(parseSourceIndex(1.5), 0);
});

Deno.test("spec 의 src 와 실측 6행이 일치", () => {
  for (const c of mgmt.columns) {
    const parsed = parseSourceIndex(MGMT_ROW6[c.col - 1]);
    if (c.kind === "lease") assertEquals(parsed, c.src, `열 ${c.col} ${c.header}`);
  }
});

Deno.test("KST 날짜: 아침 9시 전 UTC 전날도 KST 날짜", () => {
  assertEquals(kstStamp(new Date("2026-10-18T23:30:00Z")), { date: "10월 19일", yymm: "2610", time: "08:30" });
  assertEquals(kstStamp(new Date("2026-01-05T00:05:00Z")), { date: "1월 5일", yymm: "2601", time: "09:05" });
});

Deno.test("순번·마지막 행", () => {
  assertEquals(nextSeq(["1", "2", "5838", "", "합계"]), 5839);
  assertEquals(nextSeq(["1,759"]), 1760);
  assertEquals(nextSeq([]), 1);
  // 데이터 7행부터: B는 3행까지, E는 4행까지 값 → 마지막 행 = 7+3 = 10
  assertEquals(lastFilledRow(7, [["a", "b", "c"], [], ["x", "", "", "y"]]), 10);
  assertEquals(lastFilledRow(7, [[], []]), 0);
});

const data = {
  leaseNo: "1993", route: "사내", via: "이정현", field: "계약서요청", receiverName: "박영현", receiverPhone: "010-1234-5678",
  symptom: "=3년 전자계약서", handler: "이윤아", outside: "외근요청", contractKind: "전자", progress: "안내완",
  vendor: "세무법인 송정택스", region: "수도권C", grade: "S", address: "서울 강남구",
};
const at = new Date("2026-10-19T08:58:00Z"); // KST 17:58

Deno.test("경영 행 조립: 열 위치·사내 요청자·수식 방지·특이사항 미기입", () => {
  const v = buildAppendValues(mgmt, { data, author: "김수인", submittedAt: at, seq: 1760 });
  assertEquals(v[1], "1760");
  assertEquals(v[2], "10월 19일");
  assertEquals(v[3], "2610");
  assertEquals(v[4], "17:58");
  assertEquals(v[5], "김수인");
  assertEquals(v[6], "이윤아");
  assertEquals(v[7], "진행중");
  assertEquals(v[8], undefined); // 빈 머리 H
  assertEquals(v[10], "외근요청");
  assertEquals(v[11], "1993");
  assertEquals(v[17], "이정현"); // 사내 → 요청자 이름
  assertEquals(v[19], "전자");
  assertEquals(v[25], "'=3년 전자계약서");
  assertEquals(v[30], undefined); // 특이사항은 임대리스트 열
  // 임대리스트 못 찾음(leaseFilled=false) → 업체명·지역·등급·주소 fallback
  assertEquals([v[14], v[15], v[16], v[43]], ["S", "수도권C", "세무법인 송정택스", "서울 강남구"]);
});

Deno.test("영업 행 조립: 진행 메모 H, 처리내용 비움, 수식 칸 건너뜀, 임대리스트 값 있으면 fallback 없음", () => {
  const v = buildAppendValues(sales, { data, author: "이정현", submittedAt: at, seq: 5839 }, { formulaCols: new Set([1, 3, 15]), leaseFilled: true });
  assertEquals(v[1], undefined); // A 수식
  assertEquals(v[3], undefined); // C 수식
  assertEquals(v[15], undefined); // 지역 수식 유지
  assertEquals(v[8], "안내완");
  assertEquals(v[12], "1993");
  assertEquals(v[24], undefined);
  assertEquals(v[14], undefined); // 등급은 임대리스트 값으로
  assertEquals(v[16], undefined);
  assertEquals(v[33], "서울 강남구"); // 주소는 leaseFormula — 수식 없으면 앱 값
});

Deno.test("업체로 접수(순 없음): 업체명·지역·등급·주소만", () => {
  const v = buildAppendValues(sales, { data: { ...data, leaseNo: "" }, author: "이정현", submittedAt: at, seq: 1 });
  assertEquals(v[12], undefined);
  assertEquals([v[14], v[15], v[16], v[33]], ["S", "수도권C", "세무법인 송정택스", "서울 강남구"]);
  assertEquals(v[13], undefined);
});

Deno.test("임대리스트 값 고정: 6행 번호로 원본 열, leaseFix 우선, 빈 값·#N/A 건너뜀", () => {
  const leaseHeaders: string[] = []; const leaseValues: string[] = [];
  for (let i = 1; i <= 90; i++) { leaseHeaders.push(`H${i}`); leaseValues.push(i === 18 ? "" : `v${i}`); }
  const out = buildLeaseValues(mgmt, MGMT_ROW6, leaseHeaders, leaseValues, { H79: "고친업체명" });
  assertEquals(out[12], "v25");
  assertEquals(out[16], "고친업체명");
  assertEquals(out[20], "v35");
  assertEquals(out[54], "v35");
  assertEquals(out[38], "v9");
  assertEquals(out[30], undefined); // 원본 빈 값
  assertEquals(out[48], undefined); // 방문주기(#N/A)
  assertEquals(out[15], undefined); // 지역은 lease 아님
});

Deno.test("갱신 값: 진행상황·처리자·처리내용만, 빈 값 안 씀", () => {
  assertEquals(buildUpdateValues(sales, { status: "완료", handler: "박민", progress: "견적서 발송완", handled: "처리함" }), { 6: "박민", 7: "처리완료", 8: "견적서 발송완", 24: "처리함" });
  assertEquals(buildUpdateValues(mgmt, { status: "보류", handled: "" }), { 7: "보류" });
  assertEquals(sheetStatusText("접수"), "진행중");
  assertEquals(sheetStatusText("이상한값"), "");
});

Deno.test("지문: 3개 이상일 때만, 시각 앞 0·공백 무시", () => {
  const v = buildAppendValues(sales, { data, author: "이정현", submittedAt: at, seq: 1 });
  assertEquals(fingerprintCols(sales, v), [2, 4, 5, 12, 23]);
  assertEquals(fingerprintCols(sales, { 2: "10월 19일", 4: "" }), []);
  assertEquals(normFingerprint(" 10월 19일"), normFingerprint("10월 19일"));
  assertEquals(normFingerprint("9:05"), normFingerprint("09:05"));
});

Deno.test("영업 spec 의 src 와 실측 6행이 일치", () => {
  const SALES_ROW6 = ["", "", "", "", "", "", "", "", "", "", "", "", "31", "19", "", "79", "", "", "35", "62개월", "", "", "", "", "38", "₩ 14", "₩ 15", "1900. 1. 8", "1900. 1. 9", "11 개월", "", "", ""];
  for (const c of sales.columns) {
    const parsed = parseSourceIndex(SALES_ROW6[c.col - 1]);
    if (c.kind === "lease") assertEquals(parsed, c.src, `열 ${c.col} ${c.header}`);
    else assertEquals(parsed, 0, `열 ${c.col} ${c.header} 은 6행 번호가 없어야 함`);
  }
});
