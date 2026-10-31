import CostTile from "./CostTile";
import LiveSendBoard from "./LiveSendBoard";
import AgentTeamCard from "./AgentTeamCard";
import HomeKpiBoard from "./HomeKpiBoard";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clock3,
  Bot,
  Database,
  Pencil,
  Check,
  Server,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import FeedbackBoard from "./FeedbackBoard";
import { PATCH_NOTES } from "./patchNotes";
import { AGENT_DEPTS } from "./agentTeam";
import { AGENT_WORK_LOG } from "./agentWorkLog";
import { countRows, selectRows } from "./supabase";
import { kstDate } from "./visits";
import { useScreenActive } from "./screenActive";
import { type HomeKpiState } from "./kpi/homeKpiModel";
import { bizDays, kpiRanges } from "./kpi/kpiCompute";
import { headlineNumbers } from "./kpi/teamBoard";

// 홈 = CS KPI 현황판 (2026-10-23 개편, 2026-10-24 전면 개편 docs/tasks/home-redesign-2026-10-24.md — KPI 달성표가 주인공)
// ① 머리 띠(2026-10-24 마무리, 사용자 "상단 한 줄 너무 밋밋, 주차 빼"): 왼쪽 큰 날짜 "10월 24일 토요일" + 작은 연도,
//    가운데 칩 "4분기 · 말일까지 n영업일"(kpiCompute.bizDays), 오른쪽 "갱신 n분 전" + [편집]. 장식은 얇은 그라데이션 선 하나. 60초 시계(1초 금지)
//    홈 3차(2026-10-25 팀 보드): 띠를 더 얇게(py-2·px-2), 오른쪽에 큰 숫자 3개 "미처리 · OKR · 분기 점검"(kpi 묶음, 없으면 "—"),
//    페이지 여백 없음 — 판을 App 컨테이너 안쪽 여백만큼 바깥으로 넓힌다(-mx·-mt, 둥근 모서리 없음)
// ② CS KPI 현황판(HomeKpiBoard): 금일 현황 → KPI 달성표(분기 점검 진행은 K2 행 안) → 미처리 → OKR(주·범위 칩)
// ③ 운영·시스템(접을 수 있음, 기본 펼침): DB·시트 상태·최근 배포·AI 에이전트 팀 알약, 비용, 실시간 전송 현황판,
//    AI 에이전트 팀 카드, 업데이트 목록 — 접혀 있으면 그리지 않으므로 전송 현황판 15초 폴링도 멈춘다. 절약 효과(IMPACT)는 2026-10-24 삭제
// ④ 피드백 보드 → 시스템 푸터
// 예전 지표 판(오늘 점검·이번 주 방문·키맨 7일·7일 추이·팀별 점검·분기 진행률)과 미처리 판은 KPI 위젯으로 옮겼다(같은 함수).
// 데이터는 전부 anon 읽기 가능한 테이블만. 조회가 실패해도 화면은 뜬다(경고 한 줄).

type Screen =
  | "field" | "calendar" | "walkingMap" | "asReception" | "serviceReception" | "happycall" | "promoSend"
  | "okr" | "weekly" | "growth" | "itHistory" | "counterSms" | "selfdev" | "copierNotes" | "operations"
  | "lookup" | "contactChanges";

// ── 운영 상태(관제 덱·운영 접힘) ─────────────────────────────────────────────
// 늘 읽는 것: 재직 인원(=DB 응답 시간)·시트 동기화 큐(접힘 머리 점). (누적 기록 수 조회는 절약 효과와 함께 2026-10-24 삭제)
type Telemetry = {
  fetchedAt: number; latencyMs: number;
  sheetPending: number; sheetFailed: number;
  /** 가장 최근 실패 작업이 며칠 전인지(7일 창 안, 없으면 null) — 홈 칩 "실패 n · n일 전" */
  sheetFailedDaysAgo: number | null;
  activeMembers: number;
  errors: string[];
};

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return kstDate(d); };

