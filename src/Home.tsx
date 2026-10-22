import { teamLabel } from "./authors";
import CostTile from "./CostTile";
import HomeUnhandledPanel from "./HomeUnhandledPanel";
import LiveSendBoard from "./LiveSendBoard";
import AgentTeamCard from "./AgentTeamCard";
import HomeReceptionPanel from "./HomeReceptionPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Camera,
  ChevronDown,
  Clock3,
  Bot,
  Database,
  Radio,
  Route,
  ShieldCheck,
  Timer,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import FeedbackBoard from "./FeedbackBoard";
import { PATCH_NOTES } from "./patchNotes";
import { AGENT_DEPTS } from "./agentTeam";
import { AGENT_WORK_LOG } from "./agentWorkLog";
import { countRows, selectAllRowsFast, selectRows } from "./supabase";
import { getTeamVisits, kstDate, weekRange } from "./visits";
import { loadFieldRows } from "./expansionSource";
import { countField, FIELD_BASIS_TEXT, type FieldRow } from "./workCount";

// 홈 = 실시간 운영 현황판 (2026-09-12 개편, 같은 날 하단부까지 전면 다크 통일)
// ① 관제 덱: 라이브 시계·시스템 상태·개인 인사(내 이번 주 기록)
// ② 지표: 오늘/이번 주 기록·방문·키맨 변경·데이터 자산·7일 추이·지역별 주간 기록·팀별 분기 진행률·실시간 피드
// ③ 피드백 보드(직원 의견 → 개발자 컨펌) → 절약 효과(실측 기반 카운터) → 릴리스 타임라인 → 시스템 푸터
// 데이터는 전부 anon 읽기 가능한 테이블만. 조회가 실패해도 화면은 뜬다(하단 경고 한 줄).
// 주의: selectRows는 1,000행에서 잘린다 — 워킨맵(3천 행+)처럼 클 수 있는 조회는 selectAllRowsFast(실사고: 진행률 오표시).

type Screen =
  | "field" | "calendar" | "walkingMap" | "asReception" | "serviceReception" | "happycall" | "promoSend"
  | "okr" | "weekly" | "growth" | "itHistory" | "counterSms" | "selfdev" | "copierNotes" | "operations";

// 절약 근거 — 방문 1건당 반복 업무 약 10분(양식 5~8→1~2, 전송 3~5→1~2, 보고 5~10→자동)
const MINUTES_SAVED_PER_RECORD = 10;
const savings = [
  { task: "양식 작성", before: "5~8분", after: "1~2분", how: "카톡 원본 붙여넣기 → 자동 변환" },
  { task: "업무방 전송", before: "3~5분", after: "1~2분", how: "업무 종류 한 번 → 지정 방에 내용·사진" },
  { task: "업무 보고", before: "5~10분", after: "자동", how: "FIELD 기록이 일일·주간 실적으로" },
];

// ── 실시간 데이터 ────────────────────────────────────────────────────────────
type RecordRow = { id: number; created_at: string | null; 작성일: string; 작성자: string; 업체명: string; 구분: string; 지역: string };
type Telemetry = {
  fetchedAt: number; latencyMs: number;
  todayInspections: number; todayAs: number; weekInspections: number; weekAs: number;
  daily: Array<{ date: string; inspections: number; as: number }>;
  weekRows: FieldRow[];   // 이번 주 점검·AS 표 행(세는 규칙은 workCount countField — 팀 현황·순위표·조회 탭과 같은 함수)
  weekVisits: number; weekMinutes: number;
  outboxPending: number; outboxOldestMin: number | null; botLastDelivery: string | null;
  sheetPending: number; sheetFailed: number;
  keymanChanges7d: number; keymanGreetWaiting: number;
  totalRecords: number; totalPhotos: number; activeMembers: number;
  teamProgress: Array<{ team: string; done: number; total: number }>;
  recent: RecordRow[];
  errors: string[];
};

const COL = (name: string) => encodeURIComponent(name);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return kstDate(d); };

