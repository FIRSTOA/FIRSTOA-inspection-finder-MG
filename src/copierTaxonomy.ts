/**
 * 복합기 분류 어휘 — 브랜드·기종 시리즈·증상. 기록(copier_notes)·족보(copier_playbook)·가이드(knowledge_docs)가
 * **같은 축**을 써야 세 층이 연결되므로 한 곳에 모아 둔다.
 *
 * 주의: 족보 카드를 만드는 클러스터 스크립트(scratchpad/jokbo-cluster.mjs)는 이 파일 규칙의 거울이다.
 * 한쪽만 고치면 브랜드가 비어 있는 기록이 엉뚱한 브랜드로 배정된다(제록스 9201 사고, 2026-08-18).
 * 규칙을 고치면 tests/taxonomy.test.ts가 대표 모델명으로 검산한다 — 스크립트도 함께 갱신할 것.
 */
export const BRANDS: Record<string, string[]> = {
  삼성: ["MX3", "MX4", "MX7", "9201", "흑백기"],
  신도: ["320", "410", "420", "450", "N501", "600", "bizhub"],
  제록스: ["키슈", "세이토", "마블", "베니", "보탄", "헤라", "APEOS", "SC2022", "305", "5005"],
  교세라: ["2100", "2101", "5521", "5526"],
  브라더: ["5700", "8900"],
  오키: ["5473"],
  HP: ["477", "530", "650", "7740", "8600", "8610", "8710", "8720", "8730", "9010"],
  리코: [],
  캐논: [],
  코니카미놀타: [],
  렉스마크: ["MX410"],
  기타: [],
};
export const BRAND_NAMES = Object.keys(BRANDS);

/**
 * 기종 칩 → 실제 모델명 매칭 규칙.
 * 기록의 model엔 관용명("MX3")과 실기기명("SL-X3220NR")이 섞여 있어서
 * 칩 선택 시 [관용명 일치 OR 포함 패턴 OR 정규식]으로 다 잡는다.
 * 삼성 K+숫자(SL-K…)는 흑백기로 분류 — MX 칩에서는 제외.
 */
export type ModelRule = { include: string[]; regex?: string; excludeRegex?: string };
export const MODEL_RULES: Record<string, Record<string, ModelRule>> = {
  삼성: {
    MX3: { include: ["3220", "3250", "3255", "3280"], excludeRegex: "k[0-9]" },
    MX4: { include: ["4220", "4225", "4250", "4255", "4300", "4305", "4350", "4355"], excludeRegex: "k[0-9]" },
    MX7: { include: ["7400", "7500", "7600"], excludeRegex: "k[0-9]" },
    "9201": { include: ["9201", "9251", "9301"] }, // CLX-9201/9251/9301 — 삼성 대형 컬러기(기록에 제록스로 오기된 건이 있었다)
    흑백기: { include: [], regex: "k[0-9]{3}" },
  },
  신도: {
    "320": { include: ["320", "321"] }, "410": { include: ["410", "411"] }, "420": { include: ["420", "422"] },
    "450": { include: ["450", "451", "452"] }, N501: { include: ["501"] }, "600": { include: ["600"] }, bizhub: { include: ["bizhub"] },
  },
  // 제록스는 기록에 팀 약어가 쓰인다(VC3375·APVIIC2273·DCVC2263…). 세대 약어 = 코드명 대응은
  // 팀이 코드명을 병기해 둔 기록에서 확인됨: V→세이토, VI→베니, VII→보탄, IV→키슈,
  // DocuCentre-V C2263→마블, V C5585→헤라(클래스). 순서가 우선순위 — 헤라·번호 시리즈를 먼저 걸러야
  // "VC5585"가 세이토로 새지 않는다. 9201/9301은 코드명 확인 전이라 번호 그대로 둔다.
  제록스: {
    헤라: { include: ["헤라", "5580", "5585", "6680"] },
    "305": { include: ["305"] },
    "5005": { include: ["5005"] },
    SC2022: { include: ["sc2022", "sc-2022", "2022"] },
    보탄: { include: ["보탄", "port-vii c"], regex: "vii[\\s-]*c?\\d{4}" },
    베니: { include: ["베니", "port-vi c"], regex: "vi(?!i)[\\s-]*c?\\d{4}" },
    키슈: { include: ["키슈", "port-iv c"], regex: "iv[\\s-]*c?\\d{4}" },
    마블: { include: ["마블", "centre-v c226", "c2263", "c2265"] },
    세이토: { include: ["세이토", "port-v c", "centre-v c2276", "centre-v c3375"], regex: "(?:^|[^aeiou])v[\\s-]*c?\\d{4}" },
    APEOS: { include: ["apeos-c", "apeos-3", "apeosc", "2060", "3070", "2560"] },
  },
  교세라: { "2100": { include: ["2100"] }, "2101": { include: ["2101"] }, "5521": { include: ["5521"] }, "5526": { include: ["5526"] } },
  브라더: { "5700": { include: ["5700"] }, "8900": { include: ["8900"] } },
  오키: { "5473": { include: ["5473"] } },
  HP: Object.fromEntries(["477", "530", "650", "7740", "8600", "8610", "8710", "8720", "8730", "9010"].map((num) => [num, { include: [num] }])),
  렉스마크: { MX410: { include: ["410"] } },
};

