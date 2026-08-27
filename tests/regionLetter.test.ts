import { describe, expect, it } from "vitest";
import { regionLetter } from "../src/region";

describe("regionLetter", () => {
  it("표기 변형을 글자로", () => {
    expect(regionLetter("수도권D")).toBe("D");
    expect(regionLetter("c")).toBe("C");
    expect(regionLetter("강서b")).toBe("B");
    expect(regionLetter("수도권C지역")).toBe("C");
    expect(regionLetter(" D ")).toBe("D");
  });
  it("경기권 지명은 D, 지방 표기는 E", () => {
    expect(regionLetter("경기 화성시")).toBe("D");
    expect(regionLetter("평택 포승읍")).toBe("D");
    expect(regionLetter("지방")).toBe("E");
    expect(regionLetter("충남 천안")).toBe("E");
  });
  it("서울 구 이름도 팀 글자로 — 양식에 '지역: 서울 강남구'로 쓰는 사람이 있어 전송이 막히면 안 된다", () => {
    expect(regionLetter("서울 강남구")).toBe("C");
    expect(regionLetter("노원구")).toBe("A");
    expect(regionLetter("영등포구 여의도")).toBe("B");
    expect(regionLetter("천안시 서북구")).toBe("E");
  });
  it("못 알아보면 fallback 글자, 없으면 빈칸 — 아무 값이나 E로 몰지 않는다", () => {
    expect(regionLetter("키맨/접수자: 010-1234-5678", "D")).toBe("D");
    expect(regionLetter("D450", "수도권C")).toBe("C");
    expect(regionLetter("수도권AB")).toBe("");
    expect(regionLetter("", "")).toBe("");
  });
});

// _dupKey는 "메시지에서 읽은 원래 값"으로 계산해야 한다 — 정규화 값으로 만들면 과거 업로드분과 키가 어긋나
// 재업로드·백필 때 같은 건이 전부 다시 들어온다(2026-08-26, D 점검방 백필 준비 중 발견).
describe("지역 정규화와 _dupKey 분리", () => {
  it("저장 지역은 글자로 바뀌지만 dupKey는 원문 표기를 따른다", async () => {
    const { buildRecords } = await import("../src/inspectParser");
    const form = (region: string) => [
      "구분: 점검", "등급: S", "업체명: 테스트상사", "부서명: 3층", `지역: ${region}`,
      "키맨/접수자: 홍길동 010-0000-0000", "모델명: SL-X3220NR", "시리얼넘버: ABC123",
      "자산기번: X0001", "내용: 정기점검", "처리내용: 기본점검",
    ].join("\n");
    const a = buildRecords(form("수도권C"), "2026-08-26", "이민구", "");
    const b = buildRecords(form("C"), "2026-08-26", "이민구", "");
    expect(a.inspect?.["지역"]).toBe("C");
    expect(b.inspect?.["지역"]).toBe("C");
    expect(a.inspect?._dupKey).not.toBe(b.inspect?._dupKey); // 원문 표기가 다르면 키도 다르다 = 키가 정규화에 흔들리지 않는다
    expect(a.region).toBe("C");
  });
});

// 키맨 변경 판정 — 주소·전화만 바뀐 건은 인사 대상이 아니다(2026-08-27)
describe("키맨 변경 판정", () => {
  it("사람이 바뀐 건만 인사 대상", async () => {
    const { isKeymanChange } = await import("../src/keyman");
    expect(isKeymanChange({ category: "키맨변경", reason: "담당자 퇴사" })).toBe(true);
    expect(isKeymanChange({ category: "담당자", reason: "" })).toBe(true);
    expect(isKeymanChange({ category: "소장 교체", reason: "" })).toBe(true);
    expect(isKeymanChange({ category: "주소변경", reason: "이전" })).toBe(false);
    expect(isKeymanChange({ category: "주소", reason: "담당자 퇴사" })).toBe(false); // 주소 건은 제외
    expect(isKeymanChange({ category: "전화번호", reason: "번호 변경" })).toBe(false);
  });
  it("같은 업체 판정은 지점 표기 차이를 흡수한다", async () => {
    const { sameVendor } = await import("../src/keyman");
    expect(sameVendor("주식회사 무암", "(주)무암")).toBe(true);
    expect(sameVendor("드림엔지니어링 삼성동현장", "드림엔지니어링")).toBe(true);
    expect(sameVendor("무암", "세안이엔씨")).toBe(false);
    expect(sameVendor("", "무암")).toBe(false);
  });
});

// "담당자삭제"처럼 새로 인사할 사람이 없는 건은 인사 대상이 아니다(2026-08-28 현장 지적)
describe("인사 대상 판정 — 삭제류 제외·새 담당자 필수", () => {
  it("삭제·해지·폐업 건은 사람 변경으로 보지 않는다", async () => {
    const { isPersonChange } = await import("../src/keyman");
    expect(isPersonChange("담당자삭제", "")).toBe(false);
    expect(isPersonChange("키맨", "중복 삭제")).toBe(false);
    expect(isPersonChange("담당자변경", "해지")).toBe(false);
    expect(isPersonChange("담당자변경", "퇴사")).toBe(true);
    expect(isPersonChange("키맨", "교체")).toBe(true);
  });
  it("변경후(새 담당자)가 없으면 인사를 요청하지 않는다", async () => {
    const { needsGreeting } = await import("../src/keyman");
    const base = { category: "담당자변경", reason: "퇴사", greeting_done: false };
    expect(needsGreeting({ ...base, after_text: "박영희 팀장 010-0000-0000" }, 5)).toBe(true);
    expect(needsGreeting({ ...base, after_text: "" }, 5)).toBe(false);          // 인사할 사람 미상
    expect(needsGreeting({ ...base, after_text: "박영희" }, 45)).toBe(false);    // 30일 지난 건은 완료 간주
    expect(needsGreeting({ ...base, after_text: "박영희", greeting_done: true }, 5)).toBe(false);
    expect(needsGreeting({ category: "담당자삭제", reason: "", after_text: "-", greeting_done: false }, 3)).toBe(false);
  });
});
