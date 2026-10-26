/**
 * 내 일정·팀 일정의 줄 순서(2026-10-27) — [고정] 단추 대신 끌어서 옮기기·▲▼.
 * 옮기면 지금 보이는 순서 전체가 "명시 순서"(plan_memos __order__:날짜)가 된다.
 * 화면(MyPlan.tsx)과 떨어진 순수 함수만 둔다 — tests/planOrder.test.ts.
 */

/** id 를 결과 목록의 toIndex 자리로 옮긴다(범위 밖은 끝으로 맞춤). 없는 id 면 그대로 복사본. */
export function moveId(list: readonly string[], id: string, toIndex: number): string[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  const rest = list.filter((_, i) => i !== from);
  const at = Math.max(0, Math.min(rest.length, Math.trunc(Number.isFinite(toIndex) ? toIndex : rest.length)));
  rest.splice(at, 0, id);
  return rest;
}

/**
 * 같은 묶음(팀 일정 = 같은 사람) 안에서만 옮긴다. 묶음 밖 자리로 가면 **같은 배열 참조**를 그대로 돌려준다
 * (호출부가 `=== list` 로 "막힘"을 안다). 묶음은 목록에서 이어져 있다고 본다(사람별로 묶어 그림).
 */
export function moveWithinGroup(list: readonly string[], groupOf: (id: string) => string, id: string, toIndex: number): readonly string[] {
  const from = list.indexOf(id);
  if (from < 0) return list;
  const g = groupOf(id);
  let first = from;
  let last = from;
  while (first > 0 && groupOf(list[first - 1]) === g) first--;
  while (last < list.length - 1 && groupOf(list[last + 1]) === g) last++;
  // id 를 뺀 목록에서 묶음은 [first, last-1] — 그 사이나 바로 뒤(last)에 넣어야 묶음이 안 갈라진다
  if (!Number.isFinite(toIndex) || toIndex < first || toIndex > last) return list;
  return moveId(list, id, toIndex);
}

/**
 * 명시 순서 + 새 id: 명시 순서(pinned)에 있는 것은 그 순서대로 앞에, 없는 것(새로 들어온 일정)은
 * 지금 순서(ordered, 화면은 최근접 이웃) 그대로 뒤에 붙인다. 중복 id 는 한 번만.
 */
export function explicitOrder(ordered: readonly string[], pinned: readonly string[]): string[] {
  const present = new Set(ordered);
  const head = Array.from(new Set(pinned.filter((id) => present.has(id))));
  const inHead = new Set(head);
  const tail = Array.from(new Set(ordered.filter((id) => !inHead.has(id))));
  return [...head, ...tail];
}

/**
 * 저장할 순서: 화면에서 정한 순서(visible) 뒤에, 화면에 안 보이던 기존 명시 순서(숨긴 사람·다른 보기)를
 * 그대로 남긴다 — 팀 일정에서 옮겼다고 내 일정의 다른 순서가 지워지지 않게.
 */
export function mergeVisibleOrder(visible: readonly string[], pinned: readonly string[]): string[] {
  const seen = new Set(visible);
  return Array.from(new Set([...visible, ...pinned.filter((id) => !seen.has(id))]));
}
