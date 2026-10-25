// 부서 접수 저장 6단계·처리 단추 흐름 — fetch 모킹으로 호출 순서와 분기를 확인한다(src/deptReceptionFlow.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDeptReception, formatPhone, memoLine, nextWeekday, pickVendorAlias, prependMemo, resolveReceiver, retryDeptSheetAppend, runDeptAction, runDeptSave, saveDeptReceptionEdit } from "../src/deptReceptionFlow";
import { isCheckConstraintError } from "../src/deptReceptionApi";
import { kstDate } from "../src/visits";
import { invalidateConfigCaches } from "../src/supabase";
import type { DeptReceptionInput } from "../src/deptReception";

type Call = { method: string; table: string; url: string; body: unknown };
type Handler = (c: Call) => { status?: number; body?: unknown } | undefined;

let calls: Call[] = [];
function mockFetch(handler: Handler) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const table = u.pathname.replace(/^\/rest\/v1\//, "").replace(/^\/functions\/v1\//, "fn:");
    const call: Call = { method: (init?.method || "GET").toUpperCase(), table, url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const res = handler(call) || {};
    const status = res.status ?? 200;
    const text = res.body === undefined ? "" : typeof res.body === "string" ? res.body : JSON.stringify(res.body);
    // 204 는 본문이 있으면 Response 가 거부한다
    return new Response(status === 204 ? null : text, { status, headers: { "Content-Type": "application/json" } });
  }));
}
const firstIndex = (method: string, table: string) => calls.findIndex((c) => c.method === method && c.table === table);
const touched = (table: string) => calls.some((c) => c.table === table);

const base = (over: Partial<DeptReceptionInput> = {}): DeptReceptionInput => ({
  dept: "영업팀", author: "김수인", route: "전화", vendor: "퍼스트오에이", leaseNo: "1234", region: "수도권C",
  field: "렌탈문의", content: "한 대 추가 렌탈 문의", ...over,
});

/** 기본 응답: 설정(TEST_MODE 꺼짐) · 방 매핑(rooms) · 각 표 insert 성공 */
function standard(rooms: Array<{ category: string; region: string; room: string }>, override?: Handler): Handler {
  return (c) => {
    const o = override?.(c);
    if (o) return o;
    if (c.table === "app_config") return { body: [{ key: "TEST_MODE", value: "false" }] };
    if (c.table === "room_map") return { body: rooms };
    if (c.method === "POST" && c.table === "service_receptions") return { status: 201, body: [{ id: "r1" }] };
    if (c.method === "GET" && c.table === "field_sheet_sync_jobs") return { body: [] };
    if (c.method === "POST" && c.table === "field_sheet_sync_jobs") return { status: 201 };
    if (c.method === "GET" && c.table === "team_calendar_events") return { body: [] };
    if (c.method === "POST" && c.table === "team_calendar_events") return { status: 201, body: [{ id: "c1" }] };
    if (c.method === "GET" && c.table === "outbox") return { body: [] };
    if (c.method === "POST" && c.table === "outbox") return { status: 201 };
    if (c.table.startsWith("rpc/")) return { body: "" };
    if (c.method === "PATCH") return { status: 204 };
    return { body: [] };
  };
}

