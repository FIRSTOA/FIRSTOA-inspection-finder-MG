/**
 * 통합검색 분석 도구 — OKR(T1 okr_member_report · T2 okr_team_report) (2026-10-29, 설계 5-2·5-3)
 *
 * 숫자는 화면과 같은 코드(okr-rules.ts — src/okr.ts·kpiCompute.ts 가 다시 내보내는 그 함수)로 센다:
 *  개인 = 그 기간 판정 있는 목표 중 완료·해당없음 비율(판정 0 = 미작성 = 0%), 팀 = 팀원(명단 ∪ 보고자, 팀장 제외) 평균,
 *  전체 = A~D 전원 평균, 아무도 판정이 없으면 null(미작성). 목표 = 그 달 화면 목표(monthScreenGoals, 옛 달은 달 goals).
 * 글(실제결과·사유·개선계획·근거)은 html 을 버리고 칸마다 300자. 판단은 모델이, 세기·검사는 여기서.
 * OKR 은 누구나 본다(설계 Q1 — OKR 화면도 누구나 봄). 순수 부분(analyzeMember·analyzeTeam)은 tests/askToolsOkr.test.ts.
 */
import {
  OKR_TEAMS, achievementRate, actionMembersInMonth, bottleneckText, goalsApplyingTo, isLegacyMonthId, judgmentCounts, monthScreenGoals, normalizeJudgment,
  okrMemberShares, okrShareAverage, okrTeamMembers, okrWritingChecks, okrWritingSummary, pillarLabel, resultRowFor, worstOfJudgments,
  type OkrCycle, type OkrFeedback, type OkrGoal, type OkrJudgment, type OkrReport, type OkrResultRow, type OkrRosterLite, type OkrTeam, type OkrWeekFacts, type OkrWritingIssue,
} from "./okr-rules.ts";
import { clip, findPerson, inList, loadRoster, parseOkrPeriod, str, toolError, type AskToolArgs, type AskToolCtx, type OkrPeriod, type RosterRow } from "./tool-util.ts";

/* ───────────── 서버 행 → 규칙 꼴(html 버림) ───────────── */

export function toGoals(raw: unknown): OkrGoal[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g, i) => {
    const x = (g || {}) as Record<string, unknown>;
    const scope = x.scope && typeof x.scope === "object" ? x.scope as { team?: unknown; member?: unknown } : null;
    const team = str(scope?.team);
    const member = str(scope?.member);
    return {
      no: Number(x.no) || i + 1, pillar: str(x.pillar), bottleneck: str(x.bottleneck), objective: str(x.objective), criteria: str(x.criteria),
      ...(x.hidden === true ? { hidden: true } : {}),
      ...((OKR_TEAMS as readonly string[]).includes(team) ? { scope: member ? { team: team as OkrTeam, member } : { team: team as OkrTeam } } : {}),
    } as OkrGoal;
  });
}
const toFeedback = (raw: unknown): Record<string, OkrFeedback> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, OkrFeedback> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = (v || {}) as Record<string, unknown>;
    out[k] = { memo: str(f.memo), ...(str(f.judgment) ? { judgment: str(f.judgment) } : {}), ...(str(f.action) ? { action: str(f.action) } : {}) };
  }
  return out;
};
export function toCycle(r: Record<string, unknown>): OkrCycle {
  const id = str(r.id);
  return {
    id, kind: r.kind === "quarter" || /^\d{4}-Q[1-4]$/.test(id) ? "quarter" : r.kind === "week" ? "week" : "month",
    title: str(r.title), year: Number(r.year) || 0, month: Number(r.month) || 0, week_no: r.week_no == null ? null : Number(r.week_no),
    start_date: str(r.start_date), end_date: str(r.end_date), parent_id: r.parent_id ? str(r.parent_id) : null,
    goals: toGoals(r.goals), feedback: toFeedback(r.feedback),
    ...(r.direction !== undefined ? { direction: str(r.direction) } : {}),
    ...(r.goals_origin !== undefined ? { goals_origin: (["copy", "import", "manual", "leader"].includes(str(r.goals_origin)) ? str(r.goals_origin) : "") as OkrCycle["goals_origin"] } : {}),
  };
}
export function toReport(r: Record<string, unknown>): OkrReport {
  const header = (r.header && typeof r.header === "object" ? r.header : {}) as Record<string, unknown>;
  const rows: OkrResultRow[] = Array.isArray(r.rows) ? (r.rows as Array<Record<string, unknown>>).map((x) => ({
    no: Number(x?.no) || 0, actual: str(x?.actual), judgment: str(x?.judgment), reason: str(x?.reason), plan: str(x?.plan), evidence: str(x?.evidence),
  })).filter((x) => x.no > 0) : [];
  return {
    cycle_id: str(r.cycle_id), team: str(r.team), member: str(r.member),
    header: { leader: str(header.leader), author: str(header.author), headcount: str(header.headcount), submitted: str(header.submitted) },
    rows,
    goals: Array.isArray(header.goals) ? toGoals(header.goals) : undefined,
    feedback: header.feedback && typeof header.feedback === "object" && !Array.isArray(header.feedback) ? toFeedback(header.feedback) : undefined,
    updated_at: str(r.updated_at) || undefined,
  };
}

