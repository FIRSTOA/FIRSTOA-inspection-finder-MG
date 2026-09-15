import { describe, expect, it } from "vitest";
import { parseManualSchedules, parseVendorLine } from "../src/manualSchedule";

const SAMPLE = `1.마감/한공
16N웰스매니지먼트 주식회사-분기마감
010-9707-9066 허경무 매니저님(총괄)
23093 / ECOSYS-M5526CDN / VUV0511991 / C1916
서울 강남구 역삼동 832-7 황화빌딩 1301호 ㄴ엘베유무 : 유
첫 분기마감

2.마감/한공
17, 17N주식회사 무암 (Mooam)-분기마감
010-4481-6440 현해리대표님
21462 / SL-X3220NR / 0A6XBJMM90004HK / B7185
서울 강남구 삼성로100길 8 202호
분기마감`;

describe("parseManualSchedules", () => {
  it("번호 블록 2개를 일정 2건으로 — 업체·연락처·기기·주소·메모가 각 칸에", () => {
    const [a, b] = parseManualSchedules(SAMPLE);
    expect(parseManualSchedules(SAMPLE)).toHaveLength(2);

    expect(a.kind).toBe("마감");
    expect(a.hantin).toBe("한공");
    expect(a.grade).toBe("N");
    expect(a.vendor).toBe("웰스매니지먼트 주식회사");
    expect(a.title).toBe("분기마감");
    expect(a.phone).toBe("010-9707-9066");
    expect(a.keyman).toBe("010-9707-9066 허경무 매니저님(총괄)");
    expect(a.leaseNo).toBe("23093");
    expect(a.model).toBe("ECOSYS-M5526CDN");
    expect(a.serial).toBe("VUV0511991");
    expect(a.asset).toBe("C1916");
    expect(a.address).toBe("서울 강남구 역삼동 832-7 황화빌딩 1301호");
    expect(a.addressNote).toBe("엘베유무 : 유");
    expect(a.memo).toBe("첫 분기마감");

    expect(b.vendor).toBe("주식회사 무암 (Mooam)");
    expect(b.grade).toBe("N");
    expect(b.phone).toBe("010-4481-6440");
    expect(b.model).toBe("SL-X3220NR");
    expect(b.serial).toBe("0A6XBJMM90004HK");
    expect(b.asset).toBe("B7185");
    expect(b.address).toBe("서울 강남구 삼성로100길 8 202호");
    expect(b.addressNote).toBe("");
    expect(b.memo).toBe("분기마감");
  });

  it("번호 없이 붙여 넣어도 한 건으로 — 기기 줄이 없어도 된다", () => {
    const [e] = parseManualSchedules("보림토건 청계현장\n010-1111-2222 김과장님\n서울 중구 청계천로 100\n여분 전달");
    expect(e.vendor).toBe("보림토건 청계현장");
    expect(e.kind).toBe("");
    expect(e.phone).toBe("010-1111-2222");
    expect(e.address).toBe("서울 중구 청계천로 100");
    expect(e.model).toBe("");
    expect(e.memo).toBe("여분 전달");
  });

  it("업체명을 못 읽은 블록은 버리고, 빈 입력은 빈 배열", () => {
    expect(parseManualSchedules("")).toEqual([]);
    expect(parseManualSchedules("   \n\n")).toEqual([]);
  });
});

describe("parseVendorLine", () => {
  it("순번·등급 접두와 일정 꼬리를 뗀다", () => {
    expect(parseVendorLine("16N웰스매니지먼트 주식회사-분기마감")).toEqual({ grade: "N", vendor: "웰스매니지먼트 주식회사", title: "분기마감" });
    expect(parseVendorLine("22#V보림토건(주)신반포 22차 현장(사무실)매월마감")).toEqual({ grade: "V", vendor: "보림토건(주)신반포 22차 현장(사무실)", title: "매월마감" });
    expect(parseVendorLine("30SS제이드자산운용")).toEqual({ grade: "SS", vendor: "제이드자산운용", title: "" });
  });
  it("등급 글자로 시작하는 영문 상호는 건드리지 않는다", () => {
    expect(parseVendorLine("NH농협 강남점")).toEqual({ grade: "", vendor: "NH농협 강남점", title: "" });
    expect(parseVendorLine("3M코리아")).toEqual({ grade: "", vendor: "3M코리아", title: "" });
  });
});
