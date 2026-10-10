/**
 * 관리부 마감 목록 자동 반영 — counter_sms_inbox(봇이 넣은 마감방 글) → counter_sms_targets (2026-10-10)
 *
 * 왜: 카운터 문자 탭에서 [목록 맞추기]를 한 번 눌러야 목록이 들어가던 것을 없앤다("그냥 자동으로 올라가게").
 * 누가 부르나: ① pg_cron 2분마다(supabase/counter-inbox-ingest-cron.sql) ② 앱이 카운터 탭을 열 때 ③ 봇이 글을 넣은 직후.
 *   여러 곳에서 동시에 불려도 행마다 "applied_at is null 인 것만 잡기"(조건부 PATCH)로 한 번만 처리된다.
 *
 * 규칙(_shared/counter-sms/ingest.ts 참고): 있는 업체는 손대지 않고(완료·문자보냄 유지) 없는 업체만 추가, 목록에 없는
 *   열린 업체는 알려만 준다. 머리글 달이 다르면 새 달 목록. 처리 결과는 inbox.note·배치 log 에 날짜·시간·보낸이와 함께 남고
 *   팀원에게 웹푸시(09~19시 KST)로 "C팀 마감 목록 도착 — 신규 2 · 중복 3" 이 간다.
 *
 * 요청: {}                     → 대기 중 inbox 처리
 *       { text, team? }        → 그 글로 계획만 세워 돌려준다(쓰기 없음, 시험용)
 *       { retry: true }        → '자동 처리 실패' 로 남은 행도 다시 시도
 */
import { mergeTargets, parseBlocks, parseListHeader } from "../_shared/counter-sms/parser.ts";
import { mergeFormats } from "../_shared/counter-sms/data.ts";
import { type ExistingTarget, needsNewBatch, planIngest, summarizePlan } from "../_shared/counter-sms/ingest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://kkdiihazgzesbqxjytqv.supabase.co";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const REST = `${SUPABASE_URL}/rest/v1`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const TEAMS = new Set(["A", "B", "C", "D", "E"]);
const enc = encodeURIComponent;

