/**
 * 품질실 검수아 렌더 스모크(2026-10-24 커밋 전 검사) — TabSearch 결과 줄·OKR 위젯(2x1/1x1 × teams 있음/없음)·IT 학습·InboxHub·MemberAdmin·AdminHub·SystemAdmin 칩 6개.
 * 일부 화면이 import 시점에 window 를 읽어서 vi.hoisted 로 먼저 깐다. MyPlan 은 leaflet(document 필요) 때문에 서버 렌더 불가 — 여기서 뺐다.
 */
vi.hoisted(() => {
  const mem = new Map<string, string>();
  const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 };
  (globalThis as Record<string, unknown>).localStorage = ls;
  (globalThis as Record<string, unknown>).window = { localStorage: ls, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, location: { href: "", search: "", hash: "" } };
});
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { TabSearchResults } from "../src/TabSearch.view";
import { TAB_SPECS, type TabLine } from "../src/tabSearch";
import InboxHub from "../src/InboxHub";
import ItLearningHistory from "../src/ItLearningHistory";
import MemberAdmin from "../src/MemberAdmin";
import SystemAdmin from "../src/SystemAdmin";
import AdminHub from "../src/AdminHub";
import { SYSTEM_VIEWS } from "../src/adminViews";
import { KpiWidget } from "../src/kpi/KpiWidgets.view";

const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");
const noop = () => {};
const bad = /undefined|NaN|\[object Object\]/;
describe("QA 스모크", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const mem = new Map<string, string>();
    const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 };
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", { localStorage: ls, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, location: { href: "", search: "", hash: "" } });
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  it("TabSearch 결과 줄(펼침 단추)", () => {
    const line: TabLine = { key: "1", table: "as_records", kind: "AS", tone: "blue", date: "2026-10-20", title: "용지걸림 처리", detail: "롤러 교체", author: "홍길동", team: "A", device: "C3060 · ABC", raw: "원문", loose: false, otherVendor: "", vendor: "가나상사", logiKind: "" };
    const spec = Object.values(TAB_SPECS)[0];
    const html = render(createElement(TabSearchResults, { spec, title: "가나상사", runState: "done", error: "", onRun: noop, lines: [line, { ...line, key: "2" }], all: [line, { ...line, key: "2" }], hidden: [], chip: "all", onChip: noop, summary: "2건", coverage: { searched: ["AS"], failed: [], missing: [], rawSkipped: [] }, resultKey: "k", kakao: "off", onKakaoRetry: noop }));
    expect(html).toContain("용지걸림 처리");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(bad);
  });
  const okrBase = { kind: "okr" as const, period: "week" as const, onPeriod: noop, pct: 60, counts: [{ label: "완료", value: 3, tone: "ok" }], weeks: [1, 2, 3].map((n) => ({ label: `${n}주차`, pct: 50, current: n === 3 })), missingTeams: ["C"] };
  for (const size of ["2x1", "1x1"] as const) for (const teams of [undefined, [{ team: "A", pct: 50 }, { team: "B", pct: null }]]) {
    it(`OKR ${size} teams=${teams ? "있음" : "없음"}`, () => {
      const html = render(createElement(KpiWidget, { kind: "okr", title: "OKR", basis: "b", status: "ready", size, view: { ...okrBase, teams } as never }));
      expect(html).toContain("60");
      expect(html).not.toMatch(bad);
    });
  }
  const cases: Array<[string, () => Parameters<typeof renderToString>[0]]> = [
    ["InboxHub", () => createElement(InboxHub, { author: "홍길동" })],
    ["ItLearningHistory", () => createElement(ItLearningHistory, { author: "홍길동" })],
    ["MemberAdmin", () => createElement(MemberAdmin)],
    ["AdminHub", () => createElement(AdminHub, { author: "홍길동" })],
    ...SYSTEM_VIEWS.map(([v, label]) => [`SystemAdmin ${label}`, () => createElement(SystemAdmin, { view: v })] as [string, () => Parameters<typeof renderToString>[0]]),
  ];
  for (const [name, el] of cases) it(`${name} 렌더`, () => { const html = render(el()); expect(html.length).toBeGreaterThan(20); expect(html).not.toMatch(bad); });
});
