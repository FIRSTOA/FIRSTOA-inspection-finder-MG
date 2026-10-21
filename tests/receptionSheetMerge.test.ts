// 서비스접수 미처리 = 시트 상태 기준(C3): DB 행과 시트 행 합치기, 스위치, 현황판·홈 연결
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, getConfig: vi.fn(), invokeEdgeFunction: vi.fn() };
});

import { getConfig, invokeEdgeFunction } from "../src/supabase";
import { isSheetOpenOn, loadSheetOpen, mergeSheetAndDb, sheetRowStatus, sheetRowUrl, type SheetOpenResponse, type SheetOpenRow } from "../src/receptionSheetOpen";
import { applySheetToBoard, type BoardData } from "../src/receptionBoardData";
import { countUnhandledTabs, mergeUnhandled } from "../src/homeUnhandled";
import type { OpenReceptionRow } from "../src/deptReceptionApi";

const TODAY = "2026-10-22";
const base = { created_at: "2026-10-01T00:00:00Z", route: "", region: "A", grade: "", lease_no: "", title: "", symptom: "", author: "", vendor: "v", sheet_row: null, remote_meta: null };
const db: OpenReceptionRow[] = [
  { ...base, id: "sales-linked", type: "영업팀", receipt_date: "2026-10-20", status: "접수", sheet_row: 5847 },
  { ...base, id: "sales-queued", type: "영업팀", receipt_date: "2026-10-22", status: "접수", remote_meta: { sheet_state: "queued" } },
  { ...base, id: "sales-synced-meta", type: "영업팀", receipt_date: "2026-10-21", status: "접수", remote_meta: { sheet_state: "synced" } },
  { ...base, id: "ops-1", type: "운영지원", receipt_date: "2026-10-21", status: "접수" },
  { ...base, id: "copier-1", type: "복합기 AS", receipt_date: "2026-10-21", status: "접수" },
  { ...base, id: "remote-linked", type: "원격이관", receipt_date: "2026-10-21", status: "원격대기", sheet_row: 6 },
  { ...base, id: "remote-free", type: "원격이관", receipt_date: "2026-10-21", status: "원격대기" },
];
const sr = (p: Partial<SheetOpenRow>): SheetOpenRow => ({
  source: "sales", kind: "영업팀", sheetRow: 1, seq: "", date: "2026-10-21", author: "", handler: "", state: "", cls: "open",
  vendor: "가", field: "", region: "", summary: "", ...p,
});
const resp: SheetOpenResponse = {
  rows: [
    sr({ sheetRow: 8, state: "진행중" }),
    sr({ sheetRow: 9, cls: "hold", state: "보류" }),
    sr({ sheetRow: 10, date: "2026-06-01" }), // 90일 넘음
    sr({ sheetRow: 11, date: "" }), // 날짜 모름 → 칸 안
    sr({ source: "mgmt", kind: "경영지원", sheetRow: 20 }),
    sr({ source: "remote", kind: "IT", sheetRow: 7, region: "강남구" }),
    sr({ source: "remote", kind: "원격이관", sheetRow: 6, region: "부산", receptionId: "remote-linked" }),
  ],
  fetchedAt: "", errors: [], okSources: ["sales", "mgmt", "remote"], coveredIds: ["sales-linked", "remote-linked"], healed: 0, healEnabled: true,
};

afterEach(() => { vi.mocked(getConfig).mockReset(); vi.mocked(invokeEdgeFunction).mockReset(); });

describe("합치기 규칙", () => {
  it("영업은 시트가 진실: 이어졌거나 동기화된 DB 행은 빼고 대기 행만 남김, 운영·복합기·안 이어진 원격은 DB 그대로", () => {
    const m = mergeSheetAndDb(db, resp, TODAY);
    expect(m.db.map((r) => r.id)).toEqual(["sales-queued", "ops-1", "copier-1", "remote-free"]);
    expect(m.sheet.map((r) => `${r.source}:${r.sheetRow}`)).toEqual(["sales:8", "sales:9", "sales:11", "mgmt:20", "remote:7", "remote:6"]);
    expect(m.over90.map((r) => r.sheetRow)).toEqual([10]);
    expect(m.notice).toBe("");
  });

  it("시트 읽기 실패면 DB 그대로 + 안내(숫자 0 아님)", () => {
    const m = mergeSheetAndDb(db, null, TODAY, "시간 초과");
    expect(m.db).toHaveLength(db.length);
    expect(m.sheet).toEqual([]);
    expect(m.notice).toContain("시트를 못 읽어");
    expect(m.notice).toContain("시간 초과");
  });

  it("한 탭 머리가 바뀌면 그 종류만 DB 기준", () => {
    const m = mergeSheetAndDb(db, { ...resp, okSources: ["mgmt", "remote"], errors: ["시트 머리 변경: 해지방어접수"] }, TODAY);
    expect(m.db.map((r) => r.id)).toContain("sales-linked");
    expect(m.sheet.some((r) => r.source === "sales")).toBe(false);
    expect(m.notice).toContain("영업");
  });

  it("상태 칸·링크", () => {
    expect(sheetRowStatus({ cls: "hold", state: "보류" })).toBe("보류");
    expect(sheetRowStatus({ cls: "open", state: "처리중" })).toBe("진행중");
    expect(sheetRowStatus({ cls: "open", state: "" })).toBe("접수");
    expect(sheetRowUrl("sales", 5847)).toContain("gid=174566767&range=A5847");
  });
});