async function loadTelemetry(): Promise<Telemetry> {
  const today = kstDate();
  const week = weekRange(today);
  const d7 = daysAgo(6);
  const quarter = Math.floor(new Date().getMonth() / 3) + 1;
  const errors: string[] = [];
  const t0 = performance.now();
  const activeMembers = await countRows("cs_members", "active=is.true").catch((e) => { errors.push(`멤버 ${(e as Error).message}`); return 0; });
  const latencyMs = Math.round(performance.now() - t0);
  const safe = async <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch (e) { errors.push(`${label} ${(e as Error).message}`); return fallback; }
  };
  const recentCols = `select=id,created_at,${COL("작성일")},${COL("작성자")},${COL("업체명")},${COL("구분")},${COL("지역")}&_hidden=not.is.true&order=id.desc&limit=8`;
  const [field7, recentInsp, recentAs, outbox, activity, sheetJobs, keyman, visits, totalInsp, totalAs, totalPhotos, workin] = await Promise.all([
    // 점검·AS 수 = 표 원본 하나·함수 하나(2026-10-22) — 예전엔 여기만 행 수(양식 1장 = 1, 팀장 포함, 지역 칸)라 팀 현황과 달랐다
    safe("점검·AS 7일", loadFieldRows(d7 < week.start ? d7 : week.start, today), [] as FieldRow[]),
    safe("최근점검", selectRows<RecordRow>("jeomgeom", recentCols), []),
    safe("최근AS", selectRows<RecordRow>("as_records", recentCols), []),
    safe("봇큐", selectRows<{ created_at: string }>("outbox", "select=created_at&order=created_at.asc&limit=50"), []),
    safe("봇배달", selectRows<{ last_at: string }>("room_activity", "select=last_at&source=eq.bot_send&order=last_at.desc&limit=1"), []),
    safe("시트큐", selectRows<{ sheet_status: string | null }>("field_sheet_sync_jobs", `select=sheet_status&created_at=gte.${d7}&order=id.desc&limit=300`), []),
    safe("키맨", selectRows<{ greeting_done: boolean | null; category: string | null }>("contact_changes", `select=greeting_done,category&change_date=gte.${d7}&_hidden=not.is.true`), []),
    safe("방문", getTeamVisits(week.start, week.end), []),
    safe("점검누적", countRows("jeomgeom"), 0),
    safe("AS누적", countRows("as_records"), 0),
    safe("사진", countRows("photo_assets"), 0),
    // 워킨맵은 분기당 3천 행이 넘는다 — 반드시 전량 조회(selectRows는 1,000행에서 잘려 진행률이 틀리게 나왔다)
    safe("워킨맵", selectAllRowsFast<{ team: string; label: string; kind: string }>("workin_map_places", `select=team,label,kind&quarter=eq.${quarter}&kind=in.(quarter,monthly)&visible=not.is.false&order=id.asc`), []),
  ]);
  const dayKeys = Array.from({ length: 7 }, (_, i) => daysAgo(6 - i));
  const daily = dayKeys.map((date) => ({ date, inspections: countField(field7, { kind: "inspection", from: date, to: date }), as: countField(field7, { kind: "as", from: date, to: date }) }));
  const weekRows = field7.filter((r) => !r.hidden && r.day >= week.start && r.day <= week.end);
  const now = Date.now();
  const oldest = outbox[0]?.created_at ? Math.round((now - new Date(outbox[0].created_at).getTime()) / 60000) : null;
  const statusOf = (s: string | null) => (s || "").toLowerCase();
  const visited = visits.filter((v) => v.visited);
  const monthlyUnits = (label: string) => (label === "G2" ? 1 : label === "G3" ? 2 : label === "G5" || label === "G12" ? 3 : 0);
  return {
    fetchedAt: now, latencyMs,
    todayInspections: daily[6].inspections, todayAs: daily[6].as,
    weekInspections: countField(weekRows, { kind: "inspection" }), weekAs: countField(weekRows, { kind: "as" }),
    daily, weekRows,
    weekVisits: visited.length,
    weekMinutes: visited.reduce((s, v) => s + Object.values((v as unknown as { minutes?: Record<string, number> }).minutes || {}).reduce((a, b) => a + (Number(b) || 0), 0), 0),
    outboxPending: outbox.length, outboxOldestMin: oldest, botLastDelivery: activity[0]?.last_at || null,
    sheetPending: sheetJobs.filter((j) => ["pending", "queued", "retry"].includes(statusOf(j.sheet_status))).length,
    sheetFailed: sheetJobs.filter((j) => ["failed", "error"].includes(statusOf(j.sheet_status))).length,
    keymanChanges7d: keyman.length,
    keymanGreetWaiting: keyman.filter((k) => !k.greeting_done && /담당|키맨|명의/.test(k.category || "")).length,
    totalRecords: totalInsp + totalAs, totalPhotos, activeMembers,
    // 워킨맵 '팀별 진행률'과 같은 셈법 — 분기점검 G5·G12 완료, 매월점검은 3단위(G2=1·G3=2·G5/G12=3)
    teamProgress: ["A", "B", "C", "D", "E"].map((team) => {
      const rows = workin.filter((w) => w.team === team);
      const quarterly = rows.filter((w) => w.kind === "quarter"), monthly = rows.filter((w) => w.kind === "monthly");
      return { team, total: quarterly.length + monthly.length * 3, done: quarterly.filter((w) => w.label === "G5" || w.label === "G12").length + monthly.reduce((s, w) => s + monthlyUnits(w.label), 0) };
    }),
    recent: [...recentInsp, ...recentAs].sort((a, b) => String(b.created_at || b.작성일).localeCompare(String(a.created_at || a.작성일))).slice(0, 10),
    errors,
  };
}

