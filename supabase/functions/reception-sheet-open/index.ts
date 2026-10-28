/**
 * reception-sheet-open — 서비스접수 미처리 = 시트 상태 기준(C3, 2026-10-22)
 * 설계: docs/tasks/reception-unhandled-sheet-and-dept-search.md 5절, 목록·보관 모드 docs/tasks/reception-list-sheet-rows-2026-10-28.md 4절.
 *
 * 하는 일(읽기 + 제한된 자가 치유):
 *  1. 접수 문서(1QRl…)의 해지방어접수(=영업팀)·경영지원접수·원격·AS접수용(CS) 탭을 Sheets API batchGet 1회로 읽는다
 *     (서비스 계정 — field-sheet-sync 와 같은 GOOGLE_SERVICE_ACCOUNT, 공개 링크에 기대지 않음). AS접수용은 A5:T + BD5:BD 두 범위.
 *  2. 머리 검증(다르면 그 탭만 errors 에 넣고 뺀다) → 상태 분류(state.ts sheetStateClass, CS 는 "record").
 *  3. 앱에서 만든 접수와 시트 행을 잇는다(영업·경영 = field_sheet_sync_jobs.sheet_row + 접수자 일치, 원격 = service_receptions.sheet_row + 이번 달 + 상호,
 *     CS = linkCopierRows (날짜·퍼스트순·접수자) 3단계).
 *  4. 스위치 RECEPTION_SHEET_OPEN_ENABLED 가 'true' 일 때만: 이어진 DB 접수가 접수/진행중/원격대기인데 시트가 완료면
 *     조건부 PATCH 로 완료(시트 '취소'면 취소). 한 번에 최대 50건. 스위치가 꺼져 있으면 읽기만 한다.
 *  5. "파싱된 전체 행 + links" 를 엣지 메모리에 60초 캐시 — 미처리·목록·보관 모드가 시트 읽기 1회를 나눠 쓴다. 고객 전화번호는 돌려주지 않는다.
 *
 * 미처리(기존, 본문 {}): { ok, rows, fetchedAt, errors, okSources, coveredIds, linkedIds, healed, healEnabled, cached }
 *  rows = 영업·경영·원격 미처리·보류만(CS 시트 행 없음). coveredIds·linkedIds 에 CS 잇기 결과는 넣지 않는다(기존 숫자 불변).
 *  linkedIds(2026-10-25 밤) = 지금 시트에 있는 행(완료·보류·미처리 무관)에 이어진 접수 id. 프런트는 영업·경영 DB 접수를 이 id 일 때만 뺀다.
 *  rows[].content(2026-10-25 밤) = 최근 90일 행의 내용 열 원문 600자.
 *
 * 목록(2026-10-28, 본문 { list: { from, to } }): { ok, rows: SheetListRow[], noDate, from, to, clipped, fetchedAt, errors, okSources, cached }
 *  2026-10-01 이후·from~to(최대 92일, to 기준으로 자름)·앱 접수와 이어지지 않은 시트 행(완료·기록 포함), content 없음. 날짜 모름은 noDate 개수만.
 *
 * 보관(2026-10-28, 본문 { snapshot: true }): pg_cron(ops.call_edge, vault field_cron_jwt = anon 키) 이 부른다. Bearer 가 service role 키 또는 anon 키여야 하고(무인증·다른 값 403),
 *  5분 안 재호출은 시트를 읽지 않고 { ok: true, throttled: true, nextAfter } 를 돌려준다.
 *  팀장 결정(2026-10-28): 크론 12개와 같은 anon JWT 호출을 그대로 받는다 — 새 시크릿·vault 등록·SQL 수정 없음. 이유: ① 저장 값은 호출자가 아니라
 *  시트에서 오고 ② 목록 모드로 누구나 읽는 가린 값과 같으며 ③ fingerprint 가 다른 행은 덮지 않는다 → 공개 호출의 위험은 부하뿐이라 빈도만 막는다.
 *  reception_sheet_rows 에 service role 로 upsert(on_conflict=source,month,seq), 안 보인 행 gone_at. 응답 { ok, upserted, gone, skipped, noDate, errors }.
 *
 * 상세 한 행(2026-10-25): 본문 { row: { source, sheetRow, seq, allowDone? } } 이면 그 행만 머리행과 같이 읽어
 * { ok, detail: SheetRowDetail } 을 돌려준다(열 전부·내용 최대 4000자·줄바꿈 그대로, 전화번호 열 제외).
 * 순번이 다르면(행이 밀림) 409. 완료 계열이면 409 — 단 allowDone:true(접수리스트 시트 줄 펼침, 2026-10-28)면 완료 행도 연다.
 * statusOnly 쓰기(field-sheet-sync)는 이 값과 무관하게 여전히 열린 행만. 캐시 없음(항상 지금 값).
 * 시트는 절대 쓰지 않는다(D6).
 */