/* ───────────── 기간 묶음 ───────────── */

export type OkrBundle = { period: OkrPeriod; cycles: Map<string, OkrCycle>; reports: OkrReport[]; roster: OkrRosterLite[] };

/** 그 달 화면 목표 — OKR 화면·홈 K19 와 같은 규칙(옛 달 = 달 goals, 새 달 = monthScreenGoals(달, 분기)) */
export function goalsOfMonth(b: Pick<OkrBundle, "cycles" | "period">, monthId: string): OkrGoal[] {
  const cycle = b.cycles.get(monthId) || null;
  if (!cycle) return [];
  return isLegacyMonthId(monthId) ? cycle.goals : monthScreenGoals(cycle, b.cycles.get(b.period.quarterId) || null).goals;
}
/** 그 달 주 단위 사실(kpiCompute OkrWeekFacts 와 같은 꼴) */
export function weekFactsOf(b: OkrBundle, monthId: string): OkrWeekFacts {
  const weeks = b.period.weeks.filter((w) => w.monthId === monthId);
  const ids = new Set(weeks.map((w) => w.id));
  return { id: weeks[0]?.id || `${monthId}-W1`, weeks: weeks.map((w) => ({ id: w.id, weekNo: w.weekNo, label: w.label })), goals: goalsOfMonth(b, monthId), reports: b.reports.filter((r) => ids.has(r.cycle_id)) };
}

async function loadBundle(ctx: AskToolCtx, periodArg: unknown): Promise<OkrBundle & { rosterFull: RosterRow[] }> {
  const period = parseOkrPeriod(periodArg, ctx.today);
  const cycleIds = [period.quarterId, ...period.months, ...period.weeks.map((w) => w.id)];
  const reportIds = [...period.months, ...period.weeks.map((w) => w.id)];
  const [cycleRows, rep, rosterFull] = await Promise.all([
    ctx.rest.get<Record<string, unknown>>(`okr_cycles?select=id,kind,title,year,month,week_no,start_date,end_date,parent_id,direction,goals_origin,goals,feedback&id=${inList(cycleIds)}`),
    ctx.rest.getAll<Record<string, unknown>>("okr_reports", `select=cycle_id,team,member,header,rows,updated_at&cycle_id=${inList(reportIds)}&order=cycle_id.asc,team.asc,member.asc`, { max: 4000 }),
    loadRoster(ctx),
  ]);
  const cycles = new Map(cycleRows.map((r) => { const c = toCycle(r); return [c.id, c] as const; }));
  return { period, cycles, reports: rep.rows.map(toReport), roster: rosterFull.map((r) => ({ name: r.name, team: r.team, title: r.title })), rosterFull };
}

/* ───────────── T1 개인 ───────────── */

export type MemberAnalysis = {
  person: string; team: string; period: string; periodLabel: string;
  rate: { person: number | null; done: number; judged: number; team: number | null; all: number | null; rule: string };
  weeks: Array<{ id: string; label: string; written: boolean; judged: number; total: number; pct: number | null; counts: Record<OkrJudgment, number> }>;
  missingWeeks: string[];
  goals: Array<{ no: number; pillar: string; bottleneck: string; objective: string; criteria: string; byWeek: Record<string, string>; last: string; leaderFeedback?: string; leaderJudgment?: string }>;
  checks: { summary: Record<number, number>; items: OkrWritingIssue[] };
  partFeedback: Array<{ cycle: string; no: number; memo: string }>;
  evidence: Array<{ week: string; no: number; judgment: string; actual: string; reason: string; plan: string; evidence: string }>;
  notes: string[];
};

