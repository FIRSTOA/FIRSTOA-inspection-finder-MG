/**
 * 기종명 → 제조사 공식 카탈로그.
 * 재고현황·복합기 학습·거래처검색 등에서 같은 분류를 쓰도록 한 곳에 확립한다.
 * (2026-07 팀 보유 기종 목록 기준 — 새 기종은 여기에만 추가하면 전 화면에 반영)
 */
export const MODEL_CATALOG: Record<string, string[]> = {
  제록스: [
    "Apeos-3560", "APEOS-C2060", "APEOS-C2061", "APEOS-C2450S", "APEOS-C2560", "APEOS-C2561", "APEOS-C2567",
    "APEOS-C3060", "APEOS-C3061", "APEOS-C3067", "APEOS-C3070", "APEOS-C3567", "APEOS-C3570", "APEOS-C4570",
    "APEOS-C4571", "APEOS-C5570", "APEOS-C7070", "APEOS-C8180",
    "ApeosPort-3060", "ApeosPort-C2060", "ApeosPort-C2560", "ApeosPort-C3070", "ApeosPort-C3570", "ApeosPort-C5570",
    "ApeosPort-IV C2270(키슈)", "ApeosPort-IV C3370(키슈)", "ApeosPort-IV C3373(키슈)", "ApeosPort-IV C3375(키슈)",
    "ApeosPort-IV C3376(키슈)", "ApeosPort-IV C5570(키슈)", "ApeosPort-IV C5575(키슈)",
    "ApeosPort-IV C5580(헤라클래스)", "ApeosPort-IV C6680(헤라클래스)",
    "ApeosPort-V C2275(세이토)", "ApeosPort-V C2276(세이토)", "ApeosPort-V C3373(세이토)", "ApeosPort-V C3375(세이토)",
    "ApeosPort-V C3376(세이토)", "ApeosPort-V C4475(세이토)", "ApeosPort-V C5575(세이토)", "ApeosPort-V C5576(세이토)",
    "ApeosPort-V C5580(헤라클래스)", "ApeosPort-V C5585(헤라클래스)", "ApeosPort-V C6680(헤라클래스)",
    "ApeosPort-V3560",
    "ApeosPort-VI C2271(베니)", "ApeosPort-VI C3371(베니)", "ApeosPort-VI C4471(베니)", "ApeosPort-VI C5571(베니)",
    "ApeosPort-VII C2273(보탄)", "ApeosPort-VII C3373(보탄)", "ApeosPort-VII C3375(보탄)", "ApeosPort-VII C4473(보탄)",
    "ApeosPort-VII C5573(보탄)",
    "DocuCentre SC2022", "DocuCentre-V C2263(마블)", "DocuCentre-V C2265(마블)", "DocuCentre-V C2276(세이토)",
    "DocuCentre-V C3375(세이토)", "DocuCentre-V3065",
    "DocuPrint-C5005D", "DocuPrint-CM305DF", "DocuPrint CM305", "DocuPrint-CM415AP", "DocuPrint-P255dw",
    "CM115W", // DocuPrint CM115w
  ],
  삼성: [
    "CLX-6260FR", "CLX-9201NA", "CLX-9251NA", "CLX-9301NA", "SCX-6545X", "SCX-8123NA", "SCX-8128NA",
    "SL-C1860FW", "SL-C2470FR",
    "SL-K3250NR", "SL-K4250LX", "SL-K4250RX", "SL-K4255LX", "SL-K4255RX", "SL-K4300LX", "SL-K4305LX",
    "SL-K4350LX", "SL-K4355LX", "SL-K6350LX", "SL-K703GX", "SL-K730GX", "SL-K7400LX", "SL-K7500LX",
    "SL-K7600GX", "SL-K7600LX", "SL-K7600LXR", "SL-K9600LX",
    "SL-M2027", "SL-M3870FW", "SL-M3890FW",
    "SL-X3220NR", "SL-X3280NR", "SL-X4220RX", "SL-X4225RX", "SL-X4250LX", "SL-X4255LX", "SL-X4255RX",
    "SL-X4300LX", "SL-X4305LX", "SL-X5230NR", "SL-X6250LX", "SL-X6300LX", "SL-X7400LX", "SL-X7400LXR",
    "SL-X7500LX", "SL-X7600LX", "SL-X7600LXR", "SL-X9400LX", "SL-X9600LX",
    "AX34N302NWWD", // 블루스카이 공기청정기
  ],
  신도: [
    "D320", "D321", "D400", "D410", "D411", "D420", "D422", "D430", "D450", "D451", "D452", "D470",
    "N501", "N502", "N600", "N601", "MF3091(N502)", "A600",
  ],
  교세라: ["ECOSYS-M5521CDN", "ECOSYS-M5521CDW", "ECOSYS-M5526CDN", "ECOSYS-MA2100CFX", "ECOSYS-P5021cdn", "ECOSYS-PA2100CX"],
  오키: ["ES5473"],
  브라더: ["HL-L2360DN", "HL-L2365DW", "HL-L5100DN", "MFC-8900CDW", "MFC-L5700DN", "MFC-L8900CDN"],
  HP: [
    "HP DesignJet T790(24형)", "HP-477DW", "HP-7740", "HP-8600", "HP-8610", "HP-8710", "HP-8720", "HP-8730",
    "HP-9010", "HP-T530", "HP-T650",
  ],
  리코: ["IM-C2000", "IM-C2010", "MP-2554", "MP-C2003", "MP-C2004"],
  캐논: ["IR-ADV C3525"],
  코니카미놀타: ["BIZHUB-025DNI", "BIZHUB-028DN", "BIZHUB-128DN", "BIZHUB-136DN"],
  // 제조사 확인 필요 — 확인되면 위 항목으로 옮기기
  미확인: ["DGWOX-4100", "MB2390", "MX410", "ACM3CA", "KS7305", "KS1270C"],
};

export const CATALOG_BRANDS = Object.keys(MODEL_CATALOG).filter((brand) => brand !== "미확인");

// 기종명 정규화: 괄호 별칭 제거, 대문자, 영숫자만 (예: "ApeosPort-V C3375(세이토)" → "APEOSPORTVC3375")
export function normalizeModelKey(model: string): string {
  return String(model || "")
    .replace(/\([^)]*\)/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const KEY_TO_BRAND = new Map<string, string>();
for (const [brand, models] of Object.entries(MODEL_CATALOG)) {
  if (brand === "미확인") continue;
  for (const model of models) {
    const key = normalizeModelKey(model);
    if (key) KEY_TO_BRAND.set(key, brand);
  }
}
const CATALOG_KEYS = Array.from(KEY_TO_BRAND.keys()).sort((a, b) => b.length - a.length);

// 카탈로그 기반 제조사 판정 — 정확 일치 → 포함 일치(긴 키 우선). 못 찾으면 "".
export function brandOfModel(model: string): string {
  const key = normalizeModelKey(model);
  if (!key) return "";
  const exact = KEY_TO_BRAND.get(key);
  if (exact) return exact;
  if (key.length < 4) return "";
  for (const candidate of CATALOG_KEYS) {
    if (candidate.length >= 4 && (key.includes(candidate) || candidate.includes(key))) return KEY_TO_BRAND.get(candidate) || "";
  }
  return "";
}

// 전체 기종 목록 (datalist 자동완성용) — 카탈로그 표기 그대로
export const ALL_MODEL_NAMES = Object.entries(MODEL_CATALOG)
  .filter(([brand]) => brand !== "미확인")
  .flatMap(([, models]) => models);
