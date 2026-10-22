/**
 * 홈 KPI 현황판 — 컨테이너(HomeKpiBoard.tsx)가 쓰는 순수 로직(2026-10-23, 설계안 docs/tasks/home-kpi-dashboard.md).
 *  · 위젯 목록·기본 배치·배치 저장 형식(localStorage `home_kpi_layout_v1` = {v:1, items})
 *  · 보이는 위젯 → 읽을 원본(숨긴 위젯 원본은 안 읽음) · 60초 가벼운 원본 / 5분 무거운 원본 나눔 · 묶음 합치기(실패면 마지막 값 유지)
 *  · 위젯 보기(view) 만들기 — 숫자는 kpiCompute 의 함수만 부른다(여기서 새로 세지 않음)
 * 조회·화면 없음. 테스트: tests/homeKpiBoard.test.tsx
 */
import { KPI_BY_ID, KPI_DEFS, mainKpiIds, type KpiId, type KpiPeriodKey, type KpiSource, type KpiTarget } from "./kpiDefs";
import {
  kpiCount, kpiProgress, KPI_TEAMS, okrKpi, overageKpi, rangeOfPeriod, recontractOverdueKpi, shiftYmd, bizDays, workinPace,
  type KpiRange, type KpiRanges,
} from "./kpiCompute";
import { kpiCellState, sourcesFor, type KpiBundle, type KpiSourceStatus } from "./kpiData";
import { UNHANDLED_BADGE, type UnhandledRow } from "../homeUnhandled";
import type {
  KpiListItem, KpiListView, KpiNumberView, KpiPeriod, KpiProgressView, KpiQuarterGoalView, KpiRingView, KpiSize, KpiSparkView,
  KpiStatus, KpiTableRow, KpiTeamBarsView, KpiTodayItem, KpiTone, KpiView,
} from "./KpiWidgets.view";
import type { KpiLayoutItem } from "./HomeKpiGrid.view";

/* ───────────── 위젯 목록 · 기본 배치 ───────────── */

export type HomeWidgetId = "today" | "K2" | "table" | "K1" | "exp" | "K10" | "unhandledPanel" | "receptionPanel" | "unhandled" | "K3" | "K19" | "K12";
export type HomeWidgetDef = {
  id: HomeWidgetId;
  title: string;
  /** panel = 기존 홈 부품을 그대로 그린다(스스로 읽고 갱신 — 현황판 묶음을 쓰지 않음) */
  kind: KpiView["kind"] | "panel";
  /** 이 위젯이 보여 주는 KPI(원본·숫자 기준·누르면 열 화면이 여기서 나온다) */
  kpis: KpiId[];
  sizes: KpiSize[];
  description: string;
  /** 기본 배치에서 숨김([위젯 추가]로 켬) */
  defaultHidden?: boolean;
};

const ALL_KPI_IDS = KPI_DEFS.map((d) => d.id);
const TODAY_KPI_IDS = KPI_DEFS.filter((d) => d.today).map((d) => d.id);

