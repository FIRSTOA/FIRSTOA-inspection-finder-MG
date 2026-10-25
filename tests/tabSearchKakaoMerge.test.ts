import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, invokeEdgeFunction: vi.fn() };
});

import { invokeEdgeFunction } from "../src/supabase";
import {
  collapseKakao, createKakaoCache, createKakaoDisabledMemo, dupKey80, KAKAO_CACHE_TTL_MS, kakaoQueryOf, kakaoToLine, mergeKakaoLines, searchKakaoForTab,
  type KakaoHit, type KakaoSearchResult, type TabLine,
} from "../src/tabSearch";
import type { Entity } from "../src/entity360";

const mocked = vi.mocked(invokeEdgeFunction);
afterEach(() => mocked.mockReset());

const field = (p: Partial<TabLine> & { key: string; table: string; date: string }): TabLine => ({
  kind: p.table, tone: "", title: "", detail: "", author: "", team: "", device: "", raw: "", loose: false,
  otherVendor: "", vendor: "무암", logiKind: "", ...p,
});
let nextId = 1;
const hit = (p: Partial<KakaoHit>): KakaoHit => ({
  id: nextId++, room: "강남C 점검방", sent_at: "2026-10-20T05:00:00+00:00", seq: 1, author: "퍼스트 김OO 프로",
  text: "무암 내일 10시 방문 예정입니다", kind_guess: "chat", is_bot: false, ...p,
});
const entity = { name: "주식회사 무암", nameKeys: ["무암"] } as unknown as Entity;

const FORM = "거래처명 : 무암\n매수 : 12345\n토너 : 검정 1\n담당자 : 010-1234-5678\n특이사항 : 없음 정상 출력 확인";
const FORM_MASKED = "거래처명 : 무암\n매수 : 12399\n토너 : 검정 1\n담당자 : 010-****-5678\n특이사항 : 없음 정상 출력 확인";

