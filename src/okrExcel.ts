/**
 * OKR 엑셀 내려받기 — 순수 변환(설계 docs/tasks/okr-excel-export-2026-10-28.md, 구현 A).
 *
 * 입력 = 로더(src/okrExcelExport.ts loadOkrExcelInput) 결과 객체, 출력 = 시트 5개의 { name, columns, rows }.
 * 셈은 새로 짜지 않는다: 분기 = okr.quarterRollup · 월 = okr.monthlyRollup · 보이는 행 = goalsForView + overlayGoals(OkrHub 와 같은 사슬)
 * · 판정 = normalizeJudgment · 요약 % = kpiCompute okrMemberShares·okrShareAverage·okrTeamMembers(홈 K19 와 같은 함수).
 * exceljs·Supabase 는 여기서 부르지 않는다(서식·다운로드는 okrExcelExport.ts).
 */
import {
  OKR_TEAMS, alertMonths, goalLayer, goalsForView, hasResultRows, judgmentCounts, monthlyRollup, monthScreenGoals, monthsOfQuarter,
  normalizeJudgment, overlayGoals, quarterRollup, resultRowFor, findReport, visibleGoals, weeksOfMonth,
  type OkrCycle, type OkrGoal, type OkrReport,
} from "./okr";
import { okrMemberShares, okrShareAverage, okrTeamMembers, okrWeekMemberRows, type OkrWeekFacts, type RosterMember } from "./kpi/kpiCompute";

/* ───────────── 입력 ───────────── */

/** 분기의 한 달. weekReports 의 cycle_id 는 정식 id(weekCycleId, `2026-10-W3`)로 맞춘 것 — 옛 id 행은 로더가 resolveWeekCycleId 로 읽고 cycle_id 를 정식 id 로 바꿔 넘긴다. */
export type OkrExcelMonthInput = {
  id: string; // `2026-10`
  year: number;
  month: number;
  cycle: OkrCycle | null; // 월 행(없으면 null)
  reports: OkrReport[]; // 월 행의 기록(getOkrReports(월 id)) — 파트 종합(member '')만 쓴다
  weekReports: OkrReport[]; // 그 달 주차 기록 전부(getOkrReports(주차 id) 합친 것, header·goals 포함)
  roster: RosterMember[] | null; // rosterFromMembers(members, {from: 월초, to: 월말}), 명단 실패면 null(보고자만)
};
export type OkrExcelInput = {
  year: number;
  quarter: number; // 1~4
  quarterCycle: OkrCycle | null; // `2026-Q4` 행
  months: OkrExcelMonthInput[]; // 분기의 세 달(빠진 달은 cycle null 로 봄 — 순서는 monthsOfQuarter 로 다시 맞춘다)
  today: string; // KST YYYY-MM-DD(visits.ts kstDate()) — 이 날 이후 시작 주차는 빼고, 지난 주차가 없는 달은 요약 "-"
  now: string; // 만든 시각 ISO(new Date().toISOString()) — 표시는 여기서 KST 로 바꾼다
  by: string; // 만든 사람(작성자 선택값)
  rosterFailed?: boolean; // 명단을 못 읽었으면 true → 요약 위 블록에 "명단을 못 읽어 보고자만 셈"
};

/* ───────────── 출력 ───────────── */

/** 열 종류 — 서식용. text 짧은 글 · long 긴 글(줄바꿈+위 정렬) · pct 0~100 정수(숫자면 `0"%"` 표시, 글이면 그대로) · num 정수 · judgment 판정(judgmentTone 으로 채움색) */
export type OkrExcelColumnKind = "text" | "long" | "pct" | "num" | "judgment";
export type OkrExcelColumn = { header: string; width: number; kind: OkrExcelColumnKind };
export type OkrExcelCell = string | number | null;
export type OkrExcelSheet = {
  name: string;
  columns: OkrExcelColumn[];
  rows: OkrExcelCell[][];
  /** false 면 columns[].header 로 머리행을 쓰지 않는다(요약 탭 — 머리는 subHeaderRows 의 행들). 기본 true(1행 머리·고정·autoFilter) */
  headerRow?: boolean;
  /** rows 안에서 머리 서식(굵게·남색)을 줄 행 번호(0부터, rows 기준) — 요약 탭의 팀 표·개인 표 머리 */
  subHeaderRows?: number[];
  /** rows 안에서 굵게만 줄 행(요약 위 블록 이름 칸, CS 합계 행) */
  boldRows?: number[];
  notes?: string[];
};
export type OkrExcelWorkbook = { fileName: string; sheets: OkrExcelSheet[]; weekRowCount: number };

