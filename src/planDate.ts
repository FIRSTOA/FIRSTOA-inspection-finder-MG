/**
 * 일정 계획 기본 날짜 — 현장 리듬에 맞춘다:
 * 오후 4시 이후 = 내일 일정을 짜는 시간 → 다음 영업일이 기본.
 * 그 전(당일 일정이 비어 근처를 급히 찾는 상황 포함) = 오늘이 기본.
 * 영업일 = 주말·한국 공휴일(대체공휴일 포함) 제외.
 */
import { kstDate } from "./visits";

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

export function isBusinessDay(ymd: string): boolean {
  const day = new Date(`${ymd}T12:00:00+09:00`).getDay();
  return day !== 0 && day !== 6 && !KR_HOLIDAYS.has(ymd);
}

export function nextBusinessDay(from: string): string {
  const d = new Date(`${from}T12:00:00+09:00`);
  do { d.setDate(d.getDate() + 1); } while (!isBusinessDay(kstDate(d)));
  return kstDate(d);
}

export function defaultPlanDate(): string {
  const today = kstDate();
  const hourKst = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return hourKst >= 16 ? nextBusinessDay(today) : today;
}
