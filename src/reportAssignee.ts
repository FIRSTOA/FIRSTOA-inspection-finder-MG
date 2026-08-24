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

/**
 * 접수내용 찾기 — issue 칸이 비면 note의 접수양식에서 뽑는다.
 * 임대리스트 양식은 "제목⇥ 용지 씹힘" 꼴로 수십 줄 아래에 있고, FIELD 양식은 "내용: …" 꼴.
 * ("분기마감·매월마감"은 계약 구분 표기지 방문 내용이 아니다 — 내용은 반드시 이 칸들에서 찾는다)
 */
export function extractIssue(issue: string | undefined, note: string | undefined): string {
  const direct = (issue || "").split(/\n/)[0].replace(/\(마지막[^)]*\)/g, "").trim();
  if (direct) return direct;
  for (const key of ["접수내용", "내용", "제목", "상태"]) {
    // 구분자: 탭·콜론 또는 스페이스 2개 이상 — 양식에 따라 "제목⇥값"도 "제목    값"도 있다
    const m = (note || "").match(new RegExp(`(?:^|\\n)\\s*"?${key}"?(?:\\s*[\\t:]+|[ ]{2,})\\s*([^\\t\\n"]+)`));
    const val = (m?.[1] || "").trim();
    // 칸이 비면 다음 칸 이름("상태" 등)이 값으로 잡힌다 — 필드명 자체는 값이 아니다
    if (val && !/^[-–—.]*$/.test(val) && !/^(접수내용|내용|제목|상태|참고사항|기기상태)$/.test(val)) return val;
  }
  return "";
}

/**
 * 접수 구분 추출 — 제목 머리 낱말이 방문 목적 자체인 경우(미수방문·여분요청 등).
 * 이게 빠지면 줄이 오해를 부른다: "이지스 3280 8월 부재중"은 AS처럼 읽히지만 실제론 미수 수금 방문.
 * A/S·점검요청은 기본 업무라 뽑지 않는다(증상이 내용을 대신한다).
 */
const CATEGORY_WORDS = ["미수방문", "여분요청", "토너납품", "CMS작성", "셋팅요청", "기기교체"];

export function extractCategory(vendor: string, title: string | undefined, assignee: string): string {
  let head = ((title || "").trim() || vendor || "").trim();
  if (assignee) head = head.replace(new RegExp(`^\\s*${assignee}\\s*[-–—:\\s]*`), "");
  const first = head.split(/\s+/)[0] || "";
  return CATEGORY_WORDS.find((word) => first.startsWith(word)) || "";
}
