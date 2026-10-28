import { describe, expect, it } from "vitest";
import { REGION_TEAM_MAP, teamOfRegionText } from "../src/regionTeamMap";
import { sheetRowToVendor } from "../src/misuVisitHistoryData";

// 2026-10-28 "E 지역은 미수가 없나? 왜 0이지?" — misu '지역' 칸 실측 분포(팀장 집계) 표본.
// 팀 근거 = vendor_info(임대리스트) 시/구 × 관리 담당자 집계(MCP 실측).
describe("teamOfRegionText — 자유 입력 지역 → 팀", () => {
  const cases: Array<[string, string]> = [
    ["A", "A"], ["D", "D"], ["E", "E"], ["수도권B", "B"], ["수도권C", "C"], ["C지역", "C"], ["B지역", "B"], ["수도권c", "C"], ["Ｄ", "D"],
    ["CSS", "E"], ["지방", "E"], ["강서B", "B"],
    ["강남구", "C"], ["서초구", "C"], ["송파구", "C"], ["성동구", "C"], ["광진구", "C"], ["강동구", "C"], ["강남", "C"],
    ["고양시", "A"], ["일산", "A"], ["양주시", "A"], ["남양주", "A"], ["중구", "A"], ["마포구", "A"],
    ["구로", "B"], ["강서", "B"], ["강서구", "B"], ["금천구", "B"], ["관악구", "B"], ["부천", "B"], ["김포시", "B"], ["연수구", "B"],
    ["인천", "B"], ["인천 미추홀", "B"], ["서울 구로구", "B"], ["서구", "B"],
    ["평택시", "D"], ["화성시", "D"], ["안성시", "D"], ["성남시", "D"], ["용인시", "D"], ["용인", "D"], ["오산시", "D"], ["광주시", "D"],
    ["수원시 영통구", "D"], ["성남시 분당구", "D"], ["경기", "D"], ["경기 고양시", "A"],
    ["세종", "E"], ["세종시", "E"], ["제주시", "E"], ["원주시", "E"], ["기장군", "E"], ["아산시", "E"], ["김천시", "E"], ["홍천군", "E"],
    ["제주도 출장", "E"], ["부산 강서구", "E"], ["강원도", "E"], ["충청도", "E"], ["광주광역시", "E"], ["부산진구", "E"],
    ["서초, 광주, 광명", "C"], ["광명, 광명사무실, 광주공장, 서울 사무실", "B"],
  ];
  it.each(cases)("%s → %s", (text, team) => { expect(teamOfRegionText(text)).toBe(team); });

  it("업체명 오입력·모호한 값·빈 값은 미지정(\"\")", () => {
    for (const v of ["뉴스토리사이언", "서울", "수도권", "동구", "남구", "북구", "7.3", "", null, undefined, "수정 요청"]) {
      expect(teamOfRegionText(v)).toBe("");
    }
  });

  it("표에 같은 이름이 두 팀으로 들어가지 않는다", () => {
    const names = Object.keys(REGION_TEAM_MAP);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("미수 조회 팀 = 관리부 시트 이름(지역 칸 아님)", () => {
  // 시트:수도권E_김슬기 의 '지역'은 서구·아산시·김천시 … — 지명으로 다시 나누면 서구(B)가 E 에서 빠진다
  it("E 시트 행은 지역이 '서구'여도 E", () => {
    const v = sheetRowToVendor({ id: 1, _업체명: "주식회사 네스프", 지역: "서구", _출처: "시트:수도권E_김슬기", 미수잔액: "220000" });
    expect(v?.team).toBe("E");
    expect(teamOfRegionText("서구")).toBe("B");
  });
});
