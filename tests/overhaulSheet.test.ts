import { describe, expect, it, vi } from "vitest";
import {
  clearOverhaulCache, countOverhaul, loadOverhaulRows, overhaulCsvUrl, overhaulDeptTeam, overhaulGidOf, overhaulTabFrom,
  parseOverhaulCsv, parseOverhaulDate, OVERHAUL_SHEET_DEFAULT_TAB, OVERHAUL_SHEET_ID,
} from "../src/overhaulSheet";

// 실측 모양(2026-10-24): 위에 빈 칸 섞인 줄 → 머리글 → 행. 날짜 3형식, 번호 쉼표, 빈 줄("" 또는 0,0)
const CSV = [
  ',,,,,,,,,,,,,,,,,',
  ',,,,,,,,,,,합계,,,,,,',
  '번호,날짜,년,월,담당자,부서명,모델명,부품명,오버홀품목,수리품목,소요시간,오버홀포인트,수리포인트,주차별,수리가공,오버홀가공,Column 17,실질주차',
  '"2,308",26/10/01,2026,10,김현군,CSS,C3070,정착기,1,1,30,1,1,1주,,,,',
  '"2,309",2026/1/2,2026,1,한왕주,강북C,X4220,현상기,1,,20,2,0.5,1주,,,,',
  '17,23/10/27(금),2023,10,박X,경기D,C2060,드럼,,,10,1.5,,4주,,,,',
  ',,,,,,,,,,,0,0,,,,,',
  ',,,,,,,,,,,,,,,,,',
  '"2,310",날짜아님,2026,10,이X,강북A,,,,,,3,,,,,,',
  '"2,311",26/13/01,2026,10,이X,강북A,,,,,,3,,,,,,',
  '"2,312",26/10/02,2026,10,외부Y,외부인력,,,,,,x,,,,,,',
].join("\n");

describe("오버홀 시트 — 날짜 3형식·점수 합·깨진 줄", () => {
  it("날짜: yy/mm/dd · yyyy/m/d · yy/mm/dd(요일) → YYYY-MM-DD", () => {
    expect(parseOverhaulDate("23/10/27(금)")).toBe("2023-10-27");
    expect(parseOverhaulDate("26/10/01")).toBe("2026-10-01");
    expect(parseOverhaulDate("2026/1/2")).toBe("2026-01-02");
    expect(parseOverhaulDate("2026-10-23")).toBe("2026-10-23");
    expect(parseOverhaulDate("26/02/30")).toBe(""); // 없는 날
    expect(parseOverhaulDate("")).toBe("");
    expect(parseOverhaulDate("합계")).toBe("");
  });
  it("머리글을 찾아 읽고 빈 줄·날짜 깨진 줄은 건너뛴다, 숫자 아닌 포인트는 0", () => {
    const rows = parseOverhaulCsv(CSV);
    expect(rows.map((r) => r.author)).toEqual(["김현군", "한왕주", "박X", "외부Y"]);
    expect(rows[0]).toEqual({ author: "김현군", date: "2026-10-01", points: 1, repairPoints: 1, dept: "CSS" });
    expect(rows[1]).toMatchObject({ date: "2026-01-02", points: 2, repairPoints: 0.5 });
    expect(rows[2]).toMatchObject({ date: "2023-10-27", points: 1.5, repairPoints: 0 });
    expect(rows[3].points).toBe(0);
  });
  it("머리글이 없으면 알린다(조용히 0 아님)", () => {
    expect(() => parseOverhaulCsv("a,b\n1,2")).toThrow(/머리글/);
  });
  it("기간 사람별 오버홀포인트·수리포인트 합", () => {
    const rows = parseOverhaulCsv(CSV);
    const c = countOverhaul(rows, "2026-01-01", "2026-12-31");
    expect([c.count, c.points, c.repairPoints]).toEqual([3, 3, 1.5]);
    expect(c.byPerson[0]).toMatchObject({ name: "한왕주", points: 2, repairPoints: 0.5, count: 1 });
    expect(countOverhaul(rows, "2026-10-01", "2026-10-31").points).toBe(1);
  });
  it("부서명 → 팀, 탭 설정", () => {
    expect(["강북A", "경기D", "CSS", "외부인력", "퇴사자", ""].map(overhaulDeptTeam)).toEqual(["A", "D", "E", "", "", ""]);
    expect(overhaulTabFrom({})).toBe(OVERHAUL_SHEET_DEFAULT_TAB);
    expect(overhaulTabFrom({ OVERHAUL_SHEET_TAB: " 리스트(27년) " })).toBe("리스트(27년)");
  });
});

