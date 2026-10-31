// 2026-10-31 AS 접수 뒤 방문 판단 안내글 — 자료 모으기·큐 적재(src/visitAdviceData.ts)
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, selectRows: vi.fn(), selectAllRows: vi.fn(), rpc: vi.fn(), getConfig: vi.fn() };
});

import { getConfig, rpc, selectAllRows, selectRows } from "../src/supabase";
import type { ServiceReceptionRow } from "../src/api";
import { collectVisitAdviceInput, runVisitAdviceFor, ticketKindLabel, visitAdviceDueAt } from "../src/visitAdviceData";
import { BUNDLE_LINE } from "../src/visitAdvice";

const sel = vi.mocked(selectRows);
const selAll = vi.mocked(selectAllRows);
const rpcMock = vi.mocked(rpc);
const cfg = vi.mocked(getConfig);
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); });

// RPC 두 개: resolve_ticket_vendor_code(업체 코드) · queue_visit_advice(적재). 적재 호출 인자를 모은다
type QueueArgs = { p_reception_id: string; p_room: string; p_text: string; p_verdict: string | null; p_send: boolean; p_due_at: string; p_facts: Record<string, unknown>; p_author: string };
let queued: QueueArgs[] = [];
function mockRpc(code: string | null, queue: (a: QueueArgs) => unknown = (a) => ({ status: a.p_send ? "queued" : "skipped" })) {
  queued = [];
  rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "resolve_ticket_vendor_code") return code as never;
    if (fn === "queue_visit_advice") { queued.push(args as QueueArgs); return queue(args as QueueArgs) as never; }
    throw new Error(`unexpected rpc ${fn}`);
  });
}

const CODE = "1234567890";
const HQ = "청오에스떠블유 주식회사(써브웨이 본사)";
const BRANCH2 = "청오에스떠블유 주식회사(써브웨이 답십리역점)";
const ADDR = "서울 종로구 율곡로 10 5층";

const reception = (over: Partial<ServiceReceptionRow> = {}): ServiceReceptionRow => ({
  id: "rc-1", created_at: "2026-10-30T05:00:00Z", receipt_date: "2026-10-30", author: "접수자", route: "", type: "복합기 AS", vendor: HQ,
  asset_no: "31V0123", serial: "ABC12345", model: "D470", region: "수도권C", title: "", symptom: "용지 걸림", paid: "", notes: "", report_text: "",
  status: "전송완료", sent_room: "C팀 AS방", grade: "V", receiver_name: "", receiver_phone: "", keyman_info: "", lease_no: "1501", address: ADDR, ...over,
});

const LEASE = [
  { id: 1, 코드: "21000", _업체명: HQ, 기번: "ABC12345", 자산번호: "31V0123", 모델명: "D470", 품목: "복합기", 임대여부: "임대중", 주소상세주소: ADDR },
  { id: 2, 코드: "21000", _업체명: HQ, 기번: "XYZ98765", 자산번호: "31V0456", 모델명: "SL-X3220", 품목: "복합기", 임대여부: "임대중", 주소상세주소: ADDR },
];
const JEOM = [
  { id: 11, 작성일: "2026-08-04", _업체명: HQ, 시리얼넘버: "ABC12345", 자산기번: "31V0123", 모델명: "D470", 매수: "흑 10000 컬 5000", 여분: "K2 C2 M2 Y2", 폐통: "2" },
  { id: 12, 작성일: "2026-05-10", _업체명: HQ, 시리얼넘버: "ABC12345", 자산기번: "31V0123", 모델명: "D470", 매수: "흑 8000 컬 4000", 여분: "K2 C2 M2 Y2", 폐통: "2" },
];
const ASR = [{ id: 21, 작성일: "2026-10-23", _업체명: HQ, 시리얼넘버: "ABC12345", 자산기번: "31V0123", 모델명: "D470" }];
const PAST_TICKETS = [
  // 이번 접수로 만든 일정 — 다녀온 AS 에서도, 추가일정에서도 빠져야 한다
  { id: "t-own", date: "2026-10-30", scheduleType: "AS", status: "완료", vendor: HQ, vendor_code: CODE, receptionId: "rc-1" },
];
const FUTURE = [
  { id: "t-own2", date: "2026-10-31", scheduleType: "AS", status: "", vendor: HQ, vendor_code: CODE, receptionId: "rc-1", address: ADDR },
  { id: "t-swap", date: "2026-11-02", time: "10:00", team: "운영", scheduleType: "물류", source: "naver", status: "", vendor: BRANCH2, vendor_code: CODE,
    calendarTitle: "⭐1번 일정⭐/퍼스트/교체(일반)/기기상향/청오에스떠블유", address: "서울 동대문구 답십리로 1" },
  { id: "t-bldg", date: "2026-11-05", team: "C", scheduleType: "AS", source: "manual", status: "", vendor: "다른회사", vendor_code: "9999999999",
    issue: "토너 교체 요청", address: ADDR },
  { id: "t-off", date: "2026-11-03", scheduleType: "휴가", status: "", vendor: "홍길동 연차", vendor_code: "" },
  { id: "t-far", date: "2026-11-04", scheduleType: "AS", status: "", vendor: "무관업체", vendor_code: "5555555555", address: "부산 해운대구 우동 1" },
];
const WORKIN = [{ id: 7, quarter: 4, kind: "quarter", label: "G3", team: "C", name: "25#V청오에스떠블유 써브웨이본사", visible: true }];