async function loadTelemetry(): Promise<Telemetry> {
  const d7 = daysAgo(6);
  const errors: string[] = [];
  const t0 = performance.now();
  const activeMembers = await countRows("cs_members", "active=is.true").catch((e) => { errors.push(`멤버 ${(e as Error).message}`); return 0; });
  const latencyMs = Math.round(performance.now() - t0);
  const safe = async <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch (e) { errors.push(`${label} ${(e as Error).message}`); return fallback; }
  };
  const sheetJobs = await safe("시트큐", selectRows<{ sheet_status: string | null; created_at: string | null }>("field_sheet_sync_jobs", `select=sheet_status,created_at&created_at=gte.${d7}&order=id.desc&limit=300`), []);
  const statusOf = (s: string | null) => (s || "").toLowerCase();
  const failed = sheetJobs.filter((j) => ["failed", "error"].includes(statusOf(j.sheet_status)));
  const lastFailed = failed.map((j) => String(j.created_at || "")).filter(Boolean).sort().pop();
  return {
    fetchedAt: Date.now(), latencyMs,
    sheetPending: sheetJobs.filter((j) => ["pending", "queued", "retry"].includes(statusOf(j.sheet_status))).length,
    sheetFailed: failed.length,
    sheetFailedDaysAgo: lastFailed ? sheetDaysAgo(lastFailed, kstDate()) : null,
    activeMembers,
    errors,
  };
}

function useTelemetry() {
  const [data, setData] = useState<Telemetry | null>(null);
  const busy = useRef(false);
  const active = useScreenActive();
  useEffect(() => {
    if (!active) return; // 다른 화면이 떠 있으면(KeepAlive 숨김) 쉰다
    const refresh = async () => {
      if (busy.current) return;
      busy.current = true;
      try { setData(await loadTelemetry()); } finally { busy.current = false; }
    };
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [active]);
  return data;
}

/**
 * 시계(1분 단위). 화면이 숨어 있으면(KeepAlive) 멈춘다.
 * 2026-10-24 속도·개편: 1초 시계(LiveClock)는 없앴다 — 홈 전체가 매초 다시 그려졌다. 머리 띠(날짜·분기 남은 영업일·갱신)만 1분마다.
 */
function useClock(stepMs: number) {
  const active = useScreenActive();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const first = window.setTimeout(() => setNow(new Date()), 0); // 다시 보일 때 바로 맞춤
    const t = window.setInterval(() => setNow(new Date()), stepMs);
    return () => { window.clearTimeout(first); window.clearInterval(t); };
  }, [active, stepMs]);
  return now;
}

function readAuthor(): string { try { return localStorage.getItem("author") || ""; } catch { return ""; } }

const relTime = (iso: string | null) => {
  if (!iso) return "기록 없음";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`; if (m < 1440) return `${Math.floor(m / 60)}시간 전`; return `${Math.floor(m / 1440)}일 전`;
};
/** 시트 실패 "n일 전" — KST 날짜 차 */
const sheetDaysAgo = (iso: string, today: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(kstDate(new Date(iso)))) / 86_400_000));
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** 머리 띠 큰 날짜 "10월 24일 토요일" — KST(kstDate) 기준 */
function headDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}월 ${d}일 ${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}요일`;
}

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

const OPS_OPEN_KEY = "home_ops_open_v1";
/** 기본 펼침(팀장 결정 2026-10-23 — 전송 현황판 등은 사용자가 요청해 만든 화면). 접으면 "0" 으로 기기에 기억 */
function readOpsOpen(): boolean { try { return localStorage.getItem(OPS_OPEN_KEY) !== "0"; } catch { return true; } }

