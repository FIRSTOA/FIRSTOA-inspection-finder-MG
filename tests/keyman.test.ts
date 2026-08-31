import { describe, expect, it } from "vitest";
import { matchesVendorRecord } from "../src/keyman";

/**
 * 실사고(2026-08-28): C지역 "넥스트라이프" 점검 카드에 B지역
 * "넥스트라이프 롯데시네마 인천검단관"의 주소수정 이력이 부분일치로 붙었다.
 * 규칙: 정확일치는 지역 무관 / 부분일치는 지역을 알 때 같은 지역만.
 */
describe("matchesVendorRecord — 지점 혼동 방지", () => {
  it("다른 지역의 비슷한 이름(지점)은 붙지 않는다 (실사고 사례)", () => {
    expect(matchesVendorRecord("넥스트라이프 롯데시네마 인천검단관", "B", "넥스트라이프", "C")).toBe(false);
  });
  it("같은 지역이면 지점 표기 차이는 흡수한다", () => {
    expect(matchesVendorRecord("넥스트라이프 롯데시네마 인천검단관", "C", "넥스트라이프", "C")).toBe(true);
  });
  it("정확일치는 지역이 달라도(오기 가능성) 붙는다", () => {
    expect(matchesVendorRecord("넥스트라이프", "B", "넥스트라이프", "C")).toBe(true);
  });
  it("법인 표기 차이는 정확일치로 흡수된다", () => {
    expect(matchesVendorRecord("(주)넥스트라이프", "B", "넥스트라이프", "C")).toBe(true);
  });
  it("지역을 모르면(통합이력) 부분일치도 보여준다 — 화면이 업체명·지역 라벨로 구분", () => {
    expect(matchesVendorRecord("넥스트라이프 롯데시네마 인천검단관", "B", "넥스트라이프", "")).toBe(true);
  });
  it("기록 쪽 지역이 비어 있으면 배제하지 않는다", () => {
    expect(matchesVendorRecord("넥스트라이프 강남점", "", "넥스트라이프", "C")).toBe(true);
  });
  it("짧은 이름의 우연한 포함은 원래부터 막혀 있다", () => {
    expect(matchesVendorRecord("한국", "C", "한국전자", "C")).toBe(false);
  });
});
