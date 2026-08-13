/**
 * 일정 계획 기본 날짜 — 현장 리듬에 맞춘다:
 * 오후 4시 이후 = 내일 일정을 짜는 시간 → 다음 영업일이 기본.
 * 그 전(당일 일정이 비어 근처를 급히 찾는 상황 포함) = 오늘이 기본.
 * 주말은 근무일이 아니므로 다음 영업일 계산에서 건너뛴다.
 */
import { kstDate } from "./visits";

export function nextBusinessDay(from: string): string {
  const d = new Date(`${from}T12:00:00+09:00`);
  do { d.setDate(d.getDate() + 1); } while ([0, 6].includes(d.getDay()));
  return kstDate(d);
}

export function defaultPlanDate(): string {
  const today = kstDate();
  const hourKst = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return hourKst >= 16 ? nextBusinessDay(today) : today;
}
