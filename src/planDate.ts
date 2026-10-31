/**
 * 일정 계획 기본 날짜 — 현장 리듬에 맞춘다:
 * 오후 4시 이후 = 내일 일정을 짜는 시간 → 다음 영업일이 기본.
 * 그 전(당일 일정이 비어 근처를 급히 찾는 상황 포함) = 오늘이 기본.
 * 영업일 = 주말·한국 공휴일(대체공휴일 포함) 제외.
 */
import { kstDate } from "./visits";
// 2026-10-31: 공휴일 표·영업일 계산은 supabase/functions/_shared/kr-holidays.ts (엣지 schedule-report 와 같은 표 — 고칠 곳 한 군데). 여기선 다시 내보낸다.
import { nextBusinessDay } from "../supabase/functions/_shared/kr-holidays.ts";
export { KR_HOLIDAYS, isBusinessDay, nextBusinessDay } from "../supabase/functions/_shared/kr-holidays.ts";


export function defaultPlanDate(): string {
  const today = kstDate();
  const hourKst = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return hourKst >= 16 ? nextBusinessDay(today) : today;
}