function useTelemetry() {
  const [data, setData] = useState<Telemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    try { setData(await loadTelemetry()); } finally { busy.current = false; setLoading(false); }
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return { data, loading, refresh };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  return now;
}

/** 숫자가 이전 값에서 목표값까지 올라간다(0.9초). 움직임 줄이기 설정이면 즉시. */
function useCountUp(target: number, ms = 900) {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(target)) { setValue(target); fromRef.current = target; return; }
    const from = fromRef.current, start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms), eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick); else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function readAuthor(): string { try { return localStorage.getItem("author") || ""; } catch { return ""; } }

const fmt = (n: number) => n.toLocaleString("ko-KR");
const relTime = (iso: string | null) => {
  if (!iso) return "기록 없음";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`; if (m < 1440) return `${Math.floor(m / 60)}시간 전`; return `${Math.floor(m / 1440)}일 전`;
};
const greeting = (h: number) => (h < 6 ? "늦은 밤까지 수고가 많습니다" : h < 11 ? "좋은 아침입니다" : h < 14 ? "점심은 챙기셨나요" : h < 18 ? "오후도 힘내세요" : "오늘 하루 고생 많으셨습니다");

// ── 조각 ─────────────────────────────────────────────────────────────────────
type Tone = "ok" | "warn" | "bad" | "idle";
const card = "rounded-2xl border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const eyebrow = "text-[10px] font-black uppercase tracking-[0.16em] text-slate-500";

function StatusPill({ tone, icon: Icon, label, value, onClick }: { tone: Tone; icon: LucideIcon; label: string; value: string; onClick?: () => void }) {
  const dot = tone === "ok" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : tone === "bad" ? "bg-rose-500" : "bg-slate-500";
  const cls = `flex items-center gap-2.5 px-3 py-2 ${card}`;
  const inner = (
    <>
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {tone !== "idle" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${dot}`} />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
      </span>
      <Icon size={14} className="shrink-0 text-slate-400" />
      <span className="min-w-0"><span className={`block ${eyebrow}`}>{label}</span><span className="block truncate text-[12.5px] font-black text-slate-100">{value}</span></span>
    </>
  );
  if (onClick) {
    // 누를 수 있는 알약은 하나뿐이라 살짝 다르게: 자주색 테두리·은은한 빛·내려가기 화살표. 운영 지표를 가리지 않게 얇게(2026-10-19 사용자 요청)
    return (
      <button type="button" onClick={onClick} className={`${cls} w-full cursor-pointer text-left !border-fuchsia-400/45 shadow-[0_0_0_1px_rgba(232,121,249,0.12),0_0_28px_-10px_rgba(232,121,249,0.7)] transition hover:!border-fuchsia-300/80 hover:bg-white/[0.06] hover:shadow-[0_0_0_1px_rgba(232,121,249,0.25),0_0_36px_-8px_rgba(232,121,249,0.9)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-300`}>
        {inner}
        <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-[10px] font-black text-fuchsia-200">보기<ChevronDown size={11} /></span>
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

// 홈 아래 "AI 에이전트 팀" 카드(#agent-team)로 부드럽게 스크롤 + 카드가 하이라이트하도록 이벤트 발송
function focusAgentTeam() {
  const el = document.getElementById("agent-team");
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // scrollIntoView 금지: 홈의 검은 판이 overflow-hidden 이라 그 안쪽 scrollTop 이 밀려 위가 잘린 채 되돌릴 수 없었다(2026-10-19 실측).
  // 창(window)만 스크롤하고, 혹시 밀린 overflow-hidden 조상은 0 으로 되돌린다.
  for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollTop) p.scrollTop = 0;
  const top = el.getBoundingClientRect().top + window.scrollY - 76; // 상단 바 높이만큼 여유
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  el.dispatchEvent(new CustomEvent("agent-team:focus"));
}

function BigNumber({ value, className = "" }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={`tabular-nums ${className}`}>{fmt(v)}</span>;
}

function Metric({ label, value, sub, icon: Icon, accent = "text-blue-300", loading }: { label: string; value: number | null; sub?: string; icon: LucideIcon; accent?: string; loading?: boolean }) {
  return (
    <div className={`p-4 ${card}`}>
      <div className={`flex items-center justify-between ${eyebrow}`}><span>{label}</span><Icon size={14} className={accent} /></div>
      <div className="mt-2 text-[30px] font-black leading-none text-white sm:text-[34px]">{value === null ? <span className="inline-block h-8 w-16 animate-pulse rounded bg-white/[0.08]" /> : <BigNumber value={value} />}</div>
      <div className="mt-1.5 min-h-[16px] text-[11px] font-bold text-slate-400">{sub || (loading ? "불러오는 중" : "")}</div>
    </div>
  );
}

function Bars({ daily }: { daily: Telemetry["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.inspections + d.as));
  return (
    <div className="flex items-end gap-1.5">
      {daily.map((d, i) => {
        const total = d.inspections + d.as, h = Math.max(total ? 6 : 2, Math.round((total / max) * 60)), ih = total ? Math.round((d.inspections / total) * h) : 0;
        return (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date} · 점검 ${d.inspections}대 · AS ${d.as}건`}>
            <span className={`text-[10px] font-black tabular-nums ${total ? "text-slate-300" : "text-slate-600"}`}>{total || ""}</span>
            <div className="flex w-full flex-col justify-end overflow-hidden rounded-sm bg-white/[0.06]" style={{ height: 60 }}>
              <div className={`w-full transition-[height] duration-700 ${i === 6 ? "bg-blue-400" : "bg-blue-500/60"}`} style={{ height: ih }} />
              <div className={`w-full transition-[height] duration-700 ${i === 6 ? "bg-violet-400" : "bg-violet-500/60"}`} style={{ height: h - ih }} />
            </div>
            <span className={`text-[9.5px] font-black tabular-nums ${i === 6 ? "text-white" : "text-slate-500"}`}>{d.date.slice(8)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Home({ onGoField, onNavigate }: { onGoField: () => void; onNavigate?: (screen: Screen) => void }) {
  const now = useClock();
  const { data, loading } = useTelemetry();
  const [author, setAuthor] = useState(readAuthor);
  useEffect(() => { const sync = () => setAuthor(readAuthor()); window.addEventListener("focus", sync); window.addEventListener("storage", sync); return () => { window.removeEventListener("focus", sync); window.removeEventListener("storage", sync); }; }, []);
  const [patchExpanded, setPatchExpanded] = useState(false);
  const go = (screen: Screen) => screen === "field" ? onGoField() : onNavigate?.(screen);
  const openOverdue = () => { try { localStorage.setItem("cs_as_open_overdue", "1"); } catch { /* 무시 */ } go("asReception"); setTimeout(() => window.dispatchEvent(new CustomEvent("cs:open-overdue")), 300); };

  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const dateLabel = useMemo(() => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now), [now.getDate()]); // eslint-disable-line react-hooks/exhaustive-deps
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const weekNo = Math.ceil((((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7);

  const agentPillValue = useMemo(() => {
    const total = AGENT_DEPTS.reduce((n, d) => n + d.roles.length, 0);
    const today = kstDate();
    const active = new Set(AGENT_WORK_LOG.filter((w) => w.date === today).map((w) => w.agent)).size;
    return active > 0 ? `직원 ${total}명 · 오늘 ${active}명 투입` : `직원 ${total}명 출근 중`;
  }, []);
  const patchGroups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of PATCH_NOTES) map.set(p.date, [...(map.get(p.date) || []), p.note]);
    return Array.from(map.entries());
  }, []);

  // 상태 판정 — 숫자보다 "정상/지연" 한 단어가 먼저 읽히게
  const sheet: { tone: Tone; value: string } = !data ? { tone: "idle", value: "확인 중" }
    : data.sheetFailed ? { tone: "bad", value: `실패 ${data.sheetFailed} · 대기 ${data.sheetPending}` }
    : data.sheetPending ? { tone: "warn", value: `대기 ${data.sheetPending}건` } : { tone: "ok", value: "정상 · 큐 비어 있음" };
  const db: { tone: Tone; value: string } = !data ? { tone: "idle", value: "확인 중" }
    : data.errors.length ? { tone: "warn", value: `응답 ${data.latencyMs}ms · 일부 조회 실패` }
    : { tone: data.latencyMs < 400 ? "ok" : "warn", value: `응답 ${data.latencyMs}ms` };

  const totalProgress = data ? data.teamProgress.reduce((s, t) => s + t.total, 0) : 0;
  const doneProgress = data ? data.teamProgress.reduce((s, t) => s + t.done, 0) : 0;
  const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
  const weekRecords = data ? data.weekRows.length : 0; // 양식 장수 — 절약 효과(양식 1장 × 10분) 계산에만
  const myWeekInsp = data && author ? countField(data.weekRows, { kind: "inspection", author }) : 0;
  const myWeekAs = data && author ? countField(data.weekRows, { kind: "as", author }) : 0;
  const amManager = Boolean(data && author && data.weekRows.some((r) => r.author === author && r.manager));
  // 팀 = 지역 칸(없으면 출처 괄호 → 작성자 팀) — 팀 현황·조회 탭과 같은 함수
  const regionWeek = useMemo(() => ["A", "B", "C", "D", "E"].map((region) => {
    const insp = data ? countField(data.weekRows, { kind: "inspection", team: region }) : 0;
    const as = data ? countField(data.weekRows, { kind: "as", team: region }) : 0;
    return { region, insp, as, count: insp + as };
  }), [data]);
  const regionMax = Math.max(1, ...regionWeek.map((r) => r.count));
  const savedWeekHours = Math.round((weekRecords * MINUTES_SAVED_PER_RECORD) / 60);
  const savedTotalHours = data ? Math.round((data.totalRecords * MINUTES_SAVED_PER_RECORD) / 60) : 0;

  return (
    <div className="pb-8">
      <div className="relative overflow-hidden rounded-3xl bg-[#0B0F17] text-white shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        {/* 배경 결 — 격자 + 광원 셋 */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(rgba(148,163,184,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.7) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-[38%] h-[28rem] w-[28rem] rounded-full bg-violet-600/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

        {/* ── ① 관제 덱 ── */}
        <div className="relative flex flex-col gap-4 border-b border-white/[0.08] px-4 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10.5px] font-black tracking-[0.22em] text-blue-300"><Radio size={13} className="animate-pulse motion-reduce:animate-none" />FIRSTOA CS · LIVE OPERATIONS</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-[42px] font-black leading-none tabular-nums tracking-tight sm:text-[54px]">{clock}</span>
              <span className="text-sm font-bold text-slate-300">{dateLabel}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] font-black">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">{quarter}분기 운영 중</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">{weekNo}주차</span>
              {data && <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">CS 재직 {data.activeMembers}명</span>}
              {data && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">갱신 {relTime(new Date(data.fetchedAt).toISOString())}</span>}
            </div>
            <p className="mt-3 text-[13px] font-bold text-slate-300">
              {author ? <><span className="text-white">{author}</span> 프로, {greeting(now.getHours())}. 이번 주 내 점검 <span className="font-mono text-white">{data ? myWeekInsp : "—"}</span>대 · AS <span className="font-mono text-white">{data ? myWeekAs : "—"}</span>건{amManager ? " (팀장 기록은 집계 제외)" : ""} · 전체 점검 <span className="font-mono text-white">{data ? fmt(data.weekInspections) : "—"}</span>대 · AS <span className="font-mono text-white">{data ? fmt(data.weekAs) : "—"}</span>건</>
                : <>{greeting(now.getHours())}. 왼쪽 아래에서 작성자를 고르면 내 기록이 여기 표시됩니다.</>}
            </p>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:min-w-[580px]">
            <StatusPill tone={db.tone} icon={Database} label="데이터베이스" value={db.value} />
            <StatusPill tone={sheet.tone} icon={ShieldCheck} label="시트 동기화" value={sheet.value} />
            <StatusPill tone="ok" icon={Zap} label="최근 배포" value={patchGroups[0] ? `${patchGroups[0][0]} · ${patchGroups[0][1].length}건 반영` : "-"} />
            <StatusPill tone="ok" icon={Bot} label="FIELD AI 에이전트 팀" value={agentPillValue} onClick={focusAgentTeam} />
            {/* 비용(AI 질문·문자) — 관제 덱 안에(2026-10-11), 누르면 일별·실시간·지금까지 내역 */}
            <CostTile />
            <HomeReceptionPanel onOpen={() => go("serviceReception")} />
          </div>
        </div>

        {/* ── ② 실시간 전송 현황판 — 모든 방 + 오늘 전송 흐름 (2026-10-17 홈 개편) ── */}
        <LiveSendBoard />

        {/* ── ③ 지표 ── */}
        <div className="relative grid grid-cols-1 gap-3 px-4 py-4 sm:px-6 lg:grid-cols-12 lg:items-start">
          <div className="grid min-w-0 auto-rows-min grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-8">
            {/* 미처리 토탈 — 접수 6종 + 지난 일정, 팀·부서·물류 탭(2026-10-19) */}
            <HomeUnhandledPanel onOpenOverdue={openOverdue} onOpenReception={() => go("serviceReception")} />
            <Metric label="오늘 점검(대)" icon={Activity} accent="text-emerald-300" loading={loading} value={data ? data.todayInspections : null} sub={data ? `AS ${data.todayAs}건 · 이번 주 점검 ${fmt(data.weekInspections)}대 · AS ${fmt(data.weekAs)}건` : undefined} />
            <Metric label="이번 주 방문" icon={Route} accent="text-blue-300" loading={loading} value={data ? data.weekVisits : null} sub={data ? `${Math.round(data.weekMinutes / 60)}시간 현장 · 작성자 ${new Set(data.weekRows.map((r) => r.author).filter(Boolean)).size}명` : undefined} />
            <Metric label="키맨·주소 변경 7일" icon={UsersRound} accent="text-amber-300" loading={loading} value={data ? data.keymanChanges7d : null} sub={data ? (data.keymanGreetWaiting ? `인사 대기 ${data.keymanGreetWaiting}건 — 워킨맵에서 체크` : "인사 대기 없음") : undefined} />
            <Metric label="데이터 자산" icon={Camera} accent="text-violet-300" loading={loading} value={data ? data.totalRecords : null} sub={data ? `점검·AS 기록 누적 · 사진 ${fmt(data.totalPhotos)}장` : undefined} />
            <div className={`p-4 ${card}`}>
              <div className={`flex items-center justify-between ${eyebrow}`}>
                <span>최근 7일 점검(대)·AS(건)</span>
                <span className="flex items-center gap-3 normal-case tracking-normal"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-400" />점검</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-violet-400" />AS</span></span>
              </div>
              <div className="mt-3">{data ? <Bars daily={data.daily} /> : <div className="h-[96px] animate-pulse rounded bg-white/[0.05]" />}</div>
              <div className="mt-2 text-[10px] font-semibold leading-snug text-slate-500">기준: 점검·AS 표, {FIELD_BASIS_TEXT} — 팀 현황·순위표·조회 탭과 같은 숫자</div>
            </div>
            <div className={`p-4 ${card}`}>
              <div className={`flex items-center justify-between ${eyebrow}`}><span>이번 주 팀별 점검·AS</span><span className="normal-case tracking-normal text-slate-500">점검(대) · AS(건)</span></div>
              <div className="mt-3 space-y-2">
                {regionWeek.map((r) => (
                  <div key={r.region} className="flex items-center gap-3">
                    <span className="w-6 shrink-0 text-[12px] font-black text-slate-300">{r.region}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-400 transition-[width] duration-700" style={{ width: `${Math.round((r.count / regionMax) * 100)}%` }} /></div>
                    <span className="w-16 shrink-0 text-right font-mono text-[11px] font-black tabular-nums text-slate-300">{data ? `${r.insp} · ${r.as}` : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:col-span-4">
            <div className={`p-4 ${card}`}>
              <div className="flex items-center justify-between">
                <span className={eyebrow}>{quarter}분기 점검 진행률 <span className="normal-case tracking-normal text-slate-600">· 워킨맵 기준</span></span>
                <span className="font-mono text-[12px] font-black tabular-nums text-white">{data ? `${pct(doneProgress, totalProgress)}%` : "—"} <span className="text-slate-500">{data ? `${fmt(doneProgress)}/${fmt(totalProgress)}` : ""}</span></span>
              </div>
              <div className="mt-3 space-y-2.5">
                {(data?.teamProgress || ["A", "B", "C", "D", "E"].map((team) => ({ team, done: 0, total: 0 }))).map((t) => (
                  <div key={t.team} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-[12px] font-black text-slate-300">{teamLabel(t.team)}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-[width] duration-700" style={{ width: `${pct(t.done, t.total)}%` }} /></div>
                    <span className="w-28 shrink-0 text-right font-mono text-[11px] font-black tabular-nums text-slate-300">{pct(t.done, t.total)}% <span className="text-slate-500">{fmt(t.done)}/{fmt(t.total)}</span></span>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => go("walkingMap")} className="mt-3 flex items-center gap-1 text-[11px] font-black text-blue-300 transition hover:text-white">워킨맵에서 색상별로 보기 <ArrowRight size={13} /></button>
            </div>
          </div>
        </div>
        {data?.errors.length ? <div className="relative border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[11px] font-bold text-amber-200 sm:px-6">일부 지표를 못 불러왔습니다: {data.errors.slice(0, 3).join(" · ")}</div> : null}

        {/* ── ③ 피드백 보드 — 직원 불편·버그·개선점 → 개발자 답글·지시 → 컨펌(개발 대기) ── */}
        <FeedbackBoard author={author} />

        {/* ── ④ 절약 효과 ── */}
        <div className="relative border-t border-white/[0.08] px-4 py-5 sm:px-6">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className={`min-w-0 p-5 lg:col-span-5 ${card}`}>
              <div className={`flex items-center gap-2 ${eyebrow}`}><Timer size={13} className="text-emerald-300" />Impact · 절약 추정</div>
              <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
                <div><div className="text-[38px] font-black leading-none text-white sm:text-[44px]">{data ? <BigNumber value={savedWeekHours} /> : "—"}<span className="ml-1 text-[16px] font-black text-emerald-300">시간</span></div><div className="mt-1.5 text-[11px] font-bold text-slate-400">이번 주 · 기록 {fmt(weekRecords)}건 × 약 {MINUTES_SAVED_PER_RECORD}분</div></div>
                <div><div className="text-[24px] font-black leading-none text-slate-200">{data ? <BigNumber value={savedTotalHours} /> : "—"}<span className="ml-1 text-[12px] font-black text-slate-400">시간</span></div><div className="mt-1.5 text-[11px] font-bold text-slate-500">누적 · 기록 {data ? fmt(data.totalRecords) : "—"}건</div></div>
              </div>
              <p className="mt-4 text-[11px] font-semibold leading-5 text-slate-500">반복 업무(양식·전송·보고) 기준의 추정치입니다. 실제 방문·처리 시간은 포함하지 않습니다.</p>
            </div>
            <div className={`p-2 lg:col-span-7 ${card}`}>
              {savings.map((s, i) => (
                <div key={s.task} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-3 ${i ? "border-t border-white/[0.06]" : ""}`}>
                  <span className="w-24 shrink-0 text-[13px] font-black text-white">{s.task}</span>
                  <span className="flex items-center gap-1.5 font-mono text-[12px] font-black tabular-nums"><span className="text-slate-500 line-through decoration-slate-600">{s.before}</span><ArrowRight size={12} className="text-slate-500" /><span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">{s.after}</span></span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-slate-400">{s.how}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <AgentTeamCard />

        {/* ── ⑤ 릴리스 타임라인 ── */}
        <div className="relative border-t border-white/[0.08] px-4 py-5 sm:px-6">
          <div className={`min-w-0 ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3.5">
              <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white"><Zap size={15} /></span><div><div className={eyebrow}>Releases</div><h3 className="text-[13.5px] font-black text-white">업데이트</h3></div></div>
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] font-black tabular-nums"><span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-300">누적 {PATCH_NOTES.length}</span>{patchGroups[0] && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">v{patchGroups[0][0].replaceAll("-", ".")}</span>}</div>
            </div>
            <ol className="relative px-4 py-3 before:absolute before:bottom-6 before:left-[27px] before:top-6 before:w-px before:bg-white/10">
              {(patchExpanded ? patchGroups.slice(0, 8) : patchGroups.slice(0, 3)).map(([date, notes], gi) => (
                <li key={date} className="relative flex gap-3 py-2 pl-1">
                  <span className={`relative z-10 mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${gi === 0 ? "border-blue-400 bg-[#0B0F17]" : "border-white/20 bg-[#0B0F17]"}`}>{gi === 0 && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-mono text-[11px] font-black tabular-nums"><span className="text-slate-200">{date}</span>{gi === 0 && <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] text-white">NEW</span>}<span className="text-slate-500">{notes.length}건</span></div>
                    <ul className="mt-1 space-y-0.5">
                      {notes.slice(0, gi === 0 ? 3 : 2).map((note) => <li key={note} className="truncate text-[12px] font-semibold text-slate-300" title={note}>{note}</li>)}
                      {notes.length > (gi === 0 ? 3 : 2) && <li className="text-[10.5px] font-bold text-slate-500">… 외 {notes.length - (gi === 0 ? 3 : 2)}건</li>}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => setPatchExpanded(!patchExpanded)} className="flex w-full items-center justify-center gap-1.5 border-t border-white/[0.08] py-2.5 text-[11.5px] font-black text-slate-400 transition hover:bg-white/[0.04] hover:text-white">{patchExpanded ? "접기" : "최근 배포 더 보기"}<ChevronDown size={14} className={`transition ${patchExpanded ? "rotate-180" : ""}`} /></button>
          </div>
        </div>

        {/* ── ⑧ 시스템 푸터 ── */}
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3 font-mono text-[10.5px] font-bold text-slate-500 sm:px-6">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1"><span>FIRSTOA CS</span><span className="text-slate-700">|</span><span>build {patchGroups[0]?.[0] || "—"}</span><span className="text-slate-700">|</span><span>db supabase · seoul</span><span className="text-slate-700">|</span><span>edge vercel</span>{data && <><span className="text-slate-700">|</span><span>data {relTime(new Date(data.fetchedAt).toISOString())}</span></>}</span>
          <span className="flex items-center gap-1.5 text-slate-500"><Clock3 size={11} />전송 현황 15초 · 지표 60초마다 자동 갱신 · 새 기능 제안은 팀장·개발 담당에게</span>
        </div>
      </div>
    </div>
  );
}
