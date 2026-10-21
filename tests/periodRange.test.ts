import { describe, expect, it } from "vitest";
import { calendarRange } from "../src/periodRange";

describe("calendarRange", () => {
  it("이번 달 = 1일~말일", () => {
    expect(calendarRange("month", "2026-10-21")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(calendarRange("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("지난달 — 연초에는 작년 12월", () => {
    expect(calendarRange("lastmonth", "2026-10-21")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(calendarRange("lastmonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("최근 3개월 = 이번 달 포함 달력월 3개", () => {
    expect(calendarRange("3m", "2026-10-21")).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(calendarRange("3m", "2026-02-15")).toEqual({ from: "2025-12-01", to: "2026-02-28" });
  });
  it("6개월·1년", () => {
    expect(calendarRange("6m", "2026-10-21").from).toBe("2026-05-01");
    expect(calendarRange("1y", "2026-10-21").from).toBe("2025-11-01");
  });
});
