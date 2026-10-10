/**
 * 통합 검색 360 — 입력 하나로 "검색"과 "질문"을 다 받는다.
 *
 * 첫 화면: 큰 입력칸 하나. 업체명·자산기번·시리얼이면 그 업체의 모든 기록을 모으고(28개 표),
 *   문장으로 물으면 ① 질문 속 업체가 있으면 그 업체 기록만 근거로 답(entity-ask) ② 없으면 표 전체를 조건으로 추려 답(data-ask).
 *   방식은 자동 판정이고 알약으로 고정할 수도 있다. 아래에 예시 질문·최근 검색·회사 기록 전체 건수.
 * 결과: ① 현재 상태 카드(현장 메모 포함) → ② 기기 카드 → ③ 표별 건수 → ③-1 질문하기 → ③-2 기종 참고 → ④ 월별 타임라인.
 * 로직은 entity360.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search as SearchIcon, Sparkles } from "lucide-react";
import { notify } from "./toast";
import { invokeEdgeFunction } from "./supabase";
import UnifiedHistory from "./UnifiedHistory";
import {
  buildEntity, countRows, daysSince, deriveState, entityTokensFromQuestion, gather, gatherModelRefs, identKey, isOtherVendor, rawTextOf, resolveCandidates, SOURCES, toEvents,
  type Candidate, type Entity, type EventItem, type Group, type ModelRef, type SourceResult, type State,
} from "./entity360";

type Phase = "idle" | "resolving" | "choose" | "gathering" | "done";
type Mode = "auto" | "search" | "entity" | "data";
const GROUPS: Group[] = ["기기·계약", "현장 기록", "영업·관리", "고객 소통", "기타"];
const EXACT_HOW = new Set(["기번·자산번호 일치", "임대리스트 기기 번호 일치", "업체명 일치"]);
const RECENT_KEY = "cs_search360_recent_v1";
const TOTALS_KEY = "cs_search360_totals_v1";
const fmtDays = (ymd: string) => { const d = daysSince(ymd); return d === null ? "" : d === 0 ? "오늘" : `${d}일 전`; };
const loadRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v.map(String).slice(0, 8) : []; } catch { return []; } };
// 문장인가(질문·요청) — 이게 아니면 업체명·기번 검색으로 본다
const QUESTION_RE = /[?？]|몇|언제|어디|어떻|무슨|뭐|얼마|줘|주세요|알려|정리|요약|목록|리스트|있어|있나|됐어|했어|중에|추려|비교|평균|합계|건수|누가|왜|해야|필요|만들/;
// 표 전체를 조건으로 추리는 질문의 단서 — 팀·기간·등급·"각각/씩/전체"
const DATA_RE = /[A-E]\s*팀|이번\s*주|지난\s*주|이번\s*달|지난\s*달|\d{1,2}\s*월|등급|전체|모든|각각|몇\s*개씩|씩|리스트|목록|순위|합계|평균|건수|누가|제일|가장/;

/** 에이전트에게 넘길 압축 기록 — 정확 일치만, 최신순 350건, 글자 수 제한(토큰 절약) */
function compactForAsk(entity: Entity, state: State, events: EventItem[]) {
  const rows = events.filter((ev) => !ev.loose && ev.source.table !== "vendor_info").slice(0, 350).map((ev) => ({
    d: ev.date, s: ev.source.label, t: ev.title.slice(0, 90), x: ev.snippet.slice(0, 120), a: ev.author, tm: ev.team,
    m: ev.model, sn: ev.serial, as: ev.asset, ...(isOtherVendor(ev, entity) ? { other: ev.vendor.slice(0, 40) } : {}),
  }));
  return {
    entity: { name: entity.name, code: entity.code, leaseCode: entity.leaseCode, names: entity.names.slice(0, 8), serials: entity.serials, assets: entity.assets },
    state: {
      address: state.address, addressFrom: state.addressFrom, keyman: state.keyman, tel: state.tel, grade: state.grade, leaseStatus: state.leaseStatus,
      devices: state.devices, misu: state.misu, overage: state.overage, recontract: state.recontract, bulman: state.bulman, notes: state.notes.slice(0, 12).map((n) => `${n.kind}: ${n.text}`),
      lastInspect: state.lastInspect, lastAs: state.lastAs, lastVisit: state.lastVisit, openReceptions: state.openReceptions, upcomingTickets: state.upcomingTickets,
      counts: state.counts.filter((c) => c.exact).map((c) => `${c.label} ${c.exact}`), total: state.total, oldest: state.oldest, newest: state.newest,
    },
    events: rows,
  };
}
const ASK_SUGGESTIONS = ["AS가 몇 번 있었고 주로 무슨 문제였어?", "언제부터 임대했고 기기는 어떻게 바뀌었어?", "이 기기 이전 사용처가 있어?", "초과료·미수 흐름을 정리해 줘", "이 업체를 처음 가는 사람에게 한 문단으로 요약해 줘"];
const TRY_THESE: Array<{ text: string; kind: "검색" | "업체 질문" | "전체 질문" }> = [
  { text: "잡플러스", kind: "검색" },
  { text: "B6945", kind: "검색" },
  { text: "잡플러스 AS 몇 번 터졌어?", kind: "업체 질문" },
  { text: "무암 언제부터 임대했고 기기 이동 이력 있어?", kind: "업체 질문" },
  { text: "C팀 미수 중 CS가 체크할 곳 리스트 줘", kind: "전체 질문" },
  { text: "C팀 이번 주 PC 확장성 몇 개씩 했어?", kind: "전체 질문" },
];
const PLACEHOLDERS = ["잡플러스", "B6945", "잡플러스 AS 몇 번 터졌어?", "C팀 미수 중 CS가 체크할 곳 리스트 줘", "ZPBLBJST8000GQV", "C팀 이번 주 PC 확장성 몇 개씩 했어?"];

