/**
 * 독서 탭 — 익명으로 좋은 글(책 구절·배운 점)을 공유하고, 추천으로 포인트를 쌓는다.
 * 글은 익명으로 노출되고 author는 저장만 하여 포인트(받은 추천 합계) 집계에 쓴다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteRows, insertRow, selectRows, uploadPublicFile } from "./supabase";
import { GAS_GET_URL } from "./api";

type ReadingPost = { id: string; created_at: string; author: string; title: string; content: string; kind?: string; cover_url?: string; photo_url?: string };
type BookHit = { title: string; authors: string; thumbnail: string };

/**
 * 책 검색 — ① GAS 프록시(리디북스 공개 검색, 키 불필요·기본) → ② 카카오(키 등록 시)
 * → ③ 구글 도서(무키, 공용 쿼터라 자주 마름) → ④ 오픈라이브러리 순서로 시도한다.
 */
async function searchRidiBooks(query: string): Promise<BookHit[]> {
  const res = await fetch(`${GAS_GET_URL}?action=booksearch&q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`프록시 ${res.status}`);
  const data = await res.json() as { books?: BookHit[] };
  return (data.books || []).filter((book) => book.title && typeof book.title === "string");
}
let kakaoKeyCache: string | null = null;
async function getKakaoBookKey(): Promise<string> {
  if (kakaoKeyCache !== null) return kakaoKeyCache;
  try {
    const rows = await selectRows<{ value: string }>("app_config", "select=value&key=eq.KAKAO_BOOK_KEY&limit=1");
    kakaoKeyCache = (rows[0]?.value || "").trim();
  } catch { kakaoKeyCache = ""; }
  return kakaoKeyCache;
}
async function searchKakaoBooks(query: string, key: string): Promise<BookHit[]> {
  const res = await fetch(`https://dapi.kakao.com/v3/search/book?query=${encodeURIComponent(query)}&size=8`, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!res.ok) throw new Error(`카카오 ${res.status}`);
  const data = await res.json() as { documents?: Array<{ title?: string; authors?: string[]; thumbnail?: string }> };
  return (data.documents || []).map((doc) => ({
    title: doc.title || "", authors: (doc.authors || []).join(", "),
    thumbnail: String(doc.thumbnail || "").replace("http://", "https://"),
  })).filter((book) => book.title);
}
async function searchGoogleBooks(query: string): Promise<BookHit[]> {
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=8&printType=books&country=KR`);
  if (!res.ok) throw new Error(`구글 도서 ${res.status}`);
  const data = await res.json() as { items?: Array<{ volumeInfo?: { title?: string; authors?: string[]; imageLinks?: { thumbnail?: string; smallThumbnail?: string } } }> };
  return (data.items || []).map((item) => ({
    title: item.volumeInfo?.title || "",
    authors: (item.volumeInfo?.authors || []).join(", "),
    thumbnail: String(item.volumeInfo?.imageLinks?.thumbnail || item.volumeInfo?.imageLinks?.smallThumbnail || "").replace("http://", "https://"),
  })).filter((book) => book.title);
}
/**
 * 장르별 추천 도서 — 검증된 책만 큐레이션해 두고, 날짜 기준으로 3권씩 돌아가며 보여준다.
 * 표지·저자는 리디 프록시로 해석해 기기에 7일 캐시. (베스트셀러 API는 전부 키 장벽,
 * 스크레이핑은 웹소설 잡음이 섞여서 큐레이션이 품질·유지비 모두 낫다)
 */
const BOOK_RECS: Record<string, Array<{ t: string; a: string }>> = {
  "자기계발": [
    { t: "미움받을 용기", a: "기시미 이치로" }, { t: "아주 작은 습관의 힘", a: "제임스 클리어" },
    { t: "데일 카네기 인간관계론", a: "데일 카네기" }, { t: "그릿", a: "앤절라 더크워스" },
    { t: "원씽", a: "게리 켈러" }, { t: "역행자", a: "자청" },
  ],
  "경영·리더십": [
    { t: "초격차", a: "권오현" }, { t: "일을 잘한다는 것", a: "야마구치 슈" },
    { t: "하드씽", a: "벤 호로위츠" }, { t: "좋은 기업을 넘어 위대한 기업으로", a: "짐 콜린스" },
    { t: "규칙 없음", a: "리드 헤이스팅스" }, { t: "최고의 팀은 무엇이 다른가", a: "대니얼 코일" },
  ],
  "경제·재테크": [
    { t: "돈의 심리학", a: "모건 하우절" }, { t: "부자 아빠 가난한 아빠", a: "로버트 기요사키" },
    { t: "부의 추월차선", a: "엠제이 드마코" }, { t: "존리의 부자되기 습관", a: "존리" },
    { t: "새로운 종의 부자들", a: "" },
  ],
  "인문·교양": [
    { t: "사피엔스", a: "유발 하라리" }, { t: "총 균 쇠", a: "재레드 다이아몬드" },
    { t: "팩트풀니스", a: "한스 로슬링" }, { t: "정의란 무엇인가", a: "마이클 샌델" },
    { t: "코스모스", a: "칼 세이건" }, { t: "넛지", a: "리처드 탈러" },
  ],
  "소설·에세이": [
    { t: "불편한 편의점", a: "김호연" }, { t: "달러구트 꿈 백화점", a: "이미예" },
    { t: "아몬드", a: "손원평" }, { t: "미드나잇 라이브러리", a: "매트 헤이그" },
    { t: "나미야 잡화점의 기적", a: "히가시노 게이고" }, { t: "어서 오세요, 휴남동 서점입니다", a: "황보름" },
  ],
  "IT·기술": [
    { t: "클린 코드", a: "로버트 C. 마틴" }, { t: "IT 좀 아는 사람", a: "닐 메타" },
    { t: "비전공자를 위한 이해할 수 있는 IT 지식", a: "최원영" }, { t: "프로그래머의 뇌", a: "펠리너 헤르만스" },
    { t: "소프트웨어 장인", a: "산드로 만쿠소" },
  ],
};
const REC_GENRES = Object.keys(BOOK_RECS);

/** 날짜로 정해지는 3권 — 매일 자연스럽게 돌아간다 */
function dailyRecPicks(genre: string): Array<{ t: string; a: string }> {
  const pool = BOOK_RECS[genre] || [];
  if (pool.length <= 3) return pool;
  const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
  const start = seed % pool.length;
  return [0, 1, 2].map((offset) => pool[(start + offset) % pool.length]);
}

/** 여러 권을 GAS 한 번 호출로 해석 (저자 힌트 포함) — 기기 7일 캐시 + 서버 6시간 캐시 */
async function resolveRecBatch(picks: Array<{ t: string; a: string }>): Promise<Record<string, { cover: string; authors: string }>> {
  const out: Record<string, { cover: string; authors: string }> = {};
  const fresh: Array<{ t: string; a: string }> = [];
  for (const pick of picks) {
    try {
      const raw = localStorage.getItem(`book_rec_v2:${pick.t}`);
      if (raw) { const parsed = JSON.parse(raw); if (Date.now() - parsed.t < 7 * 86_400_000) { out[pick.t] = parsed.v; continue; } }
    } catch { /* 캐시 실패 무시 */ }
    fresh.push(pick);
  }
  if (fresh.length) {
    const param = fresh.map((pick) => `${pick.t}@@${pick.a}`).join("||");
    const res = await fetch(`${GAS_GET_URL}?action=bookresolve&titles=${encodeURIComponent(param)}`);
    if (res.ok) {
      const data = await res.json() as { books?: Record<string, { cover: string; authors: string }> };
      for (const pick of fresh) {
        const value = data.books?.[pick.t] || { cover: "", authors: "" };
        out[pick.t] = value;
        try { localStorage.setItem(`book_rec_v2:${pick.t}`, JSON.stringify({ t: Date.now(), v: value })); } catch { /* 무시 */ }
      }
    }
  }
  return out;
}

function BookRecsCard({ onPick }: { onPick: (title: string, cover: string) => void }) {
  const [genre, setGenre] = useState(REC_GENRES[0]);
  const [resolved, setResolved] = useState<Record<string, { cover: string; authors: string }>>({});
  const picks = useMemo(() => dailyRecPicks(genre), [genre]);
  useEffect(() => {
    let alive = true;
    void resolveRecBatch(picks).then((entries) => { if (alive) setResolved((current) => ({ ...current, ...entries })); });
    return () => { alive = false; };
  }, [picks]);
  // 나머지 장르를 뒤에서 미리 해석해 둔다 — 장르를 바꿔도 즉시 뜨게
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const other of REC_GENRES) {
          try { await resolveRecBatch(dailyRecPicks(other)); } catch { /* 다음 장르 */ }
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-black text-slate-950">📚 이런 책 어때요</h3>
        <p className="mt-0.5 text-[10px] font-bold text-slate-400">매일 바뀌어요 — 누르면 제목·표지가 작성칸에 담깁니다</p>
      </div>
      <div className="flex gap-1 overflow-x-auto px-3 pt-2.5">
        {REC_GENRES.map((name) => (
          <button key={name} type="button" onClick={() => setGenre(name)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black transition ${genre === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>
        ))}
      </div>
      <div className="space-y-1 p-2.5">
        {picks.map((pick) => {
          const info = resolved[pick.t];
          return (
            <button key={pick.t} type="button" onClick={() => onPick(pick.t, info?.cover || "")}
              className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition hover:bg-slate-50">
              {info?.cover
                ? <img src={info.cover} alt="" loading="lazy" className="h-14 w-10 shrink-0 rounded object-cover shadow-sm" />
                : <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-gradient-to-br from-slate-600 to-slate-800 p-1 text-center text-[8px] font-black leading-3 text-white">{pick.t.slice(0, 8)}</span>}
              <span className="min-w-0">
                <span className="block truncate text-xs font-black text-slate-800">{pick.t}</span>
                <span className="block truncate text-[10px] font-bold text-slate-400">{info?.authors || pick.a}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

async function searchOpenLibrary(query: string): Promise<BookHit[]> {
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=8&fields=title,author_name,cover_i`);
  if (!res.ok) throw new Error(`openlibrary ${res.status}`);
  const data = await res.json() as { docs?: Array<{ title?: string; author_name?: string[]; cover_i?: number }> };
  return (data.docs || []).map((doc) => ({
    title: doc.title || "", authors: (doc.author_name || []).join(", "),
    thumbnail: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : "",
  })).filter((book) => book.title);
}

