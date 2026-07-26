/**
 * 복합기 학습·처리이력 — 브랜드/기종별 수리 노하우와 처리 사례를 쌓는 팀 지식 베이스.
 * (supabase/dev-notes.sql의 copier_notes 테이블)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows } from "./supabase";

type CopierNote = {
  id: string; created_at: string; author: string; brand: string; model: string;
  kind: "학습" | "처리이력"; title: string; content: string;
};

const BRANDS: Record<string, string[]> = {
  삼성: ["MX3", "MX4", "MX7", "흑백기"],
  신도: ["320", "410", "420", "450", "N501"],
  제록스: ["키슈/세이토", "마블", "베니/보탄", "헤라", "세레스", "305", "5005"],
  교세라: ["2100", "2101", "5521", "5526"],
  브라더: ["5700", "8900"],
  오키: ["5473"],
  기타: [],
};
const BRAND_NAMES = Object.keys(BRANDS);
const BRAND_TONE: Record<string, string> = {
  삼성: "bg-blue-50 text-blue-700", 신도: "bg-emerald-50 text-emerald-700", 제록스: "bg-rose-50 text-rose-700",
  교세라: "bg-amber-50 text-amber-700", 브라더: "bg-violet-50 text-violet-700", 오키: "bg-cyan-50 text-cyan-700",
  기타: "bg-slate-100 text-slate-600",
};

type QuizItem = { note: CopierNote; options: CopierNote[] };

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
  const answerQuiz = (id: string) => {
    if (quizPick || quizIndex < 0 || quizIndex >= quiz.length) return;
    setQuizPick(id);
    if (id === quiz[quizIndex].note.id) setQuizScore((score) => score + 1);
    else setWrongNotes((wrong) => [...wrong, quiz[quizIndex]]);
  };
  const nextQuiz = () => { setQuizPick(""); setQuizIndex((index) => index + 1); };
  const [draft, setDraft] = useState({ brand: "삼성", model: "", kind: "학습" as "학습" | "처리이력", title: "", content: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setNotes(await selectRows<CopierNote>("copier_notes", "select=*&order=created_at.desc&limit=1000"));
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/dev-notes.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return notes.filter((note) => {
      if (brand !== "전체" && note.brand !== brand) return false;
      if (model !== "전체" && note.model !== model) return false;
      if (kindFilter !== "전체" && note.kind !== kindFilter) return false;
      if (!keyword) return true;
      return [note.title, note.content, note.model, note.author].join(" ").toLowerCase().includes(keyword);
    });
  }, [notes, brand, model, kindFilter, query]);

  const countOf = (targetBrand: string, targetModel?: string) => notes.filter((note) =>
    note.brand === targetBrand && (targetModel === undefined || note.model === targetModel)).length;

  const submit = async () => {
    if (busy || !draft.content.trim()) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    setBusy(true);
    try {
      await insertRow("copier_notes", { author, brand: draft.brand, model: draft.model.trim(), kind: draft.kind, title: draft.title.trim(), content: draft.content.trim() });
      setDraft({ ...draft, title: "", content: "" });
      setWriteOpen(false);
      await load();
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
        {quizIndex < 0 && <div className="mx-auto max-w-xl py-4 text-center">
          <div className="text-3xl">🎓</div>
          <h3 className="mt-2 text-xl font-black text-slate-950">복합기 기술 퀴즈</h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">팀이 쌓은 처리 사례로 만드는 문제 — 증상을 보고 올바른 처리를 고르세요.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-1">
            {["전체", ...BRAND_NAMES].map((name) => (
              <button key={name} type="button" onClick={() => setQuizBrand(name)} className={`rounded-md px-3 py-2 text-xs font-black ${quizBrand === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>
            ))}
          </div>
          <div className="mt-3 flex justify-center gap-2">
            {[5, 10].map((count) => <button key={count} type="button" onClick={() => setQuizCount(count)} className={`rounded-md px-4 py-2 text-sm font-black ${quizCount === count ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "border border-slate-200 text-slate-600"}`}>{count}문제</button>)}
          </div>
          <button type="button" onClick={startQuiz} className="mt-5 h-11 rounded-md bg-blue-600 px-8 text-sm font-black text-white">퀴즈 시작</button>
          <p className="mt-3 text-[11px] font-bold text-slate-400">문제 은행: 제목·내용이 채워진 기록 {notes.filter((n) => n.title.trim() && n.content.trim()).length}건</p>
        </div>}
        {currentQuiz && <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between text-xs font-black text-slate-400">
            <span>{quizIndex + 1} / {quiz.length}</span><span>점수 {quizScore}</span>
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 p-4">
            <div className="flex flex-wrap gap-1.5">
              <span className={`rounded px-2 py-0.5 text-[10px] font-black ${BRAND_TONE[currentQuiz.note.brand] || "bg-slate-100 text-slate-600"}`}>{currentQuiz.note.brand}</span>
              {currentQuiz.note.model && <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">{currentQuiz.note.model}</span>}
            </div>
            <div className="mt-2 text-base font-black text-slate-950">증상: {currentQuiz.note.title}</div>
            <div className="mt-1 text-xs font-bold text-slate-500">올바른 처리 내용을 고르세요</div>
          </div>
          <div className="mt-3 space-y-2">
            {currentQuiz.options.map((option) => {
              const picked = quizPick === option.id;
              const isAnswer = option.id === currentQuiz.note.id;
              const tone = !quizPick ? "border-slate-200 bg-white hover:border-blue-300"
                : isAnswer ? "border-emerald-400 bg-emerald-50"
                : picked ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white opacity-60";
              return (
                <button key={option.id} type="button" onClick={() => answerQuiz(option.id)} className={`block w-full rounded-lg border p-3 text-left text-sm font-semibold leading-6 text-slate-700 transition ${tone}`}>
                  {option.content.length > 160 ? `${option.content.slice(0, 160)}…` : option.content}
                  {quizPick && isAnswer && <span className="ml-2 text-xs font-black text-emerald-600">✓ 정답</span>}
                </button>
              );
            })}
          </div>
          {quizPick && <div className="mt-4 flex justify-end">
            <button type="button" onClick={nextQuiz} className="rounded-md bg-blue-600 px-6 py-2.5 text-sm font-black text-white">{quizIndex + 1 >= quiz.length ? "결과 보기" : "다음 문제"}</button>
          </div>}
        </div>}
        {quizIndex >= quiz.length && quiz.length > 0 && <div className="mx-auto max-w-2xl py-4 text-center">
          <div className="text-3xl">{quizScore === quiz.length ? "🏆" : quizScore >= quiz.length / 2 ? "👏" : "💪"}</div>
          <h3 className="mt-2 text-xl font-black text-slate-950">{quiz.length}문제 중 {quizScore}개 정답</h3>
          {wrongNotes.length > 0 && <div className="mt-4 space-y-2 text-left">
            <div className="text-xs font-black text-slate-400">오답 노트 — 다시 확인하세요</div>
            {wrongNotes.map((item) => <div key={item.note.id} className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
              <div className="text-sm font-black text-slate-900">[{item.note.brand}{item.note.model ? ` ${item.note.model}` : ""}] {item.note.title}</div>
              <p className="mt-1 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-600">{item.note.content}</p>
            </div>)}
          </div>}
          <button type="button" onClick={() => { setQuizIndex(-1); setQuiz([]); }} className="mt-5 rounded-md border border-slate-300 px-6 py-2.5 text-sm font-black text-slate-700">다시 풀기</button>
        </div>}
      </section>}

      {view === "notes" && <>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500">브랜드·기종별 수리 노하우와 처리 사례를 쌓는 팀 지식 베이스입니다.</p>
          <button type="button" onClick={() => { setWriteOpen(true); setDraft({ ...draft, brand: brand === "전체" ? "삼성" : brand, model: model === "전체" ? "" : model }); }} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white">+ 기록 추가</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {["전체", ...BRAND_NAMES].map((name) => (
            <button key={name} type="button" onClick={() => { setBrand(name); setModel("전체"); }} className={`rounded-md px-3 py-2 text-xs font-black ${brand === name ? "bg-slate-900 text-white" : `${BRAND_TONE[name] || "bg-slate-100 text-slate-500"}`}`}>
              {name}{name !== "전체" && countOf(name) > 0 ? ` ${countOf(name)}` : ""}
            </button>
          ))}
        </div>
        {brand !== "전체" && (
          <div className="mt-2 flex flex-wrap gap-1">
            {["전체", ...(BRANDS[brand] || [])].map((name) => (
              <button key={name} type="button" onClick={() => setModel(name)} className={`rounded px-2.5 py-1.5 text-[11px] font-black ${model === name ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                {name}{name !== "전체" && countOf(brand, name) > 0 ? ` ${countOf(brand, name)}` : ""}
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
        </div>
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
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
              {note.author === author && <button type="button" onClick={() => void removeNote(note)} className="shrink-0 text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>}
            </div>
            {note.title && <div className="mt-2 text-sm font-black text-slate-900">{note.title}</div>}
            <p className="mt-1.5 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">{note.content}</p>
            <div className="mt-2 text-[11px] font-bold text-slate-400">{note.author || "익명"} · {note.created_at.slice(0, 10)}</div>
          </article>
        ))}
      </div>

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
                <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="직접 입력 가능" className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
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
