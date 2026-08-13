// 기번/자산기번 등 식별자 비교용 정규화 — 프로젝트 공용.
// (api.ts normId / WalkingMap normalizeIdKey / spareAdvice normSerial 로 3벌 중복이던 것을 통합)
export function normalizeId(value: string) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

// 워킨맵 지명("25#V보림토건(주) 3분기…")에서 접두 번호·등급·꼬리표를 벗겨 업체명 비교키를 만든다.
// (WalkingMap 로컬 구현을 공용으로 승격 — vendorFlags·일정리스트 배지에서도 같은 기준 사용)
export function vendorMatchKey(value: string) {
  return String(value || "")
    // ㈜·(주)는 기호 제거를 거치면 맨 앞 "주"만 남아 "주식회사" 제거 규칙을 빠져나간다 — 먼저 지운다
    .replace(/㈜|\(주\)|\(유\)/g, "")
    // 접두 번호와 등급 사이에 #·/·- 가 끼는 형식("20#SS…", "2609/17#V…")이 워킨맵에 190곳 있다
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, "")
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?/i, "")
    .replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase()
    // 법인 접두어는 변별력이 없는데 앞부분 일치 매칭을 오폭시킨다 ("주식회사 무암" ↔ "주식회사 무천…")
    .replace(/^(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인)/, "");
}

// 워킨맵 comment는 "모델 / 시리얼" 표기(공백 유무 혼재) — 첫 슬래시가 구분자.
// 자동일정 등록·내 일정 표시가 같은 규칙을 쓴다.
export function parseEquipComment(comment: string): { model: string; serial: string } {
  const t = String(comment || "").replace(/\s+/g, " ").trim();
  if (!t) return { model: "", serial: "" };
  const i = t.indexOf("/");
  if (i < 0) return { model: t, serial: "" };
  return { model: t.slice(0, i).trim(), serial: t.slice(i + 1).trim() };
}
