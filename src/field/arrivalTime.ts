/**
 * 필드 양식 도착 시간 [지금] 칩·소요 시간 "지금까지 n분" 제안 칩의 순수 계산(2026-10-27, docs/tasks/review-2026-10-27.md F-1).
 * 시각은 항상 KST(Asia/Seoul) 기준 — 기기 시간대와 상관없이 같은 값을 낸다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 시·분(0~23, 0~59) */
function kstHourMinute(now: Date): { hour: number; minute: number } {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return { hour: k.getUTCHours(), minute: k.getUTCMinutes() };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 지금(KST)을 5분 단위로 내림 — 14:07 → { hour: "14", minute: "05" }. 분 선택지(MINUTE_OPTIONS)가 5분 단위라 그에 맞춘다 */
export function nowRoundedDown5(now: Date): { hour: string; minute: string } {
  const { hour, minute } = kstHourMinute(now);
  return { hour: pad2(hour), minute: pad2(Math.floor(minute / 5) * 5) };
}

/**
 * 도착(오늘 KST 시·분)부터 지금까지 흐른 분. 시가 비었거나 숫자가 아니면 null, 분이 비면 0분으로 본다.
 * 지금보다 도착이 뒤면(자정 넘김·미래 입력) null.
 */
export function elapsedMinutes(arrivalHour: string, arrivalMinute: string, now: Date): number | null {
  if (!arrivalHour || !/^\d{1,2}$/.test(arrivalHour.trim())) return null;
  const h = parseInt(arrivalHour, 10);
  const m = arrivalMinute && /^\d{1,2}$/.test(arrivalMinute.trim()) ? parseInt(arrivalMinute, 10) : 0;
  if (h > 23 || m > 59) return null;
  const { hour, minute } = kstHourMinute(now);
  const diff = hour * 60 + minute - (h * 60 + m);
  return diff < 0 ? null : diff;
}

/** 소요 시간 제안값 — 흐른 분을 5분 단위로 올림. 0 이하·8시간(480분) 초과·계산 불가면 null(칩 숨김) */
export function suggestDuration(arrivalHour: string, arrivalMinute: string, now: Date): number | null {
  const e = elapsedMinutes(arrivalHour, arrivalMinute, now);
  if (e === null || e <= 0) return null;
  const n = Math.ceil(e / 5) * 5;
  return n > 480 ? null : n;
}
