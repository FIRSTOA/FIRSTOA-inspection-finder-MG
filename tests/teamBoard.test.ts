import { describe, expect, it } from "vitest";
import { headlineNumbers, kindsForTab, teamBoardFromParts, teamPill, toggleTeamFilter, TEAM_MINI_KPIS } from "../src/kpi/teamBoard";
import type { TableRowModel } from "../src/kpi/homeKpiModel";
import type { UnhandledRow } from "../src/homeUnhandled";
import type { OkrWeekFacts } from "../src/kpi/kpiCompute";
import type { KpiStatus } from "../src/kpi/KpiWidgets.view";

type Cell = [number | null, number | null, KpiStatus];
const row = (id: string, name: string, main: boolean, teams: Partial<Record<"A" | "B" | "C" | "D" | "E", Cell>>): TableRowModel => ({
  id, name, unit: "건", targetLabel: "", basis: "", status: "onTrack", pace: 0.5, main, cellState: "ready",
  cells: [{ scope: "CS", value: null, target: null, status: "none" }, ...(["A", "B", "C", "D", "E"] as const).map((t) => {
    const c = teams[t];
    return { scope: t, value: c ? c[0] : null, target: c ? c[1] : null, status: c ? c[2] : ("none" as KpiStatus) };
  })],
  teamBars: [], people: [],
});
const un = (team: UnhandledRow["team"], ageDays: number, key: string): UnhandledRow => ({ key, source: "reception", kind: "CS접수", team, date: "2026-10-20", vendor: "", title: "", assignee: "", status: "", ageDays });
const okrWeek: OkrWeekFacts = {
  id: "w4", weeks: [{ id: "w3", weekNo: 3, label: "3주" }, { id: "w4", weekNo: 4, label: "4주" }], goals: [],
  reports: [
    { cycle_id: "w3", team: "A", member: "가", header: {}, rows: [] },
    { cycle_id: "w3", team: "A", member: "나", header: {}, rows: [] },
    { cycle_id: "w4", team: "A", member: "가", header: {}, rows: [] },
  ] as unknown as OkrWeekFacts["reports"],
};

describe("팀 보드 — 상태 알약", () => {
  it("부족이 하나라도 있으면 부족, 전부 달성이면 달성, 아니면 순항, 판정 없으면 판정 없음", () => {
    expect(teamPill(["done", "onTrack", "behind"])).toBe("behind");
    expect(teamPill(["done", "done", "none", "pending"])).toBe("done");
    expect(teamPill(["done", "onTrack"])).toBe("onTrack");
    expect(teamPill(["none", "pending"])).toBe("none");
  });
});

describe("팀 보드 — 카드 조합", () => {
  const rows = [
    row("K20", "블로그 답글", true, { A: [2, 8, "behind"], B: [8, 8, "done"] }),
    row("K33", "오버홀", true, { A: [5, 8, "behind"], B: [8, 8, "done"] }),
    row("K2", "분기 점검 진행", false, { A: [34, 50, "onTrack"], E: [10, 20, "behind"] }),
  ];
  const cards = teamBoardFromParts({ rows, unhandled: [un("A", 0, "1"), un("A", 12, "2"), un("B", 0, "3"), un("경영", 40, "4")], roster: [{ name: "가", team: "A" }, { name: "나", team: "A" }, { name: "다", team: "E" }], okrWeek, okrMissing: { A: 1 } });
  const A = cards.find((c) => c.team === "A")!, B = cards.find((c) => c.team === "B")!, E = cards.find((c) => c.team === "E")!;
  it("5장 순서 A·B·C·D·CSS, 인원·미처리·정기점검 %", () => {
    expect(cards.map((c) => c.label)).toEqual(["A", "B", "C", "D", "CSS"]);
    expect(A.headcount).toBe(2);
    expect(A.unhandled).toBe(2);
    expect(A.inspectionPct).toBe(68);
    expect(A.pill).toBe("behind");
    expect(B.pill).toBe("done");
  });
  it("주의 한 줄: 가장 낮은 % 부족 지표 · OKR 미작성 n명 · 가장 오래된 미처리 n일", () => {
    expect(A.alerts).toEqual(["블로그 답글 25%", "OKR 미작성 1명", "미처리 최장 12일"]);
    expect(B.alerts).toEqual([]); // 오늘 들어온 미처리는 주의 아님
  });
  it("CSS(E)는 OKR 대상이 아니다 — okrApplies false, % null", () => {
    expect(E.okrApplies).toBe(false);
    expect(E.okrPct).toBeNull();
    expect(E.alerts.some((a) => a.includes("OKR"))).toBe(false);
    const e2 = teamBoardFromParts({ rows, unhandled: [], roster: [], okrWeek, okrMissing: { E: 3 } as never }).find((c) => c.team === "E")!;
    expect(e2.alerts.some((x) => x.includes("OKR"))).toBe(false);
  });
  it("미니 타일 4개(블로그·오버홀·재계약·IT 퀴즈) — 지표 id 는 이름으로 찾음, 원본 없으면 준비 중", () => {
    expect(TEAM_MINI_KPIS.map((t) => t.short)).toEqual(["블로그", "오버홀", "재계약", "IT 퀴즈"]);
    expect(A.tiles[0]).toMatchObject({ label: "블로그", status: "behind", pct: 25 });
    expect(A.tiles[2].status).toBe("pending");
  });
  it("묶음이 없으면 숫자는 null(0 으로 그리지 않음)", () => {
    const empty = teamBoardFromParts({ rows: null, unhandled: null, roster: null, okrWeek: null });
    expect(empty.every((c) => c.unhandled === null && c.okrPct === null && c.inspectionPct === null && c.headcount === null)).toBe(true);
    expect(headlineNumbers(null)).toEqual({ unhandled: null, okrPct: null, inspectionPct: null });
  });
});

describe("팀 보드 — 필터", () => {
  it("같은 팀을 다시 누르면 전체(null), 다른 팀이면 그 팀", () => {
    expect(toggleTeamFilter(null, "C")).toBe("C");
    expect(toggleTeamFilter("C", "C")).toBeNull();
    expect(toggleTeamFilter("C", "E")).toBe("E");
  });
});

describe("미처리 칸 — 탭별 보이는 종류(kindsForTab)", () => {
  it("전체는 8종 + 재계약, 팀은 현장 5종, 부서는 한 칸, 기타는 있는 종류만", () => {
    expect(kindsForTab("전체")).toEqual({ kinds: ["CS접수", "원격이관", "IT", "경영지원", "운영지원", "영업팀", "물류"], recontract: true });
    expect(kindsForTab("C")).toEqual({ kinds: ["CS접수", "원격이관", "IT", "물류"], recontract: false });
    expect(kindsForTab("E").kinds).not.toContain("경영지원");
    expect(kindsForTab("경영")).toEqual({ kinds: ["경영지원"], recontract: false });
    expect(kindsForTab("영업").kinds).toEqual(["영업팀"]);
    expect(kindsForTab("기타", { CS접수: 3, IT: 0 })).toEqual({ kinds: ["CS접수"], recontract: false });
  });
});
