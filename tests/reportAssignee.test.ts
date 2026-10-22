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

describe("명단 이름의 정규식 특수문자", () => {
  it("괄호 든 이름('김광태(IT)')이 있어도 죽지 않고 정확히 잡는다", () => {
    const order = ["김광태(IT)", "심태현"];
    expect(matchReportAssignee({ vendor: "김광태(IT) - 서버실 점검" }, order)).toBe("김광태(IT)");
    expect(matchReportAssignee({ vendor: "심태현 점검요청", calendarTitle: "심태현 점검요청" }, order)).toBe("심태현");
  });
});

describe("접수내용 추출 — 빈 칸이 다음 줄 라벨을 물지 않는다", () => {
  it("값이 빈 '제목' 다음 줄의 '지역'을 접수내용으로 잡지 않는다", () => {
    expect(extractIssue("", "제목\t\n지역\t서울 양천구")).toBe("");
    expect(extractIssue("", "내용:\t\n접수자성함\t홍길동")).toBe("");
  });
});

import { escapeRegExp, groupReportTickets, hasReportMember, matchReportAssignees, reportHeadOf } from "../src/reportAssignee";

/**
 * 여러 명 배정(2026-10-22) 회귀 고정 — 2026-08-25 "팀 보고 통째로 없음" 사고와 같은 자리.
 * LEGACY_* 는 바꾸기 전 CsAsWorkspace 의 보고 생성 코드를 글자 그대로 옮긴 것이다.
 * 1명(또는 미배정)뿐인 일정에서는 새 묶음 함수로 만든 본문이 옛 본문과 한 글자도 다르면 안 된다.
 */
type T = { id: string; assignee?: string; vendor: string; calendarTitle?: string; logistics?: boolean };

function legacyAssignee(ticket: T, order: string[]): string {
  return ticket.assignee
    || order.find((name) => new RegExp(`^\\s*${escapeRegExp(name)}\\s*[-–—:\\s]`).test(ticket.vendor))
    || order.find((name) => new RegExp(`(?:^|[\\s/·])${escapeRegExp(name)}(?=[\\s\\-–—:/]|$)`).test((ticket.calendarTitle || "").slice(0, 14)))
    || "";
}
const lineOf = (t: T, head: string) => `•${head ? t.vendor.replace(new RegExp(`^\\s*${escapeRegExp(head)}\\s*[-–—:\\s]*`), "") : t.vendor}`;

function legacyReport(dayTickets: T[], order: string[], day: "today" | "next"): string {
  const assigneeOf = (t: T) => legacyAssignee(t, order);
  const todays = dayTickets.filter((t) => order.includes(assigneeOf(t)));
  const unassigned = dayTickets.filter((t) => !assigneeOf(t) && (day === "next" || !t.logistics));
  const groups: string[] = [];
  for (const name of order) {
    const mine = todays.filter((t) => assigneeOf(t) === name);
    if (mine.length) {
      if (groups.length) groups.push("");
      groups.push(`#${name}`, ...mine.map((t) => lineOf(t, assigneeOf(t))));
    }
  }
  if (unassigned.length) {
    if (groups.length) groups.push("");
    groups.push("#미배정", ...unassigned.map((t) => lineOf(t, assigneeOf(t))));
  }
  return (groups.length ? groups : ["없음"]).join("\n");
}

function newReport(dayTickets: T[], order: string[], day: "today" | "next"): string {
  const groups: string[] = [];
  for (const { name, tickets } of groupReportTickets(dayTickets, order, (t) => day === "next" || !t.logistics)) {
    if (groups.length) groups.push("");
    groups.push(`#${name}`, ...tickets.map((t) => lineOf(t, reportHeadOf(t, order))));
  }
  return (groups.length ? groups : ["없음"]).join("\n");
}

const ORDER2 = ["신정훈", "손영근", "김정민", "심태현", "정웅", "이권선", "박옥주"];
const SINGLE: T[] = [
  { id: "1", assignee: "김정민", vendor: "키프코우주항공 재계약 및 점검" },
  { id: "2", vendor: "김정민 효성산업 A/S" },
  { id: "3", vendor: "2차체크/효성산업", calendarTitle: "심태현 2차체크/효성산업" },
  { id: "4", assignee: "신정훈", vendor: "신정훈 - 서버실 점검" },
  { id: "5", vendor: "납품(현장)/퍼스트/운영팀/증설/스트락스건축사사무소", logistics: true },
  { id: "6", vendor: "용지걸림 정웅빌딩" },
  { id: "7", assignee: "물류기사", vendor: "토너 납품", logistics: true },
  { id: "8", assignee: "심태현", vendor: "공간코리아 점검요청" },
];

