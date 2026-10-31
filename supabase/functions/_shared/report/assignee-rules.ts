// 2026-10-31: 본문은 src/reportAssignee.ts 에서 이사(엣지 schedule-report 가 같은 규칙으로 중간보고를 만든다). src 쪽은 다시 내보낸다.
/**
 * 중간보고 담당자 판정 — 배정 컬럼이 원본.
 * 네이버 수기 일정은 제목 머리에 이름을 적는 관행인데, 동기화가 이름을 vendor에서 떼고
 * calendarTitle에만 남기므로("2차 김정민 …"처럼 접두어 뒤일 수도 있다) 둘 다 본다.
 *
 * 컴포넌트 밖 순수 함수로 둔 이유: 정규식 이스케이프가 한 글자만 어긋나도 팀 보고가
 * 통째로 "없음"이 되는 사고가 실제로 있었다(\\s가 \s로 깎여 무력화).
 * tests/reportAssignee.test.ts가 실제 사고 케이스로 그걸 지킨다.
 */
import { parseAssignees } from "./assignees.ts";

export type AssigneeSource ={ assignee?: string; vendor: string; calendarTitle?: string };

/** 이름을 정규식에 끼울 때 특수문자를 무력화 — 명단은 자유 입력이라 "김광태(IT)" 같은 표기가 올 수 있다 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 배정 칸이 빈 수기 일정 — 제목 머리에서 명단 이름 1명을 추정 */
function matchFromTitle(ticket: AssigneeSource, order: string[]): string {
  return order.find((name) => new RegExp(`^\\s*${escapeRegExp(name)}\\s*[-–—:\\s]`).test(ticket.vendor))
    || order.find((name) => new RegExp(`(?:^|[\\s/·])${escapeRegExp(name)}(?=[\\s\\-–—:/]|$)`).test((ticket.calendarTitle || "").slice(0, 14)))
    || "";
}

/**
 * 제목 머리에서 떼어낼 이름표 — 배정 칸 원문 그대로("김A,이B"는 네이버 제목 머리 "김A,이B-"와 같은 글자).
 * 1명일 때 예전 matchReportAssignee 와 글자까지 같다(줄 만들기·구분 추출이 이 값을 쓴다).
 */
export function reportHeadOf(ticket: AssigneeSource, order: string[]): string {
  return ticket.assignee || matchFromTitle(ticket, order);
}

/**
 * 중간보고 담당자들 — 배정 칸이 있으면 그 목록(여러 명이면 각자 묶음에 한 줄씩, D3), 없으면 제목 추정 1명.
 * 빈 배열 = 미배정. 배정 칸이 공백뿐인 옛 값은 예전처럼 그 원문 1개로 둔다(미배정으로 바뀌지 않게).
 */
export function matchReportAssignees(ticket: AssigneeSource, order: string[]): string[] {
  if (ticket.assignee) {
    const names = parseAssignees(ticket.assignee);
    return names.length ? names : [ticket.assignee];
  }
  const one = matchFromTitle(ticket, order);
  return one ? [one] : [];
}

/** 호환 — 대표(첫 사람) 1명 */
export function matchReportAssignee(ticket: AssigneeSource, order: string[]): string {
  return matchReportAssignees(ticket, order)[0] || "";
}

/**
 * 금일 처리예정 묶음 — 명단 순서대로 사람별, 끝에 "미배정"(keepUnassigned 가 허락한 것만).
 * 명단 밖 사람만 걸린 건은 어느 묶음에도 넣지 않는다(물류 인원 몫 — 예전 규칙 그대로).
 * 2명 일정은 두 사람 묶음에 각각 들어간다. 두 보고 생성기(규칙 초안·AI 다듬기)가 이 하나를 같이 쓴다.
 */
export function groupReportTickets<T extends AssigneeSource>(
  tickets: T[], order: string[], keepUnassigned: (ticket: T) => boolean,
): Array<{ name: string; tickets: T[] }> {
  const namesOf = new Map<T, string[]>(tickets.map((t) => [t, matchReportAssignees(t, order)]));
  const groups: Array<{ name: string; tickets: T[] }> = [];
  for (const name of order) {
    const mine = tickets.filter((t) => namesOf.get(t)!.includes(name));
    if (mine.length) groups.push({ name, tickets: mine });
  }
  const unassigned = tickets.filter((t) => !namesOf.get(t)!.length && keepUnassigned(t));
  if (unassigned.length) groups.push({ name: "미배정", tickets: unassigned });
  return groups;
}

/** 명단 사람이 하나라도 걸렸나 — 익일일정에서 물류 건을 남길지 판단 */
export function hasReportMember(ticket: AssigneeSource, order: string[]): boolean {
  return matchReportAssignees(ticket, order).some((name) => order.includes(name));
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
    // 구분자: 탭·콜론 또는 스페이스 2개 이상 — 양식에 따라 "제목⇥값"도 "제목    값"도 있다.
    // 값은 라벨과 같은 줄에서만 찾는다(\s가 개행을 넘으면 빈 칸 다음 줄의 라벨이 값으로 잡힌다).
    const m = (note || "").match(new RegExp(`(?:^|\\n)[^\\S\\n]*"?${key}"?(?:[^\\S\\n]*[\\t:]+|[ ]{2,})[^\\S\\n]*([^\\t\\n"]+)`));
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
  if (assignee) head = head.replace(new RegExp(`^\\s*${escapeRegExp(assignee)}\\s*[-–—:\\s]*`), "");
  const first = head.split(/\s+/)[0] || "";
  return CATEGORY_WORDS.find((word) => first.startsWith(word)) || "";
}
