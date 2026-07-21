import { useEffect, useState } from "react";
import {
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Database,
  GraduationCap,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  Wrench,
  X,
} from "lucide-react";
import { getItTechApiUrl, itTechApi, saveItTechApiUrl, type ItRow, type QuizQuestion, valueByPrefix } from "./itTechApi";

type View = "knowledge" | "history" | "inventory" | "quiz" | "register";
type DisplayMode = "original" | "integrated";
type Notice = { kind: "success" | "error"; text: string } | null;

const VIEWS: Array<{ key: View; label: string; icon: typeof Search }> = [
  { key: "knowledge", label: "지식 DB", icon: BookOpen },
  { key: "history", label: "처리이력", icon: ClipboardList },
  { key: "inventory", label: "IT 재고", icon: Boxes },
  { key: "quiz", label: "기술 퀴즈", icon: GraduationCap },
  { key: "register", label: "AS 등록", icon: Plus },
];

const DETAIL_KEYS = ["등록자", "업체명", "자산번호", "레벨", "분류", "제조사", "모델명", "부품", "제목", "증상", "중지코드", "점검순서", "원인", "조치", "결과", "설정경로", "고객응대", "히스토리", "키워드", "원본링크", "등록일"];
const EMPTY_FORM: ItRow = {
  작성자: "", 구분: "AS", 레벨: "", 등급: "", 업체명: "", 부서명: "", 지역: "", 접수자: "",
  모델명: "", 시리얼번호: "", 자산기번: "", 제조사: "", 증상: "", 처리내용: "", 특이사항: "",
  도착시간: "", 소요시간: "",
};

function SearchField({ value, onChange, onSearch, placeholder, disabled }: { value: string; onChange: (value: string) => void; onSearch: () => void; placeholder: string; disabled?: boolean }) {
  return <div className="flex gap-2">
    <div className="relative min-w-0 flex-1">
      <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }} placeholder={placeholder} disabled={disabled} className="h-11 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm font-semibold outline-none focus:border-blue-500 disabled:bg-slate-100" />
    </div>
    <button type="button" onClick={onSearch} disabled={disabled} className="h-11 rounded-md bg-blue-600 px-4 text-sm font-black text-white disabled:bg-slate-300">검색</button>
  </div>;
}

function Empty({ text }: { text: string }) {
  return <div className="border-y border-slate-200 bg-white py-16 text-center"><Database size={28} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-400">{text}</p></div>;
}

function DetailModal({ row, title, onClose }: { row: ItRow; title: string; onClose: () => void }) {
  const ordered = [...DETAIL_KEYS.filter((key) => String(row[key] ?? "").trim()), ...Object.keys(row).filter((key) => !DETAIL_KEYS.includes(key) && String(row[key] ?? "").trim())];
  return <div className="fixed inset-0 z-[4200] flex items-end bg-slate-950/45 sm:items-center sm:justify-center sm:p-5" onMouseDown={onClose}>
    <section className="flex max-h-[90vh] w-full flex-col rounded-t-xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div className="min-w-0"><div className="text-[11px] font-black text-blue-600">IT 학습·처리이력</div><h3 className="truncate text-lg font-black text-slate-950">{title}</h3></div><button type="button" onClick={onClose} aria-label="닫기" className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200"><X size={18} /></button></header>
      <div className="overflow-y-auto px-5 py-2">{ordered.map((key) => <div key={key} className="grid gap-1 border-b border-slate-100 py-3 sm:grid-cols-[120px_1fr]"><div className="text-xs font-black text-slate-500">{key}</div><div className="whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-800">{String(row[key] ?? "")}</div></div>)}</div>
    </section>
  </div>;
}

