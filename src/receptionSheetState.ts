/**
 * 접수 시트 상태 규칙(프런트 사본) — 서비스접수 미처리 = 시트 상태 기준(C3, 2026-10-22).
 * 원본: supabase/functions/reception-sheet-open/state.ts. 두 사본은 tests/receptionSheetState.test.ts 가 같은 표본으로 대조한다.
 * 한쪽을 고치면 다른 쪽도 같이 고칠 것.
 */
export type SheetClass = "done" | "hold" | "open";

const squeeze = (v: unknown) => String(v ?? "").replace(/\s+/g, "");

/** 상태 칸 → 완료/보류/미처리. 완료 = 완료·취소·중복·이관·해결·재접수 포함 또는 AS접수·A/S접수, 보류 = 정확히 "보류", 그 밖(공란 포함) = 미처리 */
export function sheetStateClass(value: unknown): SheetClass {
  const s = squeeze(value);
  if (!s) return "open";
  if (/완료|취소|중복|이관|해결|재접수/.test(s)) return "done";
  const upper = s.toUpperCase();
  if (upper === "AS접수" || upper === "A/S접수") return "done";
  if (s === "보류") return "hold";
  return "open";
}

export const isCancelState = (value: unknown) => /취소/.test(squeeze(value));

const pad2 = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad2(m)}-${pad2(d)}` : "";
};

/** C열 년월(yyMM) + B열 "M월 d일" → YYYY-MM-DD. B에 연도가 붙어 있으면 그대로, C가 이상하면 "" */
export function sheetDate(yymm: unknown, md: unknown): string {
  const b = String(md ?? "").trim();
  const full = b.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (full) return validYmd(Number(full[1]), Number(full[2]), Number(full[3]));
  const c = squeeze(yymm);
  const ym = c.match(/^(\d{2})(\d{2})$/);
  if (!ym) return "";
  const year = 2000 + Number(ym[1]);
  const month = Number(ym[2]);
  if (month < 1 || month > 12) return "";
  const md2 = b.match(/^(\d{1,2})\s*[월/.-]\s*(\d{1,2})/);
  if (!md2) return "";
  const m = Number(md2[1]);
  const d = Number(md2[2]);
  let y = year;
  if (m === 12 && month === 1) y -= 1;
  else if (m === 1 && month === 12) y += 1;
  return validYmd(y, m, d);
}

/** 화면 표기: 공란은 "상태 비어 있음" */
export const sheetStateLabel = (state: unknown) => (squeeze(state) ? String(state).trim() : "상태 비어 있음");
