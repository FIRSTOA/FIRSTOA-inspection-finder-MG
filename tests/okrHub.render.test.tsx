// OKR 분기 → 월 → 주 화면(2026-10-20) — 분기 탭·[10월] 통합집계·파트 탭(파트 종합)이 서버 렌더로 깨지지 않고 나오는지,
// 그리고 옛 화면(fresh 없음)의 열 머리가 그대로인지 확인하는 최소 회귀 테스트. 데이터는 props 로 넣고 fetch 는 막아 둔다.
// 3차(2026-10-21): 범례 없음 · QuarterTeamView 없음(파트 탭엔 분기 화면 없음) · 주차 열 머리 "이번 주 목표" 없음 · 청록 쪼개기색 없음 · 주차 합치기/불러오기 단추 없음.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { blankGoalsLike, emptyReport, monthDraftFromQuarter, quarterRollup, weeksOfMonth, type OkrCycle, type OkrGoal, type OkrReport } from "../src/okr";
import * as QuarterViewModule from "../src/OkrQuarterView";
import OkrMonthRollup, { MonthTeamSummary } from "../src/OkrMonthRollup";
import { TeamView } from "../src/OkrHub";
import { OkrCrumbBar, OkrTopBand, OkrWeekStrip } from "../src/OkrHeader";
import { okrCrumbs, weekRangeShort } from "../src/okrUi";
const OkrQuarterView = QuarterViewModule.default;

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
  parent_id: "2026-Q4", goals: OCT.goals, feedback: { "1": { memo: "11월에는 담당자 기준표를 먼저 돌린다" } }, direction: "10월은 4분기 목표의 담당자·대상·측정 기준을 정하고 실행을 시작한다.\n주간: 주간에는 실행하고\n월말: 월말에는 숫자와 미달 원인을 확인한다.\n분기: 분기 말 교훈으로 정리한다.", goals_origin: "", goals_prev: null, // OkrDirection 새 저장 형식(머리글 / 주간: / 월말: / 분기:)
};
const partA: OkrReport = { ...emptyReport("2026-10", "A", ""), rows: [{ no: 1, actual: "9건 중 6건 (67%, 미흡)", judgment: "미흡", reason: "", plan: "", evidence: "" }] };
const weekRows: OkrReport[] = [
  { ...emptyReport("2026-10-W2", "A", "김정민"), rows: [{ no: 1, actual: "담당표 초안", judgment: "미착수", reason: "", plan: "", evidence: "" }] },
];

beforeAll(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 }))); });
afterAll(() => { vi.unstubAllGlobals(); });

