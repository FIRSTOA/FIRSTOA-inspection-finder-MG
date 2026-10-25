// OKR 행의 주인 층(공통·파트 전용·개인 전용) — okr.ts 몫(2026-10-25 저녁, docs/tasks/okr-rows-per-layer-2026-10-25.md 3절·9절)
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OKR_PILLARS, addGoalRow, applyPastedGoals, blankGoalsLike, commonGoalsOf, editsRowDirectly, effectiveGoals, emptyReport, goalAppliesTo, goalLayer, goalsApplyingTo, goalsForTeamTotal, goalsForView,
  isLeaderGoals, layerRowsOf, mergeGoals, monthScreenGoals, monthlyRollup, nextGoalNo, normalizeGoals, ownsGoal, quarterRollup, removeGoalRow,
  replaceCommonGoals, restoreGoalRow, type OkrCycle, type OkrGoal, type OkrReport,
} from "../src/okr";
import { askConfirm } from "../src/confirmModal";
import { ADD_GOAL_MESSAGE, addGoalMessage, confirmAddGoalRow, confirmRemoveGoalRow, goalEditTarget, ownerLabelOf } from "../src/okrGoalConfirm";

vi.mock("../src/confirmModal", () => ({ askConfirm: vi.fn() }));
const ask = vi.mocked(askConfirm);

const nine = (): OkrGoal[] => OKR_PILLARS.flatMap((p, pi) => [1, 2, 3].map((n) => ({ no: pi * 3 + n, pillar: p.full, bottleneck: `병목 ${pi + 1}-${n}`, objective: `목표 ${pi * 3 + n}`, criteria: "" })));
const cycleOf = (id: string, kind: OkrCycle["kind"], goals: OkrGoal[], origin: OkrCycle["goals_origin"] = "leader"): OkrCycle => ({
  id, kind, title: "", year: 2026, month: 10, week_no: null, start_date: "2026-10-01", end_date: "2026-10-31", parent_id: null, goals, feedback: {}, direction: "", goals_origin: origin,
});
const rep = (team: string, rows: Array<[number, string]>): OkrReport =>
  ({ ...emptyReport("2026-10", team, ""), rows: rows.map(([no, judgment]) => ({ no, actual: "x", judgment, reason: "", plan: "", evidence: "" })) });
const P1 = OKR_PILLARS[0].full;
const P2 = OKR_PILLARS[1].full;

// 공통 9줄 + A 전용 101 + 홍길동(A) 전용 102 + 김철수(A) 전용 103 + B 전용 104
const layered = (): OkrGoal[] => {
  let g = nine();
  g = addGoalRow(g, P1, [], { team: "A" }).goals;
  g = addGoalRow(g, P2, [], { team: "A", member: "홍길동" }).goals;
  g = addGoalRow(g, P2, [], { team: "A", member: "김철수" }).goals;
  g = addGoalRow(g, P1, [], { team: "B" }).goals;
  return g;
};
const nos = (gs: OkrGoal[]) => gs.map((g) => g.no).sort((a, b) => a - b);

describe("번호 — 층 행은 101+, 공통 행은 1~100 띠, 분기·세 달 번호와 안 겹침", () => {
  it("파트 종합에서 추가 → scope {team:A}, no 101, Pillar 1 묶음 끝", () => {
    const { goals, no } = addGoalRow(nine(), P1, [1, 2, 10], { team: "A" });
    expect(no).toBe(101);
    const row = goals.find((g) => g.no === no)!;
    expect(row.scope).toEqual({ team: "A" });
    expect(goalLayer(row)).toBe("team");
    expect(goals.findIndex((g) => g.no === no)).toBe(3);
  });
  it("세 달 번호(층 행 포함)가 linkedNos 로 오면 그 위로", () => {
    expect(addGoalRow(nine(), P1, [1, 9, 10, 101, 105], { team: "B", member: "이영희" }).no).toBe(106);
  });
  it("공통 추가는 층 행이 있어도 1~100 띠에서 max+1", () => {
    expect(addGoalRow(layered(), P1).no).toBe(10);
    expect(nextGoalNo(layered(), [10, 11])).toBe(12);
    expect(nextGoalNo(layered(), [], true)).toBe(105);
  });
});

