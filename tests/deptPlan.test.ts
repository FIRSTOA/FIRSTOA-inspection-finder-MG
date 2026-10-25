// 서비스접수 › 부서 미니 업무공간 — 일정 묶음·배정 후보·시트 링크·배정(assign) 흐름 (src/deptPlan.ts, deptReceptionFlow "assign").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deptMemberNames, deptPlanBuckets, PLAN_BUCKETS, planTodoCount, sheetKeyOf, type PlanRow } from "../src/deptPlan";
import { deptSheetUrl, RECEPTION_SPREADSHEET_ID } from "../src/receptionSheetOpen";
import { runDeptAction } from "../src/deptReceptionFlow";
import { DEPT_RIGHT_VIEWS, parseDeptRightView } from "../src/receptionRightView";
import { deptMonthGrid, shiftDeptMonth } from "../src/deptCalendarView";
import { invalidateConfigCaches } from "../src/supabase";
import type { DeptCalEvent } from "../src/deptCalendarView";

const TODAY = "2026-10-23"; // 금요일 → 다음 영업일 10-26(월)
const r = (id: string, schedule: string, over: Partial<PlanRow> = {}): PlanRow => ({
  id, type: "영업팀", status: "접수", receipt_date: "2026-10-01", remote_meta: schedule ? { schedule_date: schedule } : {}, ...over,
});
const ev = (id: string, date: string, over: Partial<DeptCalEvent> = {}): DeptCalEvent => ({
  id, team: "영업팀", date, time: "", title: `일정${id}`, memo: "", author: "", receptionId: "", done: false, ...over,
});

describe("deptPlanBuckets", () => {
  // 2026-10-25 밤 사용자 "일정리스트의 [미처리] 묶음은 빼 달라 — 미처리현황 탭과 중복" → 묶음은 금일·익일·예정 3개만.
  // (2c3f253 에서 넣은 "미처리 = 미처리현황과 같은 행" 테스트 2개는 묶음 자체가 없어져 지웠다)
  it("금일·익일(주말 포함 ~ 월요일)·예정으로만 나누고, 예정일 지남·없음은 어느 묶음에도 없다", () => {
    const rows = [r("a", TODAY), r("b", "2026-10-24"), r("c", "2026-10-26"), r("d", "2026-10-27"), r("e", "2026-10-20"), r("f", "")];
    const b = deptPlanBuckets("영업팀", rows, [], TODAY);
    expect(Object.keys(b).sort()).toEqual(["later", "next", "today"]);
    expect(PLAN_BUCKETS).toEqual(["today", "next", "later"]);
    expect(b.today.map((x) => x.key)).toEqual(["r:a"]);
    expect(b.next.map((x) => x.key)).toEqual(["r:b", "r:c"]);
    expect(b.later.map((x) => x.key)).toEqual(["r:d"]);
    const all = [...b.today, ...b.next, ...b.later].map((x) => x.key);
    expect(all).not.toContain("r:e");
    expect(all).not.toContain("r:f");
  });

  it("다른 부서·완료·취소는 뺀다", () => {
    const rows = [r("x", TODAY, { type: "경영지원" }), r("y", TODAY, { status: "완료" }), r("z", TODAY, { status: "취소" }), r("ok", TODAY)];
    const b = deptPlanBuckets("영업팀", rows, [], TODAY);
    expect(b.today.map((x) => x.key)).toEqual(["r:ok"]);
  });

  it("부서 일정: 접수와 연결된 것·지난 날·다른 부서는 빼고 날짜 묶음에만", () => {
    const evs = [ev("1", TODAY), ev("2", "2026-10-30"), ev("3", "2026-10-20"), ev("4", TODAY, { receptionId: "r1" }), ev("5", TODAY, { team: "경영지원" })];
    const b = deptPlanBuckets("영업팀", [], evs, TODAY);
    expect(b.today.map((x) => x.key)).toEqual(["e:1"]);
    expect(b.later.map((x) => x.key)).toEqual(["e:2"]);
    expect(b.next).toHaveLength(0);
  });

  it("일정리스트 숫자 = 금일 접수 + 안 끝난 금일 부서 일정(미처리는 세지 않음)", () => {
    const b = deptPlanBuckets("영업팀", [r("a", TODAY), r("old", "2026-10-01")], [ev("1", TODAY, { done: true }), ev("2", TODAY)], TODAY);
    expect(planTodoCount(b)).toBe(2);
    expect(planTodoCount(deptPlanBuckets("영업팀", [r("old", "")], [], TODAY))).toBe(0);
  });
});

