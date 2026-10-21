/**
 * 미수 방문이력 저장 흐름(misuVisitApi.saveMisuVisit) + 화면 보조(misuVisitDraft) + 작성기 렌더 스모크.
 * 지키는 것: 저장 실패면 카톡 안 보냄 · 방 없음(E) → 저장만 · 같은 id 재전송(409) = 성공 · 표 없음 → tableNotReady · 테스트방 대체 금지.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { invalidateConfigCaches } from "../src/supabase";
import { buildMisuVisitRow, isMisuTableMissing, misuSheetRowToVendor, saveMisuVisit } from "../src/misuVisitApi";
import {
  filterMisuVendors, isMisuDraftTouched, MISU_DRAFT_KEY, misuRoundHint, readMisuDraft, sheetVendorToOption, slotsToPhotos, writeMisuDraft,
} from "../src/misuVisitDraft";
import { emptyMisuVisitDraft, type MisuVisit, type MisuVisitDraft } from "../src/misuVisit";
import MisuVisitForm from "../src/MisuVisitForm";

const ALL_PHOTOS = (["outside", "door", "device", "notice"] as const).map((slot) => ({ slot, url: `https://x.supabase.co/storage/v1/object/public/photos/20261022/${slot}.jpg` }));

function goodSecond(over: Partial<MisuVisitDraft> = {}): MisuVisitDraft {
  return emptyMisuVisitDraft({
    id: "11111111-2222-4333-8444-555555555555", visit_round: "2차 경고", visited_at: "2026-10-22T05:20:00Z",
    author: "이민구", author_team: "C", vendor: "○○학원", company_code: "2139567243", lease_seq: "3004", region: "C",
    misu_months: "5", misu_balance: "2140050",
    contact_name: "김○○", contact_title: "점장", contact_is_rep: false, rep_phone_status: "확보", rep_phone: "010-0000-0000",
    open_status: "영업중",
    dun_methods: ["구두 안내", "안내문 봉함 전달"], dun_reply: "대표에게 전달하겠다",
    return_requested: true, return_to: "점장", return_reply: "대표 확인 후 회신", return_method: "반송 주소 안내",
    photos: ALL_PHOTOS, judgment: "소송이관", judgment_reason: "2차 경고 후 무응답",
    rules_ack: { sealed: true, thirdPartyNoDebt: true },
    ...over,
  });
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let cfg: Record<string, string> = {};
let rooms: Array<{ category: string; region: string; room: string }> = [];
let insertStatus = 201;
let insertBody = "";
let outboxStatus = 201;

beforeEach(() => {
  invalidateConfigCaches();
  calls = [];
  cfg = { TEST_MODE: "false", TEST_ROOM: "테스트 전용방", FIELD_KAKAO_SEND_ENABLED: "true" };
  rooms = [{ category: "미수", region: "C", room: "강남C 미수 보증금 보고방" }, { category: "점검", region: "E", room: "지방 점검방" }];
  insertStatus = 201;
  insertBody = "";
  outboxStatus = 201;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    if (url.includes("/app_config")) return json(Object.entries(cfg).map(([key, value]) => ({ key, value })));
    if (url.includes("/room_map")) return json(rooms);
    if (url.includes("/rpc/create_photo_album")) return json("album-123");
    if (url.includes("/photo_assets")) return new Response("", { status: 201 });
    if (url.includes("/misu_visits") && method === "POST") return new Response(insertBody, { status: insertStatus });
    if (url.includes("/outbox") && method === "GET") return json([]);
    if (url.includes("/outbox") && method === "POST") return new Response("", { status: outboxStatus });
    return json([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const posts = (part: string) => calls.filter((c) => c.method === "POST" && c.url.includes(part));

describe("saveMisuVisit 저장 흐름", () => {
  it("정상: 앨범 → misu_visits insert(id 고정·_hidden=false) → 지역 미수방 outbox", async () => {
    const r = await saveMisuVisit(goodSecond(), { origin: "https://field.example/" });
    expect(r.saved).toBe("new");
    expect(r.kakao).toBe("queued");
    expect(r.room).toBe("강남C 미수 보증금 보고방");
    const row = posts("/misu_visits")[0].body as Record<string, unknown>;
    expect(row.id).toBe("11111111-2222-4333-8444-555555555555");
    expect(row._hidden).toBe(false);
    expect(row.album_id).toBe("album-123");
    expect(row.room).toBe("강남C 미수 보증금 보고방");
    expect(row).not.toHaveProperty("created_at");
    expect(String(row.text_body)).toContain("/미수 방문 2차(경고)");
    expect(String(row.text_body)).toContain("https://field.example/?album=album-123");
    const out = posts("/outbox")[0].body as { room: string; text: string };
    expect(out.room).toBe("강남C 미수 보증금 보고방");
    expect(out.text).toBe(row.text_body);
  });

  it("저장 실패(500)면 카톡을 보내지 않는다", async () => {
    insertStatus = 500;
    insertBody = '{"message":"boom"}';
    const r = await saveMisuVisit(goodSecond());
    expect(r.saved).toBeNull();
    expect(r.kakao).toBeNull();
    expect(r.error).toContain("500");
    expect(posts("/outbox")).toHaveLength(0);
  });

  it("표 없음(404 PGRST205) → tableNotReady, 카톡 없음", async () => {
    insertStatus = 404;
    insertBody = '{"code":"PGRST205","message":"Could not find the table public.misu_visits"}';
    const r = await saveMisuVisit(goodSecond());
    expect(r.saved).toBeNull();
    expect(r.tableNotReady).toBe(true);
    expect(posts("/outbox")).toHaveLength(0);
    expect(isMisuTableMissing(new Error('조회 실패 misu_visits(404): {"code":"42P01"}'))).toBe(true);
    expect(isMisuTableMissing(new Error("저장 실패 misu_visits(500): x"))).toBe(false);
  });

  it("E 지역처럼 room_map 에 '미수|E' 가 없으면 저장만 — 테스트방으로 대신 보내지 않는다", async () => {
    const r = await saveMisuVisit(goodSecond({ region: "E", author_team: "E" }));
    expect(r.saved).toBe("new");
    expect(r.kakao).toBe("no-room");
    expect(r.room).toBe("");
    expect(r.message).toContain("저장만 됩니다");
    expect(posts("/outbox")).toHaveLength(0);
    expect((posts("/misu_visits")[0].body as Record<string, unknown>).room).toBe("");
  });

  it("지역이 비어도 저장만", async () => {
    const r = await saveMisuVisit(goodSecond({ region: "" }));
    expect(r.saved).toBe("new");
    expect(r.kakao).toBe("no-room");
    expect(posts("/outbox")).toHaveLength(0);
  });

  it("같은 id 재전송(409) = 이미 저장됨(성공). 앞서 카톡이 안 나갔으면 이번에 보낸다", async () => {
    insertStatus = 409;
    const r = await saveMisuVisit(goodSecond({ album_id: "album-old" }));
    expect(r.saved).toBe("dup");
    expect(r.kakao).toBe("queued");
    expect(r.message).toContain("이미 저장된 기록");
    expect(posts("/rpc/create_photo_album")).toHaveLength(0); // 앨범도 다시 만들지 않는다
  });

  it("409 + 카톡 이미 보냄 → 다시 안 보냄", async () => {
    insertStatus = 409;
    const r = await saveMisuVisit(goodSecond({ album_id: "album-old" }), { kakaoAlreadySent: true });
    expect(r.saved).toBe("dup");
    expect(r.kakao).toBe("already");
    expect(posts("/outbox")).toHaveLength(0);
  });

  it("카톡 전송 설정 꺼짐 → 저장만", async () => {
    cfg.FIELD_KAKAO_SEND_ENABLED = "false";
    const r = await saveMisuVisit(goodSecond());
    expect(r.saved).toBe("new");
    expect(r.kakao).toBe("disabled");
    expect(posts("/outbox")).toHaveLength(0);
  });

  it("테스트 모드 → 테스트방", async () => {
    cfg.TEST_MODE = "true";
    const r = await saveMisuVisit(goodSecond({ region: "E" }));
    expect(r.testMode).toBe(true);
    expect((posts("/outbox")[0].body as { room: string }).room).toBe("테스트 전용방");
  });

  it("카톡 큐 실패 → 저장은 성공, kakao=failed 로 알림", async () => {
    outboxStatus = 500;
    const r = await saveMisuVisit(goodSecond());
    expect(r.saved).toBe("new");
    expect(r.kakao).toBe("failed");
    expect(r.message).toContain("카톡 보내기 실패");
  });

  it("막음 항목이 있거나 사진이 덜 올라갔으면 아무것도 쓰지 않는다", async () => {
    const r1 = await saveMisuVisit(goodSecond({ judgment: "" }));
    expect(r1.saved).toBeNull();
    const r2 = await saveMisuVisit(goodSecond({ photos: [...ALL_PHOTOS.slice(1), { slot: "outside", url: "pending:outside" }] }));
    expect(r2.saved).toBeNull();
    expect(r2.error).toContain("올라가지 않았습니다");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("행 만들기·화면 보조", () => {
  it("buildMisuVisitRow: 아무도 없음이면 응대자 칸 비움, 반환 안 함이면 반환 칸 비움, pending 사진 제외", () => {
    const d = goodSecond({ no_contact: true, return_requested: false, photos: [{ slot: "door", url: "pending:door" }, ALL_PHOTOS[0]] });
    const row = buildMisuVisitRow(d, { missing: ["④ 사진 4장"], text: "t", room: "", albumId: "" });
    expect(row.contact_name).toBe("");
    expect(row.contact_is_rep).toBeNull();
    expect(row.return_to).toBe("");
    expect(row.photos).toEqual([{ slot: "outside", url: ALL_PHOTOS[0].url }]);
    expect(row.missing).toEqual(["④ 사진 4장"]);
  });

  it("misu 시트 행 → 후보(팀·잔액·개월·거래처코드·임순)", () => {
    const v = misuSheetRowToVendor({ id: 7, _업체명: "가나학원", _출처: "시트:수도권C_담당", 미수잔액: "₩2,140,050", 미수개월: "#N/A", "실제 개월수": "5", _raw: { 거래처코드: "2139567243", 임순: "3004" } });
    expect(v).toMatchObject({ key: "misu:7", name: "가나학원", team: "C", balance: "2140050", months: "5", companyCode: "2139567243", leaseSeq: "3004" });
    const opt = sheetVendorToOption(v!, [{ ...goodSecond({ visit_round: "1차 안내", company_code: "2139567243" }), created_at: "2026-10-02T01:00:00Z" } as MisuVisit]);
    expect(opt.months).toBe("5개월");
    expect(opt.balance).toBe("2,140,050원");
    expect(opt.visitCount).toBe(1);
    expect(opt.lastRound).toBe("1차 안내");
  });

  it("목록 좁히기: 검색어 없으면 내 팀만, CS체크 먼저, 검색어 있으면 전 팀", () => {
    const base = { key: "", companyCode: "", leaseSeq: "", balance: "" };
    const list = [
      { ...base, key: "1", name: "A상사", team: "A", months: "9", csChecked: false },
      { ...base, key: "2", name: "C학원", team: "C", months: "2", csChecked: true },
      { ...base, key: "3", name: "C마트", team: "C", months: "6", csChecked: false },
    ];
    expect(filterMisuVendors(list, "", "C").map((v) => v.key)).toEqual(["2", "3"]);
    expect(filterMisuVendors(list, "상사", "C").map((v) => v.key)).toEqual(["1"]);
    expect(filterMisuVendors(list, "", "팀장").map((v) => v.key)).toEqual(["2", "1", "3"]);
  });

  it("사진 칸 → photos: 검증용 임시 주소는 pendingOk 일 때만", () => {
    const slots = { outside: { url: "https://a/1.jpg", w: 1600, h: 1200, hasFile: true }, door: { hasFile: true } };
    expect(slotsToPhotos(slots, true)).toEqual([{ slot: "outside", url: "https://a/1.jpg", w: 1600, h: 1200 }, { slot: "door", url: "pending:door" }]);
    expect(slotsToPhotos(slots, false)).toHaveLength(1);
  });

  it("초안 봉투: 쓰고 읽기, 7일 지나면 버림, 빈 폼은 손댄 것 아님", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const d = goodSecond();
    expect(writeMisuDraft(storage, { v: 1, savedAt: 1_000, draft: d, vendor: null, slots: {}, kakaoSent: true, recorded: false })).toBe(true);
    expect(readMisuDraft(storage, 2_000)?.draft.id).toBe(d.id);
    expect(readMisuDraft(storage, 2_000)?.kakaoSent).toBe(true);
    expect(readMisuDraft(storage, 1_000 + 8 * 24 * 3600_000)).toBeNull();
    mem.set(MISU_DRAFT_KEY, "{broken");
    expect(readMisuDraft(storage, 2_000)).toBeNull();
    expect(isMisuDraftTouched(emptyMisuVisitDraft(), null, 0)).toBe(false);
    expect(isMisuDraftTouched(emptyMisuVisitDraft({ contact_name: "김" }), null, 0)).toBe(true);
  });

  it("차수 안내 문구", () => {
    expect(misuRoundHint(null, "ready")).toContain("1차 안내부터");
    expect(misuRoundHint({ round: "2차 경고", count: 1, lastRound: "1차 안내", lastVisitedAt: "2026-10-02T01:00:00Z", lastAuthor: "이민구" }, "ready")).toBe("지난 방문 1건 · 마지막 1차 안내(10-02 · 이민구)");
    expect(misuRoundHint(null, "error")).toContain("불러오지 못했습니다");
  });
});

describe("작성기 렌더 스모크", () => {
  it("서버 렌더로 깨지지 않고 작성기·보내기 단추가 나온다", () => {
    const html = renderToString(createElement(MisuVisitForm, { author: "이민구", setAuthor: () => {}, onToast: () => {} })).replace(/<!-- -->/g, "");
    expect(html).toContain("CS 방문이력 작성기");
    expect(html).toContain("저장하고 보내기");
    expect(html).toContain("미수 목록을 불러오는 중");
  });
});
