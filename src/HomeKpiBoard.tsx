/**
 * 홈 = CS KPI 현황판 컨테이너(2026-10-23, 설계안 docs/tasks/home-kpi-dashboard.md · Q1~Q13 제안값 확정 + 사용자 추가 요구).
 *  · 숫자: kpiData.loadKpiBundle 한 번(보이는 위젯의 원본만 — 숨긴 위젯 원본은 안 읽음) → kpi/homeKpiModel 이 위젯 보기로
 *  · 갱신: 화면이 보이고(KeepAlive 활성) 탭이 보일 때만. 60초마다 가벼운 원본, 5분마다 전체(homeKpiModel FAST_SOURCES)
 *  · 첫 로드는 세 묶음(2026-10-24 속도): 첫 숫자 원본으로 먼저 그리고 바깥 느린 원본(LATE_SOURCES)·무거운 원본(HEAVY_SOURCES)은 오는 대로
 *  · 위젯 4개(2026-10-24 마무리): 금일 현황 · KPI 달성표(분기 점검 진행은 K2 행 안) · 미처리 · OKR(범위 칩 전체/A~D/개인)
 *  · 팀 카드(2026-10-25 밤): 온 칸은 숫자·안 온 칸만 "…", 캐시(v3 teams)가 있으면 안 온 칸도 캐시 값으로 첫 그림부터
 *  · 마지막 값 캐시(homeKpiSnapshot v3): 미처리 합계도 — 미처리 원본(엣지 함수)이 오기 전엔 캐시 합계 카드, 오면 미처리 칸
 *  · 위젯 보기는 묶음·기간이 같으면 다시 세지 않는다(cachedView) — 부모가 다시 그려도 달성표를 매번 세지 않게
 *  · 실패: 위젯마다 "—" + [다시] + 마지막 값(N분 전). 원본 표 없음 = 준비 중, 원본 없음 = 원본 연결 필요(절대 0 으로 안 보임)
 *  · 배치: localStorage home_kpi_layout_v1 = {v:1, items}. 편집(크기·위치·숨김)은 HomeKpiGrid
 *  · 위젯을 누르면 같은 숫자의 화면으로(Home 이 받던 onNavigate 재사용)
 *  · 지난 기간 보기(2026-10-26 docs/tasks/home-period-nav-2026-10-26.md): 달성표 [주][월][분기] + ◀ ▶ [오늘로] = cursor{period, offset}.
 *    메모리에 있는 기간(지난 1~7주·지난달)은 파생 묶음(조회 0), 그 밖(2~5달 전·지난 분기)은 추가 조회 → 메모리 LRU 3, 늦은 응답은 버림.
 *    팀 카드·달성표만 그 기간, 금일 띠·미처리 칸·머리 큰 숫자는 늘 지금. 마지막 값 캐시는 offset 0 일 때만. 커서는 저장하지 않는다.
 * 표시 부품은 kpi/KpiWidgets.view · kpi/HomeKpiGrid.view(윤화면) 를 그대로 쓴다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "./toast";
import { kstDate } from "./visits";
import { teamForAuthor } from "./operations";
import { useScreenActive } from "./screenActive";
import HomeUnhandledPanel from "./HomeUnhandledPanel";
import { loadKpiBundle, type KpiBundle } from "./kpi/kpiData";
import { KPI_BY_ID, type KpiScreen, type KpiSource } from "./kpi/kpiDefs";
import { HomeKpiGrid, type KpiGridWidget, type KpiLayoutItem } from "./kpi/HomeKpiGrid.view";
import { KpiWidget, type KpiLoadStatus, type KpiOkrScope, type KpiView } from "./kpi/KpiWidgets.view";
import {
  FAST_REFRESH_MS, HOME_KPI_DEFAULT_LAYOUT, HOME_WIDGETS, SLOW_REFRESH_MS,
  cachedView, cursorCacheKey, cursorPlan, firstLoadPhases, lastOkAgo, lruPut, mergeBundle, okrView, pastBundle, pickOkrWeekId, readHomeLayout,
  requestGate, sourcesForLayout, splitSources, tableRows, todayItems, widgetState, writeHomeLayout,
  type HomeKpiState, type HomeWidgetDef, type TablePeriod,
} from "./kpi/homeKpiModel";
import { buildHomeSnapshot, mergeSnapshotList, readHomeSnapshot, snapshotAgo, writeHomeSnapshot, type HomeKpiSnapshot } from "./kpi/homeKpiSnapshot";
import { kpiCellState } from "./kpi/kpiData";
import { mergeTeamCardsWithSnapshot, teamBoardView, toggleTeamFilter } from "./kpi/teamBoard";
import { TeamBoardStrip } from "./kpi/TeamBoard.view";
import type { TeamKey } from "./kpi/teamColors";
import { canStep, cursorLabel, cursorRange, isEnded, step, type PeriodCursor } from "./kpi/periodCursor";
import { currentWeekOf, weekCycleId } from "./okr";

export type HomeKpiBoardProps = {
  /** 위젯·표 행·띠 칩을 누르면 열 화면(App 의 screen 값) */
  onNavigate?: (screen: KpiScreen["screen"]) => void;
  /** 미처리 일정 칸: 지난 일정 줄 → 일정리스트 미처리(Home openOverdue) */
  onOpenOverdue?: () => void;
  /** 미처리 칸·카드: 접수 → 서비스접수(미처리 현황판) */
  onOpenReception?: () => void;
  /** 읽을 때마다 묶음을 알려 준다(홈 한 줄 머리 "갱신 n분 전"·절약 효과 — 같은 원본을 두 번 읽지 않게) */
  onLoaded?: (state: HomeKpiState) => void;
  /** 편집 모드 — 홈 한 줄 머리의 [편집] 이 켠다(2026-10-24). 주지 않으면 그리드 안의 [편집] */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
};

