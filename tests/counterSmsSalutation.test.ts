import { describe, expect, it } from "vitest";
import { buildMessage, fillVendorPlaceholder, parseCompanyAndGrade, salutationName, vendorSalutation } from "../src/counterSmsParser";
import { DEFAULT_FORMATS, DEFAULT_TEMPLATES, mergeFormats, mergeTemplates } from "../src/counterSmsData";

describe("mergeTemplates — 지역 프로필 저장본과 기본값 병합", () => {
  const legacy = "안녕하세요 퍼스트 전산입니다.\n세금계산서 발행을 위해 사용량 확인을 위한 카운터 사진이 필요하여 연락드렸습니다.\n카운터 한장만 보내주시면 감사하겠습니다.";
  it("옛 기본 문구 그대로인 칸은 새 기본({업체명} 포함)으로 승격한다 — 자리표시자 이전에 시드된 DB 행", () => {
    const merged = mergeTemplates({ s_single_greeting: legacy, v_single_greeting: `${legacy}\n` });
    expect(merged.s_single_greeting).toBe(DEFAULT_TEMPLATES.s_single_greeting);
    expect(merged.v_single_greeting).toBe(DEFAULT_TEMPLATES.v_single_greeting);
  });
  it("팀이 손본 문구는 그대로 둔다", () => {
    const merged = mergeTemplates({ s_single_greeting: "{업체명} 담당자님, 퍼스트전산입니다." });
    expect(merged.s_single_greeting).toBe("{업체명} 담당자님, 퍼스트전산입니다.");
    expect(merged.s_single_closing).toBe(DEFAULT_TEMPLATES.s_single_closing);
  });
  it("기종 문구도 같은 규칙 — 옛 5473 문구는 승격, 다른 기종은 저장본 우선", () => {
    const merged = mergeFormats({ "5473": DEFAULT_FORMATS["5473"].replace("{업체명} 담당자님\n", ""), N500: "직접 쓴 안내" });
    expect(merged["5473"]).toBe(DEFAULT_FORMATS["5473"]);
    expect(merged.N500).toBe("직접 쓴 안내");
  });
});

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

describe("fillVendorPlaceholder — 인사말의 {업체명}", () => {
  it("자리표시자를 호칭용 업체명으로 바꾼다 (설정에서 위치·문구를 직접 고칠 수 있게)", () => {
    expect(fillVendorPlaceholder("{업체명} 담당자님\n안녕하세요", "N 주식회사 무암 (Mooam)-")).toBe("무암 담당자님\n안녕하세요");
    expect(fillVendorPlaceholder("안녕하세요 {업체명} 담당자님", "V 웰스매니지먼트 주식회사")).toBe("안녕하세요 웰스매니지먼트 담당자님");
  });
  it("이름이 하나도 안 남으면 '담당자님'만, 업체명을 모르면(옛 호출) 그 줄을 뺀다", () => {
    expect(fillVendorPlaceholder("{업체명} 담당자님\n안녕하세요", "주식회사")).toBe("담당자님\n안녕하세요");
    expect(fillVendorPlaceholder("{업체명} 담당자님\n안녕하세요")).toBe("안녕하세요");
  });
  it("자리표시자가 없으면 그대로 — 직접 지운 인사말에 다시 붙이지 않는다", () => {
    expect(fillVendorPlaceholder("안녕하세요 퍼스트 전산입니다.", "N 무암")).toBe("안녕하세요 퍼스트 전산입니다.");
  });
  it("손으로 친 변형도 받는다 — 띄어쓰기·전각 괄호·{업체}", () => {
    expect(fillVendorPlaceholder("{ 업체명 } 담당자님", "N 무암")).toBe("무암 담당자님");
    expect(fillVendorPlaceholder("｛업체명｝ 담당자님", "N 무암")).toBe("무암 담당자님");
    expect(fillVendorPlaceholder("{업체} 담당자님", "N 무암")).toBe("무암 담당자님");
  });
});

describe("buildMessage — 기본 인사말은 '{업체명} 담당자님'으로 시작한다", () => {
  it("단일 기기", () => {
    const msg = buildMessage(["M5526"], DEFAULT_FORMATS, DEFAULT_TEMPLATES, "s_group", "N 주식회사 무암 (Mooam)-");
    expect(msg.startsWith("무암 담당자님\n안녕하세요 퍼스트 전산입니다.")).toBe(true);
  });
  it("여러 기기", () => {
    const msg = buildMessage(["M5526", "C2263"], DEFAULT_FORMATS, DEFAULT_TEMPLATES, "v_group", "V 웰스매니지먼트 주식회사");
    expect(msg.startsWith("웰스매니지먼트 담당자님\n안녕하세요 퍼스트 전산입니다.")).toBe(true);
    expect(msg).toContain("총 2대");
  });
  it("완결형 문구 기종(5473)도 첫 줄이 호칭", () => {
    const msg = buildMessage(["5473"], DEFAULT_FORMATS, DEFAULT_TEMPLATES, "s_group", "S 대한상사");
    expect(msg.startsWith("대한상사 담당자님\n사용량확인차")).toBe(true);
  });
  it("업체명을 안 주면 호칭 줄 없이 인사말부터", () => {
    const msg = buildMessage(["M5526"], DEFAULT_FORMATS, DEFAULT_TEMPLATES, "s_group");
    expect(msg.startsWith("안녕하세요 퍼스트 전산입니다.")).toBe(true);
    expect(msg).not.toContain("{업체명}");
  });
  it("인사말에서 자리표시자를 지운 팀은 호칭이 붙지 않는다", () => {
    const templates = { ...DEFAULT_TEMPLATES, s_single_greeting: "안녕하세요 퍼스트 전산입니다." };
    const msg = buildMessage(["M5526"], DEFAULT_FORMATS, templates, "s_group", "N 무암");
    expect(msg.startsWith("안녕하세요 퍼스트 전산입니다.")).toBe(true);
  });
});