/** 순서 = 기본 배치 순서(사용자 2026-10-23: 금일 현황 띠 → 분기 점검 진행 → KPI 달성표 → 설계안 1단계 위젯) */
export const HOME_WIDGETS: HomeWidgetDef[] = [
  { id: "today", title: "금일 현황", kind: "todayStrip", kpis: TODAY_KPI_IDS, sizes: ["4x1"], description: "오늘 점검·AS·물류·확장성·칭찬 … 한 줄" },
  { id: "K2", title: "분기 점검 진행", kind: "quarterGoal", kpis: ["K2"], sizes: ["2x1", "4x1", "1x1"], description: "워킨맵 완료/대상 · 필요 페이스 vs 지금 페이스" },
  { id: "table", title: "KPI 달성표", kind: "kpiTable", kpis: ALL_KPI_IDS, sizes: ["4x1"], description: "CS 전체 → 팀 → 개인 · [주요 목표]/[전체 지표]" },
  { id: "K1", title: "점검", kind: "number", kpis: ["K1"], sizes: ["1x1", "2x1", "2x2"], description: "기기 대수 · 지난 기간 대비" },
  { id: "exp", title: "PC·복합기 확장성", kind: "teamBars", kpis: ["K7", "K8"], sizes: ["2x1", "2x2"], description: "팀별 PC 확장성(목표선) · 복합기" },
  { id: "K10", title: "초과사용 제안 방문", kind: "progress", kpis: ["K10"], sizes: ["2x1", "1x1", "2x2"], description: "파트 월 2건 목표 대비" },
  // 팀장 결정(2026-10-23): 사용자가 요청해 만든 홈 미처리 칸(팀 탭 전체/A~E/경영/운영/영업, 접수·AS/물류 묶음)과 미처리 접수 카드를 그대로 둔다.
  // 두 패널은 자기 로더로 읽는다(현황판 묶음과 중복 조회 감수). kpis 를 비워 현황판이 이 위젯 때문에 원본을 더 읽지 않게 한다
  { id: "unhandledPanel", title: "미처리 일정", kind: "panel", kpis: [], sizes: ["2x2", "4x1"], description: "기존 홈 미처리 칸 — 팀 탭 · 접수·AS / 물류 묶음" },
  { id: "receptionPanel", title: "미처리 접수", kind: "panel", kpis: [], sizes: ["2x1", "1x1"], description: "기존 홈 미처리 접수 카드 — 서비스접수 현황판과 같은 계산" },
  { id: "K3", title: "AS", kind: "spark", kpis: ["K3"], sizes: ["1x1", "2x1"], description: "AS 건수 · 최근 8주 추세" },
  { id: "K19", title: "OKR 달성률 (이번 달)", kind: "ring", kpis: ["K19"], sizes: ["1x1", "2x1"], description: "A~D 파트 판정 · 미흡·미착수" },
  { id: "K12", title: "재계약 확인 지남", kind: "number", kpis: ["K12"], sizes: ["1x1"], description: "다음확인일 지난 열린 재계약" },
  // 현황판 묶음으로 그린 요약 목록(오래된 순) — 기본은 숨김, 미처리 일정 패널을 쓴다
  { id: "unhandled", title: "미처리 요약 (접수 + 지난 일정)", kind: "list", kpis: ["K16", "K17"], sizes: ["2x2", "2x1"], description: "오래된 순 목록 · 접수/일정/물류/7일 넘음 칩", defaultHidden: true },
];
export const HOME_WIDGET_BY_ID: Record<HomeWidgetId, HomeWidgetDef> = Object.fromEntries(HOME_WIDGETS.map((w) => [w.id, w])) as Record<HomeWidgetId, HomeWidgetDef>;

export const HOME_KPI_DEFAULT_LAYOUT: KpiLayoutItem[] = HOME_WIDGETS.map((w) => ({ id: w.id, size: w.sizes[0], hidden: w.defaultHidden === true }));

/* ───────────── 배치 저장 (localStorage, 설계안 4-5 2단계-a) ───────────── */

export const HOME_KPI_LAYOUT_KEY = "home_kpi_layout_v1";
export const HOME_KPI_LAYOUT_VERSION = 1;

/**
 * 저장 글 → 배치. 모양이 틀리거나 버전이 다르면 기본 배치. 모르는 id·중복은 버리고, 허용 안 된 크기는 그 위젯 첫 크기,
 * 저장 뒤에 새로 생긴 위젯은 끝에 붙인다(설계안 4-5 "모르는 id 는 버리고 새 위젯은 끝에").
 */
