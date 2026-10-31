/**
 * 사진 분기 아카이브 — 오래된 사진을 드라이브로 옮기고 스토리지를 비운다.
 *
 * 실제 드라이브 저장은 GAS(first-data 웹앱 ?action=photoarchive)가 한다:
 * 구글이 서비스 계정의 드라이브 저장 용량을 없애서("Service Accounts do not have
 * storage quota") 엣지에서 직접 업로드가 불가능하다. GAS는 사용자(firstoa95) 계정으로
 * 실행되므로 파일이 사용자 소유로 저장된다. 이 함수는 진입점·중계 역할:
 * pg_cron(매시)과 CS 웹앱이 여기를 부르고, 여기가 GAS를 부른다.
 *
 * 액션(POST JSON):
 *  - { action: "status", days? }             대상 수 확인 (변경 없음)
 *  - { action: "archive", days?, limit? }    GAS에 위임해 이관 실행, 결과 중계
 *
 * 매핑·폴백: GAS가 photo_assets.drive_file_id를 기록하고, get_photo_album이
 * 드라이브 썸네일로 폴백하므로 기존 앨범 링크(?album=)는 계속 열린다.
 */

import { redactSecret } from "../_shared/gas-admin.ts";
import { GAS_TIMEOUT_MS, contentRangeTotal, judgeGasResponse } from "./rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

// first-data GAS 웹앱 (src/api.ts GAS_GET_URL과 동일 배포)
const GAS_URL = "https://script.google.com/macros/s/AKfycbzoubwDNWFpiR7h9YTEfQBTM2wE69GeqXI4fjVJQ-wPdEsQ9thxASo2J4ydytaPXyoO/exec";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase 서비스 키 설정이 없습니다.");

    const days = Math.min(Math.max(Number(body.days) || 90, 7), 3650);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

    if (action === "status") {
      const count = async (filter: string) => {
        const res = await fetch(`${supabaseUrl}/rest/v1/photo_assets?${filter}&select=id`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" },
        });
        // 응답 상태를 본다 — 실패를 0건으로 보이면 "옮길 사진 없음"으로 잘못 읽힌다(2026-10-31)
        if (!res.ok) throw new Error(`photo_assets 건수 조회 실패(HTTP ${res.status}): ${(await res.text().catch(() => "")).slice(0, 160)}`);
        const total = contentRangeTotal(res.headers.get("content-range"));
        if (total === null) throw new Error(`photo_assets 건수 없음(content-range=${res.headers.get("content-range") || "없음"})`);
        return total;
      };
      const candidates = await count(`drive_file_id=is.null&created_at=lt.${cutoff}`);
      const archivedTotal = await count("drive_file_id=not.is.null");
      return Response.json({ ok: true, days, candidates, archivedTotal, engine: "GAS(photoarchive)" }, { headers: jsonHeaders });
    }

    if (action !== "archive") throw new Error(`알 수 없는 action: ${action}`);
    const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 200);
    // photoarchive 는 GAS 관리 토큰 필요(2026-10-24, 설계 kakao-collect-expand 3-7). 시크릿이 없으면 GAS 가 {ok:false,status:403} 본문을 준다 → 403 실패로 응답(2026-10-31)
    const token = Deno.env.get("FIELD_ADMIN_TOKEN") ?? "";
    // 타임아웃 140초(크론 150초 안, 2026-10-31 — 없을 때 7일 83회 150초 초과). GAS 는 계속 돌 수 있으나 이번 실행은 실패로 남긴다
    const res = await fetch(`${GAS_URL}?action=photoarchive&limit=${limit}&days=${days}&token=${encodeURIComponent(token)}`, { redirect: "follow", signal: AbortSignal.timeout(GAS_TIMEOUT_MS) });
    const text = redactSecret(await res.text(), token);
    const verdict = judgeGasResponse(res.status, text);
    if (!verdict.ok) {
      console.error("photo-drive-archive gas-failed", JSON.stringify({ httpStatus: res.status, status: verdict.status, error: verdict.error }));
      return Response.json({ ok: false, error: verdict.error, gas: verdict.data ?? null }, { status: verdict.status, headers: jsonHeaders });
    }
    return Response.json(verdict.data, { headers: jsonHeaders });
  } catch (error) {
    const timeout = !!error && typeof error === "object" && (error as { name?: unknown }).name === "TimeoutError";
    const msg = timeout ? `GAS 응답 시간 초과(${GAS_TIMEOUT_MS / 1000}초) — GAS 는 계속 돌고 있을 수 있습니다` : (error instanceof Error ? error.message : String(error));
    console.error("photo-drive-archive error", msg);
    return Response.json({ error: redactSecret(msg, Deno.env.get("FIELD_ADMIN_TOKEN") ?? "") }, { status: timeout ? 504 : 500, headers: jsonHeaders });
  }
});
