import { describe, expect, it } from "vitest";
import { BLOG_CACHE_MS, blogCacheFresh, blogGvizUrl, blogPeriods, blogTeamOf, countBlog, parseBlogCsv } from "../src/blogSheet";

const HEAD = "순번,분기,월,등록일,주차,참여자성함,아이디,댓글내용[반드시 본인이 쓴 댓글만],블로그URL,체크표시,포인트(0.5/1),부서명";
const csv = [
  HEAD,
  "예시,2025-4분기,2025-12,2025-12-01,,김예지,YJ,좋아요,https://x,TRUE,0.5,",
  '1,2026-4분기,2026-10,2026-10-19,#REF!,양승원,a,"여러 줄,\n쉼표 ""댓글""",https://x,TRUE,1,CS',
  "2,2026-4분기,2026-10,2026-10-25,#REF!,양승원,a,짧은,https://x,TRUE,0.5,CS",
  "3,2026-4분기,2026-10,2026-10-26,#REF!,홍길동,b,짧은,https://x,TRUE,0.5,IT",
  "4,2026-4분기,2026-09,2026-09-30,#REF!,홍길동,b,짧은,https://x,TRUE,1,IT",
  "5,x,x,깨진날짜,#REF!,홍길동,b,짧은,https://x,TRUE,1,IT",
].join("\r\n");

describe("blogSheet", () => {
  const rows = parseBlogCsv(csv);
  it("여러 줄 댓글을 한 행으로, 예시·깨진 날짜 행은 제외", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ seq: "1", name: "양승원", date: "2026-10-19", points: 1, dept: "CS" });
  });
  it("주(월~일)·달 경계", () => {
    const p = blogPeriods("2026-10-22"); // 목
    expect(p.week).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(p.month).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(blogPeriods("2026-10-25").week.from).toBe("2026-10-19"); // 일요일
    expect(countBlog(rows, { ...p.week }).count).toBe(2); // 10-26(다음 주)·9월 제외
    expect(countBlog(rows, { ...p.month }).count).toBe(3);
  });
  it("사람별·부서별 집계", () => {
    const r = countBlog(rows, { from: "2026-10-01", to: "2026-10-31" });
    expect(r.people).toBe(2);
    expect(r.points).toBe(2);
    expect(r.byPerson[0]).toMatchObject({ name: "양승원", count: 2, points: 1.5 });
    expect(countBlog(rows, { from: "2026-01-01", to: "2026-12-31", person: "홍길동" }).count).toBe(2);
    expect(countBlog(rows, { from: "2026-01-01", to: "2026-12-31", dept: "IT" }).count).toBe(2);
  });
  it("팀 매핑: CS 계열은 명단 팀, 없으면 부서명", () => {
    const m = new Map([["양승원", "B"]]);
    expect(blogTeamOf({ name: "양승원", dept: "CS_S", count: 1, points: 1 }, m)).toBe("B");
    expect(blogTeamOf({ name: "홍길동", dept: "CS", count: 1, points: 1 }, m)).toBe("CS");
    expect(blogTeamOf({ name: "홍길동", dept: "IT", count: 1, points: 1 }, m)).toBe("IT");
  });
});

describe("blogSheet 조회 용량(gviz 필요 열만)", () => {
  // gviz out:csv 는 같은 시트를 select A,D,F,K,L 로 받은 모양 — 모든 칸이 따옴표, 숫자 칸의 "예시"는 빈 칸
  const slim = [
    '"순번","등록일","참여자성함","포인트(0.5/1)","부서명"',
    '"","2025-12-01","김예지","0.5",""',
    '"1","2026-10-19","양승원","1","CS"',
    '"2","2026-10-25","양승원","0.5","CS"',
    '"3","2026-10-26","홍길동","0.5","IT"',
    '"4","2026-09-30","홍길동","1","IT"',
    '"5","깨진날짜","홍길동","1","IT"',
  ].join("\r\n");
  it("전체 CSV 와 같은 행·같은 셈", () => {
    const full = parseBlogCsv(csv);
    const small = parseBlogCsv(slim);
    expect(small).toEqual(full);
    const f = { from: "2026-10-01", to: "2026-10-31" };
    expect(countBlog(small, f)).toEqual(countBlog(full, f));
  });
  it("주소는 필요한 열만 고르고, 15분 안이면 캐시 유효", () => {
    expect(decodeURIComponent(blogGvizUrl())).toContain("tq=select A,D,F,K,L");
    expect(blogGvizUrl()).toContain("tqx=out:csv");
    expect(BLOG_CACHE_MS).toBe(900000);
    expect(blogCacheFresh(null, 1000)).toBe(false);
    expect(blogCacheFresh(1000, 1000 + 14 * 60000)).toBe(true);
    expect(blogCacheFresh(1000, 1000 + 15 * 60000)).toBe(false);
    expect(blogCacheFresh(5000, 1000)).toBe(false);
  });
});
