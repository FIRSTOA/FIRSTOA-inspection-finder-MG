/**
 * 홈 KPI 위젯 — 표시 전용(계산·조회 없음). 설계안 docs/tasks/home-kpi-dashboard.md 4-1절 · 개편 지시서 docs/tasks/home-redesign-2026-10-24.md.
 * 숫자는 kpiCompute.ts 가 내고 컨테이너(HomeKpiBoard)가 props 로 넣는다. kpi/* 중 import 하는 것은 팀 색(teamColors.ts)·타일 클래스(kpiTiles.ts) — 둘 다 계산 없음.
 *
 * 위젯 종류(kind): number 숫자 카드 · ring % 링 · teamBars 팀별 막대 · spark 추세 · progress 목표 진행 · list 밀린 일 목록
 *   + kpiTable KPI 달성표(주인공: 상태 알약·CS 전체·팀 칸·행 펼치기 = 팀 막대·개인 칩) · quarterGoal 분기 점검 진행(팀 5줄)
 *   + unhandledTotal 미처리 합산 카드 · okr OKR(링·판정 수·주별 막대) · todayStrip 금일 현황 칩 띠(가로 스크롤).
 * 로딩 상태(KpiLoadStatus): loading 뼈대 · ready 값 · empty "기록 없음" · error "—" + [다시] + 마지막 성공 값 · pending "준비 중"(원본 표 없음)
 *   → 로딩·오류·준비 중은 절대 0 으로 보이지 않는다(설계안 3절 원칙 5).
 *   ※ 옛 이름 KpiStatus(=로딩 상태)는 KpiLoadStatus 로 바꿨다. KpiStatus 는 지표 판정(달성·순항·부족·목표없음·준비 중).
 * 머리: 제목 · 기간 칩 · (i) 단추 = "숫자 기준: …" 펼침(폰은 hover 가 없어서 누르면 펼친다). 바닥: 기준 한 줄(말줄임, 전문은 title).
 * 톤: theme="deck"(기본, 홈 검은 판 #0B0F17 안의 반투명 카드) / "light"(흰 화면에 놓을 때).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Clock3, Info, Minus, RefreshCw, type LucideIcon } from "lucide-react";
import { TEAM_COLORS, teamColor, type TeamKey } from "./teamColors";
import { okrTeamFromFilter, okrTone, statusTileClass, teamCellDimmed } from "./kpiTiles";

/**
 * 화면 이동 단추(띠 칩 누르기·행 펼침 [화면 열기 →]·바닥 "자세히"·[워킨맵 →]) 보이기.
 * 사용자 2026-10-24 "버튼 누르면 자꾸 어디로 이동되는데 일단 필요 없어" → 끔. 타입(onOpen)은 그대로 — 되살리려면 true 로.
 */
export const SHOW_OPEN_LINKS = false;

// ── 타입(props) ─────────────────────────────────────────────────────────────
export type KpiSize = "1x1" | "2x1" | "2x2" | "4x1" | "4x2";
export type KpiTone = "ok" | "warn" | "bad" | "idle";
/** 위젯 로딩 상태(예전 이름 KpiStatus). */
export type KpiLoadStatus = "loading" | "ready" | "empty" | "error" | "pending";
export type KpiTheme = "deck" | "light";
export type KpiKind = "number" | "ring" | "teamBars" | "spark" | "progress" | "list" | "quarterGoal" | "kpiTable" | "unhandledTotal" | "okr" | "todayStrip";

/** 팀(A~E) 한 줄. target 이 있으면 막대에 목표선·상태색. */
export type KpiTeamValue = { team: string; label?: string; value: number; target?: number | null; tone?: KpiTone; sub?: string };
/** 추세 한 점(왼쪽=오래된 것, 오른쪽=오늘/이번 주). */
export type KpiSeriesPoint = { label: string; value: number };
/** 작은 꼬리표("미흡 2", "미착수 1"). */
export type KpiChip = { label: string; value?: number | string; tone?: KpiTone };
/** 밀린 일 한 줄. */
export type KpiListItem = { key: string; title: string; ageLabel?: string; badge?: string; meta?: string; tone?: KpiTone; onOpen?: () => void };

export type KpiNumberView = {
  kind: "number";
  value: number;
  unit: string;
  target?: number | null;
  prevValue?: number | null;
  prevLabel?: string;
  better?: "up" | "down";
  tone?: KpiTone;
  sub?: string;
  teams?: KpiTeamValue[];
  points?: KpiSeriesPoint[];
};
export type KpiRingView = {
  kind: "ring";
  numerator: number;
  denominator: number;
  unit?: string;
  pace?: number | null;            // 경과율 %(0~100)
  tone?: KpiTone;
  chips?: KpiChip[];
  teams?: KpiTeamValue[];
};
export type KpiTeamBarsView = {
  kind: "teamBars";
  unit: string;
  rows: KpiTeamValue[];
  target?: number | null;
  total?: number | null;
  legend?: string;
};
export type KpiSparkView = {
  kind: "spark";
  unit: string;
  points: KpiSeriesPoint[];
  value?: number | null;
  prevValue?: number | null;
  prevLabel?: string;
  better?: "up" | "down";
};
export type KpiProgressView = {
  kind: "progress";
  value: number;
  target: number;
  unit: string;
  pace?: number | null;
  remainLabel?: string;
  teams?: KpiTeamValue[];
};
export type KpiListView = {
  kind: "list";
  total: number;
  unit: string;
  items: KpiListItem[];
  chips?: KpiChip[];
  emptyText?: string;
};

// ── 개편(2026-10-24) 뷰 타입 — 구현서A 가 같은 모양으로 채운다 ───────────────────
/** 지표 판정: 달성·순항·부족·목표 없음·준비 중. */
export type KpiStatus = "done" | "onTrack" | "behind" | "none" | "pending";
/** 범위. E 는 화면에 "CSS". */
export type KpiScope = "CS" | "A" | "B" | "C" | "D" | "E";
/** total = 올해 누계(블로그 등, "올해 누계 n" 작은 글자) · sub = 보조 글자(오버홀 "수리 n점" 등) */
export type KpiPersonCell = { name: string; team: string; value: number; target: number | null; done: boolean; total?: number; sub?: string };
export type KpiTableRow = {
  id: string; name: string; unit: string; targetLabel: string; basis: string;
  status: KpiStatus; pace: number | null; // 기간 경과 0~1 (막대 점선)
  cells: Array<{ scope: KpiScope; value: number | null; target: number | null; status: KpiStatus }>;
  /** status = 팀 칸과 같은 판정(homeKpiModel 이 kpiRowStatus 로 채움) */
  teamBars: Array<{ team: string; value: number; target: number | null; pct: number | null; status: KpiStatus }>;
  people: KpiPersonCell[];
  trend?: { delta: number | null; label: string }; // 목표 없는 지표용
  cellState: "ready" | "pending" | "error"; pendingText?: string; main: boolean;
  /** 분기 점검 진행(K2) 행 펼침 — 있으면 팀 막대 대신 팀 5줄·기준일 칩·필요/지금 페이스(분기 점검 위젯과 같은 모양) */
  quarter?: KpiQuarterBlock;
  /** true 면 CS 전체 칸 옆에 회색 "지금" 칩(열린 건은 지난 시점 값이 없어 지금 값) — 계산은 모델이 한다 */
  nowChip?: boolean;
  onOpen?: () => void;
};
/** 기간 이동(2026-10-26) — 있으면 기간 칩 [주][월][분기] + ◀ 라벨 ▶ 스테퍼. 없으면 옛 화면 그대로 */
export type KpiTableCursor = { label: string; ended: boolean; canPrev: boolean; canNext: boolean; loading?: boolean; onStep: (dir: -1 | 1) => void; onToday: () => void };
export type KpiTableView = { kind: "kpiTable"; period: "week" | "month" | "quarter"; view: "main" | "all"; rows: KpiTableRow[]; counts: { main: number; all: number }; onPeriod: (p: "week" | "month" | "quarter") => void; onView: (v: "main" | "all") => void;
  /** 홈 3차 팀 카드 필터(2026-10-25) — 있으면 그 팀 칸은 그대로, 다른 팀 칸은 흐리게(opacity-40). CS 전체 열은 그대로. 없으면 지금처럼 */
  teamFilter?: TeamKey | null;
  /** 기간 이동 스테퍼(없으면 옛 모양) */
  cursor?: KpiTableCursor };
export type KpiQuarterGoalView = { kind: "quarterGoal"; basis: "end" | "early"; onBasis: (b: "end" | "early") => void; endLabel: string; bizDaysLeft: number; elapsed: number;
  teams: Array<{ team: string; done: number; total: number; pct: number; headcount: number; need: number | null; now: number | null }> };
/** 달성표 K2 행 안에 넣는 같은 블록(kind 없음) */
export type KpiQuarterBlock = Omit<KpiQuarterGoalView, "kind">;
export type KpiUnhandledTotalView = { kind: "unhandledTotal"; total: number; parts: Array<{ label: string; value: number | null; tone?: string }>; breakdown: Array<{ label: string; value: number; tone?: string }>; oldest?: string; weekDelta?: number | null; defs: Array<{ label: string; text: string }> };
/**
 * OKR 범위 필터: 팀 칩 [전체 n%/A n%/B/C/D] — 없으면 칩 없이 "CS 4파트(A~D)".
 * 홈 3차(2026-10-25 사용자 "개인 드롭다운 말고 C팀 누르면 이름 쭉"): 개인 드롭다운은 그리지 않는다 — 팀 칩을 누르면 팀원 목록(people).
 * member·members 는 옛 저장 범위·컨테이너 호환용으로 타입에만 남김(화면에서 고를 수 없음).
 */
export type KpiOkrScope = { team: "ALL" | "A" | "B" | "C" | "D"; member?: string; members?: string[]; onScope: (s: { team: "ALL" | "A" | "B" | "C" | "D"; member?: string }) => void };
/** 팀원 한 줄: 고른 주차 그 사람 판정 달성률·판정 수. missing = 그 주차 판정이 하나도 없음(0% 아님). prevPct = 바로 앞 주차 */
export type KpiOkrPerson = { name: string; pct: number | null; counts: { done: number; partial: number; poor: number; none: number }; missing: boolean; prevPct: number | null };
/** [전체] 칩의 팀 한 줄: 달성률 · 이번 주 보고 미작성 인원(이번 달 보기는 모름 → null) */
export type KpiOkrTeamLine = { team: string; pct: number | null; missing: number | null };
/**
 * 주차 한 칸(막대 겸 칩). id 가 있으면 누를 수 있다(onWeek). current = 이번 주, selected = 고른 주(없으면 current), future = 아직 안 온 주(비활성).
 * period 는 옛 캐시 호환으로만 남김 — 2026-10-25 부터 OKR 박스는 늘 "week"(월 보기 삭제, 달성표 K19 행에서 월·분기).
 */
