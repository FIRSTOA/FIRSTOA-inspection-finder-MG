// 엑셀처럼 여러 칸 고르기·복사·붙여넣기(2026-10-01 OKR 요청)
//  - 범위: Shift+클릭, Shift+화살표, 마우스 드래그. 같은 <table> 안 [data-cell]을 행(tr)·열(행 안 순서)로 센다.
//  - Ctrl+C: 범위(없으면 그 칸)를 탭·줄바꿈 글(TSV)로 — 줄바꿈·탭·따옴표가 든 칸은 엑셀처럼 "…"로 감싼다. 엑셀·구글시트에 그대로 붙는다.
//  - Ctrl+V: 고른 칸부터 오른쪽·아래로 채운다(엑셀에서 복사한 여러 칸도). 글은 각 칸에 'cell-set' 이벤트로 넘긴다(RichCell이 받아 저장).
//  - Ctrl+X·Delete: 범위를 비운다. 범위 표시는 [data-range] 속성 → index.css가 칸(td) 배경을 칠한다.
//  - Ctrl+Z / Ctrl+Y(Ctrl+Shift+Z): 붙여넣기·지우기·잘라내기·덮어쓰며 타이핑으로 바뀐 칸들을 묶음째 되돌리고 다시 실행한다(최근 50묶음).
//    칸 안에서 글자를 고치는 중의 Ctrl+Z는 브라우저 자체 되돌리기다.
type Pos = { table: HTMLTableElement; row: number; col: number };

let anchorEl: HTMLElement | null = null;
let focusEl: HTMLElement | null = null;
let dragging = false;
let installed = false;

// 표의 칸들을 행별로 — 이 행에 직접 속한 칸만(안쪽에 표가 또 있어도 섞이지 않게)
export function cellGrid(table: HTMLTableElement): HTMLElement[][] {
  const rows: HTMLElement[][] = [];
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    const cells = Array.from(tr.querySelectorAll<HTMLElement>("[data-cell]")).filter((el) => el.closest("tr") === tr && el.closest("table") === table);
    if (cells.length) rows.push(cells);
  }
  return rows;
}
export function cellPos(el: HTMLElement): Pos | null {
  const table = el.closest("table");
  if (!table) return null;
  const grid = cellGrid(table);
  for (let r = 0; r < grid.length; r++) { const c = grid[r].indexOf(el); if (c >= 0) return { table, row: r, col: c }; }
  return null;
}
// 두 칸이 만드는 네모 안의 칸들(행별)
export function rangeCells(a: HTMLElement, b: HTMLElement): HTMLElement[][] {
  const pa = cellPos(a), pb = cellPos(b);
  if (!pa || !pb || pa.table !== pb.table) return [[a]];
  const grid = cellGrid(pa.table);
  const r0 = Math.min(pa.row, pb.row), r1 = Math.max(pa.row, pb.row), c0 = Math.min(pa.col, pb.col), c1 = Math.max(pa.col, pb.col);
  return grid.slice(r0, r1 + 1).map((row) => row.slice(c0, c1 + 1)).filter((row) => row.length);
}
function paint() {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-cell][data-range]"))) el.removeAttribute("data-range");
  if (!anchorEl || !focusEl || anchorEl === focusEl) return;
  for (const row of rangeCells(anchorEl, focusEl)) for (const el of row) el.setAttribute("data-range", "");
}
function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("mouseup", () => { dragging = false; });
  // 칸 밖을 누르면 범위 해제(표 머리·단추·다른 화면)
  document.addEventListener("mousedown", (e) => { const t = e.target as HTMLElement | null; if (t && !t.closest("[data-cell]")) clearRange(); }, true);
}
export function setAnchor(el: HTMLElement) { install(); anchorEl = el; focusEl = el; paint(); }
export function extendTo(el: HTMLElement) { install(); if (!anchorEl) anchorEl = el; focusEl = el; paint(); }
export function clearRange() { anchorEl = null; focusEl = null; dragging = false; paint(); }
export const rangeAnchor = () => anchorEl;
export const rangeFocus = () => focusEl;
export const hasRange = () => !!anchorEl && !!focusEl && anchorEl !== focusEl;
export const inRange = (el: HTMLElement) => !!anchorEl && !!focusEl && anchorEl !== focusEl && rangeCells(anchorEl, focusEl).some((row) => row.includes(el));
export function beginDrag(el: HTMLElement) { setAnchor(el); dragging = true; }
export function dragOver(el: HTMLElement) { if (dragging && anchorEl && anchorEl !== el && cellPos(el)?.table === cellPos(anchorEl)?.table) extendTo(el); }

