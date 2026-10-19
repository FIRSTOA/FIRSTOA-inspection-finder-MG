import { describe, expect, it } from "vitest";
import { deptCalQuery, groupDeptEventsByDate, isDeptCalTeam, toDeptCalEvent } from "../src/deptCalendarView";

describe("부서 달력 보기", () => {
  it("부서 3종만 부서 팀으로 본다", () => {
    expect(isDeptCalTeam("경영지원")).toBe(true);
    expect(isDeptCalTeam("운영지원")).toBe(true);
    expect(isDeptCalTeam("영업팀")).toBe(true);
    for (const v of ["ALL", "A", "E", "기타", "종일", "영업지원", "팀장", "", null]) expect(isDeptCalTeam(v)).toBe(false);
  });

  it("행 변환: reception_id null → '', ✅ 제목은 완료, 현장 팀 행·잘못된 날짜는 버린다", () => {
    const ev = toDeptCalEvent({ id: "1", team: "영업팀", date: "2026-10-20", time: null, title: "✅ [영업] 가나 · 견적", memo: null, author: "홍길동", reception_id: null });
    expect(ev).toEqual({ id: "1", team: "영업팀", date: "2026-10-20", time: "", title: "✅ [영업] 가나 · 견적", memo: "", author: "홍길동", receptionId: "", done: true });
    expect(toDeptCalEvent({ id: "2", team: "C", date: "2026-10-20" })).toBeNull();
    expect(toDeptCalEvent({ id: "3", team: "경영지원", date: "10/20" })).toBeNull();
    expect(toDeptCalEvent({ id: "4", team: "운영지원", date: "2026-10-21", reception_id: "abc" })?.receptionId).toBe("abc");
  });

  it("조회문은 한글 팀을 인코딩하고 날짜 범위를 건다", () => {
    const q = deptCalQuery("경영지원", "2026-09-27", "2026-11-07");
    expect(q).toContain(`team=eq.${encodeURIComponent("경영지원")}`);
    expect(q).toContain("date=gte.2026-09-27&date=lte.2026-11-07");
    expect(q).toContain("reception_id");
  });

  it("날짜별로 묶는다", () => {
    const a = toDeptCalEvent({ id: "1", team: "경영지원", date: "2026-10-01" })!;
    const b = toDeptCalEvent({ id: "2", team: "경영지원", date: "2026-10-01" })!;
    const c = toDeptCalEvent({ id: "3", team: "경영지원", date: "2026-10-02" })!;
    const g = groupDeptEventsByDate([a, b, c]);
    expect(g.get("2026-10-01")?.map((e) => e.id)).toEqual(["1", "2"]);
    expect(g.get("2026-10-02")?.length).toBe(1);
  });
});

describe("일정리스트 팀 칩 해석", () => {
  it("부서 칸은 dept 만, 현장 칸은 team 만 돌려준다", async () => {
    const { splitTeamPick } = await import("../src/deptCalendarView");
    expect(splitTeamPick("운영지원")).toEqual({ dept: "운영지원", team: null });
    expect(splitTeamPick("ALL")).toEqual({ dept: null, team: "ALL" });
    expect(splitTeamPick("E")).toEqual({ dept: null, team: "E" });
    expect(splitTeamPick("종일")).toEqual({ dept: null, team: "종일" });
  });
});
