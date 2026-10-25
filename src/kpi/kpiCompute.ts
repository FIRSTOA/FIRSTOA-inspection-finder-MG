/**
 * 홈 KPI 현황판 — 순수 집계(설계안 docs/tasks/home-kpi-dashboard.md 3절 "위젯 1개 = 집계 함수 1개").
 *
 * 원칙: 새로 세지 않는다. 조회 탭·주간현황판·순위표·홈 판이 이미 쓰는 함수를 그대로 부른다.
 *   점검·AS = workCount.countField · 확장성 = workCount.countExpansion · 물류·재계약·불만·초과조정·미수 = formCount.countForms(양식 원본 표, 2026-10-24)
 *   담당자 변경 = formCount.countForms(contact_change, 2026-10-24 3단계) · 교체양식 = countableEvents(원본 표가 없는 복사 전용 양식 — 활동 기록이 원본)
 *   미처리 = homeUnhandled.mergeUnhandled/countUnhandledTabs · OKR = okr.achievementRate/judgmentCounts · 블로그 = blogSheet.countBlog
 *   미수 = misuVisit.effectiveMisuVisits → formCount · 접수 처리율 = deptReception.weekCompletionRate · 분기 진행 = workinProgress(홈·워킨맵 식)
 *   영업일 = planDate.isBusinessDay(주말·한국 공휴일) + 설정 holidays
 * 기존 단일 함수가 없던 것(초과조정 방문·재계약 확인 지남·재계약 갱신율·불만 완료율·키맨 인사율·칭찬·오버홀·방문 업체)만 여기서 정의하고,
 * 팀·재전송·팀장 규칙은 workCount 의 규칙(지역 칸 → 출처 괄호 → 작성자 팀, 팀장 제외, 같은 날 같은 업체 1건)을 따른다.
 *
 * 범위: 모든 셈은 scope { team?, author? } 를 받는다 → CS 전체 → 팀 → 개인 같은 함수(kpiProgress).
 * "0"과 "못 읽음"은 구분한다: 원본이 없으면(facts 에 없음) null, 기록이 없으면 0. 못 읽은 이유는 kpiData.ts 가 위젯별 상태로 넘긴다.
 */
import { calendarRange } from "../periodRange";
import { weekRange } from "../visits";
import { isBusinessDay } from "../planDate";
import { logisticsKindForEvent, OPERATIONS_TEAMS, type ActivityEvent } from "../operations";
import {
  countExpansion, countField, kstDayOf,
  type ExpansionKind, type ExpansionRow, type FieldKind, type FieldRow,
} from "../workCount";
import { teamWorkinProgress, type WorkinPlaceLite } from "../workinProgress";
import { countUnhandledTabs, rowsForTab, UNHANDLED_TABS, type UnhandledRow, type UnhandledTab } from "../homeUnhandled";
import {
  OKR_TEAMS, achievementRate, emptyResultRow, findReport, isAlert, isLegacyMonthId, judgmentCounts, monthScreenGoals, normalizeJudgment, resultRowFor, worstOfJudgments,
  type OkrCycle, type OkrGoal, type OkrJudgment, type OkrReport, type OkrResultRow,
} from "../okr";
import { blogTeamOf, countBlog, type BlogRow } from "../blogSheet";
import { countOverhaul, overhaulDeptTeam, type OverhaulCount, type OverhaulRow } from "../overhaulSheet";
import { type MisuVisit } from "../misuVisit";
import { countableForms, countForms, fieldLogisticsRows, latestByVendor, misuFormRows, type FormRow } from "../formCount";
import { weekCompletionRate } from "../deptReception";
import { isYmd } from "../recontractSchedule";
import { KPI_BY_ID, KPI_DEFS, type KpiId, type KpiPeriodKey, type KpiScopeKind, type KpiTarget, type KpiTargetBasis } from "./kpiDefs";

/* ───────────── 기간 ───────────── */

export type KpiRange = { from: string; to: string };
export type KpiRanges = {
  today: string;
  todayRange: KpiRange;
  /** 이번 주 월~일(주간현황판·블로그 칸과 같은 weekRange, Q4) */
  week: KpiRange;
  /** 지난주 같은 요일까지(월~같은 요일) — "지난주 대비"를 같은 날수로 비교 */
  prevWeekToDate: KpiRange;
  /** 이번 달 1일~말일(조회 탭 달력 기준 calendarRange) */
  month: KpiRange;
  /** 지난달 1일~같은 날(말일 넘으면 말일) */
  prevMonthToDate: KpiRange;
  quarter: KpiRange;
  quarterNo: number;
  /** 경과율(%) — 목표 대비 상태색(뒤짐·절반 미만)에 쓴다(달력 날 기준) */
  weekElapsedRate: number; monthElapsedRate: number; quarterElapsedRate: number;
  /** 최근 8주(오래된 것부터, 마지막 = 이번 주) */
  weeks8: Array<KpiRange & { label: string }>;
  /** 오늘 기준 최근 7일(오늘 포함) */
  last7: KpiRange;
};

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
export function shiftYmd(ymd: string, days: number): string { return new Date(utc(ymd) + days * 86_400_000).toISOString().slice(0, 10); }
export function dayDiff(from: string, to: string): number { return Math.round((utc(to) - utc(from)) / 86_400_000); }
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const elapsedRate = (r: KpiRange, today: string) => Math.max(0, Math.min(100, Math.round(((dayDiff(r.from, today) + 1) / (dayDiff(r.from, r.to) + 1)) * 100)));

