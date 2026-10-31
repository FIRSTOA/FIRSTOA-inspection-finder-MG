/**
 * workinmap-sync 실행부 — 액션 works · pull · status · login_test · push(P2 전: 건너뜀) · 2026-10-31
 * index.ts(Deno.serve)가 env·fetch 를 넣어 부른다. Deno 전역을 쓰지 않아 vitest 가 fetch 주입으로 끝까지 돌려 본다.
 *
 * DB(service role REST) 규칙 — supabase/workin-sync-20261031.sql 머리 "엣지 규칙":
 *   · 모든 PostgREST 요청에 헤더 `x-workin-sync: 1`(트리거 핑퐁 방지). 앱 행을 쓸 때 updated_by = '워킨맵 동기화'.
 *   · 칸을 덮기 전에 workin_sync_log(before/after) 먼저 insert — 로그 insert 가 실패하면 그 묶음 행은 쓰지 않는다.
 *   · 기존 행 쓰기 = rpc workin_sync_update_places(p_rows) 200행 묶음(보낸 키만 update, 없는 id 건너뜀 → skippedDeleted).
 *     새 장소만 POST workin_map_places 단순 insert(on_conflict 없음).
 *   · works upsert 는 on_conflict=account_no,work_id 이고 override_skip·override_by·first_pulled_at 은 보내지 않는다(사람 값 유지).
 *   · review 는 식 unique 인덱스라 on_conflict 를 쓰지 않는다 — 미처리 같은 행을 먼저 조회해 있으면 넣지 않고, 그래도 409 면 무시.
 *   · pull 은 rpc workin_sync_take_lease 로 겹침을 막고 끝나면 release(dry 는 쓰지 않으므로 임대 없이).
 * 비밀값: 이메일·비밀번호·토큰은 응답·로그·DB 오류 칸에 넣지 않는다(auth.ts scrub). status 는 토큰 칸을 select 하지 않는다.
 */
import { fetchWork, fetchWorkList, type WorkListItem } from "./api.ts";
import { FIREBASE_WEB_API_KEY_FALLBACK, getIdToken, readAccounts, type Account, type AuthCtx, type FetchFn, type TokenRow, type TokenStore } from "./auth.ts";
import {
  classifyWork, DEFAULT_EXCLUDE_WORKS, DEFERRED_PREFIX, chunkPatchRows, kstParts, nextScheduledRun, PULL_HOURS_KST, listConfig, normalizeRemoteWork, planPull, reviewKey, switchOn, SYNC_ACTOR,
  type LocalPlace, type PlannedLog, type PlannedReview, type PullPlan, type SyncRequest, type WorkParse, type WorkStatus,
} from "./plan.ts";

export type SyncDeps = {
  fetchFn: FetchFn;
  supabaseUrl: string;
  serviceKey: string;
  getEnv: (key: string) => string | undefined;
  now: () => number;
  /** 실행 id(임대 holder) */
  holder: string;
};
export type SyncResponse = { status: number; body: Record<string, unknown> };

export const CONFIG_KEYS = [
  "WORKINMAP_SYNC_ENABLED", "WORKINMAP_EXCLUDE_WORKS", "WORKINMAP_TEST_WORK", "WORKINMAP_ACCOUNT_LABELS", "WORKINMAP_API_KEY",
] as const;
const PLACE_COLS = "id,number,team,quarter,kind,label,visible,name,comment,phone,address,address_detail,latitude,longitude,memos,updated_at,updated_by,ext_id,ext_work_id,ext_account_no,ext_year,ext_last_update,ext_synced_at,ext_missing_at";
const ACCOUNT_STATUS_COLS = "account_no,label,expires_at,fail_count,paused,last_login_at,last_ok_at,last_error,updated_at"; // 토큰 칸 없음
const WORK_COLS = "account_no,work_id,name,team,year,quarter,kind,status,place_count,override_skip,first_pulled_at,last_pulled_at,last_work_modified,last_error";
const READ_TIMEOUT_MS = 45_000;
const WRITE_TIMEOUT_MS = 30_000;
const UPSERT_CHUNK = 200;
/** 한 회차 시간 예산 — 넘으면 남은 워크는 다음 회차(엣지 150초 제한 안에서 끝내려고) */
export const PULL_BUDGET_MS = 120_000;
const NEAR_LIMIT = 950;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n = 480) => String(s || "").slice(0, n);

