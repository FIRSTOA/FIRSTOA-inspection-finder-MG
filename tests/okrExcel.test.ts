// OKR 엑셀 내려받기 순수 변환(src/okrExcel.ts) — 설계 docs/tasks/okr-excel-export-2026-10-28.md "테스트" 6묶음
import { describe, expect, it } from "vitest";
import { emptyReport, resolveWeekCycleId, weeksOfMonth, type OkrCycle, type OkrGoal, type OkrReport, type OkrResultRow } from "../src/okr";
import { okrMemberShares, okrShareAverage, type OkrWeekFacts, type RosterMember } from "../src/kpi/kpiCompute";
import {
  ARCHIVED_MARK, MISSING_MARK, OKR_EXCEL_SHEET_NAMES, buildOkrWorkbookData, isValidSheetName, judgmentText, judgmentTone, monthSheet,
  okrExcelFileName, partSheet, summarySheet, weekSheet, type OkrExcelInput, type OkrExcelSheet,
} from "../src/okrExcel";

const P1 = "Pillar 1.\nAI · 효율성";
const P2 = "Pillar 2. 고객";
const goal = (no: number, pillar: string, extra: Partial<OkrGoal> = {}): OkrGoal => ({ no, pillar, bottleneck: `병목${no}`, objective: `목표${no}`, criteria: `기준${no}`, ...extra });
const monthGoals: OkrGoal[] = [
  goal(1, P1), goal(2, P1), goal(3, P2),
  goal(101, P1, { scope: { team: "C" } }),
  goal(102, P2, { scope: { team: "C", member: "이민구" } }),
  goal(4, P2, { hidden: true }),
];
const cycleOf = (id: string, kind: OkrCycle["kind"], month: number, goals: OkrGoal[]): OkrCycle => ({
  id, kind, title: id, year: 2026, month, week_no: null, start_date: "", end_date: "", parent_id: null, goals, feedback: {}, goals_origin: "leader",
});
const quarterCycle = cycleOf("2026-Q4", "quarter", 10, [goal(1, P1), goal(2, P1), goal(3, P2)]);
const oct = cycleOf("2026-10", "month", 10, monthGoals);
const row = (no: number, judgment: string, actual = ""): OkrResultRow => ({ no, actual, judgment, reason: "", plan: "", evidence: "" });
const rep = (cycle: string, team: string, member: string, rows: OkrResultRow[], extra: Partial<OkrReport> = {}): OkrReport => ({ ...emptyReport(cycle, team, member), rows, ...extra });

const W1 = "2026-10-W1", W2 = "2026-10-W2";
const weekReports: OkrReport[] = [
  rep(W1, "C", "이민구", [row(1, "완료", "했음"), row(2, "부분달성"), row(3, "미흡"), row(101, "미착수"), row(102, "해당없음"), row(4, "달성")]),
  rep(W1, "C", "홍길동", [row(1, "미달성"), row(2, ""), row(3, "완료"), row(101, "완료")]),
  // 그 주 C 파트 행 — 1번 달성기준 덮어쓰기(주차 바탕)
  rep(W1, "C", "", [], { goals: [{ no: 1, pillar: P1, bottleneck: "", objective: "", criteria: "C주차기준1" }] }),
  rep(W2, "C", "이민구", [row(1, "완료"), row(2, "부분달성"), row(3, "완료"), row(101, "완료"), row(102, "완료")]),
];
const monthReports: OkrReport[] = [
  rep("2026-10", "C", "", [row(1, "완료", "파트 결과")], { header: { leader: "이파장", author: "홍길동", headcount: "", submitted: "" }, updated_at: "2026-10-13T23:30:00Z", updated_by: "홍길동" }),
];
const roster: RosterMember[] = [{ name: "이민구", team: "C" }, { name: "홍길동", team: "C" }, { name: "김미작", team: "C" }, { name: "팀장님", team: "C", title: "팀장" }];

const inputAt = (today: string): OkrExcelInput => ({
  year: 2026, quarter: 4, quarterCycle, today, now: "2026-10-14T01:00:00Z", by: "이민구",
  months: [
    { id: "2026-10", year: 2026, month: 10, cycle: oct, reports: monthReports, weekReports, roster },
    { id: "2026-11", year: 2026, month: 11, cycle: null, reports: [], weekReports: [], roster },
    { id: "2026-12", year: 2026, month: 12, cycle: null, reports: [], weekReports: [], roster },
  ],
});
const input = inputAt("2026-10-14"); // 화요일 = 10월 2주차(10/12~16), 3주차 이후는 아직
const colOf = (s: OkrExcelSheet, header: string) => { const i = s.columns.findIndex((c) => c.header === header); expect(i).toBeGreaterThanOrEqual(0); return i; };

