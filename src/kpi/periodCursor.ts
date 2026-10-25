/**
 * 홈 KPI 지난 기간 넘겨 보기 — 기간 커서(순수 함수). 설계안 docs/tasks/home-period-nav-2026-10-26.md 6절 "구현 A".
 *
 * offset 0 = 이번 기간, 음수 = 지난 기간. 지난 기간의 기준일(anchor)은 그 기간의 말일(주 = 일요일, 월 = 말일, 분기 = 분기 말일)이고,
 * 범위는 kpiRanges(anchor) 가 내는 것을 그대로 쓴다(주 = visits.weekRange 월~일, 월 = calendarRange, 분기 = kpiRanges 분기).
 * 상한: 주 7번(= 8주, kpiRanges.weeks8 과 같다)·월 5번(= 6개월)·분기 3번이되 **올해 안**(워킨맵 quarter 칸에 연도가 없다, 설계안 R1).
 * today 는 kstDate() 값(YYYY-MM-DD).
 */
import { currentWeekOf } from "../okr";
import { kpiRanges, rangeOfPeriod, shiftYmd, type KpiRange } from "./kpiCompute";

export type CursorPeriod = "week" | "month" | "quarter";
export type PeriodCursor = { period: CursorPeriod; offset: number };

export const BACK_LIMIT: Readonly<Record<CursorPeriod, number>> = { week: 7, month: 5, quarter: 3 };

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 뒤로 갈 수 있는 최대 칸 수(양수). 분기는 올해 안: today 의 분기 번호 − 1 까지 */
export function maxBack(period: CursorPeriod, today: string): number {
  if (period !== "quarter") return BACK_LIMIT[period];
  const q = Math.ceil(Number(today.slice(5, 7)) / 3);
  return Math.min(BACK_LIMIT.quarter, q - 1);
}

/** 상한·미래를 잘라 낸 offset(−maxBack ~ 0) */
function clampOffset(period: CursorPeriod, offset: number, today: string): number {
  return Math.max(-maxBack(period, today), Math.min(0, Math.trunc(offset) || 0));
}

/** 그 기간을 셀 기준일 — offset 0 이면 today, 아니면 그 기간의 말일 */
export function anchorOf(today: string, cursor: PeriodCursor): string {
  const k = clampOffset(cursor.period, cursor.offset, today);
  if (k === 0) return today;
  if (cursor.period === "week") return shiftYmd(kpiRanges(today).week.to, 7 * k); // 이번 주 일요일에서 k주
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  // 월 = 그 달 말일, 분기 = 그 분기 마지막 달 말일
  const base = cursor.period === "month" ? (y * 12 + (m - 1)) + k : (y * 12 + (Math.ceil(m / 3) * 3 - 1)) + 3 * k;
  const ty = Math.floor(base / 12), tm = (base % 12) + 1;
  return `${ty}-${pad(tm)}-${pad(lastDayOf(ty, tm))}`;
}

/** 커서가 가리키는 기간 범위 {from,to} */
export function cursorRange(today: string, cursor: PeriodCursor): KpiRange {
  return rangeOfPeriod(kpiRanges(anchorOf(today, cursor)), cursor.period);
}

/** 화면 라벨 — 주: 이번 주 / 지난주 10/19~10/25 / 10월 2주차(10/12~10/18) · 월: 이번 달 / 9월 / 2025년 12월 · 분기: 4분기 */
export function cursorLabel(today: string, cursor: PeriodCursor): string {
  const k = clampOffset(cursor.period, cursor.offset, today);
  const r = cursorRange(today, cursor);
  if (cursor.period === "week") {
    if (k === 0) return "이번 주";
    if (k === -1) return `지난주 ${md(r.from)}~${md(r.to)}`;
    const w = currentWeekOf(r.from); // OKR 화면과 같은 번호(월요일이 속한 달)
    return `${w.month}월 ${w.weekNo}주차(${md(r.from)}~${md(r.to)})`;
  }
  if (cursor.period === "month") {
    if (k === 0) return "이번 달";
    const y = r.from.slice(0, 4), m = Number(r.from.slice(5, 7));
    return y === today.slice(0, 4) ? `${m}월` : `${y}년 ${m}월`;
  }
  return `${Math.ceil(Number(r.from.slice(5, 7)) / 3)}분기`;
}

/** dir −1 = 지난 기간으로, +1 = 오늘 쪽으로 한 칸 갈 수 있나 */
export function canStep(cursor: PeriodCursor, dir: -1 | 1, today: string): boolean {
  const cur = clampOffset(cursor.period, cursor.offset, today);
  return clampOffset(cursor.period, cur + dir, today) !== cur;
}

/** 한 칸 이동 — 상한·이번 기간에 막히면 같은 cursor 를 그대로 돌려준다 */
export function step(cursor: PeriodCursor, dir: -1 | 1, today: string): PeriodCursor {
  if (!canStep(cursor, dir, today)) return cursor;
  return { period: cursor.period, offset: clampOffset(cursor.period, cursor.offset, today) + dir };
}

/** 끝난 기간인가(범위 말일 < 오늘) — "마감" 칩·경과율 100 */
export function isEnded(today: string, cursor: PeriodCursor): boolean {
  return cursorRange(today, cursor).to < today;
}

/**
 * 메인 묶음이 이미 읽어 둔 범위(mainFrom = kpiLoadFrom(ranges), mainTo = 분기 말) 안이면 true → 추가 조회 없이 파생 묶음.
 * 오늘 기준 지난 1~7주·지난달은 true, 2달 전·지난 분기는 false(설계안 2-1).
 */
export function coveredBy(mainFrom: string, mainTo: string, range: KpiRange): boolean {
  return range.from >= mainFrom && range.to <= mainTo;
}
