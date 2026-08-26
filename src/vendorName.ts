/**
 * 임대리스트 시트 원문 업체명(CA열 "업체명": "25V(주) 드림엔지니어링삼성동현장타 업체와 6:4 청구발행매월마감")을 양식용으로 다듬는다.
 * 양식 첫 줄이 `마감일+등급`을 앞에 따로 붙이므로("25V"), 원문의 순번+등급 접두를 떼지 않으면 "25V25#V㈜세안…"처럼 겹친다(2026-08-26 실사고).
 */
const GRADE_PREFIX = /^\s*\d{1,4}#?(?:SS|NN|S|N|V)(?=[가-힣㈜("'\s])/;

export function stripGradePrefix(name: string): string {
  return String(name || "").replace(GRADE_PREFIX, "").replace(/_x000d_|\r|\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 접수 양식·기록에 쓸 업체명: 시트 원문 업체명(지점 표기 포함) → 거래처명/_업체명(회사명만).
 * 워킨맵 이름은 쓰지 않는다 — 회사명만으로 지도를 찾으면 본사·현장 중 아무 지점이 잡혔다(드림엔지니어링본사, 세안이엔씨삼성서울병원).
 */
export function sheetVendorName(hit: Record<string, string> | null | undefined): string {
  if (!hit) return "";
  const full = stripGradePrefix(hit["업체명"] || "");
  if (full.length >= 2) return full;
  return String(hit["거래처명"] || hit["_업체명"] || "").trim();
}
