/**
 * 담당자 목록 규칙 — 웹앱(src/assignees.ts 가 다시 내보냄)과 엣지 함수(schedule-report)가 같은 규칙을 쓴다(2026-10-31 이사).
 * Deno·Vite 둘 다 읽으므로 외부 import 없이 순수 함수만 둔다.
 */
/**
 * 일정 담당자 여러 명 — as_tickets.assignee 한 칸에 쉼표 목록("김A,이B")으로 저장한다(2026-10-22, SQL 없음).
 * 규칙: 쉼표 구분·공백 없음·선택 순서 유지·첫 사람 = 대표·중복 제거. 1명이면 예전 값과 글자 하나 다르지 않다.
 * 읽을 때는 손으로 고친 값도 받도록 쉼표·전각 쉼표·슬래시·가운뎃점·앞뒤 공백을 모두 구분자로 본다.
 * 설계: docs/tasks/schedule-multi-assignee.md
 */

/** 인원 제한 없음(2026-10-26 사용자 지시, 예전 3명) — 제목 머리는 titleAssigneePrefix 가 줄인다 */
export const MAX_ASSIGNEES = 99;

const SEPARATORS = /[,，/·・]/;

/** 저장값 → 이름 배열(trim·빈칸 제거·중복 제거, 순서 유지) */
export function parseAssignees(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of String(value ?? "").split(SEPARATORS)) {
    const name = part.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 이름 배열 → 저장값("김A,이B"). 중복만 제거(max 기본 = 제한 없음) */
export function joinAssignees(names: string[], max: number = MAX_ASSIGNEES): string {
  const out: string[] = [];
  for (const raw of names) {
    for (const name of parseAssignees(raw)) if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, Math.max(0, max)).join(",");
}

/** 이 사람이 담당자 목록에 있나 — 정확 일치("이수"와 "이수진"은 다른 사람) */
export function hasAssignee(value: string | null | undefined, name: string | null | undefined): boolean {
  const who = String(name ?? "").trim();
  if (!who) return false;
  return parseAssignees(value).includes(who);
}

/** 화면 표시 — "김A·이B", short 면 좁은 칸용 "김A 외 1". 비면 빈 문자열 */
export function formatAssignees(value: string | null | undefined, opts: { short?: boolean } = {}): string {
  const names = parseAssignees(value);
  if (names.length <= 1) return names[0] || "";
  return opts.short ? `${names[0]} 외 ${names.length - 1}` : names.join("·");
}

/** 네이버·카톡 제목 머리용 이름 — 3명까지는 저장값 그대로("김A,이B,박C"), 4명 이상은 "김A 외 3명". 저장값은 건드리지 않는다 */
export function titleAssigneeLabel(value: string | null | undefined): string {
  const names = parseAssignees(value);
  if (names.length <= 3) return String(value ?? "").trim();
  return `${names[0]} 외 ${names.length - 1}명`;
}

/** 대표(첫 사람) — 지도 핀 색·정렬처럼 한 사람만 고를 때 */
export function primaryAssignee(value: string | null | undefined): string {
  return parseAssignees(value)[0] || "";
}

/** 새로 추가된 사람만 — 배정 푸시 대상(이미 있던 사람에게 다시 보내지 않는다) */
export function addedAssignees(before: string | null | undefined, after: string | null | undefined): string[] {
  const prev = parseAssignees(before);
  return parseAssignees(after).filter((name) => !prev.includes(name));
}
