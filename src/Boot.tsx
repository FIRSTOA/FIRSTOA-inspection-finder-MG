/**
 * 첫 화면 분기(2026-10-02) — 앨범 링크 / 그룹웨어 로그인 / 본 앱.
 *  잠금(관리 탭 SSO_REQUIRED)이 켜져 있고 그룹웨어 세션이 없으면 곧장 경영지원팀 그룹웨어 로그인 화면으로 보낸다(2026-10-08 팀장 요청 —
 *  FIELD 자체 로그인 문(SsoGate)은 보관만 하고, 로그인에 실패해 돌아왔을 때만 그 문을 띄워 이유와 다시 시도 단추를 보여 준다. 그래야 실패가 무한 반복되지 않는다).
 *  첫 화면을 늦추지 않으려고 기기에 적어 둔 마지막 값으로 먼저 판단하고, 설정은 뒤에서 한 번 더 확인한다(오프라인이면 마지막 값 유지).
 */
import { useEffect, useRef, useState } from "react";
import App from "./App";
import AlbumView from "./AlbumView";
import PhotoViewer from "./PhotoViewer";

/** 카톡 사진 링크(?photo=주소|주소…&i=0) — 우리 저장소 사진만 확대·회전 뷰어로 연다(로그인 없이, 2026-10-14) */
function photoParam(): { urls: string[]; idx: number } | null {
  const q = new URLSearchParams(window.location.search);
  const raw = q.get("photo");
  if (!raw) return null;
  const urls = raw.split("|").map((u) => u.trim()).filter((u) => /^https:\/\/kkdiihazgzesbqxjytqv\.supabase\.co\/storage\/v1\/object\/public\//.test(u));
  if (!urls.length) return null;
  return { urls, idx: Math.min(urls.length - 1, Math.max(0, Number(q.get("i")) || 0)) };
}
import SsoGate from "./SsoGate";
import { getConfig } from "./supabase";
import { getSsoSession, isOnValue, rememberSsoRequired, SSO_ERROR_KEY, ssoRequiredCached, ssoRequiredStateCached, startGroupwareLogin } from "./sso";
import { decideBootView, useOnResume, type SsoRequiredState } from "./ssoBoot";

export default function Boot({ albumId }: { albumId: string | null }) {
  const [required, setRequired] = useState<SsoRequiredState>(() => ssoRequiredStateCached());
  const [ssoError] = useState<string>(() => {
    try { const e = sessionStorage.getItem(SSO_ERROR_KEY) || ""; sessionStorage.removeItem(SSO_ERROR_KEY); return e; } catch { return ""; }
  });
  useEffect(() => {
    getConfig().then((cfg) => { const on = isOnValue(cfg.SSO_REQUIRED); rememberSsoRequired(on); setRequired(on ? "on" : "off"); })
      .catch(() => setRequired((r) => (r === "unknown" ? "off" : r))); // 오프라인이면 마지막 값 유지(처음 보는 기기는 예전 방식으로 연다)
    // 새 기기에서 설정 응답이 늦으면 6초 뒤엔 예전 방식으로 연다 — 응답이 오면 위에서 다시 맞춘다
    const t = window.setTimeout(() => setRequired((r) => (r === "unknown" ? "off" : r)), 6000);
    return () => window.clearTimeout(t);
  }, []);
  // 화면이 다시 보일 때마다 세션 만료를 다시 확인한다(켜 둔 채 7일이 지난 폰 — 2026-10-21). 세션이 살아 있으면 값이 같아 다시 그리지 않는다
  const [hasSession, setHasSession] = useState(() => Boolean(getSsoSession()));
  const [tick, setTick] = useState(0);
  useOnResume(() => { const alive = Boolean(getSsoSession()); setHasSession(alive); if (!alive && ssoRequiredCached()) setTick((t) => t + 1); });
  // 잠금인데 세션이 없으면(실패로 돌아온 경우 제외) 그룹웨어 로그인으로 바로 이동 — 화면이 보일 때마다 한 번만(뒤로 가기로 돌아와 멈추지 않게)
  const sentTick = useRef(-1);
  const [photo] = useState(photoParam);
  const view = decideBootView({ publicPage: Boolean(albumId || photo), required, hasSession, ssoError });
  const needLogin = view === "login" || view === "gate";
  useEffect(() => {
    if (!needLogin || ssoError || sentTick.current === tick) return;
    sentTick.current = tick;
    startGroupwareLogin("/");
  }, [needLogin, ssoError, tick]);
  if (albumId) return <AlbumView id={albumId} />;
  if (photo) return <div className="min-h-[100dvh] bg-black"><PhotoViewer urls={photo.urls} index={photo.idx} onClose={() => { window.location.href = "/"; }} /></div>;
  if (view === "gate") return <SsoGate error={ssoError} />;
  if (view === "login") return <div className="flex min-h-[100dvh] items-center justify-center bg-[#070d1a] text-sm font-bold text-slate-300">그룹웨어 로그인으로 이동 중…</div>;
  if (view === "wait-config") return <div className="flex min-h-[100dvh] items-center justify-center bg-[#070d1a] text-sm font-bold text-slate-300">불러오는 중…</div>;
  return <App />;
}
