/**
 * 카톡 원문 넣기 — 내보내기 TXT 조각 → kakao_messages (2026-10-24, 원문 보존)
 * 설계: docs/tasks/kakao-collect-expand.md 3-5 · 부록 B, 표: supabase/kakao-messages-20261024.sql
 *
 * 누가 부르나: GAS apps-script/first-data/src/KakaoRaw.gs (드라이브 수신함 처리 뒤, 날짜 띠 경계 500KB 조각).
 * 인증: 헤더 x-ingest-token 이 시크릿 FIELD_INGEST_TOKEN 과 같아야 한다(서비스 키를 GAS 에 두지 않는다).
 *       Authorization 은 anon 키(엣지 기본 JWT 검사 통과용). 토큰 시크릿이 비어 있으면 모든 요청을 거부한다.
 *
 * 요청 POST JSON
 *   { room, text, file_name?, chunk_index?, chunk_count?, source?: "gas-drive"|"app-upload"|"phone-export" }  → 넣기
 *   { mode: "last", room }                                                                                 → 그 방 마지막 적재 시각(증분 기준)
 * 응답
 *   넣기: { ok, read, inserted, skipped, masked, from_at, to_at, import_id, log_error? }   (skipped = 이미 있던 글)
 *   last: { ok, room, last_to_at }
 *
 * 규칙
 *  - 한 요청 text 최대 500KB(UTF-8). 넘으면 413 — GAS 가 더 잘게 자른다.
 *  - 방은 kakao_collect_rooms(enabled·keep_raw) 에 있어야 한다(공백 무시 비교). 없으면 403 — 개인방·잡담방은 넣지 않는다.
 *  - 가림·분류 추정·중복 키는 _shared/kakao-parse.ts. DB 트리거가 한 번 더 가린다.
 *  - insert 는 on_conflict=hash + ignore-duplicates(이미 있는 글은 건너뜀). 250행씩, statement timeout(57014)이면 반씩 쪼개 다시
 *    (2026-10-31: 500행 묶음이 8초 한도를 넘어 0행 적재로 끝나던 것 — _shared/rest-batch.ts).
 *  - 조각마다 kakao_import_log 1행(본문 없음). 기록 실패는 응답 log_error 로 알린다(삼키지 않음).
 */