// ── DB(REST) ────────────────────────────────────────────────────

export class Db {
  private rest: string;
  private headers: Record<string, string>;
  constructor(private deps: SyncDeps) {
    this.rest = `${deps.supabaseUrl.replace(/\/$/, "")}/rest/v1`;
    this.headers = { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}`, "Content-Type": "application/json", "x-workin-sync": "1" };
  }
  private async call(method: string, path: string, body?: unknown, prefer?: string): Promise<Response> {
    return await this.deps.fetchFn(`${this.rest}/${path}`, {
      method,
      headers: prefer ? { ...this.headers, Prefer: prefer } : this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
    });
  }
  private static async fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`${what} 실패(${res.status}) ${text.slice(0, 160)}`), { status: res.status });
  }
  async get<T>(path: string): Promise<T> {
    const res = await this.call("GET", path);
    if (!res.ok) await Db.fail(res, path.split("?")[0]);
    return await res.json() as T;
  }
  async getAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const page = await this.get<T[]>(`${path}&limit=1000&offset=${offset}`);
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }
  async insert(table: string, rows: unknown): Promise<void> {
    const res = await this.call("POST", table, rows, "return=minimal");
    if (!res.ok) await Db.fail(res, `${table} 넣기`);
  }
  async upsert(table: string, onConflict: string, rows: unknown): Promise<void> {
    const res = await this.call("POST", `${table}?on_conflict=${onConflict}`, rows, "resolution=merge-duplicates,return=minimal");
    if (!res.ok) await Db.fail(res, `${table} upsert`);
  }
  async patch(table: string, filter: string, set: unknown): Promise<void> {
    const res = await this.call("PATCH", `${table}?${filter}`, set, "return=minimal");
    if (!res.ok) await Db.fail(res, `${table} 고치기`);
  }
  async rpc<T>(fn: string, args: unknown): Promise<T> {
    const res = await this.call("POST", `rpc/${fn}`, args);
    if (!res.ok) await Db.fail(res, `rpc ${fn}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** workin_sync_accounts 토큰 캐시(service role). label 은 app_config 라벨 복사 */
export function dbTokenStore(db: Db, labels: Record<string, string>): TokenStore {
  return {
    async load(no) {
      const rows = await db.get<TokenRow[]>(`workin_sync_accounts?select=account_no,id_token,refresh_token,expires_at,fail_count,paused,last_ok_at,last_error&account_no=eq.${no}`);
      return rows[0] ?? null;
    },
    async save(no, patch) {
      await db.upsert("workin_sync_accounts", "account_no", [{ account_no: no, label: labels[String(no)] || `계정${no}`, ...patch, updated_at: new Date().toISOString() }]);
    },
  };
}

type Config = { enabled: boolean; exclude: string[]; testWork: string; labels: Record<string, string>; apiKey: string };

async function readConfig(db: Db): Promise<Config> {
  const keys = CONFIG_KEYS.map((k) => encodeURIComponent(k)).join(",");
  const rows = await db.get<Array<{ key: string; value: string | null }>>(`app_config?select=key,value&key=in.(${keys})`);
  const map = Object.fromEntries(rows.map((r) => [r.key, String(r.value ?? "")]));
  let labels: Record<string, string> = {};
  try {
    const j = JSON.parse(map.WORKINMAP_ACCOUNT_LABELS || "{}");
    if (j && typeof j === "object") labels = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v)]));
  } catch { /* 라벨은 표시용 — 없으면 계정n */ }
  return {
    enabled: switchOn(map.WORKINMAP_SYNC_ENABLED),
    exclude: listConfig(map.WORKINMAP_EXCLUDE_WORKS, DEFAULT_EXCLUDE_WORKS),
    testWork: (map.WORKINMAP_TEST_WORK || "").trim(),
    labels,
    apiKey: (map.WORKINMAP_API_KEY || "").trim() || FIREBASE_WEB_API_KEY_FALLBACK,
  };
}

