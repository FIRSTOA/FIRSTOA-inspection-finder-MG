/**
 * 판정 자동 테스트 — 실제로 터졌던 사고 사례를 박제해서, 판정 로직을 고칠 때
 * 과거 사고가 되살아나는지 배포 전에 잡는다. `npm test`로 실행.
 *
 * 케이스 출처(전부 실제 운영 사고/실데이터):
 *  - 재계약 212건 미분류: 워킨맵 재계약 이름이 "2109/27SS…" 형식
 *  - 무천디자인 오매칭 / 더채움 못 찾음: 법인 접두어·㈜ 표기 차이
 *  - 한성알앤씨 이력 못 찾음: 워킨맵 꼬리표가 키에 붙음
 *  - 워킨맵 190곳 "#" 접두("20#SS…", "2609/17#V…") 매칭 실패 (2026-08-14 발견)
 *  - 충청도가 D로, D가 E로 가던 지역 오판정
 *  - 내 일정 FIELD 불러오기가 분기점검을 AS로 변환하던 모드 감지 경로
 */
import { describe, expect, it } from "vitest";
import { normalizeId, parseEquipComment, vendorMatchKey } from "../src/ids";
import { normRegion } from "../src/region";
import { detectReportTypesFromInput, detectUnifiedInputMode } from "../src/fieldModes";
import { nextBusinessDay } from "../src/planDate";
import { parseCompanyAndGrade } from "../src/counterSmsParser";

describe("vendorMatchKey — 업체명 매칭 키", () => {
  it("㈜/(주) 표기 차이를 없앤다 (더채움 사고)", () => {
    expect(vendorMatchKey("㈜더채움자산운용")).toBe("더채움자산운용");
    expect(vendorMatchKey("(주)한성알앤씨")).toBe(vendorMatchKey("한성알앤씨"));
  });

  it("법인 접두어를 벗겨 앞부분 일치 오폭을 막는다 (무천디자인 사고)", () => {
    expect(vendorMatchKey("주식회사 무암")).toBe("무암");
    expect(vendorMatchKey("주식회사 무천디자인")).toBe("무천디자인");
    expect(vendorMatchKey("주식회사 무천디자인").startsWith(vendorMatchKey("주식회사 무암"))).toBe(false);
  });

  it("워킨맵 재계약 접두 '2109/27SS'를 벗긴다 (재계약 212건 미분류 사고)", () => {
    expect(vendorMatchKey("2109/27SS한성알앤씨매월마감")).toBe("한성알앤씨");
  });

  it("접두 번호와 등급 사이 #도 벗긴다 (워킨맵 190곳 — 20#SS·2609/17#V 형식)", () => {
    expect(vendorMatchKey("20#SS한불엠앤에스㈜1층 리셉션 사무실안쪽매월마감")).toBe("한불엠앤에스1층리셉션사무실안쪽");
    expect(vendorMatchKey("2609/17#V파인솔루션 주식회사506호C3608 기기이동 매월마감").startsWith("파인솔루션")).toBe(true);
    expect(vendorMatchKey("25#V보림토건(주) 3분기점검").startsWith("보림토건")).toBe(true);
  });

  it("마감 꼬리표를 벗긴다 (한성알앤씨 이력 못 찾던 사고)", () => {
    expect(vendorMatchKey("4S㈜화인브릿지학동로분기마감")).toBe("화인브릿지학동로");
    expect(vendorMatchKey("14SS㈜이오플랜본사1매월마감")).toBe("이오플랜본사1");
  });

  it("접두·꼬리 없는 평범한 이름은 그대로", () => {
    expect(vendorMatchKey("잡플러스")).toBe("잡플러스");
  });
});

describe("normalizeId — 기번/자산번호 비교 키", () => {
  it("기호·공백·대소문자를 무시한다", () => {
    expect(normalizeId("0A6X-BJMR 40001DY")).toBe("0a6xbjmr40001dy");
    expect(normalizeId("b7872")).toBe(normalizeId("B7872"));
  });
});

describe("normRegion — 지역 판정 (A~E 있으면 그 글자, 그 외 값 있으면 E)", () => {
  it("A~E 글자가 있으면 그 글자", () => {
    expect(normRegion("수도권A")).toBe("A");
    expect(normRegion("C지역")).toBe("C");
    expect(normRegion("c")).toBe("C");
    expect(normRegion("D")).toBe("D");
  });
  it("글자가 없으면 전부 E (충청도가 D로 가던 사고)", () => {
    expect(normRegion("충청남도 천안")).toBe("E");
    expect(normRegion("지방")).toBe("E");
    expect(normRegion("강남")).toBe("E");
  });
  it("빈 값은 빈 문자열 (지역 없음 검증용)", () => {
    expect(normRegion("")).toBe("");
    expect(normRegion("  ")).toBe("");
  });
});

