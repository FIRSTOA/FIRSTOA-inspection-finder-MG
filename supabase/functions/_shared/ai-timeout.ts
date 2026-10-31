/**
 * OpenAI 호출 타임아웃 공용 규칙 (2026-10-31 점검: 타임아웃 없는 AI 엣지 8개).
 * Deno 엣지와 vitest 가 같이 쓴다 — Deno 전용 API 없음.
 *  - fetch(..., { signal: aiTimeoutSignal() }) 로 붙이면 본문 읽기(res.json())까지 같은 시간 안에 끝나야 한다.
 *  - 시간 초과는 catch 에서 isAiTimeout(error) 로 가려 504 + AI_TIMEOUT_MESSAGE 로 답한다.
 *  - 엣지 요청 유휴 한도 150초 안: 보통 60초, 긴 도구 호출이 있는 함수(entity-ask 등)는 90초.
 */
export const AI_TIMEOUT_MS = 60_000;
export const AI_TIMEOUT_LONG_MS = 90_000;
export const AI_TIMEOUT_MESSAGE = "AI 응답이 늦어 중단했습니다 — 다시 시도";

export function aiTimeoutSignal(ms: number = AI_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}

/** AbortSignal.timeout 이 끊은 오류인지(Deno·Node 모두 DOMException name "TimeoutError"). */
export function isAiTimeout(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: unknown }).name === "TimeoutError";
}

/** 시간 초과 응답 — 504, 본문 { error }. headers 는 각 함수의 CORS·JSON 헤더. */
export function aiTimeoutResponse(headers: Record<string, string>, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: AI_TIMEOUT_MESSAGE, ...extra }), { status: 504, headers: { ...headers, "Content-Type": "application/json" } });
}
