// OKR 분기 → 월 → 주 화면(2026-10-20) — 분기 탭·[10월] 통합집계·파트 탭(파트 종합)이 서버 렌더로 깨지지 않고 나오는지,
// 그리고 옛 화면(fresh 없음)의 열 머리가 그대로인지 확인하는 최소 회귀 테스트. 데이터는 props 로 넣고 fetch 는 막아 둔다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { emptyReport, monthDraftFromQuarter, quarterRollup, weeksOfMonth, type OkrCycle, type OkrGoal, type OkrReport } from "../src/okr";
import OkrQuarterView, { QuarterTeamView } from "../src/OkrQuarterView";
import OkrMonthRollup, { MonthTeamSummary } from "../src/OkrMonthRollup";
import { TeamView } from "../src/OkrHub";

type Doc = { id: string; direction: string; goals: OkrGoal[] };
const load = (name: string): Doc => JSON.parse(readFileSync(resolve(__dirname, "../docs/okr", name), "utf8"));
const Q4 = load("2026-Q4-okr.json");
const OCT = load("2026-10-okr.json");
const noop = () => {};
// 서버 렌더는 글 조각 사이에 <!-- --> 를 넣는다. RichCell 칸의 글은 effect에서 그려지므로 서버 렌더에 안 나온다(표 밖 글만 확인).
const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");

const quarter: OkrCycle = {
  id: "2026-Q4", kind: "quarter", title: "CS팀 4분기 OKR", year: 2026, month: 10, week_no: null, start_date: "2026-10-01", end_date: "2026-12-31",
  parent_id: null, goals: Q4.goals, feedback: {}, direction: "", goals_origin: "", goals_prev: null,
};
const october: OkrCycle = {
  id: "2026-10", kind: "month", title: "CS팀 10월 OKR 실행결과", year: 2026, month: 10, week_no: null, start_date: "2026-10-01", end_date: "2026-10-31",
  parent_id: "2026-Q4", goals: OCT.goals, feedback: { "1": { memo: "11월에는 담당자 기준표를 먼저 돌린다" } }, direction: OCT.direction || "AI로 반복 업무를 줄인다", goals_origin: "", goals_prev: null,
};
const partA: OkrReport = { ...emptyReport("2026-10", "A", ""), rows: [{ no: 1, actual: "9건 중 6건 (67%, 미흡)", judgment: "미흡", reason: "", plan: "", evidence: "" }] };
const weekRows: OkrReport[] = [
  { ...emptyReport("2026-10-W2", "A", "김정민"), rows: [{ no: 1, actual: "담당표 초안", judgment: "미착수", reason: "", plan: "", evidence: "" }] },
];

beforeAll(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 }))); });
afterAll(() => { vi.unstubAllGlobals(); });

