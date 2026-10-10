import { describe, expect, it } from "vitest";
import { parseListHeader, splitBlocks } from "../src/counterSmsParser";

// 관리부가 마감방에 올리는 실제 목록 머리글 — 【수도권C】 + "26-10" (2026-10-10 사용자 예시)
const SAMPLE = `【수도권C】
26-10

[강남구]
30, 30S주식회사 더디자이너스디자인관광호텔신축공사 현장매월마감
010-2401-5104 성지은 과장(결제/계약) 010-7589-4000 강병규 기사(현장)
23013 / DOCUCENTRE-V C2263(마블) / 705790 / B6945
서울 강남구 역삼동 718-26 2층 현장사무실(엘베 없음, 계단)

5, 5N현대회계법인-매월마감
010-9373-1309 최미자
17473 / CLX-9201NA / Z8D9B1AF200014N / 미부착
서울 강남구 역삼로542 5층(대치동, 신사에스앤지빌딩)


[광진구]
31, 31V(주)잡플러스4층백업/합산분기마감
장경우 010-8618-8101(총괄)
21638 / SL-X7400LXR / ZPBLBJST8000GQV / A5571
서울 광진구 천호대로 537, 15층
~
미수 2개월, 2,096,700원
`;

describe("parseListHeader — 관리부 마감 목록 머리글", () => {
  it("【수도권C】·26-10 → C팀, 2026-10, '10월 마감'", () => {
    expect(parseListHeader(SAMPLE)).toEqual({ team: "C", ym: "2026-10", monthLabel: "10월 마감" });
  });
  it("【CSS】·【지방】은 E팀, 네 자리 연도도 받는다", () => {
    expect(parseListHeader("【CSS】\n2026-11\n\n1, 1N어딘가").team).toBe("E");
    expect(parseListHeader("【지방】\n2026.1\n").ym).toBe("2026-01");
  });
  it("머리글이 없으면 둘 다 undefined — 기기 줄(23013 / …)이나 전화번호를 달로 오인하지 않는다", () => {
    const noHead = SAMPLE.split("\n").slice(3).join("\n");
    expect(parseListHeader(noHead)).toEqual({ team: undefined, ym: undefined, monthLabel: undefined });
  });
  it("머리글·[구역] 줄이 있어도 업체 블록 수는 그대로", () => {
    expect(splitBlocks(SAMPLE)).toHaveLength(3);
  });
});
