import { describe, expect, it } from "vitest";
import { addUsage, defaultPricesFor, emptyUsage, priceUsage } from "../supabase/functions/_shared/ai-usage.ts";

describe("AI 사용량 집계·단가 (2026-10-10)", () => {
  it("설정이 없으면 모델 이름으로 공식 가격표 기본값(gpt-5.5 = 5/0.5/30), 모르는 모델은 미설정", () => {
    expect(defaultPricesFor("gpt-5.5")).toMatchObject({ input: 5, cached: 0.5, output: 30, known: true });
    expect(defaultPricesFor("gpt-5.5-pro")).toMatchObject({ input: 30, output: 180 });
    expect(defaultPricesFor("gpt-5.4-mini")).toMatchObject({ input: 0.75, output: 4.5 });
    expect(defaultPricesFor("gpt-5")).toMatchObject({ input: 1.25, output: 10 });
    expect(defaultPricesFor("claude-x").known).toBe(false);
  });
  it("Responses API usage 를 왕복마다 누적한다(캐시·추리 토큰 포함)", () => {
    let u = emptyUsage();
    u = addUsage(u, { input_tokens: 30000, output_tokens: 1200, input_tokens_details: { cached_tokens: 12000 }, output_tokens_details: { reasoning_tokens: 500 } });
    u = addUsage(u, { input_tokens: 31000, output_tokens: 800, input_tokens_details: { cached_tokens: 30000 }, output_tokens_details: { reasoning_tokens: 300 } });
    expect(u).toEqual({ input: 61000, cached: 42000, output: 2000, reasoning: 800, rounds: 2 });
    expect(addUsage(emptyUsage(), undefined)).toEqual({ input: 0, cached: 0, output: 0, reasoning: 0, rounds: 1 });
  });
  it("단가를 모르면 null, 알면 (입력−캐시)×입력 + 캐시×캐시 + 출력×출력 (100만 토큰당 달러)", () => {
    const u = { input: 1_000_000, cached: 400_000, output: 100_000, reasoning: 20_000, rounds: 1 };
    expect(priceUsage(u, { input: 0, output: 0, cached: 0, known: false })).toBeNull();
    expect(priceUsage(u, { input: 2, output: 8, cached: 0.5, known: true })).toBeCloseTo(600_000 * 2e-6 + 400_000 * 0.5e-6 + 100_000 * 8e-6, 6);
    expect(priceUsage(u, { input: 2, output: 8, cached: 0, known: true })).toBeCloseTo(1_000_000 * 2e-6 + 100_000 * 8e-6, 6); // 캐시 단가 없으면 입력 단가로
  });
});
