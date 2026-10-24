/**
 * GAS 관리 동작 중계 — 관리 탭 [카톡 수집] 카드의 [지금 수집 실행]·[다시 넣기]·[끝난 작업 정리] (2026-10-24)
 * 설계: docs/tasks/kakao-collect-expand.md 3-7.
 *
 * first-data GAS 웹앱은 쓰기 동작에 관리 토큰(스크립트 속성 FIELD_ADMIN_TOKEN)을 요구한다. 토큰을 앱 번들에 넣을 수 없으므로
 * 앱은 이 함수를 anon 키로 부르고, 이 함수가 Supabase 시크릿 FIELD_ADMIN_TOKEN 을 붙여 GAS 를 부른다.
 *  - 시크릿이 없으면 503(잠긴 쪽으로 실패).
 *  - 허용 목록 ingestnow·retryheld·kakaoclear 만(그 밖 400). 위험한 동작은 GAS 편집기에서.
 *  - IP 당 분당 5회(이 인스턴스 안 — 대략적). 넘으면 429.
 *  - GAS 응답 JSON 을 그대로 돌려준다(토큰 글자는 가림). GAS 가 토큰 거부면 본문 {ok:false, status:403} 이 그대로 간다.
 * 한계: 이 함수도 anon 키로 부를 수 있다(SSO 서버 검증 없음). 공개 번들에 박힌 GAS 주소로 누구나 행 삭제를 부르던 구멍을 닫는 것이 목적.
 *
 * 요청 POST JSON { action: "ingestnow" | "retryheld" | "kakaoclear" }
 * 배포: npx supabase functions deploy gas-admin --project-ref kkdiihazgzesbqxjytqv --use-api
 */
import { allowedGasAction, createRateLimiter, gasAdminUrl, redactSecret } from "../_shared/gas-admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

// first-data GAS 웹앱 (src/api.ts GAS_GET_URL · photo-drive-archive GAS_URL 과 동일 배포)
const GAS_URL = "https://script.google.com/macros/s/AKfycbzoubwDNWFpiR7h9YTEfQBTM2wE69GeqXI4fjVJQ-wPdEsQ9thxASo2J4ydytaPXyoO/exec";
const PER_MIN = 5;
const GAS_TIMEOUT_MS = 140_000; // 엣지 요청 유휴 한도(150초) 안. ingestnow 는 GAS 쪽에서 몇 분 걸릴 수 있다
const limiter = createRateLimiter(PER_MIN);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, error: "Method not allowed" }, 405);

  const token = Deno.env.get("FIELD_ADMIN_TOKEN") || "";
  if (!token) return reply({ ok: false, error: "gas-admin: 시크릿 FIELD_ADMIN_TOKEN 이 설정되지 않았습니다." }, 503);

  const body = await req.json().catch(() => ({})) as { action?: unknown };
  const action = allowedGasAction(body.action);
  if (!action) return reply({ ok: false, error: `허용되지 않은 동작: ${String(body.action ?? "").slice(0, 40)}` }, 400);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (limiter.hit(ip)) return reply({ ok: false, error: "너무 잦은 요청입니다 — 1분 뒤 다시 시도해 주세요." }, 429);

  try {
    const res = await fetch(gasAdminUrl(GAS_URL, action, token), { redirect: "follow", signal: AbortSignal.timeout(GAS_TIMEOUT_MS) });
    const text = redactSecret(await res.text(), token);
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      return reply({ ok: false, error: `GAS 응답 해석 실패(${res.status}): ${text.slice(0, 160)}` }, 502);
    }
    console.log("gas-admin", JSON.stringify({ action, ip, gasStatus: res.status, ok: (data as { ok?: unknown })?.ok ?? null }));
    return reply(data);
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "TimeoutError";
    const msg = timeout ? "GAS 응답 시간 초과 — GAS 는 계속 돌고 있을 수 있습니다. 잠시 뒤 새로고침해 확인하세요." : (error instanceof Error ? error.message : String(error));
    return reply({ ok: false, error: redactSecret(msg, token) }, timeout ? 504 : 500);
  }
});
