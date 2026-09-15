import { describe, expect, it } from "vitest";
import { vendorMatchKey, vendorTokens, vendorTokensContained } from "../src/ids";

// 2026-09-16 태인회계법인 — 워킨맵 지명이 여러 칸을 이어 붙여 완전일치·부분포함 모두 빗나갔다
const PLACE = "7N태인회계법인 화성 분사무소기존 가정집강남구 / 전 대치동가정집단순마감마감";

describe("vendorTokens", () => {
  it("법인표기·괄호·접두 등급을 벗기고 낱말로", () => {
    expect(vendorTokens("태인회계법인 대치동 가정집")).toEqual(["태인회계법인", "대치동", "가정집"]);
    expect(vendorTokens("주식회사 태인")).toEqual(["태인"]);
    expect(vendorTokens("보림토건(주)신반포 22차 현장(사무실)")).toEqual(["보림토건", "신반포", "22차", "현장"]);
  });
});

describe("vendorTokensContained", () => {
  const key = vendorMatchKey(PLACE);
  it("점검기록 업체명의 낱말이 모두 워킨맵 키 안에 있으면 같은 곳", () => {
    expect(key.includes("태인회계법인")).toBe(true);
    expect(vendorTokensContained("태인회계법인 대치동 가정집", key)).toBe(true);
    expect(vendorTokensContained("태인회계법인", key)).toBe(true);
  });
  it("낱말이 하나라도 빠지면 다른 곳 — 다른 지점·현장이 섞이지 않게", () => {
    expect(vendorTokensContained("태인회계법인 수원 분사무소", key)).toBe(false);
    expect(vendorTokensContained("보림토건 수원현장", vendorMatchKey("22#V보림토건(주)신반포 22차 현장(사무실)매월마감"))).toBe(false);
  });
  it("낱말 합이 5자 미만이면 거절 — '태인'이 태인시설·태인주안지사까지 붙지 않게", () => {
    expect(vendorTokensContained("태인", key)).toBe(false);
    expect(vendorTokensContained("주식회사 태인", key)).toBe(false);
    expect(vendorTokensContained("", key)).toBe(false);
  });
});
