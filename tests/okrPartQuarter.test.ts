// 파트 탭 [n분기] 화면 규칙(src/okrPartQuarter.ts, 2026-11-01) — 탭 머리 = 분기 실제결과가 적힌 목표 수/목표 수, 분기 기록 행 연결
import { describe, expect, it } from "vitest";
import { emptyReport, emptyResultRow, partQuarterRows, type OkrQuarterRollup, type OkrReport } from "../src/okr";
import { partQuarterTabCount } from "../src/okrPartQuarter";

const empty = { byMonth: {}, quarter: "" as const };
const rollup: OkrQuarterRollup = {
  months: [{ id: "2026-10", month: 10, actionTeams: 0 }],
  rows: [1, 2, 3].map((no) => ({
    no, pillar: "", bottleneck: "", objective: "", criteria: "", byMonth: {}, quarter: { judgment: "", auto: "", manual: false },
    byTeam: { A: { byMonth: { "2026-10": { judgment: "미흡" as const, source: "set" as const } }, quarter: "미흡" as const }, B: empty, C: empty, D: empty },
  })),
};

describe("파트 분기 규칙", () => {
  it("탭 머리: 분기 실제결과가 적힌 목표 수/목표 수, 판정·미흡은 세지 않는다", () => {
    expect(partQuarterTabCount(partQuarterRows(rollup, "A", null))).toEqual({ count: "0/3", alerts: 0 });
    const rep: OkrReport = { ...emptyReport("2026-Q4", "A", ""), rows: [{ ...emptyResultRow(1), actual: "10월: 6건 / 11월: 8건" }, { ...emptyResultRow(2), actual: "  ", judgment: "미흡" }, { ...emptyResultRow(3), reason: "사유만" }] };
    expect(partQuarterTabCount(partQuarterRows(rollup, "A", rep))).toEqual({ count: "1/3", alerts: 0 });
    expect(partQuarterTabCount([])).toEqual({ alerts: 0 });
  });
  it("다른 파트 기록은 섞이지 않는다", () => {
    const rep: OkrReport = { ...emptyReport("2026-Q4", "B", ""), rows: [{ ...emptyResultRow(1), actual: "B파트 결과" }] };
    expect(partQuarterTabCount(partQuarterRows(rollup, "A", null))).toEqual({ count: "0/3", alerts: 0 });
    expect(partQuarterRows(rollup, "B", rep)[0].row?.actual).toBe("B파트 결과");
  });
});
