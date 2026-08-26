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
