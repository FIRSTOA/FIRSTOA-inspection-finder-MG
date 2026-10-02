/**
 * 첫 화면 분기(2026-10-02) — 앨범 링크 / 그룹웨어 로그인 문 / 본 앱.
 *  잠금(관리 탭 SSO_REQUIRED)이 켜져 있고 그룹웨어 세션이 없으면 로그인 문만 보인다.
 *  첫 화면을 늦추지 않으려고 기기에 적어 둔 마지막 값으로 먼저 판단하고, 설정은 뒤에서 한 번 더 확인한다(오프라인이면 마지막 값 유지).
 */
import { useEffect, useState } from "react";
import App from "./App";
import AlbumView from "./AlbumView";
import SsoGate from "./SsoGate";
import { getConfig } from "./supabase";
import { getSsoSession, isOnValue, rememberSsoRequired, SSO_ERROR_KEY, ssoRequiredCached } from "./sso";

export default function Boot({ albumId }: { albumId: string | null }) {
  const [required, setRequired] = useState<boolean>(() => ssoRequiredCached());
  const [ssoError] = useState<string>(() => {
    try { const e = sessionStorage.getItem(SSO_ERROR_KEY) || ""; sessionStorage.removeItem(SSO_ERROR_KEY); return e; } catch { return ""; }
  });
  useEffect(() => {
    getConfig().then((cfg) => { const on = isOnValue(cfg.SSO_REQUIRED); rememberSsoRequired(on); setRequired(on); }).catch(() => { /* 오프라인이면 마지막 값 유지 */ });
  }, []);
  if (albumId) return <AlbumView id={albumId} />;
  if (required && !getSsoSession()) return <SsoGate error={ssoError} />;
  return <App />;
}
