import { describe, expect, it } from "vitest";
import { buildCounterCaption, cleanVendorName, infoFromRaw, pickCounterRoom } from "../src/counterSmsPhoto";
import { detectAddress, findVendorBlocks, parseDeviceLine } from "../src/counterSmsParser";

// 2026-10-10 관리부 목록 원문 그대로(일반 목록: 임대리스트 순번 / 기종 / 시리얼 / 자산기번)
const RAW = `【수도권C】
26-10

[강남구]
5, 5N현대회계법인-매월마감
010-9373-1309 최미자
17473 / CLX-9201NA / Z8D9B1AF200014N / 미부착
서울 강남구 역삼로542 5층(대치동, 신사에스앤지빌딩)

6, 6V주식회사 웰스어드바이저스강남 / 3층 경리부 (증폭기 1개 회수)웰스어+메디치+주암대토+웰스평택 합산분기마감
010-4401-8018 김준영과장
21250 / MFC-L5700DN / E75671H2N92377 / X7230
서울 강남구 도산대로63길 15, 3층, 대표님실(청담동, 웰스어드바이저스빌딩) > 엘베 있음
9일고정/분기마감/매월사용매수기록


[성동구]
6, 6N금호4가역세권재개발추진준비위원회-매월마감
010-3969-9218 김재수 부사장
23146 / SL-X3220NR / 0A6XBJMT90007HV / B8759
서울 성동구 금호동4가 137 3층 302호(엘베없음, 계단)
`;
// CMS 목록: 임대리스트 순번이 없다 — "기종 / 시리얼 / 자산기번"
const CMS_RAW = `[수도권C]
27, 27SS주식회사 자연인-분기마감
김규태팀장님 010-2323-8920 / 02-6917-7310 (점검시 이쪽으로)
SL-X3220NR / 0A6XBJLW900019N / C3636
서울 강남구 언주로 133길 21 아이소이 빌딩 (본관 4층 / 별관 3,4층) 전부 엘베 유
CMS.30

27, 27SS주식회사 자연인-분기마감
김규태팀장님 010-2323-8920 / 02-6917-7310 (점검시 이쪽으로)
SL-X3220NR / 0A6XBJPW400034H / X9378
서울 강남구 언주로 133길 21 아이소이 빌딩 (본관 4층 / 별관 3,4층) 전부 엘베 유
CMS.30

29, 29S(주)더채움자산운용-분기마감
010-9147-2900 최연수 대표
SL-X7600LXR / ZPBJBJST90000QM / 미부착
서울 강남구 선릉로100길26, 3층(엘베O)
CMS.30
`;

describe("관리부 목록 기기 줄·주소 읽기", () => {
  it("일반 목록: 순번 / 기종 / 시리얼 / 자산기번 — 전화 줄의 '/'는 기기 줄로 안 본다", () => {
    const [block] = findVendorBlocks(RAW, "N 현대회계법인-");
    expect(parseDeviceLine(block)).toEqual({ leaseCode: "17473", model: "CLX-9201NA", serial: "Z8D9B1AF200014N", asset: "미부착" });
    expect(detectAddress(block)).toBe("서울 강남구 역삼로542 5층(대치동, 신사에스앤지빌딩)");
    const [wells] = findVendorBlocks(RAW, "V 주식회사 웰스어드바이저스강남");
    expect(parseDeviceLine(wells)).toEqual({ leaseCode: "21250", model: "MFC-L5700DN", serial: "E75671H2N92377", asset: "X7230" });
  });
  it("CMS 목록: 순번 없이 기종 / 시리얼 / 자산기번 — 같은 업체 블록이 여럿이면 다 모은다", () => {
    const blocks = findVendorBlocks(CMS_RAW, "SS 주식회사 자연인");
    expect(blocks).toHaveLength(2);
    expect(parseDeviceLine(blocks[0])).toEqual({ leaseCode: "", model: "SL-X3220NR", serial: "0A6XBJLW900019N", asset: "C3636" });
    const info = infoFromRaw({ id: "x", vendor: "SS 주식회사 자연인-", team: "C", machines: [], list_kind: "CMS" }, [CMS_RAW]);
    expect(info).toEqual({ model: "SL-X3220NR", serial: "0A6XBJLW900019N, 0A6XBJPW400034H", asset: "C3636, X9378", address: "서울 강남구 언주로 133길 21 아이소이 빌딩 (본관 4층 / 별관 3,4층) 전부 엘베 유", leaseCode: "" });
  });
  it("임대 코드나 시리얼이 있으면 이름이 달라도 그 블록을 찾는다", () => {
    expect(findVendorBlocks(RAW, "다른이름", "23146")).toHaveLength(1);
    expect(findVendorBlocks(RAW, "다른이름", "", "E75671H2N92377")[0]).toContain("웰스어드바이저스");
    expect(findVendorBlocks(RAW, "없는업체")).toHaveLength(0);
  });
});

