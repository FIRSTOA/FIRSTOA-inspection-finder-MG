/**
 * 홈 3차 "팀 보드"(2026-10-25, docs/tasks/home-design-3-impl-2026-10-25.md) — 팀 카드 5장(A·B·C·D·CSS=E)과 머리 띠 큰 숫자 3개의 순수 모델.
 * 새 조회 없음: 이미 읽은 묶음(KpiBundle)과 이미 있는 함수 결과만 조합한다.
 *  · 주요 목표 판정·미니 KPI·정기점검 % = 달성표 행(homeKpiModel.tableRowsFor — 달성표 위젯과 같은 행 캐시라 다시 세지 않음)의 팀 칸
 *  · 미처리 = facts.unhandled(homeUnhandled.mergeUnhandled 결과)의 팀 행 수 — 홈 미처리 칸 팀 탭과 같은 숫자
 *  · OKR 이번 주 % = okrWeekResult(이번 주, 전체 범위, 명단).byTeam = 팀원별 달성률 평균(미작성 0%) — OKR 위젯 [전체] 칩과 같은 숫자. CSS(E)는 OKR 대상 아님 → "—"
 * 첫 그림(2026-10-25 밤 사용자 "홈에서 팀별 수치가 조금 늦게 나온다"):
 *  · 팀 카드는 34지표 달성표 전체가 아니라 필요한 지표(주요 목표·미니 4·분기 점검)만 행 단위 캐시(tableRowsFor)로 센다
 *  · 칸마다 "기다림(wait)" — 원본을 아직 안 읽었고 읽을 예정이면 그 칸만 "…"(점선), 온 칸은 숫자. 카드 전체를 로딩으로 묶지 않는다
 *  · 마지막 값 캐시(homeKpiSnapshot v3 teams)가 있으면 기다리는 칸을 그 값으로(mergeTeamCardsWithSnapshot) — 실패(error) 칸은 덮지 않음
 * 화면은 TeamBoard.view.tsx. 테스트: tests/teamBoard.test.ts · tests/teamBoardFirstPaint.test.ts
 */
import { KPI_BY_ID, KPI_DEFS, mainKpiIds, type KpiId, type KpiSource } from "./kpiDefs";
import { okrWeekResult, pct, workinPace, type OkrWeekFacts, type RosterMember } from "./kpiCompute";
import type { KpiBundle } from "./kpiData";
import { cachedView, okrPeopleForTeam, tableRowsFor, type ModelCtx, type TablePeriod, type TableRowModel } from "./homeKpiModel";
import { OKR_TEAMS } from "../okr";
import type { KpiStatus } from "./KpiWidgets.view";
import { UNHANDLED_KINDS, type UnhandledKind, type UnhandledRow, type UnhandledTab } from "../homeUnhandled";
import { REGION_LABEL } from "../region";
import { TEAM_ORDER, type TeamKey } from "./teamColors";

/** 팀 카드 미니 타일 4개 — 지표 이름으로 찾는다(정의 id 가 바뀌어도 이름이 같으면 그대로). 없는 이름은 빠진다 */
const MINI_KPI_NAMES: Array<{ name: string; short: string }> = [
  { name: "블로그 답글", short: "블로그" },
  { name: "PC확장성", short: "PC확장" },
  { name: "오버홀", short: "오버홀" },
  { name: "IT 실습(기술력)", short: "IT실습" },
]; // 2026-10-25 사용자: "재계약·IT 퀴즈 빼고 블로그·PC확장성·오버홀·IT실습"
export const TEAM_MINI_KPIS: Array<{ id: KpiId; short: string }> = MINI_KPI_NAMES.flatMap(({ name, short }) => {
  const d = KPI_DEFS.find((x) => x.name === name);
  return d ? [{ id: d.id, short }] : [];
});
/** 정기점검 % = 분기 점검 진행(K2) 행의 팀 칸 */
export const TEAM_INSPECTION_KPI: KpiId | undefined = KPI_DEFS.find((d) => d.name === "분기 점검 진행")?.id;
/** 재계약 % = 재계약 진행(K35, 워킨맵 G5 / G7 뺀 전부) 행의 팀 칸 — 정기점검 오른쪽(2026-10-26). 옛 K25 "재계약 기록"(재계약 표 곳 수)와 헷갈리지 않게 분기 비율 지표로 찾는다 */
export const TEAM_RENEWAL_KPI: KpiId | undefined = KPI_DEFS.find((d) => d.name === "재계약 진행" && d.targetBasis === "workin")?.id;

