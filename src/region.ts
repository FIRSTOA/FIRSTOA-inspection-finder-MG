/** 지역 분류 공용 헬퍼 (거래처검색·통합이력 공유).
 *  A 강북 / B 강서 / C 강남 / D 경기 / E 지방. 확인 안 된 건 "기타".
 */
import type { VendorHit } from "./api";

export const REGIONS = ["A", "B", "C", "D", "E"];
export const REGION_LABEL: Record<string, string> = { A: "강북", B: "강서", C: "강남", D: "경기", E: "지방" };

// 지방(도·광역시) 판별 토큰 — "광주"는 경기 광주와 겹쳐 광역시 표기만 인정
const PROVINCE_TOKENS = ["충청", "충남", "충북", "대전", "세종", "전라", "전남", "전북", "경상", "경남", "경북", "대구", "부산", "울산", "강원", "제주", "광주광역", "지방"];

// "수도권A"·"A" → "A". A~E 글자 있으면 그 글자, 지방(도 단위)은 "E", 그 외 원문.
export function normRegion(r: string): string {
  const s = String(r || "").trim();
  const upper = s.toUpperCase();
  const suffix = upper.match(/([A-E])\s*$/);
  if (suffix) return suffix[1];
  const prefix = upper.match(/^([A-E])(?:\s|$)/);
  if (prefix) return prefix[1];
  if (PROVINCE_TOKENS.some((token) => s.includes(token))) return "E";
  return s;
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