// 증상 유형 필터 — 제목·내용 키워드로 서버에서 거른다 (기종 × 증상으로 범위 축소)
export const SYMPTOM_FILTERS: Record<string, string[]> = {
  "급지·걸림": ["급지", "걸림", "잼", "JAM"],
  "줄·화질": ["세로줄", "가로줄", "얼룩", "화질", "번짐", "흐림", "비침"],
  "에러코드": ["에러", "error", "E-", "SC", "코드"],
  "토너·드럼": ["토너", "드럼", "카트리지", "폐토너"],
  "정착기·롤러": ["정착", "퓨저", "롤러", "히터"],
  "스캔·팩스": ["스캔", "팩스", "ADF"],
  "네트워크·드라이버": ["네트워크", "드라이버", "IP", "무선", "포트", "공유"],
  "소음": ["소음", "소리", "이음"],
};

/**
 * 모델명 → [브랜드, 시리즈] 판정. 브랜드를 알면 그 브랜드 규칙만, 모르면(기록에 "기타") 전 브랜드를 훑는다.
 * 규칙 객체의 **선언 순서가 우선순위**다 — 제록스 헤라(5585)를 세이토(V세대)보다 먼저 둬야 VC5585가 헤라로 간다.
 */
export function seriesOfModel(brand: string, model: string): { brand: string; series: string } {
  const m = String(model || "").toLowerCase();
  const known = brand && brand !== "기타" && MODEL_RULES[brand];
  const candidates: Array<[string, Record<string, ModelRule>]> = known
    ? [[brand, MODEL_RULES[brand]]]
    : Object.entries(MODEL_RULES);
  for (const [brandName, rules] of candidates) {
    for (const [series, rule] of Object.entries(rules)) {
      if (rule.excludeRegex && new RegExp(rule.excludeRegex, "i").test(m)) continue;
      if (rule.include.some((key) => m.includes(key)) || (rule.regex && new RegExp(rule.regex, "i").test(m))) {
        return { brand: brandName, series };
      }
    }
  }
  return { brand: brand || "기타", series: "" };
}

/** 제목·내용에서 증상 분류 — 족보 카드의 symptom과 같은 어휘. 못 잡으면 "기타". */
export function symptomOfText(text: string): string {
  const hay = String(text || "").toLowerCase();
  for (const [name, keys] of Object.entries(SYMPTOM_FILTERS)) {
    if (keys.some((key) => hay.includes(key.toLowerCase()))) return name;
  }
  return "기타";
}
