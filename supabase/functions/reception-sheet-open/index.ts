/**
 * reception-sheet-open — 서비스접수 미처리 = 시트 상태 기준(C3, 2026-10-22)
 * 설계: docs/tasks/reception-unhandled-sheet-and-dept-search.md 5절.
 *
 * 하는 일(읽기 + 제한된 자가 치유):
 *  1. 접수 문서(1QRl…)의 해지방어접수(=영업팀)·경영지원접수·원격 탭을 Sheets API batchGet 1회로 읽는다
 *     (서비스 계정 — field-sheet-sync 와 같은 GOOGLE_SERVICE_ACCOUNT, 공개 링크에 기대지 않음).
 *  2. 머리 검증(다르면 그 탭만 errors 에 넣고 뺀다) → 상태 분류(state.ts sheetStateClass) → 미처리·보류 행만 돌려준다.
 *  3. 앱에서 만든 접수와 시트 행을 잇는다(영업·경영 = field_sheet_sync_jobs.sheet_row + 접수자 일치, 원격 = service_receptions.sheet_row + 이번 달 + 상호).
 *  4. 스위치 RECEPTION_SHEET_OPEN_ENABLED 가 'true' 일 때만: 이어진 DB 접수가 접수/진행중/원격대기인데 시트가 완료면
 *     조건부 PATCH 로 완료(시트 '취소'면 취소). 한 번에 최대 50건. 스위치가 꺼져 있으면 읽기만 한다.
 *  5. 결과는 엣지 메모리에 60초 캐시(Sheets API 할당·속도). 고객 전화번호는 돌려주지 않는다.
 *
 * 응답: { ok, rows, fetchedAt, errors, okSources, coveredIds, healed, healEnabled, cached }
 *  rows[].content(2026-10-25 밤) = 최근 90일 행의 내용 열 원문 600자(줄바꿈 그대로, 40자 summary 로 다 보이면 없음) — 상세 팝업이 바로 보여 준다.
 *  644행 실측: 원문 236.8KB → 299.4KB, gzip(서버) 72.5KB → 약 97.6KB 추정(+25KB).
 * 시트는 절대 쓰지 않는다(D6).
 *
 * 상세 한 행(2026-10-25): 본문 { row: { source, sheetRow, seq } } 이면 목록 대신 그 행만 머리행과 같이 읽어
 * { ok, detail: SheetRowDetail } 을 돌려준다(열 전부·내용 최대 4000자·줄바꿈 그대로, 전화번호 열 제외).
 * 순번이 다르면(행이 밀림) 409, 이미 완료 계열이면 409(처리 끝난 행은 내주지 않는다). 캐시 없음(항상 지금 값).
 */
import { batchGetValues, quoteTitle, sheetsApiConfigured, spreadsheetMeta } from "../field-sheet-sync/sheets-api.ts";
import {
  headerError, healCandidates, kstDaysAgo, kstMonth, LIST_CONTENT_DAYS, linkRows, openRowsOf, parseSheetRows, SHEET_LAYOUTS, sheetRowDetail, SOURCE_LABEL, SPREADSHEET_ID,
  syncedReceptionIds, type DeptJob, type ParsedSheetRow, type RemoteReception, type SheetOpenRow, type SheetRowDetail, type SheetSource,
} from "./state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const CACHE_MS = 60_000;
const HEAL_MAX = 50;
const JOB_DAYS = 120;
const OPEN_DB = ["접수", "진행중", "원격대기"];
const SWITCH_KEY = "RECEPTION_SHEET_OPEN_ENABLED";

type Payload = {
  ok: true;
  rows: SheetOpenRow[];
  fetchedAt: string;
  errors: string[];
  okSources: SheetSource[];
  coveredIds: string[];
  healed: number;
  healEnabled: boolean;
};

let cache: { at: number; payload: Payload } | null = null;
let inflight: Promise<Payload> | null = null;

function dbEnv() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return null;
  return { rest: `${url}/rest/v1`, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}
type DbEnv = NonNullable<ReturnType<typeof dbEnv>>;

async function getJson<T>(env: DbEnv, path: string): Promise<T> {
  const res = await fetch(`${env.rest}/${path}`, { headers: env.headers });
  if (!res.ok) throw new Error(`${path.split("?")[0]} 조회 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 150)}`);
  return await res.json() as T;
}

const enc = encodeURIComponent;
const inIds = (ids: string[]) => ids.map((i) => enc(`"${i}"`)).join(",");
const inText = (vals: string[]) => vals.map((v) => enc(v)).join(",");

