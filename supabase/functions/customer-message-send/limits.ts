/**
 * 고객 문자·메일 발송 상한 규칙 (Deno 엣지와 vitest 가 같이 쓴다 — Deno 전용 API 없음).
 *
 * 2026-10-31: 건수 조회(countRows)가 실패하면 예전엔 0 을 돌려줘 상한이 열린 채 발송됐다.
 * 이제 건수 조회 실패는 SendLimitCheckError 로 던지고, 호출부가 503 "발송 한도 확인 실패" 로 막는다(fail-closed).
 * 설정값(configNumber) 조회 실패는 0 → 코드 기본값(시간당 40·하루 max(80, 30일 평균×3))으로 진행해도 된다(팀장 결정).
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const SEND_LIMIT_CHECK_FAILED = "발송 한도 확인 실패 — 잠시 후 다시";

export class SendLimitCheckError extends Error {
  constructor(detail: string) {
    super(`${SEND_LIMIT_CHECK_FAILED} (${detail})`);
    this.name = "SendLimitCheckError";
  }
}

/** PostgREST content-range("0-0/123", "*\/0") 의 전체 건수. 건수가 없거나("0-0/*") 숫자가 아니면 null. */
export function parseContentRangeTotal(range: string | null): number | null {
  const total = String(range || "").split("/")[1];
  if (total === undefined || total === "" || total === "*") return null;
  const n = Number(total);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** message_jobs 건수. 네트워크 오류·4xx/5xx·건수 없는 응답은 SendLimitCheckError. */
export async function countRows(fetchFn: FetchLike, sbUrl: string, h: Record<string, string>, query: string): Promise<number> {
  let res: Response;
  try {
    res = await fetchFn(`${sbUrl}/rest/v1/message_jobs?select=id&${query}&limit=1`, { headers: { ...h, Prefer: "count=exact" } });
  } catch (e) {
    throw new SendLimitCheckError(`네트워크: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SendLimitCheckError(`HTTP ${res.status}: ${detail.slice(0, 120)}`);
  }
  const total = parseContentRangeTotal(res.headers.get("content-range"));
  if (total === null) throw new SendLimitCheckError(`건수 없음(content-range=${res.headers.get("content-range") || "없음"})`);
  return total;
}

/** app_config 숫자 설정. 실패·없음은 0 → 호출부가 코드 기본값을 쓴다(상한 수 자체는 코드에 있음). */
export async function configNumber(fetchFn: FetchLike, sbUrl: string, h: Record<string, string>, key: string): Promise<number> {
  try {
    const res = await fetchFn(`${sbUrl}/rest/v1/app_config?select=value&key=eq.${encodeURIComponent(key)}&limit=1`, { headers: h });
    if (!res.ok) return 0;
    const rows = await res.json();
    return Number(rows?.[0]?.value || 0) || 0;
  } catch { return 0; } // 설정 조회 실패는 기본값으로 진행(팀장 결정 2026-10-31)
}

export const kstDayStartIso = (nowMs = Date.now()) => { const kst = new Date(nowMs + 9 * 3600_000); kst.setUTCHours(0, 0, 0, 0); return new Date(kst.getTime() - 9 * 3600_000).toISOString(); };

export type LimitResult = { ok: true } | { ok: false; reason: string };

/**
 * 시간당·하루·수신번호당 상한, 그리고 하루 건수가 30일 평균의 3배를 넘으면 차단. app_config SMS_HOURLY_CAP / SMS_DAILY_CAP 로 바꿀 수 있다.
 * 건수 조회가 하나라도 실패하면 SendLimitCheckError 를 던진다(열린 채 통과시키지 않는다).
 */
export async function checkSendLimits(fetchFn: FetchLike, sbUrl: string, h: Record<string, string>, p: { channel: string; to: string; type: string }, nowMs = Date.now()): Promise<LimitResult> {
  if (!sbUrl || !h.apikey) return { ok: true };
  const hourAgo = new Date(nowMs - 3600_000).toISOString();
  const dayStart = kstDayStartIso(nowMs);
  const d30 = new Date(nowMs - 30 * 86400_000).toISOString();
  const base = `source_type=like.direct*&status=eq.sent&channel=eq.${encodeURIComponent(p.channel)}`;
  const [hour, today, toToday, last30, hourlyCap, dailyCap] = await Promise.all([
    countRows(fetchFn, sbUrl, h, `${base}&sent_at=gte.${encodeURIComponent(hourAgo)}`),
    countRows(fetchFn, sbUrl, h, `${base}&sent_at=gte.${encodeURIComponent(dayStart)}`),
    countRows(fetchFn, sbUrl, h, `${base}&recipient=eq.${encodeURIComponent(p.to)}&sent_at=gte.${encodeURIComponent(dayStart)}`),
    countRows(fetchFn, sbUrl, h, `${base}&sent_at=gte.${encodeURIComponent(d30)}`),
    configNumber(fetchFn, sbUrl, h, p.channel === "email" ? "EMAIL_HOURLY_CAP" : "SMS_HOURLY_CAP"),
    configNumber(fetchFn, sbUrl, h, p.channel === "email" ? "EMAIL_DAILY_CAP" : "SMS_DAILY_CAP"),
  ]);
  const avgDaily = last30 / 30;
  const hCap = hourlyCap || 40;
  const dCap = dailyCap || Math.max(80, Math.ceil(avgDaily * 3));   // 평소(30일 평균)의 3배, 바닥 80
  const perTo = 5;
  if (toToday >= perTo) return { ok: false, reason: `같은 번호(${p.to})로 오늘 ${toToday}건 — 하루 ${perTo}건까지` };
  if (hour >= hCap) return { ok: false, reason: `최근 1시간 ${hour}건 — 시간당 ${hCap}건까지(관리 탭 app_config SMS_HOURLY_CAP)` };
  if (today >= dCap) return { ok: false, reason: `오늘 ${today}건 — 하루 ${dCap}건까지(30일 평균 ${avgDaily.toFixed(1)}건의 3배, SMS_DAILY_CAP 로 조정)` };
  return { ok: true };
}
