/**
 * IT 학습·처리이력 — IT파트가 관리하는 PC DB 구글 시트를 '보는 창'(2026-10-03 개편).
 *  - 원본·관리는 IT 담당자(구글 시트 + Apps Script). FIELD는 공개 시트를 그대로 읽기만 하고 우리 DB로 복사하지 않는다.
 *  - 지식 DB · 처리이력 · 영업상담 · 교육자료 검색, 기술 퀴즈(4지선다 자동 생성)는 설정 없이 바로.
 *  - AS 등록(시트에 쓰기)만 담당자의 Apps Script 주소가 있을 때 — 주소는 이 기기에 저장된다.
 */
import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, GraduationCap, Link2, Megaphone, Plus, Search, Settings2, Wrench } from "lucide-react";
import { UI } from "./ui/card";
import StateBox from "./ui/StateBox";
import ItDetail from "./ItDetail";
import ItPracticeForm from "./ItPracticeForm";
import { createOnceGuard, ItLogsMissingError, saveQuizAttempt } from "./itLogs";
import { asItRows, buildQuiz, getTabRows, IT_SHEET_URL, type ItRow, type ItTabKey, type QuizQuestion, searchRows, sheetTabUrl, valueByPrefix } from "./itSheet";
import { getItTechApiUrl, itTechApi, saveItTechApiUrl } from "./itTechApi";

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
    <button type="button" onClick={onSearch} disabled={disabled} className={`${UI.btn} shrink-0 px-5`}>검색</button>
  </div>;
}

const PLACEHOLDER: Record<ItTabKey, string> = { knowledge: "부품·증상·카테고리 검색", history: "업체명·자산번호·증상 검색", sales: "상황·멘트·항목 검색", links: "교육자료 검색" };

