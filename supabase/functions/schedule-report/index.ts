/**
 * schedule-report — 중간보고 자동 발송(평일 12:00·14:00 KST, C팀 먼저) · 2026-10-31
 * 설계: docs/tasks/schedule-report-auto-2026-10-31.md 4·5절 + 결정(Q1 변동 없어도 보냄 · Q2 진행중 줄·특이사항 칸 없음 · Q3 같은 계정 방 초대됨).
 * SQL: supabase/schedule-report-20261031.sql (schedule_report_log · app_config 3키 · 크론 2개).
 *
 * 요청: POST { slot: "12"|"14"|"now", team?: "A".."E", dryRun?: true, actor?: "이름" }
 *   - 크론은 ops.call_edge(vault field_cron_jwt = anon) 로 {slot:"12"|"14"} 만. 앱 [지금 보내기]는 anon 으로 {slot:"now", team, actor}.
 * 응답: { ok, kstDate, results: [{ team, slot, status, reason, room, realRoom, test, text, lines, polished, outboxId, logId, chars }] }
 *   status = queued | dry | skipped | failed. 한 팀이라도 failed 면 HTTP 500(ops.edge_call_health 가 잡게) — results 는 그대로 싣는다.
 *
 * 팀마다(한 팀 실패가 다음 팀을 막지 않음):
 *   1) 12/14(dryRun 아님): claim 행 insert — 409/23505 = 이미 시도한 차수 → skipped/already(새 행 없음)
 *   2) 차수 판정(logic.slotGate): off · kakao_off · holiday · before10 · (now) after19 → skipped
 *   3) now: 같은 팀 now 가 10분 안에 있으면 skipped/too_soon, 아니면 claim 행
 *   4) 12/14: 같은 날 [복사] 기록이 차수 60분 전~지금이면 skipped/manual_copied
 *   5) as_tickets(오늘~다음 영업일 + 그 뒤 연기 표시 건) · cs_members → midReportPlanFor. 오늘 대상 0건 → skipped/empty
 *   6) room_map 스케줄|팀 — 없으면 skipped/no_room(테스트방으로도 안 보냄)
 *   7) polishReportLines(40초, fnTag schedule-report — 비용 기록은 polish 가 함). 실패·개수 불일치면 규칙 초안(polished=false)
 *   8) SCHEDULE_REPORT_TEST 또는 TEST_MODE → TEST_ROOM, 머리 "[테스트 · 원래는 ○○]"
 *   9) dryRun 이면 글만(log status dry). 아니면 outbox insert → log queued(outbox_id·text·lines·polished·ai_model)
 * Supabase 쓰기는 service role(엣지 안 REST). 요청에 방·본문 칸이 없다 — 보내는 곳은 room_map 의 정해진 방뿐.
 */
