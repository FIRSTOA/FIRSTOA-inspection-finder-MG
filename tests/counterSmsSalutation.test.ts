import { describe, expect, it } from "vitest";
import { buildMessage, parseCompanyAndGrade, salutationName, vendorSalutation } from "../src/counterSmsParser";
import { DEFAULT_FORMATS, DEFAULT_TEMPLATES } from "../src/counterSmsData";

describe("salutationName — 문자 첫 줄 호칭용 업체명", () => {
  it("파서가 만든 '등급 업체명'에서 등급·주식회사·영문 괄호·꼬리를 뗀다", () => {
    expect(salutationName("N 웰스매니지먼트 주식회사")).toBe("웰스매니지먼트");
    expect(salutationName("N 주식회사 무암 (Mooam)-")).toBe("무암");
    expect(salutationName("V ㈜세안이엔씨")).toBe("세안이엔씨");
    expect(salutationName("SS 제이드자산운용")).toBe("제이드자산운용");
  });
  it("원문 첫 줄을 파서에 통과시킨 결과로도 같은 이름이 나온다", () => {
    expect(salutationName(parseCompanyAndGrade("16N웰스매니지먼트 주식회사-분기마감").vendor)).toBe("웰스매니지먼트");
    expect(salutationName(parseCompanyAndGrade("17, 17N주식회사 무암 (Mooam)-분기마감").vendor)).toBe("무암");
    expect(salutationName("22#V보림토건(주)신반포 22차 현장(사무실)매월마감")).toBe("보림토건 신반포 22차 현장(사무실)");
  });
  it("영문 상호는 등급으로 오해하지 않는다", () => {
    expect(salutationName("NH농협")).toBe("NH농협");
    expect(salutationName("3M코리아")).toBe("3M코리아");
  });
  it("호칭 — 이름이 남으면 '○○ 담당자님', 없으면 '담당자님'", () => {
    expect(vendorSalutation("N 주식회사 무암 (Mooam)-")).toBe("무암 담당자님");
    expect(vendorSalutation("주식회사")).toBe("담당자님");
  });
});

describe("buildMessage — 업체명이 있으면 인사말 앞에 호칭 한 줄", () => {
  it("단일 기기", () => {
    const msg = buildMessage(["M5526"], DEFAULT_FORMATS, DEFAULT_TEMPLATES, "s_group", "N 주식회사 무암 (Mooam)-");
    expect(msg.startsWith("무암 담당자님\n안녕하세요 퍼스트 전산입니다.")).toBe(true);
  });
  it("여러 기기", () => {
    const msg = buildMessage(["M5526", "C2263"], DEFAULT_FORMATS, DEFAULT_TEMPLATES, "v_group", "V 웰스매니지먼트 주식회사");
    expect(msg.startsWith("웰스매니지먼트 담당자님\n안녕하세요 퍼스트 전산입니다.")).toBe(true);
    expect(msg).toContain("총 2대");
  });
  it("완결형 문구 기종(사용량확인차…)도 호칭이 먼저", () => {
    const msg = buildMessage(["5473"], DEFAULT_FORMATS, DEFAULT_TEMPLATES, "s_group", "S 대한상사");
    expect(msg.startsWith("대한상사 담당자님\n사용량확인차")).toBe(true);
  });
  it("업체명을 안 주면 예전과 같이 인사말부터", () => {
    const msg = buildMessage(["M5526"], DEFAULT_FORMATS, DEFAULT_TEMPLATES, "s_group");
    expect(msg.startsWith("안녕하세요 퍼스트 전산입니다.")).toBe(true);
  });
});