export type TeamPill = "behind" | "done" | "onTrack" | "none";
export const TEAM_PILL_LABEL: Record<TeamPill, string> = { behind: "부족", done: "달성", onTrack: "순항", none: "판정 없음" };

/** wait = 그 지표 원본을 아직 안 읽었고 읽을 예정(화면 "…" 점선). 실패·준비 중은 wait 아님 */
export type TeamMiniTile = { id: string; label: string; status: KpiStatus; pct: number | null; value: number | null; wait?: boolean };

/** 칸별 기다림 — true 인 칸만 "…", 나머지는 숫자(또는 "—") */
export type TeamCardWait = { pill: boolean; headcount: boolean; unhandled: boolean; okr: boolean; inspection: boolean; renewal?: boolean; alerts: boolean };
export const NO_WAIT: TeamCardWait = { pill: false, headcount: false, unhandled: false, okr: false, inspection: false, renewal: false, alerts: false };

export type TeamCardModel = {
  team: TeamKey;
  label: string;          // A·B·C·D·CSS
  region: string;         // 강북·강서·강남·경기·지방
  headcount: number | null; // 명단(cs_members, rosterFromMembers) 그 팀 인원 — 명단 없으면 null
  pill: TeamPill;
  unhandled: number | null;
  okrPct: number | null;
  /** CSS(E)는 OKR 대상이 아니다 — 화면은 "—" */
  okrApplies: boolean;
  inspectionPct: number | null;
  /** 재계약 진행 %(K35). 대상 0(팀 지점 없음)·못 읽음 = null → "—". 옛 캐시(v3, 2026-10-26 전)엔 없음 */
  renewalPct?: number | null;
  tiles: TeamMiniTile[];
  /** 주의 한 줄 조각(없으면 빈 배열 → "주의 없음") */
  alerts: string[];
  /** 아직 안 온 칸(없으면 다 옴) */
  wait?: TeamCardWait;
  /** 마지막 값 캐시로 채운 칸이 있다 */
  stale?: boolean;
};

/**
 * 상태 알약: 그 팀 주요 목표(main 행, 원본 읽힘) 칸 판정 — 부족이 하나라도 → 부족, 판정된 것이 전부 달성 → 달성, 아니면 순항.
 * 목표가 있는 판정(달성·순항·부족)이 하나도 없으면 "판정 없음".
 */
export function teamPill(statuses: KpiStatus[]): TeamPill {
  const judged = statuses.filter((s) => s === "done" || s === "onTrack" || s === "behind");
  if (!judged.length) return "none";
  if (judged.includes("behind")) return "behind";
  if (judged.every((s) => s === "done")) return "done";
  return "onTrack";
}

/** 카드 선택 토글 — 같은 팀을 다시 누르면 전체(null) */
export function toggleTeamFilter(cur: TeamKey | null, next: TeamKey): TeamKey | null {
  return cur === next ? null : next;
}

const cellOf = (row: TableRowModel | undefined, team: TeamKey) => row?.cellState === "ready" ? row.cells.find((c) => c.scope === team) : undefined;
const cellPct = (c: { value: number | null; target: number | null } | undefined) => (c && c.value !== null && c.target ? pct(c.value, c.target) : null);

export type TeamBoardParts = {
  rows: TableRowModel[] | null;
  unhandled: UnhandledRow[] | null;
  roster: RosterMember[] | null;
  okrWeek: OkrWeekFacts | null;
  /** OKR % 의 구성원 명단(okrWeek 와 같은 묶음 것) — 없으면 roster */
  okrRoster?: RosterMember[] | null;
  /** 팀별 이번 주 OKR 보고 미작성 인원 = homeKpiModel.okrPeopleForTeam(명단 ∪ 보고자) 의 missing 수 — OKR 칸 팀원 목록과 같은 정의 */
  okrMissing?: Partial<Record<TeamKey, number>> | null;
  /** 기다리는 원본 — 없으면 다 온 것(옛 호출·테스트) */
  waiting?: TeamWaiting;
};

/** 아직 안 왔고 올 예정인 것: 지표 id 집합(또는 전부) + 미처리·OKR·명단 원본 */
export type TeamWaiting = { ids: ReadonlySet<string> | "all"; unhandled: boolean; okr: boolean; roster: boolean };

