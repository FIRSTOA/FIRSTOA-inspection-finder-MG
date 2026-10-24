/**
 * 자동 일정 화면의 기본 팀 — 작성자(로그인한 사람)의 명단 팀.
 * 2026-10-24: 화면이 팀을 "C"로 고정해 열려, C팀이 아닌 직원은 ① 필수 스케줄이 비고(C팀 + 내 배정으로 조회)
 * 추천 후보가 C팀 워킨맵에서 나오며, 팀 칩을 바꾸지 않고 등록하면 일정이 C팀으로 들어갔다.
 * 명단(cs_members, useAuthorBook)에서 작성자를 찾아 A~E 면 그 팀, 아니면(팀장·IT·명단에 없음) 예전처럼 C.
 */
import { AUTHOR_TEAMS, type AuthorTeam } from "./authors";

export const AUTO_SCHEDULE_TEAMS = ["A", "B", "C", "D", "E"] as const;
export const AUTO_SCHEDULE_FALLBACK_TEAM = "C";

export function defaultAutoScheduleTeam(author: string, book: Partial<Record<AuthorTeam, string[]>>): string {
  const name = String(author || "").trim();
  if (!name) return AUTO_SCHEDULE_FALLBACK_TEAM;
  for (const team of AUTHOR_TEAMS) {
    if (!(book[team] || []).includes(name)) continue;
    if ((AUTO_SCHEDULE_TEAMS as readonly string[]).includes(team)) return team;
  }
  return AUTO_SCHEDULE_FALLBACK_TEAM;
}
