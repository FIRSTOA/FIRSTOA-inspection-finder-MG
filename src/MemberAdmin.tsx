import { Fragment, useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { Pencil, Search, UserPlus, UserRound, Undo2 } from "lucide-react";
import { AUTHOR_TEAMS, CS_DEPT, addMember, deleteMember, displayTitle, fetchMembers, renameDeptGroup, renameTeamGroup, restoreMember, saveTeamGroups, teamLabel as csTeamLabel, updateMember, useTeamGroups, type MemberRow } from "./authors";
import FormModal from "./FormModal";
import PortalSelect from "./PortalSelect";

/**
 * 인원 관리 — 회사 전체 명단을 ERP식 한 표로.
 *
 * [다크 툴바: 검색 + 부서 필터] 아래 테이블. 전체 보기에선 부서 구분행 → 팀 구분행의
 * 2단으로 나뉘고, 부서를 고르면 팀 구분행만 남는다 (CS팀 A/B/C/D가 바로 나뉘어 보이게).
 * CS팀의 팀장/A~D 값은 작성자 명단·일정 팀 필터가 그대로 쓰므로 바꾸면 즉시 반영된다.
 * 2026-09-20: 입사일·근속·퇴사 처리 대신 '수정일'과 '삭제'로 관리한다(사용자 결정). 삭제해도 과거 기록의 이름은 문자열로 남는다.
 * 예전 퇴사 처리로 남은 행이 있으면 아래 '퇴사자' 묶음에서 복구하거나 삭제한다.
 */
// 부서·팀 목록은 공용 등록부(app_config TEAM_GROUPS, authors.ts)에서 온다 — 사용자 선택 창에서 만든 그룹·소그룹이 여기도 그대로 보인다(2026-09-18)
const TITLES = ["", "팀장", "파트장", "부파트장"];
const TITLE_RANK: Record<string, number> = { 팀장: 0, 파트장: 1, 부파트장: 2 };
const TITLE_TONE: Record<string, string> = {
  팀장: "bg-blue-50 text-blue-700", 파트장: "bg-violet-50 text-violet-700", 부파트장: "bg-emerald-50 text-emerald-700",
  임원: "bg-amber-50 text-amber-700", 프로: "bg-slate-100 text-slate-500",
};

/** 리더 판정: 팀장·겸임(A·B)·팀 없는 직책자 — 팀 구분행보다 위에 따로 묶는다 */
function isLeaderRow(row: MemberRow) {
  if (row.dept === "임원") return true;
  return row.team === "팀장" || row.team.includes("·") || (!row.team && !!row.title);
}

function teamLabel(dept: string, team: string) {
  if (!team) return "팀 미지정";
  return dept === CS_DEPT && team.length === 1 ? csTeamLabel(team) : team; // CS 글자는 등록부 표시명(E → CSS팀)
}

/** 수정일 표기 — updated_at이 없으면 입사일(초기 시드) */
function modifiedLabel(row: MemberRow): string {
  const iso = row.updated_at || row.joined_on || "";
  return iso ? String(iso).slice(0, 10) : "—";
}

type Section = { key: string; label: string; rows: MemberRow[] };
type EditState = { row: MemberRow; dept: string; team: string; teamCustom: boolean; title: string };

export default function MemberAdmin() {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const [deptFilter, setDeptFilter] = useState<string>("전체");
  const groupsReg = useTeamGroups();
  const DEPTS = groupsReg.depts;
  const TEAM_OPTIONS = groupsReg.teams;
  // 부서(그룹)·팀(소그룹) 손질 — 사용자 선택 창과 같은 등록부를 고친다(2026-09-20 "관리 탭에서도"). 삭제는 비어 있을 때만
  const [groupEdit, setGroupEdit] = useState<{ kind: "dept" | "team"; mode: "rename" | "new"; team?: string; text: string } | null>(null);
  const isCsCode = (dept: string, team: string) => dept === CS_DEPT && (AUTHOR_TEAMS as string[]).includes(team);
  const teamsFor = (dept: string) => (TEAM_OPTIONS[dept] || [""]).filter((team) => !groupsReg.hidden.includes(`${dept}|${team}`) || rows.some((row) => row.active && row.dept === dept && row.team === team));
  const groupAct = async (run: () => Promise<void>, done: string) => {
    try { await run(); await load(); setError(""); if (done) window.setTimeout(() => setError(""), 0); }
    catch (e) { setError((e as Error).message || "그룹을 저장하지 못했습니다."); }
  };
  const applyGroupEdit = async () => {
    if (!groupEdit) return;
    const edit = groupEdit;
    const text = edit.text.trim();
    setGroupEdit(null);
    if (!text) return;
    const dept = deptFilter;
    if (edit.kind === "dept" && edit.mode === "new") {
      if (DEPTS.includes(text)) { setDeptFilter(text); return; }
      await groupAct(() => saveTeamGroups({ depts: [...DEPTS, text], teams: { ...TEAM_OPTIONS, [text]: [""] } }).then(() => undefined), "");
      setDeptFilter(text);
    } else if (edit.kind === "dept") {
      if (dept === "전체") return;
      await groupAct(() => renameDeptGroup(dept, text), "");
      setDeptFilter(text);
    } else if (edit.mode === "new") {
      if (dept === "전체" || (TEAM_OPTIONS[dept] || []).includes(text)) return;
      await groupAct(() => saveTeamGroups({ teams: { ...TEAM_OPTIONS, [dept]: [...(TEAM_OPTIONS[dept] || []), text] } }).then(() => undefined), "");
    } else if (edit.team !== undefined) {
      await groupAct(() => renameTeamGroup(dept, edit.team as string, text), "");
    }
  };
  const deleteDeptGroup = async () => {
    const dept = deptFilter;
    if (dept === "전체") return;
    if (dept === CS_DEPT) { setError("CS팀 그룹은 일정·배정의 기준이라 지울 수 없습니다."); return; }
    if (rows.some((row) => row.active && row.dept === dept)) { setError("인원이 있는 그룹은 지울 수 없습니다 — 먼저 ✎ 수정으로 다른 부서로 옮겨 주세요."); return; }
    if (!await askConfirm(`"${dept}" 그룹을 지울까요?`)) return;
    const teams = { ...TEAM_OPTIONS }; delete teams[dept];
    await groupAct(() => saveTeamGroups({ depts: DEPTS.filter((d) => d !== dept), teams }).then(() => undefined), "");
    setDeptFilter("전체");
  };
  const deleteTeamGroup = async (team: string) => {
    const dept = deptFilter;
    if (dept === "전체") return;
    if (rows.some((row) => row.active && row.dept === dept && (row.team === team || row.team.split(/[·/,]/).map((t) => t.trim()).includes(team)))) { setError("인원이 있는 소그룹은 지울 수 없습니다 — 먼저 ✎ 수정으로 옮겨 주세요."); return; }
    if (!await askConfirm(`"${teamLabel(dept, team)}" 소그룹을 지울까요?`)) return;
    if (isCsCode(dept, team)) await groupAct(() => saveTeamGroups({ hidden: [...groupsReg.hidden, `${dept}|${team}`] }).then(() => undefined), ""); // 코드는 남기고 숨긴다
    else await groupAct(() => saveTeamGroups({ teams: { ...TEAM_OPTIONS, [dept]: (TEAM_OPTIONS[dept] || []).filter((t) => t !== team) } }).then(() => undefined), "");
  };
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState({ name: "", dept: "CS팀" as string, team: "A", title: "" });
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchMembers());
      setError("");
    } catch (e) {
      setError((e as Error).message || "명단을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const active = rows.filter((row) => row.active);
  const left = rows.filter((row) => !row.active);
  const deptCount = (dept: string) => active.filter((row) => row.dept === dept).length;

  const grouped = useMemo(() => {
    const rank = (row: MemberRow) => TITLE_RANK[row.title] ?? 9;
    const query = search.trim();
    const out: Array<{ dept: string; count: number; sections: Section[] }> = [];
    // 사용자 선택 창에서 만든 새 그룹(부서)도 여기 보여야 관리가 이어진다(2026-09-18) — 고정 4부서 뒤에 이름순
    const extraDepts = [...new Set(active.map((row) => row.dept))].filter((dept) => dept && !(DEPTS as readonly string[]).includes(dept)).sort();
    for (const dept of [...DEPTS, ...extraDepts]) {
      if (deptFilter !== "전체" && deptFilter !== dept) continue;
      let list = active.filter((row) => row.dept === dept);
      if (query) list = list.filter((row) => row.name.includes(query) || row.team.includes(query) || teamLabel(dept, row.team).includes(query));
      if (!list.length) continue;
      const leaders = list.filter(isLeaderRow).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      const rest = list.filter((row) => !isLeaderRow(row));
      const teamNames = [...new Set(rest.map((row) => row.team))]
        .sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b));
      const sections: Section[] = [];
      // 임원은 구분행 없이 부서행 바로 아래 — 2명뿐이라 소제목이 소음이다
      if (leaders.length && dept !== "임원") sections.push({ key: "_lead", label: "팀장 · 파트장", rows: leaders });
      else if (leaders.length) sections.push({ key: "_lead", label: "", rows: leaders });
      for (const team of teamNames) {
        sections.push({
          key: team || "_none", label: teamLabel(dept, team),
          rows: rest.filter((row) => row.team === team).sort((a, b) => rank(a) - rank(b) || a.sort - b.sort || a.name.localeCompare(b.name)),
        });
      }
      out.push({ dept, count: list.length, sections });
    }
    return out;
  }, [active, deptFilter, search, DEPTS]);

  const submit = async () => {
    if (!draft.name.trim() || adding) return;
    setAdding(true);
    try {
      await addMember(draft.team, draft.name, undefined, draft.dept, draft.title);
      setDraft({ ...draft, name: "" });
      setAddOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message || "추가하지 못했습니다.");
    } finally {
      setAdding(false);
    }
  };

  const act = async (id: string, run: () => Promise<void>) => {
    setBusyId(id);
    try { await run(); await load(); }
    catch (e) { setError((e as Error).message || "처리하지 못했습니다."); }
    finally { setBusyId(""); }
  };

  const saveEdit = async () => {
    if (!edit) return;
    await act(edit.row.id, () => updateMember(edit.row.id, { dept: edit.dept, team: edit.team, title: edit.title }));
    setEdit(null);
  };

  const titleChip = (row: MemberRow) => {
    const label = displayTitle(row);
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${TITLE_TONE[label] || TITLE_TONE.프로}`}>{label}</span>;
  };

  const memberTr = (row: MemberRow) => (
    <tr key={row.id} className="group border-b border-slate-50 transition hover:bg-slate-50/60">
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          <UserRound size={14} className="shrink-0 text-slate-300" />
          <span className="whitespace-nowrap text-sm font-black text-slate-900">{row.name}</span>
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold text-slate-500">{row.dept}</td>
      <td className="whitespace-nowrap px-4 py-2">
        {row.team ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{teamLabel(row.dept, row.team)}</span> : <span className="text-xs text-slate-300">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-2">{titleChip(row)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold tabular-nums text-slate-500">{modifiedLabel(row)}</td>
      <td className="px-4 py-2">
        <span className="flex items-center justify-end gap-1">
          <button type="button" title="정보 수정" disabled={busyId === row.id}
            onClick={() => setEdit({ row, dept: row.dept, team: row.team, teamCustom: !(TEAM_OPTIONS[row.dept] || []).includes(row.team), title: row.title })}
            className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 lg:opacity-0 lg:group-hover:opacity-100">
            <Pencil size={13} />
          </button>
          <button type="button" disabled={busyId === row.id}
            onClick={async () => { if (await askConfirm(`${row.name} 님을 명단에서 삭제할까요?\n\n되돌릴 수 없습니다. 과거 기록의 이름은 그대로 남습니다.`)) void act(row.id, () => deleteMember(row.id)); }}
            className="whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-black text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40 lg:opacity-0 lg:group-hover:opacity-100">삭제</button>
        </span>
      </td>
    </tr>
  );

  const divider = (label: string, count: number, strong = false) => (
    <tr>
      <td colSpan={6} className={strong
        ? "border-y border-slate-200 bg-slate-100/90 px-4 py-1.5 text-xs font-black text-slate-700"
        : "border-b border-slate-100 bg-slate-50/70 px-4 py-1 text-[11px] font-black tracking-wide text-slate-500"}>
        {label} <span className="ml-1 text-[10px] font-bold tabular-nums text-slate-400">{count}명</span>
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1E252F] px-5 py-4">
          <div>
            <h3 className="text-base font-black text-white lg:text-lg">인원 관리 <span className="text-[11px] font-bold text-slate-400">회사 전체</span></h3>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">부서 칩으로 거르고, 행에 마우스를 올리면 ✎ 수정·삭제가 나타납니다. 직책이 없으면 "프로".</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black tabular-nums text-slate-300">재직 {active.length}명</span>
            {left.length > 0 && <button type="button" onClick={() => setShowLeft((current) => !current)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-black text-slate-300 transition hover:bg-white/10">예전 퇴사 처리 {left.length}명 {showLeft ? "숨기기" : "보기"}</button>}
            <button type="button" onClick={() => { const dept = deptFilter === "전체" ? "CS팀" : deptFilter; setDraft({ ...draft, dept, team: TEAM_OPTIONS[dept]?.[0] ?? "" }); setAddOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">
              <UserPlus size={15} />인원 추가
            </button>
          </div>
        </div>

        {/* 다크 툴바 — 검색 + 부서 필터 */}
        <div className="flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5">
          <label className="flex items-center gap-2 rounded-full bg-white/[0.08] px-3.5 py-1.5 transition focus-within:bg-white/[0.14]">
            <Search size={13} className="shrink-0 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름·팀 검색"
              className="w-24 bg-transparent text-xs font-bold text-white outline-none placeholder:text-slate-500 lg:w-36" />
          </label>
          {["전체", ...DEPTS].map((dept) => {
            const count = dept === "전체" ? active.length : deptCount(dept);
            const on = deptFilter === dept;
            return (
              <button key={dept} type="button" onClick={() => setDeptFilter(dept)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-black transition ${on ? "bg-white text-slate-950" : "bg-white/[0.07] text-slate-400 hover:bg-white/[0.14] hover:text-slate-200"}`}>
                {dept} <span className={`tabular-nums ${on ? "text-slate-400" : "text-slate-500"}`}>{count}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => setGroupEdit({ kind: "dept", mode: "new", text: "" })} className="whitespace-nowrap rounded-full border border-dashed border-white/25 px-3 py-1.5 text-xs font-black text-slate-400 transition hover:bg-white/[0.1] hover:text-slate-200">＋ 그룹</button>
        </div>

        {/* 그룹(부서)·소그룹(팀) 손질 — 부서를 고르면 나온다. 사용자 선택 창과 같은 등록부 */}
        {(deptFilter !== "전체" || groupEdit) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px]">
            {groupEdit ? (
              <>
                <span className="font-black text-slate-500">{groupEdit.kind === "dept" ? "그룹" : "소그룹"} {groupEdit.mode === "new" ? "추가" : `이름 바꾸기${groupEdit.team !== undefined ? ` (${teamLabel(deptFilter, groupEdit.team)})` : ""}`}</span>
                <input autoFocus value={groupEdit.text} onChange={(e) => setGroupEdit({ ...groupEdit, text: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyGroupEdit(); } if (e.key === "Escape") setGroupEdit(null); }}
                  placeholder={groupEdit.mode === "new" ? (groupEdit.kind === "dept" ? "새 그룹 이름 (예: 영업2팀)" : "새 소그룹 이름") : "새 이름"}
                  className="min-w-0 flex-1 rounded-lg border border-blue-300 bg-white px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-blue-500" />
                <button type="button" onClick={() => void applyGroupEdit()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white">저장</button>
                <button type="button" onClick={() => setGroupEdit(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-500">취소</button>
              </>
            ) : (
              <>
                <span className="font-black text-slate-600">그룹 · {deptFilter}</span>
                <button type="button" onClick={() => setGroupEdit({ kind: "dept", mode: "rename", text: deptFilter })} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">이름 바꾸기</button>
                <button type="button" onClick={() => void deleteDeptGroup()} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-rose-50 hover:text-rose-600">그룹 삭제</button>
                <span className="mx-1 h-4 w-px bg-slate-300" />
                <span className="font-black text-slate-500">소그룹</span>
                {teamsFor(deptFilter).map((team) => (
                  <span key={team || "_none"} className="inline-flex items-center overflow-hidden rounded-full border border-slate-300 bg-white text-[11px] font-bold text-slate-600">
                    <span className="px-2 py-1">{teamLabel(deptFilter, team)}{isCsCode(deptFilter, team) ? <span className="ml-1 text-slate-400">{team}</span> : null}</span>
                    {team !== "" && <button type="button" title="이름 바꾸기" onClick={() => setGroupEdit({ kind: "team", mode: "rename", team, text: isCsCode(deptFilter, team) ? teamLabel(deptFilter, team) : team })} className="border-l border-slate-200 px-1.5 py-1 hover:bg-slate-100"><Pencil size={11} /></button>}
                    {team !== "" && <button type="button" title="소그룹 삭제 (비어 있을 때만)" onClick={() => void deleteTeamGroup(team)} className="border-l border-slate-200 px-1.5 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">×</button>}
                  </span>
                ))}
                <button type="button" onClick={() => setGroupEdit({ kind: "team", mode: "new", text: "" })} className="rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">＋ 소그룹</button>
                {deptFilter === CS_DEPT && <span className="text-slate-400">A~E 글자는 배정 코드라 표시명만 바뀝니다</span>}
              </>
            )}
          </div>
        )}

        {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}
        {loading && <div className="p-10 text-center text-sm font-bold text-slate-400">명단을 불러오는 중…</div>}

        {!loading && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-[11px] font-black tracking-wide text-slate-400">
                  <th className="px-4 py-2.5">이름</th>
                  <th className="px-4 py-2.5">부서</th>
                  <th className="px-4 py-2.5">팀/파트</th>
                  <th className="px-4 py-2.5">직책</th>
                  <th className="px-4 py-2.5">수정일</th>
                  <th className="px-4 py-2.5 text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((group) => (
                  <Fragment key={group.dept}>
                    {deptFilter === "전체" && divider(group.dept, group.count, true)}
                    {group.sections.map((section) => (
                      <Fragment key={section.key}>
                        {section.label && divider(section.label, section.rows.length)}
                        {section.rows.map(memberTr)}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
                {!grouped.length && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-xs font-bold text-slate-300">
                    {search.trim() ? `"${search.trim()}" 검색 결과가 없습니다` : "인원 없음 — 우측 상단 \"인원 추가\"로 등록하세요"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showLeft && left.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <h3 className="text-base font-black text-slate-950">퇴사자</h3>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">예전 방식(퇴사 처리)으로 빠진 행입니다. 다시 쓰면 복구, 필요 없으면 삭제하세요.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {left.map((row) => (
              <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-slate-500">{row.name} <span className="text-[11px] font-bold text-slate-400">{row.dept}{row.team ? ` · ${row.team}` : ""}</span></span>
                  <span className="block text-[10px] font-bold tabular-nums text-slate-400">{row.joined_on || "-"} 입사 · {row.left_on || "-"} 퇴사</span>
                </span>
                <button type="button" disabled={busyId === row.id} onClick={() => void act(row.id, () => restoreMember(row.id))}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                  <Undo2 size={13} />복구
                </button>
                <button type="button" disabled={busyId === row.id} onClick={async () => { if (await askConfirm(`${row.name} 님을 완전히 삭제할까요?`)) void act(row.id, () => deleteMember(row.id)); }}
                  className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-[11px] font-black text-rose-600 transition hover:bg-rose-100 disabled:opacity-40">삭제</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 인원 추가 모달 */}
      {addOpen && (
        <FormModal title="인원 추가" subtitle="등록하면 작성자 목록·요청 대상에 바로 나타납니다" icon={<UserPlus size={17} />} onClose={() => setAddOpen(false)}
          footer={<>
            <button type="button" onClick={() => setAddOpen(false)} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
            <button type="button" disabled={!draft.name.trim() || adding} onClick={() => void submit()}
              className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{adding ? "등록 중…" : "추가"}</button>
          </>}>
          <div className="space-y-4">
            <label className="block text-xs font-bold text-slate-500">이름 <b className="text-rose-500">*</b>
              <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-xs font-bold text-slate-500">부서
                <span className="mt-1 block"><PortalSelect width={170} value={draft.dept} onChange={(next) => setDraft({ ...draft, dept: next, team: TEAM_OPTIONS[next]?.[0] ?? "" })}
                  options={DEPTS.map((dept) => ({ value: dept, label: dept }))} /></span>
              </div>
              <div className="text-xs font-bold text-slate-500">팀/파트
                <span className="mt-1 block"><PortalSelect width={170} value={draft.team} onChange={(next) => setDraft({ ...draft, team: next })}
                  options={teamsFor(draft.dept).map((team) => ({ value: team, label: teamLabel(draft.dept, team) }))} /></span>
              </div>
              <div className="text-xs font-bold text-slate-500">직책
                <span className="mt-1 block"><PortalSelect width={170} value={draft.title} onChange={(next) => setDraft({ ...draft, title: next })}
                  options={TITLES.map((title) => ({ value: title, label: title || "프로 (기본)" }))} /></span>
              </div>
            </div>
          </div>
        </FormModal>
      )}

      {/* 정보 수정 모달 — 부서·팀·직책 */}
      {edit && (
        <FormModal title={`${edit.row.name} 정보 수정`} subtitle="바꾸면 작성자 목록·요청 대상·프로필에 바로 반영됩니다" icon={<UserRound size={17} />} onClose={() => setEdit(null)}
          footer={<>
            <button type="button" onClick={() => setEdit(null)} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
            <button type="button" disabled={busyId === edit.row.id} onClick={() => void saveEdit()}
              className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{busyId === edit.row.id ? "저장 중…" : "저장"}</button>
          </>}>
          <div className="space-y-4">
            <div className="text-xs font-bold text-slate-500">부서
              <span className="mt-1 block"><PortalSelect width={180} value={edit.dept}
                onChange={(next) => setEdit({ ...edit, dept: next, team: TEAM_OPTIONS[next]?.[0] ?? "", teamCustom: false })}
                options={DEPTS.map((dept) => ({ value: dept, label: dept }))} /></span>
            </div>
            <div className="text-xs font-bold text-slate-500">팀/파트 <span className="font-semibold text-slate-400">— 겸임은 "직접 입력"으로 A·B처럼 점(·)으로 묶으세요</span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <PortalSelect width={150} value={edit.teamCustom ? "__custom" : edit.team}
                  onChange={(next) => next === "__custom" ? setEdit({ ...edit, teamCustom: true }) : setEdit({ ...edit, team: next, teamCustom: false })}
                  options={[...teamsFor(edit.dept).map((team) => ({ value: team, label: teamLabel(edit.dept, team) })), { value: "__custom", label: "직접 입력…" }]} />
                {edit.teamCustom && (
                  <input autoFocus value={edit.team} onChange={(e) => setEdit({ ...edit, team: e.target.value })} placeholder="예: A·B"
                    className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                )}
              </div>
            </div>
            <div className="text-xs font-bold text-slate-500">직책
              <span className="mt-1 block"><PortalSelect width={180} value={edit.title} onChange={(next) => setEdit({ ...edit, title: next })}
                options={TITLES.map((title) => ({ value: title, label: title || "프로 (기본)" }))} /></span>
            </div>
          </div>
        </FormModal>
      )}
    </div>
  );
}
