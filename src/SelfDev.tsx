/**
 * 자기개발 허브 — 독서 · 배움/팁 공유 · 개인 목표 트래커.
 * 독서/배움공유는 reading_posts(kind)를 공유하고, 목표는 self_goals 테이블을 쓴다. (supabase/selfdev.sql)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import ReadingHub from "./ReadingHub";
import { kstDate } from "./visits";
import { AUTHOR_TEAMS, displayTitle, useAuthorBook, useMembers } from "./authors";
import PortalSelect from "./PortalSelect";

type Tab = "home" | "reading" | "tips" | "goals" | "praise";
const GOAL_CATEGORIES = ["자격증", "학습", "독서", "건강", "습관", "기타"] as const;
const fmtP = (votes: number) => (Math.round(votes * 2) / 10).toFixed(1); // 추천 1개 = 0.2P
// 책 제목으로 정해지는 표지 색 — 이미지 없이도 책장 느낌을 낸다
const COVER_TONES = ["from-blue-600 to-indigo-700", "from-emerald-600 to-teal-700", "from-rose-500 to-pink-600", "from-amber-500 to-orange-600", "from-violet-600 to-purple-700", "from-slate-700 to-slate-900"];
const coverTone = (title: string) => COVER_TONES[[...title].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COVER_TONES.length];
// 아바타 이니셜 — 성 빼고 이름 두 글자("한지우"→"지우"), 두 글자 이하는 그대로
const initials = (name: string) => (name.length > 2 ? name.slice(-2) : name);

/** 달성률 도넛 링 */
function Ring({ percent, size = 52, stroke = 6 }: { percent: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (circumference * Math.max(0, Math.min(100, percent))) / 100;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E2E8F0" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#2563EB" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${filled} ${circumference}`} className="transition-all" />
    </svg>
  );
}

type SelfGoal = {
  id: string; created_at: string; author: string; title: string; memo: string;
  target_date: string | null; done: boolean; done_at: string | null; category?: string;
  start_date?: string | null; progress?: number;
};

type AnyPost = { id: string; created_at: string; author: string; title: string; content: string; kind?: string; cover_url?: string };
type PraisePost = { id: string; created_at: string; from_author: string; to_name: string; content: string };
type AnyVote = { post_id: string; voter: string; created_at?: string };

// ── 대시보드: 포인트·활동·명예의 전당을 한눈에 ──
function DevDashboard({ author, onGo }: { author: string; onGo: (tab: Tab) => void }) {
  const [posts, setPosts] = useState<AnyPost[]>([]);
  const [votes, setVotes] = useState<AnyVote[]>([]);
  const [goals, setGoals] = useState<SelfGoal[]>([]);
  const [praises, setPraises] = useState<PraisePost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      selectRows<AnyPost>("reading_posts", "select=*&order=created_at.desc&limit=300").catch(() => [] as AnyPost[]),
      selectRows<AnyVote>("reading_votes", "select=post_id,voter,created_at&limit=5000").catch(() => [] as AnyVote[]),
      selectRows<SelfGoal>("self_goals", "select=*&limit=500").catch(() => [] as SelfGoal[]),
      selectRows<PraisePost>("praise_posts", "select=*&order=created_at.desc&limit=100").catch(() => [] as PraisePost[]),
    ]).then(([postRows, voteRows, goalRows, praiseRows]) => {
      if (!active) return;
      setPosts(postRows); setVotes(voteRows); setGoals(goalRows); setPraises(praiseRows);
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

  const dailyPick = (kind: string) => {
    const pool = posts.filter((p) => (p.kind || "reading") === kind)
      .sort((a, b) => (voteCount.get(b.id) || 0) - (voteCount.get(a.id) || 0))
      .slice(0, 10);
    if (!pool.length) return null;
    const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    return pool[seed % pool.length];
  };
  const readingPick = useMemo(() => dailyPick("reading"), [posts, voteCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const myPraiseCount = praises.filter((p) => p.to_name === author).length;
  const myRecentPraises = praises.filter((p) => p.to_name === author).slice(0, 3);
  const feedPraises = praises.slice(0, 4);
  const topActiveGoal = [...myGoals.filter((g) => !g.done)].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0];
  const recentDoneGoals = [...myGoals.filter((g) => g.done)].sort((a, b) => String(b.done_at || "").localeCompare(String(a.done_at || ""))).slice(0, 2);
  const books = useMemo(() => {
    const seen = new Set<string>();
    const out: AnyPost[] = [];
    for (const post of posts) {
      if ((post.kind || "reading") !== "reading" || !post.title.trim()) continue;
      const key = post.title.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(post);
      if (out.length >= 4) break;
    }
    return out;
  }, [posts]);
  const tips = useMemo(() => posts.filter((post) => post.kind === "tip").slice(0, 4), [posts]);

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>;

  const widgetHead = (title: string, action: string, go: Tab) => (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-black text-slate-950">{title}</h3>
      <button type="button" onClick={() => onGo(go)} className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-600 transition hover:bg-blue-100">{action}</button>
    </div>
  );
  const miniCard = "block w-full rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-left transition hover:border-slate-200 hover:bg-slate-50";

  return (
    <div className="space-y-4 pb-16">
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {/* 나의 성장 대시보드 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {widgetHead("🌱 나의 성장 대시보드", "목표 관리", "goals")}
          <div className="grid grid-cols-2 gap-2 p-3.5">
            <button type="button" onClick={() => onGo("goals")} className={miniCard}>
              <div className="text-[10px] font-black text-slate-400">내 목표 달성</div>
              <div className="mt-1.5 flex items-center gap-2.5">
                <span className="relative inline-flex shrink-0">
                  <Ring percent={myGoals.length ? Math.round((myGoalsDone / myGoals.length) * 100) : 0} />
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black tabular-nums text-slate-800">{myGoals.length ? Math.round((myGoalsDone / myGoals.length) * 100) : 0}%</span>
                </span>
                <span className="min-w-0">
                  <div className="text-lg font-black tabular-nums text-slate-950">{myGoalsDone}<span className="text-xs font-black text-slate-400">/{myGoals.length}</span></div>
                  {topActiveGoal ? <div className="truncate text-[10px] font-bold text-slate-500">{topActiveGoal.title} · {topActiveGoal.progress ?? 0}%</div> : <div className="text-[10px] font-bold text-slate-400">진행 중 없음</div>}
                </span>
              </div>
            </button>
            <button type="button" onClick={() => onGo("praise")} className={miniCard}>
              <div className="text-[10px] font-black text-slate-400">내가 받은 칭찬</div>
              <div className="mt-1 text-xl font-black tabular-nums text-slate-950">{myPraiseCount}</div>
              {myRecentPraises.length ? <div className="mt-1.5 flex items-center">
                <span className="flex -space-x-1.5">{myRecentPraises.map((praise) => <span key={praise.id} className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-[9px] font-black text-amber-700 ring-2 ring-white">{initials(praise.from_author || "?").slice(0, 2)}</span>)}</span>
                <span className="ml-1.5 text-[10px] font-bold text-slate-400">최근 {myRecentPraises.length}건</span>
              </div> : <div className="mt-1.5 text-[10px] font-bold text-slate-400">아직 없음 — 먼저 칭찬해 보세요</div>}
            </button>
            <button type="button" onClick={() => onGo("goals")} className={miniCard}>
              <div className="text-[10px] font-black text-slate-400">달성 목표</div>
              {recentDoneGoals.length ? <div className="mt-1.5 flex flex-wrap gap-1">
                {recentDoneGoals.map((goal) => <span key={goal.id} className="max-w-full truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">✓ {goal.title}</span>)}
              </div> : <div className="mt-1 text-xl font-black tabular-nums text-slate-950">0</div>}
            </button>
            <button type="button" onClick={() => onGo("tips")} className={miniCard}>
              <div className="text-[10px] font-black text-slate-400">배움·팁 포인트</div>
              <div className="mt-1 text-xl font-black tabular-nums text-violet-600">{fmtP(myVotesReceived)}P</div>
              <div className="mt-1.5 text-[10px] font-bold text-slate-400">내가 쓴 글 {myPosts} · 받은 추천 {myVotesReceived}</div>
            </button>
          </div>
        </section>

        {/* 독서 책장 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {widgetHead("📚 독서 — 최근 책장", "+ 새 글 쓰기", "reading")}
          {books.length ? (
            <div className="grid grid-cols-4 gap-3 p-4">
              {books.map((book) => (
                <button key={book.id} type="button" onClick={() => onGo("reading")} className="group text-left">
                  {book.cover_url ? (
                    <img src={book.cover_url} alt={book.title} loading="lazy" className="aspect-[3/4] w-full rounded-lg object-cover shadow-md transition group-hover:-translate-y-0.5 group-hover:shadow-lg" />
                  ) : (
                    <div className={`flex aspect-[3/4] items-center justify-center rounded-lg bg-gradient-to-br p-2 shadow-md transition group-hover:-translate-y-0.5 group-hover:shadow-lg ${coverTone(book.title)}`}>
                      <span className="line-clamp-4 text-center text-[11px] font-black leading-4 text-white">{book.title}</span>
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center justify-between px-0.5">
                    <span className="text-[10px] font-bold tabular-nums text-slate-400">{book.created_at.slice(5, 10)}</span>
                    <span className="shrink-0 text-[10px] font-black tabular-nums text-amber-600">👍 {voteCount.get(book.id) || 0}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : <div className="p-8 text-center text-xs font-bold text-slate-400">책 제목이 담긴 글이 아직 없어요 — 첫 구절을 남겨보세요.</div>}
          {readingPick && <button type="button" onClick={() => onGo("reading")} className="block w-full border-t border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50">
            <span className="text-[10px] font-black tracking-wide text-amber-600">📖 오늘의 구절{readingPick.title ? ` · 《${readingPick.title}》` : ""}</span>
            <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">{readingPick.content}</p>
          </button>}
        </section>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {/* 칭찬 릴레이 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {widgetHead("💖 칭찬 릴레이", "나도 칭찬하기", "praise")}
          <div className="divide-y divide-slate-50">
            {!feedPraises.length && <div className="p-8 text-center text-xs font-bold text-slate-400">아직 칭찬이 없어요. 첫 칭찬의 주인공을 만들어 주세요.</div>}
            {feedPraises.map((praise) => (
              <div key={praise.id} className="flex items-start gap-2.5 px-4 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-black text-amber-700">{initials(praise.to_name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-5"><span className="font-black text-slate-500">{praise.from_author || "익명"}</span> <span className="text-slate-300">→</span> <b className="font-black text-slate-900">{praise.to_name}</b></span>
                  <span className="block truncate text-xs font-semibold text-slate-600">{praise.content}</span>
                </span>
                <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-300">{praise.created_at.slice(5, 10)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 지식창고 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {widgetHead("💡 지식창고 — 배움·팁", "+ 새 팁 등록", "tips")}
          {tips.length ? (
            <div className="grid grid-cols-1 gap-2 p-3.5 sm:grid-cols-2">
              {tips.map((tip) => (
                <button key={tip.id} type="button" onClick={() => onGo("tips")} className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-200 hover:shadow">
                  {tip.title && <div className="truncate text-xs font-black text-slate-900">{tip.title}</div>}
                  <p className={`${tip.title ? "mt-1 " : ""}line-clamp-3 text-[11px] font-semibold leading-5 text-slate-600`}>{tip.content}</p>
                  <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-slate-400">
                    <span className="tabular-nums">{tip.created_at.slice(5, 10)}</span>
                    <span className="font-black tabular-nums text-blue-600">👍 {voteCount.get(tip.id) || 0}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : <div className="p-8 text-center text-xs font-bold text-slate-400">아직 팁이 없어요 — 오늘 배운 것 하나를 남겨보세요.</div>}
        </section>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {widgetHead("🏆 이번 달 포인트 랭킹", "글 쓰러 가기", "reading")}
          <div className="space-y-1.5 p-4">
            {!monthlyRank.length && <div className="py-4 text-center text-xs font-bold text-slate-400">이번 달 추천 기록이 아직 없어요.</div>}
            {monthlyRank.map(([name, count], index) => (
              <div key={name} className={`flex items-center justify-between rounded-lg px-3 py-2 ${name === author ? "bg-violet-50 ring-1 ring-violet-200" : "bg-slate-50"}`}>
                <span className="text-xs font-black text-slate-700">{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {name}{name === author ? " (나)" : ""}</span>
                <span className="text-xs font-black tabular-nums text-violet-600">{fmtP(count)}P</span>
              </div>
            ))}
          </div>
        </section>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {widgetHead("🏛 명예의 전당 — 월간 1위", "포인트 쌓기", "tips")}
          <div className="space-y-1.5 p-4">
            {!hallOfFame.length && <div className="py-4 text-center text-xs font-bold text-slate-400">아직 마감된 달의 기록이 없어요.</div>}
            {hallOfFame.map((entry) => (
              <div key={entry.month} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-black tabular-nums text-slate-500">{Number(entry.month.slice(5, 7))}월</span>
                <span className="text-xs font-black text-slate-800">👑 {entry.name}</span>
                <span className="text-xs font-black tabular-nums text-amber-600">{fmtP(entry.votes)}P</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function dday(target: string | null) {
  if (!target) return "";
  const diff = Math.round((new Date(`${target}T00:00:00`).getTime() - new Date(`${kstDate()}T00:00:00`).getTime()) / 86_400_000);
  if (diff === 0) return "D-DAY";
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}


// 칭찬 릴레이 — 익명으로 동료를 칭찬. 받은 칭찬은 월간 칭찬왕으로 집계.
function PraiseBoard({ author }: { author: string }) {
  const { book } = useAuthorBook();
  const members = useMembers();
  const [rows, setRows] = useState<PraisePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toName, setToName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [filterTo, setFilterTo] = useState("전체");
  const [filterFrom, setFilterFrom] = useState("전체");
  const [editId, setEditId] = useState("");
  const [editContent, setEditContent] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await selectRows<PraisePost>("praise_posts", "select=*&order=created_at.desc&limit=300"));
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/selfdev-social.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthlyKing = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.created_at.slice(0, 7) !== monthKey) continue;
      map.set(row.to_name, (map.get(row.to_name) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows, monthKey]);
  const myReceived = rows.filter((row) => row.to_name === author).length;
  const people = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) { if (row.to_name) names.add(row.to_name); if (row.from_author) names.add(row.from_author); }
    return Array.from(names).sort();
  }, [rows]);
  const visibleRows = useMemo(() => rows.filter((row) =>
    (filterTo === "전체" || row.to_name === filterTo) && (filterFrom === "전체" || row.from_author === filterFrom)), [rows, filterTo, filterFrom]);
  // 받는 사람: 부서 먼저 → 해당 부서 이름만 (52명 전체 스크롤 방지)
  const depts = useMemo(() => {
    const order = ["임원", "CS팀", "영업팀", "CSS·운영지원"];
    const set = new Set(members.filter((m) => m.active).map((m) => m.dept).filter(Boolean));
    return [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [members]);
  const [praiseDept, setPraiseDept] = useState("CS팀");
  const nameOptions = useMemo(() => {
    const active = members.filter((m) => m.active && m.name !== author && m.dept === praiseDept);
    if (active.length) return active.map((m) => ({ value: m.name, label: m.name, group: m.team || undefined, hint: displayTitle(m) }));
    return AUTHOR_TEAMS.flatMap((team) => (book[team] || []).filter((name) => name !== author).map((name) => ({ value: name, label: name, group: `${team}팀` })));
  }, [members, book, author, praiseDept]);

  const saveEditPraise = async () => {
    if (!editContent.trim()) return;
    try {
      await updateRows("praise_posts", `id=eq.${editId}`, { content: editContent.trim() });
      setRows((current) => current.map((row) => row.id === editId ? { ...row, content: editContent.trim() } : row));
      setEditId("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const removePraise = async (row: PraisePost) => {
    if (row.from_author !== author) return;
    if (!window.confirm("이 칭찬을 삭제할까요?")) return;
    try {
      await deleteRows("praise_posts", `id=eq.${row.id}`);
      setRows((current) => current.filter((r) => r.id !== row.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    if (busy || !toName || !content.trim()) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    if (toName === author) { setError("자기 자신 칭찬은 셀프라 무효입니다 🙂 동료를 칭찬해 주세요."); return; }
    setBusy(true);
    setError("");
    try {
      await insertRow("praise_posts", { from_author: author, to_name: toName, content: content.trim() });
      setContent("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-16">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-black text-slate-500">💌 칭찬 보내기 <span className="font-bold text-slate-300">— 보낸 사람 이름이 함께 표시됩니다</span></div>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black tabular-nums text-amber-700">내가 받은 칭찬 {myReceived}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {depts.length > 0 && <PortalSelect width={135} value={praiseDept} onChange={(dept) => { setPraiseDept(dept); setToName(""); }} options={depts.map((dept) => ({ value: dept, label: dept }))} />}
              <PortalSelect width={150} value={toName} onChange={setToName} placeholder="받는 사람" options={nameOptions} />
              <input value={content} onChange={(e) => setContent(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} placeholder="어떤 점이 좋았는지 구체적으로 (예: 어제 무거운 기기 옮기는 것 도와줘서 감사!)" className="min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              <button type="button" onClick={() => void submit()} disabled={busy || !toName || !content.trim()} className="shrink-0 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{busy ? "보내는 중…" : "보내기"}</button>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <select value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-600 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
              <option value="전체">받은 사람: 전체</option>
              {people.map((name) => <option key={name} value={name}>받은 사람: {name}</option>)}
            </select>
            <select value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-600 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
              <option value="전체">보낸 사람: 전체</option>
              {people.map((name) => <option key={name} value={name}>보낸 사람: {name}</option>)}
            </select>
            {(filterTo !== "전체" || filterFrom !== "전체") && <button type="button" onClick={() => { setFilterTo("전체"); setFilterFrom("전체"); }} className="text-[11px] font-black text-slate-400">초기화</button>}
          </div>
          {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {!loading && !visibleRows.length && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">{rows.length ? "조건에 맞는 칭찬이 없어요." : "아직 칭찬이 없어요. 첫 칭찬의 주인공을 만들어 주세요."}</div>}
          {visibleRows.map((row) => (
            <article key={row.id} className={`rounded-xl border p-4 shadow-sm ${row.to_name === author ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-400">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-black text-amber-700">{initials(row.to_name)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]"><span className="font-black text-slate-600">{row.from_author || "익명"}</span>{row.from_author === author ? " (나)" : ""} <span className="text-slate-300">→</span> <b className="font-black text-slate-900">{row.to_name}</b></span>
                    <span className="rounded-full bg-amber-50 px-2 py-px text-[10px] font-black text-amber-600">칭찬</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {row.from_author === author && editId !== row.id && <>
                    <button type="button" onClick={() => { setEditId(row.id); setEditContent(row.content); }} className="font-black text-slate-300 hover:text-blue-500">수정</button>
                    <button type="button" onClick={() => void removePraise(row)} className="font-black text-slate-300 hover:text-rose-500">삭제</button>
                  </>}
                  {row.created_at.slice(0, 10)}
                </span>
              </div>
              {editId === row.id ? (
                <div className="mt-2 flex gap-1.5">
                  <input value={editContent} onChange={(e) => setEditContent(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveEditPraise(); }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  <button type="button" onClick={() => setEditId("")} className="shrink-0 rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">취소</button>
                  <button type="button" onClick={() => void saveEditPraise()} className="shrink-0 rounded-full bg-slate-900 transition hover:bg-slate-800 px-3 py-2 text-xs font-black text-white">저장</button>
                </div>
              ) : <p className="mt-2.5 whitespace-pre-wrap pl-[46px] text-[15px] font-medium leading-7 text-slate-800">{row.content}</p>}
            </article>
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6">
          <h3 className="text-sm font-black text-slate-950">👑 이번 달 칭찬왕</h3>
          <div className="mt-3 space-y-1.5">
            {!monthlyKing.length && <div className="py-6 text-center text-xs font-bold text-slate-400">이번 달 칭찬이 아직 없어요.</div>}
            {monthlyKing.map(([name, count], index) => (
              <div key={name} className={`flex items-center justify-between rounded-lg px-3 py-2 ${name === author ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50"}`}>
                <span className="text-xs font-black text-slate-700">{index === 0 ? "👑" : `${index + 1}.`} {name}{name === author ? " (나)" : ""}</span>
                <span className="text-xs font-black text-amber-600">{count}회</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function GoalsBoard({ author }: { author: string }) {
  const [goals, setGoals] = useState<SelfGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [category, setCategory] = useState<string>("기타");
  const [categoryFilter, setCategoryFilter] = useState<string>("전체");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState("");
  const [editDraft, setEditDraft] = useState({ title: "", memo: "", target_date: "", start_date: "", category: "기타" });

  const startEdit = (goal: SelfGoal) => {
    setEditId(goal.id);
    setEditDraft({ title: goal.title, memo: goal.memo, target_date: goal.target_date || "", start_date: goal.start_date || "", category: goal.category || "기타" });
  };
  const saveEdit = async () => {
    if (!editDraft.title.trim()) return;
    try {
      const patch = { title: editDraft.title.trim(), memo: editDraft.memo.trim(), target_date: editDraft.target_date || null, start_date: editDraft.start_date || null, category: editDraft.category };
      await updateRows("self_goals", `id=eq.${editId}`, patch);
      setGoals((current) => current.map((g) => g.id === editId ? { ...g, ...patch } : g));
      setEditId("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // 진행률: 슬라이더는 로컬로 즉시 반영하고, 손을 뗄 때 저장한다.
  const setProgressLocal = (id: string, progress: number) => {
    setGoals((current) => current.map((g) => g.id === id ? { ...g, progress } : g));
  };
  const saveProgress = (goal: SelfGoal) => {
    void updateRows("self_goals", `id=eq.${goal.id}`, { progress: goal.progress ?? 0 }).catch(() => { /* 다음 저장에서 재시도 */ });
  };

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
  const activeGoals = useMemo(() => visible.filter((g) => !g.done), [visible]);
  const doneGoals = useMemo(() => visible.filter((g) => g.done), [visible]);
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
      await insertRow("self_goals", { author, title: title.trim(), memo: memo.trim(), target_date: targetDate || null, start_date: startDate || kstDate(), category });
      setTitle(""); setMemo(""); setTargetDate(""); setStartDate("");
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
    setGoals((current) => current.map((g) => g.id === goal.id ? { ...g, done, done_at: done ? new Date().toISOString() : null, progress: done ? 100 : g.progress } : g));
    try {
      await updateRows("self_goals", `id=eq.${goal.id}`, { done, done_at: done ? new Date().toISOString() : null, ...(done ? { progress: 100 } : {}) });
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

  const renderGoal = (goal: SelfGoal) => {
    const mineGoal = goal.author === author;
    const ddayLabel = dday(goal.target_date);
    const overdue = !goal.done && ddayLabel.startsWith("D+");
    if (editId === goal.id) {
      return (
        <article key={goal.id} className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/30 p-4">
          <div className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
            <select value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
              {GOAL_CATEGORIES.map((name) => <option key={name}>{name}</option>)}
            </select>
            <input value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={editDraft.start_date} onChange={(e) => setEditDraft({ ...editDraft, start_date: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            <input type="date" value={editDraft.target_date} onChange={(e) => setEditDraft({ ...editDraft, target_date: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </div>
          <input value={editDraft.memo} onChange={(e) => setEditDraft({ ...editDraft, memo: e.target.value })} placeholder="메모" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditId("")} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-500">취소</button>
            <button type="button" onClick={() => void saveEdit()} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-5 py-2 text-xs font-black text-white">저장</button>
          </div>
        </article>
      );
    }
    return (
      <article key={goal.id} className={`flex items-start gap-3 rounded-xl border p-4 shadow-sm ${goal.done ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
        <button type="button" disabled={!mineGoal} onClick={() => void toggleDone(goal)} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black transition ${goal.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400"} ${mineGoal ? "" : "cursor-default opacity-60"}`}>✓</button>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-black ${goal.done ? "text-emerald-700 line-through" : "text-slate-900"}`}>{goal.title}</div>
          {goal.memo && <div className="mt-0.5 text-xs font-semibold text-slate-500">{goal.memo}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
            {showAll && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-black text-slate-600">{goal.author}</span>}
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-black text-emerald-600">{goal.category || "기타"}</span>
            {(goal.start_date || goal.target_date) && <span>{goal.start_date || "?"} ~ {goal.target_date || "미정"}</span>}
            {ddayLabel && !goal.done && <span className={`rounded px-1.5 py-0.5 font-black ${overdue ? "bg-rose-100 text-rose-600" : "bg-blue-50 text-blue-600"}`}>{ddayLabel}</span>}
            {goal.done && goal.done_at && <span className="text-emerald-600">완료 {goal.done_at.slice(0, 10)}</span>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-all ${goal.done ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${goal.done ? 100 : (goal.progress ?? 0)}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right text-[11px] font-black text-slate-500">{goal.done ? 100 : (goal.progress ?? 0)}%</span>
          </div>
          {mineGoal && !goal.done && <input type="range" min={0} max={100} step={5} value={goal.progress ?? 0}
            onChange={(e) => setProgressLocal(goal.id, Number(e.target.value))}
            onMouseUp={() => saveProgress({ ...goal, progress: goal.progress ?? 0 })}
            onTouchEnd={() => saveProgress({ ...goal, progress: goal.progress ?? 0 })}
            className="mt-1 w-full accent-blue-600" />}
        </div>
        {mineGoal && <span className="flex shrink-0 gap-2">
          <button type="button" onClick={() => startEdit(goal)} className="text-[11px] font-black text-slate-300 hover:text-blue-500">수정</button>
          <button type="button" onClick={() => void removeGoal(goal)} className="text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>
        </span>}
      </article>
    );
  };

  return (
    <div className="space-y-4 pb-16">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-black text-slate-400">새 목표 추가</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                {GOAL_CATEGORIES.map((name) => <option key={name}>{name}</option>)}
              </select>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="목표 (예: 정보처리기사 필기 합격, 매주 책 1권)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[10px] font-black text-slate-400">시작일 (비우면 오늘)
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <label className="text-[10px] font-black text-slate-400">완료 목표일
                <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
            </div>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택)" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => void addGoal()} disabled={busy || !title.trim()} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{busy ? "추가 중…" : "목표 추가"}</button>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full bg-slate-100 p-1">
                {([[false, "내 목표"], [true, "전체 보기"]] as [boolean, string][]).map(([all, label]) => (
                  <button key={label} type="button" onClick={() => setShowAll(all)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${showAll === all ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>
                ))}
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black tabular-nums text-slate-500">내 목표 {mine.length} · 완료 {myDone} · 달성률 {mine.length ? Math.round((myDone / mine.length) * 100) : 0}%</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {["전체", ...GOAL_CATEGORIES].map((name) => (
                <button key={name} type="button" onClick={() => setCategoryFilter(name)} className={`rounded-full px-2.5 py-1 text-[11px] font-black transition ${categoryFilter === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>
              ))}
            </div>
          </div>

          {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {!loading && !visible.length && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">{showAll ? "등록된 목표가 없어요." : "아직 목표가 없어요. 첫 목표를 걸어보세요."}</div>}
          {activeGoals.map(renderGoal)}
          {doneGoals.length > 0 && <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer px-4 py-3 text-xs font-black text-slate-500">✅ 완료한 목표 {doneGoals.length}개 펼치기</summary>
            <div className="space-y-3 border-t border-slate-100 p-3">{doneGoals.map(renderGoal)}</div>
          </details>}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6">
          <h3 className="text-sm font-black text-slate-950">🏁 달성 현황</h3>
          <p className="mt-0.5 text-[10px] font-bold text-slate-400">완료한 목표 수 기준. 서로 자극이 되어주세요.</p>
          <div className="mt-3 space-y-1.5">
            {!teamStats.length && <div className="py-6 text-center text-xs font-bold text-slate-400">아직 목표 기록이 없어요.</div>}
            {teamStats.map(([name, stat], index) => (
              <div key={name} className={`flex items-center justify-between rounded-lg px-3 py-2 ${name === author ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-slate-50"}`}>
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
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#1E252F] px-5 py-4">
          <h2 className="text-base font-black text-white lg:text-lg">자기개발 / 지식공유</h2>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">읽고, 나누고, 목표를 이루는 공간 — 글은 익명으로, 추천 1개 = 0.2P</p>
        </div>
        <div className="flex overflow-x-auto border-t border-white/5">
          {([["home", "홈"], ["reading", "독서"], ["tips", "배움·팁"], ["goals", "목표"], ["praise", "칭찬"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`relative shrink-0 whitespace-nowrap px-5 py-3.5 text-sm font-black transition ${tab === key ? "text-slate-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}>{label}</button>
          ))}
        </div>
      </section>
      {tab === "home" && <DevDashboard author={author} onGo={setTab} />}
      {tab === "reading" && <ReadingHub author={author} kind="reading" />}
      {tab === "tips" && <ReadingHub author={author} kind="tip" />}
      {tab === "goals" && <GoalsBoard author={author} />}
      {tab === "praise" && <PraiseBoard author={author} />}
    </div>
  );
}
