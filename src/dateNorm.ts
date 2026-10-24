/**
 * 날짜 칸 글자 정규화 — "YYYY-MM-DD" 하나로(2026-10-24).
 *
 * 왜: 미수·재계약·불만·초과조정 표의 날짜 칸(계약종료일·방문일·날짜·다음확인일·입력일·약속일)에
 *     "26-11-15" · "26,11,30" · "26년10월22일" · "2024. 5. 23" · "Thu Aug 24 2023 …" · "6월 19일" 이 섞였다(앱 입력분 포함).
 *     집계(formCount)·조회 탭 표시·GAS(DateNorm.gs)가 같은 규칙을 쓰게 한 곳에 둔다.
 *     규칙 표: docs/manual/ops/03-database.md "10. 날짜 칸 정규화 규칙" — GAS 쪽도 그 표를 따른다. 바꾸면 양쪽 같이.
 *
 * 규칙(위에서부터 먼저 맞는 것 하나)
 *   1. 'YYYY-MM-DDTHH:…'(UTC 시각 글자, 시트 미러)       → KST 날짜
 *   2. 'YYYY<구분>M<구분>D'  구분 = - . / , (앞뒤 공백 허용) → 그대로
 *   3. 'YY<구분>M<구분>D'    2자리 연도 = 20YY
 *   4. 'YYYY년 M월 D일' · 'YY년M월D일'(일 글자 생략 허용)
 *   5. 'Thu Aug 24 2023 …'(시트 Date 글자)              → 적힌 날짜 그대로(시간대 무시)
 *   6. 'M월 D일'(연도 없음)                             → baseYear 가 있으면 그 해, 없으면 null
 *   · 숫자 뒤에 숫자가 바로 붙으면 안 맞는 것으로 본다('2026-10-291' → null). 날짜 뒤 '(목)'·' 14:00' 같은 꼬리는 허용.
 *   · 달력에 없는 날(2/30)·연도 1990~2100 밖 → null
 *   · 못 읽으면 null — 저장할 때는 원래 글자를 그대로 둔다(normalizeDateKeep), 고치지 않는다.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function ymdOf(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1990 || y > 2100) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const yearOf = (yy: string) => (yy.length === 2 ? 2000 + Number(yy) : Number(yy));

export type DateNormOptions = { baseYear?: number };

/** 날짜 칸 글자 → "YYYY-MM-DD", 못 읽으면 null. 규칙은 파일 머리 주석. */
export function normalizeDateText(value: unknown, opts: DateNormOptions = {}): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;

  // 1. UTC 시각 글자 → KST 날짜
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:/.test(s)) {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    const k = new Date(t + 9 * 3600_000);
    return ymdOf(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate());
  }
  // 2·3. 숫자 세 덩어리(4자리 또는 2자리 연도)
  const num = s.match(/^(\d{4}|\d{2})\s*[-./,]\s*(\d{1,2})\s*[-./,]\s*(\d{1,2})(?!\d)/);
  if (num) return ymdOf(yearOf(num[1]), Number(num[2]), Number(num[3]));
  // 4. 한글 년월일
  const ko = s.match(/^(\d{4}|\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})(?!\d)/);
  if (ko) return ymdOf(yearOf(ko[1]), Number(ko[2]), Number(ko[3]));
  // 5. JS Date 글자
  const js = s.match(/^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})\b/);
  if (js && MONTHS[js[1]]) return ymdOf(Number(js[3]), MONTHS[js[1]], Number(js[2]));
  // 6. 연도 없는 'M월 D일'
  const md = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})(?!\d)/);
  if (md) return opts.baseYear ? ymdOf(opts.baseYear, Number(md[1]), Number(md[2])) : null;
  return null;
}

/** 저장용: 읽히면 "YYYY-MM-DD", 못 읽으면 원래 글자 그대로(앞뒤 공백만 정리) — "미정"·"차주 중" 같은 글을 지우지 않는다 */
export function normalizeDateKeep(value: unknown, opts: DateNormOptions = {}): string {
  const raw = String(value ?? "").trim();
  return normalizeDateText(raw, opts) ?? raw;
}

/** KST 기준 해(오늘이 아니라 기준 시각을 줄 수 있게) — baseYear 기본값 */
export function kstYear(at: Date | string = new Date()): number {
  const t = at instanceof Date ? at.getTime() : Date.parse(at);
  const d = new Date((Number.isFinite(t) ? t : Date.now()) + 9 * 3600_000);
  return d.getUTCFullYear();
}

/**
 * 날짜 칸 이름(미수·재계약·불만·초과조정 표와 FIELD 양식 공통).
 * '제안일자'는 "제안일/제안자" 를 한 칸에 적는 칸이라 넣지 않는다.
 */
export const DATE_TEXT_COLUMNS: ReadonlySet<string> = new Set(["날짜", "입력일", "방문일", "계약종료일", "다음확인일", "약속일"]);

/** 양식 값 중 날짜 칸만 정규화한 새 객체(못 읽는 칸은 원래 글자) — 저장 직전에 부른다 */
export function normalizeDateFields<T extends Record<string, unknown>>(form: T, opts: DateNormOptions = {}, keys: ReadonlySet<string> = DATE_TEXT_COLUMNS): T {
  const out: Record<string, unknown> = { ...form };
  for (const k of Object.keys(out)) {
    if (keys.has(k) && typeof out[k] === "string" && out[k]) out[k] = normalizeDateKeep(out[k], opts);
  }
  return out as T;
}

/** 조회 탭 표시용: 날짜 칸이고 읽히면 "YYYY-MM-DD", 아니면 원래 글자(원본 행은 건드리지 않는다) */
export function displayDateCell(value: string, key: string): string {
  if (!DATE_TEXT_COLUMNS.has(key) || !value) return value;
  return normalizeDateText(value) ?? value;
}