// 칸의 평문 — RichCell 안쪽 글 상자([data-cell-text])의 innerText(<br>→줄바꿈)
export function cellText(el: HTMLElement): string {
  const box = el.querySelector<HTMLElement>("[data-cell-text]") || el;
  return (box.innerText || box.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "");
}
export function toTsv(rows: string[][]): string {
  const q = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join("\t")).join("\n");
}
// 엑셀·구글시트가 주는 TSV — "…"로 감싼 칸 안의 줄바꿈·탭·""(따옴표)을 푼다. 끝의 빈 줄은 버린다.
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}
// 복사할 글 — 범위에 들어 있으면 범위 전체, 아니면 그 칸 하나
export function copyText(from: HTMLElement): string {
  const rows = inRange(from) && anchorEl && focusEl ? rangeCells(anchorEl, focusEl) : [[from]];
  return toTsv(rows.map((r) => r.map(cellText)));
}
export function setCellText(el: HTMLElement, text: string) { el.dispatchEvent(new CustomEvent<string>("cell-set", { detail: text })); }
type Snap = Array<{ el: HTMLElement; text: string }>;
const undoStack: Snap[] = [];
const redoStack: Snap[] = [];
const snapshot = (cells: HTMLElement[]): Snap => cells.map((el) => ({ el, text: cellText(el) }));
// 바꾸기 직전에 부른다 — 이 칸들의 지금 글을 한 묶음으로 기억
export function rememberCells(cells: HTMLElement[]) { if (!cells.length) return; undoStack.push(snapshot(cells)); if (undoStack.length > 50) undoStack.shift(); redoStack.length = 0; }
function restore(snap: Snap): number { let n = 0; for (const { el, text } of snap) if (el.isConnected) { setCellText(el, text); n++; } return n; }
export function undo(): number { const snap = undoStack.pop(); if (!snap) return 0; redoStack.push(snapshot(snap.map((x) => x.el))); return restore(snap); }
export function redo(): number { const snap = redoStack.pop(); if (!snap) return 0; undoStack.push(snapshot(snap.map((x) => x.el))); return restore(snap); }
// 붙여넣기 — from 칸(범위가 있으면 그 왼쪽 위)부터 오른쪽·아래로. 표 밖으로 넘치는 건 버린다. 채운 칸 수를 돌려준다.
export function pasteText(from: HTMLElement, text: string): number {
  const data = parseTsv(text);
  if (!data.length) return 0;
  const ranged = inRange(from) && anchorEl && focusEl ? rangeCells(anchorEl, focusEl) : null;
  const writes: Array<[HTMLElement, string]> = [];
  // 한 칸짜리 글을 여러 칸 범위에 붙이면 범위 전체를 그 글로(엑셀과 같다)
  if (ranged && data.length === 1 && data[0].length === 1) { for (const row of ranged) for (const el of row) writes.push([el, data[0][0]]); }
  else {
    const start = ranged ? ranged[0][0] : from;
    const pos = cellPos(start);
    if (!pos) writes.push([from, data.map((r) => r.join("\t")).join("\n")]);
    else { const grid = cellGrid(pos.table); data.forEach((r, i) => r.forEach((v, j) => { const el = grid[pos.row + i]?.[pos.col + j]; if (el) writes.push([el, v]); })); }
  }
  rememberCells(writes.map(([el]) => el));
  for (const [el, v] of writes) setCellText(el, v);
  return writes.length;
}
export function clearCells(from: HTMLElement): number {
  const cells = (inRange(from) && anchorEl && focusEl ? rangeCells(anchorEl, focusEl) : [[from]]).flat();
  rememberCells(cells);
  for (const el of cells) setCellText(el, "");
  return cells.length;
}
