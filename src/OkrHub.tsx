// OKR 화면 — 기록·성과 > OKR (2026-09-24)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북을 웹으로 옮겼다. 다른 탭과 같은 짙은 상단 바에 연도 + 1~12월만 두고, 달을 고르면 그 달 OKR이 열린다
// (없으면 지난달 목표를 복사한 초안 — 무언가 적는 순간 저장).
//  - 구조: Pillar 3개(AI·효율성·비용절감 / 매출증대·안정 / 나의 성장·소통) × 병목 1·2·3 = 목표 9개.
//  - 목표(objective)·Pillar·병목은 통합집계 하나(2026-10-01 사용자): 달의 공통(okr_cycles.goals)을 모든 파트·팀원이 똑같이 본다. 분기 안에서는 달마다 같은 목표.
//    [전분기/지난달 목표 불러오기]로 이어 쓰고 조금만 고친다. 파트·팀원 화면에서 목표 칸은 파란 읽기 칸.
//  - 달성기준은 주차마다·칸마다: 이 주차의 파트 종합 기록(header.goals)에 적은 것이 팀원 모두의 기본, 팀원이 고친 것은 그 사람 기록에만(파트로 안 올라감).
//    고친 번호의 칸만 저장되므로 안 고친 번호는 위 단계 것이 그대로 흐른다. 누가 열어도 같은 화면(15초 동기화). [전주 달성기준 불러오기]로 이어 쓴다.
//  - 파트 탭(A~D) = 엑셀 시트 한 장. Pillar는 표 위 가로 막대(행 머리), 그 아래 병목 1·2·3 행. 셀은 엑셀처럼: 한 번 눌러 선택 → Del 삭제 → 더블클릭·Enter·타이핑으로 편집.
//    노란 칸(실제결과·사유·개선계획·근거자료)과 목표·달성기준은 글자색 검정·빨강·파랑을 바꿔 적을 수 있다(RichCell).
//    완료·해당없음이 아니면 사유·개선계획이 필수(빈 칸이 붉게), 미흡·미착수 행은 왼쪽 띠.
//  - 파트 안에 [파트 종합] + 팀원 박스(× 로 기록 삭제). 팀원은 자기 박스에서 적고, 파트장은 종합에서 모아 넣는다. 통계·통합집계는 파트 종합 행 기준.
//  - AI 보조(엣지 okr-assist): ✨정리(메모 → 양식) · ✨합치기(팀원 → 종합, 건수 합산) · ✨초안(파트 결과 → 팀장 피드백). 숫자는 만들지 않는다.
//  - 디자인 원칙(2026-09-24 사용자): 설명 문구·이모지 없이, 색은 판정 등급과 노란 입력칸에만.
//  - 저장은 자동(0.7초 디바운스). 저장 직전 서버 값과 3자 비교해(okr.ts mergeReport/mergeCycle) 내가 고친 칸만 쓰고 남이 고친 칸은 살린다.
//  - 동기화(2026-09-29): 달·주차는 항상 서버에서 새로 읽고, 15초마다·창이 다시 보일 때 내가 고치지 않은 것은 서버 값으로 바꾼다 — 모든 파트가 서로 것을 본다.
//  - 주차(2026-09-29): 달 옆 [월 | 1주 2주 …]. 주차는 결과·판정·피드백을 따로 적는 별도 기록(okr_cycles kind=week, parent_id=달)이고,
//    목표·달성기준은 달(공통 + 파트 고유)을 그대로 쓴다 — 주차 화면에서 목표를 고치면 달 것이 바뀐다.
import { useEffect, useMemo, useRef, useState } from "react";
import PortalSelect from "./PortalSelect";
import RichCell from "./RichCell";
import JudgmentPicker from "./JudgmentPicker";
import { createPortal } from "react-dom";
import { tableCellClick } from "./cellNav";
import { askConfirm } from "./confirmModal";
import { useAuthorBook } from "./authors";
import { teamForAuthor } from "./operations";
import {
  JUDGMENT_INFO, OKR_PILLARS, OKR_TEAMS, achievementRate, actionMembers, actionTeams, bottleneckLabel, cycleLabel, defaultCycleTitle,
  currentWeekOf, defaultGoalTemplate, deleteOkrReport, emptyGoal, emptyReport, emptyResultRow, findReport, getOkrCycle, getOkrReport, getOkrReports, hasResultRows, isAlert, listOkrCycles, listOkrResultIndex, memberReports,
  mergeCycle, mergeMemberActuals, mergeReport, monthCycleId, needsReasonPlan, normalizeJudgment, okrAssist, okrWeeksInMonth, overlayCriteria, pillarIndex, pillarLabel, probeOkrSchema, putCriteria, remapFeedback, remapReports,
  renumberGoals, reportKey, resultRowFor, saveOkrCycle, saveOkrReport, weekCycleId, worstJudgment, worstOfJudgments,
  type OkrCycle, type OkrGoal, type OkrReport, type OkrResultRow, type OkrTeam, type RichField,
} from "./okr";

type Tab = "all" | OkrTeam;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type GoalOps = { onGoal: (no: number, patch: Partial<OkrGoal>) => void; onPillar: (nos: number[], idx: number) => void; onInsert: (afterNo: number, pillarFull: string) => void; onRemove: (goal: OkrGoal) => void };

const kstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const kstClock = () => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const teamName = (team: string) => `${team}파트`;
const pad = (n: number) => String(n).padStart(2, "0");
const sig = (c: OkrCycle) => JSON.stringify({ goals: c.goals, feedback: c.feedback, title: c.title });
const shortBottleneck = (goals: OkrGoal[], no: number) => bottleneckLabel(goals, no).replace("병목현상", "병목");
// 노란 칸의 색 정보 갱신 — 평문으로 바뀐 칸(AI·합치기)은 색을 지운다
const withHtml = (row: OkrResultRow, field: RichField, html: string | undefined): OkrResultRow["html"] => {
  const next = { ...(row.html || {}) };
  if (html) next[field] = html; else delete next[field];
  return Object.keys(next).length ? next : undefined;
};
const clearHtml = (row: OkrResultRow, fields: RichField[]): OkrResultRow["html"] => {
  const next = { ...(row.html || {}) };
  for (const f of fields) delete next[f];
  return Object.keys(next).length ? next : undefined;
};
const goalHtml = (g: OkrGoal, field: "objective" | "criteria", html: string | undefined): OkrGoal["html"] => {
  const next = { ...(g.html || {}) };
  if (html) next[field] = html; else delete next[field];
  return Object.keys(next).length ? next : undefined;
};

const TD = "border border-slate-200 align-top";
const TD_READ = `${TD} px-2 py-1.5`;
const TD_CELL = `${TD} p-0`; // 빈 곳 클릭은 표의 onClick(tableCellClick)이 안쪽 칸으로 넘긴다
const TD_EDIT = `${TD_CELL} focus-within:ring-2 focus-within:ring-inset focus-within:ring-slate-400`;
const TD_WRITE = `${TD_CELL} bg-[#FFFBEB] focus-within:bg-white`;
const TD_FIXED = `${TD_CELL} bg-sky-50`; // 고정 목표(전사 공통) — 파트·팀원 화면에서 읽기만, 색으로 구분(2026-09-30 팀장)
const TD_FIXED_EDIT = `${TD_FIXED} focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-400`;
const TH_READ = "border border-slate-300 bg-slate-100 px-2 py-1.5 text-slate-600";
const TH_WRITE = "border border-slate-300 bg-[#FDECB3] px-2 py-1.5 text-slate-800";
const LINK = "text-slate-500 hover:text-slate-900 hover:underline disabled:opacity-40";
// AI·모아 넣기 버튼(✨정리·✨합치기·그대로 모아 넣기·✨초안·팀원 기록 보기)은 사용자가 써 본 뒤 다시 정하기로 해 잠시 숨김(2026-09-26). 코드는 그대로.
const SHOW_OKR_TOOLS = false;
const MONTH_VIEW_UNTIL = "2026-09"; // 달 단위로 적던 마지막 달 — 그 뒤는 주차 기록만 있어 '월 종합' 탭을 보이지 않는다(2026-10-01)

// 열 너비 — 머리 칸 오른쪽 가장자리를 끌어 조절(엑셀처럼, 2026-09-24). 이 브라우저에 기억(localStorage), 가장자리를 두 번 누르면 기본값.
function useColWidths(storageKey: string, defaults: number[]) {
  const [widths, setWidths] = useState<number[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || "null"); if (Array.isArray(saved) && saved.length === defaults.length) return saved.map((n) => Math.max(40, Number(n) || 0)); } catch { /* 무시 */ }
    return defaults;
  });
  const persist = (next: number[]) => { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 무시 */ } };
  const startDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = widths[index];
    let latest = widths;
    const onMove = (ev: MouseEvent) => { const next = [...latest]; next[index] = Math.max(40, start + ev.clientX - startX); latest = next; setWidths(next); };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); persist(latest); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const resetCol = (index: number) => { const next = [...widths]; next[index] = defaults[index]; setWidths(next); persist(next); };
  return { widths, total: widths.reduce((a, b) => a + b, 0), startDrag, resetCol };
}
const ResizeHandle = ({ onDrag, onReset }: { onDrag: (e: React.MouseEvent) => void; onReset: () => void }) => <span onMouseDown={onDrag} onDoubleClick={onReset} title="끌어서 너비 조절 · 두 번 누르면 기본" className="absolute -right-[3px] top-0 z-10 h-full w-[7px] cursor-col-resize select-none hover:bg-slate-400/60" />;