// ── 워크 목록 ────────────────────────────────────────────────────

type ClassifiedWork = WorkListItem & { accountNo: number; status: WorkStatus; parse: WorkParse | null };
type StoredWork = {
  account_no: number; work_id: string; name: string; status: string; place_count: number; override_skip: boolean;
  first_pulled_at: string | null; last_pulled_at: string | null; last_work_modified: string | null; last_error?: string | null;
};

async function listAllWorks(accounts: Account[], authOf: (a: Account) => AuthCtx, cfg: Config, nowMs: number) {
  const works: ClassifiedWork[] = [];
  const accountErrors: Array<{ account: number; error: string }> = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const acc of accounts) {
    const list = await fetchWorkList(authOf(acc));
    if (!list.ok) { accountErrors.push({ account: acc.no, error: list.error }); continue; }
    for (const w of list.works) {
      const c = classifyWork({ id: w.id, name: w.name }, { exclude: cfg.exclude, testWork: cfg.testWork, now: new Date(nowMs) });
      let status: WorkStatus = c.status;
      if (seen.has(w.id)) { status = "duplicate"; warnings.push(`공유 워크 ${w.name}: 먼저 본 계정에만 붙임(계정${acc.no} 건너뜀)`); }
      seen.add(w.id);
      works.push({ ...w, accountNo: acc.no, status, parse: c.parse });
    }
  }
  return { works, accountErrors, warnings };
}

function workTableRow(w: ClassifiedWork, nowIso: string) {
  return {
    account_no: w.accountNo, work_id: w.id, name: w.name.slice(0, 300),
    team: w.parse?.team ?? null, year: w.parse?.year ?? null, quarter: w.parse?.quarter ?? null, kind: w.parse?.kind ?? null,
    status: w.status, place_count: Math.max(0, Number(w.placeCount) || 0), last_work_modified: w.modified, updated_at: nowIso,
  };
}

const workView = (w: ClassifiedWork, labels: Record<string, string>) => ({
  account: w.accountNo, accountLabel: labels[String(w.accountNo)] || `계정${w.accountNo}`, workId: w.id, name: w.name, status: w.status,
  team: w.parse?.team ?? null, year: w.parse?.year ?? null, quarter: w.parse?.quarter ?? null, kind: w.parse?.kind ?? null,
  placeCount: w.placeCount, nearLimit: (w.placeCount ?? 0) >= NEAR_LIMIT,
});

// ── 한 워크 가져오기 ──────────────────────────────────────────────

type WorkResult = {
  workId: string; name: string; account: number; result: "applied" | "dry" | "stopped" | "error";
  stats?: PullPlan["stats"]; colorCheck?: PullPlan["colorCheck"]; error?: string; stop?: PullPlan["stop"];
  writes?: { patched: number; patchFailed: number; skippedDeleted: number; inserted: number; insertFailed: number; reviews: number; logs: number };
  sample?: Array<Record<string, unknown>>;
};

async function loadLocal(db: Db, workId: string, parse: WorkParse, remoteIds: string[]): Promise<LocalPlace[]> {
  const scope = `and(ext_id.is.null,team.eq.${parse.team},quarter.eq.${parse.quarter},kind.eq.${parse.kind})`;
  const rows = await db.getAll<LocalPlace>(`workin_map_places?select=${PLACE_COLS}&or=(ext_work_id.eq.${encodeURIComponent(workId)},${scope})&order=id.asc`);
  const have = new Set(rows.map((r) => r.ext_id).filter(Boolean) as string[]);
  const extra = remoteIds.filter((id) => !have.has(id) && /^[0-9a-z]+$/i.test(id));
  // 다른 워크에 붙어 있던 장소(워킨맵에서 이동)도 ext_id 로 찾는다
  for (let i = 0; i < extra.length; i += 150) {
    const ids = extra.slice(i, i + 150).join(",");
    rows.push(...await db.get<LocalPlace[]>(`workin_map_places?select=${PLACE_COLS}&ext_id=in.(${ids})`));
  }
  return rows;
}

