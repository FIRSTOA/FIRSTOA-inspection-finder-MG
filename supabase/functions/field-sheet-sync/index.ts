const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function enabled(value: unknown) {
  return String(value || "").toLowerCase() === "true";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const { jobId } = await req.json();
    if (!jobId) return Response.json({ error: "jobId가 필요합니다." }, { status: 400, headers: jsonHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const webhookUrl = Deno.env.get("FIELD_SHEETS_WEBHOOK_URL") || "";
    const webhookSecret = Deno.env.get("FIELD_SHEETS_WEBHOOK_SECRET") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase 서비스 키 설정이 없습니다.");

    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const rest = `${supabaseUrl}/rest/v1`;
    const jobRes = await fetch(`${rest}/field_sheet_sync_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`, { headers });
    const jobs = await jobRes.json();
    const job = jobs[0];
    if (!job) return Response.json({ error: "동기화 작업을 찾지 못했습니다." }, { status: 404, headers: jsonHeaders });
    if (job.sheet_status === "synced") return Response.json({ ok: true, status: "already_synced", row: job.sheet_row }, { headers: jsonHeaders });

    const configRes = await fetch(`${rest}/app_config?select=key,value`, { headers });
    const configRows = await configRes.json();
    const config = Object.fromEntries((configRows || []).map((row: { key: string; value: string }) => [row.key, row.value]));
    if (!enabled(config.FIELD_SHEET_SYNC_ENABLED)) {
      return Response.json({ ok: true, status: "held" }, { headers: jsonHeaders });
    }
    if (!webhookUrl || !webhookSecret) throw new Error("시트 웹훅 Secret 설정이 없습니다.");

    const sheetRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "append_field_sheet_row",
        secret: webhookSecret,
        jobId: job.id,
        category: job.category,
        testMode: enabled(config.FIELD_SHEET_TEST_MODE),
        author: job.author,
        submittedAt: job.created_at,
        sourceText: job.source_text,
        payload: job.payload,
      }),
    });
    const sheetData = await sheetRes.json().catch(() => ({}));
    if (!sheetRes.ok || !sheetData.ok) throw new Error(sheetData.error || `시트 응답 오류(${sheetRes.status})`);

    await fetch(`${rest}/field_sheet_sync_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ sheet_status: "synced", sheet_row: sheetData.row || null, synced_at: new Date().toISOString(), last_error: null, attempts: Number(job.attempts || 0) + 1 }),
    });
    return Response.json({ ok: true, status: "synced", row: sheetData.row || null, sheet: sheetData.sheet || "" }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