export const OKR_EXCEL_SHEET_NAMES = ["요약", "분기 통합집계", "월 통합집계", "파트 종합", "주차 기록"] as const;
export const SUGGEST_MARK = "(제안)";
export const MISSING_MARK = "미작성";
export const ARCHIVED_MARK = "보관";

/** 판정 칸 채움 종류 — alert 미흡·미착수(연한 빨강) · partial 부분달성(연한 노랑) · done 완료(연한 초록) · na 해당없음(회색) · missing 미작성 · "" 채움 없음. "(제안)" 꼬리는 떼고 본다. */
export type OkrJudgmentTone = "alert" | "partial" | "done" | "na" | "missing" | "";
export function judgmentTone(value: OkrExcelCell): OkrJudgmentTone {
  const text = String(value ?? "").replace(SUGGEST_MARK, "").trim();
  if (text === MISSING_MARK) return "missing";
  const j = normalizeJudgment(text);
  if (j === "미흡" || j === "미착수") return "alert";
  if (j === "부분달성") return "partial";
  if (j === "완료") return "done";
  if (j === "해당없음") return "na";
  return "";
}

/** 판정 글 — 정규화(미달성→미흡, 달성→완료), 모르는 글은 그대로(공백만 정리) */
export const judgmentText = (raw: string | null | undefined): string => normalizeJudgment(String(raw || "")) || String(raw || "").trim();

export const okrExcelFileName = (year: number, quarter: number, today: string): string => `OKR_${year}Q${quarter}_${today}.xlsx`;

/** 엑셀 시트 이름 규칙(31자 이하, \ / ? * [ ] : 없음) */
export const isValidSheetName = (name: string): boolean => name.length > 0 && name.length <= 31 && !/[\\/?*[\]:]/.test(name);

/* ───────────── 공통 ───────────── */

const KST_DT = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
/** ISO → "YYYY-MM-DD HH:mm"(KST). 비거나 못 읽으면 "" */
export function kstDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : KST_DT.format(d);
}
const oneLine = (s: string | null | undefined) => String(s || "").replace(/\s*\r?\n\s*/g, " ").trim();
const plain = (s: string | null | undefined) => String(s || "").replace(/\r\n?/g, "\n").trim();
const lastEdit = (r?: Pick<OkrReport, "updated_at" | "updated_by">) => (r ? [kstDateTime(r.updated_at), String(r.updated_by || "").trim()].filter(Boolean).join(" · ") : "");
const LAYER_LABEL = { common: "공통", team: "파트 전용", member: "개인 전용" } as const;
const byKo = (a: string, b: string) => a.localeCompare(b, "ko");

type MonthCtx = {
  m: OkrExcelMonthInput;
  goals: OkrGoal[]; // 그 달 화면 목표(monthScreenGoals) — 층 행·보관 행 포함 한 벌
  pending: boolean; // 월 OKR 아직 없음
  weeks: ReturnType<typeof weeksOfMonth>;
  pastWeeks: ReturnType<typeof weeksOfMonth>; // 시작일 ≤ today
  facts: OkrWeekFacts; // kpiCompute 에 넘길 그 달 주차 사실(홈 kpiData 와 같은 모양)
};
function monthCtxs(input: OkrExcelInput): MonthCtx[] {
  const byId = new Map(input.months.map((m) => [m.id, m]));
  return monthsOfQuarter(input.year, input.quarter).map((q) => {
    const m = byId.get(q.id) || { id: q.id, year: q.year, month: q.month, cycle: null, reports: [], weekReports: [], roster: null };
    const screen = monthScreenGoals(m.cycle, input.quarterCycle);
    const weeks = weeksOfMonth(m.year, m.month);
    return {
      m, goals: screen.goals, pending: !m.cycle || screen.pending, weeks,
      pastWeeks: weeks.filter((w) => w.start <= input.today),
      facts: { id: weeks[0]?.id || "", weeks: weeks.map((w) => ({ id: w.id, weekNo: w.weekNo, label: `${w.weekNo}주` })), goals: screen.goals, reports: m.weekReports },
    };
  });
}
const quarterLabel = (input: OkrExcelInput) => {
  const ms = monthsOfQuarter(input.year, input.quarter);
  return `${input.year}년 ${input.quarter}분기 (${ms[0].month}~${ms[2].month}월)`;
};
const col = (header: string, width: number, kind: OkrExcelColumnKind = "text"): OkrExcelColumn => ({ header, width, kind });