function mockChungo(opts: { failJeom?: boolean; queue?: (a: QueueArgs) => unknown } = {}) {
  mockRpc(CODE, opts.queue);
  sel.mockImplementation(async (table: string, q: string) => {
    if (table === "vendor_info") return (q.includes("_raw") ? [{ _업체명: HQ, 코드: "21000" }] : LEASE) as never;
    if (table === "vendor_master") return [{ code: CODE, name: "청오에스떠블유 주식회사", aliases: [HQ, BRANCH2] }] as never;
    if (table === "jeomgeom") { if (opts.failJeom) throw new Error("조회 실패 jeomgeom(500): timeout"); return JEOM as never; }
    if (table === "as_records") return ASR as never;
    if (table === "as_tickets") return PAST_TICKETS as never;
    if (table === "workin_vendor_code") return [{ place_id: 7 }] as never;
    if (table === "workin_map_places") return WORKIN as never;
    return [] as never;
  });
  selAll.mockImplementation(async (table: string) => (table === "as_tickets" ? FUTURE : []) as never);
}

describe("collectVisitAdviceInput — 청오에스떠블유 표본", () => {
  it("점검 08-04 · AS 10-23 · 워킨맵 C팀 · 11-02 교체(다른 주소 지점)는 제외 · 같은 건물 다른 업체 일정은 포함", async () => {
    mockChungo();
    const got = await collectVisitAdviceInput(reception(), { today: "2026-10-30" });
    if ("notFound" in got) throw new Error("못 찾음이면 안 된다");
    expect(got.vendor).toBe(HQ);
    expect(got.lastInspection).toBe("2026-08-04");
    expect(got.lastAs).toBe("2026-10-23");               // 이번 접수로 만든 일정(10-30 완료)은 빠진다
    expect(got.asAfterInspection).toEqual([{ date: "2026-10-23", deviceCount: 1 }]);
    expect(got.deviceTotal).toBe(2);
    expect(got.workin).toEqual({ kind: "quarter", label: "C팀" });
    // 2026-10-31 사용자: 같은 사업자라도 다른 주소(답십리역점)는 추가일정에서 뺀다 — 같은 건물만
    expect(got.upcoming.map((u) => u.date)).toEqual(["2026-11-05"]);
    const [bldg] = got.upcoming;
    expect(bldg.sameBuilding).toBe(true);
    expect(bldg.vendor).toBe("다른회사");
    // RPC 는 접수 id·시리얼·자산·업체명 그대로
    expect(rpcMock).toHaveBeenCalledWith("resolve_ticket_vendor_code", { p_reception: "rc-1", p_serial: "ABC12345", p_asset: "31V0123", p_vendor: HQ });
  });

  it("업체 코드도 임대리스트 지점도 없으면 notFound", async () => {
    mockRpc(null);
    sel.mockResolvedValue([] as never);
    selAll.mockResolvedValue([] as never);
    expect(await collectVisitAdviceInput(reception({ lease_no: "", vendor: "없는회사" }), { today: "2026-10-30" })).toEqual({ notFound: true });
  });

  it("일정 종류 낱말", () => {
    expect(ticketKindLabel({ scheduleType: "물류", source: "naver", calendarTitle: "…-납품(일반)/퍼스트" })).toBe("납품");
    expect(ticketKindLabel({ scheduleType: "익일AS", source: "", calendarTitle: "" })).toBe("AS");
    expect(ticketKindLabel({ scheduleType: "물류", source: "", calendarTitle: "메모만" })).toBe("물류");
    expect(ticketKindLabel({ scheduleType: "", source: "recontract", calendarTitle: "" })).toBe("재계약 확인");
  });
});