export default function ItLearningHistory({ author }: { author: string }) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>("original");
  const [view, setView] = useState<View>("knowledge");
  const [endpoint, setEndpoint] = useState(getItTechApiUrl());
  const [endpointDraft, setEndpointDraft] = useState(getItTechApiUrl());
  const [connectionOpen, setConnectionOpen] = useState(!getItTechApiUrl());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ItRow[]>([]);
  const [selected, setSelected] = useState<ItRow | null>(null);

  const [quizPool, setQuizPool] = useState<QuizQuestion[]>([]);
  const [quizLevel, setQuizLevel] = useState("전체");
  const [quizCount, setQuizCount] = useState(10);
  const [quizIndex, setQuizIndex] = useState(-1);
  const [quizScore, setQuizScore] = useState(0);
  const [quizChoices, setQuizChoices] = useState<string[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [wrongNotes, setWrongNotes] = useState<QuizQuestion[]>([]);

  const [form, setForm] = useState<ItRow>({ ...EMPTY_FORM, 작성자: author || "" });

  const connected = Boolean(endpoint);
  const notify = (kind: "success" | "error", text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 3200);
  };

  const run = async (target: View = view, searchQuery = query) => {
    if (!connected) { setConnectionOpen(true); return; }
    setLoading(true);
    try {
      const data = target === "knowledge" ? await itTechApi.knowledge(searchQuery)
        : target === "history" ? await itTechApi.history(searchQuery)
          : await itTechApi.inventory(searchQuery);
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    itTechApi.knowledge("").then((data) => { if (active) setRows(Array.isArray(data) ? data : []); }).catch(() => undefined);
    return () => { active = false; };
  }, [endpoint]);

  const switchView = (next: View) => {
    setView(next);
    setQuery("");
    setRows([]);
    setSelected(null);
    if ((next === "knowledge" || next === "history" || next === "inventory") && connected) void run(next, "");
  };

  const saveEndpoint = async () => {
    const next = saveItTechApiUrl(endpointDraft);
    setEndpoint(next);
    if (!next) { notify("error", "Apps Script 배포 주소를 입력해 주세요."); return; }
    setLoading(true);
    try {
      await itTechApi.ping();
      setConnectionOpen(false);
      notify("success", "기존 PC DB와 연결했습니다.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "연결에 실패했습니다."); }
    finally { setLoading(false); }
  };

  const startQuiz = async () => {
    if (!connected) { setConnectionOpen(true); return; }
    setLoading(true);
    try {
      const data = await itTechApi.quiz(60);
      const filtered = quizLevel === "전체" ? data : data.filter((item) => String(item.난이도) === quizLevel);
      const picked = [...filtered].sort(() => Math.random() - 0.5).slice(0, quizCount);
      if (!picked.length) { notify("error", "선택한 레벨의 문제가 없습니다."); return; }
      setQuizPool(picked); setQuizIndex(0); setQuizScore(0); setQuizChoices([]); setQuizSubmitted(false); setWrongNotes([]);
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

  const nextQuiz = () => {
    if (quizIndex + 1 >= quizPool.length) setQuizIndex(quizPool.length);
    else { setQuizIndex((index) => index + 1); setQuizChoices([]); setQuizSubmitted(false); }
  };

  const submitForm = async () => {
    if (!String(form.증상 || "").trim()) { notify("error", "증상은 필수입니다."); return; }
    if (!connected) { setConnectionOpen(true); return; }
    setLoading(true);
    try {
      const result = await itTechApi.addRecord(form);
      notify("success", `IT AS 이력을 등록했습니다${result.id ? ` (ID ${result.id})` : ""}.`);
      setForm({ ...EMPTY_FORM, 작성자: author || "" });
    } catch (error) { notify("error", error instanceof Error ? error.message : "등록하지 못했습니다."); }
    finally { setLoading(false); }
  };

  const titleFor = (row: ItRow) => String(row.제목 || row.업체명 || valueByPrefix(row, "부품명", "부품") || row.자산번호 || "상세 정보");

  return <div className="space-y-4">
    {notice && <div className={`fixed right-4 top-20 z-[5000] max-w-sm rounded-md px-4 py-3 text-sm font-bold text-white shadow-xl ${notice.kind === "success" ? "bg-emerald-600" : "bg-rose-600"}`}>{notice.text}</div>}

    <section className="border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2"><Wrench size={19} className="text-blue-600" /><h2 className="text-lg font-black text-slate-950">IT 학습·처리이력</h2></div><p className="mt-1 text-xs font-semibold text-slate-500">PC 처리 경험을 검색하고 기술 지식과 퀴즈로 다시 활용합니다.</p></div>
        <button type="button" onClick={() => setConnectionOpen((open) => !open)} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-black ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}><Settings2 size={15} />{connected ? "DB 연결됨" : "DB 연결 필요"}</button>
      </div>
      {connectionOpen && <div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row"><input value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} placeholder="Apps Script 웹 앱 /exec 주소" className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500" /><button type="button" onClick={() => void saveEndpoint()} className="h-10 rounded-md bg-slate-900 px-4 text-sm font-black text-white">연결 확인</button></div><p className="mx-auto mt-2 max-w-3xl text-[11px] font-semibold text-slate-400">기존 PC DB Apps Script에 API 어댑터를 적용한 뒤 배포 주소를 한 번만 입력합니다.</p></div>}
      <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <button type="button" onClick={() => setDisplayMode("original")} className={`rounded-md px-4 py-2 text-sm font-black ${displayMode === "original" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white"}`}>원본 화면</button>
        <button type="button" onClick={() => setDisplayMode("integrated")} className={`rounded-md px-4 py-2 text-sm font-black ${displayMode === "integrated" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`}>통합 화면</button>
      </div>
      {displayMode === "integrated" && <nav className="flex overflow-x-auto px-2 py-2">{VIEWS.map(({ key, label, icon: Icon }) => <button key={key} type="button" onClick={() => switchView(key)} className={`flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm font-black ${view === key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}><Icon size={16} />{label}</button>)}</nav>}
    </section>

    {displayMode === "original" && (connected ? <section className="overflow-hidden border border-slate-200 bg-white shadow-sm">
      <iframe title="퍼스트전산 PC DB 원본" src={endpoint} className="block h-[calc(100dvh-190px)] min-h-[680px] w-full border-0 bg-white" allow="clipboard-read; clipboard-write" />
    </section> : <section className="border border-amber-200 bg-amber-50 px-5 py-14 text-center shadow-sm">
      <Settings2 size={30} className="mx-auto text-amber-600" />
      <h3 className="mt-3 text-base font-black text-slate-900">원본 PC DB 연결이 필요합니다</h3>
      <p className="mt-1 text-sm font-semibold text-slate-600">상단의 DB 연결 필요 버튼을 눌러 Apps Script 웹 앱 주소를 입력하세요.</p>
    </section>)}

    {displayMode === "integrated" && (view === "knowledge" || view === "history" || view === "inventory") && <section className="border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4"><SearchField value={query} onChange={setQuery} onSearch={() => void run()} disabled={loading} placeholder={view === "knowledge" ? "부품·증상·카테고리 검색" : view === "history" ? "업체명 또는 자산기번 검색" : "자산기번·CPU·메모리·사양 검색"} /><div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-400"><span>{loading ? "불러오는 중" : `검색 결과 ${rows.length}건`}</span>{query && <button type="button" onClick={() => { setQuery(""); void run(view, ""); }} className="text-blue-600">전체 보기</button>}</div></div>
      {loading ? <div className="flex items-center justify-center py-20"><LoaderCircle className="animate-spin text-blue-600" /></div> : rows.length === 0 ? <Empty text={connected ? "검색 결과가 없습니다." : "DB를 연결하면 기존 자료를 확인할 수 있습니다."} /> : <div className="divide-y divide-slate-100">{rows.map((row, index) => {
        const part = valueByPrefix(row, "부품명", "부품");
        const title = view === "knowledge" ? part || "IT 지식" : view === "history" ? String(row.제목 || row.업체명 || "처리이력") : String(row.자산번호 || row.자산기번 || "재고 항목");
        const summary = view === "knowledge" ? valueByPrefix(row, "설명", "AI설명", "증상") : view === "history" ? String(row.증상 || row.조치 || "") : [row.CPU, row.메모리, row.SSD, row.모델명].filter(Boolean).join(" · ");
        return <button key={String(row.ID || row.id || index)} type="button" onClick={() => setSelected(row)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"><span className="flex h-9 min-w-10 items-center justify-center rounded-md bg-slate-100 px-2 text-[11px] font-black text-slate-700">{view === "knowledge" ? String(row.카테고리 || "IT").slice(0, 4) : view === "history" ? String(row.분류 || "이력").slice(0, 4) : String(row._출처시트 || "재고").slice(0, 4)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-slate-900">{title}</span><span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{summary || "세부 내용을 확인하세요."}</span><span className="mt-0.5 block text-[11px] font-semibold text-slate-400">{String(row.업체명 || row.제조사 || row.등록일 || "")}</span></span><ChevronRight size={17} className="text-slate-300" /></button>;
      })}</div>}
    </section>}

    {displayMode === "integrated" && view === "quiz" && <section className="border border-slate-200 bg-white p-4 shadow-sm">
      {quizIndex < 0 ? <div className="mx-auto max-w-2xl py-6 text-center"><GraduationCap size={36} className="mx-auto text-blue-600" /><h3 className="mt-3 text-xl font-black text-slate-950">IT 기술력 퀴즈</h3><p className="mt-1 text-sm font-semibold text-slate-500">레벨을 선택하고 현장 기술을 점검합니다.</p><div className="mt-6 grid grid-cols-5 gap-1.5">{[1,2,3,4,5,6,7,8,9,10].map((level) => <button key={level} type="button" onClick={() => setQuizLevel(String(level))} className={`h-10 rounded-md text-xs font-black ${quizLevel === String(level) ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>Lv.{level}</button>)}</div><div className="mt-3 flex justify-center gap-2"><button type="button" onClick={() => setQuizLevel("전체")} className={`rounded-md px-4 py-2 text-sm font-black ${quizLevel === "전체" ? "bg-slate-900 text-white" : "border border-slate-200"}`}>전체</button>{[10,20].map((count) => <button key={count} type="button" onClick={() => setQuizCount(count)} className={`rounded-md px-4 py-2 text-sm font-black ${quizCount === count ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "border border-slate-200"}`}>{count}문제</button>)}</div><button type="button" onClick={() => void startQuiz()} disabled={loading} className="mt-6 h-11 rounded-md bg-blue-600 px-7 text-sm font-black text-white disabled:bg-slate-300">퀴즈 시작</button></div>
      : quizIndex >= quizPool.length ? <div className="mx-auto max-w-2xl py-8 text-center"><CheckCircle2 size={40} className="mx-auto text-emerald-600" /><div className="mt-3 text-3xl font-black text-slate-950">{quizScore}/{quizPool.length}</div><p className="mt-1 text-sm font-bold text-slate-500">정답률 {Math.round((quizScore / quizPool.length) * 100)}%</p>{wrongNotes.length > 0 && <div className="mt-6 space-y-2 text-left"><h4 className="text-sm font-black text-slate-900">오답노트 {wrongNotes.length}건</h4>{wrongNotes.map((item, index) => <div key={index} className="rounded-md border-l-4 border-rose-400 bg-rose-50 p-3"><div className="text-xs font-black text-rose-700">{item.카테고리} · {item.부품명}</div><div className="mt-1 text-sm font-bold text-slate-800">{item.문제}</div><div className="mt-1 text-xs font-semibold text-emerald-700">정답: {item.isMulti ? item.multiAnswer?.join(", ") : item.정답}</div></div>)}</div>}<button type="button" onClick={() => setQuizIndex(-1)} className="mt-6 rounded-md bg-slate-900 px-6 py-3 text-sm font-black text-white">다시 풀기</button></div>
      : currentQuiz && <div className="mx-auto max-w-2xl"><div className="flex items-center justify-between text-xs font-black text-slate-400"><span>{quizIndex + 1}/{quizPool.length}</span><span>점수 {quizScore}</span></div><div className="mt-3 rounded-md bg-slate-50 p-4"><div className="text-xs font-black text-blue-600">{currentQuiz.카테고리} · Lv.{currentQuiz.난이도 || "-"}</div><h3 className="mt-2 text-lg font-black leading-7 text-slate-950">{currentQuiz.문제}</h3>{currentQuiz.isMulti && <div className="mt-2 text-xs font-bold text-amber-700">정답 2개를 선택하세요.</div>}</div><div className="mt-3 grid gap-2">{currentQuiz.보기.map((choice) => { const answer = currentQuiz.isMulti ? currentQuiz.multiAnswer || [] : [currentQuiz.정답]; const selectedChoice = quizChoices.includes(choice); const tone = quizSubmitted ? answer.includes(choice) ? "border-emerald-500 bg-emerald-50 text-emerald-800" : selectedChoice ? "border-rose-400 bg-rose-50 text-rose-800" : "border-slate-200 text-slate-400" : selectedChoice ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700"; return <button key={choice} type="button" disabled={quizSubmitted} onClick={() => answerQuiz(choice)} className={`min-h-12 rounded-md border px-4 py-3 text-left text-sm font-bold ${tone}`}>{choice}</button>; })}</div>{quizSubmitted && <div className="mt-3 space-y-2">{currentQuiz.AI해설 && <div className="rounded-md bg-violet-50 p-3 text-sm font-semibold leading-6 text-violet-900">{currentQuiz.AI해설}</div>}{currentQuiz.주의사항 && <div className="rounded-md bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900"><CircleAlert size={16} className="mr-1 inline" />{currentQuiz.주의사항}</div>}<button type="button" onClick={nextQuiz} className="h-11 w-full rounded-md bg-slate-900 text-sm font-black text-white">다음 문제</button></div>}</div>}
    </section>}

    {displayMode === "integrated" && view === "register" && <section className="border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-4"><h3 className="text-base font-black text-slate-950">IT AS 처리이력 등록</h3><p className="mt-1 text-xs font-semibold text-slate-500">현장 처리 내용을 PC DB에 바로 누적합니다.</p></div><div className="grid gap-3 sm:grid-cols-2">{Object.keys(EMPTY_FORM).map((key) => { const long = ["증상","처리내용","특이사항"].includes(key); return <label key={key} className={long ? "sm:col-span-2" : ""}><span className="mb-1 block text-xs font-black text-slate-600">{key}{key === "증상" && <b className="text-rose-500"> *</b>}</span>{long ? <textarea value={String(form[key] || "")} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} rows={3} className="w-full resize-y rounded-md border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-500" /> : key === "구분" || key === "레벨" ? <select value={String(form[key] || "")} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-blue-500">{(key === "구분" ? ["AS","설치","점검","기타"] : ["","1","2","3"]).map((option) => <option key={option} value={option}>{option || "선택"}</option>)}</select> : <input value={String(form[key] || "")} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-full rounded-md border border-slate-300 px-2.5 text-sm outline-none focus:border-blue-500" />}</label>; })}</div><button type="button" onClick={() => void submitForm()} disabled={loading} className="mt-5 h-12 w-full rounded-md bg-blue-600 text-sm font-black text-white disabled:bg-slate-300">처리이력 등록</button></section>}

    {displayMode === "integrated" && selected && <DetailModal row={selected} title={titleFor(selected)} onClose={() => setSelected(null)} />}
  </div>;
}