/* ───────────── 탭 1 요약 ───────────── */

export const OKR_EXCEL_RULE = "개인 = 완료·해당없음 ÷ 판정 있는 목표, 팀 = 팀원 평균(미작성 0%), 판정 0 = 미작성 — 홈 KPI 와 같음";

/**
 * 요약 — 위 블록(기간·만든 시각·만든 사람·셈 규칙) + 팀 표 + 개인 표. 열 9개 공용 격자:
 * 팀 표  `파트 | (빈칸) | m1 % | m2 % | m3 % | 미흡 | 미착수 | 인원 | 비고`
 * 개인 표 `파트 | 이름 | m1 % | m2 % | m3 % | 미흡 | 미착수 | 작성 주차(n/지난 주차) | 비고("10월 미작성" 등)`
 * 월 % = okrShareAverage(okrMemberShares(그 달 주차 사실, 팀, 그 달 명단, 그 달 주차 전부)) — 판정 0 = "미작성", 지난 주차가 없는 달 = "-".
 * 미흡·미착수 = 분기 지난 주차의 개인 판정 행(okrWeekMemberRows) 개수 합 — 팀 행 = 그 팀 사람 합, CS 행 = 전체 합.
 */
export function summarySheet(input: OkrExcelInput): OkrExcelSheet {
  const ctxs = monthCtxs(input);
  const monthHeads = ctxs.map((c) => `${c.m.month}월 %`);
  const columns = [col("파트", 16), col("이름", 14), ...monthHeads.map((h) => col(h, 10, "pct")), col("미흡", 8, "num"), col("미착수", 8, "num"), col("인원·작성 주차", 14), col("비고", 24)];
  const rows: OkrExcelCell[][] = [];
  const boldRows: number[] = [];
  const subHeaderRows: number[] = [];
  const top: Array<[string, string]> = [["기간", quarterLabel(input)], ["만든 시각", kstDateTime(input.now)], ["만든 사람", input.by || ""], ["셈 규칙", OKR_EXCEL_RULE]];
  if (input.rosterFailed) top.push(["주의", "명단을 못 읽어 보고자만 셈"]);
  for (const [k, v] of top) { boldRows.push(rows.length); rows.push([k, v]); }
  rows.push([]);

  type Per = { team: string; byMonth: Array<{ shares: ReturnType<typeof okrMemberShares>; started: boolean }>; people: string[] };
  const per: Per[] = OKR_TEAMS.map((team) => {
    const byMonth = ctxs.map((c) => ({ shares: okrMemberShares(c.facts, team, c.m.roster, c.facts.weeks.map((w) => w.id)), started: c.pastWeeks.length > 0 }));
    const people: string[] = [];
    for (const c of ctxs) for (const name of okrTeamMembers(c.facts, team, c.m.roster)) if (!people.includes(name)) people.push(name);
    return { team, byMonth, people };
  });
  // 사람별 미흡·미착수·작성 주차 — 분기의 지난 주차, 그 달 그 팀 구성원일 때만
  const personStat = (team: string, name: string) => {
    let alert = 0, notStarted = 0, wrote = 0, due = 0;
    const monthCells: OkrExcelCell[] = [];
    const missing: string[] = [];
    ctxs.forEach((c, i) => {
      const member = okrTeamMembers(c.facts, team, c.m.roster).includes(name);
      const share = per.find((p) => p.team === team)!.byMonth[i].shares.find((s) => s.name === name);
      if (!c.pastWeeks.length || !member || !share) { monthCells.push("-"); return; }
      for (const w of c.pastWeeks) {
        const rows = okrWeekMemberRows(c.goals, c.m.weekReports, w.id, name, team);
        const counts = judgmentCounts(rows);
        alert += counts["미흡"]; notStarted += counts["미착수"];
        due += 1;
        const rep = c.m.weekReports.find((r) => r.cycle_id === w.id && r.member === name && r.team === team);
        if (rep && hasResultRows(rep.rows)) wrote += 1;
      }
      if (!share.judged) { monthCells.push(0); missing.push(`${c.m.month}월`); } else monthCells.push(Math.round((share.done / share.judged) * 100));
    });
    return { monthCells, alert, notStarted, wrote, due, missing };
  };
  const pctOf = (shares: ReturnType<typeof okrMemberShares>, started: boolean): OkrExcelCell => {
    if (!started) return "-";
    const v = okrShareAverage(shares);
    return v === null ? MISSING_MARK : v;
  };

  subHeaderRows.push(rows.length);
  rows.push(["파트", "", ...monthHeads, "미흡", "미착수", "인원", ""]);
  const teamTotals = per.map((p) => {
    const stats = p.people.map((n) => personStat(p.team, n));
    return { p, alert: stats.reduce((a, s) => a + s.alert, 0), notStarted: stats.reduce((a, s) => a + s.notStarted, 0) };
  });
  for (const t of teamTotals) rows.push([`${t.p.team}파트`, "", ...t.p.byMonth.map((b) => pctOf(b.shares, b.started)), t.alert, t.notStarted, t.p.people.length, ""]);
  boldRows.push(rows.length);
  rows.push([
    "CS 4파트(A~D)", "",
    ...ctxs.map((c, i) => pctOf(per.flatMap((p) => p.byMonth[i].shares), c.pastWeeks.length > 0)),
    teamTotals.reduce((a, t) => a + t.alert, 0), teamTotals.reduce((a, t) => a + t.notStarted, 0), per.reduce((a, p) => a + p.people.length, 0), "",
  ]);
  rows.push([]);

  subHeaderRows.push(rows.length);
  rows.push(["파트", "이름", ...monthHeads, "미흡", "미착수", "작성 주차", "비고"]);
  for (const p of per) {
    for (const name of [...p.people].sort(byKo)) {
      const s = personStat(p.team, name);
      rows.push([p.team, name, ...s.monthCells, s.alert, s.notStarted, `${s.wrote}/${s.due}`, s.missing.length ? `${s.missing.join("·")} ${MISSING_MARK}` : ""]);
    }
  }
  return { name: OKR_EXCEL_SHEET_NAMES[0], columns, rows, headerRow: false, subHeaderRows, boldRows };
}

