// OKR — 월별 목표(Pillar·병목·목표·달성기준)와 파트별 실행결과(실제결과·종합판정·사유·개선계획·근거자료)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북(작성가이드 / 통합집계 / A~D파트 시트)을 그대로 옮긴 구조다(2026-09-24).
//  - okr_cycles : 기간 하나(월간 또는 주간). 목표 9개와 팀장 피드백을 들고 있다. 주간 기간은 그 달의 목표를 복사해 쓴다.
//  - okr_reports: 기간 × 파트 × 사람 하나. member=''가 파트 종합(통합집계가 읽는 행), member='이름'이 팀원 개인 기록.
//    파트 결과는 팀원 기록을 파트장이 모아 쓴다(2026-09-24 사용자: "A~D는 각 팀원 내용을 합친 통계이므로 팀원 그룹도 있어야").
// 표 생성·초기 데이터: supabase/okr.sql (사용자가 SQL Editor에서 실행).
import { deleteRows, invokeEdgeFunction, selectAllRows, selectRows, upsertRow } from "./supabase";
// 2026-10-29: 순수 규칙(판정·달성률·목표 층·주차·K19 주 단위 셈)은 _shared/ask/okr-rules.ts 로 옮겼다 — 통합검색 data-ask 분석 도구가 같은 코드로 센다.
// 이 파일은 그대로 다시 내보낸다(가져다 쓰는 쪽은 바꿀 것 없음).
import {
  OKR_PILLARS, OKR_TEAMS, actionTeams, bottleneckText, commonGoalsOf, blankGoalsLike, effectiveGoals, emptyGoal, emptyHeader, emptyResultRow,
  findReport, goalHasText, goalsApplyingTo, isAlert, isLegacyMonthId, layerRowsOf, monthCycleId, monthsOfQuarter,
  normalizeJudgment, okrWeeksInMonth, pillarIndex, quarterCycleId, quarterOf, renumberGoals, resultRowFor, weekCycleId, worstOfJudgments, achievementRate,
  OKR_LEGACY_UNTIL, lastJudgmentInMonth,
} from "../supabase/functions/_shared/ask/okr-rules.ts";
import type {
  OkrCycle, OkrFeedback, OkrGoal, OkrGoalScope, OkrGoalView, OkrGoalsOrigin, OkrHeader, OkrJudgment, OkrReport, OkrResultRow, OkrTeam,
} from "../supabase/functions/_shared/ask/okr-rules.ts";
export * from "../supabase/functions/_shared/ask/okr-rules.ts";


const pad = (n: number) => String(n).padStart(2, "0");
// 결과(실제결과·판정)가 적힌 기록이 있는 달·주차 id — 달력의 점과 '월 종합' 버튼 표시용(2026-09-29: 빈 초안까지 표시돼 헷갈렸다)
export async function listOkrResultIndex(): Promise<Set<string>> {
  const rows = await selectRows<{ cycle_id: string; rows: unknown }>("okr_reports", "select=cycle_id,rows&limit=2000");
  const out = new Set<string>();
  for (const r of rows) {
    const list = Array.isArray(r.rows) ? (r.rows as Array<{ actual?: string; judgment?: string }>) : [];
    if (list.some((x) => String(x.actual || "").trim() || String(x.judgment || "").trim())) out.add(r.cycle_id);
  }
  return out;
}
export const hasResultRows = (rows: OkrResultRow[]) => rows.some((x) => x.actual.trim() || x.judgment.trim());

export function cycleLabel(c: Pick<OkrCycle, "kind" | "year" | "month" | "week_no">): string {
  if (c.kind === "quarter") return `${c.year}년 ${quarterOf(c.month)}분기`;
  return c.kind === "week" ? `${c.year}년 ${c.month}월 ${c.week_no}주차` : `${c.year}년 ${c.month}월`;
}
export function defaultCycleTitle(c: Pick<OkrCycle, "kind" | "year" | "month" | "week_no">): string {
  if (c.kind === "quarter") return `CS팀 ${quarterOf(c.month)}분기 OKR`;
  return c.kind === "week" ? `CS팀 ${c.month}월 ${c.week_no}주차 OKR 실행결과` : `CS팀 ${c.month}월 OKR 실행결과`;
}

// Pillar 1→2→3 순으로 정렬(같은 Pillar 안에서는 원래 순서 유지, Pillar 미정은 맨 뒤) 후 번호 다시 매김
export function sortGoalsByPillar(goals: OkrGoal[]): OkrGoal[] {
  const rank = (g: OkrGoal) => { const i = pillarIndex(g.pillar); return i < 0 ? 99 : i; };
  return renumberGoals([...goals].sort((a, b) => rank(a) - rank(b)));
}
// 병목현상 번호 — 같은 Pillar 안에서 몇 번째 목표인지(엑셀의 '병목현상 1·2·3')
export function bottleneckLabel(goals: OkrGoal[], no: number): string {
  const goal = goals.find((g) => g.no === no);
  if (!goal) return "";
  const idx = pillarIndex(goal.pillar);
  const siblings = goals.filter((g) => pillarIndex(g.pillar) === idx).sort((a, b) => a.no - b.no);
  const pos = siblings.findIndex((g) => g.no === no);
  return `병목현상 ${pos + 1}`;
}
// 목표 순서가 바뀌었을 때(삽입·삭제·정렬) 옛 번호 → 새 번호 표. 결과 행과 피드백 키를 같이 옮길 때 쓴다.
export function remapReports(reports: OkrReport[], remap: Map<number, number>, only: (r: OkrReport) => boolean = () => true): OkrReport[] {
  return reports.map((r) => (only(r) ? {
    ...r,
    rows: r.rows.filter((x) => remap.has(x.no)).map((x) => ({ ...x, no: remap.get(x.no) as number })).sort((a, b) => a.no - b.no),
    ...(r.feedback ? { feedback: remapFeedback(r.feedback, remap) } : {}),
    ...(r.goals?.length ? { goals: r.goals.filter((g) => remap.has(g.no)).map((g) => ({ ...g, no: remap.get(g.no) as number })).sort((a, b) => a.no - b.no) } : {}), // 달성기준 덮어쓰기 칸도 같은 번호를 따라간다
  } : r));
}
// ── 달성기준 덧씌우기(2026-10-01 사용자): 목표·Pillar·병목은 통합집계의 공통 하나, 달성기준만 파트 종합 → 개인 순으로 덮어쓴다.
// over에는 고친 번호의 칸만 들어 있다 — 안 고친 번호는 위 단계 것이 그대로 흐른다(파트장이 나중에 고쳐도 팀원에게 보인다).
export function overlayCriteria(base: OkrGoal[], over?: OkrGoal[]): OkrGoal[] {
  if (!over?.length) return base;
  return base.map((g) => {
    const o = over.find((x) => x.no === g.no);
    if (!o) return g;
    const html: NonNullable<OkrGoal["html"]> = { ...(g.html || {}) };
    delete html.criteria;
    if (o.html?.criteria) html.criteria = o.html.criteria;
    return { ...g, criteria: o.criteria, html: Object.keys(html).length ? html : undefined };
  });
}
// 전주 달성기준 가져오기: 전주에 그 칸에 보이던 기준 중 지금 기본(한 단계 위)과 다른 번호만 — 같은 건 위 단계 것이 계속 흐르게. 빈 것은 제외.
export function criteriaToCarry(prevEffective: OkrGoal[], currentBase: OkrGoal[]): OkrGoal[] {
  return prevEffective
    .filter((p) => { const b = currentBase.find((g) => g.no === p.no); return !!b && p.criteria.trim() !== "" && p.criteria !== b.criteria; })
    .map((p) => ({ ...p, html: p.html?.criteria ? { criteria: p.html.criteria } : undefined }));
}
// 덮어쓰기 칸 목록에 넣기 — 같은 번호는 바꾸고 번호순으로
export function putCriteria(list: OkrGoal[] | undefined, entries: OkrGoal[]): OkrGoal[] {
  const kept = (list || []).filter((x) => !entries.some((e) => e.no === x.no));
  return [...kept, ...entries].sort((a, b) => a.no - b.no);
}
// 같은 사람의 결과 행 둘을 번호별로 합친다(주차 번호 정리로 두 기간 행이 하나가 될 때, 2026-10-01):
// 한쪽이 비면 채워진 쪽, 둘 다 있으면 keep을 두고 incoming의 글을 뒤에 덧붙인다(판정은 keep 것, 비어 있을 때만 incoming). 색(html)은 버린다.
export function mergeResultRows(keep: OkrResultRow[], incoming: OkrResultRow[]): OkrResultRow[] {
  const filled = (r: OkrResultRow | undefined) => !!r && (r.actual.trim() !== "" || r.judgment.trim() !== "");
  const nos = [...new Set([...keep, ...incoming].map((r) => r.no))].sort((a, b) => a - b);
  return nos.map((no) => {
    const a = keep.find((r) => r.no === no); const b = incoming.find((r) => r.no === no);
    if (!b) return a as OkrResultRow;
    if (!a || !filled(a)) return b;
    if (!filled(b)) return a;
    const join = (x: string, y: string) => (y.trim() && y.trim() !== x.trim() ? (x.trim() ? `${x.trimEnd()}\n${y.trim()}` : y.trim()) : x);
    return { no, actual: join(a.actual, b.actual), reason: join(a.reason, b.reason), plan: join(a.plan, b.plan), evidence: join(a.evidence, b.evidence), judgment: a.judgment.trim() ? a.judgment : b.judgment };
  });
}
export function remapFeedback(feedback: Record<string, OkrFeedback>, remap: Map<number, number>): Record<string, OkrFeedback> {
  return Object.fromEntries(Object.entries(feedback).filter(([k]) => remap.has(Number(k))).map(([k, v]) => [String(remap.get(Number(k))), v]));
}