import { MAX_INGEST_BYTES, parseKakaoText, toRows, utf8Bytes, type KakaoRow } from "../_shared/kakao-parse.ts";
import { insertInChunks } from "../_shared/rest-batch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const INGEST_TOKEN = Deno.env.get("FIELD_INGEST_TOKEN") || "";
const REST = `${SUPABASE_URL}/rest/v1`;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const enc = encodeURIComponent;
const SOURCES = new Set(["gas-drive", "app-upload", "phone-export"]);
const BATCH = 250;
const MIN_BATCH = 25;

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${REST}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 200)}`);
  return (text.trim() ? JSON.parse(text) : null) as T;
}

/** 길이가 같을 때만 글자별 비교(시간 차로 토큰을 알아내지 못하게) */
function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const roomKey = (s: string) => String(s || "").replace(/\s+/g, "");
type CollectRoom = { room: string; kinds: string[] | null; region: string | null; enabled: boolean; keep_raw: boolean };

async function findRoom(room: string): Promise<CollectRoom | null> {
  const rows = await rest<CollectRoom[]>("/kakao_collect_rooms?select=room,kinds,region,enabled,keep_raw");
  return rows.find((r) => roomKey(r.room) === roomKey(room)) || null;
}

/** app_config.KAKAO_BOT_NICKS(쉼표 목록) — 없으면 기본 "Ai법인폰"(GAS Kakao.gs 와 같은 기본값) */
async function botNicks(): Promise<Set<string>> {
  const rows = await rest<Array<{ value: string }>>("/app_config?select=value&key=eq.KAKAO_BOT_NICKS&limit=1").catch(() => []);
  const list = String(rows[0]?.value || "Ai법인폰").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(list);
}

async function insertRows(rows: Record<string, unknown>[]): Promise<number> {
  return await insertInChunks(rows, async (chunk) => {
    const got = await rest<Array<{ hash: string }>>("/kakao_messages?on_conflict=hash&select=hash", {
      method: "POST",
      body: JSON.stringify(chunk),
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    });
    return Array.isArray(got) ? got.length : 0;
  }, { size: BATCH, minSize: MIN_BATCH });
}

async function writeLog(row: Record<string, unknown>): Promise<{ id: number | null; error: string }> {
  try {
    const got = await rest<Array<{ id: number }>>("/kakao_import_log?select=id", {
      method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" },
    });
    return { id: got?.[0]?.id ?? null, error: "" };
  } catch (e) {
    console.error("kakao_import_log 기록 실패", e);
    return { id: null, error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, error: "POST 만 받습니다" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return reply({ ok: false, error: "서버 설정 없음(SUPABASE_URL/SERVICE_ROLE_KEY)" }, 500);
  if (!INGEST_TOKEN) return reply({ ok: false, error: "FIELD_INGEST_TOKEN 시크릿이 비어 있어 받지 않습니다" }, 503);
  if (!sameToken(req.headers.get("x-ingest-token") || "", INGEST_TOKEN)) return reply({ ok: false, error: "토큰이 맞지 않습니다" }, 401);

  // 본문 크기는 JSON 을 풀기 전에 먼저 본다(조각 한도 + JSON 여유)
  const raw = await req.text();
  if (utf8Bytes(raw) > MAX_INGEST_BYTES + 16 * 1024) return reply({ ok: false, error: `요청이 너무 큽니다(최대 ${MAX_INGEST_BYTES / 1024}KB) — 더 잘게 나눠 보내세요` }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply({ ok: false, error: "JSON 이 아닙니다" }, 400); }

  const room = String(body.room || "").trim();
  if (!room) return reply({ ok: false, error: "room 이 비었습니다" }, 400);

  try {
    // 증분 기준 — 그 방의 마지막 적재 시각
    if (body.mode === "last") {
      const canonical = (await findRoom(room))?.room || room; // 적재 기록의 방 이름은 kakao_collect_rooms 표기
      const rows = await rest<Array<{ to_at: string | null }>>(
        `/kakao_import_log?select=to_at&room=eq.${enc(canonical)}&status=eq.ok&to_at=not.is.null&order=to_at.desc&limit=1`,
      );
      return reply({ ok: true, room: canonical, last_to_at: rows[0]?.to_at || null });
    }

    const text = String(body.text || "");
    if (!text.trim()) return reply({ ok: false, error: "text 가 비었습니다" }, 400);
    if (utf8Bytes(text) > MAX_INGEST_BYTES) return reply({ ok: false, error: `text 가 ${MAX_INGEST_BYTES / 1024}KB 를 넘습니다` }, 413);

    const fileName = String(body.file_name || "").split(/[\\/]/).pop()?.slice(0, 200) || "";
    const source = SOURCES.has(String(body.source)) ? String(body.source) : "gas-drive";
    const chunkIndex = Number.isInteger(body.chunk_index) ? Number(body.chunk_index) : null;
    const chunkCount = Number.isInteger(body.chunk_count) ? Number(body.chunk_count) : null;
    const logBase = { room, source, file_name: fileName || null, chunk_index: chunkIndex, chunk_count: chunkCount };

    const target = await findRoom(room);
    if (!target || !target.enabled || !target.keep_raw) {
      const why = !target ? "수집 방 목록(kakao_collect_rooms)에 없는 방" : "원문 보관이 꺼진 방";
      const log = await writeLog({ ...logBase, status: "error", error: why });
      return reply({ ok: false, error: `${why}이라 넣지 않았습니다: ${room}`, log_error: log.error || undefined }, 403);
    }

    const messages = parseKakaoText(text, target.room);
    if (!messages.length) {
      const log = await writeLog({ ...logBase, room: target.room, status: "error", error: "읽은 글 0건(형식 확인 필요)" });
      return reply({ ok: false, error: "읽은 글이 0건입니다 — 카톡 내보내기 형식인지 확인하세요", read: 0, log_error: log.error || undefined }, 422);
    }
    const { rows, masked } = await toRows(messages, fileName);
    const bots = await botNicks();
    const times = rows.map((r) => r.sent_at).sort();
    const fromAt = times[0];
    const toAt = times[times.length - 1];

    // 기록 먼저(import_id 를 글에 붙이려고) — 숫자는 넣은 뒤 고친다
    const log = await writeLog({ ...logBase, room: target.room, from_at: fromAt, to_at: toAt, read_count: rows.length, status: "partial" });
    const full = rows.map((r: KakaoRow) => ({
      ...r, room: target.room, kinds: target.kinds || [], region: target.region, is_bot: bots.has(r.author.trim()),
      source, import_id: log.id,
    }));

    let inserted = 0;
    let error = "";
    try {
      inserted = await insertRows(full);
    } catch (e) {
      error = String((e as Error)?.message || e).slice(0, 300);
    }
    const skipped = error ? 0 : rows.length - inserted;
    let logError = log.error;
    if (log.id != null) {
      await rest(`/kakao_import_log?id=eq.${log.id}`, {
        method: "PATCH",
        body: JSON.stringify({ inserted, duplicated: skipped, masked, status: error ? "error" : "ok", error: error || null }),
        headers: { Prefer: "return=minimal" },
      }).catch((e) => { logError = String((e as Error)?.message || e).slice(0, 200); });
    }
    if (error) return reply({ ok: false, error: `넣기 실패: ${error}`, read: rows.length, inserted, log_error: logError || undefined }, 500);
    return reply({ ok: true, read: rows.length, inserted, skipped, masked, from_at: fromAt, to_at: toAt, import_id: log.id, log_error: logError || undefined });
  } catch (e) {
    return reply({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 500);
  }
});
