/**
 * 부서 [일정리스트]·[달력] 서버 렌더(2026-10-28 사용자 추가 요청).
 * 지키는 것: 완료 건 기본 접힘("완료 n건 ▾"), 오늘 완료 앱 접수 카드는 누를 수 있는 단추(상세 펼침), "시트 접수는 금일로만" 안내 없음,
 * 달력 시트 칩·점은 앱 일정과 같은 색(열림 = 부서색 채움, 완료 = 회색 취소선) — 속 빈 흰 점·흰 칩 없음.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DeptPlanList, { DonePlanCard } from "../src/DeptPlanList.view";
import DeptCalendarPanel from "../src/DeptCalendarPanel";
import { deptPlanBuckets } from "../src/deptPlan";
import { deptMonthGrid } from "../src/deptCalendarView";
import { RECEPTION_TYPE_META } from "../src/ReceptionTypePicker";
import type { OpenReceptionRow } from "../src/deptReceptionApi";
import type { SheetListRow } from "../src/receptionSheetOpen";

const TODAY = "2026-10-28";
const noop = () => undefined;
const sheet = (over: Partial<SheetListRow> = {}): SheetListRow => ({
  source: "mgmt", kind: "경영지원", sheetRow: 100, seq: "10", date: TODAY, author: "이찬우", handler: "", state: "", cls: "open",
  vendor: "우리하나", field: "계약서요청", region: "", summary: "", month: "2026-10", ...over,
});
const done = { id: "t", type: "경영지원", status: "완료", receipt_date: TODAY, vendor: "테스트", remote_meta: { handler: "이윤아" } } as unknown as OpenReceptionRow;

describe("DeptPlanList — 완료 카드 상세·안내 문구", () => {
  const buckets = deptPlanBuckets("경영지원", [], [], TODAY, { sheet: [sheet(), sheet({ seq: "11", date: "2026-10-29", vendor: "내일업체" })], done: [done] });
  const props = { buckets, onActive: noop, renderActions: () => null, onAssign: noop, onOpenEvent: noop, renderSheet: (it: { sheet: SheetListRow }) => createElement("div", null, `SHEET:${it.sheet.vendor}`) };
  it("완료 건은 기본 접힘 — 열린 건 아래 '완료 n건 ▾' 한 줄, 완료 카드 본문은 안 그림", () => {
    const html = renderToString(createElement(DeptPlanList, { ...props, active: "today" }));
    expect(html).toContain("SHEET:우리하나");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[\s\S]*완료 <!-- -->1<!-- -->건 <!-- -->▾/);
    expect(html).not.toContain(">테스트<");
  });
  it("완료 앱 접수 카드 = 펼침 단추, 펼치면 상세, renderDetail 없으면 disabled", () => {
    const closed = renderToString(createElement(DonePlanCard, { row: done, open: false, onToggle: noop, renderDetail: () => createElement("div", null, "DETAIL") }));
    expect(closed).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[\s\S]*테스트/);
    expect(closed).not.toContain("DETAIL");
    const opened = renderToString(createElement(DonePlanCard, { row: done, open: true, onToggle: noop, renderDetail: () => createElement("div", null, "DETAIL") }));
    expect(opened).toContain("DETAIL");
    const off = renderToString(createElement(DonePlanCard, { row: done, open: true, onToggle: noop }));
    expect(off).toMatch(/<button[^>]*disabled=""/);
    expect(off).not.toContain("DETAIL");
  });
  it("[익일]에 내일 접수 시트 줄, '금일로만' 안내 없음", () => {
    const html = renderToString(createElement(DeptPlanList, { ...props, active: "next" }));
    expect(html).toContain("SHEET:내일업체");
    expect(html).not.toContain("금일)로만");
  });
});

describe("DeptCalendarPanel — 시트 칩·점 색 = 앱 일정 색", () => {
  const days = deptMonthGrid("2026-10-01");
  const html = renderToString(createElement(DeptCalendarPanel, {
    team: "경영지원", month: "2026-10-01", days, today: TODAY, mode: "calendar", compact: true, reloadTick: 0,
    sheetRows: [sheet(), sheet({ seq: "12", cls: "done", vendor: "끝난업체" })],
  }));
  const meta = RECEPTION_TYPE_META["경영지원"];
  it("점: 열림 = 부서색 채움, 완료 = 회색 채움, 테두리만 점 없음", () => {
    expect(html).toContain(`h-1.5 w-1.5 rounded-full ${meta.bar}`);
    expect(html).toContain("h-1.5 w-1.5 rounded-full bg-slate-300");
    expect(html).not.toContain("rounded-full border border-slate-500");
  });
  it("고른 날(오늘) 목록: 열린 칩 = 흰 바탕(2026-10-29 분홍 → 흰색), 완료 = 연회색 취소선이고 열린 것보다 아래, '시트' 글자 있음", () => {
    expect(html).toContain("border border-slate-200 bg-white text-slate-800");
    expect(html).toMatch(/bg-slate-50 text-slate-400 line-through[\s\S]*끝난업체/);
    // 같은 날 칸·목록 모두: 열린 업체가 끝난 업체보다 먼저(완료는 아래로 모음)
    const openAt = [...html.matchAll(/우리하나/g)].map((m) => m.index ?? 0);
    const doneAt = [...html.matchAll(/끝난업체/g)].map((m) => m.index ?? 0);
    expect(openAt.length).toBeGreaterThan(0);
    expect(doneAt.length).toBe(openAt.length);
    openAt.forEach((o, i) => expect(o).toBeLessThan(doneAt[i]));
    expect(html).toContain("시트");
  });
});
