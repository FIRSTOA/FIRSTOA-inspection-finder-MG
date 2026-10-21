// 조회 › 미수 › [방문 이력] — 이전 기록 변환, 시트·방문·CS체크 이어 붙이기, 필터, 조회 쿼리(fetch 모킹), 서버 렌더 스모크.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { emptyMisuVisitDraft, type MisuVisit } from "../src/misuVisit";
import {
  canHideMisuVisit, DEFAULT_MISU_HISTORY_FILTERS, filterSortMisuVendors, hideMisuVisit, isTableMissingError, joinMisuHistory,
  kakaoRowToLegacy, legacyKakaoQuery, loadLegacyKakao, loadMisuVisits, loadVendorVisits, misuPeriodRange, misuVisitsQuery,
  sheetMemosToLegacy, sheetRowToVendor, sortLegacy, toHistoryVendor, toHistoryVisits, type MisuSheetVendor,
} from "../src/misuVisitHistoryData";
import MisuVisitHistory from "../src/MisuVisitHistory";
import MisuVisitHistoryView from "../src/MisuVisitHistory.view";
import { MisuBoard } from "../src/MisuOverageBoards";

const PHOTOS = (["outside", "door", "device", "notice"] as const).map((slot) => ({ slot, url: `https://x/${slot}.jpg` }));
function visit(over: Partial<MisuVisit>): MisuVisit {
  return { ...emptyMisuVisitDraft({ author: "이민구", author_team: "C", vendor: "서울학원", ...over }), created_at: over.created_at || "2026-10-22T05:35:00Z", _hidden: over._hidden ?? false } as MisuVisit;
}
const sheetRow = {
  id: 628512, 입력일: "2026-07-06", 거래처코드: "2139567243", 지역: "양주시", 미수개월: "3", 미수잔액: "1093950", "실제 잔액": "1773350",
  _업체명: "서울학원", _출처: "시트:수도권A_이윤아",
  _raw: { 임순: 3004, 경영담당: "최영지", 경영체크: "10/19 원장님 통화 — 3개월 분할", 전략체크: "", CS체크: " ", "마지막 체크일": "2026-10-21" },
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("이전 기록 변환(D10)", () => {
  it("카톡 행: 입력자 머리 떼고 날짜만, 봇 조회 답장은 뺀다", () => {
    expect(kakaoRowToLegacy({ 입력일: "2026-06-22 00:00:00", 입력자: "태현프로", 원문: "태현프로: 태향건설\n이사님과 소통", _업체명: "태향건설" }))
      .toEqual({ at: "2026-06-22", source: "카톡", author: "태현프로", text: "태향건설\n이사님과 소통" });
    expect(kakaoRowToLegacy({ 입력일: "2026-06-22 14:05:00", 입력자: "", 원문: "방문함" })).toEqual({ at: "2026-06-22 14:05", source: "카톡", author: undefined, text: "방문함" });
    expect(kakaoRowToLegacy({ 입력일: "2026-06-22", 입력자: "퍼스트전산 경영지원AI", 원문: "퍼스트전산 경영지원AI: 📢 미수금 조회 결과입니다\n..." })).toBeNull();
    expect(kakaoRowToLegacy({ 입력일: "2026-06-22", 원문: "" })).toBeNull();
  });
  it("시트 메모: 경영·전략·CS체크 중 값 있는 것만, 날짜는 마지막 체크일", () => {
    const memos = sheetMemosToLegacy(sheetRow);
    expect(memos).toEqual([{ at: "2026-10-21", source: "경영체크", author: "최영지", text: "10/19 원장님 통화 — 3개월 분할" }]);
  });
  it("정렬: 최신 위, 날짜 못 읽으면 아래", () => {
    const list = sortLegacy([{ at: "2024-01-02", source: "카톡", text: "a" }, { at: "??", source: "카톡", text: "b" }, { at: "2026-06-22", source: "카톡", text: "c" }]);
    expect(list.map((e) => e.text)).toEqual(["c", "a", "b"]);
  });
});

describe("시트·방문·CS체크 이어 붙이기", () => {
  const sv = sheetRowToVendor(sheetRow) as MisuSheetVendor;
  it("시트 행 → 거래처코드·임순·팀·잔액(미수잔액 먼저)", () => {
    expect(sv).toMatchObject({ vendor: "서울학원", team: "A", region: "양주시", company_code: "2139567243", lease_seq: "3004", monthsNum: 3, balanceNum: 1093950 });
    expect(sheetRowToVendor({ _업체명: "", _출처: "시트:수도권B" })).toBeNull();
  });
  it("코드로 이어지면 이름 표시 없음, 이름으로만 이어지면 '이름으로 이어짐', 시트에 없는 업체는 따로", () => {
    const byCode = visit({ id: "a", company_code: "2139567243", visit_round: "1차 안내", visited_at: "2026-10-01T03:00:00Z" });
    const byName = visit({ id: "b", vendor: "(주)바로엔지니어링", visit_round: "1차 안내", visited_at: "2026-10-02T03:00:00Z" });
    const lone = visit({ id: "c", vendor: "새업체", author_team: "D", misu_months: "6", misu_balance: "500000", visited_at: "2026-10-03T03:00:00Z" });
    const hidden = visit({ id: "d", company_code: "2139567243", _hidden: true });
    const sheet2 = sheetRowToVendor({ id: 2, _업체명: "바로엔지니어링 주식회사", _출처: "시트:수도권B_x", 미수개월: "5", 미수잔액: "900000" }) as MisuSheetVendor;
    const joined = joinMisuHistory([sv, sheet2], [byCode, byName, lone, hidden], [{ team: "A", vendor: "서울학원", checked: true }]);
    expect(joined).toHaveLength(3);
    const [a, b, c] = joined;
    expect(a.visits.map((v) => v.id)).toEqual(["a"]);
    expect(a.csChecked).toBe(true);
    expect(toHistoryVendor(a, "2026-10-22")).toMatchObject({ linkedByName: false, months: "3개월", balance: "1,093,950원", status: "1차만", lastVisit: { date: "10-01", round: "1차 안내", author: "이민구" } });
    expect(b.linkedBy).toBe("name");
    expect(toHistoryVendor(b, "2026-10-22").linkedByName).toBe(true);
    expect(c).toMatchObject({ name: "새업체", sheet: null, team: "D", monthsNum: 6, balanceNum: 500000 });
  });
  it("필터·정렬: 팀·상태·검색, 기간이 걸리면 방문 없는 업체 숨김, 최근 방문순", () => {
    const joined = joinMisuHistory([sv], [visit({ id: "x", vendor: "다른곳", visited_at: "2026-10-20T03:00:00Z" })]);
    const f = DEFAULT_MISU_HISTORY_FILTERS;
    expect(filterSortMisuVendors(joined, f).map((v) => v.name)).toEqual(["다른곳", "서울학원"]);
    expect(filterSortMisuVendors(joined, { ...f, team: "A" }).map((v) => v.name)).toEqual(["서울학원"]);
    expect(filterSortMisuVendors(joined, { ...f, status: "방문 기록 없음" }).map((v) => v.name)).toEqual(["서울학원"]);
    expect(filterSortMisuVendors(joined, { ...f, period: "30일" }).map((v) => v.name)).toEqual(["다른곳"]);
    expect(filterSortMisuVendors(joined, { ...f, query: "서울 학원" }).map((v) => v.name)).toEqual(["서울학원"]);
    expect(filterSortMisuVendors(joined, { ...f, sort: "잔액순" })[0].name).toBe("서울학원");
  });
});

describe("숨기기·타임라인 모양", () => {
  it("작성자 본인(sub 우선)·작성 당일만", () => {
    const v = visit({ id: "h", author_sub: "u1", created_at: "2026-10-22T01:00:00Z" });
    expect(canHideMisuVisit(v, { name: "다른사람", sub: "u1" }, "2026-10-22")).toBe(true);
    expect(canHideMisuVisit(v, { name: "이민구", sub: "u2" }, "2026-10-22")).toBe(false);
    expect(canHideMisuVisit(v, { name: "이민구", sub: "u1" }, "2026-10-23")).toBe(false);
    expect(canHideMisuVisit({ ...v, author_sub: "" }, { name: "이민구", sub: "" }, "2026-10-22")).toBe(true);
    // KST 자정 직전(UTC 전날 15시 이후) 작성은 KST 날짜로 판정
    expect(canHideMisuVisit({ ...v, created_at: "2026-10-21T15:30:00Z" }, { name: "x", sub: "u1" }, "2026-10-22")).toBe(true);
  });
  it("보완 기록은 원 기록 바로 아래, 사진 4칸·시간 외 표시", () => {
    const root = visit({ id: "r", visit_round: "2차 경고", visited_at: "2026-10-22T05:20:00Z", photos: PHOTOS.slice(0, 3), photo_skips: { notice: "문 잠김" } });
    const sup = visit({ id: "s", visit_round: "2차 경고", supplement_of: "r", visited_at: "2026-10-22T05:20:00Z", created_at: "2026-10-22T06:00:00Z" });
    const night = visit({ id: "n", visited_at: "2026-10-22T13:30:00Z", rules_ack: { offHoursReason: "고객 요청" } }); // 22:30 KST
    const out = toHistoryVisits([sup, night, root], { name: "", sub: "" }, "2026-10-22");
    expect(out.map((v) => [v.id, v.supplementOf ?? null])).toEqual([["n", null], ["r", null], ["s", "r"]]);
    expect(out[0]).toMatchObject({ offHours: true, offHoursReason: "고객 요청", visitedAt: "10-22(목) 22:30" });
    expect(out[1].photos.map((p) => p.url ? "사진" : p.skipReason)).toEqual(["사진", "사진", "사진", "문 잠김"]);
    expect(out[1].lines[0]).toMatch(/^① 응대자: /);
  });
});

describe("조회(fetch 모킹)", () => {
  function mock(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const { status, body } = handler(String(url), init);
      return { ok: status < 300, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), headers: new Headers() } as unknown as Response;
    }));
    return calls;
  }

  it("기간 → KST 하루 경계 쿼리, 숨김 제외", async () => {
    expect(misuPeriodRange({ period: "30일", from: "", to: "" }, "2026-10-22")).toEqual({ from: "2026-09-23", to: "" });
    expect(misuPeriodRange({ period: "전체", from: "2026-01-01", to: "" }, "2026-10-22")).toEqual({ from: "", to: "" });
    const q = misuVisitsQuery({ from: "2026-10-01", to: "2026-10-22" });
    expect(q).toContain("_hidden=eq.false");
    expect(q).toContain(`visited_at=gte.${encodeURIComponent("2026-10-01T00:00:00+09:00")}`);
    expect(q).toContain(`visited_at=lte.${encodeURIComponent("2026-10-22T23:59:59.999+09:00")}`);
    const calls = mock(() => ({ status: 200, body: [] }));
    await loadMisuVisits({ from: "", to: "" });
    expect(calls[0].url).toContain("/misu_visits?select=*&_hidden=eq.false&order=visited_at.desc");
  });

  it("표 없음(404 PGRST205) → isTableMissingError", async () => {
    mock(() => ({ status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.misu_visits' in the schema cache" } }));
    const err = await loadMisuVisits({ from: "", to: "" }).catch((e) => e);
    expect(isTableMissingError(err)).toBe(true);
    expect(isTableMissingError(new Error("조회 실패 misu_visits(500): boom"))).toBe(false);
  });

  it("업체 전체 방문: 코드·임순·이름 OR 로 읽고 다른 코드는 거른다", async () => {
    const calls = mock(() => ({ status: 200, body: [visit({ id: "1", company_code: "2139567243" }), visit({ id: "2", company_code: "9999999999" }), visit({ id: "3" })] }));
    const rows = await loadVendorVisits({ company_code: "2139567243", lease_seq: "3004", vendor: "서울학원" });
    expect(rows.map((v) => v.id)).toEqual(["1", "3"]);
    expect(decodeURIComponent(calls[0].url)).toContain('or=(company_code.eq."2139567243",lease_seq.eq."3004",vendor.eq."서울학원")');
  });

  it("옛 카톡 기록: 그 업체 이름만, 정규화 이름이 같은 행만", async () => {
    expect(decodeURIComponent(legacyKakaoQuery("㈜서울학원"))).toContain("_업체명=ilike.*서울학원*");
    mock(() => ({ status: 200, body: [
      { 입력일: "2025-01-02", 입력자: "가", 원문: "가: 방문", _업체명: "서울학원" },
      { 입력일: "2025-01-03", 입력자: "나", 원문: "다른 곳", _업체명: "신서울학원" },
    ] }));
    const list = await loadLegacyKakao("서울학원");
    expect(list).toEqual([{ at: "2025-01-02", source: "카톡", author: "가", text: "방문" }]);
  });

  it("숨기기: _hidden=eq.false 조건으로 PATCH, 다시 읽어 안 숨겨졌으면 오류", async () => {
    let hidden = false;
    const calls = mock((url, init) => {
      if (init?.method === "PATCH") { hidden = true; return { status: 204, body: "" }; }
      return { status: 200, body: [{ _hidden: hidden }] };
    });
    await hideMisuVisit("abc", "이민구");
    expect(calls[0].url).toContain("misu_visits?id=eq.abc&_hidden=eq.false");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ _hidden: true, _hidden_by: "이민구" });
    mock((_url, init) => (init?.method === "PATCH" ? { status: 204, body: "" } : { status: 200, body: [{ _hidden: false }] }));
    await expect(hideMisuVisit("abc", "이민구")).rejects.toThrow(/숨김이 저장되지/);
  });
});

