/**
 * OKR 순수 규칙 — 앱(src/okr.ts·src/kpi/kpiCompute.ts 가 다시 내보냄)과 엣지 함수(data-ask 분석 도구)가 같은 코드로 센다(2026-10-29).
 * 통합검색 "무엇이든 묻기" 설계안 docs/tasks/search-ask-everything-2026-10-29.md 3-6·5장 — 화면 숫자와 답 숫자가 어긋나지 않게.
 * 브라우저·Deno 공용 — import 없음. 여기 함수 본문은 2026-10-29 에 src/okr.ts·kpiCompute.ts 에서 글자 그대로 옮긴 것이다.
 */

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
// hidden(2026-10-25): 보관한 행 — 실제결과·판정 기록이 있는 행을 지우면 지우는 대신 숨긴다(표에서 안 보임, 홈 지난 주차 % 는 그대로 셈). docs/tasks/okr-rows-add-remove-2026-10-25.md
// scope(2026-10-25 저녁): 행의 주인 층 — 없음 = 공통(팀장, A~D 전부) · {team} = 그 파트 전용 · {team, member} = 그 사람 전용. 월 행에만(분기 행엔 없음).
//   층 행 번호는 101부터(전역 유일). docs/tasks/okr-rows-per-layer-2026-10-25.md
export type OkrGoalScope = { team: OkrTeam; member?: string };
export type OkrGoalLayer = "common" | "team" | "member";
export type OkrGoalView = { team?: OkrTeam | string; member?: string };
export type OkrGoal = { no: number; pillar: string; bottleneck: string; objective: string; criteria: string; hidden?: boolean; scope?: OkrGoalScope; html?: { objective?: string; criteria?: string; bottleneck?: string; objectiveSet?: "1"; bottleneckSet?: "1"; criteriaSet?: "1" } };
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

// 목표 번호를 1부터 다시 매긴다(행 삭제·추가 후)
export function renumberGoals(goals: OkrGoal[]): OkrGoal[] {
  return goals.map((g, i) => ({ ...g, no: i + 1 }));
}

// 빈 달의 기본 틀 — Pillar 3개 × 병목현상 3개
export function defaultGoalTemplate(): OkrGoal[] {
  return renumberGoals(OKR_PILLARS.flatMap((p, pi) => [1, 2, 3].map((n) => ({ no: pi * 3 + n, pillar: p.full, bottleneck: `병목현상 ${n}`, objective: "", criteria: "" }))));
}
// 완료·해당없음이 아니면 사유와 개선계획을 둘 다 적어야 한다(2026-09-24 사용자). 해당없음은 근거자료에 '대상 0건'.
export const needsReasonPlan = (judgment: string) => { const j = normalizeJudgment(judgment); return !!j && j !== "완료" && j !== "해당없음"; };
export const isAlert = (judgment: string) => { const j = normalizeJudgment(judgment); return j === "미흡" || j === "미착수"; };

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

// 같은 번호·Pillar에 글만 비운 틀(없으면 3×3)
// 층 행(scope)은 보지 않는다 — 공통 행만으로 틀을 만든다(층 행은 replaceCommonGoals 가 따로 지킨다, 2026-10-25 저녁).
export function blankGoalsLike(goals: OkrGoal[]): OkrGoal[] {
  goals = commonGoalsOf(goals);
  if (!goals.length) return defaultGoalTemplate().map((g) => ({ ...g, bottleneck: "" }));
  return goals.map((g) => ({ no: g.no, pillar: g.pillar, bottleneck: "", objective: "", criteria: "", ...(g.hidden ? { hidden: true } : {}) })); // 보관 행은 복사본에서도 숨김
}

// 병목현상 글 — 옛 값처럼 "병목현상 1" 꼬리표뿐이면 빈 글. 글 앞에 꼬리표가 붙어 있으면 떼어 낸다.
export function bottleneckText(value: string): string {
  return String(value || "").replace(/^\s*병목\s*현상\s*\d+\s*[.:：)]?\s*/, "").trim();
}
export const goalHasText = (g: OkrGoal) => !!(bottleneckText(g.bottleneck) || g.objective.trim() || g.criteria.trim());