import { kstNow, nextBusinessDay, type KstNow } from "../_shared/kr-holidays.ts";
import { midReportPlanFor } from "../_shared/report/mid-report.ts";
import { polishReportLines, REPORT_POLISH_DEFAULT_MODEL } from "../_shared/report/polish.ts";
import type { MemberLike } from "../_shared/report/team-order.ts";
import {
  clip, CONFIG_KEYS, copyWindowStartIso, isAuthorized, isUniqueViolation, nowTooSoon, NOW_MIN_GAP_MS, parseRequest, pickRoom, projectRefOf,
  readConfig, slotGate, teamsToRun, withTestHeader, type ReportConfig, type ScheduleReportRequest, type Team,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const LOG = "schedule_report_log";
const ROOM_CATEGORY = "스케줄";
const POLISH_TIMEOUT_MS = 40_000;
const DEFER_DAYS = 120;
const TICKET_COLUMNS = "id,team,date,time,status,scheduleType,source,vendor,calendarTitle,note,issue,model,assignee";

const enc = encodeURIComponent;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type DbEnv = { rest: string; headers: Record<string, string> };

function dbEnv(): DbEnv | null {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return null;
  return { rest: `${url}/rest/v1`, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

async function getJson<T>(env: DbEnv, path: string): Promise<T> {
  const res = await fetch(`${env.rest}/${path}`, { headers: env.headers });
  if (!res.ok) throw new Error(`${path.split("?")[0]} 조회 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 150)}`);
  return await res.json() as T;
}

/** 1,000행 넘는 조회를 끝까지(limit/offset) */
async function getAll<T>(env: DbEnv, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const page = await getJson<T[]>(env, `${path}&limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/** 행 하나 넣고 돌려받기. unique 위반이면 { already: true } */
async function insertReturning<T>(env: DbEnv, table: string, row: Record<string, unknown>): Promise<{ already: true } | { already: false; row: T }> {
  const res = await fetch(`${env.rest}/${table}`, {
    method: "POST",
    headers: { ...env.headers, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (table === LOG && isUniqueViolation(res.status, text)) return { already: true };
    throw new Error(`${table} 넣기 실패(${res.status}) ${text.slice(0, 150)}`);
  }
  const body = await res.json() as T[];
  if (!Array.isArray(body) || !body[0]) throw new Error(`${table} 넣기 응답이 비었습니다`);
  return { already: false, row: body[0] };
}

async function patchLog(env: DbEnv, id: number, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${env.rest}/${LOG}?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...env.headers, Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`${LOG} 갱신 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 150)}`);
}

async function readConfigMap(env: DbEnv): Promise<Record<string, string>> {
  const keys = CONFIG_KEYS.map((k) => enc(k)).join(",");
  const rows = await getJson<Array<{ key: string; value: string | null }>>(env, `app_config?select=key,value&key=in.(${keys})`);
  return Object.fromEntries(rows.map((r) => [r.key, String(r.value ?? "")]));
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 보고 재료 — 오늘~다음 영업일 전부 + 그 뒤 120일 중 연기 표시가 있는 것(연기 꼬리). 앱과 같은 순서(date·time·id) */
async function loadTickets(env: DbEnv, team: Team, todayYmd: string): Promise<Array<Record<string, unknown>>> {
  const tomorrow = nextBusinessDay(todayYmd);
  const order = "order=date.asc,time.asc,id.asc";
  const near = await getAll<Record<string, unknown>>(env,
    `as_tickets?select=${TICKET_COLUMNS}&team=eq.${team}&date=gte.${todayYmd}&date=lte.${tomorrow}&${order}`);
  const later = await getAll<Record<string, unknown>>(env,
    `as_tickets?select=${TICKET_COLUMNS}&team=eq.${team}&date=gt.${tomorrow}&date=lte.${addDays(todayYmd, DEFER_DAYS)}&note=ilike.*${enc("연기")}*&${order}`);
  return [...near, ...later];
}

async function loadMembers(env: DbEnv): Promise<MemberLike[]> {
  const rows = await getJson<Array<{ name: string | null; team: string | null; dept: string | null; active: boolean | null }>>(env,
    "cs_members?select=name,team,dept,active&active=is.true&limit=1000");
  return rows.map((r) => ({ name: String(r.name ?? "").trim(), team: String(r.team ?? ""), dept: String(r.dept ?? ""), active: r.active === true }))
    .filter((r) => r.name);
}

type TeamResult = {
  team: Team; slot: string; status: "queued" | "dry" | "skipped" | "failed"; reason: string;
  room: string; realRoom: string; test: boolean; text: string; lines: number; polished: boolean;
  outboxId: string | null; logId: number | null; chars: number;
};

async function polish(payload: unknown[]): Promise<{ lines: string[] | null; model: string; error: string }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const model = Deno.env.get("OPENAI_REPORT_MODEL") || REPORT_POLISH_DEFAULT_MODEL;
  if (!apiKey) return { lines: null, model, error: "OPENAI_API_KEY 없음" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), POLISH_TIMEOUT_MS);
  try {
    const res = await polishReportLines(payload, { apiKey, model, fnTag: "schedule-report", signal: ctl.signal });
    return res.ok ? { lines: res.lines, model: res.model, error: "" } : { lines: null, model: res.model, error: `${res.status} ${res.error}` };
  } catch (e) {
    return { lines: null, model, error: ctl.signal.aborted ? "40초 초과" : errMsg(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function runTeam(env: DbEnv, req: ScheduleReportRequest, cfg: ReportConfig, team: Team, nowKst: KstNow): Promise<TeamResult> {
  const { slot, dryRun, actor } = req;
  const r: TeamResult = {
    team, slot, status: "skipped", reason: "", room: "", realRoom: "", test: false, text: "", lines: 0, polished: false,
    outboxId: null, logId: null, chars: 0,
  };
  const baseRow = { kst_date: nowKst.ymd, team, slot, actor };
  let draftHash = "";
  let aiModel = "";

  /** 결과를 로그에 — claim 행이 있으면 갱신, 없으면 새 행 */
  const record = async (status: TeamResult["status"], reason: string) => {
    r.status = status;
    r.reason = reason;
    r.chars = r.text.length;
    const fields = {
      status, reason: clip(reason, 300), room: r.room, real_room: r.realRoom, test: r.test, outbox_id: r.outboxId,
      text: clip(r.text, 6000), draft_hash: draftHash, lines: r.lines, polished: r.polished, ai_model: aiModel,
    };
    if (r.logId !== null) await patchLog(env, r.logId, fields);
    else {
      const ins = await insertReturning<{ id: number }>(env, LOG, { ...baseRow, ...fields });
      if (!ins.already) r.logId = ins.row.id;
    }
    return r;
  };

  try {
    // 1) 차수 잡기(12/14) — 같은 날·팀·차수는 한 번만
    if (!dryRun && slot !== "now") {
      const claim = await insertReturning<{ id: number }>(env, LOG, { ...baseRow, status: "claim" });
      if (claim.already) { r.reason = "already"; return r; }
      r.logId = claim.row.id;
    }

    // 2) 스위치·카톡 전송·영업일·시각
    const gate = slotGate({ slot, dryRun, config: cfg, nowKst });
    if (gate) return await record("skipped", gate);

    // 3) [지금 보내기] 연타 막기 → claim
    if (!dryRun && slot === "now") {
      const since = new Date(Date.now() - NOW_MIN_GAP_MS).toISOString();
      const recent = await getJson<Array<{ status: string; created_at: string }>>(env,
        `${LOG}?select=status,created_at&team=eq.${team}&slot=eq.now&created_at=gte.${enc(since)}`);
      if (nowTooSoon(recent, Date.now())) return await record("skipped", "too_soon");
      const claim = await insertReturning<{ id: number }>(env, LOG, { ...baseRow, status: "claim" });
      if (!claim.already) r.logId = claim.row.id;
    }

    // 4) 사람이 이미 [복사] 했나(12/14)
    const copyFrom = dryRun ? null : copyWindowStartIso(slot, nowKst.ymd);
    if (copyFrom) {
      const copies = await getJson<Array<{ id: number }>>(env,
        `${LOG}?select=id&team=eq.${team}&slot=eq.copy&kst_date=eq.${nowKst.ymd}&created_at=gte.${enc(copyFrom)}&limit=1`);
      if (copies.length) return await record("skipped", "manual_copied");
    }

    // 5) 재료 → 계획
    const [tickets, members] = await Promise.all([loadTickets(env, team, nowKst.ymd), loadMembers(env)]);
    const plan = midReportPlanFor({ tickets, members, nowKst, team, slot });
    draftHash = plan.draftHash;
    r.lines = plan.payload.length;
    if (plan.eligibleTodayCount === 0) {
      r.text = plan.draft;
      return await record(dryRun ? "dry" : "skipped", "empty");
    }

    // 6) 방 — 매핑이 없으면 보내지 않는다(dryRun 은 글만 보여 줌)
    const roomRows = await getJson<Array<{ region: string; room: string }>>(env,
      `room_map?select=region,room&category=eq.${enc(ROOM_CATEGORY)}`);
    const pick = pickRoom(roomRows, team, cfg);
    if (!pick.ok && !dryRun) {
      r.text = plan.draft;
      return await record("skipped", "no_room");
    }

    // 7) AI 다듬기(실패면 규칙 초안)
    let body = plan.draft;
    let reason = "";
    if (plan.payload.length) {
      const ai = await polish(plan.payload);
      const assembled = ai.lines ? plan.assemble(ai.lines) : null;
      if (assembled) {
        body = assembled;
        r.polished = true;
        aiModel = ai.model;
      } else {
        reason = `ai_fallback: ${ai.error || "개수 불일치"}`;
      }
    }

    // 8) 테스트방 치환
    if (pick.ok) {
      r.room = pick.room;
      r.realRoom = pick.realRoom;
      r.test = pick.test;
      r.text = withTestHeader(body, pick);
    } else {
      r.text = body;
      reason = reason ? `no_room · ${reason}` : "no_room";
    }

    // 9) dryRun 이면 여기까지
    if (dryRun) return await record("dry", reason);

    const ob = await insertReturning<{ id: string }>(env, "outbox", { room: r.room, text: r.text });
    if (ob.already) throw new Error("outbox 넣기 실패");
    r.outboxId = String(ob.row.id);
    // 넣은 뒤 기록 실패는 '보냄'으로 돌려준다(실패로 적으면 사람이 또 보낸다) — 응답 500 으로 감시에만 잡히게
    try {
      return await record("queued", reason);
    } catch (e) {
      r.status = "queued";
      r.reason = clip(`log_update_failed: ${errMsg(e)}`, 300);
      r.chars = r.text.length;
      return r;
    }
  } catch (e) {
    const reason = clip(errMsg(e), 300);
    try {
      return await record("failed", reason);
    } catch {
      r.status = "failed";
      r.reason = reason;
      return r;
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "POST 만" }, { status: 405, headers: jsonHeaders });

  const authorized = isAuthorized(req.headers.get("authorization"), {
    projectRef: projectRefOf(Deno.env.get("SUPABASE_URL") || ""),
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    nowMs: Date.now(),
  });
  if (!authorized) return Response.json({ error: "인증된 호출만 받습니다" }, { status: 403, headers: jsonHeaders });

  const parsed = parseRequest(await req.json().catch(() => ({})));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400, headers: jsonHeaders });

  const env = dbEnv();
  if (!env) return Response.json({ error: "SUPABASE_URL·SERVICE_ROLE_KEY 없음" }, { status: 500, headers: jsonHeaders });

  const nowKst = kstNow();
  let cfg: ReportConfig;
  try {
    cfg = readConfig(await readConfigMap(env));
  } catch (e) {
    return Response.json({ ok: false, kstDate: nowKst.ymd, error: `설정 읽기 실패: ${errMsg(e)}` }, { status: 500, headers: jsonHeaders });
  }

  const teams = teamsToRun(parsed.team, cfg.teams);
  const results: TeamResult[] = [];
  for (const team of teams) results.push(await runTeam(env, parsed, cfg, team, nowKst));

  const failed = results.some((x) => x.status === "failed" || x.reason.startsWith("log_update_failed"));
  return Response.json({ ok: !failed, kstDate: nowKst.ymd, results }, { status: failed ? 500 : 200, headers: jsonHeaders });
});
