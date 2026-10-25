/** 달성표 기간 이동 스테퍼(2026-10-26): cursor 없으면 옛 칩 그대로, 있으면 ◀ 라벨 ▶ · 마감 · 오늘로 · 지금 칩 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { KpiWidget, type KpiTableCursor, type KpiTableRow, type KpiView } from "../src/kpi/KpiWidgets.view";

const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");
const noop = () => {};
const row: KpiTableRow = {
  id: "a", name: "미처리지표", unit: "건", targetLabel: "", basis: "기준", pace: null, main: true, teamBars: [], people: [], cellState: "ready",
  status: "none", cells: [{ scope: "CS", value: 7, target: null, status: "none" }], nowChip: true,
};
const W = (cursor?: KpiTableCursor, nowChip = true) => render(createElement(KpiWidget, {
  kind: "kpiTable", title: "KPI 달성표", basis: "기준", status: "ready",
  view: { kind: "kpiTable", period: "week", view: "main", rows: [{ ...row, nowChip }], counts: { main: 1, all: 1 }, onPeriod: noop, onView: noop, cursor } as KpiView,
}));
const cur = (o: Partial<KpiTableCursor> = {}): KpiTableCursor => ({ label: "10월 1주차", ended: true, canPrev: true, canNext: true, onStep: noop, onToday: noop, ...o });

describe("KpiTable cursor", () => {
  it("cursor 없으면 옛 칩·제목 그대로, 스테퍼 없음", () => {
    const html = W(undefined, false);
    expect(html).toContain("이번 주");
    expect(html).toContain("KPI 달성표 · 이번 주");
    expect(html).not.toContain("이전 기간");
    expect(html).not.toContain("지금");
  });
  it("cursor 있으면 짧은 칩 + 스테퍼 + 마감 + 오늘로 + 지금 칩", () => {
    const html = W(cur({ loading: true }));
    expect(html).toContain("KPI 달성표 · 10월 1주차");
    expect(html).not.toContain("이번 주");
    expect(html).toContain("이전 기간");
    expect(html).toContain("마감");
    expect(html).toContain("읽는 중…");
    expect(html).toContain("오늘로");
    expect(html).toContain("지금");
  });
  it("이번 기간이면 ▶ 비활성, 오늘로·마감 없음", () => {
    const html = W(cur({ ended: false, canNext: false }));
    expect(html).not.toContain("오늘로");
    expect(html).not.toContain("마감");
    expect(html).toMatch(/aria-label="다음 기간"[^>]*disabled|disabled[^>]*aria-label="다음 기간"/);
  });
});
