/**
 * 통합 검색 360 — 자산기번·시리얼·업체명 중 하나로 "이 업체(기기)에 대해 회사가 가진 모든 기록"을 한 화면에.
 *
 * 화면 순서: 검색 → (후보가 여럿이면 고르기) → ① 현재 상태 카드(주소·키맨·등급·미수·재계약·불만·마지막 점검/AS·열린 접수)
 *   → ② 기기 카드 → ③ 어디에 몇 건이 있는지(표별 집계, 0건도 보여 "빠짐없이"를 확인) → ④ 타임라인(월별 묶음, 종류·기기·글자 필터)
 *   → ⑤ 이름이 비슷하기만 한 기록(확인 필요, 접어 둠). 로직은 entity360.ts.
 */
import { useMemo, useState } from "react";
import { notify } from "./toast";
import UnifiedHistory from "./UnifiedHistory";
import { invokeEdgeFunction } from "./supabase";
import {
  buildEntity, daysSince, deriveState, gather, identKey, isOtherVendor, rawTextOf, resolveCandidates, SOURCES, toEvents,
  type Candidate, type Entity, type EventItem, type Group, type SourceResult, type State,
} from "./entity360";

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
      devices: state.devices, misu: state.misu, overage: state.overage, recontract: state.recontract, bulman: state.bulman,
      lastInspect: state.lastInspect, lastAs: state.lastAs, lastVisit: state.lastVisit, openReceptions: state.openReceptions, upcomingTickets: state.upcomingTickets,
      counts: state.counts.filter((c) => c.exact).map((c) => `${c.label} ${c.exact}`), total: state.total, oldest: state.oldest, newest: state.newest,
    },
    events: rows,
  };
}
const ASK_SUGGESTIONS = ["AS가 몇 번 있었고 주로 무슨 문제였어?", "언제부터 임대했고 기기는 어떻게 바뀌었어?", "이 기기 이전 사용처가 있어?", "초과료·미수 흐름을 정리해 줘", "이 업체를 처음 가는 사람에게 한 문단으로 요약해 줘"];

type Phase = "idle" | "resolving" | "choose" | "gathering" | "done";
const GROUPS: Group[] = ["기기·계약", "현장 기록", "영업·관리", "고객 소통", "기타"];
const EXACT_HOW = new Set(["기번·자산번호 일치", "임대리스트 기기 번호 일치", "업체명 일치"]);
const fmtDays = (ymd: string) => { const d = daysSince(ymd); return d === null ? "" : d === 0 ? "오늘" : `${d}일 전`; };