describe("mergeKakaoLines — FIELD 기록 + 카톡 한 목록", () => {
  it("카톡이 비면 FIELD 줄을 그대로 돌려준다", () => {
    const lines = [field({ key: "a", table: "jeomgeom", date: "2026-10-20" })];
    const r = mergeKakaoLines(lines, []);
    expect(r.lines).toBe(lines);
    expect(r.hidden).toEqual([]);
  });

  it("share(FIELD 링크)·media(사진 자리)는 항상 숨긴다 — FIELD 기록이 없어도", () => {
    const r = mergeKakaoLines([], [hit({ kind_guess: "share", text: "https://field 링크" }), hit({ kind_guess: "media", text: "사진" })]);
    expect(r.lines).toEqual([]);
    expect(r.hidden.map((l) => l.hideReason).sort()).toEqual(["media", "share"]);
  });

  it("양식 글: 숫자 뺀 앞 80자가 표 원문과 같으면 숨김(매수·가린 전화번호 차이 흡수)", () => {
    const lines = [field({ key: "j1", table: "jeomgeom", date: "2026-09-01", raw: FORM })];
    const r = mergeKakaoLines(lines, [hit({ kind_guess: "form:점검", sent_at: "2026-10-20T05:00:00Z", text: FORM_MASKED })]);
    expect(r.hidden).toHaveLength(1);
    expect(r.hidden[0].hideReason).toBe("same-text");
    expect(r.lines.map((l) => l.key)).toEqual(["j1"]);
  });

  it("양식 글: 글이 달라도 ±1일 안 같은 종류 정확 일치 기록이 있으면 숨김", () => {
    const lines = [field({ key: "as1", table: "as_records", date: "2026-10-21", raw: "다른 글" })];
    const r = mergeKakaoLines(lines, [hit({ kind_guess: "form:AS", sent_at: "2026-10-20T05:00:00Z", text: "증상 : 용지걸림\n처리내용 : 롤러 교체\n거래처 : 무암" })]);
    expect(r.hidden[0]?.hideReason).toBe("same-day");
  });

  it("양식 글: 날짜가 2일 떨어지면 남긴다", () => {
    const lines = [field({ key: "as1", table: "as_records", date: "2026-10-22", raw: "다른 글" })];
    const r = mergeKakaoLines(lines, [hit({ kind_guess: "form:AS", sent_at: "2026-10-20T05:00:00Z", text: "증상 : 용지걸림\n처리내용 : 롤러" })]);
    expect(r.hidden).toEqual([]);
    expect(r.lines.map((l) => l.source ?? "field")).toEqual(["field", "kakao"]); // source 없음 = FIELD
  });

  it("양식 글: 같은 날이어도 다른 종류 표면 남긴다", () => {
    const lines = [field({ key: "j1", table: "jeomgeom", date: "2026-10-20", raw: "다른 글" })];
    const r = mergeKakaoLines(lines, [hit({ kind_guess: "form:AS", text: "증상 : 용지걸림\n처리내용 : 롤러" })]);
    expect(r.hidden).toEqual([]);
  });

  it("양식 글: 같은 날 같은 종류라도 이름 일부 일치(loose) 기록으로는 숨기지 않는다", () => {
    const lines = [field({ key: "j1", table: "visit_logs", date: "2026-10-20", raw: "다른 글", loose: true })];
    const r = mergeKakaoLines(lines, [hit({ kind_guess: "form:점검", text: "매수 : 100\n토너 : 1\n거래처 : 무암" })]);
    expect(r.hidden).toEqual([]);
    expect(r.lines.find((l) => l.source === "kakao")?.kindGuess).toBe("form:점검");
  });

  it("form:점검 은 방문기록(visit_logs)으로도 같은 날 판정", () => {
    const lines = [field({ key: "v1", table: "visit_logs", date: "2026-10-19", raw: "방문" })];
    const r = mergeKakaoLines(lines, [hit({ kind_guess: "form:점검", text: "매수 : 100\n토너 : 1\n거래처 : 무암" })]);
    expect(r.hidden[0]?.hideReason).toBe("same-day");
  });

  it("chat 은 같은 날 같은 업체 양식이 있어도, 글이 같아도 절대 숨기지 않는다", () => {
    const lines = [field({ key: "j1", table: "jeomgeom", date: "2026-10-20", raw: "무암 내일 10시 방문 예정입니다" })];
    const r = mergeKakaoLines(lines, [hit({ kind_guess: "chat" }), hit({ kind_guess: null, text: "무암 토너 남았나요" })]);
    expect(r.hidden).toEqual([]);
    expect(r.lines.filter((l) => l.source === "kakao")).toHaveLength(2);
  });

  it("짧은 양식 글(정규화 10자 미만)은 글 비교로 숨기지 않는다", () => {
    const lines = [field({ key: "j1", table: "jeomgeom", date: "2026-01-01", raw: "점검 완료" })];
    const r = mergeKakaoLines(lines, [hit({ kind_guess: "form:점검", text: "점검 완료" })]);
    expect(r.hidden).toEqual([]);
  });

  it("순서: 날짜 내림차순, 같은 날이면 FIELD 먼저, 카톡끼리는 늦은 시각 먼저", () => {
    const lines = [
      field({ key: "f21", table: "jeomgeom", date: "2026-10-21" }),
      field({ key: "f20b", table: "jeomgeom", date: "2026-10-20" }),
      field({ key: "f20a", table: "as_records", date: "2026-10-20" }),
      field({ key: "nodate", table: "jeomgeom", date: "" }),
    ];
    const k1 = hit({ sent_at: "2026-10-20T01:00:00Z", text: "가" });
    const k2 = hit({ sent_at: "2026-10-20T08:00:00Z", text: "나" });
    const k3 = hit({ sent_at: "2026-10-22T08:00:00Z", text: "다" });
    const r = mergeKakaoLines(lines, [k1, k2, k3]);
    expect(r.lines.map((l) => l.key)).toEqual([`kakao:${k3.id}`, "f21", "f20b", "f20a", `kakao:${k2.id}`, `kakao:${k1.id}`, "nodate"]);
  });

  it("숨긴 수와 남긴 수가 들어온 수와 맞는다(접힌 것 제외)", () => {
    const lines = [field({ key: "j1", table: "jeomgeom", date: "2026-10-20", raw: FORM })];
    const rows = [hit({ kind_guess: "share" }), hit({ kind_guess: "form:점검", text: FORM }), hit({ kind_guess: "chat", text: "a" }), hit({ kind_guess: "chat", text: "b" })];
    const r = mergeKakaoLines(lines, rows);
    expect(r.hidden).toHaveLength(2);
    expect(r.lines.filter((l) => l.source === "kakao")).toHaveLength(2);
    expect(r.collapsed).toBe(0);
  });

  it("같은 방·같은 사람·같은 본문 ±2분 안은 한 줄로 접는다(3분이면 둘 다)", () => {
    const a = hit({ sent_at: "2026-10-20T05:00:00Z", text: "토너  주문 부탁" });
    const b = hit({ sent_at: "2026-10-20T05:01:30Z", text: "토너 주문 부탁" });
    const c = hit({ sent_at: "2026-10-20T05:05:00Z", text: "토너 주문 부탁" });
    expect(collapseKakao([b, a, c]).map((h) => h.id)).toEqual([a.id, c.id]);
    expect(mergeKakaoLines([], [a, b, c]).collapsed).toBe(1);
    expect(collapseKakao([a, { ...a }]).length).toBe(1); // 같은 id 한 번만
  });

  it("카톡 줄 모양: 키·KST 날짜·시각·첫 줄 제목·방·주민번호 가림·업체 키 없으면 loose", () => {
    const h = hit({ id: 77, sent_at: "2026-10-20T16:30:00Z", text: "\n무암 900101-1234567 확인\n둘째 줄", room: "강남C 점검방" });
    const l = kakaoToLine(h, entity);
    expect(l).toMatchObject({ key: "kakao:77", table: "kakao_messages", kind: "카톡", source: "kakao", date: "2026-10-21", time: "01:30", detail: "강남C 점검방", loose: false, kindGuess: "chat" });
    expect(l.title).toBe("무암 900101-1****** 확인");
    expect(kakaoToLine(hit({ text: "다른 업체 이야기" }), entity).loose).toBe(true);
    expect(kakaoToLine(hit({ text: "다른 업체 이야기" })).loose).toBe(false);
  });

  it("dupKey80 — 숫자·기호·공백 빼고 소문자 80자", () => {
    expect(dupKey80("SL-X7400 매수: 1,234 / 토너 *")).toBe("slx매수토너");
    expect(dupKey80("가".repeat(100))).toHaveLength(80);
  });
});

