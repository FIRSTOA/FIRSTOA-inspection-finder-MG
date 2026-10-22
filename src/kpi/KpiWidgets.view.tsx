/**
 * 홈 KPI 위젯 — 표시 전용(계산·조회 없음). 설계안 docs/tasks/home-kpi-dashboard.md 4-1절.
 * 숫자는 kpiCompute.ts 가 내고 컨테이너(HomeKpiBoard)가 props 로 넣는다. 이 파일은 kpi/* 다른 파일을 import 하지 않는다.
 *
 * 위젯 종류(kind): number 숫자 카드 · ring % 링 · teamBars 팀별 막대 · spark 추세 · progress 목표 진행 · list 밀린 일 목록
 *   + quarterGoal 분기 목표 진행(실적/목표·%·필요 페이스 vs 지금 페이스) · kpiTable KPI 달성표(전체/A~E/개인, [주요 목표][전체 지표])
 *   + todayStrip 금일 현황 칩 띠(가로 스크롤). 원본 없는 값은 회색 "원본 연결 필요".
 * 상태(status): loading 뼈대 · ready 값 · empty "0 · 기록 없음" · error "—" + [다시] + 마지막 성공 값 · pending "준비 중"(원본 표 없음)
 *   → 로딩·오류·준비 중은 절대 0 으로 보이지 않는다(설계안 3절 원칙 5).
 * 머리: 제목 · 기간 칩 · (i) 단추 = "숫자 기준: …" 펼침(폰은 hover 가 없어서 누르면 펼친다). 바닥: 기준 한 줄(말줄임, 전문은 title).
 * 색: 상태색 = 달성 초록 · 경과보다 뒤짐 노랑 · 경과의 절반 미만 빨강 · 판정 없음 회색.
 * 톤: theme="deck"(기본, 홈 검은 판 #0B0F17 안의 반투명 카드 — Home.tsx Metric 과 같은 결) / "light"(흰 화면에 놓을 때).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, ChevronRight, Clock3, Info, Minus, RefreshCw, type LucideIcon } from "lucide-react";

// ── 타입(props) ─────────────────────────────────────────────────────────────
export type KpiSize = "1x1" | "2x1" | "2x2" | "4x1";
export type KpiTone = "ok" | "warn" | "bad" | "idle";
export type KpiStatus = "loading" | "ready" | "empty" | "error" | "pending";
export type KpiTheme = "deck" | "light";
export type KpiKind = "number" | "ring" | "teamBars" | "spark" | "progress" | "list" | "quarterGoal" | "kpiTable" | "todayStrip";

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
  target?: number | null;          // 있으면 "목표 N · 75%"
  prevValue?: number | null;       // 있으면 전주(전기) 대비 화살표
  prevLabel?: string;              // 기본 "지난주"
  better?: "up" | "down";          // 미처리처럼 줄어야 좋은 숫자는 "down"(화살표 색 반전)
  tone?: KpiTone;                  // 큰 숫자 옆 점(예: 재계약 확인 지남 = bad)
  sub?: string;                    // 한 줄 보조 글
  teams?: KpiTeamValue[];          // 2x1 이상에서 팀별 미니 막대
  points?: KpiSeriesPoint[];       // 2x1 이상에서 미니 추세
};
export type KpiRingView = {
  kind: "ring";
  numerator: number;
  denominator: number;
  unit?: string;                   // 분자/분모 단위(예: "단위", "개")
  pace?: number | null;            // 경과율 %(0~100). 있으면 "경과 24% · 앞섬/뒤짐"과 상태색
  tone?: KpiTone;                  // 직접 지정하면 pace 판정 대신 사용
  chips?: KpiChip[];               // "미흡 2 · 미착수 1"
  teams?: KpiTeamValue[];          // 2x1·2x2 에서 팀별 %(value=분자, target=분모)
};
export type KpiTeamBarsView = {
  kind: "teamBars";
  unit: string;
  rows: KpiTeamValue[];
  target?: number | null;          // 팀 공통 목표선(행별 target 이 우선)
  total?: number | null;           // 머리 오른쪽 합계(없으면 표시 안 함 — 위젯은 더하지 않는다)
  legend?: string;                 // "PC · 복합기" 처럼 값 뜻
};
export type KpiSparkView = {
  kind: "spark";
  unit: string;
  points: KpiSeriesPoint[];
  value?: number | null;           // 큰 숫자(없으면 마지막 점 값)
  prevValue?: number | null;
  prevLabel?: string;
  better?: "up" | "down";
};
export type KpiProgressView = {
  kind: "progress";
  value: number;
  target: number;
  unit: string;
  pace?: number | null;            // 경과율 %(막대 위 점선)
  remainLabel?: string;            // "남은 기간 8일"
  teams?: KpiTeamValue[];          // 파트별 "A 2/2"
};
export type KpiListView = {
  kind: "list";
  total: number;
  unit: string;
  items: KpiListItem[];
  chips?: KpiChip[];               // "접수 14 · 일정 5 · 물류 2"
  emptyText?: string;              // 기본 "밀린 일이 없습니다"
};
/** 페이스 한 줄: "분기 말일 · 49일 → 필요 7.5건/일 · 지금 5.6건/일". need·now 는 kpiCompute 가 낸다(위젯은 비교만). */
export type KpiPaceLine = { label: string; need: number; now: number; unit?: string; tone?: KpiTone };
/** 분기 목표 진행 — 워킨맵 진행률과 같은 꼴. 큰 줄 "점검 373/1469 · 25%" + 막대 + 페이스 줄들. */
export type KpiQuarterGoalView = {
  kind: "quarterGoal";
  label: string;                   // "점검"
  value: number;
  target: number;
  unit?: string;                   // "대"(큰 줄 단위, 생략 가능)
  pace?: number | null;            // 경과율 %(막대 위 점선)
  lines: KpiPaceLine[];            // 보통 [분기 말일, 말일 10일 전]. unit 기본 "건/일"
  teams?: KpiTeamValue[];          // 2x1 이상에서 팀별 실적/목표 칩
};