// ── Supabase ──
export function normalizeGoals(raw: unknown[]): OkrGoal[] {
  return raw.map((g, i) => { const x = (g || {}) as Partial<OkrGoal>; return { no: Number(x.no) || i + 1, pillar: String(x.pillar || ""), bottleneck: String(x.bottleneck || ""), objective: String(x.objective || ""), criteria: String(x.criteria || ""), ...(x.hidden === true ? { hidden: true } : {}), ...scopeField(x.scope), ...(x.html && typeof x.html === "object" ? { html: x.html } : {}) }; });
}
// scope 는 팀이 A~D 일 때만 통과(이상한 값은 공통으로 읽는다). member 는 빈 글이면 뺀다(= 파트 전용).
function scopeField(raw: unknown): { scope?: OkrGoalScope } {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as { team?: unknown; member?: unknown };
  const team = String(r.team || "") as OkrTeam;
  if (!(OKR_TEAMS as readonly string[]).includes(team)) return {};
  const member = typeof r.member === "string" ? r.member.trim() : "";
  return { scope: member ? { team, member } : { team } };
}
type CycleRow = Partial<OkrCycle> & { id: string };
function toCycle(r: CycleRow): OkrCycle {
  const extra: Pick<OkrCycle, "direction" | "goals_origin" | "goals_prev"> = {};
  if (r.direction !== undefined) extra.direction = String(r.direction || "");
  if (r.goals_origin !== undefined) extra.goals_origin = toOrigin(r.goals_origin);
  if (r.goals_prev !== undefined) extra.goals_prev = Array.isArray(r.goals_prev) ? normalizeGoals(r.goals_prev) : null;
  return {
    id: r.id,
    kind: cycleKindOf(r.kind, r.id),
    title: String(r.title || ""),
    year: Number(r.year) || 0,
    month: Number(r.month) || 0,
    week_no: r.week_no == null ? null : Number(r.week_no),
    start_date: String(r.start_date || ""),
    end_date: String(r.end_date || ""),
    parent_id: r.parent_id ? String(r.parent_id) : null,
    goals: Array.isArray(r.goals) ? normalizeGoals(r.goals) : [],
    feedback: r.feedback && typeof r.feedback === "object" ? r.feedback : {},
    updated_at: r.updated_at,
    updated_by: r.updated_by ?? null,
    ...extra,
  };
}
const toOrigin = (v: unknown): OkrGoalsOrigin => (v === "copy" || v === "import" || v === "manual" || v === "leader" ? v : "");
// 서버 행의 kind → 화면 kind. 분기 행(`2026-Q4`)을 달로 읽지 않게 id 꼴도 함께 본다.
export function cycleKindOf(kind: unknown, id: string): OkrCycle["kind"] {
  if (kind === "quarter" || /^\d{4}-Q[1-4]$/.test(String(id || ""))) return "quarter";
  return kind === "week" ? "week" : "month";
}
function toReport(r: Partial<OkrReport> & { cycle_id: string; team: string }): OkrReport {
  const header = { ...emptyHeader(), ...(r.header && typeof r.header === "object" ? r.header : {}) };
  return {
    cycle_id: r.cycle_id,
    team: r.team,
    member: String(r.member || ""),
    header: { leader: String(header.leader || ""), author: String(header.author || ""), headcount: String(header.headcount || ""), submitted: String(header.submitted || "") },
    goals: Array.isArray((header as unknown as { goals?: unknown }).goals) ? normalizeGoals((header as unknown as { goals: unknown[] }).goals) : undefined,
    feedback: (() => { const f = (header as unknown as { feedback?: unknown }).feedback; return f && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, OkrFeedback>) : undefined; })(),
    rows: Array.isArray(r.rows) ? r.rows.map((x) => ({ no: Number(x.no) || 0, actual: String(x.actual || ""), judgment: String(x.judgment || ""), reason: String(x.reason || ""), plan: String(x.plan || ""), evidence: String(x.evidence || ""), ...(x.html && typeof x.html === "object" ? { html: x.html } : {}) })).filter((x) => x.no > 0) : [],
    updated_at: r.updated_at,
    updated_by: r.updated_by ?? null,
  };
}

// 표가 최신인지(okr_reports.member 열이 있는지) — 없으면 400(column does not exist). 표 자체가 없으면 404지만 그건 listOkrCycles가 알린다.
export async function probeOkrSchema(): Promise<boolean> {
  try { await selectRows("okr_reports", "select=member&limit=1"); return true; }
  catch (e) { return !/\(400\)/.test((e as Error).message); }
}

