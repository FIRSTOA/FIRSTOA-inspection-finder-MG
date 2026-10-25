// 미처리 행 [완료]·[보류]·[배정] → 시트 상태만 갱신(statusOnly) 순수 규칙 — 2026-10-25
import { describe, expect, it } from "vitest";
import {
  findTargetRow, isStatusOnlyPayload, parseStatusOnly, planStatusWrite, StatusJobError, verifyStatusHeaders,
} from "../supabase/functions/_shared/sheet-status.ts";
import { SHEET_LAYOUTS } from "../supabase/functions/reception-sheet-open/state.ts";

const sales = SHEET_LAYOUTS.sales; // 데이터 7행~, 상태 G(7), 처리자 F(6), 순번 A(1), 상호 P(16)
const remote = SHEET_LAYOUTS.remote; // 데이터 5행~, 상태 G(7), 처리자 K(11), 상호 R(18)

const base = { statusOnly: true, sheetRow: 9, seq: "1203", vendorHead: "㈜퍼스트오", status: "처리완료" };

describe("statusOnly 요청 검사(허용 값·필수 값)", () => {
  it("영업 처리완료는 통과, payload.data 안에 넣어도 같다", () => {
    expect(isStatusOnlyPayload(base)).toBe(true);
    expect(isStatusOnlyPayload({ data: { _statusOnly: "1" } })).toBe(true);
    expect(isStatusOnlyPayload({ data: { 상호: "x" } })).toBe(false);
    expect(parseStatusOnly("reception_sales", base)).toEqual({ source: "sales", sheetRow: 9, seq: "1203", vendorHead: "㈜퍼스트오", status: "처리완료", handler: "" });
    expect(parseStatusOnly("reception_mgmt", { data: { ...base, seq: "1,203" } }).seq).toBe("1203");
  });
  it("허용 값 밖은 400 — 원격에는 보류가 없다(Q1), 다른 category·빈 상호·데이터 위 행도 거절", () => {
    const err = (category: string, p: unknown) => {
      try { parseStatusOnly(category, p); return 0; } catch (e) { return e instanceof StatusJobError ? e.httpStatus : -1; }
    };
    expect(err("reception_remote", { ...base, status: "보류" })).toBe(400);
    expect(err("reception_sales", { ...base, status: "자체해결" })).toBe(400);
    expect(err("reception_remote", { ...base, status: "자체해결" })).toBe(0);
    expect(err("reception_copier", base)).toBe(400);
    expect(err("reception_sales", { ...base, vendorHead: " " })).toBe(400);
    expect(err("reception_sales", { ...base, sheetRow: 6 })).toBe(400);
    expect(err("reception_sales", { ...base, status: "", handler: "" })).toBe(400);
    expect(err("reception_sales", { ...base, status: "", handler: "김철수" })).toBe(0);
  });
});

describe("행 대조(순번 + 상호 앞 6자 둘 다)", () => {
  // 7행부터: 7=1201, 8=1202, 9=1203(퍼스트오에이), 10=1204
  const seqCol = ["1201", "1202", "1,203", "1204"];
  const vendorCol = ["가나상사", "다라물산", "(주)퍼스트오에이 본사", "마바"];
  it("받은 행이 맞으면 그 행, 행이 밀렸으면 순번 검색으로 찾는다", () => {
    expect(findTargetRow(sales, { sheetRow: 9, seq: "1203", vendorHead: "퍼스트오에" }, seqCol, vendorCol)).toEqual({ row: 9, moved: false });
    expect(findTargetRow(sales, { sheetRow: 8, seq: "1203", vendorHead: "퍼스트오에" }, seqCol, vendorCol)).toEqual({ row: 9, moved: true });
  });
  it("순번은 맞는데 상호가 다르면 실패(쓰지 않음) — 기대/실제 값이 메시지에", () => {
    const r = findTargetRow(sales, { sheetRow: 9, seq: "1203", vendorHead: "다라물산" }, seqCol, vendorCol);
    expect("error" in r && r.error).toMatch(/9행 기대 순번 '1203'·상호 '다라물산' \/ 실제 순번 '1203'·상호 '\(주\)퍼스트오에이 본사'/);
  });
  it("순번이 비면 받은 행에서만 확인하고 검색하지 않는다(원격 A열 수식 빈칸)", () => {
    const rs = ["", "", "77"];
    const rv = ["알파", "베타", "감마"];
    expect(findTargetRow(remote, { sheetRow: 6, seq: "", vendorHead: "베타" }, rs, rv)).toEqual({ row: 6, moved: false });
    const miss = findTargetRow(remote, { sheetRow: 5, seq: "", vendorHead: "베타" }, rs, rv);
    expect("error" in miss && miss.error).toMatch(/순번이 비어 검색하지 않음/);
  });
});

describe("머리 확인·쓸 칸", () => {
  const header = Array(23).fill("");
  header[6] = "진행중/\n처리완료/보류/취소";
  header[5] = "처리자";
  it("상태 머리가 다르면 오류, 처리자를 쓸 때만 처리자 머리 확인", () => {
    expect(verifyStatusHeaders(sales, header, true)).toBe("");
    const moved = [...header];
    moved[6] = "비고";
    expect(verifyStatusHeaders(sales, moved, false)).toMatch(/7열 머리가 "비고"/);
    const noHandler = [...header];
    noHandler[5] = "메모";
    expect(verifyStatusHeaders(sales, noHandler, false)).toBe("");
    expect(verifyStatusHeaders(sales, noHandler, true)).toMatch(/6열 머리/);
  });
  it("같은 값은 안 쓰고(멱등), 바뀐 칸만 — 상태 G(7)·처리자 F(6)/K(11) 외 칸은 없다, = 시작 글자는 고정", () => {
    expect(planStatusWrite(sales, { status: "처리완료", handler: "" }, { status: "처리 완료", handler: "이영희" })).toEqual({});
    expect(planStatusWrite(sales, { status: "보류", handler: "김철수" }, { status: "진행중", handler: "" })).toEqual({ 7: "보류", 6: "김철수" });
    expect(planStatusWrite(remote, { status: "", handler: "박IT" }, { status: "", handler: "" })).toEqual({ 11: "박IT" });
    expect(planStatusWrite(remote, { status: "", handler: "=HACK()" }, { status: "", handler: "" })).toEqual({ 11: "'=HACK()" });
  });
});
