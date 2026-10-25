/**
 * 홈 KPI 마지막 값 캐시(stale-while-revalidate, 2026-10-24 사용자 "홈 처음 들어갈 때 너무 느려, 바로 나오게").
 *  · 저장: 다 읽은 뒤(전체 읽기) 계산된 위젯 보기만 localStorage `home_kpi_snapshot_v2` 에 — 원본 행은 넣지 않는다(실측 약 25KB)
 *    금일 띠 · 달성표(이번 주, 개인 칩은 뺌, K2 행 분기 블록 포함) · 분기 점검 진행(말일·10일 전) · OKR(주·달, 전체 범위)
 *    · 미처리 합계(전체·팀 탭·종류 칸·재계약 확인 지남 — v2, 2026-10-24: 엣지 함수 1.2초를 기다리지 않고 첫 화면에 숫자). 정상(ok) 원본으로 센 것만.
 *  · 복원: 홈을 열면 바로 이 값으로 그리고("n분 전 값 · 갱신 중"), 새로 읽은 원본이 오는 대로 그 위젯·행만 새 값으로 바꾼다.
 *    아직 안 온 원본(off)의 행·칩만 캐시로 채운다 — 실패(error)한 원본은 캐시로 덮지 않는다(실패를 숨기지 않음).
 *  · 버린다: 버전·지표 목록이 다르거나, 다른 날(KST) 값이거나, 12시간 지났거나, 모양이 깨졌으면.
 * 숫자는 homeKpiModel 의 같은 함수(todayItems·tableRows·quarterGoalView·okrView)와 homeUnhandled(countUnhandledTabs·countUnhandledKinds)가 센 값 그대로다. 조회·화면 없음.
 * 테스트: tests/homeKpiSnapshot.test.ts
 */
import { KPI_DEFS, type KpiId } from "./kpiDefs";
import { kpiCellState, type KpiBundle } from "./kpiData";
import { HOME_WIDGETS, cachedView, okrView, quarterGoalView, tableRows, todayItems, unhandledParts, type ModelCtx, type OkrViewModel, type TableRowModel } from "./homeKpiModel";
import type { KpiQuarterGoalView, KpiTodayItem } from "./KpiWidgets.view";
import { countUnhandledKinds, countUnhandledTabs, oldestUnhandled, UNHANDLED_BADGE, UNHANDLED_KIND_LABEL, UNHANDLED_KINDS, UNHANDLED_TABS, type UnhandledRow } from "../homeUnhandled";

/** v2(2026-10-24): 미처리 합계 추가 · K2 위젯 삭제(달성표 행 안으로) — 키도 올려 옛 캐시는 읽지 않는다 */
export const HOME_KPI_SNAPSHOT_KEY = "home_kpi_snapshot_v2";
export const HOME_KPI_SNAPSHOT_VERSION = 2;
export const HOME_KPI_SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60_000;
/** 이보다 크면 저장하지 않는다(localStorage 를 다른 기능과 나눠 쓴다) */
export const HOME_KPI_SNAPSHOT_MAX_CHARS = 96_000;
/** 지표·위젯 목록이 바뀌면(배포) 예전 캐시는 버린다 */
export const HOME_KPI_SNAPSHOT_DEFS = [...KPI_DEFS.map((d) => d.id), "|", ...HOME_WIDGETS.map((w) => w.id)].join(",");

export type SnapTodayItem = Omit<KpiTodayItem, "onOpen"> & { id: KpiId };
export type SnapTableRow = TableRowModel;
/** 미처리 합계(홈 미처리 칸 머리·팀 탭·종류 칸과 같은 함수) — 목록 행은 넣지 않는다(크기·개인정보) */
export type SnapUnhandled = {
  total: number;
  tabs: Array<{ label: string; value: number }>;
  kinds: Array<{ label: string; value: number }>;
  /** 재계약 확인 지남(합계 밖) — 아직 못 셌으면 null */
  recontract: number | null;
  oldest: string;
};
export type HomeKpiSnapshot = {
  v: number;
  defs: string;
  savedAt: number;
  today: string;
  todayItems: SnapTodayItem[];
  /** 달성표 이번 주(홈 기본 기간) — 개인 칩(people)은 비워 저장 */
  table: SnapTableRow[];
  k2: { end: Omit<KpiQuarterGoalView, "onBasis"> | null; early: Omit<KpiQuarterGoalView, "onBasis"> | null };
  okr: { week: OkrViewModel | null; month: OkrViewModel | null };
  unhandled: SnapUnhandled | null;
};

/** 미처리 행 → 합계 요약(SnapUnhandled). 팀 탭은 건수 있는 것만(전체 제외) */
export function summarizeUnhandled(rows: UnhandledRow[], recontract: number | null): SnapUnhandled {
  const tabs = countUnhandledTabs(rows);
  const kinds = countUnhandledKinds(rows);
  const o = oldestUnhandled(rows);
  return {
    total: tabs["전체"],
    tabs: UNHANDLED_TABS.filter((t) => t !== "전체" && tabs[t] > 0).map((t) => ({ label: t === "E" ? "CSS" : t, value: tabs[t] })),
    kinds: UNHANDLED_KINDS.map((k) => ({ label: UNHANDLED_KIND_LABEL[k], value: kinds[k] })),
    recontract,
    oldest: o ? `${o.vendor || o.title || "업체 미정"} (${o.ageDays}일 · ${UNHANDLED_BADGE[o.kind]})` : "",
  };
}