/**
 * 부분 그리기 판정(순수). 알약은 주요 목표 하나라도 기다리면 "…"(일부만으로 달성·부족을 말하지 않음),
 * 주의 한 줄은 그 재료(주요 목표·미처리·OKR) 중 하나라도 기다리면 "…".
 */
export function teamCardWait(team: TeamKey, mainIds: readonly string[], w: TeamWaiting | undefined): { card: TeamCardWait; tile: (id: string) => boolean } {
  if (!w) return { card: NO_WAIT, tile: () => false };
  const idWait = (id: string) => w.ids === "all" || w.ids.has(id);
  const pill = w.ids === "all" || mainIds.some(idWait);
  const okr = team !== "E" && w.okr; // CSS(E)는 OKR 대상 아님 — 기다리지 않는다
  const unhandled = w.unhandled;
  return {
    card: { pill, headcount: w.roster, unhandled, okr, inspection: TEAM_INSPECTION_KPI ? idWait(TEAM_INSPECTION_KPI) : false, renewal: TEAM_RENEWAL_KPI ? idWait(TEAM_RENEWAL_KPI) : false, alerts: pill || unhandled || okr },
    tile: idWait,
  };
}

/** 순수 조합 — 테스트는 이것으로. rows 는 tableRows 결과(이번 기간), unhandled 는 mergeUnhandled 결과 */
export function teamBoardFromParts(p: TeamBoardParts): TeamCardModel[] {
  const byId = new Map((p.rows || []).map((r) => [r.id, r]));
  const okr = p.okrWeek ? okrWeekResult(p.okrWeek, p.okrWeek.id, undefined, p.okrRoster ?? p.roster) : null;
  const mainIds = (p.rows || []).filter((r) => r.main).map((r) => r.id);
  return TEAM_ORDER.map((team) => {
    const okrApplies = team !== "E";
    const w = teamCardWait(team, mainIds, p.waiting);
    const mainRows = (p.rows || []).filter((r) => r.main && r.cellState === "ready");
    const mainCells = mainRows.map((r) => ({ row: r, cell: cellOf(r, team) })).filter((x): x is { row: TableRowModel; cell: NonNullable<ReturnType<typeof cellOf>> } => !!x.cell);
    const teamRows = p.unhandled ? p.unhandled.filter((r) => r.team === team) : null;
    const okrPct = okrApplies && okr ? okr.byTeam.find((t) => t.team === team)?.pct ?? null : null;
    const tiles: TeamMiniTile[] = TEAM_MINI_KPIS.map(({ id, short }) => {
      const row = byId.get(id);
      const c = cellOf(row, team);
      return { id, label: short, status: c ? c.status : "pending", pct: cellPct(c), value: c ? c.value : null, ...(w.tile(id) ? { wait: true } : {}) };
    });
    // 주의 한 줄: 가장 낮은 % 의 부족 지표 · OKR 미작성 n명 · 가장 오래된 미처리 n일(오늘 들어온 건은 주의 아님)
    const alerts: string[] = [];
    const low = mainCells
      .map(({ row, cell }) => ({ name: row.name, status: cell.status, p: cellPct(cell) }))
      .filter((x): x is { name: string; status: KpiStatus; p: number } => x.status === "behind" && x.p !== null)
      .sort((a, z) => a.p - z.p || a.name.localeCompare(z.name, "ko"))[0];
    if (low) alerts.push(`${low.name} ${low.p}%`);
    const miss = okrApplies ? p.okrMissing?.[team] ?? 0 : 0;
    if (miss) alerts.push(`OKR 미작성 ${miss}명`);
    const oldest = teamRows?.reduce((m, r) => Math.max(m, r.ageDays), 0) ?? 0;
    if (oldest > 0) alerts.push(`미처리 최장 ${oldest}일`);
    return {
      team, label: team === "E" ? "CSS" : team, region: REGION_LABEL[team] || "",
      headcount: p.roster ? p.roster.filter((m) => m.team === team).length : null,
      pill: teamPill(mainCells.map((x) => x.cell.status)),
      unhandled: teamRows ? teamRows.length : null,
      okrPct, okrApplies,
      inspectionPct: TEAM_INSPECTION_KPI ? cellPct(cellOf(byId.get(TEAM_INSPECTION_KPI), team)) : null,
      renewalPct: TEAM_RENEWAL_KPI ? cellPct(cellOf(byId.get(TEAM_RENEWAL_KPI), team)) : null,
      tiles, alerts,
      ...(p.waiting ? { wait: w.card } : {}),
    };
  });
}

