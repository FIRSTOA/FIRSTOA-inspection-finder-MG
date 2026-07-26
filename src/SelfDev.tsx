/**
 * 자기개발 허브 — 독서 · 배움/팁 공유 · 개인 목표 트래커.
 * 독서/배움공유는 reading_posts(kind)를 공유하고, 목표는 self_goals 테이블을 쓴다. (supabase/selfdev.sql)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import ReadingHub from "./ReadingHub";
import { kstDate } from "./visits";

type Tab = "reading" | "tips" | "goals";

type SelfGoal = {
  id: string; created_at: string; author: string; title: string; memo: string;
  target_date: string | null; done: boolean; done_at: string | null;
};

function dday(target: string | null) {
  if (!target) return "";
  const diff = Math.round((new Date(`${target}T00:00:00`).getTime() - new Date(`${kstDate()}T00:00:00`).getTime()) / 86_400_000);
  if (diff === 0) return "D-DAY";
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

function GoalsBoard({ author }: { author: string }) {
  const [goals, setGoals] = useState<SelfGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setGoals(await selectRows<SelfGoal>("self_goals", "select=*&order=done.asc,target_date.asc.nullslast,created_at.desc&limit=500"));
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/selfdev.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => showAll ? goals : goals.filter((g) => g.author === author), [goals, showAll, author]);
  const mine = useMemo(() => goals.filter((g) => g.author === author), [goals, author]);
  const myDone = mine.filter((g) => g.done).length;
  const teamStats = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const g of goals) {
      const entry = map.get(g.author) || { total: 0, done: 0 };
      entry.total += 1;
      if (g.done) entry.done += 1;
      map.set(g.author, entry);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].done - a[1].done);
  }, [goals]);

  const addGoal = async () => {
    if (busy || !title.trim()) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    setBusy(true);
    try {
      await insertRow("self_goals", { author, title: title.trim(), memo: memo.trim(), target_date: targetDate || null });
      setTitle(""); setMemo(""); setTargetDate("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async (goal: SelfGoal) => {
    if (goal.author !== author) return;
    const done = !goal.done;
    setGoals((current) => current.map((g) => g.id === goal.id ? { ...g, done, done_at: done ? new Date().toISOString() : null } : g));
    try {
      await updateRows("self_goals", `id=eq.${goal.id}`, { done, done_at: done ? new Date().toISOString() : null });
    } catch {
      await load();
    }
  };

  const removeGoal = async (goal: SelfGoal) => {
    if (goal.author !== author) return;
    if (!window.confirm(`"${goal.title}" 목표를 삭제할까요?`)) return;
    try {
      await deleteRows("self_goals", `id=eq.${goal.id}`);
      setGoals((current) => current.filter((g) => g.id !== goal.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4 pb-16">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">🎯 나의 목표</h2>
            <p className="mt-1 text-xs font-semibold text-emerald-100">자격증·스터디·습관 — 개인 목표를 걸고 완료를 쌓아가세요.</p>
          </div>
          <div className="flex gap-4 text-center">
            <div><div className="text-lg font-black">{mine.length}</div><div className="text-[10px] font-bold text-emerald-100">내 목표</div></div>
            <div><div className="text-lg font-black">{myDone}</div><div className="text-[10px] font-bold text-emerald-100">완료</div></div>
            <div><div className="text-lg font-black">{mine.length ? Math.round((myDone / mine.length) * 100) : 0}%</div><div className="text-[10px] font-bold text-emerald-100">달성률</div></div>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-black text-slate-400">새 목표 추가</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="목표 (예: 정보처리기사 필기 합격, 매주 책 1권)" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
            </div>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택)" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => void addGoal()} disabled={busy || !title.trim()} className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">{busy ? "추가 중…" : "목표 추가"}</button>
            </div>
          </section>

          <div className="flex items-center justify-between">
            <div className="rounded-md bg-slate-100 p-1">
              {([[false, "내 목표"], [true, "전체 보기"]] as [boolean, string][]).map(([all, label]) => (
                <button key={label} type="button" onClick={() => setShowAll(all)} className={`rounded px-3 py-1.5 text-xs font-black ${showAll === all ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </div>
          </div>

          {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {!loading && !visible.length && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">{showAll ? "등록된 목표가 없어요." : "아직 목표가 없어요. 첫 목표를 걸어보세요."}</div>}
          {visible.map((goal) => {
            const mineGoal = goal.author === author;
            const ddayLabel = dday(goal.target_date);
            const overdue = !goal.done && ddayLabel.startsWith("D+");
            return (
              <article key={goal.id} className={`flex items-start gap-3 rounded-xl border p-4 shadow-sm ${goal.done ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
                <button type="button" disabled={!mineGoal} onClick={() => void toggleDone(goal)} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black transition ${goal.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400"} ${mineGoal ? "" : "cursor-default opacity-60"}`}>✓</button>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-black ${goal.done ? "text-emerald-700 line-through" : "text-slate-900"}`}>{goal.title}</div>
                  {goal.memo && <div className="mt-0.5 text-xs font-semibold text-slate-500">{goal.memo}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                    {showAll && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-black text-slate-600">{goal.author}</span>}
                    {goal.target_date && <span>목표일 {goal.target_date}</span>}
                    {ddayLabel && !goal.done && <span className={`rounded px-1.5 py-0.5 font-black ${overdue ? "bg-rose-100 text-rose-600" : "bg-blue-50 text-blue-600"}`}>{ddayLabel}</span>}
                    {goal.done && goal.done_at && <span className="text-emerald-600">완료 {goal.done_at.slice(0, 10)}</span>}
                  </div>
                </div>
                {mineGoal && <button type="button" onClick={() => void removeGoal(goal)} className="shrink-0 text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>}
              </article>
            );
          })}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6">
          <h3 className="text-sm font-black text-slate-900">🏁 달성 현황</h3>
          <p className="mt-0.5 text-[10px] font-bold text-slate-400">완료한 목표 수 기준. 서로 자극이 되어주세요.</p>
          <div className="mt-3 space-y-1.5">
            {!teamStats.length && <div className="py-6 text-center text-xs font-bold text-slate-400">아직 목표 기록이 없어요.</div>}
            {teamStats.map(([name, stat], index) => (
              <div key={name} className={`flex items-center justify-between rounded-md px-3 py-2 ${name === author ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-slate-50"}`}>
                <span className="text-xs font-black text-slate-700">{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {name}{name === author ? " (나)" : ""}</span>
                <span className="text-xs font-black text-emerald-600">{stat.done}/{stat.total}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function SelfDevHub({ author }: { author: string }) {
  const [tab, setTab] = useState<Tab>("reading");
  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-md bg-slate-100 p-1">
        {([["reading", "📚 독서"], ["tips", "💡 배움·팁 공유"], ["goals", "🎯 목표"]] as [Tab, string][]).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`rounded px-4 py-2 text-sm font-black ${tab === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
        ))}
      </div>
      {tab === "reading" && <ReadingHub author={author} kind="reading" />}
      {tab === "tips" && <ReadingHub author={author} kind="tip" />}
      {tab === "goals" && <GoalsBoard author={author} />}
    </div>
  );
}
