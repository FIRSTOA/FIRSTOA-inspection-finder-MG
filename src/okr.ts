// OKR — 월별 목표(Pillar·병목·목표·달성기준)와 파트별 실행결과(실제결과·종합판정·사유·개선계획·근거자료)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북(작성가이드 / 통합집계 / A~D파트 시트)을 그대로 옮긴 구조다(2026-09-24).
//  - okr_cycles : 기간 하나(월간 또는 주간). 목표 9개와 팀장 피드백을 들고 있다. 주간 기간은 그 달의 목표를 복사해 쓴다.
//  - okr_reports: 기간 × 파트 × 사람 하나. member=''가 파트 종합(통합집계가 읽는 행), member='이름'이 팀원 개인 기록.
//    파트 결과는 팀원 기록을 파트장이 모아 쓴다(2026-09-24 사용자: "A~D는 각 팀원 내용을 합친 통계이므로 팀원 그룹도 있어야").
// 표 생성·초기 데이터: supabase/okr.sql (사용자가 SQL Editor에서 실행).
import { deleteRows, invokeEdgeFunction, selectRows, upsertRow } from "./supabase";

export const OKR_TEAMS = ["A", "B", "C", "D"] as const; // CSS팀(E)은 OKR 대상이 아니다(2026-09-24)
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

// Pillar는 정해진 3개(2026-09-24 사용자) — 각 Pillar 아래 병목현상 1·2·3 → 목표 9개
export const OKR_PILLARS = [
  { label: "AI · 효율성 · 비용절감", full: "Pillar 1.\nAI · 효율성 · 비용절감", keywords: /AI|효율|비용/i },
  { label: "매출증대 · 안정", full: "Pillar 2.\n매출증대 · 안정", keywords: /매출|안정/ },
  { label: "나의 성장 · 소통", full: "Pillar 3.\n나의 성장 · 소통", keywords: /성장|소통|자기/ },
] as const;
// 저장된 Pillar 글("Pillar 1.\nAI · 효율성 · 비용절감" / "매출증대·안정" 등)이 3개 중 어느 것인지. 모르면 -1
export function pillarIndex(pillar: string): number {
  const text = String(pillar || "");
  const num = text.match(/Pillar\s*([123])/i);
  if (num) return Number(num[1]) - 1;
  return OKR_PILLARS.findIndex((p) => p.keywords.test(text));
}
export const pillarLabel = (pillar: string) => { const i = pillarIndex(pillar); return i >= 0 ? OKR_PILLARS[i].label : String(pillar || "").replace(/^Pillar\s*\d+\.?\s*/i, "").trim(); };

export type OkrGoal = { no: number; pillar: string; bottleneck: string; objective: string; criteria: string };
// 글자색(엑셀처럼 검정·빨강·파랑) — 색이 들어간 칸만 html을 함께 둔다. AI·합치기가 평문으로 바꾸면 html은 지운다.
export type RichField = "actual" | "reason" | "plan" | "evidence";
export type OkrFeedback = { action?: string; memo: string; memoHtml?: string };
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
export type OkrResultRow = { no: number; actual: string; judgment: string; reason: string; plan: string; evidence: string; html?: Partial<Record<RichField, string>> };
export type OkrHeader = { leader: string; author: string; headcount: string; submitted: string };
export type OkrReport = {
  cycle_id: string;
  team: string;
  member: string; // '' = 파트 종합, 그 외 = 팀원 이름
  header: OkrHeader;
  rows: OkrResultRow[];
  updated_at?: string;
  updated_by?: string | null;
};

export const emptyGoal = (no: number): OkrGoal => ({ no, pillar: "", bottleneck: "", objective: "", criteria: "" });
export const emptyResultRow = (no: number): OkrResultRow => ({ no, actual: "", judgment: "", reason: "", plan: "", evidence: "" });
export const emptyHeader = (): OkrHeader => ({ leader: "", author: "", headcount: "", submitted: "" });
export const emptyReport = (cycleId: string, team: string, member = ""): OkrReport => ({ cycle_id: cycleId, team, member, header: emptyHeader(), rows: [] });
export const reportKey = (r: Pick<OkrReport, "team" | "member">) => `${r.team}|${r.member || ""}`;
export const findReport = (reports: OkrReport[], team: string, member = "") => reports.find((r) => r.team === team && (r.member || "") === member);
// 파트의 팀원 기록(파트 종합 행 제외), 이름순
export const memberReports = (reports: OkrReport[], team: string) => reports.filter((r) => r.team === team && r.member).sort((a, b) => a.member.localeCompare(b.member, "ko"));

