/**
 * 업체명 비교키 — 앱(src)과 엣지 함수(Deno)가 같은 규칙으로 "같은 업체"를 판단하도록 한 파일에 둔다 (2026-10-10).
 * src/ids.ts 의 vendorMatchKey, src/counterSmsContacts.ts 의 contactVendorKey 는 여기서 다시 내보낸다.
 * 브라우저·Deno 공용이라 import 가 없다(순수 문자열 처리만).
 */

// 워킨맵 지명("25#V보림토건(주) 3분기…")에서 접두 번호·등급·꼬리표를 벗겨 업체명 비교키를 만든다.
// (WalkingMap 로컬 구현을 공용으로 승격 — vendorFlags·일정리스트 배지에서도 같은 기준 사용)
export function vendorMatchKey(value: string): string {
  return String(value || "")
    // ㈜·(주)는 기호 제거를 거치면 맨 앞 "주"만 남아 "주식회사" 제거 규칙을 빠져나간다 — 먼저 지운다
    .replace(/㈜|\(주\)|\(유\)/g, "")
    // 괄호 메모("(bluedot Inc.)", "(비번 2580*")는 키를 오염시킨다 — SQL vendor_key_와 같은 규칙 (닫힘 유실 포함)
    .replace(/\([^)]*\)?/g, " ")
    // 접두 번호와 등급 사이에 #·/·- 가 끼는 형식("20#SS…", "2609/17#V…")이 워킨맵에 190곳 있다
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, "")
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?/i, "")
    .replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase()
    // 법인표기는 위치 불문 변별력이 없다 — "블루닷 주식회사" vs "블루닷"이 같은 키가 되도록 (SQL vendor_key_와 거울)
    .replace(/(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인)/g, "");
}

/** 마감 문자 업체 비교키 — 파서가 붙인 등급 접두("N 주식회사 무암")·순번·법인표기를 벗긴다. 이름 표기가 조금 달라도 같은 업체로 잇기 위해 */
export function contactVendorKey(vendor: string): string {
  const raw = String(vendor || "").trim();
  const stripped = raw.replace(/^(?:SS|NN|V|S|N)\s+/i, "");
  return vendorMatchKey(stripped) || vendorMatchKey(raw) || stripped.toLowerCase();
}
