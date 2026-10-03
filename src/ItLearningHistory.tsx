/**
 * IT 학습·처리이력 — 퍼스트전산 PC DB를 Supabase(it_rows)에서 읽고 쓴다(2026-10-03 개편).
 *  - 지식 DB · 처리이력 · 영업상담 · 교육자료 검색(서버 검색, 맞는 줄만), 기술 퀴즈(4지선다 자동 생성·결과 저장), AS 등록(DB에 바로)
 *  - 표(it_rows)가 아직 없으면 공개 구글 시트를 임시로 읽는다. [시트에서 가져오기]는 누구나 누를 수 있다.
 *  - Apps Script·원본 화면·기기별 주소 설정은 없앴다.
 */
import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, Database, GraduationCap, Link2, LoaderCircle, Megaphone, Plus, RefreshCw, Search, Wrench } from "lucide-react";
import ItDetail from "./ItDetail";
import { IT_SHEET_URL, type ItRow, type ItTabKey, type QuizQuestion, sheetTabUrl, valueByPrefix } from "./itSheet";
import { addHistory, importSheetToDb, type ItStatus, itStatus, LIST_LIMIT, listRows, makeQuiz, myQuizResults, type QuizResultRow, saveQuizResult } from "./itStore";

type View = ItTabKey | "quiz" | "register";
type Notice = { kind: "success" | "error" | "info"; text: string } | null;
const LIST_VIEWS: View[] = ["knowledge", "history", "sales", "links"];
const isListView = (v: View): v is ItTabKey => LIST_VIEWS.includes(v);

const VIEWS: Array<{ key: View; label: string; icon: typeof Search }> = [
  { key: "knowledge", label: "지식 DB", icon: BookOpen },
  { key: "history", label: "처리이력", icon: Wrench },
  { key: "sales", label: "영업상담", icon: Megaphone },
  { key: "links", label: "교육자료", icon: Link2 },
  { key: "quiz", label: "기술 퀴즈", icon: GraduationCap },
  { key: "register", label: "AS 등록", icon: Plus },
];

const EMPTY_FORM: Record<string, string> = {
  작성자: "", 구분: "AS", 레벨: "", 등급: "", 업체명: "", 부서명: "", 지역: "", 접수자: "",
  모델명: "", 시리얼번호: "", 자산기번: "", 제조사: "", 증상: "", 처리내용: "", 특이사항: "",
  도착시간: "", 소요시간: "",
};

function SearchField({ value, onChange, onSearch, placeholder, disabled }: { value: string; onChange: (value: string) => void; onSearch: () => void; placeholder: string; disabled?: boolean }) {
  return <div className="flex gap-2">
    <div className="relative min-w-0 flex-1">
      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
      <input value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }} placeholder={placeholder} disabled={disabled}
        className="h-10 w-full rounded-full bg-white/[0.08] pl-9 pr-4 text-sm font-semibold text-white outline-none transition placeholder:text-slate-500 focus:bg-white/[0.13] disabled:opacity-50" />
    </div>
    <button type="button" onClick={onSearch} disabled={disabled} className="h-10 shrink-0 rounded-full bg-blue-600 px-5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:bg-slate-600">검색</button>
  </div>;
}

function Empty({ text }: { text: string }) {
  return <div className="border-y border-slate-200 bg-white py-16 text-center"><Database size={28} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-400">{text}</p></div>;
}

const PLACEHOLDER: Record<ItTabKey, string> = { knowledge: "부품·증상·카테고리 검색", history: "업체명·자산번호·증상 검색", sales: "상황·멘트·항목 검색", links: "교육자료 검색" };

