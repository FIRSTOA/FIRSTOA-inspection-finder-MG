/**
 * photo-drive-archive 의 순수 규칙 (Deno 엣지와 vitest 가 같이 쓴다 — Deno 전용 API 없음).
 * 2026-10-31: GAS 호출 타임아웃 없음(7일 83회 150초 초과)·GAS {ok:false} 본문을 200 으로 넘김·status 조회 응답 미확인을 고침.
 */
/** 크론(ops.call_edge 150초) 한도 안. gas-admin 과 같은 값 */
export const GAS_TIMEOUT_MS = 140_000;

/** PostgREST content-range("0-0/123", "*\/0") 의 전체 건수. 건수가 없거나 숫자가 아니면 null. */
export function contentRangeTotal(range: string | null): number | null {
  const total = String(range || "").split("/")[1];
  if (total === undefined || total === "" || total === "*") return null;
  const n = Number(total);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type GasVerdict = { ok: true; data: unknown } | { ok: false; status: number; error: string; data?: unknown };

/**
 * GAS 응답(HTTP 상태 + 본문 글) → 성공/실패 판정. 실패면 엣지가 돌려줄 HTTP 상태도 정한다(ops 기록에 실패로 남게 4xx/5xx).
 *  - HTTP 가 2xx 아님 → 502
 *  - 본문이 JSON 아님 → 502
 *  - 본문 { ok:false } 또는 ok:true 없이 error 만 있는 본문(GAS photoArchiveRun_ 의 { error: "SUPABASE_SERVICE_KEY 미설정" }) →
 *    본문 status 가 4xx 면 그 값(예: 토큰 거부 403), 아니면 502
 */
export function judgeGasResponse(httpStatus: number, text: string): GasVerdict {
  let data: unknown;
  try { data = JSON.parse(text); } catch {
    return { ok: false, status: 502, error: `GAS 응답 파싱 실패(${httpStatus}): ${text.slice(0, 160)}` };
  }
  if (httpStatus < 200 || httpStatus >= 300) return { ok: false, status: 502, error: `GAS HTTP ${httpStatus}`, data };
  const body = data as { ok?: unknown; status?: unknown; error?: unknown; message?: unknown } | null;
  if (body && typeof body === "object" && (body.ok === false || (body.ok !== true && body.error != null && body.error !== ""))) {
    const s = Number(body.status);
    const status = Number.isInteger(s) && s >= 400 && s < 500 ? s : 502;
    return { ok: false, status, error: `GAS 실패: ${String(body.error ?? body.message ?? "").slice(0, 200) || "ok:false"}`, data };
  }
  return { ok: true, data };
}
