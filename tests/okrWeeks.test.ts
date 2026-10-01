import { describe, expect, it } from "vitest";
import { currentWeekOf, okrWeeksInMonth, weekCycleId, weekMonthOf } from "../src/okr";

// 한 주(월~금)는 그 주가 시작하는 월요일이 든 달에만 속한다(2026-10-01 사용자) — 달 경계 주가 두 달에 겹쳐 적히지 않는다
describe("OKR 주차 — 한 주는 한 달에만(월요일 기준)", () => {
  it("2026년 9월: 9/7 주가 1주차, 9/28~10/2가 4주차 — 8/31~9/4는 8월 5주차", () => {
    const weeks = okrWeeksInMonth(2026, 9);
    expect(weeks.map((w) => [w.weekNo, w.start, w.end])).toEqual([
      [1, "2026-09-07", "2026-09-11"], [2, "2026-09-14", "2026-09-18"], [3, "2026-09-21", "2026-09-25"], [4, "2026-09-28", "2026-10-02"],
    ]);
    expect(okrWeeksInMonth(2026, 8).at(-1)).toEqual({ weekNo: 5, start: "2026-08-31", end: "2026-09-04" });
  });
  it("2026년 10월 1주차는 10/5부터 — 9/28 주는 10월에 없다", () => {
    const weeks = okrWeeksInMonth(2026, 10);
    expect(weeks[0]).toEqual({ weekNo: 1, start: "2026-10-05", end: "2026-10-09" });
    expect(weeks.some((w) => w.start === "2026-09-28")).toBe(false);
    expect(weeks[weeks.length - 1]).toEqual({ weekNo: 4, start: "2026-10-26", end: "2026-10-30" });
  });
  it("오늘이 10/1(목)이면 9월 4주차, 10/5(월)이면 10월 1주차, 9/1(화)이면 8월 5주차", () => {
    expect(currentWeekOf("2026-10-01")).toEqual({ year: 2026, month: 9, weekNo: 4 });
    expect(currentWeekOf("2026-10-02")).toEqual({ year: 2026, month: 9, weekNo: 4 });
    expect(currentWeekOf("2026-10-05")).toEqual({ year: 2026, month: 10, weekNo: 1 });
    expect(currentWeekOf("2026-09-01")).toEqual({ year: 2026, month: 8, weekNo: 5 });
    expect(weekCycleId(2026, 9, 4)).toBe("2026-09-W4");
  });
  it("연말·연초: 12/28~1/1 주는 12월 4주차(11/30 주는 11월 5주차), 2027년 1월 1주차는 1/4부터", () => {
    expect(weekMonthOf("2026-12-28")).toEqual({ year: 2026, month: 12 });
    expect(okrWeeksInMonth(2026, 12).map((w) => w.start)).toEqual(["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"]);
    expect(okrWeeksInMonth(2026, 11).at(-1)?.start).toBe("2026-11-30");
    expect(okrWeeksInMonth(2027, 1)[0].start).toBe("2027-01-04");
    expect(currentWeekOf("2027-01-01")).toEqual({ year: 2026, month: 12, weekNo: 4 });
  });
  it("모든 달의 주가 겹치거나 빠지지 않는다(2026년)", () => {
    const all = Array.from({ length: 12 }, (_, i) => okrWeeksInMonth(2026, i + 1)).flat().map((w) => w.start);
    expect(new Set(all).size).toBe(all.length);
    const sorted = [...all].sort();
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(`${sorted[i - 1]}T12:00:00+09:00`); const cur = new Date(`${sorted[i]}T12:00:00+09:00`);
      expect((cur.getTime() - prev.getTime()) / 86_400_000).toBe(7);
    }
  });
});
