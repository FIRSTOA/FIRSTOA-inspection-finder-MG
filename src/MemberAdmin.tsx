import { Fragment, useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { Pencil, Search, UserPlus, UserRound, Undo2 } from "lucide-react";
import { AUTHOR_TEAMS, CS_DEPT, addMember, deleteMember, displayTitle, fetchMembers, renameDeptGroup, renameTeamGroup, restoreMember, saveTeamGroups, teamLabel as csTeamLabel, updateMember, useTeamGroups, type MemberRow } from "./authors";
import FormModal from "./FormModal";
import PortalSelect from "./PortalSelect";
import { UI } from "./ui/card";
import StateBox from "./ui/StateBox";

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
// 팀장·파트장(또는 겸임)만 따로 묶는다 — 부파트장은 자기 팀 안에 있어야 한다(2026-09-20: IT파트 김정식이 "팀장·파트장"에 섞여 보이던 것)
function isLeaderRow(row: MemberRow) {
  if (row.dept === "임원") return true;
  return row.team === "팀장" || row.team.includes("·") || (!row.team && (row.title === "팀장" || row.title === "파트장"));
}

function teamLabel(dept: string, team: string) {
  if (!team) return "부서 직속"; // 팀 칸이 빈 사람 = 부서에 바로 속함(IT파트처럼 팀이 없는 부서는 구분행 자체를 안 그린다)
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
      setRows(await fetchMembers(true));
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
      const sections: Section[] = [];
      const byRank = (a: MemberRow, b: MemberRow) => rank(a) - rank(b) || a.sort - b.sort || a.name.localeCompare(b.name);
      // 팀(소그룹)이 없는 부서(IT파트·임원)는 구분행 없이 한 덩어리 — 직책 순으로만 정렬한다
      if (!list.some((row) => row.team)) {
        sections.push({ key: "_all", label: "", rows: [...list].sort(byRank) });
        out.push({ dept, count: list.length, sections });
        continue;
      }
      const leaders = list.filter(isLeaderRow).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      const rest = list.filter((row) => !isLeaderRow(row));
      const teamNames = [...new Set(rest.map((row) => row.team))]
        .sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b));
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
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${TITLE_TONE[label] || TITLE_TONE.프로}`}>{label}</span>;
  };

  // 수정·삭제 단추 — 마우스 올림에 기대지 않고 항상 보인다(폰 min-h-11, PC 표 안에서만 lg:min-h-9)
  const rowActions = (row: MemberRow) => (
    <span className="flex items-center justify-end gap-2">
      <button type="button" title="정보 수정" aria-label={`${row.name} 정보 수정`} disabled={busyId === row.id}
        onClick={() => setEdit({ row, dept: row.dept, team: row.team, teamCustom: !(TEAM_OPTIONS[row.dept] || []).includes(row.team), title: row.title })}
        className={`${UI.btnGhost} px-3!`}>
        <Pencil size={14} />수정
      </button>
      <button type="button" disabled={busyId === row.id}
        onClick={async () => { if (await askConfirm(`${row.name} 님을 명단에서 삭제할까요?\n\n되돌릴 수 없습니다. 과거 기록의 이름은 그대로 남습니다.`)) void act(row.id, () => deleteMember(row.id)); }}
        className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border border-rose-200 bg-white px-3 text-sm font-black text-rose-600 transition hover:bg-rose-50 disabled:opacity-40 lg:min-h-9">삭제</button>
    </span>
  );

  // 폰(md 미만) 카드 한 줄
  const memberCard = (row: MemberRow) => (
    <div key={row.id} className="px-4 py-3">
      <div className="flex items-center gap-2">
        <UserRound size={14} className="shrink-0 text-slate-300" />
        <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-900">{row.name}</span>
        {titleChip(row)}
      </div>
      <p className="mt-1 break-keep pl-6 text-xs font-semibold text-slate-500">
        {row.dept}{row.team ? ` · ${teamLabel(row.dept, row.team)}` : ""} <span className="tabular-nums text-slate-400">· 수정 {modifiedLabel(row)}</span>
      </p>
      <div className="mt-2">{rowActions(row)}</div>
    </div>
  );

  const memberTr = (row: MemberRow) => (
    <tr key={row.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          <UserRound size={14} className="shrink-0 text-slate-300" />
          <span className="whitespace-nowrap text-sm font-black text-slate-900">{row.name}</span>
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold text-slate-500">{row.dept}</td>
      <td className="whitespace-nowrap px-4 py-2">
        {row.team ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{teamLabel(row.dept, row.team)}</span> : <span className="text-xs text-slate-300">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-2">{titleChip(row)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold tabular-nums text-slate-500">{modifiedLabel(row)}</td>
      <td className="px-4 py-2">{rowActions(row)}</td>
    </tr>
  );

  const divider = (label: string, count: number, strong = false) => (
    <tr>
      <td colSpan={6} className={strong
        ? "border-y border-slate-200 bg-slate-100/90 px-4 py-1.5 text-xs font-black text-slate-700"
        : "border-b border-slate-100 bg-slate-50/70 px-4 py-1 text-[11px] font-black tracking-wide text-slate-500"}>
        {label} <span className="ml-1 text-[11px] font-bold tabular-nums text-slate-400">{count}명</span>
      </td>
    </tr>
  );

  // 폰용 구분줄(표 구분행과 같은 뜻)
  const dividerDiv = (label: string, count: number, strong = false) => (
    <div className={strong
      ? "border-y border-slate-200 bg-slate-100/90 px-4 py-2 text-xs font-black text-slate-700"
      : "border-y border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] font-black text-slate-500"}>
      {label} <span className="ml-1 text-[11px] font-bold tabular-nums text-slate-400">{count}명</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <section className={UI.card}>
        {/* 허브(AdminHub)가 다크 머리를 이미 가지므로 여기는 연회색 머리 + 밝은 툴바 */}
        <div className={UI.head}>
          <div className="min-w-0">
            <h3 className={UI.title}>인원 관리 <span className="text-[11px] font-bold text-slate-400">회사 전체</span></h3>
            <p className={UI.desc}>부서 칩으로 거르고, 각 줄의 [수정]·[삭제]로 바꿉니다. 직책이 없으면 "프로"입니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${UI.badge} ${UI.tone.off} tabular-nums`}>재직 {active.length}명</span>
            {left.length > 0 && <button type="button" onClick={() => setShowLeft((current) => !current)} className={UI.btnGhost}>예전 퇴사 처리 {left.length}명 {showLeft ? "숨기기" : "보기"}</button>}
            <button type="button" onClick={() => { const dept = deptFilter === "전체" ? "CS팀" : deptFilter; setDraft({ ...draft, dept, team: TEAM_OPTIONS[dept]?.[0] ?? "" }); setAddOpen(true); }}
              className={UI.btn}>
              <UserPlus size={15} />인원 추가
            </button>
          </div>
        </div>

        {/* 툴바 — 검색 + 부서 필터 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 lg:px-5">
          <label className="relative block w-full sm:w-56">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름·팀 검색" aria-label="이름·팀 검색"
              className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 lg:h-10" />
          </label>
          {["전체", ...DEPTS].map((dept) => {
            const count = dept === "전체" ? active.length : deptCount(dept);
            const on = deptFilter === dept;
            return (
              <button key={dept} type="button" onClick={() => setDeptFilter(dept)} className={UI.chip(on)}>
                {dept} <span className={`ml-1 tabular-nums ${on ? "text-slate-300" : "text-slate-400"}`}>{count}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => setGroupEdit({ kind: "dept", mode: "new", text: "" })} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-dashed border-slate-300 px-3.5 text-[12px] font-black text-slate-500 transition hover:bg-slate-50 lg:min-h-9">＋ 그룹</button>
        </div>

        {/* 그룹(부서)·소그룹(팀) 손질 — 부서를 고르면 나온다. 사용자 선택 창과 같은 등록부 */}
        {(deptFilter !== "전체" || groupEdit) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px]">
            {groupEdit ? (
              <>
                <span className="font-black text-slate-500">{groupEdit.kind === "dept" ? "그룹" : "소그룹"} {groupEdit.mode === "new" ? "추가" : `이름 바꾸기${groupEdit.team !== undefined ? ` (${teamLabel(deptFilter, groupEdit.team)})` : ""}`}</span>
                <input autoFocus value={groupEdit.text} onChange={(e) => setGroupEdit({ ...groupEdit, text: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyGroupEdit(); } if (e.key === "Escape") setGroupEdit(null); }}
                  placeholder={groupEdit.mode === "new" ? (groupEdit.kind === "dept" ? "새 그룹 이름 (예: 영업2팀)" : "새 소그룹 이름") : "새 이름"}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-blue-300 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-500 lg:h-10" />
                <button type="button" onClick={() => void applyGroupEdit()} className={UI.btn}>저장</button>
                <button type="button" onClick={() => setGroupEdit(null)} className={UI.btnGhost}>취소</button>
              </>
            ) : (
              <>
                <span className="font-black text-slate-600">그룹 · {deptFilter}</span>
                <button type="button" onClick={() => setGroupEdit({ kind: "dept", mode: "rename", text: deptFilter })} className={`${UI.btnGhost} text-xs!`}>이름 바꾸기</button>
                <button type="button" onClick={() => void deleteDeptGroup()} className={`${UI.btnGhost} text-xs! hover:bg-rose-50 hover:text-rose-600`}>그룹 삭제</button>
                <span className="mx-1 hidden h-4 w-px bg-slate-300 sm:block" />
                <span className="font-black text-slate-500">소그룹</span>
                {teamsFor(deptFilter).map((team) => (
                  <span key={team || "_none"} className="inline-flex items-center overflow-hidden rounded-full border border-slate-300 bg-white text-[11px] font-bold text-slate-600">
                    <span className="px-3 py-2.5">{teamLabel(deptFilter, team)}{isCsCode(deptFilter, team) ? <span className="ml-1 text-slate-400">{team}</span> : null}</span>
                    {team !== "" && <button type="button" title="이름 바꾸기" aria-label="소그룹 이름 바꾸기" onClick={() => setGroupEdit({ kind: "team", mode: "rename", team, text: isCsCode(deptFilter, team) ? teamLabel(deptFilter, team) : team })} className="inline-flex min-h-11 min-w-11 items-center justify-center border-l border-slate-200 hover:bg-slate-100 lg:min-h-9 lg:min-w-9"><Pencil size={13} /></button>}
                    {team !== "" && <button type="button" title="소그룹 삭제 (비어 있을 때만)" aria-label="소그룹 삭제" onClick={() => void deleteTeamGroup(team)} className="inline-flex min-h-11 min-w-11 items-center justify-center border-l border-slate-200 text-sm text-slate-400 hover:bg-rose-50 hover:text-rose-600 lg:min-h-9 lg:min-w-9">×</button>}
                  </span>
                ))}
                <button type="button" onClick={() => setGroupEdit({ kind: "team", mode: "new", text: "" })} className="inline-flex min-h-11 items-center rounded-full border border-dashed border-slate-300 bg-white px-3.5 text-[11px] font-bold text-slate-600 hover:bg-slate-100 lg:min-h-9">＋ 소그룹</button>
                {deptFilter === CS_DEPT && <span className="text-slate-400">A~E 글자는 배정 코드라 표시명만 바뀝니다</span>}
              </>
            )}
          </div>
        )}

        {error && <div role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}
        {loading && <StateBox inside kind="loading" message="명단을 불러오는 중입니다…" />}

        {/* 폰: 카드 목록(가로 스크롤 없음). 표와 같은 구분(부서 → 팀)과 같은 단추를 쓴다 */}
        {!loading && (
          <div className="md:hidden">
            {grouped.map((group) => (
              <Fragment key={group.dept}>
                {deptFilter === "전체" && dividerDiv(group.dept, group.count, true)}
                {group.sections.map((section) => (
                  <Fragment key={section.key}>
                    {section.label && dividerDiv(section.label, section.rows.length)}
                    <div className="divide-y divide-slate-100">{section.rows.map(memberCard)}</div>
                  </Fragment>
                ))}
              </Fragment>
            ))}
            {!grouped.length && (
              <StateBox inside kind="empty" message={search.trim() ? `"${search.trim()}" 검색 결과가 없습니다.` : "등록된 인원이 없습니다."} hint={search.trim() ? undefined : "위의 [인원 추가]로 등록해 주세요."} />
            )}
          </div>
        )}

        {!loading && (
          <div className="hidden overflow-x-auto md:block">
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
                  <tr><td colSpan={6}>
                    <StateBox inside kind="empty" message={search.trim() ? `"${search.trim()}" 검색 결과가 없습니다.` : "등록된 인원이 없습니다."} hint={search.trim() ? undefined : "위의 [인원 추가]로 등록해 주세요."} />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showLeft && left.length > 0 && (
        <section className={UI.card}>
          <div className={UI.head}>
            <div>
              <h3 className={UI.title}>퇴사자</h3>
              <p className={UI.desc}>예전 방식(퇴사 처리)으로 빠진 행입니다. 다시 쓰면 복구, 필요 없으면 삭제해 주세요.</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {left.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate text-sm font-black text-slate-500">{row.name} <span className="text-[11px] font-bold text-slate-400">{row.dept}{row.team ? ` · ${row.team}` : ""}</span></span>
                  <span className="block text-[11px] font-bold tabular-nums text-slate-400">{row.joined_on || "-"} 입사 · {row.left_on || "-"} 퇴사</span>
                </span>
                <button type="button" disabled={busyId === row.id} onClick={() => void act(row.id, () => restoreMember(row.id))}
                  className={`${UI.btnGhost} shrink-0`}>
                  <Undo2 size={14} />복구
                </button>
                <button type="button" disabled={busyId === row.id} onClick={async () => { if (await askConfirm(`${row.name} 님을 완전히 삭제할까요?`)) void act(row.id, () => deleteMember(row.id)); }}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-white px-4 text-sm font-black text-rose-600 transition hover:bg-rose-50 disabled:opacity-40 lg:min-h-9">삭제</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 인원 추가 모달 */}
      {addOpen && (
        <FormModal title="인원 추가" subtitle="등록하면 작성자 목록·요청 대상에 바로 나타납니다" icon={<UserPlus size={17} />} onClose={() => setAddOpen(false)}
          footer={<>
            <button type="button" onClick={() => setAddOpen(false)} className="min-h-11 rounded-full px-4 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
            <button type="button" disabled={!draft.name.trim() || adding} onClick={() => void submit()}
              className={`${UI.btn} px-6!`}>{adding ? "등록 중…" : "추가"}</button>
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
            <button type="button" onClick={() => setEdit(null)} className="min-h-11 rounded-full px-4 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
            <button type="button" disabled={busyId === edit.row.id} onClick={() => void saveEdit()}
              className={`${UI.btn} px-6!`}>{busyId === edit.row.id ? "저장 중…" : "저장"}</button>
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
