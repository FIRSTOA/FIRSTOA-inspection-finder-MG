// 내비 바로가기 링크 — 모바일에서는 지도 앱(스킴)으로, PC에서는 웹 지도로 연다.
// 팀 휴대폰에는 네이버지도·카카오맵·T맵이 깔려 있는 전제라 모바일은 앱 스킴을 그대로 쓴다.
export const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent);

export function naverMapLink(query: string): string {
  const q = encodeURIComponent(query);
  return isMobileDevice ? `nmap://search?query=${q}&appname=com.firstoa.cs` : `https://map.naver.com/p/search/${q}`;
}

export function kakaoMapSearchLink(query: string): string {
  const q = encodeURIComponent(query);
  return isMobileDevice ? `kakaomap://search?q=${q}` : `https://map.kakao.com/link/search/${q}`;
}

// 좌표가 있으면 카카오는 길찾기로 연다 (목적지 지정)
export function kakaoMapRouteLink(name: string, lat: number, lng: number): string {
  return isMobileDevice
    ? `kakaomap://route?ep=${lat},${lng}&by=CAR`
    : `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`;
}

// 네이버 길찾기 — 좌표가 있으면 목적지 지정, PC는 검색으로 (웹 길찾기 URL은 좌표계가 달라 불안정)
export function naverMapRouteLink(name: string, lat?: number, lng?: number): string {
  if (isMobileDevice && lat != null && lng != null) {
    return `nmap://route/car?dlat=${lat}&dlng=${lng}&dname=${encodeURIComponent(name)}&appname=com.firstoa.cs`;
  }
  return naverMapLink(name);
}

// T맵 길찾기 — 앱 전용 스킴 (PC에는 T맵이 없어 눌러도 무반응이지만, 일정리스트 상세와 표기를 맞춘다)
export function tmapRouteLink(name: string, lat?: number, lng?: number): string {
  if (lat != null && lng != null) return `tmap://route?goalname=${encodeURIComponent(name)}&goaly=${lat}&goalx=${lng}`;
  return `tmap://search?name=${encodeURIComponent(name)}`;
}