export default function ItLearningHistory({ author }: { author: string }) {
  const [view, setView] = useState<View>("knowledge");
  const [status, setStatus] = useState<ItStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ItRow[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<{ row: ItRow; tab: ItTabKey } | null>(null);

  const [quizPool, setQuizPool] = useState<QuizQuestion[]>([]);
  const [quizLevel, setQuizLevel] = useState("전체");
  const [quizCount, setQuizCount] = useState(10);
  const [quizIndex, setQuizIndex] = useState(-1);
  const [quizScore, setQuizScore] = useState(0);
  const [quizChoices, setQuizChoices] = useState<string[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [wrongNotes, setWrongNotes] = useState<QuizQuestion[]>([]);
  const [quizSaved, setQuizSaved] = useState<"" | "saving" | "saved" | "skip">("");
  const [myResults, setMyResults] = useState<QuizResultRow[]>([]);

  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY_FORM, 작성자: author || "" });

  const notify = (kind: "success" | "error" | "info", text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 3600);
  };
  const runSeq = useRef(0);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => {
    try { const parsed = JSON.parse(localStorage.getItem("it_recent_queries_v1") || "[]"); return Array.isArray(parsed) ? parsed.slice(0, 8) : []; } catch { return []; }
  });
  const rememberQuery = (value: string) => {
    const q = value.trim();
    if (!q) return;
    setRecentQueries((current) => {
      const next = [q, ...current.filter((item) => item !== q)].slice(0, 8);
      try { localStorage.setItem("it_recent_queries_v1", JSON.stringify(next)); } catch { /* 저장 실패 무시 */ }
      return next;
    });
  };

  const run = async (target: View = view, searchQuery = query) => {
    if (!isListView(target)) return;
    const seq = ++runSeq.current;
    setLoading(true);
    try {
      const apply = (r: { rows: ItRow[]; total: number; truncated: boolean }) => { setRows(r.rows); setTotal(r.total); setTruncated(r.truncated); };
      const result = await listRows(target, searchQuery, (fresh) => { if (seq === runSeq.current) apply(fresh); });
      if (seq !== runSeq.current) return; // 그 사이 다른 탭/검색으로 넘어감
      apply(result);
      if (searchQuery.trim() && result.rows.length) rememberQuery(searchQuery);
    } catch (error) {
      if (seq === runSeq.current) notify("error", error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.");
    } finally { if (seq === runSeq.current) setLoading(false); }
  };

  useEffect(() => {
    void itStatus().then(setStatus);
    void run("knowledge", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchView = (next: View) => {
    setView(next);
    setQuery("");
    setRows([]); setTotal(0); setTruncated(false);
    setSelected(null);
    if (isListView(next)) void run(next, "");
    if (next === "quiz" && status?.source === "db" && author) void myQuizResults(author).then(setMyResults).catch(() => { /* 무시 */ });
  };

  const runImport = async () => {
    if (!window.confirm("구글 시트의 네 탭(지식 DB·처리이력·영업상담·교육자료)을 DB로 가져옵니다.\n이미 있는 줄은 새 내용으로 바뀌고, 앱에서 등록한 처리이력은 그대로 남습니다. 진행할까요?")) return;
    setImporting("준비 중…");
    try {
      const n = await importSheetToDb(setImporting);
      const s = await itStatus(true); setStatus(s);
      notify("success", `시트 ${n}줄을 DB로 가져왔습니다.`);
      if (isListView(view)) void run(view, query);
    } catch (error) { notify("error", error instanceof Error ? error.message : "가져오지 못했습니다."); }
    finally { setImporting(""); }
  };

  const startQuiz = async () => {
    setLoading(true);
    try {
      const picked = await makeQuiz(quizCount, quizLevel);
      if (!picked.length) { notify("error", "선택한 레벨의 문제가 없습니다."); return; }
      setQuizPool(picked); setQuizIndex(0); setQuizScore(0); setQuizChoices([]); setQuizSubmitted(false); setWrongNotes([]); setQuizSaved("");
    } catch (error) { notify("error", error instanceof Error ? error.message : "퀴즈를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  };

  const currentQuiz = quizIndex >= 0 ? quizPool[quizIndex] : null;
  const answerQuiz = (choice: string) => {
    if (!currentQuiz || quizSubmitted) return;
    const need = currentQuiz.isMulti ? 2 : 1;
    const next = quizChoices.includes(choice) ? quizChoices.filter((item) => item !== choice) : [...quizChoices, choice];
    setQuizChoices(next);
    if (next.length !== need) return;
    const answers = currentQuiz.isMulti ? currentQuiz.multiAnswer || [] : [currentQuiz.정답];
    const correct = next.length === answers.length && next.every((item) => answers.includes(item));
    if (correct) setQuizScore((score) => score + 1);
    else setWrongNotes((notes) => [...notes, currentQuiz]);
    setQuizSubmitted(true);
  };

  const finishQuiz = (score: number, wrong: QuizQuestion[]) => {
    setQuizIndex(quizPool.length);
    if (status?.source !== "db" || !author) { setQuizSaved("skip"); return; }
    setQuizSaved("saving");
    saveQuizResult({ name: author, level: quizLevel, score, total: quizPool.length, wrong: wrong.map((w) => ({ 문제: w.문제, 정답: w.정답, 카테고리: w.카테고리 })) })
      .then(() => { setQuizSaved("saved"); void myQuizResults(author).then(setMyResults).catch(() => { /* 무시 */ }); })
      .catch(() => setQuizSaved("skip"));
  };
  const nextQuiz = () => {
    if (quizIndex + 1 >= quizPool.length) finishQuiz(quizScore, wrongNotes);
    else { setQuizIndex((index) => index + 1); setQuizChoices([]); setQuizSubmitted(false); }
  };

  const submitForm = async () => {
    if (!String(form.증상 || "").trim()) { notify("error", "증상은 필수입니다."); return; }
    setLoading(true);
    try {
      await addHistory(form, author);
      notify("success", "IT AS 처리이력을 등록했습니다 — 처리이력 탭 맨 위에 보입니다.");
      setForm({ ...EMPTY_FORM, 작성자: author || "" });
    } catch (error) { notify("error", error instanceof Error ? error.message : "등록하지 못했습니다."); }
    finally { setLoading(false); }
  };

  const titleFor = (row: ItRow, tab: ItTabKey) => tab === "knowledge" ? valueByPrefix(row, "부품명", "부품") || "IT 지식"
    : tab === "history" ? String(row.제목 || row.업체명 || "처리이력")
      : tab === "sales" ? String(row.항목명 || "상담") : String(row.제목 || row.분류 || "교육자료");
  const summaryFor = (row: ItRow, tab: ItTabKey) => tab === "knowledge" ? valueByPrefix(row, "설명", "AI설명", "증상")
    : tab === "history" ? String(row.증상 || row.조치 || "")
      : tab === "sales" ? valueByPrefix(row, "업무특성", "고객 공감")
        : [row.갱신 ? `갱신 ${row.갱신}` : "", row.문항수 ? `${row.문항수}장` : ""].filter(Boolean).join(" · ");
  const badgeFor = (row: ItRow, tab: ItTabKey) => tab === "knowledge" ? String(row.카테고리 || "IT") : tab === "history" ? String(row.분류 || "이력") : tab === "sales" ? String(row.구분 || "상담") : String(row.분류 || "자료");

  const db = status?.source === "db";
  const levels = ["1", "2", "3", "4", "5"];

  return <div className="space-y-4">
    {notice && <div className={`fixed right-4 top-20 z-[5000] max-w-sm rounded-lg px-4 py-3 text-sm font-bold text-white shadow-xl ${notice.kind === "success" ? "bg-emerald-600" : notice.kind === "error" ? "bg-rose-600" : "bg-slate-800"}`}>{notice.text}</div>}

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1E252F] px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-black text-white lg:text-lg">IT 학습·처리이력</h2>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
            {status === null ? "저장소 확인 중…" : db ? `퍼스트전산 PC DB — Supabase에서 바로 검색합니다 · 지식 ${status.dbRows.toLocaleString()}건` : status.tableReady ? "DB 표는 있지만 비어 있습니다 — [시트에서 가져오기]를 누르면 바로 채워집니다. 그동안은 시트를 직접 읽습니다." : "DB 표가 아직 없어 구글 시트를 직접 읽는 중입니다(임시). 관리자가 supabase/it_db.sql을 1회 실행하면 DB로 넘어갑니다."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {status?.tableReady && <button type="button" onClick={() => void runImport()} disabled={Boolean(importing)}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3.5 py-1.5 text-xs font-black text-emerald-300 transition hover:bg-emerald-400/25 disabled:opacity-60">
            <RefreshCw size={14} className={importing ? "animate-spin" : ""} />{importing || (db ? "시트에서 다시 가져오기" : "시트에서 가져오기")}</button>}
          <a href={IT_SHEET_URL} target="_blank" rel="noreferrer" className="rounded-full bg-white/[0.07] px-3 py-1.5 text-[11px] font-bold text-slate-300 transition hover:bg-white/20 hover:text-white">시트 원본 ↗</a>
        </div>
      </div>
      <div className="flex overflow-x-auto">
        {VIEWS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => switchView(key)}
            className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-3.5 text-sm font-black transition ${view === key ? "text-slate-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:text-slate-700"}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>
    </section>

    {isListView(view) && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-[#151A23] p-3.5"><SearchField value={query} onChange={setQuery} onSearch={() => void run()} disabled={loading} placeholder={PLACEHOLDER[view]} />
        {recentQueries.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-black text-slate-500">최근</span>
          {recentQueries.map((item) => (
            <button key={item} type="button" onClick={() => { setQuery(item); void run(view, item); }} className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-white/[0.14] hover:text-slate-200">{item}</button>
          ))}
          <button type="button" onClick={() => { setRecentQueries([]); try { localStorage.removeItem("it_recent_queries_v1"); } catch { /* 무시 */ } }} className="text-[10px] font-bold text-slate-600 transition hover:text-slate-400">지우기</button>
        </div>}</div>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-[11px] font-bold text-slate-400">
        <span className="tabular-nums">{loading ? "불러오는 중…" : truncated ? `${total.toLocaleString()}건 중 처음 ${LIST_LIMIT}건 — 검색어로 좁히세요` : `검색 결과 ${total.toLocaleString()}건`}</span>
        {query && <button type="button" onClick={() => { setQuery(""); void run(view, ""); }} className="font-black text-blue-600">전체 보기</button>}
      </div>
      {loading && !rows.length ? <div className="flex items-center justify-center py-20"><LoaderCircle className="animate-spin text-blue-600" /></div> : rows.length === 0 ? <Empty text="검색 결과가 없습니다." /> : <div className="divide-y divide-slate-100">{rows.map((row, index) => {
        const title = titleFor(row, view), summary = summaryFor(row, view);
        const badge = <span className="flex h-9 min-w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 px-2 text-[10px] font-black text-slate-500">{badgeFor(row, view).slice(0, 5)}</span>;
        const body = <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-slate-900">{title}</span><span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{summary || "세부 내용을 확인하세요."}</span>{view !== "links" && <span className="mt-0.5 block text-[11px] font-semibold text-slate-400">{String(row.업체명 || row.제조사 || row.등록일 || row.난이도 && `Lv.${row.난이도}` || "")}</span>}</span>;
        if (view === "links") return <a key={String(row.링크 || index)} href={String(row.링크 || "#")} target="_blank" rel="noreferrer" className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50">{badge}{body}<ChevronRight size={17} className="text-slate-300" /></a>;
        return <button key={String(row._id || row.ID || index)} type="button" onClick={() => setSelected({ row, tab: view })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50">{badge}{body}<ChevronRight size={17} className="text-slate-300" /></button>;
      })}</div>}
    </section>}

    {view === "quiz" && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {quizIndex < 0 ? <div className="mx-auto max-w-2xl py-6 text-center"><GraduationCap size={36} className="mx-auto text-blue-600" /><h3 className="mt-3 text-xl font-black text-slate-950">IT 기술력 퀴즈</h3><p className="mt-1 text-sm font-semibold text-slate-500">레벨을 선택하고 현장 기술을 점검합니다. 보기는 지식 DB에서 자동으로 만듭니다.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-1.5">{levels.map((level) => <button key={level} type="button" onClick={() => setQuizLevel(level)} className={`h-10 min-w-16 rounded-full px-4 text-xs font-black transition ${quizLevel === level ? "bg-blue-600 text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)]" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>Lv.{level}</button>)}<button type="button" onClick={() => setQuizLevel("전체")} className={`h-10 rounded-full px-4 text-xs font-black transition ${quizLevel === "전체" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>전체</button></div>
        <div className="mt-3 flex justify-center gap-2">{[10, 20].map((count) => <button key={count} type="button" onClick={() => setQuizCount(count)} className={`rounded-full px-4 py-2 text-sm font-black transition ${quizCount === count ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{count}문제</button>)}</div>
        <button type="button" onClick={() => void startQuiz()} disabled={loading} className="mt-6 h-11 rounded-full bg-blue-600 px-7 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700 disabled:bg-slate-300">{loading ? "문제 만드는 중…" : "퀴즈 시작"}</button>
        {myResults.length > 0 && <div className="mx-auto mt-6 max-w-sm text-left"><div className="text-[11px] font-black text-slate-400">내 최근 기록</div><div className="mt-1 divide-y divide-slate-100 rounded-xl border border-slate-200">{myResults.map((r) => <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs font-bold text-slate-600"><span>{r.created_at.slice(0, 10)} · {r.level === "전체" ? "전체" : `Lv.${r.level}`}</span><span className="tabular-nums text-slate-900">{r.score}/{r.total} <span className="text-slate-400">({Math.round((r.score / Math.max(1, r.total)) * 100)}%)</span></span></div>)}</div></div>}
      </div>
      : quizIndex >= quizPool.length ? <div className="mx-auto max-w-2xl py-8 text-center"><CheckCircle2 size={40} className="mx-auto text-emerald-600" /><div className="mt-3 text-3xl font-black text-slate-950">{quizScore}/{quizPool.length}</div><p className="mt-1 text-sm font-bold text-slate-500">정답률 {Math.round((quizScore / quizPool.length) * 100)}%{quizSaved === "saved" ? " · 기록 저장됨 ✓" : quizSaved === "saving" ? " · 저장 중…" : ""}</p>
        {wrongNotes.length > 0 && <div className="mt-6 space-y-2 text-left"><h4 className="text-sm font-black text-slate-900">오답노트 {wrongNotes.length}건</h4>{wrongNotes.map((item, index) => <div key={index} className="rounded-lg border-l-4 border-rose-400 bg-rose-50 p-3"><div className="text-xs font-black text-rose-700">{item.카테고리} · {item.부품명}</div><div className="mt-1 text-sm font-bold text-slate-800">{item.문제}</div><div className="mt-1 text-xs font-semibold text-emerald-700">정답: {item.isMulti ? item.multiAnswer?.join(", ") : item.정답}</div>{item.AI해설 && <div className="mt-1 text-xs font-semibold text-violet-800">{item.AI해설}</div>}</div>)}</div>}
        <button type="button" onClick={() => setQuizIndex(-1)} className="mt-6 rounded-full bg-slate-900 px-6 py-3 text-sm font-black text-white transition hover:bg-slate-800">다시 풀기</button></div>
      : currentQuiz && <div className="mx-auto max-w-2xl"><div className="flex items-center justify-between text-xs font-black tabular-nums text-slate-400"><span>{quizIndex + 1}/{quizPool.length}</span><span>점수 {quizScore}</span></div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${((quizIndex + (quizSubmitted ? 1 : 0)) / Math.max(1, quizPool.length)) * 100}%` }} /></div>
        <div className="mt-3 rounded-lg bg-slate-50 p-4"><div className="text-xs font-black text-blue-600">{currentQuiz.카테고리} · Lv.{currentQuiz.난이도 || "-"}</div><h3 className="mt-2 text-lg font-black leading-7 text-slate-950">{currentQuiz.문제}</h3>{currentQuiz.isMulti && <div className="mt-2 text-xs font-bold text-amber-700">정답 2개를 선택하세요.</div>}</div>
        <div className="mt-3 grid gap-2">{currentQuiz.보기.map((choice) => { const answer = currentQuiz.isMulti ? currentQuiz.multiAnswer || [] : [currentQuiz.정답]; const selectedChoice = quizChoices.includes(choice); const tone = quizSubmitted ? answer.includes(choice) ? "border-emerald-500 bg-emerald-50 text-emerald-800" : selectedChoice ? "border-rose-400 bg-rose-50 text-rose-800" : "border-slate-200 text-slate-400" : selectedChoice ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700"; return <button key={choice} type="button" disabled={quizSubmitted} onClick={() => answerQuiz(choice)} className={`min-h-12 rounded-lg border px-4 py-3 text-left text-sm font-bold ${tone}`}>{choice}</button>; })}</div>
        {quizSubmitted && <div className="mt-3 space-y-2">{currentQuiz.AI해설 && <div className="rounded-lg bg-violet-50 p-3 text-sm font-semibold leading-6 text-violet-900">{currentQuiz.AI해설}</div>}{currentQuiz.주의사항 && <div className="rounded-lg bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900">⚠ {currentQuiz.주의사항}</div>}<button type="button" onClick={nextQuiz} className="h-11 w-full rounded-full bg-slate-900 text-sm font-black text-white transition hover:bg-slate-800">{quizIndex + 1 >= quizPool.length ? "결과 보기" : "다음 문제"}</button></div>}</div>}
    </section>}

    {view === "register" && !db && <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-10 text-center shadow-sm">
      <Database size={28} className="mx-auto text-amber-600" />
      <h3 className="mt-3 text-base font-black text-slate-900">DB로 넘어가면 여기서 바로 등록됩니다</h3>
      <p className="mx-auto mt-1 max-w-md text-sm font-semibold text-slate-600">지금은 시트를 임시로 읽는 중이라 쓰기가 안 됩니다. {status?.tableReady ? "위의 [시트에서 가져오기]를 한 번 누르면" : "관리자가 DB 표를 만들고 [시트에서 가져오기]를 누르면"} AS 등록이 열립니다. 급하면 시트에 직접 적어 주세요.</p>
      <a href={sheetTabUrl("history")} target="_blank" rel="noreferrer" className="mt-5 inline-flex h-10 items-center rounded-full bg-slate-900 px-5 text-sm font-black text-white transition hover:bg-slate-800">PC DB 시트 열기 ↗</a>
    </section>}
    {view === "register" && db && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-4"><h3 className="text-base font-black text-slate-950 lg:text-lg">IT AS 처리이력 등록</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-400">현장 처리 내용을 PC DB에 바로 누적합니다. 증상만 필수입니다.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">{Object.keys(EMPTY_FORM).map((key) => { const long = ["증상", "처리내용", "특이사항"].includes(key); return <label key={key} className={long ? "sm:col-span-2" : ""}><span className="mb-1 block text-xs font-bold text-slate-500">{key}{key === "증상" && <b className="text-rose-500"> *</b>}</span>{long ? <textarea value={form[key] || ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} rows={3} className="w-full resize-y rounded-lg border border-slate-300 p-2.5 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /> : key === "구분" || key === "레벨" ? <select value={form[key] || ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">{(key === "구분" ? ["AS", "설치", "점검", "기타"] : ["", "1", "2", "3"]).map((option) => <option key={option} value={option}>{option || "선택"}</option>)}</select> : <input value={form[key] || ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 px-2.5 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />}</label>; })}</div>
      <button type="button" onClick={() => void submitForm()} disabled={loading} className="mt-5 h-12 w-full rounded-full bg-blue-600 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:bg-slate-300">처리이력 등록</button></section>}

    {selected && <ItDetail row={selected.row} tab={selected.tab} onClose={() => setSelected(null)} />}
  </div>;
}
