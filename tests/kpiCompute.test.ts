import { describe, expect, it } from "vitest";
import {
  countableEvents, countExpansion, countField, expansionTally, fieldTally, mergeExpansionIntoEvents, mergeFieldIntoEvents, toExpansionRows, toFieldRows,
  type ExpansionRaw, type FieldRaw,
} from "../src/workCount";
import type { ActivityEvent } from "../src/operations";
import { countUnhandledTabs, mergeUnhandled, type ReceptionInput, type TicketInput } from "../src/homeUnhandled";
import { achievementRate, emptyReport, resultRowFor, type OkrCycle, type OkrReport } from "../src/okr";
import { blogPeriods, countBlog, type BlogRow } from "../src/blogSheet";
import { teamWorkinProgress, type WorkinPlaceLite } from "../src/workinProgress";
import {
  bizDays, countOverageVisits, dailyNeedText, fieldKpi, expansionKpi, kpiCount, kpiProgress, kpiRanges, kpiTargetFor, kpiTodayLine, okrKpi,
  kpiRowStatus, okrWeekResult, recontractOverdue, overageKpi, okrWeekMembers, okrScopeLabel, blogYearTotals, overhaulByPerson, titledNames, toFormRows, unhandledKpis, workinPace, type FormRaw, type KpiFacts, type RosterMember,
} from "../src/kpi/kpiCompute";
import { KPI_DEFS, mainKpiIds, parseKpiTargets } from "../src/kpi/kpiDefs";

// 사용자 원칙: "PC 를 예로 조회랑 주간현황이 다르면 안 된다" — KPI 값 = 조회 탭·팀 현황·순위표·홈 판이 같은 입력에서 내는 값.
const ROSTER_MAP: Record<string, string> = { 한왕주: "C", 박영현: "C", 이민구: "C", 엄재현: "E", 이권선: "A", 김종희: "D", 이호준: "B", 박옥주: "팀장", 신정훈: "팀장" };
const teamOf = (a: string) => ROSTER_MAP[a] || "미지정";
const ROSTER: RosterMember[] = Object.entries(ROSTER_MAP).filter(([, t]) => t !== "팀장").map(([name, team]) => ({ name, team }));
const TODAY = "2026-10-23"; // 금요일
const R = kpiRanges(TODAY);
const ctx = { today: TODAY, teamOf };

const doc = (machines: Array<[string, string, string]>, region: string) =>
  ["작성자: x", `지역: ${region}`, ...machines.flatMap(([m, s, a], i) => [`${i + 1}.`, `모델명: ${m}`, `시리얼넘버: ${s}`, `자산기번: ${a}`])].join("\n");
const frow = (id: number, day: string, at: string, author: string, region: string, vendor: string, machines: Array<[string, string, string]>, extra: Partial<FieldRaw> = {}): FieldRaw => ({
  id, "작성일": day, created_at: at, "작성자": author, "지역": region, "_업체명": vendor, "업체명": vendor, "_출처": "카톡:웹앱",
  "모델명": machines[0][0], "시리얼넘버": machines[0][1], "자산기번": machines[0][2], "_원문": doc(machines, region), _hidden: false, ...extra,
});
const JEOMGEOM: FieldRaw[] = [
  frow(1, "2026-10-20", "2026-10-20T02:00:00Z", "엄재현", "E", "홍성지역협력네트워크", [["X4220", "ZJY01", "X7855"]]),
  frow(2, "2026-10-20", "2026-10-20T03:00:00Z", "엄재현", "E", "홍성지역협력네트워크", [["X4300", "28S3B", "X7854"]]),
  frow(3, "2026-10-21", "2026-10-21T07:30:00Z", "한왕주", "C", "한국에스엠에이", [["SL-X4220RX", "28S3B1BH1", "D0090"]]),
  frow(4, "2026-10-21", "2026-10-21T08:30:00Z", "한왕주", "C", "한국에스엠에이", [["SL-X4220RX", "28S3B1BH1", "D0090"]]), // 재전송
  frow(5, "2026-10-22", "2026-10-22T02:00:00Z", "이민구", "C", "이너인포", [["C3070", "520702", "B6394"], ["C3070", "520643", "B3254"], ["C3070", "520589", "B6323"]]),
  frow(6, "2026-10-19", "2026-10-19T02:00:00Z", "박옥주", "B", "잭슨카멜레온", [["C2060", "214079", "A1627"]]), // 팀장
  frow(7, "2026-10-14", "2026-10-14T02:00:00Z", "이권선", "A", "동양팩", [["C2060", "311001", "D6222"]]), // 지난주
  frow(8, "2026-10-23", "2026-10-23T01:00:00Z", "이호준", "", "닥터다이어리", [["X3220", "0A6XB", "B0273"]], { "_출처": "카톡:점검(B)" }), // 오늘, 출처 괄호 팀
  frow(9, "2026-10-21", "2026-10-21T09:00:00Z", "한왕주", "C", "델타", [["D450", "8001203", "A1267"]], { _hidden: true }),
];
const AS: FieldRaw[] = [
  frow(11, "2026-10-12", "2026-10-12T05:52:00Z", "김종희", "D", "비티엑스", [["X3220", "0A6XBJPT", ""]]),
  frow(12, "2026-10-20", "2026-10-20T01:58:00Z", "박영현", "C", "아이더디자인", [["C3375", "840123", "E3200"]]),
  frow(13, "2026-10-23", "2026-10-23T04:39:00Z", "박영현", "C", "아이더디자인", [["C3375", "840123", "E3200"]]), // 다른 날 → 1건 더
];
const FIELD = [...toFieldRows("jeomgeom", JEOMGEOM, teamOf), ...toFieldRows("as_records", AS, teamOf)];