// 월 고르기 — 현재 달만 보이는 버튼, 누르면 분기별로 1·2·3월 / 4·5·6월… 묶인 작은 판이 뜬다(1~12월 나열 대신, 2026-09-24 사용자 제안). 기록 있는 달엔 점.
function MonthPicker({ value, current, onChange }: { value: number; current?: number; onChange: (m: number) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  const place = () => { const box = triggerRef.current?.getBoundingClientRect(); if (!box) return; setSpot({ top: box.bottom + 6, left: Math.min(Math.max(8, box.right - 280), window.innerWidth - 288) }); };
  useEffect(() => {
    if (!spot) return;
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setSpot(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setSpot(null); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [spot]);
  return <>
    <button ref={triggerRef} type="button" onClick={() => (spot ? setSpot(null) : place())} className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-white/20">
      {value}월<svg width="14" height="14" viewBox="0 0 20 20" fill="none" className={`text-slate-400 transition ${spot ? "rotate-180" : ""}`}><path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {spot && createPortal(
      <div ref={panelRef} style={{ position: "fixed", top: spot.top, left: spot.left, width: 280, zIndex: 4000 }} className="rounded-xl border border-slate-200 bg-white p-2 shadow-[0_16px_40px_rgba(15,23,42,0.22)]">
        {[1, 2, 3, 4].map((q) => <div key={q} className="flex items-center gap-2 border-b border-slate-100 py-1 last:border-0">
          <span className="w-11 shrink-0 border-r border-slate-300 pr-2 text-right text-[11px] font-black text-slate-500">{q}분기</span>
          {[1, 2, 3].map((i) => { const m = (q - 1) * 3 + i; return <button key={m} type="button" title={m === current ? "이번 달" : undefined} onClick={() => { onChange(m); setSpot(null); }} className={`relative flex-1 rounded-md px-2 py-1.5 text-center text-[13px] font-bold tabular-nums transition ${m === value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"} ${m === current && m !== value ? "ring-1 ring-inset ring-emerald-500" : ""}`}>{m}</button>; })}
        </div>)}
      </div>,
      document.body,
    )}
  </>;
}

// Pillar 행 머리 — 표 위 가로 막대. 고칠 수 있는 화면(파트 종합·통합집계)에서는 여기서 Pillar를 바꾸고 병목을 추가한다.
function PillarBar({ idx, colSpan, editable, onPillar, onAdd }: { idx: number; colSpan: number; editable: boolean; onPillar: (i: number) => void; onAdd: () => void }) {
  return <tr><td colSpan={colSpan} className="border border-slate-800 bg-slate-800 px-2 py-1 text-[12px] font-black text-white">
    <div className="flex items-center gap-3">
      {editable
        ? <select value={String(idx)} onChange={(e) => onPillar(Number(e.target.value))} className="cursor-pointer bg-slate-800 text-[12px] font-black text-white outline-none">
          <option value="-1">Pillar 미정</option>
          {OKR_PILLARS.map((p, i) => <option key={p.label} value={String(i)}>Pillar {i + 1} · {p.label}</option>)}
        </select>
        : <span className="px-1">{idx >= 0 ? `Pillar ${idx + 1} · ${OKR_PILLARS[idx].label}` : "Pillar 미정"}</span>}
      {editable && <button type="button" onClick={onAdd} className="ml-auto text-[11px] font-bold text-slate-400 hover:text-white">＋ 병목</button>}
    </div>
  </td></tr>;
}

// 병목 칸 — "병목 n" + 작은 ×(목표 삭제, 고칠 수 있을 때만)
function BottleneckCell({ goals, goal, alert, alertTone, editable, onRemove }: { goals: OkrGoal[]; goal: OkrGoal; alert: boolean; alertTone: string; editable: boolean; onRemove: (g: OkrGoal) => void }) {
  return <td className={`${TD_READ} text-[11px] font-bold text-slate-500 ${alert ? `border-l-4 ${alertTone}` : ""}`}>
    <div className="flex items-start justify-between gap-1">{shortBottleneck(goals, goal.no)}{editable && <button type="button" title="이 목표 삭제" onClick={() => onRemove(goal)} className="text-slate-300 hover:text-rose-600">×</button>}</div>
  </td>;
}

function JudgmentBadge({ value }: { value: string }) {
  const j = normalizeJudgment(value);
  if (!j) return <span className="text-[11px] text-slate-300">—</span>;
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-bold ${JUDGMENT_INFO[j].tone}`}>{j}</span>;
}

// 연속된 같은 Pillar 목표를 한 묶음으로(막대 하나 + 병목 1·2·3 행)
function pillarRuns(goals: OkrGoal[]): Array<{ idx: number; goals: OkrGoal[] }> {
  const out: Array<{ idx: number; goals: OkrGoal[] }> = [];
  for (const g of goals) {
    const idx = pillarIndex(g.pillar);
    const last = out[out.length - 1];
    if (last && last.idx === idx) last.goals.push(g);
    else out.push({ idx, goals: [g] });
  }
  return out;
}

export default function OkrHub({ author }: { author: string }) {
  const today = kstToday();
  const { book } = useAuthorBook();
  const myTeam = useMemo(() => { const t = teamForAuthor(author); return (OKR_TEAMS as readonly string[]).includes(t) ? (t as OkrTeam) : null; }, [author]);
  const [cycles, setCycles] = useState<OkrCycle[]>([]);
  const [resultIds, setResultIds] = useState<Set<string>>(new Set()); // 결과가 적힌 달·주차 id
  const thisWeek = useMemo(() => currentWeekOf(today), [today]);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [weekNo, setWeekNo] = useState<number | null>(null); // null = 월 전체, n = n주차 — 주차마다 결과를 따로 적는다(2026-09-29 요청)
  const [cycle, setCycle] = useState<OkrCycle | null>(null);
  const [reports, setReports] = useState<OkrReport[]>([]);
  // 주차를 열었을 때 목표의 출처 — 달(공통 목표·Pillar·병목). 달성기준 덮어쓰기는 열린 주차의 기록(reports)에 있다.
  const [goalSrc, setGoalSrc] = useState<{ cycle: OkrCycle } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false); // okr_reports.member 열이 없는 옛 표
  useEffect(() => { void probeOkrSchema().then((ok) => setNeedsUpgrade(!ok)).catch(() => undefined); }, []);
  const [message, setMessage] = useState("");
  useEffect(() => { if (!message) return; const t = window.setTimeout(() => setMessage(""), 6000); return () => window.clearTimeout(t); }, [message]);
  const [tab, setTab] = useState<Tab>(myTeam || "all");
  const [member, setMember] = useState(myTeam ? author : ""); // '' = 파트 종합
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [syncedAt, setSyncedAt] = useState("");
  const [aiBusy, setAiBusy] = useState("");
  // 마지막으로 서버와 맞춘 값(base) — 저장 때 지금 서버 값과 3자 비교해, 내가 고친 칸만 내 것으로 쓰고 남이 고친 칸은 덮어쓰지 않는다
  const cycleBaseRef = useRef<Record<string, OkrCycle>>({});
  const reportBaseRef = useRef<Record<string, OkrReport>>({});
  const loadedCycleRef = useRef("");
  const cyclesRef = useRef<OkrCycle[]>([]);
  useEffect(() => { cyclesRef.current = cycles; }, [cycles]);
  // 주차의 저장 id — 보통은 연-월-W번호. 같은 기간(시작 월요일)의 행이 다른 id로 남아 있으면(셈법이 바뀌던 2026-10-01 전후) 그 행을 그대로 쓴다.
  // 같은 기간 행이 둘이면 정식 id → 결과가 적힌 쪽 순으로 고른다.
  const weekIdFor = (y: number, m: number, w: number, list: OkrCycle[] = cyclesRef.current, ids: Set<string> = resultIds): string => {
    const fresh = weekCycleId(y, m, w);
    const wk = okrWeeksInMonth(y, m).find((x) => x.weekNo === w);
    const same = wk ? list.filter((c) => c.kind === "week" && c.start_date === wk.start) : [];
    if (!same.length) return fresh;
    return (same.find((c) => c.id === fresh) || same.find((c) => ids.has(c.id)) || same[0]).id;
  };
  const cycleId = cycle?.id || (weekNo ? weekIdFor(year, month, weekNo, cycles) : monthCycleId(year, month));
  const stateRef = useRef({ cycle, reports, goalSrc });
  useEffect(() => { stateRef.current = { cycle, reports, goalSrc }; }, [cycle, reports, goalSrc]);
  const saveSeqRef = useRef(0); // 저장이 끝날 때마다 +1 — 그 전에 시작한 동기화 읽기는 버린다(옛 값으로 되돌아가지 않게)
  // 디바운스 대기 중인 저장 — 달·주차를 바꾸거나 화면을 나갈 때 잃지 않도록 즉시 저장(flush)한다. 달 → 주차 → 기록 순(외래키)
  const pendingCyclesRef = useRef<OkrCycle[]>([]);
  const pendingReportsRef = useRef<OkrReport[]>([]);
  const flushPending = async () => {
    const cs = pendingCyclesRef.current; pendingCyclesRef.current = [];
    const rs = pendingReportsRef.current; pendingReportsRef.current = [];
    for (const c of cs) await saveOkrCycle(c, author).catch(() => undefined);
    for (const r of rs) await saveOkrReport(r, author).catch(() => undefined);
  };
  useEffect(() => () => { void flushPending(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 언마운트 시 1회

  const rosterOf = (team: OkrTeam): string[] => book[team] || [];
  // 파트 탭을 바꾸면: 내가 그 파트 팀원이면 내 박스, 아니면 파트 종합
  const openTeam = (team: Tab) => { setTab(team); setMember(team !== "all" && rosterOf(team).includes(author) ? author : ""); };

  const rkey = (r: Pick<OkrReport, "cycle_id" | "team" | "member">) => `${r.cycle_id}|${reportKey(r)}`;
  const csig = (c: OkrCycle | undefined) => (c ? sig(c) : "");
  const rsig = (r: OkrReport | undefined) => (r ? repSig(r) : "");
  const rememberSaved = (saved: OkrCycle) => {
    setCycles((cur) => (cur.some((c) => c.id === saved.id) ? cur.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...cur]));
    cyclesRef.current = cyclesRef.current.some((c) => c.id === saved.id) ? cyclesRef.current.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...cyclesRef.current];
  };
  const monthDraft = (y: number, m: number, list: OkrCycle[]): OkrCycle => {
    const start = `${y}-${pad(m)}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const previous = list.filter((c) => c.kind === "month" && c.start_date < start).sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
    const draft: OkrCycle = { id: monthCycleId(y, m), kind: "month", title: "", year: y, month: m, week_no: null, start_date: start, end_date: `${y}-${pad(m)}-${pad(lastDay)}`, parent_id: null, goals: previous ? previous.goals.map((g) => ({ ...g })) : defaultGoalTemplate(), feedback: {} };
    draft.title = defaultCycleTitle(draft);
    return draft;
  };
  const weekDraft = (y: number, m: number, w: number): OkrCycle => {
    const wk = okrWeeksInMonth(y, m).find((x) => x.weekNo === w) || { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-01` };
    const draft: OkrCycle = { id: weekCycleId(y, m, w), kind: "week", title: "", year: y, month: m, week_no: w, start_date: wk.start, end_date: wk.end, parent_id: monthCycleId(y, m), goals: [], feedback: {} };
    draft.title = defaultCycleTitle(draft);
    return draft;
  };

  // 달·주차 열기 — 항상 서버에서 새로 읽는다(처음 받은 목록만 믿고 초안을 만들면 남이 그 사이 만든 달을 초안으로 덮어썼다).
  // 없으면 초안: 달은 가장 최근 지난달 목표를 복사, 주차는 달의 목표를 그대로 쓴다(무언가 적는 순간 저장).
  // effect가 아니라 핸들러에서 한다: 자동 저장 뒤 목록이 갱신될 때 결과를 다시 읽어 입력 중인 값을 덮어쓰는 일이 없다.
  const openTokenRef = useRef(0);
  const openCycle = (y: number, m: number, w: number | null) => {
    void flushPending();
    setYear(y); setMonth(m); setWeekNo(w);
    const id = w ? weekIdFor(y, m, w) : monthCycleId(y, m);
    const mid = monthCycleId(y, m);
    const token = ++openTokenRef.current;
    setLoading(true);
    void (async () => {
      try {
        const [found, rows, mc] = await Promise.all([getOkrCycle(id), getOkrReports(id), w ? getOkrCycle(mid) : Promise.resolve(null)]);
        if (token !== openTokenRef.current) return;
        const list = cyclesRef.current;
        let c = found || (w ? weekDraft(y, m, w) : monthDraft(y, m, list));
        if (found && w) { // 옛 셈법으로 만든 주차 행(id·제목은 그대로)의 달·주차·날짜 표기를 새 셈법에 맞춘다 — 저장은 자동 저장이 한다(2026-10-01)
          const fresh = weekDraft(y, m, w);
          if (found.start_date !== fresh.start_date || found.end_date !== fresh.end_date || found.year !== y || found.month !== m || found.week_no !== w) {
            c = { ...found, year: y, month: m, week_no: w, start_date: fresh.start_date, end_date: fresh.end_date, title: found.title === defaultCycleTitle(found) || !found.title ? fresh.title : found.title };
          }
        }
        cycleBaseRef.current = { [c.id]: c };
        reportBaseRef.current = Object.fromEntries(rows.map((r) => [rkey(r), r]));
        if (w) {
          const gc = mc || monthDraft(y, m, list);
          cycleBaseRef.current[gc.id] = gc;
          setGoalSrc({ cycle: gc });
          if (mc) rememberSaved(mc);
        } else setGoalSrc(null);
        if (found) rememberSaved(found);
        setCycle(c);
        setReports(rows);
        loadedCycleRef.current = id;
        setSaveStatus("idle");
        setSyncedAt(kstClock());
      } catch (e) { if (token === openTokenRef.current) setMessage((e as Error).message); }
      finally { if (token === openTokenRef.current) setLoading(false); }
    })();
  };
  // 달을 고르면 어느 주차를 열지 — 이번 달이면 이번 주, 아니면 결과가 있는 마지막 주차, 없으면 달 단위 옛 기록이 있을 때만 그것, 아니면 1주차
  const openMonthDefault = (y: number, m: number, ids: Set<string> = resultIds) => {
    if (thisWeek.year === y && thisWeek.month === m) { openCycle(y, m, thisWeek.weekNo); return; }
    const withData = okrWeeksInMonth(y, m).filter((w) => ids.has(weekIdFor(y, m, w.weekNo, cyclesRef.current, ids)));
    if (withData.length) { openCycle(y, m, withData[withData.length - 1].weekNo); return; }
    openCycle(y, m, ids.has(monthCycleId(y, m)) && monthCycleId(y, m) <= MONTH_VIEW_UNTIL ? null : 1);
  };
  useEffect(() => {
    Promise.all([listOkrCycles(), listOkrResultIndex().catch(() => new Set<string>())])
      .then(([list, ids]) => { setCycles(list); cyclesRef.current = list; setResultIds(ids); setTableMissing(false); openMonthDefault(thisWeek.year, thisWeek.month, ids); })
      .catch((e) => { const msg = (e as Error).message || ""; if (/okr_cycles|relation|404|schema cache/i.test(msg)) setTableMissing(true); setMessage(msg); setLoading(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 처음 한 번

  // 달·주차 행이 서버에 있게 — 주차 결과를 저장하려면 달(부모) → 주차 순으로 행이 있어야 한다(외래키)
  const ensureCycle = async (c: OkrCycle) => {
    if (cyclesRef.current.some((x) => x.id === c.id)) return;
    if (c.parent_id) { const parent = stateRef.current.goalSrc?.cycle; if (parent && parent.id === c.parent_id) await ensureCycle(parent); }
    await saveOkrCycle(c, author);
    cycleBaseRef.current[c.id] = c;
    rememberSaved(c);
  };
  const cycleById = (id: string): OkrCycle | null => { const st = stateRef.current; return st.cycle?.id === id ? st.cycle : st.goalSrc?.cycle.id === id ? st.goalSrc.cycle : null; };
  // 저장 결과를 화면에 — 저장하는 사이 더 적은 글(from → 지금)은 지키고, 남이 고친 칸은 반영
  const applyCycle = (merged: OkrCycle, from: OkrCycle) => {
    setCycle((cur) => (cur && cur.id === merged.id ? mergeCycle(from, cur, merged) : cur));
    setGoalSrc((cur) => (cur && cur.cycle.id === merged.id ? { ...cur, cycle: mergeCycle(from, cur.cycle, merged) } : cur));
  };
  const applyReport = (merged: OkrReport, from: OkrReport) => {
    const key = rkey(merged);
    const fix = (list: OkrReport[]) => list.map((r) => (rkey(r) === key ? mergeReport(from, r, merged) : r));
    setReports(fix);
  };
  const persistCycle = async (local: OkrCycle) => {
    if (local.parent_id) { const parent = cycleById(local.parent_id); if (parent) await ensureCycle(parent); }
    const base = cycleBaseRef.current[local.id] || local;
    const server = await getOkrCycle(local.id).catch(() => null);
    const merged = server && sig(server) !== sig(base) && sig(server) !== sig(local) ? mergeCycle(base, local, server) : local;
    await saveOkrCycle(merged, author);
    cycleBaseRef.current[local.id] = merged;
    saveSeqRef.current += 1;
    rememberSaved(merged);
    if (merged !== local) applyCycle(merged, local);
  };
  const persistReport = async (local: OkrReport) => {
    const owner = cycleById(local.cycle_id); if (owner) await ensureCycle(owner);
    const key = rkey(local);
    const base = reportBaseRef.current[key] || emptyReport(local.cycle_id, local.team, local.member);
    const server = await getOkrReport(local.cycle_id, local.team, local.member).catch(() => null);
    const merged = server && repSig(server) !== repSig(base) && repSig(server) !== repSig(local) ? mergeReport(base, local, server) : local;
    await saveOkrReport(merged, author);
    reportBaseRef.current[key] = merged;
    saveSeqRef.current += 1;
    if (hasResultRows(merged.rows)) setResultIds((cur) => (cur.has(merged.cycle_id) ? cur : new Set(cur).add(merged.cycle_id)));
    if (merged !== local) applyReport(merged, local);
  };
  // 자동 저장(0.7초 디바운스) — 바뀐 달·주차·기록만. 아직 서버에 없는 달·주차(초안)는 기록보다 먼저 만든다.
  useEffect(() => {
    if (!cycle || loading || loadedCycleRef.current !== cycle.id) return;
    const owned = [...(goalSrc ? [goalSrc.cycle] : []), cycle];
    const dirtyCycles = owned.filter((c) => sig(c) !== csig(cycleBaseRef.current[c.id]));
    const dirtyReports = reports.filter((r) => repSig(r) !== rsig(reportBaseRef.current[rkey(r)]));
    if (!dirtyCycles.length && !dirtyReports.length) return;
    const drafts = dirtyReports.length ? owned.filter((c) => !cyclesRef.current.some((x) => x.id === c.id) && !dirtyCycles.includes(c)) : [];
    pendingCyclesRef.current = [...drafts, ...dirtyCycles]; pendingReportsRef.current = dirtyReports;
    const timer = window.setTimeout(async () => {
      pendingCyclesRef.current = []; pendingReportsRef.current = [];
      try {
        for (const c of dirtyCycles) await persistCycle(c);
        for (const r of dirtyReports) await persistReport(r);
        setSaveStatus("saved");
      } catch (e) { setSaveStatus("error"); setMessage((e as Error).message); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [cycle, reports, goalSrc, author, loading]); // eslint-disable-line react-hooks/exhaustive-deps -- persist* 는 ref 기반

  // 동기화 — 15초마다, 창이 다시 보일 때: 내가 고치지 않은 것은 서버 값으로 바꾼다(남이 적은 결과·고친 목표가 보이게, 2026-09-29 요청).
  // 고치는 중인 것은 그대로 두고 저장 때 합친다(persist*).
  useEffect(() => {
    if (loading || !cycle) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const { cycle: c0, goalSrc: g0 } = stateRef.current; if (!c0) return;
      const token = openTokenRef.current; const seq = saveSeqRef.current;
      try {
        const [srvC, srvRows, srvG] = await Promise.all([getOkrCycle(c0.id), getOkrReports(c0.id), g0 ? getOkrCycle(g0.cycle.id) : Promise.resolve(null)]);
        if (stopped || token !== openTokenRef.current || seq !== saveSeqRef.current || pendingCyclesRef.current.length || pendingReportsRef.current.length) return;
        const takeCycle = (cur: OkrCycle, srv: OkrCycle | null) => {
          if (!srv || sig(cur) !== csig(cycleBaseRef.current[cur.id]) || sig(srv) === sig(cur)) return cur;
          cycleBaseRef.current[cur.id] = srv; return srv;
        };
        const takeRows = (cur: OkrReport[], srv: OkrReport[]) => {
          const out = cur.map((r) => {
            const sv = srv.find((x) => rkey(x) === rkey(r));
            if (!sv || repSig(r) !== rsig(reportBaseRef.current[rkey(r)]) || repSig(sv) === repSig(r)) return r;
            reportBaseRef.current[rkey(r)] = sv; return sv;
          });
          for (const sv of srv) if (!cur.some((r) => rkey(r) === rkey(sv))) { reportBaseRef.current[rkey(sv)] = sv; out.push(sv); }
          return out;
        };
        setCycle((cur) => (cur ? takeCycle(cur, srvC) : cur));
        setReports((cur) => takeRows(cur, srvRows));
        if (g0) setGoalSrc((cur) => (cur ? { cycle: takeCycle(cur.cycle, srvG) } : cur));
        if (srvC) rememberSaved(srvC);
        setSyncedAt(kstClock());
      } catch { /* 다음 틱에 다시 */ }
    };
    const iv = window.setInterval(() => void tick(), 15_000);
    const onShow = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onShow); window.addEventListener("focus", onShow);
    return () => { stopped = true; window.clearInterval(iv); document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", onShow); };
  }, [loading, cycle?.id, goalSrc?.cycle.id]); // eslint-disable-line react-hooks/exhaustive-deps -- 나머지는 ref로 읽는다

  const goalCycle = goalSrc ? goalSrc.cycle : cycle; // 목표·달성기준의 출처(달)
  const commonGoals = goalCycle?.goals || [];
  const partOf = (team: OkrTeam) => findReport(reports, team, "");
  // 보이는 목표: 공통(달) → 파트 종합의 달성기준 덮어쓰기(이 주차 기록) → 개인의 덮어쓰기. 목표·Pillar·병목은 늘 공통.
  const teamGoalsOf = (team: OkrTeam): OkrGoal[] => overlayCriteria(commonGoals, partOf(team)?.goals);
  const personGoalsOf = (team: OkrTeam, who: string): OkrGoal[] => (!who || who === "__sum__" ? teamGoalsOf(team) : overlayCriteria(teamGoalsOf(team), findReport(reports, team, who)?.goals));
  const updateCycle = (patch: Partial<OkrCycle>) => { setSaveStatus("saving"); setCycle((cur) => (cur ? { ...cur, ...patch } : cur)); };
  // 목표 쪽 편집은 달에 — 주차를 열어 두었으면 goalSrc(달)로 간다
  const updateGoalCycle = (patch: Partial<OkrCycle>) => { setSaveStatus("saving"); if (goalSrc) setGoalSrc((cur) => (cur ? { ...cur, cycle: { ...cur.cycle, ...patch } } : cur)); else setCycle((cur) => (cur ? { ...cur, ...patch } : cur)); };
  const setFeedback = (no: number, memo: string, memoHtml?: string) => updateCycle({ feedback: { ...(cycle?.feedback || {}), [String(no)]: { ...(cycle?.feedback?.[String(no)] || { memo: "" }), memo, memoHtml } } });
  const upsertInto = (list: OkrReport[], cid: string, team: string, who: string, fn: (r: OkrReport) => OkrReport) => {
    const exists = list.some((r) => r.team === team && (r.member || "") === who);
    const base = exists ? list : [...list, emptyReport(cid, team, who)];
    return base.map((r) => (r.team === team && (r.member || "") === who ? fn(r) : r));
  };
  const patchReport = (team: string, who: string, fn: (r: OkrReport) => OkrReport) => { setSaveStatus("saving"); setReports((cur) => upsertInto(cur, cycleId, team, who, fn)); };
  // 달성기준 고치기 — 파트 종합이면 파트 기록, 팀원이면 그 사람 기록에 그 번호만(header.goals). 파트 것은 팀원에게 흐르고, 팀원 것은 파트로 올라가지 않는다.
  const setCriteria = (team: OkrTeam, who: string, no: number, criteria: string, html?: string) => {
    const scope = who && who !== "__sum__" ? who : "";
    const shown = personGoalsOf(team, scope).find((g) => g.no === no) || emptyGoal(no);
    patchReport(team, scope, (r) => ({ ...r, goals: putCriteria(r.goals, [{ ...shown, criteria, html: html ? { criteria: html } : undefined }]) }));
  };
  // 전주(또는 지난달 마지막 주) 기간 id — 월 종합(옛 기록)을 보고 있으면 지난달
  const prevCycleId = ((): string | null => {
    const pm = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    if (!weekNo) return monthCycleId(pm.y, pm.m);
    if (weekNo > 1) return weekIdFor(year, month, weekNo - 1, cycles);
    const ws = okrWeeksInMonth(pm.y, pm.m);
    return ws.length ? weekIdFor(pm.y, pm.m, ws[ws.length - 1].weekNo, cycles) : null;
  })();
  const prevCycleLabel = prevCycleId ? (prevCycleId.includes("-W") ? `${Number(prevCycleId.slice(5, 7))}월 ${prevCycleId.split("W")[1]}주차` : `${Number(prevCycleId.slice(5, 7))}월`) : "";
  // 전주 달성기준 불러오기(2026-10-01): 전주에 이 칸(파트 종합이면 파트, 팀원이면 그 사람)에 보이던 달성기준을 그대로 전부 가져온다(빈 칸만 제외).
  const loadPrevCriteria = async (team: OkrTeam, who: string) => {
    if (!prevCycleId || !goalCycle) return;
    const scope = who && who !== "__sum__" ? who : "";
    try {
      const prevMonthId = prevCycleId.slice(0, 7);
      const [prevRows, prevMonth] = await Promise.all([getOkrReports(prevCycleId), prevMonthId === goalCycle.id ? Promise.resolve(goalCycle) : getOkrCycle(prevMonthId)]);
      const prevTeam = overlayCriteria(prevMonth?.goals || [], findReport(prevRows, team, "")?.goals);
      const prevEffective = scope ? overlayCriteria(prevTeam, findReport(prevRows, team, scope)?.goals) : prevTeam;
      const entries = prevEffective.filter((g) => g.criteria.trim()).map((g) => ({ ...g, html: g.html?.criteria ? { criteria: g.html.criteria } : undefined }));
      if (!entries.length) { setMessage(`${prevCycleLabel}에 적힌 달성기준이 없어요`); return; }
      const mine = findReport(reports, team, scope)?.goals?.length || 0;
      if (mine && !(await askConfirm(`이 주차의 달성기준을 ${prevCycleLabel} 것(${entries.length}개)으로 바꿉니다. 결과·판정은 그대로 둡니다.`, { okLabel: "가져오기" }))) return;
      patchReport(team, scope, (r) => ({ ...r, goals: putCriteria(r.goals, entries) }));
      setMessage(`${prevCycleLabel} 달성기준 ${entries.length}개를 그대로 가져왔어요 — 바뀐 부분만 고치면 됩니다`);
    } catch (e) { setMessage(`불러오기 실패: ${(e as Error).message}`); }
  };
  // 전주 실제결과 불러오기(2026-10-08): 전주에 이 칸(파트 종합/팀원)에 적힌 실제결과·판정·사유·개선계획·근거를 그대로 가져온다 — 이어지는 일을 다시 안 적게
  const loadPrevResults = async (team: OkrTeam, who: string) => {
    if (!prevCycleId) return;
    const scope = who && who !== "__sum__" ? who : "";
    try {
      const prevRows = await getOkrReports(prevCycleId);
      const prev = findReport(prevRows, team, scope);
      const filled = (r: OkrResultRow) => Boolean(r.actual.trim() || r.judgment || r.reason.trim() || r.plan.trim() || r.evidence.trim());
      const entries = (prev?.rows || []).filter(filled);
      if (!entries.length) { setMessage(`${prevCycleLabel}에 적힌 실제결과가 없어요`); return; }
      const mineFilled = (findReport(reports, team, scope)?.rows || []).filter(filled).length;
      if (mineFilled && !(await askConfirm(`이 주차의 실제결과 ${mineFilled}칸을 ${prevCycleLabel} 것(${entries.length}칸)으로 덮어씁니다. 달성기준은 그대로 둡니다.`, { okLabel: "가져오기" }))) return;
      patchReport(team, scope, (r) => ({ ...r, rows: [...entries.map((e) => ({ ...e })), ...r.rows.filter((x) => !entries.some((e) => e.no === x.no))].sort((a, b) => a.no - b.no) }));
      setMessage(`${prevCycleLabel} 실제결과 ${entries.length}칸을 그대로 가져왔어요 — 이번 주에 달라진 부분만 고치면 됩니다`);
    } catch (e) { setMessage(`불러오기 실패: ${(e as Error).message}`); }
  };
  const updateResult = (team: string, who: string, no: number, patch: Partial<OkrResultRow>) => patchReport(team, who, (r) => {
    const has = r.rows.some((x) => x.no === no);
    const rows = has ? r.rows.map((x) => (x.no === no ? { ...x, ...patch } : x)) : [...r.rows, { ...emptyResultRow(no), ...patch }];
    return { ...r, rows: rows.sort((a, b) => a.no - b.no) };
  });

  // 목표 편집(통합집계만, 2026-10-01 사용자): 목표·Pillar·병목 구조는 달의 공통 하나 — 파트·팀원에게 같은 것이 보인다. 분기 안에서는 달마다 같은 목표.
  // 번호가 바뀌면(삽입·삭제) 이 달의 기록 전부(달·주차, 파트·팀원)의 결과 행·달성기준 칸을 같이 옮긴다 — 서버에 바로 쓰고 다시 읽는다.
  const goalOps: GoalOps = (() => {
    const current = commonGoals;
    const write = (next: OkrGoal[]) => updateGoalCycle({ goals: next });
    const reorder = async (next: OkrGoal[], remap: Map<number, number>) => {
      if (!goalCycle || !cycle) return;
      setSaveStatus("saving"); setLoading(true);
      try {
        await flushPending();
        const renumbered = renumberGoals(next);
        await ensureCycle(goalCycle);
        if (cycle.id !== goalCycle.id) await ensureCycle(cycle);
        await saveOkrCycle({ ...goalCycle, goals: renumbered, feedback: remapFeedback(goalCycle.feedback || {}, remap) }, author);
        const ids = Array.from(new Set([goalCycle.id, cycle.id, ...cyclesRef.current.filter((c) => c.year === goalCycle.year && c.month === goalCycle.month).map((c) => c.id)]));
        for (const id of ids) {
          const c = id === cycle.id ? cycle : cyclesRef.current.find((x) => x.id === id);
          if (c && c.kind === "week") await saveOkrCycle({ ...c, feedback: remapFeedback(c.feedback || {}, remap) }, author);
          const rows = await getOkrReports(id);
          const moved = remapReports(rows, remap);
          await Promise.all(moved.filter((r, i) => repSig(r) !== repSig(rows[i])).map((r) => saveOkrReport(r, author)));
        }
        saveSeqRef.current += 1;
        openCycle(year, month, weekNo);
      } catch (e) { setLoading(false); setSaveStatus("error"); setMessage((e as Error).message); }
    };
    return {
      onGoal: (no, patch) => write(current.map((g) => (g.no === no ? { ...g, ...patch } : g))),
      onPillar: (nos, idx) => { void (async () => {
        const from = pillarIndex(current.find((g) => nos.includes(g.no))?.pillar || "");
        if (from === idx) return;
        const ok = await askConfirm(`${from >= 0 ? `Pillar ${from + 1} · ${OKR_PILLARS[from].label}` : "Pillar 미정"} 묶음의 병목 ${nos.length}개를 ${idx >= 0 ? `Pillar ${idx + 1} · ${OKR_PILLARS[idx].label}` : "Pillar 미정"}으로 옮길까요?`, { okLabel: "옮기기" });
        if (ok) write(current.map((g) => (nos.includes(g.no) ? { ...g, pillar: idx >= 0 ? OKR_PILLARS[idx].full : "" } : g)));
      })(); },
      onInsert: (afterNo, pillarFull) => {
        const at = current.findIndex((g) => g.no === afterNo);
        void reorder([...current.slice(0, at + 1), { ...emptyGoal(0), pillar: pillarFull }, ...current.slice(at + 1)], new Map(current.map((g) => [g.no, g.no <= afterNo ? g.no : g.no + 1])));
      },
      onRemove: (goal) => { void (async () => {
        const affected = reports.filter((r) => { const row = resultRowFor(r, goal.no); return row.actual || row.judgment; }).map((r) => `${teamName(r.team)}${r.member ? ` ${r.member}` : ""}`);
        const ok = await askConfirm(`${pillarLabel(goal.pillar)} ${shortBottleneck(current, goal.no)} 목표를 삭제할까요?${affected.length ? `\n\n이미 결과를 적은 곳: ${affected.join(", ")} — 그 결과도 함께 지워집니다.` : ""}${weekNo ? "\n(이 달의 다른 주차 기록도 같은 번호가 지워집니다)" : ""}`, { danger: true, okLabel: "삭제" });
        if (!ok) return;
        const remaining = current.filter((g) => g.no !== goal.no);
        await reorder(remaining, new Map(remaining.map((g, i) => [g.no, i + 1])));
      })(); },
    };
  })();
  const copyGoalsFrom = async (sourceId: string) => {
    const src = cycles.find((c) => c.id === sourceId);
    if (!src || !goalCycle) return;
    if (commonGoals.some((g) => g.objective.trim()) && !(await askConfirm(`${cycleLabel(goalCycle)}의 목표·달성기준 ${commonGoals.length}개를 ${cycleLabel(src)} 것으로 바꿀까요?\n(파트·팀원이 적은 결과는 그대로 두고, 같은 번호끼리 이어집니다)`, { okLabel: "가져오기" }))) return;
    updateGoalCycle({ goals: src.goals.map((g) => ({ ...g })) });
    setMessage(`${cycleLabel(src)} 목표 ${src.goals.length}개를 가져왔어요 — 바뀐 부분만 고치면 됩니다`);
  };
  // [전분기/지난달 목표 불러오기]의 출처 — 이 달보다 앞선 달 중 목표가 적힌 가장 최근 달
  const prevGoalSource = useMemo(() => cycles.filter((c) => c.kind === "month" && c.id < monthCycleId(year, month) && c.goals.some((g) => g.objective.trim())).sort((a, b) => (a.id < b.id ? 1 : -1))[0] || null, [cycles, year, month]);

  const monthLabel = cycle ? cycleLabel(cycle) : "";
  const goalPayload = (g: OkrGoal) => ({ no: g.no, pillar: pillarLabel(g.pillar), objective: g.objective, criteria: g.criteria });
  const goalNameIn = (goals: OkrGoal[], no: number) => { const g = goals.find((x) => x.no === no); return g ? `${pillarLabel(g.pillar)} ${shortBottleneck(goals, no)}` : `${no}번`; };

  const setTeamFeedback = (team: OkrTeam, no: number, memo: string, memoHtml?: string) => patchReport(team, "", (r) => ({ ...r, feedback: { ...(r.feedback || {}), [String(no)]: { ...(r.feedback?.[String(no)] || { memo: "" }), memo, memoHtml } } }));
  // ✨ 팀원 결과 → 파트장 피드백 초안(통합집계의 초안과 같은 틀, 대상이 파트가 아니라 팀원)
  const aiTeamFeedback = async (team: OkrTeam, no: number) => {
    const goals = teamGoalsOf(team);
    const goal = goals.find((g) => g.no === no); if (!goal) return;
    const rows = memberReports(reports, team).map((m) => ({ team: m.member, ...resultRowFor(m, no) })).filter((t) => t.actual.trim() || t.judgment);
    if (!rows.length) { setMessage(`${goalNameIn(goals, no)}에 팀원 결과가 아직 없어요.`); return; }
    const existing = partOf(team)?.feedback?.[String(no)]?.memo || "";
    if (existing.trim() && !(await askConfirm(`${goalNameIn(goals, no)} 피드백 칸에 이미 글이 있어요. 초안으로 바꿀까요?`, { okLabel: "바꾸기" }))) return;
    const key = `tfb|${team}|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "feedback", month: monthLabel, goal: goalPayload(goal), teams: rows.map(({ team: name, actual, judgment, reason, plan, evidence }) => ({ team: name, actual, judgment, reason, plan, evidence })) });
      if (res.memo) { setTeamFeedback(team, no, res.memo, undefined); setMessage("피드백 초안을 넣었어요 — 파트장 말로 다듬어 주세요"); }
    } catch (e) { setMessage(`초안 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };

  // 팀원 기록 삭제(박스 ×) — 명단에 있는 사람은 박스는 남고 이 달(주차) 기록만 지워진다
  const removeMember = async (team: OkrTeam, name: string) => {
    const rec = findReport(reports, team, name);
    const filled = rec ? rec.rows.filter((x) => x.actual || x.judgment).length : 0;
    const inRoster = rosterOf(team).includes(name);
    const ok = await askConfirm(`${name}의 ${monthLabel} ${teamName(team)} 기록을 지울까요?${filled ? `\n적힌 목표 ${filled}개가 지워지며 되돌릴 수 없습니다.` : ""}${inRoster ? "\n(인원 명단에 있는 사람이라 박스는 남습니다 — 명단에서 빼려면 관리 › 인원)" : ""}`, { danger: true, okLabel: "지우기" });
    if (!ok) return;
    try {
      if (rec) await deleteOkrReport(cycleId, team, name);
      setReports((cur) => cur.filter((r) => !(r.team === team && r.member === name)));
      delete reportBaseRef.current[rkey({ cycle_id: cycleId, team, member: name })];
      if (member === name) setMember("");
      setMessage(`${name} 기록을 지웠어요`);
    } catch (e) { setMessage((e as Error).message); }
  };

  // (2026-10-01) 주차 셈법 전환 때 옛 번호 행을 옮기던 [주차 기록 정리] 단추는 사용자가 한 번 실행한 뒤 걷어냈다 — 서버 기록은 모두 새 번호(9월 4주차 등)에 있다.

  // 팀원들이 적은 실제결과를 파트 종합 칸으로 — 비어 있으면 넣고, 있으면 뒤에 덧붙인다. 종합판정이 비어 있으면 팀원 판정 중 가장 나쁜 것을 넣는다.
  const mergeMembers = async (team: OkrTeam, no: number) => {
    const goals = teamGoalsOf(team);
    const members = memberReports(reports, team);
    const merged = mergeMemberActuals(members, no);
    if (!merged) { setMessage(`${goalNameIn(goals, no)}에 팀원이 적은 실제결과가 아직 없어요.`); return; }
    const part = resultRowFor(partOf(team), no);
    if (part.actual.trim() && !(await askConfirm(`${goalNameIn(goals, no)} 종합 실제결과에 이미 내용이 있어요. 팀원 기록을 그 뒤에 덧붙일까요?`, { okLabel: "덧붙이기" }))) return;
    const judgment = part.judgment || worstOfJudgments(members.map((m) => resultRowFor(m, no).judgment));
    updateResult(team, "", no, { actual: part.actual.trim() ? `${part.actual.trimEnd()}\n${merged}` : merged, judgment, html: clearHtml(part, ["actual"]) });
  };
  // ✨ 메모 → 양식. 실제결과·종합판정은 바꾸고, 사유·개선계획·근거자료는 비어 있는 칸만 채운다.
  const aiFormat = async (team: OkrTeam, who: string, no: number) => {
    const goals = teamGoalsOf(team);
    const goal = goals.find((g) => g.no === no); if (!goal) return;
    const row = resultRowFor(findReport(reports, team, who), no);
    if (!row.actual.trim()) { setMessage("실제결과 칸에 한 일을 대충이라도 적은 뒤 ✨정리를 누르세요 (예: 계약서 8건 중 5건 확인, 3건은 카톡만 보냄)"); return; }
    const key = `fmt|${team}|${who}|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "format", month: monthLabel, goal: goalPayload(goal), text: row.actual, reason: row.reason, plan: row.plan, evidence: row.evidence });
      const filled: RichField[] = ["actual", ...(["reason", "plan", "evidence"] as RichField[]).filter((f) => !row[f].trim() && res[f])];
      updateResult(team, who, no, {
        actual: res.actual || row.actual, judgment: normalizeJudgment(res.judgment || "") || row.judgment,
        reason: row.reason.trim() ? row.reason : res.reason || "", plan: row.plan.trim() ? row.plan : res.plan || "", evidence: row.evidence.trim() ? row.evidence : res.evidence || "",
        html: clearHtml(row, filled),
      });
      setMessage("양식으로 정리했어요 — 숫자와 (수치 없음) 표시를 확인해 주세요");
    } catch (e) { setMessage(`정리 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };
  // ✨ 팀원 기록 → 파트 종합(건수 합산). 종합 칸을 통째로 바꾼다(있으면 확인).
  const aiMerge = async (team: OkrTeam, no: number) => {
    const goals = teamGoalsOf(team);
    const goal = goals.find((g) => g.no === no); if (!goal) return;
    const members = memberReports(reports, team).map((m) => ({ name: m.member, ...resultRowFor(m, no) })).filter((m) => m.actual.trim() || m.judgment);
    if (!members.length) { setMessage(`${goalNameIn(goals, no)}에 팀원 기록이 아직 없어요.`); return; }
    const part = resultRowFor(partOf(team), no);
    if ((part.actual.trim() || part.reason.trim()) && !(await askConfirm(`${goalNameIn(goals, no)} 종합 칸(실제결과·판정·사유·개선계획·근거자료)을 팀원 ${members.length}명 기록으로 다시 씁니다. 지금 내용은 덮어씁니다.`, { okLabel: "다시 쓰기" }))) return;
    const key = `mrg|${team}|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "merge", month: monthLabel, goal: goalPayload(goal), members: members.map(({ name, actual, judgment, reason, plan, evidence }) => ({ name, actual, judgment, reason, plan, evidence })) });
      updateResult(team, "", no, { actual: res.actual || part.actual, judgment: normalizeJudgment(res.judgment || "") || part.judgment, reason: res.reason || part.reason, plan: res.plan || part.plan, evidence: res.evidence || part.evidence, html: undefined });
      setMessage(`팀원 ${members.length}명 기록을 합쳐 종합 칸을 채웠어요 — 합산 건수를 확인해 주세요`);
    } catch (e) { setMessage(`합치기 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };
  // ✨ 파트 결과 → 팀장 피드백 초안(공통 목표 기준)
  const aiFeedback = async (no: number) => {
    const goal = commonGoals.find((g) => g.no === no); if (!goal) return;
    const teams = OKR_TEAMS.map((t) => ({ team: t, ...resultRowFor(partOf(t), no) })).filter((t) => t.actual.trim() || t.judgment);
    if (!teams.length) { setMessage(`${goalNameIn(commonGoals, no)}에 파트 결과가 아직 없어요.`); return; }
    const existing = cycle?.feedback?.[String(no)]?.memo || "";
    if (existing.trim() && !(await askConfirm(`${goalNameIn(commonGoals, no)} 피드백 칸에 이미 글이 있어요. 초안으로 바꿀까요?`, { okLabel: "바꾸기" }))) return;
    const key = `fb|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "feedback", month: monthLabel, goal: goalPayload(goal), teams: teams.map(({ team, actual, judgment, reason, plan, evidence }) => ({ team, actual, judgment, reason, plan, evidence })) });
      if (res.memo) { setFeedback(no, res.memo, undefined); setMessage("피드백 초안을 넣었어요 — 팀장님 말로 다듬어 주세요"); }
    } catch (e) { setMessage(`초안 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };

  const weeks = useMemo(() => okrWeeksInMonth(year, month), [year, month]);
  const showMonthTab = monthCycleId(year, month) <= MONTH_VIEW_UNTIL && (weekNo === null || resultIds.has(monthCycleId(year, month))); // '월 종합'은 주차로 나누기 전(9월까지) 달 단위 옛 기록이 있을 때만
  const years = useMemo(() => { const ys = new Set<number>([Number(today.slice(0, 4)), Number(today.slice(0, 4)) - 1, ...cycles.map((c) => c.year)]); return [...ys].sort((a, b) => b - a); }, [cycles, today]);
  const tabs: Array<[Tab, string]> = [["all", "통합집계"], ...OKR_TEAMS.map((t) => [t, teamName(t)] as [Tab, string])];
  const isDraft = !!cycle && !cycles.some((c) => c.id === cycle.id); // 아직 DB에 없는 달·주차(초안)

  if (!author) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">FIELD에서 작성자를 먼저 선택해 주세요.</div>;

  return <div className="space-y-4 pb-16">
    {(!cycle || tableMissing) && !loading && <div className="rounded-xl bg-[#1E252F] px-5 py-4 text-sm font-black text-white">OKR · {year}년 {month}월</div>}
    {tableMissing && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><b>OKR 표가 아직 없습니다.</b> Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>(표 만들기)을 한 번 실행한 뒤 이 화면을 다시 열어 주세요.</div>}
    {needsUpgrade && !tableMissing && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><b>OKR 표를 한 번 더 올려야 합니다.</b> 팀원별 기록 칸(member)이 없는 예전 표라 저장이 안 됩니다. Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>을 다시 실행하면(기존 내용은 그대로) 바로 됩니다.</div>}
    {message && !tableMissing && <div className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">{message}</div>}

    {cycle && goalCycle && !tableMissing && <>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#1E252F] px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-black tracking-tight text-white lg:text-xl">{cycle.title || defaultCycleTitle(cycle)}</h2>
              {isDraft && <p className="mt-1 text-[11px] font-semibold text-slate-400">{weekNo ? "아직 기록이 없는 주차 — 목표는 통합집계 것, 달성기준은 [전주 달성기준 불러오기]로 이어 쓸 수 있어요. 적는 순간 저장됩니다" : commonGoals.some((g) => g.objective) ? "아직 기록이 없는 달 — 지난달 목표를 그대로 가져왔습니다" : "아직 목표가 없는 달 — 표에서 바로 적어 주세요"}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-300">
              <PortalSelect tone="dark" width={110} value={String(year)} onChange={(v) => openMonthDefault(Number(v), month)} options={years.map((y) => ({ value: String(y), label: `${y}년` }))} />
              <MonthPicker value={month} current={thisWeek.year === year ? thisWeek.month : undefined} onChange={(m) => openMonthDefault(year, m)} />
              <div className="flex items-center gap-0.5 rounded-lg border border-white/15 bg-white/10 p-0.5">
                {showMonthTab && <button type="button" title="주차로 나누기 전 달 단위로 적은 옛 기록" onClick={() => openCycle(year, month, null)} className={`rounded-md px-2.5 py-1 text-[12px] font-bold transition ${!weekNo ? "bg-white text-slate-950" : "text-slate-300 hover:text-white"}`}>월 종합</button>}
                {weeks.map((w) => {
                  const isNow = thisWeek.year === year && thisWeek.month === month && thisWeek.weekNo === w.weekNo;
                  const edge = w.start.slice(0, 7) !== `${year}-${pad(month)}` ? " · 지난달 말부터 이어지는 주" : w.end.slice(0, 7) !== `${year}-${pad(month)}` ? " · 다음달 초까지 이어지는 주" : "";
                  return <button key={w.weekNo} type="button" title={`${w.start} ~ ${w.end}${isNow ? " · 이번 주" : ""}${edge}`} onClick={() => openCycle(year, month, w.weekNo)} className={`relative rounded-md px-2.5 py-1 text-[12px] font-bold tabular-nums transition ${weekNo === w.weekNo ? "bg-white text-slate-950" : isNow ? "text-white ring-1 ring-inset ring-emerald-400" : "text-slate-300 hover:text-white"}`}>
                    {w.weekNo}주{isNow && <span className={`ml-1 text-[9px] font-black ${weekNo === w.weekNo ? "text-emerald-600" : "text-emerald-400"}`}>이번주</span>}
                  </button>;
                })}
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1.5 tabular-nums">{cycle.start_date} ~ {cycle.end_date}</span>
              {saveStatus === "saving" && <span className="text-slate-400">저장 중…</span>}
              {saveStatus === "error" && <span className="text-rose-300">저장 실패</span>}
              {saveStatus !== "saving" && syncedAt && <span className="text-[11px] font-semibold text-slate-500" title="15초마다, 창을 다시 볼 때 다른 사람이 적은 내용을 가져옵니다">동기화 {syncedAt}</span>}            </div>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pt-2">
          {tabs.map(([key, label]) => {
            const rep = key === "all" ? undefined : findReport(reports, key, "");
            const goals = key === "all" ? commonGoals : teamGoalsOf(key);
            const rows = rep ? goals.map((g) => resultRowFor(rep, g.no)) : [];
            const judged = rows.filter((x) => normalizeJudgment(x.judgment)).length;
            const alerts = rows.filter((x) => isAlert(x.judgment)).length;
            return <button key={key} type="button" onClick={() => openTeam(key)} className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-black transition ${tab === key ? "border-slate-900 text-slate-950" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
              {label}{key !== "all" && goals.length > 0 && <span className="text-[11px] font-bold tabular-nums text-slate-400">{judged}/{goals.length}</span>}
              {alerts > 0 && <span className="text-[11px] font-bold text-rose-600">미흡 {alerts}</span>}
            </button>;
          })}
        </div>
      </section>

      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">불러오는 중…</div>
        : tab === "all"
          ? <SummaryView cycle={cycle} goals={commonGoals} goalsOf={teamGoalsOf} goalCycleId={goalCycle.id} cycles={cycles} reports={reports} aiBusy={aiBusy} prevSource={prevGoalSource} onFeedback={setFeedback} onAiFeedback={(no) => void aiFeedback(no)} onCopyGoals={(id) => void copyGoalsFrom(id)} onTemplate={() => updateGoalCycle({ goals: defaultGoalTemplate() })} {...goalOps} />
          : <TeamView team={tab} cycle={cycle} goals={personGoalsOf(tab, member)} reports={reports} member={member} onMember={setMember} onRemoveMember={(name) => void removeMember(tab, name)} roster={rosterOf(tab)} author={author} aiBusy={aiBusy}
              onHeader={(patch) => patchReport(tab, "", (r) => ({ ...r, header: { ...r.header, ...patch } }))}
              onResult={(no, patch) => updateResult(tab, member, no, patch)}
              onMerge={(no) => void mergeMembers(tab, no)} onAiMerge={(no) => void aiMerge(tab, no)} onAiFormat={(no) => void aiFormat(tab, member, no)}
              onTeamFeedback={(no, memo, memoHtml) => setTeamFeedback(tab, no, memo, memoHtml)} onAiTeamFeedback={(no) => void aiTeamFeedback(tab, no)}
              onCriteria={(no, text, html) => setCriteria(tab, member, no, text, html)} onLoadPrev={() => void loadPrevCriteria(tab, member)} onLoadPrevResults={() => void loadPrevResults(tab, member)} prevLabel={prevCycleLabel} />}
    </>}
  </div>;
}

const repSig = (r: OkrReport) => JSON.stringify({ header: r.header, rows: r.rows, goals: r.goals, feedback: r.feedback });

// ── 사람 박스(파트 종합 / 팀원) — 이름 · 판정 n/9 · 미흡 수. 팀원 박스는 고른 상태에서 ×로 기록 삭제 ──
function PersonBox({ label, sub, rows, total, selected, onClick, onRemove }: { label: string; sub?: string; rows: OkrResultRow[]; total: number; selected: boolean; onClick: () => void; onRemove?: () => void }) {
  const judged = rows.filter((r) => normalizeJudgment(r.judgment)).length;
  const alerts = rows.filter((r) => isAlert(r.judgment)).length;
  const pct = total ? Math.round((judged / total) * 100) : 0;
  return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }} className={`relative w-[128px] shrink-0 cursor-pointer rounded-lg border p-2.5 text-left transition ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}>
    <div className="flex items-baseline justify-between gap-1"><span className="truncate text-[13px] font-black">{label}</span><span className={`text-[11px] font-bold tabular-nums ${selected ? "text-slate-300" : "text-slate-400"}`}>{judged}/{total}</span></div>
    <div className="h-4 text-[10px] font-semibold text-slate-400">{alerts ? <span className={selected ? "text-rose-300" : "text-rose-600"}>미흡·미착수 {alerts}</span> : sub || ""}</div>
    <div className={`mt-1 h-1 overflow-hidden rounded-full ${selected ? "bg-white/20" : "bg-slate-100"}`}><div className={`h-full transition-all ${selected ? "bg-white" : "bg-slate-800"}`} style={{ width: `${pct}%` }} /></div>
    {onRemove && selected && <button type="button" title="이 사람의 이 달 기록 삭제" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-black text-slate-500 hover:border-rose-400 hover:text-rose-600">×</button>}
  </div>;
}

// ── 파트 시트: Pillar 막대 + 병목 1·2·3 행, 열 머리는 엑셀과 같게(No·Pillar 열은 막대로 대신), 격자 셀 ──
const COLS: Array<[string, number, "read" | "write"]> = [
  ["병목", 58, "read"], ["목표", 220, "read"], ["달성기준", 250, "read"],
  ["실제결과", 300, "write"], ["종합판정", 104, "write"], ["사유", 210, "write"], ["개선계획", 210, "write"], ["근거자료", 210, "write"],
];

function TeamView({ team, cycle, goals, reports, member, onMember, onRemoveMember, roster, author, aiBusy, onHeader, onResult, onMerge, onAiMerge, onAiFormat, onTeamFeedback, onAiTeamFeedback, onCriteria, onLoadPrev, onLoadPrevResults, prevLabel }: {
  team: OkrTeam; cycle: OkrCycle; goals: OkrGoal[]; reports: OkrReport[]; member: string; onMember: (m: string) => void; onRemoveMember: (name: string) => void; roster: string[]; author: string; aiBusy: string;
  onHeader: (patch: Partial<OkrReport["header"]>) => void; onResult: (no: number, patch: Partial<OkrResultRow>) => void; onMerge: (no: number) => void; onAiMerge: (no: number) => void; onAiFormat: (no: number) => void;
  onTeamFeedback: (no: number, memo: string, memoHtml?: string) => void; onAiTeamFeedback: (no: number) => void;
  onCriteria: (no: number, criteria: string, html?: string) => void; onLoadPrev: () => void; onLoadPrevResults: () => void; prevLabel: string;
}) {
  const partReport = findReport(reports, team, "") || emptyReport(cycle.id, team, "");
  const members = memberReports(reports, team);
  const memberNames = useMemo(() => { const seen = new Set<string>(); return [...roster, ...members.map((m) => m.member)].filter((n) => n && !seen.has(n) && seen.add(n)); }, [roster, members]);
  const current = member ? (findReport(reports, team, member) || emptyReport(cycle.id, team, member)) : partReport;
  // 목표·Pillar·병목은 통합집계에서만(여기선 파란 읽기 칸). 달성기준은 파트 종합·팀원이 각자 고친다(파트 것이 팀원의 기본, 팀원 것은 본인 칸에만)
  const [openMembers, setOpenMembers] = useState<Record<number, boolean>>({});
  const runs = pillarRuns(goals);
  const addOtherName = () => {
    const name = window.prompt("이 파트에 기록할 이름(관리 › 인원 명단에 없는 사람)");
    if (name && name.trim()) onMember(name.trim());
  };
  const rowsOf = (r: OkrReport | undefined) => goals.map((g) => resultRowFor(r, g.no));
  const col = useColWidths("okr_cols_team", COLS.map(([, w]) => w));
  const rich = (row: OkrResultRow, field: RichField, no: number, placeholder: string, extra = "") => <RichCell text={row[field]} html={row.html?.[field]} placeholder={placeholder} className={extra} minRows={3} onChange={(t, h) => onResult(no, { [field]: t, html: withHtml(row, field, h) })} />;

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    {/* 사람 박스 */}
    <div className="flex flex-wrap items-stretch gap-2 border-b border-slate-200 bg-slate-50 p-3">
      <PersonBox label="파트 종합" sub="통합집계에 반영" rows={rowsOf(partReport)} total={goals.length} selected={!member} onClick={() => onMember("")} />
      <div role="button" tabIndex={0} onClick={() => onMember("__sum__")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMember("__sum__"); } }} className={`w-[136px] shrink-0 cursor-pointer rounded-lg border p-2.5 text-left transition ${member === "__sum__" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}>
        <div className="text-[13px] font-black">팀원 집계</div>
        <div className="h-4 whitespace-nowrap text-[10px] font-semibold text-slate-400">{members.length}명 · 조치 필요 인원</div>
        <div className="mt-1 h-1" />
      </div>
      <span className="mx-0.5 hidden w-px self-stretch bg-slate-200 sm:block" />
      {memberNames.map((name) => <PersonBox key={name} label={name} sub={name === author ? "나" : ""} rows={rowsOf(findReport(reports, team, name))} total={goals.length} selected={member === name} onClick={() => onMember(name)} onRemove={() => onRemoveMember(name)} />)}
      <button type="button" onClick={addOtherName} className="w-[64px] shrink-0 rounded-lg border border-dashed border-slate-300 text-[11px] font-bold text-slate-400 hover:bg-white">＋ 이름</button>
      {!memberNames.length && <div className="self-center text-[11px] font-semibold text-slate-400">관리 › 인원 명단에 {teamName(team)} 인원을 넣으면 이름 박스가 생깁니다</div>}
    </div>
    {member === "__sum__" ? <TeamSummary team={team} goals={goals} names={memberNames} reports={reports} partReport={partReport} onMember={onMember} aiBusy={aiBusy} onFeedback={onTeamFeedback} onAiFeedback={onAiTeamFeedback} /> : <>
    {/* 달성기준 안내 + 전주 불러오기(2026-10-01) — 목표는 통합집계 하나, 달성기준은 이 주차 파트 종합 것이 팀원에게 기본으로 보이고 팀원이 고친 건 본인 칸에만 */}
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
      <span>{member ? `${member}의 달성기준 — 파트 종합 것이 기본으로 보이고, 여기서 고친 건 ${member} 칸에만 남습니다` : `${teamName(team)} 달성기준 — 여기서 고치면 팀원 모두에게 기본으로 보입니다 (목표는 통합집계에서만)`}</span>
      {prevLabel && <span className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onLoadPrev} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-100">↩ {prevLabel} 달성기준 불러오기</button>
        <button type="button" onClick={onLoadPrevResults} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-100">↩ {prevLabel} 실제결과 불러오기</button>
      </span>}
    </div>
    {/* 제출 정보 — 엑셀 머리 칸처럼(파트 종합에서만) */}
    {!member && <div className="grid grid-cols-2 border-b border-slate-200 text-[12px] lg:grid-cols-4">
      {([["leader", "파트장(부파트장)", "text"], ["author", "작성자", "text"], ["submitted", "제출일", "date"], ["headcount", "파트 인원수", "text"]] as Array<[keyof OkrReport["header"], string, string]>).map(([key, label, type], i) => <label key={key} className={`flex items-center gap-2 px-3 py-1.5 ${i < 3 ? "lg:border-r lg:border-slate-200" : ""} ${i % 2 === 0 ? "border-r border-slate-200" : ""}`}>
        <span className="w-[92px] shrink-0 text-[11px] font-bold text-slate-500">{label}</span>
        <input type={type} value={partReport.header[key]} onChange={(e) => onHeader({ [key]: e.target.value })} placeholder={key === "headcount" ? String(memberNames.length || "") : ""} className="min-w-0 flex-1 rounded bg-[#FFFBEB] px-2 py-1 text-[12px] font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-slate-400" />
      </label>)}
    </div>}

    <div className="overflow-x-auto">
      <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
        <colgroup>{COLS.map(([label], i) => <col key={label} style={{ width: col.widths[i] }} />)}</colgroup>
        <thead className="sticky top-0 z-10 text-[11px] font-bold">
          <tr>{COLS.map(([label, , mode], i) => <th key={label} className={`relative ${mode === "write" ? TH_WRITE : TH_READ}`}>{label}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr>
        </thead>
        <tbody>
          {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
            <PillarBar idx={run.idx} colSpan={COLS.length} editable={false} onPillar={() => undefined} onAdd={() => undefined} />
            {run.goals.map((goal) => {
              const row = resultRowFor(current, goal.no);
              const j = normalizeJudgment(row.judgment);
              const suggested = worstJudgment(row.actual);
              const alert = isAlert(row.judgment);
              const mustExplain = needsReasonPlan(row.judgment);
              const memberEntries = !member ? members.map((m) => ({ name: m.member, row: resultRowFor(m, goal.no) })).filter((x) => x.row.actual.trim() || x.row.judgment) : [];
              const open = !member && !!openMembers[goal.no];
              const fmtKey = `fmt|${team}|${member}|${goal.no}`;
              const mrgKey = `mrg|${team}|${goal.no}`;
              return <FragmentRows key={`${cycle.id}|${member}|${goal.no}`}>
                <tr>
                  <BottleneckCell goals={goals} goal={goal} alert={alert} alertTone={j === "미착수" ? "border-l-rose-500" : "border-l-orange-500"} editable={false} onRemove={() => undefined} />
                  <td className={TD_FIXED}><RichCell readOnly text={goal.objective} html={goal.html?.objective} minRows={2} className="font-semibold text-sky-950" /></td>
                  <td className={TD_EDIT}><RichCell text={goal.criteria} html={goal.html?.criteria} minRows={2} onChange={(t, h) => onCriteria(goal.no, t, h)} /></td>
                  <td className={TD_WRITE}>
                    {rich(row, "actual", goal.no, "")}
                    {SHOW_OKR_TOOLS && <div className="flex flex-wrap gap-x-3 px-2 pb-1 text-[10px] font-bold">
                      <button type="button" disabled={!!aiBusy} onClick={() => onAiFormat(goal.no)} className={LINK}>{aiBusy === fmtKey ? "정리 중…" : "✨ 정리"}</button>
                      {!member && members.length > 0 && <button type="button" onClick={() => setOpenMembers((cur) => ({ ...cur, [goal.no]: !open }))} className={LINK}>{open ? "팀원 기록 닫기" : `팀원 기록 ${memberEntries.length}`}</button>}
                      {!member && memberEntries.length > 0 && <>
                        <button type="button" disabled={!!aiBusy} onClick={() => onAiMerge(goal.no)} className={LINK}>{aiBusy === mrgKey ? "합치는 중…" : "✨ 합치기"}</button>
                        <button type="button" onClick={() => onMerge(goal.no)} className={LINK}>그대로 모아 넣기</button>
                      </>}
                    </div>}
                  </td>
                  <td className={`${TD} p-0 ${j ? JUDGMENT_INFO[j].tone : "bg-[#FFFBEB]"}`}>
                    <JudgmentPicker value={j} suggested={row.actual.trim() ? suggested : ""} onChange={(v) => onResult(goal.no, { judgment: v })} />
                    {suggested && suggested !== j && row.actual.trim() && <button type="button" onClick={() => onResult(goal.no, { judgment: suggested })} className="block w-full px-2 pb-1 text-left text-[10px] font-bold text-slate-500 hover:underline">→ {suggested}</button>}
                  </td>
                  <td className={`${TD_WRITE} ${mustExplain && !row.reason.trim() ? "!bg-rose-50" : ""}`}>{rich(row, "reason", goal.no, "")}</td>
                  <td className={`${TD_WRITE} ${mustExplain && !row.plan.trim() ? "!bg-rose-50" : ""}`}>{rich(row, "plan", goal.no, "")}</td>
                  <td className={TD_WRITE}>{rich(row, "evidence", goal.no, "")}</td>
                </tr>
                {open && <tr className="bg-slate-50">
                  <td colSpan={COLS.length} className={`${TD} px-3 py-2`}>
                    {memberEntries.length === 0 ? <div className="text-[11px] font-semibold text-slate-400">아직 아무도 적지 않았어요. 팀원은 위 이름 박스에서 자기 기록을 씁니다.</div>
                      : <table className="w-full border-collapse text-[11px]"><colgroup><col style={{ width: 80 }} /><col style={{ width: "32%" }} /><col style={{ width: 76 }} /><col /><col /><col /></colgroup>
                        <thead><tr className="text-[10px] font-bold text-slate-500">{["이름", "실제결과", "종합판정", "사유", "개선계획", "근거자료"].map((h) => <th key={h} className="border border-slate-200 bg-white px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
                        <tbody className="align-top">{memberEntries.map((x) => <tr key={x.name} className="bg-white"><td className="border border-slate-200 px-1.5 py-1 font-black text-slate-800"><button type="button" onClick={() => onMember(x.name)} className="hover:underline">{x.name}</button></td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-700">{x.row.actual}</td><td className="border border-slate-200 px-1.5 py-1"><JudgmentBadge value={x.row.judgment} /></td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.reason}</td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.plan}</td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.evidence}</td></tr>)}</tbody>
                      </table>}
                  </td>
                </tr>}
              </FragmentRows>;
            })}
          </FragmentRows>)}
          {goals.length === 0 && <tr><td colSpan={COLS.length} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다 — 통합집계에서 [3 × 3 빈 틀] 또는 [다른 달 목표 가져오기]</td></tr>}
        </tbody>
      </table>
    </div>
    </>}
  </section>;
}

// ── 팀원 집계: 통합집계와 같은 모양으로, 목표별 팀원 판정 · 조치 필요 인원(미흡·미착수) · 파트 종합판정 ──
function TeamSummary({ team, goals, names, reports, partReport, onMember, aiBusy, onFeedback, onAiFeedback }: { team: OkrTeam; goals: OkrGoal[]; names: string[]; reports: OkrReport[]; partReport: OkrReport; onMember: (m: string) => void; aiBusy: string; onFeedback: (no: number, memo: string, memoHtml?: string) => void; onAiFeedback: (no: number) => void }) {
  const runs = pillarRuns(goals);
  // 명단의 팀원 전부(기록이 없어도) — 기록은 있으면 그 사람 행, 없으면 빈 행
  const members = names.map((n) => findReport(reports, team, n) || emptyReport(partReport.cycle_id, team, n));
  const heads = ["병목", "목표", ...names, "조치 필요 인원", "파트 종합", "미흡항목 피드백 & 다음 달 개선 방향"];
  const col = useColWidths(`okr_cols_teamsum2_${team}_${names.length}`, [58, 260, ...names.map(() => 96), 140, 100, 340]);
  const stats = members.map((m) => { const rows = goals.map((g) => resultRowFor(m, g.no)); return { name: m.member, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, alerts: rows.filter((r) => isAlert(r.judgment)).length, rate: achievementRate(rows) }; });
  return <div className="space-y-3 p-3">
    {stats.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((st) => <button key={st.name} type="button" onClick={() => onMember(st.name)} className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-400">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{st.name}</div><div className="text-[11px] font-bold tabular-nums text-slate-400">{st.judged >= goals.length && goals.length ? "작성 완료" : `판정 ${st.judged}/${goals.length}`}</div></div>
        <div className="mt-1 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{st.rate === null ? "—" : `${st.rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-[11px] font-bold">{st.alerts > 0 ? <span className="text-rose-600">미흡·미착수 {st.alerts}</span> : <span className="text-slate-300">미흡 없음</span>}</div></div>
      </button>)}
    </div>}
    <div className="overflow-x-auto">
      <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
        <colgroup>{heads.map((h, i) => <col key={`${h}-${i}`} style={{ width: col.widths[i] }} />)}</colgroup>
        <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={`relative ${i === heads.length - 1 ? TH_WRITE : TH_READ} ${i >= 2 && i < 2 + names.length ? "text-center" : ""} ${i === heads.length - 2 ? "text-center" : ""}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
        <tbody>
          {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
            <PillarBar idx={run.idx} colSpan={heads.length} editable={false} onPillar={() => undefined} onAdd={() => undefined} />
            {run.goals.map((goal) => {
              const alertNames = members.filter((m) => isAlert(resultRowFor(m, goal.no).judgment)).map((m) => m.member);
              const part = resultRowFor(partReport, goal.no);
              const suggested = worstOfJudgments(members.map((m) => resultRowFor(m, goal.no).judgment));
              return <tr key={goal.no}>
                <td className={`${TD_READ} text-[11px] font-bold text-slate-500 ${alertNames.length ? "border-l-4 border-l-orange-500" : ""}`}>{shortBottleneck(goals, goal.no)}</td>
                <td className={`${TD_READ} whitespace-pre-wrap font-semibold leading-snug text-slate-800`}>{goal.objective}</td>
                {members.map((m) => <td key={m.member} className={`${TD} px-1 py-1.5 text-center`}><button type="button" onClick={() => onMember(m.member)} title={`${m.member} 기록 보기`}><JudgmentBadge value={resultRowFor(m, goal.no).judgment} /></button></td>)}
                <td className={`${TD_READ} text-[11px] leading-snug`}>{alertNames.length ? <span className="font-black text-blue-700">{alertNames.join(", ")}</span> : <span className="text-slate-300">—</span>}</td>
                <td className={`${TD} px-1 py-1.5 text-center`}><JudgmentBadge value={part.judgment} />{!normalizeJudgment(part.judgment) && suggested && <div className="mt-0.5 text-[10px] font-bold text-slate-400">제안 {suggested}</div>}</td>
                <td className={TD_WRITE}>
                  <RichCell text={partReport.feedback?.[String(goal.no)]?.memo || ""} html={partReport.feedback?.[String(goal.no)]?.memoHtml} minRows={2} onChange={(t, h) => onFeedback(goal.no, t, h)} />
                  {SHOW_OKR_TOOLS && <div className="px-2 pb-1 text-[10px] font-bold"><button type="button" disabled={!!aiBusy} onClick={() => onAiFeedback(goal.no)} className={LINK}>{aiBusy === `tfb|${team}|${goal.no}` ? "초안 쓰는 중…" : "✨ 초안"}</button></div>}
                </td>
              </tr>;
            })}
          </FragmentRows>)}
          {goals.length === 0 && <tr><td colSpan={heads.length} className="border border-slate-200 p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다</td></tr>}
        </tbody>
      </table>
    </div>
    {!members.length && <div className="text-center text-[12px] font-semibold text-slate-400">관리 › 인원 명단에 이 파트 인원을 넣으면 여기 열이 생깁니다</div>}
  </div>;
}

// tbody 안에서 여러 행을 묶는 용도
function FragmentRows({ children }: { children: React.ReactNode }) { return <>{children}</>; }

// ── 통합집계: 엑셀 '1.통합집계' 시트와 같은 열(목표 · 파트별 종합판정 · 조치 필요 파트 · 피드백). 공통 목표를 여기서 고친다 ──
function SummaryView({ cycle, goals, goalsOf, goalCycleId, cycles, reports, aiBusy, prevSource, onFeedback, onAiFeedback, onCopyGoals, onTemplate, onGoal, onPillar, onInsert, onRemove }: {
  cycle: OkrCycle; goals: OkrGoal[]; goalsOf: (team: OkrTeam) => OkrGoal[]; goalCycleId: string; cycles: OkrCycle[]; reports: OkrReport[]; aiBusy: string; prevSource: OkrCycle | null; onFeedback: (no: number, memo: string, memoHtml?: string) => void; onAiFeedback: (no: number) => void;
  onCopyGoals: (sourceId: string) => void; onTemplate: () => void;
} & GoalOps) {
  const partRows = reports.filter((r) => !r.member);
  const runs = pillarRuns(goals);
  const perTeam = OKR_TEAMS.map((t) => {
    const rep = partRows.find((r) => r.team === t);
    const teamGoals = goalsOf(t);
    const rows = teamGoals.map((g) => resultRowFor(rep, g.no));
    const ms = memberReports(reports, t);
    return { team: t, rep, total: teamGoals.length, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, alerts: rows.filter((r) => isAlert(r.judgment)).length, rate: achievementRate(rows), members: ms.map((m) => ({ name: m.member, judged: teamGoals.filter((g) => normalizeJudgment(resultRowFor(m, g.no).judgment)).length })) };
  });
  const otherMonths = cycles.filter((c) => c.kind === "month" && c.id !== goalCycleId && c.goals.some((g) => g.objective.trim()));
  const SUMMARY_COLS = 4 + OKR_TEAMS.length; // 병목 · 목표 · 파트별 · 조치 · 피드백
  const col = useColWidths("okr_cols_summary", [58, 300, ...OKR_TEAMS.map(() => 84), 130, 360]);
  const heads = ["병목", "목표", ...OKR_TEAMS.map(teamName), "조치 필요 파트", "미흡항목 피드백 & 다음 달 개선 방향"];
  return <div className="space-y-3">
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {perTeam.map(({ team, rep, total, judged, alerts, rate, members }) => <div key={team} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{teamName(team)}</div><div className="text-[11px] font-bold tabular-nums text-slate-400">{judged >= total && total ? "제출 완료" : `판정 ${judged}/${total}`}</div></div>
        <div className="mt-1 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{rate === null ? "—" : `${rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-right text-[11px] font-bold">{alerts > 0 ? <span className="text-rose-600">미흡·미착수 {alerts}</span> : <span className="text-slate-300">미흡 없음</span>}</div></div>
        <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-400">{rep?.header.leader ? `파트장 ${rep.header.leader}` : "파트장 미기재"}{members.length ? ` · ${members.map((m) => `${m.name} ${m.judged}/${total}`).join(", ")}` : ""}</div>
      </div>)}
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">
        <span className="text-[11px] font-semibold text-slate-500">목표·Pillar·병목은 여기서만 고칩니다 — 모든 파트·팀원에게 같은 목표가 보입니다. 분기 안에서는 달마다 같은 목표를 씁니다</span>
        <div className="flex flex-wrap items-center gap-1">
          {!goals.some((g) => g.objective.trim()) && <button type="button" onClick={onTemplate} className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100">3 × 3 빈 틀</button>}
          {prevSource && <button type="button" onClick={() => onCopyGoals(prevSource.id)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-100">↩ {cycle.month % 3 === 1 ? "전분기" : "지난달"} 목표 불러오기 ({cycleLabel(prevSource)})</button>}
          {otherMonths.length > 0 && <PortalSelect width={200} value="" onChange={(v) => v && onCopyGoals(v)} options={[{ value: "", label: "다른 달에서 가져오기…" }, ...otherMonths.map((c) => ({ value: c.id, label: `${cycleLabel(c)} (${c.goals.length}개)` }))]} />}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
          <colgroup>{heads.map((h, i) => <col key={h} style={{ width: col.widths[i] }} />)}</colgroup>
          <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={h} className={`relative ${i === heads.length - 1 ? TH_WRITE : TH_READ} ${i >= 2 && i < 2 + OKR_TEAMS.length ? "text-center" : ""}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
          <tbody>
            {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
              <PillarBar idx={run.idx} colSpan={SUMMARY_COLS} editable onPillar={(i) => onPillar(run.goals.map((g) => g.no), i)} onAdd={() => onInsert(run.goals[run.goals.length - 1].no, run.goals[0].pillar)} />
              {run.goals.map((goal) => {
                const actions = actionTeams(reports, goal.no);
                const who = actionMembers(reports, goal.no);
                const fb = cycle.feedback?.[String(goal.no)];
                const fbKey = `fb|${goal.no}`;
                return <tr key={goal.no}>
                  <BottleneckCell goals={goals} goal={goal} alert={actions.length > 0} alertTone="border-l-orange-500" editable onRemove={onRemove} />
                  <td className={TD_FIXED_EDIT}><RichCell text={goal.objective} html={goal.html?.objective} minRows={2} className="font-semibold text-sky-950" onChange={(t, h) => onGoal(goal.no, { objective: t, html: goalHtml(goal, "objective", h) })} /></td>
                  {OKR_TEAMS.map((t) => <td key={t} className={`${TD} px-1 py-1.5 text-center`}><JudgmentBadge value={resultRowFor(partRows.find((r) => r.team === t), goal.no).judgment} /></td>)}
                  <td className={`${TD_READ} text-[11px] leading-snug`}>{actions.length ? actions.map((t) => <div key={t}><span className="font-black text-rose-600">{t}파트</span>{who[t]?.length ? <span className="text-slate-500"> · {who[t].join(", ")}</span> : null}</div>) : <span className="text-slate-300">—</span>}</td>
                  <td className={TD_WRITE}>
                    <RichCell text={fb?.memo || ""} html={fb?.memoHtml} minRows={2} onChange={(t, h) => onFeedback(goal.no, t, h)} />
                    {SHOW_OKR_TOOLS && <div className="px-2 pb-1 text-[10px] font-bold"><button type="button" disabled={!!aiBusy} onClick={() => onAiFeedback(goal.no)} className={LINK}>{aiBusy === fbKey ? "초안 쓰는 중…" : "✨ 초안"}</button></div>}
                  </td>
                </tr>;
              })}
            </FragmentRows>)}
            {goals.length === 0 && <tr><td colSpan={SUMMARY_COLS} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다 — 위 [3 × 3 빈 틀] 또는 [다른 달 목표 가져오기]</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
