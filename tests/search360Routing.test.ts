import { describe, expect, it } from "vitest";
import { entityTokensFromQuestion, isStrongCandidate } from "../src/entity360";

describe("통합검색 질문 라우팅 — 확실한 업체만 '업체에 질문'으로 (2026-10-10 나인핏 오탐)", () => {
  it("'출근시간 9시~10시 사이인 곳들 어디야' 에서는 업체 후보 낱말이 안 나온다", () => {
    expect(entityTokensFromQuestion("출근시간 9시~10시 사이인곳들 어디야")).toEqual([]);
    expect(entityTokensFromQuestion("점심시간 1시 넘는 곳 리스트 줘")).toEqual([]);
  });
  it("업체명이 들어 있으면 그 낱말은 남는다", () => {
    expect(entityTokensFromQuestion("나인핏 출근시간 몇 시야")).toContain("나인핏");
    expect(entityTokensFromQuestion("잡플러스 AS 몇 번 터졌어")).toContain("잡플러스");
  });
  it("별칭 부분 일치('업체명 유사')는 확실한 후보가 아니고, 이름 포함은 3글자 이상일 때만", () => {
    expect(isStrongCandidate({ how: "업체명 유사" }, "출근시간")).toBe(false);
    expect(isStrongCandidate({ how: "업체명 포함" }, "시간")).toBe(false);
    expect(isStrongCandidate({ how: "업체명 포함" }, "잡플러스")).toBe(true);
    expect(isStrongCandidate({ how: "업체명 일치" }, "무암")).toBe(true);
    expect(isStrongCandidate({ how: "기번·자산번호 일치" }, "A5571")).toBe(true);
    expect(isStrongCandidate({ how: "임대리스트 기기 번호 일치" }, "ZPBLBJST8000GQV")).toBe(true);
  });
});
