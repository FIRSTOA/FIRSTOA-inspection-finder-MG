/**
 * 한국 영업일·KST 날짜 — 웹앱(src/planDate.ts 가 다시 내보냄)과 엣지 함수(schedule-report)가 같은 표를 쓴다(2026-10-31 이사).
 * 서버(Deno)는 UTC 로 돈다 — 날짜·시각은 전부 Asia/Seoul 기준으로 직접 계산하고, 실행 환경의 시간대에 기대지 않는다.
 * Deno·Vite 둘 다 읽으므로 외부 import 없이 순수 함수만 둔다.
 */

// 한국 공휴일 표 (대체공휴일 포함) — 음력 명절 때문에 연 단위 표가 필요하다.
// ⚠ 매년 12월에 다음 해 공휴일을 추가할 것 (관공서의 공휴일에 관한 규정 기준)
export const KR_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01",                                            // 신정
  "2026-02-16", "2026-02-17", "2026-02-18",                // 설날 연휴
  "2026-03-01", "2026-03-02",                              // 삼일절(일) + 대체
  "2026-05-05",                                            // 어린이날
  "2026-05-24", "2026-05-25",                              // 부처님오신날(일) + 대체
  "2026-06-06",                                            // 현충일
  "2026-08-15", "2026-08-17",                              // 광복절(토) + 대체
  "2026-09-24", "2026-09-25", "2026-09-26",                // 추석 연휴
  "2026-10-03", "2026-10-05",                              // 개천절(토) + 대체
  "2026-10-09",                                            // 한글날
  "2026-12-25",                                            // 성탄절
  // 2027 (예비 — 연말에 확정본 확인)
  "2027-01-01",
  "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09",  // 설날 연휴(일 포함) + 대체
  "2027-03-01",
  "2027-05-05",
  "2027-05-13",                                            // 부처님오신날
  "2027-06-06",
  "2027-08-15", "2027-08-16",                              // 광복절(일) + 대체
  "2027-09-14", "2027-09-15", "2027-09-16",                // 추석 연휴
  "2027-10-03", "2027-10-04",                              // 개천절(일) + 대체
  "2027-10-09", "2027-10-11",                              // 한글날(토) + 대체
  "2027-12-25", "2027-12-27",                              // 성탄절(토) + 대체
]);

/** 'YYYY-MM-DD' 의 요일(0=일) — 실행 환경 시간대와 무관하게 달력 날짜 그대로 */
function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

/** 그 시각의 KST 날짜 'YYYY-MM-DD' (src/visits.ts kstDate 와 같은 식) */
export function kstYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export type KstNow = { ymd: string; hh: string; mm: string };

/** 지금(또는 주어진 시각)의 KST 날짜·시·분 — 엣지(UTC)에서 '오늘'·머리 시각을 잡을 때 */
export function kstNow(d: Date = new Date()): KstNow {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const pick = (type: string) => (parts.find((p) => p.type === type)?.value || "00").padStart(2, "0");
  return { ymd: kstYmd(d), hh: pick("hour"), mm: pick("minute") };
}

export function isBusinessDay(ymd: string): boolean {
  const day = weekdayOf(ymd);
  return day !== 0 && day !== 6 && !KR_HOLIDAYS.has(ymd);
}

/** 다음 영업일 — 금요일 → 월요일, 공휴일·대체공휴일 건너뜀. 달력 날짜 계산이라 시간대 영향 없음 */
export function nextBusinessDay(from: string): string {
  const d = new Date(`${from}T00:00:00Z`);
  let ymd = from;
  do {
    d.setUTCDate(d.getUTCDate() + 1);
    ymd = d.toISOString().slice(0, 10);
  } while (!isBusinessDay(ymd));
  return ymd;
}
