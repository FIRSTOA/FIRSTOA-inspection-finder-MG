/**
 * 관리 탭 [카톡 수집] 카드의 데이터·판정 (2026-10-24, 설계 docs/tasks/kakao-collect-expand.md 3-6·3-7).
 *
 * 읽기
 *  - Supabase kakao_collect_rooms(방 목록·순서) · kakao_import_log(방별 원문 최근 글) — src/supabase.ts 래퍼
 *  - GAS ?action=collectstatus(방별 구조 적재 최근·확인필요) · ?action=adminstatus(수집함·작업 큐) — 읽기라 토큰 없음
 * 쓰기
 *  - ingestnow·retryheld·kakaoclear 는 엣지 gas-admin 경유(토큰은 엣지 시크릿). GAS 를 토큰 없이 부르면 403 본문.
 *  - kakao_collect_rooms 는 anon 권한이 SELECT 뿐 → 방 추가·수정은 화면이 insert SQL 한 줄을 만들어 주고 사용자가 SQL Editor 에서 실행.
 * 판정·집계는 순수 함수(tests/kakaoCollectAdmin.test.ts).
 */
import { invokeEdgeFunction, selectRows } from "./supabase";
import { GAS_GET_URL } from "./api";
import { isBusinessDay } from "./planDate";
import { kstDate } from "./visits";

export const COLLECT_KINDS = ["점검", "AS", "물류", "불만", "미수", "재계약", "초과조정"] as const;
export const COLLECT_REGIONS = ["A", "B", "C", "D", "E", "AB", "CD", "*"] as const;
export const COLLECT_ROOMS_SQL_FILE = "supabase/kakao-collect-rooms-20261024.sql";
export const IMPORT_LOG_SQL_FILE = "supabase/kakao-messages-20261024.sql";

export type CollectRoomRow = {
  room: string;
  kinds: string[];
  region: string | null;
  enabled: boolean;
  export: boolean;
  structured: boolean;
  keep_raw: boolean;
  sort_order: number;
  note: string | null;
};

export type ImportLogRow = { room: string; to_at: string | null; status: string; created_at: string; file_name?: string | null; inserted?: number; error?: string | null };

export type GasCollectRoom = {
  room: string; kinds?: string[]; region?: string; enabled?: boolean; export?: boolean; structured?: boolean; keep_raw?: boolean;
  last_import_at?: string | null; last_raw_at?: string | null; held?: number;
};
export type GasLastRun = { at?: string; files?: number; done?: number; added?: number; held?: number; failed?: number; pending?: boolean; deferred?: number; mapSource?: string };
export type GasCollectStatus = {
  ok?: boolean; error?: string; source?: string; supabaseError?: string;
  rooms?: GasCollectRoom[]; held_total?: number; held_names?: string[]; unregistered?: string[]; last_run?: GasLastRun | null;
};
export type GasAdminStatus = {
  ok?: boolean; error?: string;
  queue?: { jobs?: Array<{ roomType?: string; teamLabel?: string; status?: string; lastError?: string }>; active?: boolean };
  drive?: { enabled?: boolean; hasTrigger?: boolean; pending?: number; folderUrl?: string; interval?: string; held?: number; heldNames?: string[]; lastIngest?: GasLastRun | null };
};
export type GasActionResult = { ok?: boolean; status?: number; error?: string; [key: string]: unknown };

export type CollectState = "ok" | "warn" | "bad" | "off";
export const COLLECT_STATE_LABEL: Record<CollectState, string> = { ok: "정상", warn: "지연", bad: "멈춤", off: "수집 안 함" };

/** PostgREST 가 표 없음을 알릴 때(404 · PGRST205 · relation does not exist). selectRows 오류 글을 받는다. */
export function isMissingTableError(message: string): boolean {
  return /\(404\)|PGRST205|does not exist|Could not find the table/i.test(String(message || ""));
}

/** ISO 시각 → KST 날짜 'YYYY-MM-DD'. 못 읽으면 null. */
export function kstYmdOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : kstDate(d);
}

