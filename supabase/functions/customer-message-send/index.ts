// ---- 솔라피(SOLAPI) 문자 발송 — Secrets: SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER ----
async function solapiAuth(): Promise<{ headers: Record<string, string>; sender: string }> {
  const apiKey = Deno.env.get("SOLAPI_API_KEY") || "";
  const apiSecret = Deno.env.get("SOLAPI_API_SECRET") || "";
  const sender = (Deno.env.get("SOLAPI_SENDER") || "").replace(/[^\d]/g, "");
  if (!apiKey || !apiSecret || !sender) throw new Error("솔라피 설정 누락 (SOLAPI_API_KEY/SECRET/SENDER)");
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const keyData = new TextEncoder().encode(apiSecret);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(date + salt));
  const signature = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { headers: { Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`, "Content-Type": "application/json" }, sender };
}
// 사진(MMS) 첨부 — 솔라피 저장소에 JPG(≤200KB, base64)를 올리고 fileId를 받는다. 홍보물 문자에 사진이 그대로 가게(2026-09-26 요청)
async function solapiUploadImage(base64: string): Promise<string> {
  const { headers } = await solapiAuth();
  const res = await fetch("https://api.solapi.com/storage/v1/files", { method: "POST", headers, body: JSON.stringify({ file: base64, type: "MMS", name: "promo.jpg" }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.fileId) throw new Error(`솔라피 사진 업로드 실패(${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  return String(data.fileId);
}
async function solapiSend(to: string, text: string, opts: { imageId?: string; subject?: string } = {}): Promise<void> {
  const { headers, sender } = await solapiAuth();
  const message: Record<string, unknown> = { to, from: sender, text };
  if (opts.imageId) { message.type = "MMS"; message.imageId = opts.imageId; message.subject = (opts.subject || "안내").slice(0, 40); }
  const res = await fetch("https://api.solapi.com/messages/v4/send-many/detail", {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: [message] }), // 사진 없으면 90바이트 초과 시 LMS 자동 전환(autoTypeDetect 기본)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`솔라피 발송 실패(${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  const failed = (data.failedMessageList || []) as Array<{ statusMessage?: string }>;
  if (failed.length) throw new Error(`솔라피 발송 실패: ${failed[0]?.statusMessage || "알 수 없는 오류"}`);
}

// ---- 발송 제한·기록 (2026-10-10) ----
// 앱 화면이 보내는 종류만 받는다(해피콜·홍보·고객 리포트·점검 리포트 MMS·분기 안내 테스트). 모르는 종류는 거절.
const KNOWN_TYPES = new Set(["happycall", "promotion", "report", "inspection_report", "quarter_notice_test"]);
const kstDayStartIso = () => { const now = new Date(); const kst = new Date(now.getTime() + 9 * 3600_000); kst.setUTCHours(0, 0, 0, 0); return new Date(kst.getTime() - 9 * 3600_000).toISOString(); };
async function countRows(sbUrl: string, h: Record<string, string>, query: string): Promise<number> {
  try {
    const res = await fetch(`${sbUrl}/rest/v1/message_jobs?select=id&${query}&limit=1`, { headers: { ...h, Prefer: "count=exact" } });
    const range = res.headers.get("content-range") || "";                 // "0-0/123"
    return Number(range.split("/")[1] || 0) || 0;
  } catch { return 0; }
}
async function configNumber(sbUrl: string, h: Record<string, string>, key: string): Promise<number> {
  try {
    const res = await fetch(`${sbUrl}/rest/v1/app_config?select=value&key=eq.${encodeURIComponent(key)}&limit=1`, { headers: h });
    const rows = await res.json();
    return Number(rows?.[0]?.value || 0) || 0;
  } catch { return 0; }
}
/** 시간당·하루·수신번호당 상한, 그리고 하루 건수가 30일 평균의 3배를 넘으면 차단. app_config SMS_HOURLY_CAP / SMS_DAILY_CAP 로 바꿀 수 있다 */
async function checkSendLimits(sbUrl: string, h: Record<string, string>, p: { channel: string; to: string; type: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!sbUrl || !h.apikey) return { ok: true };
  const nowMs = Date.now();
  const hourAgo = new Date(nowMs - 3600_000).toISOString();
  const dayStart = kstDayStartIso();
  const d30 = new Date(nowMs - 30 * 86400_000).toISOString();
  const base = `source_type=like.direct*&status=eq.sent&channel=eq.${encodeURIComponent(p.channel)}`;
  const [hour, today, toToday, last30, hourlyCap, dailyCap] = await Promise.all([
    countRows(sbUrl, h, `${base}&sent_at=gte.${encodeURIComponent(hourAgo)}`),
    countRows(sbUrl, h, `${base}&sent_at=gte.${encodeURIComponent(dayStart)}`),
    countRows(sbUrl, h, `${base}&recipient=eq.${encodeURIComponent(p.to)}&sent_at=gte.${encodeURIComponent(dayStart)}`),
    countRows(sbUrl, h, `${base}&sent_at=gte.${encodeURIComponent(d30)}`),
    configNumber(sbUrl, h, p.channel === "email" ? "EMAIL_HOURLY_CAP" : "SMS_HOURLY_CAP"),
    configNumber(sbUrl, h, p.channel === "email" ? "EMAIL_DAILY_CAP" : "SMS_DAILY_CAP"),
  ]);
  const avgDaily = last30 / 30;
  const hCap = hourlyCap || 40;
  const dCap = dailyCap || Math.max(80, Math.ceil(avgDaily * 3));   // 평소(30일 평균)의 3배, 바닥 80
  const perTo = 5;
  if (toToday >= perTo) return { ok: false, reason: `같은 번호(${p.to})로 오늘 ${toToday}건 — 하루 ${perTo}건까지` };
  if (hour >= hCap) return { ok: false, reason: `최근 1시간 ${hour}건 — 시간당 ${hCap}건까지(관리 탭 app_config SMS_HOURLY_CAP)` };
  if (today >= dCap) return { ok: false, reason: `오늘 ${today}건 — 하루 ${dCap}건까지(30일 평균 ${avgDaily.toFixed(1)}건의 3배, SMS_DAILY_CAP 로 조정)` };
  return { ok: true };
}
async function logDirect(sbUrl: string, h: Record<string, string>, r: { channel: string; to: string; text: string; type: string; vendor: string; author: string; status: "sent" | "failed" | "blocked"; error?: string; mms?: boolean }): Promise<void> {
  if (!sbUrl || !h.apikey) return;
  const now = new Date().toISOString();
  try {
    await fetch(`${sbUrl}/rest/v1/message_jobs`, { method: "POST", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({
      source_type: `direct:${r.type}`, source_id: null, channel: r.channel, recipient: r.to, message: r.text.slice(0, 2000),
      payload: { type: r.type, vendor: r.vendor, author: r.author, mms: !!r.mms }, scheduled_at: now, status: r.status, created_by: r.author || "앱",
      sent_at: r.status === "sent" ? now : null, error: r.error || "", created_at: now, updated_at: now,
    }) });
  } catch { /* 기록 실패는 발송을 막지 않는다 */ }
}
/** 차단되면 담당자에게 웹푸시 — 1시간에 한 번만 */
async function alertBlocked(sbUrl: string, h: Record<string, string>, reason: string, p: { to: string; type: string; author: string }): Promise<void> {
  if (!sbUrl || !h.apikey) return;
  const recent = await countRows(sbUrl, h, `source_type=like.direct*&status=eq.blocked&created_at=gte.${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`);
  if (recent > 1) return;
  try {
    await fetch(`${sbUrl}/functions/v1/push-send`, { method: "POST", headers: h, body: JSON.stringify({
      title: "고객 문자 발송이 제한에 걸렸어요", body: `${reason} · 종류 ${p.type} · 보낸이 ${p.author || "모름"} · 수신 ${p.to}`, tag: "sms-blocked", category: "admin", targets: ["이민구"], url: "/",
    }) });
  } catch { /* 알림 실패 무시 */ }
}

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
    const sbUrl = Deno.env.get("SUPABASE_URL") || "";
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" };

    const body = await req.json();
    if (body.action === "import_history") {
      // 솔라피에 남아 있는 과거 발송 내역 → message_jobs(direct:import). 비용 현황의 "지금까지"가 앱 기록(2026-10-10) 이전까지 보이게(2026-10-11).
      // 홈 비용 창의 단추로만 부른다. dry 면 세기만 하고 넣지 않는다. 같은 messageId 는 두 번 넣지 않는다(payload.message_id).
      const days = Math.min(730, Math.max(1, Number(body.days) || 365));
      const dry = body.dry === true;
      const sbUrl2 = Deno.env.get("SUPABASE_URL") || ""; const sbKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const sbHeaders2 = { apikey: sbKey2, Authorization: `Bearer ${sbKey2}`, "Content-Type": "application/json" };
      const { headers: solapiHeaders } = await solapiAuth();
      const start = new Date(Date.now() - days * 86400_000).toISOString();
      let startKey = ""; let fetched = 0; let inserted = 0; let skipped = 0; const errors: string[] = []; const byType: Record<string, number> = {}; let sample: unknown = null;
      for (let page = 0; page < 60; page += 1) {
        const url = `https://api.solapi.com/messages/v4/list?limit=500&dateType=CREATED&startDate=${encodeURIComponent(start)}${startKey ? `&startKey=${encodeURIComponent(startKey)}` : ""}`;
        const res = await fetch(url, { headers: solapiHeaders });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { errors.push(`솔라피 ${res.status}: ${JSON.stringify(data).slice(0, 300)}`); break; }
        const raw = data.messageList;
        const list = (Array.isArray(raw) ? raw : Object.values(raw || {})) as Array<Record<string, unknown>>;
        if (!list.length) break;
        if (!sample) sample = { keys: Object.keys(list[0]), type: list[0].type, status: list[0].status, statusCode: list[0].statusCode, dateCreated: list[0].dateCreated };
        fetched += list.length;
        list.forEach((m) => { const t = String(m.type || "?"); byType[t] = (byType[t] || 0) + 1; });
        const ok = list.filter((m) => m.messageId && /^4/.test(String(m.statusCode || "")));
        if (!dry) {
          const ids = ok.map((m) => String(m.messageId));
          const existing = new Set<string>();
          for (let i = 0; i < ids.length; i += 100) {
            const chunk = ids.slice(i, i + 100).map((v) => `"${v}"`).join(",");
            const ex = await fetch(`${sbUrl2}/rest/v1/message_jobs?select=payload&source_type=eq.direct:import&payload->>message_id=in.(${encodeURIComponent(chunk)})`, { headers: sbHeaders2 }).then((r) => r.json()).catch(() => []);
            (Array.isArray(ex) ? ex : []).forEach((r: { payload?: { message_id?: string } }) => { if (r.payload?.message_id) existing.add(String(r.payload.message_id)); });
          }
          const now = new Date().toISOString();
          const rows = ok.filter((m) => !existing.has(String(m.messageId))).map((m) => {
            const when = String(m.dateCreated || now);
            return {
              source_type: "direct:import", source_id: null, channel: "sms", recipient: String(m.to || ""), message: String(m.text || "").slice(0, 2000),
              payload: { type: "import", message_id: String(m.messageId), solapi_type: String(m.type || ""), mms: String(m.type || "") === "MMS", status: String(m.status || ""), statusCode: String(m.statusCode || "") },
              scheduled_at: when, status: "sent", created_by: "솔라피 가져오기", sent_at: when, error: "", created_at: when, updated_at: now,
            };
          });
          if (rows.length) {
            const ins = await fetch(`${sbUrl2}/rest/v1/message_jobs`, { method: "POST", headers: { ...sbHeaders2, Prefer: "return=minimal" }, body: JSON.stringify(rows) });
            if (!ins.ok) { errors.push(`저장 ${ins.status}: ${(await ins.text().catch(() => "")).slice(0, 200)}`); break; }
            inserted += rows.length;
          }
          skipped += list.length - rows.length;
        }
        startKey = String(data.nextKey || "");
        if (!startKey) break;
      }
      return Response.json({ ok: true, dry, days, fetched, inserted, skipped, byType, sample, errors }, { headers: corsHeaders });
    }
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
          if (String(job.channel) === "sms") {
            await solapiSend(String(job.recipient || "").replace(/[^\d]/g, ""), String(job.message || ""));
          } else {
            const provider = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(job.payload as object || {}), channel: job.channel, to: job.recipient, text: job.message, source: "FIRSTOA_CS_SYSTEM" }) });
            const providerBody = await provider.text().catch(() => "");
            if (!provider.ok) throw new Error(`발송 웹훅 실패(${provider.status}): ${providerBody.slice(0, 200)}`);
            // GAS 웹훅은 항상 HTTP 200 — 본문 ok=false를 실패로 처리 (예약발송이 실패인데 sent로 남지 않게)
            try {
              const parsedBody = JSON.parse(providerBody);
              if (parsedBody && parsedBody.ok === false) throw new Error(`발송 실패: ${String(parsedBody.error || "").slice(0, 200)}`);
            } catch (parseError) {
              if (parseError instanceof Error && parseError.message.startsWith("발송 실패")) throw parseError;
            }
          }
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

    // ── 발송 제한(2026-10-10 점검): 이 함수는 공개 anon 키로 누구나 부를 수 있다. 비밀값은 번들에 들어가면 공개라 의미가 없고,
    //    대신 "평소보다 훨씬 많이 나가면 막는다"(사용자 결정) — 시간당·하루·수신번호당 건수 상한 + 30일 평균의 3배 넘으면 차단 + 담당자 푸시.
    //    직접 발송은 전부 message_jobs 에 기록(source_type direct)해서 통합검색·집계·제한 계산의 근거로 쓴다.
    const type = String(body.type || "").trim();
    const author = String(body.author || "").trim();
    const vendor = String(body.vendor || "").trim();
    if (!KNOWN_TYPES.has(type)) return Response.json({ error: `알 수 없는 발송 종류(${type || "없음"}) — 앱 화면에서 보내 주세요` }, { status: 400, headers: corsHeaders });
    const limit = await checkSendLimits(sbUrl, sbHeaders, { channel, to, type });
    if (!limit.ok) {
      await logDirect(sbUrl, sbHeaders, { channel, to, text, type, vendor, author, status: "blocked", error: limit.reason });
      await alertBlocked(sbUrl, sbHeaders, limit.reason, { to, type, author });
      return Response.json({ error: `발송 제한: ${limit.reason}` }, { status: 429, headers: corsHeaders });
    }

    if (channel === "sms") {
      // imageBase64(JPG, ≤200KB)가 오면 MMS로 — 사진이 문자에 바로 뜬다
      const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.replace(/^data:image\/\w+;base64,/, "") : "";
      const imageId = imageBase64 ? await solapiUploadImage(imageBase64) : "";
      try {
        await solapiSend(to, text, imageId ? { imageId, subject: String(body.subject || "") } : {}); // 실패 시 throw → 아래 catch가 오류로 응답
      } catch (e) {
        await logDirect(sbUrl, sbHeaders, { channel, to, text, type, vendor, author, status: "failed", error: (e as Error).message });
        throw e;
      }
      await logDirect(sbUrl, sbHeaders, { channel, to, text, type, vendor, author, status: "sent", mms: !!imageId });
      return Response.json({ ok: true, provider: "solapi", mms: !!imageId }, { headers: corsHeaders });
    }
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, channel, to, text, source: "FIRSTOA_CS_SYSTEM" }),
    });
    const detail = await response.text().catch(() => "");
    if (!response.ok) return Response.json({ error: `발송 웹훅 실패(${response.status}): ${detail.slice(0, 200)}` }, { status: 502, headers: corsHeaders });
    // GAS 웹훅은 항상 HTTP 200을 주므로 본문의 ok 플래그로 실패를 감지한다
    try {
      const parsed = JSON.parse(detail);
      if (parsed && parsed.ok === false) { await logDirect(sbUrl, sbHeaders, { channel, to, text, type, vendor, author, status: "failed", error: String(parsed.error || "").slice(0, 200) }); return Response.json({ error: `발송 실패: ${String(parsed.error || "").slice(0, 200)}` }, { status: 502, headers: corsHeaders }); }
    } catch { /* JSON이 아니면 성공으로 간주 */ }
    await logDirect(sbUrl, sbHeaders, { channel, to, text, type, vendor, author, status: "sent" });
    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: corsHeaders });
  }
});