const storage = (): Storage | null => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};
const MIN_GAP_MS = 15_000; // 화면 오가기·포커스가 몰려도 15초 안에는 다시 읽지 않음
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 분기 점검 보기(kind 포함) → 달성표 K2 행 블록(kind 없음) */
function withoutKind<T extends { kind: string }>(v: T): Omit<T, "kind"> {
  const { kind: _kind, ...rest } = v;
  void _kind;
  return rest;
}

/** 오류 칸 "마지막 값" 한 줄 */
function headline(v: KpiView | null): string {
  if (!v) return "";
  switch (v.kind) {
    case "quarterGoal": { const d = v.teams.reduce((a, t) => a + t.done, 0), n = v.teams.reduce((a, t) => a + t.total, 0); return `${d}/${n}`; }
    case "okr": return v.pct === null ? "" : `${v.pct}%`;
    case "unhandledTotal": return `${v.total}건`;
    default: return "";
  }
}

export default function HomeKpiBoard({ onNavigate, onOpenOverdue, onOpenReception, onLoaded, editing: editingProp, onEditingChange }: HomeKpiBoardProps) {
  const active = useScreenActive();
  const [layout, setLayout] = useState<KpiLayoutItem[]>(() => readHomeLayout(storage()));
  const [layoutNotice, setLayoutNotice] = useState("");
  // 달성표 기간 커서(2026-10-26) — 기본 "이번 주"(월~일), offset 0 = 이번 기간. 저장하지 않는다(홈을 다시 열면 늘 이번 주)
  const [cursor, setCursor] = useState<PeriodCursor>({ period: "week", offset: 0 });
  const period: TablePeriod = cursor.period;
  const [tableView, setTableView] = useState<"main" | "all">("main");
  const [goalBasis, setGoalBasis] = useState<"end" | "early">("end"); // 달성표 K2 행 안 분기 블록 기준 — 기본 말일
  const [okrWeekId, setOkrWeekId] = useState<string | undefined>(undefined); // OKR 주차 칩 — 기본 이번 주(2026-10-25 [주|월] 대신 주차)
  const [okrScope, setOkrScope] = useState<{ team: KpiOkrScope["team"]; member?: string }>({ team: "ALL" }); // OKR 범위 — 기본 CS 4파트
  // 홈 3차 팀 카드 거르기(2026-10-25): 카드를 누르면 달성표(그 팀 칸 강조)·미처리(그 팀 탭)·OKR(그 팀 범위)이 그 팀으로, 다시 누르면 전체
  const [teamFilter, setTeamFilter] = useState<TeamKey | null>(null);
  const pickTeam = (t: TeamKey) => {
    const next = toggleTeamFilter(teamFilter, t);
    setTeamFilter(next);
    setOkrScope({ team: next && next !== "E" ? next : "ALL" }); // CSS(E)는 OKR 대상 아님 → 전체
  };
  const [state, setState] = useState<HomeKpiState | null>(null);
  // 마지막 값 캐시(2026-10-24 속도) — 홈을 열자마자 이 값으로 그리고, 새 원본이 오는 대로 바꾼다(homeKpiSnapshot)
  const [snap] = useState<HomeKpiSnapshot | null>(() => readHomeSnapshot(storage(), kstDate(), Date.now()));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [innerEditing, setInnerEditing] = useState(false);
  const controlled = editingProp !== undefined;
  const editing = controlled ? editingProp : innerEditing;
  const setEditing = useCallback((v: boolean) => { if (!controlled) setInnerEditing(v); onEditingChange?.(v); }, [controlled, onEditingChange]);
  const stateRef = useRef<HomeKpiState | null>(null);
  const busy = useRef(false);
  const lastFull = useRef(0);
  const lastAny = useRef(0);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => { onLoadedRef.current = onLoaded; }, [onLoaded]);

  // 배치가 바뀌어도(크기·순서) 읽을 원본이 같으면 같은 값 — 다시 읽지 않는다
  const wantKey = useMemo(() => [...sourcesForLayout(layout)].sort().join(","), [layout]);
  const want = useMemo(() => new Set(wantKey.split(",").filter(Boolean) as KpiSource[]), [wantKey]);

  const refresh = useCallback(async (force = false) => {
    if (busy.current) return;
    const now = Date.now();
    const prev = stateRef.current;
    const loaded = new Set(prev ? Object.keys(prev.bundle.sources) : []);
    const fresh = [...want].filter((s) => !loaded.has(s)); // 새로 켠 위젯 원본
    if (!force && !fresh.length && now - lastAny.current < MIN_GAP_MS) return;
    busy.current = true;
    setLoading(true);
    try {
      const full = force || !prev || now - lastFull.current >= SLOW_REFRESH_MS || prev.bundle.today !== kstDate();
      const sources = splitSources(want, full);
      for (const s of fresh) sources.add(s);
      if (!sources.size) return;
      const apply = (b: Awaited<ReturnType<typeof loadKpiBundle>>) => {
        const next = mergeBundle(stateRef.current, b);
        stateRef.current = next;
        setState(next);
        setLoadError("");
        onLoadedRef.current?.(next);
      };
      if (prev) apply(await loadKpiBundle({ sources }));
      else {
        // 처음(값이 없을 때): 첫 숫자 원본을 받아 바로 그리고, 바깥 느린 원본·무거운 원본은 동시에 읽어 오는 대로 덮는다 — 같은 로더, 순서만 나눔
        const [firstPart, late, heavy] = firstLoadPhases(sources);
        if (firstPart.size) apply(await loadKpiBundle({ sources: firstPart }));
        // 바깥 원본은 하나씩 따로(미처리 엣지 함수가 블로그 시트 1.25MB 를 기다리지 않게)
        const rest = [...[...late].map((s) => new Set([s])), heavy].filter((p) => p.size);
        await Promise.all(rest.map(async (part) => apply(await loadKpiBundle({ sources: part }))));
      }
      lastAny.current = Date.now();
      if (full) {
        lastFull.current = lastAny.current;
        // 다 읽었을 때만 마지막 값 캐시를 새로 쓴다(계산된 보기만, 원본 행 없음). 못 써도 화면은 새 값 그대로
        const cur = stateRef.current;
        if (cur) writeHomeSnapshot(storage(), buildHomeSnapshot(cur.bundle, teamForAuthor, Date.now()));
      }
    } catch (e) {
      // loadKpiBundle 은 원본별 실패를 상태로 돌려주지만, 그 밖의 실패도 화면에 알린다(조용히 삼키지 않음)
      setLoadError(`KPI 를 불러오지 못했습니다: ${msg(e)}`);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [want]);

  useEffect(() => {
    if (!active) return; // 다른 화면이 떠 있으면(KeepAlive 숨김) 쉰다
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, FAST_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearTimeout(first); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible);
    };
  }, [active, refresh]);

  const changeLayout = (next: KpiLayoutItem[]) => {
    setLayout(next);
    setLayoutNotice(writeHomeLayout(storage(), next));
  };

  const open = useCallback((screen: KpiScreen) => {
    if (!onNavigate) return;
    onNavigate(screen.screen);
    notify(`'${screen.tab}'에서 같은 숫자를 볼 수 있습니다.`);
  }, [onNavigate]);

  const bundle = state?.bundle ?? null;
  const ctx = useMemo(() => ({ teamOf: teamForAuthor, period }), [period]);

  // ── 지난 기간 보기 ──
  const today = bundle?.today ?? kstDate();
  const [pastCache, setPastCache] = useState<Map<string, KpiBundle>>(() => new Map()); // 추가 조회 묶음(키 = 날짜|기간|offset, LRU 3)
  const [okrCache, setOkrCache] = useState<Map<string, KpiBundle>>(() => new Map()); // 다른 달 OKR 만 읽은 묶음(LRU 3)
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState("");
  const [pastRetry, setPastRetry] = useState(0);
  const pastGate = useRef(requestGate());
  const plan = useMemo(() => (bundle ? cursorPlan(bundle, today, cursor, want) : ({ kind: "now" } as const)), [bundle, today, cursor, want]);
  const okrKeyFull = plan.kind === "derive" && plan.okrKey ? `${today}|okr|${plan.okrKey}` : "";
  const needKey = plan.kind === "load" ? cursorCacheKey(today, cursor) : okrKeyFull;
  const needLoad = Boolean(needKey) && !(plan.kind === "load" ? pastCache.has(needKey) : okrCache.has(needKey));
  useEffect(() => {
    const token = pastGate.current.begin(); // 커서가 바뀌면 앞 요청 응답은 버린다
    const main = stateRef.current?.bundle;
    if (!needLoad || !main) { setPastLoading(false); return; }
    const p = cursorPlan(main, today, cursor, want);
    if (p.kind === "now") { setPastLoading(false); return; }
    const opts = p.kind === "load"
      ? { sources: p.sources, today, anchor: p.anchor, window: p.range }
      : { sources: ["okr" as const], today, anchor: p.anchor };
    setPastLoading(true);
    setPastError("");
    loadKpiBundle(opts).then((b) => {
      if (!pastGate.current.isLatest(token)) return;
      if (p.kind === "load") setPastCache((m) => lruPut(m, needKey, b, 3));
      else setOkrCache((m) => lruPut(m, needKey, b, 3));
    }, (e: unknown) => {
      if (pastGate.current.isLatest(token)) setPastError(`지난 기간 숫자를 불러오지 못했습니다: ${msg(e)} — 달성표 [다시]를 누르세요`);
    }).finally(() => { if (pastGate.current.isLatest(token)) setPastLoading(false); });
  }, [needLoad, needKey, today, cursor, want, pastRetry]);
  // 화면에 쓰는 묶음: 달성표·팀 카드 = 그 기간(viewBundle), 금일 띠·미처리·머리 숫자 = 지금(bundle)
  const viewBundle = useMemo(() => {
    if (!bundle || plan.kind === "now") return bundle;
    return pastBundle(bundle, today, cursor, plan, {
      loaded: plan.kind === "load" ? pastCache.get(cursorCacheKey(today, cursor)) ?? null : null,
      okr: okrKeyFull ? okrCache.get(okrKeyFull) ?? null : null,
    });
  }, [bundle, today, cursor, plan, pastCache, okrCache, okrKeyFull]);
  const isNow = plan.kind === "now" && cursor.offset === 0; // 묶음이 오기 전에 커서를 옮겼으면 캐시(이번 주 값)를 쓰지 않는다
  // OKR 박스: 주 커서가 다른 달 주차면 그 달 OKR 묶음(읽는 중이면 null = 로딩)
  const okrBundle = cursor.period === "week" && okrKeyFull ? okrCache.get(okrKeyFull) ?? null : bundle;
  const setPeriod = (p: TablePeriod) => { setCursor({ period: p, offset: 0 }); setOkrWeekId(undefined); };
  const stepCursor = (dir: -1 | 1) => {
    const next = step(cursor, dir, today);
    if (next === cursor) return;
    setCursor(next);
    // OKR 박스 한 방향 연동(설계안 5절 5): 주 기간일 때만 그 주차로, 이번 주면 기본(이번 주)
    if (next.period === "week") {
      if (next.offset === 0) setOkrWeekId(undefined);
      else { const cw = currentWeekOf(cursorRange(today, next).from); setOkrWeekId(weekCycleId(cw.year, cw.month, cw.weekNo)); }
    }
  };
  const toToday = () => { setCursor({ period: cursor.period, offset: 0 }); setOkrWeekId(undefined); };
  const retry = () => { if (isNow) void refresh(true); else { setPastError(""); setPastRetry((n) => n + 1); } };

  const renderWidget = (w: HomeWidgetDef, size: KpiGridWidget["sizes"][number], inEdit: boolean) => {
    // 홈 미처리 칸(2026-10-24 "미처리 전체" 카드와 합침) — 숫자는 이 묶음의 unhandled(mergeUnhandled)·recontract 한 벌
    if (w.id === "unhandledPanel") {
      // 미처리 원본이 아직 안 왔고(엣지 함수 평균 1.2초) 마지막 값 캐시가 있으면 합계 카드로 먼저 — 오면 미처리 칸(목록·탭)으로 바뀐다
      if (!bundle?.facts.unhandled && !bundle?.sources.unhandled && snap?.unhandled) {
        const u = snap.unhandled;
        return (
          <KpiWidget
            kind="unhandledTotal" title="미처리" size={size} theme="deck" status="ready" disabled={inEdit}
            basis={`${snapshotAgo(snap.savedAt, Date.now())} 값 · 갱신 중 — 접수 6종 + 지난 AS 일정 + 물류(홈 미처리 칸과 같은 함수)`}
            period="갱신 중"
            view={{
              kind: "unhandledTotal", total: u.total,
              parts: [...u.tabs.map((t) => ({ label: t.label, value: t.value })), { label: "재계약 확인 지남", value: u.recontract }],
              breakdown: u.kinds.map((k) => ({ label: k.label, value: k.value, tone: "bad" })),
              oldest: u.oldest || undefined,
              defs: [{ label: "미처리", text: "서비스접수 미처리(시트 상태 기준 포함) + 오늘 전 AS 일정 미완료 + 물류. 재계약 확인 지남은 합계 밖." }],
            }}
          />
        );
      }
      return (
        <div className="h-full min-w-0 [&>*]:h-full">
          <HomeUnhandledPanel bundle={bundle} team={teamFilter} onOpenOverdue={() => onOpenOverdue?.()} onOpenReception={() => onOpenReception?.()} onRetry={() => { void refresh(true); }} />
        </div>
      );
    }
    const st = widgetState(w, w.id === "K19" ? okrBundle : bundle);
    const first = KPI_BY_ID[w.kpis[0]];
    let view: KpiView | null = null;
    let chip: string | undefined;
    let emptyText: string | undefined;
    let onOpen: (() => void) | undefined = onNavigate && first ? () => open(first.screen) : undefined;
    const openLabel = first?.screen.tab;
    // 묶음이 아직 없거나 그 지표 원본을 아직 안 읽었으면(off) 마지막 값 캐시(snap)로 그린다 — 실패(error)한 원본은 덮지 않는다
    const isOff = (id: string) => { const b = w.id === "table" ? viewBundle : bundle; return !b || kpiCellState(id as keyof typeof KPI_BY_ID, b).status === "off"; };
    let fromSnap = false;
    switch (w.id) {
      case "today": {
        const live = bundle ? cachedView(bundle, ctx, "today", () => todayItems(bundle, ctx)) : null;
        const m = mergeSnapshotList(live, snap?.todayItems, isOff);
        fromSnap = m.used;
        if (live || m.used) view = { kind: "todayStrip", items: m.list.map((it) => ({ ...it, onOpen: onNavigate ? () => open(KPI_BY_ID[it.id].screen) : undefined })) };
        chip = "오늘"; onOpen = undefined; break;
      }
      case "table": {
        const vb = viewBundle;
        const live = vb ? cachedView(vb, ctx, `table|${goalBasis}`, () => tableRows(vb, ctx, goalBasis)) : null;
        const m = mergeSnapshotList(live, period === "week" && isNow ? snap?.table : undefined, isOff); // 캐시는 이번 주(홈 기본 기간)·offset 0 만
        fromSnap = m.used;
        const all = m.list;
        if (live || m.used) {
          const rows = (tableView === "main" ? all.filter((r) => r.main) : all)
            .map((r) => {
              // K2 행 분기 블록 — 캐시 행(말일 기준)인데 "말일 10일 전"을 골랐으면 캐시의 그 기준 블록으로
              const alt = r.quarter && r.quarter.basis !== goalBasis ? snap?.k2[goalBasis] : null;
              const q = alt ? withoutKind(alt) : r.quarter;
              return { ...r, quarter: q ? { ...q, onBasis: setGoalBasis } : undefined, onOpen: onNavigate ? () => open(KPI_BY_ID[r.id as keyof typeof KPI_BY_ID].screen) : undefined };
            });
          view = {
            kind: "kpiTable", period, view: tableView, rows, counts: { main: all.filter((r) => r.main).length, all: all.length }, onPeriod: setPeriod, onView: setTableView, teamFilter,
            cursor: {
              label: cursorLabel(today, cursor), ended: isEnded(today, cursor), canPrev: canStep(cursor, -1, today), canNext: canStep(cursor, 1, today),
              loading: pastLoading, onStep: stepCursor, onToday: toToday,
            },
          };
        }
        onOpen = undefined; break;
      }
      case "K19": {
        const scopeKey = `${okrScope.team}|${okrScope.member || ""}`;
        // 고른 주차가 지금 달 주차 목록에 없으면(달이 바뀜) 이번 주로 — pickOkrWeekId 가 같은 규칙으로 고른다
        const ob = okrBundle; // 보통 지금 묶음, 주 커서가 다른 달 주차면 그 달 OKR 묶음
        const otherMonth = ob !== bundle;
        const okrW = ob?.facts.okr?.week;
        const wk = okrW && okrWeekId ? pickOkrWeekId(okrW, okrWeekId) : undefined;
        const pickedPast = Boolean(okrW && wk && (wk !== okrW.id || otherMonth));
        const live = ob ? cachedView(ob, ctx, `K19|${pickedPast ? wk : "cur"}|${scopeKey}`, () => okrView(ob, { weekId: pickedPast ? wk : undefined, team: okrScope.team, member: okrScope.member })) : null;
        // 캐시는 이번 주·전체 범위(CS 4파트)만 — 다른 주차·범위를 고르면 새 값이 올 때까지 로딩
        const old = st.status === "loading" && !pickedPast && okrScope.team === "ALL" && !okrScope.member ? snap?.okr.week ?? null : null;
        const v = old ?? live;
        fromSnap = !!old;
        view = v ? { ...v, scope: { ...v.scope, onScope: setOkrScope }, onWeek: (id: string) => setOkrWeekId(okrW && id === okrW.id && !otherMonth ? undefined : id), teamFilter } : null;
        const selLabel = pickedPast ? okrW?.weeks.find((x) => x.id === wk)?.label ?? "" : "";
        chip = pickedPast ? `${selLabel}차` : "이번 주";
        emptyText = pickedPast ? `${selLabel}차 OKR 기록이 없습니다` : "이번 주 OKR 기록이 아직 없습니다"; break;
      }
    }
    let status: KpiLoadStatus = fromSnap && view ? "ready" : st.status;
    if (status === "ready" && !view) status = "empty";
    const basis = w.id === "table"
      ? "행마다 KPI 정의의 기준 · 상태 = 달성(실적 ≥ 목표) · 순항(실적/목표 ≥ 기간 경과) · 부족 · 목표 없음 · 목표 = 인당 목표 × 인원(관리 탭 KPI_TARGETS) · 비율 지표는 분자/분모 · 팀장 제외(오버홀은 팀장·파트장·부파트장 제외)"
      : w.id === "today" ? "오늘(KST) · 칩마다 해당 KPI 기준(달성표와 같은 함수)"
        : w.kpis.map((id) => KPI_BY_ID[id].basis).join(" / ");
    const notice = st.notice;
    return (
      <KpiWidget
        kind={w.kind as KpiView["kind"]}
        title={w.title}
        basis={notice ? `${basis} · 안내: ${notice}` : basis}
        status={status}
        view={view ?? undefined}
        period={chip}
        size={size}
        theme="deck"
        errorText={st.status === "error" ? `불러오지 못했습니다 — ${st.message}` : undefined}
        lastOk={st.status === "error" && view && state ? { text: headline(view), at: lastOkAgo(w, state.okAt, Date.now()) } : undefined}
        pendingText={st.status === "pending" ? st.message : undefined}
        emptyText={emptyText}
        onRetry={w.id === "table" ? retry : () => { void refresh(true); }}
        onOpen={onOpen}
        openLabel={openLabel}
        disabled={inEdit}
      />
    );
  };

  const widgets: KpiGridWidget[] = HOME_WIDGETS.map((w) => ({
    id: w.id, title: w.title, sizes: w.sizes, description: w.description,
    render: ({ size, editing: e }) => renderWidget(w, size, e),
  }));

  // 원본은 읽었지만 알릴 것(접수 일부 실패·시트 기준 안내·명단 못 읽음) — 기준 툴팁에만 두지 않고 위에 한 줄로
  const sourceNotices = bundle ? layout.filter((x) => !x.hidden).map((x) => HOME_WIDGETS.find((w) => w.id === x.id)).flatMap((w) => (w ? [widgetState(w, bundle).notice] : [])) : [];
  const notices = [...new Set([loadError, isNow ? "" : pastError, bundle?.settings.error ? `목표 설정: ${bundle.settings.error}` : "", ...sourceNotices].filter(Boolean))];
  // 마지막 값 캐시로 그린 칸이 있는 동안(아직 안 읽은 원본이 있음) 한 줄로 알린다
  const snapAgo = snap && (!bundle || [...want].some((s) => !bundle.sources[s])) ? snapshotAgo(snap.savedAt, Date.now()) : "";
  // 팀 카드 5장 — 달성표와 같은 행 캐시(tableRowsFor)·미처리 묶음·OKR 이번 주에서 조합(새 조회 없음).
  // 안 온 칸만 "…", 마지막 값 캐시는 이번 주·말일 기준일 때만(캐시가 그 기준으로 저장됨)
  // 지난 기간이면 그 기간 묶음(viewBundle) + 미처리·OKR 이번 주는 지금 묶음(bundle). 마지막 값 캐시는 offset 0 일 때만
  const teamCards = useMemo(() => {
    const live = teamBoardView(viewBundle, period, teamForAuthor, goalBasis, want, bundle);
    return isNow && period === "week" && goalBasis === "end" ? mergeTeamCardsWithSnapshot(live, snap?.teams).cards : live;
  }, [viewBundle, bundle, isNow, period, goalBasis, want, snap]);
  return (
    <div className="relative border-b border-white/[0.08] px-2 py-2">
      {snapAgo && <p role="status" className="mb-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-1.5 text-[11.5px] font-bold text-sky-200">{snapAgo === "방금" ? "방금 전" : snapAgo} 값 · {loading || !bundle ? "갱신 중" : "일부 갱신 대기"}</p>}
      {notices.map((n) => <p key={n} role="alert" className="mb-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11.5px] font-bold text-amber-300">{n}</p>)}
      <TeamBoardStrip cards={teamCards} selected={teamFilter} onSelect={pickTeam} periodLabel={isNow ? undefined : `${cursorLabel(today, cursor)} 기준`} />
      <HomeKpiGrid
        layout={layout}
        widgets={widgets}
        onLayoutChange={changeLayout}
        defaultLayout={HOME_KPI_DEFAULT_LAYOUT}
        theme="deck"
        notice={layoutNotice}
        editable={controlled ? editing : true}
        editing={editing}
        onEditingChange={setEditing}
      />
    </div>
  );
}