/** ISO 시각 → '10/25 07:12'(KST). 못 읽으면 '-'. */
export function formatKstShort(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value || "";
  return `${Number(v("month"))}/${Number(v("day"))} ${v("hour")}:${v("minute")}`;
}

/** from(포함 안 함) 다음 날부터 to(포함)까지 영업일 수. from >= to 면 0. */
export function bizDaysAfter(fromYmd: string, toYmd: string): number {
  if (fromYmd >= toYmd) return 0;
  const d = new Date(`${fromYmd}T12:00:00+09:00`);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    d.setDate(d.getDate() + 1);
    const ymd = kstDate(d);
    if (ymd > toYmd) break;
    if (isBusinessDay(ymd)) n++;
  }
  return n;
}

/**
 * 방 상태 판정.
 *  - enabled=false 또는 export=false → off(회색, 매크로가 저장하지 않는 방)
 *  - 마지막 수집 흔적이 없음 → bad
 *  - 오늘·어제(달력) 또는 그 뒤 영업일이 1일 이하(금요일 → 월요일) → ok
 *  - 그 뒤 영업일 2~3일 → warn(노랑), 4일 이상 → bad(빨강)
 */
export function collectState(room: { enabled?: boolean; export?: boolean }, lastYmd: string | null, today: string): CollectState {
  if (room.enabled === false || room.export === false) return "off";
  if (!lastYmd) return "bad";
  if (lastYmd >= today) return "ok";
  const prev = new Date(`${today}T12:00:00+09:00`);
  prev.setDate(prev.getDate() - 1);
  if (lastYmd >= kstDate(prev)) return "ok";
  const lag = bizDaysAfter(lastYmd, today);
  if (lag <= 1) return "ok";
  if (lag <= 3) return "warn";
  return "bad";
}

/** kakao_import_log(순서 무관) → 방별 원문 최근 글(to_at)·최근 성공 적재 시각(created_at) — 둘 다 error 줄 제외 · 마지막 상태 · 최근 5줄(error 포함). */
export function importLogByRoom(rows: ImportLogRow[]): Record<string, { lastToAt: string | null; lastStatus: string; lastCreatedAt: string; recent: ImportLogRow[] }> {
  const sorted = rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const out: Record<string, { lastToAt: string | null; lastStatus: string; lastCreatedAt: string; recent: ImportLogRow[] }> = {};
  for (const r of sorted) {
    const cur = out[r.room] || (out[r.room] = { lastToAt: null, lastStatus: r.status, lastCreatedAt: "", recent: [] });
    if (cur.recent.length < 5) cur.recent.push(r);
    if (r.status === "error") continue; // 실패 줄은 "들어온" 것으로 치지 않는다
    if (!cur.lastCreatedAt) cur.lastCreatedAt = r.created_at;
    if (r.to_at && (!cur.lastToAt || r.to_at > cur.lastToAt)) cur.lastToAt = r.to_at;
  }
  return out;
}

export type CollectRoomView = {
  room: string; kinds: string[]; region: string; enabled: boolean; export: boolean; structured: boolean; keepRaw: boolean;
  lastImportAt: string | null;   // 구조 적재 최근(GAS 수집 로그)
  lastRawAt: string | null;      // 원문 최근 글(kakao_import_log.to_at, 없으면 GAS last_raw_at)
  lastSeenYmd: string | null;    // 상태 판정에 쓴 날짜 = 위 둘 + 적재 기록 시각 중 가장 늦은 KST 날짜
  held: number;
  state: CollectState;
  recent: ImportLogRow[];
};

const maxIso = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x && !Number.isNaN(new Date(x).getTime()))
  .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

/**
 * 방 줄 만들기. 순서 = kakao_collect_rooms(sort_order). 표가 없으면(null) GAS collectstatus 방 목록으로 대신한다.
 */