export async function listOkrCycles(): Promise<OkrCycle[]> {
  const rows = await selectRows<CycleRow>("okr_cycles", "select=*&order=start_date.desc,kind.asc&limit=300");
  return rows.map(toCycle);
}
export async function getOkrCycle(id: string): Promise<OkrCycle | null> {
  const rows = await selectRows<CycleRow>("okr_cycles", `select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows.length ? toCycle(rows[0]) : null;
}
// member를 주면 그 사람(''=파트 종합 행들)만
export async function getOkrReports(cycleId: string, member?: string): Promise<OkrReport[]> {
  const who = member === undefined ? "" : `&member=eq.${encodeURIComponent(member)}`;
  const rows = await selectRows<OkrReport>("okr_reports", `select=*&cycle_id=eq.${encodeURIComponent(cycleId)}${who}&order=team.asc,member.asc`);
  return rows.map(toReport);
}
export async function getOkrReport(cycleId: string, team: string, member: string): Promise<OkrReport | null> {
  const rows = await selectRows<OkrReport>("okr_reports", `select=*&cycle_id=eq.${encodeURIComponent(cycleId)}&team=eq.${encodeURIComponent(team)}&member=eq.${encodeURIComponent(member || "")}&limit=1`);
  return rows.length ? toReport(rows[0]) : null;
}

// ── 3자 병합(2026-09-29): base = 마지막으로 서버와 맞춘 값, local = 내 화면, server = 지금 서버.
// 여러 사람이 같은 달·주차를 동시에 적는다(팀원은 자기 행, 파트장은 종합·목표). 통째로 덮어쓰면 남이 적은 칸이 사라지므로
// 내가 base에서 고친 칸만 내 것으로 쓰고, 안 고친 칸은 서버 것을 따른다.
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// 2026-10-25 저녁(R1): 번호 단위 합집합 — 파트장·파트원이 동시에 행을 추가해도 남의 새 행이 사라지지 않는다.
//   번호마다: 둘 다 있으면 내가 고쳤으면 내 것·아니면 서버 것 · 한쪽에서만 새로 생겼으면 넣음 · 내가 지웠으면 뺌 · 서버가 지웠으면 내가 고친 경우만 남김.
//   같은 번호로 서로 다른 새 행(동시 추가)이면 서버 것은 그 번호, 내 것은 새 번호(층 행은 101+). 새 행은 아직 기록이 없어 번호를 바꿔도 안전.
//   otherNos = 같은 번호로 맞물리는 다른 사이클 번호(분기·세 달) — 새 번호가 그것과도 겹치지 않게(모르면 생략).
export function mergeGoals(base: OkrGoal[], local: OkrGoal[], server: OkrGoal[], otherNos: number[] = []): OkrGoal[] {
  if (same(local, base)) return server;
  if (same(server, base)) return local;
  const B = new Map(base.map((g) => [g.no, g]));
  const S = new Map(server.map((g) => [g.no, g]));
  const taken = [...base, ...local, ...server].map((g) => g.no).concat(otherNos);
  const out: OkrGoal[] = [];
  const serverPlaced = new Set<number>(); // 서버 행을 그 번호 그대로 이미 넣은 번호
  for (const l of local) {
    const b = B.get(l.no); const sv = S.get(l.no);
    if (b && sv) { out.push(same(l, b) ? sv : l); serverPlaced.add(l.no); continue; }
    if (b) { if (!same(l, b)) out.push(l); continue; } // 서버가 지웠다 — 내가 고친 행만 남김
    if (!sv) { out.push(l); continue; } // 내가 새로 만든 행
    serverPlaced.add(l.no);
    if (same(l, sv)) { out.push(l); continue; } // 둘이 똑같이 만든 행
    const no = nextGoalNo([], taken, !!l.scope); // 동시 추가 — 서버 것은 그 번호, 내 것은 새 번호
    taken.push(no);
    out.push({ ...l, no });
    serverPlaced.delete(l.no); // 서버 행은 아래에서 서버 순서 자리에 끼운다
  }
  // 서버에만 있는 행: 서버가 새로 만든 것만(base 에 있었는데 내가 지운 행은 뺌). 서버 순서에서 앞 행 바로 뒤에 끼운다.
  server.forEach((sv, i) => {
    if (serverPlaced.has(sv.no) || B.has(sv.no)) return;
    let at = 0;
    for (let k = i - 1; k >= 0; k--) { const idx = out.findIndex((g) => g.no === server[k].no); if (idx >= 0) { at = idx + 1; break; } }
    out.splice(at, 0, sv);
  });
  return out;
}
// 번호 안에서는 칸(memo·memoHtml·judgment·action) 단위로 합친다(2026-10-20): 팀장이 CS 종합을 고르는 사이 남이 같은 번호 메모를 고쳐도 둘 다 남게.
// 한쪽에 번호 자체가 없으면(지움·새로 생김) 예전처럼 번호 통째로 고른다.
export function mergeFeedback(base: Record<string, OkrFeedback>, local: Record<string, OkrFeedback>, server: Record<string, OkrFeedback>): Record<string, OkrFeedback> {
  const out: Record<string, OkrFeedback> = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(server)])) {
    const l = local[k]; const b = base[k]; const sv = server[k];
    if (!l || !sv) {
      const v = same(l, b) ? sv : l;
      if (v) out[k] = v;
      continue;
    }
    if (same(l, b)) { out[k] = sv; continue; }
    if (same(sv, b)) { out[k] = l; continue; }
    const bb: Partial<OkrFeedback> = b || {};
    const merged: Partial<OkrFeedback> = {};
    for (const f of new Set([...Object.keys(bb), ...Object.keys(l), ...Object.keys(sv)]) as Set<keyof OkrFeedback>) {
      const v = same(l[f], bb[f]) ? sv[f] : l[f];
      if (v !== undefined) (merged as Record<string, unknown>)[f] = v;
    }
    out[k] = { ...merged, memo: String(merged.memo ?? "") };
  }
  return out;
}
export function mergeCycle(base: OkrCycle, local: OkrCycle, server: OkrCycle): OkrCycle {
  const out: OkrCycle = { ...local, title: local.title !== base.title ? local.title : server.title, goals: mergeGoals(base.goals, local.goals, server.goals), feedback: mergeFeedback(base.feedback || {}, local.feedback || {}, server.feedback || {}) };
  // 분기 구조 열(있을 때만): 내가 고쳤으면 내 것, 아니면 서버 것
  if (local.direction !== undefined || server.direction !== undefined) out.direction = (local.direction ?? "") !== (base.direction ?? "") ? local.direction ?? "" : server.direction ?? local.direction ?? "";
  if (local.goals_origin !== undefined || server.goals_origin !== undefined) out.goals_origin = (local.goals_origin ?? "") !== (base.goals_origin ?? "") ? local.goals_origin ?? "" : server.goals_origin ?? local.goals_origin ?? "";
  if (local.goals_prev !== undefined || server.goals_prev !== undefined) out.goals_prev = !same(local.goals_prev, base.goals_prev) ? local.goals_prev ?? null : server.goals_prev ?? local.goals_prev ?? null;
  return out;
}
export function mergeReport(base: OkrReport, local: OkrReport, server: OkrReport): OkrReport {
  const header = { ...local.header };
  for (const k of Object.keys(header) as (keyof OkrHeader)[]) if (local.header[k] === base.header[k]) header[k] = server.header[k];
  const nos = [...new Set([...base.rows, ...local.rows, ...server.rows].map((r) => r.no))].sort((a, b) => a - b);
  const rows = nos.map((no) => {
    const l = local.rows.find((r) => r.no === no); const b = base.rows.find((r) => r.no === no); const sv = server.rows.find((r) => r.no === no);
    return same(l, b) ? sv || l : l;
  }).filter((r): r is OkrResultRow => !!r);
  const goals = same(local.goals, base.goals) ? server.goals : local.goals;
  const feedback = mergeFeedback(base.feedback || {}, local.feedback || {}, server.feedback || {});
  return { ...local, header, rows, goals: goals?.length ? goals : undefined, feedback: Object.keys(feedback).length ? feedback : undefined };
}
// 저장할 행 — 분기 구조 열(direction·goals_origin·goals_prev)은 값이 있을 때만 보낸다(SQL 실행 전 표에 보내면 400).
export function okrCyclePayload(cycle: OkrCycle, by: string, nowIso: string): Record<string, unknown> {
  return {
    id: cycle.id, kind: cycle.kind, title: cycle.title, year: cycle.year, month: cycle.month, week_no: cycle.week_no,
    start_date: cycle.start_date, end_date: cycle.end_date, parent_id: cycle.parent_id, goals: cycle.goals, feedback: cycle.feedback,
    ...(cycle.direction !== undefined ? { direction: cycle.direction } : {}),
    ...(cycle.goals_origin !== undefined ? { goals_origin: cycle.goals_origin } : {}),
    ...(cycle.goals_prev !== undefined ? { goals_prev: cycle.goals_prev } : {}),
    updated_at: nowIso, updated_by: by || null,
  };
}
export async function saveOkrCycle(cycle: OkrCycle, by: string): Promise<void> {
  await upsertRow("okr_cycles", okrCyclePayload(cycle, by, new Date().toISOString()), "id");
}
// 분기 구조 SQL(supabase/okr-quarter.sql)이 실행됐는지 — okr_cycles.direction 열이 없으면 400
export async function probeOkrQuarterSchema(): Promise<boolean> {
  try { await selectRows("okr_cycles", "select=direction&limit=1"); return true; }
  catch (e) { return !/\(400\)/.test((e as Error).message); }
}
export async function saveOkrReport(report: OkrReport, by: string): Promise<void> {
  await upsertRow("okr_reports", {
    cycle_id: report.cycle_id, team: report.team, member: report.member || "", header: { ...report.header, ...(report.goals?.length ? { goals: report.goals } : {}), ...(report.feedback && Object.keys(report.feedback).length ? { feedback: report.feedback } : {}) }, rows: report.rows,
    updated_at: new Date().toISOString(), updated_by: by || null,
  }, "cycle_id,team,member");
}
// AI 보조(엣지 함수 okr-assist) — format: 메모를 양식(항목 : n건 중 m건 (x%, 등급))으로 · merge: 팀원 기록을 파트 종합으로 · feedback: 팀장 피드백 초안
export type OkrAssistResult = { actual?: string; judgment?: string; reason?: string; plan?: string; evidence?: string; memo?: string; model?: string };
export async function okrAssist(body: Record<string, unknown>): Promise<OkrAssistResult> {
  return invokeEdgeFunction<OkrAssistResult>("okr-assist", body, 90_000);
}

// 팀원 한 사람의 이 달 기록 삭제(박스 ×). 명단에 있는 사람은 박스는 남고 기록만 지워진다.
export async function deleteOkrReport(cycleId: string, team: string, member: string): Promise<void> {
  await deleteRows("okr_reports", `cycle_id=eq.${encodeURIComponent(cycleId)}&team=eq.${encodeURIComponent(team)}&member=eq.${encodeURIComponent(member)}`);
}

export async function deleteOkrCycle(cycleId: string): Promise<void> {
  await deleteRows("okr_reports", `cycle_id=eq.${encodeURIComponent(cycleId)}`);
  await deleteRows("okr_cycles", `id=eq.${encodeURIComponent(cycleId)}`);
}

// ── 분기 → 월 → 주 (2026-10-20, docs/tasks/okr-quarter-month-week.md) ──
// 분기 OKR(팀장, id `2026-Q4`)과 월 OKR(팀장, id `2026-10`)은 따로 저장한다. 주차는 goals 없이 부모 달 것을 쓴다.


const lastDayOf = (y: number, m: number) => new Date(y, m, 0).getDate();
// 새 분기 행 — 9묶음 틀(글 비움). parent 없음, month는 분기 첫 달(DB month CHECK 1..12).
export function quarterDraft(year: number, q: number): OkrCycle {
  const months = monthsOfQuarter(year, q);
  const last = months[2].month;
  return {
    id: quarterCycleId(year, q), kind: "quarter", title: "", year, month: months[0].month, week_no: null,
    start_date: `${year}-${pad(months[0].month)}-01`, end_date: `${year}-${pad(last)}-${pad(lastDayOf(year, last))}`,
    parent_id: null, goals: blankGoalsLike([]), feedback: {}, direction: "", goals_origin: "",
  };
}
// 새 달 행 — 지난달 복사 대신 분기 틀(Pillar·번호만, 글 빈칸)에 goals_origin 'copy'(팀장 월 OKR 대기).
// parent_id는 분기 행을 넘겼을 때만 건다(FK: 분기 행이 서버에 있어야 함). quarter를 안 주면 3×3 빈 틀.
export function monthDraftFromQuarter(year: number, month: number, quarter?: OkrCycle | null): OkrCycle {
  return {
    id: monthCycleId(year, month), kind: "month", title: "", year, month, week_no: null,
    start_date: `${year}-${pad(month)}-01`, end_date: `${year}-${pad(month)}-${pad(lastDayOf(year, month))}`,
    parent_id: quarter && quarter.kind === "quarter" ? quarter.id : null,
    goals: blankGoalsLike(quarter?.goals || []), feedback: {}, direction: "", goals_origin: "copy",
  };
}

// ── 행(병목·목표 줄) 추가·삭제·보관(2026-10-25, docs/tasks/okr-rows-add-remove-2026-10-25.md) ──
// 번호(no)는 판정·피드백을 잇는 키라 다시 매기지 않는다. 화면 "병목현상 n"은 같은 Pillar 안 순서(bottleneckLabel)라 번호가 띄엄띄엄이어도 1·2·3·4.
export const visibleGoals = (goals: OkrGoal[]): OkrGoal[] => goals.filter((g) => !g.hidden);
export const archivedGoals = (goals: OkrGoal[]): OkrGoal[] => goals.filter((g) => g.hidden);
// 새 번호 = 그 사이클 최대 번호 + 1. otherNos = 같은 번호로 맞물리는 사이클(분기 ↔ 그 분기 달)의 번호 — 겹치면 분기 표에 남의 판정이 붙는다.
// 2026-10-25 저녁: 번호 띠 — 공통 행은 1~100 안에서 max+1, 층 행(layer=true)은 101부터 전역 max+1.
//   팀장 문서 붙여넣기는 늘 1~9 번호라 층 행과 부딪히지 않는다. 공통 띠가 꽉 차면(100) 전역 max+1.
export const LAYER_GOAL_NO_FROM = 101;
export function nextGoalNo(goals: OkrGoal[], otherNos: number[] = [], layer = false): number {
  const all = [...goals.map((g) => g.no), ...otherNos].filter((n) => Number.isFinite(n));
  const top = Math.max(0, ...all);
  if (layer) return Math.max(LAYER_GOAL_NO_FROM - 1, top) + 1;
  const low = Math.max(0, ...all.filter((n) => n < LAYER_GOAL_NO_FROM)) + 1;
  return low < LAYER_GOAL_NO_FROM ? low : top + 1;
}
// 그 Pillar 묶음 끝(배열에서 같은 Pillar 마지막 행 뒤)에 빈 행. 그 Pillar 행이 없으면 맨 끝.
// scope 를 주면 그 층 전용 행(번호 101+). otherNos 는 달이면 분기 + 그 분기 세 달 goals 번호 전부(층 행 포함).
export function addGoalRow(goals: OkrGoal[], pillar: string, otherNos: number[] = [], scope?: OkrGoalScope): { goals: OkrGoal[]; no: number } {
  const no = nextGoalNo(goals, otherNos, !!scope);
  const idx = pillarIndex(pillar);
  let at = -1;
  goals.forEach((g, i) => { if (pillarIndex(g.pillar) === idx) at = i; });
  const row: OkrGoal = { ...emptyGoal(no), pillar, ...(scope ? { scope: scope.member ? { team: scope.team, member: scope.member } : { team: scope.team } } : {}) };
  return { goals: at < 0 ? [...goals, row] : [...goals.slice(0, at + 1), row, ...goals.slice(at + 1)], no };
}
// 그 번호에 실제결과·판정이 어디든 있는지 — 보고서(월 파트·주차 팀원 등) rows + 사이클 feedback 의 사람 판정(CS·분기 종합)
export function goalHasRecords(no: number, reports: OkrReport[], feedbacks: Array<Record<string, OkrFeedback> | undefined> = []): boolean {
  if (reports.some((r) => { const row = resultRowFor(r, no); return !!(row.actual.trim() || normalizeJudgment(row.judgment)); })) return true;
  return feedbacks.some((f) => !!normalizeJudgment(f?.[String(no)]?.judgment || ""));
}
// 지우기 종류 — empty: 글·기록 없음(확인 없이 바로) · text: 글만 있음(확인 후 삭제) · archive: 기록 있음(삭제 대신 보관)
export type GoalRemoveKind = "empty" | "text" | "archive";
export function goalRemoveKind(goal: OkrGoal, hasRecords: boolean): GoalRemoveKind {
  if (hasRecords) return "archive";
  return goalHasText(goal) ? "text" : "empty";
}
// 행 빼기 — 기록이 있으면 hidden 으로 보관(판정 데이터는 보고서에 그대로), 없으면 배열에서 뺀다. 다른 행 번호는 그대로.
// view 를 주면 그 화면에서 지울 수 있는 행만 뺀다(editsRowDirectly — 전용 행은 누구나, 공통 행은 통합집계·분기에서만; 아니면 goals 그대로 + blocked).
// view 생략 = 예전처럼 검사 없음. (2026-10-25 밤: "주인 층만" → "누구나, 공통은 팀장 화면에서만")
export function removeGoalRow(goals: OkrGoal[], no: number, hasRecords: boolean, view?: OkrGoalView): { goals: OkrGoal[]; kind: GoalRemoveKind; blocked?: true } {
  const goal = goals.find((g) => g.no === no);
  if (!goal) return { goals, kind: "empty" };
  if (view && !editsRowDirectly(goal, view)) return { goals, kind: goalRemoveKind(goal, hasRecords), blocked: true };
  const kind = goalRemoveKind(goal, hasRecords);
  return { goals: kind === "archive" ? goals.map((g) => (g.no === no ? { ...g, hidden: true } : g)) : goals.filter((g) => g.no !== no), kind };
}
// 보관 행 되살리기 — 같은 자리·같은 번호로(지난 판정이 다시 붙는다)
export function restoreGoalRow(goals: OkrGoal[], no: number, view?: OkrGoalView): OkrGoal[] {
  return goals.map((g) => { if (g.no !== no || !g.hidden || (view && !editsRowDirectly(g, view))) return g; const rest = { ...g }; delete rest.hidden; return rest; });
}

// 그 화면이 이 행의 주인인지(새 행을 만드는 층과 같은 뜻 — 2026-10-25 밤부터 편집·삭제 판단엔 안 쓴다, editsRowDirectly·goalAppliesTo) — 통합집계·분기({}) = 공통 · 파트 종합({team}) = 그 파트 전용 · 파트원({team, member}) = 본인 전용
export function ownsGoal(g: Pick<OkrGoal, "scope">, view: OkrGoalView): boolean {
  if (!view.team) return !g.scope;
  if (!g.scope || g.scope.team !== view.team) return false;
  return view.member ? g.scope.member === view.member : !g.scope.member;
}
// 화면에 보일 행(2026-10-25 밤 재정정 — 사용자 "내 행은 내 탭에만, 다른 사람이 내 탭을 눌렀을 때 모두가 볼 수 있는 것"):
//   통합집계({}) = 공통만 / 파트 종합({team}) = 공통 + 그 파트 전용 / 파트원 탭({team, member}) = 공통 + 그 파트 전용 + 그 사람 전용.
//   = goalAppliesTo 와 같은 거르기(보이는 행 = 그 탭에서 판정할 행). 누가 그 탭을 열었는지는 따지지 않는다 — 남의 탭을 열면 그 사람 행이 보이고 고칠 수 있다.
//   순서: 같은 Pillar 묶음 안에서 공통(원래 순서) → 파트 전용 → 개인 전용. 보관 행(hidden)은 거르지 않는다(visibleGoals 는 따로).
const layerRank = (g: OkrGoal): string => (!g.scope ? "0" : g.scope.member ? `2|${g.scope.team}|${g.scope.member}` : `1|${g.scope.team}`);
export function goalsForView(goals: OkrGoal[], view: OkrGoalView = {}): OkrGoal[] {
  return orderByLayer(goalsApplyingTo(goals, view));
}
function orderByLayer(goals: OkrGoal[]): OkrGoal[] {
  const pillarAt = new Map<string, number>();
  goals.forEach((g) => { if (!pillarAt.has(g.pillar)) pillarAt.set(g.pillar, pillarAt.size); });
  return goals.map((g, i) => ({ g, i })).sort((a, b) => {
    const pa = pillarAt.get(a.g.pillar) ?? 0; const pb = pillarAt.get(b.g.pillar) ?? 0;
    if (pa !== pb) return pa - pb;
    const ra = layerRank(a.g); const rb = layerRank(b.g);
    if (ra !== rb) return ra === "0" ? -1 : rb === "0" ? 1 : ra.localeCompare(rb, "ko");
    return a.i - b.i;
  }).map((x) => x.g);
}
// 그 화면에서 행 자체(okr_cycles.goals)를 고치는지 — 전용 행(scope)은 그 행이 보이는 화면이면 누가 열었든 행 자체(한 벌),
//   공통 행은 통합집계·분기({})에서만 행 자체, 파트 탭에선 그 층 덮어쓰기(팀장 문서 보호, 4차 그대로). 삭제·보관 × 도 같은 기준.
export function editsRowDirectly(g: Pick<OkrGoal, "scope">, view: OkrGoalView = {}): boolean { return !!g.scope || !view.team; }
// 공통 행 통째 교체(붙여넣기·빈 틀·분기로 시작·다른 달 가져오기) = nextCommon 의 공통 행 + current 의 층 행(번호 그대로).
// nextCommon 에 섞여 온 층 행은 버린다(다른 달의 전용 행을 가져오지 않음). 층 행 번호와 겹친 공통 행은 새 번호(1~100 띠).
// 층 행은 같은 Pillar 묶음 끝에 다시 끼운다(그 Pillar 가 없으면 맨 끝).
export function replaceCommonGoals(current: OkrGoal[], nextCommon: OkrGoal[]): OkrGoal[] {
  const layers = layerRowsOf(current);
  const layerNos = new Set(layers.map((g) => g.no));
  const common = commonGoalsOf(nextCommon);
  const taken = [...layers, ...common].map((g) => g.no);
  let out: OkrGoal[] = common.map((g) => {
    if (!layerNos.has(g.no)) return g;
    const no = nextGoalNo([], taken); taken.push(no);
    return { ...g, no };
  });
  for (const l of layers) {
    const idx = pillarIndex(l.pillar);
    let at = -1;
    out.forEach((g, i) => { if (pillarIndex(g.pillar) === idx) at = i; });
    out = at < 0 ? [...out, l] : [...out.slice(0, at + 1), l, ...out.slice(at + 1)];
  }
  return out;
}


// ── 붙여넣기 파서: 팀장 문서 글 또는 엑셀 표 복사 → direction + 9묶음 ──
export type OkrPasteResult = { direction: string; goals: OkrGoal[]; warnings: string[] };
type PasteField = "bottleneck" | "objective" | "criteria";
const FIELD_NAMES: Record<PasteField, string> = { bottleneck: "병목현상", objective: "목표", criteria: "실행" };
const RE_DIRECTION = /^\s*★?\s*핵심\s*방향\s*★?\s*[.:：]?\s*(.*)$/;
const RE_PILLAR = /^\s*Pillar\s*([1-3])(?!\d)\s*[.:：)]?\s*(.*)$/i;
const RE_GOAL_HEAD = /^\s*(병목\s*현상|목표|실행|달성\s*기준)\s*([1-9])(?!\d)\s*(?:[.:：)]\s*|\s+|$)(.*)$/;
const BULLET = /^[·•∙ㆍ\-–*▪■□○●]\s*/;

const fieldOf = (word: string): PasteField => { const w = word.replace(/\s+/g, ""); return w === "병목현상" ? "bottleneck" : w === "목표" ? "objective" : "criteria"; };
const pillarFull = (idx: number, raw = "") => (idx >= 0 && idx < OKR_PILLARS.length ? OKR_PILLARS[idx].full : raw);

export function parseOkrPaste(text: string): OkrPasteResult {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  if (isTablePaste(src)) return parseTablePaste(src);
  return parseDocPaste(src);
}

function finishGoals(map: Map<number, OkrGoal>, warnings: string[], fieldsSeen: Map<number, Set<PasteField>>, checkFields: PasteField[]): OkrGoal[] {
  const goals = [...map.values()].sort((a, b) => a.no - b.no);
  for (const g of goals) {
    const seen = fieldsSeen.get(g.no) || new Set<PasteField>();
    const where = `Pillar ${Math.ceil(g.no / 3)} 병목 ${((g.no - 1) % 3) + 1}`;
    for (const f of checkFields) if (!seen.has(f) || !g[f].trim()) warnings.push(`${where}: ${FIELD_NAMES[f]} 없음`);
  }
  if (goals.length && goals.length !== 9) warnings.push(`묶음 ${goals.length}개(9개가 아님)`);
  return goals;
}

function parseDocPaste(src: string): OkrPasteResult {
  const warnings: string[] = [];
  const map = new Map<number, OkrGoal>();
  const seen = new Map<number, Set<PasteField>>();
  const directionLines: string[] = [];
  let pillarIdx = -1;
  let target: { kind: "direction" } | { kind: "goal"; no: number; field: PasteField } | null = null;
  let headers = 0;
  const push = (no: number, field: PasteField, line: string) => {
    const g = map.get(no) as OkrGoal;
    const t = line.trim();
    if (!t) return;
    if (field === "criteria" && g.criteria && !BULLET.test(t)) {
      // 불릿 없는 줄 = 앞 불릿 줄이 접혀 이어진 것
      const prevIsBullet = BULLET.test(g.criteria.split("\n").pop() || "");
      g.criteria = prevIsBullet ? `${g.criteria} ${t}` : `${g.criteria}\n${t}`;
      return;
    }
    g[field] = g[field] ? `${g[field]}\n${t}` : t;
  };
  for (const line of src.split("\n")) {
    const dm = line.match(RE_DIRECTION);
    if (dm) { headers++; target = { kind: "direction" }; if (dm[1].trim()) directionLines.push(dm[1].trim()); continue; }
    const pm = line.match(RE_PILLAR);
    if (pm) { headers++; pillarIdx = Number(pm[1]) - 1; target = null; continue; }
    const gm = line.match(RE_GOAL_HEAD);
    if (gm) {
      headers++;
      const n = Number(gm[2]);
      const pi = n > 3 ? Math.ceil(n / 3) - 1 : Math.max(0, pillarIdx);
      const no = n > 3 ? n : pi * 3 + n; // 병목 1~3은 Pillar 안 순번, 4~9면 전체 번호로 본다
      if (!map.has(no)) map.set(no, { no, pillar: pillarFull(pi), bottleneck: "", objective: "", criteria: "" });
      const field = fieldOf(gm[1]);
      if (!seen.has(no)) seen.set(no, new Set());
      (seen.get(no) as Set<PasteField>).add(field);
      target = { kind: "goal", no, field };
      if (gm[3].trim()) push(no, field, gm[3]);
      continue;
    }
    if (!target) continue; // 제목줄 등 머리 앞 글은 버림
    if (target.kind === "direction") { if (line.trim()) directionLines.push(line.trim()); }
    else push(target.no, target.field, line);
  }
  if (!headers) { warnings.push("머리줄(★핵심방향★·Pillar·병목현상 N·목표 N·실행 N)을 찾지 못했습니다"); return { direction: "", goals: [], warnings }; }
  const goals = finishGoals(map, warnings, seen, ["bottleneck", "objective", "criteria"]);
  return { direction: directionLines.join("\n"), goals, warnings };
}

// 탭 구분 + 머리행에 병목현상·목표가 있으면 엑셀 표 복사로 본다
function isTablePaste(src: string): boolean {
  if (!src.includes("\t")) return false;
  return splitTsv(src).some((cells) => headerColumns(cells) !== null);
}
// 엑셀 TSV: 줄바꿈 든 칸은 "…" 로 감싸고 안의 " 는 ""
export function splitTsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { quoted = true; i++; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
type PasteCols = { no: number; pillar: number; bottleneck: number; objective: number; criteria: number };
function headerColumns(cells: string[]): PasteCols | null {
  const norm = cells.map((c) => c.replace(/\s+/g, ""));
  const find = (re: RegExp) => norm.findIndex((c) => re.test(c));
  const cols: PasteCols = { no: find(/^(No\.?|번호)$/i), pillar: find(/^Pillar$/i), bottleneck: find(/^병목(현상)?$/), objective: find(/^목표$/), criteria: find(/^(달성기준|실행|달성기준\(실행\))$/) };
  return cols.bottleneck >= 0 && cols.objective >= 0 ? cols : null;
}
function parseTablePaste(src: string): OkrPasteResult {
  const warnings: string[] = [];
  const rows = splitTsv(src);
  const hi = rows.findIndex((r) => headerColumns(r) !== null);
  const cols = headerColumns(rows[hi]) as PasteCols;
  const map = new Map<number, OkrGoal>();
  const seen = new Map<number, Set<PasteField>>();
  let pillarIdx = -1; let pillarRaw = "";
  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  for (const r of rows.slice(hi + 1)) {
    const bottleneckCell = cell(r, cols.bottleneck); const objective = cell(r, cols.objective); const criteria = cell(r, cols.criteria);
    if (!bottleneckCell && !objective && !criteria) continue; // 빈 줄·합계 줄
    const pCell = cell(r, cols.pillar);
    if (pCell) { pillarIdx = pillarIndex(pCell); pillarRaw = pCell; } // 병합 셀은 첫 행에만 값 → 아래로 이어 씀
    const noCell = Number(cell(r, cols.no).replace(/[^\d]/g, ""));
    const no = noCell >= 1 ? noCell : map.size + 1;
    const pi = pillarIdx >= 0 ? pillarIdx : Math.ceil(no / 3) - 1;
    map.set(no, { no, pillar: pillarFull(pi, pillarRaw), bottleneck: bottleneckText(bottleneckCell), objective, criteria });
    const s = new Set<PasteField>(["bottleneck", "objective"]); if (cols.criteria >= 0) s.add("criteria");
    seen.set(no, s);
  }
  const goals = finishGoals(map, warnings, seen, cols.criteria >= 0 ? ["bottleneck", "objective", "criteria"] : ["bottleneck", "objective"]);
  if (cols.criteria < 0 && goals.length) warnings.push("달성기준 열이 없어 달성기준은 비워 둡니다(통합집계 표)");
  return { direction: "", goals, warnings };
}
// 붙여넣은 goals를 지금 goals에 덮는다 — 같은 번호 묶음만 바꾸고(결과 행·feedback이 번호로 이어짐), 붙여넣은 달성기준이 비면 지금 것을 둔다.
export function applyPastedGoals(current: OkrGoal[], pasted: OkrGoal[]): OkrGoal[] {
  const out = commonGoalsOf(current).map((g) => { // 층 행은 건드리지 않는다 — 공통 행만 덮고 층 행은 replaceCommonGoals 로 제자리에(2026-10-25 저녁)
    const p = pasted.find((x) => x.no === g.no);
    if (!p) return g;
    return { no: g.no, pillar: p.pillar || g.pillar, bottleneck: p.bottleneck, objective: p.objective, criteria: p.criteria.trim() ? p.criteria : g.criteria };
  });
  for (const p of pasted) if (!out.some((g) => g.no === p.no)) out.push({ ...p });
  const common = out.sort((a, b) => a.no - b.no);
  return layerRowsOf(current).length ? replaceCommonGoals(current, common) : common;
}

// ── 상단 필터: [4분기] [10월] [11월] [12월] ──
export type OkrFilterItem = { id: string; label: string; kind: "quarter" | "month"; year: number; month: number; exists: boolean; legacy: boolean };
// today('YYYY-MM-DD', visits.ts kstDate())가 든 분기, 또는 pick으로 고른 분기의 [분기, 달×3]. 주차는 넣지 않는다.
// 3차(2026-10-21): 파트 탭(A~D)엔 [n분기]가 없다 — 통합집계 탭('all')일 때만 분기 칩을 남긴다
// 2026-11-01 파트 분기: 파트 탭에도 [n분기] 칩을 남긴다. 단 legacy 분기(2026-Q3 이하, 분기 행 없음)는 종전처럼 파트 탭에서 뺀다.
export const filterItemsForTab = (items: OkrFilterItem[], tab: string): OkrFilterItem[] => (tab === "all" ? items : items.filter((it) => it.kind !== "quarter" || !it.legacy));
// 3차: 그 분기의 "지금 달" — 오늘(KST yyyy-mm-dd)이 든 달, 아니면 첫 달. 분기 화면에서 파트 탭을 누르면 이 달의 [파트 종합]으로 간다
export function quarterNowMonth(year: number, q: number, today: string): { year: number; month: number; id: string } {
  const ms = monthsOfQuarter(year, q);
  return ms.find((x) => x.year === Number(today.slice(0, 4)) && x.month === Number(today.slice(5, 7))) || ms[0];
}
export function topFilterItems(cycles: Pick<OkrCycle, "id">[], today: string, pick?: { year: number; quarter: number }): OkrFilterItem[] {
  const year = pick?.year ?? Number(today.slice(0, 4));
  const q = pick?.quarter ?? quarterOf(Number(today.slice(5, 7)));
  const ids = new Set(cycles.map((c) => c.id));
  const qid = quarterCycleId(year, q);
  const months = monthsOfQuarter(year, q);
  return [
    { id: qid, label: `${q}분기`, kind: "quarter" as const, year, month: months[0].month, exists: ids.has(qid), legacy: months[2].id <= OKR_LEGACY_UNTIL },
    ...months.map((m) => ({ id: m.id, label: `${m.month}월`, kind: "month" as const, year, month: m.month, exists: ids.has(m.id), legacy: isLegacyMonthId(m.id) })),
  ];
}

// ── 집계 ──
export type OkrTeamJudgments = Record<OkrTeam, OkrJudgment | "">;
const emptyTeamJudgments = (): OkrTeamJudgments => Object.fromEntries(OKR_TEAMS.map((t) => [t, ""])) as OkrTeamJudgments;
// dots(2026-10-20): A~D 파트 월 종합 동그라미(확정 set / 마지막 주차 제안 suggest), cs: CS 종합(월). byTeam·actionTeams는 예전처럼 확정 판정만.
export type OkrRollupRow = { no: number; pillar: string; bottleneck: string; objective: string; criteria: string; byTeam: OkrTeamJudgments; actionTeams: string[]; memo: string; dots: Record<OkrTeam, OkrJudgedCell>; cs: OkrRolledJudgment };
// 엑셀 '1.통합집계' — 묶음마다 A~D 파트 종합(member '') 판정과 조치 필요 파트. 묶음 글은 effectiveGoals(분기 대신 보일 때도 같은 번호).
// weekReports(그 달 주차 기록)를 주면 판정을 안 고른 파트에 마지막 주차 판정을 제안으로 채운다(dots·cs). 안 주면 제안 없음.
export function monthlyRollup(cycle: OkrCycle, reports: OkrReport[], quarter?: OkrCycle | null, weekReports?: OkrReport[]): OkrRollupRow[] {
  const summary = reports.filter((r) => !r.member && (!r.cycle_id || r.cycle_id === cycle.id));
  const weeks = weekReports || [];
  return visibleGoals(commonGoalsOf(effectiveGoals(cycle, quarter))).map((g) => { // 보관 행 제외(2026-10-25) · 공통 행만(층 행은 통합집계 표에 없음, 2026-10-25 저녁)
    const byTeam = emptyTeamJudgments();
    for (const t of OKR_TEAMS) byTeam[t] = normalizeJudgment(resultRowFor(findReport(summary, t), g.no).judgment);
    const dots = Object.fromEntries(OKR_TEAMS.map((t) => [t, partMonthJudgment(summary, weeks, t, g.no)])) as Record<OkrTeam, OkrJudgedCell>;
    const fb = cycle.feedback?.[String(g.no)];
    return { no: g.no, pillar: g.pillar, bottleneck: bottleneckText(g.bottleneck), objective: g.objective, criteria: g.criteria, byTeam, actionTeams: actionTeams(summary, g.no), memo: fb?.memo || "", dots, cs: monthCsJudgment(dots, fb?.judgment) };
  });
}
export type OkrQuarterProgress = {
  months: Array<{ id: string; month: number; actionTeams: number }>; // 그 달 조치 필요(미흡·미착수) 파트 칸 수
  rows: Array<{ no: number; pillar: string; bottleneck: string; objective: string; cells: Record<string, OkrTeamJudgments> }>; // cells[달id][파트]
};
// 분기 진행 표 — 묶음 × 달 × 파트 판정. 묶음 목록은 분기 goals(없으면 달들의 번호 합).
export function quarterProgress(monthCycles: OkrCycle[], reportsByCycle: Record<string, OkrReport[]>, quarter?: OkrCycle | null): OkrQuarterProgress {
  const months = monthCycles.filter((c) => c.kind === "month").sort((a, b) => (a.id < b.id ? -1 : 1));
  let base: OkrGoal[] = quarter?.goals || [];
  if (!base.length) {
    const byNo = new Map<number, OkrGoal>();
    for (const m of months) for (const g of commonGoalsOf(m.goals)) if (!byNo.has(g.no)) byNo.set(g.no, g);
    base = [...byNo.values()].sort((a, b) => a.no - b.no);
  }
  const rollups = new Map(months.map((m) => [m.id, monthlyRollup(m, reportsByCycle[m.id] || [], quarter)]));
  return {
    months: months.map((m) => ({ id: m.id, month: m.month, actionTeams: (rollups.get(m.id) || []).reduce((n, r) => n + r.actionTeams.length, 0) })),
    rows: base.map((g) => ({
      no: g.no, pillar: g.pillar, bottleneck: bottleneckText(g.bottleneck), objective: g.objective,
      cells: Object.fromEntries(months.map((m) => [m.id, (rollups.get(m.id) || []).find((x) => x.no === g.no)?.byTeam || emptyTeamJudgments()])),
    })),
  };
}
const weekNoOfId = (id: string) => { const m = String(id || "").match(/-W(\d+)$/); return m ? Number(m[1]) : 0; };
// 파트 종합 [✨ 주차 합치기] — 그 달 주차 팀원 기록의 실제결과를 "• 1주 이민구: …"로. 주차 → 이름 순.
export function mergeMonthActuals(weekReports: OkrReport[], no: number): string {
  return weekReports
    .filter((r) => r.member && weekNoOfId(r.cycle_id) > 0)
    .map((r) => ({ w: weekNoOfId(r.cycle_id), name: r.member, actual: resultRowFor(r, no).actual.trim() }))
    .filter((x) => x.actual)
    .sort((a, b) => a.w - b.w || a.name.localeCompare(b.name, "ko"))
    .map((x) => { const lines = x.actual.split(/\r?\n/); const head = `• ${x.w}주 ${x.name}`; return lines.length === 1 ? `${head}: ${lines[0]}` : `${head}:\n${lines.map((l) => `  ${l}`).join("\n")}`; })
    .join("\n");
}

// ── 2차 피드백(2026-10-20, docs/tasks/okr-feedback-2.md): 분기 → 월 → 파트 모두 '팀원 집계'와 같은 틀 ──
// 판정 출처: 'set' 사람이 고른 것 · 'suggest' 아래 단계에서 계산한 제안 · '' 없음
export type OkrJudgedCell = { judgment: OkrJudgment | ""; source: "set" | "suggest" | "" };
// judgment = 화면에 보일 값(manual이면 사람이 고른 것, 아니면 auto)
export type OkrRolledJudgment = { judgment: OkrJudgment | ""; auto: OkrJudgment | ""; manual: boolean };

// 파트 월 종합 칸 — 월 report(member '') 판정이 있으면 set, 없으면 lastJudgmentInMonth를 suggest
export function partMonthJudgment(monthReports: OkrReport[], weekReports: OkrReport[], team: string, no: number): OkrJudgedCell {
  const set = normalizeJudgment(resultRowFor(findReport(monthReports.filter((r) => !r.member), team), no).judgment);
  if (set) return { judgment: set, source: "set" };
  const suggested = lastJudgmentInMonth(weekReports, team, no);
  return suggested ? { judgment: suggested, source: "suggest" } : { judgment: "", source: "" };
}
const rolled = (auto: OkrJudgment | "", override?: string): OkrRolledJudgment => {
  const o = normalizeJudgment(override || "");
  return o ? { judgment: o, auto, manual: true } : { judgment: auto, auto, manual: false };
};
// CS 종합(월) — auto = A~D 칸(확정·제안 모두) 중 가장 나쁜 것, override(feedback[no].judgment)가 있으면 그것
export function monthCsJudgment(cells: Record<OkrTeam, OkrJudgedCell>, override?: string): OkrRolledJudgment {
  return rolled(worstOfJudgments(OKR_TEAMS.map((t) => cells[t]?.judgment || "")), override);
}
// 마지막 값(빈 것 건너뜀) — 분기 종합(달 CS 종합 3개)·파트 분기 종합(파트 월 종합 3개)에 같이 쓴다
export function lastOfJudgments(values: Array<OkrJudgment | "">): OkrJudgment | "" {
  for (let i = values.length - 1; i >= 0; i--) { const j = normalizeJudgment(values[i] || ""); if (j) return j; }
  return "";
}
export function quarterCsJudgment(byMonth: Array<OkrJudgment | "">, override?: string): OkrRolledJudgment {
  return rolled(lastOfJudgments(byMonth), override);
}

// 분기 통합집계(quarterProgress 대체) — 묶음 × 달 CS 종합 + 분기 종합, 파트별 칸(파트 탭용)도 같이
// 분기 표 "조치·확인 필요 달"(2026-10-21) — 그 목표의 월 CS 종합(사람 값 우선, 없으면 자동)이 미흡·미착수(isAlert)인 달 이름, 달 순서대로.
// 월 통합집계의 '조치 필요 파트'와 같은 규칙. months 는 화면의 세 달(없는 달은 byMonth 에 없어 건너뛴다).
export function alertMonths(byMonth: Record<string, OkrRolledJudgment> | undefined, months: Array<{ id: string; month: number }>): string[] {
  return months.filter((m) => isAlert(byMonth?.[m.id]?.judgment || "")).map((m) => `${m.month}월`);
}
// 분기 통합집계 파트 카드(2026-10-21) — 월 카드와 같은 값(판정 n/총·달성 %·미흡·미착수 수·파트장).
// 목표마다 그 파트의 월 판정 중 마지막 기록 달(byTeam.quarter = lastOfJudgments, ●·○ 모두)로 셈한다.
// 파트장 = 분기 달 중 가장 최근 달의 파트 월 report(member '') header.leader, 없으면 "".
export type OkrTeamCard = { team: OkrTeam; total: number; judged: number; alerts: number; rate: number | null; leader: string };
// 분기 카드 = 그 파트의 10·11·12월 합계(사용자 2026-10-21: "ABCD의 10,11,12의 토탈", 전체 = 목표 수 × 3달 = 27).
//   판정 n/27 = 달마다 파트 월 종합 판정(확정 ●·제안 ○ 모두)이 있는 칸 수, 미흡·미착수 = 그 중 경고 판정 수, 달성 % = 월 카드와 같은 셈(완료·해당없음 / 판정 있는 칸).
//   달 행이 아직 없는 달도 전체(27)에 넣는다. 파트장 = 가장 최근 달 파트 월 report 의 header.leader.
export function quarterTeamCard(rollup: OkrQuarterRollup, team: OkrTeam, monthReports: Record<string, OkrReport[]>): OkrTeamCard {
  const monthCount = Math.max(3, rollup.months.length);
  const rows: OkrResultRow[] = [];
  for (const r of rollup.rows) for (const m of rollup.months) rows.push({ ...emptyResultRow(r.no), judgment: r.byTeam[team]?.byMonth[m.id]?.judgment || "" });
  const ids = [...new Set([...rollup.months.map((m) => m.id), ...Object.keys(monthReports)])].sort().reverse();
  const leader = ids.map((id) => findReport(monthReports[id] || [], team, "")?.header.leader?.trim() || "").find(Boolean) || "";
  return { team, total: rollup.rows.length * monthCount, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, alerts: rows.filter((r) => isAlert(r.judgment)).length, rate: achievementRate(rows), leader };
}
export type OkrQuarterRollup = {
  months: Array<{ id: string; month: number; actionTeams: number }>;
  rows: Array<{
    no: number; pillar: string; bottleneck: string; objective: string; criteria: string;
    byMonth: Record<string, OkrRolledJudgment>; // [달id] CS 종합
    quarter: OkrRolledJudgment; // 분기 종합(quarter.feedback[no].judgment 덮어쓰기)
    byTeam: Record<OkrTeam, { byMonth: Record<string, OkrJudgedCell>; quarter: OkrJudgment | "" }>; // 파트 탭
  }>;
};
const emptyRolled = (): OkrRolledJudgment => ({ judgment: "", auto: "", manual: false });
const emptyCell = (): OkrJudgedCell => ({ judgment: "", source: "" });
// 묶음 목록은 분기 goals(없으면 달들의 번호 합) — quarterProgress와 같다. 달은 넘긴 월 행만(없는 달은 열이 없다).
export function quarterRollup(quarter: OkrCycle | null, monthCycles: OkrCycle[], monthReports: Record<string, OkrReport[]>, weekReportsByMonth: Record<string, OkrReport[]>): OkrQuarterRollup {
  const months = monthCycles.filter((c) => c.kind === "month").sort((a, b) => (a.id < b.id ? -1 : 1));
  let base: OkrGoal[] = visibleGoals(quarter?.goals || []); // 보관 행 제외(2026-10-25) — 나머지 행은 같은 번호로 달 판정과 맞물린다
  if (!quarter?.goals.length) {
    const byNo = new Map<number, OkrGoal>();
    for (const m of months) for (const g of visibleGoals(commonGoalsOf(m.goals))) if (!byNo.has(g.no)) byNo.set(g.no, g);
    base = [...byNo.values()].sort((a, b) => a.no - b.no);
  }
  const rollups = new Map(months.map((m) => [m.id, monthlyRollup(m, monthReports[m.id] || [], quarter, weekReportsByMonth[m.id] || [])]));
  return {
    months: months.map((m) => ({ id: m.id, month: m.month, actionTeams: (rollups.get(m.id) || []).reduce((n, r) => n + r.actionTeams.length, 0) })),
    rows: base.map((g) => {
      const rowOf = (mid: string) => (rollups.get(mid) || []).find((x) => x.no === g.no);
      const byMonth: Record<string, OkrRolledJudgment> = Object.fromEntries(months.map((m) => [m.id, rowOf(m.id)?.cs || emptyRolled()]));
      const byTeam = Object.fromEntries(OKR_TEAMS.map((t) => {
        const cells: Record<string, OkrJudgedCell> = Object.fromEntries(months.map((m) => [m.id, rowOf(m.id)?.dots[t] || emptyCell()]));
        return [t, { byMonth: cells, quarter: lastOfJudgments(months.map((m) => cells[m.id].judgment)) }];
      })) as OkrQuarterRollup["rows"][number]["byTeam"];
      return {
        no: g.no, pillar: g.pillar, bottleneck: bottleneckText(g.bottleneck), objective: g.objective, criteria: g.criteria,
        byMonth, quarter: quarterCsJudgment(months.map((m) => byMonth[m.id].judgment), quarter?.feedback?.[String(g.no)]?.judgment), byTeam,
      };
    }),
  };
}

// ── 2026-11-01 파트 분기: 파트 탭 [4분기] 화면용 순수 함수 ──
export type PartQuarterRow = {
  no: number;
  goal: OkrQuarterRollup["rows"][number]; // 분기 goal(병목·목표·달성기준) 그대로 — rollup 행
  byMonth: Array<{ monthId: string; label: string; judgment: OkrJudgment | ""; confirmed: boolean }>; // confirmed: ● 사람 확정(set) / ○ 제안·없음
  auto: OkrJudgment | ""; // 마지막 기록 달의 파트 판정(byTeam[team].quarter)
  judgment: OkrJudgment | ""; // 화면에 보일 분기 판정 = 사람 값 우선, 없으면 auto
  manual: boolean; // judgment 가 사람이 고른 값인가
  row: OkrResultRow | null; // 파트 분기 기록(cycle_id 분기 id) 행, 없으면 null
};
/**
 * 2026-11-01 파트 분기 — 분기 goals 번호마다 한 줄: 세 달 파트 판정(●/○)·자동 분기 판정·사람 값 우선 판정·분기 기록 행.
 * quarterReport = 그 파트의 분기 okr_reports 행(cycle_id 분기 id, team, member ''), 없으면 null.
 */
export function partQuarterRows(rollup: OkrQuarterRollup, team: OkrTeam, quarterReport: OkrReport | null): PartQuarterRow[] {
  return rollup.rows.map((r) => {
    const t = r.byTeam[team];
    const byMonth = rollup.months.map((m) => {
      const c = t?.byMonth[m.id];
      return { monthId: m.id, label: `${m.month}월`, judgment: (c?.judgment || "") as OkrJudgment | "", confirmed: c?.source === "set" };
    });
    const auto = t?.quarter || "";
    const row = quarterReport?.rows.find((x) => x.no === r.no) || null;
    const set = normalizeJudgment(row?.judgment || "");
    return { no: r.no, goal: r, byMonth, auto, judgment: set || auto, manual: !!set, row };
  });
}
export type PartQuarterMonthStat = { monthId: string; label: string; judged: number; total: number; warn: number; hasReport: boolean };
/**
 * 2026-11-01 파트 분기 — 달별 진행 띠: 그 달 파트 월 종합 판정이 있는 목표 수(judged, ●○ 모두)/목표 수(total),
 * 미흡·미착수(isAlert) 수(warn), 판정이 하나라도 있으면 hasReport.
 */
export function partQuarterMonthStrip(rollup: OkrQuarterRollup, team: OkrTeam): PartQuarterMonthStat[] {
  return rollup.months.map((m) => {
    const js = rollup.rows.map((r) => normalizeJudgment(r.byTeam[team]?.byMonth[m.id]?.judgment || ""));
    const judged = js.filter(Boolean).length;
    return { monthId: m.id, label: `${m.month}월`, judged, total: rollup.rows.length, warn: js.filter((j) => isAlert(j)).length, hasReport: judged > 0 };
  });
}

// ── 목표·달성기준 덮어쓰기 사슬(새 구조): 월 공통(effectiveGoals) → 파트 종합(월 report header.goals) → 파트원 주차(header.goals) ──
// 4차(2026-10-21) 층별 독립: 칸마다 field 별 표시(html.bottleneckSet·objectiveSet·criteriaSet)가 있으면 그 층의 글을 쓴다 — 빈 글이어도(비우면 빈 채 유지). 단 달성기준(criteria)은 7차부터 글이 있을 때만 덮는다(비우면 위 층).
// 표시가 없으면 위 층 글이 기본으로 보인다. 표시 없는 옛 칸(8월~10월 W3 데이터): objective·bottleneck 은 무시, criteria 는 글이 있을 때만 덮는다.
const isObjectiveSet = (g?: OkrGoal) => g?.html?.objectiveSet === "1";
const isBottleneckSet = (g?: OkrGoal) => g?.html?.bottleneckSet === "1";
const isCriteriaSet = (g?: OkrGoal) => g?.html?.criteriaSet === "1";
// 덮은 결과 goal에도 표시를 남긴다(다음 층이 같은 규칙으로 덮는다).
// keepEmptyCriteria(8차, 주차 화면): 표시(criteriaSet)가 있으면 빈 달성기준도 그 층 값 — 파트원이 지운 건 지운 채(사용자 "삭제하고 다시 들어가면 또 있어").
//   false(파트 종합 등 월 층): 달성기준은 글이 있을 때만 덮는다(비우면 위 층 = 통합집계 달성기준이 보임, 7차).
export function overlayGoals(base: OkrGoal[], over?: OkrGoal[], keepEmptyCriteria = false): OkrGoal[] {
  if (!over?.length) return base;
  return base.map((g) => {
    const o = over.find((x) => x.no === g.no);
    if (!o) return g;
    const html: NonNullable<OkrGoal["html"]> = { ...(g.html || {}) };
    let criteria = g.criteria;
    // 목표·병목현상은 표시가 있으면 빈 글도 그 층 값(비우면 빈 채 유지).
    if (o.criteria.trim() || (keepEmptyCriteria && isCriteriaSet(o))) {
      criteria = o.criteria;
      delete html.criteria;
      if (o.html?.criteria) html.criteria = o.html.criteria;
      if (isCriteriaSet(o)) html.criteriaSet = "1";
    }
    let objective = g.objective;
    if (isObjectiveSet(o)) {
      objective = o.objective;
      delete html.objective;
      if (o.html?.objective) html.objective = o.html.objective;
      html.objectiveSet = "1";
    }
    let bottleneck = g.bottleneck;
    if (isBottleneckSet(o)) {
      bottleneck = o.bottleneck;
      delete html.bottleneck;
      if (o.html?.bottleneck) html.bottleneck = o.html.bottleneck;
      html.bottleneckSet = "1";
    }
    return { ...g, bottleneck, objective, criteria, html: Object.keys(html).length ? html : undefined };
  });
}
// 덮어쓰기 칸 하나 고치기 — 같은 번호 칸이 있으면 그 칸에 field만 바꿔 얹는다(다른 field 의 글·표시는 그대로).
// 새 칸은 고친 field 만 채운다(다른 field 는 빈 글 + 표시 없음 → 위 층 글이 계속 기본으로 보인다).
// 4차: 빈 글도 표시와 함께 저장한다(비우면 빈 채 유지, 위 층으로 되돌아가지 않음). html 은 글자색(RichCell).
export function putGoalField(list: OkrGoal[] | undefined, shown: OkrGoal, field: "objective" | "criteria" | "bottleneck", text: string, html?: string): OkrGoal[] {
  const cur = list || [];
  const existing = cur.find((x) => x.no === shown.no);
  const cell: OkrGoal = existing ? { ...existing } : { no: shown.no, pillar: shown.pillar, bottleneck: "", objective: "", criteria: "" };
  const h: NonNullable<OkrGoal["html"]> = existing ? { ...(existing.html || {}) } : {};
  cell[field] = text;
  delete h[field];
  if (html) h[field] = html;
  if (field === "criteria") h.criteriaSet = "1"; else if (field === "objective") h.objectiveSet = "1"; else h.bottleneckSet = "1";
  cell.html = h;
  return [...cur.filter((x) => x.no !== shown.no), cell].sort((a, b) => a.no - b.no);
}
// 전주 목표 가져오기 — 같은 달 안의 전주일 때만, 전주 칸에 objectiveSet이 있던 번호만 표시와 함께 돌려준다(달이 바뀌면 월 목표가 바뀌므로 넘기지 않는다).
// 달성기준은 여기서 정하지 않는다: 호출부가 지금 loadPrevCriteria 규칙(빈 것 제외, 전부)으로 만든 칸에 이 목표를 같은 번호로 얹는다.
export function prevGoalsToCarry(prevEffective: OkrGoal[], sameMonth: boolean): OkrGoal[] {
  if (!sameMonth) return [];
  return prevEffective
    .filter((p) => isObjectiveSet(p) && p.objective.trim() !== "")
    .map((p) => ({ ...p, html: { ...(p.html?.objective ? { objective: p.html.objective } : {}), ...(p.html?.criteria ? { criteria: p.html.criteria } : {}), objectiveSet: "1" as const } }));
}

// 핵심방향 단계 보기 — 첫 줄은 머리글. 나머지 줄은 ", 월말" 같은 경계에서 잘라 주간/월말/분기 낱말로 단계를 고른다. 못 고른 조각은 rest.
// 단계는 늘 주간 → 월말 → 분기 순으로 돌려준다. 같은 단계가 두 번 나오면 두 번째부터는 rest.
const DIRECTION_STEPS = [
  { key: "week" as const, label: "주간 실행", re: /^주간/ },
  { key: "month" as const, label: "월말 확인", re: /^월말/ },
  { key: "quarter" as const, label: "분기 정리", re: /^분기/ },
];
export function directionSteps(text: string): { headline: string; steps: Array<{ key: "week" | "month" | "quarter"; label: string; text: string }>; rest: string[] } {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const steps: Array<{ key: "week" | "month" | "quarter"; label: string; text: string }> = [];
  const rest: string[] = [];
  for (const line of lines.slice(1)) {
    for (const raw of line.split(/[,，]\s*(?=주간|월말|분기)/)) {
      const piece = raw.trim().replace(/[,，]\s*$/, "");
      if (!piece) continue;
      const def = DIRECTION_STEPS.find((d) => d.re.test(piece));
      if (def && !steps.some((x) => x.key === def.key)) steps.push({ key: def.key, label: def.label, text: piece });
      else rest.push(piece);
    }
  }
  const order = (k: string) => DIRECTION_STEPS.findIndex((d) => d.key === k);
  steps.sort((a, b) => order(a.key) - order(b.key));
  return { headline: lines[0] || "", steps, rest };
}

// 여러 기간 기록 한 번에(분기 화면 주차 기록) — cycle_id=in.(…). 빈 목록이면 조회하지 않는다. 실패는 호출부로 던진다.
export async function getOkrReportsIn(cycleIds: string[]): Promise<OkrReport[]> {
  const ids = [...new Set(cycleIds.filter(Boolean))];
  if (!ids.length) return [];
  const list = encodeURIComponent(ids.map((id) => `"${id}"`).join(","));
  // 읽기 전용 집계(주차 판정·실적·제안)용 — header(목표 덮어쓰기·피드백 jsonb)는 이 경로에서 쓰지 않아 뺀다(조회 용량↓, 2026-10-24).
  // 그래서 돌려주는 report 의 header·goals·feedback 은 비어 있다 — 저장(upsert)에 쓰지 말 것.
  const rows = await selectAllRows<OkrReport>("okr_reports", `select=cycle_id,team,member,rows,updated_at,updated_by&cycle_id=in.(${list})&order=cycle_id.asc,team.asc,member.asc`);
  return rows.map(toReport);
}

// 주차의 저장 id(엑셀 내려받기 2026-10-28, docs/tasks/okr-excel-export-2026-10-28.md R1) — OkrHub weekIdFor 와 같은 규칙의 순수 함수.
// 보통은 연-월-W번호. 같은 시작 월요일의 주차 행이 다른 id 로 남아 있으면(셈법이 바뀌던 2026-10-01 전후) 그 행을 쓴다.
// 같은 기간 행이 여럿이면 정식 id → 결과가 적힌 쪽(resultIds = listOkrResultIndex) → 첫 행 순. OkrHub 는 이번에 바꾸지 않는다(추가만).
export function resolveWeekCycleId(year: number, month: number, weekNo: number, cycles: ReadonlyArray<Pick<OkrCycle, "id" | "kind" | "start_date">>, resultIds: ReadonlySet<string> = new Set()): string {
  const fresh = weekCycleId(year, month, weekNo);
  const wk = okrWeeksInMonth(year, month).find((x) => x.weekNo === weekNo);
  const same = wk ? cycles.filter((c) => c.kind === "week" && c.start_date === wk.start) : [];
  if (!same.length) return fresh;
  return (same.find((c) => c.id === fresh) || same.find((c) => resultIds.has(c.id)) || same[0]).id;
}