/** 팀 카드가 쓰는 지표 — 주요 목표 + 미니 타일 4 + 분기 점검 + 재계약 진행(정의 순서) */
export function teamBoardKpiIds(targets: Parameters<typeof mainKpiIds>[0]): KpiId[] {
  const want = new Set<KpiId>([...mainKpiIds(targets), ...TEAM_MINI_KPIS.map((t) => t.id), ...(TEAM_INSPECTION_KPI ? [TEAM_INSPECTION_KPI] : []), ...(TEAM_RENEWAL_KPI ? [TEAM_RENEWAL_KPI] : [])]);
  return KPI_DEFS.filter((d) => want.has(d.id)).map((d) => d.id);
}

/**
 * 묶음 → 기다리는 것(순수). want = 이번에 읽을 원본(HomeKpiBoard 배치 기준). 안 읽은 원본이 want 에 있어야 "기다림" —
 * 숨긴 위젯 원본처럼 안 읽을 것은 기다리지 않는다("—" 그대로). want 를 안 주면 안 읽은 것은 모두 올 예정으로 본다.
 * 지표는 kpiCellState 가 off(안 읽은 원본이 있음)이고 그 안 읽은 원본이 모두 올 예정이며, 이미 온 원본 중 실패가 없을 때만 기다림.
 */
export function teamWaiting(b: KpiBundle | null, ids: readonly KpiId[], want?: ReadonlySet<KpiSource>): TeamWaiting {
  const coming = (s: KpiSource) => !b?.sources[s] && (!want || want.has(s));
  const idWaits = (id: KpiId) => {
    const def = KPI_BY_ID[id];
    if (def.status === "unlinked") return false;
    const notYet = def.loads.filter((s) => !b?.sources[s]);
    if (!notYet.length || !notYet.every(coming)) return false;
    return def.loads.every((s) => !b?.sources[s] || b.sources[s]!.status === "ok" || s === "roster"); // 이미 실패한 원본이 있으면 기다려도 숫자가 안 온다
  };
  return { ids: new Set(ids.filter(idWaits)), unhandled: coming("unhandled"), okr: coming("okr"), roster: coming("roster") };
}

/**
 * 묶음 → 팀 카드 5장. 필요한 지표 행만 센다(tableRowsFor — 행 캐시를 달성표와 같이 써 두 번 세지 않음) + 기다리는 칸 표시.
 * want = 읽을 원본(기다림 판정용).
 * now = 지금 묶음(지난 기간 보기, 2026-10-26) — b 가 지난 기간 파생 묶음이면 미처리·"OKR 이번 주" 칸은 now 의 값(늘 지금, 미처리 칸에 "지금" 칩은 화면이 단다).
 *   주의 한 줄의 OKR 미작성·미처리 최장도 now 기준. 주요 목표·미니 타일·정기점검은 b(그 기간).
 */
export function teamBoardView(b: KpiBundle | null, period: TablePeriod, teamOf: ModelCtx["teamOf"], basis: "end" | "early" = "end", want?: ReadonlySet<KpiSource>, now?: KpiBundle | null): TeamCardModel[] {
  if (!b) return teamBoardFromParts({ rows: null, unhandled: null, roster: null, okrWeek: null, waiting: { ...teamWaiting(null, [], want), ids: "all" } });
  const ctx: ModelCtx = { teamOf, period };
  const ids = teamBoardKpiIds(b.settings.targets);
  const rows = cachedView(b, ctx, `teamBoard|rows|${basis}`, () => tableRowsFor(b, ctx, ids, basis));
  const cur = now && now !== b ? now : b;
  const waiting = teamWaiting(b, ids, want);
  if (cur !== b) { const nw = teamWaiting(cur, [], want); waiting.unhandled = nw.unhandled; waiting.okr = nw.okr; }
  const okrMissing = cachedView(cur, ctx, "teamBoard|okrMissing", () =>
    Object.fromEntries(OKR_TEAMS.map((t) => [t, okrPeopleForTeam(cur, t, "week").filter((x) => x.missing).length])) as Partial<Record<TeamKey, number>>);
  return teamBoardFromParts({ rows, unhandled: cur.facts.unhandled ?? null, roster: b.facts.roster ?? null, okrWeek: cur.facts.okr?.week ?? null, okrRoster: cur.facts.roster ?? null, okrMissing, waiting });
}

