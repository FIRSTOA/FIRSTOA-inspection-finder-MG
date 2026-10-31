/**
 * workinmap-sync 로그인·토큰 — Firebase 이메일/비밀번호 REST(설계 v2-A1·A2) · 2026-10-31
 * Deno 엣지와 vitest 가 같이 쓴다: Deno.env·네트워크는 인자로 받는다(fetch 주입).
 *
 * 계정: secrets WORKINMAP_n_EMAIL / WORKINMAP_n_PASSWORD (n = 1..9, 비어 있는 번호에서 멈춤). 사용자가 대시보드에 직접 넣는다.
 * 토큰 캐시: workin_sync_accounts(계정 번호별 id_token·refresh_token·expires_at·fail_count·paused) — RLS + revoke, service role 만.
 * 흐름: 캐시 토큰(만료 5분 전까지) → refresh token 갱신 → 비밀번호 로그인. 비밀번호 로그인이 연속 3회 실패하면 paused(자동 재시도 멈춤).
 * 비밀값(이메일·비밀번호·토큰)은 로그·응답·오류 문구에 절대 넣지 않는다 — 오류 문구는 Firebase 오류 코드(INVALID_PASSWORD 등)만.
 */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type Account = { no: number; email: string; password: string };

/** 공개 웹 클라이언트 키(workinmap.com common.js 실측, 비밀 아님). app_config WORKINMAP_API_KEY 가 비어 있지 않으면 그 값 */
export const FIREBASE_WEB_API_KEY_FALLBACK = "AIzaSyBeWVClLYv94njfFjE3IVqSakRDDQTBp4A";
export const MAX_LOGIN_FAILS = 3;
const REFRESH_MARGIN_MS = 5 * 60_000;
const AUTH_TIMEOUT_MS = 20_000;

/** env 에서 계정 n개. 번호가 비면 거기서 멈춘다(1이 없으면 0개) */
export function readAccounts(getEnv: (key: string) => string | undefined): Account[] {
  const out: Account[] = [];
  for (let n = 1; n <= 9; n += 1) {
    const email = (getEnv(`WORKINMAP_${n}_EMAIL`) || "").trim();
    const password = getEnv(`WORKINMAP_${n}_PASSWORD`) || "";
    if (!email || !password) break;
    out.push({ no: n, email, password });
  }
  return out;
}

/** workin_sync_accounts 한 행(토큰 칸 포함 — 이 파일 밖으로 내보내지 않는다) */
export type TokenRow = {
  account_no: number;
  id_token?: string | null;
  refresh_token?: string | null;
  expires_at?: string | null;
  fail_count?: number | null;
  paused?: boolean | null;
  last_login_at?: string | null;
  last_ok_at?: string | null;
  /** not null default '' — null 을 넣지 않는다 */
  last_error?: string;
};

export interface TokenStore {
  load(accountNo: number): Promise<TokenRow | null>;
  save(accountNo: number, patch: Partial<TokenRow>): Promise<void>;
}

export type TokenResult =
  | { ok: true; idToken: string; via: "cache" | "refresh" | "password" }
  | { ok: false; error: string; paused: boolean };

/** 문구에서 비밀값 지우기(혹시 Firebase 가 이메일을 되돌려 줄 때 대비) */
export function scrub(text: string, secrets: string[]): string {
  let s = String(text || "");
  for (const v of secrets) if (v && v.length >= 3) s = s.split(v).join("***");
  return s.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "***").replace(/AMf-[\w-]{20,}/g, "***").slice(0, 200);
}

