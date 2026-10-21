/**
 * 재계약 다음확인일 → 일정 만들기(recontractSchedule) — 순수 로직 + 저장 흐름(fetch 모킹, 실제 DB·네이버 호출 없음).
 * 지키는 것: 칩 날짜(금요일 익일=월요일) · 같은 dupKey = 같은 일정 id · 팀 결정 · 요약 빈 줄 제외 · 테스트 모드 제목/네이버 미호출
 *          · 일정 저장 실패면 네이버 안 부름 · 네이버만 실패면 다시 시도 작업 · 같은 업체 열린 재계약 일정 → duplicate · 옮기기.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateConfigCaches } from "../src/supabase";
import {
  addMonthsYmd, assigneeForRecontract, buildRecontractSummary, buildRecontractTicket, clearScheduleOffer, createRecontractSchedule,
  defaultScheduleTitle, formatYmdKo, formatYmdShort, isYmd, nextCheckChips, readScheduleOffer, recontractTicketId, saveScheduleOffer,
  SCHEDULE_OFFER_KEY, shouldOfferSchedule, teamForRecontract, validateScheduleInput, type RecontractScheduleInput,
} from "../src/recontractSchedule";

const FORM: Record<string, string> = {
  작성자: "", 지역: "C", 등급: "S", 업체명: "보림토건(주)", 담당자: "김과장 010-1234-5678", 기종: "C3060 2층",
  계약종료일: "2026-11-30", 갱신상태: "제안완료", 갱신위험도: "중", 고객반응현황: "검토중", 월렌탈료: "",
  제안조건: "3년 유지, 컬러 단가 인하", 갱신방향: "", 내부협의: "", 후속담당자: "이민구", 기한: "1주 이내", 다음확인일: "2026-10-29", 관리포인트: "",
};

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(), key: () => null, get length() { return m.size; },
  };
}

describe("날짜 도우미·칩", () => {
  it("요일 표기: 카톡 2026-10-29(목), 칸 10/29(목), 글자값은 그대로", () => {
    expect(formatYmdKo("2026-10-29")).toBe("2026-10-29(목)");
    expect(formatYmdShort("2026-10-29")).toBe("10/29(목)");
    expect(formatYmdKo("차주 중")).toBe("차주 중");
    expect(isYmd("2026-02-30")).toBe(false);
  });
  it("목요일(10/22) 기준 칩 6개", () => {
    const chips = nextCheckChips("2026-10-22");
    expect(chips.map((c) => c.label)).toEqual(["익일", "+3일", "+1주", "+2주", "+1달", "+3달"]);
    expect(chips.map((c) => c.ymd)).toEqual(["2026-10-23", "2026-10-25", "2026-10-29", "2026-11-05", "2026-11-22", "2027-01-22"]);
  });
  it("금요일 익일 = 월요일(주말 건너뜀), +3일은 달력 그대로", () => {
    const chips = nextCheckChips("2026-10-23");
    expect(chips[0].ymd).toBe("2026-10-26");
    expect(chips[1].ymd).toBe("2026-10-26");
  });
  it("+1달 말일 넘침은 그 달 말일", () => {
    expect(addMonthsYmd("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsYmd("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("일정 행 만들기", () => {
  it("같은 dupKey = 같은 id(rc- + 앞 20자)", () => {
    expect(recontractTicketId("0123456789abcdef0123456789abcdef")).toBe("rc-0123456789abcdef0123");
    expect(recontractTicketId("", FORM)).toBe(recontractTicketId("", { ...FORM }));
  });
  it("팀: 양식 지역 → 작성자 명단 → 빈칸", () => {
    expect(teamForRecontract(FORM, "누구", {})).toBe("C");
    expect(teamForRecontract({ ...FORM, 지역: "" }, "홍길동", { B: ["홍길동"] })).toBe("B");
    expect(teamForRecontract({ ...FORM, 지역: "" }, "없는사람", { B: ["홍길동"] })).toBe("");
  });
  it("담당: 후속담당자가 명단에 있으면 그 이름, 아니면 작성자", () => {
    expect(assigneeForRecontract(FORM, "작성자", ["이민구"])).toBe("이민구");
    expect(assigneeForRecontract(FORM, "작성자", ["다른사람"])).toBe("작성자");
  });
  it("요약: 빈 값 줄은 빼고 원문을 아래에 붙인다", () => {
    const s = buildRecontractSummary(FORM, "이민구", "2026-10-29", "/계약갱신\n원문", "2026-10-22");
    expect(s.split("\n")[0]).toBe("[재계약 확인] 보림토건(주) · 다음 확인일 2026-10-29(목)");
    expect(s).toContain("갱신 상태: 제안완료 / 위험도: 중 / 고객 반응: 검토중");
    expect(s).toContain("계약 종료일: 2026-11-30");
    expect(s).not.toContain("월 렌탈료");
    expect(s).not.toContain("갱신 방향");
    expect(s).not.toContain("관리 포인트");
    expect(s).toContain("— 작성 이민구 2026-10-22 (FIELD 재계약)");
    expect(s).toContain("— 전송 원문 —\n/계약갱신\n원문");
  });
  it("행: 유형 AS·팀 시각·source recontract·naverUid 없음, 테스트 모드면 [테스트] 제목", () => {
    const input: RecontractScheduleInput = { dupKey: "abc", form: FORM, author: "이민구", testMode: true, date: "2026-10-29", team: "C", title: "[재계약 확인] 보림토건(주)", address: "서울", note: "n", assignee: "이민구" };
    const row = buildRecontractTicket(input);
    expect(row).toMatchObject({ id: "rc-abc", team: "C", date: "2026-10-29", time: "15:00", scheduleType: "AS", source: "recontract", status: "배정", vendor: "보림토건(주)", issue: "재계약 확인 (FIELD 재계약에서 등록)" });
    expect(row.calendarTitle).toBe("[테스트] [재계약 확인] 보림토건(주)");
    expect("naverUid" in row).toBe(false);
    expect(defaultScheduleTitle("보림토건(주)", true)).toBe("[테스트] [재계약 확인] 보림토건(주)");
  });
  it("검사: 지난 날짜·팀 없음·제목 없음 막음", () => {
    expect(validateScheduleInput({ date: "2026-10-21", team: "C", title: "x" }, "2026-10-22")).toMatch(/오늘 이후/);
    expect(validateScheduleInput({ date: "2026-10-22", team: "", title: "x" }, "2026-10-22")).toMatch(/팀/);
    expect(validateScheduleInput({ date: "2026-10-22", team: "A", title: " " }, "2026-10-22")).toMatch(/제목/);
    expect(validateScheduleInput({ date: "2026-10-22", team: "A", title: "x" }, "2026-10-22")).toBe("");
  });
});

describe("대기 중인 제안(24시간)", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", memStore()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("날짜일 때만 묻는다 — 글자값·빈 값·다른 양식은 안 물음", () => {
    expect(shouldOfferSchedule({ schemaKey: "recontract", form: FORM })).toBe(true);
    expect(shouldOfferSchedule({ schemaKey: "recontract", form: { ...FORM, 다음확인일: "차주 중" } })).toBe(false);
    expect(shouldOfferSchedule({ schemaKey: "recontract", form: { ...FORM, 다음확인일: "" } })).toBe(false);
    expect(shouldOfferSchedule({ schemaKey: "bulman", form: FORM })).toBe(false);
  });
  it("저장 → 읽기 → 24시간 지나면 지워짐", () => {
    const at = Date.parse("2026-10-22T01:00:00Z");
    saveScheduleOffer({ dupKey: "k1", form: FORM, author: "a", text: "t", testMode: false, at });
    expect(readScheduleOffer(at + 1000)?.dupKey).toBe("k1");
    expect(readScheduleOffer(at + 25 * 3600_000)).toBeNull();
    expect(localStorage.getItem(SCHEDULE_OFFER_KEY)).toBeNull();
  });
  it("지우기는 같은 건만", () => {
    saveScheduleOffer({ dupKey: "k2", form: FORM, author: "a", text: "t", testMode: false, at: Date.now() });
    clearScheduleOffer("다른건");
    expect(readScheduleOffer()?.dupKey).toBe("k2");
    clearScheduleOffer("k2");
    expect(readScheduleOffer()).toBeNull();
  });
});

describe("createRecontractSchedule 저장 흐름(fetch 모킹)", () => {
  type Call = { url: string; method: string; body: Record<string, unknown> | null };
  let calls: Call[] = [];
  let cfg: Record<string, string> = {};
  let openTickets: Array<Record<string, unknown>> = [];
  let upsertStatus = 201;
  let edgeStatus = 200;

  beforeEach(() => {
    invalidateConfigCaches();
    calls = [];
    cfg = { TEST_MODE: "false", NAVER_CALENDAR_ENABLED: "true" };
    openTickets = [];
    upsertStatus = 201;
    edgeStatus = 200;
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/app_config")) return json(Object.entries(cfg).map(([key, value]) => ({ key, value })));
      if (url.includes("/functions/v1/naver-calendar-push")) return edgeStatus === 200 ? json({ uid: "firstoa-r-rc-abc" }) : json({ error: "쓰기 상한" }, edgeStatus);
      if (url.includes("/as_tickets") && method === "GET") {
        const id = url.match(/id=eq\.([^&]+)/)?.[1];
        return json(id ? openTickets.filter((t) => t.id === decodeURIComponent(id)) : openTickets);
      }
      if (url.includes("/as_tickets") && method === "POST") return new Response(upsertStatus === 201 ? "" : "fail", { status: upsertStatus });
      if (url.includes("/as_tickets") && method === "PATCH") return new Response(null, { status: 204 });
      return json([]);
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const input = (over: Partial<RecontractScheduleInput> = {}): RecontractScheduleInput => ({
    dupKey: "abc", form: FORM, author: "이민구", testMode: false, date: "2026-10-29", team: "C",
    title: "[재계약 확인] 보림토건(주)", address: "서울 강남구", note: "요약", assignee: "이민구", ...over,
  });
  const edge = () => calls.filter((c) => c.url.includes("/functions/v1/naver-calendar-push"));
  const upserts = () => calls.filter((c) => c.method === "POST" && c.url.includes("/as_tickets"));
  const patches = () => calls.filter((c) => c.method === "PATCH" && c.url.includes("/as_tickets"));

  it("새로 만들기: as_tickets upsert(id 고정) → 네이버(stableKey=같은 id, calId 없음=익일통합as) → naverUid 저장", async () => {
    const r = await createRecontractSchedule(input(), "auto", "2026-10-22");
    expect(r).toMatchObject({ kind: "created", ticketId: "rc-abc", naver: "ok" });
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0].url).toContain("on_conflict=id");
    expect(upserts()[0].body).toMatchObject({ id: "rc-abc", scheduleType: "AS", time: "15:00" });
    expect(edge()).toHaveLength(1);
    expect(edge()[0].body).toMatchObject({ stableKey: "rc-abc", date: "2026-10-29", time: "15:00", location: "서울 강남구" });
    expect(edge()[0].body && "calId" in edge()[0].body).toBe(false);
    expect(patches()[0].body).toMatchObject({ naverUid: "firstoa-r-rc-abc" });
  });
  it("두 번 눌러도 같은 id·같은 stableKey", async () => {
    await createRecontractSchedule(input(), "auto", "2026-10-22");
    await createRecontractSchedule(input(), "auto", "2026-10-22");
    expect(new Set(upserts().map((c) => c.body?.id))).toEqual(new Set(["rc-abc"]));
    expect(new Set(edge().map((c) => c.body?.stableKey))).toEqual(new Set(["rc-abc"]));
  });
  it("일정 저장 실패 → throw, 네이버는 부르지 않음", async () => {
    upsertStatus = 500;
    await expect(createRecontractSchedule(input(), "new", "2026-10-22")).rejects.toThrow(/저장 실패/);
    expect(edge()).toHaveLength(0);
  });
  it("네이버만 실패 → 일정은 저장, failed + 다시 시도 작업", async () => {
    edgeStatus = 429;
    const r = await createRecontractSchedule(input(), "new", "2026-10-22");
    expect(r).toMatchObject({ kind: "created", naver: "failed" });
    if (r.kind === "duplicate") throw new Error("unexpected");
    expect(r.naverJob).toMatchObject({ kind: "push", ticketId: "rc-abc" });
    expect(upserts()).toHaveLength(1);
  });
  it("테스트 모드 → 네이버 미호출, 제목 [테스트]", async () => {
    const r = await createRecontractSchedule(input({ testMode: true }), "new", "2026-10-22");
    expect(r).toMatchObject({ naver: "test" });
    expect(edge()).toHaveLength(0);
    expect(String(upserts()[0].body?.calendarTitle)).toMatch(/^\[테스트\]/);
  });
  it("네이버 토글 꺼짐 → 미호출", async () => {
    cfg.NAVER_CALENDAR_ENABLED = "false";
    const r = await createRecontractSchedule(input(), "new", "2026-10-22");
    expect(r).toMatchObject({ naver: "off" });
    expect(edge()).toHaveLength(0);
  });
  it("같은 업체 열린 재계약 일정(워킨맵 포함) → duplicate, 저장 안 함 / 다른 업체는 무시", async () => {
    openTickets = [
      { id: "wk-1", vendor: "보림토건", date: "2026-10-25", issue: "재계약 방문 (워킨맵에서 등록)", status: "배정" },
      { id: "wk-2", vendor: "다른업체", date: "2026-10-25", issue: "재계약 방문 (워킨맵에서 등록)", status: "배정" },
    ];
    const r = await createRecontractSchedule(input(), "auto", "2026-10-22");
    expect(r.kind).toBe("duplicate");
    if (r.kind !== "duplicate") throw new Error("unexpected");
    expect(r.existing.map((t) => t.id)).toEqual(["wk-1"]);
    expect(upserts()).toHaveLength(0);
    const q = calls.find((c) => c.method === "GET" && c.url.includes("/as_tickets"))!.url;
    expect(q).toContain(`issue=like.${encodeURIComponent("재계약*")}`);
    expect(q).toContain(`status=neq.${encodeURIComponent("완료")}`);
  });
  it("옮기기: 기존 행 날짜·시각·내용 수정 + 네이버 caldav_update", async () => {
    openTickets = [{ id: "wk-1", vendor: "보림토건", date: "2026-10-25", note: "옛 메모", naverUid: "uid-1" }];
    const r = await createRecontractSchedule(input(), { moveId: "wk-1" }, "2026-10-22");
    expect(r).toMatchObject({ kind: "moved", ticketId: "wk-1", naver: "ok" });
    expect(patches()[0].url).toContain("id=eq.wk-1");
    expect(patches()[0].body).toMatchObject({ date: "2026-10-29", time: "15:00" });
    expect(String(patches()[0].body?.note)).toContain("— 이전 내용 —\n옛 메모");
    expect(edge()[0].body).toMatchObject({ action: "caldav_update", uid: "uid-1", date: "2026-10-29" });
    expect(upserts()).toHaveLength(0);
  });
});