/* ───────────── 탭 2 분기 통합집계 ───────────── */

/** 분기 — quarterRollup 그대로(보관 행 제외). 달 열은 분기 세 달 고정, 월 행이 없는 달은 빈칸 */
export function quarterSheet(input: OkrExcelInput): OkrExcelSheet {
  const ctxs = monthCtxs(input);
  const monthCycles = ctxs.map((c) => c.m.cycle).filter((c): c is OkrCycle => !!c);
  const rollup = quarterRollup(
    input.quarterCycle, monthCycles,
    Object.fromEntries(ctxs.map((c) => [c.m.id, c.m.reports])),
    Object.fromEntries(ctxs.map((c) => [c.m.id, c.m.weekReports])),
  );
  const columns = [
    col("번호", 6, "num"), col("Pillar", 22), col("병목현상", 36, "long"), col("목표", 40, "long"), col("달성기준", 40, "long"),
    ...ctxs.map((c) => col(`${c.m.month}월 CS`, 11, "judgment")),
    col("분기 종합", 11, "judgment"), col("분기 종합 출처", 12), col("조치·확인 필요 달", 16), col("결과·개선계획(메모)", 45, "long"),
  ];
  const rows: OkrExcelCell[][] = rollup.rows.map((r) => [
    r.no, oneLine(r.pillar), plain(r.bottleneck), plain(r.objective), plain(r.criteria),
    ...ctxs.map((c) => r.byMonth[c.m.id]?.judgment || ""),
    r.quarter.judgment, r.quarter.judgment ? (r.quarter.manual ? "직접" : "자동") : "",
    alertMonths(r.byMonth, rollup.months).join(", "),
    plain(input.quarterCycle?.feedback?.[String(r.no)]?.memo),
  ]);
  return { name: OKR_EXCEL_SHEET_NAMES[1], columns, rows };
}

