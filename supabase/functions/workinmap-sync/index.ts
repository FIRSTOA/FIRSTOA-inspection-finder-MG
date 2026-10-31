/**
 * workinmap-sync — 워킨맵(workinmap.com) → 웹앱 workin_map_places 가져오기(P1) · 2026-10-31
 * 설계: docs/tasks/workinmap-sync-2026-10-31.md v2 · SQL: supabase/workin-sync-20261031.sql(표다빈)
 *
 * 요청: POST JSON
 *   { action: "works" }                                         계정별 workList4 → 이름 규칙 해석 → workin_sync_works upsert, 응답에 해석표
 *   { action: "pull", scope?: "current"|"old"|"<워크 id>", dryRun?: true }
 *                                                               이번 분기 / 지난 분기(목록 수정일 바뀐 것만) / 워크 하나.
 *                                                               dryRun 이거나 app_config WORKINMAP_SYNC_ENABLED 가 'true' 가 아니면 쓰지 않고 차이만.
 *   { action: "status" }                                        계정(토큰 칸 없음)·워크·미처리 확인 큐 수
 *   { action: "login_test", account: n }                        계정 n 멈춤 풀고 로그인만(응답에 토큰·이메일 없음)
 *   { action: "push" }                                          P2 전 — { ok:true, skipped:"push_disabled" }
 * 인증: schedule-report 와 같은 규칙(이 프로젝트 anon/service_role JWT · 만료 전, 또는 service role 키). 크론은 ops.call_edge(vault field_cron_jwt).
 * secrets: WORKINMAP_n_EMAIL / WORKINMAP_n_PASSWORD (n=1..9) — 사용자가 대시보드에 직접. 코드·로그·응답에 값 없음.
 * 실행부는 sync.ts(fetch 주입, vitest 로 검사), 규칙은 plan.ts, 로그인은 auth.ts, 워킨맵 읽기는 api.ts.
 */
import { isAuthorized, parseRequest, projectRefOf } from "./plan.ts";
import { runAction } from "./sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "POST 만" }, { status: 405, headers: jsonHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorized = isAuthorized(req.headers.get("authorization"), { projectRef: projectRefOf(supabaseUrl), serviceKey, nowMs: Date.now() });
  if (!authorized) return Response.json({ error: "인증된 호출만 받습니다" }, { status: 403, headers: jsonHeaders });
  if (!supabaseUrl || !serviceKey) return Response.json({ error: "SUPABASE_URL·SERVICE_ROLE_KEY 없음" }, { status: 500, headers: jsonHeaders });

  const parsed = parseRequest(await req.json().catch(() => ({})));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400, headers: jsonHeaders });

  try {
    const out = await runAction(parsed, {
      fetchFn: (input, init) => fetch(input, init),
      supabaseUrl,
      serviceKey,
      getEnv: (k) => Deno.env.get(k),
      now: () => Date.now(),
      holder: crypto.randomUUID(),
    });
    return Response.json(out.body, { status: out.status, headers: jsonHeaders });
  } catch (e) {
    // 비밀값은 auth.ts 가 오류 문구에 넣지 않는다 — 여기서는 메시지만
    const msg = e instanceof Error ? e.message : String(e);
    console.error("workinmap-sync 실패", msg);
    return Response.json({ ok: false, error: msg.slice(0, 300) }, { status: 500, headers: jsonHeaders });
  }
});
