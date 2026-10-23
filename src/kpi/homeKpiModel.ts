/**
 * 홈 KPI 현황판 — 컨테이너(HomeKpiBoard.tsx)가 쓰는 순수 로직(2026-10-23 설계안 docs/tasks/home-kpi-dashboard.md,
 * 2026-10-24 전면 개편 docs/tasks/home-redesign-2026-10-24.md — KPI 달성표가 주인공, 위젯 6개).
 *  · 위젯 목록·기본 배치·배치 저장 형식(localStorage `home_kpi_layout_v1` = {v:1, items} — 버전은 올리지 않는다, 사라진 id 는 읽을 때 버림)
 *  · 보이는 위젯 → 읽을 원본(숨긴 위젯 원본은 안 읽음) · 60초 가벼운 원본 / 5분 무거운 원본 나눔 · 묶음 합치기(실패면 마지막 값 유지)
 *  · 위젯 보기(view) 만들기 — 숫자는 kpiCompute·homeUnhandled 의 함수만 부른다(여기서 새로 세지 않음)
 * 조회·화면 없음. 테스트: tests/homeKpiBoard.test.tsx
 */
import { KPI_BY_ID, KPI_DEFS, RECONTRACT_OVERDUE_DEFINITION, mainKpiIds, type KpiId, type KpiPeriodKey, type KpiSource, type KpiTarget } from "./kpiDefs";
import {
  kpiCount, kpiProgress, kpiRowStatus, KPI_TEAMS, okrKpi, okrTeamRows, okrWeekResult, pct, recontractOverdue, shiftYmd, workinPace,
  type KpiRange, type KpiRanges, type KpiRowStatus,
} from "./kpiCompute";
import { kpiCellState, sourcesFor, type KpiBundle, type KpiSourceStatus } from "./kpiData";
import { splitByGroup } from "../homeUnhandled";
import { OKR_TEAMS, judgmentCounts, normalizeJudgment, type OkrJudgment } from "../okr";
import type {
  KpiOkrView, KpiPersonCell, KpiQuarterGoalView, KpiScope as KpiCellScope, KpiSize, KpiTableRow, KpiTodayItem, KpiUnhandledTotalView,
  KpiView, KpiWidgetProps,
} from "./KpiWidgets.view";
import type { KpiLayoutItem } from "./HomeKpiGrid.view";

/* ───────────── 위젯 목록 · 기본 배치 ───────────── */

