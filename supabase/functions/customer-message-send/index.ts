const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const webhookUrl = Deno.env.get("CUSTOMER_MESSAGE_WEBHOOK_URL");
    if (!webhookUrl) return Response.json({ error: "CUSTOMER_MESSAGE_WEBHOOK_URL secret이 없습니다." }, { status: 500, headers: corsHeaders });

    const body = await req.json();
    if (body.action === "dispatch_due") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (!supabaseUrl || !serviceKey) return Response.json({ error: "Supabase server 환경변수가 없습니다." }, { status: 500, headers: corsHeaders });
      const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
      const dueUrl = `${supabaseUrl}/rest/v1/message_jobs?status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*&order=scheduled_at.asc&limit=50`;
      const dueResponse = await fetch(dueUrl, { headers: restHeaders });
      if (!dueResponse.ok) return Response.json({ error: await dueResponse.text() }, { status: 500, headers: corsHeaders });
      const jobs = await dueResponse.json() as Array<Record<string, unknown>>;
      let sent = 0;
      for (const job of jobs) {
        const id = String(job.id);
        const claim = await fetch(`${supabaseUrl}/rest/v1/message_jobs?id=eq.${id}&status=eq.scheduled`, { method: "PATCH", headers: { ...restHeaders, Prefer: "return=representation" }, body: JSON.stringify({ status: "processing", updated_at: new Date().toISOString() }) });
        const claimed = await claim.json().catch(() => []) as unknown[];
        if (!claim.ok || !claimed.length) continue;
        try {
          const provider = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(job.payload as object || {}), channel: job.channel, to: job.recipient, text: job.message, source: "FIRSTOA_CS_SYSTEM" }) });
          if (!provider.ok) throw new Error(`발송 웹훅 실패(${provider.status}): ${(await provider.text()).slice(0, 200)}`);
          await fetch(`${supabaseUrl}/rest/v1/message_jobs?id=eq.${id}`, { method: "PATCH", headers: restHeaders, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: "" }) });
          const sourceId = String(job.source_id || "");
          if (job.source_type === "happycall" && sourceId) {
            const remainingResponse = await fetch(`${supabaseUrl}/rest/v1/message_jobs?source_type=eq.happycall&source_id=eq.${encodeURIComponent(sourceId)}&status=in.(scheduled,processing,failed)&select=id&limit=1`, { headers: restHeaders });
            const remaining = remainingResponse.ok ? await remainingResponse.json() as unknown[] : [];
            if (!remaining.length) {
              await fetch(`${supabaseUrl}/rest/v1/happycall_messages?visit_id=eq.${encodeURIComponent(sourceId)}`, { method: "PATCH", headers: restHeaders, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), error: "" }) });
            }
          }
          sent += 1;
        } catch (error) {
          await fetch(`${supabaseUrl}/rest/v1/message_jobs?id=eq.${id}`, { method: "PATCH", headers: restHeaders, body: JSON.stringify({ status: "failed", updated_at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }) });
          if (job.source_type === "happycall" && job.source_id) {
            await fetch(`${supabaseUrl}/rest/v1/happycall_messages?visit_id=eq.${encodeURIComponent(String(job.source_id))}`, { method: "PATCH", headers: restHeaders, body: JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : String(error) }) });
          }
        }
      }
      return Response.json({ ok: true, processed: jobs.length, sent }, { headers: corsHeaders });
    }
    const channel = body.channel === "email" ? "email" : "sms";
    const rawTo = String(body.to || "").trim();
    const to = channel === "email" ? rawTo : rawTo.replace(/[^\d]/g, "");
    const text = String(body.text || "").trim();
    const validTarget = channel === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) : /^01\d{8,9}$/.test(to);
    if (!validTarget || !text) return Response.json({ error: "수신처 또는 메시지가 올바르지 않습니다." }, { status: 400, headers: corsHeaders });

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, channel, to, text, source: "FIRSTOA_CS_SYSTEM" }),
    });
    const detail = await response.text().catch(() => "");
    if (!response.ok) return Response.json({ error: `발송 웹훅 실패(${response.status}): ${detail.slice(0, 200)}` }, { status: 502, headers: corsHeaders });
    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: corsHeaders });
  }
});