const xp = (id: number, day: string, author: string, vendor: string, region = "", extra: Partial<ExpansionRaw> = {}): ExpansionRaw => ({ id, "날짜": day, "작성자": author, "_업체명": vendor, "지역": region, _hidden: false, ...extra });
const PC: ExpansionRaw[] = [
  xp(1, "2026-10-21", "한왕주", "세원기술단", "C"),
  xp(2, "2026-10-21", "한왕주", "세원기술단", "C"), // 같은 날 같은 업체 재전송
  xp(3, "2026-10-20T09:02:41+00:00", "박영현", "에스에이치", ""), // 시트 미러(UTC 글자) → 10/20 KST, 작성자 팀 C
  xp(4, "2026-10-22T16:30:00+00:00", "이권선", "동양팩", "A"), // 10/23 01:30 KST = 오늘
  xp(5, "2026-10-22", "신정훈", "노비텍", "C"), // 팀장
  xp(6, "2026-09-30T16:00:00+00:00", "이호준", "닥터", "B"), // 10/1 KST
];
const MFP: ExpansionRaw[] = [{ id: 21, "등록일": "2026-10-22", "등록자": "엄재현", "_업체명": "홍성", "상호": "홍성", _hidden: false }];
const EXP = [...toExpansionRows("pc_expansion", PC, teamOf), ...toExpansionRows("mfp_expansion", MFP, teamOf)];

const ev = (id: string, day: string, author: string, team: string, category: string, vendor: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id, createdAt: `${day}T02:00:00Z`, activityDate: day, author, team, category, vendor, quantity: 1, machineCount: 0, sourceText: "", metadata: {}, status: "active", cancelledAt: "", cancelledBy: "", ...extra,
} as ActivityEvent);
const ACTIVITY: ActivityEvent[] = [
  ev("a1", "2026-10-22", "한왕주", "C", "logistics", "물류업체", { sourceText: "구분: 납품" }),
  ev("a2", "2026-10-22", "한왕주", "C", "logistics", "여분업체", { sourceText: "구분: 여분" }), // 팀 현황 '물류' 칸에서 빠짐
  ev("a3", "2026-10-23", "김종희", "D", "logistics", "물류2", { sourceText: "구분: 교체" }),
  ev("a4", "2026-10-20", "이민구", "C", "recontract", "(주)델타"),
  ev("a5", "2026-10-21", "이민구", "C", "recontract", "델타"), // 같은 업체(표기 변형) → 1곳
  ev("a6", "2026-10-21", "박영현", "C", "complaint", "아이더디자인"),
  ev("a7", "2026-10-21", "박영현", "C", "contact_change", "A사"),
  ev("a8", "2026-10-22", "박옥주", "B", "contact_change", "B사"), // 팀장
  ev("a9", "2026-10-22", "이권선", "A", "replacement", "C사"),
  ev("a10", "2026-10-22", "이권선", "A", "replacement", "D사", { status: "cancelled" }), // 오발송
];
/** 팀 현황(OperationsDashboard)과 같은 입구: loadWorkEvents 합성 → 팀장 제외 → countableEvents */
const EVENTS = countableEvents(mergeFieldIntoEvents(mergeExpansionIntoEvents(ACTIVITY, EXP), FIELD).filter((e) => teamOf(e.author) !== "팀장"));

const FACTS: KpiFacts = { roster: ROSTER, field: FIELD, expansion: EXP, events: EVENTS };

