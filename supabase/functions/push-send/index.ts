/**
 * 웹푸시 발송 — push_subscriptions의 구독으로 알림을 밀어넣는다.
 *
 * 요청: { title, body?, url?, tag?, all?: true | targets?: string[](이름), exclude?: string[] }
 *  - all이면 전 구독자, 아니면 targets 이름과 person이 일치하는 구독만.
 *  - exclude는 행위 당사자 제외용(자기가 등록한 공지 알림을 자기가 받지 않게).
 * 죽은 구독(404/410)은 발송 중 자동 삭제. VAPID 비밀키는 Secrets(VAPID_KEYS_JWK).
 */
import { ApplicationServer, importVapidKeys } from "jsr:@negrel/webpush@0.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

let appServerCache: ApplicationServer | null = null;
async function appServerOf(): Promise<ApplicationServer> {
  if (appServerCache) return appServerCache;
  const jwk = Deno.env.get("VAPID_KEYS_JWK") || "";
  if (!jwk) throw new Error("VAPID_KEYS_JWK 미설정 (Supabase Secrets)");
  const vapidKeys = await importVapidKeys(JSON.parse(jwk), { extractable: false });
  appServerCache = await ApplicationServer.new({
    contactInformation: Deno.env.get("VAPID_SUBJECT") || "mailto:firstoa95@gmail.com",
    vapidKeys,
  });
  return appServerCache;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    if (!title) return Response.json({ error: "title이 필요합니다" }, { status: 400, headers: jsonHeaders });

    const rest = `${Deno.env.get("SUPABASE_URL")}/rest/v1`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

    const targets = Array.isArray(body.targets) ? body.targets.map((v: unknown) => String(v).trim()).filter(Boolean) : [];
    let query = `${rest}/push_subscriptions?select=endpoint,p256dh,auth,person`;
    if (body.all !== true) {
      if (!targets.length) return Response.json({ ok: true, sent: 0, reason: "no_targets" }, { headers: jsonHeaders });
      const list = targets.map((t: string) => `"${t.replace(/"/g, "")}"`).join(",");
      query += `&person=in.(${encodeURIComponent(list)})`;
    }
    const rows = (await (await fetch(query, { headers: restHeaders })).json().catch(() => [])) as Array<{ endpoint: string; p256dh: string; auth: string; person: string }>;
    const exclude = new Set((Array.isArray(body.exclude) ? body.exclude : []).map((v: unknown) => String(v).trim()).filter(Boolean));
    const recipients = rows.filter((row) => !exclude.has(row.person));
    if (!recipients.length) return Response.json({ ok: true, sent: 0, reason: "no_subscribers" }, { headers: jsonHeaders });

    const appServer = await appServerOf();
    const payload = JSON.stringify({
      title: title.slice(0, 100),
      body: String(body.body || "").slice(0, 300),
      url: String(body.url || "/"),
      tag: body.tag ? String(body.tag).slice(0, 60) : undefined,
    });

    let sent = 0, gone = 0, failed = 0;
    await Promise.all(recipients.map(async (row) => {
      try {
        const sub = appServer.subscribe({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } });
        await sub.pushTextMessage(payload, {});
        sent += 1;
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status || 0;
        if (status === 404 || status === 410) {
          gone += 1; // 만료된 구독 — 지워서 다음 발송에서 제외
          await fetch(`${rest}/push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`, {
            method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" },
          }).catch(() => undefined);
        } else {
          failed += 1;
        }
      }
    }));
    return Response.json({ ok: true, sent, gone, failed }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