describe("runVisitAdviceFor — 판정·적재(RPC queue_visit_advice)", () => {
  const NOW_14 = new Date("2026-10-30T05:00:00Z"); // KST 금 14:00
  const ON = { VISIT_ADVICE_ENABLED: "true" };

  it("청오: 판단필요 + 묶기 안내 글을 즉시 due 로 적재", async () => {
    mockChungo();
    cfg.mockResolvedValue(ON);
    const r = await runVisitAdviceFor(reception(), "C팀 AS방", { now: NOW_14 });
    expect(r).toMatchObject({ status: "queued", verdict: "판단필요", immediate: true });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ p_reception_id: "rc-1", p_room: "C팀 AS방", p_send: true, p_verdict: "판단필요", p_due_at: NOW_14.toISOString(), p_author: "접수자" });
    const text = queued[0].p_text;
    expect(text.split("\n")[0]).toBe(`${HQ} V`);
    expect(text).toContain("마지막점검일:2026-08-04");
    expect(text).toContain("마지막AS일:2026-10-23");
    expect(text).not.toContain("2026-11-02");                       // 다른 주소 지점(답십리역점) 교체는 뺀다(2026-10-31 같은 건물만)
    expect(text).toMatch(/1\.2026-11-05\(목\) \[같은 건물\] 다른회사/);
    expect(text).toContain(BUNDLE_LINE);
    expect(text.length).toBeLessThanOrEqual(600);
  });

  it("개인정보: 큐로 가는 글·facts 에 접수자 전화번호·주소가 들어가지 않는다(검수아 2026-10-31)", async () => {
    mockChungo();
    cfg.mockResolvedValue(ON);
    await runVisitAdviceFor(reception({ receiver_phone: "010-1234-5678", receiver_name: "홍길동", address: ADDR }), "C팀 AS방", { now: NOW_14 });
    expect(queued).toHaveLength(1);
    const blob = `${queued[0].p_text}
${JSON.stringify(queued[0].p_facts)}`;
    expect(blob).not.toMatch(/01\d-?\d{3,4}-?\d{4}/);
    expect(blob).not.toContain("1234-5678");
    expect(blob).not.toContain(ADDR);
    expect(blob).not.toContain("율곡로");
  });

  it("할 일 없음(워킨맵 G5 + 추가일정 없음) → 그래도 p_send=false 로 RPC 를 부른다(보충 크론 오발송 방지)", async () => {
    mockChungo();
    const base = sel.getMockImplementation()!;
    sel.mockImplementation(async (t: string, q: string) => (t === "workin_map_places" ? [{ ...WORKIN[0], label: "G5" }] : base(t, q)) as never);
    selAll.mockResolvedValue([] as never);
    cfg.mockResolvedValue(ON);
    const r = await runVisitAdviceFor(reception(), "C팀 AS방", { now: NOW_14 });
    expect(r).toEqual({ status: "no-task", verdict: "불필요" });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ p_send: false, p_verdict: "불필요" });
  });

  it("못 찾음 → 판단불가 글(누락 없이 적재)", async () => {
    mockRpc(null);
    sel.mockResolvedValue([] as never);
    selAll.mockResolvedValue([] as never);
    cfg.mockResolvedValue(ON);
    const r = await runVisitAdviceFor(reception({ lease_no: "", vendor: "없는회사" }), "C팀 AS방", { now: NOW_14 });
    expect(r).toMatchObject({ status: "queued", verdict: "판단불가" });
    expect(queued[0].p_text).toContain("임대리스트에서 못 찾음");
  });

  it("조회 실패 → 건너뛰지 않고 판단불가(자료 못 읽음) 글", async () => {
    mockChungo({ failJeom: true });
    cfg.mockResolvedValue(ON);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await runVisitAdviceFor(reception(), "C팀 AS방", { now: NOW_14 });
    expect(r).toMatchObject({ status: "queued", verdict: "판단불가" });
    expect(queued[0].p_text).toContain("자료 못 읽음");
  });

  it("KST 10시 전 접수 → due_at 오늘 10:00, 첫 줄에 접수 시각 꼬리", async () => {
    mockChungo();
    cfg.mockResolvedValue(ON);
    const now = new Date("2026-10-30T00:30:00Z"); // KST 09:30
    const r = await runVisitAdviceFor(reception({ created_at: now.toISOString() }), "C팀 AS방", { now });
    expect(r).toMatchObject({ status: "queued", immediate: false, dueAt: "2026-10-30T01:00:00.000Z" });
    expect(queued[0].p_due_at).toBe("2026-10-30T01:00:00.000Z");
    expect(queued[0].p_text.split("\n")[0]).toBe(`${HQ} V (10/30 09:30 접수분)`);
  });

  it("표·함수가 없으면(SQL 실행 전) 콘솔 경고 + tableMissing 오류를 돌려준다", async () => {
    mockChungo({ queue: () => { throw new Error('RPC queue_visit_advice 실패(404): {"code":"PGRST202","message":"Could not find the function"}'); } });
    cfg.mockResolvedValue(ON);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await runVisitAdviceFor(reception(), "C팀 AS방", { now: NOW_14 });
    expect(r).toMatchObject({ status: "error", tableMissing: true });
    expect(warn).toHaveBeenCalled();
  });

  it("다른 실패(방 거절 등)는 tableMissing=false 오류로", async () => {
    mockChungo({ queue: () => { throw new Error("RPC queue_visit_advice 실패(400): 보낼 수 없는 방"); } });
    cfg.mockResolvedValue(ON);
    const r = await runVisitAdviceFor(reception(), "엉뚱한 방", { now: NOW_14 });
    expect(r).toMatchObject({ status: "error", tableMissing: false });
  });

  it("이미 처리된 접수 → exists, 스위치 꺼짐 → off(조회 안 함)", async () => {
    mockChungo({ queue: () => ({ status: "exists", existing: "sent" }) });
    cfg.mockResolvedValue(ON);
    expect((await runVisitAdviceFor(reception(), "C팀 AS방", { now: NOW_14 })).status).toBe("exists");
    rpcMock.mockClear();
    cfg.mockResolvedValue({ VISIT_ADVICE_ENABLED: "false" });
    expect(await runVisitAdviceFor(reception(), "C팀 AS방", { now: NOW_14 })).toEqual({ status: "off" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("visitAdviceDueAt", () => {
  it("09:30 → 같은 날 10:00 / 14:00 → 즉시 / 금 21:00 → 월 10:00 / 공휴일 아침 → 다음 영업일", () => {
    expect(visitAdviceDueAt(new Date("2026-10-30T00:30:00Z"))).toBe("2026-10-30T01:00:00.000Z");
    expect(visitAdviceDueAt(new Date("2026-10-30T05:00:00Z"))).toBe("2026-10-30T05:00:00.000Z");
    expect(visitAdviceDueAt(new Date("2026-10-30T12:00:00Z"))).toBe("2026-11-02T01:00:00.000Z");
    expect(visitAdviceDueAt(new Date("2026-12-24T23:00:00Z"))).toBe("2026-12-28T01:00:00.000Z"); // 12-25(금) 08시 → 월
  });
});

describe("pickUpcomingTickets — 같은 사업자 다른 표기(2026-10-31 같은 건물만)", () => {
  it("같은 주소면 포함, 다른 주소면 제외, 주소 없으면 포함 + (주소 미확인)", async () => {
    const { pickUpcomingTickets } = await import("../src/visitAdviceData");
    const { sameBuildingKey } = await import("../src/visitAdvice");
    const ctx = { receptionId: "rc-1", code: "1234567890", entity: { deviceKeys: [], nameKeys: [] } as never, branchName: "써브웨이 본사", branchDeviceKeys: [], buildingKeys: [sameBuildingKey("서울 강남구 테헤란로 10, 5층")], today: "2026-10-30" };
    const rows = [
      { id: "a", date: "2026-11-02", vendor: "청오에스떠블유(본사 2층)", vendor_code: "1234567890", address: "서울 강남구 테헤란로 10 2층", scheduleType: "물류" },
      { id: "b", date: "2026-11-03", vendor: "써브웨이 답십리역점", vendor_code: "1234567890", address: "서울 동대문구 답십리로 1", scheduleType: "물류" },
      { id: "c", date: "2026-11-04", vendor: "청오에스떠블유", vendor_code: "1234567890", address: "", scheduleType: "AS" },
    ];
    const got = pickUpcomingTickets(rows as never, ctx);
    expect(got.map((t) => t.id)).toEqual(["a", "c"]);
    expect(got[0].addressUnknown).toBeUndefined();
    expect(got[1].addressUnknown).toBe(true);
  });
});
