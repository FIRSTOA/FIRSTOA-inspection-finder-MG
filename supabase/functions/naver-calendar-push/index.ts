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
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function buildIcal(input: { title: string; date: string; time: string; location: string; description: string; uid?: string }) {
  const [y, m, d] = input.date.split("-").map(Number);
  const [hh, mm] = (input.time || "09:00").split(":").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = (h: number, min: number) => `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
  const endMin = mm + 60; // 기본 1시간
  const uid = input.uid || `firstoa-${crypto.randomUUID()}`;
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

// ---- CalDAV (비공식): 일정 생성·조회·수정·삭제 ------------------------------
// 네이버 OpenAPI는 등록 전용 + CalDAV REPORT는 UID 필터를 무시(실측)하므로,
// 등록 자체를 CalDAV PUT({uid}.ics)으로 해서 리소스 주소를 우리가 정한다.
// 이후 조회(GET)·수정(PUT)·삭제(DELETE)는 그 주소로 직접 접근 — 검색 불필요.
// 연동 계정의 "애플리케이션 비밀번호"(2단계 인증 필요)가 Secrets에 있어야 동작.
const CALDAV_BASE = "https://caldav.calendar.naver.com";

function caldavAuth() {
  const id = Deno.env.get("NAVER_CALDAV_ID") || "";
  const pw = Deno.env.get("NAVER_CALDAV_APP_PASSWORD") || "";
  if (!id || !pw) return null;
  return { id, header: "Basic " + btoa(`${id}:${pw}`) };
}

async function configCalendarIdOf(): Promise<string> {
  const sUrl = Deno.env.get("SUPABASE_URL") || "";
  const sKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!sUrl || !sKey) return "";
  const r = await fetch(`${sUrl}/rest/v1/app_config?key=eq.NAVER_CALENDAR_ID&select=value`, { headers: { apikey: sKey, Authorization: `Bearer ${sKey}` } });
  const rows = await r.json().catch(() => []);
  return String(rows?.[0]?.value || "").trim();
}

function caldavEventUrl(authId: string, calendarId: string, uid: string) {
  return `${CALDAV_BASE}/caldav/${encodeURIComponent(authId)}/calendar/${encodeURIComponent(calendarId)}/${encodeURIComponent(uid)}.ics`;
}

// VEVENT 구간만 잘라낸다 — VTIMEZONE 블록에도 DTSTART가 있어 통째로 찾으면 1970년을 집는다
function eventBlockOf(ics: string): string {
  const m = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/);
  return m ? m[0] : ics;
}

function icsProp(ics: string, name: string): string {
  const unfolded = eventBlockOf(ics).replace(/\r?\n[ \t]/g, "");
  const m = unfolded.match(new RegExp(`^${name}[^:]*:(.*)$`, "mi"));
  return m ? m[1].trim().replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";") : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    // CalDAV: 네이버 일정 조회/수정/삭제 (uid 필요 — 웹앱이 등록 때 저장해 둔 값)
    if (body.action === "caldav_get" || body.action === "caldav_update" || body.action === "caldav_delete") {
      const auth = caldavAuth();
      if (!auth) return Response.json({ error: "CalDAV 미설정 — NAVER_CALDAV_ID/NAVER_CALDAV_APP_PASSWORD Secrets가 필요합니다" }, { status: 400, headers: jsonHeaders });
      const uid = String(body.uid || "").trim();
      if (!uid) return Response.json({ error: "uid가 필요합니다" }, { status: 400, headers: jsonHeaders });
      const calId = await configCalendarIdOf();
      if (!calId) return Response.json({ error: "NAVER_CALENDAR_ID 설정이 비어 있습니다 (관리 탭)" }, { status: 400, headers: jsonHeaders });
      const url = caldavEventUrl(auth.id, calId, uid);

      const getRes = await fetch(url, { headers: { Authorization: auth.header } });
      if (getRes.status === 404) {
        return Response.json({ error: "네이버에서 이 일정을 찾지 못했습니다 — CalDAV 도입 전에 등록됐거나 이미 삭제된 일정입니다" }, { status: 404, headers: jsonHeaders });
      }
      if (getRes.status === 401) return Response.json({ error: "CalDAV 인증 실패 — 애플리케이션 비밀번호를 확인하세요" }, { status: 401, headers: jsonHeaders });
      const ics = await getRes.text();
      if (!getRes.ok) return Response.json({ error: `네이버 일정 조회 실패(${getRes.status})` }, { status: 500, headers: jsonHeaders });

      if (body.action === "caldav_get") {
        return Response.json({
          ok: true,
          title: icsProp(ics, "SUMMARY"),
          description: icsProp(ics, "DESCRIPTION"),
          location: icsProp(ics, "LOCATION"),
          dtstart: icsProp(ics, "DTSTART"),
        }, { headers: jsonHeaders });
      }
      if (body.action === "caldav_delete") {
        const del = await fetch(url, { method: "DELETE", headers: { Authorization: auth.header } });
        if (del.status >= 400 && del.status !== 404) throw new Error(`네이버 일정 삭제 실패(${del.status})`);
        return Response.json({ ok: true, status: "deleted" }, { headers: jsonHeaders });
      }
      // caldav_update: 시간·UID는 보존하고 제목/내용/장소만 교체
      const unfolded = eventBlockOf(ics).replace(/\r?\n[ \t]/g, "");
      const keep = (name: string) => (unfolded.match(new RegExp(`^(${name}[^:]*:.*)$`, "mi")) || [])[1] || "";
      const esc = (v: string) => String(v || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
      const newIcs = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:FirstOA CS Webapp", "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
        keep("DTSTART"), keep("DTEND"),
        `SUMMARY:${esc(String(body.title || ""))}`,
        String(body.location || "").trim() ? `LOCATION:${esc(String(body.location))}` : "",
        String(body.description || "").trim() ? `DESCRIPTION:${esc(String(body.description))}` : "",
        "END:VEVENT", "END:VCALENDAR",
      ].filter(Boolean).join("\r\n");
      const put = await fetch(url, { method: "PUT", headers: { Authorization: auth.header, "Content-Type": "text/calendar; charset=utf-8" }, body: newIcs });
      if (put.status >= 400) throw new Error(`네이버 일정 수정 실패(${put.status})`);
      return Response.json({ ok: true, status: "updated" }, { headers: jsonHeaders });
    }

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
      // 편의: 캘린더 공유 URL(naver.me/… 등)을 붙여넣으면 페이지에서 실제 ID를 뽑아 쓰고,
      // 다음 호출부터 바로 쓰도록 설정값도 ID로 바꿔 저장한다
      if (/^https?:\/\//.test(configCalendarId)) {
        const page = await fetch(configCalendarId, { redirect: "follow" }).then((r) => r.text()).catch(() => "");
        const found = page.match(/calendarId"\s*:\s*"([^"]+)"/);
        if (found) {
          configCalendarId = found[1];
          await fetch(`${supabaseUrl}/rest/v1/app_config?key=eq.NAVER_CALENDAR_ID`, {
            method: "PATCH",
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ value: configCalendarId }),
          }).catch(() => {});
        } else {
          return Response.json({ error: "캘린더 공유 URL에서 ID를 찾지 못했습니다. 캘린더의 '공개 설정'이 켜져 있어야 합니다." }, { status: 400, headers: jsonHeaders });
        }
      }
    }

    // 등록: CalDAV가 설정돼 있으면 PUT({uid}.ics)으로 — 나중에 조회·수정·삭제가 가능해진다.
    const caldav = caldavAuth();
    const calIdForCreate = configCalendarId || Deno.env.get("NAVER_CALDAV_DEFAULT_CALENDAR") || "";
    if (caldav && calIdForCreate) {
      const eventUidC = `firstoa-${crypto.randomUUID()}`;
      const icalC = buildIcal({
        title, date,
        time: String(body.time || "09:00"),
        location: String(body.location || ""),
        description: String(body.description || ""),
        uid: eventUidC,
      });
      const putRes = await fetch(caldavEventUrl(caldav.id, calIdForCreate, eventUidC), {
        method: "PUT",
        headers: { Authorization: caldav.header, "Content-Type": "text/calendar; charset=utf-8" },
        body: icalC.replace(/\n/g, "\r\n").replace(/\r\r/g, "\r"),
      });
      if (putRes.status < 400) {
        return Response.json({ ok: true, status: "created", uid: eventUidC, via: "caldav", requestedCalendarId: calIdForCreate }, { headers: jsonHeaders });
      }
      // CalDAV 등록 실패 시 OpenAPI로 폴백 (등록은 되지만 나중에 수정 불가)
    }

    // 1) refresh token → access token
    const tokenRes = await fetch(
      `https://nid.naver.com/oauth2.0/token?grant_type=refresh_token&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}`,
    );
    const token = await tokenRes.json().catch(() => ({}));
    if (!token.access_token) throw new Error(`네이버 토큰 갱신 실패: ${token.error_description || token.error || tokenRes.status}`);

    // 2) 일정 등록
    const eventUid = `firstoa-${crypto.randomUUID()}`;
    const ical = buildIcal({
      title,
      date,
      time: String(body.time || "09:00"),
      location: String(body.location || ""),
      description: String(body.description || ""),
      uid: eventUid,
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
    return Response.json({ ok: true, status: "created", uid: eventUid, requestedCalendarId: calendarId, naver: naverResult }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
