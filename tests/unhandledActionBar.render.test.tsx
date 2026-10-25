// 미처리 단추 줄 서버 렌더 — 출처별 단추(원격 보류 없음·일정 완료만)·홈 팝업에 단추 줄
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { UnhandledActionButtons, SheetRowLink } from "../src/UnhandledActionBar.view";
import { UnhandledDetail } from "../src/HomeUnhandledPanel";
import type { UnhandledRow } from "../src/homeUnhandled";

const noop = () => {};
const r: UnhandledRow = {
  key: "s:sales:12", source: "reception", kind: "영업팀", team: "영업", date: "2026-10-20", vendor: "가나상사", title: "해지문의", assignee: "", status: "보류", ageDays: 5,
  sheet: { source: "sales", row: 12, seq: "301", author: "김", vendor: "가나상사" },
};
const html = (row: UnhandledRow) =>
  renderToString(createElement(UnhandledActionButtons, { row, busy: "", onDone: noop, onHold: noop, onAssign: noop, onOpenSchedule: noop })).replace(/<!-- -->/g, "");

describe("UnhandledActionButtons", () => {
  it("영업 시트 줄: 완료·보류 풀기·미배정", () => {
    const h = html(r);
    for (const t of ['data-act="done"', "보류 풀기", "미배정"]) expect(h).toContain(t);
  });
  it("원격 줄은 보류 단추 없음", () => {
    const h = html({ ...r, key: "s:remote:9", kind: "원격이관", sheet: { source: "remote", row: 9, seq: "1", author: "", vendor: "가나상사" } });
    expect(h).not.toContain('data-act="hold"');
    expect(h).toContain('data-act="assign"');
  });
  it("CS접수 일정 줄 = 완료 + 일정리스트에서 열기", () => {
    const h = html({ ...r, key: "t:x", source: "ticket", kind: "CS접수", sheet: undefined });
    expect(h).toContain('data-act="done"');
    expect(h).toContain("일정리스트에서 열기");
    expect(h).not.toContain('data-act="assign"');
  });
  it("처리 중이면 잠금 + 처리 중…", () => {
    const h = renderToString(createElement(UnhandledActionButtons, { row: r, busy: "done", onDone: noop, onHold: noop, onAssign: noop }));
    expect(h).toContain("처리 중…");
    expect(h).toContain("disabled");
  });
  it("시트 링크 글자", () => {
    expect(renderToString(createElement(SheetRowLink, { row: r })).replace(/<!-- -->/g, "")).toContain("영업시트 12행");
  });
  it("홈 팝업 actions → 단추 줄 + 열기 보조", () => {
    const h = renderToString(createElement(UnhandledDetail, { row: r, onClose: noop, onOpen: noop, actions: true })).replace(/<!-- -->/g, "");
    expect(h).toContain('data-act="done"');
    expect(h).toContain("서비스접수에서 열기");
    expect(h).toContain("영업시트 12행");
  });
});
