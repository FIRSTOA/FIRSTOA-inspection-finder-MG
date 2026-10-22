/**
 * 조회 탭(DataLookup) 칸 글자·CSV — 표 칸·모바일 카드·상세 제목·CSV 내보내기가 모두 lookupText 로 글자를 얻는다.
 * 주민번호는 여기서 가린다(2026-10-22, src/privacy.ts). 원본 행은 그대로(검색·수정은 원본 값으로).
 * 테스트: tests/privacyDisplay.test.ts
 */
import { maskDeep, maskRrnValue } from "./privacy";

type Row = Record<string, unknown>;
const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|ERROR!?)$/i;

export function lookupText(row: Row, key: string): string {
  const value = maskDeep(row[key], key);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");   // work_kinds 같은 배열은 쉼표로
  if (typeof value === "object") return JSON.stringify(value);
  const out = String(value);
  return SHEET_ERROR.test(out.trim()) ? "" : maskRrnValue(out, key);   // 시트 수식 에러값은 빈칸 취급
}

export function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV 본문(머리 줄 + 행) — BOM 은 부르는 쪽이 붙인다 */
export function lookupCsv(columns: Array<{ key: string; label: string }>, rows: Row[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  rows.forEach((row) => lines.push(columns.map((c) => csvCell(lookupText(row, c.key))).join(",")));
  return lines.join("\n");
}

/**
 * 기록 수정 칸의 시작 상태(2026-10-22). 입력칸 초기값은 **원본** 값(가린 값을 저장하면 원본이 망가진다).
 * 원본에 주민번호가 들어 있는 칸은 잠근다 — 가린 글자만 보여 주고 여기서는 고칠 수 없다(관리자에게).
 */
export function editFieldState(row: Row, key: string): { initial: string; locked: boolean; shown: string } {
  const v = row[key];
  const original = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  const masked = maskRrnValue(original, key);
  return masked !== original ? { initial: original, locked: true, shown: masked } : { initial: original, locked: false, shown: original };
}
