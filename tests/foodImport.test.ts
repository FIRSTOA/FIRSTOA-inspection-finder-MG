/**
 * 네이버지도 저장목록 복사본 파서 — 2026-08-25 사용자가 실제로 복사해 준 88곳 샘플의 일부로 검증.
 */
import { describe, expect, it } from "vitest";
import { looksLikeNaverSavedList, parkingFromNote, parseNaverSavedList, stripCategory } from "../src/foodImport";

const SAMPLE = `1,b1,b2 식당가 주차1시간
고양진 생갈비 김치찌개찌개,전골
서울특별시 강남구 역삼동 825-20 1층 106, 107, 108호



b2 식당가
서울 송파구 법원로11길 11
서울특별시 송파구 법원로11길 11

가츠몽,주차자리 빡셈
가츠몽 교대점돈가스
서울특별시 서초구 서초동 1659-12 아치빌딩 1층


국밥집 주차가능
서울 강남구 논현로163길 13-4
서울특별시 강남구 신사동 569-12

은마상가 지하
서울 강남구 삼성로 212-2
서울특별시 강남구 대치동 316
메모은마상가 지하

주차장 10분에 천원
삼성힐주차장주차장
서울특별시 강남구 대치동 951-13

연타발 압구정본점곱창,막창,양
서울특별시 강남구 신사동 629-32

육온도육류,고기요리
서울특별시 광진구 자양동 52-2 육온도
메모점심 김치제육+된찌 8000

서울 강남구 도곡로 532
서울특별시 강남구 도곡로 532
`;

describe("네이버 저장목록 파서", () => {
  const rows = parseNaverSavedList(SAMPLE);
  const byName = (n: string) => rows.find((r) => r.name === n);

  it("항목 수 — 빈 줄 여러 개도 한 구분으로", () => {
    expect(rows.length).toBe(9);
  });
  it("가게명+업종 꼬리를 떼고, 앞 메모줄은 주차 정보로", () => {
    const r = byName("고양진 생갈비 김치찌개")!;
    expect(r.parking).toBe("가능");
    expect(r.parkingMemo).toBe("1,b1,b2 식당가 주차1시간");
    expect(r.address).toMatch(/^서울특별시 강남구 역삼동/);
  });
  it("'빡셈'은 불가, '10분에 천원'은 유료", () => {
    expect(byName("가츠몽 교대점")?.parking).toBe("불가");
    expect(byName("삼성힐주차장")?.parking).toBe("유료");
  });
  it("도로명 짧은 주소를 지오코딩용으로 고른다", () => {
    expect(byName("국밥집 주차가능")?.address ?? rows.find((r) => r.parkingMemo === "국밥집 주차가능")?.address).toBe("서울 강남구 논현로163길 13-4");
  });
  it("메모성 한 줄 + 주소만 있는 항목은 주소를 이름으로, 문구는 메모로", () => {
    const r = rows.find((r) => r.address === "서울 송파구 법원로11길 11")!;
    expect(r.name).toBe("송파구 법원로11길 11");
    expect(r.memo).toContain("b2 식당가");
  });
  it("'메모…' 줄은 메모에 붙는다", () => {
    expect(byName("육온도")?.memo).toBe("점심 김치제육+된찌 8000");
    expect(rows.find((r) => r.address === "서울 강남구 삼성로 212-2")?.memo).toContain("은마상가 지하");
  });
  it("주소만 있는 항목도 살린다", () => {
    expect(rows.find((r) => r.address === "서울 강남구 도곡로 532")?.name).toBe("강남구 도곡로 532");
  });
  it("업종 꼬리 사전", () => {
    expect(stripCategory("연타발 압구정본점곱창,막창,양")).toBe("연타발 압구정본점");
    expect(stripCategory("호돌이반점중식당")).toBe("호돌이반점");
    expect(stripCategory("현대타워주상복합")).toBe("현대타워주상복합");
    expect(parkingFromNote("제육쌈밥,김치찌개 2시간무료")).toBe("가능");
  });
  it("형식 판별", () => {
    expect(looksLikeNaverSavedList(SAMPLE)).toBe(true);
    expect(looksLikeNaverSavedList("삼겹살집 | 서울 강남구 테헤란로 152 | 지하 1시간")).toBe(false);
  });
});
