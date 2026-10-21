/**
 * 첫 화면 분기 판단 + 화면 복귀 때 다시 판단(2026-10-21 버그 수정).
 *  버그: Boot 는 처음 열 때 한 번만 "세션 있나"를 봤다. 폰에서 FIELD 를 켜 둔 채 7일 세션이 지나면(10/14 로그인 → 10/21)
 *  다시 화면을 열어도 새로고침이 없어 그룹웨어로 보내지 않았고, 양식들은 세션이 없다고 보고 작성자 고르기·인원 선택 창을 되살렸다.
 *  이제 화면이 다시 보일 때(visibilitychange·pageshow·focus)마다 다시 판단해 만료면 그룹웨어 재로그인으로 보낸다.
 *  새 기기(스위치 값을 아직 모름)는 설정을 받기 전엔 본 앱을 그리지 않는다 — 그 사이 작성자 고르기가 보이지 않게.
 */
import { useEffect, useRef } from "react";

export type SsoRequiredState = "on" | "off" | "unknown";
export type BootView = "public" | "wait-config" | "login" | "gate" | "app";

/** 순수 판단(테스트용) */
export function decideBootView(o: { publicPage: boolean; required: SsoRequiredState; hasSession: boolean; ssoError: string }): BootView {
  if (o.publicPage) return "public";
  if (o.required === "unknown") return "wait-config";
  if (o.required === "on" && !o.hasSession) return o.ssoError ? "gate" : "login";
  return "app";
}

/** 화면이 다시 보일 때(visibilitychange·pageshow·focus) fn 을 부른다 — Boot 가 여기서 세션을 다시 읽는다 */
export function useOnResume(fn: () => void) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible") ref.current(); };
    document.addEventListener("visibilitychange", on);
    window.addEventListener("pageshow", on);
    window.addEventListener("focus", on);
    return () => { document.removeEventListener("visibilitychange", on); window.removeEventListener("pageshow", on); window.removeEventListener("focus", on); };
  }, []);
}
