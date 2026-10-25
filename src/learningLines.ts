/**
 * 주간 현황판 › 성장기록 › 배운 점 한 줄 파서(GrowthHub 에서 분리, 2026-10-25) + K21 IT 실습용 변환.
 * 한 줄 = "날짜\t브랜드\t기종\t배운 점\t교육자\t소요시간"(탭), 탭이 없으면 공백 구분 폴백.
 */
import type { WeeklyNoteRow } from "./visits";

export type LearningParsed = { 날짜: string; 브랜드: string; 기종: string; "배운 점": string; 교육자: string; 소요시간: string };

export function parseLearningLine(line: string): LearningParsed {
  if (line.includes("\t")) {
    const [날짜 = "", 브랜드 = "", 기종 = "", 배운점 = "", 교육자 = "", 소요시간 = ""] = line.trim().split("\t");
    return { 날짜, 브랜드, 기종, "배운 점": 배운점, 교육자, 소요시간 };
  }
  const parts = line.trim().split(/\s+/).filter(Boolean);
  const durationIndex = parts.findIndex((part, index) => index >= 3 && /^\d+\s*(?:분|시간)?$/.test(part));
  if (durationIndex >= 0) {
    return {
      날짜: parts[0] || "",
      브랜드: parts[1] || "",
      기종: parts[2] || "",
      "배운 점": parts.slice(3, durationIndex).join(" "),
      소요시간: parts[durationIndex] || "",
      교육자: parts.slice(durationIndex + 1).join(" "),
    };
  }
  return {
    날짜: parts[0] || "",
    브랜드: parts[1] || "",
    기종: parts[2] || "",
    "배운 점": parts.slice(3, -2).join(" ") || parts.slice(3).join(" "),
    소요시간: parts.length >= 5 ? parts.at(-2) || "" : "",
    교육자: parts.length >= 6 ? parts.at(-1) || "" : "",
  };
}

/** 여러 줄 글의 첫 줄만(성장기록 카드 미리보기용) */
export function parseLearningText(text: string): LearningParsed {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  return parseLearningLine(first);
}

/** 글 → 빈 줄 뺀 줄별 파싱 */
export function learningLinesOf(text: string): LearningParsed[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseLearningLine(line));
}

/**
 * 브랜드 칸이 IT 인가 — 공백 제거·대소문자 무시 후 정확히 "IT" 이거나 "IT" 다음 글자가 영문·숫자가 아님.
 * IT · it · " I T " · IT파트 · IT-실습 → 예 / ITX · ITEM · IT2 · 아이티 · "" → 아니오
 */
export function isItBrand(brand: string): boolean {
  const b = String(brand || "").replace(/\s+/g, "").toUpperCase();
  return /^IT(?![A-Z0-9])/.test(b);
}

const ymd = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const validMd = (mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
const addMonths = (date: string, n: number) => {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1 + n;
  return ymd(y + Math.floor(m / 12), ((m % 12) + 12) % 12 + 1, Number(date.slice(8, 10)));
};

/**
 * 줄 날짜 → YYYY-MM-DD. 못 읽으면 "".
 * - 연도 4자리(2026-10-21 · 2026.10.5 · 2026/1/2) 그대로
 * - 연도 없는 M/D · M.D · M-D · M월 D일(실측 2026-10-25: 실제 글은 전부 "10/20" 꼴) → weekStart 의 연도.
 *   그 날짜가 weekStart 보다 6개월 넘게 뒤면 전년, 6개월 넘게 앞이면 다음 해(연말·연초 걸친 주)
 */
export function learningDateOf(raw: string, weekStart = ""): string {
  const s = String(raw || "").trim();
  const full = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (full) return validMd(Number(full[2]), Number(full[3])) ? ymd(Number(full[1]), Number(full[2]), Number(full[3])) : "";
  const md = s.match(/^(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})(?!\d)/);
  if (!md || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return "";
  const mo = Number(md[1]), d = Number(md[2]);
  if (!validMd(mo, d)) return "";
  const y = Number(weekStart.slice(0, 4));
  const date = ymd(y, mo, d);
  if (date > addMonths(weekStart, 6)) return ymd(y - 1, mo, d);
  if (date < addMonths(weekStart, -6)) return ymd(y + 1, mo, d);
  return date;
}

export type LearningDatedRow = { author: string; date: string };

/**
 * K21 IT 실습 — 배운 점 중 브랜드가 IT 인 줄 → {작성자, 날짜}. 날짜는 줄의 날짜(연도 없으면 week_start 연도, 못 읽으면 그 주 week_start).
 * 배운 점·기종이 둘 다 빈 줄은 뺀다. 같은 작성자·같은 날짜·같은 배운 점 글은 1회. range 밖 날짜는 뺀다.
 */
export function itLearningRowsFromNotes(notes: readonly WeeklyNoteRow[], range: { from: string; to: string }): LearningDatedRow[] {
  const seen = new Set<string>();
  const out: LearningDatedRow[] = [];
  for (const note of notes) {
    const author = String(note.author || "").trim();
    if (!author) continue;
    for (const item of learningLinesOf(String(note.learning || ""))) {
      if (!isItBrand(item.브랜드)) continue;
      const text = item["배운 점"].replace(/\s+/g, " ").trim();
      if (!text && !item.기종.trim()) continue;
      const date = learningDateOf(item.날짜, String(note.weekStart || "")) || String(note.weekStart || "");
      if (!date || date < range.from || date > range.to) continue;
      const key = `${author}\u0001${date}\u0001${text || item.기종.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ author, date });
    }
  }
  return out;
}

/**
 * K21 두 원본 합치기 — practice = 실습 기록 행(표 없으면 null), notes = 배운 점 IT 줄(못 읽으면 null).
 * 둘 다 null 이면 null(못 셈 = 준비 중/오류), 한쪽만 있으면 그쪽만 센다.
 */
export function combineItPractice(practice: readonly LearningDatedRow[] | null, notes: readonly LearningDatedRow[] | null): LearningDatedRow[] | null {
  if (!practice && !notes) return null;
  return [...(practice || []), ...(notes || [])];
}
