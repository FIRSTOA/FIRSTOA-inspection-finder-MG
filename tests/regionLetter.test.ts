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