// ── 행의 주인 층(2026-10-25 저녁, docs/tasks/okr-rows-per-layer-2026-10-25.md 3-1) ──
export function goalLayer(g: Pick<OkrGoal, "scope">): OkrGoalLayer {
  if (!g.scope) return "common";
  return g.scope.member ? "member" : "team";
}
export const isLayerGoal = (g: Pick<OkrGoal, "scope">): boolean => !!g.scope;
export const isCommonGoal = (g: Pick<OkrGoal, "scope">): boolean => !g.scope;
export const commonGoalsOf = (goals: OkrGoal[]): OkrGoal[] => goals.filter(isCommonGoal);
// 통째 교체 때 지킬 행(scope 있는 행)
export const layerRowsOf = (goals: OkrGoal[]): OkrGoal[] => goals.filter(isLayerGoal);

// 이 행이 그 화면(view)의 판정·실제결과 대상인지(= 예전 goalsForView 의 거르기, 2026-10-25 밤 이름만 옮김).
//   통합집계({}) = 공통만 / 파트 종합({team}) = 공통 + 그 파트 전용 / 파트원({team, member}) = 공통 + 그 파트 전용 + 본인 전용.
//   다른 층 행은 화면에 보이되(goalsForView) 판정 칸이 잠긴다 — 홈 개인 % 분모(kpiCompute okrWeekMemberRows)도 이것.
export function goalAppliesTo(g: Pick<OkrGoal, "scope">, view: OkrGoalView = {}): boolean {
  if (!g.scope) return true;
  if (!view.team || g.scope.team !== view.team) return false;
  return !g.scope.member || (!!view.member && g.scope.member === view.member);
}
export const goalsApplyingTo = (goals: OkrGoal[], view: OkrGoalView = {}): OkrGoal[] => goals.filter((g) => goalAppliesTo(g, view));

// 파트 % 집계·팀원 집계용 — 공통 + 그 파트 전용 + 그 파트 사람들의 개인 전용 전부
export function goalsForTeamTotal(goals: OkrGoal[], team: OkrTeam | string): OkrGoal[] {
  return goals.filter((g) => !g.scope || g.scope.team === team);
}