// 2026-10-25 밤 사용자 정정("그 사람만의 병목을 다른 사람도 보이게 — 구글시트처럼"): 예전 "다른 층엔 안 보임" 기대를
//   "어느 화면이든 모두 보임(goalsForView) + 판정 대상은 따로(goalAppliesTo — 남의 전용 행은 판정 칸 잠김)" 로 고쳐 씀.
describe("goalsForView(모두 보임)·goalAppliesTo(판정 대상)·goalsForTeamTotal — 3층", () => {
  const g = layered();
  it("어느 화면이든 공통 + 모든 파트 전용 + 모든 개인 전용", () => {
    expect(nos(goalsForView(g))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 101, 102, 103, 104]);
    expect(nos(commonGoalsOf(g))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("순서 — Pillar 묶음 안에서 공통 → 파트 전용(A→D) → 개인 전용(팀 → 이름)", () => {
    // 저장 순서를 일부러 흩뜨려도(B 전용이 A 전용보다 앞, 개인 전용이 공통 사이) 같은 결과
    const by = (no: number) => g.find((x) => x.no === no)!;
    const shuffled = [by(104), by(1), by(102), by(2), by(101), by(3), by(103), ...g.filter((x) => x.no >= 4 && x.no <= 9)];
    const p1 = goalsForView(shuffled).filter((x) => x.pillar === P1).map((x) => x.no);
    expect(p1).toEqual([1, 2, 3, 101, 104]);
    const p2 = goalsForView(shuffled).filter((x) => x.pillar === P2).map((x) => x.no);
    expect(p2).toEqual([4, 5, 6, 103, 102]); // 김철수 < 홍길동(가나다)
    // Pillar 묶음은 끊기지 않는다
    const pillars = goalsForView(shuffled).map((x) => x.pillar);
    expect(pillars.filter((p, i) => i === 0 || pillars[i - 1] !== p)).toEqual([P1, P2, OKR_PILLARS[2].full]);
  });
  it("판정 대상 — 통합집계({}) = 공통만, A파트 종합 = 공통 + A 전용, B파트 종합엔 A 전용이 대상 아님(보이되 잠김)", () => {
    expect(nos(goalsApplyingTo(g, {}))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(nos(goalsApplyingTo(g, { team: "A" }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 101]);
    expect(nos(goalsApplyingTo(g, { team: "B" }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 104]);
    expect(goalAppliesTo(g.find((x) => x.no === 101)!, { team: "B" })).toBe(false);
  });
  it("판정 대상 — 파트원 = 공통 + 그 파트 전용 + 본인 전용(같은 팀 다른 사람 전용은 잠김)", () => {
    expect(nos(goalsApplyingTo(g, { team: "A", member: "홍길동" }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 101, 102]);
    expect(nos(goalsApplyingTo(g, { team: "B", member: "홍길동" }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 104]); // 다른 파트의 동명이인 아님
    expect(goalAppliesTo(g.find((x) => x.no === 102)!, { team: "A" })).toBe(false); // 파트 종합에서도 개인 전용은 잠김
  });
  it("팀 합계 = 공통 + 그 파트 전용 + 그 파트 사람들 개인 전용 전부", () => {
    expect(nos(goalsForTeamTotal(g, "A"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 101, 102, 103]);
    expect(nos(goalsForTeamTotal(g, "C"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("주인 층 — 공통은 통합집계, A 전용은 A파트 종합, 개인 전용은 본인만", () => {
    const by = (no: number) => g.find((x) => x.no === no)!;
    expect(ownsGoal(by(1), {})).toBe(true);
    expect(ownsGoal(by(1), { team: "A" })).toBe(false);
    expect(ownsGoal(by(101), { team: "A" })).toBe(true);
    expect(ownsGoal(by(101), { team: "A", member: "홍길동" })).toBe(false);
    expect(ownsGoal(by(102), { team: "A", member: "홍길동" })).toBe(true);
    expect(ownsGoal(by(102), { team: "A", member: "김철수" })).toBe(false);
    expect(ownsGoal(by(102), { team: "A" })).toBe(false);
  });
});

// 2026-10-25 밤: 전용 행은 누구나 지우고 되살린다(확인창에 주인), 공통 행은 통합집계·분기에서만(팀장 문서 보호)
describe("삭제·보관·되살리기 — 전용 행은 누구나, 공통 행은 통합집계에서만", () => {
  it("editsRowDirectly", () => {
    const g = layered();
    const by = (no: number) => g.find((x) => x.no === no)!;
    expect(editsRowDirectly(by(1), {})).toBe(true);
    expect(editsRowDirectly(by(1), { team: "A" })).toBe(false);
    expect(editsRowDirectly(by(101), { team: "B", member: "이영희" })).toBe(true);
    expect(editsRowDirectly(by(102), { team: "A", member: "김철수" })).toBe(true);
    expect(editsRowDirectly(by(104), {})).toBe(true);
  });
  it("A파트 종합에서 공통 행은 못 지우고, 전용 행은 누구 것이든 지운다", () => {
    const g = layered();
    const blocked = removeGoalRow(g, 1, false, { team: "A" });
    expect(blocked.blocked).toBe(true);
    expect(blocked.goals).toBe(g);
    expect(removeGoalRow(g, 101, false, { team: "A" }).goals.some((x) => x.no === 101)).toBe(false);
    const archived = removeGoalRow(g, 102, true, { team: "A", member: "홍길동" }).goals;
    expect(archived.find((x) => x.no === 102)?.hidden).toBe(true);
    expect(archived.find((x) => x.no === 102)?.scope).toEqual({ team: "A", member: "홍길동" }); // 보관해도 주인 유지
    expect(restoreGoalRow(archived, 102, { team: "A", member: "김철수" }).find((x) => x.no === 102)?.hidden).toBeUndefined(); // 남이 되살려도 됨
    expect(removeGoalRow(g, 104, false, { team: "A", member: "홍길동" }).goals.some((x) => x.no === 104)).toBe(false); // 다른 파트 전용도
    const commonArchived = removeGoalRow(g, 1, true, {}).goals;
    expect(restoreGoalRow(commonArchived, 1, { team: "A" }).find((x) => x.no === 1)?.hidden).toBe(true); // 공통 보관은 파트 탭에서 못 되살림
  });
});

describe("normalizeGoals — scope 왕복, hidden 유지, 이상한 scope 는 공통", () => {
  it("저장 → 읽기", () => {
    const g = removeGoalRow(layered(), 103, true).goals;
    const back = normalizeGoals(JSON.parse(JSON.stringify(g)) as unknown[]);
    expect(back).toEqual(g);
    expect(back.find((x) => x.no === 103)).toMatchObject({ hidden: true, scope: { team: "A", member: "김철수" } });
  });
  it("팀이 A~D 가 아니면 버리고, member 빈 글은 파트 전용", () => {
    const back = normalizeGoals([{ no: 101, pillar: P1, scope: { team: "E" } }, { no: 102, pillar: P1, scope: { team: "C", member: "  " } }, { no: 103, pillar: P1, scope: "A" }]);
    expect(back[0].scope).toBeUndefined();
    expect(back[1].scope).toEqual({ team: "C" });
    expect(back[2].scope).toBeUndefined();
  });
});

describe("통째 교체 — 층 행과 번호를 지킨다", () => {
  it("replaceCommonGoals: 3×3 빈 틀·다른 달 가져오기에도 층 행 그대로, 섞여 온 남의 층 행은 버림", () => {
    const g = layered();
    const blank = replaceCommonGoals(g, blankGoalsLike([]));
    expect(layerRowsOf(blank)).toEqual(layerRowsOf(g));
    expect(commonGoalsOf(blank).every((x) => !x.objective)).toBe(true);
    const otherMonth = [...nine(), { no: 120, pillar: P1, bottleneck: "9월 A 전용", objective: "", criteria: "", scope: { team: "A" as const } }];
    const copied = replaceCommonGoals(g, otherMonth);
    expect(copied.some((x) => x.no === 120)).toBe(false);
    expect(nos(copied)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 101, 102, 103, 104]);
    expect(copied.findIndex((x) => x.no === 101)).toBeLessThan(copied.findIndex((x) => x.no === 4)); // Pillar 1 묶음 안에 다시
  });
  it("공통 행 번호가 층 행과 겹치면 공통 쪽을 새 번호로", () => {
    const g = layered();
    const out = replaceCommonGoals(g, [{ no: 101, pillar: P1, bottleneck: "겹침", objective: "", criteria: "" }]);
    expect(out.find((x) => x.no === 101)?.scope).toEqual({ team: "A" });
    expect(out.find((x) => x.bottleneck === "겹침")?.no).toBe(1);
  });
  it("applyPastedGoals·blankGoalsLike 는 층 행을 건드리지 않는다", () => {
    const g = layered();
    const pasted = applyPastedGoals(g, nine().map((x) => ({ ...x, objective: `새 ${x.no}` })));
    expect(layerRowsOf(pasted)).toEqual(layerRowsOf(g));
    expect(blankGoalsLike(g).some((x) => x.scope || x.no > 100)).toBe(false);
  });
});

describe("팀장 월 OKR 판정·화면 바탕은 공통 행만 본다", () => {
  const onlyLayerText = (): OkrGoal[] => [...nine().map((x) => ({ ...x, bottleneck: "", objective: "" })), { no: 101, pillar: P1, bottleneck: "A 글", objective: "A 목표", criteria: "", scope: { team: "A" } }];
  it("isLeaderGoals 는 층 행 글만 있으면 false", () => {
    expect(isLeaderGoals(cycleOf("2026-11", "month", onlyLayerText(), "manual"))).toBe(false);
  });
  it("분기 글을 대신 보여도(effectiveGoals)·빈 틀이어도(monthScreenGoals) 그 달 층 행은 남는다", () => {
    const q = cycleOf("2026-Q4", "quarter", nine());
    const nov = cycleOf("2026-11", "month", onlyLayerText(), "copy");
    expect(effectiveGoals(nov, q).map((x) => x.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 101]);
    expect(effectiveGoals(nov, q)[0].objective).toBe("목표 1");
    const screen = monthScreenGoals(nov, q);
    expect(screen.pending).toBe(true);
    expect(nos(screen.goals)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 101]);
  });
});

describe("롤업 — 통합집계·분기 표는 공통 행만(층 행 추가 전후 같음)", () => {
  it("monthlyRollup·quarterRollup", () => {
    const reports = [rep("A", [[1, "완료"], [101, "미흡"]])];
    const before = cycleOf("2026-10", "month", nine());
    const after = cycleOf("2026-10", "month", layered());
    expect(monthlyRollup(after, reports)).toEqual(monthlyRollup(before, reports));
    const qr = (m: OkrCycle) => quarterRollup(null, [m], { [m.id]: reports }, {});
    expect(qr(after).rows.map((r) => r.no)).toEqual(qr(before).rows.map((r) => r.no));
    expect(qr(after).rows.some((r) => r.no > 100)).toBe(false);
  });
});

describe("mergeGoals — 동시 추가 합집합 + 번호 재발급(R1)", () => {
  it("A·B 파트장이 같은 순간 101 을 만들면 서버 것은 101, 내 것은 102", () => {
    const base = nine();
    const server = addGoalRow(base, P1, [], { team: "A" }).goals;
    const local = addGoalRow(base, P1, [], { team: "B" }).goals;
    const out = mergeGoals(base, local, server);
    expect(out.find((x) => x.no === 101)?.scope).toEqual({ team: "A" });
    expect(out.find((x) => x.no === 102)?.scope).toEqual({ team: "B" });
    expect(out.length).toBe(11);
  });
  it("서로 다른 번호로 추가한 행·남이 고친 칸이 모두 남는다", () => {
    const base = layered();
    const server = addGoalRow(base, P2, [], { team: "C" }).goals.map((x) => (x.no === 2 ? { ...x, objective: "남이" } : x));
    const local = base.map((x) => (x.no === 101 ? { ...x, objective: "내가" } : x));
    const out = mergeGoals(base, local, server);
    expect(out.find((x) => x.no === 2)?.objective).toBe("남이");
    expect(out.find((x) => x.no === 101)?.objective).toBe("내가");
    expect(out.find((x) => x.no === 105)?.scope).toEqual({ team: "C" });
    expect(out.findIndex((x) => x.no === 105)).toBe(server.findIndex((x) => x.no === 105)); // 서버 자리 그대로
  });
  it("내가 지운 행은 빠지고, 서버가 지운 행은 내가 안 고쳤으면 빠진다", () => {
    const base = layered();
    const local = base.filter((x) => x.no !== 103);
    const server = base.filter((x) => x.no !== 104).map((x) => (x.no === 1 ? { ...x, objective: "s" } : x));
    const out = mergeGoals(base, local, server);
    expect(out.some((x) => x.no === 103 || x.no === 104)).toBe(false);
    expect(out.find((x) => x.no === 1)?.objective).toBe("s");
  });
  it("공통 행 동시 추가는 1~100 띠에서 새 번호, otherNos 도 피한다", () => {
    const base = nine();
    const server = addGoalRow(base, P1).goals;
    const local = addGoalRow(base, P2).goals;
    const out = mergeGoals(base, local, server, [11]);
    expect(out.find((x) => x.no === 10)?.pillar).toBe(P1);
    expect(out.find((x) => x.no === 12)?.pillar).toBe(P2);
  });
});

describe("확인창·저장 위치(okrGoalConfirm)", () => {
  beforeEach(() => ask.mockReset());
  it("층마다 문구 — 공통·A파트 전용·개인 전용", async () => {
    ask.mockResolvedValue(true);
    await confirmAddGoalRow(nine(), P1);
    await confirmAddGoalRow(nine(), P1, [], false, { team: "A" });
    const added = await confirmAddGoalRow(nine(), P1, [], false, { team: "A", member: "홍길동" }, 10);
    expect(ask.mock.calls.map((c) => c[0])).toEqual([ADD_GOAL_MESSAGE, addGoalMessage("team", "A"), addGoalMessage("member", "홍길동", 10)]);
    expect(ask.mock.calls[1][0]).toContain("A파트 전용");
    expect(ask.mock.calls[2][0]).toContain("홍길동 님의 10월 모든 주차");
    expect(added?.no).toBe(101);
    expect(added?.goals.find((x) => x.no === 101)?.scope).toEqual({ team: "A", member: "홍길동" });
  });
  it("파트 탭에서 공통 행 지우기는 묻지도 않고 null, 전용 행은 누구나 — 확인창 첫 줄에 주인", async () => {
    expect(await confirmRemoveGoalRow(layered(), 1, false, "공통", { team: "A" })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    ask.mockResolvedValueOnce(true);
    expect((await confirmRemoveGoalRow(layered(), 102, false, "P2 병목", { team: "B", member: "박영수" }))?.goals.some((x) => x.no === 102)).toBe(false);
    expect(String(ask.mock.calls[0][0]).startsWith("홍길동 전용 행입니다.\n")).toBe(true);
    ask.mockResolvedValueOnce(true);
    await confirmRemoveGoalRow(layered(), 101, true, "P1 병목", {});
    expect(String(ask.mock.calls[1][0]).startsWith("A파트 전용 행입니다.\n")).toBe(true);
    ask.mockResolvedValueOnce(true);
    await confirmRemoveGoalRow(layered(), 1, false, "공통", {});
    expect(String(ask.mock.calls[2][0])).not.toContain("전용 행입니다");
    expect([ownerLabelOf({}), ownerLabelOf({ scope: { team: "C" } }), ownerLabelOf({ scope: { team: "C", member: "이영희" } })]).toEqual(["", "C파트 전용", "이영희 전용"]);
  });
  it("goalEditTarget — 전용 행은 어느 화면에서든 own(행 자체, 구글시트처럼 한 벌), 공통 행은 파트 탭에서 layer", () => {
    const g = layered();
    const by = (no: number) => g.find((x) => x.no === no);
    const blankCommon: OkrGoal = { no: 10, pillar: P1, bottleneck: "", objective: "", criteria: "" };
    expect(goalEditTarget(blankCommon, { team: "A" })).toBe("layer");
    expect(goalEditTarget(by(1), { team: "A", member: "홍길동" })).toBe("layer");
    expect(goalEditTarget(by(1), {})).toBe("own");
    expect(goalEditTarget(by(101), { team: "A" })).toBe("own");
    expect(goalEditTarget(by(101), { team: "A", member: "홍길동" })).toBe("own");
    expect(goalEditTarget(by(102), { team: "A", member: "홍길동" })).toBe("own");
    expect(goalEditTarget(by(102), { team: "A", member: "김철수" })).toBe("own");
    expect(goalEditTarget(by(104), { team: "A" })).toBe("own");
    expect(goalEditTarget(undefined, { team: "A" })).toBe("layer");
  });
});
