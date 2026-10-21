/**
 * 재계약 다음확인일 날짜 칸 — 카톡 줄은 "2026-10-29(목)", 표 값은 YYYY-MM-DD 원값. 불만은 글자 칸 그대로(D8).
 * + api.sendCategoryForm 이 저장·방 큐 뒤에 성공 신호(field:category-sent)를 내고 제안을 기기에 남기는지(fetch 모킹).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatText, CATEGORY_SCHEMAS, emptyCatForm } from "../src/categoryForms";
import { invalidateConfigCaches } from "../src/supabase";
import { CATEGORY_SENT_EVENT, type CategorySentDetail } from "../src/categorySentEvent";
import { SCHEDULE_OFFER_KEY } from "../src/recontractSchedule";
import { sendCategoryForm } from "../src/api";

const fieldOf = (schema: string, key: string) => CATEGORY_SCHEMAS[schema].sections.flatMap((s) => s.fields).find((f) => f.key === key);

describe("날짜 칸 스키마·카톡 표기", () => {
  it("재계약 다음확인일만 date, 불만은 text", () => {
    expect(fieldOf("recontract", "다음확인일")?.type).toBe("date");
    expect(fieldOf("bulman", "다음확인일")?.type).toBe("text");
    expect(emptyCatForm("recontract")).toHaveProperty("다음확인일", "");
  });
  it("재계약: 날짜면 요일 붙임, 글자값·빈 값은 그대로", () => {
    const form = { ...emptyCatForm("recontract"), 업체명: "보림토건", 다음확인일: "2026-10-29" };
    expect(buildCatText("recontract", form, "이민구")).toContain("다음 확인일: 2026-10-29(목)");
    expect(buildCatText("recontract", { ...form, 다음확인일: "차주 중" }, "이민구")).toContain("다음 확인일: 차주 중");
    expect(buildCatText("recontract", { ...form, 다음확인일: "" }, "이민구")).toMatch(/다음 확인일: $/m);
  });
  it("불만: 날짜 모양 값도 그대로(요일 안 붙임)", () => {
    const form = { ...emptyCatForm("bulman"), 다음확인일: "2026-10-29" };
    const text = buildCatText("bulman", form, "a");
    expect(text).toContain("다음 확인일: 2026-10-29");
    expect(text).not.toContain("2026-10-29(목)");
  });
});

describe("sendCategoryForm 성공 신호", () => {
  type Call = { url: string; method: string; body: unknown };
  let calls: Call[] = [];
  let received: CategorySentDetail[] = [];
  let store: Map<string, string>;
  let insertStatus = 201;

  beforeEach(() => {
    invalidateConfigCaches();
    calls = []; received = []; insertStatus = 201;
    store = new Map();
    const et = new EventTarget();
    vi.stubGlobal("window", Object.assign(et, { setTimeout, clearTimeout }));
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    et.addEventListener(CATEGORY_SENT_EVENT, (e) => received.push((e as CustomEvent<CategorySentDetail>).detail));
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/app_config")) return json([{ key: "TEST_MODE", value: "true" }, { key: "TEST_ROOM", value: "테스트 전용방" }]);
      if (url.includes("/room_map")) return json([]);
      if (url.includes("/recontract") && method === "POST") return new Response("", { status: insertStatus });
      if (url.includes("/outbox") && method === "POST") return new Response("", { status: 201 });
      return json([]);
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const form = { ...emptyCatForm("recontract"), 지역: "C", 업체명: "보림토건", 다음확인일: "2026-10-29" };

  it("저장 성공 → 신호 1번(재계약·dupKey·testMode) + 제안 보관, 표 값은 YYYY-MM-DD", async () => {
    const text = buildCatText("recontract", form, "이민구");
    const res = await sendCategoryForm("recontract", form, "이민구", text, "2026-10-22T03:00:00Z");
    expect(res.ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ schemaKey: "recontract", author: "이민구", testMode: true });
    expect(received[0].dupKey).toMatch(/^[0-9a-f]{32}$/);
    const inserted = calls.find((c) => c.method === "POST" && c.url.includes("/recontract"))!.body as Record<string, unknown>;
    expect(inserted["다음확인일"]).toBe("2026-10-29");
    expect(inserted["_dupKey"]).toBe(received[0].dupKey);
    expect(JSON.parse(store.get(SCHEDULE_OFFER_KEY) || "{}")).toMatchObject({ dupKey: received[0].dupKey });
  });
  it("저장 실패 → 신호 없음·제안 없음", async () => {
    insertStatus = 500;
    const res = await sendCategoryForm("recontract", form, "이민구", "t", "2026-10-22T03:00:00Z");
    expect(res.ok).toBe(false);
    expect(received).toHaveLength(0);
    expect(store.has(SCHEDULE_OFFER_KEY)).toBe(false);
  });
  it("초과조정: 신호는 가지만 제안은 남기지 않음(재계약만 묻는다)", async () => {
    const f = { ...emptyCatForm("overage-adjust"), 업체명: "보림토건", 지역: "C" };
    const res = await sendCategoryForm("overage-adjust", f, "이민구", "t", "2026-10-22T03:00:00Z");
    expect(res.ok).toBe(true);
    expect(received.map((d) => d.schemaKey)).toEqual(["overage-adjust"]);
    expect(store.has(SCHEDULE_OFFER_KEY)).toBe(false);
  });
});
