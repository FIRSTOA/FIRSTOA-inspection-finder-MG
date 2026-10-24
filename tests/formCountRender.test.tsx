vi.hoisted(() => {
  const mem = new Map<string, string>();
  const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 };
  (globalThis as Record<string, unknown>).localStorage = ls;
  (globalThis as Record<string, unknown>).window = { localStorage: ls, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, location: { href: "", search: "", hash: "" } };
});
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DataLookup from "../src/DataLookup";
import OperationsDashboard from "../src/OperationsDashboard";
import TeamRanking from "../src/TeamRanking";
import UnifiedHistory from "../src/UnifiedHistory";

const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");
const bad = /undefined|NaN|\[object Object\]/;
const noop = () => {};
describe("QA 임시 스모크", () => {
  beforeAll(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 }))); });
  afterAll(() => { vi.unstubAllGlobals(); });
  it("OperationsDashboard", () => { const h = render(createElement(OperationsDashboard, { author: "홍길동" } as never)); expect(h).toContain("물류·재계약·불만·초과조정·미수 기준"); expect(h).not.toMatch(bad); });
  it("TeamRanking", () => { const h = render(createElement(TeamRanking, { author: "홍길동" })); expect(h).toContain("원본 표 기준"); expect(h).not.toMatch(bad); });
  for (const key of ["recontract", "bulman", "logistics", "overage_adjust"]) {
    it(`DataLookup ${key}`, () => {
      (globalThis as any).window.localStorage.setItem("cs_lookup_category_v1", key);
      const h = render(createElement(DataLookup, { author: "홍길동" }));
      expect(h.length).toBeGreaterThan(100); expect(h).not.toMatch(bad);
      expect(h).toContain("홈·주간현황판 팀 현황·순위표와 같은 숫자");
    });
  }
  it("UnifiedHistory open", () => { const h = render(createElement(UnifiedHistory, { vendor: "가나상사", accent: "blue", open: true, onClose: noop, onError: noop, author: "홍길동" })); expect(h.length).toBeGreaterThan(50); expect(h).not.toMatch(bad); });
});