export type KpiOkrWeek = { id?: string; label: string; pct: number | null; current: boolean; selected?: boolean; future?: boolean };
export type KpiOkrView = { kind: "okr"; period: "week" | "month"; pct: number | null; counts: Array<{ label: string; value: number; tone: string }>; weeks: KpiOkrWeek[]; missingTeams: string[];
  /** 고른 주차 id(없으면 이번 주) */
  weekId?: string;
  /** 주차 칩·막대를 누르면 — 컨테이너가 붙인다. 없으면 칩을 그리지 않는다 */
  onWeek?: (weekId: string) => void;
  scope?: KpiOkrScope;
  /** 파트별 미니 바(A~D 이번 기간 달성률). 모델 연결 전에는 비어 있어 그 구역을 그리지 않는다 — 다음 단계 */
  teams?: Array<{ team: string; pct: number | null }>;
  /** 머리 범위 글자(없으면 scope 로 만든다) — kpiCompute.okrScopeLabel 과 같은 글 */
  scopeLabel?: string;
  /** 홈 3차: [전체] 칩 % (고른 범위와 상관없이 A~D 전체) */
  allPct?: number | null;
  /** 홈 3차: 팀 칩 % 와 [전체] 칩의 팀 4줄(늘 A~D) */
  teamLines?: KpiOkrTeamLine[];
  /** 홈 3차: 팀 칩을 고르면 그 팀원 목록(고른 주차). [전체]는 빈 배열 */
  people?: KpiOkrPerson[];
  /** 홈 3차 팀 카드 필터 — 바뀌면 그 팀 칩으로 맞춘다(A~D 만, CSS·없음 = 전체) */
  teamFilter?: TeamKey | null };

/** 금일 현황 칩 하나. value=null 이면 "—", pending 이면 회색 "원본 연결 필요". */
export type KpiTodayItem = { key: string; label: string; value: number | null; unit: string; tone?: KpiTone; pending?: boolean; onOpen?: () => void };
export type KpiTodayStripView = { kind: "todayStrip"; items: KpiTodayItem[] };

export type KpiView = KpiNumberView | KpiRingView | KpiTeamBarsView | KpiSparkView | KpiProgressView | KpiListView | KpiQuarterGoalView | KpiTableView | KpiUnhandledTotalView | KpiOkrView | KpiTodayStripView;

export type KpiWidgetProps = {
  kind: KpiKind;                   // 로딩 중에도 뼈대 모양을 맞추려고 view 와 따로 받는다
  title: string;                   // kpiTable 은 "KPI 달성표" 만 — 기간("· 이번 주")은 위젯이 view.period 로 붙인다
  basis: string;                   // 앞에 "숫자 기준: "을 붙여 보여 준다
  status: KpiLoadStatus;
  view?: KpiView;                  // status=ready 일 때 필수(kind 가 다르면 빈 상태로 그림)
  period?: string;                 // "이번 주" 칩(kpiTable 은 안 그림 — 자체 기간 칩)
  icon?: LucideIcon;
  size?: KpiSize;
  theme?: KpiTheme;
  errorText?: string;
  lastOk?: { text: string; at?: string };
  pendingText?: string;
  emptyText?: string;
  onRetry?: () => void;
  onOpen?: () => void;
  openLabel?: string;
  disabled?: boolean;              // 편집 모드에서 그리드가 true — 눌러도 이동하지 않음
};

// ── 톤 ──────────────────────────────────────────────────────────────────────
type ThemeTokens = {
  card: string; title: string; text: string; sub: string; muted: string; track: string; chip: string;
  hover: string; divider: string; skeleton: string; link: string; ringTrack: string; tipBox: string; goalLine: string;
};
const THEMES: Record<KpiTheme, ThemeTokens> = {
  deck: {
    card: "border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
    title: "text-slate-400", text: "text-white", sub: "text-slate-400", muted: "text-slate-500",
    track: "bg-white/10", chip: "bg-white/[0.07] text-slate-300", hover: "hover:bg-white/[0.05]",
    divider: "divide-white/[0.06] border-white/[0.06]", skeleton: "bg-white/[0.07]", link: "text-blue-300 hover:text-white",
    ringTrack: "stroke-white/10", tipBox: "bg-slate-900/95 text-slate-200 border-white/10", goalLine: "border-white/70",
  },
  light: {
    card: "border border-slate-200 bg-white shadow-sm",
    title: "text-slate-500", text: "text-slate-900", sub: "text-slate-600", muted: "text-slate-400",
    track: "bg-slate-100", chip: "bg-slate-100 text-slate-600", hover: "hover:bg-slate-50",
    divider: "divide-slate-100 border-slate-100", skeleton: "bg-slate-100", link: "text-blue-600 hover:text-blue-800",
    ringTrack: "stroke-slate-100", tipBox: "bg-slate-50 text-slate-700 border-slate-200", goalLine: "border-slate-500/70",
  },
};
const TONE_TEXT: Record<KpiTheme, Record<KpiTone, string>> = {
  deck: { ok: "text-emerald-300", warn: "text-amber-300", bad: "text-rose-300", idle: "text-slate-400" },
  light: { ok: "text-emerald-600", warn: "text-amber-600", bad: "text-rose-600", idle: "text-slate-500" },
};
const TONE_BAR: Record<KpiTone, string> = { ok: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-500", idle: "bg-slate-400" };
const TONE_STROKE: Record<KpiTone, string> = { ok: "stroke-emerald-400", warn: "stroke-amber-400", bad: "stroke-rose-500", idle: "stroke-slate-400" };
const TONE_DOT: Record<KpiTone, string> = { ok: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-500", idle: "bg-slate-500" };
const NEUTRAL_BAR = "bg-gradient-to-r from-violet-500 to-blue-400";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";

// 지표 판정 색: 달성 초록 · 순항 파랑 · 부족 빨강 · 목표 없음 회색 · 준비 중 점선 회색
const STATUS_LABEL: Record<KpiStatus, string> = { done: "달성", onTrack: "순항", behind: "부족", none: "목표 없음", pending: "준비 중" };
const STATUS_PILL: Record<KpiTheme, Record<KpiStatus, string>> = {
  deck: {
    done: "bg-emerald-500/15 text-emerald-300", onTrack: "bg-sky-500/15 text-sky-300", behind: "bg-rose-500/15 text-rose-300",
    none: "bg-white/[0.07] text-slate-400", pending: "border border-dashed border-slate-500 text-slate-400",
  },
  light: {
    done: "bg-emerald-50 text-emerald-700", onTrack: "bg-sky-50 text-sky-700", behind: "bg-rose-50 text-rose-700",
    none: "bg-slate-100 text-slate-500", pending: "border border-dashed border-slate-300 text-slate-500",
  },
};
const STATUS_TEXT: Record<KpiTheme, Record<KpiStatus, string>> = {
  deck: { done: "text-emerald-300", onTrack: "text-sky-300", behind: "text-rose-300", none: "text-slate-300", pending: "text-slate-500" },
  light: { done: "text-emerald-600", onTrack: "text-sky-600", behind: "text-rose-600", none: "text-slate-600", pending: "text-slate-400" },
};
const STATUS_BAR: Record<KpiStatus, string> = { done: "bg-emerald-400", onTrack: "bg-sky-400", behind: "bg-rose-500", none: "bg-slate-400", pending: "bg-slate-500" };

// ── 표시용 작은 도우미(계산이 아니라 글자 만들기) ─────────────────────────────
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("ko-KR") : "—");
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const rate = (n: number) => (Number.isFinite(n) ? n.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—");
/** 팀 이름: 내부 E 는 화면에 CSS. */
const teamName = (s: string) => (s === "E" ? "CSS" : s);
const toneOf = (s?: string): KpiTone => (s === "ok" || s === "warn" || s === "bad" || s === "idle" ? s : "idle");
/** 목표 대비 % 와 경과율로 상태색. 경과율이 없으면 100% 이상만 초록, 나머지 회색. */
function toneFor(pct: number | null, pace?: number | null): KpiTone {
  if (pct === null) return "idle";
  if (pct >= 100) return "ok";
  if (pace === null || pace === undefined) return "idle";
  if (pct >= pace) return "ok";
  if (pct >= pace / 2) return "warn";
  return "bad";
}
function teamTone(t: KpiTeamValue, commonTarget?: number | null): KpiTone | null {
  if (t.tone) return t.tone;
  const target = t.target ?? commonTarget;
  if (!target) return null;
  if (t.value >= target) return "ok";
  if (t.value >= target / 2) return "warn";
  return "bad";
}
const isWide = (s?: KpiSize) => s === "2x1" || s === "2x2" || s === "4x1" || s === "4x2";
const isTall = (s?: KpiSize) => s === "2x2" || s === "4x2";

/** 숫자가 이전 값에서 올라간다(0.7초). 움직임 줄이기면 즉시 — Home.tsx useCountUp 과 같은 방식. */
function useCountUp(target: number, ms = 700) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(target)) { const id = requestAnimationFrame(() => setValue(target)); fromRef.current = target; return () => cancelAnimationFrame(id); }
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
function Big({ value, className }: { value: number; className: string }) {
  const v = useCountUp(value);
  return <span className={`tabular-nums ${className}`}>{fmt(v)}</span>;
}

// ── 공용 조각 ───────────────────────────────────────────────────────────────
function Delta({ value, prev, label = "지난주", better = "up", theme }: { value: number; prev: number; label?: string; better?: "up" | "down"; theme: KpiTheme }) {
  const diff = value - prev;
  const tones = TONE_TEXT[theme];
  if (diff === 0) return <span className={`inline-flex items-center gap-0.5 text-[11px] font-black ${tones.idle}`}><Minus size={12} aria-hidden />{label} 대비 같음</span>;
  const up = diff > 0;
  const good = better === "up" ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const r = prev > 0 ? `${up ? "+" : ""}${Math.round((diff / prev) * 100)}%` : `${up ? "+" : ""}${fmt(diff)}`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-black tabular-nums ${good ? tones.ok : tones.bad}`}>
      <Icon size={13} aria-hidden /><span className="sr-only">{up ? "증가" : "감소"} </span>{r}
      <span className="ml-0.5 font-bold opacity-70">{label} 대비</span>
    </span>
  );
}

function Chips({ chips, theme }: { chips: KpiChip[]; theme: KpiTheme }) {
  const t = THEMES[theme];
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c.label} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-black ${t.chip}`}>
          {c.tone && <span aria-hidden className={`size-1.5 rounded-full ${TONE_DOT[c.tone]}`} />}
          {c.label}{c.value !== undefined && <span className="font-mono tabular-nums">{typeof c.value === "number" ? fmt(c.value) : c.value}</span>}
        </span>
      ))}
    </div>
  );
}

