// OKR — 월별 목표(Pillar·병목·목표·달성기준)와 파트별 실행결과(실제결과·종합판정·사유·개선계획·근거자료)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북(작성가이드 / 통합집계 / A~D파트 시트)을 그대로 옮긴 구조다(2026-09-24).
//  - okr_cycles : 기간 하나(월간 또는 주간). 목표 9개와 팀장 피드백을 들고 있다. 주간 기간은 그 달의 목표를 복사해 쓴다.
//  - okr_reports: 기간 × 파트 하나. 머리(파트장·작성자·인원수·제출일)와 목표별 결과 행.
// 표 생성·초기 데이터: supabase/okr.sql (사용자가 SQL Editor에서 실행).
import { deleteRows, selectRows, upsertRow } from "./supabase";

export const OKR_TEAMS = ["A", "B", "C", "D", "E"] as const;
export type OkrTeam = (typeof OKR_TEAMS)[number];

export const OKR_JUDGMENTS = ["완료", "부분달성", "미흡", "미착수", "해당없음"] as const;
export type OkrJudgment = (typeof OKR_JUDGMENTS)[number];

// 작성가이드 6번 표 — 등급과 언제 고르는지. 큰 rank가 더 나쁘다(종합판정 = 가장 나쁜 등급 하나).
export const JUDGMENT_INFO: Record<OkrJudgment, { rank: number; when: string; then: string; tone: string; dot: string }> = {
  완료: { rank: 0, when: "100% 다 했음", then: "숫자만 쓰면 끝", tone: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  해당없음: { rank: 0, when: "할 대상이 처음부터 0건", then: "근거자료에 '대상 0건'", tone: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  부분달성: { rank: 1, when: "80~99% 거의 했지만 조금 부족", then: "숫자 + 사유", tone: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-400" },
  미흡: { rank: 2, when: "1~79% 많이 부족", then: "숫자 + 사유 + 개선계획", tone: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-500" },
  미착수: { rank: 3, when: "0% 시작도 못 함", then: "왜 시작 못 했는지(사유)", tone: "bg-rose-100 text-rose-800 border-rose-200", dot: "bg-rose-500" },
};

export type OkrGoal = { no: number; pillar: string; bottleneck: string; objective: string; criteria: string };
export type OkrFeedback = { action?: string; memo: string };
export type OkrCycle = {
  id: string;
  kind: "month" | "week";
  title: string;
  year: number;
  month: number;
  week_no: number | null;
  start_date: string;
  end_date: string;
  parent_id: string | null;
  goals: OkrGoal[];
  feedback: Record<string, OkrFeedback>;
  updated_at?: string;
  updated_by?: string | null;
};
export type OkrResultRow = { no: number; actual: string; judgment: string; reason: string; plan: string; evidence: string };
export type OkrHeader = { leader: string; author: string; headcount: string; submitted: string };
export type OkrReport = {
  cycle_id: string;
  team: string;
  header: OkrHeader;
  rows: OkrResultRow[];
  updated_at?: string;
  updated_by?: string | null;
};

export const emptyGoal = (no: number): OkrGoal => ({ no, pillar: "", bottleneck: "", objective: "", criteria: "" });
export const emptyResultRow = (no: number): OkrResultRow => ({ no, actual: "", judgment: "", reason: "", plan: "", evidence: "" });
export const emptyHeader = (): OkrHeader => ({ leader: "", author: "", headcount: "", submitted: "" });
export const emptyReport = (cycleId: string, team: string): OkrReport => ({ cycle_id: cycleId, team, header: emptyHeader(), rows: [] });

// "Pillar 1.\nAI · 효율성 · 비용절감" → { num: "Pillar 1", name: "AI · 효율성 · 비용절감" }
export function splitPillar(pillar: string): { num: string; name: string } {
  const text = String(pillar || "").trim();
  const m = text.match(/^(Pillar\s*\d+)\.?\s*([\s\S]*)$/i);
  if (!m) return { num: "", name: text };
  return { num: m[1].replace(/\s+/g, " "), name: m[2].trim() };
}

// 파트별 결과 행에서 목표 번호로 찾기 — 없으면 빈 행
export function resultRowFor(report: OkrReport | undefined, no: number): OkrResultRow {
  return report?.rows.find((r) => r.no === no) || emptyResultRow(no);
}

export function normalizeJudgment(word: string): OkrJudgment | "" {
  const w = String(word || "").replace(/\s+/g, "");
  if (w === "미달성") return "미흡";
  if (w === "달성") return "완료";
  return (OKR_JUDGMENTS as readonly string[]).includes(w) ? (w as OkrJudgment) : "";
}

// 달성률 → 등급 (작성가이드 6번 표)
export function gradeFromPercent(percent: number): OkrJudgment {
  if (!Number.isFinite(percent)) return "미흡";
  if (percent >= 100) return "완료";
  if (percent >= 80) return "부분달성";
  if (percent > 0) return "미흡";
  return "미착수";
}

// 실제결과 글에서 가장 나쁜 등급을 골라 종합판정 후보를 낸다.
// "1주일 이내 확인 이행률 : 14건 중 11건 (79%, 미흡)" 처럼 등급 낱말이 있으면 그것을, 없으면 괄호 안 %로 등급을 매긴다.
// 해당없음만 있으면 해당없음, 아무것도 못 찾으면 "".
export function worstJudgment(actual: string): OkrJudgment | "" {
  const text = String(actual || "");
  const found: OkrJudgment[] = [];
  const wordRe = /(?:^|[(\s,:：·•\-–—/])(완료|부분달성|미흡|미착수|해당없음|미달성)(?=$|[)\s,.。;/])/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(text))) { const j = normalizeJudgment(m[1]); if (j) found.push(j); }
  if (!found.length) {
    const pctRe = /(\d+(?:\.\d+)?)\s*%/g;
    while ((m = pctRe.exec(text))) found.push(gradeFromPercent(Number(m[1])));
  }
  if (!found.length) return "";
  const graded = found.filter((j) => j !== "해당없음");
  if (!graded.length) return "해당없음";
  return graded.reduce((worst, j) => (JUDGMENT_INFO[j].rank > JUDGMENT_INFO[worst].rank ? j : worst), graded[0]);
}

// 통합집계 '조치 필요 파트' — 미흡·미착수인 파트만(부분달성은 사유만 받고 조치 대상엔 안 넣는다: 8월 통합집계 기준)
export function actionTeams(reports: OkrReport[], no: number): string[] {
  return reports
    .filter((r) => { const j = normalizeJudgment(resultRowFor(r, no).judgment); return j === "미흡" || j === "미착수"; })
    .map((r) => r.team)
    .sort();
}

export function judgmentCounts(rows: OkrResultRow[]): Record<OkrJudgment, number> {
  const out = Object.fromEntries(OKR_JUDGMENTS.map((j) => [j, 0])) as Record<OkrJudgment, number>;
  for (const r of rows) { const j = normalizeJudgment(r.judgment); if (j) out[j] += 1; }
  return out;
}

// 달성률(%) — 완료·해당없음을 달성으로, 판정 없는 행은 분모에서 뺀다
export function achievementRate(rows: OkrResultRow[]): number | null {
  const judged = rows.map((r) => normalizeJudgment(r.judgment)).filter(Boolean) as OkrJudgment[];
  if (!judged.length) return null;
  const done = judged.filter((j) => j === "완료" || j === "해당없음").length;
  return Math.round((done / judged.length) * 100);
}

const pad = (n: number) => String(n).padStart(2, "0");
const kst = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d);

// 월~금 근무 주. 주간 OKR은 이 범위로 잡는다.
export function okrWorkWeek(date: string): { start: string; end: string } {
  const d = new Date(`${date}T12:00:00+09:00`);
  const day = d.getUTCDay(); // 일=0
  const back = day === 0 ? 6 : day - 1;
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - back);
  const friday = new Date(monday); friday.setUTCDate(monday.getUTCDate() + 4);
  return { start: kst(monday), end: kst(friday) };
}