/** 순수 — 한 사람 분석(테스트 대상). person 은 명단 이름 그대로 */
export function analyzeMember(b: OkrBundle, person: string, teamHint: string): MemberAnalysis {
  const { period } = b;
  const mine = b.reports.filter((r) => r.member === person);
  const team = mine.find((r) => (OKR_TEAMS as readonly string[]).includes(r.team))?.team || teamHint;
  const notes: string[] = [];
  const pastWeeks = period.weeks.filter((w) => !w.future);
  // 달성률 — 달마다 okrMemberShares(홈 K19 와 같은 함수) 몫을 더한다
  let done = 0, judged = 0;
  const teamShares = new Map<string, { done: number; judged: number }>();
  const allShares = new Map<string, { team: string; done: number; judged: number }>();
  for (const monthId of period.months) {
    const w = weekFactsOf(b, monthId);
    const ids = period.weeks.filter((x) => x.monthId === monthId).map((x) => x.id);
    if (!ids.length) continue;
    if (!w.goals.length) notes.push(`${monthId} 목표가 아직 없음(월 OKR 행 없음) — 그 달 판정은 셀 수 없음`);
    for (const t of OKR_TEAMS) {
      for (const s of okrMemberShares(w, t, b.roster, ids)) {
        const key = `${t}|${s.name}`;
        const a = allShares.get(key) || { team: t, done: 0, judged: 0 };
        a.done += s.done; a.judged += s.judged; allShares.set(key, a);
        if (t === team) { const x = teamShares.get(s.name) || { done: 0, judged: 0 }; x.done += s.done; x.judged += s.judged; teamShares.set(s.name, x); }
      }
    }
    if (![...okrTeamMembers(w, team, b.roster)].includes(person)) {
      const rows = ids.flatMap((id) => goalsApplyingTo(w.goals, { team, member: person }).map((g) => resultRowFor(mine.find((r) => r.cycle_id === id), g.no)));
      const j = rows.filter((x) => normalizeJudgment(x.judgment));
      done += j.filter((x) => ["완료", "해당없음"].includes(normalizeJudgment(x.judgment))).length; judged += j.length;
    }
  }
  const own = teamShares.get(person);
  if (own) { done = own.done; judged = own.judged; }
  const avg = (list: Array<{ done: number; judged: number }>) => okrShareAverage(list.map((x) => ({ team, name: "", ...x })));
  const rate = {
    person: judged ? Math.round((done / judged) * 100) : 0,
    done, judged,
    team: avg([...teamShares.values()]),
    all: avg([...allShares.values()]),
    rule: "개인 = 판정 있는 목표 중 완료·해당없음 비율(판정 0 = 미작성 0%) · 팀 = 팀원(명단 ∪ 보고자, 팀장 제외) 평균 · 전체 = A~D 전원 평균 — 홈 K19 와 같은 함수",
  };

  // 주차별
  const weeks = pastWeeks.map((wk) => {
    const goals = goalsApplyingTo(goalsOfMonth(b, wk.monthId), { team, member: person }).filter((g) => !g.hidden);
    const rep = mine.find((r) => r.cycle_id === wk.id);
    const rows = goals.map((g) => resultRowFor(rep, g.no));
    const n = rows.filter((x) => normalizeJudgment(x.judgment)).length;
    return { id: wk.id, label: wk.label, written: n > 0, judged: n, total: goals.length, pct: achievementRate(rows), counts: judgmentCounts(rows) };
  });
  const missingWeeks = weeks.filter((w) => !w.written).map((w) => w.id);

  // 목표별 흐름(번호 기준 — 달이 바뀌면 그 달 목표 글)
  const goalMap = new Map<number, MemberAnalysis["goals"][number]>();
  for (const wk of pastWeeks) {
    const monthCycle = b.cycles.get(wk.monthId);
    const rep = mine.find((r) => r.cycle_id === wk.id);
    for (const g of goalsApplyingTo(goalsOfMonth(b, wk.monthId), { team, member: person }).filter((x) => !x.hidden)) {
      const cur = goalMap.get(g.no) || {
        no: g.no, pillar: pillarLabel(g.pillar), bottleneck: clip(bottleneckText(g.bottleneck), 120), objective: clip(g.objective, 200),
        criteria: clip(rep?.goals?.find((x) => x.no === g.no && x.criteria.trim())?.criteria || g.criteria, 300), byWeek: {}, last: "",
      };
      const j = normalizeJudgment(resultRowFor(rep, g.no).judgment);
      cur.byWeek[wk.id] = j || "(빈칸)";
      if (j) cur.last = j;
      const fb = monthCycle?.feedback?.[String(g.no)];
      if (fb?.memo?.trim()) cur.leaderFeedback = clip(fb.memo, 300);
      if (normalizeJudgment(fb?.judgment || "")) cur.leaderJudgment = normalizeJudgment(fb?.judgment || "");
      goalMap.set(g.no, cur);
    }
  }

  // 작성 품질 검사 — 파트 종합 행(member '')의 달성기준 덮어쓰기도 "쪼갠 기준"으로 인정
  const items = okrWritingChecks(pastWeeks.map((wk) => ({
    id: wk.id, goals: goalsOfMonth(b, wk.monthId), report: mine.find((r) => r.cycle_id === wk.id) || null,
    teamGoals: b.reports.find((r) => r.cycle_id === wk.id && r.team === team && !r.member)?.goals,
  })), { member: person, team });

  // 파트장 피드백 — 그 사람 기록·파트 종합 기록의 header.feedback
  const partFeedback = b.reports
    .filter((r) => r.team === team && (r.member === person || !r.member) && r.feedback)
    .flatMap((r) => Object.entries(r.feedback || {}).filter(([, f]) => f.memo.trim()).map(([no, f]) => ({ cycle: r.cycle_id, no: Number(no), memo: clip(f.memo, 300) })))
    .slice(0, 40);

  const evidence = pastWeeks.flatMap((wk) => {
    const rep = mine.find((r) => r.cycle_id === wk.id);
    return (rep?.rows || []).filter((x) => x.actual.trim() || x.judgment.trim() || x.reason.trim()).map((x) => ({
      week: wk.id, no: x.no, judgment: normalizeJudgment(x.judgment) || "(빈칸)", actual: clip(x.actual), reason: clip(x.reason), plan: clip(x.plan), evidence: clip(x.evidence),
    }));
  });
  if (!mine.length) notes.push(`${person} 의 이 기간 개인 OKR 기록이 하나도 없음`);
  if (period.weeks.some((w) => w.future)) notes.push(`아직 시작 안 한 주(${period.weeks.filter((w) => w.future).map((w) => w.id).join(", ")})는 미작성으로 세지 않음 — 달성률 분모에도 판정이 없어 영향 없음`);

  return {
    person, team, period: period.id, periodLabel: period.label, rate, weeks, missingWeeks,
    goals: [...goalMap.values()].sort((a, c) => a.no - c.no),
    checks: { summary: okrWritingSummary(items), items: items.slice(0, 80) },
    partFeedback, evidence, notes,
  };
}

