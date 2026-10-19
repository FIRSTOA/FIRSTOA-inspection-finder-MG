import { describe, expect, it } from "vitest";
import { deptCalEditPatch, deptCalFormOf, deptCalQuery, groupDeptEventsByDate, isDeptCalTeam, toDeptCalEvent } from "../src/deptCalendarView";

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

describe("부서 달력 편집 행 변환", () => {
  it("폼 → PATCH 본문: 다듬고, 제목·날짜·시간 형식을 검사한다", () => {
    const ev = toDeptCalEvent({ id: "1", team: "영업팀", date: "2026-10-20", time: "09:30:00", title: "[영업] 가나 · 견적", memo: "메모", reception_id: "r1" })!;
    expect(deptCalFormOf(ev)).toEqual({ date: "2026-10-20", time: "09:30", title: "[영업] 가나 · 견적", memo: "메모" });
    expect(deptCalEditPatch({ date: "2026-10-22", time: "", title: "  견적 방문 ", memo: " 2층 \n" }))
      .toEqual({ ok: true, patch: { date: "2026-10-22", time: "", title: "견적 방문", memo: "2층" } });
    expect(deptCalEditPatch({ date: "2026-10-22", time: "14:05", title: "x", memo: "" })).toMatchObject({ ok: true, patch: { time: "14:05" } });
    expect(deptCalEditPatch({ date: "2026-10-22", time: "", title: "  ", memo: "" })).toEqual({ ok: false, error: "제목을 적어 주세요" });
    expect(deptCalEditPatch({ date: "", time: "", title: "x", memo: "" }).ok).toBe(false);
    expect(deptCalEditPatch({ date: "2026-10-22", time: "9시", title: "x", memo: "" }).ok).toBe(false);
  });
});