// 어느 달의 몇 주차인지 — 주간현황판(weeksInMonth)과 같은 셈: 그 달 1일이 든 주가 1주차
export function okrWeeksInMonth(year: number, month: number): Array<{ weekNo: number; start: string; end: string }> {
  const lastDay = new Date(year, month, 0).getDate();
  const seen = new Set<string>();
  const out: Array<{ weekNo: number; start: string; end: string }> = [];
  for (let day = 1; day <= lastDay; day++) {
    const w = okrWorkWeek(`${year}-${pad(month)}-${pad(day)}`);
    if (seen.has(w.start)) continue;
    seen.add(w.start);
    out.push({ weekNo: out.length + 1, ...w });
  }
  return out;
}

export const monthCycleId = (year: number, month: number) => `${year}-${pad(month)}`;
export const weekCycleId = (year: number, month: number, weekNo: number) => `${year}-${pad(month)}-W${weekNo}`;

export function cycleLabel(c: Pick<OkrCycle, "kind" | "year" | "month" | "week_no">): string {
  return c.kind === "week" ? `${c.year}년 ${c.month}월 ${c.week_no}주차` : `${c.year}년 ${c.month}월`;
}
export function defaultCycleTitle(c: Pick<OkrCycle, "kind" | "year" | "month" | "week_no">): string {
  return c.kind === "week" ? `CS팀 ${c.month}월 ${c.week_no}주차 OKR 실행결과` : `CS팀 ${c.month}월 OKR 실행결과`;
}

