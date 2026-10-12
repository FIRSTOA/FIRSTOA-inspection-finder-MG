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