async function postJson(fetchFn: FetchFn, url: string, body: string, contentType: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetchFn(url, { method: "POST", headers: { "Content-Type": contentType }, body, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, json };
}

/** Firebase 오류 본문 → 코드만(INVALID_PASSWORD, TOO_MANY_ATTEMPTS_TRY_LATER …) */
function firebaseError(status: number, json: Record<string, unknown>): string {
  const err = json.error as { message?: unknown } | undefined;
  const code = String(err?.message ?? "").split(/[\s:]/)[0];
  return `HTTP ${status}${code ? ` ${code}` : ""}`;
}

export async function signInWithPassword(fetchFn: FetchFn, apiKey: string, email: string, password: string): Promise<{ idToken: string; refreshToken: string; expiresInSec: number }> {
  const { status, json } = await postJson(
    fetchFn,
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    JSON.stringify({ email, password, returnSecureToken: true }),
    "application/json",
  );
  if (status !== 200 || typeof json.idToken !== "string" || typeof json.refreshToken !== "string") throw new Error(`비밀번호 로그인 실패(${firebaseError(status, json)})`);
  return { idToken: json.idToken, refreshToken: json.refreshToken, expiresInSec: Number(json.expiresIn) || 3600 };
}

export async function refreshIdToken(fetchFn: FetchFn, apiKey: string, refreshToken: string): Promise<{ idToken: string; refreshToken: string; expiresInSec: number }> {
  const { status, json } = await postJson(
    fetchFn,
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
    `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    "application/x-www-form-urlencoded",
  );
  if (status !== 200 || typeof json.id_token !== "string") throw new Error(`토큰 갱신 실패(${firebaseError(status, json)})`);
  return { idToken: json.id_token, refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : refreshToken, expiresInSec: Number(json.expires_in) || 3600 };
}

export type AuthCtx = { fetchFn: FetchFn; apiKey: string; account: Account; store: TokenStore; nowMs: () => number };

/**
 * 계정 하나의 ID 토큰. force = 캐시를 믿지 않음(API 가 109/401 을 줬을 때).
 * refresh 실패는 실패 횟수에 넣지 않는다(그다음 비밀번호 로그인이 판단). 비밀번호 실패만 fail_count +1, 3회면 paused.
 */
export async function getIdToken(ctx: AuthCtx, opts: { force?: boolean } = {}): Promise<TokenResult> {
  const { fetchFn, apiKey, account, store } = ctx;
  const secrets = [account.email, account.password];
  const row = await store.load(account.no);
  if (row?.paused) return { ok: false, error: row.last_error ? `멈춤: ${row.last_error}` : "멈춤(로그인 연속 실패)", paused: true };

  const now = ctx.nowMs();
  const exp = row?.expires_at ? Date.parse(row.expires_at) : NaN;
  if (!opts.force && row?.id_token && Number.isFinite(exp) && exp - now > REFRESH_MARGIN_MS) return { ok: true, idToken: row.id_token, via: "cache" };

  const saveOk = async (t: { idToken: string; refreshToken: string; expiresInSec: number }, viaPassword: boolean) => {
    const at = new Date(ctx.nowMs()).toISOString();
    await store.save(account.no, {
      id_token: t.idToken, refresh_token: t.refreshToken, expires_at: new Date(ctx.nowMs() + t.expiresInSec * 1000).toISOString(),
      fail_count: 0, paused: false, last_ok_at: at, last_error: "", ...(viaPassword ? { last_login_at: at } : {}),
    });
  };

  if (row?.refresh_token) {
    try {
      const t = await refreshIdToken(fetchFn, apiKey, row.refresh_token);
      await saveOk(t, false);
      return { ok: true, idToken: t.idToken, via: "refresh" };
    } catch {
      // refresh 만료·취소 → 비밀번호 로그인으로
    }
  }

  try {
    const t = await signInWithPassword(fetchFn, apiKey, account.email, account.password);
    await saveOk(t, true);
    return { ok: true, idToken: t.idToken, via: "password" };
  } catch (e) {
    const msg = scrub(e instanceof Error ? e.message : String(e), secrets);
    const fails = Number(row?.fail_count || 0) + 1;
    const paused = fails >= MAX_LOGIN_FAILS;
    await store.save(account.no, { id_token: null, fail_count: fails, paused, last_error: msg });
    return { ok: false, error: paused ? `${msg} — 연속 ${fails}회 실패로 멈춤` : msg, paused };
  }
}

/** 워킨맵 API 응답이 토큰 오류인가(error_code 109 또는 HTTP 401 — 실측: HTTP 200 + {error_code:109, status:401} 로도 온다) */
export function isTokenError(status: number, json: unknown): boolean {
  if (status === 401) return true;
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return Number(o.error_code) === 109 || Number(o.status) === 401;
}