/* ───────────── 탭 3 월 통합집계 ───────────── */

/** 월 — 세 달을 한 탭에, monthlyRollup(공통 행만·보관 제외). A~D 제안(마지막 주차)은 "부분달성(제안)". 월 OKR 이 없는 달은 "n월 OKR 아직 없음" 1행 */
export function monthSheet(input: OkrExcelInput): OkrExcelSheet {
  const columns = [
    col("월", 7), col("번호", 6, "num"), col("Pillar", 22), col("병목현상", 36, "long"), col("목표", 40, "long"), col("달성기준", 40, "long"),
    ...OKR_TEAMS.map((t) => col(t, 13, "judgment")),
    col("CS 종합", 11, "judgment"), col("CS 출처", 9), col("조치 필요 파트", 12), col("결과·개선계획(메모)", 45, "long"),
  ];
  const rows: OkrExcelCell[][] = [];
  for (const c of monthCtxs(input)) {
    const label = `${c.m.month}월`;
    if (!c.m.cycle || c.pending) { rows.push([label, null, "", "", `${c.m.month}월 OKR 아직 없음`]); continue; }
    for (const r of monthlyRollup(c.m.cycle, c.m.reports, input.quarterCycle, c.m.weekReports)) {
      rows.push([
        label, r.no, oneLine(r.pillar), plain(r.bottleneck), plain(r.objective), plain(r.criteria),
        ...OKR_TEAMS.map((t) => { const d = r.dots[t]; return !d.judgment ? "" : d.source === "suggest" ? `${d.judgment}${SUGGEST_MARK}` : d.judgment; }),
        r.cs.judgment, r.cs.judgment ? (r.cs.manual ? "직접" : "자동") : "",
        r.actionTeams.join(", "), plain(r.memo),
      ]);
    }
  }
  return { name: OKR_EXCEL_SHEET_NAMES[2], columns, rows };
}

/* ───────────── 탭 4 파트 종합 ───────────── */

/** 전용 행은 층 덮어쓰기를 얹지 않고 행 자체(OkrHub selfRows 와 같음) */
const selfRows = (shown: OkrGoal[], base: OkrGoal[]): OkrGoal[] => shown.map((g) => (g.scope ? base.find((b) => b.no === g.no) || g : g));

/** 그 달 그 파트 종합 탭에 보이는 행 — OkrHub teamGoalsOf(월): visibleGoals(goalsForView({team})) → overlayGoals(월 파트 종합 report.goals) → selfRows */
export function partScreenGoals(monthGoals: OkrGoal[], partReport: OkrReport | undefined, team: string): OkrGoal[] {
  return selfRows(overlayGoals(visibleGoals(goalsForView(monthGoals, { team })), partReport?.goals), monthGoals);
}

/** 파트 종합 — 달 × 파트 × (공통 + 그 파트 전용, 보관 제외). 월 행이 없는 달은 빼고, 월 OKR 이 없는 달은 파트 종합 기록이 있을 때만 */
export function partSheet(input: OkrExcelInput): OkrExcelSheet {
  const columns = [
    col("월", 7), col("파트", 6), col("번호", 6, "num"), col("행 구분", 10), col("Pillar", 22), col("병목현상", 30, "long"), col("목표", 40, "long"), col("달성기준", 40, "long"),
    col("실제결과", 45, "long"), col("판정", 11, "judgment"), col("사유", 36, "long"), col("개선계획", 36, "long"), col("근거자료", 30, "long"),
    col("파트장", 10), col("작성자", 10), col("마지막 수정", 24),
  ];
  const rows: OkrExcelCell[][] = [];
  for (const c of monthCtxs(input)) {
    if (!c.m.cycle) continue;
    const parts = c.m.reports.filter((r) => !r.member);
    if (c.pending && !parts.length) continue;
    for (const team of OKR_TEAMS) {
      const rep = findReport(parts, team, "");
      for (const g of partScreenGoals(c.goals, rep, team)) {
        const r = resultRowFor(rep, g.no);
        rows.push([
          `${c.m.month}월`, team, g.no, LAYER_LABEL[goalLayer(g)], oneLine(g.pillar), plain(g.bottleneck), plain(g.objective), plain(g.criteria),
          plain(r.actual), judgmentText(r.judgment), plain(r.reason), plain(r.plan), plain(r.evidence),
          rep?.header.leader?.trim() || "", rep?.header.author?.trim() || "", lastEdit(rep),
        ]);
      }
    }
  }
  return { name: OKR_EXCEL_SHEET_NAMES[3], columns, rows };
}

