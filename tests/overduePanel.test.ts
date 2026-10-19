import { describe, expect, it } from "vitest";
import { filterOverdue, overdueAgeTone, overdueBadge, overdueKind } from "../src/overdueLogic";

const rows = [
  { team: "A", scheduleType: "AS" },
  { team: "A", scheduleType: "납품철수교체휴가교육" },
  { team: "B", scheduleType: "물류" },
];
describe("미처리 일정 칸", () => {
  it("종류 판정과 배지", () => {
    expect(overdueKind("AS")).toBe("AS");
    expect(overdueKind("납품철수교체휴가교육")).toBe("물류");
    expect(overdueKind("물류")).toBe("물류");
    expect(overdueBadge("납품철수교체휴가교육")).toBe("납품");
  });
  it("팀·종류 필터", () => {
    expect(filterOverdue(rows, "A", "")).toHaveLength(2);
    expect(filterOverdue(rows, "", "물류")).toHaveLength(2);
    expect(filterOverdue(rows, "A", "AS")).toHaveLength(1);
  });
  it("경과일 색", () => {
    expect([2, 3, 6, 7].map(overdueAgeTone)).toEqual(["plain", "amber", "amber", "red"]);
  });
});
