/**
 * "오늘"을 UTC 로 만들지 않기(2026-10-31). new Date().toISOString().slice(0, 10) 은
 * KST 00~09시에 전날이 된다 — 오늘은 visits.ts kstDate() 를 쓴다.
 * (날짜 더하기·빼기처럼 이미 날짜 문자열에서 출발하는 toISOString 은 해당 없음)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { kstDate } from "../src/visits";

const SRC = resolve(__dirname, "../src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
});

describe("UTC 오늘 금지", () => {
  it("src 어디에도 new Date().toISOString().slice(0, 10) 이 없다", () => {
    const bad = files(SRC).filter((f) => /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
  it("kstDate 는 UTC 15시 이후를 다음 날로 본다", () => {
    expect(kstDate(new Date("2026-10-31T15:30:00Z"))).toBe("2026-11-01");
    expect(kstDate(new Date("2026-10-31T14:59:00Z"))).toBe("2026-10-31");
  });
});