async function readSwitch(env: DbEnv): Promise<boolean> {
  const rows = await getJson<Array<{ value: string }>>(env, `app_config?select=value&key=eq.${SWITCH_KEY}`);
  return String(rows[0]?.value ?? "").trim() === "true";
}

/**
 * 이어진 DB 접수 중 아직 열린 것만 골라 조건부 PATCH(상태를 조건에 다시 건다 — 그 사이 사람이 바꾼 건은 덮지 않음).
 * 돌려주는 값 = 실제로 바뀐 행 수.
 */
async function heal(env: DbEnv, candidates: Array<{ id: string; to: "완료" | "취소" }>): Promise<number> {
  if (!candidates.length) return 0;
  const openIds = new Set<string>();
  const ids = candidates.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const rows = await getJson<Array<{ id: string }>>(env, `service_receptions?select=id&id=in.(${inIds(part)})&status=in.(${inText(OPEN_DB)})&deleted=eq.false`);
    rows.forEach((r) => openIds.add(String(r.id)));
  }
  const todo = candidates.filter((c) => openIds.has(c.id)).slice(0, HEAL_MAX);
  let changed = 0;
  const now = new Date().toISOString();
  for (const to of ["완료", "취소"] as const) {
    const group = todo.filter((c) => c.to === to).map((c) => c.id);
    if (!group.length) continue;
    const res = await fetch(`${env.rest}/service_receptions?id=in.(${inIds(group)})&status=in.(${inText(OPEN_DB)})`, {
      method: "PATCH",
      headers: { ...env.headers, Prefer: "return=representation" },
      body: JSON.stringify({ status: to, completed_at: now, completed_by: to === "취소" ? "시트 취소 동기화" : "시트 처리완료 동기화" }),
    });
    if (!res.ok) throw new Error(`자가 치유 PATCH 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 150)}`);
    const body = await res.json().catch(() => []);
    changed += Array.isArray(body) ? body.length : 0;
  }
  return changed;
}

