/**
 * 통합검색 "무엇이든 묻기" — 앱 계산값 꾸러미(packs.kpi). 설계안 docs/tasks/search-ask-everything-2026-10-29.md 3-6·7-2.
 * KPI·팀 보드 숫자는 앱이 이미 센 값을 그대로 넘겨 화면 숫자와 답 숫자가 어긋나지 않게 한다.
 *  · 이번 주 질문: 홈 마지막 값 캐시(homeKpiSnapshot, 12시간 안·오늘 값)가 있으면 그것 → 즉시
 *  · 없거나 달·분기 질문: loadKpiBundle 로 한 번 읽고 kpiProgress(기간 × 전체·팀·개인)로 센다(몇 초)
 *  · 크기: data-ask 가 가림 뒤 25,000자 넘으면 통째로 버리므로 여기서 ASK_PACK_MAX_CHARS 안으로 줄인다(fitPacks)
 * 순수 부분(packsFromSnapshot·packsFromBundle·fitPacks)은 tests/askPacks.test.ts.
 * Search360 은 이 파일을 동적 import 한다(KPI 로더가 커서 통합검색 첫 화면 묶음에 넣지 않음).
 */
import { readHomeSnapshot, type HomeKpiSnapshot } from "./kpi/homeKpiSnapshot";
import { kpiCellState, loadKpiBundle, type KpiBundle } from "./kpi/kpiData";
import { kpiProgress, type KpiProgressRow } from "./kpi/kpiCompute";
import { KPI_DEFS, type KpiPeriodKey } from "./kpi/kpiDefs";
import { teamForAuthor } from "./operations";
import { kstDate } from "./visits";
import type { AskPeriod, AskPerson } from "./askRoute";

/** 엣지 상한 25,000자보다 조금 작게(가림으로 글자가 늘 수 있음) */
export const ASK_PACK_MAX_CHARS = 23_000;

export type AskPack = { kind: string; title: string; data: { rows: unknown[]; [k: string]: unknown } };
export type AskPackResult = { packs: AskPack[]; from: "snapshot" | "bundle" | "none"; note: string };

const TEAM_NAME = (t: string) => (t === "E" ? "CSS" : t);
const PERIOD_LABEL: Record<AskPeriod, string> = { week: "이번 주", month: "이번 달", quarter: "이번 분기" };
const STATUS_LABEL: Record<string, string> = { done: "달성", onTrack: "순항", behind: "부족", none: "판정 없음", pending: "대기" };

/** 홈 캐시 → 꾸러미. teams 를 주면 그 팀 칸·카드만(전체 칸은 늘 남김) */
export function packsFromSnapshot(s: HomeKpiSnapshot, opts: { teams?: string[] } = {}): AskPack[] {
  const want = opts.teams?.length ? new Set(opts.teams.map(TEAM_NAME)) : null;
  const keep = (scope: string) => !want || scope === "CS" || want.has(scope);
  const at = new Date(s.savedAt).toISOString();
  const packs: AskPack[] = [];
  packs.push({
    kind: "kpi_table", title: `KPI 달성표 이번 주(홈 화면 값, ${s.today} 기준)`,
    data: {
      period: "week", today: s.today, savedAt: at,
      legend: "cells = [범위(CS 전체·A~E, E=CSS), 실적, 목표, 판정]",
      rows: s.table.map((r) => ({
        id: r.id, name: r.name, unit: r.unit, status: STATUS_LABEL[r.status] || r.status, target: r.targetLabel, basis: r.basis.slice(0, 160), main: r.main,
        cells: r.cells.filter((c) => keep(c.scope)).map((c) => [c.scope, c.value, c.target, STATUS_LABEL[c.status] || c.status]),
      })),
    },
  });
  if (s.teams?.length) {
    packs.push({
      kind: "kpi_teams", title: "팀 카드(홈 팀 보드, 이번 주·말일 기준)",
      data: {
        rows: s.teams.filter((t) => !want || want.has(TEAM_NAME(t.team))).map((t) => ({
          team: t.label, headcount: t.headcount, pill: STATUS_LABEL[t.pill] || t.pill, unhandled: t.unhandled, okrPct: t.okrApplies ? t.okrPct : "대상 아님",
          inspectionPct: t.inspectionPct, renewalPct: t.renewalPct ?? null, tiles: t.tiles.map((x) => [x.label, x.value, x.pct, STATUS_LABEL[x.status] || x.status]), alerts: t.alerts,
        })),
      },
    });
  }
  if (s.unhandled) {
    packs.push({ kind: "kpi_unhandled", title: "미처리 합계(홈 미처리 칸)", data: { total: s.unhandled.total, recontractOverdue: s.unhandled.recontract, oldest: s.unhandled.oldest, rows: [...s.unhandled.tabs.map((t) => ({ 팀: t.label, 건수: t.value })), ...s.unhandled.kinds.map((k) => ({ 종류: k.label, 건수: k.value }))] } });
  }
  const okr = s.okr?.week;
  if (okr) {
    packs.push({ kind: "kpi_okr", title: "OKR 달성률(홈 OKR 칸, 이번 주차)", data: { pct: okr.pct, allPct: okr.allPct ?? null, missingTeams: okr.missingTeams, rows: (okr.teamLines || []).map((l) => ({ 팀: l.team, 달성률: l.pct, 미작성인원: l.missing })) } });
  }
  if (s.todayItems.length) {
    packs.push({ kind: "kpi_today", title: "금일 현황(홈 띠)", data: { rows: s.todayItems.map((it) => ({ id: it.id, 지표: it.label, 값: it.value, 단위: it.unit })) } });
  }
  return packs;
}

