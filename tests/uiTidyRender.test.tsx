/**
 * UI 정돈 1차·카운터 문자·타부서 미니 업무공간 렌더 스모크(품질실, 2026-10-24).
 * 서버 렌더(renderToString) + fetch 막음 — 대표 props 로 그렸을 때 예외 없이 화면 머리 글자가 나오는지만 본다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DataLookup from "../src/DataLookup";
import { MisuBoard, OverageBoard } from "../src/MisuOverageBoards";
import OperationsDashboard from "../src/OperationsDashboard";
import TeamRanking from "../src/TeamRanking";
import ItLearningHistory from "../src/ItLearningHistory";
import CounterSms from "../src/CounterSms";
import DeptWorkspacePanel, { DeptRightTabs, DeptSheetLink } from "../src/DeptWorkspacePanel";
import StateBox from "../src/ui/StateBox";

const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");

describe("UI 정돈 화면 렌더 스모크", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const mem = new Map<string, string>();
    const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 };
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", { localStorage: ls, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, location: { href: "", search: "", hash: "" } });
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  const cases: Array<[string, () => Parameters<typeof renderToString>[0]]> = [
    ["DataLookup(조회 기본)", () => createElement(DataLookup, { author: "홍길동" })],
    ["MisuBoard", () => createElement(MisuBoard, {})],
    ["OverageBoard", () => createElement(OverageBoard)],
    ["OperationsDashboard", () => createElement(OperationsDashboard, { author: "홍길동" } as never)],
    ["TeamRanking", () => createElement(TeamRanking, { author: "홍길동" })],
    ["ItLearningHistory", () => createElement(ItLearningHistory, { author: "홍길동" })],
    ["CounterSms", () => createElement(CounterSms, { author: "홍길동" })],
    ["DeptWorkspacePanel(plan)", () => createElement(DeptWorkspacePanel, { dept: "영업팀", view: "plan", author: "홍길동" } as never)],
    ["DeptWorkspacePanel(board)", () => createElement(DeptWorkspacePanel, { dept: "경영지원", view: "board", author: "홍길동" } as never)],
    ["DeptRightTabs", () => createElement(DeptRightTabs, { value: "plan", onChange: () => {}, counts: { plan: 3, board: 2 } as never })],
    ["DeptSheetLink", () => createElement(DeptSheetLink, { dept: "영업팀" })],
  ];
  for (const [name, el] of cases) {
    it(`${name}: 예외 없이 그린다`, () => {
      const html = render(el());
      expect(html.length).toBeGreaterThan(20);
      expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
    });
  }

  it("StateBox 세 종류", () => {
    for (const kind of ["loading", "error", "empty"] as const) {
      const html = render(createElement(StateBox, { kind, message: "메시지", onRetry: () => {} } as never));
      expect(html).toContain("메시지");
    }
  });
});
