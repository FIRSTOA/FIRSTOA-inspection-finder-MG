import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OKR_PILLARS, actionMembersInMonth, applyPastedGoals, bottleneckText, cycleKindOf, cycleLabel, defaultCycleTitle, effectiveGoals, emptyReport,
  goalsAreFromQuarter, isLeaderGoals, mergeCycle, mergeMonthActuals, monthDraftFromQuarter, monthlyRollup, monthsOfQuarter, okrCyclePayload,
  parseOkrPaste, parseQuarterId, quarterCycleId, quarterDraft, quarterOf, quarterProgress, splitTsv, topFilterItems, weeksOfMonth,
  directionSteps, lastJudgmentInMonth, lastOfJudgments, mergeFeedback, monthCsJudgment, overlayCriteria, overlayGoals, partMonthJudgment,
  prevGoalsToCarry, putGoalField, quarterCsJudgment, quarterRollup, filterItemsForTab, quarterNowMonth, alertMonths, quarterTeamCard, monthScreenGoals,
  type OkrCycle, type OkrGoal, type OkrJudgedCell, type OkrReport, type OkrTeam,
} from "../src/okr";
import { showsWeekChips } from "../src/okrUi";

type Doc = { id: string; direction: string; goals: OkrGoal[] };
const load = (name: string): Doc => JSON.parse(readFileSync(resolve(__dirname, "../docs/okr", name), "utf8"));
const Q4 = load("2026-Q4-okr.json");
const OCT = load("2026-10-okr.json");

// 전사본 goals를 팀장 문서 글 꼴로 되돌린다(카톡에서 복사한 모양)
function toDocText(doc: Doc, opts: { inline?: boolean } = {}): string {
  const out: string[] = ["CS팀 OKR", ""];
  if (doc.direction) out.push("★ 핵심방향 ★", ...doc.direction.split("\n"), "");
  OKR_PILLARS.forEach((p, pi) => {
    out.push(`Pillar ${pi + 1}  ${p.label}`);
    for (let n = 1; n <= 3; n++) {
      const g = doc.goals.find((x) => x.no === pi * 3 + n) as OkrGoal;
      if (opts.inline) out.push(`병목현상 ${n}  ${g.bottleneck}`, `목표 ${n}: ${g.objective}`);
      else out.push(`병목현상 ${n}`, g.bottleneck, `목표 ${n}`, g.objective);
      out.push(`실행 ${n}`, ...g.criteria.split("\n"), "");
    }
  });
  return out.join("\n");
}
const tsvCell = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const cyc = (over: Partial<OkrCycle>): OkrCycle => ({ id: "2026-10", kind: "month", title: "", year: 2026, month: 10, week_no: null, start_date: "2026-10-01", end_date: "2026-10-31", parent_id: null, goals: [], feedback: {}, ...over });
const rep = (cycleId: string, team: string, member: string, rows: Array<[number, string, string]>): OkrReport => ({ ...emptyReport(cycleId, team, member), rows: rows.map(([no, actual, judgment]) => ({ no, actual, judgment, reason: "", plan: "", evidence: "" })) });