describe("OKR 분기 → 월 → 주 화면 렌더", () => {
  it("[4분기] 탭: 표 하나(병목현상·목표·달성기준 + 10·11·12월 CS 종합 + 4분기 종합) + 붙여넣기 단추, 옛 '분기 진행' 표 없음", () => {
    const rollup = quarterRollup(quarter, [october], { "2026-10": [partA] }, { "2026-10": weekRows });
    const html = render(createElement(OkrQuarterView, { quarter, rollup, prevQuarter: null, onGoal: noop, onPaste: noop, onRestore: noop, onCopyPrev: noop, onTemplate: noop, onQuarterJudgment: noop, onPickMonth: noop }));
    expect(html).toContain("팀장 분기 OKR 붙여넣기");
    expect(html).toContain("달성기준(실행)");
    expect(html).toContain("병목현상");
    // 목표 글은 RichCell 칸(effect에서 그림)이라 서버 렌더에 안 나온다 — 열 머리·칸 색으로 확인
    expect(html).toContain("bg-indigo-50");
    expect(html).not.toContain("분기 진행");
    for (const m of ["10월", "11월", "12월"]) expect(html).toContain(m);
    expect(html).toContain("4분기 종합");
    expect(html).toMatch(/10월(<\/button>)?<span[^>]*>조치 1/); // 조치 수는 달 머리에 남는다
    expect(html).toContain("미흡");
  });

  it("[4분기] + 파트 탭: QuarterTeamView — A파트 · 10·11·12월 머리 · 파트 분기 종합, '월을 고르세요' 없음", () => {
    const rollup = quarterRollup(quarter, [october], { "2026-10": [partA] }, { "2026-10": weekRows });
    const html = render(createElement(QuarterTeamView, { team: "A" as const, quarter, goals: quarter.goals, rollup, onPick: noop, onPickMonthHead: noop }));
    expect(html).toContain("A파트");
    for (const m of ["10월", "11월", "12월"]) expect(html).toContain(m);
    expect(html).toContain("A파트 분기 종합");
    expect(html).not.toContain("월을 고르세요");
  });

  it("[10월] 통합집계: 핵심방향 + A~D 판정 + 조치 필요 파트·사람 + 'n월 결과 및 n+1월 개선계획'", () => {
    const html = render(createElement(OkrMonthRollup, {
      cycle: october, quarter, goals: october.goals, goalsOf: () => october.goals, fromQuarter: false, quarterLabel: "4분기", reports: [partA], weekRows, otherMonths: [],
      onDirection: noop, onFeedback: noop, onPaste: noop, onStartFromQuarter: noop, onCopyGoals: noop, onRestore: noop, onTemplate: noop, ops: { onGoal: noop, onPillar: noop, onInsert: noop, onRemove: noop },
      onCsJudgment: noop, onPickTeam: noop,
    }));
    expect(html).toContain("핵심방향");
    expect(html).toContain("CS 종합");
    for (const step of ["주간 실행", "월말 확인", "분기 정리"]) expect(html).toContain(step); // 핵심방향 단계 띠
    expect(html).toContain("팀장 문서"); // 범례
    expect(html).toContain("10월 결과 및 11월 개선계획");
    expect(html).toContain("팀장 10월 OKR 붙여넣기");
    expect(html).toContain("A파트");
    expect(html).toContain("김정민"); // 그 달 주차 기록에서 미착수인 사람
    expect(html).not.toContain("OKR 대기");
    // 월 OKR이 복사본이면 분기 OKR을 읽기 전용으로 + 대기 띠
    const nov = { ...monthDraftFromQuarter(2026, 11, quarter), goals: october.goals, goals_origin: "copy" as const };
    const waiting = render(createElement(OkrMonthRollup, {
      cycle: nov, quarter, goals: quarter.goals, goalsOf: () => quarter.goals, fromQuarter: true, quarterLabel: "4분기", reports: [], weekRows: [], otherMonths: [],
      onDirection: noop, onFeedback: noop, onPaste: noop, onStartFromQuarter: noop, onCopyGoals: noop, onRestore: noop, onTemplate: noop, ops: { onGoal: noop, onPillar: noop, onInsert: noop, onRemove: noop },
      onCsJudgment: noop, onPickTeam: noop,
    }));
    expect(waiting).toContain("팀장 11월 OKR 대기");
    expect(waiting).toContain("고치면 11월 OKR로 저장"); // 11·12월도 OkrHub가 ops를 넘겨 고칠 수 있다
    expect(waiting).toContain("11월 결과 및 12월 개선계획");
    expect(waiting).toContain("focus-within:ring-indigo-400"); // 병목현상·목표 = 팀장 문서색 편집 칸(2차: 읽기 전용 아님 — 글은 RichCell이라 서버 렌더에 안 나옴)
  });

  it("[10월] 파트 탭: 파트 종합(병목현상 글 열·개선계획(11월 전략)·주차 합치기·주차 칩), 옛 화면은 '병목' 열 그대로", () => {
    const weeks = weeksOfMonth(2026, 10);
    const base = {
      team: "A" as const, cycle: october, goals: october.goals, reports: [partA], member: "", onMember: noop, onRemoveMember: noop, roster: ["김정민"], author: "김정민", aiBusy: "",
      onHeader: noop, onResult: noop, onMerge: noop, onAiMerge: noop, onAiFormat: noop, onTeamFeedback: noop, onAiTeamFeedback: noop, onCriteria: noop, onLoadPrev: noop, onLoadPrevResults: noop, prevLabel: "9월",
    };
    const fresh = {
      level: "month" as const, nextMonth: 11, summary: null, onMergeWeeks: noop,
      weekChips: createElement("div", null, weeks.map((w) => createElement("button", { key: w.id, type: "button" }, w.label))),
    };
    const html = render(createElement(TeamView, { ...base, fresh }));
    expect(html).toContain("병목현상");
    expect(html).toContain("개선계획(11월 전략)");
    expect(html).toContain("주차 합치기");
    expect(html).toContain(weeks[0].label);
    expect(html).toContain(bottleneckSnippet(october.goals[0]));
    expect(html).not.toContain("달성기준 불러오기"); // 월 제출 화면엔 전주 불러오기 없음
    expect(html).toContain("bg-indigo-50"); // 병목현상·목표·달성기준 = 팀장 문서색(읽기)
    expect(html).not.toContain("bg-teal-50\""); // 쪼개기 칸 없음
    // 판정 제안 = 마지막 기록 주차(suggestOf). 파트 종합 판정이 미흡이어도 마지막 주차가 완료면 '→ 완료'
    const suggesting = render(createElement(TeamView, { ...base, fresh: { ...fresh, suggestOf: (no: number) => (no === 1 ? "완료" as const : "" as const) } }));
    expect(suggesting).toContain("→ 완료");

    // 주차(파트원) 화면: 목표·달성기준 = 쪼개기색 편집 칸, 불러오기 단추 이름
    const week = render(createElement(TeamView, { ...base, member: "김정민", reports: weekRows, fresh: { ...fresh, level: "week" as const, onObjective: noop, monthGoalOf: () => undefined } }));
    expect(week).toContain("이번 주 목표");
    expect(week).toContain("bg-teal-50");
    expect(week).toContain("9월 목표·달성기준 불러오기");
    expect(week).not.toContain("(목표는 통합집계에서만)");

    const legacy = render(createElement(TeamView, base));
    expect(legacy).toMatch(/>병목<span/);
    expect(legacy).not.toContain("병목현상");
    expect(legacy).not.toContain("주차 합치기");
    expect(legacy).toContain("9월 달성기준 불러오기");
    expect(legacy).toContain("bg-sky-50"); // 옛 TD_FIXED 그대로
    expect(legacy).not.toContain("bg-indigo-50");
    expect(legacy).not.toContain("목표·달성기준 불러오기");
  });

  it("[10월] 파트 탭 [팀원 집계]: 병목현상 글 + 파트 종합 제안(마지막 기록 주차)", () => {
    const weeks = weeksOfMonth(2026, 10);
    const html = render(createElement(MonthTeamSummary, {
      team: "A" as const, goals: october.goals, names: ["김정민"], weeks, weekRows, partReport: emptyReport("2026-10", "A", ""), onPick: noop, onFeedback: noop,
    }));
    expect(html).toContain("병목현상");
    expect(html).toContain(bottleneckSnippet(october.goals[0]));
    expect(html).toContain("제안 미착수");
  });
});

function bottleneckSnippet(g: OkrGoal) { return g.bottleneck.replace(/^\s*병목\s*현상\s*\d+\s*[.:：)]?\s*/, "").slice(0, 15); }