describe("배정 후보·시트 링크·보기 키", () => {
  it("부서 기본 처리자 + cs_members 의 그 부서 활성 인원(운영은 CSS 제외)", () => {
    const members = [
      { name: "홍길동", dept: "영업팀", team: "전략영업", active: true },
      { name: "퇴사자", dept: "영업팀", team: "", active: false },
      { name: "김경영", dept: "경영지원파트", team: "", active: true },
      { name: "이운영", dept: "CSS/운영지원파트", team: "운영지원", active: true },
      { name: "박CSS", dept: "CSS/운영지원파트", team: "CSS", active: true },
    ];
    const sales = deptMemberNames("영업팀", members);
    expect(sales).toContain("이찬우");
    expect(sales).toContain("홍길동");
    expect(sales).not.toContain("퇴사자");
    expect(sales).not.toContain("김경영");
    expect(deptMemberNames("운영지원", members)).toEqual(["이운영"]);
    expect(deptMemberNames("운영지원", [])).toEqual([]);
  });

  it("시트 링크: 영업·경영만, 운영은 null", () => {
    expect(deptSheetUrl("영업팀")).toBe(`https://docs.google.com/spreadsheets/d/${RECEPTION_SPREADSHEET_ID}/edit#gid=174566767`);
    expect(deptSheetUrl("경영지원")).toContain("gid=899183889");
    expect(deptSheetUrl("운영지원")).toBeNull();
  });

  it("시트 행 key 풀기·보기 키 기본값", () => {
    expect(sheetKeyOf("s:sales:123")).toEqual({ source: "sales", row: 123 });
    expect(sheetKeyOf("r:abc")).toBeNull();
    expect(parseDeptRightView(null)).toBe("plan");
    expect(parseDeptRightView("board")).toBe("board");
    expect(parseDeptRightView("weird")).toBe("plan");
  });
});

// ── runDeptAction "assign" (fetch 모킹) ──
type Call = { method: string; table: string; body: unknown };
let calls: Call[] = [];
function mockFetch(stored: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const table = u.pathname.replace(/^\/rest\/v1\//, "").replace(/^\/functions\/v1\//, "fn:");
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ method, table, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let status = 200;
    let body: unknown = [];
    if (method === "GET" && table === "service_receptions") body = [stored];
    else if (table === "app_config") body = [{ key: "FIELD_SHEET_SYNC_ENABLED", value: "false" }];
    else if (table.startsWith("rpc/")) body = "";
    else if (method === "POST") { status = 201; body = [{ id: "c1" }]; }
    else if (method === "PATCH") status = 204;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(status === 204 ? null : text, { status, headers: { "Content-Type": "application/json" } });
  }));
}
beforeEach(() => { invalidateConfigCaches(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("runDeptAction assign", () => {
  it("처리자만 바꾸고(1명) 시트 행이 있으면 시트 갱신 잡을 쌓는다", async () => {
    mockFetch({ id: "r9", type: "영업팀", status: "접수", vendor: "가나상사", author: "박민", sheet_row: 12, remote_meta: { handler: "박민", sheet_seq: "5", memo_log: "메모" } });
    const res = await runDeptAction({ id: "r9", type: "영업팀", vendor: "가나상사", author: "박민" }, "assign", { by: "팀장", handler: "이정현, 김수인" });
    const rpcCall = calls.find((c) => c.table === "rpc/merge_reception_handling")!.body as { p_meta: Record<string, string>; p_status?: string };
    expect(rpcCall.p_meta).toEqual({ handler: "이정현" });
    expect(rpcCall.p_status).toBeUndefined();
    expect(res.row.remote_meta?.handler).toBe("이정현");
    expect(res.row.remote_meta?.memo_log).toBe("메모");
    const job = calls.find((c) => c.method === "POST" && c.table === "field_sheet_sync_jobs")!.body as { payload: { data: Record<string, string> } };
    expect(job.payload.data._updateOnly).toBe("1");
    expect(job.payload.data.handler).toBe("이정현");
  });

  it("같은 처리자면 아무것도 쓰지 않는다", async () => {
    mockFetch({ id: "r9", type: "운영지원", status: "접수", vendor: "가나", author: "a", remote_meta: { handler: "이운영" } });
    const res = await runDeptAction({ id: "r9", type: "운영지원", vendor: "가나", author: "a" }, "assign", { by: "x", handler: "이운영" });
    expect(calls.some((c) => c.table.startsWith("rpc/"))).toBe(false);
    expect(res.warnings).toEqual([]);
  });
});

// ── 부서 업무공간 [달력] 보기(2026-10-25: 일정·캘린더 탭 부서 칩 삭제 → 서비스접수에서 올인원) ──
describe("부서 오른쪽 보기에 달력", () => {
  it("탭 4개 순서 = 일정리스트·달력·접수리스트·미처리현황, 'cal' 기억값 복원", () => {
    expect(DEPT_RIGHT_VIEWS.map(([v]) => v)).toEqual(["plan", "cal", "list", "board"]);
    expect(DEPT_RIGHT_VIEWS.find(([v]) => v === "cal")?.[1]).toBe("달력");
    expect(parseDeptRightView("cal")).toBe("cal");
  });
  it("달력 격자 42칸은 1일이 든 주 일요일부터, 달 이동은 1일로", () => {
    const g = deptMonthGrid("2026-10-01"); // 2026-10-01 = 목요일
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-09-27");
    expect(g[4]).toBe("2026-10-01");
    expect(g[41]).toBe("2026-11-07");
    expect(shiftDeptMonth("2026-10-01", 1)).toBe("2026-11-01");
    expect(shiftDeptMonth("2026-01-01", -1)).toBe("2025-12-01");
  });
});
