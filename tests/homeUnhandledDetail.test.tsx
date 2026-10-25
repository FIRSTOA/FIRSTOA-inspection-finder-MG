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

  it("일정 행: 정보 표(제목·시각·주소) + 메모 전체(줄바꿈) + 네이버 캘린더 열기 링크", () => {
    const note = `상호 : 튜링\n${"메".repeat(3000)}`;
    const html = renderToString(createElement(UnhandledDetail, {
      row: { ...row, key: "t:1", source: "ticket", kind: "CS접수", fields: [{ label: "제목", value: "강남C 토너" }, { label: "시각", value: "15:00" }], detail: note, contentLabel: "메모" },
      onClose: () => {},
    })).replace(/<!-- -->/g, "");
    for (const t of ["제목", "강남C 토너", "15:00", "메모", "네이버 캘린더 열기", "https://calendar.naver.com/"]) expect(html).toContain(t);
    expect(html).toContain(note); // 자르지 않음
  });

  it("시트 행은 열 때 전체를 읽는 중 안내(서버 렌더 = 첫 화면)", () => {
    const html = renderToString(createElement(UnhandledDetail, {
      row: { ...row, key: "s:sales:7", sheet: { source: "sales", row: 7, seq: "1", author: "", vendor: "" } }, onClose: () => {},
    }));
    expect(html).toContain("시트에서 그 행 전체를 읽는 중");
  });

  it("물류는 열기 단추 없음(onOpen 없음)", () => {
    const html = renderToString(createElement(UnhandledDetail, { row: { ...row, kind: "물류", source: "ticket" }, onClose: () => {} }));
    expect(html).not.toContain("에서 열기");
    expect(html).toContain("네이버 캘린더");
  });
});
