/**
 * 홈 3차 "팀 보드"(2026-10-25, docs/tasks/home-design-3-impl-2026-10-25.md) — 팀 카드 5장(A·B·C·D·CSS=E)과 머리 띠 큰 숫자 3개의 순수 모델.
 * 새 조회 없음: 이미 읽은 묶음(KpiBundle)과 이미 있는 함수 결과만 조합한다.
 *  · 주요 목표 판정·미니 KPI·정기점검 % = 달성표 행(homeKpiModel.tableRows — 달성표 위젯과 같은 cachedView 키라 다시 세지 않음)의 팀 칸
 *  · 미처리 = facts.unhandled(homeUnhandled.mergeUnhandled 결과)의 팀 행 수 — 홈 미처리 칸 팀 탭과 같은 숫자
 *  · OKR 이번 주 % = okrWeekResult(이번 주, 전체 범위).byTeam — OKR 위젯 [전체] 칩과 같은 숫자. CSS(E)는 OKR 대상 아님 → "—"
 * 화면은 TeamBoard.view.tsx. 테스트: tests/teamBoard.test.ts
 */
import { KPI_DEFS, type KpiId } from "./kpiDefs";
import { okrWeekResult, pct, workinPace, type OkrWeekFacts, type RosterMember } from "./kpiCompute";
import type { KpiBundle } from "./kpiData";
import { cachedView, okrPeopleForTeam, tableRows, type ModelCtx, type TablePeriod, type TableRowModel } from "./homeKpiModel";
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

export type TeamPill = "behind" | "done" | "onTrack" | "none";
export const TEAM_PILL_LABEL: Record<TeamPill, string> = { behind: "부족", done: "달성", onTrack: "순항", none: "판정 없음" };

export type TeamMiniTile = { id: string; label: string; status: KpiStatus; pct: number | null; value: number | null };

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
  tiles: TeamMiniTile[];
  /** 주의 한 줄 조각(없으면 빈 배열 → "주의 없음") */
  alerts: string[];
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
  /** 팀별 이번 주 OKR 보고 미작성 인원 = homeKpiModel.okrPeopleForTeam(명단 ∪ 보고자) 의 missing 수 — OKR 칸 팀원 목록과 같은 정의 */
  okrMissing?: Partial<Record<TeamKey, number>> | null;
};

/** 순수 조합 — 테스트는 이것으로. rows 는 tableRows 결과(이번 기간), unhandled 는 mergeUnhandled 결과 */
export function teamBoardFromParts(p: TeamBoardParts): TeamCardModel[] {
  const byId = new Map((p.rows || []).map((r) => [r.id, r]));
  const okr = p.okrWeek ? okrWeekResult(p.okrWeek, p.okrWeek.id) : null;
  return TEAM_ORDER.map((team) => {
    const okrApplies = team !== "E";
    const mainRows = (p.rows || []).filter((r) => r.main && r.cellState === "ready");
    const mainCells = mainRows.map((r) => ({ row: r, cell: cellOf(r, team) })).filter((x): x is { row: TableRowModel; cell: NonNullable<ReturnType<typeof cellOf>> } => !!x.cell);
    const teamRows = p.unhandled ? p.unhandled.filter((r) => r.team === team) : null;
    const okrPct = okrApplies && okr ? okr.byTeam.find((t) => t.team === team)?.pct ?? null : null;
    const tiles: TeamMiniTile[] = TEAM_MINI_KPIS.map(({ id, short }) => {
      const row = byId.get(id);
      const c = cellOf(row, team);
      return { id, label: short, status: c ? c.status : "pending", pct: cellPct(c), value: c ? c.value : null };
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
      tiles, alerts,
    };
  });
}

/** 묶음 → 팀 카드 5장. 달성표 위젯과 같은 cachedView 키(`table|end`)를 써서 같은 묶음·기간이면 다시 세지 않는다 */
export function teamBoardView(b: KpiBundle | null, period: TablePeriod, teamOf: ModelCtx["teamOf"], basis: "end" | "early" = "end"): TeamCardModel[] {
  if (!b) return teamBoardFromParts({ rows: null, unhandled: null, roster: null, okrWeek: null });
  const ctx: ModelCtx = { teamOf, period };
  const rows = cachedView(b, ctx, `table|${basis}`, () => tableRows(b, ctx, basis));
  const okrMissing = cachedView(b, ctx, "teamBoard|okrMissing", () =>
    Object.fromEntries(OKR_TEAMS.map((t) => [t, okrPeopleForTeam(b, t, "week").filter((x) => x.missing).length])) as Partial<Record<TeamKey, number>>);
  return teamBoardFromParts({ rows, unhandled: b.facts.unhandled ?? null, roster: b.facts.roster ?? null, okrWeek: b.facts.okr?.week ?? null, okrMissing });
}

/** 홈 머리 띠 큰 숫자 3개 — 미처리 전체 · OKR 이번 주(CS 4파트) % · 분기 점검 % . 못 읽었으면 null("—") */
export type HeadlineNumbers = { unhandled: number | null; okrPct: number | null; inspectionPct: number | null };
export function headlineNumbers(b: KpiBundle | null): HeadlineNumbers {
  if (!b) return { unhandled: null, okrPct: null, inspectionPct: null };
  const w = b.facts.okr?.week;
  const all = b.facts.workin ? workinPace(b.facts.workin, b.ranges, b.facts.roster, b.settings.holidays)[0] : undefined;
  return {
    unhandled: b.facts.unhandled ? b.facts.unhandled.length : null,
    okrPct: w ? okrWeekResult(w, w.id).pct : null,
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
