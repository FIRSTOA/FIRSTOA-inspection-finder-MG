/**
 * workinmap-sync 워킨맵 API 읽기(api.solgit.co) · 2026-10-31 — P1 은 읽기 두 경로만 둔다.
 *   GET /api/v2/users/info?nosync=true&type=workList4 → { works: [{ _id, name, places?, … }] }
 *   GET /api/v2/works/<id> → { _id, name, places: [...] }
 * 109/401(토큰 실패)이면 그 계정만 강제로 다시 로그인하고 1회 재시도. fetch 는 주입(테스트).
 * 쓰기 경로(P2: places/props, places/modify2)는 아직 없다. 삭제·추가·이동 경로는 앞으로도 두지 않는다(설계 v2-C3).
 */
import { getIdToken, isTokenError, type AuthCtx } from "./auth.ts";

export const API_BASE = "https://api.solgit.co";
const API_TIMEOUT_MS = 30_000;

export type ApiResult = { ok: true; json: unknown } | { ok: false; error: string; tokenFailed?: boolean };

/** 인증 붙여 GET. 토큰 오류면 force 로그인 후 1회 재시도 */
export async function apiGet(auth: AuthCtx, path: string): Promise<ApiResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tok = await getIdToken(auth, { force: attempt > 0 });
    if (!tok.ok) return { ok: false, error: `로그인 실패: ${tok.error}`, tokenFailed: true };
    let res: Response;
    try {
      res = await auth.fetchFn(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${tok.idToken}` }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    } catch (e) {
      return { ok: false, error: `워킨맵 연결 실패: ${e instanceof Error ? e.name : "error"}` };
    }
    const json = await res.json().catch(() => null);
    if (isTokenError(res.status, json)) {
      if (attempt === 0) continue;
      return { ok: false, error: "워킨맵 토큰 인증 실패(109) — 재로그인 뒤에도", tokenFailed: true };
    }
    if (!res.ok) return { ok: false, error: `워킨맵 HTTP ${res.status}` };
    if (json === null) return { ok: false, error: "워킨맵 응답이 JSON 이 아님" };
    return { ok: true, json };
  }
  return { ok: false, error: "도달 불가" };
}

export type WorkListItem = { id: string; name: string; placeCount: number | null; modified: string | null };

/** workList4 응답 → 워크 목록. 형식이 어긋나면 null */
export function parseWorkList(json: unknown): WorkListItem[] | null {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const works = Array.isArray(o.works) ? o.works : Array.isArray(json) ? json as unknown[] : null;
  if (!works) return null;
  const out: WorkListItem[] = [];
  for (const w of works) {
    if (!w || typeof w !== "object") continue;
    const r = w as Record<string, unknown>;
    if (typeof r._id !== "string" || !r._id) continue;
    const count = Array.isArray(r.places) ? r.places.length : Number.isFinite(Number(r.placeCount ?? r.place_count ?? r.count)) && (r.placeCount ?? r.place_count ?? r.count) !== undefined ? Number(r.placeCount ?? r.place_count ?? r.count) : null;
    const modRaw = r.last_update ?? r.update_date ?? r.updated_at ?? r.modified ?? null;
    let modified: string | null = null;
    if (modRaw !== null && modRaw !== undefined && modRaw !== "") {
      const n = typeof modRaw === "number" ? (modRaw < 1e12 ? modRaw * 1000 : modRaw) : Date.parse(String(modRaw));
      modified = Number.isFinite(n) ? new Date(n).toISOString() : null;
    }
    out.push({ id: r._id, name: String(r.name ?? "").normalize("NFC").trim(), placeCount: count, modified });
  }
  return out;
}

export async function fetchWorkList(auth: AuthCtx): Promise<{ ok: true; works: WorkListItem[] } | { ok: false; error: string; tokenFailed?: boolean }> {
  const r = await apiGet(auth, "/api/v2/users/info?nosync=true&type=workList4");
  if (!r.ok) return r;
  const works = parseWorkList(r.json);
  if (!works) return { ok: false, error: "워크 목록 형식 이상(works 배열 없음)" };
  return { ok: true, works };
}

export async function fetchWork(auth: AuthCtx, workId: string): Promise<ApiResult> {
  if (!/^[0-9a-f]{24}$/i.test(workId)) return { ok: false, error: "워크 id 형식 이상" };
  return apiGet(auth, `/api/v2/works/${workId}`);
}
