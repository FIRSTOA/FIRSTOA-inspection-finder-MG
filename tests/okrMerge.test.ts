import { describe, expect, it } from "vitest";
import { emptyReport, mergeCycle, mergeGoals, mergeReport, type OkrCycle, type OkrGoal, type OkrReport } from "../src/okr";

const goal = (no: number, objective: string, criteria = ""): OkrGoal => ({ no, pillar: "Pillar 1.\nAI · 효율성 · 비용절감", bottleneck: `병목현상 ${no}`, objective, criteria });
const cycle = (goals: OkrGoal[], feedback: OkrCycle["feedback"] = {}, title = "9월"): OkrCycle => ({ id: "2026-09", kind: "month", title, year: 2026, month: 9, week_no: null, start_date: "2026-09-01", end_date: "2026-09-30", parent_id: null, goals, feedback });
const report = (rows: OkrReport["rows"], header: Partial<OkrReport["header"]> = {}): OkrReport => ({ ...emptyReport("2026-09", "C", ""), header: { leader: "", author: "", headcount: "", submitted: "", ...header }, rows });
const row = (no: number, actual: string, judgment = "") => ({ no, actual, judgment, reason: "", plan: "", evidence: "" });

describe("OKR 3자 병합 — 내가 고친 칸은 내 것, 안 고친 칸은 서버 것", () => {
  it("목표: 다른 사람이 2번을 고치고 내가 1번을 고쳤으면 둘 다 남는다", () => {
    const base = [goal(1, "a"), goal(2, "b")];
    const local = [goal(1, "a-내가"), goal(2, "b")];
    const server = [goal(1, "a"), goal(2, "b-남이")];
    expect(mergeGoals(base, local, server).map((g) => g.objective)).toEqual(["a-내가", "b-남이"]);
  });
  it("목표: 내가 안 고쳤으면 서버 그대로, 서버가 안 바뀌었으면 내 것 그대로, 번호 구조가 어긋나면 내 것", () => {
    const base = [goal(1, "a")];
    expect(mergeGoals(base, base, [goal(1, "s")])[0].objective).toBe("s");
    expect(mergeGoals(base, [goal(1, "l")], base)[0].objective).toBe("l");
    expect(mergeGoals(base, [goal(1, "l"), goal(2, "x")], [goal(1, "s")]).map((g) => g.objective)).toEqual(["l", "x"]);
  });
  it("달: 제목·피드백도 칸 단위로 합친다", () => {
    const base = cycle([goal(1, "a")], { "1": { memo: "m" } });
    const local = cycle([goal(1, "a")], { "1": { memo: "m" }, "2": { memo: "내 피드백" } });
    const server = cycle([goal(1, "a")], { "1": { memo: "남이 고친 m" } }, "9월(남이 제목)");
    const out = mergeCycle(base, local, server);
    expect(out.title).toBe("9월(남이 제목)");
    expect(out.feedback).toEqual({ "1": { memo: "남이 고친 m" }, "2": { memo: "내 피드백" } });
  });
  it("기록: 팀원이 적은 3번 행을 남기고 내가 고친 1번 행·머리 칸은 내 것", () => {
    const base = report([row(1, "x")], { leader: "김" });
    const local = report([row(1, "x-내가", "완료")], { leader: "김", author: "나" });
    const server = report([row(1, "x"), row(3, "남이 적음")], { leader: "김 → 박" });
    const out = mergeReport(base, local, server);
    expect(out.rows.map((r) => [r.no, r.actual])).toEqual([[1, "x-내가"], [3, "남이 적음"]]);
    expect(out.header).toMatchObject({ leader: "김 → 박", author: "나" });
  });
  it("기록: 처음 적는 사람(base 빈 행)은 서버에 그 사이 생긴 행과 합쳐진다", () => {
    const base = emptyReport("2026-09", "C", "이민구");
    const local = { ...base, rows: [row(2, "내 결과")] };
    const server = { ...base, rows: [row(1, "남이 대신 적은 1번")] };
    expect(mergeReport(base, local, server).rows.map((r) => r.no)).toEqual([1, 2]);
  });
});