/** 달성표 한 칸. target=null 이면 "실적만"(목표 "—", 막대 없음). actual=null 이면 "원본 연결 필요". */
export type KpiActual = { actual: number | null; target: number | null };
export type KpiTableTeam = KpiActual & { team: string };
export type KpiTablePerson = KpiActual & { name: string; team: string };
export type KpiTableRow = {
  id: string;
  label: string;                   // "블로그 인당 주 2"
  unit: string;
  period?: string;                 // "주" · "월" · "분기"(행마다 목표 기간이 다를 때)
  total: KpiActual;                // CS 전체
  teams: KpiTableTeam[];           // A~E(없는 팀은 "—")
  people?: KpiTablePerson[];       // 펼치면 개인
  pending?: boolean;               // 원본 없음 → 줄 전체 회색 "원본 연결 필요"
  pendingText?: string;
  main?: boolean;                  // [주요 목표] 보기에 나옴
  group?: string;                  // [전체 지표] 묶음 머리: "현장"·"영업"·"접수"·"소통·성장"
  onOpen?: () => void;
};
export type KpiPeriod = "오늘" | "이번 주" | "이번 달" | "분기";
/** KPI 달성표: 행 = KPI, 열 = CS 전체 / A~E, 펼치면 개인. PC 는 표, 폰은 KPI 카드 → 팀 → 개인. */
export type KpiTableView = {
  kind: "kpiTable";
  rows: KpiTableRow[];
  teamOrder?: string[];            // 기본 ["A","B","C","D","E"]
  groupOrder?: string[];           // 기본 ["현장","영업","접수","소통·성장"], 없는 묶음은 "기타"로 끝에
  pace?: number | null;            // 경과율 % — 미달 색 판정(없으면 100% 미만 = 노랑, 50% 미만 = 빨강)
  period?: KpiPeriod;              // 기간 칩(제어형). 주면 [오늘][이번 주][이번 달][분기] 칩이 보인다
  periods?: KpiPeriod[];           // 보일 기간 칩(기본 4개)
  onPeriodChange?: (p: KpiPeriod) => void;
  mode?: "main" | "all";           // 보기 칩 초기값(기본 "main"). 이후는 위젯 안에서 바뀐다
};

/** 금일 현황 칩 하나. value=null 이면 "—", pending 이면 회색 "원본 연결 필요". */
export type KpiTodayItem = { key: string; label: string; value: number | null; unit: string; tone?: KpiTone; pending?: boolean; onOpen?: () => void };
export type KpiTodayStripView = { kind: "todayStrip"; items: KpiTodayItem[] };

export type KpiView = KpiNumberView | KpiRingView | KpiTeamBarsView | KpiSparkView | KpiProgressView | KpiListView | KpiQuarterGoalView | KpiTableView | KpiTodayStripView;