/** today = kstDate() 값(YYYY-MM-DD). new Date().toISOString() 금지(아침 9시 전 날짜 어긋남) */
export function kpiRanges(today: string): KpiRanges {
  const w = weekRange(today);
  const week = { from: w.start, to: w.end };
  const prevFrom = shiftYmd(week.from, -7);
  const prevWeekToDate = { from: prevFrom, to: shiftYmd(prevFrom, dayDiff(week.from, today)) };
  const month = calendarRange("month", today);
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const prevMonthToDate = { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(Math.min(d, lastDayOf(py, pm)))}` };
  const quarterNo = Math.ceil(m / 3);
  const qEndMonth = quarterNo * 3;
  const quarter = { from: `${y}-${pad(qEndMonth - 2)}-01`, to: `${y}-${pad(qEndMonth)}-${pad(lastDayOf(y, qEndMonth))}` };
  const weeks8 = Array.from({ length: 8 }, (_, i) => {
    const r = weekRange(shiftYmd(week.from, -7 * (7 - i)));
    return { from: r.start, to: r.end, label: `${Number(r.start.slice(5, 7))}/${Number(r.start.slice(8, 10))}` };
  });
  return {
    today, todayRange: { from: today, to: today }, week, prevWeekToDate, month, prevMonthToDate, quarter, quarterNo,
    weekElapsedRate: elapsedRate(week, today), monthElapsedRate: elapsedRate(month, today), quarterElapsedRate: elapsedRate(quarter, today),
    weeks8, last7: { from: shiftYmd(today, -6), to: today },
  };
}

export function rangeOfPeriod(r: KpiRanges, p: KpiPeriodKey): KpiRange {
  return p === "today" ? r.todayRange : p === "week" ? r.week : p === "month" ? r.month : r.quarter;
}

/** 로더가 한 번에 읽을 가장 이른 날짜(분기 시작·전주·전월 비교·8주 추세까지 덮는다) */
export function kpiLoadFrom(r: KpiRanges): string {
  return [r.quarter.from, r.prevWeekToDate.from, r.prevMonthToDate.from, r.weeks8[0].from].sort()[0];
}

/** 영업일 수(양 끝 포함) — 주말·한국 공휴일(planDate.KR_HOLIDAYS)·설정 holidays 제외 */
export function bizDays(from: string, to: string, holidays: readonly string[] = []): number {
  if (!from || !to || from > to) return 0;
  const extra = new Set(holidays);
  let n = 0;
  for (let d = from; d <= to; d = shiftYmd(d, 1)) if (isBusinessDay(d) && !extra.has(d)) n += 1;
  return n;
}

/* ───────────── 결과 모양(위젯 1개) ───────────── */

export type KpiTeamValue = { team: string; value: number | null; target: number | null; rate: number | null; numerator?: number; denominator?: number };
export type KpiTrendPoint = KpiRange & { label: string; value: number };
export type KpiValue = {
  id: KpiId;
  unit: string;
  /** null = 셀 수 없음(분모 0 등). 0 과 다르다 */
  value: number | null;
  numerator?: number;
  denominator?: number;
  target: number | null;
  /** 목표 대비 %(목표 0 인 '없어야 정상' 지표는 null) */
  targetRate: number | null;
  prev: number | null;
  delta: number | null;
  /** 전주(전월) 대비 % — 이전 값이 0 이면 null */
  deltaRate: number | null;
  byTeam: KpiTeamValue[];
  trend: KpiTrendPoint[];
  /** 지표별 덧붙임 숫자(2차 경고·글자 확인일·미흡·미착수 등) */
  extra: Record<string, number>;
  /** 기간 안 기록이 하나도 없음("기록 없음" 표시) */
  empty: boolean;
  range: KpiRange | null;
};

export function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

function finish(id: KpiId, v: Partial<KpiValue> & { value: number | null }): KpiValue {
  const prev = v.prev ?? null;
  const delta = prev === null || v.value === null ? null : v.value - prev;
  const target = v.target ?? null;
  return {
    id, unit: KPI_BY_ID[id].unit, value: v.value, numerator: v.numerator, denominator: v.denominator,
    target, targetRate: v.targetRate !== undefined ? v.targetRate : target && v.value !== null ? pct(v.value, target) : null,
    prev, delta, deltaRate: delta === null || !prev ? null : Math.round((delta / prev) * 100),
    byTeam: v.byTeam || [], trend: v.trend || [], extra: v.extra || {}, empty: v.empty ?? false, range: v.range ?? null,
  };
}

export const KPI_TEAMS = OPERATIONS_TEAMS as readonly string[]; // A~E

/** 상태색(설계안 4-1): 달성 ok · 경과율보다 뒤짐 warn · 경과율의 절반 미만 bad. 작을수록 좋은 지표는 목표(0) 이하 = ok */
export type KpiTone = "ok" | "warn" | "bad" | "idle";
export function kpiTone(id: KpiId, value: number | null, rate: number | null, elapsed: number, target: number | null = 0): KpiTone {
  if (value === null) return "idle";
  if (KPI_BY_ID[id].better === "down") return value <= (target ?? 0) ? "ok" : "bad";
  if (rate === null) return "idle";
  if (rate >= 100 || rate >= elapsed) return "ok";
  return rate < elapsed / 2 ? "bad" : "warn";
}

/* ───────────── 원본 행(로더가 채운다) ───────────── */

/** title = cs_members.title(팀장/파트장/부파트장, 빈값 = 프로) — 오버홀(K33)만 직책자를 뺀다 */
export type RosterMember = { name: string; team: string; title?: string };

/**
 * cs_members 활성 행 → KPI 명단. 팀 판정은 작성자 명단(authors.ts bookOf)과 같은 규칙:
 * 겸직 표기("A·B")는 나눠 보고, "CSS" = E(CSS팀) — DB 에는 팀 값 "E" 가 없고 CSS 인원은 team="CSS" 다(2026-10-24 실측).
 * A~E 가 아닌 행(팀 칸 빈 파트장 등)은 인원·팀에서 빠지지만, 직책자면 team "" 로 남겨 titledNames(오버홀 직책자 제외)에 잡히게 한다.
 */
export function rosterFromMembers(members: ReadonlyArray<{ name: string; team: string; title?: string | null; active: boolean }>): RosterMember[] {
  const out: RosterMember[] = [];
  for (const m of members) {
    if (!m.active) continue;
    const title = String(m.title || "").trim();
    const team = String(m.team || "").split(/[·/,]/).map((t) => t.trim()).map((t) => (t === "CSS" ? "E" : t)).find((t) => KPI_TEAMS.includes(t)) || "";
    if (team || OVERHAUL_EXCLUDED_TITLES.has(title)) out.push({ name: m.name, team, title });
  }
  return out;
}
export type PraiseRow = { from_author: string; to_name: string; created_at: string };
export type CustomerPraiseRow = { author: string; created_at: string };
export type VisitLite = { workDate: string; author: string; vendor: string; visited: boolean };
export type OfficeLite = { work_date: string; author: string; values: Record<string, { count?: number; minutes?: number } | undefined> | null };
export type KeymanRow = { greeting_done: boolean | null; category: string | null };
export type ReceptionWeekRow = { status: string; receipt_date: string };
/**
 * 주 단위 OKR(2026-10-24 사용자 "프로들은 주만 쓴다"): 이번 주 id(weekCycleId)·그 달 주차 목록·그 달 화면 목표·그 달 주차 기록 전부.
 * goals = 주차가 속한 달의 monthScreenGoals(옛 달은 달 goals) — OKR 화면이 주차에 쓰는 목표와 같다.
 */
export type OkrWeekFacts = { id: string; weeks: Array<{ id: string; weekNo: number; label: string }>; goals: OkrGoal[]; reports: OkrReport[] };
export type OkrFacts = { cycle: OkrCycle | null; quarter: OkrCycle | null; reports: OkrReport[]; week?: OkrWeekFacts };
/** IT 학습 기록 한 행(itLogs 로더 결과) — date = KST YYYY-MM-DD */
export type ItLogLite = { author: string; date: string };

/** 원본 묶음 — 못 읽은 원본은 비워 둔다(그 KPI 는 null = 못 셈) */
export type KpiFacts = Partial<{
  roster: RosterMember[];
  field: FieldRow[];
  expansion: ExpansionRow[];
  /** loadWorkEvents 결과에 팀장 제외 + countableEvents 를 건 것(팀 현황과 같은 입구) — 이제 교체양식(K28)만 센다 */
  events: ActivityEvent[];
  workin: WorkinPlaceLite[];
  overage: FormRow[];
  recontract: FormRow[];
  bulman: FormRow[];
  misu: MisuVisit[];
  /** 물류 양식 표(logistics_records) — K24 원본(2026-10-24, 활동 기록 대신). 점검·AS 양식의 여분·마감·세팅은 field 의 구분 칸에서 */
  logistics: FormRow[];
  /** 담당자·주소 변경 표(contact_changes) — K27 원본(2026-10-24 3단계). 팀 = CS 작성자만(formCount.csOnlyTeam) */
  contact: FormRow[];
  unhandled: UnhandledRow[];
  receptionWeek: ReceptionWeekRow[];
  keyman: KeymanRow[];
  okr: OkrFacts;
  blog: BlogRow[];
  praise: PraiseRow[];
  customerPraise: CustomerPraiseRow[];
  visits: VisitLite[];
  office: OfficeLite[];
  itQuiz: ItLogLite[];
  itPractice: ItLogLite[];
  /** 오버홀 기록 시트(overhaulSheet.loadOverhaulRows) — K33 원본(2026-10-24, 사무실 일지 대신) */
  overhaul: OverhaulRow[];
}>;

/* ───────────── 공통: 양식 표(초과조정·재계약·불만·물류·미수) 행 정리 — formCount.ts 로 옮김(2026-10-24), 여기서는 다시 내보내기만 ───────────── */
export { looseYmd, sourceParenTeam, toFormRows, latestByVendor, type FormRaw, type FormRow } from "../formCount";

export type KpiScope = { team?: string; author?: string };
type FormScope = Partial<KpiRange> & KpiScope;
const inScope = (r: FormRow, s: FormScope) => !r.hidden && !r.manager
  && (!s.team || s.team === "전체" || r.team === s.team) && (!s.author || r.author === s.author)
  && (!s.from || r.day >= s.from) && (!s.to || r.day <= s.to);

const text = (r: FormRow, key: string) => String(r.raw[key] ?? "").trim();

/* ───────────── 초과조정 · 재계약 · 불만 ───────────── */

export const OVERAGE_COLUMNS = ["id", "_hidden", "created_at", "방문일", "작성자", "지역", "_출처", "업체명", "_업체명", "고객반응", "진행상태"];
export const RECONTRACT_COLUMNS = ["id", "_hidden", "created_at", "날짜", "작성자", "지역", "_출처", "업체명", "_업체명", "갱신상태", "최종상태", "다음확인일"];
export const BULMAN_COLUMNS = ["id", "_hidden", "created_at", "날짜", "작성자", "지역", "_출처", "업체명", "_업체명", "최종상태", "접수/처리"];

/** 초과 제안 방문 세는 대상 — 오발송 삭제·팀장 제외, 같은 사람·같은 방문일·같은 업체 = 1건(재전송). 규칙 = formCount.countableForms("overage") */
export function countableOverage(rows: FormRow[], s: FormScope = {}): FormRow[] { return countableForms("overage", rows, s); }
export function countOverageVisits(rows: FormRow[], s: FormScope = {}): number { return countForms("overage", rows, s.from, s.to, { team: s.team, author: s.author }); }
const overageFilled = (x: FormRow) => !!text(x, "고객반응") && !!text(x, "진행상태");

const RECONTRACT_CLOSED = new Set(["갱신완료", "종료"]);
const isRenewed = (r: FormRow) => text(r, "갱신상태") === "갱신완료" || text(r, "최종상태") === "갱신완료";

/**
 * 재계약 확인 지남 — 업체별 마지막 기록(숨김 제외, 팀장 기록 포함: 밀린 건이라 누가 적었든 남아 있다)이
 * 끝나지 않았고(최종상태 갱신완료·종료 아님, 갱신상태 갱신완료 아님) 다음확인일(YYYY-MM-DD) < 오늘.
 * 다음확인일이 10-23 전 글자값("차주 중")이면 지남 판정 못 함 → textDates 로 따로 센다.
 */
export function recontractOverdue(rows: FormRow[], today: string, team?: string): { count: number; textDates: number; list: FormRow[] } {
  const latest = latestByVendor(rows.filter((r) => !r.hidden));
  const open = latest.filter((r) => !RECONTRACT_CLOSED.has(text(r, "최종상태")) && !isRenewed(r) && (!team || team === "전체" || r.team === team));
  const list = open.filter((r) => { const d = text(r, "다음확인일"); return isYmd(d) && d < today; });
  const textDates = open.filter((r) => { const d = text(r, "다음확인일"); return !!d && !isYmd(d); }).length;
  return { count: list.length, textDates, list };
}

/** 재계약 갱신 완료율 — 기간 안 기록 업체 중 (그 기간) 마지막 기록이 갱신완료인 곳 / 기록 업체. 팀장 제외 */
export function recontractRenewal(rows: FormRow[], s: FormScope): { done: number; total: number } {
  const latest = latestByVendor(rows.filter((x) => inScope(x, s)));
  return { done: latest.filter(isRenewed).length, total: latest.length };
}

const isComplaintDone = (r: FormRow) => /완료/.test(text(r, "최종상태") || text(r, "접수/처리"));
/** 불만 처리 완료율 — 기간 안 기록 업체 중 마지막 기록 최종상태 완료 / 기록 업체. 팀장 제외 */
export function complaintCompletion(rows: FormRow[], s: FormScope): { done: number; total: number } {
  const latest = latestByVendor(rows.filter((x) => inScope(x, s)));
  return { done: latest.filter(isComplaintDone).length, total: latest.length };
}

/* ───────────── 활동 기록(팀 현황·순위표 입구) ───────────── */

/** 팀 현황 '물류' 칸 = 물류 중 여분·마감 제외(OperationsDashboard matchesFilter logistics_main 과 같은 판정) */
export function isMainLogistics(e: ActivityEvent): boolean {
  return e.category === "logistics" && !["여분", "마감"].includes(logisticsKindForEvent(e));
}
const eventsIn = (events: ActivityEvent[], s: KpiScope, r: KpiRange, pick: (e: ActivityEvent) => boolean) =>
  events.filter((e) => pick(e) && e.activityDate >= r.from && e.activityDate <= r.to && (!s.team || e.team === s.team) && (!s.author || e.author === s.author));

/* ───────────── KPI 하나 · 범위 하나 → 실적(분자/분모) ───────────── */

export type KpiCount = { n: number; d?: number };
export type KpiCtx = { today: string; teamOf: (author: string) => string };

/**
 * 모든 KPI 의 셈 입구. scope = {} 이면 CS 전체, {team} 이면 팀, {author} 이면 개인(팀도 같이 줄 수 있음).
 * 원본이 없으면 null(못 셈) — 기록 0 과 다르다. 열린 건 지표(K12·K16·K17)는 range 를 보지 않는다.
 */
export function kpiCount(id: KpiId, f: KpiFacts, s: KpiScope, r: KpiRange, ctx: KpiCtx): KpiCount | null {
  const isMgr = (a: string) => ctx.teamOf(a) === "팀장";
  const teamOk = (team: string) => !s.team || team === s.team;
  const field = (kind: FieldKind) => (f.field ? { n: countField(f.field, { kind, team: s.team, author: s.author, from: r.from, to: r.to }) } : null);
  const exp = (kind: ExpansionKind) => (f.expansion ? { n: countExpansion(f.expansion, { kind, team: s.team, author: s.author, from: r.from, to: r.to }) } : null);
  const ev = (pick: (e: ActivityEvent) => boolean) => (f.events ? { n: eventsIn(f.events, s, r, pick).length } : null);
  switch (id) {
    case "K1": return field("inspection");
    case "K3": return field("as");
    case "K7": return exp("expansion_it");
    case "K8": return exp("expansion_copier");
    // 물류·재계약·불만 = 양식 원본 표(formCount.countForms, 2026-10-24) — 팀 현황·순위표·조회 탭과 같은 함수. 재계약·불만은 업체 수
    case "K24": return f.logistics && f.field ? { n: countForms("logistics", [...f.logistics, ...fieldLogisticsRows(f.field)], r.from, r.to, { part: "main", team: s.team, author: s.author }) } : null;
    case "K25": return f.recontract ? { n: countForms("recontract", f.recontract, r.from, r.to, { team: s.team, author: s.author }) } : null;
    case "K26": return f.bulman ? { n: countForms("complaint", f.bulman, r.from, r.to, { team: s.team, author: s.author }) } : null;
    case "K27": return f.contact ? { n: countForms("contact_change", f.contact, r.from, r.to, { team: s.team, author: s.author }) } : null;
    case "K28": return ev((e) => e.category === "replacement");
    case "K2": {
      if (!f.workin || s.author) return null;
      const teams = teamWorkinProgress(f.workin).filter((t) => teamOk(t.team));
      return { n: teams.reduce((a, t) => a + t.done, 0), d: teams.reduce((a, t) => a + t.total, 0) };
    }
    case "K4": {
      if (!f.visits) return null;
      const keys = new Set(f.visits.filter((v) => v.visited && v.workDate >= r.from && v.workDate <= r.to && !isMgr(v.author)
        && teamOk(ctx.teamOf(v.author)) && (!s.author || v.author === s.author)).map((v) => `${v.workDate}|${v.vendor}`));
      return { n: keys.size };
    }
    case "K33": {
      if (!f.overhaul) return null;
      // 원본 = 오버홀 기록 구글 시트(2026-10-24). 오버홀만 직책자(팀장·파트장·부파트장) 제외 — 다른 KPI 는 팀장만 제외(기존 그대로)
      return { n: countOverhaul(overhaulRowsIn(f.overhaul, f.roster, ctx.teamOf, s), r.from, r.to).points };
    }
    case "K10": return f.overage ? { n: countOverageVisits(f.overage, { ...r, ...s }) } : null;
    case "K11": {
      if (!f.overage) return null;
      const list = countableOverage(f.overage, { ...r, ...s });
      return { n: list.filter(overageFilled).length, d: list.length };
    }
    case "K12": return f.recontract && !s.author ? { n: recontractOverdue(f.recontract, ctx.today, s.team).count } : null;
    case "K13": { if (!f.recontract) return null; const x = recontractRenewal(f.recontract, { ...r, ...s }); return { n: x.done, d: x.total }; }
    case "K15": { if (!f.bulman) return null; const x = complaintCompletion(f.bulman, { ...r, ...s }); return { n: x.done, d: x.total }; }
    // 미수 방문 = misu_visits(보완 기록은 원 기록 1건) → formCount 규칙(같은 날 같은 사람 같은 업체 1건·팀장 제외)
    case "K14": return f.misu ? { n: countForms("misu", misuFormRows(f.misu, ctx.teamOf), r.from, r.to, { team: s.team, author: s.author }) } : null;
    case "K16": case "K17": {
      if (!f.unhandled || s.author) return null;
      const src = id === "K16" ? "reception" : "ticket";
      const list = f.unhandled.filter((x) => x.source === src);
      return { n: s.team ? rowsForTab(list, s.team as UnhandledTab).length : list.length };
    }
    case "K29": {
      if (!f.receptionWeek || s.team || s.author) return null;
      const w = weekCompletionRate(f.receptionWeek, ctx.today);
      return { n: w.done, d: w.total };
    }
    case "K18": {
      if (!f.keyman || s.team || s.author) return null;
      const need = f.keyman.filter((k) => KEYMAN_GREET_CATEGORY.test(k.category || ""));
      return { n: need.filter((k) => k.greeting_done).length, d: need.length };
    }
    case "K19": {
      if (!f.okr) return null;
      // 주 범위(7일 이하)면 이번 주 주차 기록, 아니면 이번 달 파트 종합(기존)
      const w = f.okr.week;
      const weekMode = dayDiff(r.from, r.to) <= 6;
      if (weekMode && !w) return null;
      if (s.author) {
        // 개인 = 그 주 그 사람 okr_reports member 행의 판정(주 단위만 — 달은 파트 종합뿐)
        if (!weekMode || !w) return null;
        const mine = okrWeekMemberRows(w.goals, w.reports, w.id, s.author, s.team);
        return { n: mine.filter((x) => ["완료", "해당없음"].includes(normalizeJudgment(x.judgment))).length, d: mine.filter((x) => normalizeJudgment(x.judgment)).length };
      }
      const rows = OKR_TEAMS.filter((t) => teamOk(t)).flatMap((t) => (weekMode && w ? okrWeekTeamRows(w.goals, w.reports, w.id, t) : okrTeamRows(f.okr!.cycle, f.okr!.quarter, f.okr!.reports, t)));
      return { n: rows.filter((x) => ["완료", "해당없음"].includes(normalizeJudgment(x.judgment))).length, d: rows.filter((x) => normalizeJudgment(x.judgment)).length };
    }
    case "K20": {
      if (!f.blog) return null;
      const c = countBlog(f.blog, { from: r.from, to: r.to, person: s.author });
      if (!s.team) return { n: c.count };
      if (!f.roster) return null;
      const memberTeam = new Map(f.roster.map((m) => [m.name, m.team]));
      return { n: c.byPerson.filter((p) => blogTeamOf(p, memberTeam) === s.team).reduce((a, p) => a + p.count, 0) };
    }
    case "K30": case "K31": {
      if (!f.praise) return null;
      const who = (p: PraiseRow) => String(id === "K30" ? p.to_name : p.from_author).trim();
      return { n: f.praise.filter((p) => { const d = kstDayOf(p.created_at); const w = who(p); return d >= r.from && d <= r.to && !isMgr(w) && teamOk(ctx.teamOf(w)) && (!s.author || w === s.author); }).length };
    }
    case "K32": {
      if (!f.customerPraise) return null;
      return { n: f.customerPraise.filter((p) => { const d = kstDayOf(p.created_at); return d >= r.from && d <= r.to && !isMgr(p.author) && teamOk(ctx.teamOf(p.author)) && (!s.author || p.author === s.author); }).length };
    }
    case "K21": case "K34": {
      const list = id === "K21" ? f.itPractice : f.itQuiz;
      if (!list) return null; // 표 없음·못 읽음 = null(0 아님)
      return { n: list.filter((x) => { const a = String(x.author || "").trim(); return x.date >= r.from && x.date <= r.to && !!a && !isMgr(a) && teamOk(ctx.teamOf(a)) && (!s.author || a === s.author); }).length };
    }
  }
}

/* ───────────── 목표(인당 × 인원) ───────────── */

export type KpiTargetCtx = { range: KpiRange; period: KpiPeriodKey; today: string; scope: KpiScopeKind; headcount: number; teamCount: number; holidays: readonly string[] };

/**
 * 범위 하나의 목표. full = 기간 전체, toDate = 오늘까지(영업일 비율). 목표 없는 지표는 null.
 * 비율 지표(ratio·workin)는 목표가 '분모'라 여기서 내지 않는다(kpiProgress 가 d 를 쓴다), zero 는 0.
 */
export function kpiTargetFor(id: KpiId, t: KpiTarget | undefined, c: KpiTargetCtx): { full: number | null; toDate: number | null } {
  const basis = KPI_BY_ID[id].targetBasis;
  if (basis === "zero") return { full: 0, toDate: 0 };
  if (!t || basis === "none" || basis === "ratio" || basis === "workin") return { full: null, toDate: null };
  const total = bizDays(c.range.from, c.range.to, c.holidays);
  const done = bizDays(c.range.from, c.range.to < c.today ? c.range.to : c.today, c.holidays);
  const share = total ? done / total : 0;
  if (basis === "perPersonWeek" && t.perPersonWeek !== undefined) {
    if (!c.headcount) return { full: null, toDate: null };
    const full = round1(t.perPersonWeek * c.headcount * total / 5);
    return { full, toDate: round1(full * share) };
  }
  if (basis === "perPersonBizDay" && t.perPersonBizDay !== undefined) {
    if (!c.headcount) return { full: null, toDate: null };
    return { full: round1(t.perPersonBizDay * c.headcount * total), toDate: round1(t.perPersonBizDay * c.headcount * done) };
  }
  if (basis === "perTeamMonth") {
    const months = c.period === "month" ? 1 : c.period === "quarter" ? 3 : 0;
    if (!months) return { full: null, toDate: null };
    let full: number | null = null;
    if (t.perPersonMonth !== undefined && c.headcount) full = t.perPersonMonth * c.headcount * months;
    else if (c.scope === "team" && t.perTeamMonth !== undefined) full = t.perTeamMonth * months;
    else if (c.scope === "all") full = (c.period === "month" ? t.monthTotal : t.quarterTotal) ?? (t.perTeamMonth !== undefined ? t.perTeamMonth * c.teamCount * months : null);
    return full === null ? { full, toDate: null } : { full, toDate: round1(full * share) };
  }
  return { full: null, toDate: null };
}

/* ───────────── CS 전체 → 팀 → 개인 진행 표 ───────────── */

export type KpiProgressRow = {
  scope: KpiScopeKind; key: string; label: string; team: string; headcount: number;
  /** 실적(비율 지표는 분자) */
  actual: number | null;
  /** 목표(기간 전체). 비율 지표는 분모 */
  target: number | null;
  /** 오늘까지 목표(영업일 비율) */
  targetToDate: number | null;
  rate: number | null;
  rateToDate: number | null;
  /** 남은 수량(목표 - 실적, 0 아래면 0) */
  remaining: number | null;
  /** 개인 줄 중 "그 외" — 팀 칸에는 들었지만 그 팀 명단 사람이 아닌 기록(명단 밖·팀장 아닌 미지정·다른 팀 사람이 이 팀 지역으로 쓴 것) */
  rest?: true;
};
/** 팀 칸 − 그 팀 명단 개인 합 = "그 외" 칩 이름 */
export const KPI_REST_LABEL = "그 외";

export type KpiSettingsLite = { targets: Partial<Record<KpiId, KpiTarget>>; holidays: readonly string[] };

/**
 * 오버홀 시트 행 중 KPI 로 세는 것(범위 적용, 기간은 countOverhaul 이 본다):
 * 팀 = 명단 팀(teamOf, A~E) → 없으면 부서명 끝 글자(강북A → A, CSS → E) · 외부인력·퇴사자·팀 모름·팀장·직책자 제외.
 */
export function overhaulRowsIn(rows: OverhaulRow[], roster: RosterMember[] | undefined, teamOf: (a: string) => string, s: KpiScope = {}): OverhaulRow[] {
  const titled = titledNames(roster);
  return rows.filter((o) => {
    const a = String(o.author || "").trim();
    if (!a || titled.has(a)) return false;
    const rosterTeam = teamOf(a);
    if (rosterTeam === "팀장") return false;
    const team = KPI_TEAMS.includes(rosterTeam) ? rosterTeam : overhaulDeptTeam(o.dept);
    if (!team) return false;
    return (!s.team || s.team === "전체" || team === s.team) && (!s.author || a === s.author);
  });
}

/** 오버홀 사람별 오버홀포인트·수리포인트(달성표 개인 칩 보조 글자 "수리 n점"용) — kpiCount K33 와 같은 거름 */
export function overhaulByPerson(rows: OverhaulRow[], roster: RosterMember[] | undefined, teamOf: (a: string) => string, r: KpiRange): OverhaulCount {
  return countOverhaul(overhaulRowsIn(rows, roster, teamOf), r.from, r.to);
}

/** 블로그 사람별 올해 누계(1/1 ~ 오늘) — 달성표 K20 개인 칩 "올해 누계 n". 셈 = countBlog 그대로 */
export function blogYearTotals(rows: BlogRow[], today: string): Map<string, number> {
  const c = countBlog(rows, { from: `${today.slice(0, 4)}-01-01`, to: today });
  return new Map(c.byPerson.map((p) => [p.name, p.count]));
}

/** 오버홀(K33) 집계·목표 인원에서 빼는 직책(cs_members.title) — 사용자 2026-10-24 */
export const OVERHAUL_EXCLUDED_TITLES: ReadonlySet<string> = new Set(["팀장", "파트장", "부파트장"]);
/** 명단에서 직책자 이름 */
export function titledNames(roster: RosterMember[] | undefined): Set<string> {
  return new Set((roster || []).filter((m) => OVERHAUL_EXCLUDED_TITLES.has(String(m.title || "").trim())).map((m) => m.name));
}
/** KPI 별 인원 명단 — 오버홀만 직책자 제외, 나머지는 명단 그대로(명단은 이미 팀장 팀 제외) */
export function rosterFor(id: KpiId, roster: RosterMember[] | undefined): RosterMember[] | undefined {
  if (id !== "K33" || !roster) return roster;
  return roster.filter((m) => !OVERHAUL_EXCLUDED_TITLES.has(String(m.title || "").trim()));
}

/** 명단(A~E 활성, 팀장 제외) → 팀별 인원 */
export function headcountByTeam(roster: RosterMember[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of roster || []) if (KPI_TEAMS.includes(m.team)) out[m.team] = (out[m.team] || 0) + 1;
  return out;
}

export function kpiProgress(id: KpiId, f: KpiFacts, opts: { ranges: KpiRanges; period: KpiPeriodKey; settings: KpiSettingsLite; teamOf: (a: string) => string }): KpiProgressRow[] {
  const def = KPI_BY_ID[id];
  const range = rangeOfPeriod(opts.ranges, opts.period);
  const ctx: KpiCtx = { today: opts.ranges.today, teamOf: opts.teamOf };
  const roster = rosterFor(id, f.roster);
  const heads = headcountByTeam(roster);
  const teams = def.teams === "A~D" ? [...OKR_TEAMS] as string[] : def.teams === "없음" ? [] : [...KPI_TEAMS];
  const total = teams.reduce((a, t) => a + (heads[t] || 0), 0);
  const ratio = def.targetBasis === "ratio" || def.targetBasis === "workin";
  const counts = new Map<string, KpiCount | null>();
  const make = (scope: KpiScopeKind, key: string, label: string, team: string, headcount: number, s: KpiScope): KpiProgressRow => {
    const c = kpiCount(id, f, s, range, ctx);
    counts.set(`${scope}|${key}`, c);
    const tg = ratio ? { full: c?.d ?? null, toDate: null } : kpiTargetFor(id, opts.settings.targets[id], { range, period: opts.period, today: ctx.today, scope, headcount, teamCount: teams.length, holidays: opts.settings.holidays });
    const actual = c ? c.n : null;
    const rate = actual === null || !tg.full ? null : pct(actual, tg.full);
    return {
      scope, key, label, team, headcount, actual, target: tg.full, targetToDate: tg.toDate, rate,
      rateToDate: actual === null || !tg.toDate ? null : pct(actual, tg.toDate),
      remaining: actual === null || tg.full === null ? null : Math.max(0, round1(tg.full - actual)),
    };
  };
  const rows: KpiProgressRow[] = [];
  if (def.scopes.includes("all")) rows.push(make("all", "전체", "CS 전체", "", total, {}));
  if (def.scopes.includes("team")) for (const t of teams) rows.push(make("team", t, t === "E" ? "CSS(E)" : `${t}팀`, t, heads[t] || 0, { team: t }));
  if (def.scopes.includes("person")) {
    // 개인 = 그 팀 칸과 같은 행 집합 안에서 그 사람 몫({team, author}). 예전엔 {author}만 줘서 팀 칸(지역 칸 판정)과 개인 칩(명단 작성자)이
    // 다른 행을 셌다 — 명단 밖·다른 팀 사람이 이 팀 지역으로 쓴 기록은 팀 칸에만, 이 팀 사람이 다른 지역으로 쓴 기록은 개인 칩에만 들어 합이 어긋났다(2026-10-25 C팀 19 vs 17).
    // 더할 수 있는 셈(분모 없음)이면 남는 몫을 "그 외" 줄로 보여 팀 칸 = 개인 합이 되게 한다.
    for (const t of teams) {
      const people = (roster || []).filter((x) => x.team === t).map((m) => make("person", m.name, m.name, t, 1, { team: t, author: m.name }));
      rows.push(...people);
      const teamCount = counts.get(`team|${t}`);
      if (!teamCount || teamCount.d !== undefined || people.some((p) => p.actual === null)) continue;
      const rest = round1(teamCount.n - people.reduce((a, p) => a + (p.actual ?? 0), 0));
      if (rest > 0) rows.push({ scope: "person", key: `${t}|${KPI_REST_LABEL}`, label: KPI_REST_LABEL, team: t, headcount: 0, actual: rest, target: null, targetToDate: null, rate: null, rateToDate: null, remaining: null, rest: true });
    }
  }
  return rows;
}

/* ───────────── 금일 현황 한 줄 ───────────── */

export type KpiTodayItem = { id: KpiId; label: string; unit: string; value: number | null };
/** 금일 현황(정의의 today 표시 순서) — 점검 n대·AS n건·물류·PC·복합기·미수 방문 … 값 null = 못 읽음 */
export function kpiTodayLine(f: KpiFacts, ranges: KpiRanges, teamOf: (a: string) => string, s: KpiScope = {}): KpiTodayItem[] {
  return KPI_DEFS.filter((d) => d.today).map((d) => ({ id: d.id, label: d.name, unit: d.unit, value: kpiCount(d.id, f, s, ranges.todayRange, { today: ranges.today, teamOf })?.n ?? null }));
}

/* ───────────── 분기 점검 진행 · 남은 영업일 · 하루 필요량(워킨맵 진행률 패널과 같은 꼴) ───────────── */

export type WorkinDeadline = { date: string; days: number; need3: number | null; need4: number | null; needHead: number | null };
export type WorkinPaceRow = {
  team: string; label: string; done: number; total: number; rate: number; remaining: number; headcount: number;
  toEnd: WorkinDeadline; toEarly: WorkinDeadline;
  /** 지금 속도 = 완료 / 분기 시작~오늘 영업일 / 인원(1인 하루) */
  pacePerPerson: number | null;
};

/** 워킨맵 dailyTarget 과 같은 글자("완료"·"기한 경과"·"7.5건/일") */
export function dailyNeedText(remaining: number, days: number, members: number): string {
  if (remaining <= 0) return "완료";
  if (days <= 0) return "기한 경과";
  return `${(remaining / days / members).toFixed(1)}건/일`;
}
/** 반올림 전 값 — 표시 반올림은 위젯(KpiWidgets.view rate)에서. 반올림하면 남은 양이 작을 때 0.04 → 0 = "목표 달성"으로 잘못 보였다(2026-10-23) */
const need = (remaining: number, days: number, members: number) => (remaining <= 0 ? 0 : days <= 0 || members <= 0 ? null : remaining / days / members);

/**
 * 워킨맵 진행률 패널 식 — 완료/대상·%(반올림), 남은 영업일 = max(오늘, 분기 시작) ~ 분기 말일 / 말일 10일 전(양 끝 포함),
 * 하루 필요량 = 남은 수 ÷ 남은 영업일 ÷ 인원(워킨맵은 3인·4인 두 칸, 여기는 명단 인원 칸도).
 * need3·need4·needHead·pacePerPerson 은 반올림 전 값이다(표시 자리수는 위젯이 정한다).
 */
export function workinPace(places: WorkinPlaceLite[], ranges: KpiRanges, roster: RosterMember[] | undefined, holidays: readonly string[] = []): WorkinPaceRow[] {
  const heads = headcountByTeam(roster);
  const q = ranges.quarter;
  const start = ranges.today > q.from ? ranges.today : q.from;
  const early = shiftYmd(q.to, -10);
  const toEndDays = bizDays(start, q.to, holidays), toEarlyDays = bizDays(start, early, holidays);
  const elapsed = bizDays(q.from, ranges.today < q.to ? ranges.today : q.to, holidays);
  const teams = teamWorkinProgress(places);
  const all = { team: "전체", done: teams.reduce((a, t) => a + t.done, 0), total: teams.reduce((a, t) => a + t.total, 0) };
  return [all, ...teams].map((t) => {
    const headcount = t.team === "전체" ? Object.values(heads).reduce((a, b) => a + b, 0) : heads[t.team] || 0;
    const remaining = Math.max(0, t.total - t.done);
    const dl = (date: string, days: number): WorkinDeadline => ({ date, days, need3: need(remaining, days, 3), need4: need(remaining, days, 4), needHead: need(remaining, days, headcount) });
    return {
      team: t.team, label: t.team === "전체" ? "CS 전체" : `${t.team}팀`, done: t.done, total: t.total,
      rate: t.total ? Math.round((t.done / t.total) * 100) : 0, remaining, headcount,
      toEnd: dl(q.to, toEndDays), toEarly: dl(early, toEarlyDays),
      pacePerPerson: elapsed && headcount ? t.done / elapsed / headcount : null,
    };
  });
}

/* ═════════════ 위젯용 KpiValue(1단계 8개 + 나머지) ═════════════ */

/* K1·K3 점검 대수·AS 건수 — workCount.countField */
export function fieldKpi(rows: FieldRow[], kind: FieldKind, r: KpiRanges, period: "week" | "month" = "week"): KpiValue {
  const cur = period === "week" ? r.week : r.month;
  const prev = period === "week" ? r.prevWeekToDate : r.prevMonthToDate;
  const value = countField(rows, { kind, from: cur.from, to: cur.to });
  return finish(kind === "inspection" ? "K1" : "K3", {
    value, prev: countField(rows, { kind, from: prev.from, to: prev.to }), range: cur, empty: value === 0,
    byTeam: KPI_TEAMS.map((team) => ({ team, value: countField(rows, { kind, team, from: cur.from, to: cur.to }), target: null, rate: null })),
    trend: r.weeks8.map((w) => ({ ...w, value: countField(rows, { kind, from: w.from, to: w.to }) })),
  });
}

/* K7·K8 확장성 — workCount.countExpansion */
export function expansionKpi(rows: ExpansionRow[], kind: ExpansionKind, r: KpiRanges, period: "week" | "month" = "month"): KpiValue {
  const cur = period === "week" ? r.week : r.month;
  const prev = period === "week" ? r.prevWeekToDate : r.prevMonthToDate;
  const value = countExpansion(rows, { kind, from: cur.from, to: cur.to });
  return finish(kind === "expansion_it" ? "K7" : "K8", {
    value, prev: countExpansion(rows, { kind, from: prev.from, to: prev.to }), range: cur, empty: value === 0,
    byTeam: KPI_TEAMS.map((team) => ({ team, value: countExpansion(rows, { kind, team, from: cur.from, to: cur.to }), target: null, rate: null })),
    trend: r.weeks8.map((w) => ({ ...w, value: countExpansion(rows, { kind, from: w.from, to: w.to }) })),
  });
}

/* K2 분기 점검 진행률 — workinProgress.teamWorkinProgress */
export function workinKpi(places: WorkinPlaceLite[], r: KpiRanges, target?: KpiTarget): KpiValue {
  const teams = teamWorkinProgress(places);
  const done = teams.reduce((n, t) => n + t.done, 0), total = teams.reduce((n, t) => n + t.total, 0);
  const value = pct(done, total);
  const goal = target?.value ?? 100;
  return finish("K2", {
    value, numerator: done, denominator: total, target: goal, targetRate: value === null ? null : pct(value, goal),
    range: r.quarter, empty: total === 0,
    byTeam: teams.map((t) => ({ team: t.team, value: pct(t.done, t.total), numerator: t.done, denominator: t.total, target: goal, rate: pct(t.done, t.total) })),
    extra: { elapsed: r.quarterElapsedRate, ahead: value === null ? 0 : value - r.quarterElapsedRate },
  });
}

/* K10 초과사용 제안 방문 — 파트당 월 목표 */
export function overageKpi(rows: FormRow[], r: KpiRanges, target?: KpiTarget): KpiValue {
  const t = target || {};
  const value = countOverageVisits(rows, r.month);
  const teamGoal = t.perTeamMonth ?? null;
  return finish("K10", {
    value, target: t.monthTotal ?? (teamGoal !== null ? teamGoal * KPI_TEAMS.length : null), prev: countOverageVisits(rows, r.prevMonthToDate), range: r.month, empty: value === 0,
    byTeam: KPI_TEAMS.map((team) => {
      const v = countOverageVisits(rows, { ...r.month, team });
      return { team, value: v, target: teamGoal, rate: teamGoal ? pct(v, teamGoal) : null };
    }),
    extra: {
      quarter: countOverageVisits(rows, r.quarter),
      quarterTarget: t.quarterTotal ?? (teamGoal !== null ? teamGoal * KPI_TEAMS.length * 3 : 0),
      teamsMet: teamGoal === null ? 0 : KPI_TEAMS.filter((team) => countOverageVisits(rows, { ...r.month, team }) >= teamGoal).length,
    },
  });
}

/* K11 초과 제안 기록 완결률 */
export function overageCompleteness(rows: FormRow[], r: KpiRanges, target?: KpiTarget): KpiValue {
  const list = countableOverage(rows, r.month);
  const n = list.filter(overageFilled).length;
  const goal = target?.value ?? 100;
  const value = pct(n, list.length);
  return finish("K11", {
    value, numerator: n, denominator: list.length, target: goal, targetRate: value === null ? null : pct(value, goal), range: r.month, empty: list.length === 0,
    byTeam: KPI_TEAMS.map((team) => {
      const l = countableOverage(rows, { ...r.month, team });
      const k = l.filter(overageFilled).length;
      return { team, value: pct(k, l.length), numerator: k, denominator: l.length, target: goal, rate: pct(k, l.length) };
    }),
  });
}

/* K12 재계약 확인 지남 */
export function recontractOverdueKpi(rows: FormRow[], r: KpiRanges, target?: KpiTarget): KpiValue {
  const all = recontractOverdue(rows, r.today);
  return finish("K12", {
    value: all.count, target: target?.value ?? 0, targetRate: null, range: null, empty: all.count === 0,
    byTeam: KPI_TEAMS.map((team) => ({ team, value: recontractOverdue(rows, r.today, team).count, target: target?.value ?? 0, rate: null })),
    extra: { textDates: all.textDates },
  });
}

/* K16·K17 미처리 — homeUnhandled.countUnhandledTabs */
export function unhandledKpis(rows: UnhandledRow[], target16?: KpiTarget, target17?: KpiTarget): { K16: KpiValue; K17: KpiValue; tabs: Record<UnhandledTab, number> } {
  const make = (id: "K16" | "K17", list: UnhandledRow[], target?: KpiTarget) => {
    const tabs = countUnhandledTabs(list);
    return finish(id, {
      value: tabs["전체"], target: target?.value ?? 0, targetRate: null, range: null, empty: tabs["전체"] === 0,
      byTeam: UNHANDLED_TABS.filter((t) => t !== "전체" && (id === "K16" || KPI_TEAMS.includes(t))).map((team) => ({ team, value: tabs[team], target: target?.value ?? 0, rate: null })),
      extra: { over7: list.filter((x) => x.ageDays >= 7).length, unassigned: list.filter((x) => !x.assignee).length },
    });
  };
  return {
    K16: make("K16", rows.filter((x) => x.source === "reception"), target16),
    K17: make("K17", rows.filter((x) => x.source === "ticket"), target17),
    tabs: countUnhandledTabs(rows),
  };
}

/* K18 키맨 변경 인사 — 홈 '키맨 변경 7일' 칸과 같은 조건 */
export const KEYMAN_GREET_CATEGORY = /담당|키맨|명의/;

/* K19 OKR 달성률 — OKR 월 통합집계 파트 카드와 같은 식 */
/** 그 달 화면 목표(새 구조 = monthScreenGoals, 옛 달 = 달 goals) × 파트 종합 행(member '') */
export function okrTeamRows(cycle: OkrCycle | null, quarter: OkrCycle | null, reports: OkrReport[], team: string): OkrResultRow[] {
  if (!cycle) return [];
  const goals = isLegacyMonthId(cycle.id) ? cycle.goals : monthScreenGoals(cycle, quarter).goals;
  const rep = findReport(reports.filter((x) => !x.member), team, "");
  return goals.map((g) => resultRowFor(rep, g.no));
}

export function okrKpi(okr: OkrFacts, r: KpiRanges, target?: KpiTarget): KpiValue {
  const goal = target?.value ?? 100;
  const per = OKR_TEAMS.map((team) => ({ team, rows: okrTeamRows(okr.cycle, okr.quarter, okr.reports, team) }));
  const all = per.flatMap((p) => p.rows);
  const value = achievementRate(all);
  const counts = judgmentCounts(all);
  const judged = all.filter((x) => normalizeJudgment(x.judgment)).length;
  return finish("K19", {
    value, numerator: counts["완료"] + counts["해당없음"], denominator: judged, target: goal, targetRate: value === null ? null : pct(value, goal),
    range: r.month, empty: judged === 0,
    byTeam: per.map((p) => {
      const rate = achievementRate(p.rows);
      const j = p.rows.filter((x) => normalizeJudgment(x.judgment)).length;
      return { team: p.team, value: rate, numerator: p.rows.filter((x) => ["완료", "해당없음"].includes(normalizeJudgment(x.judgment))).length, denominator: j, target: goal, rate };
    }),
    extra: { 미흡: counts["미흡"], 미착수: counts["미착수"], alerts: all.filter((x) => isAlert(x.judgment)).length, goals: all.length },
  });
}

/* K19 주 단위(2026-10-24) — 셈법은 achievementRate·judgmentCounts 그대로, 입력만 그 주 기록 */

/**
 * 한 파트의 그 주 판정 행: 목표마다 파트 종합(member '') 판정이 있으면 그것, 없으면 그 주 팀원 판정 중 가장 나쁜 것
 * (okr.lastJudgmentInMonth 가 주 하나에 쓰는 규칙과 같다 — worstOfJudgments). 판정이 하나도 없으면 빈 판정 행.
 */
export function okrWeekTeamRows(goals: OkrGoal[], reports: OkrReport[], weekId: string, team: string): OkrResultRow[] {
  const inWeek = reports.filter((r) => r.cycle_id === weekId && r.team === team);
  const summary = findReport(inWeek.filter((r) => !r.member), team, "");
  const members = inWeek.filter((r) => r.member);
  return goals.map((g) => {
    const own = resultRowFor(summary, g.no);
    if (normalizeJudgment(own.judgment)) return own;
    return { ...emptyResultRow(g.no), judgment: worstOfJudgments(members.map((m) => resultRowFor(m, g.no).judgment)) };
  });
}

export type OkrWeekResult = {
  /** A~D 전체 달성률(판정 없는 칸 분모 제외). 판정이 하나도 없으면 null(0% 아님) */
  pct: number | null;
  counts: Record<OkrJudgment, number>;
  /** 그 주 판정이 하나도 없는 파트 — "이번 주 OKR 미작성 n팀" */
  missingTeams: string[];
  byTeam: Array<{ team: string; pct: number | null }>;
};
/** OKR 범위(2026-10-24 사용자 "어디의 달성률인지 + 팀/개인 필터"): ALL = CS 4파트(A~D), 팀 하나, member = 그 사람 */
export type OkrScopeTeam = "ALL" | "A" | "B" | "C" | "D";
export type OkrScope = { team: OkrScopeTeam; member?: string };

/** 그 주 그 사람(member 행)의 목표별 판정 — 팀을 주면 그 팀 행만. 기록이 없으면 빈 판정 행 */
export function okrWeekMemberRows(goals: OkrGoal[], reports: OkrReport[], weekId: string, member: string, team?: string): OkrResultRow[] {
  const rep = reports.find((r) => r.cycle_id === weekId && r.member === member && (!team || team === "ALL" || r.team === team));
  return goals.map((g) => resultRowFor(rep, g.no));
}

/** 개인 고르기 목록 — 그 달 주차 기록(w.reports)에 member 행이 있는 사람(이름순). team ALL 이면 A~D 전부 */
export function okrWeekMembers(w: OkrWeekFacts, team: OkrScopeTeam = "ALL"): string[] {
  const names = new Set(w.reports.filter((r) => r.member && (team === "ALL" ? (OKR_TEAMS as readonly string[]).includes(r.team) : r.team === team)).map((r) => r.member));
  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

/** 머리 범위 글자 — "CS 4파트(A~D) · 이번 주" · "A파트 · 이번 주" · "홍길동(A) · 이번 주" */
export function okrScopeLabel(scope: OkrScope | undefined, period: "week" | "month"): string {
  const when = period === "week" ? "이번 주" : "이번 달";
  if (!scope || scope.team === "ALL") return scope?.member ? `${scope.member} · ${when}` : `CS 4파트(A~D) · ${when}`;
  return scope.member ? `${scope.member}(${scope.team}) · ${when}` : `${scope.team}파트 · ${when}`;
}

/**
 * 주 OKR 결과. scope 없음/ALL = A~D 전체(기존 그대로). 팀 = 그 파트만(파트 종합 → 없으면 팀원 중 가장 나쁜 것).
 * member = 그 사람 member 행 판정만(missingTeams 는 비고, 판정 없으면 pct null).
 */
export function okrWeekResult(w: OkrWeekFacts, weekId: string = w.id, scope?: OkrScope): OkrWeekResult {
  if (scope?.member) {
    const rows = okrWeekMemberRows(w.goals, w.reports, weekId, scope.member, scope.team);
    const team = w.reports.find((r) => r.cycle_id === weekId && r.member === scope.member)?.team ?? (scope.team === "ALL" ? "" : scope.team);
    return { pct: achievementRate(rows), counts: judgmentCounts(rows), missingTeams: [], byTeam: team ? [{ team, pct: achievementRate(rows) }] : [] };
  }
  const teams = !scope || scope.team === "ALL" ? [...OKR_TEAMS] as string[] : [scope.team];
  const per = teams.map((team) => ({ team, rows: okrWeekTeamRows(w.goals, w.reports, weekId, team) }));
  const all = per.flatMap((p) => p.rows);
  return {
    pct: achievementRate(all),
    counts: judgmentCounts(all),
    missingTeams: per.filter((p) => !p.rows.some((x) => normalizeJudgment(x.judgment))).map((p) => p.team),
    byTeam: per.map((p) => ({ team: p.team, pct: achievementRate(p.rows) })),
  };
}

/* ───────────── 달성표 행 상태(2026-10-24 홈 개편 ③) ───────────── */

/** done 달성 · onTrack 순항(실적/목표 ≥ 기간 경과 비율) · behind 부족 · none 목표 없음 · pending 원본 없음 */
export type KpiRowStatus = "done" | "onTrack" | "behind" | "none" | "pending";

/**
 * 행·칸 상태. actual null = 원본 없음(pending), 목표 없음 = none.
 *  · 작을수록 좋은 지표(zero): 실적 ≤ 목표 = done, 아니면 behind
 *  · 비율 지표(ratio): rate = 분자/분모 % 를 목표 %(goalPct) 와 비교 — 누적이 아니라 경과 비율은 안 본다. 목표 % 없거나 분모 0 이면 none
 *  · 그 밖(누적 — 인당 목표·워킨맵): 실적 ≥ 목표 = done(초록), 실적/목표 % ≥ ON_TRACK_MIN_PCT(50) = onTrack(파랑), 그 미만 behind(빨강).
 *    2026-10-25 사용자 결정 "50% 미만은 빨강, 그 이후는 파랑, 100% 는 초록" — 기간 경과율(페이스)은 판정에 안 쓴다(막대의 점선은 참고용).
 *    (그 전: 경과율 − 5포인트 기준 → 토요일에 75% 가 빨강이라 "기준이 뭐야" 지적)
 */
/** 순항 최소 달성률(%) — 이 이상이면 파랑, 미만이면 빨강 */
export const ON_TRACK_MIN_PCT = 50;
export function kpiRowStatus(
  o: { actual: number | null; target: number | null; elapsed: number | null; basis: KpiTargetBasis; better?: "up" | "down"; goalPct?: number | null },
): KpiRowStatus {
  if (o.actual === null) return "pending";
  if (o.basis === "zero" || o.better === "down") return o.actual <= (o.target ?? 0) ? "done" : "behind";
  if (o.basis === "ratio") {
    if (!o.goalPct || !o.target) return "none";
    return (pct(o.actual, o.target) ?? 0) >= o.goalPct ? "done" : "behind";
  }
  if (o.target === null || o.basis === "none") return "none";
  if (o.target <= 0 || o.actual >= o.target) return "done";
  return (o.actual / o.target) * 100 >= ON_TRACK_MIN_PCT ? "onTrack" : "behind";
}

/* ───────────── 인사말 줄 "내 이번 주" (Q9) ───────────── */

export function myWeek(field: FieldRow[], expansion: ExpansionRow[], author: string, r: KpiRanges): { inspection: number; as: number; expansionIt: number; expansionCopier: number } {
  const s = { author, from: r.week.from, to: r.week.to };
  return {
    inspection: countField(field, { ...s, kind: "inspection" }),
    as: countField(field, { ...s, kind: "as" }),
    expansionIt: countExpansion(expansion, { ...s, kind: "expansion_it" }),
    expansionCopier: countExpansion(expansion, { ...s, kind: "expansion_copier" }),
  };
}
