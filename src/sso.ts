/**
 * 그룹웨어 통합 로그인(SSO) — 2026-10-02 사내 공지에 따른 연동(1단계: 로그인·작성자 맞춤·선택적 잠금).
 *  흐름: [그룹웨어로 로그인] → https://firstoa-groupware.vercel.app/sso/authorize?redirect_uri=…&state=…
 *        → 그룹웨어 로그인 화면 → <redirect_uri>?token=<JWT 5분>&state=<원래값> 로 복귀
 *        → 우리 앱이 /sso/userinfo?token= 으로 확인 → 이름·부서·직위·사번·권한을 받아 세션(12시간)으로 보관.
 *  비밀번호도 서명 키도 우리 쪽엔 없다(그룹웨어 안내문 그대로). 토큰은 5분짜리라 확인 직후 버린다.
 *  도메인은 그룹웨어 담당자가 허용목록에 올려야 토큰이 온다 — 우리 콜백: https://firstoa-inspection-finder-mg.vercel.app/auth/callback
 *  잠금(SSO_REQUIRED, 관리 탭 스위치)이 켜지면 세션 없는 기기엔 로그인 문(SsoGate)만 보인다. 앨범(?album=)·설명서 같은 공개 페이지는 예외.
 */
export const GROUPWARE_URL = "https://firstoa-groupware.vercel.app";
export const SSO_CALLBACK_PATH = "/auth/callback";
const SESSION_KEY = "cs_sso_session_v1";
const STATE_KEY = "cs_sso_state_v1";
const REQUIRED_KEY = "cs_sso_required_v1";
export const SSO_ERROR_KEY = "cs_sso_error_v1";
const SESSION_HOURS = 12;

export type SsoUser = { sub: string; username: string; name: string; empNo: string; department: string; position: string; email: string; role: "ADMIN" | "MANAGER" | "STAFF" | string; mustChangePassword?: boolean };
export type SsoSession = { user: SsoUser; at: string; exp: number };

export function getSsoSession(): SsoSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SsoSession;
    if (!s?.user?.name || !s.exp || Date.now() > s.exp) return null;
    return s;
  } catch { return null; }
}
export function clearSsoSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ } }

/** 잠금 스위치는 app_config에 있지만 첫 화면을 늦추지 않으려고 마지막으로 본 값을 기기에 적어 둔다 */
export function ssoRequiredCached(): boolean { try { return localStorage.getItem(REQUIRED_KEY) === "1"; } catch { return false; } }
export function rememberSsoRequired(on: boolean) { try { localStorage.setItem(REQUIRED_KEY, on ? "1" : "0"); } catch { /* 무시 */ } }
export const isOnValue = (v: string | undefined) => /^(true|1|on|y)$/i.test(v || "");

/** 검증 기간엔 주소 뒤에 ?sso=test 를 붙여 연 기기에서만 로그인 단추가 보인다(팀장 지시: 검증 전엔 아무에게도 안 보이게). ?sso=off 로 해제 */
const TEST_KEY = "cs_sso_test_v1";
export function ssoTestDevice(): boolean { try { return localStorage.getItem(TEST_KEY) === "1"; } catch { return false; } }
export function applySsoTestParam() {
  const p = new URLSearchParams(window.location.search); const v = p.get("sso");
  if (!v) return;
  try { if (v === "test") localStorage.setItem(TEST_KEY, "1"); else if (v === "off") localStorage.removeItem(TEST_KEY); } catch { /* 무시 */ }
  p.delete("sso"); const q = p.toString();
  window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : ""));
}
/** 로그인 단추를 보여도 되는가 — 잠금이 켜졌거나(모두) 검증 기기이거나 */
export const ssoLoginVisible = () => ssoRequiredCached() || ssoTestDevice();

const randomState = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(""); };

/** 그룹웨어 로그인 화면으로 이동 — 돌아올 곳은 이 앱의 /auth/callback(https 필수) */
export function startGroupwareLogin(returnTo = window.location.pathname + window.location.search) {
  const state = randomState();
  try { sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, returnTo })); } catch { /* 무시 */ }
  const redirect = `${window.location.origin}${SSO_CALLBACK_PATH}`;
  window.location.assign(`${GROUPWARE_URL}/sso/authorize?redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`);
}

export type CallbackCheck = { kind: "none" } | { kind: "error"; error: string; returnTo: string } | { kind: "ok"; token: string; returnTo: string };

/** 콜백 주소·쿼리·보관해 둔 state를 보고 토큰을 믿어도 되는지 판단(순수 함수 — 테스트용) */
export function checkCallback(pathname: string, search: string, savedRaw: string | null): CallbackCheck {
  const params = new URLSearchParams(search);
  const token = params.get("token"); const state = params.get("state");
  if (pathname !== SSO_CALLBACK_PATH && !(token && state)) return { kind: "none" };
  let saved: { state?: string; returnTo?: string } | null = null;
  try { saved = savedRaw ? JSON.parse(savedRaw) : null; } catch { saved = null; }
  const returnTo = saved?.returnTo && !saved.returnTo.startsWith(SSO_CALLBACK_PATH) && saved.returnTo.startsWith("/") && !saved.returnTo.startsWith("//") ? saved.returnTo : "/";
  if (!token || !state) return { kind: "error", error: "그룹웨어에서 토큰을 받지 못했습니다. 다시 시도해 주세요", returnTo };
  if (!saved?.state || saved.state !== state) return { kind: "error", error: "로그인 요청과 응답이 맞지 않습니다(state 불일치). 같은 브라우저에서 다시 시도해 주세요", returnTo };
  return { kind: "ok", token, returnTo };
}

/** 콜백으로 돌아온 경우 토큰을 확인해 세션을 만든다. 콜백이 아니면 null(렌더 전에 한 번 부른다). */
export async function handleSsoCallback(): Promise<{ ok: true; user: SsoUser; returnTo: string } | { ok: false; error: string; returnTo: string } | null> {
  let savedRaw: string | null = null;
  try { savedRaw = sessionStorage.getItem(STATE_KEY); } catch { /* 무시 */ }
  const check = checkCallback(window.location.pathname, window.location.search, savedRaw);
  if (check.kind === "none") return null;
  try { sessionStorage.removeItem(STATE_KEY); } catch { /* 무시 */ }
  if (check.kind === "error") return { ok: false, error: check.error, returnTo: check.returnTo };
  try {
    const res = await fetch(`${GROUPWARE_URL}/sso/userinfo?token=${encodeURIComponent(check.token)}`, { headers: { Authorization: `Bearer ${check.token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !data?.user?.name) return { ok: false, error: `그룹웨어 확인 실패(${res.status})${data?.error ? ` · ${data.error}` : ""}`, returnTo: check.returnTo };
    const user = data.user as SsoUser;
    const session: SsoSession = { user, at: new Date().toISOString(), exp: Date.now() + SESSION_HOURS * 3600_000 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    // 작성자 선택을 그룹웨어 이름으로 맞춘다 — 로그인한 사람이 기준
    try { localStorage.setItem("author", user.name); } catch { /* 무시 */ }
    return { ok: true, user, returnTo: check.returnTo };
  } catch (e) { return { ok: false, error: `그룹웨어 연결 실패: ${(e as Error).message}`, returnTo: check.returnTo }; }
}