describe("kakaoQueryOf — 카톡 검색어", () => {
  it("법인 표기·괄호 메모·공백을 뺀 핵심 이름", () => {
    expect(kakaoQueryOf("(주)건영테크")).toBe("건영테크");
    expect(kakaoQueryOf("㈜ 건영 테크")).toBe("건영테크");
    expect(kakaoQueryOf("주식회사 무암 (Mooam)")).toBe("무암");
    expect(kakaoQueryOf("블루닷 유한회사")).toBe("블루닷");
    expect(kakaoQueryOf("ABC Korea")).toBe("abckorea");
  });
  it("2자 미만이면 null", () => {
    expect(kakaoQueryOf("㈜")).toBeNull();
    expect(kakaoQueryOf("주식회사 가")).toBeNull();
    expect(kakaoQueryOf("")).toBeNull();
  });
});

describe("꺼짐 기억 · 5분 캐시 · searchKakaoForTab", () => {
  const on = (rows: KakaoHit[] = []): KakaoSearchResult => ({ ok: true, enabled: true, rows, limit: 100, truncated: false });
  const off: KakaoSearchResult = { ok: true, enabled: false, rows: [], limit: 0, truncated: false };

  it("꺼짐 메모: enabled:false 한 번이면 꺼짐, 저장소에도 남고 새 메모가 읽는다", () => {
    const bag = new Map<string, string>();
    const store = { getItem: (k: string) => bag.get(k) ?? null, setItem: (k: string, v: string) => void bag.set(k, v), removeItem: (k: string) => void bag.delete(k) };
    const m = createKakaoDisabledMemo(store);
    m.note({ enabled: true });
    expect(m.isOff()).toBe(false);
    m.note({ enabled: false });
    expect(m.isOff()).toBe(true);
    expect(createKakaoDisabledMemo(store).isOff()).toBe(true);
    m.reset();
    expect(createKakaoDisabledMemo(store).isOff()).toBe(false);
    // 저장소가 막혀도 모듈 상태로 동작
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    const m2 = createKakaoDisabledMemo(broken);
    m2.note({ enabled: false });
    expect(m2.isOff()).toBe(true);
  });

  it("캐시: 키 = 탭+검색어, 5분 지나면 버린다", () => {
    const c = createKakaoCache();
    c.set("inspection", "무암", on(), 1_000);
    expect(c.get("inspection", "무암", 1_000 + KAKAO_CACHE_TTL_MS - 1)).not.toBeNull();
    expect(c.get("logistics", "무암", 1_000)).toBeNull();
    expect(c.get("inspection", "무암", 1_000 + KAKAO_CACHE_TTL_MS)).toBeNull();
    expect(c.size()).toBe(0);
  });

  it("캐시: 상한을 넘으면 오래된 것부터 버린다", () => {
    const c = createKakaoCache(KAKAO_CACHE_TTL_MS, 2);
    c.set("inspection", "a1", on(), 0);
    c.set("inspection", "b2", on(), 0);
    c.set("inspection", "c3", on(), 0);
    expect(c.get("inspection", "a1", 0)).toBeNull();
    expect(c.size()).toBe(2);
  });

  it("검색어 정규화해서 부르고, 같은 탭·검색어는 5분 안에 다시 부르지 않는다", async () => {
    const memo = createKakaoDisabledMemo(null);
    const cache = createKakaoCache();
    mocked.mockResolvedValueOnce(on([hit({})]));
    const a = await searchKakaoForTab("inspection", "(주)건영테크", { memo, cache, now: 0 });
    expect(mocked).toHaveBeenCalledWith("kakao-search", { q: "건영테크", kinds: ["점검", "AS"], limit: 100 }, 15_000);
    expect(a).toMatchObject({ status: "ok", q: "건영테크", cached: false });
    const b = await searchKakaoForTab("inspection", "㈜ 건영테크", { memo, cache, now: 60_000 });
    expect(b).toMatchObject({ status: "ok", cached: true });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("스위치 꺼짐: 처음 한 번만 부르고 그 뒤로는 부르지 않는다", async () => {
    const memo = createKakaoDisabledMemo(null);
    const cache = createKakaoCache();
    mocked.mockResolvedValueOnce(off);
    expect(await searchKakaoForTab("inspection", "무암", { memo, cache })).toEqual({ status: "off" });
    expect(await searchKakaoForTab("logistics", "건영테크", { memo, cache })).toEqual({ status: "off" });
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(0);
  });

  it("방 없는 탭·짧은 검색어는 부르지 않고(none), 실패는 throw 하고 캐시에 넣지 않는다", async () => {
    const memo = createKakaoDisabledMemo(null);
    const cache = createKakaoCache();
    expect(await searchKakaoForTab("it", "무암", { memo, cache })).toEqual({ status: "none" });
    expect(await searchKakaoForTab("inspection", "㈜", { memo, cache })).toEqual({ status: "none" });
    expect(mocked).not.toHaveBeenCalled();
    mocked.mockResolvedValueOnce({ ok: false, error: "검색이 너무 잦습니다" });
    await expect(searchKakaoForTab("inspection", "무암", { memo, cache })).rejects.toThrow("검색이 너무 잦습니다");
    expect(cache.size()).toBe(0);
    expect(memo.isOff()).toBe(false);
  });
});