export function parseHomeLayout(raw: string | null | undefined): { items: KpiLayoutItem[]; restored: boolean } {
  const fallback = { items: HOME_KPI_DEFAULT_LAYOUT.map((x) => ({ ...x })), restored: false };
  if (!raw) return fallback;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fallback; }
  if (!parsed || typeof parsed !== "object") return fallback;
  const { v, items } = parsed as { v?: unknown; items?: unknown };
  if (v !== HOME_KPI_LAYOUT_VERSION || !Array.isArray(items)) return fallback;
  const seen = new Set<string>();
  const out: KpiLayoutItem[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const { id, size, hidden } = it as { id?: unknown; size?: unknown; hidden?: unknown };
    if (typeof id !== "string" || !(id in HOME_WIDGET_BY_ID) || seen.has(id)) continue;
    const def = HOME_WIDGET_BY_ID[id as HomeWidgetId];
    seen.add(id);
    out.push({ id, size: def.sizes.includes(size as KpiSize) ? (size as KpiSize) : def.sizes[0], hidden: hidden === true });
  }
  for (const w of HOME_WIDGETS) if (!seen.has(w.id)) out.push({ id: w.id, size: w.sizes[0], hidden: w.defaultHidden === true });
  return { items: out, restored: true };
}

export function serializeHomeLayout(items: KpiLayoutItem[]): string {
  return JSON.stringify({ v: HOME_KPI_LAYOUT_VERSION, items: items.map((x) => ({ id: x.id, size: x.size, hidden: x.hidden === true })) });
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function readHomeLayout(storage: StorageLike | null | undefined): KpiLayoutItem[] {
  try { return parseHomeLayout(storage?.getItem(HOME_KPI_LAYOUT_KEY)).items; } catch { return parseHomeLayout(null).items; }
}
/** 저장 실패(사생활 모드·저장공간 가득)면 안내 글을 돌려준다 — 화면은 바뀐 배치로 계속 보인다 */
export function writeHomeLayout(storage: StorageLike | null | undefined, items: KpiLayoutItem[]): string {
  if (!storage) return "이 기기에서는 배치를 저장할 수 없습니다 — 새로 열면 기본 배치로 돌아갑니다.";
  try { storage.setItem(HOME_KPI_LAYOUT_KEY, serializeHomeLayout(items)); return ""; }
  catch (e) { return `배치를 저장하지 못했습니다(${e instanceof Error ? e.message : String(e)}) — 새로 열면 기본 배치로 돌아갑니다.`; }
}

/* ───────────── 읽을 원본 ───────────── */

/** 보이는(숨기지 않은) 위젯의 원본만. 달성표가 보이면 [전체 지표]로 바로 바꿀 수 있게 전 KPI 원본 */
export function sourcesForLayout(layout: KpiLayoutItem[]): Set<KpiSource> {
  const ids = new Set<KpiId>();
  for (const it of layout) {
    if (it.hidden) continue;
    const w = HOME_WIDGET_BY_ID[it.id as HomeWidgetId];
    if (w) for (const k of w.kpis) ids.add(k);
  }
  return sourcesFor(ids);
}

/**
 * 60초마다 다시 읽는 가벼운 원본(한두 번 조회). 나머지(점검·AS·확장성·활동 기록 분기 전량, 워킨맵 3천 행 등)는 5분마다 —
 * 지금 홈은 60초마다 13개 조회였다(설계안 7절). 점검·AS 오늘 숫자는 최대 5분 늦을 수 있다.
 */
export const FAST_SOURCES: ReadonlySet<KpiSource> = new Set<KpiSource>(["unhandled", "receptionWeek", "keyman", "office", "praise", "customerPraise", "overage", "bulman"]);
export const SLOW_REFRESH_MS = 5 * 60_000;
export const FAST_REFRESH_MS = 60_000;

export function splitSources(want: Set<KpiSource>, full: boolean): Set<KpiSource> {
  if (full) return new Set(want);
  return new Set([...want].filter((s) => FAST_SOURCES.has(s)));
}

/**
 * 새 묶음을 앞 묶음 위에 덮는다. 새로 못 읽은 원본(error)은 앞의 값(facts)을 남겨 "마지막 값"으로 쓴다 — 상태는 error 로 바뀐다.
 * okAt = 원본별 마지막 성공 시각(오류 칸 "N분 전 값" 표시용).
 */
export type HomeKpiState = { bundle: KpiBundle; okAt: Partial<Record<KpiSource, number>> };
export function mergeBundle(prev: HomeKpiState | null, next: KpiBundle): HomeKpiState {
  const okAt: Partial<Record<KpiSource, number>> = { ...(prev?.okAt || {}) };
  for (const [s, st] of Object.entries(next.sources) as Array<[KpiSource, KpiSourceStatus]>) if (st.status === "ok") okAt[s] = st.at;
  if (!prev) return { bundle: next, okAt };
  const facts = { ...prev.bundle.facts };
  for (const [k, v] of Object.entries(next.facts)) if (v !== undefined) (facts as Record<string, unknown>)[k] = v;
  // 기간(오늘)이 바뀌었으면 앞 값은 다른 날 기준이라 버린다
  const sameDay = prev.bundle.today === next.today;
  return {
    bundle: {
      ...next,
      facts: sameDay ? facts : next.facts,
      sources: { ...(sameDay ? prev.bundle.sources : {}), ...next.sources },
      unhandledInfo: next.unhandledInfo ?? (sameDay ? prev.bundle.unhandledInfo : null),
    },
    okAt,
  };
}

/* ───────────── 기간 ───────────── */

export const PERIOD_LABEL: Record<KpiPeriodKey, KpiPeriod> = { today: "오늘", week: "이번 주", month: "이번 달", quarter: "분기" };
export const PERIOD_KEYS: KpiPeriodKey[] = ["today", "week", "month", "quarter"];
const isPeriodKey = (p: string): p is KpiPeriodKey => (PERIOD_KEYS as string[]).includes(p);

/** 위젯·행이 실제로 쓰는 기간: 고른 기간을 못 쓰는 지표는 정의의 기본 기간(열린 건·7일은 null) */
export function effectivePeriod(id: KpiId, board: KpiPeriodKey): KpiPeriodKey | null {
  const def = KPI_BY_ID[id];
  if (def.periods.includes(board)) return board;
  return isPeriodKey(def.period) ? def.period : null;
}
export function periodChip(id: KpiId, board: KpiPeriodKey): string {
  const p = effectivePeriod(id, board);
  if (p) return PERIOD_LABEL[p];
  return KPI_BY_ID[id].period === "7d" ? "최근 7일" : "열린 건";
}

/** 지난 기간(같은 날수) — 오늘 ↔ 어제, 주 ↔ 지난주 같은 요일까지, 달 ↔ 지난달 같은 날까지. 분기는 비교 없음 */
export function prevRangeOf(r: KpiRanges, p: KpiPeriodKey): { range: KpiRange; label: string } | null {
  if (p === "today") { const y = shiftYmd(r.today, -1); return { range: { from: y, to: y }, label: "어제" }; }
  if (p === "week") return { range: r.prevWeekToDate, label: "지난주" };
  if (p === "month") return { range: r.prevMonthToDate, label: "지난달" };
  return null;
}

/** 경과율(목표 대비 색 판정용). 오늘은 판정 안 함 */
export function paceOf(r: KpiRanges, p: KpiPeriodKey): number | null {
  return p === "week" ? r.weekElapsedRate : p === "month" ? r.monthElapsedRate : p === "quarter" ? r.quarterElapsedRate : null;
}

/* ───────────── 위젯 상태 ───────────── */

export type WidgetState = { status: KpiStatus; message: string; notice: string };

/** 위젯의 KPI 원본 상태를 합친다: 하나라도 원본 없음/표 없음 → 준비 중, 실패 → 오류. 묶음이 아직 없으면 로딩 */
export function widgetState(w: HomeWidgetDef, bundle: KpiBundle | null): WidgetState {
  if (!bundle) return { status: "loading", message: "", notice: "" };
  const notices = new Set<string>();
  const ids = w.id === "table" || w.id === "today" ? [] : w.kpis; // 띠·표는 행마다 따로 판정
  for (const id of ids) {
    const c = kpiCellState(id, bundle);
    if (c.status === "ok") { if (c.notice) notices.add(c.notice); continue; }
    if (c.status === "unlinked" || c.status === "missing") return { status: "pending", message: c.message, notice: "" };
    if (c.status === "off") return { status: "loading", message: "", notice: "" };
    return { status: "error", message: c.message, notice: "" };
  }
  return { status: "ready", message: "", notice: [...notices].join(" · ") };
}

/** 오류 칸 "마지막 값 … · N분 전" — 원본별 마지막 성공 시각 중 가장 오래된 것 */
export function lastOkAgo(w: HomeWidgetDef, okAt: HomeKpiState["okAt"], now: number): string {
  const times = w.kpis.flatMap((id) => KPI_BY_ID[id].loads).map((s) => okAt[s]).filter((x): x is number => typeof x === "number");
  if (!times.length) return "";
  const m = Math.max(0, Math.round((now - Math.min(...times)) / 60_000));
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
}

/* ───────────── 위젯 보기(view) ───────────── */

export type ModelCtx = { teamOf: (author: string) => string; period: KpiPeriodKey };
const teamLabelOf = (t: string) => (t === "E" ? "CSS" : t);
const settingsOf = (b: KpiBundle) => ({ targets: b.settings.targets, holidays: b.settings.holidays });

/** 숫자 하나 + 지난 기간 + 팀별 + 8주 추세 — kpiCount 하나로(표·띠와 같은 셈) */
export function countSeries(id: KpiId, b: KpiBundle, ctx: ModelCtx): { value: number | null; prev: number | null; prevLabel: string; teams: Array<{ team: string; value: number }>; trend: Array<{ label: string; value: number }>; period: KpiPeriodKey | null } {
  const period = effectivePeriod(id, ctx.period);
  const r = b.ranges;
  const range = period ? rangeOfPeriod(r, period) : r.todayRange;
  const c = { today: r.today, teamOf: ctx.teamOf };
  const value = kpiCount(id, b.facts, {}, range, c)?.n ?? null;
  const pr = period ? prevRangeOf(r, period) : null;
  const prev = pr ? kpiCount(id, b.facts, {}, pr.range, c)?.n ?? null : null;
  const teams = KPI_TEAMS.map((team) => ({ team, value: kpiCount(id, b.facts, { team }, range, c)?.n ?? 0 }));
  const trend = r.weeks8.map((w) => ({ label: w.label, value: kpiCount(id, b.facts, {}, w, c)?.n ?? 0 }));
  return { value, prev, prevLabel: pr?.label || "", teams, trend, period };
}

/** K1 점검 · K12 재계약 확인 지남 — 숫자 카드 */
export function numberView(id: "K1" | "K12", b: KpiBundle, ctx: ModelCtx): KpiNumberView | null {
  const def = KPI_BY_ID[id];
  if (id === "K12") {
    if (!b.facts.recontract) return null;
    const v = recontractOverdueKpi(b.facts.recontract, b.ranges, b.settings.targets.K12);
    return {
      kind: "number", value: v.value ?? 0, unit: def.unit, better: "down", tone: (v.value ?? 0) > 0 ? "bad" : "ok",
      sub: v.extra.textDates ? `확인일을 글자로 적은 열린 건 ${v.extra.textDates}곳은 따로 확인` : "다음확인일 지난 열린 건",
      teams: v.byTeam.map((t) => ({ team: t.team, label: teamLabelOf(t.team), value: t.value ?? 0 })),
    };
  }
  const s = countSeries(id, b, ctx);
  if (s.value === null) return null;
  return {
    kind: "number", value: s.value, unit: def.unit, prevValue: s.prev, prevLabel: s.prevLabel || undefined, better: def.better,
    teams: s.teams.map((t) => ({ team: t.team, label: teamLabelOf(t.team), value: t.value })), points: s.trend,
  };
}

/** K3 AS — 추세 */
export function sparkView(id: "K3", b: KpiBundle, ctx: ModelCtx): KpiSparkView | null {
  const s = countSeries(id, b, ctx);
  if (s.value === null) return null;
  return { kind: "spark", unit: KPI_BY_ID[id].unit, points: s.trend, value: s.value, prevValue: s.prev, prevLabel: s.prevLabel || undefined, better: "up" };
}

/** K7(목표선·상태색) + K8(옆 숫자) — 팀별 막대. 목표 = 인원 × 영업일 1(kpiProgress 의 팀 행) */
export function expansionView(b: KpiBundle, ctx: ModelCtx): KpiTeamBarsView | null {
  if (!b.facts.expansion) return null;
  const p7 = effectivePeriod("K7", ctx.period) ?? "month";
  const rows7 = kpiProgress("K7", b.facts, { ranges: b.ranges, period: p7, settings: settingsOf(b), teamOf: ctx.teamOf });
  const s8 = countSeries("K8", b, ctx);
  const all = rows7.find((r) => r.scope === "all");
  return {
    kind: "teamBars", unit: "건", legend: "막대 = PC 확장성(점선 = 목표) · 옆 = 복합기",
    total: all?.actual ?? null,
    rows: rows7.filter((r) => r.scope === "team").map((r) => ({
      team: r.team, label: teamLabelOf(r.team), value: r.actual ?? 0, target: r.target,
      sub: `복합기 ${s8.teams.find((t) => t.team === r.team)?.value ?? 0}`,
    })),
  };
}

/** K10 초과사용 제안 방문 — 목표 대비. 목표가 달 단위라 오늘·이번 주를 골라도 이번 달로 본다 */
export function overageView(b: KpiBundle, ctx: ModelCtx): { view: KpiProgressView; period: KpiPeriodKey } | null {
  if (!b.facts.overage) return null;
  const period: KpiPeriodKey = ctx.period === "quarter" ? "quarter" : "month";
  const rows = kpiProgress("K10", b.facts, { ranges: b.ranges, period, settings: settingsOf(b), teamOf: ctx.teamOf });
  const all = rows.find((r) => r.scope === "all");
  const fallback = overageKpi(b.facts.overage, b.ranges, b.settings.targets.K10);
  const range = rangeOfPeriod(b.ranges, period);
  const left = bizDays(shiftYmd(b.ranges.today, 1), range.to, b.settings.holidays);
  return {
    period,
    view: {
      kind: "progress", value: all?.actual ?? fallback.value ?? 0, target: all?.target ?? fallback.target ?? 0, unit: "건",
      pace: paceOf(b.ranges, period), remainLabel: `남은 영업일 ${left}일`,
      teams: rows.filter((r) => r.scope === "team").map((r) => ({ team: r.team, label: teamLabelOf(r.team), value: r.actual ?? 0, target: r.target })),
    },
  };
}

/** K19 OKR 달성률 — 링 */
export function okrView(b: KpiBundle): KpiRingView | null {
  if (!b.facts.okr) return null;
  const v = okrKpi(b.facts.okr, b.ranges, b.settings.targets.K19);
  if (!v.denominator) return null;
  return {
    kind: "ring", numerator: v.numerator ?? 0, denominator: v.denominator, unit: "개", pace: b.ranges.monthElapsedRate,
    chips: [{ label: "미흡", value: v.extra.미흡 ?? 0, tone: v.extra.미흡 ? "warn" : "idle" }, { label: "미착수", value: v.extra.미착수 ?? 0, tone: v.extra.미착수 ? "bad" : "idle" }],
    teams: v.byTeam.map((t) => ({ team: t.team, label: t.team, value: t.numerator ?? 0, target: t.denominator ?? 0 })),
  };
}

/** K2 분기 점검 진행 — 워킨맵 꼴 "점검 373/1469 · 25%" + 필요/지금 페이스(1인 하루 단위) */
export function quarterGoalView(b: KpiBundle): KpiQuarterGoalView | null {
  if (!b.facts.workin) return null;
  const rows = workinPace(b.facts.workin, b.ranges, b.facts.roster, b.settings.holidays);
  const all = rows[0];
  if (!all || !all.total) return null;
  // 필요·지금 페이스 = workinPace 그대로(반올림 전 값 — 표시 1자리는 위젯). 명단을 못 읽으면(인원 0) 워킨맵 '4인' 칸
  const byHead = all.headcount > 0;
  const heads = byHead ? all.headcount : 4;
  const needOf = (d: typeof all.toEnd) => {
    const n = byHead ? d.needHead : d.need4;
    return n ?? Number.POSITIVE_INFINITY; // null = 남은 영업일 0(기한 경과) → "필요 —"·빨강
  };
  const now = all.pacePerPerson ?? 0;
  const line = (label: string, d: typeof all.toEnd) => ({ label: `${label}(${d.date.slice(5).replace("-", "/")}) · 영업일 ${d.days}일`, need: needOf(d), now, unit: `단위/일·인(${heads}명)` });
  return {
    kind: "quarterGoal", label: "점검", value: all.done, target: all.total, pace: b.ranges.quarterElapsedRate,
    lines: [line("분기 말일", all.toEnd), line("말일 10일 전", all.toEarly)],
    teams: rows.slice(1).map((t) => ({ team: t.team, label: teamLabelOf(t.team), value: t.done, target: t.total })),
  };
}

/** 미처리(접수 + 지난 일정) — 오래된 것부터 */
export function unhandledView(b: KpiBundle, onOpenRow?: (r: UnhandledRow) => void): KpiListView | null {
  const rows = b.facts.unhandled;
  if (!rows) return null;
  const sorted = [...rows].sort((a, z) => z.ageDays - a.ageDays || a.key.localeCompare(z.key));
  const tone = (d: number): KpiTone => (d >= 7 ? "bad" : d >= 3 ? "warn" : "idle");
  const reception = rows.filter((r) => r.source === "reception").length;
  const logistics = rows.filter((r) => r.kind === "물류").length;
  const items: KpiListItem[] = sorted.slice(0, 12).map((r) => ({
    key: r.key, title: r.vendor || r.title || "(업체 없음)", ageLabel: r.ageDays ? `${r.ageDays}일 지남` : "오늘",
    badge: UNHANDLED_BADGE[r.kind], meta: [r.team, r.assignee || "미배정"].filter(Boolean).join(" · "), tone: tone(r.ageDays),
    onOpen: onOpenRow && r.kind !== "물류" ? () => onOpenRow(r) : undefined,
  }));
  return {
    kind: "list", total: rows.length, unit: "건", items,
    chips: [
      { label: "접수", value: reception, tone: reception ? "warn" : "idle" },
      { label: "일정", value: rows.length - reception - logistics, tone: rows.length - reception - logistics ? "warn" : "idle" },
      { label: "물류", value: logistics },
      { label: "7일 넘음", value: rows.filter((r) => r.ageDays >= 7).length, tone: rows.some((r) => r.ageDays >= 7) ? "bad" : "idle" },
    ],
  };
}

/** 금일 현황 띠 — kpiTodayLine(정의의 today 순서). 원본 없는 KPI 는 회색, 못 읽은 원본은 "—" */
export function todayItems(b: KpiBundle, ctx: Pick<ModelCtx, "teamOf">): Array<Omit<KpiTodayItem, "onOpen"> & { id: KpiId }> {
  return KPI_DEFS.filter((d) => d.today).map((d) => {
    const st = kpiCellState(d.id, b);
    const value = st.status === "ok" ? kpiCount(d.id, b.facts, {}, b.ranges.todayRange, { today: b.ranges.today, teamOf: ctx.teamOf })?.n ?? null : null;
    return { id: d.id, key: d.id, label: d.name, unit: d.unit, value, pending: st.status === "unlinked" };
  });
}

/* ───────────── KPI 달성표 ───────────── */

const GROUP_LABEL: Record<string, string> = { "현장 실행": "현장", "고객가치·영업": "영업", "응대 속도": "접수", "성장·OKR": "소통·성장" };

/** 목표 기준 짧은 글("인당 주 2" 등) — 행 이름 옆 */
export function targetHint(id: KpiId, t: KpiTarget | undefined): string {
  const basis = KPI_BY_ID[id].targetBasis;
  if (!t) return "";
  if (basis === "perPersonWeek" && t.perPersonWeek !== undefined) return `인당 주 ${t.perPersonWeek}`;
  if (basis === "perPersonBizDay" && t.perPersonBizDay !== undefined) return `인당 영업일 ${t.perPersonBizDay}`;
  if (basis === "perTeamMonth") return t.perPersonMonth !== undefined ? `인당 월 ${t.perPersonMonth}` : t.perTeamMonth !== undefined ? `파트 월 ${t.perTeamMonth}` : "";
  if (basis === "ratio" && t.value !== undefined) return `목표 ${t.value}%`;
  if (basis === "zero") return "0 이 정상";
  return "";
}

/**
 * 행 = KPI 하나, 칸 = CS 전체 / A~E / 펼치면 개인. 값은 kpiProgress(전체·팀·개인 같은 함수).
 * 비율 지표(ratio·workin)는 칸이 분자/분모, 목표 없는 지표는 "n/—"(전체 지표 보기에만 — main 아님).
 */
export function tableRows(b: KpiBundle, ctx: ModelCtx): Array<Omit<KpiTableRow, "onOpen">> {
  const main = new Set(mainKpiIds(b.settings.targets));
  return KPI_DEFS.map((def) => {
    const st = kpiCellState(def.id, b);
    const p = effectivePeriod(def.id, ctx.period) ?? "month";
    const chip = periodChip(def.id, ctx.period);
    const hint = targetHint(def.id, b.settings.targets[def.id]);
    const base = {
      id: def.id, label: hint ? `${def.name} · ${hint}` : def.name, unit: def.unit,
      period: chip !== PERIOD_LABEL[ctx.period] ? chip : undefined, main: main.has(def.id), group: GROUP_LABEL[def.group] || def.group,
    };
    const empty = { total: { actual: null, target: null }, teams: [] };
    if (st.status !== "ok") {
      const pendingText = st.status === "unlinked" ? "원본 연결 필요" : st.status === "missing" ? "준비 중(원본 표 실행 대기)" : st.status === "off" ? "불러오는 중" : "불러오지 못함";
      return { ...base, ...empty, pending: true, pendingText };
    }
    const rows = kpiProgress(def.id, b.facts, { ranges: b.ranges, period: p, settings: settingsOf(b), teamOf: ctx.teamOf });
    const all = rows.find((r) => r.scope === "all");
    return {
      ...base,
      total: all ? { actual: all.actual, target: all.target } : { actual: null, target: null },
      teams: rows.filter((r) => r.scope === "team").map((r) => ({ team: r.team, actual: r.actual, target: r.target })),
      people: rows.filter((r) => r.scope === "person").map((r) => ({ name: r.label, team: r.team, actual: r.actual, target: r.target })),
    };
  });
}

/* ───────────── 내 이번 주(관제 덱 인사말) ───────────── */

/** 인사말 "이번 주 내 점검 n대 · AS n건" 과 전체 — 표 원본이 없으면 null */
export function weekSummary(b: KpiBundle | null, author: string, teamOf: (a: string) => string): { mine: { inspection: number; as: number } | null; all: { inspection: number; as: number }; weekRecords: number } | null {
  if (!b?.facts.field) return null;
  const c = { today: b.ranges.today, teamOf };
  const w = b.ranges.week;
  const n = (id: KpiId, s: { author?: string }) => kpiCount(id, b.facts, s, w, c)?.n ?? 0;
  const weekRecords = b.facts.field.filter((r) => !r.hidden && r.day >= w.from && r.day <= w.to).length;
  return { mine: author ? { inspection: n("K1", { author }), as: n("K3", { author }) } : null, all: { inspection: n("K1", {}), as: n("K3", {}) }, weekRecords };
}
