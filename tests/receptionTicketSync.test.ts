// 현황판: 복합기 AS 접수 ↔ 연결 일정(as_tickets) 대조 — 일정 완료 건 제외 + 접수 자가 치유(PATCH) + "일정 없음" 표시
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBoardData, reconcileWithTickets, TICKET_SYNC_BY } from "../src/receptionBoardData";
import type { OpenReceptionRow } from "../src/deptReceptionApi";

const base = { created_at: "2026-10-01T00:00:00Z", route: "", region: "A", grade: "", lease_no: "", title: "", symptom: "", sheet_row: null, author: "김", field: "", remote_meta: null };
const open: OpenReceptionRow[] = [
  { ...base, id: "a1", receipt_date: "2026-10-10", type: "복합기 AS", vendor: "완료된곳", status: "진행중" },
  { ...base, id: "a2", receipt_date: "2026-10-11", type: "복합기 AS", vendor: "열린곳", status: "접수" },
  { ...base, id: "a3", receipt_date: "2026-10-12", type: "복합기 AS", vendor: "일정없는곳", status: "접수" },
  { ...base, id: "a4", receipt_date: "2026-10-12", type: "복합기 AS", vendor: "보류곳", status: "보류" },
  { ...base, id: "i1", receipt_date: "2026-10-12", type: "IT", vendor: "아이티", status: "접수" },
];
const tickets = [
  { id: "t1", receptionId: "a1", status: "완료" },
  { id: "t1b", receptionId: "a1", status: "배정" }, // 재방문 티켓이 열려 있어도 하나라도 완료면 완료(일정리스트 최고 단계 규칙)
  { id: "t2", receptionId: "a2", status: "배정" },
  { id: "t4", receptionId: "a4", status: "완료" },
];

type Call = { url: string; method: string; body: string };
function mockFetch(opts: { ticketsFail?: boolean; patchFail?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method || "GET";
    calls.push({ url: u, method, body: String(init?.body || "") });
    const fail = (u.includes("/as_tickets") && opts.ticketsFail) || (method === "PATCH" && opts.patchFail);
    if (fail) return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" } as unknown as Response;
    const body = method === "PATCH" ? null
      : u.includes("/as_tickets") ? tickets
        : u.includes("select=status,receipt_date") ? [] : open;
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("접수 ↔ 일정 대조", () => {
  it("순수 대조: 일정 완료는 done, 일정 없음은 noTicket, 보류·다른 종류는 대상 아님", () => {
    const r = reconcileWithTickets(open, tickets);
    expect(r.doneIds).toEqual(["a1"]);
    expect([...r.noTicketIds]).toEqual(["a3"]);
  });

  it("loadBoardData: 일정 완료 건은 열린 건에서 빠지고 접수 PATCH(완료·처리자 표기), 일정 없음 플래그", async () => {
    const calls = mockFetch();
    const data = await loadBoardData("2026-10-19");
    expect(data.rows.map((r) => r.id)).toEqual(["a2", "a3", "a4", "i1"]);
    expect(data.sources.a1).toBeUndefined();
    expect(data.rows.find((r) => r.id === "a3")?.noTicket).toBe(true);
    expect(data.rows.find((r) => r.id === "a2")?.noTicket).toBeUndefined();
    expect(data.healed).toBe(1);
    expect(data.syncError).toBe("");
    const ticketCall = calls.find((c) => c.url.includes("/as_tickets"));
    expect(ticketCall?.url).toContain("select=id,receptionId,status");
    expect(decodeURIComponent(ticketCall!.url)).toContain('receptionId=in.("a1","a2","a3")');
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toContain("/service_receptions?");
    expect(decodeURIComponent(patch!.url)).toContain('id=in.("a1")');
    expect(decodeURIComponent(patch!.url)).toContain("status=in.(접수,진행중)");
    const body = JSON.parse(patch!.body);
    expect(body).toMatchObject({ status: "완료", completed_by: TICKET_SYNC_BY });
    expect(typeof body.completed_at).toBe("string");
  });

  it("PATCH 실패: 화면은 계속(완료 건은 빼고) syncError 로 알림", async () => {
    mockFetch({ patchFail: true });
    const data = await loadBoardData("2026-10-19");
    expect(data.rows.map((r) => r.id)).not.toContain("a1");
    expect(data.healed).toBe(0);
    expect(data.syncError).toContain("반영하지 못했습니다");
  });

  it("일정 조회 실패: 원래 열린 건 그대로 보여 주고 syncError", async () => {
    const calls = mockFetch({ ticketsFail: true });
    const data = await loadBoardData("2026-10-19");
    expect(data.rows.map((r) => r.id)).toContain("a1");
    expect(data.rows.some((r) => r.noTicket)).toBe(false);
    expect(data.syncError).toContain("대조 실패");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