export default function ItLearningHistory({ author }: { author: string }) {
  const [view, setView] = useState<View>("knowledge");
  const [endpoint, setEndpoint] = useState(getItTechApiUrl());
  const [endpointDraft, setEndpointDraft] = useState(getItTechApiUrl());
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ItRow[]>([]);
  const [selected, setSelected] = useState<{ row: ItRow; tab: ItTabKey } | null>(null);
  const [listError, setListError] = useState(""); // 목록 불러오기 실패 표시용(빈 결과와 구분) — 2026-10-24

  const [quizPool, setQuizPool] = useState<QuizQuestion[]>([]);
  const [quizLevel, setQuizLevel] = useState("전체");
  const [quizCount, setQuizCount] = useState(10);
  const [quizIndex, setQuizIndex] = useState(-1);
  const [quizScore, setQuizScore] = useState(0);
  const [quizChoices, setQuizChoices] = useState<string[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [wrongNotes, setWrongNotes] = useState<QuizQuestion[]>([]);
  const [quizSaveState, setQuizSaveState] = useState<"idle" | "saved" | "missing" | "noauthor" | "error">("idle");
  const quizRunId = useRef(0);
  const quizSaveGuard = useRef(createOnceGuard());

  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY_FORM, 작성자: author || "" });

  const connected = Boolean(endpoint);
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
    setListError("");
    try {
      // 기기에 저장된 지난 결과가 있으면 0초에 먼저 보여주고, 새로 받은 시트로 조용히 갈아 끼운다
      const { rows: base } = await getTabRows(target, (fresh) => { if (seq === runSeq.current) setRows(asItRows(searchRows(fresh, searchQuery))); });
      if (seq !== runSeq.current) return; // 그 사이 다른 탭/검색으로 넘어감
      const list = asItRows(searchRows(base, searchQuery));
      setRows(list);
      if (searchQuery.trim() && list.length) rememberQuery(searchQuery);
    } catch (error) {
      if (seq === runSeq.current) {
        const message = error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";
        setListError(message);
        notify("error", message);
      }
    } finally { if (seq === runSeq.current) setLoading(false); }
  };

  useEffect(() => {
    void run("knowledge", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchView = (next: View) => {
    setView(next);
    setQuery("");
    setRows([]);
    setSelected(null);
    if (isListView(next)) void run(next, "");
  };

  const saveEndpoint = async () => {
    const next = saveItTechApiUrl(endpointDraft);
    setEndpoint(next);
    if (!next) { notify("info", "Apps Script 주소를 비웠습니다. 조회·퀴즈는 그대로 됩니다."); setConnectionOpen(false); return; }
    setLoading(true);
    try {
      await itTechApi.ping();
      setConnectionOpen(false);
      notify("success", "IT 담당자 Apps Script와 연결했습니다 — AS 등록을 쓸 수 있습니다.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "연결에 실패했습니다."); }
    finally { setLoading(false); }
  };

  const startQuiz = async () => {
    setLoading(true);
    try {
      const { rows: base } = await getTabRows("knowledge"); // IT기술력DB의 퀴즈문제·퀴즈답으로 4지선다를 만든다
      const picked = buildQuiz(base, quizCount, quizLevel);
      if (!picked.length) { notify("error", "선택한 레벨의 문제가 없습니다."); return; }
      quizRunId.current += 1; setQuizSaveState("idle");
      setQuizPool(picked); setQuizIndex(0); setQuizScore(0); setQuizChoices([]); setQuizSubmitted(false); setWrongNotes([]);
    } catch (error) { notify("error", error instanceof Error ? error.message : "퀴즈를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  };

  // 완료 화면에 닿는 순간 1회만 기록(퀴즈 시작마다 runId 가 바뀐다) — KPI 용
  const recordQuizAttempt = async () => {
    if (!author) { setQuizSaveState("noauthor"); return; }
    const key = String(quizRunId.current);
    if (!quizSaveGuard.current.take(key)) return;
    try {
      await saveQuizAttempt({ author, level: quizLevel, total: quizPool.length, score: quizScore });
      setQuizSaveState("saved");
    } catch (error) {
      if (error instanceof ItLogsMissingError) setQuizSaveState("missing");
      else { quizSaveGuard.current.release(key); setQuizSaveState("error"); }
    }
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
  const nextQuiz = () => {
    if (quizIndex + 1 >= quizPool.length) { setQuizIndex(quizPool.length); void recordQuizAttempt(); }
    else { setQuizIndex((index) => index + 1); setQuizChoices([]); setQuizSubmitted(false); }
  };

  const submitForm = async () => {
    if (!String(form.증상 || "").trim()) { notify("error", "증상은 필수입니다."); return; }
    if (!connected) { setConnectionOpen(true); return; }
    setLoading(true);
    try {
      const result = await itTechApi.addRecord(form);
      notify("success", `IT AS 이력을 PC DB에 등록했습니다${result.id ? ` (ID ${result.id})` : ""}.`);
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
  const levels = ["1", "2", "3", "4", "5"];

  return <div className="space-y-4">
    {notice && <div role="status" className={`fixed inset-x-4 top-20 z-[5000] rounded-lg px-4 py-3 text-sm font-bold text-white shadow-xl sm:inset-x-auto sm:right-4 sm:max-w-sm ${notice.kind === "success" ? "bg-emerald-600" : notice.kind === "error" ? "bg-rose-600" : "bg-slate-800"}`}>{notice.text}</div>}

    <section className={UI.card}>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${UI.heroHead}`}>
        <div className="min-w-0">
          <h2 className="text-base font-black text-white lg:text-lg">IT 학습·처리이력</h2>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">IT파트가 관리하는 PC DB 시트를 그대로 읽습니다 — 지식·처리이력·영업상담·교육자료 검색과 기술 퀴즈는 설정 없이 바로.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setConnectionOpen((open) => !open)} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-black transition lg:min-h-9 ${connected ? "bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25" : "bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white"}`}>
            <Settings2 size={14} />{connected ? "AS 등록 연결됨" : "AS 등록 연결"}</button>
          <a href={IT_SHEET_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-white/10 px-3.5 text-[11px] font-bold text-slate-300 transition hover:bg-white/20 hover:text-white lg:min-h-9">시트 원본 ↗</a>
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

    <ItPracticeForm author={author} />

    {connectionOpen && <section className={`${UI.card} ${UI.body}`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row">
        <input value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} placeholder="IT 담당자가 준 Apps Script 웹 앱 /exec 주소" aria-label="Apps Script 주소" className={`${UI.input} min-w-0 flex-1`} />
        <button type="button" onClick={() => void saveEndpoint()} className={UI.btn}>연결 확인</button>
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-[11px] font-semibold text-slate-400">조회·퀴즈는 이 주소 없이 됩니다. <b>AS 등록(PC DB 시트에 쓰기)</b>만 IT 담당자의 Apps Script를 거칩니다 — 담당자가 저장소의 <code>apps-script/it-tech-api-adapter.gs</code>를 자기 스크립트에 붙여 배포한 주소를 넣으세요. 주소는 이 기기에만 저장됩니다.</p>
    </section>}

    {isListView(view) && <section className={UI.card}>
      <div className="bg-[#151A23] p-3.5"><SearchField value={query} onChange={setQuery} onSearch={() => void run()} disabled={loading} placeholder={PLACEHOLDER[view]} />
        {recentQueries.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-black text-slate-500">최근</span>
          {recentQueries.map((item) => (
            <button key={item} type="button" onClick={() => { setQuery(item); void run(view, item); }} className={UI.chipDark(false)}>{item}</button>
          ))}
          <button type="button" onClick={() => { setRecentQueries([]); try { localStorage.removeItem("it_recent_queries_v1"); } catch { /* 무시 */ } }} className="inline-flex min-h-11 items-center px-2 text-[11px] font-bold text-slate-500 transition hover:text-slate-300 lg:min-h-9">지우기</button>
        </div>}</div>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-[11px] font-bold text-slate-400">
        <span className="tabular-nums">{loading ? "불러오는 중…" : `검색 결과 ${rows.length.toLocaleString()}건`}</span>
        {query && <button type="button" onClick={() => { setQuery(""); void run(view, ""); }} className="inline-flex min-h-11 items-center px-2 font-black text-blue-600 lg:min-h-9">전체 보기</button>}
      </div>
      {loading && !rows.length ? <StateBox kind="loading" inside /> : rows.length === 0 && listError ? <StateBox kind="error" inside message="목록을 불러오지 못했습니다." hint={listError} onRetry={() => void run()} /> : rows.length === 0 ? <StateBox kind="empty" inside message="검색 결과가 없습니다." hint="다른 검색어로 찾아 보세요." /> : <div className="divide-y divide-slate-100">{rows.map((row, index) => {
        const title = titleFor(row, view), summary = summaryFor(row, view);
        const badge = <span className="flex h-9 min-w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 px-2 text-[11px] font-black text-slate-500">{badgeFor(row, view).slice(0, 5)}</span>;
        const body = <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-slate-900">{title}</span><span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{summary || "세부 내용을 확인하세요."}</span>{view !== "links" && <span className="mt-0.5 block text-[11px] font-semibold text-slate-400">{String(row.업체명 || row.제조사 || row.등록일 || row.난이도 && `Lv.${row.난이도}` || "")}</span>}</span>;
        if (view === "links") return <a key={String(row.링크 || index)} href={String(row.링크 || "#")} target="_blank" rel="noreferrer" className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50">{badge}{body}<ChevronRight size={17} className="text-slate-300" /></a>;
        return <button key={String(row.ID || index)} type="button" onClick={() => setSelected({ row, tab: view })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50">{badge}{body}<ChevronRight size={17} className="text-slate-300" /></button>;
      })}</div>}
    </section>}

    {view === "quiz" && <section className={`${UI.card} ${UI.body}`}>
      {quizIndex < 0 ? <div className="mx-auto max-w-2xl py-6 text-center"><GraduationCap size={36} className="mx-auto text-blue-600" /><h3 className="mt-3 text-xl font-black text-slate-950">IT 기술력 퀴즈</h3><p className="mt-1 text-sm font-semibold text-slate-500">레벨을 선택하고 현장 기술을 점검합니다. 보기는 지식 DB에서 자동으로 만듭니다.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-1.5">{levels.map((level) => <button key={level} type="button" onClick={() => setQuizLevel(level)} className={`${UI.chip(quizLevel === level)} min-w-16`}>Lv.{level}</button>)}<button type="button" onClick={() => setQuizLevel("전체")} className={UI.chip(quizLevel === "전체")}>전체</button></div>
        <div className="mt-3 flex justify-center gap-1.5">{[10, 20].map((count) => <button key={count} type="button" onClick={() => setQuizCount(count)} className={UI.chip(quizCount === count)}>{count}문제</button>)}</div>
        <button type="button" onClick={() => void startQuiz()} disabled={loading} className={`${UI.btn} mt-6 px-7`}>{loading ? "문제 만드는 중…" : "퀴즈 시작"}</button>
      </div>
      : quizIndex >= quizPool.length ? <div className="mx-auto max-w-2xl py-8 text-center"><CheckCircle2 size={40} className="mx-auto text-emerald-600" /><div className="mt-3 text-3xl font-black text-slate-950">{quizScore}/{quizPool.length}</div><p className="mt-1 text-sm font-bold text-slate-500">정답률 {Math.round((quizScore / quizPool.length) * 100)}%</p>
        {quizSaveState !== "idle" && <p className="mt-2 text-[11px] font-semibold text-slate-400">{quizSaveState === "saved" ? "퀴즈 기록이 홈 KPI 에 반영됩니다." : quizSaveState === "missing" ? "기록 표 준비 중" : quizSaveState === "noauthor" ? "작성자를 선택하면 퀴즈 기록이 KPI 에 잡힙니다" : "퀴즈 기록을 저장하지 못했습니다."}</p>}
        {wrongNotes.length > 0 && <div className="mt-6 divide-y divide-slate-100 border-t border-slate-100 text-left"><h4 className="py-3 text-sm font-black text-slate-900">오답노트 {wrongNotes.length}건</h4>{wrongNotes.map((item, index) => <div key={index} className="border-l-4 border-rose-400 py-3 pl-3"><div className="text-xs font-black text-rose-700">{item.카테고리} · {item.부품명}</div><div className="mt-1 text-sm font-bold text-slate-800">{item.문제}</div><div className="mt-1 text-xs font-semibold text-emerald-700">정답: {item.isMulti ? item.multiAnswer?.join(", ") : item.정답}</div>{item.AI해설 && <div className="mt-1 text-xs font-semibold text-slate-600">{item.AI해설}</div>}</div>)}</div>}
        <button type="button" onClick={() => setQuizIndex(-1)} className={`${UI.btn} mt-6 px-6`}>다시 풀기</button></div>
      : currentQuiz && <div className="mx-auto max-w-2xl"><div className="flex items-center justify-between text-xs font-black tabular-nums text-slate-400"><span>{quizIndex + 1}/{quizPool.length}</span><span>점수 {quizScore}</span></div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${((quizIndex + (quizSubmitted ? 1 : 0)) / Math.max(1, quizPool.length)) * 100}%` }} /></div>
        <div className="mt-3 border-y border-slate-100 py-4"><div className="text-xs font-black text-blue-600">{currentQuiz.카테고리} · Lv.{currentQuiz.난이도 || "-"}</div><h3 className="mt-2 text-lg font-black leading-7 text-slate-950">{currentQuiz.문제}</h3>{currentQuiz.isMulti && <div className="mt-2 text-xs font-bold text-amber-700">정답 2개를 선택하세요.</div>}</div>
        <div className="mt-3 grid gap-2">{currentQuiz.보기.map((choice) => { const answer = currentQuiz.isMulti ? currentQuiz.multiAnswer || [] : [currentQuiz.정답]; const selectedChoice = quizChoices.includes(choice); const tone = quizSubmitted ? answer.includes(choice) ? "border-emerald-500 bg-emerald-50 text-emerald-800" : selectedChoice ? "border-rose-400 bg-rose-50 text-rose-800" : "border-slate-200 text-slate-400" : selectedChoice ? "border-slate-900 bg-slate-50 text-slate-950" : "border-slate-200 bg-white text-slate-700"; return <button key={choice} type="button" disabled={quizSubmitted} onClick={() => answerQuiz(choice)} className={`min-h-12 rounded-lg border px-4 py-3 text-left text-sm font-bold ${tone}`}>{choice}</button>; })}</div>
        {quizSubmitted && <div className="mt-3 space-y-3">{currentQuiz.AI해설 && <div className="border-l-4 border-blue-300 pl-3 text-sm font-semibold leading-6 text-slate-700">{currentQuiz.AI해설}</div>}{currentQuiz.주의사항 && <div className="border-l-4 border-amber-400 pl-3 text-sm font-semibold leading-6 text-amber-900">⚠ {currentQuiz.주의사항}</div>}<button type="button" onClick={nextQuiz} className={`${UI.btn} w-full`}>{quizIndex + 1 >= quizPool.length ? "결과 보기" : "다음 문제"}</button></div>}</div>}
    </section>}

    {view === "register" && !connected && <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-10 text-center">
      <Settings2 size={28} className="mx-auto text-amber-600" />
      <h3 className="mt-3 text-base font-black text-slate-900">AS 등록은 IT 담당자의 Apps Script를 거칩니다</h3>
      <p className="mx-auto mt-1 max-w-md text-sm font-semibold text-slate-600">PC DB 시트는 IT파트가 관리하는 원본이라 FIELD가 직접 쓰지 않습니다. 담당자가 준 Apps Script 주소를 넣으면 여기서 바로 등록되고, 그 전엔 시트에 직접 적어 주세요.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2"><a href={sheetTabUrl("history")} target="_blank" rel="noreferrer" className={`${UI.btn} px-5`}>PC DB 시트 열기 ↗</a><button type="button" onClick={() => setConnectionOpen(true)} className={UI.btnGhost}>Apps Script 주소 넣기</button></div>
    </section>}
    {view === "register" && connected && <section className={`${UI.card} ${UI.body}`}><div className="mb-4"><h3 className={UI.title}>IT AS 처리이력 등록</h3><p className={UI.desc}>현장 처리 내용을 IT파트 PC DB에 바로 누적합니다. 증상만 필수입니다.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">{Object.keys(EMPTY_FORM).map((key) => { const long = ["증상", "처리내용", "특이사항"].includes(key); return <label key={key} className={long ? "sm:col-span-2" : ""}><span className={`${UI.label} mb-1 block`}>{key}{key === "증상" && <b className="text-rose-500"> *</b>}</span>{long ? <textarea value={form[key] || ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} rows={3} className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /> : key === "구분" || key === "레벨" ? <select value={form[key] || ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className={UI.input}>{(key === "구분" ? ["AS", "설치", "점검", "기타"] : ["", "1", "2", "3"]).map((option) => <option key={option} value={option}>{option || "선택"}</option>)}</select> : <input value={form[key] || ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className={UI.input} />}</label>; })}</div>
      <button type="button" onClick={() => void submitForm()} disabled={loading} className={`${UI.btn} mt-5 w-full`}>처리이력 등록</button></section>}

    {selected && <ItDetail row={selected.row} tab={selected.tab} onClose={() => setSelected(null)} />}
  </div>;
}
