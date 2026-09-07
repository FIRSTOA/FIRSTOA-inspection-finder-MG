import { describe, expect, it } from "vitest";
import { extractCompanyForTemplate, fieldTicketVendor } from "../src/ids";

/**
 * 실사고(2026-09-02): 임대리스트 행 "A/S V SL-X7500LX 12#V주식회사 디쉐어분당점백업"을
 * FIELD 미양식으로 변환하면 업체명이 "V주식회사"로 나왔다 — 일반 규칙(…회사 꼬리)이
 * 왼쪽부터 훑다 등급 글자 V를 이름에 붙인 것. 등급 접두 규칙이 먼저 잡아야 한다.
 */
describe("extractCompanyForTemplate — 등급 접두", () => {
  it("마감 꼬리 없는 임대리스트 접두 (실사고 사례)", () => {
    expect(extractCompanyForTemplate("A/S V SL-X7500LX 12#V주식회사 디쉐어분당점백업"))
      .toBe("주식회사 디쉐어분당점백업");
  });
  it("탭 구분이어도 동일", () => {
    expect(extractCompanyForTemplate("A/S\tV\tSL-X7500LX\t12#V주식회사 디쉐어분당점백업"))
      .toBe("주식회사 디쉐어분당점백업");
  });
  it("마감 꼬리가 있으면 기존 규칙 그대로", () => {
    expect(extractCompanyForTemplate("31SS주식회사 에이피더핀-분기마감")).toContain("에이피더핀");
  });
  it("등급 접두가 없으면 일반 규칙", () => {
    expect(extractCompanyForTemplate("주식회사 지투지프라이빗에쿼티(GTOG Private Equity Co.,Ltd.) 점검"))
      .toContain("지투지프라이빗에쿼티");
  });
  it("fieldTicketVendor도 같은 입력에서 흔들리지 않는다", () => {
    expect(fieldTicketVendor("A/S V SL-X7500LX 12#V주식회사 디쉐어분당점백업").vendor)
      .toBe("주식회사 디쉐어분당점백업");
  });
});
