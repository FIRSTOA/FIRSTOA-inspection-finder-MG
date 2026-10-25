/**
 * 서비스접수 상세 팝업 빨리 열기(2026-10-25 밤 사용자 "서비스접수 탭 상세 팝업 내용이 조금 늦게 나온다").
 * 원인: 팝업을 열 때마다 엣지 reception-sheet-open 한 행 조회(Sheets API 왕복 1~2초)를 기다렸다 — 목록 응답 summary 는 40자뿐.
 *  ① 목록 응답에 내용 원문 600자(content, 최근 90일 행만) → 팝업이 내용을 바로, 나머지 열만 뒤에
 *  ② 읽은 본문은 세션 캐시(같은 행 다시 열면 즉시) ③ 줄에 손을 올리면 미리 읽기(동시 2개, 실패 무시)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { LIST_CONTENT_MAX, listContent, openRowsOf, parseSheetRows, SHEET_LAYOUTS, kstDaysAgo } from "../supabase/functions/reception-sheet-open/state";
import { mergeUnhandled, type UnhandledRow } from "../src/homeUnhandled";
import { sheetToBoardRow } from "../src/receptionBoardData";
import { boardSheetToUnhandled } from "../src/unhandledActions";
import {
  createDetailCache, createPrefetcher, detailCacheKey, loadUnhandledDetail, peekUnhandledDetail, prefetchUnhandledDetail, forgetUnhandledDetail,
} from "../src/unhandledDetail";
import { UnhandledDetail } from "../src/HomeUnhandledPanel";
import type { SheetOpenRow } from "../src/receptionSheetOpen";

const salesRow = (cells: Record<number, string>) => { const r = Array(23).fill(""); for (const [c, v] of Object.entries(cells)) r[Number(c) - 1] = v; return r; };
const HEAD = salesRow({ 1: "순번", 2: "접수일", 5: "접수자", 7: "진행중/처리완료/보류/취소" });
const LONG = `견적 금일중으로 부탁드립니다.\n둘째 줄 내용\n${"가".repeat(700)}`;

describe("① 목록 응답 content — 내용 원문 600자(엣지 state.ts)", () => {
  it("listContent: 한 줄 40자 안이면 없음, 줄바꿈이 있거나 길면 줄바꿈 그대로 600자(+…)", () => {
    expect(listContent("짧은 내용")).toBe("");
    expect(listContent("가".repeat(40))).toBe("");
    expect(listContent("첫 줄\n둘째 줄")).toBe("첫 줄\n둘째 줄");
    const c = listContent(LONG);
    expect(c.startsWith("견적 금일중으로 부탁드립니다.\n둘째 줄 내용\n")).toBe(true);
    expect(c.length).toBe(LIST_CONTENT_MAX + 1);
    expect(c.endsWith("…")).toBe(true);
  });

  it("parseSheetRows: summary 는 그대로 40자, 긴 내용 행만 content", () => {
    const values = [HEAD, salesRow({}),
      salesRow({ 1: "1", 2: "10월 21일", 3: "2610", 5: "가", 16: "가나상사", 23: LONG }),
      salesRow({ 1: "2", 2: "10월 21일", 3: "2610", 5: "나", 16: "다라", 23: "짧음" })];
    const { rows } = parseSheetRows(SHEET_LAYOUTS.sales, values);
    expect(rows[0].summary.length).toBeLessThanOrEqual(41);
    expect(rows[0].content).toBe(listContent(LONG));
    expect("content" in rows[1]).toBe(false);
  });

  it("openRowsOf(contentSince): 90일 넘은 행(날짜 있음)은 content 를 뺀다 — 날짜 모르는 행·최근 행은 남긴다", () => {
    const base = { kind: "영업팀" as const, seq: "", author: "", handler: "", state: "", cls: "open" as const, vendor: "", field: "", region: "", summary: "s", content: "긴 내용" };
    const rows = [
      { ...base, source: "sales" as const, sheetRow: 7, date: "2026-10-20" },
      { ...base, source: "sales" as const, sheetRow: 8, date: "2026-06-01" },
      { ...base, source: "sales" as const, sheetRow: 9, date: "" },
    ];
    const out = openRowsOf(rows, new Map(), "2026-07-27");
    expect(out.map((r) => r.content ?? null)).toEqual(["긴 내용", null, "긴 내용"]);
    expect(openRowsOf(rows, new Map()).every((r) => r.content === "긴 내용")).toBe(true); // 안 주면 그대로
    expect(kstDaysAgo(90, new Date("2026-10-25T15:30:00Z"))).toBe("2026-07-28"); // KST 10-26 0시 30분 기준 90일 전
  });

  it("프런트: 홈 미처리 줄·현황판 시트 카드 모두 content 를 팝업 내용(detail)으로", () => {
    const sheet: SheetOpenRow = { source: "mgmt", kind: "경영지원", sheetRow: 120, seq: "77", date: "2026-10-24", author: "가", handler: "", state: "", cls: "open", vendor: "가나", field: "견적", region: "", summary: "견적 금일중으로…", content: "견적 금일중으로 부탁드립니다.\n둘째 줄" };
    const [u] = mergeUnhandled([], [], "2026-10-25", [sheet]);
    expect(u.detail).toBe(sheet.content);
    expect(u.title).toBe(sheet.summary); // 목록 한 줄은 그대로 40자
    const b = boardSheetToUnhandled(sheetToBoardRow(sheet), "2026-10-25")!;
    expect(b.detail).toBe(sheet.content);
    const old = boardSheetToUnhandled(sheetToBoardRow({ ...sheet, content: undefined }), "2026-10-25")!;
    expect(old.detail).toBeUndefined(); // 옛 엣지 응답 — 팝업은 지금처럼 한 행 조회
  });
});

const sheetRowOf = (row: number, extra: Partial<UnhandledRow> = {}): UnhandledRow => ({
  key: `s:sales:${row}`, source: "reception", kind: "영업팀", team: "영업", date: "2026-10-24", vendor: "가나", title: "요약", assignee: "", status: "", ageDays: 1,
  sheet: { source: "sales", row, seq: String(row), author: "가", vendor: "가나" }, ...extra,
});

describe("② 세션 캐시 · ③ 미리 읽기 — 순수 부품", () => {
  it("detailCacheKey: 시트 = 탭·행·순번, 앱 접수 = id, 일정 = 없음", () => {
    expect(detailCacheKey(sheetRowOf(9))).toBe("s:sales:9:9");
    expect(detailCacheKey({ key: "r:abc", source: "reception", receptionId: "abc" })).toBe("r:abc");
    expect(detailCacheKey({ key: "t:1", source: "ticket" })).toBe("");
  });
  it("createDetailCache: ttl 지나면 없음, max 넘으면 먼저 넣은 것부터", () => {
    const c = createDetailCache(2, 1000);
    const body = { fields: [], contentLabel: "내용", content: "x" };
    c.set("a", body, 0); c.set("b", body, 0);
    expect(c.get("a", 500)).toBe(body);
    c.set("c", body, 600);
    expect(c.get("a", 600)).toBeUndefined();
    expect(c.size()).toBe(2);
    expect(c.get("b", 1001)).toBeUndefined(); // ttl
    expect(c.get("c", 1001)).toBe(body);
  });
  it("createPrefetcher: 동시에 2개까지만, 끝나면 다시 받는다, 실패는 무시", async () => {
    const p = createPrefetcher(2);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    expect(p.run(() => gate)).toBe(true);
    expect(p.run(() => Promise.reject(new Error("x")))).toBe(true);
    expect(p.run(() => gate)).toBe(false); // 세 번째는 건너뜀
    await new Promise((r) => setTimeout(r, 0));
    expect(p.active()).toBe(1); // 실패한 것은 끝남(던지지 않음)
    release(); await gate; await new Promise((r) => setTimeout(r, 0));
    expect(p.active()).toBe(0);
    expect(p.run(() => Promise.resolve())).toBe(true);
  });
});

describe("② · ③ 실제 경로 — 엣지 한 행 조회는 행마다 한 번", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const stub = () => {
    const calls: string[] = [];
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("fetch", vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push(`${body.row?.source}:${body.row?.sheetRow}`);
      return new Response(JSON.stringify({ ok: true, detail: { source: body.row.source, sheetRow: body.row.sheetRow, seq: body.row.seq, state: "", cells: [{ label: "처리자", value: "박" }], contentLabel: "접수내용", content: "전체 내용" } }), { status: 200 });
    }));
    return calls;
  };
  it("미리 읽기 + 팝업 열기가 겹쳐도 한 번, 다시 열면 캐시(즉시 peek)", async () => {
    const calls = stub();
    const row = sheetRowOf(501);
    expect(peekUnhandledDetail(row)).toBeUndefined();
    expect(prefetchUnhandledDetail(row)).toBe(true);
    expect(prefetchUnhandledDetail(row)).toBe(false); // 이미 읽는 중
    const body = await loadUnhandledDetail(row); // 팝업 — 같은 요청을 기다린다
    expect(body?.content).toBe("전체 내용");
    expect(calls).toEqual(["sales:501"]);
    expect(peekUnhandledDetail(row)?.content).toBe("전체 내용");
    await loadUnhandledDetail(row);
    expect(calls).toEqual(["sales:501"]);
    forgetUnhandledDetail(row); // 처리 단추 → 다음엔 새로
    expect(peekUnhandledDetail(row)).toBeUndefined();
  });
  it("실패는 캐시하지 않는다(다시 열면 다시 읽음)", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "x" }), { status: 409 }));
    vi.stubGlobal("fetch", f);
    const row = sheetRowOf(502);
    await expect(loadUnhandledDetail(row)).rejects.toThrow();
    await expect(loadUnhandledDetail(row)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("팝업 첫 그림 — 목록 내용을 바로, 글 위에 '나머지 열 읽는 중…'", () => {
  it("content 가 있는 시트 줄: 내용 전체가 첫 그림에, 뼈대 없이 안내 한 줄", () => {
    const html = renderToString(createElement(UnhandledDetail, { row: sheetRowOf(503, { detail: "견적 금일중으로 부탁드립니다.\n둘째 줄 끝" }), onClose: () => {} })).replace(/<!-- -->/g, "");
    expect(html).toContain("나머지 열 읽는 중…");
    expect(html).toContain("둘째 줄 끝");
    expect(html.indexOf("나머지 열 읽는 중…")).toBeLessThan(html.indexOf("둘째 줄 끝"));
  });
  it("content 가 없는 옛 응답: 지금처럼 '시트에서 그 행 전체를 읽는 중…'", () => {
    const html = renderToString(createElement(UnhandledDetail, { row: sheetRowOf(504), onClose: () => {} }));
    expect(html).toContain("시트에서 그 행 전체를 읽는 중…");
  });
});