// 이 기간 goals가 팀장이 정한 것인지(= 그대로 보여 줄지). 복사본('copy')이거나 글이 하나도 없으면 false.
export function isLeaderGoals(cycle: Pick<OkrCycle, "goals" | "goals_origin"> | null | undefined): boolean {
  if (!cycle) return false;
  if (cycle.goals_origin === "copy") return false;
  return commonGoalsOf(cycle.goals).some(goalHasText); // 층 행 글만 있으면 팀장 월 OKR 아님(2026-10-25 저녁)
}
// 화면에 쓸 goals — 달이 팀장 월 OKR이면 그 달 것, 아니면 분기 goals(읽기 전용). 분기도 비면 달 것 그대로(복사본이라도).
// 주차는 부모 달을 cycle로 넘긴다. 분기 행 자체를 넘기면 그 goals 그대로.
export function effectiveGoals(cycle: OkrCycle | null | undefined, quarter?: OkrCycle | null): OkrGoal[] {
  if (cycle?.kind === "quarter") return cycle.goals;
  if (cycle && isLeaderGoals(cycle)) return cycle.goals;
  if (quarter && commonGoalsOf(quarter.goals).some(goalHasText)) { // 분기 글을 대신 보여도 그 달 층 행은 뒤에(2026-10-25 저녁)
    const layers = layerRowsOf(cycle?.goals || []);
    const qCommon = commonGoalsOf(quarter.goals);
    return layers.length || qCommon.length !== quarter.goals.length ? [...qCommon, ...layers] : quarter.goals;
  }
  return cycle?.goals || [];
}
// "팀장 n월 OKR 대기, 아래는 분기 OKR(읽기 전용)" 띠를 띄울지 — 달인데 팀장 goals가 아니고 분기 것을 대신 보여 줄 때
// 화면용 월 목표(2026-10-21 사용자 "11·12월 다 지워줘") — 월 OKR 이 아직 없으면(copy, 또는 goals 비어 있음, 또는 글 없음) 분기 글을 보여 주지 않는다.
// 바탕은 분기 Pillar 만 있는 빈 틀(blankGoalsLike, 분기가 없으면 빈 3×3). 손으로 만든 글 없는 틀(origin copy 아님 + 행 있음)은 그 틀 그대로.
// pending = 월 OKR 글이 아직 없음(안내 줄). effectiveGoals 는 그대로 두고 화면 층(OkrHub)만 이것을 쓴다.
export function monthScreenGoals(cycle: OkrCycle | null | undefined, quarter?: OkrCycle | null): { goals: OkrGoal[]; pending: boolean } {
  if (!cycle) return { goals: [], pending: false };
  if (cycle.kind === "quarter" || isLeaderGoals(cycle)) return { goals: cycle.goals, pending: false };
  if (cycle.goals_origin !== "copy" && commonGoalsOf(cycle.goals).length) return { goals: cycle.goals, pending: true };
  return { goals: [...blankGoalsLike(quarter?.goals || []), ...layerRowsOf(cycle.goals)], pending: true }; // 빈 틀이어도 그 달 층 행은 남긴다
}
export function goalsAreFromQuarter(cycle: OkrCycle | null | undefined, quarter?: OkrCycle | null): boolean {
  return !!cycle && cycle.kind !== "quarter" && !isLeaderGoals(cycle) && !!quarter && commonGoalsOf(quarter.goals).some(goalHasText);
}

export const OKR_LEGACY_UNTIL = "2026-09"; // 이 달까지는 분기 행이 없는 옛 구조(월 종합 + 주차) 화면
export const isLegacyMonthId = (id: string) => /^\d{4}-\d{2}$/.test(id) && id <= OKR_LEGACY_UNTIL;

