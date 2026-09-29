import { describe, expect, it } from "vitest";
import { addressCore, mapQuery, tidyAddress } from "../src/address";

describe("현장 주소 → 지도 검색어", () => {
  it("층·건물·메모 꼬리를 떼고 '로N길 번호'를 끊지 않는다(윔의원 실사고)", () => {
    const raw = "서울 서초구 서초대로 77길 17 제 지하1층 (블럭77 빌딩) (엘베 유) ㄴ주소 특이사항 :   탑차 주차 불가능";
    expect(addressCore(raw)).toBe("서울 서초구 서초대로77길 17");
  });
  it("도로명 붙여쓰기·번지·번길", () => {
    expect(addressCore("서울 강남구 논현로26길 42-11 2층 (도곡동 457-11)")).toBe("서울 강남구 논현로26길 42-11");
    expect(addressCore("빅오션이엔엠 강남구 강남대로128길73 지하1층 덕양빌딩")).toBe("빅오션이엔엠 강남구 강남대로128길 73");
    expect(addressCore("경기 고양시 일산동구 중앙로 1275번길 38-10 3층")).toBe("경기 고양시 일산동구 중앙로1275번길 38-10");
    expect(addressCore("서울 서초구 서초대로 77")).toBe("서울 서초구 서초대로 77");
  });
  it("지번 주소는 동·번지까지", () => {
    expect(addressCore("서울 강남구 역삼동 837-11 유니온센터 1707호")).toBe("서울 강남구 역삼동 837-11");
    expect(tidyAddress("서울시 중랑구 신내동800")).toBe("서울 중랑구 신내동 800");
  });
  it("주소가 없으면 대체값", () => {
    expect(mapQuery("", "윔의원")).toBe("윔의원");
    expect(mapQuery(undefined, "윔의원")).toBe("윔의원");
  });
});
