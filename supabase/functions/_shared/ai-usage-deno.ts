/**
 * OpenAI 를 부르는 모든 엣지 함수가 한 줄로 사용량을 남기게 (2026-10-11 "예전부터 쓰던 AI 비용 이력이 왜 없어")
 * — 통합검색(entity-ask·data-ask) 말고도 리포트 다듬기·골든카드·성장노트·가이드 태그·OKR·플레이북·분기 결과·메뉴 사진·시트 보정이 OpenAI 를 쓴다.
 * 응답(data)의 usage 를 읽어 ai_usage 에 기록한다. 실패해도 본 기능은 막지 않는다(fire-and-forget).
 */
import { addUsage, emptyUsage, loadPrices, logUsage, priceUsage } from "./ai-usage.ts";

export async function recordOpenAiUsage(fn: string, model: string, data: unknown, opts: { question?: string; author?: string; t0?: number } = {}): Promise<void> {
  try {
    const sbUrl = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!sbUrl || !key) return;
    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const usage = addUsage(emptyUsage(), (data as { usage?: unknown } | null)?.usage);
    if (!usage.input && !usage.output) return;
    const prices = await loadPrices(sbUrl, headers, (k) => Deno.env.get(k), model);
    await logUsage(sbUrl, headers, { fn, model, question: opts.question || "", author: opts.author || "", usage, usd: priceUsage(usage, prices), ms: opts.t0 ? Date.now() - opts.t0 : 0 });
  } catch { /* 기록 실패는 무시 */ }
}