export default function Home({ onGoField, onNavigate }: { onGoField: () => void; onNavigate?: (screen: Screen) => void }) {
  const now = useClock(60_000);
  // 운영·시스템 접힘(기본 펼침, 접으면 기기에 기억). 접혀 있으면 그 안의 부품을 그리지 않아 폴링·조회가 멈춘다
  const [opsOpen, setOpsOpen] = useState(readOpsOpen);
  const toggleOps = () => {
    const next = !opsOpen;
    setOpsOpen(next);
    try { localStorage.setItem(OPS_OPEN_KEY, next ? "1" : "0"); } catch { /* 기억 못 해도 지금 화면은 바뀐다 */ }
  };
  const data = useTelemetry();
  const [kpi, setKpi] = useState<HomeKpiState | null>(null);
  const [editing, setEditing] = useState(false);
  const [author, setAuthor] = useState(readAuthor);
  useEffect(() => { const sync = () => setAuthor(readAuthor()); window.addEventListener("focus", sync); window.addEventListener("storage", sync); return () => { window.removeEventListener("focus", sync); window.removeEventListener("storage", sync); }; }, []);
  const [patchExpanded, setPatchExpanded] = useState(false);
  const go = (screen: Screen) => screen === "field" ? onGoField() : onNavigate?.(screen);
  const openOverdue = () => { try { localStorage.setItem("cs_as_open_overdue", "1"); } catch { /* 무시 */ } go("asReception"); setTimeout(() => window.dispatchEvent(new CustomEvent("cs:open-overdue")), 300); };

  const todayYmd = kstDate(now);
  const quarter = Math.floor((Number(todayYmd.slice(5, 7)) - 1) / 3) + 1;
  // 분기 말일까지 남은 영업일(오늘 포함, 주말·공휴일·설정 휴일 제외) — 달성표와 같은 bizDays
  const holidays = kpi?.bundle.settings.holidays;
  const head = useMemo(() => headlineNumbers(kpi?.bundle ?? null), [kpi]);
  const bizLeft = useMemo(() => bizDays(todayYmd, kpiRanges(todayYmd).quarter.to, holidays ?? []), [todayYmd, holidays]);

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
    : data.sheetFailed ? { tone: "bad", value: `실패 ${data.sheetFailed}${data.sheetFailedDaysAgo !== null ? ` · ${data.sheetFailedDaysAgo ? `${data.sheetFailedDaysAgo}일 전` : "오늘"}` : ""} · 대기 ${data.sheetPending}` }
    : data.sheetPending ? { tone: "warn", value: `대기 ${data.sheetPending}건` } : { tone: "ok", value: "정상 · 큐 비어 있음" };
  const db: { tone: Tone; value: string } = !data ? { tone: "idle", value: "확인 중" }
    : data.errors.length ? { tone: "warn", value: `응답 ${data.latencyMs}ms · 일부 조회 실패` }
    : { tone: data.latencyMs < 400 ? "ok" : "warn", value: `응답 ${data.latencyMs}ms` };
  const opsTone: Tone = sheet.tone === "bad" || db.tone === "bad" ? "bad" : sheet.tone === "warn" || db.tone === "warn" ? "warn" : sheet.tone === "idle" ? "idle" : "ok";

  const opsDot = opsTone === "ok" ? "bg-emerald-400" : opsTone === "warn" ? "bg-amber-400" : opsTone === "bad" ? "bg-rose-500" : "bg-slate-500";

  return (
    <div className="-mx-1 -mt-2 pb-8 sm:-mx-4 lg:-mx-6">
      <div className="relative overflow-hidden rounded-xl bg-[#0B0F17] text-white shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        {/* 배경 결 — 격자 + 광원 셋 */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(rgba(148,163,184,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.7) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-[38%] h-[28rem] w-[28rem] rounded-full bg-violet-600/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

        {/* ── ① 머리 띠(2026-10-24) — 큰 날짜·연도 | 분기 남은 영업일 칩 | 갱신 + [편집]. 장식은 아래 얇은 그라데이션 선 하나 ── */}
        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2 py-2">
          <p className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-2xl font-black tracking-tight text-white">{headDate(todayYmd)}</span>
            <span className="font-mono text-[12px] font-bold tabular-nums text-slate-500">{todayYmd.slice(0, 4)}</span>
          </p>
          <span className="order-3 inline-flex items-center rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-[11.5px] font-black text-slate-200 sm:order-none">
            {quarter}분기 <span className="mx-1 text-slate-600">·</span> 말일까지 <b className="mx-1 font-mono tabular-nums text-white">{bizLeft}</b>영업일
          </span>
          {/* 큰 숫자 3개(홈 3차) — 폰은 아래 줄 전체 폭, sm 부터 같은 줄 */}
          <span className="order-4 flex w-full min-w-0 items-baseline gap-x-3 sm:order-none sm:ml-auto sm:w-auto" aria-label="한눈 숫자">
            {([
              ["미처리", head.unhandled === null ? "—" : head.unhandled.toLocaleString("ko-KR"), head.unhandled ? "text-rose-200" : head.unhandled === 0 ? "text-emerald-300" : "text-slate-500"],
              ["OKR", head.okrPct === null ? "—" : `${head.okrPct}%`, head.okrPct === null ? "text-slate-500" : "text-white"],
              ["분기 점검(CS 전체)", head.inspectionPct === null ? "—" : `${head.inspectionPct}%`, head.inspectionPct === null ? "text-slate-500" : "text-white"],
            ] as const).map(([label, value, tone]) => (
              <span key={label} className="flex min-w-0 items-baseline gap-1">
                <span className="text-[11px] font-bold text-slate-400">{label}</span>
                <b className={`font-mono text-[18px] font-black tabular-nums ${tone}`}>{value}</b>
              </span>
            ))}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
            <span className="text-[11.5px] font-bold text-slate-400">갱신 {kpi ? relTime(new Date(kpi.bundle.loadedAt).toISOString()) : "불러오는 중"}</span>
            <button type="button" onClick={() => setEditing(!editing)} aria-pressed={editing}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12px] font-black transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${editing ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-white/[0.07] text-slate-200 hover:bg-white/[0.12]"}`}>
              {editing ? <><Check size={14} aria-hidden />완료</> : <><Pencil size={14} aria-hidden />편집</>}
            </button>
          </span>
        </div>
        <div aria-hidden className="relative h-px bg-linear-to-r from-transparent via-blue-400/60 to-transparent" />

        {/* ── ② CS KPI 현황판 ── */}
        <HomeKpiBoard
          onNavigate={(screen) => go(screen)}
          onOpenOverdue={openOverdue}
          onOpenReception={() => go("serviceReception")}
          onLoaded={setKpi}
          editing={editing}
          onEditingChange={setEditing}
        />

        {/* ── ③ 운영·시스템(접힘) — 전송 현황판·DB/시트 상태·비용·AI 에이전트 팀·업데이트. 지우지 않고 아래로(설계안 5절, Q12) ── */}
        <div className="relative border-b border-white/[0.08]">
          <button type="button" onClick={toggleOps} aria-expanded={opsOpen} aria-controls="home-ops"
            className="flex min-h-12 w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400 sm:px-6">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${opsDot}`} aria-hidden />
            <Server size={14} className="shrink-0 text-slate-400" aria-hidden />
            <span className="text-[12.5px] font-black text-slate-200">운영·시스템</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-500">
              {opsTone === "ok" ? "정상" : opsTone === "idle" ? "확인 중" : `${db.value} · 시트 ${sheet.value}`} · 전송 현황판 · 비용 · AI 에이전트 팀 · 업데이트
            </span>
            <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${opsOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {opsOpen && (
            <div id="home-ops">
              <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
                <StatusPill tone={db.tone} icon={Database} label="데이터베이스" value={db.value} />
                <StatusPill tone={sheet.tone} icon={ShieldCheck} label="시트 동기화" value={sheet.value} />
                <StatusPill tone="ok" icon={Zap} label="최근 배포" value={patchGroups[0] ? `${patchGroups[0][0]} · ${patchGroups[0][1].length}건 반영` : "-"} />
                <StatusPill tone="ok" icon={Bot} label="FIELD AI 에이전트 팀" value={agentPillValue} onClick={focusAgentTeam} />
                {/* 비용(AI 질문·문자) — 누르면 일별·실시간·지금까지 내역 */}
                <CostTile />
              </div>

              {/* 실시간 전송 현황판 — 모든 방 + 오늘 봇/노트북 배달 건수·흐름(접혀 있으면 그리지 않아 15초 폴링도 멈춤) */}
              <LiveSendBoard />

              <AgentTeamCard />

              {/* 릴리스 타임라인 */}
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
            </div>
          )}
          {data?.errors.length ? <div className="relative border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[11px] font-bold text-amber-200 sm:px-6">일부 운영 지표를 못 불러왔습니다: {data.errors.slice(0, 3).join(" · ")}</div> : null}
        </div>

        {/* ── ④ 피드백 보드 — 직원 불편·버그·개선점 → 개발자 답글·지시 → 컨펌(개발 대기) ── */}
        <FeedbackBoard author={author} />

        {/* ── ⑤ 시스템 푸터 ── */}
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3 font-mono text-[10.5px] font-bold text-slate-500 sm:px-6">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1"><span>FIRSTOA CS</span><span className="text-slate-700">|</span><span>build {patchGroups[0]?.[0] || "—"}</span><span className="text-slate-700">|</span><span>db supabase · seoul</span><span className="text-slate-700">|</span><span>edge vercel</span>{data && <><span className="text-slate-700">|</span><span>data {relTime(new Date(data.fetchedAt).toISOString())}</span></>}</span>
          <span className="flex items-center gap-1.5 text-slate-500"><Clock3 size={11} />KPI 60초(가벼운 원본)·5분(전체) · 운영 상태 60초 · 전송 현황 15초(펼쳤을 때만) · 새 기능 제안은 팀장·개발 담당에게</span>
        </div>
      </div>
    </div>
  );
}
