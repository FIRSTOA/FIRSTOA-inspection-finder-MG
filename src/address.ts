// 사람이 쓴 현장 주소 → 지도 검색·지오코딩이 먹는 형태(2026-09-29).
// 실제 실패 예: "서울 서초구 서초대로 77길 17 제 지하1층 (블럭77 빌딩) (엘베 유) ㄴ주소 특이사항 : 탑차 주차 불가능"
//  - 지도 앱은 층·건물·메모까지 검색어로 받아 엉뚱한 곳을 찍었다.
//  - 지오코더(엣지 geocode)는 "…로 N길 M"을 첫 "로"에서 잘라 "서초대로 77"(다른 건물)로 찾았다.
export function tidyAddress(raw: string): string {
  return String(raw || "")
    .replace(/_x000d_|\r|\n|\t/g, " ")
    .replace(/\s*(?:ㄴ|※|＊|\*)\s*.*$/, "") // "ㄴ주소 특이사항 : …" 같은 꼬리 메모
    .replace(/\([^)]*\)|\[[^\]]*\]|［[^］]*］/g, " ") // (블럭77 빌딩) (엘베 유)
    .replace(/\s+/g, " ").trim()
    .replace(/^서울\s*(?:특별)?시/, "서울")
    .replace(/^(부산|대구|인천|광주|대전|울산)\s*(?:광역)?시/, "$1")
    .replace(/^세종\s*특별자치시/, "세종")
    .replace(/([가-힣A-Za-z0-9·]+(?:로|길))\s+(\d+(?:번)?길)/g, "$1$2") // "서초대로 77길" → "서초대로77길"
    .replace(/(\d+(?:번)?길)\s*(\d+(?:-\d+)?)/g, "$1 $2") // "77길17" → "77길 17"
    .replace(/([가-힣]+(?:동|리|가))\s*(\d+(?:-\d+)?)(?=\s|$)/g, "$1 $2")
    .replace(/([가-힣]+로)\s*(\d+(?:-\d+)?)(?=\s|$)(?!\s*길)/g, "$1 $2");
}

// 도로명+건물번호(또는 동+번지)까지만 — 층·호·건물명·메모는 뺀다. 못 찾으면 다듬은 전체.
export function addressCore(raw: string): string {
  const v = tidyAddress(raw)
    .replace(/\s*(?:지하|B)\s*\d+\s*(?:층|F)(?:\s.*)?$/i, "")
    .replace(/\s*\d+\s*(?:층|호)(?:\s.*)?$/, "");
  const road = v.match(/^(.*?(?:로|길)(?:\d+번?길)?\s*\d+(?:-\d+)?)(?=\s|,|$)/);
  if (road) return road[1].trim();
  const jibun = v.match(/^(.*?[가-힣]+(?:동|리|가)\s*\d+(?:-\d+)?)(?=\s|,|$)/);
  return jibun ? jibun[1].trim() : v;
}

// 지도 앱 검색어 — 주소가 있으면 핵심 주소, 없으면 대체값(업체명)
export function mapQuery(address: string | undefined, fallback = ""): string {
  const core = addressCore(address || "");
  return core || fallback;
}
