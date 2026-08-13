/**
 * 카카오맵 JS SDK 로더 — 한 번만 주입하고 재사용한다.
 * 도메인 미등록·차단 등으로 실패하면 null을 돌려 호출부가 Leaflet으로 폴백한다.
 * (JavaScript 키는 공개용 — 등록 도메인에서만 동작하도록 카카오가 제한한다)
 */
const KAKAO_JS_KEY = "67d45005b407ddcd7cb18da2bdbe14d6";

// 카카오 SDK는 전역 window.kakao로 노출된다 — 전체 타입 대신 필요한 만큼만 선언
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KakaoNS = any;

let loader: Promise<KakaoNS | null> | null = null;

export function loadKakaoMaps(): Promise<KakaoNS | null> {
  if (loader) return loader;
  loader = new Promise((resolve) => {
    const w = window as unknown as { kakao?: { maps?: { load?: (cb: () => void) => void; Map?: unknown } } };
    if (w.kakao?.maps?.Map) { resolve(w.kakao); return; }
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`;
    script.async = true;
    const timeout = window.setTimeout(() => resolve(null), 8000);
    script.onload = () => {
      const maps = (window as unknown as { kakao?: { maps?: { load?: (cb: () => void) => void } } }).kakao?.maps;
      if (!maps?.load) { window.clearTimeout(timeout); resolve(null); return; }
      maps.load(() => { window.clearTimeout(timeout); resolve((window as unknown as { kakao: KakaoNS }).kakao); });
    };
    script.onerror = () => { window.clearTimeout(timeout); resolve(null); };
    document.head.appendChild(script);
  });
  return loader;
}
