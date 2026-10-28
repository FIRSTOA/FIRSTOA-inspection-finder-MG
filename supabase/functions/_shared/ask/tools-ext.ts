/**
 * 통합검색 분석 도구 — 바깥·운영·정의(T12~T15) (2026-10-29, 설계 docs/tasks/search-ask-everything-2026-10-29.md 5-3·6장)
 *
 *  T12 it_sheet     IT파트 공개 시트 CSV 를 그때 읽어 낱말 일치 줄(최대 40) — 저장·복사 없음(엣지 메모리 5분만). 비공개면 그 사실을 오류로.
 *  T13 kakao_search 기존 엣지 kakao-search 경유(스위치·검색어 필수·200줄 제한 그대로) — 꺼져 있으면 enabled:false
 *  T14 ops_status   노트북 심박 n분 전·카톡 방별 마지막 배달·대기·동기화 실패·주요 스위치(AI 비용은 ai_usage anon 권한 회수로 읽기 불가) on/off(원문·질문·키 없음)
 *  T15 kpi_explain  KPI 정의(무엇을 어떻게 세나)·미정 지표 사유 — kpi-defs.json(tools/build-ask-kpi-defs.mjs 산출)
 * 순수 부분은 tests/askToolsExt.test.ts.
 */
import { IT_TABS, IT_TAB_KEYS, itSheetCsvUrl, searchRows, tabRowsFromCsvText, type ItTabKey, type SheetRow } from "./it-sheet.ts";
import KPI_DEFS_JSON from "./kpi-defs.json" with { type: "json" };
import { clip, enc, inList, num, str, toolError, type AskToolArgs, type AskToolCtx } from "./tool-util.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ───────────── T12 IT 시트 ───────────── */

const IT_CACHE_MS = 5 * 60_000;
const itCache = new Map<ItTabKey, { at: number; rows: SheetRow[] }>();
type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** 순수 — 줄 검색 + 칸 글 자르기(빈 칸 버림) */
export function itSheetSearch(rows: SheetRow[], q: string, limit: number): { matched: number; rows: Array<Record<string, string>> } {
  const hit = searchRows(rows, q);
  return {
    matched: hit.length,
    rows: hit.slice(0, limit).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => str(v)).map(([k, v]) => [k, clip(v, 400)]))),
  };
}

export async function itSheetTool(args: AskToolArgs, ctx: AskToolCtx, fetchText: FetchText = (u) => fetch(u)) {
  const tab = str(args.tab) as ItTabKey;
  if (!IT_TAB_KEYS.includes(tab)) return { error: `tab 은 ${IT_TAB_KEYS.map((k) => `${k}(${IT_TABS[k].name})`).join(", ")} 중 하나` };
  const q = str(args.q);
  const limit = Math.min(40, Math.max(1, num(args.limit, 20)));
  try {
    let cached = itCache.get(tab);
    if (!cached || Date.now() - cached.at > IT_CACHE_MS) {
      const res = await fetchText(itSheetCsvUrl(tab));
      if (!res.ok) return { error: `IT 시트를 읽지 못했습니다(${res.status}) — 시트 공유가 '링크가 있는 모든 사용자'인지 확인이 필요합니다` };
      cached = { at: Date.now(), rows: tabRowsFromCsvText(tab, await res.text()) };
      itCache.set(tab, cached);
    }
    return ctx.mask({ tab, sheet: IT_TABS[tab].name, total: cached.rows.length, q, ...itSheetSearch(cached.rows, q, limit), note: "IT파트 소유 시트를 읽기만 했다(복사·저장 없음). 답에 'IT파트 시트' 출처를 밝힌다." });
  } catch (e) { return toolError(e); }
}

/* ───────────── T13 카톡 검색 ───────────── */

export async function kakaoSearchTool(args: AskToolArgs, ctx: AskToolCtx) {
  const q = str(args.q);
  if (!q) return { error: "q(검색어)가 필요합니다 — 카톡 검색은 검색어 없이 전체를 읽지 않습니다" };
  const body: Record<string, unknown> = { q, limit: Math.min(200, Math.max(1, num(args.limit, 80))), who: `data-ask:${ctx.asker.name || ""}` };
  for (const k of ["room", "from", "to"]) if (str(args[k])) body[k] = str(args[k]);
  try {
    const res = await ctx.rest.edge<Record<string, unknown>>("kakao-search", body);
    if (res?.enabled === false) return { enabled: false, note: "카톡 원문 검색 스위치(KAKAO_SEARCH_ENABLED)가 꺼져 있습니다 — 카톡 대화는 근거로 쓸 수 없습니다." };
    if (res?.ok === false) return { error: str(res.error) || "카톡 검색 실패" };
    const rows = Array.isArray(res?.rows) ? (res.rows as Array<Record<string, unknown>>) : [];
    return ctx.mask({ enabled: true, count: rows.length, truncated: !!res?.truncated, rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? clip(v, 300) : v]))) });
  } catch (e) { return toolError(e); }
}

/* ───────────── T14 운영 상태 ───────────── */

/** 이름을 정해 둔 스위치만 on/off 로(값·다른 설정은 주지 않는다) */
export const OPS_SWITCHES = ["FIELD_KAKAO_SEND_ENABLED", "FIELD_SHEET_SYNC_ENABLED", "KAKAO_SEARCH_ENABLED", "DEPT_RECEPTION_ENABLED", "RECEPTION_SHEET_OPEN_ENABLED", "NAVER_CALENDAR_ENABLED"] as const;
const isOn = (v: unknown) => /^(true|1|on|yes)$/i.test(str(v));
/** 순수 — 몇 분 전(KST 무관, 절대 시각 차) */
export const minutesAgo = (iso: unknown, nowMs: number) => { const t = Date.parse(str(iso)); return Number.isFinite(t) ? Math.max(0, Math.round((nowMs - t) / 60_000)) : null; };

