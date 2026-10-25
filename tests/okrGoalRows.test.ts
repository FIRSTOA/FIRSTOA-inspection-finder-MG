// OKR 행(병목·목표 줄) 추가·삭제·보관(2026-10-25, docs/tasks/okr-rows-add-remove-2026-10-25.md 6절 ①~⑥)
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OKR_PILLARS, addGoalRow, archivedGoals, blankGoalsLike, bottleneckLabel, emptyReport, goalHasRecords, goalRemoveKind, isLegacyMonthId, monthScreenGoals,
  monthlyRollup, nextGoalNo, normalizeGoals, quarterRollup, remapReports, removeGoalRow, renumberGoals, restoreGoalRow, visibleGoals,
  type OkrCycle, type OkrGoal, type OkrReport,
} from "../src/okr";
import { okrWeekResult, type OkrWeekFacts } from "../src/kpi/kpiCompute";
import { askConfirm } from "../src/confirmModal";
import { ADD_GOAL_MESSAGE, ADD_QUARTER_GOAL_MESSAGE, confirmAddGoalRow, confirmRemoveGoalRow, goalEditTarget } from "../src/okrGoalConfirm";

vi.mock("../src/confirmModal", () => ({ askConfirm: vi.fn() }));
const ask = vi.mocked(askConfirm);

// Pillar 3 × 병목 3 = 9줄(no 1~9) — 실측 2026-Q4 와 같은 모양
const nine = (): OkrGoal[] => OKR_PILLARS.flatMap((p, pi) => [1, 2, 3].map((n) => ({ no: pi * 3 + n, pillar: p.full, bottleneck: `병목 ${pi + 1}-${n}`, objective: `목표 ${pi * 3 + n}`, criteria: "" })));
const cycleOf = (id: string, kind: OkrCycle["kind"], goals: OkrGoal[], month = 10): OkrCycle => ({
  id, kind, title: "", year: 2026, month, week_no: null, start_date: "2026-10-01", end_date: "2026-10-31", parent_id: null, goals, feedback: {}, direction: "", goals_origin: "leader",
});
const rep = (cycleId: string, team: string, member: string, rows: Array<[number, string, string]>): OkrReport =>
  ({ ...emptyReport(cycleId, team, member), rows: rows.map(([no, actual, judgment]) => ({ no, actual, judgment, reason: "", plan: "", evidence: "" })) });

describe("① 추가 — 새 번호 = 최대+1, 기존 번호 불변, 그 Pillar 끝", () => {
  it("Pillar 1 에 추가하면 no 10 이 3번 뒤에 들어가고 나머지 번호는 그대로", () => {
    const goals = nine();
    const { goals: next, no } = addGoalRow(goals, OKR_PILLARS[0].full);
    expect(no).toBe(10);
    expect(next.map((g) => g.no)).toEqual([1, 2, 3, 10, 4, 5, 6, 7, 8, 9]);
    expect(next.filter((g) => g.no !== 10)).toEqual(goals); // 기존 행은 글·번호 그대로
    expect(next.find((g) => g.no === 10)).toMatchObject({ pillar: OKR_PILLARS[0].full, bottleneck: "", objective: "", criteria: "" });
    expect(bottleneckLabel(next, 10)).toBe("병목현상 4"); // 화면 이름은 같은 Pillar 안 순서
  });
  it("번호가 띄엄띄엄이어도 최대+1, 맞물리는 사이클 번호(10월 no 10)와 겹치지 않게", () => {
    const gappy = nine().filter((g) => g.no !== 5);
    expect(nextGoalNo(gappy)).toBe(10);
    expect(addGoalRow(nine(), OKR_PILLARS[1].full, [1, 2, 10]).no).toBe(11);
    expect(nextGoalNo([])).toBe(1);
  });
});

describe("② 삭제 — 빈 행 즉시 · 글만 확인 · 기록 있으면 보관(hidden)", () => {
  it("종류 판정", () => {
    const empty: OkrGoal = { no: 10, pillar: OKR_PILLARS[0].full, bottleneck: "병목현상 4", objective: "", criteria: "" }; // 옛 꼬리표뿐 = 빈 글
    expect(goalRemoveKind(empty, false)).toBe("empty");
    expect(goalRemoveKind({ ...empty, objective: "목표" }, false)).toBe("text");
    expect(goalRemoveKind(empty, true)).toBe("archive");
  });
  it("기록(주차 팀원 판정)이 있는 행은 hidden 으로 남고 보고서 rows 는 그대로", () => {
    const goals = nine();
    const reports = [rep("2026-10-W2", "A", "김", [[2, "", "미흡"]]), rep("2026-10", "B", "", [[5, "3건 중 3건", ""]])];
    const before = JSON.stringify(reports);
    expect(goalHasRecords(2, reports)).toBe(true);
    expect(goalHasRecords(5, reports)).toBe(true); // 실제결과만 있어도 기록
    expect(goalHasRecords(3, reports)).toBe(false);
    expect(goalHasRecords(3, [], [{ "3": { memo: "", judgment: "완료" } }])).toBe(true); // CS·분기 종합 사람 판정
    expect(goalHasRecords(3, [], [{ "3": { memo: "메모만" } }])).toBe(false);
    const out = removeGoalRow(goals, 2, true);
    expect(out.kind).toBe("archive");
    expect(out.goals).toHaveLength(9);
    expect(out.goals.find((g) => g.no === 2)?.hidden).toBe(true);
    expect(visibleGoals(out.goals).map((g) => g.no)).toEqual([1, 3, 4, 5, 6, 7, 8, 9]);
    expect(archivedGoals(out.goals).map((g) => g.no)).toEqual([2]);
    expect(JSON.stringify(reports)).toBe(before);
    // 되살리기 = 같은 자리·같은 번호, hidden 키 없음
    const back = restoreGoalRow(out.goals, 2);
    expect(back).toEqual(goals);
    expect("hidden" in back[1]).toBe(false);
  });
  it("기록 없는 행은 배열에서 빠지고 다른 번호는 그대로(재번호 없음)", () => {
    const out = removeGoalRow(nine(), 4, false);
    expect(out.kind).toBe("text");
    expect(out.goals.map((g) => g.no)).toEqual([1, 2, 3, 5, 6, 7, 8, 9]);
  });
});

