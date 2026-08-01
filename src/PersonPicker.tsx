import { useMemo, useState } from "react";
import { AUTHOR_TEAMS, displayTitle, useAuthorBook, useMembers } from "./authors";
import { teamTargetLabel } from "./audience";
import PortalSelect from "./PortalSelect";

/**
 * 직원 선택 공용 픽커 — 부서·팀을 고르면 이름이 칩으로 바로 나온다 (클릭 1번).
 * (공지 대상·부서요청 대상·칭찬 받는 사람 공용) 겸임(A·B)은 어느 팀을 골라도 나온다.
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

  const people = useMemo(() => {
    const active = members.filter((m) => m.active && m.name !== exclude && m.dept === dept
      && (team === "전체" || m.team === team || m.team.split("·").includes(team)));
    if (active.length) return active.map((m) => ({ name: m.name, hint: displayTitle(m) }));
    return AUTHOR_TEAMS.flatMap((authorTeam) => (book[authorTeam] || []).filter((name) => name !== exclude).map((name) => ({ name, hint: `${authorTeam}팀` })));
  }, [members, book, exclude, dept, team]);

  return (
    <div className="w-full space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {depts.length > 0 && <PortalSelect width={125} value={dept} onChange={(next) => { setDept(next); setTeam("전체"); onChange(""); }}
          options={depts.map((name) => ({ value: name, label: name }))} />}
        {teams.length > 0 && <PortalSelect width={110} value={team} onChange={(next) => { setTeam(next); onChange(""); }}
          options={[{ value: "전체", label: "팀 전체" }, ...teams.map((name) => ({ value: name, label: teamTargetLabel(name) }))]} />}
      </div>
      <div className="flex flex-wrap gap-1">
        {people.map((person) => (
          <button key={person.name} type="button" title={person.hint} onClick={() => onChange(person.name)}
            className={`rounded-full px-2.5 py-1.5 text-xs font-black transition ${value === person.name ? "bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)]" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{person.name}</button>
        ))}
        {!people.length && <span className="py-1 text-[11px] font-bold text-slate-400">해당 팀에 선택할 인원이 없어요</span>}
      </div>
    </div>
  );
}
