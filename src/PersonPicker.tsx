import { useMemo, useState } from "react";
import { AUTHOR_TEAMS, displayTitle, useAuthorBook, useMembers } from "./authors";
import { teamTargetLabel } from "./audience";
import PortalSelect from "./PortalSelect";

/**
 * 직원 선택 공용 픽커 — 부서 → 팀 → 이름으로 좁혀간다.
 * 52명을 한 목록으로 스크롤하지 않게. (공지 대상·부서요청 대상·칭찬 받는 사람 공용)
 * 겸임(A·B)은 어느 팀을 골라도 나온다. 인원 DB가 비면 CS 명단 폴백.
 */
export default function PersonPicker({ value, onChange, exclude = "" }: {
  value: string;
  onChange: (name: string) => void;
  exclude?: string;
}) {
  const members = useMembers();
  const { book } = useAuthorBook();
  const [dept, setDept] = useState("CS팀");
  const [team, setTeam] = useState("전체");

  const depts = useMemo(() => {
    const order = ["임원", "CS팀", "영업팀", "CSS·운영지원"];
    const set = new Set(members.filter((m) => m.active).map((m) => m.dept).filter(Boolean));
    return [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [members]);

  const teams = useMemo(() => {
    const set = new Set(members.filter((m) => m.active && m.dept === dept && m.team && !m.team.includes("·")).map((m) => m.team));
    return [...set].sort();
  }, [members, dept]);

  const names = useMemo(() => {
    const active = members.filter((m) => m.active && m.name !== exclude && m.dept === dept
      && (team === "전체" || m.team === team || m.team.split("·").includes(team)));
    if (active.length) return active.map((m) => ({ value: m.name, label: m.name, group: m.team || undefined, hint: displayTitle(m) }));
    return AUTHOR_TEAMS.flatMap((authorTeam) => (book[authorTeam] || []).filter((name) => name !== exclude).map((name) => ({ value: name, label: name, group: `${authorTeam}팀` })));
  }, [members, book, exclude, dept, team]);

  return (
    <>
      {depts.length > 0 && <PortalSelect width={125} value={dept} onChange={(next) => { setDept(next); setTeam("전체"); onChange(""); }}
        options={depts.map((name) => ({ value: name, label: name }))} />}
      {teams.length > 0 && <PortalSelect width={110} value={team} onChange={(next) => { setTeam(next); onChange(""); }}
        options={[{ value: "전체", label: "팀 전체" }, ...teams.map((name) => ({ value: name, label: teamTargetLabel(name) }))]} />}
      <PortalSelect width={140} value={value} onChange={onChange} placeholder="직원 선택" options={names} />
    </>
  );
}