describe("③ 분기 표 — 보관 행 제외, 나머지는 같은 번호로 달 판정과 맞물림", () => {
  it("quarterRollup·monthlyRollup 은 hidden 을 빼고, no 6 행에는 10월 no 6 판정이 그대로 붙는다", () => {
    const qGoals = removeGoalRow(nine(), 5, true).goals;
    const quarter = cycleOf("2026-Q4", "quarter", qGoals);
    const oct = cycleOf("2026-10", "month", nine());
    const reports = { "2026-10": [rep("2026-10", "A", "", [[5, "", "미흡"], [6, "", "완료"]])] };
    const r = quarterRollup(quarter, [oct], reports, {});
    expect(r.rows.map((x) => x.no)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
    expect(r.rows.find((x) => x.no === 6)?.byTeam.A.byMonth["2026-10"].judgment).toBe("완료");
    const octHidden = cycleOf("2026-10", "month", removeGoalRow(nine(), 5, true).goals);
    expect(monthlyRollup(octHidden, reports["2026-10"]).map((x) => x.no)).not.toContain(5);
  });
  it("분기에 보관 행이 있으면 11월 복사본(빈 틀)에서도 숨김, 새 행은 자동으로 보인다", () => {
    const added = addGoalRow(removeGoalRow(nine(), 5, true).goals, OKR_PILLARS[2].full).goals;
    const quarter = cycleOf("2026-Q4", "quarter", added);
    const nov: OkrCycle = { ...cycleOf("2026-11", "month", blankGoalsLike(nine()), 11), goals_origin: "copy" };
    const shown = visibleGoals(monthScreenGoals(nov, quarter).goals).map((g) => g.no);
    expect(shown).not.toContain(5);
    expect(shown).toContain(10);
  });
});

describe("④ 홈 집계 불변 — okrWeekResult 는 보관 행 판정도 그대로 센다", () => {
  it("판정 있는 행을 보관해도 지난 주차 % 와 판정 수가 같다, 빈 새 행은 영향 0", () => {
    const reports = [
      rep("2026-10-W2", "A", "", [[1, "", "완료"], [2, "", "미흡"]]),
      rep("2026-10-W2", "B", "김", [[2, "", "미착수"], [3, "", "완료"]]),
    ];
    const facts = (goals: OkrGoal[]): OkrWeekFacts => ({ id: "2026-10-W2", weeks: [], goals, reports });
    const before = okrWeekResult(facts(nine()));
    const archived = removeGoalRow(nine(), 2, true).goals;
    const withNew = addGoalRow(archived, OKR_PILLARS[0].full).goals;
    const after = okrWeekResult(facts(withNew));
    expect(after.pct).toBe(before.pct);
    expect(after.counts).toEqual(before.counts);
    expect(after.byTeam).toEqual(before.byTeam);
    expect(before.pct).not.toBeNull();
  });
});

describe("⑤ 저장 왕복 — normalizeGoals 가 hidden 을 지키고 모르는 값은 버린다", () => {
  it("hidden:true 만 남기고, false·문자열은 키 없음", () => {
    const raw = JSON.parse(JSON.stringify(removeGoalRow(nine(), 7, true).goals)) as unknown[];
    const back = normalizeGoals(raw);
    expect(back.find((g) => g.no === 7)?.hidden).toBe(true);
    expect(back.filter((g) => g.hidden)).toHaveLength(1);
    expect(normalizeGoals([{ no: 1, hidden: "true" }, { no: 2, hidden: false }]).some((g) => "hidden" in g)).toBe(false);
  });
});

describe("⑥ 옛 구조(2026-09 이하) 경로 무변경", () => {
  it("9월은 legacy, 10월은 아님 — 옛 화면이 쓰는 재번호·기록 옮기기는 예전 그대로", () => {
    expect(isLegacyMonthId("2026-09")).toBe(true);
    expect(isLegacyMonthId("2026-10")).toBe(false);
    const goals = renumberGoals(nine().filter((g) => g.no !== 2));
    expect(goals.map((g) => g.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const moved = remapReports([rep("2026-09", "A", "", [[3, "", "완료"]])], new Map([[1, 1], [3, 2]]))[0];
    expect(moved.rows.map((r) => r.no)).toEqual([2]);
  });
});

// 2026-10-25 사용자 "생성·삭제할 때 확인 문구" — 확인창이 먼저, 취소하면 아무 변화 없음
describe("⑦ 확인창 — 추가·삭제 모두 askConfirm 뒤에만 바뀐다", () => {
  beforeEach(() => { ask.mockReset(); });
  it("추가: 확인창을 먼저 띄우고, 취소하면 null(행 그대로) · 확인하면 그 Pillar 끝에 새 행", async () => {
    const goals = nine();
    const before = JSON.stringify(goals);
    ask.mockResolvedValueOnce(false);
    expect(await confirmAddGoalRow(goals, OKR_PILLARS[0].full)).toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toBe(ADD_GOAL_MESSAGE);
    expect(ask.mock.calls[0][0]).toContain("모든 파트(A~D)");
    expect(JSON.stringify(goals)).toBe(before); // 원본 불변
    ask.mockResolvedValueOnce(true);
    const added = await confirmAddGoalRow(goals, OKR_PILLARS[0].full);
    expect(added?.no).toBe(10);
    expect(added?.goals.map((g) => g.no)).toEqual([1, 2, 3, 10, 4, 5, 6, 7, 8, 9]);
  });
  it("삭제: 빈 행도 확인(\"비어 있습니다\"), 글만 있으면 \"되돌릴 수 없습니다\", 기록 있으면 보관 — 취소하면 null", async () => {
    const goals = [...nine(), { no: 10, pillar: OKR_PILLARS[0].full, bottleneck: "", objective: "", criteria: "" }];
    const before = JSON.stringify(goals);
    ask.mockResolvedValue(false);
    expect(await confirmRemoveGoalRow(goals, 10, false, "빈 행")).toBeNull();
    expect(ask.mock.calls[0][0]).toContain("비어 있습니다");
    expect(await confirmRemoveGoalRow(goals, 1, false, "글 행")).toBeNull();
    expect(ask.mock.calls[1][0]).toContain("글이 있습니다. 삭제하면 되돌릴 수 없습니다");
    expect(await confirmRemoveGoalRow(goals, 1, true, "기록 행")).toBeNull();
    expect(ask.mock.calls[2][0]).toContain("보관");
    expect(JSON.stringify(goals)).toBe(before); // 세 번 모두 취소 → 아무 변화 없음
    ask.mockResolvedValue(true);
    expect((await confirmRemoveGoalRow(goals, 10, false, "빈 행"))?.goals.some((g) => g.no === 10)).toBe(false);
    const archived = await confirmRemoveGoalRow(goals, 1, true, "기록 행");
    expect(archived?.kind).toBe("archive");
    expect(archived?.goals.find((g) => g.no === 1)?.hidden).toBe(true);
    expect(await confirmRemoveGoalRow(goals, 99, false, "없는 행")).toBeNull(); // 없는 번호는 묻지도 않음
    expect(ask).toHaveBeenCalledTimes(5);
  });
});

// 2026-10-25 팀장: 파트 탭에서 공통 칸이 비어 있으면 공통 행에, 있으면 그 층에
describe("⑧ 파트 탭 병목현상·목표 저장 위치", () => {
  const blank: OkrGoal = { no: 10, pillar: OKR_PILLARS[0].full, bottleneck: "", objective: "", criteria: "" };
  it("공통 칸이 비면 common(이어 치는 글도 sticky 로 common), 글이 있거나 층이 덮어쓴 칸이면 layer", () => {
    expect(goalEditTarget(blank, "bottleneck", [undefined, undefined], false)).toBe("common");
    expect(goalEditTarget(blank, "objective", [[]], false)).toBe("common");
    expect(goalEditTarget({ ...blank, bottleneck: "첫 글자" }, "bottleneck", [], true)).toBe("common"); // 이미 공통으로 쓰기 시작한 칸
    expect(goalEditTarget(nine()[0], "bottleneck", [], false)).toBe("layer");
    expect(goalEditTarget(nine()[0], "objective", [], false)).toBe("layer");
    const layer: OkrGoal[] = [{ ...blank, html: { bottleneckSet: "1" } }];
    expect(goalEditTarget(blank, "bottleneck", [layer], false)).toBe("layer"); // 그 층이 이미 덮어쓴 칸
    expect(goalEditTarget(blank, "objective", [layer], false)).toBe("common"); // 다른 칸은 상관없음
    expect(goalEditTarget(undefined, "objective", [], false)).toBe("layer");
  });
  it("분기 표 추가 문구는 따로", async () => {
    ask.mockReset(); ask.mockResolvedValueOnce(false);
    expect(await confirmAddGoalRow(nine(), OKR_PILLARS[0].full, [], true)).toBeNull();
    expect(ask.mock.calls[0][0]).toBe(ADD_QUARTER_GOAL_MESSAGE);
  });
});