// 파트원 박스 아래 주차 칩 — okrWeeksInMonth 그대로에 id·짧은 이름("1주 10/5~9")만 붙임
export function weeksOfMonth(year: number, month: number): Array<{ id: string; weekNo: number; start: string; end: string; label: string }> {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return okrWeeksInMonth(year, month).map((w) => ({
    id: weekCycleId(year, month, w.weekNo), ...w,
    label: `${w.weekNo}주 ${md(w.start)}~${w.end.slice(5, 7) === w.start.slice(5, 7) ? Number(w.end.slice(8, 10)) : md(w.end)}`,
  }));
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

/* ───────────── kpiCompute 에서 옮긴 주 단위 OKR 셈(K19) ───────────── */

/** 명단 한 사람(kpiCompute RosterMember 와 같은 꼴) */
export type OkrRosterLite = { name: string; team: string; title?: string };

/**
 * 주 단위 OKR(2026-10-24 사용자 "프로들은 주만 쓴다"): 이번 주 id(weekCycleId)·그 달 주차 목록·그 달 화면 목표·그 달 주차 기록 전부.
 * goals = 주차가 속한 달의 monthScreenGoals(옛 달은 달 goals) — OKR 화면이 주차에 쓰는 목표와 같다.
 */
export type OkrWeekFacts = { id: string; weeks: Array<{ id: string; weekNo: number; label: string }>; goals: OkrGoal[]; reports: OkrReport[] };

/**
 * 한 파트의 그 주 판정 행: 목표마다 파트 종합(member '') 판정이 있으면 그것, 없으면 그 주 팀원 판정 중 가장 나쁜 것
 * (okr.lastJudgmentInMonth 가 주 하나에 쓰는 규칙과 같다 — worstOfJudgments). 판정이 하나도 없으면 빈 판정 행.
 */
export function okrWeekTeamRows(goals: OkrGoal[], reports: OkrReport[], weekId: string, team: string): OkrResultRow[] {
  const inWeek = reports.filter((r) => r.cycle_id === weekId && r.team === team);
  const summary = findReport(inWeek.filter((r) => !r.member), team, "");
  const members = inWeek.filter((r) => r.member);
  return goalsForTeamTotal(goals, team).map((g) => {
    const own = resultRowFor(summary, g.no);
    if (normalizeJudgment(own.judgment)) return own;
    return { ...emptyResultRow(g.no), judgment: worstOfJudgments(members.map((m) => resultRowFor(m, g.no).judgment)) };
  });
}

export type OkrWeekResult = {
  /** A~D 전체 달성률 = 구성원(명단 ∪ 보고자) 개인 달성률 평균, 미작성 0%(2026-10-26). 판정이 하나도 없으면 null(0% 아님) */
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
  // 그 사람 판정 대상 행 = 공통 + 그 파트 전용 + 본인 전용 (파트는 기록의 team, 없으면 넘겨받은 team).
  // 2026-10-25 밤 화면엔 남의 전용 행도 보이지만(goalsForView) 홈 분모는 판정 대상만(goalsApplyingTo) — % 불변.
  const t = rep?.team ?? (team && team !== "ALL" ? team : undefined);
  return goalsApplyingTo(goals, { team: t, member }).map((g) => resultRowFor(rep, g.no));
}

/** 개인 고르기 목록 — 그 달 주차 기록(w.reports)에 member 행이 있는 사람(이름순). team ALL 이면 A~D 전부 */
export function okrWeekMembers(w: OkrWeekFacts, team: OkrScopeTeam = "ALL"): string[] {
  const names = new Set(w.reports.filter((r) => r.member && (team === "ALL" ? (OKR_TEAMS as readonly string[]).includes(r.team) : r.team === team)).map((r) => r.member));
  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

/* ── 팀 달성률 = 팀원별 달성률 평균(2026-10-26 사용자 "A팀은 1명만 썼는데 C팀(2명 작성)보다 높다 · 3명인 팀과 4명인 팀의 차이" → 팀장 결정) ──
 * 구성원 = 명단(그 팀·팀장 제외) ∪ 그 달 주차 기록에 그 팀으로 개인 보고를 낸 사람(homeKpiModel.okrPeopleForTeam 과 같은 집합).
 * 개인 = 그 기간 자기 판정 행 중 완료·해당없음 비율, 판정 0 = 미작성 = 0%. 팀 = 평균, 전체 = A~D 구성원 전부 평균(사람마다 같은 무게).
 * 그 범위에 판정이 하나도 없으면 null("미작성", 0% 로 그리지 않는다 — 종전 규칙 유지). */

/** 팀 구성원 이름(순서 = 보고자 이름순 → 명단 순) */
export function okrTeamMembers(w: OkrWeekFacts, team: string, roster?: OkrRosterLite[] | null): string[] {
  const names = new Set<string>((OKR_TEAMS as readonly string[]).includes(team) ? okrWeekMembers(w, team as OkrScopeTeam) : []);
  for (const m of roster ?? []) if (m.team === team && m.title !== "팀장" && m.name) names.add(m.name);
  return [...names];
}

/** 한 사람 몫 — done/judged 는 판정 개수(완료·해당없음 / 판정 있는 목표), judged 0 = 미작성 */
export type OkrMemberShare = { team: string; name: string; done: number; judged: number };

/** 그 팀 구성원 각자의 weekIds(주 하나 또는 그 달 주차 전부) 판정 몫 */
export function okrMemberShares(w: OkrWeekFacts, team: string, roster: OkrRosterLite[] | null | undefined, weekIds: string[]): OkrMemberShare[] {
  return okrTeamMembers(w, team, roster).map((name) => {
    const rows = weekIds.flatMap((id) => okrWeekMemberRows(w.goals, w.reports, id, name, team));
    const judged = rows.filter((x) => normalizeJudgment(x.judgment));
    return { team, name, done: judged.filter((x) => ["완료", "해당없음"].includes(normalizeJudgment(x.judgment))).length, judged: judged.length };
  });
}

/** 구성원 평균 %(반올림) — 미작성 0%. 아무도 판정이 없으면 null */
export function okrShareAverage(shares: OkrMemberShare[]): number | null {
  if (!shares.some((x) => x.judged > 0)) return null;
  return Math.round((shares.reduce((a, x) => a + (x.judged ? x.done / x.judged : 0), 0) / shares.length) * 100);
}

/**
 * 주 OKR 결과. scope 없음/ALL = A~D 전체. 팀 = 그 파트만. pct·byTeam = 팀원별 달성률 평균(미작성 0%, roster = 명단 — 없으면 보고자만),
 * counts·missingTeams = 파트 판정 행(파트 종합 → 없으면 팀원 중 가장 나쁜 것, 종전).
 * member = 그 사람 member 행 판정만(missingTeams 는 비고, 판정 없으면 pct null).
 */
export function okrWeekResult(w: OkrWeekFacts, weekId: string = w.id, scope?: OkrScope, roster?: OkrRosterLite[] | null): OkrWeekResult {
  if (scope?.member) {
    const rows = okrWeekMemberRows(w.goals, w.reports, weekId, scope.member, scope.team);
    const team = w.reports.find((r) => r.cycle_id === weekId && r.member === scope.member)?.team ?? (scope.team === "ALL" ? "" : scope.team);
    return { pct: achievementRate(rows), counts: judgmentCounts(rows), missingTeams: [], byTeam: team ? [{ team, pct: achievementRate(rows) }] : [] };
  }
  const teams = !scope || scope.team === "ALL" ? [...OKR_TEAMS] as string[] : [scope.team];
  // 판정 개수·미작성 팀은 파트 판정 행(종전), % 는 팀원별 달성률 평균(미작성 0%, 2026-10-26)
  const per = teams.map((team) => ({ team, rows: okrWeekTeamRows(w.goals, w.reports, weekId, team), shares: okrMemberShares(w, team, roster, [weekId]) }));
  const all = per.flatMap((p) => p.rows);
  return {
    pct: okrShareAverage(per.flatMap((p) => p.shares)),
    counts: judgmentCounts(all),
    missingTeams: per.filter((p) => !p.rows.some((x) => normalizeJudgment(x.judgment))).map((p) => p.team),
    byTeam: per.map((p) => ({ team: p.team, pct: okrShareAverage(p.shares) })),
  };
}

/* ───────────── OKR 작성 품질 검사(2026-10-29, 통합검색 분석 도구 T1 — 설계안 5-3) ───────────── */

/** 검사 번호 1~9 — 설계안 5-3 "OKR 작성 품질 검사" 순서 그대로 */
export type OkrCheckNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const OKR_CHECK_LABELS: Record<OkrCheckNo, string> = {
  1: "판정 없음(그 주 미작성 목표)",
  2: "실제결과에 숫자 없음",
  3: "사유 빈칸(부분달성·미흡·미착수)",
  4: "개선계획 빈칸(미흡·미착수)",
  5: "해당없음인데 근거에 '대상 0건' 없음",
  6: "실제결과 속 %·등급과 고른 판정이 다름",
  7: "근거자료 빈칸",
  8: "앞 주와 실제결과가 같은 문장(복붙)",
  9: "쪼갠 달성기준 없이 월 기준 그대로",
};
/** 검사 결과 한 줄 — no 0 = 목표가 아니라 그 주 전체(기록 없음) */
export type OkrWritingIssue = { week: string; no: number; check: OkrCheckNo; label: string; judgment: OkrJudgment | ""; text: string };
/** 한 주 입력 — goals = 그 주 화면 목표(monthScreenGoals), report = 그 사람 그 주 member 행, teamGoals = 파트 종합 행의 달성기준 덮어쓰기(있으면) */
export type OkrWritingWeek = { id: string; goals: OkrGoal[]; report?: OkrReport | null; teamGoals?: OkrGoal[] };

const clip = (s: string, n = 160) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const sameText = (a: string, b: string) => { const x = String(a || "").replace(/\s+/g, " ").trim(); return !!x && x === String(b || "").replace(/\s+/g, " ").trim(); };
const hasSplitCriteria = (list: OkrGoal[] | undefined, no: number) => !!list?.some((g) => g.no === no && g.criteria.trim());

/**
 * 한 사람의 주차 기록(weeks — 앞 주부터 순서대로)을 목표 행마다 9가지로 검사한다.
 * 판정 대상 행 = goalsApplyingTo(공통 + 그 파트 전용 + 본인 전용, 홈 개인 % 분모와 같음) 중 보관(hidden) 행 제외.
 * 판정이 빈 행은 1번만 본다(나머지는 판정을 고른 뒤의 규칙). 기록 자체가 없는 주는 no 0 으로 1번 한 줄.
 */
export function okrWritingChecks(weeks: OkrWritingWeek[], who: { member: string; team?: string }): OkrWritingIssue[] {
  const out: OkrWritingIssue[] = [];
  let prev: OkrReport | null | undefined = null;
  for (const w of weeks) {
    const team = w.report?.team || who.team;
    const goals = goalsApplyingTo(w.goals, { team, member: who.member }).filter((g) => !g.hidden);
    const push = (no: number, check: OkrCheckNo, judgment: OkrJudgment | "", text: string) => out.push({ week: w.id, no, check, label: OKR_CHECK_LABELS[check], judgment, text: clip(text) });
    if (!w.report || !w.report.rows.some((r) => r.actual.trim() || normalizeJudgment(r.judgment))) {
      if (goals.length) push(0, 1, "", "그 주 기록 없음");
      prev = w.report;
      continue;
    }
    for (const g of goals) {
      const row = resultRowFor(w.report, g.no);
      const j = normalizeJudgment(row.judgment);
      if (!j) { push(g.no, 1, "", row.actual || g.objective); continue; }
      if (j !== "해당없음" && !/\d/.test(row.actual)) push(g.no, 2, j, row.actual || "(실제결과 빈칸)");
      if (needsReasonPlan(j) && !row.reason.trim()) push(g.no, 3, j, row.actual);
      if ((j === "미흡" || j === "미착수") && !row.plan.trim()) push(g.no, 4, j, row.reason || row.actual);
      if (j === "해당없음" && !/대상\s*0\s*건/.test(row.evidence)) push(g.no, 5, j, row.evidence || "(근거자료 빈칸)");
      const auto = worstJudgment(row.actual);
      if (auto && auto !== j) push(g.no, 6, j, `글에서 읽은 판정 ${auto} · 고른 판정 ${j} — ${row.actual}`);
      if (j !== "해당없음" && !row.evidence.trim()) push(g.no, 7, j, row.actual);
      if (prev && sameText(row.actual, resultRowFor(prev, g.no).actual)) push(g.no, 8, j, row.actual);
      if (!g.scope && !hasSplitCriteria(w.report.goals, g.no) && !hasSplitCriteria(w.teamGoals, g.no)) push(g.no, 9, j, g.criteria || "(월 달성기준 빈칸)");
    }
    prev = w.report;
  }
  return out;
}

/** 검사 번호별 건수(1~9 전부, 0 포함) */
export function okrWritingSummary(issues: OkrWritingIssue[]): Record<OkrCheckNo, number> {
  const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 } as Record<OkrCheckNo, number>;
  for (const i of issues) out[i.check] += 1;
  return out;
}
