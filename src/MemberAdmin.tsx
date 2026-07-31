import { useEffect, useMemo, useState } from "react";
import { UserPlus, UserRound, Undo2 } from "lucide-react";
import { AUTHOR_TEAMS, addMember, fetchMembers, moveMemberTeam, restoreMember, retireMember, type AuthorTeam, type MemberRow } from "./authors";
import PortalSelect from "./PortalSelect";

/**
 * 인원 관리 — 신입 등록·팀 이동·퇴사 처리.
 *
 * 퇴사는 행을 지우지 않고 재직 여부만 내린다. 과거 점검·AS 기록에 작성자명이
 * 그대로 남아 있어야 집계가 깨지지 않는다. 명단에서만 빠진다.
 */
export default function MemberAdmin() {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const [draft, setDraft] = useState<{ name: string; team: AuthorTeam; joined: string }>({ name: "", team: "A", joined: new Date().toISOString().slice(0, 10) });
  const [adding, setAdding] = useState(false);

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
  const byTeam = useMemo(() => {
    const map = new Map<AuthorTeam, MemberRow[]>();
    for (const team of AUTHOR_TEAMS) map.set(team, active.filter((row) => row.team === team));
    return map;
  }, [active]);

  const submit = async () => {
    if (!draft.name.trim() || adding) return;
    setAdding(true);
    try {
      await addMember(draft.team, draft.name, draft.joined);
      setDraft({ ...draft, name: "" });
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

  const teamLabel = (team: AuthorTeam) => (team === "팀장" ? "팀장" : `${team}팀`);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <div>
            <h3 className="text-base font-black text-slate-950 lg:text-lg">인원 관리</h3>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">여기서 바꾸면 모든 화면의 작성자·담당자 목록에 함께 반영됩니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black tabular-nums text-slate-500">재직 {active.length}명</span>
            {left.length > 0 && <button type="button" onClick={() => setShowLeft((current) => !current)} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-500 transition hover:bg-slate-50">퇴사 {left.length}명 {showLeft ? "숨기기" : "보기"}</button>}
          </div>
        </div>

        {/* 신입 등록 */}
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <label className="text-[11px] font-black text-slate-500">이름
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="신입 이름" className="mt-1 block w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <label className="text-[11px] font-black text-slate-500">소속
            <span className="mt-1 block"><PortalSelect width={130} value={draft.team} onChange={(next) => setDraft({ ...draft, team: next as AuthorTeam })}
              options={AUTHOR_TEAMS.map((team) => ({ value: team, label: teamLabel(team) }))} /></span>
          </label>
          <label className="text-[11px] font-black text-slate-500">입사일
            <input type="date" value={draft.joined} onChange={(e) => setDraft({ ...draft, joined: e.target.value })}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <button type="button" onClick={() => void submit()} disabled={!draft.name.trim() || adding}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">
            <UserPlus size={15} />{adding ? "등록 중…" : "인원 추가"}
          </button>
        </div>

        {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}
        {loading && <div className="p-10 text-center text-sm font-bold text-slate-400">명단을 불러오는 중…</div>}

        {!loading && <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {AUTHOR_TEAMS.map((team) => {
            const list = byTeam.get(team) || [];
            return (
              <div key={team} className="bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                  <span className="text-xs font-black text-slate-700">{teamLabel(team)}</span>
                  <span className="text-[11px] font-bold tabular-nums text-slate-400">{list.length}명</span>
                </div>
                <div className="divide-y divide-slate-50">
                  {list.map((row) => (
                    <div key={row.id} className="flex items-center gap-2 px-4 py-2.5">
                      <UserRound size={15} className="shrink-0 text-slate-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black text-slate-900">{row.name}</span>
                        {row.joined_on && <span className="block text-[10px] font-bold tabular-nums text-slate-400">{row.joined_on} 입사</span>}
                      </span>
                      <PortalSelect width={120} className="shrink-0 !py-1 text-[11px]" value={row.team} onChange={(next) => void act(row.id, () => moveMemberTeam(row.id, next as AuthorTeam))}
                        options={AUTHOR_TEAMS.map((option) => ({ value: option, label: teamLabel(option) }))} />
                      <button type="button" disabled={busyId === row.id}
                        onClick={() => { if (window.confirm(`${row.name} 님을 퇴사 처리할까요?\n\n명단에서만 빠지고 과거 기록은 그대로 남습니다.`)) void act(row.id, () => retireMember(row.id)); }}
                        className="shrink-0 rounded-full px-2 py-1 text-[11px] font-black text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40">퇴사</button>
                    </div>
                  ))}
                  {!list.length && <div className="px-4 py-6 text-center text-[11px] font-bold text-slate-300">인원 없음</div>}
                </div>
              </div>
            );
          })}
        </div>}
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
                  <span className="block truncate text-sm font-black text-slate-500">{row.name} <span className="text-[11px] font-bold text-slate-400">{teamLabel(row.team)}</span></span>
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
    </div>
  );
}
