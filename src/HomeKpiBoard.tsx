/**
 * 홈 = CS KPI 현황판 컨테이너(2026-10-23, 설계안 docs/tasks/home-kpi-dashboard.md · Q1~Q13 제안값 확정 + 사용자 추가 요구).
 *  · 숫자: kpiData.loadKpiBundle 한 번(보이는 위젯의 원본만 — 숨긴 위젯 원본은 안 읽음) → kpi/homeKpiModel 이 위젯 보기로
 *  · 갱신: 화면이 보이고(KeepAlive 활성) 탭이 보일 때만. 60초마다 가벼운 원본, 5분마다 전체(homeKpiModel FAST_SOURCES)
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
import { RECEPTION_RIGHT_KEY, SHOW_BOARD_EVENT } from "./receptionRightView";
import type { UnhandledRow } from "./homeUnhandled";
import HomeUnhandledPanel from "./HomeUnhandledPanel";
import HomeReceptionPanel from "./HomeReceptionPanel";
import { loadKpiBundle } from "./kpi/kpiData";
import { KPI_BY_ID, type KpiPeriodKey, type KpiScreen, type KpiSource } from "./kpi/kpiDefs";
import { HomeKpiGrid, type KpiGridWidget, type KpiLayoutItem } from "./kpi/HomeKpiGrid.view";
import { KpiWidget, type KpiStatus, type KpiView } from "./kpi/KpiWidgets.view";
import {
  FAST_REFRESH_MS, HOME_KPI_DEFAULT_LAYOUT, HOME_WIDGETS, PERIOD_KEYS, PERIOD_LABEL, SLOW_REFRESH_MS,
  expansionView, lastOkAgo, mergeBundle, numberView, okrView, overageView, periodChip, quarterGoalView, readHomeLayout,
  sourcesForLayout, sparkView, splitSources, tableRows, todayItems, unhandledView, widgetState, writeHomeLayout,
  type HomeKpiState, type HomeWidgetDef,
} from "./kpi/homeKpiModel";

export type HomeKpiBoardProps = {
  /** 위젯·표 행·띠 칩을 누르면 열 화면(App 의 screen 값) */
  onNavigate?: (screen: KpiScreen["screen"]) => void;
  /** 미처리 위젯: 지난 일정 줄 → 일정리스트 미처리(Home openOverdue) */
  onOpenOverdue?: () => void;
  /** 미처리 위젯: 접수 줄·머리 → 서비스접수(미처리 현황판) */
  onOpenReception?: () => void;
  /** 읽을 때마다 묶음을 알려 준다(관제 덱 인사말 "이번 주 내 점검" — 같은 원본을 두 번 읽지 않게) */
  onLoaded?: (state: HomeKpiState) => void;
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
    case "number": return `${v.value.toLocaleString("ko-KR")}${v.unit}`;
    case "spark": return `${(v.value ?? v.points.at(-1)?.value ?? 0).toLocaleString("ko-KR")}${v.unit}`;
    case "ring": return v.denominator ? `${Math.round((v.numerator / v.denominator) * 100)}%` : "";
    case "progress": return `${v.value}/${v.target}${v.unit}`;
    case "teamBars": return v.total !== null && v.total !== undefined ? `${v.total}${v.unit}` : "";
    case "list": return `${v.total}${v.unit}`;
    case "quarterGoal": return `${v.value}/${v.target}`;
    default: return "";
  }
}

