/**
 * 달성표 팀 칸 = 펼친 개인 칩 합(2026-10-25 사용자 "PC확장성 C팀 칸 19인데 상세는 17").
 * 팀 칸은 지역 칸으로 팀을 정하고, 개인 칩은 명단 사람의 작성자 기준으로 따로 세서 같은 행 집합이 아니었다.
 * 고친 뒤: 개인 = {team, author}(팀 칸 안에서 그 사람 몫) + 남는 몫은 "그 외" 줄 → 합이 팀 칸과 같다.
 * 순항 여유(2026-10-25 팀장 결정): 경과율 − 5포인트 이상이면 순항.
 */
import { describe, expect, it } from "vitest";
import { KPI_REST_LABEL, kpiProgress, kpiRanges, kpiRowStatus, ON_TRACK_MIN_PCT, type RosterMember } from "../src/kpi/kpiCompute";
import { parseKpiTargets } from "../src/kpi/kpiDefs";
import { toExpansionRows } from "../src/workCount";

const BOOK: Record<string, string> = { 이민구: "C", 한왕주: "C", 정준영: "D", 신정훈: "팀장" };
const teamOf = (a: string) => BOOK[a.trim()] || "미지정";
const ROSTER: RosterMember[] = [{ name: "이민구", team: "C" }, { name: "한왕주", team: "C" }, { name: "정준영", team: "D" }];
const R = kpiRanges("2026-10-24");
const pc = (id: number, day: string, author: string, region: string, vendor: string) => ({ id, "날짜": `${day}T02:00:00Z`, "작성자": author, "지역": region, "_업체명": vendor });

describe("팀 칸 = 개인 칩 합(같은 행 집합)", () => {
  // C 지역 기록: 명단 C 2명 3건 + 명단 밖(지원 나온 사람·오타 이름) 2건 + 팀장 1건(양쪽 다 제외)
  // 명단 C 사람이 D 지역으로 쓴 1건은 D 칸에 든다(C 개인 칩에 들면 C 합이 칸보다 커진다)
  const rows = toExpansionRows("pc_expansion", [
    pc(1, "2026-10-20", "이민구", "C", "가"), pc(2, "2026-10-21", "이민구", "C", "나"), pc(3, "2026-10-21", "한왕주", "수도권 C", "다"),
    pc(4, "2026-10-22", "외부지원", "C", "라"), pc(5, "2026-10-22", "한왕 주", "C", "마"),
    pc(6, "2026-10-22", "신정훈", "C", "바"),
    pc(7, "2026-10-23", "한왕주", "D", "사"),
  ], teamOf);
  const prog = kpiProgress("K7", { expansion: rows, roster: ROSTER }, { ranges: R, period: "week", settings: parseKpiTargets(""), teamOf });
  const team = (t: string) => prog.find((r) => r.scope === "team" && r.team === t)!;
  const people = (t: string) => prog.filter((r) => r.scope === "person" && r.team === t);
  const sum = (t: string) => people(t).reduce((a, r) => a + (r.actual ?? 0), 0);

  it("C: 칸 5 = 이민구 2 + 한왕주 1 + 그 외 2", () => {
    expect(team("C").actual).toBe(5);
    expect(sum("C")).toBe(5);
    expect(people("C").map((r) => [r.label, r.actual])).toEqual([["이민구", 2], ["한왕주", 1], [KPI_REST_LABEL, 2]]);
    expect(people("C").find((r) => r.rest)).toMatchObject({ target: null, headcount: 0 });
  });
  it("D: 칸 1 = 다른 팀(한왕주)이 D 지역으로 쓴 1건 → 그 외 1, 정준영 0", () => {
    expect(team("D").actual).toBe(1);
    expect(sum("D")).toBe(1);
    expect(people("D").find((r) => r.label === "정준영")?.actual).toBe(0);
  });
  it("모든 팀에서 개인 합 = 팀 칸, 남는 몫이 없으면 그 외 줄도 없다", () => {
    for (const t of ["A", "B", "C", "D", "E"]) expect(sum(t)).toBe(team(t).actual);
    expect(people("A").some((r) => r.rest)).toBe(false);
  });
});

describe("고정 기준(kpiRowStatus, 2026-10-25 사용자: 50% 미만 빨강 · 그 이후 파랑 · 100% 초록) — 경과율은 안 본다", () => {
  const st = (actual: number, elapsed: number | null) => kpiRowStatus({ actual, target: 100, elapsed, basis: "perPersonBizDay" });
  it("경과율과 무관: 50 순항 · 49 부족 · 100 달성", () => {
    expect(ON_TRACK_MIN_PCT).toBe(50);
    expect(st(50, 100)).toBe("onTrack");
    expect(st(49, 100)).toBe("behind");
    expect(st(100, 100)).toBe("done");
    expect(st(50, 10)).toBe("onTrack");
    expect(st(49, 10)).toBe("behind");
    expect(st(75, 86)).toBe("onTrack"); // 토요일 블로그 A팀 75% — 전엔 빨강
  });
  it("C팀 실측 19/20 = 순항", () => {
    expect(kpiRowStatus({ actual: 19, target: 20, elapsed: 100, basis: "perPersonBizDay" })).toBe("onTrack");
  });
});
