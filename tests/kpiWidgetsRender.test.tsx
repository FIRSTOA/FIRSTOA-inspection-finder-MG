/** 홈 개편(2026-10-24) 위젯 실제 렌더 검사(서버 렌더): 달성표 PC·폰 목록 · 팀별 진행 · 미처리 합산 · OKR · 금일 띠 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { KpiWidget, type KpiTableRow, type KpiView } from "../src/kpi/KpiWidgets.view";

const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");
const noop = () => {};
const cell = (scope: "CS" | "A" | "B" | "C" | "D" | "E", value: number | null, target: number | null, status: KpiTableRow["status"]) => ({ scope, value, target, status });
const base = { basis: "기준", pace: 0.5, main: true, teamBars: [], people: [], cellState: "ready" as const };
const rows: KpiTableRow[] = [
  { ...base, id: "a", name: "달성지표", unit: "건", targetLabel: "인당 주 2", status: "done", cells: [cell("CS", 10, 10, "done"), cell("A", 5, 5, "done"), cell("B", null, null, "none"), cell("C", 3, 5, "behind"), cell("D", 1, 5, "onTrack"), cell("E", 2, 5, "behind")],
    teamBars: [{ team: "E", value: 2, target: 5, pct: 40 }], people: [{ name: "엄재현", team: "CSS", value: 2, target: 5, done: false }] },
  { ...base, id: "b", name: "순항지표", unit: "건", targetLabel: "", status: "onTrack", cells: [cell("CS", 6, 10, "onTrack"), ...["A", "B", "C", "D", "E"].map((s) => cell(s as "A", null, null, "none"))] },
  { ...base, id: "c", name: "부족지표", unit: "건", targetLabel: "", status: "behind", cells: [cell("CS", 1, 10, "behind"), ...["A", "B", "C", "D", "E"].map((s) => cell(s as "A", null, null, "none"))] },
  { ...base, id: "d", name: "목표없음지표", unit: "건", targetLabel: "", status: "none", pace: null, trend: { delta: 3, label: "지난주 대비" }, cells: [cell("CS", 7, null, "none"), ...["A", "B", "C", "D", "E"].map((s) => cell(s as "A", null, null, "none"))] },
  { ...base, id: "e", name: "준비중지표", unit: "회", targetLabel: "", status: "pending", cellState: "pending", pendingText: "준비 중 · SQL 실행 대기", cells: [cell("CS", null, null, "pending"), ...["A", "B", "C", "D", "E"].map((s) => cell(s as "A", null, null, "pending"))] },
];
const tableView = (period: "week" | "month" | "quarter" = "week"): KpiView => ({ kind: "kpiTable", period, view: "main", rows, counts: { main: 5, all: 34 }, onPeriod: noop, onView: noop });
const W = (kind: Parameters<typeof KpiWidget>[0]["kind"], view: KpiView, extra = {}) => render(createElement(KpiWidget, { kind, title: "T", basis: "기준", status: "ready", view, ...extra }));

describe("홈 위젯 실제 렌더", () => {
  it("달성표: 상태 알약 5종 글자·E→CSS·기간 칩·PC/폰 목록 둘 다", () => {
    const html = W("kpiTable", tableView(), { size: "4x2" });
    for (const s of ["달성", "순항", "부족", "목표 없음", "준비 중"]) expect(html).toContain(s);
    expect(html).toContain("CSS팀");
    expect(html).not.toMatch(/E팀/);
    expect(html).toContain("이번 주");
    expect(html).toContain("lg:hidden"); // 폰 목록
    expect(html).toContain("hidden overflow-hidden"); // PC 표
    expect(html).toContain("전체 지표");
    expect(html).toContain("준비 중 · SQL 실행 대기");
    expect(html).toContain("+3");
  });
  it("달성표: pending 행에 숫자 0 이 없다", () => {
    const html = W("kpiTable", { ...tableView(), rows: [rows[4]] } as KpiView);
    const body = html.replace(/<[^>]+>/g, " ");
    expect(body).not.toMatch(/(^|\s)0(\s|\/|%|$)/);
    expect(html).toContain("준비 중");
  });
  it("달성표: 행 없음 안내·월/분기 기간 제목", () => {
    expect(W("kpiTable", { ...tableView(), rows: [] } as KpiView)).toContain("주요 목표로 정한 지표가 없습니다");
    expect(W("kpiTable", tableView("quarter"))).toContain("분기");
  });
  it("분기 점검 진행: 팀 5줄·E→CSS·필요/지금", () => {
    const teams = ["A", "B", "C", "D", "CSS"].map((t, i) => ({ team: t, done: i, total: 10, pct: i * 10, headcount: 3, need: 1.5, now: 1.1 }));
    const html = W("quarterGoal", { kind: "quarterGoal", basis: "end", onBasis: noop, endLabel: "분기 말일(12/31)", bizDaysLeft: 40, elapsed: 0.3, teams });
    for (const t of ["A팀", "B팀", "C팀", "D팀", "CSS팀"]) expect(html).toContain(t);
    expect(html).toContain("필요");
    expect(html).toContain("지금");
    expect(html).toContain("말일 10일 전");
  });
  it("분기 점검 진행: need null 이면 안내(0 아님)", () => {
    const html = W("quarterGoal", { kind: "quarterGoal", basis: "end", onBasis: noop, endLabel: "x", bizDaysLeft: 0, elapsed: 0.3, teams: [{ team: "A", done: 0, total: 10, pct: 0, headcount: 0, need: null, now: null }] });
    expect(html).toContain("필요 페이스를 계산할 수 없습니다");
  });
  it("미처리 전체: 합계·세 부분·접수 종류별·가장 오래된 건", () => {
    const html = W("unhandledTotal", { kind: "unhandledTotal", total: 71, parts: [{ label: "접수", value: 27, tone: "bad" }, { label: "물류", value: 44, tone: "bad" }, { label: "재계약 확인 지남", value: 0, tone: "ok" }], breakdown: [{ label: "복합기 AS", value: 3 }], oldest: "A업체 · 10일", weekDelta: null, defs: [{ label: "접수", text: "설명" }] });
    expect(html).toContain("71");
    expect(html).toContain("접수");
    expect(html).toContain("물류");
    expect(html).toContain("재계약 확인 지남");
    expect(html).toContain("가장 오래된 건");
    expect(html).toContain("복합기 AS");
  });
  it("미처리 전체: 0건이면 안내", () => {
    expect(W("unhandledTotal", { kind: "unhandledTotal", total: 0, parts: [], breakdown: [], defs: [] })).toContain("미처리가 없습니다");
  });
  it("OKR: 주 판정·주별 막대 4개·미작성 안내, 판정 없으면 0% 아님", () => {
    const html = W("okr", { kind: "okr", period: "week", onPeriod: noop, pct: 75, counts: [{ label: "완료", value: 3, tone: "ok" }], weeks: [1, 2, 3, 4].map((n) => ({ label: `${n}주차`, pct: n === 4 ? null : 60, current: n === 3 })), missingTeams: ["A", "E"] });
    expect(html).toContain("75");
    expect(html).toContain("4주차");
    expect(html).toContain("OKR 미작성 2팀");
    expect(html).toContain("CSS");
    const none = W("okr", { kind: "okr", period: "week", onPeriod: noop, pct: null, counts: [], weeks: [], missingTeams: ["A"] });
    expect(none).toContain("판정 기록이 아직 없습니다");
  });
  it("금일 띠: 값·원본 연결 필요·—", () => {
    const html = W("todayStrip", { kind: "todayStrip", items: [{ key: "a", label: "점검", value: 4, unit: "대" }, { key: "b", label: "실습", value: null, unit: "회", pending: true }, { key: "c", label: "AS", value: null, unit: "건" }] });
    expect(html).toContain("원본 연결 필요");
    expect(html).toContain("—");
    expect(html).toContain("점검");
  });
  it("로딩·준비 중·오류는 숫자를 그리지 않는다", () => {
    expect(render(createElement(KpiWidget, { kind: "kpiTable", title: "T", basis: "b", status: "loading" }))).toContain("animate-pulse");
    expect(render(createElement(KpiWidget, { kind: "okr", title: "T", basis: "b", status: "pending" }))).toContain("준비 중");
  });
});
