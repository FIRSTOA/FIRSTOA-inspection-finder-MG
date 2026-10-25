// RichCell 편집 중 Ctrl+Z / Ctrl+Y 를 칸이 직접 맡는 되돌리기 기록(2026-10-25 사용자 "컨트롤 Z 하면 이상한 게 되돌아감").
// 브라우저 기본 되돌리기는 문서 하나에 한 줄로 쌓인다 — 모든 칸·지난 편집 회차가 한 스택에 섞이고,
// 프로그램이 innerHTML 로 다시 쓴 것(편집 끝 다시 그리기·다 지운 뒤 비우기·덮어쓰기 시작·붙여넣기 이벤트)은 스택에 안 올라가
// 남은 단계가 이미 없어진 글 조각을 되살리거나(옛 글이 붙음) 다른 칸 단계를 써 버린다.
// 그래서 편집 회차마다 이 칸의 정리된 html(sanitizeRich 결과)만 따로 기억하고, 편집 중 Ctrl+Z 는 이것으로만 되돌린다.
export type EditKind = "type" | "delete" | "other";
export type EditHistory = { past: string[]; cur: string; future: string[]; lastAt: number; lastKind: EditKind | null };

const LIMIT = 100;
const BURST_MS = 1000; // 이어 치는 글자는 한 단계로(브라우저도 낱자마다 되돌리지 않는다)

export const editKind = (inputType: string | undefined): EditKind =>
  !inputType ? "other" : inputType === "insertText" || inputType === "insertCompositionText" ? "type" : inputType.startsWith("delete") ? "delete" : "other";

// 편집 시작 때 지금 칸 내용으로 연다(덮어쓰기 시작이면 비우기 전 내용)
export const openHistory = (initial: string): EditHistory => ({ past: [], cur: initial, future: [], lastAt: 0, lastKind: null });

// 칸 내용이 바뀐 뒤 부른다. 같은 종류를 잇달아 치는 중이면 지금 단계만 고쳐 쓴다.
export function recordEdit(h: EditHistory, html: string, kind: EditKind, now: number = Date.now()): void {
  if (html === h.cur) return;
  const burst = kind !== "other" && kind === h.lastKind && now - h.lastAt < BURST_MS && h.past.length > 0;
  if (!burst) { h.past.push(h.cur); if (h.past.length > LIMIT) h.past.shift(); }
  h.cur = html;
  h.future = [];
  h.lastAt = now;
  h.lastKind = kind;
}

// 되돌린 뒤 칸에 넣을 html(더 없으면 null — 다른 칸·지난 회차로 넘어가지 않는다)
export function undoEdit(h: EditHistory): string | null {
  const prev = h.past.pop();
  if (prev === undefined) return null;
  h.future.push(h.cur);
  h.cur = prev;
  h.lastKind = null; // 되돌린 뒤 새로 치면 새 단계
  return prev;
}

export function redoEdit(h: EditHistory): string | null {
  const next = h.future.pop();
  if (next === undefined) return null;
  h.past.push(h.cur);
  h.cur = next;
  h.lastKind = null;
  return next;
}

// 편집 중 키가 되돌리기/다시하기인지 — 한글 입력 상태에서도(e.code)
export function historyKey(e: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey?: boolean }): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const z = e.key === "z" || e.key === "Z" || e.code === "KeyZ";
  const y = e.key === "y" || e.key === "Y" || e.code === "KeyY";
  if (z) return e.shiftKey ? "redo" : "undo";
  if (y && !e.shiftKey) return "redo";
  return null;
}