describe("parseEquipComment — 워킨맵 comment '모델 / 시리얼' 분해", () => {
  it("공백 유무와 무관하게 첫 슬래시로 나눈다", () => {
    expect(parseEquipComment("ApeosPort-VII C5573(보탄) / 291047")).toEqual({ model: "ApeosPort-VII C5573(보탄)", serial: "291047" });
    expect(parseEquipComment("SL-X3220NR/0A6XBJMR40001DY")).toEqual({ model: "SL-X3220NR", serial: "0A6XBJMR40001DY" });
  });
  it("슬래시가 없으면 전부 모델, 빈 값은 빈 결과", () => {
    expect(parseEquipComment("BIZHUB-128DN")).toEqual({ model: "BIZHUB-128DN", serial: "" });
    expect(parseEquipComment("")).toEqual({ model: "", serial: "" });
  });
});

describe("detectUnifiedInputMode — 점검/AS 원문 자동 감지 (내 일정 FIELD 불러오기 경로)", () => {
  it("접수 마커가 2개 이상이면 AS(빈 양식) 계열", () => {
    expect(detectUnifiedInputMode("접수분야: AS\n방문담당자: 홍길동\n내용: 급지 불량")).toBe("blank-report");
  });
  it("첫 줄이 AS/여분요청/자가요청으로 시작하면 AS 계열", () => {
    expect(detectUnifiedInputMode("AS 프린터 급지 불량\n연락처 010")).toBe("blank-report");
    expect(detectUnifiedInputMode("A/S 요청드립니다")).toBe("blank-report");
    expect(detectUnifiedInputMode("여분요청 토너 K 2개")).toBe("blank-report");
  });
  it("점검 원문은 inspection — 분기점검이 AS로 변환되면 안 된다", () => {
    expect(detectUnifiedInputMode("업체명: 한성알앤씨\n지역: C\n매수: 흑12345 컬678 큰컬0 합13023\n토너잔량: K80 C70 M60 Y50")).toBe("inspection");
  });
});

describe("detectReportTypesFromInput — 구분 자동 감지", () => {
  it("구분/접수분야 줄에서 유형을 뽑는다", () => {
    expect(detectReportTypesFromInput("구분: 점검, AS")).toEqual(["점검", "AS"]);
    expect(detectReportTypesFromInput("접수분야: 여분")).toEqual(["여분"]);
    expect(detectReportTypesFromInput("구분: 셋팅")).toEqual(["세팅"]);
  });
  it("구분 줄이 없으면 첫 단어로 판정한다", () => {
    expect(detectReportTypesFromInput("점검 다녀왔습니다")).toEqual(["점검"]);
  });
});

describe("nextBusinessDay — 주말 건너뛰기 (주말 무근무 설계)", () => {
  it("주말을 건너뛴다 (8/17은 광복절 대체공휴일이라 18일)", () => {
    expect(nextBusinessDay("2026-08-15")).toBe("2026-08-18");
    expect(nextBusinessDay("2026-08-16")).toBe("2026-08-18");
    expect(nextBusinessDay("2026-08-21")).toBe("2026-08-24"); // 평범한 금 → 월
  });
  it("평일은 다음 날", () => {
    expect(nextBusinessDay("2026-08-17")).toBe("2026-08-18");
  });
  it("한국 공휴일(대체공휴일 포함)도 건너뛴다", () => {
    expect(nextBusinessDay("2026-08-14")).toBe("2026-08-18"); // 금 → 광복절 토·대체공휴일 월 건너뛰고 화
    expect(nextBusinessDay("2026-12-31")).toBe("2027-01-04"); // 신정(금) 건너뛰고 월
  });
});

describe("parseCompanyAndGrade — 카운터 문자 첫 줄 판정 (원본 로직 박제)", () => {
  it("V·SS는 v_group, 그 외는 s_group", () => {
    expect(parseCompanyAndGrade("SS한불엠앤에스매월마감").gradeGroup).toBe("v_group");
    expect(parseCompanyAndGrade("N정도테크매월마감").gradeGroup).toBe("s_group");
  });
  it("마감 키워드 앞까지가 업체명", () => {
    expect(parseCompanyAndGrade("SS한불엠앤에스매월마감").vendor).toBe("SS 한불엠앤에스");
  });
  it("빈 줄은 확인 바람 처리", () => {
    expect(parseCompanyAndGrade("").vendor).toBe("거래처 확인 바람");
  });
});
