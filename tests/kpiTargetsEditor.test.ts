import { describe, expect, it } from "vitest";
import { defaultKpiTargets, parseKpiTargets } from "../src/kpi/kpiDefs";
import { formFromJson, serializeForm } from "../src/kpi/kpiTargetsForm";

describe("KPI 목표 양식 직렬화", () => {
  it("아무것도 안 바꾸면 빈 JSON(전부 기본값)", () => {
    expect(serializeForm(formFromJson("")).json).toBe("");
  });

  it("바꾼 칸만 JSON 에 들어가고 parseKpiTargets 를 통과한다", () => {
    const f = formFromJson("");
    f.rows.K33.nums.perPersonWeek = "1"; // 오버홀 2 -> 1
    f.rows.K8.main = true;
    f.holidays = ["2026-12-31"];
    const { json, errors } = serializeForm(f);
    expect(errors).toEqual([]);
    const obj = JSON.parse(json) as Record<string, unknown>;
    expect(obj.K33).toEqual({ perPersonWeek: 1 });
    expect(Object.keys(obj).sort()).toEqual(["K33", "K8", "holidays"].sort());
    const s = parseKpiTargets(json);
    expect(s.error).toBe("");
    expect(s.targets.K33.perPersonWeek).toBe(1);
    expect(s.targets.K8.main).toBe(true);
    expect(s.holidays).toEqual(["2026-12-31"]);
    // 안 바꾼 지표는 기본값 그대로
    expect(s.targets.K10).toEqual(defaultKpiTargets().K10);
  });

  it("저장된 JSON 을 양식으로 읽어 다시 직렬화하면 같다", () => {
    const json = '{"K10":{"perTeamMonth":3},"holidays":["2026-12-31"]}';
    expect(serializeForm(formFromJson(json)).json).toBe(json);
  });

  it("기본값과 같게 되돌리면 그 칸은 JSON 에서 빠진다", () => {
    const f = formFromJson('{"K33":{"perPersonWeek":1}}');
    f.rows.K33.nums.perPersonWeek = "2";
    expect(serializeForm(f).json).toBe("");
  });

  it("음수·숫자 아님·잘못된 날짜는 오류로 막는다", () => {
    const f = formFromJson("");
    f.rows.K33.nums.perPersonWeek = "-1";
    f.rows.K10.nums.perTeamMonth = "abc";
    f.holidays = ["2026-1-1"];
    const { errors } = serializeForm(f);
    expect(errors).toEqual(expect.arrayContaining(["K33.perPersonWeek", "K10.perTeamMonth", "holidays.2026-1-1"]));
  });
});
