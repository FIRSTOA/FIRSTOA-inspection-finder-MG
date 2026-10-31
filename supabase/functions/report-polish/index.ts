import { polishReportLines, REPORT_POLISH_DEFAULT_MODEL } from "../_shared/report/polish.ts";
/**
 * 중간보고 다듬기 — 일정 원문(업체·기종·내용)을 사람이 쓰던 보고 줄로 압축한다.
 *
 * 규칙 기반 축약의 한계(제목 "A/S…"에서 업체가 "A"로 잘리는 류)를 LLM으로 넘는다.
 * 요청: { lines: [{ vendor, title, note, model, issue, category, kind }] }  (kind: "as" | "물류")
 * 응답: { lines: ["쇼군웨이크스노우보드 3220 소음", ...], model }  — 입력과 같은 순서·개수
 * 2026-10-31: 프롬프트·입력 자르기·응답 검증은 _shared/report/polish.ts — 자동 중간보고(schedule-report)와 같은 글이 나오게 한 벌만 둔다.
 * 요청·응답 모양은 그대로(화면 CsAsWorkspace 가 부른다).
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return Response.json({ error: "lines가 필요합니다" }, { status: 400, headers: jsonHeaders });
    const model = Deno.env.get("OPENAI_REPORT_MODEL") || REPORT_POLISH_DEFAULT_MODEL;
    const res = await polishReportLines(lines, { apiKey, model, fnTag: "report-polish" });
    if (!res.ok) return Response.json({ error: res.error, model: res.model }, { status: res.status, headers: jsonHeaders });
    return Response.json({ lines: res.lines, model: res.model }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
