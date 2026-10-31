/**
 * 담당자변경 시트 → contact_changes 넣기 전 내용 기반 중복 차단(순수 함수, vitest 가 같이 검사).
 *
 * 규칙 1 (2026-09-09): 업체+날짜+변경후 가 같으면 같은 건 — dupKey 는 공백 하나만 달라도 어긋나서 따로 둔다.
 * 규칙 2 (2026-10-31): 업체+구분+변경전+변경후+접수자 가 같은 행이 **날짜만 다르게** 이미 있으면 같은 건.
 *   실사고: 키맨체크 시트의 '청현세무회계컨설팅'(접수자 '프로') 행은 날짜 칸이 수식(오늘 날짜)이라
 *   매일 자정 날짜가 바뀌며 10/19~10/31 13건이 새 건으로 들어왔다(10/09 "날짜 빈칸" 수정은 이 경우를 못 막음).
 *   같은 업체의 같은 키맨 변경이 몇 달 안에 글자 하나 안 다르게 두 번 등록될 일은 없다고 본다.
 */
export type ContentRow = {
  company?: unknown; change_date?: unknown; after_text?: unknown;
  category?: unknown; before_text?: unknown; author?: unknown;
};

const squash = (v: unknown) => String(v ?? "").replace(/\s+/g, "");

/** 규칙 1 키 */
export const sameDayKey = (r: ContentRow) => [r.company, r.change_date, r.after_text].map(squash).join("|");
/** 규칙 2 키(날짜 없음) */
export const contentKey = (r: ContentRow) => [r.company, r.category, r.before_text, r.after_text, r.author].map(squash).join("|");

export type DedupeResult<T extends ContentRow> = { kept: T[]; removedSameDay: number; removedSameContent: number };

/** payload 중 existing(최근 N일 DB 행)과 겹치는 것을 뺀다. payload 안 서로 중복도 같은 규칙으로 하나만 남긴다. */
export function dedupePayload<T extends ContentRow>(payload: T[], existing: ContentRow[]): DedupeResult<T> {
  const day = new Set<string>();
  const content = new Set<string>();
  for (const r of existing) { day.add(sameDayKey(r)); content.add(contentKey(r)); }
  const kept: T[] = [];
  let removedSameDay = 0, removedSameContent = 0;
  for (const r of payload) {
    const d = sameDayKey(r), c = contentKey(r);
    if (day.has(d)) { removedSameDay += 1; continue; }
    if (content.has(c)) { removedSameContent += 1; continue; }
    day.add(d); content.add(c);
    kept.push(r);
  }
  return { kept, removedSameDay, removedSameContent };
}
