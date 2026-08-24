/**
 * 중간보고 담당자 판정 — 배정 컬럼이 원본.
 * 네이버 수기 일정은 제목 머리에 이름을 적는 관행인데, 동기화가 이름을 vendor에서 떼고
 * calendarTitle에만 남기므로("2차 김정민 …"처럼 접두어 뒤일 수도 있다) 둘 다 본다.
 *
 * 컴포넌트 밖 순수 함수로 둔 이유: 정규식 이스케이프가 한 글자만 어긋나도 팀 보고가
 * 통째로 "없음"이 되는 사고가 실제로 있었다(\\s가 \s로 깎여 무력화).
 * tests/reportAssignee.test.ts가 실제 사고 케이스로 그걸 지킨다.
 */
export type AssigneeSource = { assignee?: string; vendor: string; calendarTitle?: string };

export function matchReportAssignee(ticket: AssigneeSource, order: string[]): string {
  return ticket.assignee
    || order.find((name) => new RegExp(`^\\s*${name}\\s*[-–—:\\s]`).test(ticket.vendor))
    || order.find((name) => new RegExp(`(?:^|[\\s/·])${name}(?=[\\s\\-–—:/]|$)`).test((ticket.calendarTitle || "").slice(0, 14)))
    || "";
}