// 목표 번호를 1부터 다시 매긴다(행 삭제·추가 후)
export function renumberGoals(goals: OkrGoal[]): OkrGoal[] {
  return goals.map((g, i) => ({ ...g, no: i + 1 }));
}

// ── Supabase ──
type CycleRow = Partial<OkrCycle> & { id: string };
function toCycle(r: CycleRow): OkrCycle {
  return {
    id: r.id,
    kind: r.kind === "week" ? "week" : "month",
    title: String(r.title || ""),
    year: Number(r.year) || 0,
    month: Number(r.month) || 0,
    week_no: r.week_no == null ? null : Number(r.week_no),
    start_date: String(r.start_date || ""),
    end_date: String(r.end_date || ""),
    parent_id: r.parent_id ? String(r.parent_id) : null,
    goals: Array.isArray(r.goals) ? r.goals.map((g, i) => ({ no: Number(g.no) || i + 1, pillar: String(g.pillar || ""), bottleneck: String(g.bottleneck || ""), objective: String(g.objective || ""), criteria: String(g.criteria || "") })) : [],
    feedback: r.feedback && typeof r.feedback === "object" ? r.feedback : {},
    updated_at: r.updated_at,
    updated_by: r.updated_by ?? null,
  };
}
function toReport(r: Partial<OkrReport> & { cycle_id: string; team: string }): OkrReport {
  const header = { ...emptyHeader(), ...(r.header && typeof r.header === "object" ? r.header : {}) };
  return {
    cycle_id: r.cycle_id,
    team: r.team,
    header: { leader: String(header.leader || ""), author: String(header.author || ""), headcount: String(header.headcount || ""), submitted: String(header.submitted || "") },
    rows: Array.isArray(r.rows) ? r.rows.map((x) => ({ no: Number(x.no) || 0, actual: String(x.actual || ""), judgment: String(x.judgment || ""), reason: String(x.reason || ""), plan: String(x.plan || ""), evidence: String(x.evidence || "") })).filter((x) => x.no > 0) : [],
    updated_at: r.updated_at,
    updated_by: r.updated_by ?? null,
  };
}

export async function listOkrCycles(): Promise<OkrCycle[]> {
  const rows = await selectRows<CycleRow>("okr_cycles", "select=*&order=start_date.desc,kind.asc&limit=300");
  return rows.map(toCycle);
}
export async function getOkrReports(cycleId: string): Promise<OkrReport[]> {
  const rows = await selectRows<OkrReport>("okr_reports", `select=*&cycle_id=eq.${encodeURIComponent(cycleId)}&order=team.asc`);
  return rows.map(toReport);
}
export async function saveOkrCycle(cycle: OkrCycle, by: string): Promise<void> {
  await upsertRow("okr_cycles", {
    id: cycle.id, kind: cycle.kind, title: cycle.title, year: cycle.year, month: cycle.month, week_no: cycle.week_no,
    start_date: cycle.start_date, end_date: cycle.end_date, parent_id: cycle.parent_id, goals: cycle.goals, feedback: cycle.feedback,
    updated_at: new Date().toISOString(), updated_by: by || null,
  }, "id");
}
export async function saveOkrReport(report: OkrReport, by: string): Promise<void> {
  await upsertRow("okr_reports", {
    cycle_id: report.cycle_id, team: report.team, header: report.header, rows: report.rows,
    updated_at: new Date().toISOString(), updated_by: by || null,
  }, "cycle_id,team");
}
export async function deleteOkrCycle(cycleId: string): Promise<void> {
  await deleteRows("okr_reports", `cycle_id=eq.${encodeURIComponent(cycleId)}`);
  await deleteRows("okr_cycles", `id=eq.${encodeURIComponent(cycleId)}`);
}