function logRow(placeId: number | null, extId: string | null, accountNo: number, workId: string, l: PlannedLog, note = "") {
  return { place_id: placeId, ext_id: extId, account_no: accountNo, work_id: workId, direction: "pull", field: l.field, before_value: l.before_value ?? null, after_value: l.after_value ?? null, actor: SYNC_ACTOR, note };
}

async function insertReviews(db: Db, reviews: PlannedReview[]): Promise<number> {
  let n = 0;
  for (const r of reviews) {
    try {
      await db.insert("workin_sync_review", [{ kind: r.kind, field: r.field, place_id: r.place_id, ext_id: r.ext_id, account_no: r.account_no, work_id: r.work_id, detail: r.detail }]);
      n += 1;
    } catch (e) {
      if ((e as { status?: number }).status !== 409) throw e; // 409 = 이미 열린 같은 건
    }
  }
  return n;
}

async function pullOneWork(db: Db, auth: AuthCtx, w: ClassifiedWork, stored: StoredWork | undefined, dry: boolean, nowMs: number): Promise<WorkResult> {
  const base = { workId: w.id, name: w.name, account: w.accountNo };
  const parse = w.parse as WorkParse;
  const nowIso = new Date(nowMs).toISOString();
  const markWork = async (set: Record<string, unknown>) => { if (!dry) await db.patch("workin_sync_works", `account_no=eq.${w.accountNo}&work_id=eq.${encodeURIComponent(w.id)}`, { ...set, updated_at: nowIso }); };

  const raw = await fetchWork(auth, w.id);
  if (!raw.ok) { await markWork({ last_error: clip(raw.error) }); return { ...base, result: "error", error: raw.error }; }
  const norm = normalizeRemoteWork(raw.json, w.id);
  if (!norm.ok) {
    if (!dry) {
      await markWork({ last_error: clip(`형식 이상: ${norm.error}`) });
      await insertReviews(db, [{ kind: "format", field: "", place_id: null, ext_id: null, work_id: w.id, account_no: w.accountNo, detail: { error: norm.error, name: w.name } }]);
    }
    return { ...base, result: "error", error: `형식 이상: ${norm.error}` };
  }
  const remote = norm.work.places;

  const local = await loadLocal(db, w.id, parse, remote.map((r) => r.extId));
  const maxRows = await db.get<Array<{ number: number }>>(`workin_map_places?select=number&team=eq.${parse.team}&quarter=eq.${parse.quarter}&kind=eq.${parse.kind}&order=number.desc&limit=1`);
  const openRows = await db.getAll<{ kind: string; field: string; work_id: string | null; ext_id: string | null; place_id: number | null }>(
    `workin_sync_review?select=kind,field,work_id,ext_id,place_id&work_id=eq.${encodeURIComponent(w.id)}&resolved_at=is.null&order=id.asc`,
  );
  const linked = local.filter((l) => l.ext_work_id === w.id).length;
  const plan = planPull({
    workId: w.id, accountNo: w.accountNo, parse, remote, local,
    firstPull: !stored?.first_pulled_at,
    previousCount: Math.max(Number(stored?.place_count || 0), linked) || null,
    nowIso, openReviewKeys: new Set(openRows.map(reviewKey)),
    idBase: nowMs, takenIds: new Set(local.map((l) => l.id)), scopeMaxNumber: Number(maxRows[0]?.number || 0),
  });

  const sample = plan.patches.slice(0, 15).map((p) => ({ id: p.id, by: p.by, fields: p.fields, logs: p.logs.filter((l) => l.field !== "_link").slice(0, 4) }));
  if (plan.stop) {
    if (!dry) {
      await markWork({ last_error: clip(`중단(${plan.stop.reason}): ${plan.stop.detail}`) });
      await insertReviews(db, [{ kind: "format", field: plan.stop.reason, place_id: null, ext_id: null, work_id: w.id, account_no: w.accountNo, detail: { reason: plan.stop.reason, detail: plan.stop.detail, remote: remote.length } }]);
    }
    return { ...base, result: "stopped", stop: plan.stop, stats: plan.stats, colorCheck: plan.colorCheck };
  }
  if (dry) return { ...base, result: "dry", stats: plan.stats, colorCheck: plan.colorCheck, sample, stop: null };

  // ── 쓰기: 200행 묶음 → 그 묶음 로그 먼저, 로그 실패한 묶음은 쓰지 않음 → rpc workin_sync_update_places ──
  // (한 회차 현재 분기 워크 ~12개·장소 ~4,000 을 150초 안에. 없는 id 는 rpc 가 건너뜀 → skippedDeleted)
  const writes = { patched: 0, patchFailed: 0, skippedDeleted: 0, inserted: 0, insertFailed: 0, reviews: 0, logs: 0 };
  const errors: string[] = [];
  for (const batch of chunkPatchRows(plan.patches, UPSERT_CHUNK)) {
    const logs = batch.patches.flatMap((p) => p.logs.map((l) => logRow(p.id, p.ext_id || null, w.accountNo, w.id, l)));
    try {
      if (logs.length) await db.insert("workin_sync_log", logs);
      writes.logs += logs.length;
    } catch (e) {
      writes.patchFailed += batch.rows.length;
      errors.push(`로그 실패로 ${batch.rows.length}행 건너뜀: ${errMsg(e)}`);
      continue;
    }
    try {
      const updated = Number(await db.rpc<number>("workin_sync_update_places", { p_rows: batch.rows }));
      const n = Number.isFinite(updated) ? Math.max(0, Math.min(updated, batch.rows.length)) : 0;
      writes.patched += n;
      writes.skippedDeleted += batch.rows.length - n; // 읽은 뒤 앱에서 지워진 행(로그는 남았지만 쓰지 않음)
    } catch (e) { writes.patchFailed += batch.rows.length; if (errors.length < 5) errors.push(`${batch.rows.length}행 묶음: ${errMsg(e)}`); }
  }
  if (plan.inserts.length) {
    try {
      await db.insert("workin_sync_log", plan.inserts.map((x) => logRow(x.row.id, x.row.ext_id, w.accountNo, w.id, x.log)));
      writes.logs += plan.inserts.length;
      try { await db.insert("workin_map_places", plan.inserts.map((x) => x.row)); writes.inserted += plan.inserts.length; }
      catch (e) { writes.insertFailed += plan.inserts.length; errors.push(`새 장소 넣기 실패: ${errMsg(e)}`); }
    } catch (e) {
      writes.insertFailed += plan.inserts.length;
      errors.push(`새 장소 로그 실패로 넣지 않음: ${errMsg(e)}`);
    }
  }
  try { writes.reviews = await insertReviews(db, plan.reviews); } catch (e) { errors.push(`확인 큐 넣기 실패: ${errMsg(e)}`); }

  await markWork({
    last_pulled_at: nowIso, ...(stored?.first_pulled_at ? {} : { first_pulled_at: nowIso }), place_count: remote.length,
    last_error: clip(errors.join(" / ")),
  });
  return { ...base, result: errors.length ? "error" : "applied", stats: plan.stats, colorCheck: plan.colorCheck, writes, error: errors.length ? errors.join(" / ") : undefined };
}

