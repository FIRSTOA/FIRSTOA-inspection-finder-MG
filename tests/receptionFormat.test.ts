/**
 * 접수 양식 표기 회귀 테스트 — 실제로 카톡방에 잘못 나갔던 값들.
 */
import { describe, expect, it } from "vitest";
import { fmtDot, fmtWon, fromExcelSerial } from "../src/ServiceReception";

describe("금액 표기", () => {
  it("소수점을 지우면 9만7천원이 97억이 된다 — 반올림해야 한다", () => {
    // 임대리스트 연평균은 나눗셈 결과("97666.66667"). 예전엔 ₩9,766,666,667로 나갔다.
    expect(fmtWon("97666.66667")).toBe("₩97,667");
    expect(fmtWon("100000")).toBe("₩100,000");
    expect(fmtWon("₩1,200,000")).toBe("₩1,200,000");
  });
  it("숫자가 아니면 원문을 지킨다", () => {
    expect(fmtWon("확인요망")).toBe("확인요망");
    expect(fmtWon("")).toBe("");
  });
});

describe("엑셀 시리얼 날짜", () => {
  it("45992는 2025-12-01 (그 업체 계약일과 같다)", () => {
    expect(fromExcelSerial("45992")).toBe("2025-12-01");
    expect(fmtDot("45992")).toBe("2025. 12. 1");
  });
  it("날짜가 아닌 숫자는 건드리지 않는다", () => {
    expect(fromExcelSerial("19233")).toBe("");   // 임대리스트 순번
    expect(fromExcelSerial("100000")).toBe("");  // 금액
    expect(fromExcelSerial("3")).toBe("");       // 방문주기
  });
  it("이미 날짜 표기면 그대로 정리한다", () => {
    expect(fmtDot("2025-12-01")).toBe("2025. 12. 1");
    expect(fmtDot("")).toBe("");
  });
});