beforeEach(() => { invalidateConfigCaches(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("저장 6단계 (runDeptSave)", () => {
  it("영업팀 + 예정일 + 방 매핑: 접수 → 시트 잡 → 달력 → 카톡 순서", async () => {
    mockFetch(standard([{ category: "영업접수", region: "*", room: "영업방" }]));
    const res = await runDeptSave(base({ scheduleDate: "2026-10-22" }), { unit: "device" });
    const order = [firstIndex("POST", "service_receptions"), firstIndex("POST", "field_sheet_sync_jobs"), firstIndex("POST", "team_calendar_events"), firstIndex("POST", "outbox")];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(res.id).toBe("r1");
    expect(res.kakao).toBe("sent");
    expect(res.calendarId).toBe("c1");
    expect(res.warnings).toEqual([]);
    // 시트 잡: 영업 category, dupKey dept:<id>:append, 카톡 없음
    const job = calls.find((c) => c.method === "POST" && c.table === "field_sheet_sync_jobs")!.body as Record<string, unknown>;
    expect(job.category).toBe("reception_sales");
    expect(job._dupKey).toBe("dept:r1:append");
    // 접수 행: 부가 meta 가 실렸고 웹푸시(push-send)는 부르지 않는다
    const row = calls[firstIndex("POST", "service_receptions")].body as { type: string; remote_meta: Record<string, string> };
    expect(row.type).toBe("영업팀");
    expect(row.remote_meta.unit).toBe("device");
    expect(touched("fn:push-send")).toBe(false);
    // 마지막 병합: calendar_id·kakao
    const merge = calls.filter((c) => c.table === "rpc/merge_reception_handling").pop()!.body as { p_meta: Record<string, string> };
    expect(merge.p_meta).toMatchObject({ calendar_id: "c1", kakao: "sent" });
    expect(res.summary).toContain("카톡 전송");
  });

  it("예정일 비우면 접수일(KST 오늘)로 일정 생성", async () => {
    mockFetch(standard([]));
    const res = await runDeptSave(base({ scheduleDate: "" }));
    const row = calls[firstIndex("POST", "service_receptions")].body as { remote_meta: Record<string, string> };
    expect(row.remote_meta.schedule_date).toBe(kstDate());
    expect(touched("team_calendar_events")).toBe(true);
    expect(res.calendarId).toBe("c1");
  });

  it("예정일을 넣으면 그 날짜로 일정 생성", async () => {
    mockFetch(standard([]));
    await runDeptSave(base({ scheduleDate: "2026-12-31" }));
    const row = calls[firstIndex("POST", "service_receptions")].body as { remote_meta: Record<string, string> };
    expect(row.remote_meta.schedule_date).toBe("2026-12-31");
    expect(touched("team_calendar_events")).toBe(true);
  });

  it("운영지원·예정일 없음·매핑 없음: 시트 잡·outbox 없음, 카톡 방 미정(일정은 오늘로)", async () => {
    mockFetch(standard([]));
    const res = await runDeptSave(base({ dept: "운영지원", field: "소모품" }));
    expect(touched("field_sheet_sync_jobs")).toBe(false);
    expect(touched("outbox")).toBe(false);
    expect(res.sheetState).toBe("none");
    expect(res.kakao).toBe("no_room");
    expect(res.summary).toContain("카톡 방 미정");
  });

  it("CHECK 제약 미실행: 접수 저장에서 throw, 뒤 단계는 하지 않는다", async () => {
    mockFetch(standard([], (c) => (c.method === "POST" && c.table === "service_receptions"
      ? { status: 400, body: { code: "23514", message: 'new row for relation "service_receptions" violates check constraint "service_receptions_type_check"' } }
      : undefined)));
    const err = await runDeptSave(base()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isCheckConstraintError(err)).toBe(true);
    expect(touched("field_sheet_sync_jobs")).toBe(false);
    expect(touched("outbox")).toBe(false);
  });

  it("시트 잡 insert 실패: 접수는 남고 sheet_state=failed + 경고", async () => {
    mockFetch(standard([], (c) => (c.method === "POST" && c.table === "field_sheet_sync_jobs" ? { status: 400, body: "category check" } : undefined)));
    const res = await runDeptSave(base({ dept: "경영지원", route: "사내", via: "이윤아", field: "청구관련" }));
    expect(res.id).toBe("r1");
    expect(res.sheetState).toBe("failed");
    expect(res.warnings.some((w) => w.startsWith("시트 미반영"))).toBe(true);
    const merge = calls.filter((c) => c.table === "rpc/merge_reception_handling").pop()!.body as { p_meta: Record<string, string> };
    expect(merge.p_meta.sheet_state).toBe("failed");
  });
});

describe("처리 단추 (runDeptAction)", () => {
  const stored = { id: "r9", type: "영업팀", status: "접수", vendor: "가나상사", author: "박민", field: "해지문의", symptom: "해지 문의", remote_meta: { postpone_count: "1", memo_log: "10/18 10:00 박민: 첫 메모" } };

  it("내일로: 금요일이면 월요일, 미룸+1, 접수→진행중, 달력 upsert", async () => {
    mockFetch(standard([], (c) => (c.method === "GET" && c.table === "service_receptions" ? { body: [stored] } : undefined)));
    const res = await runDeptAction({ id: "r9", type: "영업팀", vendor: "가나상사", author: "박민" }, "tomorrow", { by: "박민", today: "2026-10-23" });
    const first = calls.find((c) => c.table === "rpc/merge_reception_handling")!.body as { p_meta: Record<string, string>; p_status?: string };
    expect(first.p_meta).toEqual({ schedule_date: "2026-10-26", postpone_count: "2" });
    expect(first.p_status).toBe("진행중");
    expect(touched("team_calendar_events")).toBe(true);
    expect(res.row.remote_meta?.schedule_date).toBe("2026-10-26");
    expect(res.row.remote_meta?.calendar_id).toBe("c1");
  });

  it("메모: 최신 행의 memo_log 위에 쌓는다", async () => {
    mockFetch(standard([], (c) => (c.method === "GET" && c.table === "service_receptions" ? { body: [stored] } : undefined)));
    const res = await runDeptAction({ id: "r9", type: "영업팀", vendor: "가나상사", author: "박민" }, "memo", { by: "이정현", text: "견적 보냄" });
    const lines = String(res.row.remote_meta?.memo_log).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2} 이정현: 견적 보냄$/);
    expect(lines[1]).toBe("10/18 10:00 박민: 첫 메모");
  });
});

// 2026-10-25 실사고: 영업 접수 1건(10/20)이 엣지 기입 37초 > 화면 제한 20초라 "대기"로 끝나 접수 sheet_row 가 비었고,
// 10/21 [완료] 때 "시트 행이 아직 없어 시트 갱신은 건너뜁니다"로 시트 G열이 '진행중'에 남았다(잡은 synced·5847행).
describe("시트 행 되찾기 (잡이 synced 인데 접수 sheet_row 가 빈 경우)", () => {
  const stuck = { id: "r7", type: "영업팀", status: "진행중", vendor: "세안", author: "손영근", lease_no: "23058", field: "신규/추가 렌탈", symptom: "데스크탑", sheet_row: null,
    remote_meta: { sheet_state: "queued", sheet_seq: "", handler: "김수인" } };
  const syncedJob: Handler = (c) => {
    if (c.method === "GET" && c.table === "service_receptions") return { body: [stuck] };
    if (c.method === "GET" && c.table === "field_sheet_sync_jobs" && c.url.includes("select=sheet_status")) return { body: [{ sheet_status: "synced", sheet_row: 5847 }] };
    return undefined;
  };

  it("완료: 잡에서 5847행을 찾아 접수에 적고, 그 행으로 갱신 잡을 쌓는다", async () => {
    mockFetch(standard([], syncedJob));
    const res = await runDeptAction({ id: "r7", type: "영업팀", vendor: "세안", author: "손영근" }, "done", { by: "김수인" });
    expect(res.warnings.some((w) => w.includes("건너뜁니다"))).toBe(false);
    const lookup = calls.find((c) => c.table === "field_sheet_sync_jobs" && c.url.includes("select=sheet_status"))!;
    expect(decodeURIComponent(lookup.url)).toContain("_dupKey=eq.dept:r7:append");
    const rowPatch = calls.find((c) => c.method === "PATCH" && c.table === "service_receptions" && (c.body as Record<string, unknown>).sheet_row !== undefined);
    expect((rowPatch!.body as Record<string, unknown>).sheet_row).toBe(5847);
    const job = calls.filter((c) => c.method === "POST" && c.table === "field_sheet_sync_jobs").pop()!.body as { payload: { data: Record<string, string> } };
    expect(job.payload.data._updateOnly).toBe("1");
    expect(job.payload.data._updateRow).toBe("5847");
  });

  it("[다시 보내기]: append 잡이 이미 있고 synced 면 대기 대신 그 행을 접수에 적는다", async () => {
    mockFetch(standard([], (c) => {
      if (c.method === "GET" && c.table === "field_sheet_sync_jobs" && c.url.includes("select=_dupKey")) return { body: [{ _dupKey: "dept:r7:append" }] };
      return syncedJob(c);
    }));
    const res = await retryDeptSheetAppend({ id: "r7", type: "영업팀", vendor: "세안", author: "손영근" });
    expect(res.row.sheet_row).toBe(5847);
    expect(res.row.remote_meta?.sheet_state).toBe("synced");
    expect(calls.some((c) => c.method === "POST" && c.table === "field_sheet_sync_jobs")).toBe(false);
  });

  it("잡도 아직 synced 가 아니면 예전처럼 건너뛴다는 경고", async () => {
    mockFetch(standard([], (c) => (c.method === "GET" && c.table === "service_receptions" ? { body: [stuck] } : undefined)));
    const res = await runDeptAction({ id: "r7", type: "영업팀", vendor: "세안", author: "손영근" }, "done", { by: "김수인" });
    expect(res.warnings).toContain("시트 행이 아직 없어 시트 갱신은 건너뜁니다");
    expect(calls.some((c) => c.method === "POST" && c.table === "field_sheet_sync_jobs")).toBe(false);
  });
});

describe("접수 수정·삭제", () => {
  const stored = { id: "r9", type: "영업팀", status: "접수", vendor: "가나상사", author: "박민", field: "해지문의", symptom: "해지 문의", receiver_name: "", receiver_phone: "", notes: "",
    sheet_row: 12, remote_meta: { schedule_date: "2026-10-20", sheet_seq: "5", calendar_id: "c0" } };

  it("수정: service_receptions PATCH(사람 입력 칸) → 예정일 병합 → 달력 → 시트 갱신 잡", async () => {
    mockFetch(standard([], (c) => (c.method === "GET" && c.table === "service_receptions" ? { body: [stored] } : undefined)));
    const res = await saveDeptReceptionEdit({ id: "r9", type: "영업팀", vendor: "가나상사", author: "박민" },
      { field: "렌탈문의", symptom: " 한 대 추가 ", receiver_name: "김담당", receiver_phone: "010-1111-2222", notes: "", schedule_date: "2026-10-22" });
    const patch = calls.find((c) => c.method === "PATCH" && c.table === "service_receptions")!;
    expect(patch.url).toContain("id=eq.r9");
    expect(patch.body).toEqual({ field: "렌탈문의", symptom: "한 대 추가", receiver_name: "김담당", receiver_phone: "010-1111-2222", notes: "" });
    const merges = calls.filter((c) => c.table === "rpc/merge_reception_handling").map((c) => (c.body as { p_meta: Record<string, string> }).p_meta);
    expect(merges[0]).toEqual({ schedule_date: "2026-10-22" });
    expect(touched("team_calendar_events")).toBe(true);
    const job = calls.find((c) => c.method === "POST" && c.table === "field_sheet_sync_jobs")!.body as { payload: { data: Record<string, string> } };
    expect(job.payload.data._updateOnly).toBe("1");
    expect(job.payload.data._updateRow).toBe("12");
    expect(res.row.field).toBe("렌탈문의");
    expect(res.row.remote_meta?.schedule_date).toBe("2026-10-22");
    expect(res.warnings).toEqual([]);
  });

  it("삭제: deleted=true 소프트 PATCH 뒤 그 접수의 달력 일정 DELETE(행 DELETE 는 없음)", async () => {
    mockFetch(standard([], (c) => (c.method === "DELETE" ? { status: 204 } : undefined)));
    const res = await deleteDeptReception({ id: "r9", type: "영업팀", vendor: "가나상사", author: "박민" });
    const patchAt = calls.findIndex((c) => c.method === "PATCH" && c.table === "service_receptions");
    expect(patchAt).toBeGreaterThanOrEqual(0);
    expect(calls[patchAt].body).toEqual({ deleted: true });
    expect(calls[patchAt].url).toContain("id=eq.r9");
    const delAt = calls.findIndex((c) => c.method === "DELETE" && c.table === "team_calendar_events");
    expect(delAt).toBeGreaterThan(patchAt);
    expect(calls[delAt].url).toContain("reception_id=eq.r9");
    expect(calls.some((c) => c.method === "DELETE" && c.table === "service_receptions")).toBe(false);
    expect(res.warnings).toEqual([]);
  });
});

describe("순수 도우미", () => {
  it("nextWeekday: 토·일 건너뜀", () => {
    expect(nextWeekday("2026-10-23")).toBe("2026-10-26"); // 금 → 월
    expect(nextWeekday("2026-10-24")).toBe("2026-10-26"); // 토 → 월
    expect(nextWeekday("2026-10-21")).toBe("2026-10-22"); // 수 → 목
  });
  it("memoLine·prependMemo", () => {
    expect(memoLine("김", "확인", new Date("2026-10-19T00:05:00Z"))).toBe("10/19 09:05 김: 확인");
    expect(prependMemo("", "a")).toBe("a");
    expect(prependMemo("b\nc", "a")).toBe("a\nb\nc");
  });
  it("resolveReceiver: 로그인 필수면 세션 고정, 아니면 선택값", () => {
    const s = { user: { name: "이정현", department: "영업팀" } };
    expect(resolveReceiver(true, s, "박민")).toEqual({ name: "이정현", team: "영업팀", locked: true });
    expect(resolveReceiver(false, s, "박민")).toEqual({ name: "박민", team: "", locked: false });
    expect(resolveReceiver(false, s, "이정현")).toEqual({ name: "이정현", team: "영업팀", locked: false });
    expect(resolveReceiver(true, null, "박민")).toEqual({ name: "박민", team: "", locked: false });
  });
  it("pickVendorAlias: 임대리스트 행이 가장 많은 표기", () => {
    expect(pickVendorAlias([{ _업체명: "가" }, { _업체명: "나" }, { _업체명: "나" }], "마스터")).toBe("나");
    expect(pickVendorAlias([], "마스터")).toBe("마스터");
  });
  it("formatPhone", () => {
    expect(formatPhone("01012345678")).toBe("010-1234-5678");
    expect(formatPhone("0212345678")).toBe("02-1234-5678");
    expect(formatPhone("내선 12")).toBe("내선 12");
  });
});