export function buildRoomViews(table: CollectRoomRow[] | null, gas: GasCollectStatus | null, log: ImportLogRow[], today: string): CollectRoomView[] {
  const gasBy = new Map((gas?.rooms || []).map((r) => [r.room, r]));
  const logBy = importLogByRoom(log);
  const base = table
    ? table.slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.room.localeCompare(b.room))
      .map((r) => ({ room: r.room, kinds: r.kinds || [], region: r.region || "", enabled: r.enabled, export: r.export, structured: r.structured, keepRaw: r.keep_raw }))
    : (gas?.rooms || []).map((r) => ({ room: r.room, kinds: r.kinds || [], region: r.region || "", enabled: r.enabled !== false, export: r.export !== false, structured: r.structured !== false, keepRaw: r.keep_raw !== false }));
  return base.map((r) => {
    const g = gasBy.get(r.room);
    const l = logBy[r.room];
    const lastImportAt = g?.last_import_at || null;
    const lastRawAt = l?.lastToAt || g?.last_raw_at || null;
    const lastSeenYmd = kstYmdOf(maxIso(lastImportAt, lastRawAt, l?.lastCreatedAt));
    return { ...r, lastImportAt, lastRawAt, lastSeenYmd, held: g?.held || 0, state: collectState(r, lastSeenYmd, today), recent: l?.recent || [] };
  });
}

export type CollectHeadline = { lastIngestAt: string | null; heldCount: number; todayRooms: number; activeRooms: number; text: string };

/** 머리 한 줄: "마지막 적재 10/25 07:12 · 확인필요 2 · 오늘 들어온 방 14/20". 분모 = 수집 대상(off 아님) 방. */
export function collectHeadline(views: CollectRoomView[], gas: GasCollectStatus | null, admin: GasAdminStatus | null, today: string): CollectHeadline {
  const lastIngestAt = gas?.last_run?.at || admin?.drive?.lastIngest?.at || null;
  const heldCount = Number(gas?.held_total ?? admin?.drive?.held ?? 0) || 0;
  const active = views.filter((v) => v.state !== "off");
  const todayRooms = active.filter((v) => v.lastSeenYmd === today).length;
  const text = `마지막 적재 ${lastIngestAt ? formatKstShort(lastIngestAt) : "기록 없음"} · 확인필요 ${heldCount} · 오늘 들어온 방 ${todayRooms}/${active.length}`;
  return { lastIngestAt, heldCount, todayRooms, activeRooms: active.length, text };
}

/** 표가 없을 때(404) 보여 줄 안내. 둘 다 있으면 빈 배열. */
export function missingTableNotices(roomsMissing: boolean, logMissing: boolean): string[] {
  const out: string[] = [];
  if (roomsMissing) out.push(`SQL 실행 대기 — kakao_collect_rooms 표가 아직 없습니다. ${COLLECT_ROOMS_SQL_FILE} 를 SQL Editor 에서 실행하세요. 그 전에는 GAS 의 _room_map 시트 매핑으로 보여 줍니다.`);
  if (logMissing) out.push(`SQL 실행 대기 — kakao_import_log 표가 아직 없어 원문 최근 글을 비워 둡니다. ${IMPORT_LOG_SQL_FILE} 를 실행하면 채워집니다.`);
  return out;
}

/** 방 추가 SQL 한 줄(사용자가 SQL Editor 에서 실행). 이미 있는 방은 건드리지 않는다. 작은따옴표는 두 번. */
export function buildCollectRoomInsertSql(draft: { room: string; kinds: string[]; region: string }): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const room = draft.room.trim();
  const kinds = draft.kinds.filter((k) => (COLLECT_KINDS as readonly string[]).includes(k));
  const region = draft.region.trim();
  return `insert into public.kakao_collect_rooms (room, kinds, region, sort_order) values (${q(room)}, array[${kinds.map(q).join(",")}]::text[], ${region ? q(region) : "null"}, 100) on conflict (room) do nothing;`;
}

/** 방 추가 초안이 SQL 로 만들 만한지(빈 이름·종류 없음이면 이유). */
export function collectDraftProblem(draft: { room: string; kinds: string[] }): string {
  if (!draft.room.trim()) return "방 이름을 넣어 주세요.";
  if (!draft.kinds.length) return "처리 종류를 하나 이상 고르세요.";
  return "";
}