describe("주차 기록 탭", () => {
  const s = weekSheet(input);
  const [cName, cWeek, cNo, cLayer, cJ, cCrit] = ["이름", "주차", "번호", "행 구분", "판정", "달성기준"].map((h) => colOf(s, h));
  const rowsOf = (name: string, week: string) => s.rows.filter((r) => r[cName] === name && String(r[cWeek]).startsWith(week));

  it("이민구 = 공통 1·2·3 + C 전용 101 + 본인 전용 102 + 보관 4", () => {
    const rs = rowsOf("이민구", "10월 1주");
    expect(rs.map((r) => r[cNo]).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 101, 102]);
    expect(rs.find((r) => r[cNo] === 4)?.[cLayer]).toBe(ARCHIVED_MARK);
    expect(rs.find((r) => r[cNo] === 101)?.[cLayer]).toBe("파트 전용");
    expect(rs.find((r) => r[cNo] === 102)?.[cLayer]).toBe("개인 전용");
    expect(rs.find((r) => r[cNo] === 1)?.[cCrit]).toBe("C주차기준1"); // 그 주 파트 행 덮어쓰기
    expect(rs.find((r) => r[cNo] === 4)?.[cJ]).toBe("완료"); // "달성" 정규화
  });
  it("홍길동 행엔 102 없음", () => {
    const nos = rowsOf("홍길동", "10월 1주").map((r) => r[cNo]);
    expect(nos).toContain(101);
    expect(nos).not.toContain(102);
  });
  it("미작성자는 주차마다 미작성 1행, 기록 없는 홍길동 2주차도 미작성 1행", () => {
    for (const wk of ["10월 1주", "10월 2주"]) {
      const rs = rowsOf("김미작", wk);
      expect(rs).toHaveLength(1);
      expect(rs[0][cJ]).toBe(MISSING_MARK);
    }
    expect(rowsOf("홍길동", "10월 2주").map((r) => r[cJ])).toEqual([MISSING_MARK]);
  });
  it("오늘 이후 주차·팀장은 넣지 않는다, 주차 이름은 '10월 1주 10/5~9'", () => {
    expect(s.rows.some((r) => String(r[cWeek]).startsWith("10월 3주"))).toBe(false);
    expect(s.rows.some((r) => r[cName] === "팀장님")).toBe(false);
    expect(rowsOf("이민구", "10월 1주")[0][cWeek]).toBe("10월 1주 10/5~9");
  });
});

describe("파트 종합 탭", () => {
  const s = partSheet(input);
  const [cTeam, cNo, cJ, cLeader, cEdit] = ["파트", "번호", "판정", "파트장", "마지막 수정"].map((h) => colOf(s, h));
  it("C = 1·2·3·101(102·보관 4 없음), 다른 파트에 101 없음", () => {
    expect(s.rows.filter((r) => r[cTeam] === "C").map((r) => r[cNo])).toEqual([1, 2, 101, 3]); // Pillar 묶음 순 — 공통 뒤 파트 전용
    for (const t of ["A", "B", "D"]) {
      const nos = s.rows.filter((r) => r[cTeam] === t).map((r) => r[cNo]);
      expect(nos.sort()).toEqual([1, 2, 3]);
    }
  });
  it("파트장·마지막 수정(KST)·판정, 월 행 없는 11·12월은 없음", () => {
    const c1 = s.rows.find((r) => r[cTeam] === "C" && r[cNo] === 1)!;
    expect(c1[cJ]).toBe("완료");
    expect(c1[cLeader]).toBe("이파장");
    expect(c1[cEdit]).toBe("2026-10-14 08:30 · 홍길동");
    expect(s.rows.every((r) => r[0] === "10월")).toBe(true);
  });
});

describe("판정 정규화·채움", () => {
  it.each([
    ["완료", "완료", "done"], ["부분달성", "부분달성", "partial"], ["미흡", "미흡", "alert"], ["미착수", "미착수", "alert"],
    ["해당없음", "해당없음", "na"], ["달성", "완료", "done"], ["미달성", "미흡", "alert"], ["", "", ""],
  ])("%s → %s (%s)", (raw, text, tone) => {
    expect(judgmentText(raw)).toBe(text);
    expect(judgmentTone(judgmentText(raw))).toBe(tone);
  });
  it("제안 꼬리·미작성", () => {
    expect(judgmentTone("부분달성(제안)")).toBe("partial");
    expect(judgmentTone(MISSING_MARK)).toBe("missing");
  });
});