/* ───────────── 탭 5 주차 기록 ───────────── */

/**
 * 그 주 그 사람 탭에 보이는 행 + 보관 행 — OkrHub personGoalsOf(주차) 사슬에서 visibleGoals 만 뺀 것:
 * goalsForView({team, member}) → overlayGoals(그 주 파트 행 goals, keepEmpty) → overlayGoals(본인 goals, keepEmpty) → selfRows.
 * 보관 행(hidden)은 남긴다(홈 % 분모에 들어가므로, 엑셀은 "보관" 표시).
 */
export function personWeekGoals(monthGoals: OkrGoal[], weekPartReport: OkrReport | undefined, own: OkrReport | undefined, team: string, member: string): OkrGoal[] {
  const shown = goalsForView(monthGoals, { team, member });
  return selfRows(overlayGoals(overlayGoals(shown, weekPartReport?.goals, true), own?.goals, true), monthGoals);
}

/** 주차 기록 — 달 × 지난 주차(시작 ≤ today) × 파트 × 사람(가나다) × 행. 기록이 없는 사람은 판정 "미작성" 1행 */
export function weekSheet(input: OkrExcelInput): OkrExcelSheet {
  const columns = [
    col("월", 7), col("주차", 18), col("파트", 6), col("이름", 10), col("번호", 6, "num"), col("행 구분", 10), col("Pillar", 22), col("병목현상", 30, "long"),
    col("목표", 40, "long"), col("달성기준", 40, "long"), col("실제결과", 45, "long"), col("판정", 11, "judgment"),
    col("사유", 36, "long"), col("개선계획", 36, "long"), col("근거자료", 30, "long"), col("마지막 수정", 24),
  ];
  const rows: OkrExcelCell[][] = [];
  for (const c of monthCtxs(input)) {
    const label = `${c.m.month}월`;
    for (const w of c.pastWeeks) {
      const inWeek = c.m.weekReports.filter((r) => r.cycle_id === w.id);
      const weekLabel = `${label} ${w.label}`;
      for (const team of OKR_TEAMS) {
        const partRep = findReport(inWeek.filter((r) => !r.member), team, "");
        for (const name of [...okrTeamMembers(c.facts, team, c.m.roster)].sort(byKo)) {
          const own = inWeek.find((r) => r.team === team && r.member === name);
          if (!own) { rows.push([label, weekLabel, team, name, null, "", "", "", "", "", "", MISSING_MARK, "", "", "", ""]); continue; }
          for (const g of personWeekGoals(c.goals, partRep, own, team, name)) {
            const r = resultRowFor(own, g.no);
            rows.push([
              label, weekLabel, team, name, g.no, g.hidden ? ARCHIVED_MARK : LAYER_LABEL[goalLayer(g)], oneLine(g.pillar), plain(g.bottleneck),
              plain(g.objective), plain(g.criteria), plain(r.actual), judgmentText(r.judgment),
              plain(r.reason), plain(r.plan), plain(r.evidence), lastEdit(own),
            ]);
          }
        }
      }
    }
  }
  return { name: OKR_EXCEL_SHEET_NAMES[4], columns, rows, notes: ["보관 = 화면에서 숨긴 행(홈 % 분모에는 들어간다)", "미작성 = 명단에 있으나 그 주 기록이 없는 사람"] };
}

/* ───────────── 한 파일 ───────────── */

export function buildOkrWorkbookData(input: OkrExcelInput): OkrExcelWorkbook {
  const week = weekSheet(input);
  return {
    fileName: okrExcelFileName(input.year, input.quarter, input.today),
    sheets: [summarySheet(input), quarterSheet(input), monthSheet(input), partSheet(input), week],
    weekRowCount: week.rows.length,
  };
}

