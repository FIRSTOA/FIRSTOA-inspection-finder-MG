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

describe("접수내용 추출 — 스페이스 구분 양식 (신도아톰파이브 실사고)", () => {
  const SPACE_FORM = [
    "A/S       x4250lx   신도아톰파이브   종료일       지역      접수일   8. 24",
    "기번      자산번호                     ",
    "기종   x4250lx   기기상태                     ",
    "제목    K현상기 고장문구                        ",
    "상태    오전 방문요청                        ",
  ].join("\n");

  it("'제목' 뒤가 탭이 아니라 스페이스 여러 개여도 잡는다", () => {
    expect(extractIssue("", SPACE_FORM)).toBe("K현상기 고장문구");
  });

  it("스페이스 1개짜리 일반 문장('내용 좀 봐줘요')은 양식으로 오인하지 않는다", () => {
    expect(extractIssue("", "내용 좀 봐줘요 이건 그냥 메모")).toBe("");
  });
});

import { extractCategory } from "../src/reportAssignee";

describe("접수 구분 추출 — 방문 목적이 줄에서 빠지면 안 되는 것들", () => {
  it("미수방문 (이지스 실사고 — 이름 접두 뒤 구분)", () => {
    expect(extractCategory("미수방문\t N\tSL-X3280NR\t5N이지스-단순마감마감", "양승원 미수방문    N   SL-X3280NR   5N이지스-단순마감마감", "양승원")).toBe("미수방문");
  });

  it("여분요청·기기교체/사양변경", () => {
    expect(extractCategory("여분요청\t V\tSL-X7500LX\t12#V주식회사 디쉐어", "", "")).toBe("여분요청");
    expect(extractCategory("S\t 기기교체/사양변경\tApeosPort-C2060", "윤기준 - S\t 기기교체/사양변경\tApeosPort-C2060", "윤기준")).toBe("");
  });

  it("A/S·점검요청·일반 제목은 뽑지 않는다", () => {
    expect(extractCategory("A/S\t N\tSL-K3250NR\t7N김경식세무회계사무소", "", "")).toBe("");
    expect(extractCategory("점검요청\t SS\tSL-X3220NR\t공간코리아", "", "")).toBe("");
    expect(extractCategory("2차체크/효성산업", "심태현 2차체크/효성산업", "심태현")).toBe("");
  });
});

describe("접수내용 추출 — 빈 칸이 다음 필드명을 물지 않는다", () => {
  it("'제목' 칸이 비어 '상태'가 값으로 잡히던 것 (에이스에스타워 실사고)", () => {
    expect(extractIssue("", "제목      상태    \n참고사항         ")).toBe("");
  });
});
