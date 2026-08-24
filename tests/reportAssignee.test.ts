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

import { extractIssue } from "../src/reportAssignee";

describe("접수내용 추출 — issue 칸이 비면 note의 접수양식에서", () => {
  const LEASE_FORM = [
    "A/S\t N\tSL-K3250NR\t7N김경식세무회계사무소-분기마감\t종료일\t27. 3. 25",
    "기번\t0A6VBJMT6000G5Y\t자산번호\tX9239",
    "기본임대료\t₩55,000\t평균임대료\t₩ 57,000",
    '일반전화\t"T:02-2647-0750',
    'F:02-2647-0753"',
    "기종\tSL-K3250NR\t기기상태\t중고기",
    "제목\t 용지 씹힘",
    "상태\t 용지 씹힘",
    "참고사항\t",
  ].join("\n");

  it("임대리스트 양식의 '제목' 줄을 찾는다 (김경식 실사고 — '분기마감'이 아니라 '용지 씹힘')", () => {
    expect(extractIssue("", LEASE_FORM)).toBe("용지 씹힘");
  });

  it("FIELD 양식의 '내용:' 줄을 찾는다", () => {
    expect(extractIssue(undefined, "모델명: ApeosPort-3060\n내용: 글자체가 겹쳐서 출력이 됩니다.\n처리내용: 드럼 교환")).toBe("글자체가 겹쳐서 출력이 됩니다.");
  });

  it("issue 칸이 있으면 그게 우선", () => {
    expect(extractIssue("검은줄 묻어나옴", LEASE_FORM)).toBe("검은줄 묻어나옴");
  });

  it("'접수내용'이 '내용'보다 우선하고, 빈 값·대시는 건너뛴다", () => {
    expect(extractIssue("", "접수내용\t용지걸림 반복\n내용\t기타")).toBe("용지걸림 반복");
    expect(extractIssue("", "제목\t-\n상태\t 소음 발생")).toBe("소음 발생");
  });

  it("아무 데도 없으면 빈값", () => {
    expect(extractIssue("", "기번\t0A6VBJ\n주소\t서울 양천구")).toBe("");
  });
});