// 2026-10-24 라이브 K33 "불러오지 못함" 재현: gviz CSV 는 열 형식 추정으로 머리글의 날짜·오버홀포인트 칸을 지운다
describe("오버홀 시트 주소 — gviz 말고 export?format=csv&gid=", () => {
  const GVIZ_HEAD = [
    '"-1","","","","","","","","","","","","","","","","",""',
    '"","","","","담당자","부서명","모델명","부품명","오버홀품목","수리품목","","","","주차별","수리가공","오버홀가공","Column 17","실질주차"',
    '"2,425","26/10/19","","","김현군","CSS","SL-X3220NR","","오버홀1","수리1","80","1","1","10월4주차","","","",""',
  ].join("\n");
  const EXPORT_HEAD = [
    "-1,,,,,,,,,,,,,,,,,",
    "0,날짜,년,월,담당자,부서명,모델명,부품명,오버홀품목,수리품목,소요시간,오버홀포인트,수리포인트,주차별,수리가공,오버홀가공,Column 17,실질주차",
    '"2,425",26/10/19,2026년,10월,김현군,CSS,SL-X3220NR,,오버홀1,수리1,80,1,1,10월4주차,,,,',
    '"2,429",26/10/19,2026년,10월,이권선,강북A,SL-X3220NR,현상기,오버홀2,,180,2,0,10월4주차,,,,',
  ].join("\n");

  it("gviz 모양(머리글 칸 지워짐)은 읽을 수 없다 — 그래서 gviz 를 쓰면 안 된다", () => {
    expect(() => parseOverhaulCsv(GVIZ_HEAD)).toThrow(/머리글/);
  });
  it("export 모양(첫 줄 -1, 번호 칸 0 인 머리글)은 읽는다", () => {
    const rows = parseOverhaulCsv(EXPORT_HEAD);
    expect(rows).toEqual([
      { author: "김현군", date: "2026-10-19", points: 1, repairPoints: 1, dept: "CSS" },
      { author: "이권선", date: "2026-10-19", points: 2, repairPoints: 0, dept: "강북A" },
    ]);
  });
  it("설정값 → gid: 기본 탭 0, 알려진 탭 이름, gid 숫자, 시트 주소, 모르는 이름은 빈 값", () => {
    expect(overhaulGidOf("")).toBe("0");
    expect(overhaulGidOf("리스트(26년)")).toBe("0");
    expect(overhaulGidOf("리스트(23년~25년3분기)")).toBe("1322158055");
    expect(overhaulGidOf(" 123456 ")).toBe("123456");
    expect(overhaulGidOf(`https://docs.google.com/spreadsheets/d/${OVERHAUL_SHEET_ID}/edit#gid=987`)).toBe("987");
    expect(overhaulGidOf("리스트(27년)")).toBe("");
  });
  it("주소는 export?format=csv&gid= 이고 gviz 가 아니다, 모르는 탭은 gid 를 달라고 던진다", () => {
    const url = overhaulCsvUrl("리스트(26년)");
    expect(url).toBe(`https://docs.google.com/spreadsheets/d/${OVERHAUL_SHEET_ID}/export?format=csv&gid=0`);
    expect(url).not.toContain("gviz");
    expect(() => overhaulCsvUrl("리스트(27년)")).toThrow(/gid/);
  });
  it("loadOverhaulRows 는 export 주소로 받아 읽는다", async () => {
    clearOverhaulCache();
    const fetchMock = vi.fn(async () => new Response(EXPORT_HEAD, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const rows = await loadOverhaulRows(OVERHAUL_SHEET_DEFAULT_TAB, { force: true });
      expect(rows).toHaveLength(2);
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/export?format=csv&gid=0");
      await expect(loadOverhaulRows("리스트(27년)", { force: true })).rejects.toThrow(/gid/);
    } finally {
      vi.unstubAllGlobals();
      clearOverhaulCache();
    }
  });
});