describe("중간보고 묶음 — 1명 일정은 옛 본문과 글자까지 같다", () => {
  it("금일(물류 미배정 제외)", () => {
    expect(newReport(SINGLE, ORDER2, "today")).toBe(legacyReport(SINGLE, ORDER2, "today"));
  });
  it("익일(미배정 물류 포함)", () => {
    expect(newReport(SINGLE, ORDER2, "next")).toBe(legacyReport(SINGLE, ORDER2, "next"));
  });
  it("빈 날은 '없음'", () => {
    expect(newReport([], ORDER2, "today")).toBe("없음");
  });
  it("옛 본문 그대로의 기대값(고정)", () => {
    expect(newReport(SINGLE, ORDER2, "today")).toBe([
      "#신정훈", "•서버실 점검", "",
      "#김정민", "•키프코우주항공 재계약 및 점검", "•효성산업 A/S", "",
      "#심태현", "•2차체크/효성산업", "•공간코리아 점검요청", "",
      "#미배정", "•용지걸림 정웅빌딩",
    ].join("\n"));
  });
});

describe("중간보고 묶음 — 여러 명", () => {
  const MULTI: T[] = [
    { id: "a", assignee: "김정민,심태현", vendor: "합동 납품 설치" },
    { id: "b", assignee: "외부기사,정웅", vendor: "외부 섞인 건" },
    { id: "c", assignee: "외부기사,물류", vendor: "명단 밖만" },
    { id: "d", assignee: "", vendor: "아무도 없음" },
  ];
  const groups = groupReportTickets(MULTI, ORDER2, () => true);
  it("2명 일정은 두 사람 묶음에 각각 한 줄, #미배정에 없다", () => {
    expect(groups.find((g) => g.name === "김정민")?.tickets.map((t) => t.id)).toEqual(["a"]);
    expect(groups.find((g) => g.name === "심태현")?.tickets.map((t) => t.id)).toEqual(["a"]);
    expect(groups.find((g) => g.name === "미배정")?.tickets.map((t) => t.id)).toEqual(["d"]);
  });
  it("명단 밖 + 명단 사람 혼합: 명단 사람 묶음에만 나오고 사라지지 않는다", () => {
    expect(groups.find((g) => g.name === "정웅")?.tickets.map((t) => t.id)).toEqual(["b"]);
  });
  it("명단 밖 사람만 걸린 건은 예전처럼 어디에도 안 들어간다(물류 몫)", () => {
    expect(groups.flatMap((g) => g.tickets).some((t) => t.id === "c")).toBe(false);
  });
  it("묶음 순서는 명단 순서", () => {
    expect(groups.map((g) => g.name)).toEqual(["김정민", "심태현", "정웅", "미배정"]);
  });
  it("matchReportAssignees·hasReportMember", () => {
    expect(matchReportAssignees({ assignee: "김정민,심태현", vendor: "" }, ORDER2)).toEqual(["김정민", "심태현"]);
    expect(matchReportAssignees({ vendor: "김정민 키프코" }, ORDER2)).toEqual(["김정민"]);
    expect(matchReportAssignees({ vendor: "정웅빌딩 점검" }, ORDER2)).toEqual([]);
    expect(hasReportMember({ assignee: "외부기사,정웅", vendor: "" }, ORDER2)).toBe(true);
    expect(hasReportMember({ assignee: "외부기사", vendor: "" }, ORDER2)).toBe(false);
  });
  it("호환 matchReportAssignee 는 대표(첫 사람), 줄 머리 떼기는 원문 그대로", () => {
    expect(matchReportAssignee({ assignee: "김정민,심태현", vendor: "" }, ORDER2)).toBe("김정민");
    expect(reportHeadOf({ assignee: "김정민,심태현", vendor: "" }, ORDER2)).toBe("김정민,심태현");
    expect(reportHeadOf({ assignee: "이홍진", vendor: "" }, ORDER2)).toBe("이홍진");
  });
});