export async function okrMemberReport(args: AskToolArgs, ctx: AskToolCtx) {
  try {
    const b = await loadBundle(ctx, args.period);
    const who = findPerson(b.rosterFull, str(args.person)) || null;
    const name = who?.name || str(args.person);
    if (!name) return { error: "person(사람 이름)이 필요합니다" };
    const reporterTeam = b.reports.find((r) => r.member === name)?.team || "";
    const team = (OKR_TEAMS as readonly string[]).includes(reporterTeam) ? reporterTeam : who?.team || "";
    if (!(OKR_TEAMS as readonly string[]).includes(team) && !b.reports.some((r) => r.member === name)) {
      return { error: `${name} 은(는) OKR 대상(A~D 파트)이 아니거나 이 기간 기록이 없습니다${who ? ` — 명단 팀 ${who.team}` : " — 명단에 없는 이름"}. E(CSS)팀은 OKR 대상이 아닙니다.` };
    }
    return ctx.mask(analyzeMember(b, name, team));
  } catch (e) { return toolError(e, "OKR 표를 읽지 못했습니다"); }
}

/* ───────────── T2 팀 ───────────── */

export type TeamAnalysis = {
  team: string; period: string; periodLabel: string;
  rate: { team: number | null; all: number | null };
  members: Array<{ name: string; pct: number; done: number; judged: number; missingWeeks: string[]; counts: Record<OkrJudgment, number>; checks: Record<number, number> }>;
  goals: Array<{ no: number; pillar: string; objective: string; counts: Record<OkrJudgment, number>; blank: number; actionMembers: string[] }>;
  mismatches: Array<{ week: string; no: number; part: string; members: string }>;
  notes: string[];
};