import { batchGetValues, quoteTitle, sheetsApiConfigured, spreadsheetMeta } from "../field-sheet-sync/sheets-api.ts";
import {
  buildSnapshotRecords, clampListRange, colLetter, combineLinks, headerError, healCandidates, kstDaysAgo, kstMonth, LIST_CONTENT_DAYS, linkCopierRows,
  linkRows, listRowsOf, mergeExtraColumns, openRowsOf, parseSheetRows, planSnapshot, SHEET_LAYOUTS, SHEET_LIST_START, sheetRowDetail, SOURCE_LABEL,
  SPREADSHEET_ID, syncedReceptionIds, type CopierLink, type CopierReception, type DeptJob, type LinkRule, type ParsedSheetRow, type RemoteReception,
  type SheetRowDetail, type SheetSource, type SnapshotRecord, type StoredSheetKey,
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
const COPIER_TYPE = "복합기 AS";
const SNAPSHOT_TABLE = "reception_sheet_rows";
const SNAPSHOT_BATCH = 500;
/** errors 에 같은 종류를 몇 개까지 예로 적을지 */
const ERROR_SAMPLES = 5;

/** 시트 1회 읽기 결과(60초 캐시) — 미처리·목록·보관이 나눠 쓴다 */
type Parsed = {
  fetchedAt: string;
  rows: ParsedSheetRow[];
  /** 탭별 읽은 값(firstRow 부터, copier 는 BD 를 끼운 뒤) — 보관 raw·content 원문용 */
  sheets: Map<SheetSource, string[][]>;
  /** 영업·경영·원격 잇기(기존 linkRows) — 미처리 응답은 이것만 */
  baseLinks: Map<string, string>;
  /** + CS 잇기(목록·보관) */
  links: Map<string, string>;
  rules: Map<string, LinkRule>;
  /** 영업·경영·원격(미처리 응답에 싣는 것 — 기존 그대로) */
  errors: string[];
  /** AS접수용(CS) 탭·CS 잇기 오류 — 목록·보관에만(홈 미처리 안내 줄에 새 문구가 끼지 않게) */
  copierErrors: string[];
  okSources: SheetSource[];
  coveredIds: string[];
  healed: number;
  healEnabled: boolean;
};

let cache: { at: number; data: Parsed } | null = null;
let inflight: Promise<Parsed> | null = null;

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
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

/** 시트 읽기 + 파싱 + 잇기 + (스위치 켜짐이면) 자가 치유 — 60초에 한 번 */
async function compute(): Promise<Parsed> {
  const errors: string[] = [];
  const copierErrors: string[] = [];
  const errOf = (s: SheetSource) => (s === "copier" ? copierErrors : errors);
  if (!sheetsApiConfigured()) throw new Error("GOOGLE_SERVICE_ACCOUNT 시크릿이 없어 접수 시트를 읽을 수 없습니다");

  // 1) 탭 이름을 gid 로 찾고 한 번에 읽는다(copier 는 A5:T 와 BD5:BD 두 범위 — 56열 전부 읽지 않음)
  const meta = await spreadsheetMeta(SPREADSHEET_ID);
  const sources = Object.keys(SHEET_LAYOUTS) as SheetSource[];
  const plans: Array<{ source: SheetSource; main: string; extras: Array<{ col: number; range: string }> }> = [];
  for (const s of sources) {
    const L = SHEET_LAYOUTS[s];
    const tab = meta.sheets.get(L.gid);
    if (!tab) { errOf(s).push(`${SOURCE_LABEL[s]} 탭(gid ${L.gid})을 찾지 못했습니다`); continue; }
    const t = quoteTitle(tab.title);
    // 탭 열 수보다 뒤 열을 부르면 batchGet 전체가 400 이 된다(미처리까지 멈춤) — 없는 열은 빼고 알린다
    const extraCols = (L.extraCols || []).filter((col) => {
      if (!tab.maxCols || col <= tab.maxCols) return true;
      errOf(s).push(`${SOURCE_LABEL[s]} 탭에 ${colLetter(col)}열이 없어(열 ${tab.maxCols}개) 그 열은 읽지 않았습니다`);
      return false;
    });
    plans.push({
      source: s,
      main: `${t}!A${L.firstRow}:${L.lastCol}`,
      extras: extraCols.map((col) => ({ col, range: `${t}!${colLetter(col)}${L.firstRow}:${colLetter(col)}` })),
    });
  }
  const values = await batchGetValues(SPREADSHEET_ID, plans.flatMap((p) => [p.main, ...p.extras.map((e) => e.range)]));

  // 2) 머리 검증 + 분류
  const all: ParsedSheetRow[] = [];
  const okSources: SheetSource[] = [];
  const sheets = new Map<SheetSource, string[][]>();
  for (const p of plans) {
    const main = values.get(p.main) || [];
    const merged = p.extras.length ? mergeExtraColumns(main, p.extras.map((e) => ({ col: e.col, values: values.get(e.range) || [] }))) : main;
    const parsed = parseSheetRows(SHEET_LAYOUTS[p.source], merged);
    if (parsed.error) { errOf(p.source).push(parsed.error); continue; }
    okSources.push(p.source);
    sheets.set(p.source, merged);
    all.push(...parsed.rows);
  }

  // 3) DB 잇기 — 실패해도 시트 행은 돌려준다(이어지지 않은 행으로 보일 뿐)
  const env = dbEnv();
  let jobs: DeptJob[] = [];
  let remotes: RemoteReception[] = [];
  let copiers: CopierReception[] = [];
  let healEnabled = false;
  if (!env) errors.push("서비스 키 설정이 없어 앱 접수와 시트 행을 잇지 못했습니다");
  else {
    const month = kstMonth();
    const since = new Date(Date.now() - JOB_DAYS * 86_400_000).toISOString();
    const needCopier = okSources.includes("copier");
    const [j, rm, cp, sw] = await Promise.allSettled([
      getJson<DeptJob[]>(env, `field_sheet_sync_jobs?select=category,sheet_row,_dupKey,author&category=in.(reception_sales,reception_mgmt)&sheet_status=eq.synced&created_at=gte.${enc(since)}&limit=5000`),
      getJson<RemoteReception[]>(env, `service_receptions?select=id,type,vendor,receipt_date,sheet_row&type=in.(${inText(["원격이관", "IT"])})&sheet_row=not.is.null&receipt_date=gte.${month}-01&deleted=eq.false&limit=5000`),
      needCopier
        ? getJson<CopierReception[]>(env, `service_receptions?select=id,receipt_date,first_no,lease_no,author,vendor&type=eq.${enc(COPIER_TYPE)}&receipt_date=gte.${month}-01&deleted=eq.false&limit=5000`)
        : Promise.resolve([] as CopierReception[]),
      readSwitch(env),
    ]);
    if (j.status === "fulfilled") jobs = j.value; else errors.push(`시트 잡 조회 실패: ${errMsg(j.reason)}`);
    if (rm.status === "fulfilled") remotes = rm.value; else errors.push(`원격 접수 조회 실패: ${errMsg(rm.reason)}`);
    if (cp.status === "fulfilled") copiers = cp.value; else copierErrors.push(`CS 접수 조회 실패(CS 시트 줄을 앱 접수와 잇지 못함): ${errMsg(cp.reason)}`);
    if (sw.status === "fulfilled") healEnabled = sw.value; else errors.push(`스위치 조회 실패(자가 치유 안 함): ${errMsg(sw.reason)}`);
  }
  const baseLinks = linkRows(all, jobs, remotes, kstMonth());
  const copierLinks: Map<string, CopierLink> = linkCopierRows(all, copiers);
  const { links, rules } = combineLinks(baseLinks, copierLinks);

  // 4) 자가 치유 — 스위치가 켜졌을 때만(CS 행은 cls record 라 후보가 되지 않는다)
  let healed = 0;
  if (env && healEnabled) {
    try {
      healed = await heal(env, healCandidates(all, baseLinks));
    } catch (e) {
      errors.push(`시트 완료 반영 실패: ${errMsg(e)}`);
    }
  }

  const covered = new Set<string>([...syncedReceptionIds(jobs), ...baseLinks.values()]);
  return {
    fetchedAt: new Date().toISOString(), rows: all, sheets, baseLinks, links, rules, errors, copierErrors, okSources,
    coveredIds: [...covered], healed, healEnabled,
  };
}

/** 캐시(60초) 또는 새로 읽기. 동시에 여러 요청이 와도 읽기는 1회 */
async function getParsed(): Promise<{ data: Parsed; cached: boolean; healed: number }> {
  // 캐시를 우회하는 옵션은 두지 않는다(공개 호출이 Sheets API 할당을 태우지 않게)
  if (cache && Date.now() - cache.at < CACHE_MS) return { data: cache.data, cached: true, healed: 0 };
  if (!inflight) {
    inflight = compute().then((data) => { cache = { at: Date.now(), data }; return data; }).finally(() => { inflight = null; });
  }
  const data = await inflight;
  return { data, cached: false, healed: data.healed };
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** 상세 한 행 — 머리행 + 그 행만 읽는다(탭 이름은 spreadsheetMeta 10분 캐시) */
async function readRowDetail(sourceRaw: unknown, rowRaw: unknown, seqRaw: unknown, allowDone: boolean): Promise<SheetRowDetail> {
  const source = String(sourceRaw || "") as SheetSource;
  const L = Object.prototype.hasOwnProperty.call(SHEET_LAYOUTS, source) ? SHEET_LAYOUTS[source] : undefined;
  if (!L) throw new HttpError(400, "source 는 sales·mgmt·remote·copier 중 하나여야 합니다");
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
  if (detail.cls === "done" && !allowDone) throw new HttpError(409, `시트에서 이미 '${detail.state}' 처리된 행입니다 — 목록을 새로 고쳐 주세요`);
  return detail;
}

// ── 보관 모드 인증 ─────────────────────────────────
function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 보관 모드 인증: Authorization: Bearer 가 엣지 환경변수 SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_ANON_KEY 와 글자까지 같으면 통과(상수 시간 비교).
 * pg_cron 의 ops.call_edge 는 vault field_cron_jwt(= anon 키)를 보낸다. 무인증·다른 값은 403. 부하는 SNAPSHOT_MIN_GAP_MS 로 막는다.
 */
function snapshotAuthorized(req: Request): boolean {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const okService = Boolean(serviceKey) && sameToken(bearer, serviceKey);
  const okAnon = Boolean(anonKey) && sameToken(bearer, anonKey);
  return okService || okAnon;
}

/** 보관 모드 최소 간격(크론은 매시 17분·23:50 이라 영향 없음). 콜드 스타트면 비어 있어 그냥 진행 */
const SNAPSHOT_MIN_GAP_MS = 5 * 60_000;
let lastSnapshotAt = 0;

const sample = (list: string[]) => (list.length > ERROR_SAMPLES ? `${list.slice(0, ERROR_SAMPLES).join(", ")} 외 ${list.length - ERROR_SAMPLES}` : list.join(", "));

/** 이미 있는 행 키(source 한 개, 달 목록) — 1,000행씩 나눠 읽는다 */
async function readStored(env: DbEnv, source: SheetSource, months: string[]): Promise<StoredSheetKey[]> {
  const out: StoredSheetKey[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const part = await getJson<StoredSheetKey[]>(env,
      `${SNAPSHOT_TABLE}?select=month,seq,fingerprint,gone_at&source=eq.${source}&month=in.(${inText(months)})&order=month.asc,seq.asc&limit=${PAGE}&offset=${offset}`);
    out.push(...part);
    if (part.length < PAGE) break;
  }
  return out;
}

async function upsertBatch(env: DbEnv, rows: SnapshotRecord[]): Promise<void> {
  const res = await fetch(`${env.rest}/${SNAPSHOT_TABLE}?on_conflict=source,month,seq`, {
    method: "POST",
    headers: { ...env.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`보관 upsert 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

async function markGone(env: DbEnv, source: SheetSource, month: string, seqs: string[], at: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < seqs.length; i += 100) {
    const part = seqs.slice(i, i + 100);
    const res = await fetch(`${env.rest}/${SNAPSHOT_TABLE}?source=eq.${source}&month=eq.${enc(month)}&seq=in.(${inIds(part)})&gone_at=is.null`, {
      method: "PATCH",
      headers: { ...env.headers, Prefer: "return=representation" },
      body: JSON.stringify({ gone_at: at }),
    });
    if (!res.ok) throw new Error(`gone_at 표시 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const body = await res.json().catch(() => []);
    n += Array.isArray(body) ? body.length : 0;
  }
  return n;
}

/** 보관 표 적재 — 머리·읽기 오류 탭(okSources 밖)과 보관 표 조회에 실패한 탭은 upsert·gone 둘 다 건너뛴다 */
async function snapshot(): Promise<{ ok: boolean; upserted: number; gone: number; skipped: number; noDate: number; errors: string[]; fetchedAt: string }> {
  const env = dbEnv();
  if (!env) throw new Error("서비스 키 설정이 없어 보관 표에 쓸 수 없습니다");
  const { data } = await getParsed();
  const errors = [...data.errors, ...data.copierErrors];
  let upserted = 0;
  let gone = 0;
  let skipped = 0;
  let noDate = 0;
  const now = new Date().toISOString();
  for (const source of data.okSources) {
    const L = SHEET_LAYOUTS[source];
    const built = buildSnapshotRecords(L, data.sheets.get(source) || [], data.rows, data.links, data.rules, data.fetchedAt, SHEET_LIST_START);
    noDate += built.noDate;
    if (built.duplicates.length) {
      skipped += built.duplicates.length;
      errors.push(`${SOURCE_LABEL[source]} 같은 순번 ${built.duplicates.length}행(처음 행만 보관): ${sample(built.duplicates)}`);
    }
    const months = Array.from(new Set(built.records.map((r) => r.month))).sort();
    if (!months.length) continue;
    let stored: StoredSheetKey[];
    try {
      stored = await readStored(env, source, months);
    } catch (e) {
      errors.push(`${SOURCE_LABEL[source]} 보관 표 조회 실패 — 이 탭은 건너뜀: ${errMsg(e)}`);
      continue;
    }
    const plan = planSnapshot(built.records, stored);
    if (plan.conflicts.length) {
      skipped += plan.conflicts.length;
      errors.push(`${SOURCE_LABEL[source]} 순번은 같은데 내용(날짜·접수자·상호)이 달라 덮지 않음 ${plan.conflicts.length}행: ${sample(plan.conflicts.map((r) => `${r.month} 순번 ${r.seq}(${r.sheet_row}행)`))}`);
    }
    for (const s of plan.suspicious) {
      errors.push(`${SOURCE_LABEL[source]} ${s.month} 저장 ${s.stored}행 중 ${s.count}행이 시트에서 안 보임 — 너무 많아 gone_at 을 찍지 않음(확인 필요)`);
    }
    let wrote = true;
    for (let i = 0; i < plan.upsert.length; i += SNAPSHOT_BATCH) {
      const batch = plan.upsert.slice(i, i + SNAPSHOT_BATCH);
      try {
        await upsertBatch(env, batch);
        upserted += batch.length;
      } catch (e) {
        wrote = false;
        errors.push(`${SOURCE_LABEL[source]} ${errMsg(e)}`);
        break;
      }
    }
    if (!wrote) continue; // 쓰기가 반쯤 끝난 탭은 gone 을 찍지 않는다
    for (const g of plan.gone) {
      try {
        gone += await markGone(env, source, g.month, g.seqs, now);
      } catch (e) {
        errors.push(`${SOURCE_LABEL[source]} ${g.month} ${errMsg(e)}`);
      }
    }
  }
  return { ok: errors.length === 0, upserted, gone, skipped, noDate, errors, fetchedAt: data.fetchedAt };
}

const fail = (error: unknown) =>
  Response.json({ error: errMsg(error) }, { status: error instanceof HttpError ? error.status : 500, headers: jsonHeaders });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });
  // 본문이 비었거나 JSON 이 아니면 미처리 요청으로 본다(기존 호출 = {})
  const parsedBody = await req.json().catch(() => ({}));
  const body = (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {}) as Record<string, unknown>;

  // 상세 한 행
  const row = body.row;
  if (row && typeof row === "object") {
    const r = row as { source?: unknown; sheetRow?: unknown; seq?: unknown; allowDone?: unknown };
    try {
      const detail = await readRowDetail(r.source, r.sheetRow, r.seq, r.allowDone === true);
      return Response.json({ ok: true, detail }, { headers: jsonHeaders });
    } catch (error) {
      return fail(error);
    }
  }

  // 보관(크론 전용)
  if (body.snapshot === true) {
    if (!snapshotAuthorized(req)) {
      return Response.json({ error: "보관 모드는 인증된 호출만 받습니다" }, { status: 403, headers: jsonHeaders });
    }
    const nowMs = Date.now();
    if (lastSnapshotAt && nowMs - lastSnapshotAt < SNAPSHOT_MIN_GAP_MS) {
      return Response.json({ ok: true, throttled: true, nextAfter: new Date(lastSnapshotAt + SNAPSHOT_MIN_GAP_MS).toISOString() }, { headers: jsonHeaders });
    }
    lastSnapshotAt = nowMs;
    try {
      return Response.json(await snapshot(), { headers: jsonHeaders });
    } catch (error) {
      return fail(error);
    }
  }

  // 목록(접수리스트 시트 줄)
  const list = body.list;
  if (list && typeof list === "object") {
    const l = list as { from?: unknown; to?: unknown };
    const range = clampListRange(l.from, l.to);
    if (!range) return Response.json({ error: "list.from·list.to 는 YYYY-MM-DD 이고 from ≤ to 여야 합니다" }, { status: 400, headers: jsonHeaders });
    try {
      const { data, cached } = await getParsed();
      const picked = listRowsOf(data.rows, data.links, range.from, range.to, SHEET_LIST_START);
      return Response.json({
        ok: true, rows: picked.rows, noDate: picked.noDate, from: range.from, to: range.to, clipped: range.clipped,
        fetchedAt: data.fetchedAt, errors: [...data.errors, ...data.copierErrors], okSources: data.okSources, cached,
      }, { headers: jsonHeaders });
    } catch (error) {
      return fail(error);
    }
  }

  // 미처리(기존 응답 모양·숫자 그대로 — CS 시트 행·CS 잇기는 넣지 않는다)
  try {
    const { data, cached, healed } = await getParsed();
    return Response.json({
      ok: true,
      rows: openRowsOf(data.rows, data.baseLinks, kstDaysAgo(LIST_CONTENT_DAYS)),
      fetchedAt: data.fetchedAt,
      errors: data.errors,
      okSources: data.okSources.filter((s) => s !== "copier"),
      coveredIds: data.coveredIds,
      linkedIds: [...new Set(data.baseLinks.values())],
      healed,
      healEnabled: data.healEnabled,
      cached,
    }, { headers: jsonHeaders });
  } catch (error) {
    return fail(error);
  }
});
