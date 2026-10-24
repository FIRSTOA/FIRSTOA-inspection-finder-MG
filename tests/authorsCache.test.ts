import { describe, expect, it } from "vitest";
import { MEMBERS_CACHE_MS, membersCacheFresh } from "../src/authors";

describe("명단 세션 캐시", () => {
  it("5분 안이면 유효, 지나거나 한 번도 안 받았거나 시계가 거꾸로면 무효", () => {
    expect(MEMBERS_CACHE_MS).toBe(300000);
    expect(membersCacheFresh(null, 1000)).toBe(false);
    expect(membersCacheFresh(1000, 1000 + 4 * 60000)).toBe(true);
    expect(membersCacheFresh(1000, 1000 + 5 * 60000)).toBe(false);
    expect(membersCacheFresh(9000, 1000)).toBe(false);
  });
});