describe("서버 렌더 스모크", () => {
  it("컨테이너는 불러오는 중으로 시작, 미수 보드에 [방문 이력] 전환이 있다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const html = renderToString(createElement(MisuVisitHistory)).replace(/<!-- -->/g, "");
    expect(html).toContain("방문 이력을 불러오는 중입니다");
    const board = renderToString(createElement(MisuBoard)).replace(/<!-- -->/g, "");
    expect(board).toContain("전체 현황");
    expect(board).toContain("CS체크 목록");
    expect(board).toContain("방문 이력");
  });
  it("변환 결과를 표시 틀에 넣으면 업체·상태 칩·체크리스트·타임라인이 나온다", () => {
    const sv = sheetRowToVendor(sheetRow) as MisuSheetVendor;
    const v1 = visit({ id: "a", company_code: "2139567243", visit_round: "1차 안내", visited_at: "2026-10-01T03:00:00Z", judgment: "계속 독촉", judgment_reason: "약속", missing: ["④ 사진 4장"] });
    const [joined] = joinMisuHistory([sv], [v1]);
    const html = renderToString(createElement(MisuVisitHistoryView, {
      state: "ready", tableNotReady: false, vendors: [toHistoryVendor(joined, "2026-10-22")], totalCount: 1,
      filters: DEFAULT_MISU_HISTORY_FILTERS, onFilters: () => {}, authorOptions: ["이민구"], openKey: joined.key, onToggle: () => {},
      detail: { state: "ready", visits: toHistoryVisits(joined.visits, { name: "", sub: "" }, "2026-10-22"), checklist: [{ key: "a", mark: "ⓐ", label: "1차 안내 기록", ok: true }], legacyState: "ready", legacy: sheetMemosToLegacy(sheetRow) },
      onOpenPhoto: () => {}, onCopyLegal: () => {},
    })).replace(/<!-- -->/g, "");
    expect(html).toContain("서울학원");
    expect(html).toContain("보완 필요");
    expect(html).toContain("소송이관 준비");
    expect(html).toContain("1차 안내");
    expect(html).toContain("경영체크");
    expect(html).not.toContain("보완 기록 쓰기"); // 연결 콜백 없으면 단추 없음
  });
  it("표 준비 전 안내", () => {
    const html = renderToString(createElement(MisuVisitHistoryView, {
      state: "ready", tableNotReady: true, vendors: [], filters: DEFAULT_MISU_HISTORY_FILTERS, onFilters: () => {}, authorOptions: [],
      openKey: null, onToggle: () => {}, detail: null, onOpenPhoto: () => {}, onCopyLegal: () => {},
    }));
    expect(html).toContain("방문이력 표가 아직 준비 중입니다");
  });
});