/**
 * 기다리는 칸만 마지막 값 캐시로(순수). 캐시 카드의 그 칸도 기다림이었으면 쓰지 않는다. 실패 칸은 live 가 기다림이 아니라 덮지 않는다.
 * used = 캐시 값을 하나라도 썼는지.
 */
export function mergeTeamCardsWithSnapshot(live: TeamCardModel[], snap: TeamCardModel[] | null | undefined): { cards: TeamCardModel[]; used: boolean } {
  if (!snap?.length) return { cards: live, used: false };
  const byTeam = new Map(snap.map((c) => [c.team, c]));
  let used = false;
  const cards = live.map((c) => {
    const old = byTeam.get(c.team);
    const w = c.wait;
    if (!old || !w) return c;
    const ow = old.wait ?? NO_WAIT;
    const nw: TeamCardWait = { ...w };
    const next: TeamCardModel = { ...c, wait: nw };
    let took = false;
    const take = (k: keyof TeamCardWait, apply: () => void) => { if (w[k] && !ow[k]) { apply(); nw[k] = false; took = true; } };
    take("pill", () => { next.pill = old.pill; });
    take("headcount", () => { next.headcount = old.headcount; });
    take("unhandled", () => { next.unhandled = old.unhandled; });
    take("okr", () => { next.okrPct = old.okrPct; });
    take("inspection", () => { next.inspectionPct = old.inspectionPct; });
    if (old.renewalPct !== undefined) take("renewal", () => { next.renewalPct = old.renewalPct; }); // 옛 캐시(칸 없음)면 "…" 그대로 기다림
    take("alerts", () => { next.alerts = [...old.alerts]; });
    next.tiles = c.tiles.map((t) => {
      const o = old.tiles.find((x) => x.id === t.id);
      if (!t.wait || !o || o.wait) return t;
      took = true;
      return { ...o, wait: false };
    });
    if (!took) return c;
    used = true;
    return { ...next, stale: true };
  });
  return { cards, used };
}

/** 홈 머리 띠 큰 숫자 3개 — 미처리 전체 · OKR 이번 주(CS 4파트) % · 분기 점검 % . 못 읽었으면 null("—") */
export type HeadlineNumbers = { unhandled: number | null; okrPct: number | null; inspectionPct: number | null };
export function headlineNumbers(b: KpiBundle | null): HeadlineNumbers {
  if (!b) return { unhandled: null, okrPct: null, inspectionPct: null };
  const w = b.facts.okr?.week;
  const all = b.facts.workin ? workinPace(b.facts.workin, b.ranges, b.facts.roster, b.settings.holidays)[0] : undefined;
  return {
    unhandled: b.facts.unhandled ? b.facts.unhandled.length : null,
    okrPct: w ? okrWeekResult(w, w.id, undefined, b.facts.roster).pct : null,
    inspectionPct: all && all.total ? all.rate : null,
  };
}

/**
 * 홈 미처리 칸 — 고른 탭에 맞는 종류 칸만(2026-10-25 사용자 "C팀 눌렀는데 경영·운영·영업·재계약까지 나와 어지럽다").
 * 보이는 칸만 줄인다 — 숫자(mergeUnhandled·탭 건수)는 그대로.
 *  · 전체: 전 종류 + 재계약 확인 지남 · 팀(A~E): CS 접수·원격·IT·물류 · 경영/운영/영업: 그 한 칸
 *  · 기타(팀 없는 행): 그 탭에 실제 있는 종류만(present 순서는 UNHANDLED_KINDS)
 */
export type UnhandledTabKinds = { kinds: UnhandledKind[]; recontract: boolean };
const TEAM_TAB_KINDS: UnhandledKind[] = ["CS접수", "원격이관", "IT", "물류"];
const DEPT_TAB_KIND: Partial<Record<UnhandledTab, UnhandledKind>> = { 경영: "경영지원", 운영: "운영지원", 영업: "영업팀" };
export function kindsForTab(tab: UnhandledTab, present: Partial<Record<UnhandledKind, number>> = {}): UnhandledTabKinds {
  if (tab === "전체") return { kinds: [...UNHANDLED_KINDS], recontract: true };
  const dept = DEPT_TAB_KIND[tab];
  if (dept) return { kinds: [dept], recontract: false };
  if (tab === "기타") return { kinds: UNHANDLED_KINDS.filter((k) => (present[k] || 0) > 0), recontract: false };
  return { kinds: [...TEAM_TAB_KINDS], recontract: false };
}