describe("OKR 분기 → 월 → 주 화면 렌더", () => {
  it("[4분기] 탭: 표 하나(병목현상·목표·달성기준 + 10·11·12월 CS 종합 + 4분기 종합), 옛 '분기 진행' 표 없음", () => {
    const rollup = quarterRollup(quarter, [october], { "2026-10": [partA] }, { "2026-10": weekRows });
    const partAled: OkrReport = { ...partA, header: { ...partA.header, leader: "박파트" } };
    const html = render(createElement(OkrQuarterView, { quarter: { ...quarter, direction: "4분기는 기준을 세운다.\n주간: 실행\n월말: 확인\n분기: 정리" }, rollup, prevQuarter: null, onGoal: noop, onPaste: noop, onRestore: noop, onCopyPrev: noop, onTemplate: noop, onQuarterJudgment: noop, onPickMonth: noop,
      onDirection: noop, monthReports: { "2026-10": [partAled] }, onPickTeam: noop }));
    // 4차 머리 구색: 분기 핵심방향 띠 + A~D 파트 카드(파트장·판정 n/9)
    expect(html).toContain("4분기 핵심방향");
    for (const step of ["주간 실행", "월말 확인", "분기 정리"]) expect(html).toContain(step);
    expect(html).toContain("파트장 박파트");
    expect(html).toContain("파트장 미기재");
    expect(html).toContain(`판정 1/${quarter.goals.length * 3}`); // 분기 카드 = 3달 합계(전체 = 목표 × 3)
    expect(html).toContain("미흡·미착수 1");
    expect(html).not.toContain("OKR 붙여넣기"); // 6차: 붙여넣기 단추 없음
    expect(html).toContain("달성기준(실행)");
    expect(html).toContain("병목현상");
    // 목표 글은 RichCell 칸(effect에서 그림)이라 서버 렌더에 안 나온다 — 열 머리·칸 색으로 확인
    expect(html).toContain("bg-indigo-50");
    expect(html).not.toContain("분기 진행");
    for (const m of ["10월", "11월", "12월"]) expect(html).toContain(m);
    expect(html).toContain("4분기 종합");
    expect(html).toMatch(/10월(<\/button>)?<span[^>]*>조치 1/); // 조치 수는 달 머리에 남는다
    expect(html).toContain("미흡");
    // 3차: 범례 없음, 달성기준(실행)은 노랑 입력칸(색은 병목현상·목표만)
    expect(html).not.toContain("결과 입력");
    expect(html).not.toContain("확정 판정");
    expect(html).toContain("bg-[#FFFBEB]");
    expect(html).not.toContain("bg-teal-50");
    // 월 통합집계와 같은 꼴의 끝 두 열 — 10월 CS 종합이 미흡이라 "10월"이 조치·확인 필요 달에
    expect(html).toContain("조치·확인 필요 달");
    expect(html).toContain("4분기 결과 및 다음 분기 개선계획");
    expect(html).not.toContain("팀장 문서"); // 4차: 배지 삭제
    expect(html).not.toMatch(/>병목 1</); // 4차: No 열 삭제
    expect(html).toMatch(/text-rose-600">10월</);
  });

  it("3차: 파트 탭용 분기 화면(QuarterTeamView)은 없다", () => {
    expect("QuarterTeamView" in QuarterViewModule).toBe(false);
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
    expect(html).not.toContain("팀장 문서"); // 3차: 범례 없음
    expect(html).not.toContain("확정 판정");
    expect(html).toContain("10월 결과 및 11월 개선계획");
    expect(html).not.toContain("OKR 붙여넣기"); // 6차: 붙여넣기·가져오기 단추 없음
    expect(html).toContain("A파트");
    expect(html).toContain("김정민"); // 그 달 주차 기록에서 미착수인 사람
    expect(html).not.toContain("OKR 대기");
    // 5차: 월 OKR이 아직 없으면(copy) 분기 글 대신 빈 틀(OkrHub 가 monthScreenGoals 로 넘김) + 한 줄 안내
    const nov = { ...monthDraftFromQuarter(2026, 11, quarter), goals: october.goals, goals_origin: "copy" as const };
    const blank = blankGoalsLike(quarter.goals);
    const waiting = render(createElement(OkrMonthRollup, {
      cycle: nov, quarter, goals: blank, goalsOf: () => blank, fromQuarter: true, quarterLabel: "4분기", reports: [], weekRows: [], otherMonths: [],
      onDirection: noop, onFeedback: noop, onPaste: noop, onStartFromQuarter: noop, onCopyGoals: noop, onRestore: noop, onTemplate: noop, ops: { onGoal: noop, onPillar: noop, onInsert: noop, onRemove: noop },
      onCsJudgment: noop, onPickTeam: noop,
    }));
    expect(waiting).toContain("11월 OKR이 아직 없습니다"); // 6차: 붙여넣기·분기로 시작 단추 안내 없음
    expect(waiting).not.toContain("분기 OKR로 시작");
    expect(waiting).not.toContain("OKR을 보여줍니다");
    expect(waiting).not.toContain(bottleneckSnippet(quarter.goals[0])); // 분기 글이 보이지 않는다
    expect(waiting).not.toContain("팀장 11월 OKR 대기");
    expect(html).not.toMatch(/>병목 1</); // 4차: No 열 삭제
    expect(html).toMatch(/<th[^>]*>병목현상<span/);
    expect(waiting).toContain("11월 결과 및 12월 개선계획");
    expect(waiting).toContain("focus-within:ring-indigo-400"); // 병목현상·목표 = 팀장 문서색 편집 칸(2차: 읽기 전용 아님 — 글은 RichCell이라 서버 렌더에 안 나옴)
  });

  it("[10월] 파트 탭: 파트 종합(병목현상·목표 남보라 편집·달성기준 노랑·개선계획(11월 전략)), 주차 합치기 없음, 옛 화면은 '병목' 열 그대로", () => {
    const weeks = weeksOfMonth(2026, 10);
    const base = {
      team: "A" as const, cycle: october, goals: october.goals, reports: [partA], member: "", onMember: noop, onRemoveMember: noop, roster: ["김정민"], author: "김정민", aiBusy: "",
      onHeader: noop, onResult: noop, onMerge: noop, onAiMerge: noop, onAiFormat: noop, onTeamFeedback: noop, onAiTeamFeedback: noop, onCriteria: noop, onLoadPrev: noop, onLoadPrevResults: noop, prevLabel: "9월",
    };
    const fresh = {
      level: "month" as const, nextMonth: 11, summary: null, onObjective: noop, onBottleneck: noop,
      weekChips: createElement("div", null, weeks.map((w) => createElement("button", { key: w.id, type: "button" }, w.label))),
    };
    const html = render(createElement(TeamView, { ...base, fresh }));
    expect(html).toContain("병목현상");
    expect(html).toContain("개선계획(11월 전략)");
    expect(html).not.toContain("주차 합치기"); // 3차: AI 느낌 단추 삭제
    expect(html).not.toContain("팀장 문서"); // 범례 없음
    expect(html).not.toContain("불러오기"); // 월 제출 화면엔 전주 불러오기 없음
    expect(html).toContain("focus-within:ring-indigo-400"); // 병목현상·목표 = 남보라 편집 칸(RichCell 글은 서버 렌더에 안 나옴)
    expect(html).not.toContain("bg-teal-50"); // 쪼개기 색 없음
    expect(html).not.toContain("파트 제출"); // 4차: 새 구조 안내 줄 없음
    expect(html.indexOf("팀원 집계")).toBeLessThan(html.indexOf("파트 종합")); // 4차: [팀원 집계]가 [파트 종합] 앞
    expect(html).not.toMatch(/>병목 1</); // 4차: 칸 안 "병목 n" 라벨 없음
    // 판정 제안 = 마지막 기록 주차(suggestOf). 파트 종합 판정이 미흡이어도 마지막 주차가 완료면 '→ 완료'
    const suggesting = render(createElement(TeamView, { ...base, fresh: { ...fresh, suggestOf: (no: number) => (no === 1 ? "완료" as const : "" as const) } }));
    expect(suggesting).toContain("→ 완료");

    // 주차(파트원) 화면: 열 머리 = 파트 종합과 같게, 병목현상·목표 남보라 편집, 불러오기 단추 없음
    const week = render(createElement(TeamView, { ...base, member: "김정민", reports: weekRows, fresh: { ...fresh, level: "week" as const } }));
    expect(week).not.toContain("이번 주 목표");
    expect(week).not.toContain("이번 주 달성기준");
    expect(week).toMatch(/>목표<span/);
    expect(week).toMatch(/>달성기준<span/);
    expect(week).toMatch(/>개선계획<span/); // "(n월 전략)"은 파트 종합에서만
    expect(week).toContain(weeks[0].label); // 파트원을 고르면 주차 칩
    // 6차: 새 구조는 사람 박스 대신 알약(rounded-full), 주차 칩은 짙은 띠가 아닌 연한 줄
    expect(html).toContain("rounded-full px-3 py-1 text-[12px] font-black transition bg-slate-100");
    expect(html).not.toContain("w-[128px]");
    const strip = render(createElement(OkrWeekStrip, { onPick: noop, weeks: weeks.map((w) => ({ ...w, on: w.weekNo === 3, now: w.weekNo === 3, filled: w.weekNo === 1 })) }));
    expect(strip).not.toContain("bg-[#1E252F]"); // 짙은 띠 아님
    expect(strip).toContain("bg-slate-50");
    expect(strip).toContain(weeks[2].label);
    expect(strip).toContain("이번주");
    expect(strip).toContain("bg-emerald-500"); // 기록 점
    expect(week).toContain("focus-within:ring-indigo-400");
    expect(week).not.toContain("bg-teal-50");
    expect(week).not.toContain("불러오기");
    expect(week).not.toContain("(목표는 통합집계에서만)");
    expect(week).not.toContain("파트 것이 기본으로"); // 4차: 안내 줄 없음
    expect(week).not.toContain("월: ");

    const legacy = render(createElement(TeamView, base));
    expect(legacy).toContain("w-[128px]"); // 6차: 옛 화면은 PersonBox 그대로
    expect(legacy).toContain("rounded-xl border border-slate-200 bg-white shadow-sm");
    expect(legacy).toMatch(/>병목<span/);
    expect(legacy).not.toContain("병목현상");
    expect(legacy).not.toContain("주차 합치기");
    expect(legacy).toContain("9월 달성기준 불러오기");
    expect(legacy).toContain("bg-sky-50"); // 옛 TD_FIXED 그대로
    expect(legacy).not.toContain("bg-indigo-50");
    expect(legacy).not.toContain("목표·달성기준 불러오기");
  });

  it("[10월] 파트 탭 [팀원 집계]: 병목현상 글 + 파트 종합 제안(마지막 기록 주차), '병목 n' 번호 열·범례 없음", () => {
    const weeks = weeksOfMonth(2026, 10);
    const html = render(createElement(MonthTeamSummary, {
      team: "A" as const, goals: october.goals, names: ["김정민"], weeks, weekRows, partReport: emptyReport("2026-10", "A", ""), onPick: noop, onFeedback: noop,
    }));
    expect(html).toContain("병목현상");
    expect(html).toContain(bottleneckSnippet(october.goals[0]));
    expect(html).toMatch(/>미착수<\/div>/); // 4차: "제안" 글자 없이 값만(○ 점으로 제안)
    expect(html).not.toContain("제안 미착수");
    expect(html).not.toMatch(/>병목 1</); // 3차: 첫 번호 열 삭제
    expect(html).not.toContain("확정 판정");
    expect(html).toMatch(/<th[^>]*>병목현상<span/); // 첫 머리가 병목현상
  });
});

describe("OKR 6차 머리(짙은 띠 = 기간만, 흰 카드 경로 줄)", () => {
  it("짙은 띠: 제목 'CS팀 OKR'·월 칩만, 큰 제목·기간 알약·동기화 없음", () => {
    const chips = [{ id: "2026-Q4", label: "4분기", on: false, now: false, onClick: noop }, ...[10, 11, 12].map((m) => ({ id: `2026-${m}`, label: `${m}월`, on: m === 10, now: m === 10, onClick: noop }))];
    const html = render(createElement(OkrTopBand, { years: [2026, 2025], year: 2026, quarter: 4, chips, onYear: noop, onQuarter: noop }));
    expect(html).toContain("CS팀 OKR");
    for (const m of ["4분기", "10월", "11월", "12월"]) expect(html).toContain(`>${m}</button>`);
    expect(html).not.toContain("실행결과");
    expect(html).not.toContain("2026-10-19 ~ 2026-10-23");
    expect(html).not.toContain("동기화");
  });
  it("경로 줄: 마지막 조각 굵게 + 오른쪽 동기화 시각 · 저장 실패", () => {
    const crumbs = okrCrumbs({ quarterView: false, quarter: 4, tab: "C", member: "이민구", month: 10, week: { weekNo: 3, start: "2026-10-19", end: "2026-10-23" } });
    const html = render(createElement(OkrCrumbBar, { crumbs, saveStatus: "saved", syncedAt: "01:15" }));
    expect(html).toContain("C파트");
    expect(html).toContain("이민구");
    expect(html).toContain("10월 3주차 (10/19~23)");
    expect(html).toContain("동기화 01:15");
    expect(html).toContain("truncate");
    expect(render(createElement(OkrCrumbBar, { crumbs, saveStatus: "error", syncedAt: "01:15" }))).toContain("저장 실패");
  });
  it("okrCrumbs: 통합집계·분기·파트 종합·팀원 집계·파트원 주차", () => {
    const base = { quarterView: false, quarter: 4, month: 10 };
    expect(okrCrumbs({ ...base, tab: "all", member: "" })).toEqual(["통합집계", "10월"]);
    expect(okrCrumbs({ ...base, quarterView: true, tab: "all", member: "" })).toEqual(["통합집계", "4분기"]);
    expect(okrCrumbs({ ...base, tab: "C", member: "" })).toEqual(["C파트", "파트 종합", "10월"]);
    expect(okrCrumbs({ ...base, tab: "C", member: "__sum__" })).toEqual(["C파트", "팀원 집계", "10월"]);
    expect(okrCrumbs({ ...base, tab: "C", member: "이민구", week: { weekNo: 3, start: "2026-10-19", end: "2026-10-23" } })).toEqual(["C파트", "이민구", "10월 3주차 (10/19~23)"]);
    expect(okrCrumbs({ ...base, tab: "C", member: "이민구", week: null })).toEqual(["C파트", "이민구", "10월"]);
    expect(weekRangeShort("2026-09-28", "2026-10-02")).toBe("9/28~10/2");
  });
});

function bottleneckSnippet(g: OkrGoal) { return g.bottleneck.replace(/^\s*병목\s*현상\s*\d+\s*[.:：)]?\s*/, "").slice(0, 15); }