export default function Search360({ author }: { author: string }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [group, setGroup] = useState<"전체" | Group>("전체");
  const [sourceOnly, setSourceOnly] = useState("");
  const [within, setWithin] = useState("");
  const [deviceOnly, setDeviceOnly] = useState("");
  const [showLoose, setShowLoose] = useState(false);
  const [openRaw, setOpenRaw] = useState<string | null>(null);
  const [limit, setLimit] = useState(120);
  const [histVendor, setHistVendor] = useState("");
  // 질문하기 — 모인 기록을 그대로 넘겨 답을 받는다(entity-ask 엣지 함수). 기록에 없는 건 없다고 답하게 돼 있다
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Array<{ q: string; a: string; used: number }>>([]);

  const resetFilters = () => { setGroup("전체"); setSourceOnly(""); setWithin(""); setDeviceOnly(""); setShowLoose(false); setLimit(120); setOpenRaw(null); setAnswers([]); setQuestion(""); };

  const pick = async (c: Candidate | null, q: string) => {
    setPhase("gathering");
    try {
      const e = await buildEntity(c, q);
      const r = await gather(e);
      setEntity(e); setResults(r); setPhase("done");
    } catch (err) {
      notify(`모으기 실패: ${(err as Error).message}`, "error"); setPhase("idle");
    }
  };
  const run = async () => {
    const q = input.trim();
    if (q.length < 2) { notify("두 글자 이상 넣어 주세요 — 자산기번·시리얼·업체명 아무거나", "info"); return; }
    setQuery(q); resetFilters(); setEntity(null); setResults([]); setPhase("resolving");
    const list = await resolveCandidates(q).catch(() => [] as Candidate[]);
    setCandidates(list);
    // 하나뿐이거나, 정확 일치가 딱 하나면 바로 모은다. 애매하면 고르게 한다(엉뚱한 업체를 모으지 않게)
    const exactOnes = list.filter((c) => EXACT_HOW.has(c.how));
    if (list.length === 1 || exactOnes.length === 1) { await pick(exactOnes[0] || list[0], q); return; }
    if (!list.length) { await pick(null, q); return; }
    setPhase("choose");
  };

  const events = useMemo(() => (entity ? toEvents(results) : []), [entity, results]);
  const state = useMemo(() => (entity ? deriveState(entity, results) : null), [entity, results]);
  const looseCount = events.filter((ev) => ev.loose).length;
  const filtered = useMemo(() => {
    const w = within.trim().toLowerCase();
    const dk = identKey(deviceOnly);
    return events.filter((ev) => {
      if (ev.loose && !showLoose) return false;
      if (ev.source.table === "vendor_info") return false; // 임대리스트는 기기 카드로 보여 준다
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

  const chip = (text: string, tone = "bg-slate-100 text-slate-700") => <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${tone}`}>{text}</span>;

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || !entity || !state || asking) return;
    setAsking(true); setQuestion("");
    try {
      const body = { question: text, author, ...compactForAsk(entity, state, events) };
      const res = await invokeEdgeFunction<{ answer?: string; error?: string }>("entity-ask", body, 90_000);
      if (res.error) throw new Error(res.error);
      setAnswers((cur) => [{ q: text, a: String(res.answer || "").trim(), used: body.events.length }, ...cur].slice(0, 6));
    } catch (err) {
      notify(`답을 받지 못했습니다: ${(err as Error).message}`, "error");
    } finally { setAsking(false); }
  };

  return (
    <div className="space-y-3">
      {/* 검색 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-black text-slate-500">자산기번 · 시리얼(기번) · 업체명 — 아무거나 하나로 회사에 있는 모든 기록을 모읍니다</div>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="예: B7230 · ZPBLBJST8000GQV · 무암 · 잡플러스" autoCapitalize="off"
            className="h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 text-[15px] font-bold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <button type="submit" disabled={phase === "resolving" || phase === "gathering"} className="h-12 shrink-0 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-50">
            {phase === "resolving" ? "찾는 중…" : phase === "gathering" ? "모으는 중…" : "모두 모으기"}
          </button>
        </form>
        <p className="mt-2 text-[11px] font-semibold text-slate-400">{SOURCES.length}개 표를 한 번에 뒤집니다 — {SOURCES.map((s) => s.label).join(" · ")}</p>
      </section>

      {/* 후보 고르기 */}
      {phase === "choose" && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="text-[12px] font-black text-amber-800">"{query}" 에 해당하는 거래처가 여럿입니다 — 하나를 고르세요</div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((c) => (
              <button key={c.code} type="button" onClick={() => void pick(c, query)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-blue-400">
                <div className="truncate text-[13px] font-black text-slate-900">{c.name}</div>
                <div className="mt-0.5 text-[10.5px] font-bold text-slate-500">코드 {c.code} · 기기 {c.deviceCount}대 · <span className={EXACT_HOW.has(c.how) ? "text-emerald-700" : "text-amber-700"}>{c.how}</span></div>
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
                  <div className="text-[11px] font-black text-slate-400">"{entity.query}" → {entity.code ? `거래처 코드 ${entity.code}` : "코드 없음 · 글자 그대로"}{candidates.length > 1 && <button type="button" onClick={() => setPhase("choose")} className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black text-white hover:bg-white/20">다른 후보 {candidates.length - 1}</button>}</div>
                  <div className="mt-0.5 text-[20px] font-black leading-tight text-white">{entity.name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {state.grade && chip(`${state.grade}등급`, "bg-white/15 text-white")}
                    {state.leaseStatus && chip(state.leaseStatus, "bg-white/15 text-white")}
                    {state.workin.map((w, i) => <span key={i}>{chip(`워킨맵 ${w.team}팀 ${w.quarter}Q ${w.kind || ""} ${w.label || ""}`.replace(/\s+/g, " ").trim(), "bg-cyan-500/25 text-cyan-100")}</span>)}
                    {entity.names.length > 1 && chip(`이름 표기 ${entity.names.length}가지`, "bg-white/10 text-slate-300")}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <button type="button" onClick={() => setHistVendor(entity.name)} className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/20">통합이력 ↗</button>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(`${entity.name} (${entity.code})\n주소 ${state.address}\n키맨 ${state.keyman}\n전화 ${state.tel}`).then(() => notify("복사했습니다", "success")); }} className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/20">복사</button>
                </div>
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-2 px-5 py-4 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
              <Field label="주소" value={state.address} from={state.addressFrom} wide />
              <Field label="키맨" value={state.keyman} from={state.keymanFrom} />
              <Field label="전화" value={state.tel} />
              <Field label="마지막 점검" value={state.lastInspect ? `${state.lastInspect} (${fmtDays(state.lastInspect)})` : "기록 없음"} tone={state.lastInspect && (daysSince(state.lastInspect) || 0) > 90 ? "text-amber-700" : ""} />
              <Field label="마지막 AS" value={state.lastAs ? `${state.lastAs} (${fmtDays(state.lastAs)})` : "기록 없음"} />
              <Field label="마지막 방문기록" value={state.lastVisit ? `${state.lastVisit} (${fmtDays(state.lastVisit)})` : "기록 없음"} />
            </div>
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
              <div className="flex items-center justify-between"><div className="text-[12px] font-black text-slate-700">기기 {state.devices.length}대 <span className="font-bold text-slate-400">· 임대리스트 기준</span></div>{deviceOnly && <button type="button" onClick={() => setDeviceOnly("")} className="text-[11px] font-black text-blue-600">기기 필터 해제</button>}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {state.devices.map((d, i) => {
                  const key = d.serial || d.asset; const active = key && identKey(deviceOnly) === identKey(key);
                  return (
                    <button key={i} type="button" onClick={() => setDeviceOnly(active ? "" : key)} title="누르면 이 기기 기록만" className={`rounded-lg border p-3 text-left transition ${active ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20" : "border-emerald-200 bg-emerald-50/40 hover:border-blue-400"}`}>
                      <div className="flex items-start justify-between gap-2"><div className="truncate text-[13px] font-black text-slate-900">{d.model || "기종 미기재"}</div>{d.status && <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-600">{d.status}</span>}</div>
                      <div className="mt-1 font-mono text-[11px] font-bold text-slate-700">{[d.asset && `자산 ${d.asset}`, d.serial && `기번 ${d.serial}`].filter(Boolean).join(" · ")}</div>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                        {d.start && <div><span className="font-black text-slate-400">계약 </span>{d.start}{d.end ? ` ~ ${d.end}` : ""}</div>}
                        {d.monthsLeft && <div><span className="font-black text-slate-400">남은 </span>{d.monthsLeft}개월</div>}
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
            {answers.map((item, i) => (
              <div key={`${item.q}-${i}`} className="mt-3 rounded-lg border border-indigo-100 bg-white p-3">
                <div className="text-[11px] font-black text-indigo-600">Q. {item.q}</div>
                <div className="mt-1.5 whitespace-pre-wrap text-[13px] font-semibold leading-6 text-slate-800">{item.a}</div>
                <div className="mt-1.5 text-[10px] font-bold text-slate-400">근거로 넘긴 기록 {item.used}건 · 기록에 없는 내용은 답하지 않도록 되어 있습니다. 중요한 판단은 원문을 확인하세요.</div>
              </div>
            ))}
          </section>

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
