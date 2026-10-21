/**
 * 서비스접수 임대리스트 검색에 부서명/현장명 단계(C4) — 순서·숫자 건너뛰기·400 대체(세션 캐시)·"-"/"_" 제외·결과 표시.
 * DB 는 건드리지 않는다(fetch 모킹, 쿼리 문자열만 검사).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { searchLeaseList } from "../src/api";
import { DeptCandidateRow } from "../src/DeptReceptionForm.view";
import {
  cleanDept, deptFilter, deptPillText, isDeptColumnMissing, isMissingColumnError, leaseDeptOf, MATCHED_BY_KEY,
  resetDeptColumnCache, shouldSearchDept,
} from "../src/leaseDept";

type Stage = "업체" | "부서컬럼" | "부서대체" | "자산" | "기번" | "순번" | "?";
const stageOf = (url: string): Stage => {
  const u = decodeURIComponent(url);
  if (u.includes("_업체명=ilike")) return "업체";
  if (u.includes('_raw->>"부서명/현장명"=ilike')) return "부서대체";
  if (u.includes("부서명=ilike")) return "부서컬럼";
  if (u.includes("자산번호=ilike")) return "자산";
  if (u.includes("기번=ilike")) return "기번";
  if (u.includes("순번=eq")) return "순번";
  return "?";
};
const row = (id: number, vendor: string, raw: Record<string, unknown>) => ({ id, _업체명: vendor, _raw: { 순: String(id), ...raw } });

describe("leaseDept 순수 함수", () => {
  it('"-"·"_"·빈칸은 빈 값, 줄바꿈은 공백', () => {
    expect(cleanDept("-")).toBe("");
    expect(cleanDept(" _ ")).toBe("");
    expect(cleanDept("")).toBe("");
    expect(cleanDept(null)).toBe("");
    expect(cleanDept("평택P4-PH1\n북SUP현장")).toBe("평택P4-PH1 북SUP현장");
    expect(leaseDeptOf({ "부서명/현장명": "본사\r\n3층" })).toBe("본사 3층");
    expect(leaseDeptOf({ "부서명/현장명": "-" })).toBe("");
    expect(leaseDeptOf(null)).toBe("");
  });
  it("알약 20자 자름", () => {
    expect(deptPillText("가".repeat(20))).toBe("가".repeat(20));
    expect(deptPillText("가".repeat(25))).toBe(`${"가".repeat(20)}…`);
  });
  it("부서 단계: 2글자 이상, 숫자만이면 건너뜀", () => {
    expect(shouldSearchDept("본")).toBe(false);
    expect(shouldSearchDept("본사")).toBe(true);
    expect(shouldSearchDept("12345")).toBe(false);
    expect(shouldSearchDept(" 3층 ")).toBe(true);
  });
  it("400·42703·PGRST204 만 컬럼 없음으로 본다(타임아웃 500 은 아님)", () => {
    expect(isMissingColumnError(new Error("조회 실패 vendor_info(400): column does not exist"))).toBe(true);
    expect(isMissingColumnError(new Error('{"code":"PGRST204"}'))).toBe(true);
    expect(isMissingColumnError(new Error("조회 실패 vendor_info(500): canceling statement due to statement timeout"))).toBe(false);
  });
  it('대체 경로 필터는 "-"·"_" 를 직접 뺀다, 컬럼 경로는 생성 컬럼만', () => {
    expect(decodeURIComponent(deptFilter("본사", false))).toBe("부서명=ilike.*본사*");
    expect(decodeURIComponent(deptFilter("본사", true))).toBe('_raw->>"부서명/현장명"=ilike.*본사*&_raw->>"부서명/현장명"=not.in.("-","_")');
  });
});

describe("searchLeaseList 부서 단계", () => {
  let calls: Stage[] = [];
  let urls: string[] = [];
  let deptColumnExists = true;
  let respond: (stage: Stage) => unknown[] = () => [];

  beforeEach(() => {
    resetDeptColumnCache();
    calls = []; urls = []; deptColumnExists = true; respond = () => [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      const stage = stageOf(url);
      calls.push(stage); urls.push(url);
      if (stage === "부서컬럼" && !deptColumnExists) {
        return new Response(JSON.stringify({ code: "42703", message: "column vendor_info.부서명 does not exist" }), { status: 400 });
      }
      return new Response(JSON.stringify(respond(stage)), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("순서: 업체명 → 부서명 → 자산 (4자 미만이라 기번 없음, 숫자 아니라 순번 없음)", async () => {
    await searchLeaseList("본사");
    expect(calls).toEqual(["업체", "부서컬럼", "자산"]);
  });

  it("업체 결과 뒤에 부서 결과가 붙고, 부서로 걸린 줄만 _matchedBy=부서", async () => {
    respond = (stage) => stage === "업체" ? [row(1, "본사상사", { "부서명/현장명": "-" })]
      : stage === "부서컬럼" ? [row(1, "본사상사", {}), row(2, "가나건설", { "부서명/현장명": "본사\n2층" })] : [];
    const hits = await searchLeaseList("본사");
    expect(hits.map((h) => h._업체명)).toEqual(["본사상사", "가나건설"]); // id 1 은 중복 제거
    expect(hits[0][MATCHED_BY_KEY]).toBe("업체");
    expect(leaseDeptOf(hits[0])).toBe(""); // "-" 는 알약 없음
    expect(hits[1][MATCHED_BY_KEY]).toBe("부서");
    expect(leaseDeptOf(hits[1])).toBe("본사 2층");
  });

  it("숫자만 입력(순번 재조회 572·596행)은 부서 단계를 건너뛰어 결과 1등이 그대로", async () => {
    respond = (stage) => stage === "순번" ? [row(12345, "순번업체", {})] : [];
    const hits = await searchLeaseList("12345");
    expect(calls).toEqual(["업체", "자산", "기번", "순번"]);
    expect(hits[0]._업체명).toBe("순번업체");
    expect(hits[0][MATCHED_BY_KEY]).toBe("순번");
  });

  it("1글자는 부서 단계 없음(trgm 못 탐)", async () => {
    await searchLeaseList("본");
    expect(calls).toEqual(["업체", "자산"]);
  });

  it("업체 결과가 30이면 부서 단계를 돌지 않는다", async () => {
    respond = (stage) => stage === "업체" ? Array.from({ length: 30 }, (_, i) => row(i + 1, `업체${i}`, {})) : [];
    const hits = await searchLeaseList("업체");
    expect(hits).toHaveLength(30);
    expect(calls).toEqual(["업체"]);
  });

  it("생성 컬럼 없음(400) → 대체 경로, 그 세션 동안은 처음부터 대체 경로", async () => {
    deptColumnExists = false;
    respond = (stage) => stage === "부서대체" ? [row(7, "세안이엔씨", { "부서명/현장명": "평택P4-PH1 북SUP현장" })] : [];
    const first = await searchLeaseList("북SUP");
    expect(calls).toEqual(["업체", "부서컬럼", "부서대체", "자산", "기번"]); // 4자 이상이라 기번도
    expect(isDeptColumnMissing()).toBe(true);
    expect(first[0][MATCHED_BY_KEY]).toBe("부서");
    expect(leaseDeptOf(first[0])).toBe("평택P4-PH1 북SUP현장");
    const fallbackUrl = decodeURIComponent(urls[2]);
    expect(fallbackUrl).toContain('not.in.("-","_")');
    expect(fallbackUrl).toContain("limit=30");

    calls = [];
    await searchLeaseList("평택P4");
    expect(calls).toEqual(["업체", "부서대체", "자산", "기번"]); // 컬럼 경로를 다시 두드리지 않음
  });

  it("부서 단계가 400 아닌 오류(타임아웃)면 그 단계만 건너뛰고 캐시는 그대로", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const stage = stageOf(String(input));
      calls.push(stage);
      if (stage === "부서컬럼") return new Response("canceling statement due to statement timeout", { status: 500 });
      return new Response(JSON.stringify(stage === "자산" ? [row(3, "자산업체", {})] : []), { status: 200 });
    }));
    const hits = await searchLeaseList("AB12");
    expect(calls).toEqual(["업체", "부서컬럼", "자산", "기번"]);
    expect(isDeptColumnMissing()).toBe(false);
    expect(hits.map((h) => h._업체명)).toEqual(["자산업체"]);
  });
});

describe("결과 줄 부서 알약", () => {
  const base = { name: "세안이엔씨", no: "7", model: "C3530", asset: "A1", serial: "S1", region: "C", onPick: () => {} };
  it("값이 있으면 알약(20자 자름), 부서로 걸리면 노란 테두리", () => {
    const html = renderToString(createElement(DeptCandidateRow, { ...base, dept: "평택P4-PH1 북SUP현장 지하2층 자재창고 옆", deptMatched: true }));
    expect(html).toContain(">평택P4-PH1 북SUP현장 지하2층…<");
    expect(html).toContain("border-amber-400");
    expect(html).toContain("부서명 일치");
  });
  it("업체로 걸린 줄은 회색 알약, 값 없으면 알약 없음", () => {
    expect(renderToString(createElement(DeptCandidateRow, { ...base, dept: "본사" }))).not.toContain("border-amber-400");
    const none = renderToString(createElement(DeptCandidateRow, { ...base, dept: "" }));
    expect(none).not.toContain("bg-slate-100 px-2");
  });
});
