/**
 * 자기개발 허브 — 독서 · 배움/팁 공유 · 개인 목표 트래커.
 * 독서/배움공유는 reading_posts(kind)를 공유하고, 목표는 self_goals 테이블을 쓴다. (supabase/selfdev.sql)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import ReadingHub from "./ReadingHub";
import { kstDate } from "./visits";

type Tab = "home" | "reading" | "tips" | "goals";
const GOAL_CATEGORIES = ["자격증", "학습", "독서", "건강", "습관", "기타"] as const;
const fmtP = (votes: number) => (Math.round(votes * 2) / 10).toFixed(1); // 추천 1개 = 0.2P

type SelfGoal = {
  id: string; created_at: string; author: string; title: string; memo: string;
  target_date: string | null; done: boolean; done_at: string | null; category?: string;
};

type AnyPost = { id: string; created_at: string; author: string; title: string; content: string; kind?: string };
type AnyVote = { post_id: string; voter: string; created_at?: string };

// ── 대시보드: 포인트·활동·명예의 전당을 한눈에 ──
function DevDashboard({ author, onGo }: { author: string; onGo: (tab: Tab) => void }) {
  const [posts, setPosts] = useState<AnyPost[]>([]);
  const [votes, setVotes] = useState<AnyVote[]>([]);
  const [goals, setGoals] = useState<SelfGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      selectRows<AnyPost>("reading_posts", "select=*&order=created_at.desc&limit=300").catch(() => [] as AnyPost[]),
      selectRows<AnyVote>("reading_votes", "select=post_id,voter,created_at&limit=5000").catch(() => [] as AnyVote[]),
      selectRows<SelfGoal>("self_goals", "select=*&limit=500").catch(() => [] as SelfGoal[]),
    ]).then(([postRows, voteRows, goalRows]) => {
      if (!active) return;
      setPosts(postRows); setVotes(voteRows); setGoals(goalRows);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const ownerOf = useMemo(() => new Map(posts.map((p) => [p.id, p.author || "미지정"])), [posts]);
  const voteCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of votes) map.set(v.post_id, (map.get(v.post_id) || 0) + 1);
    return map;
  }, [votes]);
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthlyRank = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of votes) {
      if (String(v.created_at || "").slice(0, 7) !== monthKey) continue;
      const owner = ownerOf.get(v.post_id);
      if (owner) map.set(owner, (map.get(owner) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [votes, ownerOf, monthKey]);
  const hallOfFame = useMemo(() => {
    const byMonth = new Map<string, Map<string, number>>();
    for (const v of votes) {
      const month = String(v.created_at || "").slice(0, 7);
      if (!month || month === monthKey) continue; // 진행 중인 달은 제외
      const owner = ownerOf.get(v.post_id);
      if (!owner) continue;
      const inner = byMonth.get(month) || new Map<string, number>();
      inner.set(owner, (inner.get(owner) || 0) + 1);
      byMonth.set(month, inner);
    }
    return Array.from(byMonth.entries())
      .map(([month, inner]) => {
        const top = Array.from(inner.entries()).sort((a, b) => b[1] - a[1])[0];
        return { month, name: top[0], votes: top[1] };
      })
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 6);
  }, [votes, ownerOf, monthKey]);

  const myVotesReceived = useMemo(() => votes.filter((v) => ownerOf.get(v.post_id) === author).length, [votes, ownerOf, author]);
  const myPosts = posts.filter((p) => p.author === author).length;
  const myGoals = goals.filter((g) => g.author === author);
  const myGoalsDone = myGoals.filter((g) => g.done).length;
  const weekAgo = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); }, []);
  const weeklyNew = posts.filter((p) => p.created_at >= weekAgo).length;

  const dailyPick = (kind: string) => {
    const pool = posts.filter((p) => (p.kind || "reading") === kind)
      .sort((a, b) => (voteCount.get(b.id) || 0) - (voteCount.get(a.id) || 0))
      .slice(0, 10);
    if (!pool.length) return null;
    const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    return pool[seed % pool.length];
  };
  const readingPick = useMemo(() => dailyPick("reading"), [posts, voteCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const tipPick = useMemo(() => dailyPick("tip"), [posts, voteCount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>;

  return (
    <div className="space-y-4 pb-16">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-r from-indigo-700 via-violet-700 to-purple-700 p-5 text-white shadow-sm">
        <h2 className="text-xl font-black">🌱 자기개발 / 지식공유</h2>
        <p className="mt-1 text-xs font-semibold text-indigo-100">읽고, 나누고, 목표를 이루는 공간. 추천 1개 = 0.2P</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            [`${fmtP(myVotesReceived)}P`, "내 포인트"],
            [`${myPosts}`, "내가 쓴 글"],
            [`${myGoalsDone}/${myGoals.length}`, "목표 달성"],
            [`${weeklyNew}`, "이번 주 새 글"],
          ] as [string, string][]).map(([value, label]) => (
            <div key={label} className="rounded-lg bg-white/10 px-3 py-2.5 text-center">
              <div className="text-lg font-black">{value}</div>
              <div className="text-[10px] font-bold text-indigo-100">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {readingPick && <button type="button" onClick={() => onGo("reading")} className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white p-4 text-left shadow-sm">
          <div className="text-[10px] font-black text-amber-600">📖 오늘의 구절 {readingPick.title ? `· 《${readingPick.title}》` : ""}</div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-800">{readingPick.content}</p>
        </button>}
        {tipPick && <button type="button" onClick={() => onGo("tips")} className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-white p-4 text-left shadow-sm">
          <div className="text-[10px] font-black text-blue-600">💡 오늘의 팁 {tipPick.title ? `· ${tipPick.title}` : ""}</div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-800">{tipPick.content}</p>
        </button>}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-black text-slate-900">🔥 이번 달 포인트 랭킹</h3>
          <div className="mt-3 space-y-1.5">
            {!monthlyRank.length && <div className="py-6 text-center text-xs font-bold text-slate-400">이번 달 추천 기록이 아직 없어요.</div>}
            {monthlyRank.map(([name, count], index) => (
              <div key={name} className={`flex items-center justify-between rounded-md px-3 py-2 ${name === author ? "bg-violet-50 ring-1 ring-violet-200" : "bg-slate-50"}`}>
                <span className="text-xs font-black text-slate-700">{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {name}{name === author ? " (나)" : ""}</span>
                <span className="text-xs font-black text-violet-600">{fmtP(count)}P</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-black text-slate-900">🏛 명예의 전당 <span className="font-bold text-slate-400">— 월간 1위</span></h3>
          <div className="mt-3 space-y-1.5">
            {!hallOfFame.length && <div className="py-6 text-center text-xs font-bold text-slate-400">아직 마감된 달의 기록이 없어요.</div>}
            {hallOfFame.map((entry) => (
              <div key={entry.month} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                <span className="text-xs font-black text-slate-500">{Number(entry.month.slice(5, 7))}월</span>
                <span className="text-xs font-black text-slate-800">👑 {entry.name}</span>
                <span className="text-xs font-black text-amber-600">{fmtP(entry.votes)}P</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">🕘 최근 올라온 글</h3>
          <div className="flex gap-2">
            <button type="button" onClick={() => onGo("reading")} className="text-[11px] font-black text-blue-600">독서 →</button>
            <button type="button" onClick={() => onGo("tips")} className="text-[11px] font-black text-blue-600">배움·팁 →</button>
          </div>
        </div>
        <div className="mt-3 divide-y divide-slate-100">
          {posts.slice(0, 5).map((post) => (
            <button key={post.id} type="button" onClick={() => onGo((post.kind || "reading") === "tip" ? "tips" : "reading")} className="flex w-full items-center gap-2 py-2.5 text-left">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${(post.kind || "reading") === "tip" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"}`}>{(post.kind || "reading") === "tip" ? "팁" : "독서"}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{post.title ? `《${post.title}》 ` : ""}{post.content}</span>
              <span className="shrink-0 text-[10px] font-bold text-slate-400">👍 {voteCount.get(post.id) || 0}</span>
            </button>
          ))}
          {!posts.length && <div className="py-6 text-center text-xs font-bold text-slate-400">아직 글이 없어요.</div>}
        </div>
      </section>
    </div>
  );
}

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
  const [category, setCategory] = useState<string>("기타");
  const [categoryFilter, setCategoryFilter] = useState<string>("전체");
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

  const visible = useMemo(() => {
    const base = showAll ? goals : goals.filter((g) => g.author === author);
    return categoryFilter === "전체" ? base : base.filter((g) => (g.category || "기타") === categoryFilter);
  }, [goals, showAll, author, categoryFilter]);
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
      await insertRow("self_goals", { author, title: title.trim(), memo: memo.trim(), target_date: targetDate || null, category });
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
            <div className="mt-2 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_150px]">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-semibold">
                {GOAL_CATEGORIES.map((name) => <option key={name}>{name}</option>)}
              </select>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="목표 (예: 정보처리기사 필기 합격, 매주 책 1권)" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
            </div>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택)" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => void addGoal()} disabled={busy || !title.trim()} className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">{busy ? "추가 중…" : "목표 추가"}</button>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="rounded-md bg-slate-100 p-1">
              {([[false, "내 목표"], [true, "전체 보기"]] as [boolean, string][]).map(([all, label]) => (
                <button key={label} type="button" onClick={() => setShowAll(all)} className={`rounded px-3 py-1.5 text-xs font-black ${showAll === all ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {["전체", ...GOAL_CATEGORIES].map((name) => (
                <button key={name} type="button" onClick={() => setCategoryFilter(name)} className={`rounded px-2 py-1 text-[11px] font-black ${categoryFilter === name ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>
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
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-black text-emerald-600">{goal.category || "기타"}</span>
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
  const [tab, setTab] = useState<Tab>("home");
  return (
    <div className="space-y-4">
      <div className="flex w-fit flex-wrap gap-1 rounded-md bg-slate-100 p-1">
        {([["home", "🏠 홈"], ["reading", "📚 독서"], ["tips", "💡 배움·팁"], ["goals", "🎯 목표"]] as [Tab, string][]).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`rounded px-3.5 py-2 text-sm font-black ${tab === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
        ))}
      </div>
      {tab === "home" && <DevDashboard author={author} onGo={setTab} />}
      {tab === "reading" && <ReadingHub author={author} kind="reading" />}
      {tab === "tips" && <ReadingHub author={author} kind="tip" />}
      {tab === "goals" && <GoalsBoard author={author} />}
    </div>
  );
}