const okId = (b: KpiBundle, id: KpiId) => kpiCellState(id, b).status === "ok";

/** 묶음 → 캐시. 같은 함수·같은 cachedView 키(이번 주)로 세므로 화면 숫자와 같다 */
export function buildHomeSnapshot(b: KpiBundle, teamOf: ModelCtx["teamOf"], now: number): HomeKpiSnapshot {
  const ctx: ModelCtx = { teamOf, period: "week" };
  const items = cachedView(b, ctx, "today", () => todayItems(b, ctx)).filter((it) => okId(b, it.id));
  const rows = cachedView(b, ctx, "table|end", () => tableRows(b, ctx, "end")).filter((r) => r.cellState === "ready").map((r) => ({ ...r, people: [] }));
  const k2ok = okId(b, "K2"), okrOk = okId(b, "K19");
  return {
    v: HOME_KPI_SNAPSHOT_VERSION, defs: HOME_KPI_SNAPSHOT_DEFS, savedAt: now, today: b.today,
    todayItems: items, table: rows,
    k2: { end: k2ok ? quarterGoalView(b, "end") : null, early: k2ok ? quarterGoalView(b, "early") : null },
    okr: { week: okrOk ? okrView(b) : null, month: null }, // month = 옛 모양 호환(2026-10-25 OKR 박스 월 보기 삭제)
    unhandled: b.facts.unhandled && b.sources.unhandled?.status === "ok" ? summarizeUnhandled(b.facts.unhandled, unhandledParts(b).recontract) : null,
  };
}

/** 저장 글 → 캐시. 버전·지표 목록·날짜·나이·모양 중 하나라도 어긋나면 null(무시) */
export function parseHomeSnapshot(raw: string | null | undefined, today: string, now: number): HomeKpiSnapshot | null {
  if (!raw) return null;
  let s: Partial<HomeKpiSnapshot>;
  try { s = JSON.parse(raw) as Partial<HomeKpiSnapshot>; } catch { return null; }
  if (!s || typeof s !== "object") return null;
  if (s.v !== HOME_KPI_SNAPSHOT_VERSION || s.defs !== HOME_KPI_SNAPSHOT_DEFS) return null;
  if (s.today !== today || typeof s.savedAt !== "number" || now - s.savedAt > HOME_KPI_SNAPSHOT_MAX_AGE_MS || s.savedAt > now + 60_000) return null;
  if (!Array.isArray(s.todayItems) || !Array.isArray(s.table) || !s.k2 || typeof s.k2 !== "object" || !s.okr || typeof s.okr !== "object") return null;
  if (s.unhandled !== null && (!s.unhandled || typeof s.unhandled.total !== "number" || !Array.isArray(s.unhandled.tabs) || !Array.isArray(s.unhandled.kinds))) return null;
  if (!s.table.every((r) => r && typeof r.id === "string" && Array.isArray(r.cells))) return null;
  if (!s.todayItems.every((it) => it && typeof it.id === "string")) return null;
  return s as HomeKpiSnapshot;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function readHomeSnapshot(storage: StorageLike | null | undefined, today: string, now: number): HomeKpiSnapshot | null {
  let raw: string | null = null;
  try { raw = storage?.getItem(HOME_KPI_SNAPSHOT_KEY) ?? null; } catch { return null; } // 사생활 모드 — 캐시 없이 평소대로
  return parseHomeSnapshot(raw, today, now);
}
/** 저장. 너무 크거나 저장공간이 차면 저장하지 않고 이유를 돌려준다(캐시일 뿐 — 화면은 새로 읽은 값으로 그대로) */
export function writeHomeSnapshot(storage: StorageLike | null | undefined, snap: HomeKpiSnapshot): string {
  if (!storage) return "저장소 없음";
  const text = JSON.stringify(snap);
  if (text.length > HOME_KPI_SNAPSHOT_MAX_CHARS) return `캐시가 너무 큼(${text.length}자)`;
  try { storage.setItem(HOME_KPI_SNAPSHOT_KEY, text); return ""; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}

/**
 * 새 값 + 캐시 섞기. isOff(id) = 그 지표 원본을 아직 안 읽음(묶음 없음 포함). 그런 행·칩만 캐시 값으로 바꾼다.
 * live 가 null(묶음 아직 없음)이면 캐시 그대로. used = 캐시 값을 하나라도 썼는지("n분 전 값" 표시용).
 */
export function mergeSnapshotList<T extends { id: string }>(live: T[] | null, snap: T[] | undefined, isOff: (id: string) => boolean): { list: T[]; used: boolean } {
  if (!snap?.length) return { list: live ?? [], used: false };
  if (!live) return { list: snap, used: true };
  const byId = new Map(snap.map((x) => [x.id, x]));
  let used = false;
  const list = live.map((x) => {
    const old = isOff(x.id) ? byId.get(x.id) : undefined;
    if (!old) return x;
    used = true;
    return old;
  });
  return { list, used };
}

/** "방금" · "n분 전" · "n시간 전" */
export function snapshotAgo(savedAt: number, now: number): string {
  const m = Math.max(0, Math.round((now - savedAt) / 60_000));
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
}
