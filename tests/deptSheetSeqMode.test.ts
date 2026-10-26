import { describe, expect, it } from "vitest";
import {
  buildAppendValues, DEPT_SHEET_SPECS, isSpillFormula, parseSeq, seqBySheet, spillCols,
} from "../supabase/functions/field-sheet-sync/dept-sheet-spec.ts";

// 같은 내용의 Deno 테스트: supabase/functions/field-sheet-sync/dept-sheets_test.ts 끝부분
const sales = DEPT_SHEET_SPECS.reception_sales;
const mgmt = DEPT_SHEET_SPECS.reception_mgmt;
const eq = (actual: unknown, expected: unknown, message?: string) => expect(actual, message).toEqual(expected);

describe("부서 시트 순번은 시트가 매긴다(2026-10-27 A열 #REF! 사고)", () => {
// 2026-10-27 사고: 영업 A7 머리 ARRAYFORMULA 가 채우는 A 칸(대상 칸 FORMULA 읽기 = 빈칸)에 앱이 순번을 써서 #REF!
const ARRAY_A = '=ARRAYFORMULA(IF(B7:B="","",ROW(B7:B)-6))';
const ARRAY_C = '=ARRAYFORMULA(IF(B6:B="","",TEXT(B6:B,"yymm")))';
const seqAt = new Date("2026-10-26T17:32:00Z");
const seqData = { leaseNo: "11110", route: "전화", symptom: "테스트" };

it("순번: 두 부서 시트 모두 seqMode sheet — A열을 쓰지 않는다", () => {
  for (const spec of [sales, mgmt]) {
    eq(spec.seqMode, "sheet");
    const bySheet = seqBySheet(spec, { targetA: "" });
    eq(bySheet, true);
    const v = buildAppendValues(spec, { data: seqData, author: "이민기", submittedAt: seqAt, seq: 1785 }, { seqBySheet: bySheet });
    eq(v[1], undefined, `${spec.label} A열`);
    eq(v[2], "10월 27일");
  }
});

it("순번 자동 판정 표본1: 머리 ARRAYFORMULA + 대상 A 빈 셀 → 시트가 매김", () => {
  const appSpec = { seqMode: "app" as const };
  const aColumn = ["경영지원 요청업무 리스트", "", "순번", "=MAX(A7:A)", "-", "", ARRAY_A, "", ""];
  eq(seqBySheet(appSpec, { targetA: "", aboveA: "", aColumnFormulas: aColumn }), true);
  // 6·7행 FORMULA: C6·A7 배열 수식 → A·C 를 수식 칸으로 본다(값을 쓰면 배열이 깨진다)
  const head = [["", "", ARRAY_C, "", "", "", "", "", "", "", "", "=MATCH(L5,'임대리스트'!$1:$1,0)"], [ARRAY_A, "4월 29일", "", "11:06"]];
  const cols = spillCols(head);
  eq([...cols].sort((x, y) => x - y), [1, 3]);
  const v = buildAppendValues(sales, { data: seqData, author: "이민기", submittedAt: seqAt, seq: 5923 }, { formulaCols: cols, seqBySheet: true });
  eq(v[1], undefined);
  eq(v[3], undefined);
});

it("순번 자동 판정 표본2: 행별 수식(위 행 A 가 수식) + 대상 A 빈 셀 → 시트가 매김", () => {
  const appSpec = { seqMode: "app" as const };
  eq(seqBySheet(appSpec, { targetA: "", aboveA: "=A1788+1", aColumnFormulas: ["", "", "", "", "-", "", "1", "=A7+1"] }), true);
  eq(isSpillFormula("=A1788+1"), false); // 배열 아님 → 위 행 수식 복사 경로
  eq(seqBySheet(appSpec, { targetA: "=ROW()-6" }), true);
  // 전부 값이면 앱이 매긴다(옛 동작)
  eq(seqBySheet(appSpec, { targetA: "", aboveA: "1783", aColumnFormulas: ["", "-", "1", "2"] }), false);
});

it("배열 수식 판정: 다른 시트 범위·가로 범위·행별 수식은 아니다", () => {
  eq(isSpillFormula(ARRAY_A), true);
  eq(isSpillFormula("=arrayformula(row(A7:A)-6)"), true);
  eq(isSpillFormula("=FILTER(B:B, B:B<>\"\")"), true);
  eq(isSpillFormula("=ARRAYFORMULA(VLOOKUP(K7,'임대리스트'!A:Z,3,0))"), false);
  eq(isSpillFormula("=ARRAYFORMULA(MATCH(L5:BE5,임대리스트!1:1,0))"), false);
  eq(isSpillFormula("=VLOOKUP(K7,임대리스트!A:Z,3,0)"), false);
  eq(isSpillFormula("1784"), false);
});

it("기입 뒤 A 표시값 → 순번(빈칸·#REF! 은 null)", () => {
  eq(parseSeq("1784"), 1784);
  eq(parseSeq("1,784"), 1784);
  eq(parseSeq(""), null);
  eq(parseSeq("#REF!"), null);
});
});
