/**
 * 네이버 캘린더 ↔ 웹앱 완전 동기화 (1분 크론 × 내부 20초 폴링 3회)
 *
 * 통합 규칙(2026-08-15 확정):
 *  - 네이버 수기 일정 중 팀 시간대(09/12/15/18/21)가 있는 것 + 오늘 이후 → as_tickets로 자동 수입
 *    (naverUid 연결 → 이후 배정·완료·수정·삭제가 접수 일정과 동일). 종일·기타 시간은
 *    naver_calendar_events 오버레이(캘린더 표시 전용 — 연차·공지류).
 *  - 미러/수입 일정을 네이버에서 지우면 웹앱 일정도 삭제(완전 양방향 — 접수 원본은 별도 보존).
 *    단 백로그가 남은 회차에는 삭제 판단을 건너뛴다(이동을 삭제로 오인 방지).
 *  - 네이버에서 날짜·시간·제목 수정 → 웹앱 반영. 완료 체크(영업부) → 웹앱 상태 완료.
 *  - 대상 캘린더: 익일통합as + NAVER_SYNC_CALENDARS(납품 등) + NAVER_TEAM_CALENDAR_A~E(완료 캘린더).
 * 액션: {action:"probe", calId?} / {action:"sync", force?} / {action:"reset_state"}.
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
    const cfgRes = await fetch(`${rest}/app_config?key=like.NAVER_%25&select=key,value`, { headers: restHeaders });
    const cfg = Object.fromEntries((((await cfgRes.json().catch(() => [])) as Array<{ key: string; value: string }>)).map((r) => [r.key, r.value]));
    const mainCal = String(cfg.NAVER_CALENDAR_ID || "").trim();
    if (!mainCal || /^https?:/.test(mainCal)) throw new Error("NAVER_CALENDAR_ID가 비어 있거나 URL 형태입니다 (관리 탭에서 설정)");
    const deliveryCals = String(cfg.NAVER_SYNC_CALENDARS || "").split(",").map((v) => v.trim()).filter(Boolean);
    const teamCals: Record<string, string> = {};
    for (const tm of ["A", "B", "C", "D", "E"]) {
      const v = String(cfg[`NAVER_TEAM_CALENDAR_${tm}`] || "").trim();
      if (v) teamCals[v] = tm; // 완료 캘린더 id → 팀
    }
    const calendars = [...new Set([mainCal, ...deliveryCals, ...Object.keys(teamCals)])];
    const calKind = (cal: string): "main" | "delivery" | "done" => (cal === mainCal ? "main" : teamCals[cal] ? "done" : "delivery");
    const TEAM_BY_SLOT: Record<string, string> = { "09:00": "A", "12:00": "B", "15:00": "C", "18:00": "D", "21:00": "E" };

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

    if (action === "sync3") {
      // 1분 크론용: 즉시 1회 + 20·40초 뒤 자기 자신에게 sync 재요청 → 실효 20초 폴링
      const self = `${supabaseUrl}/functions/v1/naver-calendar-sync`;
      const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
      const fire = () => fetch(self, { method: "POST", headers: { Authorization: `Bearer ${anon}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) }).catch(() => undefined);
      await fire();
      await new Promise((r) => setTimeout(r, 20_000));
      await fire();
      await new Promise((r) => setTimeout(r, 20_000));
      await fire();
      return Response.json({ ok: true, status: "sync3_done" }, { headers: jsonHeaders });
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

    const todayKst = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
    let manualUpserted = 0, downloaded = 0, ticketUpdated = 0, imported = 0;
    for (const item of changed) {
      const r = await fetch(`${CALDAV_BASE}${item.href}`, { headers: { Authorization: auth.header } });
      if (!r.ok) continue;
      downloaded += 1;
      const ev = parseEvents(await r.text())[0];
      if (!ev) continue;
      const kind = calKind(item.cal);

      // ① 연결된 일정(미러·수입): 네이버 쪽 날짜·시간·제목·완료 체크를 웹앱에 반영
      const linkedTicket = ticketByUid.get(ev.uid);
      if (linkedTicket && ev.date) {
        const patchBody: Record<string, string> = {};
        if (linkedTicket.status !== "완료") {
          const newTime = ev.time || linkedTicket.time;
          if (linkedTicket.date !== ev.date || (linkedTicket.time || "") !== (newTime || "")) {
            patchBody.date = ev.date;
            patchBody.time = newTime;
          }
          if (ev.title) {
            const assignee = String(linkedTicket.assignee || "");
            const stripped = assignee && ev.title.startsWith(`${assignee}-`) ? ev.title.slice(assignee.length + 1) : ev.title;
            const current = (linkedTicket.calendarTitle || "").trim() || String(linkedTicket.vendor || "");
            if (stripped.trim() && stripped.trim() !== current.trim()) patchBody.calendarTitle = stripped.trim().slice(0, 200);
          }
        }
        // 영업부가 네이버에서 완료 체크(X-NAVER-COMPLETED) → 웹앱 상태도 완료
        if ((ev.completed || kind === "done") && linkedTicket.status !== "완료") patchBody.status = "완료";
        if (Object.keys(patchBody).length) {
          const patch = await fetch(`${rest}/as_tickets?id=eq.${encodeURIComponent(linkedTicket.id)}`, {
            method: "PATCH", headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify(patchBody),
          });
          if (patch.ok) ticketUpdated += 1;
        }
      }

      // ② 네이버 수기 일정: 팀 시간대 + 오늘 이후 → 웹앱 일정으로 자동 수입 (완전 통합)
      //    종일·기타 시간(연차·공지류)은 오버레이(캘린더 표시 전용)
      if (!ev.uid.startsWith("firstoa") && !ticketUids.has(ev.uid) && ev.date) {
        // 팀 시간대(09/12/15/18/21)면 그 팀, 그 외 시간(11시·9시반 등)은 "기타" — 종일만 오버레이
        const team = TEAM_BY_SLOT[ev.time] || (ev.time ? "기타" : "");
        const importable = team && ev.date >= todayKst;
        if (importable) {
          const ticketId = `nv-${ev.uid.replace(/[^0-9A-Za-z@._-]/g, "")}`.slice(0, 120);
          const ins = await fetch(`${rest}/as_tickets?on_conflict=id`, {
            method: "POST", headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify([{
              id: ticketId, team, date: ev.date, time: ev.time,
              vendor: ev.title.slice(0, 80), calendarTitle: ev.title.slice(0, 200),
              contact: "", address: ev.location.slice(0, 200), department: "",
              model: "", serial: "", asset: "", grade: "", keyman: "",
              issue: "", note: ev.description.slice(0, 4000),
              assignee: "", status: (ev.completed || kind === "done") ? "완료" : "접수",
              scheduleType: kind === "delivery" ? "납품철수교체휴가교육" : "AS",
              receptionId: "", naverUid: ev.uid, source: "naver",
            }]),
          });
          if (ins.ok) {
            imported += 1;
            ticketUids.add(ev.uid);
            ticketByUid.set(ev.uid, { id: ticketId, date: ev.date, time: ev.time, status: ev.completed ? "완료" : "접수", naverUid: ev.uid });
            await fetch(`${rest}/naver_calendar_events?uid=eq.${encodeURIComponent(ev.uid)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } }).catch(() => undefined);
          }
        } else {
          await fetch(`${rest}/naver_calendar_events?on_conflict=uid`, {
            method: "POST", headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify([{ uid: ev.uid, date: ev.date, time: ev.time, title: ev.title.slice(0, 200), location: ev.location.slice(0, 200), description: ev.description.slice(0, 2000), completed: ev.completed, calendar_id: item.cal, updated_at: new Date().toISOString() }]),
          });
          manualUpserted += 1;
        }
      }
      await fetch(`${rest}/naver_caldav_state?on_conflict=href`, {
        method: "POST", headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ href: item.href, etag: item.etag, uid: ev.uid }]),
      });
      stateByHref.set(item.href, { href: item.href, etag: item.etag, uid: ev.uid }); // 삭제 판단용 최신화
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

    // 삭제 완전 양방향(2026-08-15 확정): 네이버에서 사라진 일정은 웹앱 일정·표시도 삭제.
    // 가드: 조회 실패 회차·백로그 잔여 회차에는 판단하지 않는다 (캘린더 간 "이동"을 삭제로 오인 방지 —
    //        이동은 새 href가 다운로드돼야 같은 uid가 살아있음을 알 수 있다)
    let removed = 0, ticketDeleted = 0;
    const backlogNow = listing.filter((l) => stateByHref.get(l.href)?.etag !== l.etag).length - changed.length;
    if (!errors.length && backlogNow <= 0) {
      // 살아있는 uid = 여전히 목록에 있는 href의 uid + 이번에 내려받은 uid
      const aliveUids = new Set<string>();
      for (const r of state) if (listedHrefs.has(r.href)) aliveUids.add(r.uid);
      for (const item of changed) { const st = stateByHref.get(item.href); if (st) aliveUids.add(st.uid); }
      const goneRows = state.filter((r) => !listedHrefs.has(r.href));
      for (const row of goneRows.slice(0, 100)) {
        const uidAlive = row.uid && aliveUids.has(row.uid);
        if (row.uid && !uidAlive) {
          await fetch(`${rest}/naver_calendar_events?uid=eq.${encodeURIComponent(row.uid)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } }).catch(() => undefined);
          const t = ticketByUid.get(row.uid);
          if (t) {
            const del = await fetch(`${rest}/as_tickets?id=eq.${encodeURIComponent(t.id)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } });
            if (del.ok) ticketDeleted += 1;
          }
          removed += 1;
        }
        await fetch(`${rest}/naver_caldav_state?href=eq.${encodeURIComponent(row.href)}`, { method: "DELETE", headers: { ...restHeaders, Prefer: "return=minimal" } }).catch(() => undefined);
      }
    }

    return Response.json({
      ok: true, calendars: calendars.length, listed: listing.length, changed: changed.length, downloaded,
      manualUpserted, imported, ticketUpdated, ticketDeleted, promotedRemoved, removed, errors,
      backlog: Math.max(0, listing.filter((l) => force || stateByHref.get(l.href)?.etag !== l.etag).length - changed.length),
    }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