export default function Search360({ author }: { author: string }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [modelRefs, setModelRefs] = useState<ModelRef[]>([]);
  const [group, setGroup] = useState<"전체" | Group>("전체");
  const [sourceOnly, setSourceOnly] = useState("");
  const [within, setWithin] = useState("");
  const [deviceOnly, setDeviceOnly] = useState("");
  const [showLoose, setShowLoose] = useState(false);
  const [openRaw, setOpenRaw] = useState<string | null>(null);
  const [limit, setLimit] = useState(120);
  const [histVendor, setHistVendor] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [totals, setTotals] = useState<Record<string, number | null>>({});
  const [showTotals, setShowTotals] = useState(false);
  const [phIndex, setPhIndex] = useState(0);
  // 업체 질문(entity-ask) — 모인 기록만 근거
  const [question, setQuestion] = useState("");
  const [pendingQ, setPendingQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Array<{ q: string; a: string; used: number }>>([]);
  const [foundBy, setFoundBy] = useState("");
  // 전체 질문(data-ask) — 표를 직접 조회
  const [dataAsking, setDataAsking] = useState(false);
  const [dataAnswers, setDataAnswers] = useState<Array<{ q: string; a: string; rows: Record<string, unknown>[]; table: string; calls: string[] }>>([]);
  const [routeNote, setRouteNote] = useState(""); // "문장으로 보여 전체 데이터에 물었습니다"

  useEffect(() => { const t = window.setInterval(() => setPhIndex((i) => (i + 1) % PLACEHOLDERS.length), 3200); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(TOTALS_KEY) || "null");
      if (cached && Date.now() - cached.at < 10 * 60_000) { setTotals(cached.totals); return; }
    } catch { /* 무시 */ }
    let alive = true;
    void Promise.all(SOURCES.filter((s) => s.table !== "plan_memos").map(async (s) => [s.label, await countRows(s.table, s.hidden)] as const)).then((pairs) => {
      if (!alive) return;
      const next = Object.fromEntries(pairs);
      setTotals(next);
      try { sessionStorage.setItem(TOTALS_KEY, JSON.stringify({ at: Date.now(), totals: next })); } catch { /* 무시 */ }
    });
    return () => { alive = false; };
  }, []);

  const remember = (q: string) => { const next = [q, ...recent.filter((x) => x !== q)].slice(0, 8); setRecent(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* 무시 */ } };
  const resetFilters = () => { setGroup("전체"); setSourceOnly(""); setWithin(""); setDeviceOnly(""); setShowLoose(false); setLimit(120); setOpenRaw(null); setAnswers([]); setQuestion(""); setFoundBy(""); setModelRefs([]); };

  const gatherFor = async (c: Candidate | null, q: string): Promise<{ e: Entity; r: SourceResult[] } | null> => {
    setPhase("gathering");
    try {
      const e = await buildEntity(c, q);
      const r = await gather(e);
      setEntity(e); setResults(r); setPhase("done");
      void gatherModelRefs(e).then(setModelRefs).catch(() => setModelRefs([]));
      return { e, r };
    } catch (err) {
      notify(`모으기 실패: ${(err as Error).message}`, "error"); setPhase("idle"); return null;
    }
  };
  const askWith = async (text: string, e: Entity, r: SourceResult[]) => {
    const evs = toEvents(r); const st = deriveState(e, r);
    setAsking(true);
    try {
      const body = { question: text, author, ...compactForAsk(e, st, evs) };
      const res = await invokeEdgeFunction<{ answer?: string; error?: string }>("entity-ask", body, 90_000);
      if (res.error) throw new Error(res.error);
      setAnswers((cur) => [{ q: text, a: String(res.answer || "").trim(), used: body.events.length }, ...cur].slice(0, 6));
    } catch (err) {
      notify(`답을 받지 못했습니다: ${(err as Error).message}`, "error");
    } finally { setAsking(false); }
  };
  const pick = async (c: Candidate | null, q: string) => {
    const got = await gatherFor(c, q);
    if (got && pendingQ) { const text = pendingQ; setPendingQ(""); await askWith(text, got.e, got.r); }
  };
  const run = async (raw: string, followUp = "") => {
    const q = raw.trim();
    if (q.length < 2) { notify("두 글자 이상 넣어 주세요", "info"); return; }
    setQuery(q); resetFilters(); setEntity(null); setResults([]); setPhase("resolving"); setPendingQ(followUp);
    const list = await resolveCandidates(q).catch(() => [] as Candidate[]);
    setCandidates(list);
    remember(followUp || q);
    const exactOnes = list.filter((c) => EXACT_HOW.has(c.how));
    const chosen = list.length === 1 ? list[0] : exactOnes.length === 1 ? exactOnes[0] : null;
    if (chosen || !list.length) {
      const got = await gatherFor(chosen, q);
      if (got && followUp) { setPendingQ(""); await askWith(followUp, got.e, got.r); }
      return;
    }
    setPhase("choose");
  };
  const askData = async (text: string) => {
    const q = text.trim();
    if (q.length < 4 || dataAsking) return;
    setDataAsking(true); remember(q);
    try {
      const res = await invokeEdgeFunction<{ answer?: string; rows?: Record<string, unknown>[]; table?: string; calls?: string[]; error?: string }>("data-ask", { question: q, author }, 180_000);
      if (res.error) throw new Error(res.error);
      setDataAnswers((cur) => [{ q, a: String(res.answer || "").trim(), rows: res.rows || [], table: res.table || "", calls: res.calls || [] }, ...cur].slice(0, 5));
    } catch (err) {
      notify(`답을 받지 못했습니다: ${(err as Error).message}`, "error");
    } finally { setDataAsking(false); }
  };
  /** 질문 속 업체·기번으로 먼저 찾는다. 찾으면 true(모은 뒤 답까지 진행), 못 찾으면 false */
  const askEntity = async (q: string): Promise<boolean> => {
    const tokens = entityTokensFromQuestion(q);
    for (const token of tokens) {
      const list = await resolveCandidates(token).catch(() => [] as Candidate[]);
      if (!list.length) continue;
      setFoundBy(`질문의 "${token}"으로 찾았습니다`);
      await run(token, q);
      return true;
    }
    return false;
  };
  /** 입력 하나로 검색·업체 질문·전체 질문을 가른다 */
  const submit = async (raw: string, forced: Mode = mode) => {
    const text = raw.trim();
    if (!text) return;
    setInput(text); setRouteNote("");
    const isQuestion = QUESTION_RE.test(text) || text.split(/\s+/).length >= 4;
    const m: Mode = forced !== "auto" ? forced : !isQuestion ? "search" : "auto";
    if (m === "search") { await run(text); return; }
    if (m === "data") { await askData(text); return; }
    if (m === "entity") { setPhase("resolving"); if (!(await askEntity(text))) { setPhase("idle"); notify("질문에서 업체·기번을 못 찾았습니다 — 업체명을 함께 넣어 주세요", "info"); } return; }
    // 자동: 업체가 들리면 그 업체, 아니면 전체 데이터
    setPhase("resolving");
    const dataLike = DATA_RE.test(text);
    if (!dataLike && await askEntity(text)) return;
    setPhase("idle");
    if (!dataLike && entityTokensFromQuestion(text).length) setRouteNote("질문 속 이름이 거래처에 없어 전체 데이터에 물었습니다");
    else setRouteNote("팀·기간·등급으로 추리는 질문으로 보여 전체 데이터에 물었습니다");
    await askData(text);
  };
  const ask = async (q: string) => { const text = q.trim(); if (!text || !entity || asking) return; setQuestion(""); await askWith(text, entity, results); };

  const events = useMemo(() => (entity ? toEvents(results) : []), [entity, results]);
  const state = useMemo(() => (entity ? deriveState(entity, results) : null), [entity, results]);
  const looseCount = events.filter((ev) => ev.loose).length;
  const filtered = useMemo(() => {
    const w = within.trim().toLowerCase();
    const dk = identKey(deviceOnly);
    return events.filter((ev) => {
      if (ev.loose && !showLoose) return false;
      if (ev.source.table === "vendor_info") return false;
      if (group !== "전체" && ev.source.group !== group) return false;
      if (sourceOnly && ev.source.label !== sourceOnly) return false;
      if (dk && identKey(ev.serial) !== dk && identKey(ev.asset) !== dk && !identKey(rawTextOf(ev.row)).includes(dk)) return false;
      if (w && !`${ev.title} ${ev.snippet} ${ev.author} ${rawTextOf(ev.row)}`.toLowerCase().includes(w)) return false;
      return true;
    });
  }, [events, group, sourceOnly, within, deviceOnly, showLoose]);
  const months = useMemo(() => {
    const m = new Map<string, EventItem[]>();
    filtered.slice(0, limit).forEach((ev) => { const k = ev.date ? ev.date.slice(0, 7) : "날짜 없음"; m.set(k, [...(m.get(k) || []), ev]); });
    return Array.from(m.entries());
  }, [filtered, limit]);
  const groupCounts = useMemo(() => { const c = new Map<string, number>(); events.filter((ev) => !ev.loose && ev.source.table !== "vendor_info").forEach((ev) => c.set(ev.source.group, (c.get(ev.source.group) || 0) + 1)); return c; }, [events]);
  const totalAll = Object.values(totals).reduce<number>((n, v) => n + (v || 0), 0);
  const busy = phase === "resolving" || phase === "gathering" || dataAsking;
  const landing = phase === "idle";

  const chip = (text: string, tone = "bg-slate-100 text-slate-700") => <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${tone}`}>{text}</span>;
  const modePill = (m: Mode, label: string) => (
    <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full px-3 py-1 text-[11px] font-black transition ${mode === m ? "bg-white text-slate-900" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}>{label}</button>
  );

  return (
    <div className="space-y-3">
      {/* ── 입력 하나 — 첫 화면은 크게, 결과가 있으면 한 줄로 ── */}
      <section className="overflow-hidden rounded-2xl shadow-sm" style={{ background: "radial-gradient(900px 320px at 15% -20%, rgba(37,99,235,.45), transparent 60%), radial-gradient(700px 300px at 95% 110%, rgba(16,185,129,.22), transparent 60%), #1E252F" }}>
        <div className={landing ? "px-5 pb-6 pt-8 sm:px-10 sm:pb-8 sm:pt-10" : "px-4 py-3 sm:px-5"}>
          {landing && (
            <div className="mb-5">
              <div className="flex items-center gap-1.5 text-[11px] font-black tracking-widest text-blue-300"><Sparkles size={13} /> FIRSTOA 기록 비서</div>
              <h3 className="mt-2 text-[26px] font-black leading-tight text-white sm:text-[32px]">무엇이든 물어보세요</h3>
              <p className="mt-2 max-w-2xl text-[13px] font-semibold leading-6 text-slate-300">업체명이나 자산기번·시리얼을 치면 회사에 있는 기록을 전부 모아 한 장으로 보여 주고, 문장으로 물으면 그 기록을 근거로 답합니다. 팀·기간·등급으로 추리는 질문도 됩니다.</p>
            </div>
          )}
          <form className="flex items-stretch gap-2" onSubmit={(e) => { e.preventDefault(); void submit(input); }}>
            <label className={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-white px-4 shadow-[0_8px_30px_rgba(0,0,0,.25)] ring-2 ring-transparent transition focus-within:ring-blue-400 ${landing ? "h-14" : "h-11"}`}>
              <SearchIcon size={landing ? 20 : 16} className="shrink-0 text-slate-400" />
              <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} autoCapitalize="off" placeholder={PLACEHOLDERS[phIndex]}
                className={`min-w-0 flex-1 bg-transparent font-bold text-slate-900 outline-none placeholder:font-semibold placeholder:text-slate-400 disabled:opacity-60 ${landing ? "text-[16px] sm:text-[17px]" : "text-[14px]"}`} />
              {input && !busy && <button type="button" onClick={() => setInput("")} className="text-[11px] font-black text-slate-400 hover:text-slate-600">지우기</button>}
            </label>
            <button type="submit" disabled={busy || !input.trim()} className={`inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-blue-600 px-5 font-black text-white shadow-[0_8px_24px_rgba(37,99,235,.45)] transition hover:bg-blue-500 disabled:opacity-50 ${landing ? "h-14 text-[15px]" : "h-11 text-[13px]"}`}>
              {phase === "resolving" ? "찾는 중…" : phase === "gathering" ? "모으는 중…" : dataAsking ? "조회 중…" : <>검색·질문 <ArrowRight size={16} /></>}
            </button>
          </form>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10.5px] font-bold text-slate-400">방식</span>
            {modePill("auto", "자동")}{modePill("search", "업체·기번 검색")}{modePill("entity", "업체에 질문")}{modePill("data", "전체 데이터에 질문")}
            {mode === "auto" && <span className="text-[10.5px] font-semibold text-slate-500">· 문장이면 질문, 아니면 검색으로 봅니다</span>}
          </div>
          {landing && (
            <>
              <div className="mt-5">
                <div className="text-[11px] font-black text-slate-400">이렇게 써 보세요</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TRY_THESE.map((t) => (
                    <button key={t.text} type="button" disabled={busy} onClick={() => void submit(t.text, "auto")} className="group inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[12px] font-bold text-slate-100 transition hover:border-blue-400 hover:bg-white/15 disabled:opacity-50">
                      <span className={`rounded px-1 text-[9px] font-black ${t.kind === "검색" ? "bg-blue-500/40 text-blue-100" : t.kind === "업체 질문" ? "bg-indigo-500/40 text-indigo-100" : "bg-emerald-500/40 text-emerald-100"}`}>{t.kind}</span>{t.text}
                    </button>
                  ))}
                </div>
              </div>
              {recent.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-black text-slate-500">최근</span>
                  {recent.map((q) => <button key={q} type="button" disabled={busy} onClick={() => void submit(q, "auto")} className="rounded-full bg-white/[0.06] px-2.5 py-1 font-bold text-slate-300 hover:bg-white/15 hover:text-white disabled:opacity-50">{q.length > 28 ? `${q.slice(0, 28)}…` : q}</button>)}
                </div>
              )}
            </>
          )}
          {dataAsking && <div className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-[12px] font-bold text-emerald-100">표를 조회하고 답을 쓰는 중입니다… 30초에서 1분 정도 걸립니다 (조회 최대 8번)</div>}
          {routeNote && !dataAsking && <div className="mt-2 text-[11px] font-bold text-slate-400">{routeNote}</div>}
        </div>
        {landing && (
          <div className="border-t border-white/10 bg-black/20 px-5 py-3 sm:px-10">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
              <span className="font-black text-white">회사 기록 전체 {totalAll ? `${totalAll.toLocaleString()}건` : "세는 중…"}</span>
              <span className="font-bold text-slate-400">표 {SOURCES.length}개를 한 번에 뒤집니다</span>
              <button type="button" onClick={() => setShowTotals((v) => !v)} className="ml-auto text-[11px] font-black text-blue-300 hover:text-blue-200">{showTotals ? "표별 건수 접기" : "표별 건수 보기"}</button>
            </div>
            {showTotals && (
              <div className="mt-2 flex flex-wrap gap-1">
                {SOURCES.filter((s) => s.table !== "plan_memos").map((s) => <span key={s.table} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-black text-slate-200">{s.label} <span className="tabular-nums text-slate-400">{totals[s.label] == null ? "…" : totals[s.label]!.toLocaleString()}</span></span>)}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 전체 데이터 질문의 답 */}
      {dataAnswers.map((item, i) => (
        <section key={`${item.q}-${i}`} className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] font-black text-emerald-700"><span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px]">전체 데이터</span>Q. {item.q}</div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => { void navigator.clipboard.writeText(item.a).then(() => notify("답을 복사했습니다", "success")); }} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[10.5px] font-black text-slate-600 hover:bg-slate-50">복사</button>
              <button type="button" onClick={() => setDataAnswers((cur) => cur.filter((_, j) => j !== i))} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[10.5px] font-black text-slate-500 hover:bg-slate-50">지우기</button>
            </div>
          </div>
          <div className="mt-2 whitespace-pre-wrap text-[13.5px] font-semibold leading-7 text-slate-800">{item.a}</div>
          {item.rows.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-black text-slate-500">근거로 쓴 마지막 조회 결과 {item.rows.length}행 ({item.table})</summary>
              <div className="mt-1.5 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-[11px]">
                  <thead className="bg-slate-50 text-left font-black text-slate-500"><tr>{Object.keys(item.rows[0]).slice(0, 8).map((c) => <th key={c} className="px-2 py-1">{c}</th>)}</tr></thead>
                  <tbody>{item.rows.slice(0, 60).map((r, j) => <tr key={j} className="border-t border-slate-100">{Object.keys(item.rows[0]).slice(0, 8).map((c) => <td key={c} className="max-w-[220px] truncate px-2 py-1 font-semibold text-slate-700">{String(r[c] ?? "")}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </details>
          )}
          {item.calls.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-[10px] font-bold text-slate-400">어떻게 조회했나 ({item.calls.length}번)</summary><ul className="mt-1 space-y-0.5 font-mono text-[10px] text-slate-500">{item.calls.map((c, j) => <li key={j} className="break-all">{c}</li>)}</ul></details>}
          <div className="mt-1.5 text-[10px] font-bold text-slate-400">표를 직접 조회해 만든 답입니다. 미수·초과료는 팀 칸이 없어 일정·접수·점검 기록으로 팀을 붙였습니다. 중요한 판단은 원본 표를 확인하세요.</div>
        </section>
      ))}

      {landing && (
        <section className="grid gap-2 sm:grid-cols-4">
          {[["① 현재 상태", "주소·키맨·등급·미수·재계약·불만·현장 메모·마지막 점검/AS를 한 장에"], ["② 기기", "기기별 계약 기간·임대료·마지막 점검/AS, 누르면 그 기기 기록만"], ["③ 어디에 몇 건", "표별 건수(0건도)와 이름이 비슷한 기록은 따로"], ["④ 타임라인", "월별로 묶어 날짜순, 종류·글자·기기로 걸러 보기, 원문 보기"]].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm"><div className="text-[12px] font-black text-slate-800">{t}</div><div className="mt-0.5 text-[11px] font-semibold leading-4 text-slate-500">{d}</div></div>
          ))}
        </section>
      )}

      {/* 후보 고르기 */}
      {phase === "choose" && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="text-[12px] font-black text-amber-800">"{query}" 에 해당하는 거래처가 여럿입니다 — 하나를 고르세요{pendingQ && <span className="ml-2 font-bold text-amber-600">(고르면 "{pendingQ.slice(0, 30)}" 에 바로 답합니다)</span>}</div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((c) => (
              <button key={`${c.code}|${c.leaseCode}`} type="button" onClick={() => void pick(c, query)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-blue-400">
                <div className="truncate text-[13px] font-black text-slate-900">{c.name}</div>
                <div className="mt-0.5 text-[10.5px] font-bold text-slate-500">{c.code ? `코드 ${c.code}` : `임대 코드 ${c.leaseCode}`} · 기기 {c.deviceCount}대 · <span className={EXACT_HOW.has(c.how) ? "text-emerald-700" : "text-amber-700"}>{c.how}</span></div>
              </button>
            ))}
            <button type="button" onClick={() => void pick(null, query)} className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-left text-[12px] font-bold text-slate-500 hover:border-slate-500">코드 없이 "{query}" 글자 그대로 모으기</button>
          </div>
        </section>
      )}

      {phase === "done" && entity && state && (
        <>
          {/* ① 현재 상태 */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="bg-[#1E252F] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-black text-slate-400">"{entity.query}" → {entity.code ? `거래처 코드 ${entity.code}` : entity.leaseCode ? `임대 코드 ${entity.leaseCode}` : "코드 없음 · 글자 그대로"}{entity.leaseCode && entity.code ? ` · 임대 코드 ${entity.leaseCode}` : ""}{foundBy && <span className="ml-2 text-indigo-300">{foundBy}</span>}{candidates.length > 1 && <button type="button" onClick={() => setPhase("choose")} className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black text-white hover:bg-white/20">다른 후보 {candidates.length - 1}</button>}</div>
                  <div className="mt-0.5 text-[20px] font-black leading-tight text-white">{entity.name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {state.grade && chip(`${state.grade}등급`, "bg-white/15 text-white")}
                    {state.leaseStatus && chip(state.leaseStatus, "bg-white/15 text-white")}
                    {state.workin.slice(0, 4).map((w, i) => <span key={i}>{chip(`워킨맵 ${w.team}팀 ${w.quarter}Q ${w.kind || ""}${w.count > 1 ? ` ${w.count}대` : ""}${w.label ? ` · ${w.label}${w.label === "G5" ? " 완료" : ""}` : ""}`.replace(/\s+/g, " ").trim(), i === 0 ? "bg-cyan-500/25 text-cyan-100" : "bg-white/10 text-slate-300")}</span>)}
                    {state.workin.length > 4 && chip(`워킨맵 외 ${state.workin.length - 4}묶음`, "bg-white/10 text-slate-300")}
                    {entity.names.length > 1 && chip(`이름 표기 ${entity.names.length}가지`, "bg-white/10 text-slate-300")}
                    {entity.phones.length > 0 && chip(`연락처 ${entity.phones.length}개로 문자·해피콜 연결`, "bg-white/10 text-slate-300")}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <button type="button" onClick={() => setHistVendor(entity.name)} className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/20">통합이력 ↗</button>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(`${entity.name} (${entity.code || entity.leaseCode})\n주소 ${state.address}\n키맨 ${state.keyman}\n전화 ${state.tel}`).then(() => notify("복사했습니다", "success")); }} className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/20">복사</button>
                  <button type="button" onClick={() => { setPhase("idle"); setEntity(null); setResults([]); setInput(""); setRouteNote(""); }} className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/20">새 검색</button>
                </div>
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-2 px-5 py-4 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
              <Field label="주소" value={state.address} from={state.addressFrom} wide />
              <Field label="키맨" value={state.keyman} from={state.keymanFrom} />
              <Field label="전화" value={state.tel} />
              <Field label="마지막 점검" value={state.lastInspect ? `${state.lastInspect} (${fmtDays(state.lastInspect)})` : "기록 없음"} tone={state.lastInspect && (daysSince(state.lastInspect) || 0) > 90 ? "text-amber-700" : ""} />
              <Field label="마지막 AS" value={state.lastAs ? `${state.lastAs} (${fmtDays(state.lastAs)})` : "기록 없음"} from={state.lastAsFrom === "AS 보고" ? "" : state.lastAsFrom === "접수" || state.lastAsFrom === "일정" ? `${state.lastAsFrom} 기준 · 처리 보고 없음` : state.lastAsFrom} />
              <Field label="마지막 방문기록" value={state.lastVisit ? `${state.lastVisit} (${fmtDays(state.lastVisit)})` : "기록 없음"} />
            </div>
            {/* 현장 메모 — 특이사항(출근·점심·주의)·워킨맵 메모·임대 조건. 가기 전에 꼭 봐야 하는 것이라 상태 카드 안에 */}
            {state.notes.length > 0 && (
              <div className="border-t border-amber-100 bg-amber-50/60 px-5 py-3">
                <div className="text-[10.5px] font-black text-amber-800">현장 메모 <span className="font-bold text-amber-600">{state.notes.some((n) => n.kind === "연락금지") ? <span className="mr-1 rounded bg-rose-600 px-1.5 py-0.5 text-white">연락 금지 {state.notes.filter((n) => n.kind === "연락금지").length}</span> : null}· 특이사항 {state.notes.filter((n) => n.kind === "특이사항").length} · 워킨맵 {state.notes.filter((n) => n.kind === "워킨맵").length} · 임대 조건 {state.notes.filter((n) => n.kind === "임대조건").length}</span></div>
                <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {state.notes.slice(0, 14).map((n, i) => (
                    <li key={i} className={`flex min-w-0 items-start gap-1.5 text-[12px] leading-5 ${n.kind === "연락금지" ? "font-black text-rose-700" : n.kind === "특이사항" ? "font-black text-slate-900" : "font-semibold text-slate-700"}`}>
                      <span className={`mt-1 shrink-0 rounded px-1 text-[9px] font-black ${n.kind === "연락금지" ? "bg-rose-600 text-white" : n.kind === "특이사항" ? "bg-amber-500 text-white" : n.kind === "워킨맵" ? "bg-cyan-100 text-cyan-800" : "bg-emerald-100 text-emerald-800"}`}>{n.kind}</span>
                      <span className="min-w-0 whitespace-pre-line break-words">{n.pinned ? "📌 " : ""}{n.text}{n.from ? <span className="ml-1 text-[10px] font-bold text-slate-400">· {n.from}</span> : null}</span>
                    </li>
                  ))}
                  {state.notes.length > 14 && <li className="text-[11px] font-bold text-slate-400">외 {state.notes.length - 14}건 — 타임라인의 기타 묶음에서</li>}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-5 py-3">
              {state.misu && state.misu.months && chip(`미수 ${state.misu.months}개월 ${state.misu.amount ? `· ${state.misu.amount}원` : ""} (${state.misu.date})`, "bg-orange-100 text-orange-800")}
              {state.overage && state.overage.amount && chip(`초과료 ${state.overage.amount} (${state.overage.date})`, "bg-purple-100 text-purple-800")}
              {state.recontract && chip(`재계약 ${state.recontract.status || "기록"}${state.recontract.end ? ` · 종료 ${state.recontract.end}` : ""} (${state.recontract.date})`, "bg-rose-100 text-rose-800")}
              {state.bulman && chip(`불만 ${state.bulman.date}${state.bulman.status ? ` · ${state.bulman.status}` : ""}`, "bg-red-100 text-red-800")}
              {state.openReceptions > 0 && chip(`열린 접수 ${state.openReceptions}건`, "bg-sky-100 text-sky-800")}
              {state.upcomingTickets > 0 && chip(`예정 일정 ${state.upcomingTickets}건`, "bg-indigo-100 text-indigo-800")}
              {state.changes > 0 && chip(`담당자·주소 변경 ${state.changes}건`, "bg-amber-100 text-amber-800")}
              {state.photos > 0 && chip(`사진 ${state.photos}장`, "bg-pink-100 text-pink-800")}
              {!state.misu && !state.overage && !state.recontract && !state.bulman && state.openReceptions === 0 && state.upcomingTickets === 0 && chip("미수·초과·재계약·불만·열린 접수 없음", "bg-emerald-50 text-emerald-700")}
            </div>
          </section>

          {/* ② 기기 */}
          {state.devices.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between"><div className="text-[12px] font-black text-slate-700">기기 {state.devices.length}대 <span className="font-bold text-slate-400">· 임대리스트 기준 · 누르면 그 기기 기록만</span></div>{deviceOnly && <button type="button" onClick={() => setDeviceOnly("")} className="text-[11px] font-black text-blue-600">기기 필터 해제</button>}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {state.devices.map((d, i) => {
                  const key = d.serial || d.asset; const active = key && identKey(deviceOnly) === identKey(key);
                  return (
                    <button key={i} type="button" onClick={() => setDeviceOnly(active ? "" : key)} className={`rounded-lg border p-3 text-left transition ${active ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20" : "border-emerald-200 bg-emerald-50/40 hover:border-blue-400"}`}>
                      <div className="flex items-start justify-between gap-2"><div className="truncate text-[13px] font-black text-slate-900">{d.model || "기종 미기재"}</div>{d.status && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${/종료|철수/.test(d.status) ? "bg-slate-200 text-slate-500" : "bg-white text-emerald-700"}`}>{d.status}</span>}</div>
                      <div className="mt-1 font-mono text-[11px] font-bold text-slate-700">{[d.asset && `자산 ${d.asset}`, d.serial && `기번 ${d.serial}`].filter(Boolean).join(" · ")}</div>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                        {d.start && <div className="col-span-2"><span className="font-black text-slate-400">계약 </span>{d.start}{d.end ? ` ~ ${d.end}` : ""}{d.monthsLeft ? ` (남은 ${d.monthsLeft}개월)` : ""}</div>}
                        {d.fee && <div><span className="font-black text-slate-400">기본 </span>{d.fee}</div>}
                        {d.grade && <div><span className="font-black text-slate-400">등급 </span>{d.grade}</div>}
                        <div><span className="font-black text-slate-400">점검 </span>{d.lastInspect || "없음"}</div>
                        <div><span className="font-black text-slate-400">AS </span>{d.lastAs || "없음"}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ③ 어디에 몇 건 */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white">기록 {state.total}건</span>
              <span className="text-[11px] font-bold text-slate-500">표 {state.counts.filter((c) => c.exact > 0).length}/{state.counts.length}개에 있음{state.oldest ? ` · ${state.oldest} ~ ${state.newest}` : ""}</span>
              {looseCount > 0 && <button type="button" onClick={() => setShowLoose((v) => !v)} className={`rounded-full px-3 py-1 text-[11px] font-black ${showLoose ? "bg-amber-500 text-white" : "border border-amber-300 bg-amber-50 text-amber-800"}`}>이름이 비슷한 기록 {looseCount}건 {showLoose ? "숨기기" : "보기"}</button>}
              {state.counts.some((c) => !c.ok) && <span className="text-[10px] font-bold text-rose-600">조회 실패: {state.counts.filter((c) => !c.ok).map((c) => c.label).join(", ")}</span>}
              {state.counts.some((c) => c.rawSkipped) && <span className="text-[10px] font-bold text-amber-700" title="원문 글 속 기번 검색이 느려 건너뛴 표 — 이름·기기 칸 일치는 모두 반영됨">원문 검색 생략: {state.counts.filter((c) => c.rawSkipped).map((c) => c.label).join(", ")}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {state.counts.filter((c) => c.label !== "임대리스트").map((c) => (
                <button key={c.label} type="button" onClick={() => { setSourceOnly(sourceOnly === c.label ? "" : c.label); setGroup("전체"); }} disabled={c.exact === 0 && !(showLoose && c.loose > 0)}
                  className={`rounded px-2 py-1 text-[10.5px] font-black transition ${sourceOnly === c.label ? "bg-slate-900 text-white" : c.exact > 0 ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-slate-50 text-slate-300"}`}>
                  {c.label} <span className="tabular-nums">{c.exact}</span>{showLoose && c.loose > 0 && <span className="ml-0.5 text-amber-500">+{c.loose}</span>}
                </button>
              ))}
            </div>
          </section>

          {/* ③-1 질문하기 — 모인 기록으로 바로 답 */}
          <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-black text-indigo-900">이 업체에 대해 물어보기 <span className="font-bold text-indigo-500">· 위에 모인 기록 {state.total}건만 근거로 답합니다</span></div>
              {answers.length > 0 && <button type="button" onClick={() => setAnswers([])} className="text-[10px] font-black text-indigo-600">답 지우기</button>}
            </div>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={asking} placeholder="예: 여긴 AS가 몇 번 터졌어? / 언제부터 임대했어?" className="h-10 min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-60" />
              <button type="submit" disabled={asking || !question.trim()} className="h-10 shrink-0 rounded-lg bg-indigo-600 px-4 text-[12px] font-black text-white hover:bg-indigo-700 disabled:opacity-40">{asking ? "찾는 중…" : "물어보기"}</button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1">
              {ASK_SUGGESTIONS.map((s) => <button key={s} type="button" disabled={asking} onClick={() => void ask(s)} className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[10.5px] font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">{s}</button>)}
            </div>
            {asking && <div className="mt-3 rounded-lg border border-indigo-100 bg-white p-3 text-[12px] font-bold text-indigo-500">기록 {state.total}건을 읽고 답을 쓰는 중입니다… (20~30초)</div>}
            {answers.map((item, i) => (
              <div key={`${item.q}-${i}`} className="mt-3 rounded-lg border border-indigo-100 bg-white p-3">
                <div className="text-[11px] font-black text-indigo-600">Q. {item.q}</div>
                <div className="mt-1.5 whitespace-pre-wrap text-[13px] font-semibold leading-6 text-slate-800">{item.a}</div>
                <div className="mt-1.5 text-[10px] font-bold text-slate-400">근거로 넘긴 기록 {item.used}건 · 기록에 없는 내용은 답하지 않도록 되어 있습니다. 중요한 판단은 원문을 확인하세요.</div>
              </div>
            ))}
          </section>

          {/* ③-2 기종 참고 자료 */}
          {modelRefs.some((m) => m.notes.count || m.docs.count || m.playbook.count) && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[12px] font-black text-slate-700">이 업체 기종의 참고 자료 <span className="font-bold text-slate-400">· 처리이력·가이드·족보 (복합기 학습 탭)</span></div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {modelRefs.filter((m) => m.notes.count || m.docs.count || m.playbook.count).map((m) => (
                  <div key={m.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                    <div className="text-[12.5px] font-black text-slate-900">{m.model}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-black">{m.notes.count > 0 && chip(`처리이력 ${m.notes.count}`, "bg-blue-100 text-blue-800")}{m.docs.count > 0 && chip(`가이드 ${m.docs.count}`, "bg-emerald-100 text-emerald-800")}{m.playbook.count > 0 && chip(`족보 ${m.playbook.count}`, "bg-amber-100 text-amber-800")}</div>
                    <ul className="mt-1.5 space-y-0.5 text-[11px] font-semibold text-slate-600">{[...m.playbook.titles, ...m.notes.titles, ...m.docs.titles].slice(0, 4).map((t, i) => <li key={i} className="truncate">· {t}</li>)}</ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ④ 타임라인 */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
              {(["전체", ...GROUPS] as Array<"전체" | Group>).map((g) => (
                <button key={g} type="button" onClick={() => { setGroup(g); setSourceOnly(""); }} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${group === g ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                  {g}{g !== "전체" && <span className="ml-1 tabular-nums opacity-70">{groupCounts.get(g) || 0}</span>}
                </button>
              ))}
              <input value={within} onChange={(e) => setWithin(e.target.value)} placeholder="이 안에서 글자 찾기" className="ml-auto h-8 w-full rounded-lg border border-slate-300 px-2.5 text-[11.5px] font-semibold outline-none focus:border-blue-500 sm:w-48" />
            </div>
            {months.length === 0 && <div className="px-4 py-8 text-center text-xs font-bold text-slate-400">{events.length ? "조건에 맞는 기록이 없습니다" : "이 검색어로 찾은 기록이 없습니다 — 표기가 다르면 업체명 일부로 다시 찾아 보세요"}</div>}
            {months.map(([month, list]) => (
              <div key={month}>
                <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-slate-100 bg-white/95 px-4 py-1.5 backdrop-blur"><span className="text-[11px] font-black text-slate-700">{month === "날짜 없음" ? month : `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`}</span><span className="text-[10px] font-bold text-slate-400">{list.length}건</span></div>
                <div className="divide-y divide-slate-100">
                  {list.map((ev) => {
                    const raw = rawTextOf(ev.row); const open = openRaw === ev.key;
                    return (
                      <div key={ev.key} className={`px-4 py-2.5 text-xs ${ev.loose ? "bg-amber-50/40" : ""}`}>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="w-[62px] shrink-0 font-black tabular-nums text-slate-500">{ev.date ? ev.date.slice(5) : "—"}</span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black ${ev.source.tone}`}>{ev.source.label}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-black text-slate-900">{ev.title || "(제목 없음)"}</span>
                          {ev.loose && <span className="shrink-0 rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-black text-white">이름 비슷 · 확인</span>}
                          {!ev.loose && isOtherVendor(ev, entity) && <span title="같은 기기 번호가 다른 업체 기록에 있습니다 — 이동 기기의 이전 사용처" className="shrink-0 rounded bg-fuchsia-600 px-1.5 py-0.5 text-[9px] font-black text-white">다른 업체 · {ev.vendor.slice(0, 14)}</span>}
                          {(ev.model || ev.serial || ev.asset) && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600">{[ev.model, ev.asset, ev.serial].filter(Boolean).join(" · ").slice(0, 40)}</span>}
                          {(ev.author || ev.team) && <span className="shrink-0 text-[10px] font-bold text-slate-400">{[ev.team && `${ev.team}`, ev.author].filter(Boolean).join(" · ")}</span>}
                        </div>
                        {ev.snippet && <div className="mt-0.5 pl-[70px] text-[11.5px] font-semibold leading-5 text-slate-600">{ev.snippet}</div>}
                        {raw && <div className="pl-[70px]"><button type="button" onClick={() => setOpenRaw(open ? null : ev.key)} className="mt-0.5 text-[10px] font-black text-blue-600">{open ? "원문 닫기" : "원문 보기"}</button>{open && <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-sans text-[11.5px] leading-5 text-slate-700">{raw}</pre>}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {filtered.length > limit && <button type="button" onClick={() => setLimit((n) => n + 150)} className="w-full border-t border-slate-100 py-2.5 text-[11px] font-black text-blue-600 hover:bg-slate-50">더 보기 ({filtered.length - limit}건 남음)</button>}
          </section>
        </>
      )}

      <UnifiedHistory vendor={histVendor} accent="#2563eb" open={!!histVendor} onClose={() => setHistVendor("")} onError={(msg) => notify(msg, "error")} author={author} />
    </div>
  );
}

function Field({ label, value, from, tone = "", wide = false }: { label: string; value: string; from?: string; tone?: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <span className="mr-1.5 text-[10.5px] font-black text-slate-400">{label}</span>
      <span className={`whitespace-pre-line font-bold ${tone || (value ? "text-slate-800" : "text-slate-400")}`}>{value || "없음"}</span>
      {from && value && <span className="ml-1.5 text-[10px] font-bold text-slate-400">· {from}</span>}
    </div>
  );
}
