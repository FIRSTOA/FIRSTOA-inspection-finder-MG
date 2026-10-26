// 전송 뒤 일정 고르기 창 — 후보마다 날짜·종류·담당·업체가 보이고 [해당 없음]이 있다(2026-10-27)
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { TicketPickSheet } from "../src/field/ticketMatchOffer";
import { pickTicketsForSentForm } from "../src/field/ticketMatch";

describe("TicketPickSheet render", () => {
  const { candidates } = pickTicketsForSentForm([
    { id: "a", vendor: "레이어스튜디오-분기마감", date: "2026-10-26", status: "접수", scheduleType: "AS", assignee: "이민구" },
    { id: "b", vendor: "레이어스튜디오", date: "2026-10-22", status: "익일", scheduleType: "익일AS", assignee: "" },
  ], { vendor: "레이어스튜디오", kind: "as", today: "2026-10-26", author: "이민구" });
  const html = renderToString(createElement(TicketPickSheet, { candidates, onDone: () => {} }));
  it("후보 2줄과 해당 없음", () => {
    expect(html).toContain("10/26(오늘)");
    expect(html).toContain("10/22(지난 미완료)");
    expect(html).toContain("익일AS");
    expect(html).toContain("담당 이민구(나)");
    expect(html).toContain("해당 없음");
  });
});
