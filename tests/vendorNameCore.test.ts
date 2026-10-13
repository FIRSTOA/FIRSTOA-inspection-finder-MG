import { describe, expect, it } from "vitest";
import { vendorNameCore } from "../src/ids";

// 2026-10-12: 일정 제목에 메모가 붙어 임대리스트 주소를 못 찾던 것 — 업체 이름만 떼어 낸다
describe("일정 제목 → 업체 이름(vendorNameCore)", () => {
  it("뒤에 붙은 메모(숫자·행위어·사람 이름)를 뗀다", () => {
    expect(vendorNameCore("법무법인 수헌 3년+유지보수혜택 계약성사 계약사인 체크")).toBe("법무법인 수헌");
    expect(vendorNameCore("법무법인 수헌 재계약 2차체크 이민구")).toBe("법무법인 수헌");
    expect(vendorNameCore("푸드본 정기점검")).toBe("푸드본");
    expect(vendorNameCore("아스트로캠프 토너 교체 요청")).toBe("아스트로캠프 토너");
  });
  it("이름 자체는 최대 세 낱말까지, 메모가 없으면 그대로", () => {
    expect(vendorNameCore("주식회사 더디자이너스디자인관광호텔신축공사 현장 사무실")).toBe("주식회사 더디자이너스디자인관광호텔신축공사 현장");
    expect(vendorNameCore("잡플러스")).toBe("잡플러스");
    expect(vendorNameCore("2001아울렛 분당점")).toBe("2001아울렛 분당점");
  });
});

import { vendorSearchName } from "../src/ids";
describe("검색어 이름(vendorSearchName)", () => {
  it("법인표기·숫자 메모·붙은 영문 꼬리를 뗀다", () => {
    expect(vendorSearchName("주식회사 티나고ew725.3.7부터 1년씩 계약연장 전 주식회사 정스타피온")).toBe("티나고");
    expect(vendorSearchName("넥스트라이프 본사")).toBe("넥스트라이프 본사");
    expect(vendorSearchName("윤스라이팅-개인번호로 연락 X")).toBe("윤스라이팅");
    expect(vendorSearchName("(주)이에이엔테크놀로지(8층)PS키트")).toBe("이에이엔테크놀로지");
  });
});
