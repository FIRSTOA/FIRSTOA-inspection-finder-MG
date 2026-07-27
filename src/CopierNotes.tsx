/**
 * 복합기 학습·처리이력 — 브랜드/기종별 수리 노하우와 처리 사례를 쌓는 팀 지식 베이스.
 * (supabase/dev-notes.sql의 copier_notes 테이블)
 */
import { useCallback, useEffect, useState } from "react";
import { countRows, deleteRows, insertRow, selectRows } from "./supabase";
import { ALL_MODEL_NAMES, brandOfModel } from "./modelCatalog";

type CopierNote = {
  id: string; created_at: string; author: string; brand: string; model: string;
  kind: "학습" | "처리이력"; title: string; content: string;
};

// 기종 필터 칩: 팀 관용 시리즈명 (기록의 model 값과 일치하는 것들)
const BRANDS: Record<string, string[]> = {
  삼성: ["MX3", "MX4", "MX7", "흑백기"],
  신도: ["320", "410", "420", "450", "N501"],
  제록스: ["키슈/세이토", "마블", "베니/보탄", "헤라", "세레스", "305", "5005"],
  교세라: ["2100", "2101", "5521", "5526"],
  브라더: ["5700", "8900"],
  오키: ["5473"],
  HP: [],
  리코: [],
  캐논: [],
  코니카미놀타: [],
  렉스마크: ["MX410"],
  기타: [],
};
const BRAND_NAMES = Object.keys(BRANDS);
const BRAND_TONE: Record<string, string> = {
  삼성: "bg-blue-50 text-blue-700", 신도: "bg-emerald-50 text-emerald-700", 제록스: "bg-rose-50 text-rose-700",
  교세라: "bg-amber-50 text-amber-700", 브라더: "bg-violet-50 text-violet-700", 오키: "bg-cyan-50 text-cyan-700",
  HP: "bg-sky-50 text-sky-700", 리코: "bg-indigo-50 text-indigo-700", 캐논: "bg-orange-50 text-orange-700",
  코니카미놀타: "bg-teal-50 text-teal-700", 렉스마크: "bg-lime-50 text-lime-700", 기타: "bg-slate-100 text-slate-600",
};

type QuizItem = { note: CopierNote; options: CopierNote[] };

// content("증상: …\n처리: …\n지역: …" 형식)를 구조화 — 형식이 아니면 raw로 표시
function parseNoteContent(content: string) {
  const fields: Record<string, string> = {};
  let current = "";
  for (const line of String(content || "").split("\n")) {
    const match = line.match(/^(증상|처리|지역|레벨|업체)\s*:\s*(.*)$/);
    if (match) { current = match[1]; fields[current] = match[2]; }
    else if (current) fields[current] += `\n${line}`;
  }
  return fields["처리"] !== undefined ? fields : null;
}

function NoteBody({ note }: { note: CopierNote }) {
  const parsed = parseNoteContent(note.content);
  if (!parsed) return <p className="mt-1.5 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">{note.content}</p>;
  const meta = [parsed["업체"], parsed["지역"] && `지역 ${parsed["지역"]}`, parsed["레벨"] && `레벨 ${parsed["레벨"]}`].filter(Boolean).join(" · ");
  return (
    <div className="mt-2 space-y-1.5">
      {meta && <div className="text-xs font-black text-slate-500">{meta}</div>}
      {parsed["증상"] && <div className="rounded-md bg-rose-50/60 px-3 py-2">
        <span className="text-[10px] font-black text-rose-500">증상</span>
        <p className="mt-0.5 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">{parsed["증상"]}</p>
      </div>}
      <div className="rounded-md bg-emerald-50/60 px-3 py-2">
        <span className="text-[10px] font-black text-emerald-600">처리</span>
        <p className="mt-0.5 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">{parsed["처리"]}</p>
      </div>
    </div>
  );
}

function buildQuiz(pool: CopierNote[], count: number): QuizItem[] {
  const usable = pool.filter((note) => note.title.trim() && note.content.trim());
  if (usable.length < 4) return [];
  const shuffled = [...usable].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length)).map((note) => {
    const others = usable.filter((item) => item.id !== note.id).sort(() => Math.random() - 0.5).slice(0, 3);
    return { note, options: [note, ...others].sort(() => Math.random() - 0.5) };
  });
}

