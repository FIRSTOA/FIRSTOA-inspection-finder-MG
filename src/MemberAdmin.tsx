import { Fragment, useEffect, useMemo, useState } from "react";
import { Pencil, Search, UserPlus, UserRound, Undo2 } from "lucide-react";
import { addMember, displayTitle, fetchMembers, restoreMember, retireMember, updateMember, type MemberRow } from "./authors";
import FormModal from "./FormModal";
import PortalSelect from "./PortalSelect";

/**
 * 인원 관리 — 회사 전체 명단을 ERP식 한 표로.
 *
 * [다크 툴바: 검색 + 부서 필터] 아래 테이블. 전체 보기에선 부서 구분행 → 팀 구분행의
 * 2단으로 나뉘고, 부서를 고르면 팀 구분행만 남는다 (CS팀 A/B/C/D가 바로 나뉘어 보이게).
 * CS팀의 팀장/A~D 값은 작성자 명단·일정 팀 필터가 그대로 쓰므로 바꾸면 즉시 반영된다.
 * 퇴사는 행을 지우지 않고 재직 여부만 내린다 — 과거 기록의 이름이 살아 있어야 집계가 안 깨진다.
 */
const DEPTS = ["임원", "CS팀", "영업팀", "CSS·운영지원"] as const;
const TEAM_OPTIONS: Record<string, string[]> = {
  "임원": [""],
  "CS팀": ["팀장", "A", "B", "C", "D", "A·B"],
  "영업팀": ["", "전략영업", "IT"],
  "CSS·운영지원": ["", "운영지원", "CSS", "경영지원", "지원(비정규)"],
};
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
  return dept === "CS팀" && team.length === 1 ? `${team}팀` : team;
}

/** 입사일 → "N년 M개월" (미래·파싱 불가면 빈값) */
function tenure(joined: string | null | undefined, today: Date): string {
  if (!joined) return "";
  const start = new Date(joined);
  if (Number.isNaN(start.getTime())) return "";
  let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  if (today.getDate() < start.getDate()) months -= 1;
  if (months < 0) return "";
  const years = Math.floor(months / 12);
  return years > 0 ? `${years}년 ${months % 12}개월` : `${months % 12}개월`;
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
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState({ name: "", dept: "CS팀" as string, team: "A", title: "", joined: new Date().toISOString().slice(0, 10) });
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const today = useMemo(() => new Date(), []);

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
    for (const dept of DEPTS) {
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
  }, [active, deptFilter, search]);

  const submit = async () => {
    if (!draft.name.trim() || adding) return;
    setAdding(true);
    try {
      await addMember(draft.team, draft.name, draft.joined, draft.dept, draft.title);
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
      <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold tabular-nums text-slate-500">{row.joined_on || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold tabular-nums text-slate-400">{tenure(row.joined_on, today)}</td>
      <td className="px-4 py-2">
        <span className="flex items-center justify-end gap-1">
          <button type="button" title="정보 수정" disabled={busyId === row.id}
            onClick={() => setEdit({ row, dept: row.dept, team: row.team, teamCustom: !(TEAM_OPTIONS[row.dept] || []).includes(row.team), title: row.title })}
            className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 lg:opacity-0 lg:group-hover:opacity-100">
            <Pencil size={13} />
          </button>
          <button type="button" disabled={busyId === row.id}
            onClick={() => { if (window.confirm(`${row.name} 님을 퇴사 처리할까요?\n\n명단에서만 빠지고 과거 기록은 그대로 남습니다.`)) void act(row.id, () => retireMember(row.id)); }}
            className="whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-black text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40 lg:opacity-0 lg:group-hover:opacity-100">퇴사</button>
        </span>
      </td>
    </tr>
  );

  const divider = (label: string, count: number, strong = false) => (
    <tr>
      <td colSpan={7} className={strong
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
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">부서 칩으로 거르고, 행에 마우스를 올리면 ✎ 수정·퇴사가 나타납니다. 직책이 없으면 "프로".</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black tabular-nums text-slate-300">재직 {active.length}명</span>
            {left.length > 0 && <button type="button" onClick={() => setShowLeft((current) => !current)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-black text-slate-300 transition hover:bg-white/10">퇴사 {left.length}명 {showLeft ? "숨기기" : "보기"}</button>}
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
        </div>

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
                  <th className="px-4 py-2.5">입사일</th>
                  <th className="px-4 py-2.5">근속</th>
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
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-xs font-bold text-slate-300">
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
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">과거 기록 보존을 위해 명단에만 빠져 있습니다. 재입사 시 복구하세요.</p>
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
                  options={(TEAM_OPTIONS[draft.dept] || [""]).map((team) => ({ value: team, label: team || "(없음)" }))} /></span>
              </div>
              <div className="text-xs font-bold text-slate-500">직책
                <span className="mt-1 block"><PortalSelect width={170} value={draft.title} onChange={(next) => setDraft({ ...draft, title: next })}
                  options={TITLES.map((title) => ({ value: title, label: title || "프로 (기본)" }))} /></span>
              </div>
              <label className="text-xs font-bold text-slate-500">입사일
                <input type="date" value={draft.joined} onChange={(e) => setDraft({ ...draft, joined: e.target.value })} onClick={(e) => e.currentTarget.showPicker?.()}
                  className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
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
                  options={[...(TEAM_OPTIONS[edit.dept] || [""]).map((team) => ({ value: team, label: team || "(없음)" })), { value: "__custom", label: "직접 입력…" }]} />
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
