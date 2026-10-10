/**
 * OpenAI 사용량 집계·단가 계산·기록 (2026-10-10) — entity-ask·data-ask 가 같이 쓴다.
 *
 * 왜: "지금 API 비용이 나갈 텐데" — 질문마다 쓴 토큰과 추정 비용을 답 아래에 보여 주고(ai_usage 표가 있으면 쌓아) 한 달 합계를 볼 수 있게.
 * 단가: 모델 가격은 바뀌므로 코드에 박지 않는다. app_config 의 AI_PRICE_IN / AI_PRICE_OUT / AI_PRICE_CACHED(달러, 100만 토큰당) 를 먼저 읽고,
 *       없으면 환경변수 OPENAI_PRICE_IN/OUT/CACHED. 둘 다 없으면 토큰만 보여 준다(priced=false).
 * 브라우저 테스트(vitest)에서도 불러 쓰므로 Deno 전용 API 는 쓰지 않는다(fetch 만).
 */
export type Usage = { input: number; cached: number; output: number; reasoning: number; rounds: number };
export type Prices = { input: number; output: number; cached: number; known: boolean };
export type Cost = { usd: number | null; priced: boolean; model: string };

export const emptyUsage = (): Usage => ({ input: 0, cached: 0, output: 0, reasoning: 0, rounds: 0 });

/** Responses API 응답의 usage 를 누적한다: { input_tokens, output_tokens, input_tokens_details: { cached_tokens }, output_tokens_details: { reasoning_tokens } } */
export function addUsage(acc: Usage, u: unknown): Usage {
  const o = (u || {}) as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const inD = (o.input_tokens_details || {}) as Record<string, unknown>;
  const outD = (o.output_tokens_details || {}) as Record<string, unknown>;
  return {
    input: acc.input + n(o.input_tokens),
    cached: acc.cached + n(inD.cached_tokens),
    output: acc.output + n(o.output_tokens),
    reasoning: acc.reasoning + n(outD.reasoning_tokens),
    rounds: acc.rounds + 1,
  };
}

/** 달러 — 입력은 (전체 − 캐시)×입력단가 + 캐시×캐시단가, 출력(추리 포함)×출력단가. 단가는 100만 토큰당 달러 */
export function priceUsage(u: Usage, p: Prices): number | null {
  if (!p.known) return null;
  const fresh = Math.max(0, u.input - u.cached);
  const cachedRate = p.cached > 0 ? p.cached : p.input;
  return (fresh * p.input + u.cached * cachedRate + u.output * p.output) / 1_000_000;
}

export async function loadPrices(sbUrl: string, headers: Record<string, string>, env: (k: string) => string | undefined): Promise<Prices> {
  let input = 0, output = 0, cached = 0;
  try {
    const res = await fetch(`${sbUrl}/rest/v1/app_config?select=key,value&key=in.(AI_PRICE_IN,AI_PRICE_OUT,AI_PRICE_CACHED)`, { headers });
    const rows = (await res.json()) as Array<{ key: string; value: string }>;
    for (const r of rows || []) {
      const v = Number(String(r.value || "").replace(/[^\d.]/g, ""));
      if (r.key === "AI_PRICE_IN") input = v; else if (r.key === "AI_PRICE_OUT") output = v; else if (r.key === "AI_PRICE_CACHED") cached = v;
    }
  } catch { /* 표가 없거나 실패 — 환경변수로 */ }
  input = input || Number(env("OPENAI_PRICE_IN") || 0);
  output = output || Number(env("OPENAI_PRICE_OUT") || 0);
  cached = cached || Number(env("OPENAI_PRICE_CACHED") || 0);
  return { input, output, cached, known: input > 0 && output > 0 };
}

/** ai_usage 표에 한 줄 — 표가 없으면(SQL 미실행) 조용히 넘어간다 */
export async function logUsage(sbUrl: string, headers: Record<string, string>, row: { fn: string; model: string; question: string; author: string; usage: Usage; usd: number | null; ms: number }): Promise<void> {
  try {
    await fetch(`${sbUrl}/rest/v1/ai_usage`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({
      fn: row.fn, model: row.model, question: row.question.slice(0, 300), author: row.author.slice(0, 40),
      input_tokens: row.usage.input, cached_tokens: row.usage.cached, output_tokens: row.usage.output, reasoning_tokens: row.usage.reasoning, rounds: row.usage.rounds,
      usd: row.usd, ms: row.ms,
    }) });
  } catch { /* 기록 실패는 답을 막지 않는다 */ }
}
