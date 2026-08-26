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

/**
 * 저장용 지역 글자(A~E): "수도권D"·"c"·"강서B" → 글자, 경기권 지명 → D, 지방 표기 → E,
 * 못 알아보면(라벨 오삼킴 "키맨/접수자: …" 등) fallback 글자 → 없으면 빈칸. normRegion과 달리 아무 값이나 E로 몰지 않는다.
 * GAS Kakao.gs regionLetter_ 와 같은 규칙 — 어긋나면 카톡 수집분과 웹앱 저장분 표기가 갈린다.
 */
export function regionLetter(value: string, fallback = ""): string {
  const v = String(value || "").trim();
  const m = v.match(/^\s*(?:강서|강남|강북|강동|서울)?\s*(?:수도권)?\s*([A-Ea-e])\s*(?:지역|팀)?\s*$/);
  if (m) return m[1].toUpperCase();
  if (/(경기|평택|수원|화성|오산|성남|인천|용인|안양|부천|고양|일산|파주|김포|하남|과천|안산|시흥|의정부|남양주|포승|광명|구리|이천|안성|양주|동탄)/.test(v)) return "D";
  if (/(지방|충청|충남|충북|경상|경남|경북|전라|전남|전북|강원|제주|대전|대구|부산|울산|세종)/.test(v)) return "E";
  const f = String(fallback || "").trim().toUpperCase().match(/^(?:수도권)?([A-E])$/);
  return f ? f[1] : "";
}
