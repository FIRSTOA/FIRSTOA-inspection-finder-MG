/**
 * 일정리스트 [완료] 때 "AS 양식을 쓸까요?" 물을 일정인가(2026-10-24 개선 목록 A6).
 * AS 건수(홈·팀 현황·순위표·조회)는 as_records 원본 기준이라 일정 [완료]만 누른 AS 는 잡히지 않는다 — 완료 직전에 한 번 묻는다.
 * 묻는 것: 아직 완료 전인 AS·익일AS 일정 중 FIELD 로 보낸 양식이 일정 내용에 없는 것.
 * 묻지 않는 것: 물류(납품철수교체휴가교육·물류)·점검(매월점검) 등 AS 가 아닌 일정, 휴가·연차, 이미 양식을 보낸 일정(App.tsx appendTicketNote 의 "[날짜 전송 양식]" 표시).
 * 테스트: tests/asFormPrompt.test.ts
 */
export type AsFormPromptTicket = { scheduleType: string; status: string; vendor: string; note?: string };

export const AS_FORM_PROMPT_TEXT = "AS 양식을 쓸까요?\n양식을 보내야 AS 건수에 잡힙니다.\n(일정 [완료]만 누르면 방문·시간에만 남습니다)";

export function shouldAskAsForm(t: AsFormPromptTicket): boolean {
  if (t.status === "완료") return false;
  if (t.scheduleType !== "AS" && t.scheduleType !== "익일AS") return false;
  if (/휴가|연차/.test(t.vendor || "")) return false;
  if (/\[\d{4}-\d{2}-\d{2} 전송 양식\]/.test(t.note || "")) return false;
  return true;
}