/** 팀별 가로 막대 + 목표선(점선). 막대 길이 기준 = max(값, 목표). */
function TeamBarList({ rows, unit, target, theme, compact }: { rows: KpiTeamValue[]; unit: string; target?: number | null; theme: KpiTheme; compact?: boolean }) {
  const t = THEMES[theme];
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.target ?? target ?? 0)));
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2"}>
      {rows.map((r) => {
        const goal = r.target ?? target ?? null;
        const tone = teamTone(r, target);
        return (
          <li key={r.team} className="flex items-center gap-2.5" title={`${r.label || r.team} ${fmt(r.value)}${unit}${goal ? ` / 목표 ${fmt(goal)}${unit}` : ""}${r.sub ? ` · ${r.sub}` : ""}`}>
            <span className={`w-9 shrink-0 truncate text-[12px] font-black ${t.sub}`}>{r.label || r.team}</span>
            <span className={`relative h-2.5 flex-1 overflow-hidden rounded-full ${t.track}`}>
              <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 motion-reduce:transition-none ${tone ? TONE_BAR[tone] : NEUTRAL_BAR}`} style={{ width: `${clamp((r.value / max) * 100)}%` }} />
              {goal ? <span aria-hidden className={`absolute -inset-y-0.5 w-0 border-l-2 border-dashed ${t.goalLine}`} style={{ left: `${clamp((goal / max) * 100)}%` }} /> : null}
            </span>
            <span className={`w-14 shrink-0 text-right font-mono text-[11.5px] font-black tabular-nums ${t.text}`}>
              {fmt(r.value)}{goal ? <span className={t.muted}>/{fmt(goal)}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** 추세 선(SVG 직접 — 차트 라이브러리 없음). 마지막 점 강조. */
function Sparkline({ points, theme, height = 44, label }: { points: KpiSeriesPoint[]; theme: KpiTheme; height?: number; label: string }) {
  const t = THEMES[theme];
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (points.length < 2) return <div className={`grid place-items-center text-[11px] font-bold ${t.muted}`} style={{ height }}>추세를 그릴 점이 부족합니다</div>;
  const W = 100, H = 40, pad = 3;
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (H - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <figure className="m-0">
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={`${label} 추세: ${points.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
          <defs>
            <linearGradient id={`spark-${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgb(96,165,250)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="rgb(96,165,250)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,${H} ${line} ${W},${H}`} fill={`url(#spark-${gid})`} />
          <polyline points={line} fill="none" className="stroke-blue-400" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span aria-hidden className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-300 ring-2 ring-blue-400/30" style={{ left: "100%", top: `${(y(last.value) / H) * 100}%` }} />
      </div>
      <figcaption className={`mt-1 flex justify-between font-mono text-[9.5px] font-bold tabular-nums ${t.muted}`}>
        <span>{points[0].label}</span><span>{last.label}</span>
      </figcaption>
    </figure>
  );
}

function Ring({ pct, tone, theme, size = 76, textClass = "text-[18px]" }: { pct: number | null; tone: KpiTone; theme: KpiTheme; size?: number; textClass?: string }) {
  const t = THEMES[theme];
  const r = 30, c = 2 * Math.PI * r;
  const p = pct === null ? 0 : clamp(pct);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="8" className={t.ringTrack} />
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className={`${TONE_STROKE[tone]} transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none`} strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} />
      </svg>
      <span className={`absolute inset-0 grid place-items-center font-mono ${textClass} font-black tabular-nums ${t.text}`}>{pct === null ? "—" : `${pct}%`}</span>
    </div>
  );
}

/** 막대 + 기간 경과 점선(paceFrac 0~1). 색은 호출하는 쪽이 정한다. */
function Bar({ pct, barClass, paceFrac, theme, h = "h-2", label }: { pct: number | null; barClass: string; paceFrac?: number | null; theme: KpiTheme; h?: string; label?: string }) {
  const t = THEMES[theme];
  return (
    <span className={`relative block ${h} w-full overflow-hidden rounded-full ${t.track}`} role={label ? "progressbar" : undefined} aria-label={label} aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? 100 : undefined} aria-valuenow={label ? clamp(pct ?? 0) : undefined} aria-hidden={label ? undefined : true}>
      <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 motion-reduce:transition-none ${barClass}`} style={{ width: `${clamp(pct ?? 0)}%` }} />
      {paceFrac !== null && paceFrac !== undefined ? <span aria-hidden className={`absolute inset-y-0 w-0 border-l-2 border-dashed ${t.goalLine}`} style={{ left: `${clamp(paceFrac * 100)}%` }} /> : null}
    </span>
  );
}

// ── 본문(kind 별) ───────────────────────────────────────────────────────────
function NumberBody({ v, size, theme }: { v: KpiNumberView; size?: KpiSize; theme: KpiTheme }) {
  const t = THEMES[theme];
  const goalPct = v.target ? pctOf(v.value, v.target) : null;
  const wide = isWide(size);
  return (
    <div className={wide ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center" : ""}>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1">
          {v.tone && v.tone !== "idle" && <span aria-hidden className={`mr-1 size-2 self-center rounded-full ${TONE_DOT[v.tone]}`} />}
          <Big value={v.value} className={`text-[30px] font-black leading-none sm:text-[34px] ${t.text}`} />
          <span className={`text-[13px] font-black ${t.sub}`}>{v.unit}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {v.prevValue !== null && v.prevValue !== undefined && <Delta value={v.value} prev={v.prevValue} label={v.prevLabel} better={v.better} theme={theme} />}
          {v.target ? <span className={`text-[11px] font-black tabular-nums ${TONE_TEXT[theme][toneFor(goalPct)]}`}>목표 {fmt(v.target)}{v.unit} · {goalPct ?? 0}%</span> : null}
        </div>
        {v.sub && <div className={`mt-1 truncate text-[11px] font-bold ${t.sub}`} title={v.sub}>{v.sub}</div>}
      </div>
      {wide && v.teams?.length ? <TeamBarList rows={v.teams} unit={v.unit} theme={theme} compact /> : null}
      {wide && !v.teams?.length && v.points && v.points.length > 1 ? <Sparkline points={v.points} theme={theme} label={v.unit} /> : null}
      {isTall(size) && v.teams?.length && v.points && v.points.length > 1 ? <div className="sm:col-span-2"><Sparkline points={v.points} theme={theme} label={v.unit} /></div> : null}
    </div>
  );
}

function RingBody({ v, size, theme }: { v: KpiRingView; size?: KpiSize; theme: KpiTheme }) {
  const t = THEMES[theme];
  const pct = pctOf(v.numerator, v.denominator);
  const tone = v.tone ?? toneFor(pct, v.pace);
  const showTeams = (isWide(size) || isTall(size)) && v.teams?.length;
  return (
    <div className={showTeams ? "grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center" : ""}>
      <div className="flex items-center gap-3">
        <Ring pct={v.denominator > 0 ? pct : null} tone={tone} theme={theme} />
        <div className="min-w-0 space-y-1">
          <div className={`font-mono text-[12px] font-black tabular-nums ${t.text}`}>{fmt(v.numerator)}<span className={t.muted}> / {fmt(v.denominator)}{v.unit ? ` ${v.unit}` : ""}</span></div>
          {v.pace !== null && v.pace !== undefined && pct !== null && (
            <div className={`text-[11px] font-black ${TONE_TEXT[theme][tone]}`}>경과 {Math.round(v.pace)}% · {pct >= v.pace ? "앞섬" : "뒤짐"}</div>
          )}
          {v.chips?.length ? <Chips chips={v.chips} theme={theme} /> : null}
        </div>
      </div>
      {showTeams ? (
        <ul className="space-y-1.5">
          {v.teams!.map((r) => {
            const p = r.target ? pctOf(r.value, r.target) : null;
            const tt = r.tone ?? toneFor(p, v.pace);
            return (
              <li key={r.team} className="flex items-center gap-2.5" title={`${r.label || r.team} ${fmt(r.value)}/${fmt(r.target ?? 0)}`}>
                <span className={`w-9 shrink-0 truncate text-[12px] font-black ${t.sub}`}>{r.label || r.team}</span>
                <span className="flex-1"><Bar pct={p} barClass={TONE_BAR[tt]} paceFrac={v.pace !== null && v.pace !== undefined ? v.pace / 100 : null} theme={theme} /></span>
                <span className={`w-10 shrink-0 text-right font-mono text-[11px] font-black tabular-nums ${t.text}`}>{p === null ? "—" : `${p}%`}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function TeamBarsBody({ v, theme }: { v: KpiTeamBarsView; theme: KpiTheme }) {
  const t = THEMES[theme];
  return (
    <div>
      {(v.total !== null && v.total !== undefined) || v.legend ? (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          {v.total !== null && v.total !== undefined ? <span className="flex items-baseline gap-1"><Big value={v.total} className={`text-[24px] font-black leading-none ${t.text}`} /><span className={`text-[12px] font-black ${t.sub}`}>{v.unit}</span></span> : <span />}
          {v.legend && <span className={`text-[10.5px] font-bold ${t.muted}`}>{v.legend}</span>}
        </div>
      ) : null}
      <TeamBarList rows={v.rows} unit={v.unit} target={v.target} theme={theme} />
      {v.target ? <div className={`mt-1.5 flex items-center gap-1 text-[10px] font-bold ${t.muted}`}><span aria-hidden className="h-2.5 w-0 border-l-2 border-dashed border-current" />목표 {fmt(v.target)}{v.unit}</div> : null}
    </div>
  );
}

function SparkBody({ v, size, theme }: { v: KpiSparkView; size?: KpiSize; theme: KpiTheme }) {
  const t = THEMES[theme];
  const now = v.value ?? v.points[v.points.length - 1]?.value ?? 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="flex items-baseline gap-1"><Big value={now} className={`text-[26px] font-black leading-none ${t.text}`} /><span className={`text-[12px] font-black ${t.sub}`}>{v.unit}</span></span>
        {v.prevValue !== null && v.prevValue !== undefined && <Delta value={now} prev={v.prevValue} label={v.prevLabel} better={v.better} theme={theme} />}
      </div>
      <div className="mt-2"><Sparkline points={v.points} theme={theme} height={isTall(size) ? 120 : 44} label={v.unit} /></div>
    </div>
  );
}

function ProgressBody({ v, size, theme }: { v: KpiProgressView; size?: KpiSize; theme: KpiTheme }) {
  const t = THEMES[theme];
  const pct = pctOf(v.value, v.target);
  const tone = toneFor(pct, v.pace);
  const remain = Math.max(0, v.target - v.value);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-mono text-[24px] font-black leading-none tabular-nums ${t.text}`}>{fmt(v.value)}<span className={`text-[14px] ${t.muted}`}> / {fmt(v.target)}</span></span>
        <span className={`text-[12px] font-black ${t.sub}`}>{v.unit}</span>
        <span className={`ml-auto font-mono text-[14px] font-black tabular-nums ${TONE_TEXT[theme][tone]}`}>{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-2"><Bar pct={pct} barClass={TONE_BAR[tone]} paceFrac={v.pace !== null && v.pace !== undefined ? v.pace / 100 : null} theme={theme} h="h-3" label={`목표 대비 ${pct ?? 0}%`} /></div>
      <div className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-bold ${t.sub}`}>
        <span>{remain > 0 ? <>남은 <b className={`font-black tabular-nums ${t.text}`}>{fmt(remain)}</b>{v.unit}</> : <span className={TONE_TEXT[theme].ok}>목표 달성</span>}</span>
        {v.remainLabel && <span>{v.remainLabel}</span>}
        {v.pace !== null && v.pace !== undefined && <span className={t.muted}>점선 = 경과 {Math.round(v.pace)}%</span>}
      </div>
      {v.teams?.length ? (
        <ul className={`mt-2 grid gap-1 ${isWide(size) ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2"}`}>
          {v.teams.map((r) => {
            const tt = teamTone(r) ?? "idle";
            return (
              <li key={r.team} className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1 text-[11px] font-black ${t.chip}`}>
                <span>{r.label || r.team}</span>
                <span className={`font-mono tabular-nums ${TONE_TEXT[theme][tt]}`}>{fmt(r.value)}{r.target ? `/${fmt(r.target)}` : ""}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function ListBody({ v, size, theme, onOpen, disabled }: { v: KpiListView; size?: KpiSize; theme: KpiTheme; onOpen?: () => void; disabled?: boolean }) {
  const t = THEMES[theme];
  const tones = TONE_TEXT[theme];
  const limit = isTall(size) ? 8 : 3;
  const shown = v.items.slice(0, limit);
  const more = v.total - shown.length;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="flex items-baseline gap-1"><Big value={v.total} className={`text-[26px] font-black leading-none ${v.total ? tones.bad : tones.ok}`} /><span className={`text-[12px] font-black ${t.sub}`}>{v.unit}</span></span>
        {v.chips?.length ? <Chips chips={v.chips} theme={theme} /> : null}
      </div>
      {shown.length === 0 ? (
        <p className={`mt-2 rounded-xl border border-dashed px-3 py-3 text-center text-[12px] font-bold ${t.divider} ${tones.ok}`}>{v.emptyText || "밀린 일이 없습니다"}</p>
      ) : (
        <ul className={`mt-2 divide-y overflow-hidden rounded-xl border ${t.divider}`}>
          {shown.map((it) => {
            const open = SHOW_OPEN_LINKS ? it.onOpen || onOpen : undefined;
            const body = (
              <>
                {it.ageLabel && <span className={`w-12 shrink-0 text-[10.5px] font-black ${tones[it.tone || "idle"]}`}>{it.ageLabel}</span>}
                <span className={`min-w-0 flex-1 truncate text-[12.5px] font-bold ${t.text}`} title={it.title}>{it.title}</span>
                {it.badge && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${t.chip}`}>{it.badge}</span>}
                {it.meta && <span className={`hidden w-14 shrink-0 truncate text-right text-[11px] font-black sm:inline ${t.sub}`}>{it.meta}</span>}
              </>
            );
            return (
              <li key={it.key}>
                {open && !disabled
                  ? <button type="button" onClick={open} className={`flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left transition ${t.hover} ${focusRing}`}>{body}</button>
                  : <div className="flex min-h-11 items-center gap-2 px-3 py-1.5">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {more > 0 && <div className={`mt-1.5 text-[11px] font-bold ${t.muted}`}>외 {fmt(more)}{v.unit} 더 있습니다</div>}
    </div>
  );
}

/** 머리 칩 공용 모양(켜짐 = 흰/검정 반전). */
function chipClass(on: boolean, theme: KpiTheme) {
  const t = THEMES[theme];
  return `inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-[11.5px] font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${on ? (theme === "deck" ? "bg-white text-slate-950" : "bg-slate-900 text-white") : `${t.chip} ${t.hover}`}`;
}

// ── 분기 점검 진행(quarterGoal) — 팀 5줄만 ─────────────────────────────────
/** 지금 페이스가 필요 페이스 이상 = 초록, 80% 이상 = 노랑, 그 아래 = 빨강. */
function paceToneNum(need: number | null, now: number | null): KpiTone {
  if (need === null || now === null) return "idle";
  if (need <= 0 || now >= need) return "ok";
  return now >= need * 0.8 ? "warn" : "bad";
}

function QuarterGoalBody({ v, theme, disabled }: { v: KpiQuarterBlock; theme: KpiTheme; disabled?: boolean }) {
  const t = THEMES[theme];
  const tones = TONE_TEXT[theme];
  const elapsedPct = clamp(v.elapsed > 1 ? v.elapsed : v.elapsed * 100);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1" role="group" aria-label="기준일">
          <button type="button" aria-pressed={v.basis === "end"} disabled={disabled} onClick={() => v.onBasis("end")} className={chipClass(v.basis === "end", theme)}>말일</button>
          <button type="button" aria-pressed={v.basis === "early"} disabled={disabled} onClick={() => v.onBasis("early")} className={chipClass(v.basis === "early", theme)}>말일 10일 전</button>
        </div>
        <span className={`text-[11px] font-bold ${t.sub}`}>{v.endLabel} · 영업일 <b className={`font-mono font-black tabular-nums ${t.text}`}>{fmt(v.bizDaysLeft)}</b>일 남음</span>
      </div>
      {v.teams.length === 0 ? (
        <p className={`rounded-xl border border-dashed px-3 py-4 text-center text-[12px] font-bold ${t.divider} ${t.sub}`}>점검 대상 팀이 없습니다.</p>
      ) : (
        <ul className={`divide-y rounded-xl border ${t.divider}`}>
          {v.teams.map((r) => {
            const tone = toneFor(r.total > 0 ? r.pct : null, elapsedPct);
            const pt = paceToneNum(r.need, r.now);
            return (
              <li key={r.team} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`w-12 shrink-0 text-[12.5px] font-black ${t.text}`}>{teamName(r.team)}팀</span>
                  <span className={`font-mono text-[12.5px] font-black tabular-nums ${t.text}`}>{fmt(r.done)}<span className={t.muted}>/{fmt(r.total)}</span></span>
                  <span className={`ml-auto font-mono text-[14px] font-black tabular-nums ${r.total > 0 ? tones[tone] : t.muted}`}>{r.total > 0 ? `${Math.round(r.pct)}%` : "대상 없음"}</span>
                </div>
                <div className="mt-1.5"><Bar pct={r.total > 0 ? r.pct : 0} barClass={TONE_BAR[tone]} paceFrac={elapsedPct / 100} theme={theme} label={`${teamName(r.team)}팀 점검 ${Math.round(r.pct)}%`} /></div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] font-bold leading-5">
                  {r.need === null ? <span className={t.muted}>필요 페이스를 계산할 수 없습니다</span> : r.need <= 0 ? <span className={tones.ok}>목표 달성</span> : (
                    <>
                      <span className={t.text}>필요 <b className="font-mono font-black tabular-nums">{rate(r.need)}</b>/일·인</span>
                      <ArrowRight size={11} aria-hidden className={`self-center ${t.muted}`} />
                      <span className={tones[pt]}>지금 <b className="font-mono font-black tabular-nums">{r.now === null ? "—" : rate(r.now)}</b>/일·인</span>
                      {pt === "bad" || pt === "warn" ? <span className="sr-only">(필요 페이스보다 느립니다)</span> : null}
                    </>
                  )}
                  <span className={t.muted}>· {fmt(r.headcount)}명</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className={`mt-1.5 text-[10px] font-bold ${t.muted}`}>점선 = 기간 경과 {Math.round(elapsedPct)}%</div>
    </div>
  );
}

// ── KPI 달성표(kpiTable) ────────────────────────────────────────────────────
const PERIOD_LABEL: Record<KpiTableView["period"], string> = { week: "이번 주", month: "이번 달", quarter: "분기" };
const PERIOD_LABEL_SHORT: Record<KpiTableView["period"], string> = { week: "주", month: "월", quarter: "분기" };
const TEAM_SCOPES: KpiScope[] = ["A", "B", "C", "D", "E"];
/** PC 열: 지표 · 상태 · CS 전체 · 팀 5칸. */
const TABLE_GRID = "lg:grid lg:grid-cols-[minmax(0,1.7fr)_4.75rem_minmax(0,1.5fr)_repeat(5,minmax(0,1fr))]";

function StatusPill({ status, theme }: { status: KpiStatus; theme: KpiTheme }) {
  return <span className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black ${STATUS_PILL[theme][status]}`}>{STATUS_LABEL[status]}</span>;
}

/** 머리줄 팀 글자 배지(팀 색은 어두운 판 전용 — 밝은 판은 회색 칩) */
function TeamBadge({ team, theme, className = "", suffix = "" }: { team: string; theme: KpiTheme; className?: string; suffix?: string }) {
  const tc = teamColor(team);
  return <span className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-black ${tc && theme === "deck" ? tc.badge : THEMES[theme].chip} ${className}`}>{teamName(team)}{suffix}</span>;
}

const cellOf = (r: KpiTableRow, scope: KpiScope) => r.cells.find((c) => c.scope === scope);
const cellPct = (c?: { value: number | null; target: number | null }) => (c && c.value !== null && c.target ? Math.round((c.value / c.target) * 100) : null);
const placeholderText = (r: KpiTableRow) => (r.cellState === "error" ? "불러오지 못했습니다" : r.pendingText || "준비 중 · SQL 실행 대기");
const isPlaceholder = (r: KpiTableRow) => r.cellState !== "ready" || r.status === "pending";

function TrendMark({ trend, theme }: { trend?: KpiTableRow["trend"]; theme: KpiTheme }) {
  const t = THEMES[theme];
  if (!trend) return null;
  const d = trend.delta;
  const Icon = d === null || d === 0 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  const color = d === null || d === 0 ? t.muted : d > 0 ? TONE_TEXT[theme].ok : TONE_TEXT[theme].bad;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-black tabular-nums ${color}`}>
      <Icon size={13} aria-hidden />{d === null ? "비교 기록 없음" : `${d > 0 ? "+" : ""}${fmt(d)}`}<span className={`ml-0.5 font-bold ${t.muted}`}>{trend.label}</span>
    </span>
  );
}

function NowChip({ theme }: { theme: KpiTheme }) {
  return <span title="열린 건은 지난 시점 값이 없어 지금 값" className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-black ${THEMES[theme].chip}`}>지금</span>;
}

/** CS 전체 큰 숫자 + 막대. 목표 없으면 실적만 크게 + 추세. */
function CsSummary({ r, theme }: { r: KpiTableRow; theme: KpiTheme }) {
  const t = THEMES[theme];
  const c = cellOf(r, "CS");
  if (isPlaceholder(r)) return <span className={`text-[11.5px] font-black ${r.cellState === "error" ? TONE_TEXT[theme].bad : t.muted}`}>{placeholderText(r)}</span>;
  if (!c || c.value === null) return <span className={`text-[12px] font-black ${t.muted}`}>—</span>;
  if (!c.target) {
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`font-mono text-[24px] font-black leading-none tabular-nums lg:text-[28px] ${t.text}`}>{fmt(c.value)}<span className={`ml-1 font-sans text-[12px] font-bold ${t.sub}`}>{r.unit}</span></span>
          {r.nowChip && <NowChip theme={theme} />}
        </span>
        <TrendMark trend={r.trend} theme={theme} />
      </span>
    );
  }
  const pct = cellPct(c);
  return (
    <span className="flex min-w-0 flex-col gap-1.5" title={`${fmt(c.value)} / ${fmt(c.target)} · ${pct}%`}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`font-mono text-[24px] font-black leading-none tabular-nums lg:text-[28px] ${STATUS_TEXT[theme][c.status]}`}>{fmt(c.value)}<span className={`text-[15px] ${t.sub}`}>/{fmt(c.target)}</span></span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[13px] font-black tabular-nums ${STATUS_PILL[theme][c.status]}`}>{pct}%</span>
        {r.nowChip && <NowChip theme={theme} />}
      </span>
      <Bar pct={pct} barClass={STATUS_BAR[c.status]} paceFrac={r.pace} theme={theme} h="h-2.5" label={`${r.name} CS 전체 ${pct}%`} />
    </span>
  );
}

/**
 * 팀 칸 = 상태 타일(홈 3차 (나)): 상태색 옅은 배경 + 큰 %(상태색) + 아래 실적/목표(11px).
 * 목표 없는 칸은 회색 타일에 실적 큰 숫자, 기록 없는 칸은 회색 "—". mini = 폰 카드 아래 5칸 띠(팀 배지 + % 15px).
 */
function TeamCell({ c, scope, theme, dim, mini }: { c?: KpiTableRow["cells"][number]; scope: KpiScope; theme: KpiTheme; dim?: boolean; mini?: boolean }) {
  const t = THEMES[theme];
  const has = Boolean(c && c.value !== null);
  const hasTarget = has && Boolean(c!.target);
  const st: KpiStatus = has ? c!.status : "none";
  const pct = hasTarget ? cellPct(c) : null;
  const name = `${teamName(scope)}팀`;
  const said = !has ? `${name} 기록 없음` : hasTarget ? `${name} ${pct}% (${fmt(c!.value!)}/${fmt(c!.target!)}) ${STATUS_LABEL[st]}` : `${name} ${fmt(c!.value!)} 목표 없음`;
  const big = mini ? "text-[15px]" : "text-[18px]";
  return (
    <span className={`flex min-w-0 flex-col items-center justify-center rounded-lg px-1 text-center transition-opacity motion-reduce:transition-none ${mini ? "min-h-14 gap-1 py-1.5" : "min-h-12 gap-1 py-1.5"} ${statusTileClass(st, hasTarget, theme)} ${dim ? "opacity-40" : ""}`} title={said}>
      {mini && <TeamBadge team={scope} theme={theme} className="px-1! py-0!" />}
      <span aria-hidden className={`max-w-full truncate font-mono ${big} font-black leading-none tabular-nums ${hasTarget ? STATUS_TEXT[theme][st] : has ? t.text : t.muted}`}>
        {!has ? "—" : hasTarget ? `${pct}%` : fmt(c!.value!)}
      </span>
      {hasTarget && !mini && <span aria-hidden className={`max-w-full truncate font-mono text-[11px] font-bold tabular-nums ${t.sub}`}>{fmt(c!.value!)}/{fmt(c!.target!)}</span>}
      <span className="sr-only">{said}</span>
    </span>
  );
}

/** 펼친 내용: ⓐ 팀별 가로 막대 ⓑ 개인 칩(팀별 묶음) ⓒ 숫자 기준 + 화면 열기. */
export function RowDetail({ r, theme, disabled }: { r: KpiTableRow; theme: KpiTheme; disabled?: boolean }) {
  const t = THEMES[theme];
  const order = (team: string) => { const i = TEAM_SCOPES.indexOf(team as KpiScope); return i < 0 ? 99 : i; };
  const groups = new Map<string, KpiPersonCell[]>();
  for (const p of r.people) groups.set(p.team, [...(groups.get(p.team) ?? []), p]);
  const groupList = [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([team, list]) => [team, [...list].sort((a, b) => b.value - a.value)] as const);
  const paceFrac = r.pace;
  const empty = r.teamBars.length === 0 && r.people.length === 0 && !r.quarter;
  return (
    <div className="space-y-3">
      {r.quarter && <QuarterGoalBody v={r.quarter} theme={theme} disabled={disabled} />}
      {!r.quarter && r.teamBars.length > 0 && (
        <ul className="space-y-1.5" aria-label="팀별 실적">
          {r.teamBars.map((b) => {
            const pct = b.pct ?? (b.target ? Math.round((b.value / b.target) * 100) : null);
            const st: KpiStatus = b.status;
            return (
              <li key={b.team} className="flex items-center gap-2.5" title={`${teamName(b.team)} ${fmt(b.value)}${b.target ? ` / 목표 ${fmt(b.target)}` : ""}`}>
                <span className={`w-11 shrink-0 text-[12px] font-black ${t.sub}`}>{teamName(b.team)}</span>
                <span className="flex-1"><Bar pct={pct} barClass={STATUS_BAR[st]} paceFrac={b.target ? paceFrac : null} theme={theme} h="h-2.5" /></span>
                <span className={`w-24 shrink-0 text-right font-mono text-[11.5px] font-black tabular-nums ${t.text}`}>
                  {fmt(b.value)}{b.target ? <span className={t.muted}>/{fmt(b.target)}</span> : null}
                  <span className={`ml-1 ${STATUS_TEXT[theme][st]}`}>{pct === null ? "" : `${pct}%`}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {groupList.length > 0 && (
        <div className="space-y-2" aria-label="개인별 실적">
          {groupList.map(([team, list]) => (
            <div key={team} className="flex flex-wrap items-start gap-1.5">
              <span className={`mt-1 w-11 shrink-0 text-[11px] font-black ${t.muted}`}>{teamName(team)}</span>
              <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {list.map((p) => {
                  const cls = p.done ? STATUS_PILL[theme].done : p.target !== null ? STATUS_PILL[theme].behind : t.chip;
                  return (
                    <li key={`${p.team}-${p.name}`} className={`inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-[11.5px] font-black ${cls}`}>
                      <span>{p.name}</span>
                      <span className="font-mono tabular-nums">{fmt(p.value)}{p.target !== null ? `/${fmt(p.target)}` : ""}</span>
                      {p.sub ? <span className="text-[10px] font-bold opacity-75">{p.sub}</span> : null}
                      {p.total !== undefined ? <span className="text-[10px] font-bold opacity-75">올해 누계 <span className="font-mono tabular-nums">{fmt(p.total)}</span></span> : null}
                      <span className="sr-only">{p.done ? "달성" : p.target !== null ? "부족" : ""}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {empty && <p className={`text-[11.5px] font-bold ${t.sub}`}>팀·개인 세부 기록이 아직 없습니다.</p>}
      <div className={`flex flex-wrap items-center gap-x-3 border-t pt-1 ${t.divider}`}>
        <span className={`min-w-0 flex-1 py-1 text-[10.5px] font-semibold leading-4 ${t.muted}`}>숫자 기준: {r.basis}</span>
        {SHOW_OPEN_LINKS && r.onOpen && !disabled && (
          <button type="button" onClick={r.onOpen} className={`inline-flex min-h-11 items-center gap-0.5 px-1 text-[12px] font-black ${t.link} ${focusRing}`}>화면 열기<ArrowRight size={13} aria-hidden /></button>
        )}
      </div>
    </div>
  );
}

function RowName({ r, theme }: { r: KpiTableRow; theme: KpiTheme }) {
  const t = THEMES[theme];
  return (
    <span className="min-w-0">
      <span className={`block truncate text-[13px] font-black ${t.text}`} title={r.name}>{r.name}</span>
      <span className={`block truncate text-[10.5px] font-bold ${t.muted}`} title={`${r.unit} · ${r.targetLabel}`}>{r.unit} · {r.targetLabel}</span>
    </span>
  );
}

function KpiTableBody({ v, theme, disabled }: { v: KpiTableView; theme: KpiTheme; disabled?: boolean }) {
  const t = THEMES[theme];
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const periods = ["week", "month", "quarter"] as const;
  const cur = v.cursor;
  const periodText = cur ? PERIOD_LABEL_SHORT : PERIOD_LABEL;

  return (
    <div>
      {/* 기간 칩 · (스테퍼) · 보기 칩 */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex flex-wrap gap-1" role="group" aria-label="기간">
          {periods.map((p) => <button key={p} type="button" aria-pressed={v.period === p} disabled={disabled} onClick={() => v.onPeriod(p)} className={chipClass(v.period === p, theme)}>{periodText[p]}</button>)}
        </div>
        {cur && (
          <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="기간 이동">
            <button type="button" aria-label="이전 기간" disabled={disabled || !cur.canPrev} onClick={() => cur.onStep(-1)} className={chipClass(false, theme)}><ChevronLeft size={16} aria-hidden /></button>
            <span className={`flex min-h-11 min-w-0 items-center gap-1.5 px-1 text-[12px] font-black ${t.text}`} aria-live="polite">
              <span className="truncate">{cur.label}</span>
              {cur.ended && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black ${t.chip}`}>마감</span>}
              {cur.loading && <span className={`shrink-0 text-[10.5px] font-bold ${t.muted}`}>읽는 중…</span>}
            </span>
            <button type="button" aria-label="다음 기간" disabled={disabled || !cur.canNext} onClick={() => cur.onStep(1)} className={chipClass(false, theme)}><ChevronRight size={16} aria-hidden /></button>
            {cur.canNext && <button type="button" disabled={disabled} onClick={() => cur.onToday()} className={chipClass(false, theme)}>오늘로</button>}
          </div>
        )}
        <div className="flex flex-wrap gap-1" role="group" aria-label="보기">
          <button type="button" aria-pressed={v.view === "main"} disabled={disabled} onClick={() => v.onView("main")} className={chipClass(v.view === "main", theme)}>주요 목표<span className="font-mono opacity-70">{v.counts.main}</span></button>
          <button type="button" aria-pressed={v.view === "all"} disabled={disabled} onClick={() => v.onView("all")} className={chipClass(v.view === "all", theme)}>전체 지표<span className="font-mono opacity-70">{v.counts.all}</span></button>
        </div>
      </div>

      {v.rows.length === 0 ? (
        <p className={`rounded-xl border border-dashed px-3 py-4 text-center text-[12px] font-bold ${t.divider} ${t.sub}`}>
          {v.view === "main" ? "주요 목표로 정한 지표가 없습니다. [전체 지표]에서 모든 실적을 볼 수 있습니다." : "표시할 지표가 없습니다."}
        </p>
      ) : (
        <>
          {/* PC: 표 모양(가로 스크롤 없음) */}
          <div className={`hidden overflow-hidden rounded-xl border lg:block ${t.divider}`}>
            <div className={`${TABLE_GRID} items-end gap-2 border-b px-3 pb-2 pt-1.5 text-[11px] font-black ${t.divider} ${t.sub}`} role="row">
              <span>지표</span><span>상태</span><span>CS 전체</span>
              {TEAM_SCOPES.map((s) => (
                <span key={s} className={`flex justify-center pt-1.5 transition-opacity motion-reduce:transition-none ${theme === "deck" ? TEAM_COLORS[s as TeamKey].band : ""} ${teamCellDimmed(s, v.teamFilter) ? "opacity-40" : ""}`}>
                  <TeamBadge team={s} theme={theme} suffix="팀" />
                </span>
              ))}
            </div>
            <ul className={`divide-y ${t.divider}`}>
              {v.rows.map((r) => {
                const isOpen = open.has(r.id);
                const ph = isPlaceholder(r);
                return (
                  <li key={r.id} className={ph && r.cellState !== "error" ? "opacity-70" : ""}>
                    <button type="button" aria-expanded={ph ? undefined : isOpen} disabled={ph} onClick={() => toggle(r.id)} className={`${TABLE_GRID} min-h-16 w-full items-center gap-2 px-3 py-2 text-left ${ph ? "" : t.hover} ${focusRing}`}>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ChevronRight size={14} aria-hidden className={`shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""} ${ph ? "opacity-0" : t.muted}`} />
                        <RowName r={r} theme={theme} />
                      </span>
                      <StatusPill status={r.status} theme={theme} />
                      {ph ? (
                        <span className="col-span-6"><CsSummary r={r} theme={theme} /></span>
                      ) : (
                        <>
                          <CsSummary r={r} theme={theme} />
                          {TEAM_SCOPES.map((s) => <TeamCell key={s} c={cellOf(r, s)} scope={s} theme={theme} dim={teamCellDimmed(s, v.teamFilter)} />)}
                        </>
                      )}
                    </button>
                    {isOpen && !ph && <div className="px-3 pb-3 pl-9"><RowDetail r={r} theme={theme} disabled={disabled} /></div>}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 폰·태블릿: 지표 카드 목록(탭하면 펼침) */}
          <ul className="space-y-1.5 lg:hidden">
            {v.rows.map((r) => {
              const isOpen = open.has(r.id);
              const ph = isPlaceholder(r);
              return (
                <li key={r.id} className={`overflow-hidden rounded-xl border ${t.divider} ${ph && r.cellState !== "error" ? "opacity-70" : ""}`}>
                  <button type="button" aria-expanded={ph ? undefined : isOpen} disabled={ph} onClick={() => toggle(r.id)} className={`flex min-h-11 w-full flex-col gap-2 px-3 py-2.5 text-left ${ph ? "" : t.hover} ${focusRing}`}>
                    <span className="flex items-center gap-2">
                      <RowName r={r} theme={theme} />
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        <StatusPill status={r.status} theme={theme} />
                        {!ph && <ChevronDown size={15} aria-hidden className={`transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""} ${t.muted}`} />}
                      </span>
                    </span>
                    <CsSummary r={r} theme={theme} />
                    {!ph && (
                      <span className="grid grid-cols-5 gap-1" aria-label="팀별 달성">
                        {TEAM_SCOPES.map((s) => <TeamCell key={s} c={cellOf(r, s)} scope={s} theme={theme} dim={teamCellDimmed(s, v.teamFilter)} mini />)}
                      </span>
                    )}
                  </button>
                  {isOpen && !ph && <div className={`border-t px-3 pb-2 pt-2.5 ${t.divider}`}><RowDetail r={r} theme={theme} disabled={disabled} /></div>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// ── 미처리 합산(unhandledTotal) ─────────────────────────────────────────────
function UnhandledTotalBody({ v, theme }: { v: KpiUnhandledTotalView; theme: KpiTheme }) {
  const t = THEMES[theme];
  const tones = TONE_TEXT[theme];
  const [defsOpen, setDefsOpen] = useState(false);
  const defsId = useId();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-baseline gap-1">
          <Big value={v.total} className={`text-[34px] font-black leading-none ${v.total ? tones.bad : tones.ok}`} />
          <span className={`text-[13px] font-black ${t.sub}`}>건</span>
        </span>
        {v.weekDelta !== null && v.weekDelta !== undefined && <Delta value={v.total} prev={v.total - v.weekDelta} better="down" theme={theme} />}
        <button type="button" onClick={() => setDefsOpen((o) => !o)} aria-expanded={defsOpen} aria-controls={defsId} aria-label="미처리 뜻 풀이 보기" title="미처리 뜻 풀이" className={`-my-2 ml-auto grid size-11 shrink-0 place-items-center rounded-full ${t.muted} transition hover:text-current ${focusRing}`}>
          <Info size={15} aria-hidden />
        </button>
      </div>
      {v.total === 0 && v.parts.every((p) => p.value !== null) && <p className={`mt-1 text-[12px] font-black ${tones.ok}`}>미처리가 없습니다.</p>}
      {v.parts.length > 0 && (
        <p className={`mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] font-bold ${t.sub}`}>
          {v.parts.map((p, i) => (
            <span key={p.label} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className={t.muted}>·</span>}
              <span>{p.label} <b className={`font-mono font-black tabular-nums ${p.value !== null && p.value > 0 && p.tone ? tones[toneOf(p.tone)] : p.value === null ? t.muted : t.text}`}>{p.value === null ? "—" : fmt(p.value)}</b></span>
            </span>
          ))}
        </p>
      )}
      {v.breakdown.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-1">
          {v.breakdown.map((b) => (
            <li key={b.label} className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-[11px] font-black ${t.chip}`}>
              <span className="truncate">{b.label}</span>
              <span className={`font-mono tabular-nums ${b.value > 0 && b.tone ? tones[toneOf(b.tone)] : t.text}`}>{fmt(b.value)}</span>
            </li>
          ))}
        </ul>
      )}
      {v.oldest && <p className={`mt-2 truncate text-[11px] font-bold ${t.sub}`} title={v.oldest}>가장 오래된 건 · {v.oldest}</p>}
      {defsOpen && (
        <dl id={defsId} className={`mt-2 space-y-1.5 rounded-lg border px-2.5 py-2 text-[11px] leading-4 ${t.tipBox}`}>
          {v.defs.map((d) => (
            <div key={d.label}><dt className="font-black">{d.label}</dt><dd className="font-semibold opacity-90">{d.text}</dd></div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ── OKR(okr) ────────────────────────────────────────────────────────────────
const OKR_SCOPE_TEAMS = ["ALL", "A", "B", "C", "D"] as const;
/** kpiCompute.okrScopeLabel 과 같은 글(이 파일은 kpiCompute 를 import 하지 않아 여기 한 번 더) */
function okrScopeText(sc: KpiOkrScope | undefined, period: "week" | "month"): string {
  const when = period === "week" ? "이번 주" : "이번 달";
  if (!sc || sc.team === "ALL") return sc?.member ? `${sc.member} · ${when}` : `CS 4파트(A~D) · ${when}`;
  return sc.member ? `${sc.member}(${sc.team}) · ${when}` : `${sc.team}파트 · ${when}`;
}
const OKR_COUNT_BADGES: Array<{ key: keyof KpiOkrPerson["counts"]; label: string; tone: KpiTone }> = [
  { key: "done", label: "완료", tone: "ok" }, { key: "partial", label: "부분", tone: "warn" }, { key: "poor", label: "미흡", tone: "warn" }, { key: "none", label: "미착수", tone: "bad" },
];

/**
 * 홈 3차(2026-10-25): 칩 [전체 n%][●A n%]…[●D n%] → 팀 칩을 누르면 오른쪽에 그 팀원 이름이 쭉(이름·막대·%·판정 수, 미작성은 빨간 점선 줄).
 * [전체]·[이번 달] = 팀 4줄(팀 배지·막대·%·미작성 n명). 왼쪽 작은 칸 = 링 + 이번 달 주별 막대. 개인 드롭다운 없음.
 * 2026-10-25 주차 칩(사용자 "1,2,3,4주차 보이는 게 나을 듯, 달보단"): [주|월] 대신 [1주]…[4주]([5주]) — 링·팀 4줄·팀원 목록 전부 고른 주차. 주별 막대도 누르면 그 주.
 */
function OkrBody({ v, size, theme, disabled }: { v: KpiOkrView; size?: KpiSize; theme: KpiTheme; disabled?: boolean }) {
  const t = THEMES[theme];
  const tones = TONE_TEXT[theme];
  const sc = v.scope;
  // 고른 주차(없으면 이번 주) — 글자: 이번 주면 "이번 주/지난주", 다른 주면 "2주/앞 주"
  const sel = v.weeks.find((w) => w.selected) ?? v.weeks.find((w) => w.current);
  const isCur = v.period === "week" && (!sel || sel.current);
  const whenWord = v.period === "month" ? "이번 달" : isCur ? "이번 주" : `${sel?.label ?? ""}`;
  const prevWord = isCur ? "지난주" : "앞 주";
  const label = v.scopeLabel || okrScopeText(sc, v.period);
  const wide = isWide(size);
  const segBtn = (on: boolean) => `inline-flex min-h-11 items-center justify-center gap-1 rounded-full px-3 text-[12px] font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${on ? (theme === "deck" ? "bg-white text-slate-950" : "bg-slate-900 text-white") : `${t.sub} ${t.hover}`}`;
  const weekBar = (on: boolean) => (on ? "bg-sky-400" : theme === "deck" ? "bg-slate-500" : "bg-slate-300");
  const isSel = (w: KpiOkrView["weeks"][number]) => (sel ? w === sel : w.current);
  const canPick = (w: KpiOkrView["weeks"][number]) => Boolean(v.onWeek && w.id && !w.future);
  // 주차 칩: 고른 주 = 채움, 이번 주 = 하늘색 점, 아직 안 온 주 = 회색 비활성, 판정 없는 주 = 점선
  const weekChip = (w: KpiOkrView["weeks"][number]) => {
    const on = isSel(w);
    const dashed = !on && !w.future && w.pct === null ? `border border-dashed ${t.divider}` : "";
    return `${segBtn(on)} ${on ? "" : theme === "deck" ? "bg-white/[0.05]" : "bg-slate-100"} ${dashed} min-w-11 px-2.5 ${w.future ? "opacity-40" : ""}`;
  };
  // 칩 % 와 팀 4줄: 새 모델(teamLines) — 옛 캐시 보기면 teams 로 대신(미작성 인원 모름)
  const lines: KpiOkrTeamLine[] = v.teamLines ?? (v.teams ?? []).map((x) => ({ team: x.team, pct: x.pct, missing: null }));
  const chipPct = (tm: (typeof OKR_SCOPE_TEAMS)[number]): number | null | undefined => (tm === "ALL" ? v.allPct : lines.find((l) => l.team === tm)?.pct);
  const people = v.people ?? [];
  const showPeople = Boolean(sc && sc.team !== "ALL" && v.period === "week");
  const pickWeek = (w: KpiOkrView["weeks"][number]) => { if (canPick(w) && w.id) v.onWeek?.(w.id); };

  // 팀 카드 필터가 바뀌면 그 팀 칩으로(처음 그릴 때 필터가 있으면 그 팀으로 시작). 필터 없이 처음 그릴 때는 고른 범위를 건드리지 않는다
  const seenFilter = useRef<TeamKey | null | undefined>(undefined);
  useEffect(() => {
    const f = v.teamFilter;
    if (f === undefined || seenFilter.current === f) return;
    const first = seenFilter.current === undefined;
    seenFilter.current = f;
    if (!sc || (first && f === null)) return;
    const want = okrTeamFromFilter(f);
    if (sc.team !== want || sc.member) sc.onScope({ team: want });
  }, [v.teamFilter, sc]);

  const weeksBlock = v.weeks.length > 0 ? (
    <ul className="grid w-full gap-1" style={{ gridTemplateColumns: `repeat(${v.weeks.length}, minmax(0, 1fr))` }} aria-label={v.period === "week" ? "이번 달 주별 달성률(누르면 그 주)" : "월별 달성률"}>
      {v.weeks.map((w) => {
        const on = isSel(w);
        const inner = (
          <>
            <span className={`font-mono text-[11px] font-black tabular-nums ${on ? t.text : t.sub}`}>{w.future ? "" : w.pct === null ? "—" : `${w.pct}`}</span>
            <span className={`relative flex h-12 w-full max-w-7 items-end overflow-hidden rounded-md ${t.track} ${on ? "ring-2 ring-sky-400" : w.current ? "ring-1 ring-sky-400/50" : ""}`}>
              {w.pct === null
                ? <span aria-hidden className={`absolute inset-x-0 bottom-0 border-t border-dashed ${t.divider}`} />
                : <span className={`w-full rounded-md ${weekBar(on)}`} style={{ height: `${Math.max(6, clamp(w.pct))}%` }} />}
            </span>
            <span className={`whitespace-nowrap text-[11px] font-black ${on ? t.text : t.muted}`}>{w.label}{w.current && <span className="sr-only"> (이번 주)</span>}</span>
          </>
        );
        const tip = `${w.label} ${w.future ? "아직 안 옴" : w.pct === null ? "기록 없음" : `${w.pct}%`}`;
        return (
          <li key={w.id ?? w.label} className={`min-w-0 ${w.future ? "opacity-40" : ""}`} title={tip}>
            {canPick(w)
              ? <button type="button" aria-pressed={on} aria-label={tip} disabled={disabled} onClick={() => pickWeek(w)} className={`flex w-full min-w-0 flex-col items-center gap-0.5 rounded-md ${focusRing} disabled:cursor-not-allowed`}>{inner}</button>
              : <div className="flex min-w-0 flex-col items-center gap-0.5">{inner}</div>}
          </li>
        );
      })}
    </ul>
  ) : <p className={`text-[11.5px] font-bold ${t.muted}`}>—</p>;

  const peopleList = people.length === 0 ? (
    <p className={`rounded-lg border border-dashed px-3 py-3 text-center text-[12px] font-bold ${t.divider} ${t.sub}`}>{sc?.team}파트 이번 달 개인 보고 기록이 없습니다.</p>
  ) : (
    <ul className="space-y-1.5" aria-label={`${sc?.team}파트 팀원 ${whenWord} 달성률`}>
      {people.map((p) => p.missing ? (
        <li key={p.name} className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-dashed px-2.5 py-1.5 text-[12px] font-black ${theme === "deck" ? "border-rose-400/60" : "border-rose-300"} ${tones.bad}`}>
          <span className={`w-14 shrink-0 truncate ${t.text}`} title={p.name}>{p.name}</span>
          <span className="min-w-0">{whenWord} 보고 미작성 · {prevWord} <span className="font-mono tabular-nums">{p.prevPct === null ? "기록 없음" : `${p.prevPct}%`}</span></span>
        </li>
      ) : (
        <li key={p.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5" title={`${p.name} ${p.pct === null ? "판정 없음" : `${p.pct}%`}`}>
          <span className={`w-14 shrink-0 truncate text-[12.5px] font-black ${t.text}`}>{p.name}</span>
          <span className="min-w-16 flex-1"><Bar pct={p.pct} barClass={TONE_BAR[okrTone(p.pct)]} theme={theme} h="h-2.5" label={`${p.name} ${p.pct ?? 0}%`} /></span>
          <span className={`w-10 shrink-0 text-right font-mono text-[12.5px] font-black tabular-nums ${p.pct === null ? t.muted : tones[okrTone(p.pct)]}`}>{p.pct === null ? "—" : `${p.pct}%`}</span>
          <span className="flex shrink-0 flex-wrap gap-1">
            {OKR_COUNT_BADGES.map((c) => (
              <span key={c.key} className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-black ${t.chip} ${p.counts[c.key] ? "" : "opacity-50"}`}>
                {p.counts[c.key] > 0 && <span aria-hidden className={`size-1.5 rounded-full ${TONE_DOT[c.tone]}`} />}{c.label}<span className="font-mono tabular-nums">{p.counts[c.key]}</span>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );

  const teamList = lines.length > 0 ? (
    <ul className="space-y-1.5" aria-label={`파트별 ${whenWord} 달성률`}>
      {lines.map((r) => {
        const on = sc ? sc.team === r.team : false;
        return (
          <li key={r.team} className={`flex items-center gap-2 ${sc && sc.team !== "ALL" && !on ? "opacity-60" : ""}`} title={`${teamName(r.team)}파트 ${r.pct === null ? "기록 없음" : `${r.pct}%`}`}>
            <TeamBadge team={r.team} theme={theme} className="w-8 shrink-0" />
            <span className="min-w-12 flex-1"><Bar pct={r.pct} barClass={TONE_BAR[okrTone(r.pct)]} theme={theme} h={on ? "h-3" : "h-2.5"} /></span>
            <span className={`w-10 shrink-0 text-right font-mono text-[12.5px] font-black tabular-nums ${r.pct === null ? t.muted : tones[okrTone(r.pct)]}`}>{r.pct === null ? "—" : `${r.pct}%`}</span>
            {r.missing !== null && <span className={`shrink-0 text-right text-[11px] font-black ${r.missing > 0 ? tones.bad : t.muted}`}>{r.missing > 0 ? `미작성 ${r.missing}명` : "미작성 없음"}</span>}
          </li>
        );
      })}
    </ul>
  ) : null;

  return (
    <div className="space-y-3">
      {/* 머리: 범위·주차 글자 + 주차 칩 [1주][2주][3주][4주]([5주]) — 2026-10-25 [주|월] 대신. 월 보기는 달성표 K19 행에서 */}
      <p className={`min-w-0 truncate text-[12.5px] font-black ${t.text}`} title={label} aria-live="polite">{label}</p>
      {v.onWeek && v.weeks.some((w) => w.id) && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="OKR 주차">
          {v.weeks.map((w) => (
            <button key={w.id ?? w.label} type="button" aria-pressed={isSel(w)} disabled={disabled || !canPick(w)} onClick={() => pickWeek(w)}
              title={w.future ? `${w.label} 아직 안 옴` : w.pct === null ? `${w.label} 보고 없음` : `${w.label} ${w.pct}%`} className={weekChip(w)}>
              {w.current && <span aria-hidden className="size-1.5 rounded-full bg-sky-400" />}
              <span>{w.label}</span>
              {w.current && <span className="sr-only">(이번 주)</span>}
            </button>
          ))}
        </div>
      )}
      {/* 범위 칩: [전체 n%] [●A n%] … — 칩 안에 %, 팀 색은 점에만 */}
      {sc && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="OKR 범위(파트)">
          {OKR_SCOPE_TEAMS.map((tm) => {
            const on = sc.team === tm && !sc.member;
            const p = chipPct(tm);
            const tc = tm === "ALL" ? null : teamColor(tm);
            return (
              <button key={tm} type="button" aria-pressed={on} disabled={disabled} onClick={() => sc.onScope({ team: tm })} className={`${segBtn(on)} ${on ? "" : theme === "deck" ? "bg-white/[0.05]" : "bg-slate-100"} px-2.5`}>
                {tc && <span aria-hidden className={`size-2 rounded-full ${tc.dot}`} />}
                <span>{tm === "ALL" ? "전체" : tm}</span>
                {p !== undefined && <span className="font-mono tabular-nums opacity-80">{p === null ? "—" : `${p}%`}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* 본문: 왼쪽 작은 칸(링 + 주별 막대, 고른 주차) · 오른쪽 팀원 목록(팀 칩·고른 주차) 또는 팀 4줄. 폰은 위아래로(1x1 은 링 + 주별 막대만) */}
      <div className={wide ? "grid gap-3 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-start" : "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3"}>
        <div className={wide ? "flex items-center gap-3 sm:flex-col sm:items-stretch" : "flex flex-col items-center gap-1"}>
          <div className="flex flex-col items-center gap-1" title={v.scope?.member ? "개인 = 그 주차 판정 중 완료·해당없음 비율" : "팀 달성률 = 팀원별 달성률 평균(미작성 0%) · 전체 = A~D 팀원 전부 평균"}>
            <Ring pct={v.pct} tone={okrTone(v.pct)} theme={theme} size={wide ? 96 : 88} textClass={wide ? "text-[24px]" : "text-[20px]"} />
            {v.pct === null && <span className={`max-w-28 text-center text-[11px] font-black leading-4 ${t.muted}`}>{whenWord} 판정 기록이 아직 없습니다</span>}
          </div>
          {wide && <div className="min-w-0 flex-1">{weeksBlock}</div>}
        </div>
        <div className="min-w-0">
          {wide ? (showPeople ? peopleList : teamList) : weeksBlock}
        </div>
      </div>

      {/* 판정 수: 색 점 한 줄 */}
      {wide && v.counts.length > 0 && (
        <ul className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-black ${t.sub}`} aria-label="판정 수">
          {v.counts.map((c, i) => (
            <li key={c.label} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className={`-ml-1.5 mr-1.5 ${t.muted}`}>·</span>}
              <span aria-hidden className={`size-2 rounded-full ${TONE_DOT[toneOf(c.tone)]}`} />{c.label} <span className={`font-mono tabular-nums ${t.text}`}>{fmt(c.value)}</span>
            </li>
          ))}
        </ul>
      )}

      {v.missingTeams.length > 0 && (
        <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] font-black leading-4 ${tones.bad}`}>
          <span className="inline-flex items-center gap-1"><AlertTriangle size={13} aria-hidden />OKR 미작성</span>
          {v.missingTeams.map((m) => <TeamBadge key={m} team={m} theme={theme} />)}
        </p>
      )}
    </div>
  );
}

// ── 금일 현황 띠(todayStrip) ────────────────────────────────────────────────
function TodayStripBody({ v, theme, disabled }: { v: KpiTodayStripView; theme: KpiTheme; disabled?: boolean }) {
  const t = THEMES[theme];
  if (v.items.length === 0) return <p className={`text-[12px] font-bold ${t.sub}`}>오늘 보여 드릴 항목이 없습니다.</p>;
  return (
    <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:thin]" aria-label="오늘 현황">
      {v.items.map((it) => {
        const inner = (
          <>
            <span className={`flex items-center gap-1 text-[10.5px] font-black ${t.sub}`}>
              {it.tone && <span aria-hidden className={`size-1.5 rounded-full ${TONE_DOT[it.tone]}`} />}{it.label}
            </span>
            {it.pending
              ? <span className={`text-[11px] font-black ${t.muted}`}>원본 연결 필요</span>
              : <span className={`font-mono text-[18px] font-black leading-none tabular-nums ${it.value === null ? t.muted : t.text}`}>{it.value === null ? "—" : fmt(it.value)}<span className={`ml-0.5 font-sans text-[11px] ${t.sub}`}>{it.unit}</span></span>}
          </>
        );
        const box = `flex min-h-11 shrink-0 snap-start flex-col justify-center gap-1 rounded-xl px-3 py-2 ${t.chip} ${it.pending ? "opacity-60" : ""}`;
        return (
          <li key={it.key} className="shrink-0">
            {SHOW_OPEN_LINKS && it.onOpen && !disabled && !it.pending
              ? <button type="button" onClick={it.onOpen} aria-label={`오늘 ${it.label} ${it.value === null ? "값 없음" : `${it.value}${it.unit}`} — 화면 열기`} className={`${box} text-left transition ${t.hover} ${focusRing}`}>{inner}</button>
              : <div className={box}>{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

// ── 상태(로딩·빈·오류·준비 중) ────────────────────────────────────────────────
function Skeleton({ kind, theme }: { kind: KpiKind; theme: KpiTheme }) {
  const s = THEMES[theme].skeleton;
  if (kind === "ring" || kind === "okr") return <div className="flex items-center gap-3" aria-hidden><span className={`size-19 animate-pulse rounded-full ${s}`} /><span className="flex-1 space-y-2"><span className={`block h-3 w-20 animate-pulse rounded ${s}`} /><span className={`block h-3 w-14 animate-pulse rounded ${s}`} /></span></div>;
  if (kind === "todayStrip") return <div className="flex gap-2 overflow-hidden" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={`h-11 w-24 shrink-0 animate-pulse rounded-xl ${s}`} />)}</div>;
  if (kind === "kpiTable") return <div className="space-y-2" aria-hidden><span className={`block h-11 w-2/3 animate-pulse rounded-full ${s}`} />{[0, 1, 2, 3].map((i) => <span key={i} className={`block h-12 animate-pulse rounded-xl ${s}`} />)}</div>;
  if (kind === "teamBars" || kind === "list" || kind === "quarterGoal") return <div className="space-y-2.5" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={`block h-3 animate-pulse rounded ${s}`} />)}</div>;
  if (kind === "spark") return <div aria-hidden><span className={`block h-7 w-20 animate-pulse rounded ${s}`} /><span className={`mt-2 block h-11 animate-pulse rounded ${s}`} /></div>;
  return <div aria-hidden><span className={`block h-8 w-24 animate-pulse rounded ${s}`} /><span className={`mt-2 block h-3 w-32 animate-pulse rounded ${s}`} /></div>;
}

function ErrorBody({ theme, text, lastOk, onRetry, disabled }: { theme: KpiTheme; text?: string; lastOk?: KpiWidgetProps["lastOk"]; onRetry?: () => void; disabled?: boolean }) {
  const t = THEMES[theme];
  return (
    <div role="alert">
      <div className="flex items-baseline gap-2">
        <span className={`text-[30px] font-black leading-none ${t.muted}`} aria-label="값 없음">—</span>
        <span className={`inline-flex items-center gap-1 text-[11.5px] font-black ${TONE_TEXT[theme].bad}`}><AlertTriangle size={13} aria-hidden />{text || "불러오지 못했습니다"}</span>
      </div>
      {lastOk && <div className={`mt-1.5 flex items-center gap-1 text-[11px] font-bold ${t.sub}`}><Clock3 size={12} aria-hidden />마지막 값 {lastOk.text}{lastOk.at ? ` · ${lastOk.at}` : ""}</div>}
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={disabled} className={`mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-[12px] font-black transition disabled:opacity-50 ${t.chip} ${t.hover} ${focusRing}`}>
          <RefreshCw size={14} aria-hidden />다시 불러오기
        </button>
      )}
    </div>
  );
}

// ── 위젯 ────────────────────────────────────────────────────────────────────
/** 빈 상태에서 "0" 을 크게 보이면 안 되는 종류(표·진행·OKR·합산은 글자만). */
const NO_ZERO_EMPTY: KpiKind[] = ["kpiTable", "quarterGoal", "okr", "unhandledTotal"];
/** 본문 전체를 단추로 만들면 안쪽 단추와 겹치는 종류. */
const NO_BODY_BUTTON: KpiKind[] = ["list", "kpiTable", "todayStrip", "quarterGoal", "unhandledTotal", "okr"];

/**
 * KPI 위젯 하나. 그리드 칸을 꽉 채운다(h-full). onOpen 이 있으면 본문 전체가 단추(안쪽 단추가 있는 종류는 바닥 "자세히" 만).
 */
export function KpiWidget(props: KpiWidgetProps) {
  const { kind, title, basis, status, view, period, icon: Icon, size = "1x1", theme = "deck", onOpen, openLabel = "자세히", disabled } = props;
  const t = THEMES[theme];
  const [tipOpen, setTipOpen] = useState(false);
  const tipId = useId();
  const basisText = `숫자 기준: ${basis}`;
  const ready = status === "ready" && view && view.kind === kind;
  const effective: KpiLoadStatus = status === "ready" && !ready ? "empty" : status;
  const isTable = kind === "kpiTable";
  const headTitle = isTable && view?.kind === "kpiTable" ? `${title} · ${view.cursor ? view.cursor.label : PERIOD_LABEL[view.period]}` : title;

  let body: ReactNode;
  if (effective === "loading") body = <Skeleton kind={kind} theme={theme} />;
  else if (effective === "error") body = <ErrorBody theme={theme} text={props.errorText} lastOk={props.lastOk} onRetry={props.onRetry} disabled={disabled} />;
  else if (effective === "pending") body = (
    <div>
      <span className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-500 px-2.5 py-1 text-[12px] font-black ${t.sub}`}><span aria-hidden className="size-1.5 rounded-full bg-slate-400" />준비 중</span>
      <p className={`mt-2 text-[11.5px] font-bold leading-4 ${t.sub}`}>{props.pendingText || "원본 표가 준비되면 표시됩니다."}</p>
    </div>
  );
  else if (effective === "empty") body = kind === "list"
    ? <p className={`rounded-xl border border-dashed px-3 py-3 text-center text-[12px] font-bold ${t.divider} ${TONE_TEXT[theme].ok}`}>{props.emptyText || "밀린 일이 없습니다"}</p>
    : NO_ZERO_EMPTY.includes(kind)
      ? <p className={`rounded-xl border border-dashed px-3 py-4 text-center text-[12px] font-bold ${t.divider} ${t.sub}`}>{props.emptyText || "보여 드릴 기록이 아직 없습니다."}</p>
      : (
        <div>
          <span className={`text-[30px] font-black leading-none tabular-nums ${t.muted}`}>0</span>
          <p className={`mt-1.5 text-[11.5px] font-bold ${t.sub}`}>{props.emptyText || "이 기간에 기록이 없습니다"}</p>
        </div>
      );
  else {
    const v = view!;
    body = v.kind === "number" ? <NumberBody v={v} size={size} theme={theme} />
      : v.kind === "ring" ? <RingBody v={v} size={size} theme={theme} />
      : v.kind === "teamBars" ? <TeamBarsBody v={v} theme={theme} />
      : v.kind === "spark" ? <SparkBody v={v} size={size} theme={theme} />
      : v.kind === "progress" ? <ProgressBody v={v} size={size} theme={theme} />
      : v.kind === "quarterGoal" ? <QuarterGoalBody v={v} theme={theme} disabled={disabled} />
      : v.kind === "kpiTable" ? <KpiTableBody v={v} theme={theme} disabled={disabled} />
      : v.kind === "unhandledTotal" ? <UnhandledTotalBody v={v} theme={theme} />
      : v.kind === "okr" ? <OkrBody v={v} size={size} theme={theme} disabled={disabled} />
      : v.kind === "todayStrip" ? <TodayStripBody v={v} theme={theme} disabled={disabled} />
      : <ListBody v={v} size={size} theme={theme} onOpen={onOpen} disabled={disabled} />;
  }

  const bodyClickable = SHOW_OPEN_LINKS && Boolean(onOpen) && !disabled && (effective === "ready" || effective === "empty") && !NO_BODY_BUTTON.includes(kind);

  return (
    <article className={`flex h-full min-w-0 flex-col rounded-2xl ${t.card}`} aria-label={headTitle} aria-busy={effective === "loading" || undefined}>
      <header className="flex items-start gap-1.5 px-4 pt-3">
        {Icon && <Icon size={isTable ? 17 : 14} aria-hidden className={`shrink-0 ${isTable ? "mt-1" : "mt-0.75"} ${t.muted}`} />}
        <h3 className={`min-w-0 flex-1 font-black tracking-wide ${isTable ? `text-[16px] leading-6 sm:text-[17px] ${t.text}` : `text-[11.5px] leading-5 ${t.title}`}`}>
          <span className="line-clamp-2">{headTitle}</span>
        </h3>
        {period && !isTable && <span className={`mt-px shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${t.chip}`}>{period}</span>}
        {/* 기준 단추: PC 는 hover title, 폰은 눌러서 펼침. 보이는 크기는 작게, 누르는 칸은 44px */}
        <button
          type="button"
          onClick={() => setTipOpen((o) => !o)}
          aria-expanded={tipOpen}
          aria-controls={tipId}
          title={basisText}
          aria-label="숫자 기준 보기"
          className={`-mr-3 -mt-3 grid size-11 shrink-0 place-items-center rounded-full ${t.muted} transition hover:text-current ${focusRing}`}
        >
          <Info size={14} aria-hidden />
        </button>
      </header>
      {tipOpen && <p id={tipId} className={`mx-4 mb-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold leading-4 ${t.tipBox}`}>{basisText}</p>}

      {bodyClickable ? (
        <button type="button" onClick={onOpen} aria-label={`${headTitle} — ${openLabel}`} className={`group flex-1 rounded-xl px-4 pb-2 pt-1 text-left transition ${t.hover} ${focusRing}`}>
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-4 pb-2 pt-1">{body}</div>
      )}

      <footer className={`mt-auto flex items-center gap-2 border-t px-4 ${t.divider}`}>
        <span className={`min-w-0 flex-1 truncate py-2 text-[10px] font-semibold ${t.muted}`} title={basisText}>{basisText}</span>
        {SHOW_OPEN_LINKS && onOpen && !disabled && (
          <button type="button" onClick={onOpen} className={`-mr-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 px-2 text-[11px] font-black transition ${t.link} ${focusRing}`}>
            {openLabel}<ArrowRight size={12} aria-hidden />
          </button>
        )}
      </footer>
    </article>
  );
}

export default KpiWidget;
