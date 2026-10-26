import { describe, expect, it } from "vitest";
import { regionTeamRegex } from "../src/formCount";
import { regionTeam } from "../src/workCount";
import { receptionTeam } from "../src/homeUnhandled";

// Postgres imatch(대소문자 무시)를 JS 로 — [:space:] 만 공백 클래스로 바꾼다
const re = (pg: string) => new RegExp(pg.split("[:space:]").join("\\s"), "i");

// service_receptions.region 실측 값 전부(2026-10-27 MCP, deleted=false):
// 수도권A 214 · 수도권B 242 · 수도권C 241 · 수도권D 185 · 지방 78 · 매월 1 · 빈칸 1
const RECEPTION_REGIONS = ["수도권A", "수도권B", "수도권C", "수도권D", "지방", "매월", ""];
// 다른 표에서 본 E 표기(점검·AS 'E', 담당자 변경 '수도권E'·'e', CSS 팀 이름)
const OTHER = ["E", "e", "수도권E", "수도권 E", "CSS", "css 지원", "C", "c", "수도권 C", "C지역", "D(성남)", "A,D,E", "충청외극지방"];

describe("조회 탭 팀 칩 지역 판정 = regionTeam (CSS=E 접수 0건 버그, 2026-10-27)", () => {
  it("접수 실측 지역 값마다 imatch 정규식이 고르는 팀 = regionTeam", () => {
    for (const team of ["A", "B", "C", "D", "E"]) for (const v of [...RECEPTION_REGIONS, ...OTHER]) {
      expect([team, v, re(regionTeamRegex(team)).test(v)]).toEqual([team, v, regionTeam(v) === team]);
    }
  });

  it("'지방' 접수는 E(CSS) 칩에 걸린다 — 예전 ilike *E* 는 못 걸렀다", () => {
    expect(re(regionTeamRegex("E")).test("지방")).toBe(true);
    expect("지방".toUpperCase().includes("E")).toBe(false); // 옛 판정(글자 포함)이 0건이던 이유
  });

  it("홈 미처리 receptionTeam 도 '지방'을 E 로 본다(같은 판정)", () => {
    for (const v of RECEPTION_REGIONS) {
      const r = receptionTeam("복합기 AS", v);
      expect([v, r]).toEqual([v, regionTeam(v)]);
    }
  });

  it("정규식에 백슬래시·쉼표가 없다(PostgREST or=(…) 따옴표 값 안전)", () => {
    for (const team of ["A", "B", "C", "D", "E"]) expect(regionTeamRegex(team)).not.toMatch(/[,\\]/);
  });
});
