// 홈 미처리 줄 → 상세 팝업(2026-10-25 사용자 "탭 이동 말고 상세 팝업"). DOM 없이: 줄 단추 onClick 을 직접 부르고, 팝업은 서버 렌더로 확인
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { UnhandledDetail, UnhandledRowButton } from "../src/HomeUnhandledPanel";
import type { UnhandledRow } from "../src/homeUnhandled";

const row: UnhandledRow = {
  key: "r:9", source: "reception", kind: "원격이관", team: "C", date: "2026-10-20", vendor: "가나상사",
  title: "용지 걸림 <b>반복</b>\n2층 복합기", assignee: "한왕주", status: "접수", ageDays: 5, receptionId: "9",
};

describe("미처리 상세 팝업", () => {
  it("줄을 누르면 onPick(그 행)만 — 화면 이동 콜백은 단추에 없다", () => {
    const onPick = vi.fn();
    const el = UnhandledRowButton({ row, onPick, children: "x" }) as ReactElement<{ onClick: () => void }>;
    el.props.onClick();
    expect(onPick).toHaveBeenCalledWith(row);
  });

  it("팝업 내용 = 그 행 값(업체·종류·팀·접수일·경과·담당자·상태·내용 평문)", () => {
    const onOpen = vi.fn();
    const html = renderToString(createElement(UnhandledDetail, { row, onClose: () => {}, onOpen })).replace(/<!-- -->/g, "");
    for (const t of ["가나상사", "원격", ">C<", "2026-10-20", "5일 지남", "한왕주", "접수", "서비스접수에서 열기", "닫기"]) expect(html).toContain(t);
    expect(html).toContain("&lt;b&gt;반복&lt;/b&gt;"); // HTML 해석 안 함(XSS)
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("물류는 열기 단추 없음(onOpen 없음)", () => {
    const html = renderToString(createElement(UnhandledDetail, { row: { ...row, kind: "물류", source: "ticket" }, onClose: () => {} }));
    expect(html).not.toContain("에서 열기");
    expect(html).toContain("네이버 캘린더");
  });
});