// 팀원들이 적은 실제결과를 파트 종합 칸에 넣을 글로 — "• 이름: 내용"(여러 줄이면 이름 아래 들여쓰기)
export function mergeMemberActuals(members: OkrReport[], no: number): string {
  return members
    .map((m) => ({ name: m.member, row: resultRowFor(m, no) }))
    .filter((x) => x.row.actual.trim())
    .map((x) => { const lines = x.row.actual.trim().split(/\r?\n/); return lines.length === 1 ? `• ${x.name}: ${lines[0]}` : `• ${x.name}:\n${lines.map((l) => `  ${l}`).join("\n")}`; })
    .join("\n");
}
// 팀원 판정 중 가장 나쁜 것 — 파트 종합판정 제안용
export function worstOfJudgments(words: string[]): OkrJudgment | "" {
  const js = words.map(normalizeJudgment).filter(Boolean) as OkrJudgment[];
  if (!js.length) return "";
  const graded = js.filter((j) => j !== "해당없음");
  if (!graded.length) return "해당없음";
  return graded.reduce((worst, j) => (JUDGMENT_INFO[j].rank > JUDGMENT_INFO[worst].rank ? j : worst), graded[0]);
}

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

// 통합집계 '조치 필요 파트' — 미흡·미착수인 파트만(부분달성은 사유만 받고 조치 대상엔 안 넣는다: 8월 통합집계 기준). 파트 종합 행만 본다.
export function actionTeams(reports: OkrReport[], no: number): string[] {
  return reports
    .filter((r) => !r.member)
    .filter((r) => { const j = normalizeJudgment(resultRowFor(r, no).judgment); return j === "미흡" || j === "미착수"; })
    .map((r) => r.team)
    .sort();
}

// 조치 필요 파트별로, 그 파트 팀원 중 자기 기록이 미흡·미착수인 사람 — "B · 권태혁"처럼 누구 건지 바로 보이게(2026-09-24 요청)
export function actionMembers(reports: OkrReport[], no: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const team of actionTeams(reports, no)) {
    out[team] = memberReports(reports, team)
      .filter((m) => { const j = normalizeJudgment(resultRowFor(m, no).judgment); return j === "미흡" || j === "미착수"; })
      .map((m) => m.member);
  }
  return out;
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
export function remapReports(reports: OkrReport[], remap: Map<number, number>): OkrReport[] {
  return reports.map((r) => ({ ...r, rows: r.rows.filter((x) => remap.has(x.no)).map((x) => ({ ...x, no: remap.get(x.no) as number })).sort((a, b) => a.no - b.no) }));
}
export function remapFeedback(feedback: Record<string, OkrFeedback>, remap: Map<number, number>): Record<string, OkrFeedback> {
  return Object.fromEntries(Object.entries(feedback).filter(([k]) => remap.has(Number(k))).map(([k, v]) => [String(remap.get(Number(k))), v]));
}
// 빈 달의 기본 틀 — Pillar 3개 × 병목현상 3개
export function defaultGoalTemplate(): OkrGoal[] {
  return renumberGoals(OKR_PILLARS.flatMap((p, pi) => [1, 2, 3].map((n) => ({ no: pi * 3 + n, pillar: p.full, bottleneck: `병목현상 ${n}`, objective: "", criteria: "" }))));
}
// 완료·해당없음이 아니면 사유와 개선계획을 둘 다 적어야 한다(2026-09-24 사용자). 해당없음은 근거자료에 '대상 0건'.
export const needsReasonPlan = (judgment: string) => { const j = normalizeJudgment(judgment); return !!j && j !== "완료" && j !== "해당없음"; };
export const isAlert = (judgment: string) => { const j = normalizeJudgment(judgment); return j === "미흡" || j === "미착수"; };

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
    member: String(r.member || ""),
    header: { leader: String(header.leader || ""), author: String(header.author || ""), headcount: String(header.headcount || ""), submitted: String(header.submitted || "") },
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
export async function getOkrReports(cycleId: string): Promise<OkrReport[]> {
  const rows = await selectRows<OkrReport>("okr_reports", `select=*&cycle_id=eq.${encodeURIComponent(cycleId)}&order=team.asc,member.asc`);
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
    cycle_id: report.cycle_id, team: report.team, member: report.member || "", header: report.header, rows: report.rows,
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
