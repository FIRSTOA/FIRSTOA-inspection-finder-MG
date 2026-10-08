/**
 * 첫 화면 분기(2026-10-02) — 앨범 링크 / 그룹웨어 로그인 / 본 앱.
 *  잠금(관리 탭 SSO_REQUIRED)이 켜져 있고 그룹웨어 세션이 없으면 곧장 경영지원팀 그룹웨어 로그인 화면으로 보낸다(2026-10-08 팀장 요청 —
 *  FIELD 자체 로그인 문(SsoGate)은 보관만 하고, 로그인에 실패해 돌아왔을 때만 그 문을 띄워 이유와 다시 시도 단추를 보여 준다. 그래야 실패가 무한 반복되지 않는다).
 *  첫 화면을 늦추지 않으려고 기기에 적어 둔 마지막 값으로 먼저 판단하고, 설정은 뒤에서 한 번 더 확인한다(오프라인이면 마지막 값 유지).
 */
import { useEffect, useRef, useState } from "react";
import App from "./App";
import AlbumView from "./AlbumView";
import SsoGate from "./SsoGate";
import { getConfig } from "./supabase";
import { consumeLoggedOut, getSsoSession, isOnValue, rememberSsoRequired, SSO_ERROR_KEY, ssoRequiredCached, startGroupwareLogin } from "./sso";

export default function Boot({ albumId }: { albumId: string | null }) {
  const [required, setRequired] = useState<boolean>(() => ssoRequiredCached());
  const [ssoError] = useState<string>(() => {
    try { const e = sessionStorage.getItem(SSO_ERROR_KEY) || ""; sessionStorage.removeItem(SSO_ERROR_KEY); return e; } catch { return ""; }
  });
  const [loggedOut] = useState<boolean>(() => consumeLoggedOut()); // 방금 로그아웃한 탭 — 자동 재로그인 대신 문을 보여 준다
  useEffect(() => {
    getConfig().then((cfg) => { const on = isOnValue(cfg.SSO_REQUIRED); rememberSsoRequired(on); setRequired(on); }).catch(() => { /* 오프라인이면 마지막 값 유지 */ });
  }, []);
  // 잠금인데 세션이 없으면(실패로 돌아온 경우 제외) 그룹웨어 로그인으로 바로 이동 — 한 번만
  const sent = useRef(false);
  const needLogin = !albumId && required && !getSsoSession();
  useEffect(() => {
    if (!needLogin || ssoError || loggedOut || sent.current) return;
    sent.current = true;
    startGroupwareLogin("/");
  }, [needLogin, ssoError, loggedOut]);
  if (albumId) return <AlbumView id={albumId} />;
  if (needLogin) {
    if (ssoError) return <SsoGate error={ssoError} />;
    if (loggedOut) return <SsoGate notice="로그아웃했습니다. 그룹웨어 쪽 로그인은 그대로라 아래 단추를 누르면 바로 들어갑니다. 다른 계정으로 바꾸려면 그룹웨어에서 먼저 로그아웃해 주세요." />;
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#070d1a] text-sm font-bold text-slate-300">그룹웨어 로그인으로 이동 중…</div>;
  }
  return <App />;
}
