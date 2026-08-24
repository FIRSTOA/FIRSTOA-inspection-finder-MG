/**
 * 중간보고 담당자 판정 회귀 테스트.
 * 배경: 컴포넌트 안 정규식의 \\s가 편집을 거치며 \s로 깎여 "이름매칭 0건" —
 * A팀 보고가 통째로 "없음"이 된 실사고(2026-08-25 새벽). 케이스는 그날 DB의 실제 제목이다.
 */
import { describe, expect, it } from "vitest";
import { matchReportAssignee } from "../src/reportAssignee";

const ORDER = ["신정훈", "손영근", "김정민", "심태현", "정웅", "이권선", "박옥주"];

describe("중간보고 담당자 판정", () => {
  it("배정 컬럼이 있으면 그게 원본", () => {
    expect(matchReportAssignee({ assignee: "이홍진", vendor: "아무 제목" }, ORDER)).toBe("이홍진");
  });

  it("vendor 머리의 이름을 잡는다", () => {
    expect(matchReportAssignee({ vendor: "김정민 키프코우주항공 재계약 및 점검" }, ORDER)).toBe("김정민");
  });

  it("동기화가 이름을 calendarTitle에만 남긴 경우", () => {
    expect(matchReportAssignee({ vendor: "2차체크/효성산업", calendarTitle: "심태현 2차체크/효성산업" }, ORDER)).toBe("심태현");
  });

  it("'2차 김정민 …'처럼 접두어 뒤 이름도 잡는다", () => {
    expect(matchReportAssignee({ vendor: "키프코우주항공 재계약 및 점검", calendarTitle: "2차 김정민 키프코우주항공 재계약 및 점검" }, ORDER)).toBe("김정민");
  });

  it("보고양식 제목(탭 구분)도 머리 이름을 잡는다", () => {
    const title = "심태현 점검요청\t SS\tSL-X3220NR\t21SS주식회사 공간코리아굿모닝시티분기마감";
    expect(matchReportAssignee({ vendor: title.replace(/^심태현 /, ""), calendarTitle: title }, ORDER)).toBe("심태현");
  });

  it("명단 밖 이름·이름 없는 납품은 빈값 (물류 몫)", () => {
    expect(matchReportAssignee({ vendor: "납품(현장)/퍼스트/운영팀/증설/스트락스건축사사무소" }, ORDER)).toBe("");
    expect(matchReportAssignee({ vendor: "CSS ◆신동원 준비완료◆ IT/납품(일반)/퍼스트", calendarTitle: "CSS ◆신동원 준비완료◆ IT/납품(일반)/퍼스트" }, ORDER)).toBe("");
  });

  it("업체명 속 글자와는 안 섞인다 (부분일치 금지)", () => {
    expect(matchReportAssignee({ vendor: "정웅빌딩 점검" }, ORDER)).toBe("");
  });
});
