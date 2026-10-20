import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OKR_PILLARS, actionMembersInMonth, applyPastedGoals, bottleneckText, cycleKindOf, cycleLabel, defaultCycleTitle, effectiveGoals, emptyReport,
  goalsAreFromQuarter, isLeaderGoals, mergeCycle, mergeMonthActuals, monthDraftFromQuarter, monthlyRollup, monthsOfQuarter, okrCyclePayload,
  parseOkrPaste, parseQuarterId, quarterCycleId, quarterDraft, quarterOf, quarterProgress, splitTsv, topFilterItems, weeksOfMonth,
  type OkrCycle, type OkrGoal, type OkrReport,
} from "../src/okr";

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