export default function HomeKpiBoard({ onNavigate, onOpenOverdue, onOpenReception, onLoaded }: HomeKpiBoardProps) {
  const active = useScreenActive();
  const [layout, setLayout] = useState<KpiLayoutItem[]>(() => readHomeLayout(storage()));
  const [layoutNotice, setLayoutNotice] = useState("");
  const [period, setPeriod] = useState<KpiPeriodKey>("week"); // Q4: 기본 "이번 주"(월~일)
  const [state, setState] = useState<HomeKpiState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
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
      const b = await loadKpiBundle({ sources });
      lastAny.current = Date.now();
      if (full) lastFull.current = lastAny.current;
      const next = mergeBundle(stateRef.current, b);
      stateRef.current = next;
      setState(next);
      setLoadError("");
      onLoadedRef.current?.(next);
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
  const openReception = useCallback(() => {
    // 서비스접수 화면이 이미 떠 있으면(KeepAlive) localStorage 를 다시 읽지 않으므로 이벤트도 같이(HomeUnhandledPanel 과 같은 방식)
    try { localStorage.setItem(RECEPTION_RIGHT_KEY, "board"); } catch { /* 저장 못 해도 이벤트로 연다 */ }
    window.dispatchEvent(new CustomEvent(SHOW_BOARD_EVENT));
    onOpenReception?.();
  }, [onOpenReception]);
  const openUnhandledRow = useCallback((r: UnhandledRow) => {
    if (r.source === "reception") openReception();
    else onOpenOverdue?.();
  }, [openReception, onOpenOverdue]);

  const bundle = state?.bundle ?? null;
  const ctx = useMemo(() => ({ teamOf: teamForAuthor, period }), [period]);

  const renderWidget = (w: HomeWidgetDef, size: KpiGridWidget["sizes"][number], inEdit: boolean) => {
    // 기존 홈 부품 그대로(팀장 결정 2026-10-23) — 자기 로더·자기 갱신. 숨기면 그리지 않아 조회도 멈춘다
    if (w.kind === "panel") {
      return (
        <div className="h-full min-w-0 [&>*]:h-full">
          {w.id === "unhandledPanel"
            ? <HomeUnhandledPanel onOpenOverdue={() => onOpenOverdue?.()} onOpenReception={() => onOpenReception?.()} />
            : <HomeReceptionPanel onOpen={() => onOpenReception?.()} />}
        </div>
      );
    }
    const st = widgetState(w, bundle);
    const first = KPI_BY_ID[w.kpis[0]];
    let view: KpiView | null = null;
    let chip = w.kpis.length ? periodChip(w.kpis[0], period) : PERIOD_LABEL[period];
    let emptyText: string | undefined;
    let onOpen: (() => void) | undefined = onNavigate ? () => open(first.screen) : undefined;
    let openLabel = first.screen.tab;
    if (bundle) {
      switch (w.id) {
        case "today": {
          view = { kind: "todayStrip", items: todayItems(bundle, ctx).map((it) => ({ ...it, onOpen: onNavigate ? () => open(KPI_BY_ID[it.id].screen) : undefined })) };
          chip = "오늘"; onOpen = undefined; break;
        }
        case "K2": view = quarterGoalView(bundle); emptyText = "이번 분기 워킨맵 대상이 없습니다"; openLabel = "워킨맵"; break;
        case "table": {
          view = {
            kind: "kpiTable", pace: period === "week" ? bundle.ranges.weekElapsedRate : period === "month" ? bundle.ranges.monthElapsedRate : period === "quarter" ? bundle.ranges.quarterElapsedRate : null,
            rows: tableRows(bundle, ctx).map((r) => ({ ...r, onOpen: onNavigate ? () => open(KPI_BY_ID[r.id as keyof typeof KPI_BY_ID].screen) : undefined })),
          };
          chip = PERIOD_LABEL[period]; onOpen = undefined; break;
        }
        case "K1": case "K12": {
          view = numberView(w.id, bundle, ctx);
          if (view?.kind === "number" && view.value === 0) { emptyText = w.id === "K12" ? "확인일 지난 열린 재계약이 없습니다" : "이 기간에 점검 기록이 없습니다"; }
          break;
        }
        case "K3": view = sparkView("K3", bundle, ctx); break;
        case "exp": view = expansionView(bundle, ctx); break;
        case "K10": { const o = overageView(bundle, ctx); view = o?.view ?? null; if (o) chip = PERIOD_LABEL[o.period]; break; }
        case "K19": view = okrView(bundle); emptyText = "이번 달 판정이 아직 없습니다"; break;
        case "unhandled": {
          view = unhandledView(bundle, openUnhandledRow);
          emptyText = "밀린 일이 없습니다"; onOpen = openReception; openLabel = "미처리 현황";
          break;
        }
      }
    }
    // 상태: 원본 상태(위젯 KPI) → 값이 0·비었으면 "기록 없음"
    let status: KpiStatus = st.status;
    if (status === "ready") {
      const isEmpty = !view || (view.kind === "number" && view.value === 0) || (view.kind === "list" && view.total === 0);
      if (isEmpty) status = "empty";
    }
    const basis = w.id === "table"
      ? "행마다 KPI 정의의 기준 · 칸 = 실적/목표(목표 = 인당 목표 × 인원 · 관리 탭 KPI_TARGETS) · 비율 지표는 분자/분모 · 목표 없는 지표는 n/— · 팀장 제외"
      : w.id === "today" ? "오늘(KST) · 칩마다 해당 KPI 기준(달성표·각 위젯과 같은 함수)"
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
  const r = bundle?.ranges;
  const chips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <h2 className="mr-1 text-[10.5px] font-black tracking-[0.18em] text-blue-300">CS KPI 현황판</h2>
      <div className="flex flex-wrap gap-1" role="group" aria-label="기간">
        {PERIOD_KEYS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={period === p}
            onClick={() => setPeriod(p)}
            disabled={editing}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-[11.5px] font-black transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-50 ${period === p ? "bg-white text-slate-950" : "bg-white/[0.07] text-slate-300 hover:bg-white/[0.12] hover:text-white"}`}
          >{PERIOD_LABEL[p]}</button>
        ))}
      </div>
      {r && <span className="text-[10.5px] font-bold text-slate-500">{r.quarterNo}분기 경과 {r.quarterElapsedRate}% · 이번 달 {r.monthElapsedRate}%</span>}
    </div>
  );

  return (
    <div className="relative border-b border-white/[0.08] px-4 py-4 sm:px-6">
      {notices.map((n) => <p key={n} role="alert" className="mb-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11.5px] font-bold text-amber-300">{n}</p>)}
      <HomeKpiGrid
        layout={layout}
        widgets={widgets}
        onLayoutChange={changeLayout}
        defaultLayout={HOME_KPI_DEFAULT_LAYOUT}
        theme="deck"
        toolbarStart={chips}
        notice={layoutNotice}
        editing={editing}
        onEditingChange={setEditing}
      />
    </div>
  );
}
