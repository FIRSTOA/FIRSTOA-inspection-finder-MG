// OKR — 월별 목표(Pillar·병목·목표·달성기준)와 파트별 실행결과(실제결과·종합판정·사유·개선계획·근거자료)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북(작성가이드 / 통합집계 / A~D파트 시트)을 그대로 옮긴 구조다(2026-09-24).
//  - okr_cycles : 기간 하나(월간 또는 주간). 목표 9개와 팀장 피드백을 들고 있다. 주간 기간은 그 달의 목표를 복사해 쓴다.
//  - okr_reports: 기간 × 파트 × 사람 하나. member=''가 파트 종합(통합집계가 읽는 행), member='이름'이 팀원 개인 기록.
//    파트 결과는 팀원 기록을 파트장이 모아 쓴다(2026-09-24 사용자: "A~D는 각 팀원 내용을 합친 통계이므로 팀원 그룹도 있어야").
// 표 생성·초기 데이터: supabase/okr.sql (사용자가 SQL Editor에서 실행).
import { deleteRows, invokeEdgeFunction, selectAllRows, selectRows, upsertRow } from "./supabase";

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

// html.objectiveSet === "1"(2026-10-20): 주차 덮어쓰기 칸의 objective를 사람이 고쳤다는 표시. 옛 덮어쓰기 칸에는 옛 objective 글이 남아 있어
// 표시가 있는 칸만 objective를 읽는다(overlayGoals). 표시를 html 안에 두는 건 옛 앱이 html을 통째로 보존하기 때문이다.
// html.bottleneckSet === "1"(2026-10-21 3차): 같은 규칙으로 주차 덮어쓰기 칸의 bottleneck(병목현상 글)을 사람이 고쳤다는 표시.
// 4차(2026-10-21): 층별 독립 — 표시가 있으면 빈 글이어도 그 값(비우면 빈 채 유지). 달성기준은 예외(7차): 빈 글이면 위 층이 보인다. html.bottleneck = 병목현상 글자색(RichCell).
export type OkrGoal = { no: number; pillar: string; bottleneck: string; objective: string; criteria: string; html?: { objective?: string; criteria?: string; bottleneck?: string; objectiveSet?: "1"; bottleneckSet?: "1"; criteriaSet?: "1" } };
// 글자색(엑셀처럼 검정·빨강·파랑) — 색이 들어간 칸만 html을 함께 둔다. AI·합치기가 평문으로 바꾸면 html은 지운다.
export type RichField = "actual" | "reason" | "plan" | "evidence";
// judgment(2026-10-20): 월 행이면 CS 종합, 분기 행이면 분기 종합을 사람이 고른 값(자동값 덮어쓰기)
export type OkrFeedback = { action?: string; memo: string; memoHtml?: string; judgment?: string };
export type OkrCycle = {
  id: string;
  kind: "quarter" | "month" | "week"; // quarter(2026-10-20): 팀장 분기 OKR 한 벌. id `2026-Q4`, month = 분기 첫 달
  title: string;
  year: number;
  month: number;
  week_no: number | null;
  start_date: string;
  end_date: string;
  parent_id: string | null;
  goals: OkrGoal[];
  feedback: Record<string, OkrFeedback>;
  // 아래 셋은 supabase/okr-quarter.sql 이후에만 있는 열이다. 서버 행에 열이 없으면 undefined로 두고 저장할 때도 보내지 않는다.
  direction?: string; // 월: 팀장 ★핵심방향★ 문단, 분기: 메모
  goals_origin?: OkrGoalsOrigin; // '' 예전 그대로 · 'copy' 미확정 복사본(팀장 월 OKR 대기) · 'import' 팀장 문서 붙여넣기 · 'manual' 손으로 확정 · 'leader' SQL로 적재한 팀장 원본
  goals_prev?: OkrGoal[] | null; // 붙여넣기로 덮기 직전 goals 한 벌(되돌리기용)
  updated_at?: string;
  updated_by?: string | null;
};
export type OkrGoalsOrigin = "" | "copy" | "import" | "manual" | "leader";
export type OkrResultRow = { no: number; actual: string; judgment: string; reason: string; plan: string; evidence: string; html?: Partial<Record<RichField, string>> };
export type OkrHeader = { leader: string; author: string; headcount: string; submitted: string };
export type OkrReport = {
  cycle_id: string;
  team: string;
  member: string; // '' = 파트 종합, 그 외 = 팀원 이름
  header: OkrHeader;
  rows: OkrResultRow[];
  // 달성기준 덮어쓰기 칸(2026-10-01): 고친 번호(no)의 칸만 — 파트 종합 행이면 그 파트 팀원 모두의 기본, 팀원 행이면 그 사람만.
  // 목표(objective)·Pillar·병목은 달의 공통(okr_cycles.goals) 하나라 여기 든 objective는 무시된다. header jsonb 안에 goals로 저장(표 변경 없이).
  // 예외(2026-10-20 새 경로 overlayGoals): html.objectiveSet === "1"인 칸의 objective만 주차 목표 덮어쓰기로 읽는다.
  goals?: OkrGoal[];
  // 파트장 피드백(팀원 집계의 '미흡항목 피드백 & 다음 달 개선 방향') — 목표 번호별. header jsonb 안에 feedback으로 저장.
  feedback?: Record<string, OkrFeedback>;
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

// 한 주(월~금)가 속한 달 — 그 주가 시작하는 월요일이 든 달(2026-10-01 사용자 최종). 한 주는 한 달에만 속한다.
// 9/28~10/2는 9월 4주차 하나뿐이고 10월 1주차는 10/5부터, 8/31~9/4는 8월 5주차다(옛 셈법의 9월 1주차 → 서버 기록은 2026-10-01에 옮겼다).
export function weekMonthOf(weekStart: string): { year: number; month: number } {
  return { year: Number(weekStart.slice(0, 4)), month: Number(weekStart.slice(5, 7)) };
}
// 어느 달의 몇 주차인지 — 그 달에 시작하는 주를 앞에서부터 1·2·3…
export function okrWeeksInMonth(year: number, month: number): Array<{ weekNo: number; start: string; end: string }> {
  const lastDay = new Date(year, month, 0).getDate();
  const seen = new Set<string>();
  const out: Array<{ weekNo: number; start: string; end: string }> = [];
  for (let day = 1; day <= lastDay; day++) {
    const w = okrWorkWeek(`${year}-${pad(month)}-${pad(day)}`);
    if (seen.has(w.start)) continue;
    seen.add(w.start);
    const wm = weekMonthOf(w.start);
    if (wm.year !== year || wm.month !== month) continue;
    out.push({ weekNo: out.length + 1, ...w });
  }
  return out;
}

export const monthCycleId = (year: number, month: number) => `${year}-${pad(month)}`;
export const weekCycleId = (year: number, month: number, weekNo: number) => `${year}-${pad(month)}-W${weekNo}`;
// 오늘이 든 주차 — 그 주가 시작한 달 기준(10/1 목요일 → 9월 4주차 9/28~10/2, 10월 1주차는 10/5부터).
export function currentWeekOf(date: string): { year: number; month: number; weekNo: number } {
  const { start } = okrWorkWeek(date);
  const { year: y, month: m } = weekMonthOf(start);
  const wk = okrWeeksInMonth(y, m).find((w) => w.start === start);
  return { year: y, month: m, weekNo: wk ? wk.weekNo : 1 };
}
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
// 빈 달의 기본 틀 — Pillar 3개 × 병목현상 3개
export function defaultGoalTemplate(): OkrGoal[] {
  return renumberGoals(OKR_PILLARS.flatMap((p, pi) => [1, 2, 3].map((n) => ({ no: pi * 3 + n, pillar: p.full, bottleneck: `병목현상 ${n}`, objective: "", criteria: "" }))));
}
// 완료·해당없음이 아니면 사유와 개선계획을 둘 다 적어야 한다(2026-09-24 사용자). 해당없음은 근거자료에 '대상 0건'.
export const needsReasonPlan = (judgment: string) => { const j = normalizeJudgment(judgment); return !!j && j !== "완료" && j !== "해당없음"; };
export const isAlert = (judgment: string) => { const j = normalizeJudgment(judgment); return j === "미흡" || j === "미착수"; };

// ── Supabase ──
function normalizeGoals(raw: unknown[]): OkrGoal[] {
  return raw.map((g, i) => { const x = (g || {}) as Partial<OkrGoal>; return { no: Number(x.no) || i + 1, pillar: String(x.pillar || ""), bottleneck: String(x.bottleneck || ""), objective: String(x.objective || ""), criteria: String(x.criteria || ""), ...(x.html && typeof x.html === "object" ? { html: x.html } : {}) }; });
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
export function mergeGoals(base: OkrGoal[], local: OkrGoal[], server: OkrGoal[]): OkrGoal[] {
  if (same(local, base)) return server;
  if (same(server, base)) return local;
  const nos = (gs: OkrGoal[]) => gs.map((g) => g.no).join(",");
  if (nos(local) !== nos(base) || nos(server) !== nos(base)) return local; // 번호 구조가 어긋나면(삽입·삭제) 합칠 수 없다 — 내 것
  return local.map((g, i) => (same(g, base[i]) ? server[i] : g));
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

export type OkrQuarter = 1 | 2 | 3 | 4;
export function quarterOf(month: number): OkrQuarter { return Math.min(4, Math.max(1, Math.ceil(Number(month) / 3))) as OkrQuarter; }
export const quarterCycleId = (year: number, q: number) => `${year}-Q${q}`;
export function parseQuarterId(id: string): { year: number; quarter: OkrQuarter } | null {
  const m = String(id || "").match(/^(\d{4})-Q([1-4])$/);
  return m ? { year: Number(m[1]), quarter: Number(m[2]) as OkrQuarter } : null;
}
// 분기의 세 달 — [{year, month, id:'2026-10'}, …]
export function monthsOfQuarter(year: number, q: number): Array<{ year: number; month: number; id: string }> {
  const first = (q - 1) * 3 + 1;
  return [first, first + 1, first + 2].map((month) => ({ year, month, id: monthCycleId(year, month) }));
}
// 달이 든 분기 id
export const quarterIdOfMonth = (year: number, month: number) => quarterCycleId(year, quarterOf(month));

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
// 같은 번호·Pillar에 글만 비운 틀(없으면 3×3)
export function blankGoalsLike(goals: OkrGoal[]): OkrGoal[] {
  if (!goals.length) return defaultGoalTemplate().map((g) => ({ ...g, bottleneck: "" }));
  return goals.map((g) => ({ no: g.no, pillar: g.pillar, bottleneck: "", objective: "", criteria: "" }));
}

// 병목현상 글 — 옛 값처럼 "병목현상 1" 꼬리표뿐이면 빈 글. 글 앞에 꼬리표가 붙어 있으면 떼어 낸다.
export function bottleneckText(value: string): string {
  return String(value || "").replace(/^\s*병목\s*현상\s*\d+\s*[.:：)]?\s*/, "").trim();
}
const goalHasText = (g: OkrGoal) => !!(bottleneckText(g.bottleneck) || g.objective.trim() || g.criteria.trim());

// 이 기간 goals가 팀장이 정한 것인지(= 그대로 보여 줄지). 복사본('copy')이거나 글이 하나도 없으면 false.
export function isLeaderGoals(cycle: Pick<OkrCycle, "goals" | "goals_origin"> | null | undefined): boolean {
  if (!cycle) return false;
  if (cycle.goals_origin === "copy") return false;
  return cycle.goals.some(goalHasText);
}
// 화면에 쓸 goals — 달이 팀장 월 OKR이면 그 달 것, 아니면 분기 goals(읽기 전용). 분기도 비면 달 것 그대로(복사본이라도).
// 주차는 부모 달을 cycle로 넘긴다. 분기 행 자체를 넘기면 그 goals 그대로.
export function effectiveGoals(cycle: OkrCycle | null | undefined, quarter?: OkrCycle | null): OkrGoal[] {
  if (cycle?.kind === "quarter") return cycle.goals;
  if (cycle && isLeaderGoals(cycle)) return cycle.goals;
  if (quarter && quarter.goals.some(goalHasText)) return quarter.goals;
  return cycle?.goals || [];
}
// "팀장 n월 OKR 대기, 아래는 분기 OKR(읽기 전용)" 띠를 띄울지 — 달인데 팀장 goals가 아니고 분기 것을 대신 보여 줄 때
// 화면용 월 목표(2026-10-21 사용자 "11·12월 다 지워줘") — 월 OKR 이 아직 없으면(copy, 또는 goals 비어 있음, 또는 글 없음) 분기 글을 보여 주지 않는다.
// 바탕은 분기 Pillar 만 있는 빈 틀(blankGoalsLike, 분기가 없으면 빈 3×3). 손으로 만든 글 없는 틀(origin copy 아님 + 행 있음)은 그 틀 그대로.
// pending = 월 OKR 글이 아직 없음(안내 줄). effectiveGoals 는 그대로 두고 화면 층(OkrHub)만 이것을 쓴다.
export function monthScreenGoals(cycle: OkrCycle | null | undefined, quarter?: OkrCycle | null): { goals: OkrGoal[]; pending: boolean } {
  if (!cycle) return { goals: [], pending: false };
  if (cycle.kind === "quarter" || isLeaderGoals(cycle)) return { goals: cycle.goals, pending: false };
  if (cycle.goals_origin !== "copy" && cycle.goals.length) return { goals: cycle.goals, pending: true };
  return { goals: blankGoalsLike(quarter?.goals || []), pending: true };
}
export function goalsAreFromQuarter(cycle: OkrCycle | null | undefined, quarter?: OkrCycle | null): boolean {
  return !!cycle && cycle.kind !== "quarter" && !isLeaderGoals(cycle) && !!quarter && quarter.goals.some(goalHasText);
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
  const out = current.map((g) => {
    const p = pasted.find((x) => x.no === g.no);
    if (!p) return g;
    return { no: g.no, pillar: p.pillar || g.pillar, bottleneck: p.bottleneck, objective: p.objective, criteria: p.criteria.trim() ? p.criteria : g.criteria };
  });
  for (const p of pasted) if (!out.some((g) => g.no === p.no)) out.push({ ...p });
  return out.sort((a, b) => a.no - b.no);
}

// ── 상단 필터: [4분기] [10월] [11월] [12월] ──
export type OkrFilterItem = { id: string; label: string; kind: "quarter" | "month"; year: number; month: number; exists: boolean; legacy: boolean };
export const OKR_LEGACY_UNTIL = "2026-09"; // 이 달까지는 분기 행이 없는 옛 구조(월 종합 + 주차) 화면
export const isLegacyMonthId = (id: string) => /^\d{4}-\d{2}$/.test(id) && id <= OKR_LEGACY_UNTIL;
// today('YYYY-MM-DD', visits.ts kstDate())가 든 분기, 또는 pick으로 고른 분기의 [분기, 달×3]. 주차는 넣지 않는다.
// 3차(2026-10-21): 파트 탭(A~D)엔 [n분기]가 없다 — 통합집계 탭('all')일 때만 분기 칩을 남긴다
export const filterItemsForTab = (items: OkrFilterItem[], tab: string): OkrFilterItem[] => (tab === "all" ? items : items.filter((it) => it.kind !== "quarter"));
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
// 파트원 박스 아래 주차 칩 — okrWeeksInMonth 그대로에 id·짧은 이름("1주 10/5~9")만 붙임
export function weeksOfMonth(year: number, month: number): Array<{ id: string; weekNo: number; start: string; end: string; label: string }> {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return okrWeeksInMonth(year, month).map((w) => ({
    id: weekCycleId(year, month, w.weekNo), ...w,
    label: `${w.weekNo}주 ${md(w.start)}~${w.end.slice(5, 7) === w.start.slice(5, 7) ? Number(w.end.slice(8, 10)) : md(w.end)}`,
  }));
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
  return effectiveGoals(cycle, quarter).map((g) => {
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
    for (const m of months) for (const g of m.goals) if (!byNo.has(g.no)) byNo.set(g.no, g);
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
// 그 달 주차 기록 전체에서 미흡·미착수가 한 번이라도 있는 사람 — { 파트: [이름…] }
export function actionMembersInMonth(weekReports: OkrReport[], no: number): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const r of weekReports) {
    if (!r.member || !isAlert(resultRowFor(r, no).judgment)) continue;
    (out[r.team] ||= new Set()).add(r.member);
  }
  return Object.fromEntries(Object.keys(out).sort().map((t) => [t, [...out[t]].sort((a, b) => a.localeCompare(b, "ko"))]));
}
// 그 달 주차 팀원 판정 중 가장 나쁜 것 — 파트 종합판정 제안
export const worstInMonth = (weekReports: OkrReport[], team: string, no: number) => worstOfJudgments(weekReports.filter((r) => r.team === team && r.member).map((r) => resultRowFor(r, no).judgment));

// ── 2차 피드백(2026-10-20, docs/tasks/okr-feedback-2.md): 분기 → 월 → 파트 모두 '팀원 집계'와 같은 틀 ──
// 판정 출처: 'set' 사람이 고른 것 · 'suggest' 아래 단계에서 계산한 제안 · '' 없음
export type OkrJudgedCell = { judgment: OkrJudgment | ""; source: "set" | "suggest" | "" };
// judgment = 화면에 보일 값(manual이면 사람이 고른 것, 아니면 auto)
export type OkrRolledJudgment = { judgment: OkrJudgment | ""; auto: OkrJudgment | ""; manual: boolean };

// 주차 id 순서 — `2026-10-W4`는 `2026-10-W2`보다 늦다(문자열 비교면 W10 < W2가 되므로 숫자로)
const weekOrderKey = (id: string) => { const m = String(id || "").match(/^(.*)-W(\d+)$/); return m ? { head: m[1], w: Number(m[2]) } : { head: String(id || ""), w: 0 }; };
const laterWeek = (a: string, b: string) => { const x = weekOrderKey(a); const y = weekOrderKey(b); return x.head !== y.head ? x.head > y.head : x.w > y.w; };
// 그 달 주차 기록 중 이 파트의 '마지막 기록 주차' 판정 — 그 번호에 판정이 있는 가장 늦은 주차를 찾고,
// 그 주차 안에서 파트원 판정이 여럿이면 가장 나쁜 것(worstOfJudgments). 파트 행(member '')은 보지 않는다(worstInMonth와 같은 범위).
export function lastJudgmentInMonth(weekReports: OkrReport[], team: string, no: number): OkrJudgment | "" {
  const judged = weekReports
    .filter((r) => r.team === team && r.member)
    .map((r) => ({ id: r.cycle_id, j: normalizeJudgment(resultRowFor(r, no).judgment) }))
    .filter((x) => x.j);
  if (!judged.length) return "";
  const last = judged.reduce((acc, x) => (laterWeek(x.id, acc) ? x.id : acc), judged[0].id);
  return worstOfJudgments(judged.filter((x) => x.id === last).map((x) => x.j));
}
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
  let base: OkrGoal[] = quarter?.goals || [];
  if (!base.length) {
    const byNo = new Map<number, OkrGoal>();
    for (const m of months) for (const g of m.goals) if (!byNo.has(g.no)) byNo.set(g.no, g);
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
