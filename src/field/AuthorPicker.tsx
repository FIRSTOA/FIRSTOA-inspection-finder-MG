/**
 * 작성자(사용자) 고르기 단추·모달과 그룹웨어 로그인 줄. 점검·AS·청정기 양식과 App 상단 사용자 단추가 같이 쓴다.
 * App.tsx에서 글자 그대로 옮겨 왔다(2026-10-24, docs/tasks/field-form-tidy.md S3).
 */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { askConfirm } from "../confirmModal";
import { notify } from "../toast";
import { authorLocked, clearSsoSession, getSsoSession, logoutToGroupware, ssoLoginVisible, ssoRequiredCached, startGroupwareLogin } from "../sso";
import { AUTHOR_TEAMS, CS_DEPT, EXTERNAL_AUTHORS, addMember, deleteMember, renameDeptGroup, renameTeamGroup, saveTeamGroups, teamLabel, updateMember, useAuthorBook, useMembers, useTeamGroups } from "../authors";
import type { AuthorTeam, MemberRow } from "../authors";

export type AuthorPickerProps = {
  value: string;
  onChange: (v: string) => void;
  accent: string;
};

// 사용자(작성자) 선택 + 명단·그룹 손질 — 한 번 고르면 앱 전체(FIELD 작성자·일정·접수·마감문자)가 그 이름으로 돈다.
// 구조는 그룹(부서) → 소그룹(팀) → 사람, 2단. 관리 탭 인원 명단과 같은 등록부(app_config TEAM_GROUPS + cs_members)를 본다(2026-09-18).
//  · 그룹/소그룹: 추가·이름 바꾸기·삭제(비어 있을 때만). CS 팀 글자(A~E)는 일정 시간대·카톡방 배정 코드라 표시명만 바뀐다(E → CSS팀).
//  · 사람: 추가·이름 고치기·다른 소그룹으로 이동·삭제(퇴사 처리 — 과거 기록은 남는다).
const EXTERNAL_GROUP = "외부 이관";
type PickerRow = { name: string; member?: MemberRow };
// 그룹웨어 통합 로그인 줄(2026-10-02) — 로그인하면 작성자가 그룹웨어 이름으로 맞춰진다. 잠금이 켜진 기기에서 로그아웃하면 로그인 문으로 돌아간다
export function SsoRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [session, setSession] = useState(() => getSsoSession());
  if (!ssoRequiredCached()) return null; // 스위치가 꺼져 있으면 그룹웨어 로그인은 어디에도 안 보인다(2026-10-08) — 예전 방식 그대로
  if (!session) {
    if (!ssoLoginVisible()) return null; // 검증 전엔 숨김 — ?sso=test 기기 또는 잠금이 켜진 뒤에만
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-blue-50/70 px-4 py-2">
        <div className="min-w-0 text-[11px] font-bold leading-snug text-slate-600">그룹웨어 계정으로 로그인하면 작성자가 자동으로 맞춰집니다 <span className="font-semibold text-slate-400">· 비밀번호는 그룹웨어 화면에서만 입력</span></div>
        <button type="button" onClick={() => startGroupwareLogin()} className="shrink-0 rounded-full bg-blue-600 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-blue-700">그룹웨어로 로그인</button>
      </div>
    );
  }
  const u = session.user;
  const differs = Boolean(value) && u.name !== value;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-emerald-50/70 px-4 py-2">
      <div className="min-w-0 text-[11px] font-bold leading-snug text-emerald-800">
        그룹웨어 로그인: <b>{u.name}</b>{u.department ? ` · ${u.department}` : ""}{u.position ? ` ${u.position}` : ""}
        {differs && <span className="ml-1 font-black text-amber-700">(지금 작성자 선택과 다름)</span>}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        {differs && <button type="button" onClick={() => onChange(u.name)} className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-black text-emerald-700 hover:bg-emerald-50">이 이름으로</button>}
        <button type="button" onClick={() => { if (ssoRequiredCached()) logoutToGroupware(); else { clearSsoSession(); setSession(null); } }} className="rounded-full px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100">로그아웃</button>
      </span>
    </div>
  );
}