/** 순수 — 팀 분석(테스트 대상) */
export function analyzeTeam(b: OkrBundle, team: string): TeamAnalysis {
  const { period } = b;
  const pastWeeks = period.weeks.filter((w) => !w.future);
  const names = new Set<string>();
  for (const m of period.months) for (const n of okrTeamMembers(weekFactsOf(b, m), team, b.roster)) names.add(n);
  const members = [...names].map((name) => {
    const a = analyzeMember(b, name, team);
    const all = pastWeeks.flatMap((wk) => goalsApplyingTo(goalsOfMonth(b, wk.monthId), { team, member: name }).filter((g) => !g.hidden).map((g) => resultRowFor(b.reports.find((r) => r.cycle_id === wk.id && r.member === name), g.no)));
    return { name, pct: a.rate.person ?? 0, done: a.rate.done, judged: a.rate.judged, missingWeeks: a.missingWeeks, counts: judgmentCounts(all), checks: a.checks.summary, _team: a.rate.team, _all: a.rate.all };
  });
  const teamReports = b.reports.filter((r) => r.team === team);
  const goalNos = new Map<number, OkrGoal>();
  for (const wk of pastWeeks) for (const g of goalsOfMonth(b, wk.monthId)) if (!g.hidden && (!g.scope || g.scope.team === team) && !goalNos.has(g.no)) goalNos.set(g.no, g);
  const goals = [...goalNos.values()].sort((a, c) => a.no - c.no).map((g) => {
    const rows: OkrResultRow[] = [];
    let blank = 0;
    for (const wk of pastWeeks) for (const name of names) {
      if (!goalsApplyingTo([g], { team, member: name }).length) continue;
      const row = resultRowFor(teamReports.find((r) => r.cycle_id === wk.id && r.member === name), g.no);
      if (normalizeJudgment(row.judgment)) rows.push(row); else blank += 1;
    }
    const weekReports = teamReports.filter((r) => pastWeeks.some((w) => w.id === r.cycle_id));
    return { no: g.no, pillar: pillarLabel(g.pillar), objective: clip(g.objective, 160), counts: judgmentCounts(rows), blank, actionMembers: actionMembersInMonth(weekReports, g.no)[team] || [] };
  });
  // 파트 종합 판정 vs 팀원 판정 중 가장 나쁜 것(화면 제안 규칙 worstOfJudgments)이 다른 칸
  const mismatches: TeamAnalysis["mismatches"] = [];
  for (const wk of pastWeeks) {
    const summary = teamReports.find((r) => r.cycle_id === wk.id && !r.member);
    if (!summary) continue;
    for (const g of goalNos.values()) {
      const part = normalizeJudgment(resultRowFor(summary, g.no).judgment);
      const worst = worstOfJudgments(teamReports.filter((r) => r.cycle_id === wk.id && r.member).map((r) => resultRowFor(r, g.no).judgment));
      if (part && worst && part !== worst) mismatches.push({ week: wk.id, no: g.no, part, members: worst });
    }
  }
  const notes: string[] = [];
  if (!members.length) notes.push(`${team}파트 명단·보고자가 없음`);
  return {
    team, period: period.id, periodLabel: period.label,
    rate: { team: members[0]?._team ?? null, all: members[0]?._all ?? null },
    members: members.map(({ _team, _all, ...m }) => { void _team; void _all; return m; }).sort((a, c) => c.pct - a.pct || a.name.localeCompare(c.name, "ko")),
    goals, mismatches: mismatches.slice(0, 60), notes,
  };
}

export async function okrTeamReport(args: AskToolArgs, ctx: AskToolCtx) {
  try {
    const raw = str(args.team).toUpperCase().replace(/팀|파트/g, "").trim();
    if (raw === "E" || /CSS/.test(raw)) return { error: "E(CSS)팀은 OKR 대상이 아닙니다(A~D 파트만)." };
    if (!(OKR_TEAMS as readonly string[]).includes(raw)) return { error: `team 은 A·B·C·D 중 하나입니다(받은 값: ${str(args.team) || "빈칸"})` };
    const b = await loadBundle(ctx, args.period);
    return ctx.mask(analyzeTeam(b, raw));
  } catch (e) { return toolError(e, "OKR 표를 읽지 못했습니다"); }
}