export async function opsStatus(_args: AskToolArgs, ctx: AskToolCtx, nowMs: number = Date.now()) {
  void _args;
  const errors: string[] = [];
  const safe = async <T>(label: string, p: Promise<T>, empty: T) => { try { return await p; } catch (e) { errors.push(`${label}: ${errText(e)}`); return empty; } };
  const dayAgo = new Date(nowMs - 86_400_000).toISOString();
  const [hb, rooms, delivered, outbox, syncFailed, syncPending, cfg] = await Promise.all([
    safe("심박", ctx.rest.get<Record<string, unknown>>("worker_heartbeat?select=name,host,last_seen,note&order=last_seen.desc&limit=3"), []),
    safe("방 활동", ctx.rest.get<Record<string, unknown>>("room_activity?select=room,last_at,source&order=last_at.desc&limit=60"), []),
    safe("배달 기록", ctx.rest.getAll<Record<string, unknown>>("kakao_delivery_log", `select=room,kind,sent_at&sent_at=gte.${enc(dayAgo)}`, { max: 3000, orderBy: "sent_at" }).then((r) => r.rows), []),
    safe("발송 대기", ctx.rest.count("outbox"), null as number | null),
    safe("시트 동기화 실패", ctx.rest.count("field_sheet_sync_jobs", "sheet_status=eq.failed"), null as number | null),
    safe("시트 동기화 대기", ctx.rest.count("field_sheet_sync_jobs", "sheet_status=eq.pending"), null as number | null),
    safe("스위치", ctx.rest.get<Record<string, unknown>>(`app_config?select=key,value&key=${inList([...OPS_SWITCHES])}`), []),
  ]);
  const byRoom = new Map<string, { room: string; sent24h: number; last: string }>();
  for (const d of delivered) { const room = str(d.room); const x = byRoom.get(room) || { room, sent24h: 0, last: "" }; x.sent24h += 1; if (str(d.sent_at) > x.last) x.last = str(d.sent_at); byRoom.set(room, x); }
  return ctx.mask({
    now: new Date(nowMs).toISOString(),
    worker: hb.map((h) => ({ name: str(h.name), host: str(h.host), lastSeen: str(h.last_seen), minutesAgo: minutesAgo(h.last_seen, nowMs), note: clip(h.note, 120) })),
    roomActivity: rooms.slice(0, 30).map((r) => ({ room: str(r.room), lastAt: str(r.last_at), minutesAgo: minutesAgo(r.last_at, nowMs), source: str(r.source) })),
    delivered24h: [...byRoom.values()].sort((a, b) => b.sent24h - a.sent24h).map((x) => ({ ...x, minutesAgo: minutesAgo(x.last, nowMs) })),
    outboxWaiting: outbox,
    sheetSync: { failed: syncFailed, pending: syncPending },
    aiThisMonth: "읽기 불가 — ai_usage 는 anon 권한이 회수돼 있다(비용은 관리 탭 AI 사용량 화면에서)",
    switches: Object.fromEntries(OPS_SWITCHES.map((k) => [k, cfg.some((c) => str(c.key) === k) ? isOn(cfg.find((c) => str(c.key) === k)?.value) : null])),
    ...(errors.length ? { partial: errors } : {}),
    rule: "심박 minutesAgo 가 크면(평일 10~19시 기준 30분↑) 노트북 실행기가 멈췄을 수 있다. 원문·질문·키는 주지 않는다. 스위치 null = 설정 행 없음.",
  });
}

/* ───────────── T15 KPI 정의 ───────────── */

export type KpiDefLite = { id: string; name: string; unit: string; group: string; period: string; periods: string[]; scopes: string[]; basis: string; source: string; status: string; targetBasis: string; target: Record<string, unknown> | null; better: string; teams: string; screen?: { screen: string; tab: string } };
export type KpiDefsJson = { defs: KpiDefLite[]; pending: Array<{ id: string; name: string; reason: string }>; recontractOverdue: string };
export const KPI_DEFS_DATA = KPI_DEFS_JSON as unknown as KpiDefsJson;

/** 순수 — 'K19'·'OKR 달성률'·'재계약' 같은 말로 정의 찾기. 비면 목록 */
export function explainKpi(data: KpiDefsJson, q: string) {
  const s = str(q).replace(/\s+/g, "");
  const list = data.defs.map((d) => ({ id: d.id, name: d.name, unit: d.unit, group: d.group }));
  if (!s) return { list, pending: data.pending, note: "kpi 에 'K19' 나 이름 낱말을 주면 정의 본문을 돌려준다." };
  const id = s.match(/^K\d+$/i)?.[0]?.toUpperCase();
  const hits = data.defs.filter((d) => (id ? d.id === id : d.name.replace(/\s+/g, "").includes(s) || s.includes(d.name.replace(/\s+/g, "")) || d.basis.replace(/\s+/g, "").includes(s)));
  const pending = data.pending.filter((p) => (id ? p.id === id : p.name.replace(/\s+/g, "").includes(s) || s.includes(p.name.replace(/\s+/g, ""))));
  return {
    defs: hits.slice(0, 6).map((d) => ({ ...d, ...(d.id === "K25" || /재계약확인/.test(d.name.replace(/\s+/g, "")) ? { definition: data.recontractOverdue } : {}) })),
    pending,
    ...(hits.length || pending.length ? {} : { list, note: `'${q}' 에 맞는 지표가 없습니다 — 목록에서 고르세요.` }),
  };
}

export async function kpiExplain(args: AskToolArgs, ctx: AskToolCtx) {
  void ctx;
  return explainKpi(KPI_DEFS_DATA, str(args.kpi));
}
