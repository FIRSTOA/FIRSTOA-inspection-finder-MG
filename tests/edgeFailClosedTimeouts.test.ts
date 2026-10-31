import { describe, expect, it } from "vitest";
import { SendLimitCheckError, SEND_LIMIT_CHECK_FAILED, checkSendLimits, countRows, parseContentRangeTotal } from "../supabase/functions/customer-message-send/limits";
import { contentRangeTotal, judgeGasResponse } from "../supabase/functions/photo-drive-archive/rules";
import { AI_TIMEOUT_MESSAGE, aiTimeoutResponse, aiTimeoutSignal, isAiTimeout } from "../supabase/functions/_shared/ai-timeout";

const h = { apikey: "k", Authorization: "Bearer k" };
const countRes = (total: string, status = 200) => new Response(status < 300 ? "[]" : "boom", { status, headers: { "content-range": total } });

describe("customer-message-send 발송 상한 — 건수 조회 실패면 막는다(2026-10-31)", () => {
  it("content-range 해석: 숫자·*/0 은 건수, 건수 없음(*)·빈 값은 null", () => {
    expect(parseContentRangeTotal("0-0/123")).toBe(123);
    expect(parseContentRangeTotal("*/0")).toBe(0);
    expect(parseContentRangeTotal("0-0/*")).toBeNull();
    expect(parseContentRangeTotal(null)).toBeNull();
  });

  it("건수 조회가 500 이면 0 으로 통과시키지 않고 SendLimitCheckError", async () => {
    const fetchFn = async () => countRes("", 500);
    await expect(countRows(fetchFn, "https://x", h, "a=b")).rejects.toBeInstanceOf(SendLimitCheckError);
  });

  it("checkSendLimits: 건수 하나라도 네트워크 오류면 던진다(메시지에 '발송 한도 확인 실패')", async () => {
    const fetchFn = async (url: string) => {
      if (url.includes("/app_config")) return new Response("[]", { status: 200 });
      if (url.includes("recipient=eq.")) throw new TypeError("network down");
      return countRes("*/0");
    };
    await expect(checkSendLimits(fetchFn, "https://x", h, { channel: "sms", to: "01000000000", type: "happycall" }))
      .rejects.toThrow(SEND_LIMIT_CHECK_FAILED);
  });

  it("설정값(app_config) 조회 실패는 기본 상한으로 진행 — 시간당 40건이면 막힘, 39건이면 통과", async () => {
    const mk = (hour: number) => async (url: string) => {
      if (url.includes("/app_config")) throw new TypeError("config down");
      if (url.includes("recipient=eq.")) return countRes("*/0");
      if (url.includes(encodeURIComponent(new Date(NOW - 3600_000).toISOString()))) return countRes(`0-0/${hour}`);
      return countRes("*/0");
    };
    const NOW = Date.parse("2026-10-31T05:00:00Z");
    const p = { channel: "sms", to: "01000000000", type: "happycall" };
    expect((await checkSendLimits(mk(40), "https://x", h, p, NOW)).ok).toBe(false);
    expect((await checkSendLimits(mk(39), "https://x", h, p, NOW)).ok).toBe(true);
  });
});

describe("photo-drive-archive GAS 응답 판정(2026-10-31)", () => {
  it("{ok:true} 는 성공, 그대로 넘긴다", () => {
    expect(judgeGasResponse(200, JSON.stringify({ ok: true, archived: 3 }))).toEqual({ ok: true, data: { ok: true, archived: 3 } });
  });
  it("{ok:false,status:403} 본문은 HTTP 200 이어도 403 실패", () => {
    const v = judgeGasResponse(200, JSON.stringify({ ok: false, status: 403, error: "forbidden" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(403);
  });
  it("ok 없이 error 만 있는 본문·JSON 아닌 본문·HTTP 5xx 는 502", () => {
    for (const v of [
      judgeGasResponse(200, JSON.stringify({ error: "SUPABASE_SERVICE_KEY 미설정" })),
      judgeGasResponse(200, "<html>Google 오류</html>"),
      judgeGasResponse(500, JSON.stringify({ ok: true })),
      judgeGasResponse(200, JSON.stringify({ ok: false, error: "x" })),
    ]) {
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.status).toBe(502);
    }
  });
  it("status 건수: 건수 없는 content-range 는 null(0 으로 보이지 않게)", () => {
    expect(contentRangeTotal("0-0/7")).toBe(7);
    expect(contentRangeTotal("")).toBeNull();
  });
});

describe("AI 호출 타임아웃 공용 도우미(2026-10-31)", () => {
  it("AbortSignal.timeout 으로 끊긴 fetch 를 시간 초과로 알아보고 504 + 안내 문구", async () => {
    const hang = (_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
    });
    const err = await hang("https://api.openai.com/v1/responses", { signal: aiTimeoutSignal(20) }).catch((e) => e);
    expect(isAiTimeout(err)).toBe(true);
    const res = aiTimeoutResponse({ "Access-Control-Allow-Origin": "*" });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: AI_TIMEOUT_MESSAGE });
  });
  it("일반 오류는 시간 초과로 보지 않는다", () => {
    expect(isAiTimeout(new Error("boom"))).toBe(false);
    expect(isAiTimeout(null)).toBe(false);
  });
});