export function AuthorPickerModal({ value, onChange, accent, onClose }: AuthorPickerProps & { onClose: () => void }) {
  const members = useMembers();
  const { book } = useAuthorBook();
  const reg = useTeamGroups();
  const active = useMemo(() => members.filter((m) => m.active), [members]);
  const depts = useMemo(() => {
    const found = [...new Set(active.map((m) => m.dept).filter(Boolean))];
    return [...reg.depts, ...found.filter((d) => !reg.depts.includes(d)).sort()];
  }, [reg.depts, active]);
  const inTeam = (m: MemberRow, t: string) => m.team === t || m.team.split(/[·/,]/).map((x) => x.trim()).includes(t);
  const [dept, setDept] = useState<string>(() => active.find((m) => m.name === value)?.dept || (EXTERNAL_AUTHORS.includes(value) ? EXTERNAL_GROUP : CS_DEPT));
  const [team, setTeam] = useState<string>(() => { const me = active.find((m) => m.name === value); return me && !me.team.includes("·") ? me.team : "__all"; });
  const teams = useMemo(() => {
    if (dept === EXTERNAL_GROUP) return [] as string[];
    const listed = reg.teams[dept] || [""];
    const found = [...new Set(active.filter((m) => m.dept === dept && !m.team.includes("·")).map((m) => m.team))];
    return [...listed, ...found.filter((t) => !listed.includes(t))]
      .filter((t) => !reg.hidden.includes(`${dept}|${t}`) || active.some((m) => m.dept === dept && inTeam(m, t)));
  }, [reg, dept, active]);
  const subLabel = (d: string, t: string) => (t === "" ? "부서 직속" : d === CS_DEPT ? teamLabel(t) : t); // 팀 칸이 빈 사람은 부서에 바로 속한다(IT파트 등)
  const rows = useMemo<PickerRow[]>(() => {
    if (dept === EXTERNAL_GROUP) return EXTERNAL_AUTHORS.map((name) => ({ name }));
    const list = active.filter((m) => m.dept === dept && (team === "__all" || inTeam(m, team)));
    // 명단(cs_members)을 아직 못 읽었을 때만 시드 명단으로 — 예비 명단을 두 벌 두면 서로 어긋난다
    if (!active.length && dept === CS_DEPT && team !== "__all" && (AUTHOR_TEAMS as string[]).includes(team)) return (book[team as AuthorTeam] || []).map((name) => ({ name }));
    return list.map((m) => ({ name: m.name, member: m }));
  }, [active, dept, team, book]);
  const isCsCode = (t: string) => dept === CS_DEPT && (AUTHOR_TEAMS as string[]).includes(t);
  const teamCount = (t: string) => active.filter((m) => m.dept === dept && inTeam(m, t)).length;
  const deptCount = (d: string) => (d === EXTERNAL_GROUP ? EXTERNAL_AUTHORS.length : active.filter((m) => m.dept === d).length);

  // ── 사람 ──
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ name: string; next: string } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const add = () => {
    const name = newName.trim();
    if (!name || dept === EXTERNAL_GROUP) return;
    const t = team === "__all" ? (reg.teams[dept]?.[0] ?? "") : team;
    void addMember(t, name, undefined, dept, "").then(() => notify(`${name} 추가 — ${dept}${t ? ` · ${subLabel(dept, t)}` : ""}`, "success")).catch((e) => notify(`추가 실패: ${(e as Error).message}`, "error"));
    setNewName("");
  };
  // 이름 고치기 — 과거 기록의 이름(문자열 저장)은 그대로, 명단만 바뀐다. 지금 사용자가 그 사람이면 선택도 새 이름으로 따라간다
  const rename = async () => {
    if (!editing) return;
    const target = active.find((m) => m.name === editing.name);
    const next = editing.next.trim();
    setEditing(null);
    if (!target || !next || next === editing.name) return;
    try { await updateMember(target.id, { name: next }); if (value === editing.name) onChange(next); notify(`이름을 "${next}"로 바꿨습니다`, "success"); }
    catch (e) { notify(`이름 변경 실패: ${(e as Error).message}`, "error"); }
  };
  const remove = async (row: PickerRow) => {
    if (!row.member) return;
    if (!await askConfirm(`${row.name}을(를) 명단에서 삭제할까요?\n(되돌릴 수 없습니다 — 과거 기록의 이름은 그대로 남습니다)`)) return;
    void deleteMember(row.member.id).then(() => notify(`${row.name} 삭제됨`, "success")).catch((e) => notify(`삭제 실패: ${(e as Error).message}`, "error"));
  };
  const move = async (row: PickerRow, target: string) => {
    setMoving(null);
    if (!row.member || !target) return;
    const [d, t] = target.split("|");
    try { await updateMember(row.member.id, { dept: d, team: t ?? "" }); notify(`${row.name} → ${d}${t ? ` · ${subLabel(d, t)}` : ""}`, "success"); setDept(d); setTeam(t ?? "__all"); }
    catch (e) { notify(`이동 실패: ${(e as Error).message}`, "error"); }
  };
  const moveTargets = useMemo(() => depts.flatMap((d) => (reg.teams[d] || [""]).map((t) => ({ value: `${d}|${t}`, label: `${d} · ${subLabel(d, t)}` }))), [depts, reg.teams]);

  // ── 그룹·소그룹 ──
  const [groupEdit, setGroupEdit] = useState<{ kind: "dept" | "team"; mode: "rename" | "new"; text: string } | null>(null);
  const applyGroupEdit = async () => {
    if (!groupEdit) return;
    const text = groupEdit.text.trim();
    const edit = groupEdit;
    setGroupEdit(null);
    if (!text) return;
    try {
      if (edit.kind === "dept" && edit.mode === "new") {
        if (depts.includes(text)) { setDept(text); setTeam("__all"); return; }
        await saveTeamGroups({ depts: [...reg.depts, text], teams: { ...reg.teams, [text]: [""] } });
        setDept(text); setTeam("__all");
      } else if (edit.kind === "dept") {
        if (dept === EXTERNAL_GROUP) return;
        await renameDeptGroup(dept, text);
        setDept(text);
      } else if (edit.mode === "new") {
        if ((reg.teams[dept] || []).includes(text)) { setTeam(text); return; }
        await saveTeamGroups({ teams: { ...reg.teams, [dept]: [...(reg.teams[dept] || []), text] } });
        setTeam(text);
      } else {
        if (team === "__all") return;
        await renameTeamGroup(dept, team, text);
        if (!isCsCode(team)) setTeam(text);
      }
      notify("그룹을 저장했습니다", "success");
    } catch (e) { notify(`그룹 저장 실패: ${(e as Error).message}`, "error"); }
  };
  const deleteDept = async () => {
    if (dept === EXTERNAL_GROUP) return;
    if (active.some((m) => m.dept === dept)) { notify("인원이 있는 그룹은 지울 수 없어요 — 먼저 [이동]으로 다른 그룹에 옮겨 주세요", "error"); return; }
    if (dept === CS_DEPT) { notify("CS팀 그룹은 일정·배정의 기준이라 지울 수 없어요", "error"); return; }
    if (!await askConfirm(`"${dept}" 그룹을 지울까요?`)) return;
    const teams = { ...reg.teams }; delete teams[dept];
    try { await saveTeamGroups({ depts: reg.depts.filter((d) => d !== dept), teams }); setDept(CS_DEPT); setTeam("__all"); }
    catch (e) { notify(`그룹 삭제 실패: ${(e as Error).message}`, "error"); }
  };
  const deleteTeam = async () => {
    if (team === "__all") return;
    if (teamCount(team) > 0) { notify("인원이 있는 소그룹은 지울 수 없어요 — 먼저 [이동]으로 옮겨 주세요", "error"); return; }
    if (!await askConfirm(`"${subLabel(dept, team)}" 소그룹을 지울까요?`)) return;
    try {
      if (isCsCode(team)) await saveTeamGroups({ hidden: [...reg.hidden, `${dept}|${team}`] }); // 코드는 남기고 숨긴다 — 나중에 인원을 넣으면 다시 보인다
      else await saveTeamGroups({ teams: { ...reg.teams, [dept]: (reg.teams[dept] || []).filter((t) => t !== team) } });
      setTeam("__all");
    } catch (e) { notify(`소그룹 삭제 실패: ${(e as Error).message}`, "error"); }
  };

  const chip = (on: boolean, extra = "") => `rounded-lg px-2.5 py-1.5 text-xs font-semibold transition active:scale-95 ${on ? "text-white" : extra || "bg-slate-100 text-slate-700 hover:bg-slate-200"}`;
  const smallBtn = "rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50";
  // 로그인 필수 + 그룹웨어 세션이면 작성자는 로그인 이름으로 고정 — 고르는 목록 대신 내 계정 카드만(스위치를 끄면 예전 창 그대로). 2026-10-08 디자인 다듬음
  const sso = getSsoSession();
  if (ssoRequiredCached() && sso) {
    const u = sso.user;
    const since = (() => { try { return new Date(sso.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }); } catch { return ""; } })();
    const roleLabel = u.role === "ADMIN" ? "관리자" : u.role === "MANAGER" ? "매니저" : "직원";
    return (
      <div className="fixed inset-0 z-[3100] flex items-end bg-black/45 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-4" onClick={onClose} role="dialog">
        <div className="w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-sm sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="relative bg-[#1E252F] px-5 pb-12 pt-4 text-white">
            <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-blue-500/25 blur-2xl" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">내 계정</span>
              <button type="button" onClick={onClose} className="rounded-full px-2.5 py-1 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white">닫기</button>
            </div>
          </div>
          <div className="relative -mt-9 px-5">
            <span className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-[28px] font-black text-white shadow-[0_10px_24px_rgba(37,99,235,.4)] ring-4 ring-white">{u.name.slice(0, 1)}</span>
          </div>
          <div className="px-5 pb-5 pt-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[22px] font-black tracking-tight text-slate-900">{u.name}</span>
              {u.position && <span className="text-[13px] font-bold text-slate-500">{u.position}</span>}
              <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">그룹웨어 연결됨</span>
            </div>
            <dl className="mt-3 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              {u.department && <><dt className="font-bold text-slate-400">부서</dt><dd className="font-bold text-slate-800">{u.department}</dd></>}
              {u.empNo && <><dt className="font-bold text-slate-400">사번</dt><dd className="font-bold tabular-nums text-slate-800">{u.empNo}</dd></>}
              <dt className="font-bold text-slate-400">권한</dt><dd className="font-bold text-slate-800">{roleLabel}</dd>
              {since && <><dt className="font-bold text-slate-400">로그인</dt><dd className="font-bold tabular-nums text-slate-800">{since}</dd></>}
            </dl>
            <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-[11.5px] font-semibold leading-snug text-slate-500">
              FIELD 작성자는 이 이름으로 고정됩니다.{value && value !== u.name ? ` (남아 있던 ${value} 대신 ${u.name}으로 맞춥니다.)` : ""} 계정을 바꾸려면 그룹웨어에서 로그아웃한 뒤 다시 로그인하세요.
            </div>
            <button type="button" onClick={() => logoutToGroupware()} className="mt-3 w-full rounded-full border border-slate-300 bg-white py-2.5 text-[13px] font-black text-slate-700 transition hover:bg-slate-50">로그아웃</button>
            <p className="mt-2 text-center text-[11px] font-semibold text-slate-400">그룹웨어 로그인이 살아 있으면 바로 다시 들어옵니다.</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[3100] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onClick={onClose} role="dialog">
      <div className="flex w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-xl" style={{ maxHeight: "86vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-700">사용자(작성자) 선택</div>
            <div className="mt-0.5 text-[11px] font-bold leading-snug text-slate-400">이 기기에서 계속 이 이름으로 작성됩니다 · 관리 탭 인원 명단과 같은 명단</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs text-slate-500 transition hover:bg-slate-100">닫기</button>
        </div>
        <SsoRow value={value} onChange={onChange} />
        {/* 1단: 그룹(부서) */}
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-2">
          {[...depts, EXTERNAL_GROUP].map((d) => (
            <button key={d} type="button" onClick={() => { setDept(d); setTeam("__all"); setGroupEdit(null); setMoving(null); }}
              className={chip(dept === d, d === EXTERNAL_GROUP ? "bg-amber-100 text-amber-800 hover:bg-amber-200" : "")} style={dept === d ? { background: accent } : undefined}>
              {d}<span className="ml-1 opacity-60">{deptCount(d)}</span>
            </button>
          ))}
          <button type="button" onClick={() => setGroupEdit({ kind: "dept", mode: "new", text: "" })} className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">＋ 그룹</button>
        </div>
        {/* 2단: 소그룹(팀) */}
        {dept !== EXTERNAL_GROUP && (
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/60 px-3 py-1.5">
            <button type="button" onClick={() => { setTeam("__all"); setGroupEdit(null); }} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${team === "__all" ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>전체</button>
            {teams.filter((t) => t !== "" || teams.length > 1).map((t) => ( // 팀이 하나도 없는 부서(IT파트)는 "전체"만 — "부서 직속" 칩이 곧 전체라 소음
              <button key={t || "_none"} type="button" onClick={() => { setTeam(t); setGroupEdit(null); setMoving(null); }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${team === t ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
                {subLabel(dept, t)}<span className="ml-1 opacity-60">{teamCount(t)}</span>
              </button>
            ))}
            <button type="button" onClick={() => setGroupEdit({ kind: "team", mode: "new", text: "" })} className="rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">＋ 소그룹</button>
          </div>
        )}
        {/* 그룹 손질 도구 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-1.5 text-[11px]">
          {groupEdit ? (
            <>
              <span className="font-bold text-slate-500">{groupEdit.kind === "dept" ? "그룹" : "소그룹"} {groupEdit.mode === "new" ? "추가" : "이름 바꾸기"}</span>
              <input autoFocus value={groupEdit.text} onChange={(e) => setGroupEdit({ ...groupEdit, text: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyGroupEdit(); } if (e.key === "Escape") setGroupEdit(null); }}
                placeholder={groupEdit.mode === "new" ? (groupEdit.kind === "dept" ? "새 그룹 이름 (예: 영업2팀)" : "새 소그룹 이름 (예: F)") : "새 이름"}
                className="min-w-0 flex-1 rounded-lg border border-blue-300 px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-blue-500" />
              <button type="button" onClick={() => void applyGroupEdit()} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white">저장</button>
              <button type="button" onClick={() => setGroupEdit(null)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-500">취소</button>
            </>
          ) : dept === EXTERNAL_GROUP ? (
            <span className="font-bold text-amber-700">제조사·타사로 넘긴 AS 양식에 사람 대신 쓰는 작성자입니다 (고정 목록).</span>
          ) : (
            <>
              <span className="font-bold text-slate-500">{dept}{team !== "__all" ? ` · ${subLabel(dept, team)}` : ""}</span>
              {team === "__all" ? (
                <>
                  <button type="button" onClick={() => setGroupEdit({ kind: "dept", mode: "rename", text: dept })} className={smallBtn}>그룹 이름 바꾸기</button>
                  <button type="button" onClick={() => void deleteDept()} className={smallBtn}>그룹 삭제</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setGroupEdit({ kind: "team", mode: "rename", text: isCsCode(team) ? subLabel(dept, team) : team })} className={smallBtn}>소그룹 이름 바꾸기</button>
                  <button type="button" onClick={() => void deleteTeam()} className={smallBtn}>소그룹 삭제</button>
                  {isCsCode(team) && <span className="text-slate-400">글자 {team}는 배정 코드라 유지되고 표시명만 바뀝니다</span>}
                </>
              )}
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto py-1 pb-3">
          {dept !== EXTERNAL_GROUP && (
            <div className="flex gap-1.5 border-b border-slate-100 px-3 py-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                placeholder={`${dept}${team !== "__all" ? ` · ${subLabel(dept, team)}` : ""}에 인원 추가`} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
              <button type="button" onClick={add} className="rounded-lg bg-slate-700 px-3 text-xs font-bold text-white">추가</button>
            </div>
          )}
          {rows.map((row) => {
            const isActive = value === row.name;
            if (editing?.name === row.name) {
              return (
                <div key={row.name} className="flex items-center gap-1.5 border-b border-slate-50 px-3 py-2">
                  <input autoFocus value={editing.next} onChange={(e) => setEditing({ name: row.name, next: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void rename(); } if (e.key === "Escape") setEditing(null); }}
                    className="min-w-0 flex-1 rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
                  <button type="button" onClick={() => void rename()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">저장</button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">취소</button>
                </div>
              );
            }
            return (
              <div key={row.name} className="flex items-center border-b border-slate-50">
                <button type="button" onClick={() => { onChange(row.name); onClose(); }} className="min-w-0 flex-1 px-5 py-3 text-left text-sm transition active:bg-slate-100"
                  style={{ background: isActive ? accent : "transparent", color: isActive ? "white" : "#0F172A", fontWeight: isActive ? 600 : 400 }}>
                  {row.name}{row.member && team === "__all" && row.member.team ? <span className={`ml-2 text-[11px] ${isActive ? "text-white/70" : "text-slate-400"}`}>{subLabel(dept, row.member.team)}</span> : null}
                </button>
                {moving === row.name ? (
                  <select autoFocus defaultValue="" onChange={(e) => void move(row, e.target.value)} onBlur={() => setMoving(null)}
                    className="mx-2 my-1.5 max-w-[46%] rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold">
                    <option value="">옮길 그룹 · 소그룹…</option>
                    {moveTargets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                ) : row.member ? (
                  <>
                    <button type="button" onClick={() => setMoving(row.name)} title="다른 그룹·소그룹으로 이동" className="px-2 text-xs font-bold text-slate-500 hover:text-blue-600">이동</button>
                    <button type="button" onClick={() => setEditing({ name: row.name, next: row.name })} title="이름 고치기" className="px-2 text-xs font-bold text-slate-500 hover:text-blue-600">이름</button>
                    <button type="button" onClick={() => void remove(row)} className="px-3 text-xs font-bold text-rose-500">삭제</button>
                  </>
                ) : null}
              </div>
            );
          })}
          {!rows.length && <div className="px-5 py-6 text-center text-xs font-bold text-slate-400">{dept === EXTERNAL_GROUP ? "" : "인원이 없습니다 — 위 칸에 이름을 넣어 추가하거나, 다른 그룹에서 [이동]으로 옮겨 오세요"}</div>}
        </div>
      </div>
    </div>
  );
}

export function AuthorPicker({ value, onChange, accent }: AuthorPickerProps) {
  const [open, setOpen] = useState(false);
  const filled = value !== "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm outline-none transition active:scale-[0.99]"
        style={{
          background: "white",
          border: "1px solid #CBD5E1",
          borderLeft: filled ? `3px solid ${accent}` : "1px solid #CBD5E1",
          fontWeight: filled ? 600 : 400,
          color: filled ? "#0F172A" : "#64748B",
        }}
      >
        <span className="truncate">{filled ? value : "작성자 선택"}</span>
        {!authorLocked() && <ChevronDown size={14} className="ml-1 shrink-0 text-slate-400" />} {/* 그룹웨어 로그인 고정이면 "고르는" 화살표 없이 이름만(내 계정·로그아웃은 눌러서) 2026-10-19 */}
      </button>
      {open && <AuthorPickerModal value={value} onChange={onChange} accent={accent} onClose={() => setOpen(false)} />}
    </>
  );
}
