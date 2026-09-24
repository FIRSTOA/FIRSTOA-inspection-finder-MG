// 표 안 셀 사이를 키보드로 옮기기(엑셀처럼, 2026-09-24) — 같은 <table> 안의 [data-cell] 요소 중 방향에 맞는 가장 가까운 칸으로 포커스.
// 열 병합·Pillar 막대 행이 섞여 있어도 되게 칸 위치(화면 좌표)로 고른다.
export type CellDir = "up" | "down" | "left" | "right";

export function moveCellFocus(from: HTMLElement, dir: CellDir): boolean {
  const table = from.closest("table");
  if (!table) return false;
  const cur = from.getBoundingClientRect();
  const cx = (cur.left + cur.right) / 2;
  const cy = (cur.top + cur.bottom) / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of Array.from(table.querySelectorAll<HTMLElement>("[data-cell]"))) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const overlapY = r.top < cur.bottom - 1 && r.bottom > cur.top + 1;
    const overlapX = r.left < cur.right - 1 && r.right > cur.left + 1;
    if (dir === "right" && !(r.left >= cur.right - 1 && overlapY)) continue;
    if (dir === "left" && !(r.right <= cur.left + 1 && overlapY)) continue;
    if (dir === "down" && !(r.top >= cur.bottom - 1 && overlapX)) continue;
    if (dir === "up" && !(r.bottom <= cur.top + 1 && overlapX)) continue;
    const rx = (r.left + r.right) / 2;
    const ry = (r.top + r.bottom) / 2;
    const score = dir === "left" || dir === "right" ? Math.abs(rx - cx) + Math.abs(ry - cy) * 0.1 : Math.abs(ry - cy) + Math.abs(rx - cx) * 0.1;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;
  best.focus();
  best.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

export function dirFromKey(key: string): CellDir | null {
  return key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : null;
}

// 일반 input·select 칸 — Tab은 옆 칸, 위/아래 화살표는 위아래 칸, 좌/우는 글자 끝에 닿았을 때만 옆 칸(select는 위/아래가 값 바꾸기라 Tab·좌우만)
export function inputCellKeyDown(e: { key: string; shiftKey: boolean; currentTarget: HTMLElement; preventDefault: () => void }) {
  const el = e.currentTarget;
  if (e.key === "Tab") { if (moveCellFocus(el, e.shiftKey ? "left" : "right")) e.preventDefault(); return; }
  const dir = dirFromKey(e.key);
  if (!dir) return;
  if (el instanceof HTMLSelectElement && (dir === "up" || dir === "down")) return;
  if (el instanceof HTMLInputElement && el.type !== "number" && (dir === "left" || dir === "right")) {
    const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0;
    if (dir === "left" && !(start === 0 && end === 0)) return;
    if (dir === "right" && !(start === el.value.length && end === el.value.length)) return;
  }
  if (moveCellFocus(el, dir)) e.preventDefault();
}
