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
const SESSION_HOURS = 24 * 7; // 로그인 유지 7일(2026-10-14 사용자 결정 — 12시간마다 다시 로그인하던 것)

export type SsoUser = { sub: string; username: string; name: string; empNo: string; department: string; position: string; email: string; role: "ADMIN" | "MANAGER" | "STAFF" | string; mustChangePassword?: boolean };
export type SsoSession = { user: SsoUser; at: string; exp: number };

/** 보관한 세션 글자를 now 기준으로 판정(순수 함수 — 테스트용). 만료·깨짐이면 null */
export function parseSsoSession(raw: string | null, now: number): SsoSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SsoSession;
    if (!s?.user?.name || !s.exp) return null;
    // 유지 시간을 늘렸을 때 이미 로그인한 기기도 새 기준(로그인 시각 + 7일)을 따른다
    const exp = Math.max(s.exp, (Date.parse(s.at) || 0) + SESSION_HOURS * 3600_000);
    if (now > exp) return null;
    return { ...s, exp };
  } catch { return null; }
}
export function getSsoSession(): SsoSession | null {
  try { return parseSsoSession(localStorage.getItem(SESSION_KEY), Date.now()); } catch { return null; }
}
export function clearSsoSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ } }


/** 잠금 스위치는 app_config에 있지만 첫 화면을 늦추지 않으려고 마지막으로 본 값을 기기에 적어 둔다 */
export function ssoRequiredCached(): boolean { try { return localStorage.getItem(REQUIRED_KEY) === "1"; } catch { return false; } }
/** 이 기기가 스위치 값을 한 번이라도 받아 적었는가 — 새 기기·저장소 비움이면 "unknown"(설정 확인 전) */
export function ssoRequiredStateCached(): "on" | "off" | "unknown" {
  try { const v = localStorage.getItem(REQUIRED_KEY); return v === "1" ? "on" : v === "0" ? "off" : "unknown"; } catch { return "unknown"; }
}
/** 작성자 고정 여부 — 스위치가 켜져 있으면 세션 유무와 상관없이 고르기를 보이지 않는다.
 *  (세션이 만료된 채 열린 화면에서 고르기·인원 선택 창이 되살아나던 2026-10-21 버그. 세션이 없으면 Boot 가 그룹웨어 재로그인으로 보낸다) */
export const authorLocked = () => ssoRequiredCached();
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
export const ssoLoginVisible = () => ssoRequiredCached(); // 2026-10-08: 검증 끝 — 스위치가 켜졌을 때만(?sso=test 기기 예외 없음)

const randomState = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(""); };

/** 그룹웨어 로그인 화면으로 이동 — 돌아올 곳은 이 앱의 /auth/callback(https 필수) */
export function startGroupwareLogin(returnTo = window.location.pathname + window.location.search, opts: { viaLoginPage?: boolean } = {}) {
  const state = randomState();
  try { sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, returnTo })); } catch { /* 무시 */ }
  const redirect = `${window.location.origin}${SSO_CALLBACK_PATH}`;
  const authorize = `/sso/authorize?redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
  // 로그아웃 뒤에는 그룹웨어 로그인 화면(/worklog/login)으로 바로 보낸다 — 그룹웨어가 그 화면에서 로그인을 요구하면 계정을 바꿀 수 있다
  window.location.assign(opts.viaLoginPage ? `${GROUPWARE_URL}/worklog/login?next=${encodeURIComponent(authorize)}` : `${GROUPWARE_URL}${authorize}`);
}
/** 로그아웃 — FIELD 세션만 지우고 첫 화면으로. 그룹웨어 로그인이 살아 있으면 자동으로 다시 들어온다(사용자가 그 동작을 받아들임, 2026-10-08).
 *  그룹웨어 화면에 떨궈 두는 건 불편하다고 해서 그쪽으로 보내지 않는다. 그룹웨어 로그인이 끝난 상태면 그룹웨어 로그인 화면이 뜬다. */
export function logoutToGroupware() { clearSsoSession(); window.location.assign("/"); }

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
