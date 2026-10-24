/**
 * 자동 일정 기본 팀 — 2026-10-24 "이민구(C팀)는 잘 되는데 다른 직원은 이상하다" 재발 방지.
 * 화면이 팀을 "C"로 고정해 열려, D팀 직원은 필수 스케줄이 비고 C팀 후보가 나오고 C팀으로 등록됐다.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUTHOR_BOOK } from "../src/authors";
import { defaultAutoScheduleTeam } from "../src/autoScheduleTeam";

const book = { ...AUTHOR_BOOK, E: ["CSS직원"] };

describe("defaultAutoScheduleTeam", () => {
  it("C팀 직원은 C (기존 동작 그대로)", () => {
    expect(defaultAutoScheduleTeam("이민구", book)).toBe("C");
  });
  it("C팀이 아닌 직원은 자기 팀 — C 로 고정되지 않는다", () => {
    expect(defaultAutoScheduleTeam("양승원", book)).toBe("D");
    expect(defaultAutoScheduleTeam("김정민", book)).toBe("A");
    expect(defaultAutoScheduleTeam("윤기준", book)).toBe("B");
    expect(defaultAutoScheduleTeam(" CSS직원 ", book)).toBe("E");
  });
  it("팀장·IT·명단에 없는 이름·빈 작성자는 예전처럼 C", () => {
    expect(defaultAutoScheduleTeam("신정훈", book)).toBe("C");
    expect(defaultAutoScheduleTeam("김광태", book)).toBe("C");
    expect(defaultAutoScheduleTeam("없는사람", book)).toBe("C");
    expect(defaultAutoScheduleTeam("", book)).toBe("C");
  });
  it("팀장 칸과 현장 팀 칸에 모두 있으면 현장 팀", () => {
    expect(defaultAutoScheduleTeam("겸직", { 팀장: ["겸직"], B: ["겸직"] })).toBe("B");
  });
});

describe("AutoSchedule 화면", () => {
  it("팀 상태를 \"C\" 고정값으로 시작하지 않는다", () => {
    const src = readFileSync(new URL("../src/AutoSchedule.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/useState\(\s*["']C["']\s*\)/);
    expect(src).toMatch(/defaultAutoScheduleTeam\(author/);
  });
});
