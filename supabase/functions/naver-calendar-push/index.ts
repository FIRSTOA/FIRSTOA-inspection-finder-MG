// 네이버 캘린더 일정 등록 (등록 전용 — 네이버 API에 조회·수정·삭제는 없다)
// 팀 공용 네이버 계정의 refresh token을 Secrets에 보관하고, 호출마다 access token을 갱신해 등록한다.
// 원본은 웹앱 일정리스트(as_tickets) — 네이버 캘린더는 보기용 미러. 취소·변경은 네이버에 반영되지 않는다.
//
// Secrets: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET / NAVER_REFRESH_TOKEN / (선택) NAVER_CALENDAR_ID
// app_config: NAVER_CALENDAR_ENABLED = true 일 때만 동작 (프론트에서도 체크하지만 서버에서 한 번 더)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function icalEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function buildIcal(input: { title: string; date: string; time: string; location: string; description: string }) {
  const [y, m, d] = input.date.split("-").map(Number);
  const [hh, mm] = (input.time || "09:00").split(":").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = (h: number, min: number) => `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
  const endMin = mm + 60; // 기본 1시간
  const uid = `firstoa-${crypto.randomUUID()}`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:FirstOA CS Webapp",
    "CALSCALE:GREGORIAN",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Seoul",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZNAME:GMT+09:00",
    "TZOFFSETFROM:+0900",
    "TZOFFSETTO:+0900",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;TZID=Asia/Seoul:${stamp(hh, mm)}`,
    `DTEND;TZID=Asia/Seoul:${stamp(hh + Math.floor(endMin / 60), endMin % 60)}`,
    `SUMMARY:${icalEscape(input.title)}`,
    input.location ? `LOCATION:${icalEscape(input.location)}` : "",
    input.description ? `DESCRIPTION:${icalEscape(input.description)}` : "",
    "CLASS:PUBLIC",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    // 최초 연동: 웹앱이 네이버 로그인 후 받은 code를 넘기면 토큰 교환 → refresh token을
    // service_role 전용 테이블(naver_oauth)에 저장. 사용자가 주소창을 복사할 필요가 없다.
    if (body.action === "exchange") {
      const clientId = Deno.env.get("NAVER_CLIENT_ID") || "";
      const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET") || "";
      if (!clientId || !clientSecret) return Response.json({ error: "NAVER_CLIENT_ID/SECRET 미설정" }, { status: 400, headers: jsonHeaders });
      const code = String(body.code || "").trim();
      if (!code) return Response.json({ error: "code가 필요합니다." }, { status: 400, headers: jsonHeaders });
      const tokenRes = await fetch(
        `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}&state=firstoa`,
      );
      const token = await tokenRes.json().catch(() => ({}));
      if (!token.refresh_token) return Response.json({ error: `토큰 교환 실패: ${token.error_description || token.error || tokenRes.status}` }, { status: 400, headers: jsonHeaders });
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const saveRes = await fetch(`${supabaseUrl}/rest/v1/naver_oauth?on_conflict=id`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: 1, refresh_token: token.refresh_token, updated_at: new Date().toISOString() }]),
      });
      if (!saveRes.ok) return Response.json({ error: `토큰 저장 실패(${saveRes.status})` }, { status: 500, headers: jsonHeaders });
      return Response.json({ ok: true, status: "linked" }, { headers: jsonHeaders });
    }

    const title = String(body.title || "").trim();
    const date = String(body.date || "").trim(); // YYYY-MM-DD
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "title/date(YYYY-MM-DD)가 필요합니다." }, { status: 400, headers: jsonHeaders });
    }

    const clientId = Deno.env.get("NAVER_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    // refresh token: 연동 테이블(naver_oauth) 우선, 없으면 Secrets 폴백
    let refreshToken = Deno.env.get("NAVER_REFRESH_TOKEN") || "";
    if (supabaseUrl && serviceKey) {
      const tokRes = await fetch(`${supabaseUrl}/rest/v1/naver_oauth?id=eq.1&select=refresh_token`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      const tokRows = await tokRes.json().catch(() => []);
      if (tokRows?.[0]?.refresh_token) refreshToken = tokRows[0].refresh_token;
    }
    if (!clientId || !clientSecret || !refreshToken) {
      return Response.json({ ok: true, status: "not_configured" }, { headers: jsonHeaders }); // 미설정 시 조용히 통과
    }
    let configCalendarId = "";
    if (supabaseUrl && serviceKey) {
      const cfgRes = await fetch(`${supabaseUrl}/rest/v1/app_config?key=in.(NAVER_CALENDAR_ENABLED,NAVER_CALENDAR_ID)&select=key,value`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      const cfg: Array<{ key: string; value: string }> = await cfgRes.json().catch(() => []);
      const cfgMap = Object.fromEntries((cfg || []).map((row) => [row.key, row.value]));
      if (String(cfgMap.NAVER_CALENDAR_ENABLED || "").toLowerCase() !== "true") {
        return Response.json({ ok: true, status: "disabled" }, { headers: jsonHeaders });
      }
      configCalendarId = String(cfgMap.NAVER_CALENDAR_ID || "").trim(); // 관리 탭에서 지정한 대상 캘린더
    }

    // 1) refresh token → access token
    const tokenRes = await fetch(
      `https://nid.naver.com/oauth2.0/token?grant_type=refresh_token&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}`,
    );
    const token = await tokenRes.json().catch(() => ({}));
    if (!token.access_token) throw new Error(`네이버 토큰 갱신 실패: ${token.error_description || token.error || tokenRes.status}`);

    // 2) 일정 등록
    const ical = buildIcal({
      title,
      date,
      time: String(body.time || "09:00"),
      location: String(body.location || ""),
      description: String(body.description || ""),
    });
    const calendarId = configCalendarId || Deno.env.get("NAVER_CALENDAR_ID") || "defaultCalendarId";
    const createRes = await fetch("https://openapi.naver.com/calendar/createSchedule.json", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: `calendarId=${encodeURIComponent(calendarId)}&scheduleIcalString=${encodeURIComponent(ical)}`,
    });
    const created = await createRes.text();
    let naverResult: Record<string, unknown> = {};
    try { naverResult = JSON.parse(created); } catch { /* 비JSON 응답 */ }
    const failed = !createRes.ok || String(naverResult.result || "") === "fail" || Number(naverResult.code || 0) >= 400;
    if (failed) throw new Error(`네이버 캘린더 등록 실패: ${String(naverResult.errorMessage || created).slice(0, 300)}`);
    return Response.json({ ok: true, status: "created", requestedCalendarId: calendarId, naver: naverResult }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