export type BoardLabels = {
  heading: string; sub: string; titlePlaceholder: string; contentPlaceholder: string;
  pickLabel: string; submitLabel: string; writeHint: string;
};
const READING_LABELS: BoardLabels = {
  heading: "📚 독서", sub: "책에서 만난 좋은 글을 익명으로 나눕니다. 추천 1개 = 0.2P.",
  titlePlaceholder: "책 제목·출처 (선택)", contentPlaceholder: "마음에 남은 구절이나 생각을 적어주세요.",
  pickLabel: "🏆 베스트 구절", submitLabel: "익명으로 올리기", writeHint: "좋은 글 남기기",
};
const TIP_LABELS: BoardLabels = {
  heading: "💡 배움·팁 공유", sub: "업무 팁, 유용한 강의·아티클 링크를 익명으로 나눕니다. 추천 1개 = 0.2P.",
  titlePlaceholder: "주제·출처 (선택)", contentPlaceholder: "배운 것, 꿀팁, 링크(자동으로 클릭 가능)를 공유해주세요.",
  pickLabel: "🏆 베스트 팁", submitLabel: "익명으로 공유", writeHint: "배움·팁 남기기",
};

// 본문 속 URL을 클릭 가능한 링크로
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return <>{parts.map((part, index) => /^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer" className="break-all font-bold text-blue-600 underline">{part}</a>
    : <span key={index}>{part}</span>)}</>;
}
type ReadingVote = { post_id: string; voter: string; created_at?: string };
type ReadingComment = { id: string; post_id: string; author: string; content: string; created_at: string };
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
  const [cover, setCover] = useState("");
  const [bookResults, setBookResults] = useState<BookHit[]>([]);
  const [bookSearching, setBookSearching] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookNote, setBookNote] = useState("");
  const [photo, setPhoto] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingVotes, setPendingVotes] = useState<Set<string>>(new Set());
  const [pointsMonthly, setPointsMonthly] = useState(false);
  const [comments, setComments] = useState<ReadingComment[]>([]);
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [postRows, voteRows, commentRows] = await Promise.all([
        selectRows<ReadingPost>("reading_posts", `select=*&kind=eq.${kind}&order=created_at.desc&limit=200`)
          .catch(async (e) => {
            if (kind === "reading") return selectRows<ReadingPost>("reading_posts", "select=*&order=created_at.desc&limit=200"); // kind 컬럼 SQL 전 호환
            throw e;
          }),
        selectRows<ReadingVote>("reading_votes", "select=post_id,voter,created_at&limit=5000"),
        selectRows<ReadingComment>("reading_comments", "select=*&order=created_at.asc&limit=3000").catch(() => [] as ReadingComment[]),
      ]);
      setPosts(postRows);
      setVotes(voteRows);
      setComments(commentRows);
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

  // 베스트 구절 — 추천을 가장 많이 받은 글 (동률이면 최신)
  const todaysPick = useMemo(() => {
    if (!posts.length) return null;
    return [...posts].sort((a, b) => (voteCount.get(b.id) || 0) - (voteCount.get(a.id) || 0) || b.created_at.localeCompare(a.created_at))[0];
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

  const runBookSearch = async () => {
    const query = title.trim();
    if (!query || bookSearching) return;
    setBookSearching(true);
    setBookOpen(true);
    setBookNote("");
    let hits: BookHit[] = [];
    try { hits = await searchRidiBooks(query); } catch { /* 다음 제공자로 */ }
    if (!hits.length) {
      const kakaoKey = await getKakaoBookKey();
      if (kakaoKey) { try { hits = await searchKakaoBooks(query, kakaoKey); } catch { /* 다음 제공자로 */ } }
    }
    if (!hits.length) { try { hits = await searchGoogleBooks(query); } catch { /* 다음 제공자로 */ } }
    if (!hits.length) { try { hits = await searchOpenLibrary(query); } catch { /* 아래 안내로 */ } }
    setBookResults(hits);
    if (!hits.length) setBookNote("검색 서버가 잠시 응답하지 않았을 수 있어요 — 잠시 후 다시 시도해 보세요.");
    setBookSearching(false);
  };

  const submit = async () => {
    if (busy || !content.trim()) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    setBusy(true);
    setError("");
    try {
      await insertRow("reading_posts", { author, title: title.trim(), content: content.trim(), cover_url: kind === "reading" ? cover : "", photo_url: photo, ...(kind !== "reading" ? { kind } : {}) });
      setTitle("");
      setContent("");
      setCover("");
      setPhoto("");
      setBookResults([]);
      setBookOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const attachPhoto = async (file: File | null) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setError("이미지 파일만 첨부할 수 있어요."); return; }
    setPhotoBusy(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      setPhoto(await uploadPublicFile("photos", `reading/${new Date().getFullYear()}/${crypto.randomUUID()}-${safe}`, file, file.type));
      setError("");
    } catch (e) { setError((e as Error).message); }
    finally { setPhotoBusy(false); }
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

  const commentsByPost = useMemo(() => {
    const map = new Map<string, ReadingComment[]>();
    for (const comment of comments) {
      const list = map.get(comment.post_id) || [];
      list.push(comment);
      map.set(comment.post_id, list);
    }
    return map;
  }, [comments]);

  const submitComment = async (postId: string) => {
    const draft = (commentDrafts[postId] || "").trim();
    if (!draft) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    try {
      await insertRow("reading_comments", { post_id: postId, author, content: draft });
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      const rows = await selectRows<ReadingComment>("reading_comments", "select=*&order=created_at.asc&limit=3000");
      setComments(rows);
    } catch (e) {
      setError((e as Error).message || "댓글 저장 실패 — supabase/selfdev-social.sql 실행 여부를 확인하세요.");
    }
  };

  const removeComment = async (comment: ReadingComment) => {
    if (comment.author !== author) return;
    try {
      await deleteRows("reading_comments", `id=eq.${comment.id}`);
      setComments((current) => current.filter((c) => c.id !== comment.id));
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
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 font-black text-slate-500">익명{mine ? " (내 글)" : ""}</span>
            <span className="shrink-0">{post.created_at.slice(0, 10)}</span>
            {post.title && <span className="truncate font-black text-slate-500">《{post.title}》</span>}
          </div>
          {mine && !highlight && <button type="button" onClick={() => void removePost(post)} className="shrink-0 text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>}
        </div>
        <div className="mt-3 flex gap-3">
          {post.cover_url
            ? <img src={post.cover_url} alt={post.title || "책 표지"} loading="lazy" className="h-24 w-16 shrink-0 self-start rounded-md object-cover shadow" />
            : <span className="select-none font-serif text-3xl leading-none text-amber-300">“</span>}
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-[15px] font-medium leading-7 text-slate-800"><Linkified text={body} /></p>
        </div>
        {post.photo_url && <div className="mt-2 sm:pl-8">
          <img src={post.photo_url} alt="첨부 사진" loading="lazy" onClick={() => window.open(post.photo_url, "_blank", "noopener")}
            className="max-h-72 cursor-zoom-in rounded-xl border border-slate-100 object-contain shadow-sm" />
        </div>}
        <div className="mt-3 flex items-center gap-2 pl-8">
          <button type="button" disabled={pendingVotes.has(post.id)} onClick={() => void toggleVote(post)} className={`rounded-full px-3.5 py-1.5 text-xs font-black transition disabled:opacity-50 ${voted ? "bg-amber-400 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-amber-600"}`}>
            👍 추천{count > 0 ? ` ${count}` : ""}
          </button>
          <button type="button" onClick={() => setOpenComments((current) => { const next = new Set(current); if (next.has(post.id)) next.delete(post.id); else next.add(post.id); return next; })} className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${openComments.has(post.id) ? "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>
            💬 댓글{(commentsByPost.get(post.id)?.length || 0) > 0 ? ` ${commentsByPost.get(post.id)?.length}` : ""}
          </button>
          {isLong && <button type="button" onClick={() => toggleExpanded(post.id)} className="text-xs font-black text-blue-500">{isOpen ? "접기" : "더보기"}</button>}
        </div>
        {openComments.has(post.id) && <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 sm:pl-8">
          {(commentsByPost.get(post.id) || []).map((comment) => (
            <div key={comment.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <span className="text-[10px] font-black text-slate-400">익명{comment.author === author ? " (나)" : ""} · {comment.created_at.slice(5, 10)}</span>
                <p className="mt-0.5 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-700"><Linkified text={comment.content} /></p>
              </div>
              {comment.author === author && <button type="button" onClick={() => void removeComment(comment)} className="shrink-0 text-[10px] font-black text-slate-300 hover:text-rose-500">삭제</button>}
            </div>
          ))}
          <div className="flex gap-1.5">
            <input value={commentDrafts[post.id] || ""} onChange={(e) => setCommentDrafts((current) => ({ ...current, [post.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") void submitComment(post.id); }} placeholder="익명 댓글 남기기" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            <button type="button" onClick={() => void submitComment(post.id)} className="shrink-0 rounded-full bg-slate-900 transition hover:bg-slate-800 px-3 py-2 text-xs font-black text-white">등록</button>
          </div>
        </div>}
      </article>
    );
  };

  return (
    <div className="space-y-4 pb-16">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* 오늘의 구절 */}
          {!loading && todaysPick && renderPost(todaysPick, true)}

          {/* 글쓰기 */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-black text-slate-400">{labels.writeHint} <span className="font-bold text-slate-300">— 익명으로 공유됩니다</span></div>
            <div className="mt-2 flex gap-1.5">
              {kind === "reading" && cover && <span className="relative shrink-0">
                <img src={cover} alt="선택한 책 표지" className="h-[38px] w-7 rounded object-cover shadow" />
                <button type="button" onClick={() => setCover("")} aria-label="표지 제거" className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[9px] font-black text-white">×</button>
              </span>}
              <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && kind === "reading") void runBookSearch(); }} placeholder={labels.titlePlaceholder} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              {kind === "reading" && <button type="button" onClick={() => void runBookSearch()} disabled={!title.trim() || bookSearching} className="shrink-0 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">{bookSearching ? "검색 중…" : "📖 책 검색"}</button>}
            </div>
            {kind === "reading" && bookOpen && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-[10px] font-black text-slate-400">책을 고르면 제목·표지가 채워집니다</span>
                  <button type="button" onClick={() => setBookOpen(false)} className="text-[10px] font-black text-slate-400 hover:text-slate-600">닫기 ✕</button>
                </div>
                {bookSearching && <div className="px-1 pb-1 text-[11px] font-bold text-slate-400">책을 찾는 중…</div>}
                {!bookSearching && !bookResults.length && <div className="px-1 pb-1 text-[11px] font-bold text-slate-400">검색 결과가 없어요 — 제목을 바꿔 다시 검색해 보세요.{bookNote && <span className="mt-0.5 block font-semibold text-amber-600">{bookNote}</span>}</div>}
                <div className="grid gap-1 sm:grid-cols-2">
                  {bookResults.map((book, index) => (
                    <button key={`${book.title}-${index}`} type="button" onClick={() => { setTitle(book.title); setCover(book.thumbnail); setBookOpen(false); }}
                      className="flex items-center gap-2 rounded-lg bg-white p-2 text-left ring-1 ring-slate-200 transition hover:ring-blue-300">
                      {book.thumbnail ? <img src={book.thumbnail} alt="" className="h-12 w-8 shrink-0 rounded object-cover shadow-sm" /> : <span className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-[9px] font-black text-slate-400">표지<br />없음</span>}
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black text-slate-800">{book.title}</span>
                        {book.authors && <span className="block truncate text-[10px] font-bold text-slate-400">{book.authors}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder={labels.contentPlaceholder} className="mt-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <button type="button" onClick={() => photoRef.current?.click()} disabled={photoBusy}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-500 transition hover:bg-slate-50 disabled:opacity-40">{photoBusy ? "올리는 중…" : "📷 사진 첨부"}</button>
                <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void attachPhoto(e.target.files?.[0] || null); e.target.value = ""; }} />
                {photo && <span className="relative">
                  <img src={photo} alt="첨부한 사진" className="h-9 w-9 rounded-lg object-cover shadow-sm" />
                  <button type="button" onClick={() => setPhoto("")} aria-label="사진 제거" className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[9px] font-black text-white">×</button>
                </span>}
                <span className="text-[11px] font-bold text-slate-300">{content.trim().length ? `${content.trim().length}자` : ""}</span>
              </span>
              <button type="button" onClick={() => void submit()} disabled={busy || !content.trim()} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{busy ? "올리는 중…" : labels.submitLabel}</button>
            </div>
          </section>

          {/* 정렬·통계·검색 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full bg-slate-100 p-1">
                {([["latest", "최신순"], ["top", "추천순"]] as [SortMode, string][]).map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => setSortMode(mode)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${sortMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>
                ))}
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black tabular-nums text-slate-500">전체 {posts.length} · 이번 주 {weeklyNew} · 내 포인트 {fmtP(myPoints)}P</span>
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·내용 검색" className="w-44 rounded-full border border-slate-300 px-3.5 py-2 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </div>

          {/* 글 목록 */}
          {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {!loading && !visiblePosts.length && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">{query.trim() ? "검색 결과가 없어요." : "아직 올라온 글이 없어요. 첫 글을 남겨보세요."}</div>}
          {visiblePosts.map((post) => renderPost(post))}
        </div>

        {/* 사이드바 — 추천 도서 + 포인트 현황 */}
        <div className="space-y-4 xl:sticky xl:top-6">
        {kind === "reading" && <BookRecsCard onPick={(pickTitle, pickCover) => { setTitle(pickTitle); setCover(pickCover); setBookOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-950">🏆 포인트 현황</h3>
            <div className="rounded-full bg-slate-100 p-1">
              {([[false, "전체"], [true, "이번 달"]] as [boolean, string][]).map(([monthly, label]) => (
                <button key={label} type="button" onClick={() => setPointsMonthly(monthly)} className={`rounded-full px-2 py-1 text-[10px] font-black ${pointsMonthly === monthly ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-[10px] font-bold text-slate-400">받은 추천 1개 = 0.2P. 어떤 글인지는 공개되지 않아요.</p>
          <div className="mt-3 space-y-1.5">
            {!points.length && <div className="py-6 text-center text-xs font-bold text-slate-400">{pointsMonthly ? "이번 달 추천 기록이 없어요." : "아직 추천 기록이 없어요."}</div>}
            {points.map(([name, score], index) => (
              <div key={name} className={`flex items-center justify-between rounded-lg px-3 py-2 ${name === author ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50"}`}>
                <span className="text-xs font-black text-slate-700">{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} {name}{name === author ? " (나)" : ""}</span>
                <span className="text-xs font-black text-amber-600">{fmtP(score)}P</span>
              </div>
            ))}
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
