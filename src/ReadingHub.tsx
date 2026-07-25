/**
 * 독서 탭 — 익명으로 좋은 글(책 구절·배운 점)을 공유하고, 추천으로 포인트를 쌓는다.
 * 글은 익명으로 노출되고 author는 저장만 하여 포인트(받은 추천 합계) 집계에 쓴다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows } from "./supabase";

type ReadingPost = { id: string; created_at: string; author: string; title: string; content: string };
type ReadingVote = { post_id: string; voter: string };

export default function ReadingHub({ author }: { author: string }) {
  const [posts, setPosts] = useState<ReadingPost[]>([]);
  const [votes, setVotes] = useState<ReadingVote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [postRows, voteRows] = await Promise.all([
        selectRows<ReadingPost>("reading_posts", "select=*&order=created_at.desc&limit=200"),
        selectRows<ReadingVote>("reading_votes", "select=post_id,voter&limit=5000"),
      ]);
      setPosts(postRows);
      setVotes(voteRows);
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/reading.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const voteCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of votes) map.set(v.post_id, (map.get(v.post_id) || 0) + 1);
    return map;
  }, [votes]);
  const myVotes = useMemo(() => new Set(votes.filter((v) => v.voter === author).map((v) => v.post_id)), [votes, author]);
  const points = useMemo(() => {
    const authorOf = new Map(posts.map((p) => [p.id, p.author || "미지정"]));
    const map = new Map<string, number>();
    for (const v of votes) {
      const owner = authorOf.get(v.post_id);
      if (!owner) continue;
      map.set(owner, (map.get(owner) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [posts, votes]);

  const submit = async () => {
    if (busy || !content.trim()) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    setBusy(true);
    setError("");
    try {
      await insertRow("reading_posts", { author, title: title.trim(), content: content.trim() });
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
    const voted = myVotes.has(post.id);
    // 낙관적 갱신
    setVotes((current) => voted
      ? current.filter((v) => !(v.post_id === post.id && v.voter === author))
      : [...current, { post_id: post.id, voter: author }]);
    try {
      if (voted) await deleteRows("reading_votes", `post_id=eq.${post.id}&voter=eq.${encodeURIComponent(author)}`);
      else await insertRow("reading_votes", { post_id: post.id, voter: author });
    } catch {
      await load(); // 실패 시 서버 상태로 복원
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

  return (
    <div className="space-y-4 pb-16">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-xl font-black text-slate-950">독서</h2>
        <p className="mt-1 text-xs font-semibold text-slate-500">책에서 만난 좋은 글을 익명으로 나눕니다. 추천을 받으면 포인트가 쌓여요.</p>
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* 글쓰기 */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-black text-slate-400">좋은 글 남기기 (익명으로 공유됩니다)</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="책 제목·출처 (선택)" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="마음에 남은 구절이나 생각을 적어주세요." className="mt-2 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold leading-6" />
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => void submit()} disabled={busy || !content.trim()} className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">{busy ? "올리는 중…" : "익명으로 올리기"}</button>
            </div>
          </section>

          {/* 글 목록 */}
          {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {!loading && !posts.length && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">아직 올라온 글이 없어요. 첫 글을 남겨보세요.</div>}
          {posts.map((post) => {
            const count = voteCount.get(post.id) || 0;
            const voted = myVotes.has(post.id);
            const mine = post.author === author;
            return (
              <article key={post.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-black text-slate-500">익명{mine ? " (내 글)" : ""}</span>
                    <span>{post.created_at.slice(0, 10)}</span>
                    {post.title && <span className="truncate text-slate-500">《{post.title}》</span>}
                  </div>
                  {mine && <button type="button" onClick={() => void removePost(post)} className="shrink-0 text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[15px] font-medium leading-7 text-slate-800">{post.content}</p>
                <div className="mt-3">
                  <button type="button" onClick={() => void toggleVote(post)} className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${voted ? "bg-amber-400 text-white" : "border border-slate-200 bg-white text-slate-500 hover:border-amber-300"}`}>
                    👍 추천 {count > 0 ? count : ""}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {/* 포인트 현황 */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6">
          <h3 className="text-sm font-black text-slate-900">포인트 현황</h3>
          <p className="mt-0.5 text-[10px] font-bold text-slate-400">받은 추천 1개 = 1포인트. 어떤 글인지는 공개되지 않아요.</p>
          <div className="mt-3 space-y-1.5">
            {!points.length && <div className="py-6 text-center text-xs font-bold text-slate-400">아직 추천 기록이 없어요.</div>}
            {points.map(([name, score], index) => (
              <div key={name} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                <span className="text-xs font-black text-slate-700">{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {name}</span>
                <span className="text-xs font-black text-amber-600">{score}P</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
