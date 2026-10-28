/**
 * 통합검색 "무엇이든 묻기" — 읽기 전용 REST 창구 (2026-10-29, 설계 docs/tasks/search-ask-everything-2026-10-29.md 4장 1)
 *
 * - anon 키 GET 만(쓰기 없음). 페이지 넘김(getAll: 1,000행씩 최대 20,000행), 건수(count: HEAD count=exact).
 * - 읽기 RPC 는 이름 화이트리스트(READ_RPCS)만 — 전부 language sql stable(쓰기 없음). POST 지만 읽기 함수다.
 * - 엣지 경유(edge)는 kakao-search 하나만 — 그 함수의 스위치·검색어 필수·200줄 제한이 그대로 걸린다.
 * - 표 이름이 REST_BLOCKED 면 부르지 않는다(토큰·푸시 키·카톡 원문 직접 조회 등). 요약 도구(ops_status)가 읽는 운영 표는 여기서 막지 않는다.
 * 도구(구현 B)는 ctx.rest 로만 Supabase 를 읽는다. 브라우저·Deno·Node 공용 — fetch 만 쓴다(tests 에서 가짜 fetch 주입).
 */
import type { Cat } from "./catalog.ts";

export type AskRest = {
  /** GET /rest/v1/<path> — path 는 '표?쿼리' */
  get<T = Record<string, unknown>>(path: string): Promise<T[]>;
  /** 페이지 넘김 — query 에 limit/offset 을 넣지 않는다. order 가 없으면 orderBy(기본 id) 오름차순 */
  getAll<T = Record<string, unknown>>(table: string, query: string, opts?: { pageSize?: number; max?: number; orderBy?: string }): Promise<{ rows: T[]; truncated: boolean }>;
  /** 조건에 맞는 행 수(HEAD count=exact) */
  count(table: string, query?: string): Promise<number>;
  /** 읽기 RPC(화이트리스트) */
  rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
  /** 다른 엣지 함수(화이트리스트) — anon 키로 부른다(앱과 같은 경로) */
  edge<T = unknown>(fn: string, body: Record<string, unknown>): Promise<T>;
};

/** 읽기 RPC 화이트리스트 — 추가할 때는 SQL 이 stable/immutable·쓰기 없음인지 확인(표다빈) */
export const READ_RPCS = new Set(["suggest_workin_candidates"]);
/** 부를 수 있는 엣지 함수 */
export const READ_EDGES = new Set(["kakao-search"]);
/** REST 로도 부르지 않는 표 — 토큰·키·보안 기록·발송 원문·카톡 원문 직접·백업 사본 */
export const REST_BLOCKED = new Set(["naver_oauth", "push_subscriptions", "app_config_lock", "app_config_log", "kakao_messages", "counter_sms_inbox", "counter_sms_batches", "kakao_import_log", "mirror_hidden", "worker_jobs"]);
export const isRestBlocked = (table: string) => REST_BLOCKED.has(table) || /^_backup|_bak_/i.test(table) || table.includes(".");

/** PostgREST 칸 이름 — 한글·괄호·슬래시·공백이 있으면 큰따옴표 */
export const colSql = (c: string) => (/[^A-Za-z0-9_]/.test(c) ? `"${c}"` : c);

export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "cs"] as const;
const OPS = new Set<string>(FILTER_OPS);
export type AskFilter = { col: string; op: string; value: string };

/** 모델이 준 조건 → 쿼리 조각. 표 칸 밖·모르는 연산은 error. 최대 8개 */
export function buildFilterParts(table: string, cat: Cat, filters: unknown): { parts: string[] } | { error: string } {
  const list = Array.isArray(filters) ? (filters as Array<Record<string, unknown>>).slice(0, 8) : [];
  const parts: string[] = [];
  for (const f of list) {
    const c = String(f?.col || ""); const op = String(f?.op || "eq"); const v = String(f?.value ?? "");
    if (!cat.cols.includes(c) || !OPS.has(op)) return { error: `허용되지 않은 조건: ${c} ${op} (표 ${table} 의 칸: ${cat.cols.join(", ")})` };
    const val = op === "in" ? `(${v.split(",").map((x) => `"${encodeURIComponent(x.trim().replace(/"/g, ""))}"`).join(",")})`
      : op === "like" || op === "ilike" ? encodeURIComponent(v.includes("*") || v.includes("%") ? v : `*${v}*`)
      : op === "is" ? (/^(null|true|false)$/i.test(v.trim()) ? v.trim().toLowerCase() : "null")
      : encodeURIComponent(v);
    parts.push(`${encodeURIComponent(colSql(c))}=${op}.${val}`);
  }
  return { parts };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** anon 읽기 창구 만들기. timeoutMs 는 요청 하나의 상한 */
export function makeRest(baseUrl: string, anonKey: string, opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): AskRest {
  const f: FetchLike = opts.fetchImpl || ((i, init) => fetch(i, init));
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  const signal = () => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined);
  const tableOf = (path: string) => decodeURIComponent(path.split("?")[0] || "").trim();
  const guard = (table: string) => { if (!table || isRestBlocked(table)) throw new Error(`읽을 수 없는 표: ${table}`); };

  async function get<T>(path: string): Promise<T[]> {
    guard(tableOf(path));
    const res = await f(`${baseUrl}/rest/v1/${path}`, { headers, signal: signal() });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    return await res.json() as T[];
  }
  return {
    get,
    async getAll<T>(table: string, query: string, o: { pageSize?: number; max?: number; orderBy?: string } = {}) {
      const pageSize = Math.max(1, Math.min(1000, o.pageSize ?? 1000));
      const max = Math.max(pageSize, Math.min(20_000, o.max ?? 20_000));
      const q = query.replace(/(^|&)(limit|offset)=[^&]*/g, "").replace(/^&/, "");
      const ordered = /(^|&)order=/.test(q) ? q : `${q ? `${q}&` : ""}order=${encodeURIComponent(colSql(o.orderBy || "id"))}.asc`;
      const rows: T[] = [];
      for (let offset = 0; offset < max; offset += pageSize) {
        const page = await get<T>(`${table}?${ordered}&limit=${pageSize}&offset=${offset}`);
        rows.push(...page);
        if (page.length < pageSize) return { rows, truncated: false };
      }
      return { rows, truncated: true };
    },
    async count(table: string, query = "") {
      guard(table);
      const res = await f(`${baseUrl}/rest/v1/${table}?select=*${query ? `&${query}` : ""}&limit=1`, { method: "HEAD", headers: { ...headers, Prefer: "count=exact" }, signal: signal() });
      if (!res.ok) throw new Error(`${res.status} count ${table}`);
      const range = res.headers.get("content-range") || "";
      const n = Number(range.split("/")[1]);
      return Number.isFinite(n) ? n : 0;
    },
    async rpc<T>(name: string, args: Record<string, unknown>) {
      if (!READ_RPCS.has(name)) throw new Error(`허용되지 않은 RPC: ${name}`);
      const res = await f(`${baseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(args || {}), signal: signal() });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      return await res.json() as T;
    },
    async edge<T>(fn: string, body: Record<string, unknown>) {
      if (!READ_EDGES.has(fn)) throw new Error(`허용되지 않은 함수: ${fn}`);
      const res = await f(`${baseUrl}/functions/v1/${fn}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body || {}), signal: signal() });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      return await res.json() as T;
    },
  };
}