describe("요약 탭 % = 홈 K19 함수", () => {
  const facts: OkrWeekFacts = { id: W1, weeks: weeksOfMonth(2026, 10).map((w) => ({ id: w.id, weekNo: w.weekNo, label: "" })), goals: monthGoals, reports: weekReports };
  const expected = okrShareAverage(okrMemberShares(facts, "C", roster, facts.weeks.map((w) => w.id)));
  const s = summarySheet(input);
  const teamRow = (label: string) => s.rows.find((r) => r[0] === label)!;
  it("C 10월 % 가 okrShareAverage(okrMemberShares) 와 같고, 미작성자 0% 가 평균을 끌어내린다", () => {
    expect(teamRow("C파트")[2]).toBe(expected);
    const writersOnly = okrShareAverage(okrMemberShares(facts, "C", null, facts.weeks.map((w) => w.id)));
    expect(expected!).toBeLessThan(writersOnly!);
  });
  it("아직 안 온 달 '-', 구성원 없는 파트 '미작성', 개인 미작성자 0 + 비고", () => {
    expect(teamRow("C파트")[3]).toBe("-");
    expect(teamRow("A파트")[2]).toBe(MISSING_MARK);
    const mi = s.rows.find((r) => r[0] === "C" && r[1] === "김미작")!;
    expect(mi[2]).toBe(0);
    expect(mi[mi.length - 1]).toBe(`10월 ${MISSING_MARK}`);
    const lee = s.rows.find((r) => r[0] === "C" && r[1] === "이민구")!;
    expect(lee[7]).toBe("2/2"); // 작성 주차
    expect(s.headerRow).toBe(false);
    expect(s.subHeaderRows).toHaveLength(2);
  });
  it("판정 0 인 달은 미작성(0 아님) — 11월 주차가 지났는데 기록이 없으면", () => {
    const nov = summarySheet(inputAt("2026-11-10"));
    expect(nov.rows.find((r) => r[0] === "C파트")![3]).toBe(MISSING_MARK);
  });
});

describe("월 통합집계 탭", () => {
  const s = monthSheet(input);
  const [cMonth, cNo, cC, cObj] = ["월", "번호", "C", "목표"].map((h) => colOf(s, h));
  it("공통 행만, 제안 칸 '(제안)' 꼬리·확정 칸 꼬리 없음, 월 OKR 없는 달 1행", () => {
    const octRows = s.rows.filter((r) => r[cMonth] === "10월");
    expect(octRows.map((r) => r[cNo])).toEqual([1, 2, 3]);
    expect(octRows[0][cC]).toBe("완료"); // 월 파트 종합 확정
    expect(octRows[1][cC]).toBe("부분달성(제안)"); // 마지막 주차(W2) 제안
    const nov = s.rows.filter((r) => r[cMonth] === "11월");
    expect(nov).toHaveLength(1);
    expect(nov[0][cObj]).toBe("11월 OKR 아직 없음");
  });
});

describe("파일·시트 이름", () => {
  it("파일명과 시트 5개", () => {
    expect(okrExcelFileName(2026, 4, "2026-10-28")).toBe("OKR_2026Q4_2026-10-28.xlsx");
    const wb = buildOkrWorkbookData({ ...input, today: "2026-10-28" });
    expect(wb.fileName).toBe("OKR_2026Q4_2026-10-28.xlsx");
    expect(wb.sheets.map((x) => x.name)).toEqual([...OKR_EXCEL_SHEET_NAMES]);
    for (const x of wb.sheets) {
      expect(isValidSheetName(x.name)).toBe(true);
      for (const r of x.rows) expect(r.length).toBeLessThanOrEqual(x.columns.length);
    }
    expect(wb.weekRowCount).toBe(wb.sheets[4].rows.length);
  });
});

describe("resolveWeekCycleId(OkrHub weekIdFor 와 같은 규칙)", () => {
  const wk = (id: string, start: string) => ({ id, kind: "week" as const, start_date: start });
  it("같은 시작 월요일 행이 없으면 정식 id, 옛 id 만 있으면 그 행, 둘이면 정식 → 결과 있는 쪽", () => {
    expect(resolveWeekCycleId(2026, 10, 1, [])).toBe("2026-10-W1");
    expect(resolveWeekCycleId(2026, 10, 1, [wk("2026-10-W2", "2026-10-05")])).toBe("2026-10-W2");
    expect(resolveWeekCycleId(2026, 10, 1, [wk("old-a", "2026-10-05"), wk("2026-10-W1", "2026-10-05")])).toBe("2026-10-W1");
    expect(resolveWeekCycleId(2026, 10, 1, [wk("old-a", "2026-10-05"), wk("old-b", "2026-10-05")], new Set(["old-b"]))).toBe("old-b");
  });
});