export type KpiWidgetProps = {
  kind: KpiKind;                   // 로딩 중에도 뼈대 모양을 맞추려고 view 와 따로 받는다
  title: string;
  basis: string;                   // "활동 기록 · 기기 대수 · 작성자 팀 · 팀장 제외" — 앞에 "숫자 기준: "을 붙여 보여 준다
  status: KpiStatus;
  view?: KpiView;                  // status=ready 일 때 필수(kind 가 다르면 빈 상태로 그림)
  period?: string;                 // "이번 주" 칩
  icon?: LucideIcon;
  size?: KpiSize;                  // 그리드가 넘겨 준다. 크면 같은 데이터를 더 보여 줄 뿐
  theme?: KpiTheme;
  errorText?: string;              // 기본 "불러오지 못했습니다"
  lastOk?: { text: string; at?: string };  // 오류 때 "마지막 값 312대 · 12분 전"
  pendingText?: string;            // 기본 "원본 표가 준비되면 표시됩니다"
  emptyText?: string;              // 기본 "기록 없음"
  onRetry?: () => void;
  onOpen?: () => void;             // 누르면 같은 숫자의 목록 화면으로
  openLabel?: string;              // 기본 "자세히"
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

// ── 표시용 작은 도우미(계산이 아니라 글자 만들기) ─────────────────────────────
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("ko-KR") : "—");
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
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
const isWide = (s?: KpiSize) => s === "2x1" || s === "2x2" || s === "4x1";
const isTall = (s?: KpiSize) => s === "2x2";

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
  // 전 값이 0 이면 %가 무한대라 차이 수만 쓴다
  const rate = prev > 0 ? `${up ? "+" : ""}${Math.round((diff / prev) * 100)}%` : `${up ? "+" : ""}${fmt(diff)}`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-black tabular-nums ${good ? tones.ok : tones.bad}`}>
      <Icon size={13} aria-hidden /><span className="sr-only">{up ? "증가" : "감소"} </span>{rate}
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
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, ""); // url(#…) 안에 쓸 수 있는 글자만
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
        {/* 끝 점은 SVG 밖에서 그린다 — preserveAspectRatio=none 이면 원이 찌그러진다 */}
        <span aria-hidden className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-300 ring-2 ring-blue-400/30" style={{ left: "100%", top: `${(y(last.value) / H) * 100}%` }} />
      </div>
      <figcaption className={`mt-1 flex justify-between font-mono text-[9.5px] font-bold tabular-nums ${t.muted}`}>
        <span>{points[0].label}</span><span>{last.label}</span>
      </figcaption>
    </figure>
  );
}

function Ring({ pct, tone, theme, size = 76 }: { pct: number | null; tone: KpiTone; theme: KpiTheme; size?: number }) {
  const t = THEMES[theme];
  const r = 30, c = 2 * Math.PI * r;
  const p = pct === null ? 0 : clamp(pct);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="8" className={t.ringTrack} />
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className={`${TONE_STROKE[tone]} transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none`} strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} />
      </svg>
      <span className={`absolute inset-0 grid place-items-center font-mono text-[18px] font-black tabular-nums ${t.text}`}>{pct === null ? "—" : `${pct}%`}</span>
    </div>
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
                <span className={`relative h-2 flex-1 overflow-hidden rounded-full ${t.track}`}>
                  <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 motion-reduce:transition-none ${TONE_BAR[tt]}`} style={{ width: `${clamp(p ?? 0)}%` }} />
                  {v.pace !== null && v.pace !== undefined ? <span aria-hidden className={`absolute inset-y-0 w-0 border-l border-dashed ${t.goalLine}`} style={{ left: `${clamp(v.pace)}%` }} /> : null}
                </span>
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
      <div className={`relative mt-2 h-3 overflow-hidden rounded-full ${t.track}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} aria-label={`목표 대비 ${pct ?? 0}%`}>
        <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 motion-reduce:transition-none ${TONE_BAR[tone]}`} style={{ width: `${clamp(pct ?? 0)}%` }} />
        {v.pace !== null && v.pace !== undefined ? <span aria-hidden className={`absolute inset-y-0 w-0 border-l-2 border-dashed ${t.goalLine}`} style={{ left: `${clamp(v.pace)}%` }} title={`경과 ${Math.round(v.pace)}%`} /> : null}
      </div>
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
            const open = it.onOpen || onOpen;
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