describe("스위치", () => {
  it("'true' 문자열일 때만 켜짐", () => {
    expect(isSheetOpenOn({ RECEPTION_SHEET_OPEN_ENABLED: "true" })).toBe(true);
    expect(isSheetOpenOn({ RECEPTION_SHEET_OPEN_ENABLED: "TRUE" })).toBe(false);
    expect(isSheetOpenOn({})).toBe(false);
  });

  it("꺼져 있으면 엣지를 부르지 않는다", async () => {
    vi.mocked(getConfig).mockResolvedValue({});
    expect(await loadSheetOpen()).toEqual({ enabled: false });
    expect(invokeEdgeFunction).not.toHaveBeenCalled();
  });

  it("켜져 있으면 엣지 1회, 실패는 throw 대신 error", async () => {
    vi.mocked(getConfig).mockResolvedValue({ RECEPTION_SHEET_OPEN_ENABLED: "true" });
    vi.mocked(invokeEdgeFunction).mockRejectedValueOnce(new Error("서버 함수(reception-sheet-open) 응답 시간 초과"));
    const r = await loadSheetOpen();
    expect(r).toMatchObject({ enabled: true, data: null });
    expect(invokeEdgeFunction).toHaveBeenCalledTimes(1);
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ rows: [], okSources: ["sales"], coveredIds: ["x"] });
    const ok = await loadSheetOpen();
    expect(ok.enabled && ok.data?.okSources).toEqual(["sales"]);
  });

  it("설정을 못 읽으면 꺼진 것으로(DB 기준)", async () => {
    vi.mocked(getConfig).mockRejectedValue(new Error("설정 조회 실패"));
    expect(await loadSheetOpen()).toEqual({ enabled: false });
  });
});

describe("현황판·홈 연결", () => {
  const board: BoardData = {
    rows: db.map((r) => ({ id: r.id, type: r.type as never, vendor: r.vendor, field: "", author: "", handler: "", status: r.status, receipt_date: r.receipt_date })),
    sources: Object.fromEntries(db.map((r) => [r.id, r])), todayCount: 1, weekDoneRate: 50, healed: 0, syncError: "",
  };

  it("스위치 꺼짐이면 현황판 그대로", () => {
    expect(applySheetToBoard(board, { enabled: false }, TODAY)).toBe(board);
  });

  it("켜짐: 시트 행이 들어가고, 이어진 행은 접수 id·원본 유지, 90일 넘음은 따로", () => {
    const out = applySheetToBoard(board, { enabled: true, data: resp, error: "" }, TODAY);
    expect(out.sheetMode).toBe(true);
    const ids = out.rows.map((r) => r.id);
    expect(ids).not.toContain("sales-linked");
    expect(ids).toContain("sheet:sales:8");
    expect(ids).toContain("remote-linked"); // 시트 행이 접수 id 를 달고 들어옴
    expect(out.sources["remote-linked"]).toBeDefined();
    expect(out.rows.find((r) => r.id === "sheet:sales:9")?.status).toBe("보류");
    expect(out.rows.find((r) => r.id === "sheet:sales:8")?.sheet).toMatchObject({ linked: false, sheetRow: 8 });
    expect(out.over90?.map((r) => r.id)).toEqual(["sheet:sales:10"]);
    expect(out.weekDoneRate).toBe(50);
  });

  it("홈: 시트 행 팀 = 영업·경영·지역(원격 부산 → E), 팀 합 = 전체", () => {
    const m = mergeSheetAndDb(db, resp, TODAY);
    const rows = mergeUnhandled(m.db, [], TODAY, m.sheet);
    const sheetRows = rows.filter((r) => r.key.startsWith("s:"));
    expect(sheetRows.find((r) => r.key === "s:remote:6")?.team).toBe("E");
    expect(sheetRows.find((r) => r.key === "s:mgmt:20")?.team).toBe("경영");
    expect(sheetRows.filter((r) => r.team === "영업")).toHaveLength(3);
    const c = countUnhandledTabs(rows);
    const teamSum = (["A", "B", "C", "D", "E", "경영", "운영", "영업"] as const).reduce((n, t) => n + c[t], 0);
    expect(teamSum).toBe(c["전체"]);
    // 기본값 [] — 기존 호출 무회귀
    expect(mergeUnhandled(db, [], TODAY)).toHaveLength(db.length);
  });
});
