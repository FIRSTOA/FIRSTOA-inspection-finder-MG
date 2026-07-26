/**
 * 독서 탭 — 익명으로 좋은 글(책 구절·배운 점)을 공유하고, 추천으로 포인트를 쌓는다.
 * 글은 익명으로 노출되고 author는 저장만 하여 포인트(받은 추천 합계) 집계에 쓴다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows } from "./supabase";

type ReadingPost = { id: string; created_at: string; author: string; title: string; content: string; kind?: string };

export type BoardLabels = {
  heading: string; sub: string; titlePlaceholder: string; contentPlaceholder: string;
  pickLabel: string; submitLabel: string; writeHint: string;
};
const READING_LABELS: BoardLabels = {
  heading: "📚 독서", sub: "책에서 만난 좋은 글을 익명으로 나눕니다. 추천 1개 = 0.2P.",
  titlePlaceholder: "책 제목·출처 (선택)", contentPlaceholder: "마음에 남은 구절이나 생각을 적어주세요.",
  pickLabel: "📖 오늘의 구절", submitLabel: "익명으로 올리기", writeHint: "좋은 글 남기기",
};
const TIP_LABELS: BoardLabels = {
  heading: "💡 배움·팁 공유", sub: "업무 팁, 유용한 강의·아티클 링크를 익명으로 나눕니다. 추천 1개 = 0.2P.",
  titlePlaceholder: "주제·출처 (선택)", contentPlaceholder: "배운 것, 꿀팁, 링크(자동으로 클릭 가능)를 공유해주세요.",
  pickLabel: "💡 오늘의 팁", submitLabel: "익명으로 공유", writeHint: "배움·팁 남기기",
};

// 본문 속 URL을 클릭 가능한 링크로
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return <>{parts.map((part, index) => /^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer" className="break-all font-bold text-blue-600 underline">{part}</a>
    : <span key={index}>{part}</span>)}</>;
}
type ReadingVote = { post_id: string; voter: string; created_at?: string };
type SortMode = "latest" | "top";

const LONG_POST = 280; // 이보다 길면 접어서 보여준다
const fmtP = (votes: number) => (Math.round(votes * 2) / 10).toFixed(1); // 추천 1개 = 0.2P

export default function ReadingHub({ author, kind = "reading" }: { author: string; kind?: "reading" | "tip" }) {
  const labels = kind === "tip" ? TIP_LABELS : READING_LABELS;
  const [posts, setPosts] = useState<ReadingPost[]>([]);
  const [votes, setVotes] = useState<ReadingVote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingVotes, setPendingVotes] = useState<Set<string>>(new Set());
  const [pointsMonthly, setPointsMonthly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [postRows, voteRows] = await Promise.all([
        selectRows<ReadingPost>("reading_posts", `select=*&kind=eq.${kind}&order=created_at.desc&limit=200`)
          .catch(async (e) => {
            if (kind === "reading") return selectRows<ReadingPost>("reading_posts", "select=*&order=created_at.desc&limit=200"); // kind 컬럼 SQL 전 호환
            throw e;
          }),
        selectRows<ReadingVote>("reading_votes", "select=post_id,voter,created_at&limit=5000"),
      ]);
      setPosts(postRows);
      setVotes(voteRows);
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/reading.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  const voteCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of votes) map.set(v.post_id, (map.get(v.post_id) || 0) + 1);
    return map;
  }, [votes]);
  const myVotes = useMemo(() => new Set(votes.filter((v) => v.voter === author).map((v) => v.post_id)), [votes, author]);
  const points = useMemo(() => {
    const authorOf = new Map(posts.map((p) => [p.id, p.author || "미지정"]));
    const monthKey = new Date().toISOString().slice(0, 7);
    const map = new Map<string, number>();
    for (const v of votes) {
      if (pointsMonthly && String(v.created_at || "").slice(0, 7) !== monthKey) continue;
      const owner = authorOf.get(v.post_id);
      if (!owner) continue;
      map.set(owner, (map.get(owner) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [posts, votes, pointsMonthly]);
  const myPoints = useMemo(() => points.find(([name]) => name === author)?.[1] || 0, [points, author]);

  // 오늘의 구절 — 날짜로 정해지는 하루 한 편(추천 많은 글 위주). 새로고침해도 같은 글이 유지된다.
  const todaysPick = useMemo(() => {
    if (!posts.length) return null;
    const pool = [...posts].sort((a, b) => (voteCount.get(b.id) || 0) - (voteCount.get(a.id) || 0)).slice(0, Math.min(10, posts.length));
    const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    return pool[seed % pool.length];
  }, [posts, voteCount]);

  const visiblePosts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = keyword
      ? posts.filter((p) => p.title.toLowerCase().includes(keyword) || p.content.toLowerCase().includes(keyword))
      : posts;
    if (sortMode === "top") {
      return [...filtered].sort((a, b) => (voteCount.get(b.id) || 0) - (voteCount.get(a.id) || 0) || b.created_at.localeCompare(a.created_at));
    }
    return filtered;
  }, [posts, query, sortMode, voteCount]);

  const weekAgo = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); }, []);
  const weeklyNew = posts.filter((p) => p.created_at >= weekAgo).length;

  const submit = async () => {
    if (busy || !content.trim()) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    setBusy(true);
    setError("");
    try {
      await insertRow("reading_posts", { author, title: title.trim(), content: content.trim(), ...(kind !== "reading" ? { kind } : {}) });
      setTitle("");
      setContent("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleVote = async (post: ReadingPost) => {
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    if (pendingVotes.has(post.id)) return; // 연타 시 서버 상태가 꼬이지 않게 응답까지 잠근다
    const voted = myVotes.has(post.id);
    setPendingVotes((current) => new Set(current).add(post.id));
    // 낙관적 갱신
    setVotes((current) => voted
      ? current.filter((v) => !(v.post_id === post.id && v.voter === author))
      : [...current, { post_id: post.id, voter: author, created_at: new Date().toISOString() }]);
    try {
      if (voted) await deleteRows("reading_votes", `post_id=eq.${post.id}&voter=eq.${encodeURIComponent(author)}`);
      else await insertRow("reading_votes", { post_id: post.id, voter: author });
    } catch {
      await load(); // 실패 시 서버 상태로 복원
    } finally {
      setPendingVotes((current) => { const next = new Set(current); next.delete(post.id); return next; });
    }
  };

  const removePost = async (post: ReadingPost) => {
    if (post.author !== author) return;
    if (!window.confirm("이 글을 삭제할까요?")) return;
    try {
      await deleteRows("reading_posts", `id=eq.${post.id}`);
      setPosts((current) => current.filter((p) => p.id !== post.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const renderPost = (post: ReadingPost, highlight = false) => {
    const count = voteCount.get(post.id) || 0;
    const voted = myVotes.has(post.id);
    const mine = post.author === author;
    const isLong = post.content.length > LONG_POST;
    const isOpen = expanded.has(post.id);
    const body = isLong && !isOpen ? `${post.content.slice(0, LONG_POST).trimEnd()}…` : post.content;
    return (
      <article key={`${highlight ? "pick-" : ""}${post.id}`} className={`relative overflow-hidden rounded-xl border p-5 shadow-sm ${highlight ? "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white" : "border-slate-200 bg-white"}`}>
        {highlight && <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-400/90 px-2.5 py-1 text-[10px] font-black text-white">{labels.pickLabel}</div>}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[11px] font-bold text-slate-400">
            <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 font-black text-slate-500">익명{mine ? " (내 글)" : ""}</span>
            <span className="shrink-0">{post.created_at.slice(0, 10)}</span>
            {post.title && <span className="truncate font-black text-slate-500">《{post.title}》</span>}
          </div>
          {mine && !highlight && <button type="button" onClick={() => void removePost(post)} className="shrink-0 text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>}
        </div>
        <div className="mt-3 flex gap-3">
          <span className="select-none font-serif text-3xl leading-none text-amber-300">“</span>
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-[15px] font-medium leading-7 text-slate-800"><Linkified text={body} /></p>
        </div>
        <div className="mt-3 flex items-center gap-2 pl-8">
          <button type="button" disabled={pendingVotes.has(post.id)} onClick={() => void toggleVote(post)} className={`rounded-full px-3.5 py-1.5 text-xs font-black transition disabled:opacity-50 ${voted ? "bg-amber-400 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-amber-600"}`}>
            👍 추천{count > 0 ? ` ${count}` : ""}
          </button>
          {isLong && <button type="button" onClick={() => toggleExpanded(post.id)} className="text-xs font-black text-blue-500">{isOpen ? "접기" : "더보기"}</button>}
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-4 pb-16">
      {/* 헤더 배너 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">{labels.heading}</h2>
            <p className="mt-1 text-xs font-semibold text-slate-300">{labels.sub}</p>
          </div>
          <div className="flex gap-4 text-center">
            <div><div className="text-lg font-black">{posts.length}</div><div className="text-[10px] font-bold text-slate-300">전체 글</div></div>
            <div><div className="text-lg font-black">{weeklyNew}</div><div className="text-[10px] font-bold text-slate-300">이번 주</div></div>
            <div><div className="text-lg font-black text-amber-300">{fmtP(myPoints)}P</div><div className="text-[10px] font-bold text-slate-300">내 포인트</div></div>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* 오늘의 구절 */}
          {!loading && todaysPick && renderPost(todaysPick, true)}

          {/* 글쓰기 */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-black text-slate-400">{labels.writeHint} <span className="font-bold text-slate-300">— 익명으로 공유됩니다</span></div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={labels.titlePlaceholder} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder={labels.contentPlaceholder} className="mt-2 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold leading-6" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300">{content.trim().length ? `${content.trim().length}자` : ""}</span>
              <button type="button" onClick={() => void submit()} disabled={busy || !content.trim()} className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">{busy ? "올리는 중…" : labels.submitLabel}</button>
            </div>
          </section>

          {/* 정렬·검색 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="rounded-md bg-slate-100 p-1">
              {([["latest", "최신순"], ["top", "추천순"]] as [SortMode, string][]).map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => setSortMode(mode)} className={`rounded px-3 py-1.5 text-xs font-black ${sortMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·내용 검색" className="w-44 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold" />
          </div>

          {/* 글 목록 */}
          {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {!loading && !visiblePosts.length && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">{query.trim() ? "검색 결과가 없어요." : "아직 올라온 글이 없어요. 첫 글을 남겨보세요."}</div>}
          {visiblePosts.map((post) => renderPost(post))}
        </div>

        {/* 포인트 현황 */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-900">🏆 포인트 현황</h3>
            <div className="rounded-md bg-slate-100 p-0.5">
              {([[false, "전체"], [true, "이번 달"]] as [boolean, string][]).map(([monthly, label]) => (
                <button key={label} type="button" onClick={() => setPointsMonthly(monthly)} className={`rounded px-2 py-1 text-[10px] font-black ${pointsMonthly === monthly ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-[10px] font-bold text-slate-400">받은 추천 1개 = 0.2P. 어떤 글인지는 공개되지 않아요.</p>
          <div className="mt-3 space-y-1.5">
            {!points.length && <div className="py-6 text-center text-xs font-bold text-slate-400">{pointsMonthly ? "이번 달 추천 기록이 없어요." : "아직 추천 기록이 없어요."}</div>}
            {points.map(([name, score], index) => (
              <div key={name} className={`flex items-center justify-between rounded-md px-3 py-2 ${name === author ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50"}`}>
                <span className="text-xs font-black text-slate-700">{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {name}{name === author ? " (나)" : ""}</span>
                <span className="text-xs font-black text-amber-600">{fmtP(score)}P</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