describe("마감 카운터 사진 — 글 만들기(2026-10-10 사용자 요청 형식)", () => {
  const target = { id: "csb-1-003", vendor: "N 현대회계법인-", team: "C", machines: ["X-9201"], list_kind: "", cms_day: null, batch_id: "csb-1" };
  it("업체명 줄 따로, 기종·시리얼넘버·자산기번·주소는 빈 값이어도 줄을 남긴다. 등급 접두와 꼬리 '-'는 뗀다", () => {
    const info = infoFromRaw(target, [RAW]);
    const text = buildCounterCaption(target, { author: "이민구", info, now: new Date("2026-10-10T08:34:00Z") });
    expect(text.split("\n")).toEqual([
      "[마감 카운터]",
      "현대회계법인",
      "기종: CLX-9201NA",
      "시리얼넘버: Z8D9B1AF200014N",
      "자산기번: 미부착",
      "주소: 서울 강남구 역삼로542 5층(대치동, 신사에스앤지빌딩)",
      "전송: 이민구 · 2026-10-10 17:34 · C팀",
      "카운터 사진 첨부",
    ]);
  });
  it("원문이 없으면 카드의 기종·식별값으로 채우고 모르는 건 빈 줄, 봇 경로는 사진 링크 줄, CMS 는 결제일 표시", () => {
    const text = buildCounterCaption({ ...target, serials: ["ZPBLBJST8000GQV"], assets: ["A5571"], list_kind: "CMS", cms_day: 15 }, { author: "", info: {}, now: new Date("2026-10-10T06:30:00Z"), withLink: "https://x/y.jpg" });
    expect(text.split("\n")).toEqual([
      "[마감 카운터]",
      "현대회계법인 (CMS 15일)",
      "기종: X-9201",
      "시리얼넘버: ZPBLBJST8000GQV",
      "자산기번: A5571",
      "주소: ",
      "전송: 미지정 · 2026-10-10 15:30 · C팀",
      "사진: https://x/y.jpg",
    ]);
  });
  it("이름 정리 — 등급 접두와 꼬리 기호 제거", () => {
    expect(cleanVendorName("N 현대회계법인-")).toBe("현대회계법인");
    expect(cleanVendorName("V (주)잡플러스4층백업")).toBe("(주)잡플러스4층백업");
    expect(cleanVendorName("SS 주식회사 자연인 / ")).toBe("주식회사 자연인");
  });
});

describe("마감 카운터 사진 — 방 고르기(관리 탭 카톡방 매핑 '마감')", () => {
  it("팀 방이 있으면 팀 방, 없으면 * 공통, 둘 다 없으면 빈 값", () => {
    const map = { "마감|*": "마감방", "마감|C": "수도권C 마감", "AS|C": "C AS방" };
    expect(pickCounterRoom(map, "C")).toBe("수도권C 마감");
    expect(pickCounterRoom(map, "c")).toBe("수도권C 마감");
    expect(pickCounterRoom(map, "A")).toBe("마감방");
    expect(pickCounterRoom({ "AS|C": "C AS방" }, "C")).toBe("");
  });
});