// ── 액션 ─────────────────────────────────────────────────────────

export async function runAction(req: SyncRequest, deps: SyncDeps): Promise<SyncResponse> {
  if (req.action === "push") return { status: 200, body: { ok: true, skipped: "push_disabled" } };

  const db = new Db(deps);
  let cfg: Config;
  try { cfg = await readConfig(db); } catch (e) { return { status: 500, body: { ok: false, error: `설정 읽기 실패: ${errMsg(e)}` } }; }
  const accounts = readAccounts(deps.getEnv);
  const store = dbTokenStore(db, cfg.labels);
  const authOf = (account: Account): AuthCtx => ({ fetchFn: deps.fetchFn, apiKey: cfg.apiKey, account, store, nowMs: deps.now });
  const nowMs = deps.now();
  const startedMs = nowMs;
  const nowIso = new Date(nowMs).toISOString();

  if (req.action === "status") {
    const [acc, works, open] = await Promise.all([
      db.get<Array<Record<string, unknown>>>(`workin_sync_accounts?select=${ACCOUNT_STATUS_COLS}&order=account_no.asc`),
      db.getAll<StoredWork & Record<string, unknown>>(`workin_sync_works?select=${WORK_COLS}&order=account_no.asc,name.asc`),
      db.getAll<{ kind: string }>("workin_sync_review?select=kind&resolved_at=is.null&order=id.asc"),
    ]);
    const openByKind: Record<string, number> = {};
    for (const r of open) openByKind[r.kind] = (openByKind[r.kind] || 0) + 1;
    const lastRunMs = Math.max(0, ...works.map((w) => Date.parse(w.last_pulled_at || "") || 0));
    return {
      status: 200,
      body: {
        ok: true, enabled: cfg.enabled, accountsConfigured: accounts.map((a) => a.no),
        lastRunAt: lastRunMs ? new Date(lastRunMs).toISOString() : null,
        nextRunAt: cfg.enabled ? nextScheduledRun(nowMs) : null,
        scheduleKst: PULL_HOURS_KST.map((h) => `${String(h).padStart(2, "0")}:00`),
        incompleteWorks: works.filter((w) => String(w.last_error || "").startsWith(DEFERRED_PREFIX))
          .map((w) => ({ account: w.account_no, workId: w.work_id, name: w.name, lastPulledAt: w.last_pulled_at })),
        accounts: acc, works, openReviews: openByKind,
      },
    };
  }

  if (req.action === "login_test") {
    const account = accounts.find((a) => a.no === req.account);
    if (!account) return { status: 400, body: { ok: false, error: `계정${req.account} secrets(WORKINMAP_${req.account}_EMAIL/PASSWORD) 없음` } };
    // [다시 시도] — 멈춤을 풀고 한 번만 로그인해 본다
    await store.save(account.no, { paused: false, fail_count: 0 });
    const t = await getIdToken(authOf(account), { force: true });
    return { status: 200, body: t.ok ? { ok: true, account: account.no, via: t.via } : { ok: false, account: account.no, error: t.error, paused: t.paused } };
  }

  if (!accounts.length) return { status: 500, body: { ok: false, error: "워킨맵 계정 secrets 없음(WORKINMAP_1_EMAIL/PASSWORD)" } };

  if (req.action === "works") {
    const { works, accountErrors, warnings } = await listAllWorks(accounts, authOf, cfg, nowMs);
    let saveError = "";
    if (works.length) {
      try { await db.upsert("workin_sync_works", "account_no,work_id", works.map((w) => workTableRow(w, nowIso))); }
      catch (e) { saveError = errMsg(e); }
    }
    const ok = !accountErrors.length && !saveError;
    return { status: ok ? 200 : 500, body: { ok, works: works.map((w) => workView(w, cfg.labels)), accountErrors, warnings, saveError: saveError || undefined } };
  }

  // pull
  const dry = req.dryRun || !cfg.enabled;
  const leaseKey = req.scope === "old" ? "pull-old" : "pull";
  if (!dry) {
    const got = await db.rpc<boolean>("workin_sync_take_lease", { p_key: leaseKey, p_holder: deps.holder, p_ttl_seconds: req.scope === "old" ? 330 : 170 });
    if (got !== true) return { status: 200, body: { ok: true, skipped: "busy" } };
  }
  try {
    const stored = await db.getAll<StoredWork>(`workin_sync_works?select=${WORK_COLS}&order=account_no.asc`);
    const storedBy = new Map(stored.map((s) => [`${s.account_no}|${s.work_id}`, s]));
    const { works, accountErrors, warnings } = await listAllWorks(accounts, authOf, cfg, nowMs);
    if (!dry && works.length) await db.upsert("workin_sync_works", "account_no,work_id", works.map((w) => workTableRow(w, nowIso)));

    const cur = kstParts(new Date(nowMs));
    const picked = works.filter((w) => {
      if (w.status !== "target" || !w.parse) return false;
      const s = storedBy.get(`${w.accountNo}|${w.id}`);
      if (s?.override_skip) return false;
      if (typeof req.scope === "object") return w.id === req.scope.workId;
      const isCurrent = w.parse.year === cur.year && w.parse.quarter === cur.quarter;
      if (req.scope === "current") return isCurrent;
      if (isCurrent) return false;
      // 지난 분기: 처음이거나 워크 목록 수정일이 바뀌었을 때만(모르면 받는다)
      if (!s?.last_pulled_at || !w.modified || !s.last_work_modified) return true;
      return Date.parse(w.modified) > Date.parse(s.last_work_modified);
    });

    // 오래 안 받은 워크부터(지난 회차에 시간 초과로 밀린 워크가 먼저 돈다). 워크별 순차
    const lastPulled = (w: ClassifiedWork) => Date.parse(storedBy.get(`${w.accountNo}|${w.id}`)?.last_pulled_at || "") || 0;
    picked.sort((a, b) => lastPulled(a) - lastPulled(b));

    const results: WorkResult[] = [];
    const deferred: Array<{ account: number; workId: string; name: string }> = [];
    for (const w of picked) {
      if (deps.now() - startedMs > PULL_BUDGET_MS) { deferred.push({ account: w.accountNo, workId: w.id, name: w.name }); continue; }
      const account = accounts.find((a) => a.no === w.accountNo) as Account;
      try { results.push(await pullOneWork(db, authOf(account), w, storedBy.get(`${w.accountNo}|${w.id}`), dry, nowMs)); }
      catch (e) { results.push({ workId: w.id, name: w.name, account: w.accountNo, result: "error", error: errMsg(e) }); }
    }
    // 시간 초과로 못 한 워크 — status 의 "미완료 워크"(last_error 머리 DEFERRED_PREFIX). 다음 회차에 성공하면 '' 로 지워진다
    if (!dry) {
      for (const d of deferred) {
        await db.patch("workin_sync_works", `account_no=eq.${d.account}&work_id=eq.${encodeURIComponent(d.workId)}`, {
          last_error: `${DEFERRED_PREFIX} 시간 초과(${PULL_BUDGET_MS / 1000}초)로 다음 회차`, updated_at: nowIso,
        }).catch((e) => warnings.push(`미완료 표시 실패(${d.name}): ${errMsg(e)}`));
      }
    }
    const failed = accountErrors.length > 0 || results.some((r) => r.result === "error" || r.result === "stopped");
    return {
      status: failed && !dry && !req.manual ? 500 : 200,   // 관리 탭 수동 호출은 실패여도 200(ok:false) — 결과 표를 보여 주기 위해
      body: {
        ok: !failed, dryRun: dry, ...(cfg.enabled ? {} : { disabled: true, note: "WORKINMAP_SYNC_ENABLED 꺼짐 — dry 로만 계산(쓰기 0)" }),
        scope: req.scope, kst: `${cur.year}년 ${cur.quarter}분기`, picked: picked.length,
        results, deferred, accountErrors, warnings,
        skippedDeleted: results.reduce((n, r) => n + (r.writes?.skippedDeleted ?? 0), 0),
        unparsed: works.filter((w) => w.status === "unparsed").map((w) => ({ account: w.accountNo, workId: w.id, name: w.name })),
      },
    };
  } finally {
    if (!dry) await db.rpc("workin_sync_release_lease", { p_key: leaseKey, p_holder: deps.holder }).catch((e) => console.error("lease release 실패", errMsg(e)));
  }
}