// ── 분기 목표 진행(quarterGoal) ─────────────────────────────────────────────
const rate = (n: number) => (Number.isFinite(n) ? n.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—");
/** 지금 페이스가 필요 페이스 이상 = 초록, 80% 이상 = 노랑(주황), 그 아래 = 빨강. */
function paceTone(l: KpiPaceLine): KpiTone {
  if (l.tone) return l.tone;
  if (l.need <= 0 || l.now >= l.need) return "ok";
  return l.now >= l.need * 0.8 ? "warn" : "bad";
}

function QuarterGoalBody({ v, size, theme }: { v: KpiQuarterGoalView; size?: KpiSize; theme: KpiTheme }) {
  const t = THEMES[theme];
  const tones = TONE_TEXT[theme];
  const pct = pctOf(v.value, v.target);
  const tone = toneFor(pct, v.pace);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={`text-[13px] font-black ${t.sub}`}>{v.label}</span>
        <span className={`font-mono text-[24px] font-black leading-none tabular-nums ${t.text}`}>{fmt(v.value)}<span className={`text-[15px] ${t.muted}`}>/{fmt(v.target)}</span></span>
        {v.unit && <span className={`text-[12px] font-black ${t.sub}`}>{v.unit}</span>}
        <span className={`font-mono text-[18px] font-black tabular-nums ${tones[tone]}`}>· {pct === null ? "—" : `${pct}%`}</span>
      </div>
      <div className={`relative mt-2 h-3 overflow-hidden rounded-full ${t.track}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} aria-label={`${v.label} 목표 대비 ${pct ?? 0}%`}>
        <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 motion-reduce:transition-none ${TONE_BAR[tone]}`} style={{ width: `${clamp(pct ?? 0)}%` }} />
        {v.pace !== null && v.pace !== undefined ? <span aria-hidden className={`absolute inset-y-0 w-0 border-l-2 border-dashed ${t.goalLine}`} style={{ left: `${clamp(v.pace)}%` }} /> : null}
      </div>
      {v.pace !== null && v.pace !== undefined && <div className={`mt-1 text-[10px] font-bold ${t.muted}`}>점선 = 기간 경과 {Math.round(v.pace)}%</div>}
      {v.lines.length > 0 && (
        <ul className={`mt-2 space-y-1 border-t pt-2 ${t.divider}`}>
          {v.lines.map((l) => {
            const lt = paceTone(l);
            const unit = l.unit ?? "건/일";
            return (
              <li key={l.label} className="flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] font-bold leading-5">
                <span className={t.sub}>{l.label}</span>
                <ArrowRight size={11} aria-hidden className={`self-center ${t.muted}`} />
                {l.need <= 0 ? <span className={tones.ok}>목표 달성</span> : (
                  <>
                    <span className={t.text}>필요 <b className="font-mono font-black tabular-nums">{rate(l.need)}</b>{unit}</span>
                    <span className={t.muted}>·</span>
                    <span className={tones[lt]}>지금 <b className="font-mono font-black tabular-nums">{rate(l.now)}</b>{unit}</span>
                    {lt !== "ok" && <span className="sr-only">(필요 페이스보다 느립니다)</span>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {isWide(size) && v.teams?.length ? (
        <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-5">
          {v.teams.map((r) => {
            const p = r.target ? pctOf(r.value, r.target) : null;
            return (
              <li key={r.team} className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1 text-[11px] font-black ${t.chip}`} title={`${r.label || r.team} ${fmt(r.value)}/${fmt(r.target ?? 0)}`}>
                <span>{r.label || r.team}</span>
                <span className={`font-mono tabular-nums ${tones[r.tone ?? toneFor(p, v.pace)]}`}>{p === null ? fmt(r.value) : `${p}%`}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ── KPI 달성표(kpiTable) ────────────────────────────────────────────────────
const DEFAULT_TEAMS = ["A", "B", "C", "D", "E"];
const DEFAULT_GROUPS = ["현장", "영업", "접수", "소통·성장"];
const DEFAULT_PERIODS: KpiPeriod[] = ["오늘", "이번 주", "이번 달", "분기"];
/** 미달 색: 100% 이상 초록 · 경과율 있으면 그 기준 · 없으면 50% 이상 노랑, 미만 빨강. */
function cellTone(pct: number, pace?: number | null): KpiTone {
  if (pct >= 100) return "ok";
  if (pace !== null && pace !== undefined) return toneFor(pct, pace);
  return pct >= 50 ? "warn" : "bad";
}

function TableCell({ a, theme, pace, pendingText, align = "right" }: { a: KpiActual | undefined; theme: KpiTheme; pace?: number | null; pendingText?: string; align?: "left" | "right" }) {
  const t = THEMES[theme];
  if (!a || a.actual === null) {
    return <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-black ${t.chip} opacity-70`} title={pendingText || "원본 연결 필요"}>{pendingText || "원본 연결 필요"}</span>;
  }
  // 목표 없는 지표 = 실적만(목표 "—", 막대 없음)
  if (!a.target) {
    return <span className={`font-mono text-[12px] font-black tabular-nums ${t.text}`}>{fmt(a.actual)}<span className={t.muted}>/—</span></span>;
  }
  const pct = Math.round((a.actual / a.target) * 100);
  const tone = cellTone(pct, pace);
  return (
    <span className={`inline-flex min-w-18 flex-col gap-1 ${align === "right" ? "items-end" : "items-start"}`} title={`${fmt(a.actual)} / ${fmt(a.target)} · ${pct}%`}>
      <span className={`font-mono text-[12px] font-black tabular-nums ${TONE_TEXT[theme][tone]}`}>{fmt(a.actual)}<span className={t.muted}>/{fmt(a.target)}</span></span>
      <span className={`relative h-1.5 w-full overflow-hidden rounded-full ${t.track}`} aria-hidden>
        <span className={`absolute inset-y-0 left-0 rounded-full ${TONE_BAR[tone]}`} style={{ width: `${clamp(pct)}%` }} />
      </span>
    </span>
  );
}

function KpiTableBody({ v, theme, disabled }: { v: KpiTableView; theme: KpiTheme; disabled?: boolean }) {
  const t = THEMES[theme];
  const [mode, setMode] = useState<"main" | "all">(v.mode ?? "main");
  const [teamsOpen, setTeamsOpen] = useState<Set<string>>(() => new Set());   // 폰: KPI 카드 → 팀
  const [peopleOpen, setPeopleOpen] = useState<Set<string>>(() => new Set()); // PC·폰: → 개인
  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); apply(n); };
  const teamOrder = v.teamOrder ?? DEFAULT_TEAMS;
  const mainRows = v.rows.filter((r) => r.main);
  const shownRows = mode === "main" ? mainRows : v.rows;
  // [전체 지표]는 묶음 머리별로. 순서 = groupOrder, 모르는 묶음·묶음 없음은 "기타"로 끝에
  const groups: Array<{ name: string; rows: KpiTableRow[] }> = (() => {
    if (mode === "main") return [{ name: "", rows: shownRows }];
    const order = v.groupOrder ?? DEFAULT_GROUPS;
    const map = new Map<string, KpiTableRow[]>();
    for (const r of shownRows) { const g = r.group && order.includes(r.group) ? r.group : "기타"; map.set(g, [...(map.get(g) ?? []), r]); }
    return [...order, "기타"].filter((g) => map.has(g)).map((g) => ({ name: g, rows: map.get(g)! }));
  })();
  const teamOf = (r: KpiTableRow, team: string) => r.teams.find((x) => x.team === team);
  const chip = (on: boolean) => `inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-[11.5px] font-black transition ${focusRing} ${on ? (theme === "deck" ? "bg-white text-slate-950" : "bg-slate-900 text-white") : `${t.chip} ${t.hover}`}`;

  return (
    <div>
      {/* 보기 칩 · 기간 칩 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1" role="group" aria-label="보기">
          <button type="button" aria-pressed={mode === "main"} onClick={() => setMode("main")} className={chip(mode === "main")}>주요 목표<span className="font-mono opacity-70">{mainRows.length}</span></button>
          <button type="button" aria-pressed={mode === "all"} onClick={() => setMode("all")} className={chip(mode === "all")}>전체 지표<span className="font-mono opacity-70">{v.rows.length}</span></button>
        </div>
        {v.onPeriodChange && (
          <>
            <span aria-hidden className={`mx-0.5 h-5 w-px ${t.track}`} />
            <div className="flex flex-wrap gap-1" role="group" aria-label="기간">
              {(v.periods ?? DEFAULT_PERIODS).map((p) => (
                <button key={p} type="button" aria-pressed={v.period === p} onClick={() => v.onPeriodChange?.(p)} disabled={disabled} className={chip(v.period === p)}>{p}</button>
              ))}
            </div>
          </>
        )}
      </div>

      {shownRows.length === 0 ? (
        <p className={`rounded-xl border border-dashed px-3 py-4 text-center text-[12px] font-bold ${t.divider} ${t.sub}`}>
          {mode === "main" ? "주요 목표로 정한 지표가 없습니다. [전체 지표]에서 모든 실적을 볼 수 있습니다." : "표시할 지표가 없습니다."}
        </p>
      ) : (
        <>
          {/* PC·태블릿: 표(넘치면 표만 가로 스크롤) */}
          <div className={`hidden overflow-x-auto rounded-xl border md:block ${t.divider}`}>
            <table className="w-full min-w-160 border-collapse text-left">
              <thead>
                <tr className={`border-b text-[10.5px] font-black ${t.divider} ${t.sub}`}>
                  <th scope="col" className="px-3 py-2">지표</th>
                  <th scope="col" className="px-2 py-2 text-right">CS 전체</th>
                  {teamOrder.map((tm) => <th key={tm} scope="col" className="px-2 py-2 text-right">{tm}팀</th>)}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.name || "main"} className={`divide-y ${t.divider}`}>
                  {g.name && <tr><th colSpan={teamOrder.length + 2} scope="colgroup" className={`px-3 pb-1 pt-3 text-[10.5px] font-black tracking-wide ${t.muted}`}>{g.name}</th></tr>}
                  {g.rows.map((r) => {
                    const pOpen = peopleOpen.has(r.id);
                    const hasPeople = !r.pending && !!r.people?.length;
                    return (
                      <FragmentRow key={r.id}>
                        <tr className={r.pending ? "opacity-60" : ""}>
                          <th scope="row" className="px-1 py-1 text-left align-middle">
                            <div className="flex items-center">
                              {hasPeople ? (
                                <button type="button" aria-expanded={pOpen} onClick={() => toggle(peopleOpen, r.id, setPeopleOpen)} className={`flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-left ${t.hover} ${focusRing}`}>
                                  <ChevronRight size={14} aria-hidden className={`shrink-0 transition-transform motion-reduce:transition-none ${pOpen ? "rotate-90" : ""} ${t.muted}`} />
                                  <RowLabel r={r} theme={theme} />
                                </button>
                              ) : <div className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-2 pl-7"><RowLabel r={r} theme={theme} /></div>}
                              {r.onOpen && !disabled && <button type="button" onClick={r.onOpen} aria-label={`${r.label} 화면으로`} className={`grid size-11 shrink-0 place-items-center rounded-lg ${t.link} ${focusRing}`}><ArrowRight size={14} aria-hidden /></button>}
                            </div>
                          </th>
                          {r.pending ? (
                            <td colSpan={teamOrder.length + 1} className={`px-3 py-2 text-[11.5px] font-black ${t.muted}`}>
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${t.chip}`}><span aria-hidden className="size-1.5 rounded-full bg-slate-400" />{r.pendingText || "원본 연결 필요"}</span>
                            </td>
                          ) : (
                            <>
                              <td className="px-2 py-2 text-right align-middle"><TableCell a={r.total} theme={theme} pace={v.pace} /></td>
                              {teamOrder.map((tm) => <td key={tm} className="px-2 py-2 text-right align-middle"><TableCell a={teamOf(r, tm)} theme={theme} pace={v.pace} pendingText="—" /></td>)}
                            </>
                          )}
                        </tr>
                        {pOpen && hasPeople && (
                          <tr>
                            <td colSpan={teamOrder.length + 2} className="px-3 pb-3 pt-1">
                              <PeopleList people={r.people!} teamOrder={teamOrder} theme={theme} pace={v.pace} />
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>

          {/* 폰: KPI 카드 → 누르면 팀 → 개인 */}
          <div className="space-y-3 md:hidden">
            {groups.map((g) => (
              <section key={g.name || "main"} aria-label={g.name || "주요 목표"}>
                {g.name && <h4 className={`mb-1.5 text-[10.5px] font-black tracking-wide ${t.muted}`}>{g.name}</h4>}
                <ul className="space-y-1.5">
                  {g.rows.map((r) => {
                    const tOpen = teamsOpen.has(r.id);
                    const pOpen = peopleOpen.has(r.id);
                    return (
                      <li key={r.id} className={`overflow-hidden rounded-xl border ${t.divider} ${r.pending ? "opacity-60" : ""}`}>
                        <button type="button" aria-expanded={r.pending ? undefined : tOpen} disabled={r.pending} onClick={() => toggle(teamsOpen, r.id, setTeamsOpen)} className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left ${r.pending ? "" : t.hover} ${focusRing}`}>
                          <span className="min-w-0 flex-1"><RowLabel r={r} theme={theme} /></span>
                          {r.pending
                            ? <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${t.chip}`}>{r.pendingText || "원본 연결 필요"}</span>
                            : <TableCell a={r.total} theme={theme} pace={v.pace} />}
                          {!r.pending && <ChevronDown size={15} aria-hidden className={`shrink-0 transition-transform motion-reduce:transition-none ${tOpen ? "rotate-180" : ""} ${t.muted}`} />}
                        </button>
                        {tOpen && !r.pending && (
                          <div className={`border-t px-3 pb-2 pt-1 ${t.divider}`}>
                            <ul className={`divide-y ${t.divider}`}>
                              {teamOrder.map((tm) => (
                                <li key={tm} className="flex min-h-10 items-center justify-between gap-2 py-1">
                                  <span className={`text-[12px] font-black ${t.sub}`}>{tm}팀</span>
                                  <TableCell a={teamOf(r, tm)} theme={theme} pace={v.pace} pendingText="—" />
                                </li>
                              ))}
                            </ul>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {r.people?.length ? (
                                <button type="button" aria-expanded={pOpen} onClick={() => toggle(peopleOpen, r.id, setPeopleOpen)} className={chip(pOpen)}>
                                  개인 {r.people.length}명 {pOpen ? "접기" : "보기"}
                                </button>
                              ) : null}
                              {r.onOpen && !disabled && <button type="button" onClick={r.onOpen} className={`inline-flex min-h-11 items-center gap-0.5 px-2 text-[11.5px] font-black ${t.link} ${focusRing}`}>자세히<ArrowRight size={12} aria-hidden /></button>}
                            </div>
                            {pOpen && r.people?.length ? <div className="mt-1.5"><PeopleList people={r.people} teamOrder={teamOrder} theme={theme} pace={v.pace} /></div> : null}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** <tbody> 안에서 tr 두 개(행 + 펼친 개인)를 key 하나로 묶는다. */
function FragmentRow({ children }: { children: ReactNode }) { return <>{children}</>; }

function RowLabel({ r, theme }: { r: KpiTableRow; theme: KpiTheme }) {
  const t = THEMES[theme];
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className={`min-w-0 truncate text-[12.5px] font-black ${t.text}`} title={r.label}>{r.label}</span>
      {r.period && <span className={`shrink-0 rounded-full px-1.5 text-[9.5px] font-black ${t.chip}`}>{r.period}</span>}
      <span className={`shrink-0 text-[10px] font-bold ${t.muted}`}>{r.unit}</span>
    </span>
  );
}

/** 개인 목록: 팀 순서 → 이름순은 넘겨준 순서 그대로. 칸마다 실적/목표·막대. */
function PeopleList({ people, teamOrder, theme, pace }: { people: KpiTablePerson[]; teamOrder: string[]; theme: KpiTheme; pace?: number | null }) {
  const t = THEMES[theme];
  const rank = (team: string) => { const i = teamOrder.indexOf(team); return i < 0 ? teamOrder.length : i; };
  const sorted = [...people].sort((a, b) => rank(a.team) - rank(b.team));
  return (
    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((p) => (
        <li key={`${p.team}-${p.name}`} className={`flex min-h-10 items-center justify-between gap-2 rounded-lg px-2.5 py-1 ${t.chip}`}>
          <span className="min-w-0 truncate text-[12px] font-black">{p.name} <span className={`text-[10px] font-bold ${t.muted}`}>{p.team}</span></span>
          <TableCell a={p} theme={theme} pace={pace} />
        </li>
      ))}
    </ul>
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
            {it.onOpen && !disabled && !it.pending
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
  if (kind === "ring") return <div className="flex items-center gap-3" aria-hidden><span className={`size-19 animate-pulse rounded-full ${s}`} /><span className="flex-1 space-y-2"><span className={`block h-3 w-20 animate-pulse rounded ${s}`} /><span className={`block h-3 w-14 animate-pulse rounded ${s}`} /></span></div>;
  if (kind === "todayStrip") return <div className="flex gap-2 overflow-hidden" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={`h-11 w-24 shrink-0 animate-pulse rounded-xl ${s}`} />)}</div>;
  if (kind === "teamBars" || kind === "list" || kind === "kpiTable") return <div className="space-y-2.5" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={`block h-3 animate-pulse rounded ${s}`} />)}</div>;
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
/**
 * KPI 위젯 하나. 그리드 칸을 꽉 채운다(h-full). onOpen 이 있으면 본문 전체가 단추(목록형은 줄마다 단추 + 머리 "자세히").
 */
export function KpiWidget(props: KpiWidgetProps) {
  const { kind, title, basis, status, view, period, icon: Icon, size = "1x1", theme = "deck", onOpen, openLabel = "자세히", disabled } = props;
  const t = THEMES[theme];
  const [tipOpen, setTipOpen] = useState(false);
  const tipId = useId();
  const basisText = `숫자 기준: ${basis}`;
  const ready = status === "ready" && view && view.kind === kind;
  const effective: KpiStatus = status === "ready" && !ready ? "empty" : status;

  let body: ReactNode;
  if (effective === "loading") body = <Skeleton kind={kind} theme={theme} />;
  else if (effective === "error") body = <ErrorBody theme={theme} text={props.errorText} lastOk={props.lastOk} onRetry={props.onRetry} disabled={disabled} />;
  else if (effective === "pending") body = (
    <div>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-black ${t.chip}`}><span aria-hidden className="size-1.5 rounded-full bg-slate-400" />준비 중</span>
      <p className={`mt-2 text-[11.5px] font-bold leading-4 ${t.sub}`}>{props.pendingText || "원본 표가 준비되면 표시됩니다."}</p>
    </div>
  );
  else if (effective === "empty") body = kind === "list"
    ? <p className={`rounded-xl border border-dashed px-3 py-3 text-center text-[12px] font-bold ${t.divider} ${TONE_TEXT[theme].ok}`}>{props.emptyText || "밀린 일이 없습니다"}</p>
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
      : v.kind === "quarterGoal" ? <QuarterGoalBody v={v} size={size} theme={theme} />
      : v.kind === "kpiTable" ? <KpiTableBody v={v} theme={theme} disabled={disabled} />
      : v.kind === "todayStrip" ? <TodayStripBody v={v} theme={theme} disabled={disabled} />
      : <ListBody v={v} size={size} theme={theme} onOpen={onOpen} disabled={disabled} />;
  }

  // 본문 전체를 단추로: 값이 있을 때만(오류·로딩 땐 [다시] 단추와 겹치지 않게)
  const bodyClickable = Boolean(onOpen) && !disabled && (effective === "ready" || effective === "empty") && kind !== "list" && kind !== "kpiTable" && kind !== "todayStrip";

  return (
    <article className={`flex h-full min-w-0 flex-col rounded-2xl ${t.card}`} aria-label={title} aria-busy={effective === "loading" || undefined}>
      <header className="flex items-start gap-1.5 px-4 pt-3">
        {Icon && <Icon size={14} aria-hidden className={`mt-0.75 shrink-0 ${t.muted}`} />}
        <h3 className={`min-w-0 flex-1 text-[11.5px] font-black leading-5 tracking-wide ${t.title}`}>
          <span className="line-clamp-2">{title}</span>
        </h3>
        {period && <span className={`mt-px shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${t.chip}`}>{period}</span>}
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
        <button type="button" onClick={onOpen} aria-label={`${title} — ${openLabel}`} className={`group flex-1 rounded-xl px-4 pb-2 pt-1 text-left transition ${t.hover} ${focusRing}`}>
          {body}
        </button>
      ) : (
        <div className="flex-1 px-4 pb-2 pt-1">{body}</div>
      )}

      <footer className={`mt-auto flex items-center gap-2 border-t px-4 ${t.divider}`}>
        <span className={`min-w-0 flex-1 truncate py-2 text-[10px] font-semibold ${t.muted}`} title={basisText}>{basisText}</span>
        {onOpen && !disabled && (
          <button type="button" onClick={onOpen} className={`-mr-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 px-2 text-[11px] font-black transition ${t.link} ${focusRing}`}>
            {openLabel}<ArrowRight size={12} aria-hidden />
          </button>
        )}
      </footer>
    </article>
  );
}

export default KpiWidget;