async function compute(): Promise<Payload> {
  const errors: string[] = [];
  if (!sheetsApiConfigured()) throw new Error("GOOGLE_SERVICE_ACCOUNT 시크릿이 없어 접수 시트를 읽을 수 없습니다");

  // 1) 탭 이름을 gid 로 찾고 한 번에 읽는다
  const meta = await spreadsheetMeta(SPREADSHEET_ID);  const sources = Object.keys(SHEET_LAYOUTS) as SheetSource[];
  const ranges: Array<{ source: SheetSource; range: string }> = [];
  for (const s of sources) {
    const L = SHEET_LAYOUTS[s];
    const tab = meta.sheets.get(L.gid);
    if (!tab) { errors.push(`${SOURCE_LABEL[s]} 탭(gid ${L.gid})을 찾지 못했습니다`); continue; }
    ranges.push({ source: s, range: `${quoteTitle(tab.title)}!A${L.firstRow}:${L.lastCol}` });
  }
  const values = await batchGetValues(SPREADSHEET_ID, ranges.map((r) => r.range));

  // 2) 머리 검증 + 분류
  const all: ParsedSheetRow[] = [];
  const okSources: SheetSource[] = [];
  for (const r of ranges) {
    const parsed = parseSheetRows(SHEET_LAYOUTS[r.source], values.get(r.range) || []);
    if (parsed.error) { errors.push(parsed.error); continue; }
    okSources.push(r.source);
    all.push(...parsed.rows);
  }

  // 3) DB 잇기 — 실패해도 시트 행은 돌려준다(이어지지 않은 행으로 보일 뿐)
  const env = dbEnv();
  let jobs: DeptJob[] = [];
  let remotes: RemoteReception[] = [];
  let healEnabled = false;
  if (!env) errors.push("서비스 키 설정이 없어 앱 접수와 시트 행을 잇지 못했습니다");
  else {
    const month = kstMonth();
    const since = new Date(Date.now() - JOB_DAYS * 86_400_000).toISOString();
    const [j, rm, sw] = await Promise.allSettled([
      getJson<DeptJob[]>(env, `field_sheet_sync_jobs?select=category,sheet_row,_dupKey,author&category=in.(reception_sales,reception_mgmt)&sheet_status=eq.synced&created_at=gte.${enc(since)}&limit=5000`),
      getJson<RemoteReception[]>(env, `service_receptions?select=id,type,vendor,receipt_date,sheet_row&type=in.(${inText(["원격이관", "IT"])})&sheet_row=not.is.null&receipt_date=gte.${month}-01&deleted=eq.false&limit=5000`),
      readSwitch(env),
    ]);
    if (j.status === "fulfilled") jobs = j.value; else errors.push(`시트 잡 조회 실패: ${(j.reason as Error)?.message || j.reason}`);
    if (rm.status === "fulfilled") remotes = rm.value; else errors.push(`원격 접수 조회 실패: ${(rm.reason as Error)?.message || rm.reason}`);
    if (sw.status === "fulfilled") healEnabled = sw.value; else errors.push(`스위치 조회 실패(자가 치유 안 함): ${(sw.reason as Error)?.message || sw.reason}`);
  }
  const links = linkRows(all, jobs, remotes, kstMonth());

  // 4) 자가 치유 — 스위치가 켜졌을 때만
  let healed = 0;
  if (env && healEnabled) {
    try {
      healed = await heal(env, healCandidates(all, links));
    } catch (e) {
      errors.push(`시트 완료 반영 실패: ${(e as Error).message}`);
    }
  }

  const covered = new Set<string>([...syncedReceptionIds(jobs), ...links.values()]);
  return {
    ok: true,
    rows: openRowsOf(all, links, kstDaysAgo(LIST_CONTENT_DAYS)),
    fetchedAt: new Date().toISOString(),
    errors,
    okSources,
    coveredIds: [...covered],
    healed,
    healEnabled,
  };
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** 상세 한 행 — 머리행 + 그 행만 읽는다(탭 이름은 spreadsheetMeta 10분 캐시) */
async function readRowDetail(sourceRaw: unknown, rowRaw: unknown, seqRaw: unknown): Promise<SheetRowDetail> {
  const source = String(sourceRaw || "") as SheetSource;
  const L = SHEET_LAYOUTS[source];
  if (!L) throw new HttpError(400, "source 는 sales·mgmt·remote 중 하나여야 합니다");
  const sheetRow = Number(rowRaw);
  if (!Number.isInteger(sheetRow) || sheetRow < L.dataStart || sheetRow > 200_000) throw new HttpError(400, `행 번호가 올바르지 않습니다(${String(rowRaw)})`);
  if (!sheetsApiConfigured()) throw new Error("GOOGLE_SERVICE_ACCOUNT 시크릿이 없어 접수 시트를 읽을 수 없습니다");
  const meta = await spreadsheetMeta(SPREADSHEET_ID);
  const tab = meta.sheets.get(L.gid);
  if (!tab) throw new Error(`${SOURCE_LABEL[source]} 탭(gid ${L.gid})을 찾지 못했습니다`);
  const t = quoteTitle(tab.title);
  const headRange = `${t}!A${L.headerRow}:${L.detailLastCol}${L.headerRow}`;
  const rowRange = `${t}!A${sheetRow}:${L.detailLastCol}${sheetRow}`;
  const got = await batchGetValues(SPREADSHEET_ID, [headRange, rowRange]);
  const header = got.get(headRange)?.[0] || [];
  const headErr = headerError(L, header);
  if (headErr) throw new Error(headErr);
  const detail = sheetRowDetail(L, header, got.get(rowRange)?.[0] || [], sheetRow);
  const want = String(seqRaw ?? "").replace(/\s+/g, "");
  if (want && detail.seq.replace(/\s+/g, "") !== want) {
    throw new HttpError(409, `시트 ${sheetRow}행의 순번이 바뀌었습니다(기대 ${want}, 지금 ${detail.seq || "빈 칸"}) — 목록을 새로 고친 뒤 다시 열어 주세요`);
  }
  if (detail.cls === "done") throw new HttpError(409, `시트에서 이미 '${detail.state}' 처리된 행입니다 — 목록을 새로 고쳐 주세요`);
  return detail;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });
  // 본문이 비었거나 JSON 이 아니면 목록 요청으로 본다(기존 호출 = {})
  const body = await req.json().catch(() => ({})) as { row?: { source?: unknown; sheetRow?: unknown; seq?: unknown } };
  if (body && typeof body === "object" && body.row && typeof body.row === "object") {
    try {
      const detail = await readRowDetail(body.row.source, body.row.sheetRow, body.row.seq);
      return Response.json({ ok: true, detail }, { headers: jsonHeaders });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status, headers: jsonHeaders });
    }
  }
  try {
    // 캐시를 우회하는 옵션은 두지 않는다(공개 호출이 Sheets API 할당을 태우지 않게)
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return Response.json({ ...cache.payload, healed: 0, cached: true }, { headers: jsonHeaders });
    }
    if (!inflight) {
      inflight = compute().then((payload) => { cache = { at: Date.now(), payload }; return payload; }).finally(() => { inflight = null; });
    }
    const payload = await inflight;
    return Response.json({ ...payload, cached: false }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