/** 2026-10-24 개편: 6개만(점검·AS 추세·확장성·초과 제안·재계약 지남·미처리 요약 위젯은 삭제 — 달성표 행 펼치기·미처리 합산 카드가 대신) */
export type HomeWidgetId = "today" | "table" | "K2" | "receptionPanel" | "unhandledPanel" | "K19";
export type HomeWidgetDef = {
  id: HomeWidgetId;
  title: string;
  /** panel = 기존 홈 부품을 그대로 그린다(스스로 읽고 갱신) */
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

/** 순서 = 기본 배치 순서(2026-10-24): 금일 현황 → KPI 달성표(주인공, 전체 폭 두 줄) → 분기 점검 진행 → 미처리 전체 → 미처리 일정 → OKR */
export const HOME_WIDGETS: HomeWidgetDef[] = [
  { id: "today", title: "금일 현황", kind: "todayStrip", kpis: TODAY_KPI_IDS, sizes: ["4x1"], description: "오늘 점검·AS·물류·확장성·칭찬 … 한 줄" },
  { id: "table", title: "KPI 달성표", kind: "kpiTable", kpis: ALL_KPI_IDS, sizes: ["4x2", "4x1"], description: "지표별 달성·순항·부족 · CS 전체 → 팀 → 개인(행 펼치기)" },
  { id: "K2", title: "분기 점검 진행", kind: "quarterGoal", kpis: ["K2"], sizes: ["2x1", "4x1"], description: "팀별 완료/대상 · 필요 페이스 vs 지금 페이스(팀 인원 기준)" },
  // 미처리 전체 = 접수 미처리(현황판 같은 계산, 자기 로더) + 물류 미처리 + 재계약 확인 지남(현황판 묶음) — K12·K16 원본을 묶음에서 받는다
  { id: "receptionPanel", title: "미처리 전체", kind: "unhandledTotal", kpis: ["K12", "K16"], sizes: ["2x1", "1x1"], description: "접수 + 물류 + 재계약 확인 지남 합산 · 접수 종류별" },
  // 팀장 결정(2026-10-23): 사용자가 요청해 만든 홈 미처리 칸(팀 탭) — 자기 로더로 읽는다. kpis 를 비워 현황판 원본을 더 읽지 않게
  { id: "unhandledPanel", title: "미처리 일정", kind: "panel", kpis: [], sizes: ["2x2", "4x1"], description: "기존 홈 미처리 칸 — 팀 탭 · 접수·AS / 물류 묶음" },
  { id: "K19", title: "OKR 달성률", kind: "okr", kpis: ["K19"], sizes: ["1x1", "2x1"], description: "이번 주 파트 판정 · 이번 달 주별 막대 · 미작성 파트" },
];
export const HOME_WIDGET_BY_ID: Record<HomeWidgetId, HomeWidgetDef> = Object.fromEntries(HOME_WIDGETS.map((w) => [w.id, w])) as Record<HomeWidgetId, HomeWidgetDef>;

export const HOME_KPI_DEFAULT_LAYOUT: KpiLayoutItem[] = HOME_WIDGETS.map((w) => ({ id: w.id, size: w.sizes[0], hidden: w.defaultHidden === true }));

/* ───────────── 배치 저장 (localStorage, 설계안 4-5 2단계-a) ───────────── */

export const HOME_KPI_LAYOUT_KEY = "home_kpi_layout_v1";
export const HOME_KPI_LAYOUT_VERSION = 1;

/**
 * 저장 글 → 배치. 모양이 틀리거나 버전이 다르면 기본 배치. 모르는 id(2026-10-24 에 없앤 K1·K3·exp·K10·K12·unhandled 포함)·중복은 버리고,
 * 허용 안 된 크기는 그 위젯 첫 크기, 저장 뒤에 새로 생긴 위젯은 끝에 붙인다(설계안 4-5 "모르는 id 는 버리고 새 위젯은 끝에").
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
 * IT 퀴즈·실습 기록(2026-10-24)은 기간 안 행만 한 번 — 가벼운 쪽.
 */
export const FAST_SOURCES: ReadonlySet<KpiSource> = new Set<KpiSource>(["unhandled", "receptionWeek", "keyman", "office", "praise", "customerPraise", "overage", "bulman", "itQuiz", "itPractice"]);
export const SLOW_REFRESH_MS = 5 * 60_000;
export const FAST_REFRESH_MS = 60_000;

export function splitSources(want: Set<KpiSource>, full: boolean): Set<KpiSource> {
  if (full) return new Set(want);
  return new Set([...want].filter((s) => FAST_SOURCES.has(s)));
}

/**
 * 여러 쪽(1,000행 단위)으로 나눠 받는 무거운 원본(2026-10-24 실측, 8/31~분기 말):
 * 점검·AS 2,000행 3.6MB · 활동 기록 2,069행 3.7MB · 워킨맵 4,014행 · 방문 2,002행 · 재계약 1,200행 · 확장성.
 * 첫 로드는 이것들을 뒤로 미루고 나머지(한두 번 조회)로 먼저 그린다.
 */
export const HEAVY_SOURCES: ReadonlySet<KpiSource> = new Set<KpiSource>(["field", "expansion", "events", "workin", "visits", "recontract"]);

/** 첫 로드 두 단계: [가벼운 원본(+명단) 먼저, 무거운 원본 뒤에]. 숫자는 같은 loadKpiBundle·같은 함수 — 순서만 나눈다 */
export function firstLoadPhases(sources: Set<KpiSource>): [Set<KpiSource>, Set<KpiSource>] {
  const light = new Set([...sources].filter((s) => !HEAVY_SOURCES.has(s)));
  const heavy = new Set([...sources].filter((s) => HEAVY_SOURCES.has(s)));
  return [light, heavy];
}

/**
 * 위젯 보기 계산 캐시(2026-10-24 속도). 같은 묶음·같은 기간이면 다시 세지 않는다.
 * 왜: 홈이 다시 그려질 때마다 달성표(34 지표 × 전체·팀·개인)·띠·추세를 새로 셌다(실측 Node 75~90ms/회).
 * 묶음은 읽을 때마다 새 객체(mergeBundle)라 새로 읽으면 자연히 새로 센다.
 */
const viewCache = new WeakMap<KpiBundle, { teamOf: ModelCtx["teamOf"]; m: Map<string, unknown> }>();
export function cachedView<T>(b: KpiBundle, ctx: ModelCtx, key: string, make: () => T): T {
  let c = viewCache.get(b);
  if (!c || c.teamOf !== ctx.teamOf) { c = { teamOf: ctx.teamOf, m: new Map() }; viewCache.set(b, c); }
  const k = `${ctx.period}|${key}`;
  if (c.m.has(k)) return c.m.get(k) as T;
  const v = make();
  c.m.set(k, v);
  return v;
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

export const PERIOD_LABEL: Record<KpiPeriodKey, string> = { today: "오늘", week: "이번 주", month: "이번 달", quarter: "분기" };
/** 달성표 기간 칩(2026-10-24: 오늘은 금일 현황 띠가 맡는다) */
export type TablePeriod = "week" | "month" | "quarter";
export const TABLE_PERIODS: TablePeriod[] = ["week", "month", "quarter"];
const PERIOD_KEYS: KpiPeriodKey[] = ["today", "week", "month", "quarter"];
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

/** 경과율(달성 판정용). 오늘은 판정 안 함 */
export function paceOf(r: KpiRanges, p: KpiPeriodKey): number | null {
  return p === "week" ? r.weekElapsedRate : p === "month" ? r.monthElapsedRate : p === "quarter" ? r.quarterElapsedRate : null;
}

/* ───────────── 위젯 상태 ───────────── */

type WidgetStatus = KpiWidgetProps["status"];
export type WidgetState = { status: WidgetStatus; message: string; notice: string };

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
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/**
 * ② 분기 점검 진행 — 팀별만(사용자 2026-10-24). 팀 5줄(A·B·C·D·CSS) 완료/대상·% + 필요 n/일·인 → 지금 n/일·인(그 팀 인원 기준).
 * 기준 = 분기 말일(end, 기본) / 말일 10일 전(early). 값은 workinPace 그대로(반올림 전 — 표시 자리수는 위젯).
 * need null = 그 팀 인원 0(명단 못 읽음) 또는 남은 영업일 0 — 위젯은 "—".
 */
export function quarterGoalView(b: KpiBundle, basis: "end" | "early" = "end"): Omit<KpiQuarterGoalView, "onBasis"> | null {
  if (!b.facts.workin) return null;
  const rows = workinPace(b.facts.workin, b.ranges, b.facts.roster, b.settings.holidays);
  const all = rows[0];
  if (!all || !all.total) return null;
  const pick = (t: (typeof rows)[number]) => (basis === "end" ? t.toEnd : t.toEarly);
  const d = pick(all);
  return {
    kind: "quarterGoal", basis,
    endLabel: `${basis === "end" ? "분기 말일" : "말일 10일 전"}(${md(d.date)})`,
    bizDaysLeft: d.days, elapsed: b.ranges.quarterElapsedRate / 100, // 위젯 약속: 0~1
    teams: rows.slice(1).map((t) => ({
      team: teamLabelOf(t.team), done: t.done, total: t.total, pct: t.rate, headcount: t.headcount,
      need: pick(t).needHead, now: t.pacePerPerson,
    })),
  };
}

/**
 * ⑤ OKR — 주 단위(기본) / 이번 달. 셈법은 achievementRate·judgmentCounts 그대로, 입력 기록만 주간으로.
 * 판정이 하나도 없는 파트는 missingTeams("이번 주 OKR 미작성 n팀") — 0% 로 보이지 않는다(pct null).
 * weeks = 이번 주가 든 달의 1~n주차 달성률(아직 판정 없는 주는 null).
 */
export function okrView(b: KpiBundle, period: "week" | "month" = "week"): Omit<KpiOkrView, "onPeriod"> | null {
  const okr = b.facts.okr;
  if (!okr) return null;
  let pctValue: number | null;
  let counts: Record<OkrJudgment, number>;
  let missingTeams: string[];
  if (period === "week") {
    if (!okr.week) return null;
    const r = okrWeekResult(okr.week);
    pctValue = r.pct; counts = r.counts; missingTeams = r.missingTeams;
  } else {
    const per = OKR_TEAMS.map((team) => ({ team, rows: okrTeamRows(okr.cycle, okr.quarter, okr.reports, team) }));
    pctValue = okrKpi(okr, b.ranges).value;
    counts = judgmentCounts(per.flatMap((p) => p.rows));
    missingTeams = per.filter((p) => !p.rows.some((x) => normalizeJudgment(x.judgment))).map((p) => p.team);
  }
  const w = okr.week;
  return {
    kind: "okr", period, pct: pctValue,
    counts: [
      { label: "완료", value: counts["완료"], tone: "ok" },
      { label: "부분달성", value: counts["부분달성"], tone: counts["부분달성"] ? "warn" : "idle" },
      { label: "미흡", value: counts["미흡"], tone: counts["미흡"] ? "warn" : "idle" },
      { label: "미착수", value: counts["미착수"], tone: counts["미착수"] ? "bad" : "idle" },
      ...(counts["해당없음"] ? [{ label: "해당없음", value: counts["해당없음"], tone: "idle" }] : []),
    ],
    weeks: w ? w.weeks.map((x) => ({ label: x.label, pct: okrWeekResult(w, x.id).pct, current: x.id === w.id })) : [],
    missingTeams,
  };
}

/**
 * ④ 미처리 전체 — 큰 숫자 = 접수 미처리 + 물류 미처리 + 재계약 확인 지남(세 숫자 합, 새로 세지 않음).
 *  접수 = 서비스접수 현황판 계산(receptionBoardData.summarizeForHome, HomeReceptionPanel 이 읽음)
 *  물류 = 홈 미처리 일정 칸과 같은 함수(homeUnhandled.splitByGroup(mergeUnhandled …).logistics)
 *  재계약 = kpiCompute.recontractOverdue
 */
export const UNHANDLED_TOTAL_DEFS: Array<{ label: string; text: string }> = [
  { label: "접수", text: "서비스접수 미처리 현황판과 같은 계산 — 열린 접수 6종(일정이 완료된 복합기 AS 접수는 뺌)." },
  { label: "물류", text: "일정(as_tickets) 중 물류 종류 · 날짜 지남 · 완료 아님 · 180일 안 — 홈 '미처리 일정' 칸 물류 묶음과 같은 함수." },
  { label: "재계약 확인 지남", text: RECONTRACT_OVERDUE_DEFINITION },
];
/**
 * recontract null = 재계약 원본이 아직 안 옴(무거운 원본, 2단계) 또는 실패 — 합계는 접수+물류만, 칸은 "—"
 * (recontractState: loading = "재계약 확인 중", error = "재계약 제외"). 0 으로 더하거나 그리지 않는다.
 */
export function unhandledTotalView(o: {
  reception: number; logistics: number; recontract: number | null; recontractState?: "loading" | "error";
  breakdown: Array<{ label: string; value: number; tone?: string }>;
  oldest?: string; weekDelta?: number | null;
}): KpiUnhandledTotalView {
  const tone = (n: number) => (n > 0 ? "bad" : "ok");
  return {
    kind: "unhandledTotal",
    total: o.reception + o.logistics + (o.recontract ?? 0),
    parts: [
      { label: "접수", value: o.reception, tone: tone(o.reception) },
      { label: "물류", value: o.logistics, tone: tone(o.logistics) },
      o.recontract === null
        ? { label: `재계약 확인 지남(${o.recontractState === "error" ? "재계약 제외" : "재계약 확인 중"})`, value: null }
        : { label: "재계약 확인 지남", value: o.recontract, tone: tone(o.recontract) },
    ],
    breakdown: o.breakdown, oldest: o.oldest, weekDelta: o.weekDelta ?? null, defs: UNHANDLED_TOTAL_DEFS,
  };
}
/** 묶음에서 물류 미처리·재계약 확인 지남. 원본을 아직 못 읽었으면 그 칸 null(0 으로 그리지 않는다) */
export function unhandledParts(b: KpiBundle | null): { logistics: number | null; recontract: number | null } {
  const ok = (s: KpiSource) => b?.sources[s]?.status === "ok" || (b?.sources[s]?.status === "error" && b.facts[s as keyof typeof b.facts] !== undefined);
  return {
    logistics: b?.facts.unhandled && ok("unhandled") ? splitByGroup(b.facts.unhandled).logistics.length : null,
    recontract: b?.facts.recontract && ok("recontract") ? recontractOverdue(b.facts.recontract, b.today).count : null,
  };
}

/** 금일 현황 띠 — 정의의 today 순서. 원본 없는 KPI 는 회색, 못 읽은 원본은 "—" */
export function todayItems(b: KpiBundle, ctx: Pick<ModelCtx, "teamOf">): Array<Omit<KpiTodayItem, "onOpen"> & { id: KpiId }> {
  return KPI_DEFS.filter((d) => d.today).map((d) => {
    const st = kpiCellState(d.id, b);
    const value = st.status === "ok" ? kpiCount(d.id, b.facts, {}, b.ranges.todayRange, { today: b.ranges.today, teamOf: ctx.teamOf })?.n ?? null : null;
    return { id: d.id, key: d.id, label: d.name, unit: d.unit, value, pending: st.status === "unlinked" };
  });
}

/* ───────────── ③ KPI 달성표 ───────────── */

/** 목표 기준 짧은 글("인당 주 2" 등) — 행 이름 아래 작은 글자 */
export function targetHint(id: KpiId, t: KpiTarget | undefined): string {
  const basis = KPI_BY_ID[id].targetBasis;
  if (!t) return "";
  if (basis === "perPersonWeek" && t.perPersonWeek !== undefined) return `인당 주 ${t.perPersonWeek}`;
  if (basis === "perPersonBizDay" && t.perPersonBizDay !== undefined) return `인당 영업일 ${t.perPersonBizDay}`;
  if (basis === "perTeamMonth") return t.perPersonMonth !== undefined ? `인당 월 ${t.perPersonMonth}` : t.perTeamMonth !== undefined ? `파트 월 ${t.perTeamMonth}` : "";
  if (basis === "ratio" && t.value !== undefined) return `목표 ${t.value}%`;
  if (basis === "workin") return "분기 대상 100%";
  if (basis === "zero") return "0 이 정상";
  return "";
}

const CELL_SCOPES: KpiCellScope[] = ["A", "B", "C", "D", "E"];
/** 원본 상태 → 칸 상태·안내(SQL 전 IT 표는 "준비 중 · SQL 실행 대기" — 숫자 0 금지) */
function cellStateOf(st: ReturnType<typeof kpiCellState>): { cellState: KpiTableRow["cellState"]; pendingText?: string } {
  if (st.status === "ok") return { cellState: "ready" };
  if (st.status === "error") return { cellState: "error", pendingText: "불러오지 못함" };
  if (st.status === "missing") return { cellState: "pending", pendingText: "준비 중 · SQL 실행 대기" };
  if (st.status === "off") return { cellState: "pending", pendingText: "불러오는 중" };
  return { cellState: "pending", pendingText: "원본 연결 필요" };
}

/**
 * 행 = KPI 하나. pace = 기간 경과 0~1(위젯 약속 — 판정은 kpiRowStatus 가 % 로). 값은 kpiProgress(전체·팀·개인 같은 함수), 상태는 kpiRowStatus(달성·순항·부족·목표 없음·원본 없음).
 * cells = CS 전체 + A~E(없는 팀은 값 null·none), teamBars = 팀별 막대(펼치기 ⓐ), people = 개인 칩(펼치기 ⓑ — 팀 순서·실적 내림차순).
 * 목표 없는 지표는 trend(지난 기간 대비) — 전체 지표 보기에서 실적만 크게.
 */
export function tableRows(b: KpiBundle, ctx: ModelCtx): Array<Omit<KpiTableRow, "onOpen">> {
  const main = new Set(mainKpiIds(b.settings.targets));
  return KPI_DEFS.map((def) => {
    const st = kpiCellState(def.id, b);
    const p = effectivePeriod(def.id, ctx.period) ?? "month";
    const open = !isPeriodKey(def.period) && !def.periods.length; // 열린 건·7일 — 기간 경과 판정 없음
    const pace = open ? null : paceOf(b.ranges, p);
    const base = {
      id: def.id, name: def.name, unit: def.unit, targetLabel: targetHint(def.id, b.settings.targets[def.id]),
      basis: def.basis, pace: pace === null ? null : pace / 100, main: main.has(def.id), ...cellStateOf(st),
    };
    if (st.status !== "ok") {
      return {
        ...base, status: "pending" as KpiRowStatus,
        cells: [{ scope: "CS" as KpiCellScope, value: null, target: null, status: "pending" as KpiRowStatus }, ...CELL_SCOPES.map((scope) => ({ scope, value: null, target: null, status: "pending" as KpiRowStatus }))],
        teamBars: [], people: [],
      };
    }
    const rows = kpiProgress(def.id, b.facts, { ranges: b.ranges, period: p, settings: settingsOf(b), teamOf: ctx.teamOf });
    const goalPct = b.settings.targets[def.id]?.value ?? null;
    const statusOf = (actual: number | null, target: number | null) =>
      kpiRowStatus({ actual, target, elapsed: pace, basis: def.targetBasis, better: def.better, goalPct });
    const all = rows.find((r) => r.scope === "all");
    const teamRows = rows.filter((r) => r.scope === "team");
    const status = all ? statusOf(all.actual, all.target) : "none";
    const cells = [
      { scope: "CS" as KpiCellScope, value: all?.actual ?? null, target: all?.target ?? null, status },
      ...CELL_SCOPES.map((scope) => {
        const t = teamRows.find((r) => r.team === scope);
        return t ? { scope, value: t.actual, target: t.target, status: statusOf(t.actual, t.target) } : { scope, value: null, target: null, status: "none" as KpiRowStatus };
      }),
    ];
    const teamBars = teamRows.map((t) => ({ team: teamLabelOf(t.team), value: t.actual ?? 0, target: t.target, pct: t.actual === null || !t.target ? null : pct(t.actual, t.target) }));
    const order = (team: string) => KPI_TEAMS.indexOf(team);
    const people: KpiPersonCell[] = rows.filter((r) => r.scope === "person")
      .sort((a, z) => order(a.team) - order(z.team) || (z.actual ?? 0) - (a.actual ?? 0) || a.label.localeCompare(z.label, "ko"))
      .map((r) => ({ name: r.label, team: teamLabelOf(r.team), value: r.actual ?? 0, target: r.target, done: statusOf(r.actual, r.target) === "done" }));
    let trend: KpiTableRow["trend"];
    if (status === "none" && all) {
      const pr = open ? null : prevRangeOf(b.ranges, p);
      const prev = pr ? kpiCount(def.id, b.facts, {}, pr.range, { today: b.ranges.today, teamOf: ctx.teamOf })?.n ?? null : null;
      trend = { delta: prev === null || all.actual === null ? null : all.actual - prev, label: pr ? `${pr.label} 대비` : "" };
    }
    return { ...base, status, cells, teamBars, people, ...(trend ? { trend } : {}) };
  });
}

/* ───────────── 내 이번 주(운영 블록 절약 효과) ───────────── */

/** "이번 주 내 점검 n대 · AS n건" 과 전체·이번 주 양식 장수 — 표 원본이 없으면 null */
export function weekSummary(b: KpiBundle | null, author: string, teamOf: (a: string) => string): { mine: { inspection: number; as: number } | null; all: { inspection: number; as: number }; weekRecords: number } | null {
  if (!b?.facts.field) return null;
  const c = { today: b.ranges.today, teamOf };
  const w = b.ranges.week;
  const n = (id: KpiId, s: { author?: string }) => kpiCount(id, b.facts, s, w, c)?.n ?? 0;
  const weekRecords = b.facts.field.filter((r) => !r.hidden && r.day >= w.from && r.day <= w.to).length;
  return { mine: author ? { inspection: n("K1", { author }), as: n("K3", { author }) } : null, all: { inspection: n("K1", {}), as: n("K3", {}) }, weekRecords };
}
