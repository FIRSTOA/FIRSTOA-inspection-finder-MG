/**
 * 필드탭 원문 판정 — 붙여넣은 텍스트가 점검 원문인지 AS(빈 양식) 계열인지,
 * 그리고 구분(점검/AS/마감/여분/세팅)을 자동 감지한다.
 * App.tsx에서 추출한 순수 함수 — 판정 자동 테스트(tests/)가 이 모듈을 검증한다.
 */
export function detectUnifiedInputMode(text: string): "inspection" | "blank-report" {
  const raw = String(text || "");
  const intakeMarkers = ["접수분야", "접수유형", "임대리스트순번", "방문담당자", "AS접수횟수", "자가사용내역"];
  const markerCount = intakeMarkers.filter((marker) => raw.includes(marker)).length;
  if (markerCount >= 2) return "blank-report";
  const first = raw.trim().split(/\r?\n/)[0] || "";
  // \b는 한글 뒤에서 성립하지 않는다(ASCII 전용) — 한글 토큰은 경계 없이, AS만 \b 유지
  if (/^(?:A\s*\/?\s*S\b|여분요청|샘플전달|자가요청)/i.test(first)) return "blank-report";
  return "inspection";
}

export function detectReportTypesFromInput(text: string): string[] {
  const raw = String(text || "");
  const field = raw.match(/(?:접수분야|구분)\s*[:：\t ]+\s*([^\t\r\n]+)/i)?.[1] || raw.trim().split(/\s+/)[0] || "";
  const found: string[] = [];
  if (/점검/.test(field)) found.push("점검");
  if (/A\s*\/?\s*S|에이에스/i.test(field)) found.push("AS");
  if (/마감/.test(field)) found.push("마감");
  if (/여분/.test(field)) found.push("여분");
  if (/세팅|셋팅/.test(field)) found.push("세팅");
  return found;
}