const compactRow = (r: KpiProgressRow) => [r.label, r.actual, r.target, r.rate];

/**
 * 묶음 → 꾸러미(kpiProgress 그대로). 기간 하나 × 범위(전체·팀, 사람을 주면 그 사람 개인 줄도).
 * 원본을 못 읽은 지표는 빼고 그 이유를 skipped 로.
 */
export function packsFromBundle(b: KpiBundle, opts: { period: AskPeriod; teams?: string[]; people?: AskPerson[]; teamOf?: (a: string) => string }): AskPack[] {
  const teamOf = opts.teamOf || teamForAuthor;
  const period = opts.period as KpiPeriodKey;
  const wantTeams = opts.teams?.length ? new Set(opts.teams) : null;
  const wantPeople = new Set((opts.people || []).map((p) => p.name));
  const rows: unknown[] = [];
  const skipped: string[] = [];
  for (const d of KPI_DEFS) {
    if (d.status !== "ready") continue;
    const st = kpiCellState(d.id, b);
    if (st.status !== "ok") { skipped.push(`${d.id} ${d.name}`); continue; }
    const p: KpiPeriodKey = d.periods.includes(period) ? period : d.periods[d.periods.length - 1] || period;
    let list: KpiProgressRow[];
    try { list = kpiProgress(d.id, b.facts, { ranges: b.ranges, period: p, settings: b.settings, teamOf }); }
    catch (e) { skipped.push(`${d.id} ${d.name}(${e instanceof Error ? e.message : String(e)})`); continue; }
    const pick = list.filter((r) => r.scope === "all"
      || (r.scope === "team" && (!wantTeams || wantTeams.has(r.team)))
      || (r.scope === "person" && wantPeople.has(r.label)));
    rows.push({ id: d.id, name: d.name, unit: d.unit, better: d.better, period: p, basis: d.basis.slice(0, 160), rows: pick.map(compactRow) });
  }
  const range = b.ranges[period === "today" ? "todayRange" : period] as { from: string; to: string } | undefined;
  return [{
    kind: "kpi_progress", title: `KPI ${PERIOD_LABEL[opts.period]} 실적·목표(홈과 같은 계산, ${b.today} 기준)`,
    data: {
      period: opts.period, today: b.today, ...(range ? { from: range.from, to: range.to } : {}),
      legend: "rows = [범위(CS 전체·A팀…·이름), 실적, 목표, 달성률%] — 목표 null 은 목표 없음, 실적 null 은 대상 없음",
      ...(skipped.length ? { skipped } : {}),
      rows,
    },
  }];
}

const size = (packs: AskPack[]) => JSON.stringify(packs).length;

/**
 * 크기 상한 맞추기 — 넘으면 가장 긴 rows 를 반씩 줄이고(truncated 표시), 더 줄일 게 없으면 뒤 꾸러미부터 버린다.
 * 반환 trimmed = 줄이거나 버린 꾸러미 kind.
 */
export function fitPacks(input: AskPack[], max = ASK_PACK_MAX_CHARS): { packs: AskPack[]; trimmed: string[] } {
  const packs: AskPack[] = input.map((p) => ({ ...p, data: { ...p.data, rows: [...p.data.rows] } }));
  const trimmed = new Set<string>();
  let guard = 0;
  while (packs.length && size(packs) > max && guard++ < 200) {
    let target: AskPack | null = null;
    for (const p of packs) if (p.data.rows.length > 1 && (!target || p.data.rows.length > target.data.rows.length)) target = p;
    if (target) {
      const total = (target.data.rowsTotal as number | undefined) ?? target.data.rows.length;
      target.data.rows = target.data.rows.slice(0, Math.ceil(target.data.rows.length / 2));
      target.data.rowsTotal = total;
      target.data.truncated = true;
      trimmed.add(target.kind);
    } else {
      trimmed.add(packs.pop()!.kind);
    }
  }
  return { packs, trimmed: [...trimmed] };
}

/** 꾸러미 만들기(조회 포함). 이번 주면 홈 캐시 먼저, 아니면(또는 캐시 없음) 한 번 읽어 센다 */
export async function loadAskPacks(opts: { period: AskPeriod; teams?: string[]; people?: AskPerson[] }): Promise<AskPackResult> {
  const today = kstDate();
  let storage: Storage | null = null;
  try { storage = typeof window !== "undefined" ? window.localStorage : null; } catch { storage = null; }
  const snap = opts.period === "week" && !opts.people?.length ? readHomeSnapshot(storage, today, Date.now()) : null;
  let raw: AskPack[];
  let from: AskPackResult["from"];
  if (snap) { raw = packsFromSnapshot(snap, { teams: opts.teams }); from = "snapshot"; }
  else { raw = packsFromBundle(await loadKpiBundle({ today }), opts); from = "bundle"; }
  const fit = fitPacks(raw);
  const note = `${from === "snapshot" ? "홈 KPI 캐시" : "KPI 새로 계산"}${fit.trimmed.length ? ` · 크기 상한으로 일부 줄임(${fit.trimmed.join(", ")})` : ""}`;
  return { packs: fit.packs, from, note };
}
