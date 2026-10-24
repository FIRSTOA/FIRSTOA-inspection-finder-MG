/**
 * 카톡 원문 찾기 — kakao_messages 읽기 대행 (2026-10-24, 탭 검색 2단계 "카톡 대화")
 * 설계: docs/tasks/tab-search-kakao-history.md 3-3·7절 R1 · docs/tasks/kakao-collect-expand.md 3-5
 *
 * kakao_messages 는 anon 권한이 0 이다(supabase/kakao-messages-20261024.sql). 앱은 이 함수(service role)로만 읽는다.
 * 앱이 anon 키로 부른다(invokeEdgeFunction) — SSO 서버 검증이 없으므로 아래 제한으로 "통째로 긁기"만 막는다(R1):
 *  ① 스위치 app_config KAKAO_SEARCH_ENABLED = 'true' 일 때만(기본 꺼짐 — 직원 고지 뒤 켬). 꺼지면 { enabled:false, rows:[] }
 *  ② 검색어 필수: 낱말(공백 구분, 최대 3개) 중 하나는 정규화 2자 이상 — "전체 목록" 불가
 *  ③ 한 번 최대 200줄(limit, 기본 100)
 *  ④ IP 당 분당 30회(이 함수 인스턴스 안 — 대략적)
 *  ⑤ 검색 기록: 엣지 로그(function_edge_logs)에 "kakao-search" 한 줄(검색어·조건·줄 수·부른 사람 이름). 표(kakao_search_log)는 아직 없다.
 *
 * 요청 POST JSON { q, room?, kinds?: string[], from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', limit?, include_bot?, who? }
 *   - q 는 업체명·키워드. 띄어쓰기·기호를 뺀 글(text_key — DB 생성 열, pg_trgm 인덱스)에서 부분 일치. 낱말이 여러 개면 모두 들어간 글만.
 *   - kinds 는 방 종류 겹침(kinds && {점검,AS}). room 은 방 이름 그대로.
 *   - from/to 는 KST 날짜(포함).
 *   - 봇 글(FIELD 양식 발송분 — FIELD 기록과 중복)은 include_bot 이 true 일 때만.
 * 응답 { ok, enabled, rows: [{ id, room, sent_at, seq, author, text, kind_guess, is_bot }], limit, truncated }
 *   text 는 저장 때 가렸고(엣지 + DB 트리거), 내보내기 전에 _shared/kakao-parse.ts maskKakaoText 로 한 번 더 가린다.
 */
import { maskKakaoText } from "../_shared/kakao-parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const REST = `${SUPABASE_URL}/rest/v1`;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const enc = encodeURIComponent;
const SWITCH_KEY = "KAKAO_SEARCH_ENABLED";
const MAX_LIMIT = 200;
const PER_MIN = 30;
const KINDS = new Set(["점검", "AS", "물류", "불만", "미수", "재계약", "초과조정"]);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// DB 생성 열 text_key 와 같은 정규화: 소문자 + 숫자·영문·한글만
const keyOf = (s: string) => String(s || "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${REST}${path}`, { headers: H });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path.split("?")[0]} 조회 실패(${res.status}) ${text.slice(0, 160)}`);
  return JSON.parse(text) as T;
}

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // 메모리 보호
  return list.length > PER_MIN;
}

type Row = { id: number; room: string; sent_at: string; seq: number; author: string; text: string; kind_guess: string | null; is_bot: boolean };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, error: "POST 만 받습니다" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return reply({ ok: false, error: "서버 설정 없음" }, 500);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return reply({ ok: false, error: "검색이 너무 잦습니다 — 1분 뒤 다시" }, 429);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ ok: false, error: "JSON 이 아닙니다" }, 400); }

  try {
    const sw = await getJson<Array<{ value: string }>>(`/app_config?select=value&key=eq.${SWITCH_KEY}&limit=1`);
    if (String(sw[0]?.value ?? "").trim() !== "true") return reply({ ok: true, enabled: false, rows: [], limit: 0, truncated: false });

    const terms = String(body.q || "").trim().split(/\s+/).map(keyOf).filter(Boolean).slice(0, 3);
    if (!terms.some((t) => t.length >= 2)) return reply({ ok: false, error: "검색어를 2자 이상 넣어 주세요(업체명·키워드)" }, 400);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || 100));
    const room = String(body.room || "").trim();
    const kinds = Array.isArray(body.kinds) ? body.kinds.map(String).filter((k) => KINDS.has(k)) : [];
    const from = YMD.test(String(body.from || "")) ? String(body.from) : "";
    const to = YMD.test(String(body.to || "")) ? String(body.to) : "";

    const parts = ["select=id,room,sent_at,seq,author,text,kind_guess,is_bot"];
    terms.forEach((t) => parts.push(`text_key=ilike.${enc(`*${t}*`)}`));
    if (room) parts.push(`room=eq.${enc(room)}`);
    if (kinds.length) parts.push(`kinds=ov.${enc(`{${kinds.join(",")}}`)}`);
    if (from) parts.push(`sent_at=gte.${enc(`${from}T00:00:00+09:00`)}`);
    if (to) parts.push(`sent_at=lte.${enc(`${to}T23:59:59+09:00`)}`);
    if (body.include_bot !== true) parts.push("is_bot=is.false");
    parts.push("order=sent_at.desc,seq.desc", `limit=${limit}`);

    const rows = await getJson<Row[]>(`/kakao_messages?${parts.join("&")}`);
    const out = rows.map((r) => ({ ...r, author: maskKakaoText(r.author).text, text: maskKakaoText(r.text).text }));
    console.log("kakao-search", JSON.stringify({ who: String(body.who || "").slice(0, 30), ip, terms, room, kinds, from, to, n: out.length }));
    return reply({ ok: true, enabled: true, rows: out, limit, truncated: out.length >= limit });
  } catch (e) {
    return reply({ ok: false, error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
