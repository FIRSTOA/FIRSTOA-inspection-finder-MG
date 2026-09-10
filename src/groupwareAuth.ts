// 퍼스트전산 그룹웨어 로그인(SSO) — 리다이렉트 위임 방식 (카카오/구글 로그인과 동일 구조).
//
// 우리는 비밀번호도, 서명 키도 갖지 않는다. 그룹웨어로 사용자를 보내고, 돌아온 5분짜리
// 토큰을 userinfo로 확인만 한다. 검증은 서버(userinfo)가 대행하므로 프런트만으로도 된다.
//
// 흐름: authorize로 이동 → <콜백>?token&state 복귀 → state 대조 → userinfo 확인 → 세션 저장.
// 명세 원본: firstoa-groupware · app/sso/authorize · app/sso/userinfo · lib/worklog/sso.ts

const GROUPWARE_BASE = "https://firstoa-groupware.vercel.app";
const STATE_KEY = "gw_sso_state";        // CSRF 대조용 — sessionStorage(탭 한정, 콜백 후 폐기)
const SESSION_KEY = "gw_sso_session_v1"; // 확인된 사용자 세션(우리 쪽)

export type GroupwareRole = "ADMIN" | "MANAGER" | "STAFF";

export type GroupwareUser = {
  sub: string;
  username: string;
  name: string;
  empNo: string;
  department: string;
  position: string;
  email: string;
  role: GroupwareRole;
  mustChangePassword: boolean;
};

export type GroupwareSession = GroupwareUser & { loginAt: string };

/** 로그인 콜백 주소 — 배포 도메인이 매번 달라도(프리뷰) 현재 origin을 그대로 쓴다.
 *  이 도메인이 그룹웨어 허용목록에 등록돼 있어야 authorize가 400을 내지 않는다. */
export function callbackUrl(): string {
  return `${window.location.origin}/`;
}

function randomState(): string {
  // 브라우저 crypto 우선, 없으면 시각+난수 폴백(테스트/구형 환경)
  try {
    const buf = new Uint8Array(16);
    (globalThis.crypto || (window as unknown as { crypto: Crypto }).crypto).getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** "그룹웨어로 로그인" — state를 저장하고 authorize로 이동시킬 URL을 만든다. */
export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({ redirect_uri: redirectUri, state });
  return `${GROUPWARE_BASE}/sso/authorize?${params.toString()}`;
}

/** 로그인 시작 — state를 세션에 심고 그룹웨어로 보낸다. */
export function startLogin(): void {
  const state = randomState();
  try { sessionStorage.setItem(STATE_KEY, state); } catch { /* 프라이빗 모드 — 아래 대조에서 걸러짐 */ }
  window.location.assign(buildAuthorizeUrl(callbackUrl(), state));
}

export type CallbackParse =
  | { kind: "none" }                              // 로그인 콜백이 아님(평소 진입)
  | { kind: "ok"; token: string }                 // token 있고 state 일치
  | { kind: "state-mismatch" }                    // state 불일치/누락 → CSRF 의심, 거부
  | { kind: "no-token" };                         // 콜백스럽지만 token 없음

/** URL 쿼리에서 콜백을 판별하고 state를 대조한다(순수 함수 — 테스트 대상).
 *  savedState는 startLogin에서 심은 값. */
export function parseCallback(search: string, savedState: string | null): CallbackParse {
  const params = new URLSearchParams(search);
  const token = params.get("token");
  const state = params.get("state");
  if (!token && !state) return { kind: "none" };
  if (!state || !savedState || state !== savedState) return { kind: "state-mismatch" };
  if (!token) return { kind: "no-token" };
  return { kind: "ok", token };
}

/** 받은 토큰을 userinfo로 확인한다. 200 {ok:true,user} → user, 그 외 → null. */
export async function verifyToken(token: string): Promise<GroupwareUser | null> {
  try {
    const res = await fetch(`${GROUPWARE_BASE}/sso/userinfo?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as { ok?: boolean; user?: GroupwareUser } | null;
    if (!data || data.ok !== true || !data.user) return null;
    return data.user;
  } catch {
    return null; // 네트워크 실패 — 로그인 안 된 것으로 취급(기존 화면은 그대로 뜬다)
  }
}

// ── 우리 쪽 세션(브라우저 로컬) ─────────────────────────────────────────────
// 그룹웨어 토큰은 5분이라 저장하지 않는다. 확인된 user 정보만 우리 세션으로 들고 있는다.

export function saveSession(user: GroupwareUser): GroupwareSession {
  const session: GroupwareSession = { ...user, loginAt: new Date().toISOString() };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* 저장 실패해도 이번 세션은 메모리로 동작 */ }
  return session;
}

export function loadSession(): GroupwareSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GroupwareSession;
    return parsed && parsed.sub && parsed.name ? parsed : null;
  } catch { return null; }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ }
}

export function consumeSavedState(): string | null {
  try {
    const state = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    return state;
  } catch { return null; }
}

/** 콜백 진입 전체 처리: URL 파싱 → 검증 → 세션 저장. 결과와 정리된 여부를 돌려준다.
 *  main.tsx에서 앱 마운트 전에 부른다. */
export async function handleCallback(search: string): Promise<
  | { status: "none" }
  | { status: "logged-in"; session: GroupwareSession }
  | { status: "state-mismatch" }
  | { status: "invalid-token" }
> {
  const parsed = parseCallback(search, consumeSavedState());
  if (parsed.kind === "none") return { status: "none" };
  if (parsed.kind === "state-mismatch") return { status: "state-mismatch" };
  if (parsed.kind === "no-token") return { status: "invalid-token" };
  const user = await verifyToken(parsed.token);
  if (!user) return { status: "invalid-token" };
  return { status: "logged-in", session: saveSession(user) };
}
