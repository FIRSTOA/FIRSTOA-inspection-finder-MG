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
