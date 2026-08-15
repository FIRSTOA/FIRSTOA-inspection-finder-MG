/**
 * 네이버 캘린더 → 웹앱 표시 동기화 (10분 크론)
 *
 * 원칙: "원본은 한 곳" — 웹앱 일정(as_tickets)은 웹앱이 원본이고 네이버는 미러
 * (웹앱→네이버 반영은 일정리스트 update 감시가 이미 처리). 이 함수는 반대로
 * 네이버가 원본인 것만 다룬다:
 *   네이버에서 직접 만든 일정 → naver_calendar_events → 웹앱 캘린더에 보기 전용 표시.
 * 웹앱 일정으로 승격(naverUid 연결)된 일정은 표시 목록에서 빠진다 — 이중 표시 방지.
 *
 * 대상 캘린더: NAVER_CALENDAR_ID(익일통합as) + NAVER_SYNC_CALENDARS(쉼표 구분 추가분, 예: 납품일정).
 * 네이버 REPORT는 목록(href+etag)만 주므로(실측) etag 증분으로 바뀐 것만 개별 GET한다.
 * 액션: {action:"probe", calId?} 진단 / {action:"sync", force?} 동기화(기본).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const CALDAV_BASE = "https://caldav.calendar.naver.com";

function caldavAuth() {
  const id = Deno.env.get("NAVER_CALDAV_ID") || "";
  const pw = Deno.env.get("NAVER_CALDAV_APP_PASSWORD") || "";
  if (!id || !pw) return null;
  return { id, header: "Basic " + btoa(`${id}:${pw}`) };
}

function ymdUtc(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function reportEvents(auth: { id: string; header: string }, calId: string, startYmd: string, endYmd: string): Promise<string> {
  const bodyXml = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">
    <C:time-range start="${startYmd}T000000Z" end="${endYmd}T235959Z"/>
  </C:comp-filter></C:comp-filter></C:filter>
</C:calendar-query>`;
  const res = await fetch(`${CALDAV_BASE}/caldav/${encodeURIComponent(auth.id)}/calendar/${encodeURIComponent(calId)}/`, {
    method: "REPORT",
    headers: { Authorization: auth.header, "Content-Type": "application/xml; charset=utf-8", Depth: "1" },
    body: bodyXml,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`네이버 캘린더 조회 실패(${res.status}): ${text.slice(0, 160)}`);
  return text;
}

function parseHrefEtags(xml: string): Array<{ href: string; etag: string }> {
  const out: Array<{ href: string; etag: string }> = [];
  const blocks = xml.match(/<D:response>[\s\S]*?<\/D:response>/g) || [];
  for (const b of blocks) {
    const href = (b.match(/<D:href>([^<]+)<\/D:href>/) || [])[1] || "";
    const etag = (b.match(/<D:getetag>&quot;?"?([^<]*?)"?&quot;?<\/D:getetag>/) || (b.match(/<D:getetag>([^<]*)<\/D:getetag>/) || []))[1] || "";
    if (href.endsWith(".ics")) out.push({ href, etag: etag.replace(/"/g, "").trim() });
  }
  return out;
}

function xmlUnescape(v: string) {
  return v.replace(/&#13;/g, "\r").replace(/&#10;/g, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

type NaverEvent = { uid: string; date: string; time: string; title: string; location: string; description: string; completed: boolean };

function parseEvents(xml: string): NaverEvent[] {
  const out: NaverEvent[] = [];
  const chunks = xml.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const raw of chunks) {
    const ics = xmlUnescape(raw).replace(/\r?\n[ \t]/g, "");
    const prop = (name: string) => {
      const m = ics.match(new RegExp(`^${name}([^:]*):(.*)$`, "mi"));
      return m ? { params: m[1] || "", value: m[2].trim() } : null;
    };
    const uid = prop("UID")?.value || "";
    const dt = prop("DTSTART");
    if (!uid || !dt) continue;
    let date = "", time = "";
    const v = dt.value;
    if (/^\d{8}$/.test(v)) {
      date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    } else {
      const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
      if (!m) continue;
      if (/Z$/.test(v) && !/TZID/i.test(dt.params)) {
        const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
        const kst = new Date(utc.getTime() + 9 * 3600 * 1000);
        date = kst.toISOString().slice(0, 10);
        time = kst.toISOString().slice(11, 16);
      } else {
        date = `${m[1]}-${m[2]}-${m[3]}`;
        time = `${m[4]}:${m[5]}`;
      }
    }
    const unesc = (s: string) => s.replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
    const unescKeep = (s: string) => s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").trim(); // 내용은 줄바꿈 보존
    out.push({ uid, date, time, title: unesc(prop("SUMMARY")?.value || ""), location: unesc(prop("LOCATION")?.value || ""), description: unescKeep(prop("DESCRIPTION")?.value || ""), completed: /^X-NAVER-COMPLETED[^:]*:TRUE/mi.test(ics) });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "sync");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const rest = `${supabaseUrl}/rest/v1`;
    const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

    const auth = caldavAuth();
    if (!auth) throw new Error("CalDAV 미설정 (NAVER_CALDAV_ID/APP_PASSWORD)");
    const cfgRes = await fetch(`${rest}/app_config?key=in.(NAVER_CALENDAR_ID,NAVER_SYNC_CALENDARS)&select=key,value`, { headers: restHeaders });
    const cfg = Object.fromEntries((((await cfgRes.json().catch(() => [])) as Array<{ key: string; value: string }>)).map((r) => [r.key, r.value]));
    const mainCal = String(cfg.NAVER_CALENDAR_ID || "").trim();
    if (!mainCal || /^https?:/.test(mainCal)) throw new Error("NAVER_CALENDAR_ID가 비어 있거나 URL 형태입니다 (관리 탭에서 설정)");
    const extraCals = String(cfg.NAVER_SYNC_CALENDARS || "").split(",").map((v) => v.trim()).filter(Boolean);
    const calendars = [mainCal, ...extraCals.filter((c) => c !== mainCal)];

    const now = Date.now();
    const startYmd = ymdUtc(new Date(now - 30 * 86400_000));
    const endYmd = ymdUtc(new Date(now + 120 * 86400_000));

    if (action === "probe") {
      const calId = String(body.calId || mainCal);
      const xml = await reportEvents(auth, calId, startYmd, endYmd);
      const listing = parseHrefEtags(xml);
      return Response.json({ ok: true, calId, listed: listing.length, sample: listing.slice(0, 3) }, { headers: jsonHeaders });
    }

    if (action === "reset_state") {
      // etag 기억 초기화 — 다음 sync들이 전량을 새로 내려받는다 (스키마 추가 후 재수집용)
      await fetch(`${rest}/naver_caldav_state?href=neq.`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } });
      return Response.json({ ok: true, status: "state_cleared" }, { headers: jsonHeaders });
    }

    if (action !== "sync") throw new Error(`알 수 없는 action: ${action}`);
    const force = body.force === true; // 주의: force는 매 호출 같은 80건을 재처리한다 — 전량 재수집은 reset_state 후 일반 sync 반복

    // 모든 대상 캘린더의 목록(href+etag) — href에 캘린더 경로가 포함돼 캘린더 간 충돌 없음
    const listing: Array<{ href: string; etag: string; cal: string }> = [];
    const errors: Array<{ cal: string; error: string }> = [];
    for (const cal of calendars) {
      try {
        const xml = await reportEvents(auth, cal, startYmd, endYmd);
        for (const l of parseHrefEtags(xml)) listing.push({ ...l, cal });
      } catch (e) {
        errors.push({ cal, error: String((e as Error).message).slice(0, 120) }); // 하나가 죽어도 나머지는 계속
      }
    }

    const stateRes = await fetch(`${rest}/naver_caldav_state?select=href,etag,uid&order=href.asc`, { headers: restHeaders });
    const state = (await stateRes.json().catch(() => [])) as Array<{ href: string; etag: string; uid: string }>;
    const stateByHref = new Map(state.map((r) => [r.href, r]));
    const listedHrefs = new Set(listing.map((l) => l.href));
    const changed = listing.filter((l) => force || stateByHref.get(l.href)?.etag !== l.etag).slice(0, 80);

    // 웹앱 일정에 연결된 uid(미러+승격) — 표시 목록에서 제외 + 네이버에서 옮긴 날짜·시간을 티켓에 반영
    const ticketsRes = await fetch(`${rest}/as_tickets?select=id,date,time,status,naverUid,assignee,"calendarTitle",vendor&naverUid=not.is.null`, { headers: restHeaders });
    const ticketRows = (await ticketsRes.json().catch(() => [])) as Array<{ id: string; date: string; time: string; status: string; naverUid: string; assignee?: string; calendarTitle?: string; vendor?: string }>;
    const ticketUids = new Set(ticketRows.map((t) => t.naverUid).filter(Boolean));
    const ticketByUid = new Map(ticketRows.map((t) => [t.naverUid, t]));

    let manualUpserted = 0, downloaded = 0, ticketUpdated = 0;
    for (const item of changed) {
      const r = await fetch(`${CALDAV_BASE}${item.href}`, { headers: { Authorization: auth.header } });
      if (!r.ok) continue;
      downloaded += 1;
      const ev = parseEvents(await r.text())[0];
      if (!ev) continue;
      // 웹앱 일정 미러: 네이버 캘린더에서 누가 날짜·시간을 옮겼으면 웹앱 티켓도 따라간다
      // (완료 일정은 보관용 — 불변. 웹앱→네이버 방향은 즉시 반영이라 루프 없음)
      const linkedTicket = ticketByUid.get(ev.uid);
      if (linkedTicket && linkedTicket.status !== "완료" && ev.date) {
        const patchBody: Record<string, string> = {};
        const newTime = ev.time || linkedTicket.time;
        if (linkedTicket.date !== ev.date || (linkedTicket.time || "") !== (newTime || "")) {
          patchBody.date = ev.date;
          patchBody.time = newTime;
        }
        // 제목 역반영: 미러 제목은 "배정자-제목" 형식 — 접두를 벗겨 웹앱 제목과 비교
        if (ev.title) {
          const assignee = String(linkedTicket.assignee || "");
          const stripped = assignee && ev.title.startsWith(`${assignee}-`) ? ev.title.slice(assignee.length + 1) : ev.title;
          const current = (linkedTicket.calendarTitle || "").trim() || String(linkedTicket.vendor || "");
          if (stripped.trim() && stripped.trim() !== current.trim()) patchBody.calendarTitle = stripped.trim().slice(0, 200);
        }
        if (Object.keys(patchBody).length) {
          const patch = await fetch(`${rest}/as_tickets?id=eq.${encodeURIComponent(linkedTicket.id)}`, {
            method: "PATCH", headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify(patchBody),
          });
          if (patch.ok) ticketUpdated += 1;
        }
      }
      if (!ev.uid.startsWith("firstoa") && !ticketUids.has(ev.uid) && ev.date) {
        await fetch(`${rest}/naver_calendar_events?on_conflict=uid`, {
          method: "POST", headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ uid: ev.uid, date: ev.date, time: ev.time, title: ev.title.slice(0, 200), location: ev.location.slice(0, 200), description: ev.description.slice(0, 2000), completed: ev.completed, calendar_id: item.cal, updated_at: new Date().toISOString() }]),
        });
        manualUpserted += 1;
      }
      await fetch(`${rest}/naver_caldav_state?on_conflict=href`, {
        method: "POST", headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ href: item.href, etag: item.etag, uid: ev.uid }]),
      });
    }

    // 승격된 일정(웹앱 티켓에 연결됨)은 표시 목록에서 제거
    let promotedRemoved = 0;
    if (ticketUids.size) {
      const evRes = await fetch(`${rest}/naver_calendar_events?select=uid`, { headers: restHeaders });
      const evRows = (await evRes.json().catch(() => [])) as Array<{ uid: string }>;
      for (const row of evRows.filter((r) => ticketUids.has(r.uid))) {
        await fetch(`${rest}/naver_calendar_events?uid=eq.${encodeURIComponent(row.uid)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } }).catch(() => undefined);
        promotedRemoved += 1;
      }
    }

    // 목록에서 사라진 일정(네이버에서 삭제·이동) — 표시·etag 기억에서 제거.
    // 단, 캘린더 조회 자체가 실패한 회차에는 삭제 판단을 건너뛴다 (오삭제 방지)
    let removed = 0;
    if (!errors.length) {
      const goneRows = state.filter((r) => !listedHrefs.has(r.href));
      for (const row of goneRows.slice(0, 100)) {
        if (row.uid && !row.uid.startsWith("firstoa")) {
          await fetch(`${rest}/naver_calendar_events?uid=eq.${encodeURIComponent(row.uid)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } }).catch(() => undefined);
          removed += 1;
        }
        await fetch(`${rest}/naver_caldav_state?href=eq.${encodeURIComponent(row.href)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } }).catch(() => undefined);
      }
    }

    return Response.json({
      ok: true, calendars: calendars.length, listed: listing.length, changed: changed.length, downloaded,
      manualUpserted, ticketUpdated, promotedRemoved, removed, errors,
      backlog: Math.max(0, listing.filter((l) => force || stateByHref.get(l.href)?.etag !== l.etag).length - changed.length),
    }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