type InboxRow = { id: number; room: string; sender: string; text: string; received_at: string; note: string | null };
type BatchRow = { id: string; team: string; title: string; created_at: string; log: unknown[] | null };

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${REST}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 200)}`);
  return (text.trim().startsWith("[") || text.trim().startsWith("{") ? JSON.parse(text) : null) as T;
}
const get = <T>(path: string) => rest<T>(path);
const post = (path: string, body: unknown) => rest<null>(path, { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });
const patch = <T>(path: string, body: unknown, represent = false) =>
  rest<T>(path, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: represent ? "return=representation" : "return=minimal" } });

const roomKey = (s: string) => String(s || "").replace(/\s+/g, "");
const kstHour = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));

/** 머리글에 팀이 없으면 방 매핑(마감|팀)으로 — 공통(*) 방이면 팀을 못 정한다 */
async function teamFromRoom(room: string): Promise<string> {
  const rows = await get<Array<{ region: string; room: string }>>(`/room_map?select=region,room&category=eq.${enc("마감")}`).catch(() => []);
  const hit = rows.find((r) => roomKey(r.room) === roomKey(room) && TEAMS.has(String(r.region).trim().toUpperCase()));
  return hit ? String(hit.region).trim().toUpperCase() : "";
}

async function machineKeysFor(team: string): Promise<string[]> {
  const rows = await get<Array<{ machines: Record<string, string> | null }>>(`/counter_sms_settings?select=machines&region=eq.${enc(`${team}지역`)}&limit=1`).catch(() => []);
  return Object.keys(mergeFormats(rows[0]?.machines || null));
}

type Outcome = {
  inbox_id?: number; team: string; batch_id: string; new_batch: boolean; total: number;
  added: number; dupes: number; missing: string[]; note: string; dry?: boolean;
};

/** 글 하나를 반영한다. dry 면 계획만 */
async function ingestText(text: string, opts: { team?: string; room?: string; sender?: string; inboxId?: number; dry: boolean }): Promise<Outcome> {
  const header = parseListHeader(text);
  const team = (header.team && TEAMS.has(header.team) ? header.team : "") || (opts.team && TEAMS.has(opts.team) ? opts.team : "") || (opts.room ? await teamFromRoom(opts.room) : "");
  if (!team) throw new Error("팀을 알 수 없음 — 머리글 【수도권C】가 없고 방 매핑에도 팀이 없습니다");
  const keys = await machineKeysFor(team);
  const blocks = parseBlocks(text, keys);
  if (!blocks.length) throw new Error("업체 블록을 읽지 못했습니다(번호, 등급업체명 형식이 아님)");
  const merged = mergeTargets(blocks);

  const latest = (await get<BatchRow[]>(`/counter_sms_batches?select=id,team,title,created_at,log&team=eq.${enc(team)}&order=created_at.desc&limit=1`))[0] || null;
  const newBatch = needsNewBatch(header.ym, latest);
  const existing = newBatch || !latest ? [] : await get<ExistingTarget[]>(`/counter_sms_targets?select=id,vendor,lease_code,list_kind,sent_at,done_at&batch_id=eq.${enc(latest.id)}`);
  const plan = planIngest(existing, merged);
  const note = summarizePlan(plan, { team, total: merged.length, newBatch });
  const base: Outcome = { inbox_id: opts.inboxId, team, batch_id: latest?.id || "", new_batch: newBatch, total: merged.length, added: plan.fresh.length, dupes: plan.dupes.length, missing: plan.missingOpen.map((t) => t.vendor), note };
  if (opts.dry) return { ...base, dry: true };

  const now = new Date().toISOString();
  const by = `자동 · 관리부 목록${opts.sender ? `(${opts.sender})` : ""}`;
  let batchId = latest?.id || "";
  if (newBatch) {
    batchId = `csb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const month = header.ym ? Number(header.ym.slice(5)) : Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric" }).format(new Date()));
    await post("/counter_sms_batches", { id: batchId, team, title: header.monthLabel || `${month}월 마감`, raw: text, created_by: by });
  }
  if (plan.fresh.length) {
    const stamp = Date.now().toString(36);
    await post("/counter_sms_targets", plan.fresh.map((t, i) => ({
      id: newBatch ? `${batchId}-${String(i).padStart(3, "0")}` : `${batchId}-a${stamp}-${String(i).padStart(3, "0")}`,
      batch_id: batchId, team, vendor: t.vendor, grade_group: t.gradeGroup, phones: t.phones, labels: t.labels, machines: t.machines, vendor_names: t.vendorNames,
      added_at: now, added_by: by, list_kind: t.listKind, cms_day: t.cmsDay, lease_code: t.leaseCodes[0] || null, serials: t.serials, assets: t.assets,
    })));
  }
  // 목록이 올라올 때마다 날짜·시간·보낸이·결과를 배치 머리에 남긴다
  const current = newBatch ? [] : ((await get<BatchRow[]>(`/counter_sms_batches?select=log&id=eq.${enc(batchId)}`))[0]?.log || []);
  const entry = { at: now, by, mode: "auto", added: plan.fresh.length, skipped: plan.dupes.map((d) => d.vendor), kept: plan.dupes.length, missing: plan.missingOpen.map((t) => t.vendor), inbox_id: opts.inboxId };
  await patch(`/counter_sms_batches?id=eq.${enc(batchId)}`, { log: [...(Array.isArray(current) ? current : []), entry] }).catch(() => null);

  // 팀원에게 알림(09~19시 KST). 실패해도 반영은 끝났으니 무시
  const h = kstHour();
  if (h >= 9 && h < 19) {
    const body = { title: `${team}팀 마감 목록 도착 — 신규 ${plan.fresh.length} · 중복 ${plan.dupes.length}${newBatch ? " · 새 달 목록" : ""}`, body: note, team, tag: `counter-list-${team}`, category: "notice", url: "/" };
    await fetch(`${SUPABASE_URL}/functions/v1/push-send`, { method: "POST", headers: H, body: JSON.stringify(body) }).catch(() => null);
  }
  return { ...base, batch_id: batchId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });
  if (!KEY) return Response.json({ error: "서비스 키가 없습니다" }, { status: 500, headers: jsonHeaders });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  try {
    // 시험: 글만 주면 계획만 세운다(쓰기 없음)
    if (typeof body.text === "string" && body.text.trim()) {
      const out = await ingestText(body.text, { team: typeof body.team === "string" ? body.team : "", dry: true });
      return Response.json(out, { headers: jsonHeaders });
    }
    const retry = body.retry === true;
    const filter = retry ? "" : `&or=(note.is.null,note.not.like.${enc("자동 처리 실패*")})`;
    const rows = await get<InboxRow[]>(`/counter_sms_inbox?select=id,room,sender,text,received_at,note&applied_at=is.null${filter}&order=id.asc&limit=10`);
    const processed: Outcome[] = [];
    const failed: Array<{ inbox_id: number; error: string }> = [];
    for (const row of rows) {
      // 잡기 — 다른 호출이 먼저 잡았으면 빈 배열
      const claimed = await patch<InboxRow[]>(`/counter_sms_inbox?id=eq.${row.id}&applied_at=is.null`, { applied_at: new Date().toISOString(), applied_by: "자동", note: "처리중" }, true);
      if (!Array.isArray(claimed) || !claimed.length) continue;
      try {
        const out = await ingestText(row.text, { room: row.room, sender: row.sender, inboxId: row.id, dry: false });
        await patch(`/counter_sms_inbox?id=eq.${row.id}`, { batch_id: out.batch_id, note: out.note, applied_by: "자동" });
        processed.push(out);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        // 되돌려 놓는다 — 앱 도착함에 다시 보이고, 사람이 [직접 넣기]로 처리한다. 크론은 이 행을 다시 집지 않는다(retry 요청만)
        await patch(`/counter_sms_inbox?id=eq.${row.id}`, { applied_at: null, applied_by: null, batch_id: null, note: `자동 처리 실패: ${msg.slice(0, 160)}` }).catch(() => null);
        failed.push({ inbox_id: row.id, error: msg });
      }
    }
    return Response.json({ processed, failed, waiting: rows.length }, { headers: jsonHeaders });
  } catch (e) {
    return Response.json({ error: (e as Error).message || String(e) }, { status: 500, headers: jsonHeaders });
  }
});
