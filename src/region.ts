/** 지역 분류 공용 헬퍼 (거래처검색·통합이력 공유).
 *  A 강북 / B 강서 / C 강남 / D 경기 / E 지방. 확인 안 된 건 "기타".
 */
import type { VendorHit } from "./api";

export const REGIONS = ["A", "B", "C", "D", "E"];
export const REGION_LABEL: Record<string, string> = { A: "강북", B: "강서", C: "강남", D: "경기", E: "지방" };

// "수도권A"·"C지역"·"c" 등 A~E 글자가 있으면 그 글자.
// 그 외(충청도·경상도 등 지방 표기 전부)는 값이 있으면 E — 현장 규칙:
// "A~E가 들어가면 그 글자, 나머지는 전부 E지역으로 본다".
export function normRegion(r: string): string {
  const s = String(r || "").trim();
  if (!s) return "";
  const letter = s.toUpperCase().match(/[A-E]/);
  return letter ? letter[0] : "E";
}

// 대표 지역 (점검 > AS > 그 외 순) — 뱃지·정렬용.
const REGION_PREF = ["점검", "AS", "미수", "불만", "임대현황표", "초과", "PC확장성", "복합기확장성", "재계약", "업체정보"];
export function primaryRegion(h: VendorHit): string {
  const m = h.meta || {};
  for (const k of REGION_PREF) { const r = m[k]?.r; if (r) return normRegion(String(r)); }
  return "";
}

// 거래처 분류용 단일 지역: 대표지역이 A~E면 그 글자, 아니면 "기타".
export function vendorRegion(h: VendorHit): string {
  const r = primaryRegion(h);
  return REGIONS.includes(r) ? r : "기타";
}
