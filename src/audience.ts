import { AUTHOR_TEAMS, type MemberRow } from "./authors";

/**
 * 공지·요청의 "누구에게" 공통 로직 — 인원 DB(cs_members) 전사 명단 기준.
 *
 * 팀 대상의 target 값 규칙 (기존 데이터와 호환):
 *  - CS A~D는 예전 그대로 한 글자("A"~"D")
 *  - 부서 전체는 부서명("영업팀", "CSS·운영지원", …)
 *  - 타부서 팀/파트는 팀명 그대로("IT", "경영지원", …)
 * 수신 판정은 내 부서명·팀명(겸임 A·B는 쪼개서)과 target의 일치로 본다.
 */
export type TargetRow = { target_type?: string; target?: string };

const DEPT_ORDER = ["임원", "CS팀", "영업팀", "CSS·운영지원"];

/** "팀" 대상 선택지: 부서 전체 + 부서 내 팀/파트 (팀장·겸임 값은 선택지에서 제외) */
export function teamTargetOptions(members: MemberRow[]): Array<{ value: string; label: string; group?: string }> {
  const active = members.filter((member) => member.active);
  if (!active.length) {
    // 인원 DB를 못 읽으면 CS 팀만이라도 (예전 동작)
    return AUTHOR_TEAMS.filter((team) => team !== "팀장").map((team) => ({ value: team, label: `${team}팀` }));
  }
  const depts = [...new Set(active.map((member) => member.dept).filter(Boolean))]
    .sort((a, b) => DEPT_ORDER.indexOf(a) - DEPT_ORDER.indexOf(b));
  const options: Array<{ value: string; label: string; group?: string }> = [];
  for (const dept of depts) options.push({ value: dept, label: `${dept} 전체`, group: "부서 전체" });
  for (const dept of depts) {
    const teams = [...new Set(active
      .filter((member) => member.dept === dept && member.team && member.team !== "팀장" && !member.team.includes("·"))
      .map((member) => member.team))].sort();
    for (const team of teams) options.push({ value: team, label: teamTargetLabel(team), group: dept });
  }
  return options;
}

/** 배지·칩에 보여줄 팀 대상 이름 — CS 한 글자 값만 "○팀"으로 */
export function teamTargetLabel(target: string): string {
  return /^[A-Za-z]$/.test(target) ? `${target}팀` : target;
}

/** author(이름) 기준 수신 판정 함수 — 인원 DB 우선, 없으면 CS 명단 폴백 */
export function makeIsForMe(author: string, members: MemberRow[], book: Record<string, readonly string[]>) {
  const me = members.find((member) => member.active && member.name === author);
  const keys = new Set<string>();
  if (me) {
    if (me.dept) keys.add(me.dept);
    if (me.team) { keys.add(me.team); me.team.split("·").forEach((part) => part && keys.add(part)); }
  } else if (author) {
    const team = AUTHOR_TEAMS.find((name) => book[name]?.includes(author));
    if (team) { keys.add(team); keys.add("CS팀"); }
  }
  return (row: TargetRow): boolean => {
    const type = row.target_type || "전체";
    if (type === "전체") return true;
    if (type === "팀") return !!row.target && keys.has(row.target);
    return !!author && row.target === author;
  };
}

/** 대상에 속하는 재직자 이름들 (공지 읽음 분모) */
export function audienceNames(row: TargetRow, members: MemberRow[], book: Record<string, readonly string[]>): string[] {
  if (row.target_type === "개인") return row.target ? [row.target] : [];
  const active = members.filter((member) => member.active);
  if (!active.length) {
    if (row.target_type === "팀") return [...(book[row.target || ""] || [])];
    return AUTHOR_TEAMS.flatMap((team) => book[team] || []);
  }
  if (row.target_type === "팀") {
    const target = row.target || "";
    return active
      .filter((member) => member.dept === target || member.team === target || member.team.split("·").includes(target))
      .map((member) => member.name);
  }
  return active.map((member) => member.name);
}

/** 내 소속 표시용 짧은 라벨: "CS팀 C팀" / "영업팀 IT" / "임원" */
export function myGroupLabel(author: string, members: MemberRow[]): string {
  const me = members.find((member) => member.active && member.name === author);
  if (!me) return "";
  const team = me.team && me.team !== "팀장" ? teamTargetLabel(me.team) : "";
  return [me.dept, team].filter(Boolean).join(" ");
}