/** GAS 동작 결과를 한 줄로. GAS 403 본문(토큰 거부)은 그대로 실패 문구. */
export function describeGasResult(action: "ingestnow" | "retryheld" | "kakaoclear", r: GasActionResult): { ok: boolean; text: string } {
  if (!r || r.ok !== true) {
    const err = String(r?.error || "실패");
    return { ok: false, text: r?.status === 403 ? `GAS 가 거부했습니다(관리 토큰) — ${err}` : err };
  }
  if (action === "ingestnow") return { ok: true, text: `파일 ${r.files ?? 0} · 처리 ${r.done ?? 0} · 신규 ${r.added ?? 0} · 확인필요 ${r.held ?? 0} · 실패 ${r.failed ?? 0}${r.pending ? " · 시간 부족으로 다음 회차에 이어서" : ""}` };
  if (action === "retryheld") return { ok: true, text: `확인필요 파일 ${r.moved ?? 0}개를 수집함으로 되돌렸습니다. 다음 수집 때 다시 처리됩니다.` };
  return { ok: true, text: `끝난 작업 ${r.removed ?? 0}개 정리 · 남은 작업 ${r.remaining ?? 0}개` };
}

// ── 네트워크 ──────────────────────────────────────────────────────────────

export type CollectCardData = {
  table: CollectRoomRow[] | null; tableMissing: boolean; tableError: string;
  log: ImportLogRow[]; logMissing: boolean; logError: string;
  gas: GasCollectStatus | null; gasError: string;
  admin: GasAdminStatus | null; adminError: string;
};

async function gasGet<T extends { ok?: boolean; error?: string }>(action: string): Promise<T> {
  const res = await fetch(`${GAS_GET_URL}?action=${encodeURIComponent(action)}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`GAS ${action} 응답 ${res.status}`);
  const data = await res.json() as T;
  if (data && data.ok === false) throw new Error(String(data.error || `GAS ${action} 실패`));
  return data;
}

const errText = (r: PromiseSettledResult<unknown>) => r.status === "rejected" ? String((r.reason as Error)?.message || r.reason) : "";

/** 카드에 필요한 4가지를 동시에. 하나가 실패해도 나머지는 보여 주고, 실패는 각자 글로 돌려준다(삼키지 않음). */
export async function loadCollectCard(): Promise<CollectCardData> {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [t, l, g, a] = await Promise.allSettled([
    selectRows<CollectRoomRow>("kakao_collect_rooms", "select=room,kinds,region,enabled,export,structured,keep_raw,sort_order,note&order=sort_order.asc,room.asc"),
    selectRows<ImportLogRow>("kakao_import_log", `select=room,to_at,status,created_at,file_name,inserted,error&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1000`),
    gasGet<GasCollectStatus>("collectstatus"),
    gasGet<GasAdminStatus>("adminstatus"),
  ]);
  const tErr = errText(t);
  const lErr = errText(l);
  const tableMissing = !!tErr && isMissingTableError(tErr);
  const logMissing = !!lErr && isMissingTableError(lErr);
  return {
    table: t.status === "fulfilled" ? t.value : null, tableMissing, tableError: tableMissing ? "" : tErr,
    log: l.status === "fulfilled" ? l.value : [], logMissing, logError: logMissing ? "" : lErr,
    gas: g.status === "fulfilled" ? g.value : null, gasError: errText(g),
    admin: a.status === "fulfilled" ? a.value : null, adminError: errText(a),
  };
}

/** 쓰기 동작 — 엣지 gas-admin 경유. ingestnow 는 몇 분 걸릴 수 있어 넉넉히 기다린다(엣지는 140초에서 끊음). */
export async function runGasAdmin(action: "ingestnow" | "retryheld" | "kakaoclear"): Promise<GasActionResult> {
  return invokeEdgeFunction<GasActionResult>("gas-admin", { action }, action === "ingestnow" ? 160_000 : 30_000);
}

export const todayKst = () => kstDate();
