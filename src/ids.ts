// 기번/자산기번 등 식별자 비교용 정규화 — 프로젝트 공용.
// (api.ts normId / WalkingMap normalizeIdKey / spareAdvice normSerial 로 3벌 중복이던 것을 통합)
export function normalizeId(value: string) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

// 워킨맵 지명("25#V보림토건(주) 3분기…")에서 접두 번호·등급·꼬리표를 벗겨 업체명 비교키를 만든다.
// (WalkingMap 로컬 구현을 공용으로 승격 — vendorFlags·일정리스트 배지에서도 같은 기준 사용)
export function vendorMatchKey(value: string) {
  return String(value || "")
    .replace(/^(?:\d{4}\/)?\d+(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, "")
    .replace(/^(?:\d{4}\/)?\d+(?:SS|NN|S|N|V)?/i, "")
    .replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
}