describe("기간 — KST 월요일·월말·분기말 경계", () => {
  it("이번 주 월~일, 지난주 같은 요일까지, 이번 달·분기", () => {
    expect(R.week).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(R.prevWeekToDate).toEqual({ from: "2026-10-12", to: "2026-10-16" });
    expect(R.month).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(R.quarter).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(R.weeks8.at(-1)).toMatchObject({ from: "2026-10-19", to: "2026-10-25" });
    expect(R.weeks8[0].from).toBe("2026-08-31");
  });
  it("월요일·분기말·해 넘김", () => {
    expect(kpiRanges("2026-10-26").week).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(kpiRanges("2026-10-26").prevWeekToDate).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(kpiRanges("2026-12-31").quarter).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(kpiRanges("2027-01-01").quarter).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(kpiRanges("2027-01-01").prevMonthToDate).toEqual({ from: "2026-12-01", to: "2026-12-01" });
    expect(kpiRanges("2026-03-31").prevMonthToDate).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("영업일: 주말·한글날·대체공휴일·성탄절 제외, 설정 휴일 추가", () => {
    expect(bizDays("2026-10-01", "2026-10-23")).toBe(15); // 10/5 대체공휴일·10/9 한글날 제외
    expect(bizDays("2026-10-23", "2026-12-31")).toBe(49);
    expect(bizDays("2026-10-23", "2026-12-21")).toBe(42);
    expect(bizDays("2026-10-23", "2026-12-31", ["2026-12-31"])).toBe(48);
  });
});

describe("점검·AS — KPI = 홈·조회 탭·팀 현황·순위표", () => {
  const week = { from: R.week.from, to: R.week.to };
  it("팀별 점검 대수(이번 주)", () => {
    for (const [team, n] of Object.entries({ A: 0, B: 1, C: 4, D: 0, E: 2 })) {
      const kpi = kpiCount("K1", FACTS, { team }, week, ctx)?.n;
      const lookup = fieldTally(FIELD, { kind: "inspection", team, ...week }).count; // DataLookup
      const status = EVENTS.filter((e) => e.team === team && e.category === "inspection" && e.activityDate >= week.from && e.activityDate <= week.to)
        .reduce((s, e) => s + Math.max(1, Number(e.machineCount) || 0), 0); // OperationsDashboard inspectionMachineSum
      expect([kpi, lookup, status]).toEqual([n, n, n]);
    }
    expect(fieldKpi(FIELD, "inspection", R).value).toBe(countField(FIELD, { kind: "inspection", ...week })); // Home weekInspections
    expect(fieldKpi(FIELD, "inspection", R).value).toBe(7);
  });
  it("사람별 AS(순위표 METRICS as = 사람 활동 수) · 지난주 대비", () => {
    expect(kpiCount("K3", FACTS, { author: "박영현" }, week, ctx)?.n).toBe(2);
    expect(EVENTS.filter((e) => e.author === "박영현" && e.category === "as" && e.activityDate >= week.from).length).toBe(2);
    const v = fieldKpi(FIELD, "as", R);
    expect([v.value, v.prev]).toEqual([2, 1]); // 이번 주 2 vs 지난주 월~금 1(김종희 10/12 는 일요일 → 지난주 범위 밖)
  });
});

describe("확장성 — KPI = 조회 탭(expansionTally) = 팀 현황·순위표(활동 기록 합성)", () => {
  it("PC 팀별·전체(이번 달), 복합기", () => {
    const month = R.month;
    for (const [team, n] of Object.entries({ A: 1, B: 1, C: 2, D: 0, E: 0 })) {
      const kpi = kpiCount("K7", FACTS, { team }, month, ctx)?.n;
      const lookup = expansionTally(EXP, { kind: "expansion_it", team, ...month }).count;
      const status = EVENTS.filter((e) => e.team === team && e.category === "expansion_it" && e.activityDate >= month.from && e.activityDate <= month.to).length;
      expect([kpi, lookup, status]).toEqual([n, n, n]);
    }
    expect(expansionKpi(EXP, "expansion_it", R).value).toBe(countExpansion(EXP, { kind: "expansion_it", ...R.month }));
    expect(kpiCount("K8", FACTS, {}, R.month, ctx)?.n).toBe(1);
  });
});

describe("활동 기록 종류 — 팀 현황 칸 규칙", () => {
  it("물류(여분·마감 제외)·재계약/불만(업체 1곳)·담당자 변경(팀장 제외)·교체(오발송 제외)", () => {
    const wk = R.week;
    expect(kpiCount("K24", FACTS, {}, wk, ctx)?.n).toBe(2);
    expect(kpiCount("K25", FACTS, { team: "C" }, wk, ctx)?.n).toBe(1);
    expect(kpiCount("K26", FACTS, {}, wk, ctx)?.n).toBe(1);
    expect(kpiCount("K27", FACTS, {}, wk, ctx)?.n).toBe(1);
    expect(kpiCount("K28", FACTS, { author: "이권선" }, wk, ctx)?.n).toBe(1);
  });
});

describe("미처리 — KPI = 홈 미처리 판(countUnhandledTabs)", () => {
  it("접수·일정 나눠도 합 = 판 전체, 팀 탭 같음", () => {
    const rec: ReceptionInput[] = [
      { id: "r1", receipt_date: "2026-10-20", type: "복합기 AS", vendor: "가", region: "C", status: "접수" },
      { id: "r2", receipt_date: "2026-10-10", type: "경영지원", vendor: "나", region: "", status: "진행중" },
    ];
    const tic: TicketInput[] = [
      { id: "t1", team: "C", date: "2026-10-21", vendor: "가", assignee: "한왕주", status: "예정", scheduleType: "AS", receptionId: "r1" }, // 접수와 중복
      { id: "t2", team: "D", date: "2026-10-15", vendor: "다", assignee: "", status: "예정", scheduleType: "물류" },
    ];
    const rows = mergeUnhandled(rec, tic, TODAY);
    const board = countUnhandledTabs(rows);
    const k = unhandledKpis(rows);
    expect((k.K16.value || 0) + (k.K17.value || 0)).toBe(board["전체"]);
    expect(kpiCount("K16", { unhandled: rows }, { team: "C" }, R.week, ctx)?.n).toBe(1);
    expect(kpiCount("K17", { unhandled: rows }, { team: "D" }, R.week, ctx)?.n).toBe(1);
    expect(k.tabs).toEqual(board);
  });
});

describe("OKR — KPI = OKR 월 통합집계 파트 카드", () => {
  it("파트 달성률·전체", () => {
    const goals = [1, 2, 3].map((no) => ({ no, pillar: "P", bottleneck: "", objective: `목표${no}`, criteria: "" }));
    const cycle: OkrCycle = { id: "2026-10", kind: "month", title: "", year: 2026, month: 10, week_no: null, start_date: "2026-10-01", end_date: "2026-10-31", parent_id: null, goals, feedback: {}, goals_origin: "leader" };
    const rep = (team: string, js: string[]): OkrReport => ({ ...emptyReport("2026-10", team), rows: js.map((j, i) => ({ no: i + 1, actual: "", judgment: j, reason: "", plan: "", evidence: "" })) });
    const reports = [rep("A", ["완료", "미흡", ""]), rep("B", ["해당없음", "완료", "완료"]), { ...rep("C", ["미착수"]), member: "한왕주" }];
    const card = (team: string) => achievementRate(goals.map((g) => resultRowFor(reports.find((r) => r.team === team && !r.member), g.no))); // OkrMonthRollup perTeam
    const v = okrKpi({ cycle, quarter: null, reports }, R);
    expect(v.byTeam.map((t) => t.value)).toEqual(["A", "B", "C", "D"].map(card));
    expect(v.byTeam.map((t) => t.value)).toEqual([50, 100, null, null]);
    expect(v.value).toBe(80); // 4/5
    expect(kpiCount("K19", { okr: { cycle, quarter: null, reports } }, { team: "A" }, R.month, ctx)).toEqual({ n: 1, d: 2 });
  });
});

describe("블로그 — KPI = 주간현황판 블로그 칸(countBlog)", () => {
  it("이번 주 건수 같고, 인원 × 주 2건 목표", () => {
    const rows: BlogRow[] = [
      { seq: "1", date: "2026-10-19", name: "한왕주", dept: "CS", points: 1 },
      { seq: "2", date: "2026-10-22", name: "이권선", dept: "CS", points: 1 },
      { seq: "3", date: "2026-10-26", name: "한왕주", dept: "CS", points: 1 },
      { seq: "4", date: "2026-10-18", name: "한왕주", dept: "CS", points: 1 },
    ];
    const card = countBlog(rows, blogPeriods(TODAY).week).count;
    expect(kpiCount("K20", { blog: rows, roster: ROSTER }, {}, R.week, ctx)?.n).toBe(card);
    expect(card).toBe(2);
    const prog = kpiProgress("K20", { blog: rows, roster: ROSTER }, { ranges: R, period: "week", settings: parseKpiTargets(""), teamOf });
    expect(prog[0]).toMatchObject({ scope: "all", actual: 2, headcount: 7, target: 14 }); // 7명 × 2, 이번 주 영업일 5
    expect(prog.find((x) => x.key === "C")).toMatchObject({ actual: 1, headcount: 3, target: 6 });
    expect(prog.find((x) => x.key === "한왕주")).toMatchObject({ scope: "person", actual: 1, target: 2, rate: 50 });
  });
});

describe("분기 점검 진행 — 홈·워킨맵 식 + 남은 영업일·하루 필요량", () => {
  const places: WorkinPlaceLite[] = [
    ...Array.from({ length: 10 }, (_, i) => ({ team: "C", label: i < 4 ? "G5" : "G1", kind: "quarter" })),
    { team: "C", label: "G12", kind: "quarter" },
    { team: "C", label: "G3", kind: "monthly" },
    { team: "A", label: "G2", kind: "monthly" },
  ];
  it("홈 teamProgress 와 같은 값", () => {
    const homeFormula = (team: string) => { // Home.tsx loadTelemetry 의 식 그대로
      const rows = places.filter((w) => w.team === team);
      const q = rows.filter((w) => w.kind === "quarter"), m = rows.filter((w) => w.kind === "monthly");
      const u = (l: string) => (l === "G2" ? 1 : l === "G3" ? 2 : l === "G5" || l === "G12" ? 3 : 0);
      return { team, total: q.length + m.length * 3, done: q.filter((w) => w.label === "G5" || w.label === "G12").length + m.reduce((s, w) => s + u(w.label), 0) };
    };
    expect(teamWorkinProgress(places)).toEqual(["A", "B", "C", "D", "E"].map(homeFormula));
    expect(kpiCount("K2", { workin: places }, { team: "C" }, R.quarter, ctx)).toEqual({ n: 7, d: 14 });
  });
  it("워킨맵 패널 꼴: 분기 말일 49일 · 말일 10일 전 42일, 필요량 = 남은 수 ÷ 일 ÷ 인원", () => {
    const pace = workinPace(places, R, ROSTER);
    const c = pace.find((p) => p.team === "C")!;
    expect([c.done, c.total, c.rate, c.remaining, c.headcount]).toEqual([7, 14, 50, 7, 3]);
    expect([c.toEnd.date, c.toEnd.days, c.toEarly.date, c.toEarly.days]).toEqual(["2026-12-31", 49, "2026-12-21", 42]);
    expect(c.pacePerPerson).toBe(7 / 15 / 3); // 반올림 전 값(표시 반올림은 위젯)
    expect(c.toEnd.needHead).toBe(7 / 49 / 3);
    // 남은 양이 작아도 0 이 되지 않는다(예전 소수 1자리 반올림: 1 ÷ 49 ÷ 3 = 0.0068 → 0 → "목표 달성" 오표시)
    const tiny = workinPace([{ team: "C", label: "G1", kind: "quarter" }], R, ROSTER).find((p) => p.team === "C")!;
    expect(tiny.toEnd.needHead).toBeGreaterThan(0);
    expect(tiny.toEnd.need4).toBeGreaterThan(0);
    // 사용자 예시 373/1469(3인·4인)도 반올림 전 값 → 표시 1자리면 7.5·5.6·8.7·6.5
    const big = (days: number, members: number) => Number(((1469 - 373) / days / members).toFixed(1));
    expect([big(49, 3), big(49, 4), big(42, 3), big(42, 4)]).toEqual([7.5, 5.6, 8.7, 6.5]);
    // 사용자 예시 "점검 373/1469 → 분기 말일 49일 7.5건/일 · 말일 10일 전 42일 8.7건/일"(3인), 5.6·6.5 는 4인 칸
    expect([dailyNeedText(1469 - 373, 49, 3), dailyNeedText(1469 - 373, 49, 4), dailyNeedText(1469 - 373, 42, 3), dailyNeedText(1469 - 373, 42, 4)]).toEqual(["7.5건/일", "5.6건/일", "8.7건/일", "6.5건/일"]);
    expect(pace[0]).toMatchObject({ team: "전체", done: 8, total: 17 });
  });
});

describe("목표(인당 × 인원) · 주요 목표 · 설정", () => {
  it("PC 인당 영업일 1건: 이번 달 영업일 20일(10/5·10/9 제외) × 인원", () => {
    const base = { range: R.month, period: "month" as const, today: TODAY, teamCount: 5, holidays: [] };
    expect(kpiTargetFor("K7", { perPersonBizDay: 1 }, { ...base, scope: "team", headcount: 3 })).toEqual({ full: 60, toDate: 45 });
  });
  it("초과 파트당 월 2 · 전체 = 파트 수 × 2(5팀 = 10) · 인당 설정 · 주 단위는 목표 없음", () => {
    const base = { range: R.month, period: "month" as const, today: TODAY, teamCount: 5, holidays: [] };
    const t = parseKpiTargets("").targets.K10;
    expect(kpiTargetFor("K10", t, { ...base, scope: "team", headcount: 3 }).full).toBe(2);
    expect(kpiTargetFor("K10", t, { ...base, scope: "all", headcount: 7 }).full).toBe(10);
    expect(kpiTargetFor("K10", t, { ...base, period: "quarter", range: R.quarter, scope: "all", headcount: 7 }).full).toBe(30);
    expect(kpiTargetFor("K10", { ...t, monthTotal: 8 }, { ...base, scope: "all", headcount: 7 }).full).toBe(8); // 설정하면 그 값
    expect(kpiTargetFor("K10", t, { ...base, scope: "person", headcount: 1 }).full).toBeNull();
    expect(kpiTargetFor("K10", { ...t, perPersonMonth: 1 }, { ...base, scope: "person", headcount: 1 }).full).toBe(1);
    expect(kpiTargetFor("K10", t, { ...base, period: "week", range: R.week, scope: "team", headcount: 3 }).full).toBeNull();
  });
  it("K10 '—' 원인: 달성표 기본 기간(이번 주)엔 월 목표가 없었다 → 기간을 월·분기로 묶어 이번 주 보기에서도 이번 달 목표", () => {
    const K10 = KPI_DEFS.find((d) => d.id === "K10")!;
    expect(K10.periods).toEqual(["month", "quarter"]);
    const rows = kpiProgress("K10", { overage: [], roster: ROSTER }, { ranges: R, period: "month", settings: parseKpiTargets(""), teamOf });
    expect(rows[0]).toMatchObject({ scope: "all", actual: 0, target: 10 });
    expect(rows.filter((r) => r.scope === "team").map((r) => r.target)).toEqual([2, 2, 2, 2, 2]);
    expect(rows.filter((r) => r.scope === "person").every((r) => r.target === null)).toBe(true); // 개인은 실적만
    const v = overageKpi([], R, parseKpiTargets("").targets.K10);
    expect([v.target, v.extra.quarterTarget]).toEqual([10, 30]);
  });
  it("주요 목표 기본 7개, 설정으로 끄고 켬, 이상한 값은 버리고 알림", () => {
    expect(mainKpiIds(parseKpiTargets("").targets)).toEqual(["K2", "K33", "K7", "K10", "K20", "K21", "K34"]);
    const s = parseKpiTargets(JSON.stringify({ K7: { main: false, perPersonBizDay: 2 }, K1: { main: true }, K99: {}, K10: { perTeamMonth: -1 }, holidays: ["2026-12-31", "x"] }));
    expect(mainKpiIds(s.targets)).toContain("K1");
    expect(mainKpiIds(s.targets)).not.toContain("K7");
    expect(s.targets.K7.perPersonBizDay).toBe(2);
    expect(s.targets.K10.perTeamMonth).toBe(2);
    expect(s.holidays).toEqual(["2026-12-31"]);
    expect(s.error).toMatch(/K99/);
    expect(parseKpiTargets("{깨짐").error).toMatch(/JSON/);
  });
  it("정의 목록: id 중복 없음, 원본 없는 KPI 는 unlinked + 셈 null", () => {
    expect(new Set(KPI_DEFS.map((d) => d.id)).size).toBe(KPI_DEFS.length);
    for (const d of KPI_DEFS.filter((x) => x.status === "unlinked")) expect(kpiCount(d.id, FACTS, {}, R.week, ctx)).toBeNull();
  });
});

describe("CS 전체 → 팀 → 개인, 금일 현황", () => {
  it("진행 표 순서와 합", () => {
    const rows = kpiProgress("K7", FACTS, { ranges: R, period: "month", settings: parseKpiTargets(""), teamOf });
    expect(rows.map((r) => r.scope).slice(0, 6)).toEqual(["all", "team", "team", "team", "team", "team"]);
    const teams = rows.filter((r) => r.scope === "team");
    expect(teams.reduce((n, r) => n + (r.actual || 0), 0)).toBe(rows[0].actual);
    expect(rows[0]).toMatchObject({ actual: 4, headcount: 7, target: 140 });
    expect(rows.find((r) => r.key === "한왕주")).toMatchObject({ actual: 1, target: 20 });
  });
  it("금일: 점검·AS·PC 오늘 값 = 같은 함수의 오늘 범위", () => {
    const line = kpiTodayLine(FACTS, R, teamOf);
    const get = (id: string) => line.find((x) => x.id === id)?.value;
    expect(get("K1")).toBe(countField(FIELD, { kind: "inspection", from: TODAY, to: TODAY }));
    expect(get("K1")).toBe(1);
    expect(get("K3")).toBe(1);
    expect(get("K7")).toBe(1);
    expect(get("K24")).toBe(1);
    expect(get("K14")).toBeNull(); // 미수 원본 안 읽음 = null(0 아님)
  });
});

describe("양식 표 KPI(새로 정의한 것) — 팀·재전송·팀장 규칙", () => {
  it("초과조정 방문: 같은 사람·날·업체 1건, 팀장 제외, 출처 괄호 팀", () => {
    const raws: FormRaw[] = [
      { id: 1, created_at: "2026-10-20T02:00:00Z", "방문일": "2026-10-20", "작성자": "한왕주", "지역": "C", "_업체명": "가", "고객반응": "수락", "진행상태": "제안완료" },
      { id: 2, created_at: "2026-10-20T02:05:00Z", "방문일": "2026.10.20", "작성자": "한왕주", "지역": "C", "_업체명": "가" },
      { id: 3, created_at: "2026-10-21T02:00:00Z", "방문일": "", "작성자": "이호준", "지역": "", "_출처": "카톡:초과조정(B)", "_업체명": "나" },
      { id: 4, created_at: "2026-10-21T02:00:00Z", "방문일": "2026-10-21", "작성자": "신정훈", "지역": "C", "_업체명": "다" },
    ];
    const rows = toFormRows(raws, "방문일", teamOf);
    expect(countOverageVisits(rows, R.month)).toBe(2);
    expect(countOverageVisits(rows, { ...R.month, team: "B" })).toBe(1);
    expect(kpiCount("K11", { overage: rows }, {}, R.month, ctx)).toEqual({ n: 1, d: 2 });
  });
  it("재계약 확인 지남: 업체별 마지막 기록, 끝난 건·글자 날짜 따로", () => {
    const raws: FormRaw[] = [
      { id: 1, created_at: "2026-10-01T00:00:00Z", "작성자": "한왕주", "지역": "C", "_업체명": "가", "다음확인일": "2026-10-10", "최종상태": "진행중" },
      { id: 2, created_at: "2026-10-15T00:00:00Z", "작성자": "한왕주", "지역": "C", "_업체명": "가", "다음확인일": "2026-11-10", "최종상태": "진행중" }, // 최신 → 안 지남
      { id: 3, created_at: "2026-10-02T00:00:00Z", "작성자": "이권선", "지역": "A", "_업체명": "나", "다음확인일": "2026-10-20", "최종상태": "진행중" }, // 지남
      { id: 4, created_at: "2026-10-02T00:00:00Z", "작성자": "이권선", "지역": "A", "_업체명": "다", "다음확인일": "2026-10-01", "최종상태": "종료" },
      { id: 5, created_at: "2026-10-02T00:00:00Z", "작성자": "이권선", "지역": "A", "_업체명": "라", "다음확인일": "차주 중", "최종상태": "진행중" },
    ];
    const o = recontractOverdue(toFormRows(raws, "날짜", teamOf), TODAY);
    expect([o.count, o.textDates]).toEqual([1, 1]);
  });
});

describe("달성표 행 상태(2026-10-24) — 달성·순항·부족·목표 없음·원본 없음", () => {
  it("판정 표", () => {
    const st = (actual: number | null, target: number | null, elapsed: number | null, basis: Parameters<typeof kpiRowStatus>[0]["basis"], extra: { better?: "up" | "down"; goalPct?: number | null } = {}) =>
      kpiRowStatus({ actual, target, elapsed, basis, ...extra });
    expect(st(null, 10, 50, "perPersonWeek")).toBe("pending"); // 원본 없음 — 0 아님
    expect(st(5, null, 50, "none")).toBe("none");
    expect(st(10, 10, 50, "perPersonWeek")).toBe("done"); // 실적 ≥ 목표
    expect(st(12, 10, 50, "perPersonWeek")).toBe("done");
    expect(st(5, 10, 50, "perPersonWeek")).toBe("onTrack"); // 50% ≥ 경과 50%
    expect(st(4, 10, 50, "perPersonWeek")).toBe("behind");
    expect(st(4, 10, null, "perPersonWeek")).toBe("behind"); // 경과 모름 = 100
    expect(st(400, 1000, 30, "workin")).toBe("onTrack"); // 분기 점검 40% ≥ 경과 30%
    expect(st(0, 0, 50, "zero", { better: "down" })).toBe("done"); // 미처리 0 = 정상
    expect(st(2, 0, null, "zero", { better: "down" })).toBe("behind");
    expect(st(9, 10, 10, "ratio", { goalPct: 100 })).toBe("behind"); // 비율은 경과를 안 본다
    expect(st(10, 10, 10, "ratio", { goalPct: 100 })).toBe("done");
    expect(st(3, 10, 10, "ratio", { goalPct: null })).toBe("none");
  });
});

describe("⑥ 오버홀(K33)만 직책자(팀장·파트장·부파트장) 제외 — 집계·목표 인원 모두", () => {
  const roster: RosterMember[] = [
    { name: "한왕주", team: "C", title: "" }, { name: "박영현", team: "C", title: "파트장" }, { name: "이민구", team: "C", title: "부파트장" },
    { name: "엄재현", team: "E", title: "" }, { name: "이권선", team: "A", title: "팀장" },
  ];
  const oh = (author: string, points: number, dept = "", date = "2026-10-20", repairPoints = 0) => ({ author, date, points, repairPoints, dept });
  const f: KpiFacts = { roster, overhaul: [oh("한왕주", 2, "", "2026-10-20", 1), oh("박영현", 5), oh("이민구", 3), oh("엄재현", 1), oh("이권선", 4), oh("외부김", 9, "외부인력"), oh("한왕주", 7, "", "2026-10-12")] };

  it("집계: 직책자 기록은 빼고 프로만", () => {
    expect(kpiCount("K33", f, {}, R.week, ctx)?.n).toBe(3); // 한왕주 2 + 엄재현 1
    expect(kpiCount("K33", f, { team: "C" }, R.week, ctx)?.n).toBe(2);
    expect(titledNames(roster)).toEqual(new Set(["박영현", "이민구", "이권선"]));
  });
  it("원본 = 오버홀 시트: 외부인력 제외, 명단에 없으면 부서명 끝 글자 팀, 수리포인트는 사람별 따로", () => {
    const g: KpiFacts = { roster, overhaul: [...f.overhaul!, oh("신입", 2, "경기D")] };
    expect(kpiCount("K33", g, {}, R.week, ctx)?.n).toBe(5);
    expect(kpiCount("K33", g, { team: "D" }, R.week, ctx)?.n).toBe(2);
    expect(kpiCount("K33", { roster }, {}, R.week, ctx)).toBeNull(); // 시트 못 읽음 = null(0 아님)
    const p = overhaulByPerson(g.overhaul!, roster, teamOf, R.week);
    expect(p.byPerson.find((x) => x.name === "한왕주")).toMatchObject({ points: 2, repairPoints: 1 });
  });
  it("목표 인원도 직책자 제외(인당 주 2) — 개인 칸에도 직책자 없음", () => {
    const rows = kpiProgress("K33", f, { ranges: R, period: "week", settings: parseKpiTargets(""), teamOf });
    expect(rows[0]).toMatchObject({ scope: "all", headcount: 2, actual: 3, target: 4 });
    expect(rows.find((r) => r.key === "C")).toMatchObject({ headcount: 1, target: 2 });
    expect(rows.filter((r) => r.scope === "person").map((r) => r.key).sort()).toEqual(["엄재현", "한왕주"]);
  });
  it("다른 KPI(PC 확장성)는 팀장 팀만 제외 — 파트장·부파트장도 인원에 든다", () => {
    const rows = kpiProgress("K7", { ...f, expansion: [] }, { ranges: R, period: "week", settings: parseKpiTargets(""), teamOf });
    expect(rows[0].headcount).toBe(5);
    expect(rows.filter((r) => r.scope === "person")).toHaveLength(5);
  });
});

describe("⑤ OKR 주 단위 — okrWeekResult", () => {
  it("파트 종합 판정 우선, 없으면 그 주 팀원 판정 중 가장 나쁜 것. 판정 없는 파트 = 미작성", () => {
    const goals = [1, 2].map((no) => ({ no, pillar: "P", bottleneck: "", objective: `목표${no}`, criteria: "" }));
    const rep = (team: string, member: string, js: string[]): OkrReport => ({ ...emptyReport("2026-10-W3", team, member), rows: js.map((j, i) => ({ no: i + 1, actual: "", judgment: j, reason: "", plan: "", evidence: "" })) });
    const reports = [rep("A", "", ["완료", "완료"]), rep("A", "한X", ["미착수", "미착수"]), rep("B", "이호준", ["완료", "미흡"]), rep("B", "박X", ["부분달성", ""])];
    const r = okrWeekResult({ id: "2026-10-W3", weeks: [], goals, reports });
    expect(r.byTeam).toEqual([{ team: "A", pct: 100 }, { team: "B", pct: 0 }, { team: "C", pct: null }, { team: "D", pct: null }]);
    expect(r.pct).toBe(50);
    expect(r.missingTeams).toEqual(["C", "D"]);
    expect(kpiCount("K19", { okr: { cycle: null, quarter: null, reports: [], week: { id: "2026-10-W3", weeks: [], goals, reports } } }, {}, R.week, ctx)).toEqual({ n: 2, d: 4 });
  });
  it("범위: 팀 하나 · 개인(member 행) · 범위 글자 · 개인 목록", () => {
    const goals = [1, 2].map((no) => ({ no, pillar: "P", bottleneck: "", objective: `목표${no}`, criteria: "" }));
    const rep = (team: string, member: string, js: string[], cycle = "2026-10-W3"): OkrReport => ({ ...emptyReport(cycle, team, member), rows: js.map((j, i) => ({ no: i + 1, actual: "", judgment: j, reason: "", plan: "", evidence: "" })) });
    const reports = [rep("A", "", ["완료", "완료"]), rep("A", "한X", ["미착수", "완료"]), rep("B", "이호준", ["완료", "미흡"]), rep("B", "박X", ["부분달성", ""]), rep("C", "최X", ["완료"], "2026-10-W2")];
    const w = { id: "2026-10-W3", weeks: [], goals, reports };
    const all = okrWeekResult(w);
    expect(okrWeekResult(w, w.id, { team: "ALL" })).toEqual(all); // 기존 그대로
    const b = okrWeekResult(w, w.id, { team: "B" });
    expect([b.pct, b.missingTeams, b.byTeam]).toEqual([0, [], [{ team: "B", pct: 0 }]]);
    expect(okrWeekResult(w, w.id, { team: "C" }).missingTeams).toEqual(["C"]); // 이번 주 C 판정 없음
    const me = okrWeekResult(w, w.id, { team: "A", member: "한X" });
    expect([me.pct, me.missingTeams, me.byTeam]).toEqual([50, [], [{ team: "A", pct: 50 }]]);
    expect(okrWeekResult(w, w.id, { team: "A", member: "없는사람" }).pct).toBeNull();
    expect(kpiCount("K19", { okr: { cycle: null, quarter: null, reports: [], week: w } }, { author: "이호준" }, R.week, ctx)).toEqual({ n: 1, d: 2 });
    expect(okrWeekMembers(w, "B")).toEqual(["박X", "이호준"]);
    expect(okrWeekMembers(w)).toEqual(["박X", "이호준", "최X", "한X"]);
    expect(okrScopeLabel(undefined, "week")).toBe("CS 4파트(A~D) · 이번 주");
    expect(okrScopeLabel({ team: "A" }, "week")).toBe("A파트 · 이번 주");
    expect(okrScopeLabel({ team: "B", member: "이호준" }, "month")).toBe("이호준(B) · 이번 달");
  });
});

describe("블로그 올해 누계 — countBlog 1/1~오늘", () => {
  it("사람별 누계(작년·내일 이후 제외)", () => {
    const rows: BlogRow[] = [
      { seq: "1", date: "2026-01-01", name: "한왕주", dept: "CS", points: 1 },
      { seq: "2", date: "2026-10-23", name: "한왕주", dept: "CS", points: 1 },
      { seq: "3", date: "2025-12-31", name: "한왕주", dept: "CS", points: 1 },
      { seq: "4", date: "2026-10-24", name: "이권선", dept: "CS", points: 1 },
      { seq: "5", date: "2026-05-02", name: "이권선", dept: "CS", points: 1 },
    ];
    const m = blogYearTotals(rows, TODAY);
    expect(m.get("한왕주")).toBe(2);
    expect(m.get("이권선")).toBe(1);
  });
});