export default function CopierNotes({ author }: { author: string }) {
  const [notes, setNotes] = useState<CopierNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [brand, setBrand] = useState<string>("전체");
  const [model, setModel] = useState<string>("전체");
  const [kindFilter, setKindFilter] = useState<"전체" | "학습" | "처리이력">("전체");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  // 상단 통계 (전체 기준 — 필터와 무관)
  const [stats, setStats] = useState<{ total: number; learn: number; cases: number; month: number } | null>(null);
  useEffect(() => {
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
    void Promise.all([
      countRows("copier_notes"),
      countRows("copier_notes", `kind=eq.${encodeURIComponent("학습")}`),
      countRows("copier_notes", `kind=eq.${encodeURIComponent("처리이력")}`),
      countRows("copier_notes", `created_at=gte.${monthStart}`),
    ]).then(([total, learn, cases, month]) => setStats({ total, learn, cases, month })).catch(() => setStats(null));
  }, []);
  const [writeOpen, setWriteOpen] = useState(false);
  const [view, setView] = useState<"notes" | "quiz">("notes");
  // 퀴즈: 처리이력·학습 기록을 문제 은행으로 쓰는 4지선다 (IT 기술퀴즈와 같은 흐름)
  const [quizBrand, setQuizBrand] = useState("전체");
  const [quizCount, setQuizCount] = useState(5);
  const [quiz, setQuiz] = useState<QuizItem[]>([]);
  const [quizIndex, setQuizIndex] = useState(-1);
  const [quizPick, setQuizPick] = useState("");
  const [quizScore, setQuizScore] = useState(0);
  const [wrongNotes, setWrongNotes] = useState<QuizItem[]>([]);

  const startQuiz = () => {
    const pool = quizBrand === "전체" ? notes : notes.filter((note) => note.brand === quizBrand);
    const built = buildQuiz(pool, quizCount);
    if (!built.length) { window.alert("제목·내용이 있는 기록이 4건 이상 쌓여야 퀴즈를 만들 수 있어요."); return; }
    setQuiz(built); setQuizIndex(0); setQuizPick(""); setQuizScore(0); setWrongNotes([]);
  };
  // 오답만 다시: 틀린 문제의 원본 노트로 새 퀴즈 구성
  const retryWrong = () => {
    const pool = wrongNotes.map((item) => item.note);
    const bank = notes.filter((note) => note.title.trim() && note.content.trim());
    const built = pool.map((note) => {
      const others = bank.filter((item) => item.id !== note.id).sort(() => Math.random() - 0.5).slice(0, 3);
      return { note, options: [note, ...others].sort(() => Math.random() - 0.5) };
    });
    setQuiz(built); setQuizIndex(0); setQuizPick(""); setQuizScore(0); setWrongNotes([]);
  };
  const answerQuiz = (id: string) => {
    if (quizPick || quizIndex < 0 || quizIndex >= quiz.length) return;
    setQuizPick(id);
    if (id === quiz[quizIndex].note.id) setQuizScore((score) => score + 1);
    else setWrongNotes((wrong) => [...wrong, quiz[quizIndex]]);
  };
  const nextQuiz = () => { setQuizPick(""); setQuizIndex((index) => index + 1); };
  const [draft, setDraft] = useState({ brand: "삼성", model: "", kind: "학습" as "학습" | "처리이력", title: "", content: "" });
  const [busy, setBusy] = useState(false);

  // 기록이 1만 건 이상이라 전체 로드는 느리다 — 최근 200건씩 페이지 로드, 검색·필터는 서버(전체 대상)에서 수행
  const PAGE_SIZE = 200;
  const [hasMore, setHasMore] = useState(false);
  const buildListQuery = useCallback((offset: number) => {
    const parts = ["select=*", `order=created_at.${order}`, `limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (brand !== "전체") parts.push(`brand=eq.${encodeURIComponent(brand)}`);
    if (model !== "전체") parts.push(`model=eq.${encodeURIComponent(model)}`);
    if (kindFilter !== "전체") parts.push(`kind=eq.${encodeURIComponent(kindFilter)}`);
    const keyword = query.trim().replace(/["\\%,()]/g, "");
    if (keyword) {
      const pattern = `"*${keyword}*"`;
      parts.push(`or=${encodeURIComponent(`(title.ilike.${pattern},content.ilike.${pattern},model.ilike.${pattern},author.ilike.${pattern})`)}`);
    }
    return parts.join("&");
  }, [brand, model, kindFilter, query, order]);
  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    setError("");
    try {
      const rows = await selectRows<CopierNote>("copier_notes", buildListQuery(offset));
      setNotes((current) => (offset === 0 ? rows : [...current, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/dev-notes.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, [buildListQuery]);
  // 검색어 타이핑은 250ms 디바운스 후 서버 조회
  useEffect(() => { const timer = window.setTimeout(() => { void load(0); }, 250); return () => window.clearTimeout(timer); }, [load]);

  const filtered = notes; // 필터·검색은 서버에서 이미 적용됨

  const submit = async () => {
    if (busy || !draft.content.trim()) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    setBusy(true);
    try {
      await insertRow("copier_notes", { author, brand: draft.brand, model: draft.model.trim(), kind: draft.kind, title: draft.title.trim(), content: draft.content.trim() });
      setDraft({ ...draft, title: "", content: "" });
      setWriteOpen(false);
      await load(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeNote = async (note: CopierNote) => {
    if (note.author !== author) return;
    if (!window.confirm("이 기록을 삭제할까요?")) return;
    try {
      await deleteRows("copier_notes", `id=eq.${note.id}`);
      setNotes((current) => current.filter((n) => n.id !== note.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const currentQuiz = quizIndex >= 0 && quizIndex < quiz.length ? quiz[quizIndex] : null;

  return (
    <div className="space-y-4 pb-16">
      <div className="flex w-fit gap-1 rounded-md bg-slate-100 p-1">
        {([["notes", "📒 기록"], ["quiz", "🎓 복합기 퀴즈"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setView(key)} className={`rounded px-4 py-2 text-sm font-black ${view === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
        ))}
      </div>
      {view === "quiz" && <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {quizIndex < 0 && (() => {
          const bank = notes.filter((n) => n.title.trim() && n.content.trim());
          const bankOf = (name: string) => name === "전체" ? bank.length : bank.filter((n) => n.brand === name).length;
          return <div className="mx-auto max-w-xl py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-3xl shadow-lg shadow-blue-200">🎓</div>
            <h3 className="mt-3 text-xl font-black text-slate-950">복합기 기술 퀴즈</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">팀이 쌓은 <b className="text-blue-600">{bank.length}건</b>의 실제 처리 사례가 문제가 됩니다.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {["전체", ...BRAND_NAMES].map((name) => {
                const count = bankOf(name);
                return (
                  <button key={name} type="button" disabled={count < 4} onClick={() => setQuizBrand(name)} className={`rounded-md px-3 py-2 text-xs font-black transition ${quizBrand === name ? "bg-slate-900 text-white" : count < 4 ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                    {name} <span className={quizBrand === name ? "text-slate-300" : "text-slate-400"}>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex justify-center gap-2">
              {[5, 10].map((count) => <button key={count} type="button" onClick={() => setQuizCount(count)} className={`rounded-md px-5 py-2.5 text-sm font-black ${quizCount === count ? "bg-blue-600 text-white shadow-sm" : "border border-slate-200 text-slate-600"}`}>{count}문제</button>)}
            </div>
            <button type="button" onClick={startQuiz} className="mt-6 h-12 rounded-lg bg-blue-600 px-10 text-sm font-black text-white shadow-md shadow-blue-200 transition hover:bg-blue-500">퀴즈 시작 →</button>
            <p className="mt-3 text-[11px] font-bold text-slate-400">브랜드는 문제가 4건 이상일 때 선택할 수 있어요 · FIELD AS 전송이 쌓일수록 문제가 늘어납니다</p>
          </div>;
        })()}
        {currentQuiz && <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between text-xs font-black text-slate-400">
            <span>문제 {quizIndex + 1} / {quiz.length}</span><span className="text-blue-600">✓ {quizScore}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${((quizIndex + (quizPick ? 1 : 0)) / quiz.length) * 100}%` }} />
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap gap-1.5">
              <span className={`rounded px-2 py-0.5 text-[10px] font-black ${BRAND_TONE[currentQuiz.note.brand] || "bg-slate-100 text-slate-600"}`}>{currentQuiz.note.brand}</span>
              {currentQuiz.note.model && <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">{currentQuiz.note.model}</span>}
            </div>
            <div className="mt-2 text-base font-black text-slate-950">증상: {currentQuiz.note.title}</div>
            <div className="mt-1 text-xs font-bold text-slate-500">올바른 처리 내용을 고르세요</div>
          </div>
          <div className="mt-3 space-y-2">
            {currentQuiz.options.map((option, optionIndex) => {
              const picked = quizPick === option.id;
              const isAnswer = option.id === currentQuiz.note.id;
              const summary = (parseNoteContent(option.content)?.["처리"] || option.content).replace(/\n/g, " ");
              const tone = !quizPick ? "border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm"
                : isAnswer ? "border-emerald-400 bg-emerald-50"
                : picked ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white opacity-50";
              return (
                <button key={option.id} type="button" onClick={() => answerQuiz(option.id)} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm font-semibold leading-6 text-slate-700 transition ${tone}`}>
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${quizPick && isAnswer ? "bg-emerald-500 text-white" : quizPick && picked ? "bg-rose-400 text-white" : "bg-slate-100 text-slate-500"}`}>{["①", "②", "③", "④"][optionIndex]}</span>
                  <span className="min-w-0">{summary.length > 150 ? `${summary.slice(0, 150)}…` : summary}{quizPick && isAnswer && <b className="ml-2 text-xs text-emerald-600">✓ 정답</b>}</span>
                </button>
              );
            })}
          </div>
          {quizPick && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <div className="text-[10px] font-black text-blue-500">정답 사례 자세히</div>
            <NoteBody note={currentQuiz.note} />
            <div className="mt-1 text-[10px] font-bold text-slate-400">{currentQuiz.note.author || "익명"} · {currentQuiz.note.created_at.slice(0, 10)}</div>
          </div>}
          {quizPick && <div className="mt-4 flex justify-end">
            <button type="button" onClick={nextQuiz} className="rounded-lg bg-blue-600 px-7 py-3 text-sm font-black text-white shadow-sm">{quizIndex + 1 >= quiz.length ? "결과 보기 →" : "다음 문제 →"}</button>
          </div>}
        </div>}
        {quizIndex >= quiz.length && quiz.length > 0 && <div className="mx-auto max-w-2xl py-4 text-center">
          <div className="text-4xl">{quizScore === quiz.length ? "🏆" : quizScore >= quiz.length * 0.7 ? "👏" : quizScore >= quiz.length / 2 ? "🙂" : "💪"}</div>
          <h3 className="mt-2 text-2xl font-black text-slate-950">{quizScore} / {quiz.length}</h3>
          <p className="mt-1 text-sm font-bold text-slate-500">정답률 {Math.round((quizScore / quiz.length) * 100)}%{quizScore === quiz.length ? " — 완벽합니다!" : ""}</p>
          {wrongNotes.length > 0 && <div className="mt-5 space-y-2 text-left">
            <div className="text-xs font-black text-slate-400">오답 노트 {wrongNotes.length}건 — 실제 처리 사례로 복습하세요</div>
            {wrongNotes.map((item) => <div key={item.note.id} className="rounded-lg border border-rose-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-2 py-0.5 text-[10px] font-black ${BRAND_TONE[item.note.brand] || "bg-slate-100 text-slate-600"}`}>{item.note.brand}</span>
                {item.note.model && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{item.note.model}</span>}
                <span className="text-sm font-black text-slate-900">{item.note.title}</span>
              </div>
              <NoteBody note={item.note} />
            </div>)}
          </div>}
          <div className="mt-6 flex justify-center gap-2">
            {wrongNotes.length > 0 && <button type="button" onClick={retryWrong} className="rounded-lg border border-rose-300 bg-rose-50 px-6 py-3 text-sm font-black text-rose-700">오답만 다시 풀기</button>}
            <button type="button" onClick={() => { setQuizIndex(-1); setQuiz([]); }} className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-black text-white">새 퀴즈</button>
          </div>
        </div>}
      </section>}

      {view === "notes" && <>
      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            [`${stats.total.toLocaleString()}건`, "전체 기록"],
            [`${stats.learn.toLocaleString()}건`, "학습"],
            [`${stats.cases.toLocaleString()}건`, "처리이력"],
            [`+${stats.month.toLocaleString()}건`, "이번 달 신규"],
          ] as [string, string][]).map(([value, label]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-center shadow-sm">
              <div className="text-lg font-black text-slate-950">{value}</div>
              <div className="mt-0.5 text-[10px] font-bold text-slate-400">{label}</div>
            </div>
          ))}
        </div>
      )}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500">브랜드·기종별 수리 노하우와 처리 사례를 쌓는 팀 지식 베이스입니다.</p>
          <button type="button" onClick={() => { setWriteOpen(true); setDraft({ ...draft, brand: brand === "전체" ? "삼성" : brand, model: model === "전체" ? "" : model }); }} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white">+ 기록 추가</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {["전체", ...BRAND_NAMES].map((name) => (
            <button key={name} type="button" onClick={() => { setBrand(name); setModel("전체"); }} className={`rounded-md px-3 py-2 text-xs font-black ${brand === name ? "bg-slate-900 text-white" : `${BRAND_TONE[name] || "bg-slate-100 text-slate-500"}`}`}>
              {name}
            </button>
          ))}
        </div>
        {brand !== "전체" && (
          <div className="mt-2 flex flex-wrap gap-1">
            {["전체", ...(BRANDS[brand] || [])].map((name) => (
              <button key={name} type="button" onClick={() => setModel(name)} className={`rounded px-2.5 py-1.5 text-[11px] font-black ${model === name ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                {name}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="증상 · 해결 방법 · 작성자 검색" className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
          <div className="flex rounded-md bg-slate-100 p-1">
            {(["전체", "학습", "처리이력"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setKindFilter(value)} className={`rounded px-3 py-1.5 text-xs font-black ${kindFilter === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{value}</button>
            ))}
          </div>
          <div className="flex rounded-md bg-slate-100 p-1">
            {([["desc", "최신순"], ["asc", "오래된순"]] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setOrder(value)} className={`rounded px-3 py-1.5 text-xs font-black ${order === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
            ))}
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && !notes.length && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && !filtered.length && <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">{notes.length ? "조건에 맞는 기록이 없어요." : "첫 기록을 남겨보세요 — 같은 증상에서 팀 전체의 시간이 줄어듭니다."}</div>}

      <div className="grid gap-3 lg:grid-cols-2">
        {filtered.map((note) => (
          <article key={note.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className={`rounded px-2 py-0.5 text-[10px] font-black ${BRAND_TONE[note.brand] || "bg-slate-100 text-slate-600"}`}>{note.brand}</span>
                {note.model && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{note.model}</span>}
                <span className={`rounded px-2 py-0.5 text-[10px] font-black ${note.kind === "학습" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"}`}>{note.kind}</span>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => { void navigator.clipboard.writeText(`[${note.brand}${note.model ? ` ${note.model}` : ""}] ${note.title}\n${note.content}`); }} title="내용 복사" className="text-[11px] font-black text-slate-300 hover:text-blue-600">복사</button>
                {note.author === author && <button type="button" onClick={() => void removeNote(note)} className="text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>}
              </span>
            </div>
            {note.title && <div className="mt-2 text-sm font-black text-slate-900">{note.title}</div>}
            <NoteBody note={note} />
            <div className="mt-2 text-[11px] font-bold text-slate-400">{note.author || "익명"} · {note.created_at.slice(0, 10)}</div>
          </article>
        ))}
      </div>
      {hasMore && <button type="button" onClick={() => void load(notes.length)} disabled={loading} className="w-full rounded-lg border border-slate-200 bg-white py-3 text-sm font-black text-slate-600 shadow-sm hover:bg-slate-50 disabled:text-slate-300">{loading ? "불러오는 중…" : `더 보기 (현재 ${notes.length}건 표시)`}</button>}

      </>}

      {writeOpen && (
        <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setWriteOpen(false)}>
          <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-lg" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <b>복합기 기록 추가</b>
              <button type="button" onClick={() => setWriteOpen(false)} className="text-xs font-bold text-slate-400">닫기</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-slate-500">브랜드
                  <select value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value, model: "" })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                    {BRAND_NAMES.map((name) => <option key={name}>{name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-500">구분
                  <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "학습" | "처리이력" })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                    <option>학습</option><option>처리이력</option>
                  </select>
                </label>
              </div>
              <div className="text-xs font-bold text-slate-500">기종
                <div className="mt-1 flex flex-wrap gap-1">
                  {(BRANDS[draft.brand] || []).map((name) => (
                    <button key={name} type="button" onClick={() => setDraft({ ...draft, model: name })} className={`rounded px-2.5 py-1.5 text-[11px] font-black ${draft.model === name ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>
                  ))}
                </div>
                <input value={draft.model} list="copier-model-catalog" onChange={(e) => {
                  const value = e.target.value;
                  const detected = brandOfModel(value);
                  setDraft({ ...draft, model: value, ...(detected && BRAND_NAMES.includes(detected) ? { brand: detected } : {}) });
                }} placeholder="직접 입력 가능 — 정식 기종명 입력 시 브랜드 자동 선택" className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
                <datalist id="copier-model-catalog">{ALL_MODEL_NAMES.map((name) => <option key={name} value={name} />)}</datalist>
              </div>
              <label className="block text-xs font-bold text-slate-500">제목 (증상 요약)
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="예: 출력물 세로줄 발생" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
              </label>
              <label className="block text-xs font-bold text-slate-500">내용 (증상 · 원인 · 해결 방법)
                <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={6} placeholder={"증상:\n원인:\n해결:"} className="mt-1 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold leading-6" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={() => setWriteOpen(false)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">취소</button>
              <button type="button" disabled={busy || !draft.content.trim()} onClick={() => void submit()} className="rounded-md bg-slate-900 px-5 py-2 text-sm font-black text-white disabled:opacity-40">{busy ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
