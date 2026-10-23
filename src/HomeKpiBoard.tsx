/**
 * 홈 = CS KPI 현황판 컨테이너(2026-10-23, 설계안 docs/tasks/home-kpi-dashboard.md · Q1~Q13 제안값 확정 + 사용자 추가 요구).
 *  · 숫자: kpiData.loadKpiBundle 한 번(보이는 위젯의 원본만 — 숨긴 위젯 원본은 안 읽음) → kpi/homeKpiModel 이 위젯 보기로
 *  · 갱신: 화면이 보이고(KeepAlive 활성) 탭이 보일 때만. 60초마다 가벼운 원본, 5분마다 전체(homeKpiModel FAST_SOURCES)
 *  · 첫 로드는 두 단계(2026-10-24 속도): 가벼운 원본으로 먼저 그리고 무거운 원본(HEAVY_SOURCES)은 뒤에
 *  · 위젯 보기는 묶음·기간이 같으면 다시 세지 않는다(cachedView) — 부모가 다시 그려도 달성표를 매번 세지 않게
 *  · 실패: 위젯마다 "—" + [다시] + 마지막 값(N분 전). 원본 표 없음 = 준비 중, 원본 없음 = 원본 연결 필요(절대 0 으로 안 보임)
 *  · 배치: localStorage home_kpi_layout_v1 = {v:1, items}. 편집(크기·위치·숨김)은 HomeKpiGrid
 *  · 위젯을 누르면 같은 숫자의 화면으로(Home 이 받던 onNavigate 재사용)
 * 표시 부품은 kpi/KpiWidgets.view · kpi/HomeKpiGrid.view(윤화면) 를 그대로 쓴다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "./toast";
import { kstDate } from "./visits";
import { teamForAuthor } from "./operations";
import { useScreenActive } from "./screenActive";
import HomeUnhandledPanel from "./HomeUnhandledPanel";
import HomeReceptionPanel from "./HomeReceptionPanel";
import { loadKpiBundle } from "./kpi/kpiData";
import { KPI_BY_ID, type KpiScreen, type KpiSource } from "./kpi/kpiDefs";
import { HomeKpiGrid, type KpiGridWidget, type KpiLayoutItem } from "./kpi/HomeKpiGrid.view";
import { KpiWidget, type KpiLoadStatus, type KpiView } from "./kpi/KpiWidgets.view";
import {
  FAST_REFRESH_MS, HOME_KPI_DEFAULT_LAYOUT, HOME_WIDGETS, SLOW_REFRESH_MS,
  cachedView, firstLoadPhases, lastOkAgo, mergeBundle, okrView, quarterGoalView, readHomeLayout,
  sourcesForLayout, splitSources, tableRows, todayItems, widgetState, writeHomeLayout,
  type HomeKpiState, type HomeWidgetDef, type TablePeriod,
} from "./kpi/homeKpiModel";

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
  const [period, setPeriod] = useState<TablePeriod>("week"); // 달성표 기간 — 기본 "이번 주"(월~일)
  const [tableView, setTableView] = useState<"main" | "all">("main");
  const [goalBasis, setGoalBasis] = useState<"end" | "early">("end"); // 분기 점검 진행 기준 — 기본 말일
  const [okrPeriod, setOkrPeriod] = useState<"week" | "month">("week"); // OKR — 기본 이번 주(사용자 2026-10-24)
  const [state, setState] = useState<HomeKpiState | null>(null);
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
    try {
      const full = force || !prev || now - lastFull.current >= SLOW_REFRESH_MS || prev.bundle.today !== kstDate();
      const sources = splitSources(want, full);
      for (const s of fresh) sources.add(s);
      if (!sources.size) return;
      // 처음(값이 없을 때)은 가벼운 원본으로 먼저 그리고 무거운 원본은 뒤에 — 같은 로더, 순서만 나눔
      const phases = prev ? [sources] : firstLoadPhases(sources).filter((p) => p.size);
      for (const part of phases) {
        const b = await loadKpiBundle({ sources: part });
        const next = mergeBundle(stateRef.current, b);
        stateRef.current = next;
        setState(next);
        setLoadError("");
        onLoadedRef.current?.(next);
      }
      lastAny.current = Date.now();
      if (full) lastFull.current = lastAny.current;
    } catch (e) {
      // loadKpiBundle 은 원본별 실패를 상태로 돌려주지만, 그 밖의 실패도 화면에 알린다(조용히 삼키지 않음)
      setLoadError(`KPI 를 불러오지 못했습니다: ${msg(e)}`);
    } finally {
      busy.current = false;
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

  const renderWidget = (w: HomeWidgetDef, size: KpiGridWidget["sizes"][number], inEdit: boolean) => {
    // 기존 홈 미처리 칸(팀장 결정 2026-10-23) — 자기 로더·자기 갱신. 숨기면 그리지 않아 조회도 멈춘다
    if (w.id === "unhandledPanel") {
      return (
        <div className="h-full min-w-0 [&>*]:h-full">
          <HomeUnhandledPanel onOpenOverdue={() => onOpenOverdue?.()} onOpenReception={() => onOpenReception?.()} />
        </div>
      );
    }
    // 미처리 전체(2026-10-24) — 접수는 자기 로더(현황판 같은 계산), 물류·재계약은 현황판 묶음
    if (w.id === "receptionPanel") {
      return <HomeReceptionPanel onOpen={() => onOpenReception?.()} bundle={bundle} size={size} disabled={inEdit} />;
    }
    const st = widgetState(w, bundle);
    const first = KPI_BY_ID[w.kpis[0]];
    let view: KpiView | null = null;
    let chip: string | undefined;
    let emptyText: string | undefined;
    let onOpen: (() => void) | undefined = onNavigate && first ? () => open(first.screen) : undefined;
    let openLabel = first?.screen.tab;
    if (bundle) {
      switch (w.id) {
        case "today": {
          view = { kind: "todayStrip", items: cachedView(bundle, ctx, "today", () => todayItems(bundle, ctx)).map((it) => ({ ...it, onOpen: onNavigate ? () => open(KPI_BY_ID[it.id].screen) : undefined })) };
          chip = "오늘"; onOpen = undefined; break;
        }
        case "K2": {
          const v = cachedView(bundle, ctx, `K2|${goalBasis}`, () => quarterGoalView(bundle, goalBasis));
          view = v ? { ...v, onBasis: setGoalBasis } : null;
          chip = "분기"; emptyText = "이번 분기 워킨맵 대상이 없습니다"; openLabel = "워킨맵"; break;
        }
        case "table": {
          const all = cachedView(bundle, ctx, "table", () => tableRows(bundle, ctx));
          const rows = (tableView === "main" ? all.filter((r) => r.main) : all)
            .map((r) => ({ ...r, onOpen: onNavigate ? () => open(KPI_BY_ID[r.id as keyof typeof KPI_BY_ID].screen) : undefined }));
          view = { kind: "kpiTable", period, view: tableView, rows, counts: { main: all.filter((r) => r.main).length, all: all.length }, onPeriod: setPeriod, onView: setTableView };
          onOpen = undefined; break;
        }
        case "K19": {
          const v = cachedView(bundle, ctx, `K19|${okrPeriod}`, () => okrView(bundle, okrPeriod));
          view = v ? { ...v, onPeriod: setOkrPeriod } : null;
          chip = okrPeriod === "week" ? "이번 주" : "이번 달";
          emptyText = okrPeriod === "week" ? "이번 주 OKR 기록이 아직 없습니다" : "이번 달 판정이 아직 없습니다"; break;
        }
      }
    }
    let status: KpiLoadStatus = st.status;
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
        onRetry={() => { void refresh(true); }}
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
  const notices = [...new Set([loadError, bundle?.settings.error ? `목표 설정: ${bundle.settings.error}` : "", ...sourceNotices].filter(Boolean))];
  return (
    <div className="relative border-b border-white/[0.08] px-4 py-4 sm:px-6">
      {notices.map((n) => <p key={n} role="alert" className="mb-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11.5px] font-bold text-amber-300">{n}</p>)}
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