describe("분기 id·이름", () => {
  it("분기 계산과 id", () => {
    expect([1, 3, 4, 9, 10, 12].map(quarterOf)).toEqual([1, 1, 2, 3, 4, 4]);
    expect(quarterCycleId(2026, 4)).toBe("2026-Q4");
    expect(parseQuarterId("2026-Q4")).toEqual({ year: 2026, quarter: 4 });
    expect(parseQuarterId("2026-10")).toBeNull();
    expect(monthsOfQuarter(2026, 4).map((m) => m.id)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });
  it("분기 이름과 제목, 분기 행을 달로 읽지 않는다", () => {
    expect(cycleLabel({ kind: "quarter", year: 2026, month: 10, week_no: null })).toBe("2026년 4분기");
    expect(defaultCycleTitle({ kind: "quarter", year: 2026, month: 10, week_no: null })).toBe("CS팀 4분기 OKR");
    expect(cycleKindOf("quarter", "2026-Q4")).toBe("quarter");
    expect(cycleKindOf("month", "2026-Q4")).toBe("quarter"); // id 꼴로도 알아봄
    expect(cycleKindOf("week", "2026-10-W1")).toBe("week");
    expect(cycleKindOf(undefined, "2026-10")).toBe("month");
    const q = quarterDraft(2026, 4);
    expect([q.id, q.kind, q.month, q.start_date, q.end_date, q.goals.length]).toEqual(["2026-Q4", "quarter", 10, "2026-10-01", "2026-12-31", 9]);
  });
});

describe("붙여넣기 파서 — 팀장 문서 글", () => {
  it("4분기 전사본을 글로 되돌린 것에서 9묶음이 그대로 복원된다", () => {
    const r = parseOkrPaste(toDocText(Q4));
    expect(r.warnings).toEqual([]);
    expect(r.direction).toBe("");
    expect(r.goals).toEqual(Q4.goals);
  });
  it("10월 전사본: ★핵심방향★ 문단과 9묶음", () => {
    const r = parseOkrPaste(toDocText(OCT));
    expect(r.warnings).toEqual([]);
    expect(r.direction).toBe(OCT.direction);
    expect(r.goals).toEqual(OCT.goals);
    expect(r.goals.map((g) => g.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.goals[4].pillar).toBe("Pillar 2.\n매출증대 · 안정");
  });
  it("머리줄 옆에 글이 붙어 있어도, 불릿 줄이 접혀 다음 줄로 넘어가도 읽는다", () => {
    expect(parseOkrPaste(toDocText(OCT, { inline: true })).goals).toEqual(OCT.goals);
    const r = parseOkrPaste("Pillar 1. AI\n병목현상 1 막힘\n목표 1 하자\n실행 1\n· 첫째 줄이\n길어서 접힘\n• 둘째\n");
    expect(r.goals[0].criteria).toBe("· 첫째 줄이 길어서 접힘\n• 둘째");
    expect(r.goals[0].pillar).toBe(OKR_PILLARS[0].full);
  });
  it("본문 '목표 1건 이상' 같은 줄은 머리줄로 오해하지 않는다", () => {
    const r = parseOkrPaste("Pillar 2\n병목현상 1\n방문이 적다\n목표 1\n목표 1건 이상 방문한다\n실행 1\n· 간다");
    expect(r.goals).toHaveLength(1);
    expect(r.goals[0]).toMatchObject({ no: 4, bottleneck: "방문이 적다", objective: "목표 1건 이상 방문한다" });
  });
  it("빠진 칸은 경고, 머리가 하나도 없으면 빈 목록과 경고", () => {
    const r = parseOkrPaste("Pillar 3\n병목현상 2\n소통\n목표 2\n맞춘다");
    expect(r.goals.map((g) => g.no)).toEqual([8]);
    expect(r.warnings).toContain("Pillar 3 병목 2: 실행 없음");
    expect(r.warnings.some((w) => w.includes("9개가 아님"))).toBe(true);
    const none = parseOkrPaste("그냥 아무 글\n두 번째 줄");
    expect(none.goals).toEqual([]);
    expect(none.warnings).toHaveLength(1);
  });
});

describe("붙여넣기 파서 — 엑셀 표 복사(탭)", () => {
  it("파트 시트 꼴: 병합된 Pillar·셀 안 줄바꿈·'병목현상 N' 꼬리표를 처리해 9묶음 복원", () => {
    const head = ["No", "Pillar", "병목현상", "목표", "달성기준", "실제결과"].join("\t");
    const lines = OCT.goals.map((g, i) => [String(g.no), i % 3 === 0 ? g.pillar : "", `병목현상 ${(i % 3) + 1}\n\n${g.bottleneck}`, g.objective, g.criteria, ""].map(tsvCell).join("\t"));
    const r = parseOkrPaste([head, ...lines].join("\r\n"));
    expect(r.warnings).toEqual([]);
    expect(r.goals).toEqual(OCT.goals);
  });
  it("통합집계 꼴(달성기준 열 없음): 병목·목표만, 경고 한 줄", () => {
    const head = ["No", "Pillar", "병목현상", "목표", "A파트", "B파트"].join("\t");
    const lines = Q4.goals.map((g) => ["", g.pillar, g.bottleneck, g.objective, "완료", ""].map(tsvCell).join("\t"));
    const r = parseOkrPaste([head, ...lines].join("\n"));
    expect(r.goals.map((g) => [g.no, g.bottleneck, g.objective, g.criteria])).toEqual(Q4.goals.map((g) => [g.no, g.bottleneck, g.objective, ""]));
    expect(r.warnings).toEqual(["달성기준 열이 없어 달성기준은 비워 둡니다(통합집계 표)"]);
  });
  it("TSV 따옴표 규칙", () => {
    expect(splitTsv('a\t"b\nc ""d"""\te\nf')).toEqual([["a", 'b\nc "d"', "e"], ["f"]]);
  });
  it("붙여넣은 goals 덮기 — 같은 번호만, 달성기준이 비면 지금 것 유지", () => {
    const cur: OkrGoal[] = [{ no: 1, pillar: "P", bottleneck: "병목현상 1", objective: "옛", criteria: "옛 기준" }, { no: 2, pillar: "P", bottleneck: "", objective: "그대로", criteria: "" }];
    const out = applyPastedGoals(cur, [{ no: 1, pillar: "Q", bottleneck: "새 병목", objective: "새", criteria: "" }]);
    expect(out[0]).toEqual({ no: 1, pillar: "Q", bottleneck: "새 병목", objective: "새", criteria: "옛 기준" });
    expect(out[1].objective).toBe("그대로");
  });
});

describe("분기 goals ↔ 월 goals", () => {
  const quarter = cyc({ id: "2026-Q4", kind: "quarter", goals: Q4.goals });
  it("병목현상 꼬리표만 있으면 빈 글", () => {
    expect(bottleneckText("병목현상 2")).toBe("");
    expect(bottleneckText("병목현상 1\n\n담당이 없다")).toBe("담당이 없다");
    expect(bottleneckText("담당이 없다")).toBe("담당이 없다");
  });
  it("팀장 월 OKR이 있으면 그 달 것, 복사본·빈 달이면 분기 것(읽기 전용 띠)", () => {
    const oct = cyc({ goals: OCT.goals, goals_origin: "import" });
    expect(isLeaderGoals(oct)).toBe(true);
    expect(effectiveGoals(oct, quarter)).toBe(OCT.goals);
    const nov = cyc({ id: "2026-11", month: 11, goals: [{ no: 1, pillar: "", bottleneck: "병목현상 1", objective: "8월 글", criteria: "" }], goals_origin: "copy" });
    expect(isLeaderGoals(nov)).toBe(false);
    expect(effectiveGoals(nov, quarter)).toBe(Q4.goals);
    expect(goalsAreFromQuarter(nov, quarter)).toBe(true);
    const blank = monthDraftFromQuarter(2026, 12, quarter);
    expect([blank.goals_origin, blank.parent_id, blank.goals.length, blank.goals[0].objective, blank.goals[3].pillar]).toEqual(["copy", "2026-Q4", 9, "", Q4.goals[3].pillar]);
    expect(effectiveGoals(blank, quarter)).toBe(Q4.goals);
    expect(effectiveGoals(nov, null)).toBe(nov.goals); // 분기가 없으면 복사본이라도 달 것
    expect(goalsAreFromQuarter(oct, quarter)).toBe(false);
  });
  it("옛 표(분기 열 없음)는 새 열을 보내지 않고, 새 열이 있으면 보낸다", () => {
    const old = okrCyclePayload(cyc({}), "나", "t");
    expect("direction" in old || "goals_origin" in old || "goals_prev" in old).toBe(false);
    const nu = okrCyclePayload(cyc({ direction: "방향", goals_origin: "import", goals_prev: [] }), "나", "t");
    expect([nu.direction, nu.goals_origin, nu.goals_prev]).toEqual(["방향", "import", []]);
  });
  it("핵심방향 3자 병합 — 내가 안 고쳤으면 서버 것", () => {
    const base = cyc({ direction: "a" });
    expect(mergeCycle(base, cyc({ direction: "a" }), cyc({ direction: "s" })).direction).toBe("s");
    expect(mergeCycle(base, cyc({ direction: "l" }), cyc({ direction: "s" })).direction).toBe("l");
    expect("direction" in mergeCycle(cyc({}), cyc({}), cyc({}))).toBe(false);
  });
});

describe("상단 필터·주차 칩", () => {
  it("오늘이 든 분기와 그 분기 달만, 주차는 없음", () => {
    const items = topFilterItems([{ id: "2026-10" }, { id: "2026-10-W1" }, { id: "2026-Q4" }], "2026-10-20");
    expect(items.map((i) => [i.id, i.label, i.exists])).toEqual([["2026-Q4", "4분기", true], ["2026-10", "10월", true], ["2026-11", "11월", false], ["2026-12", "12월", false]]);
    expect(items.every((i) => !i.legacy)).toBe(true);
    const q3 = topFilterItems([], "2026-10-20", { year: 2026, quarter: 3 });
    expect(q3.map((i) => i.label)).toEqual(["3분기", "7월", "8월", "9월"]);
    expect(q3.every((i) => i.legacy)).toBe(true);
  });
  it("주차 칩 — 11월은 5주, 달 넘는 주 이름", () => {
    const nov = weeksOfMonth(2026, 11);
    expect(nov.map((w) => w.id)).toEqual(["2026-11-W1", "2026-11-W2", "2026-11-W3", "2026-11-W4", "2026-11-W5"]);
    expect(nov[0].label).toBe("1주 11/2~6");
    expect(nov[4].label).toBe("5주 11/30~12/4");
  });
});

describe("집계", () => {
  const oct = cyc({ goals: OCT.goals, goals_origin: "import", feedback: { "1": { memo: "11월엔 더" } } });
  const reports = [rep("2026-10", "A", "", [[1, "x", "미흡"], [2, "y", "완료"]]), rep("2026-10", "C", "", [[1, "z", "미착수"]]), rep("2026-10", "C", "이민구", [[1, "", "완료"]])];
  it("통합집계 — 묶음별 A~D 판정·조치 파트·개선계획 메모", () => {
    const rows = monthlyRollup(oct, reports);
    expect(rows).toHaveLength(9);
    expect(rows[0].byTeam).toEqual({ A: "미흡", B: "", C: "미착수", D: "" });
    expect(rows[0].actionTeams).toEqual(["A", "C"]);
    expect(rows[0].memo).toBe("11월엔 더");
    expect(rows[1].byTeam.A).toBe("완료");
    expect(rows[0].bottleneck).toBe(OCT.goals[0].bottleneck);
  });
  it("분기 진행 표 — 묶음 × 달 × 파트, 달마다 조치 칸 수", () => {
    const quarter = cyc({ id: "2026-Q4", kind: "quarter", goals: Q4.goals });
    const nov = cyc({ id: "2026-11", month: 11, goals_origin: "copy" });
    const p = quarterProgress([nov, oct], { "2026-10": reports, "2026-11": [rep("2026-11", "B", "", [[9, "", "미흡"]])] }, quarter);
    expect(p.months).toEqual([{ id: "2026-10", month: 10, actionTeams: 2 }, { id: "2026-11", month: 11, actionTeams: 1 }]);
    expect(p.rows).toHaveLength(9);
    expect(p.rows[0].cells["2026-10"]).toEqual({ A: "미흡", B: "", C: "미착수", D: "" });
    expect(p.rows[8].cells["2026-11"].B).toBe("미흡");
    expect(p.rows[0].objective).toBe(Q4.goals[0].objective);
  });
  it("주차 합치기·달 안 조치 필요 사람", () => {
    const weeks = [
      rep("2026-10-W2", "C", "한왕주", [[1, "둘째 주", "미흡"]]),
      rep("2026-10-W1", "C", "이민구", [[1, "첫 줄\n둘째 줄", "완료"]]),
      rep("2026-10-W2", "C", "이민구", [[1, "", "미착수"]]),
      rep("2026-10-W1", "C", "", [[1, "파트 행은 뺀다", "미흡"]]),
    ];
    expect(mergeMonthActuals(weeks, 1)).toBe("• 1주 이민구:\n  첫 줄\n  둘째 줄\n• 2주 한왕주: 둘째 주");
    expect(actionMembersInMonth(weeks, 1)).toEqual({ C: ["이민구", "한왕주"] });
  });
});

// ── 2차 피드백(docs/tasks/okr-feedback-2.md) T1~T9 ──
describe("2차: 판정 동그라미·CS 종합·분기 종합", () => {
  it("T1 lastJudgmentInMonth — 마지막 기록 주차, 그 주 안에서는 가장 나쁜 것, 파트 행 무시", () => {
    const weeks = [
      rep("2026-10-W1", "A", "김", [[1, "", "미착수"]]),
      rep("2026-10-W2", "A", "김", [[1, "", "미흡"]]),
      rep("2026-10-W4", "A", "김", [[1, "", "완료"]]),
      rep("2026-10-W4", "A", "", [[1, "파트 행", "미착수"]]),
      rep("2026-10-W3", "B", "박", [[1, "", "완료"]]),
      rep("2026-10-W3", "B", "최", [[1, "", "미흡"]]),
      rep("2026-10-W4", "B", "박", [[1, "적었지만 판정 없음", ""]]),
    ];
    expect(lastJudgmentInMonth(weeks, "A", 1)).toBe("완료");
    expect(lastJudgmentInMonth(weeks, "B", 1)).toBe("미흡"); // W4는 판정이 없어 W3, 그 주 완료·미흡 → 미흡
    expect(lastJudgmentInMonth(weeks, "C", 1)).toBe("");
    expect(lastJudgmentInMonth(weeks, "A", 2)).toBe("");
    // 주차 번호는 숫자로 비교(W10 > W9)
    expect(lastJudgmentInMonth([rep("2026-10-W9", "A", "김", [[1, "", "미흡"]]), rep("2026-10-W10", "A", "김", [[1, "", "완료"]])], "A", 1)).toBe("완료");
  });
  it("T2 partMonthJudgment — 월 행 판정이 있으면 set, 없으면 마지막 주차 suggest, 둘 다 없으면 빈칸", () => {
    const month = [rep("2026-10", "A", "", [[1, "", "부분달성"]]), rep("2026-10", "B", "이", [[1, "", "미착수"]])];
    const weeks = [rep("2026-10-W2", "A", "김", [[1, "", "미흡"]]), rep("2026-10-W2", "B", "이", [[1, "", "미흡"]])];
    expect(partMonthJudgment(month, weeks, "A", 1)).toEqual({ judgment: "부분달성", source: "set" });
    expect(partMonthJudgment(month, weeks, "B", 1)).toEqual({ judgment: "미흡", source: "suggest" }); // 월 팀원 행은 보지 않음
    expect(partMonthJudgment(month, weeks, "C", 1)).toEqual({ judgment: "", source: "" });
  });
  it("T3 monthCsJudgment — auto는 확정·제안 중 가장 나쁜 것, override가 있으면 그것", () => {
    const cells: Record<OkrTeam, OkrJudgedCell> = { A: { judgment: "완료", source: "set" }, B: { judgment: "미흡", source: "suggest" }, C: { judgment: "", source: "" }, D: { judgment: "", source: "" } };
    expect(monthCsJudgment(cells)).toEqual({ judgment: "미흡", auto: "미흡", manual: false });
    expect(monthCsJudgment(cells, "완료")).toEqual({ judgment: "완료", auto: "미흡", manual: true });
    expect(monthCsJudgment(cells, "엉뚱한 글")).toEqual({ judgment: "미흡", auto: "미흡", manual: false });
  });
  it("T4 lastOfJudgments·quarterCsJudgment — 빈 것 건너뛴 마지막 값", () => {
    expect(lastOfJudgments(["미흡", "완료", ""])).toBe("완료");
    expect(lastOfJudgments(["", "", ""])).toBe("");
    expect(quarterCsJudgment(["미흡", "완료", ""])).toEqual({ judgment: "완료", auto: "완료", manual: false });
    expect(quarterCsJudgment(["미흡", "완료", ""], "미흡")).toEqual({ judgment: "미흡", auto: "완료", manual: true });
  });
  it("T5 quarterRollup — 9행, 달 CS 종합·분기 종합·파트 칸, 달 조치 수는 quarterProgress와 같음", () => {
    const quarter = cyc({ id: "2026-Q4", kind: "quarter", goals: Q4.goals, feedback: { "1": { memo: "", judgment: "부분달성" } } });
    const oct = cyc({ goals: OCT.goals, goals_origin: "import" });
    const nov = cyc({ id: "2026-11", month: 11, goals_origin: "copy" });
    const octReports = [rep("2026-10", "A", "", [[1, "x", "미흡"], [2, "y", "완료"]]), rep("2026-10", "C", "", [[1, "z", "미착수"]]), rep("2026-10", "C", "이민구", [[1, "", "완료"]])];
    const monthReports = { "2026-10": octReports, "2026-11": [rep("2026-11", "B", "", [[9, "", "미흡"]])] };
    const weekReports = { "2026-10": [rep("2026-10-W3", "D", "정", [[1, "", "완료"]])] };
    const r = quarterRollup(quarter, [nov, oct], monthReports, weekReports);
    expect(r.months).toEqual([{ id: "2026-10", month: 10, actionTeams: 2 }, { id: "2026-11", month: 11, actionTeams: 1 }]);
    expect(r.rows).toHaveLength(9);
    const row1 = r.rows[0];
    expect(row1.objective).toBe(Q4.goals[0].objective);
    expect(row1.byMonth["2026-10"]).toEqual({ judgment: "미착수", auto: "미착수", manual: false });
    expect(row1.byMonth["2026-11"]).toEqual({ judgment: "", auto: "", manual: false });
    expect(row1.quarter).toEqual({ judgment: "부분달성", auto: "미착수", manual: true });
    expect(row1.byTeam.D.byMonth["2026-10"]).toEqual({ judgment: "완료", source: "suggest" });
    expect(row1.byTeam.D.quarter).toBe("완료");
    expect(row1.byTeam.A.byMonth["2026-10"]).toEqual({ judgment: "미흡", source: "set" });
    expect(row1.byTeam.B.byMonth["2026-11"]).toEqual({ judgment: "", source: "" });
    const row9 = r.rows[8];
    expect(row9.byMonth["2026-11"].judgment).toBe("미흡");
    expect(row9.quarter).toEqual({ judgment: "미흡", auto: "미흡", manual: false });
    expect(row9.byTeam.B.quarter).toBe("미흡");
  });
  it("monthlyRollup 4번째 인자 — dots·cs, 월 feedback judgment가 CS 종합 덮어쓰기", () => {
    const oct = cyc({ goals: OCT.goals, goals_origin: "import", feedback: { "2": { memo: "m", judgment: "미흡" } } });
    const rows = monthlyRollup(oct, [rep("2026-10", "A", "", [[2, "", "완료"]])], null, [rep("2026-10-W1", "B", "김", [[2, "", "부분달성"]])]);
    expect(rows[1].dots.B).toEqual({ judgment: "부분달성", source: "suggest" });
    expect(rows[1].byTeam.B).toBe(""); // 확정만
    expect(rows[1].cs).toEqual({ judgment: "미흡", auto: "부분달성", manual: true });
    expect(monthlyRollup(oct, [])[0].cs).toEqual({ judgment: "", auto: "", manual: false }); // 옛 호출(인자 2개)
  });
});

describe("2차: 주차 목표 덮어쓰기", () => {
  const base: OkrGoal[] = [
    { no: 1, pillar: "P", bottleneck: "막힘", objective: "월 목표 1", criteria: "월 기준 1" },
    { no: 2, pillar: "P", bottleneck: "막힘2", objective: "월 목표 2", criteria: "월 기준 2" },
  ];
  it("T6 옛 objective 글이 든 칸(표시 없음)은 objective를 무시하고 달성기준만 덮는다", () => {
    const old: OkrGoal[] = [{ no: 1, pillar: "P", bottleneck: "", objective: "8월 옛 목표", criteria: "주 기준" }];
    const out = overlayGoals(base, old);
    expect(out[0].objective).toBe("월 목표 1");
    expect(out[0].criteria).toBe("주 기준");
    expect(out[0].html).toBeUndefined();
    expect(out).toEqual(overlayCriteria(base, old)); // 옛 데이터에서는 옛 함수와 같다
    expect(overlayGoals(base, undefined)).toBe(base);
  });
  it("T6 표시가 있으면 objective를 덮고 표시를 남긴다, 파트 → 개인 사슬(4차: 새 칸은 고친 field만)", () => {
    const part = putGoalField(undefined, base[0], "objective", "파트 이번 주 목표");
    expect(part).toEqual([{ no: 1, pillar: "P", bottleneck: "", objective: "파트 이번 주 목표", criteria: "", html: { objectiveSet: "1" } }]);
    const partView = overlayGoals(base, part);
    expect(partView[0]).toMatchObject({ bottleneck: "막힘", objective: "파트 이번 주 목표", criteria: "월 기준 1", html: { objectiveSet: "1" } });
    expect(partView[1]).toBe(base[1]);
    // 개인이 달성기준만 고침 → 새 칸에 목표 표시를 베끼지 않아 파트 목표가 계속 기본으로 보인다
    const person = putGoalField(undefined, partView[0], "criteria", "내 기준");
    expect(person[0]).toEqual({ no: 1, pillar: "P", bottleneck: "", objective: "", criteria: "내 기준", html: { criteriaSet: "1" } });
    const personView = overlayGoals(partView, person);
    expect(personView[0]).toMatchObject({ objective: "파트 이번 주 목표", criteria: "내 기준", html: { objectiveSet: "1", criteriaSet: "1" } });
    // 개인이 목표를 고치면 그 사람만
    const person2 = putGoalField(person, personView[0], "objective", "내 목표", "<b>내 목표</b>");
    const personView2 = overlayGoals(partView, person2);
    expect(personView2[0]).toMatchObject({ objective: "내 목표", criteria: "내 기준", html: { objective: "<b>내 목표</b>", objectiveSet: "1" } });
  });
  it("T6(4차) 비우면 빈 채 유지 — 표시는 남고 글만 빈다(위 층으로 되돌아가지 않음), criteria만 고칠 때 같은 칸의 표시를 지킨다", () => {
    const set = putGoalField(undefined, base[0], "objective", "주 목표", "<i>주 목표</i>");
    const crit = putGoalField(set, base[0], "criteria", "주 기준");
    expect(crit[0]).toEqual({ no: 1, pillar: "P", bottleneck: "", objective: "주 목표", criteria: "주 기준", html: { objective: "<i>주 목표</i>", objectiveSet: "1", criteriaSet: "1" } });
    const cleared = putGoalField(crit, base[0], "objective", "  ");
    expect(cleared[0]).toEqual({ no: 1, pillar: "P", bottleneck: "", objective: "  ", criteria: "주 기준", html: { objectiveSet: "1", criteriaSet: "1" } });
    expect(overlayGoals(base, cleared)[0]).toMatchObject({ objective: "  ", criteria: "주 기준" });
    // 칸이 없어도 비우면 빈 칸을 표시와 함께 만든다(위 층 글을 지운 것)
    expect(putGoalField(undefined, base[0], "objective", "")).toEqual([{ no: 1, pillar: "P", bottleneck: "", objective: "", criteria: "", html: { objectiveSet: "1" } }]);
    expect(overlayGoals(base, putGoalField(undefined, base[0], "objective", ""))[0].objective).toBe("");
    const emptyCrit = putGoalField(undefined, base[1], "criteria", "");
    expect(overlayGoals(base, emptyCrit)[1].criteria).toBe(""); // 빈 달성기준도 빈 채
  });
  it("T6(4차) 표시 없는 옛 칸의 criteria는 글이 있을 때만 덮는다", () => {
    const old: OkrGoal[] = [{ no: 1, pillar: "P", bottleneck: "", objective: "옛 목표", criteria: "" }, { no: 2, pillar: "P", bottleneck: "", objective: "", criteria: "옛 기준" }];
    const out = overlayGoals(base, old);
    expect(out[0]).toMatchObject({ objective: "월 목표 1", criteria: "월 기준 1" });
    expect(out[1]).toMatchObject({ objective: "월 목표 2", criteria: "옛 기준" });
  });
  it("T7 prevGoalsToCarry — 같은 달이면 표시 있는 목표만, 다른 달이면 목표 없음", () => {
    const prev: OkrGoal[] = [
      { no: 1, pillar: "P", bottleneck: "", objective: "전주 목표", criteria: "전주 기준", html: { objectiveSet: "1", criteria: "<b>전주 기준</b>" } },
      { no: 2, pillar: "P", bottleneck: "", objective: "월 목표 2", criteria: "기준 2" },
    ];
    const carry = prevGoalsToCarry(prev, true);
    expect(carry).toHaveLength(1);
    expect(carry[0]).toMatchObject({ no: 1, objective: "전주 목표", html: { objectiveSet: "1", criteria: "<b>전주 기준</b>" } });
    expect(overlayGoals(base, carry)[0].objective).toBe("전주 목표");
    expect(prevGoalsToCarry(prev, false)).toEqual([]);
  });
});

describe("2차: 핵심방향 단계·feedback 칸 병합", () => {
  it("T8 directionSteps — 10월 전사본은 머리글 + 3단계", () => {
    const d = directionSteps(OCT.direction);
    expect(d.headline).toBe("10월은 4분기 목표의 담당자·대상·측정 기준을 정하고 실행을 시작한다.");
    expect(d.steps.map((s) => [s.key, s.label])).toEqual([["week", "주간 실행"], ["month", "월말 확인"], ["quarter", "분기 정리"]]);
    expect(d.steps[0].text).toBe("주간에는 실행하고");
    expect(d.steps[1].text).toBe("월말에는 목표 대비 숫자와 미달 원인을 확인하여 11월 전략을 정한다.");
    expect(d.steps[2].text).toBe("분기 말 지식과 교훈으로 정리할 수 있도록 개선 전 상태와 판단 근거를 남긴다.");
    expect(d.rest).toEqual([]);
  });
  it("T8 단계 낱말이 없으면 steps는 비고 rest에 글", () => {
    const d = directionSteps("머리 줄\n그냥 하는 일이다\n또 다른 줄");
    expect(d).toEqual({ headline: "머리 줄", steps: [], rest: ["그냥 하는 일이다", "또 다른 줄"] });
    expect(directionSteps("")).toEqual({ headline: "", steps: [], rest: [] });
  });
  it("T9 mergeFeedback 칸 단위 — 내가 judgment, 서버가 memo를 고치면 둘 다 남는다", () => {
    const base = { "1": { memo: "옛 메모" }, "2": { memo: "x" } };
    const local = { "1": { memo: "옛 메모", judgment: "미흡" }, "2": { memo: "x" } };
    const server = { "1": { memo: "새 메모" }, "2": { memo: "서버 x" } };
    expect(mergeFeedback(base, local, server)).toEqual({ "1": { memo: "새 메모", judgment: "미흡" }, "2": { memo: "서버 x" } });
    // 같은 칸을 둘 다 고치면 내 것
    expect(mergeFeedback(base, { "1": { memo: "내 메모" }, "2": { memo: "x" } }, server)["1"].memo).toBe("내 메모");
    // 내가 번호를 지우고 서버는 안 고쳤으면 지워진다(예전과 같음), 서버에만 새로 생긴 번호는 남는다
    expect(mergeFeedback({ "1": { memo: "a" } }, {}, { "1": { memo: "a" }, "3": { memo: "새" } })).toEqual({ "3": { memo: "새" } });
  });
});

describe("3차(2026-10-21): 병목현상 덮어쓰기·파트 탭 필터·주차 칩", () => {
  const base: OkrGoal[] = [
    { no: 1, pillar: "P", bottleneck: "월 병목 1", objective: "월 목표 1", criteria: "월 기준 1" },
    { no: 2, pillar: "P", bottleneck: "월 병목 2", objective: "월 목표 2", criteria: "월 기준 2" },
  ];
  it("T10 putGoalField bottleneck — 표시(bottleneckSet)·글자색(html.bottleneck)을 붙여 덮고, 파트 → 개인 사슬", () => {
    const part = putGoalField(undefined, base[0], "bottleneck", "파트 병목", "<b style=\"color:red\">파트 병목</b>");
    expect(part).toEqual([{ no: 1, pillar: "P", bottleneck: "파트 병목", objective: "", criteria: "", html: { bottleneck: "<b style=\"color:red\">파트 병목</b>", bottleneckSet: "1" } }]);
    const partView = overlayGoals(base, part);
    expect(partView[0]).toMatchObject({ bottleneck: "파트 병목", objective: "월 목표 1", criteria: "월 기준 1", html: { bottleneckSet: "1", bottleneck: "<b style=\"color:red\">파트 병목</b>" } });
    expect(partView[1]).toBe(base[1]);
    // 개인이 달성기준만 고치면 병목 표시를 베끼지 않아 파트 병목이 계속 기본으로 보인다
    const person = putGoalField(undefined, partView[0], "criteria", "내 기준");
    expect(person[0].html).toEqual({ criteriaSet: "1" });
    expect(overlayGoals(partView, person)[0]).toMatchObject({ bottleneck: "파트 병목", criteria: "내 기준" });
    // 같은 칸에 목표·병목 둘 다 — 표시 둘 다 남는다
    const both = putGoalField(putGoalField(undefined, base[0], "objective", "주 목표"), base[0], "bottleneck", "주 병목");
    expect(both[0].html).toEqual({ objectiveSet: "1", bottleneckSet: "1" });
    // 개인이 병목을 고치면 그 사람만(파트 칸은 그대로 — 층별 독립)
    const mine = putGoalField(undefined, partView[0], "bottleneck", "내 병목");
    expect(overlayGoals(partView, mine)[0].bottleneck).toBe("내 병목");
    expect(overlayGoals(base, part)[0].bottleneck).toBe("파트 병목");
    expect(overlayGoals(base, both)[0]).toMatchObject({ bottleneck: "주 병목", objective: "주 목표" });
  });
  it("T10(4차) 빈 bottleneck은 빈 채 유지(월 것으로 돌아가지 않음)", () => {
    const set = putGoalField(undefined, base[0], "bottleneck", "주 병목", "<i>주 병목</i>");
    const crit = putGoalField(set, base[0], "criteria", "주 기준");
    const cleared = putGoalField(crit, base[0], "bottleneck", "");
    expect(cleared[0]).toEqual({ no: 1, pillar: "P", bottleneck: "", objective: "", criteria: "주 기준", html: { bottleneckSet: "1", criteriaSet: "1" } });
    expect(overlayGoals(base, cleared)[0]).toMatchObject({ bottleneck: "", objective: "월 목표 1", criteria: "주 기준" });
    expect(overlayGoals(base, putGoalField(undefined, base[0], "bottleneck", ""))[0].bottleneck).toBe("");
  });
  it("T10 표시 없는 옛 칸의 bottleneck 글은 무시한다", () => {
    const old: OkrGoal[] = [{ no: 1, pillar: "P", bottleneck: "8월 옛 병목", objective: "", criteria: "주 기준" }];
    const out = overlayGoals(base, old);
    expect(out[0].bottleneck).toBe("월 병목 1");
    expect(out[0].criteria).toBe("주 기준");
    expect(out[0].html).toBeUndefined();
  });
  it("T11 파트 탭 필터엔 [n분기]가 없고 통합집계엔 있다, 분기 지금 달", () => {
    const items = topFilterItems([], "2026-10-21", { year: 2026, quarter: 4 });
    expect(filterItemsForTab(items, "all").map((x) => x.label)).toEqual(["4분기", "10월", "11월", "12월"]);
    expect(filterItemsForTab(items, "A").map((x) => x.label)).toEqual(["10월", "11월", "12월"]);
    expect(quarterNowMonth(2026, 4, "2026-11-03").id).toBe("2026-11");
    expect(quarterNowMonth(2026, 4, "2027-01-05").id).toBe("2026-10"); // 오늘이 분기 밖이면 첫 달
    expect(quarterNowMonth(2027, 1, "2026-10-21").id).toBe("2027-01");
  });
  it("T12 주차 칩은 파트원 이름을 골랐을 때만", () => {
    expect(showsWeekChips("")).toBe(false);
    expect(showsWeekChips("__sum__")).toBe(false);
    expect(showsWeekChips("김정민")).toBe(true);
  });
});

describe("분기 표 조치·확인 필요 달(2026-10-21)", () => {
  it("T13 alertMonths — 월 CS 종합이 미흡·미착수인 달만 달 순서대로, 없으면 빈 배열", () => {
    const months = [{ id: "2026-10", month: 10 }, { id: "2026-11", month: 11 }, { id: "2026-12", month: 12 }];
    const byMonth = {
      "2026-10": { judgment: "미흡", auto: "미흡", manual: false },
      "2026-11": { judgment: "완료", auto: "미착수", manual: true }, // 사람이 완료로 덮었으면 조치 아님
      "2026-12": { judgment: "미착수", auto: "", manual: true },
    };
    expect(alertMonths(byMonth, months)).toEqual(["10월", "12월"]);
    expect(alertMonths({}, months)).toEqual([]);
    expect(alertMonths(undefined, months)).toEqual([]);
  });
});

describe("4차·5차: 분기 파트 카드·월 빈 틀(2026-10-21)", () => {
  it("T14 quarterTeamCard — 목표마다 마지막 기록 달 판정으로 셈, 파트장은 가장 최근 달", () => {
    const goals: OkrGoal[] = [1, 2, 3].map((no) => ({ no, pillar: "P", bottleneck: "", objective: `목표 ${no}`, criteria: "" }));
    const q: OkrCycle = { ...quarterDraft(2026, 4), goals };
    const oct: OkrCycle = { ...monthDraftFromQuarter(2026, 10, q), goals, goals_origin: "manual" };
    const nov: OkrCycle = { ...monthDraftFromQuarter(2026, 11, q), goals, goals_origin: "manual" };
    const rep = (cid: string, leader: string, rows: Array<[number, string]>): OkrReport => ({ ...emptyReport(cid, "A", ""), header: { leader, author: "", headcount: "", submitted: "" }, rows: rows.map(([no, judgment]) => ({ no, actual: "", judgment, reason: "", plan: "", evidence: "" })) });
    const reports = { "2026-10": [rep("2026-10", "김옛", [[1, "미흡"], [2, "완료"]])], "2026-11": [rep("2026-11", "이새", [[1, "완료"]])] };
    const rollup = quarterRollup(q, [oct, nov], reports, {});
    const card = quarterTeamCard(rollup, "A", reports);
    // 1번 = 11월 완료(마지막 달), 2번 = 10월 완료, 3번 = 없음
    expect(card).toEqual({ team: "A", total: 3, judged: 2, alerts: 0, rate: 100, leader: "이새" });
    expect(quarterTeamCard(rollup, "B", reports)).toEqual({ team: "B", total: 3, judged: 0, alerts: 0, rate: null, leader: "" });
  });
  it("T15 monthScreenGoals — copy·빈 goals 달은 분기 글 대신 Pillar 만 있는 빈 틀, 팀장 월 OKR 은 그대로", () => {
    const q: OkrCycle = { ...quarterDraft(2026, 4), goals: [{ no: 1, pillar: "Pillar 1", bottleneck: "분기 병목", objective: "분기 목표", criteria: "분기 기준" }] };
    const copy: OkrCycle = { ...monthDraftFromQuarter(2026, 11, q), goals: [{ no: 1, pillar: "Pillar 1", bottleneck: "복사 병목", objective: "복사 목표", criteria: "" }], goals_origin: "copy" };
    expect(monthScreenGoals(copy, q)).toEqual({ goals: [{ no: 1, pillar: "Pillar 1", bottleneck: "", objective: "", criteria: "" }], pending: true });
    const empty: OkrCycle = { ...copy, goals: [], goals_origin: "" };
    expect(monthScreenGoals(empty, q).goals).toEqual([{ no: 1, pillar: "Pillar 1", bottleneck: "", objective: "", criteria: "" }]);
    const noQuarter = monthScreenGoals(empty, null);
    expect(noQuarter.goals).toHaveLength(9); // 분기가 없으면 빈 3×3
    expect(noQuarter.goals.every((g) => !g.bottleneck && !g.objective && !g.criteria)).toBe(true);
    const leader: OkrCycle = { ...copy, goals_origin: "import" };
    expect(monthScreenGoals(leader, q)).toEqual({ goals: leader.goals, pending: false });
    expect(monthScreenGoals(null, q)).toEqual({ goals: [], pending: false });
  });
});
