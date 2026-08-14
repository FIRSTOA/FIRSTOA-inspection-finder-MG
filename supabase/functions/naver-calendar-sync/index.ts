/**
 * 네이버 캘린더 → 웹앱 동기화 (10분 크론)
 *
 * 하는 일 두 가지:
 *  1. 웹앱이 등록한 일정(uid가 firstoa*)을 네이버에서 누가 옮겼으면(날짜·시간 수정)
 *     → as_tickets의 날짜·시간을 따라 바꾼다. (웹앱→네이버 방향은 이미 구현돼 있어
 *        이걸로 양방향이 된다. 완료 상태 일정은 건드리지 않는다)
 *  2. 네이버에서 직접 만든 일정(uid가 firstoa가 아님)
 *     → naver_calendar_events 테이블로 가져와 웹앱 캘린더에 표시(읽기 전용).
 *
 * 조회는 CalDAV REPORT(calendar-query, 기간 필터)로 등록 캘린더(NAVER_CALENDAR_ID)를 읽는다.
 * 액션: {action:"probe"}=원시 응답 확인(진단), {action:"sync"}=동기화 실행(기본).
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

// CalDAV REPORT — 기간 내 모든 VEVENT를 달라고 요청
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

// 네이버 REPORT는 calendar-data를 무시하고 목록(href+etag)만 준다(실측) —
// etag를 기억해 바뀐 일정만 개별 GET하는 증분 방식으로 동작한다.
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

type NaverEvent = { uid: string; date: string; time: string; title: string; location: string };

// multistatus 응답에서 VEVENT들을 뽑아 날짜·시간(KST)으로 정규화
function parseEvents(xml: string): NaverEvent[] {
  const out: NaverEvent[] = [];
  const chunks = xml.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const raw of chunks) {
    const ics = xmlUnescape(raw).replace(/\r?\n[ \t]/g, ""); // 접힌 줄 펴기
    const prop = (name: string) => {
      const m = ics.match(new RegExp(`^${name}([^:]*):(.*)$`, "mi"));
      return m ? { params: m[1] || "", value: m[2].trim() } : null;
    };
    const uid = prop("UID")?.value || "";
    const dt = prop("DTSTART");
    if (!uid || !dt) continue;
    let date = "", time = "";
    const v = dt.value;
    if (/^\d{8}$/.test(v)) { // 종일 일정
      date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    } else {
      const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
      if (!m) continue;
      if (/Z$/.test(v) && !/TZID/i.test(dt.params)) {
        // UTC 표기 → KST(+9)로 변환
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
    out.push({ uid, date, time, title: unesc(prop("SUMMARY")?.value || ""), location: unesc(prop("LOCATION")?.value || "") });
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
    const cfgRes = await fetch(`${rest}/app_config?key=eq.NAVER_CALENDAR_ID&select=value`, { headers: restHeaders });
    const calId = String(((await cfgRes.json().catch(() => [])) as Array<{ value: string }>)[0]?.value || "").trim();
    if (!calId || /^https?:/.test(calId)) throw new Error("NAVER_CALENDAR_ID가 비어 있거나 URL 형태입니다 (관리 탭에서 설정)");

    const now = Date.now();
    const startYmd = ymdUtc(new Date(now - 30 * 86400_000));
    const endYmd = ymdUtc(new Date(now + 120 * 86400_000));

    if (action === "probe") {
      const xml = await reportEvents(auth, calId, startYmd, endYmd);
      const events = parseEvents(xml);
      return Response.json({ ok: true, calId, rawLength: xml.length, sampleRaw: xml.slice(0, 1200), parsed: events.slice(0, 8), total: events.length }, { headers: jsonHeaders });
    }

    if (action !== "sync") throw new Error(`알 수 없는 action: ${action}`);
    const xml = await reportEvents(auth, calId, startYmd, endYmd);
    const listing = parseHrefEtags(xml);

    // 저장된 etag와 비교 — 바뀐 것만 내려받는다
    const stateRes = await fetch(`${rest}/naver_caldav_state?select=href,etag,uid&order=href.asc`, { headers: restHeaders });
    const state = (await stateRes.json().catch(() => [])) as Array<{ href: string; etag: string; uid: string }>;
    const stateByHref = new Map(state.map((r) => [r.href, r]));
    const listedHrefs = new Set(listing.map((l) => l.href));
    const changed = listing.filter((l) => stateByHref.get(l.href)?.etag !== l.etag).slice(0, 80); // 한 번에 80건까지 — 남으면 다음 크론

    const ticketsRes = await fetch(`${rest}/as_tickets?select=id,date,time,status,naverUid&naverUid=like.firstoa*`, { headers: restHeaders });
    const tickets = (await ticketsRes.json().catch(() => [])) as Array<{ id: string; date: string; time: string; status: string; naverUid: string }>;
    const byUid = new Map(tickets.map((t) => [t.naverUid, t]));

    let ticketUpdated = 0, manualUpserted = 0, downloaded = 0;
    for (const item of changed) {
      const r = await fetch(`${CALDAV_BASE}${item.href}`, { headers: { Authorization: auth.header } });
      if (!r.ok) continue;
      downloaded += 1;
      const events = parseEvents(await r.text());
      const ev = events[0];
      if (!ev) continue;

      if (ev.uid.startsWith("firstoa")) {
        // 웹앱 미러 일정 — 네이버에서 날짜·시간이 바뀌었으면 티켓에 반영 (완료는 보관용, 불변)
        const t = byUid.get(ev.uid);
        if (t && t.status !== "완료" && ev.date) {
          const newTime = ev.time || t.time;
          if (t.date !== ev.date || (t.time || "") !== (newTime || "")) {
            const patch = await fetch(`${rest}/as_tickets?id=eq.${encodeURIComponent(t.id)}`, {
              method: "PATCH", headers: { ...restHeaders, Prefer: "return=minimal" },
              body: JSON.stringify({ date: ev.date, time: newTime }),
            });
            if (patch.ok) ticketUpdated += 1;
          }
        }
      } else if (ev.date) {
        // 네이버에서 직접 만든 일정 — 웹앱 캘린더 표시용
        await fetch(`${rest}/naver_calendar_events?on_conflict=uid`, {
          method: "POST", headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ uid: ev.uid, date: ev.date, time: ev.time, title: ev.title.slice(0, 200), location: ev.location.slice(0, 200), calendar_id: calId, updated_at: new Date().toISOString() }]),
        });
        manualUpserted += 1;
      }
      // etag 기억
      await fetch(`${rest}/naver_caldav_state?on_conflict=href`, {
        method: "POST", headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ href: item.href, etag: item.etag, uid: ev.uid }]),
      });
    }

    // 목록에서 사라진 일정(삭제·이동) — 표시 목록과 etag 기억에서 제거
    const goneRows = state.filter((r) => !listedHrefs.has(r.href));
    let removed = 0;
    for (const row of goneRows.slice(0, 100)) {
      if (row.uid && !row.uid.startsWith("firstoa")) {
        await fetch(`${rest}/naver_calendar_events?uid=eq.${encodeURIComponent(row.uid)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } }).catch(() => undefined);
        removed += 1;
      }
      await fetch(`${rest}/naver_caldav_state?href=eq.${encodeURIComponent(row.href)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } }).catch(() => undefined);
    }

    return Response.json({ ok: true, listed: listing.length, changed: changed.length, downloaded, ticketUpdated, manualUpserted, removed, backlog: Math.max(0, listing.filter((l) => stateByHref.get(l.href)?.etag !== l.etag).length - changed.length) }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
