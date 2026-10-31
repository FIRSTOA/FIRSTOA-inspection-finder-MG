import { describe, expect, it } from "vitest";
import { currentYQ, nearestYearFor, placeYear, sameYQ, scopeFilter, shiftYQ, yqChip, yqKey, yqLabel } from "../src/workinPlaces";

// KST 기준 시각을 UTC 로 — kst("2026-12-20T10:00") = 그 KST 시각
const kst = (s: string) => new Date(Date.parse(`${s}:00+09:00`));

describe("workinPlaces 연도+분기 헬퍼(설계 workin-year-rollover §3-2)", () => {
  it("currentYQ 는 KST — 1월 1일 새벽(UTC 로는 작년 12-31)도 새해 1분기", () => {
    expect(currentYQ(kst("2027-01-01T08:30"))).toEqual({ year: 2027, quarter: 1 });
    expect(currentYQ(kst("2026-12-31T23:59"))).toEqual({ year: 2026, quarter: 4 });
    expect(currentYQ(kst("2026-10-01T00:10"))).toEqual({ year: 2026, quarter: 4 });
    expect(currentYQ(kst("2026-09-30T23:50"))).toEqual({ year: 2026, quarter: 3 });
  });

  it("shiftYQ: 4분기 +1 → 다음 해 1분기, 1분기 −1 → 작년 4분기, 여러 칸", () => {
    expect(shiftYQ({ year: 2026, quarter: 4 }, 1)).toEqual({ year: 2027, quarter: 1 });
    expect(shiftYQ({ year: 2027, quarter: 1 }, -1)).toEqual({ year: 2026, quarter: 4 });
    expect(shiftYQ({ year: 2026, quarter: 2 }, 1)).toEqual({ year: 2026, quarter: 3 });
    expect(shiftYQ({ year: 2027, quarter: 1 }, -3)).toEqual({ year: 2026, quarter: 2 });
    expect(shiftYQ({ year: 2026, quarter: 3 }, 6)).toEqual({ year: 2028, quarter: 1 });
    expect(shiftYQ({ year: 2026, quarter: 3 }, 0)).toEqual({ year: 2026, quarter: 3 });
  });

  it("nearestYearFor: 12월 1분기 → 다음 해 · 1월 4분기 → 작년 · 동점은 지난 쪽", () => {
    const dec = kst("2026-12-20T10:00");
    expect(nearestYearFor(1, dec)).toBe(2027);   // 12월 선반영 대상
    expect(nearestYearFor(4, dec)).toBe(2026);
    expect(nearestYearFor(3, dec)).toBe(2026);
    expect(nearestYearFor(2, dec)).toBe(2026);   // 2026-2Q 와 2027-2Q 가 둘 다 2분기 차 → 과거
    const jan = kst("2027-01-05T10:00");
    expect(nearestYearFor(4, jan)).toBe(2026);   // 1월에 작년 4분기
    expect(nearestYearFor(1, jan)).toBe(2027);
    expect(nearestYearFor(2, jan)).toBe(2027);
    expect(nearestYearFor(3, jan)).toBe(2026);   // 동점 → 과거
  });

  it("yqLabel · yqChip · yqKey", () => {
    expect(yqLabel({ year: 2026, quarter: 4 })).toBe("26년 4분기");
    expect(yqLabel({ year: 2027, quarter: 1 }, true)).toBe("27·1Q");
    expect(yqChip({ year: 2026, quarter: 4 })).toBe("26·4Q");
    expect(yqKey({ year: 2026, quarter: 4 })).toBe("2026-4");
  });

  it("scopeFilter: 범위 객체 · (연,분기) 1개 · 여럿(해 넘김) · 중복 제거", () => {
    expect(scopeFilter({ team: "C", year: 2027, quarter: 1, kind: "quarter" })).toBe("team=eq.C&year=eq.2027&quarter=eq.1&kind=eq.quarter");
    expect(scopeFilter({ year: 2026, quarter: 4 })).toBe("year=eq.2026&quarter=eq.4");
    expect(scopeFilter([{ year: 2026, quarter: 4 }])).toBe("year=eq.2026&quarter=eq.4");
    const cur = currentYQ(kst("2026-12-20T10:00"));
    expect(scopeFilter([cur, shiftYQ(cur, 1)])).toBe("or=(and(year.eq.2026,quarter.eq.4),and(year.eq.2027,quarter.eq.1))");
    expect(scopeFilter([cur, cur])).toBe("year=eq.2026&quarter=eq.4");
    expect(scopeFilter([])).toBe("");
  });

  it("placeYear: year → ext_year → 가까운 해 / sameYQ 는 26년 1분기 잔존 행을 27년 1분기로 보지 않음", () => {
    const dec = kst("2026-12-20T10:00");
    expect(placeYear({ year: 2026, quarter: 1 }, dec)).toBe(2026);
    expect(placeYear({ year: null, ext_year: 2026, quarter: 1 }, dec)).toBe(2026);
    expect(placeYear({ quarter: 1 }, dec)).toBe(2027);   // 캐시 행(연도 없음) — 12월엔 1분기 = 다음 해로 추정
    const next = shiftYQ(currentYQ(dec), 1);
    expect(sameYQ({ year: 2026, quarter: 1 }, next, dec)).toBe(false);
    expect(sameYQ({ year: 2027, quarter: 1 }, next, dec)).toBe(true);
    expect(sameYQ({ year: 2026, quarter: 4 }, { year: 2026, quarter: 4 }, dec)).toBe(true);
  });
});
