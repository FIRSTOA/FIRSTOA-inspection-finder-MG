/**
 * 복합기 분류 어휘 회귀 테스트 — 기종 판정과 증상 분류가 어긋나면 세 층(기록·족보·가이드)의 연결이 끊긴다.
 *
 * 이 파일이 존재하는 이유(2026-08-18 사고):
 *  ① 제록스 기록은 팀 약어(VC3375·APVIIC2273)라 세대 규칙이 없으면 시리즈 미상으로 뭉쳤다.
 *  ② 규칙 순서를 잘못 두면 "VC5585"가 헤라가 아니라 세이토로 샌다.
 *  ③ CLX-9201은 삼성인데 제록스 규칙에 넣어 카드 4장이 잘못 만들어졌다.
 * 아래 픽스처는 전부 실제 기록에 있던 모델 표기다.
 */
import { describe, expect, it } from "vitest";
import { BRANDS, MODEL_RULES, seriesOfModel, symptomOfText } from "../src/copierTaxonomy";

describe("제록스 세대 약어 → 코드명", () => {
  // 팀이 코드명을 병기해 둔 기록에서 확인된 대응 (apeosport-vc3375(세이토) 등)
  const cases: Array<[string, string]> = [
    ["vc3375", "세이토"], ["apvc3375", "세이토"], ["vc5575", "세이토"], ["vc2276", "세이토"],
    ["vc2263", "마블"], ["dcvc2263", "마블"], ["vc2265", "마블"],
    ["vic2271", "베니"], ["apvic3371", "베니"],
    ["apviic2273", "보탄"], ["viic4473", "보탄"],
    ["ivc5575", "키슈"], ["apivc5570", "키슈"],
    ["vc5585", "헤라"], ["apvc5585", "헤라"], // 번호 시리즈가 세대 규칙보다 먼저 걸러져야 한다
    ["c2060", "APEOS"], ["apeos-c2060", "APEOS"], ["ac3070", "APEOS"],
    ["cm305", "305"], ["5005d", "5005"],
  ];
  for (const [model, series] of cases) {
    it(`${model} → ${series}`, () => {
      expect(seriesOfModel("제록스", model)).toEqual({ brand: "제록스", series });
    });
  }
});

describe("삼성 기종", () => {
  it("SL-X3220NR은 MX3", () => expect(seriesOfModel("삼성", "SL-X3220NR").series).toBe("MX3"));
  it("SL-X4300LX는 MX4", () => expect(seriesOfModel("삼성", "SL-X4300LX").series).toBe("MX4"));
  it("SL-X7500LX는 MX7", () => expect(seriesOfModel("삼성", "SL-X7500LX").series).toBe("MX7"));
  it("SL-K703GX는 흑백기 (K+숫자는 MX에서 제외)", () => expect(seriesOfModel("삼성", "SL-K703GX").series).toBe("흑백기"));
  // CLX-9201/9251/9301은 삼성 — 기록 113건이 제록스로 오기돼 있었고 정정했다
  for (const model of ["CLX-9201", "clx9251", "C9301", "9201NA"]) {
    it(`${model}은 삼성 9201`, () => expect(seriesOfModel("삼성", model)).toEqual({ brand: "삼성", series: "9201" }));
  }
  it("제록스 규칙은 9201을 주장하지 않는다", () => {
    expect(Object.keys(MODEL_RULES.제록스)).not.toContain("9201");
    expect(BRANDS.제록스).not.toContain("9201");
    expect(BRANDS.삼성).toContain("9201");
  });
});

describe("브랜드가 비어 있어도 모델로 찾는다", () => {
  // 기록의 절반은 브랜드가 "기타" — 모델 표기만으로 브랜드·시리즈를 되찾아야 족보 카드가 제 브랜드로 간다
  it("기타 + vc3375 → 제록스 세이토", () => expect(seriesOfModel("기타", "vc3375")).toEqual({ brand: "제록스", series: "세이토" }));
  it("기타 + clx-9201 → 삼성 9201", () => expect(seriesOfModel("기타", "clx-9201")).toEqual({ brand: "삼성", series: "9201" }));
  it("모델이 없으면 시리즈는 빈 값", () => expect(seriesOfModel("삼성", "").series).toBe(""));
  it("알 수 없는 모델은 브랜드만 유지", () => expect(seriesOfModel("삼성", "ZZ-0000").series).toBe(""));
});

describe("증상 분류", () => {
  const cases: Array<[string, string]> = [
    ["용지걸림 지속 발생", "급지·걸림"],
    ["출력물에 세로줄 생김", "줄·화질"],
    ["현상기 에러 점등", "에러코드"],   // '에러'가 먼저 걸리는 어휘 순서 유지
    ["폐토너통 만충", "토너·드럼"],
    ["정착기 온도 설정", "정착기·롤러"],
    ["ADF 스캔 시 이물", "스캔·팩스"],
    ["네트워크 출력 안됨", "네트워크·드라이버"],
    ["구동시 소음 발생", "소음"],
    ["고객 인사만 하고 옴", "기타"],
  ];
  for (const [text, symptom] of cases) {
    it(`"${text}" → ${symptom}`, () => expect(symptomOfText(text)).toBe(symptom));
  }
});
