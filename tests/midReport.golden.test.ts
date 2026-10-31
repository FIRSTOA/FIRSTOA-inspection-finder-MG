/**
 * 중간보고 골든 — 2026-10-31 순수부를 _shared/report/mid-report.ts 로 옮기기 **전** CsAsWorkspace 의 buildMidReport·composeMidReport 가
 * 아래 픽스처로 낸 글을 글자 그대로 박아 두었다(LEGACY_*). 옮긴 뒤 화면과 엣지(schedule-report)가 이 글과 한 글자도 다르면 안 된다.
 * 사용자 결정(2026-10-31, 설계안 docs/tasks/schedule-report-auto-2026-10-31.md 맨 아래 Q2): "(진행중인 업무는 * 표시)" 줄과 "특이사항" 칸을 뺀다.
 *   → 제거 전 글(LEGACY) 그대로 1벌 + 그 두 군데만 뺀 글(stripManual) = 지금 글. 나머지 글자는 그대로여야 한다.
 */
import { describe, expect, it } from "vitest";
import { buildMidReportPlan } from "../supabase/functions/_shared/report/mid-report.ts";
import { bookFromMembers, leadersOf, reportOrderOf, teamAssigneesOf } from "../supabase/functions/_shared/report/team-order.ts";
import { nextBusinessDay } from "../supabase/functions/_shared/kr-holidays.ts";
import { MEMBERS_1030, TICKETS_1030, TICKETS_1008, detailStub } from "./fixtures/midReportC1030";

const ALL_DONE = TICKETS_1030.map((t) => ({ ...t, status: "완료" }));
const book = bookFromMembers(MEMBERS_1030);
const teamAssignees = teamAssigneesOf(book);
const orderC = reportOrderOf("C", teamAssignees, leadersOf(book));
const ai = (n: number) => Array.from({ length: n }, (_, i) => `AI${i + 1}`);

/** 사용자 결정으로 빠진 두 군데만 걷어낸다 — 머리 둘째 줄과 끝의 "구분선·특이사항" */
const stripManual = (text: string) => text
  .replace("\n(진행중인 업무는 * 표시)\n", "\n")
  .replace(/\n\n-------------------\n특이사항$/, "");

const LEGACY_TEAM_ASSIGNEES = {"A": ["이권선", "김정민", "지경민", "신정훈"], "B": ["조윤", "윤기준", "지경민", "신정훈"], "C": ["이홍진", "이민구", "박영현", "한왕주", "조윤", "지경민", "신정훈"], "D": ["김종희", "지경민", "신정훈"], "E": ["지경민", "신정훈"], "기타": []};
const LEGACY_ORDER_C = ["신정훈", "이홍진", "이민구", "박영현", "한왕주", "조윤", "지경민", "이권선", "김정민", "윤기준", "김종희"];
const LEGACY_ORDER_A = ["신정훈", "이권선", "김정민", "지경민", "조윤", "윤기준", "이홍진", "이민구", "박영현", "한왕주", "김종희"];
const LEGACY = {
  today1030: { draft: "12:00 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n#이홍진\n•알스퀘어디자인4층 X3220NR 용지제거했는데 엄청 큰 갈…\n\n#이민구\n•김경식세무회계사무소 C3375 ADF급지에서 스캔시 검정…\n\n#박영현\n•김경식세무회계사무소 C3375 ADF급지에서 스캔시 검정…\n•박영현 교체\n\n#한왕주\n•미수방문 미수방문 8월 내내 부재중\n\n#조윤\n•효성산업 CP 505d 급지 불량\n\n#지경민\n•코리아에셋 X7400LX 스캔 폴더 설정\n\n#김정민\n•퍼뮤니티 X3220NR 여분요청\n\n#미배정\n•디아트치과 헤라클래스 토너 교체 요청\n\n-------------------\n익일일정\n\n•법무법인 X3280NR 팩스 수신 안됨\n•이민구 납품\n•공간코리아굿모닝시티분기… X3220NR 소음 → 11/4\n\n-------------------\n특이사항", text: "12:00 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n#이홍진\n•AI1\n\n#이민구\n•AI2\n\n#박영현\n•AI3\n•AI4\n\n#한왕주\n•AI5\n\n#조윤\n•AI6\n\n#지경민\n•AI7\n\n#김정민\n•AI8\n\n#미배정\n•AI9\n\n-------------------\n익일일정\n\n•AI10\n•AI11\n•AI12 → 11/4\n\n-------------------\n특이사항", payload: [{"vendor": "30S주식회사 알스퀘어디자인4층 설계팀(가산빌딩)", "title": "", "note": "", "model": "SL-X3220NR", "issue": "용지제거했는데 엄청 큰 갈리는소음이난다고함", "category": "", "kind": "as"}, {"vendor": "7N김경식세무회계사무소-분기마감", "title": "", "note": "접수내용\t ADF급지에서 스캔시 검정으로 스캔 기타\t-", "model": "ApeosPort-V C3375", "issue": "ADF급지에서 스캔시 검정으로 스캔", "category": "", "kind": "as"}, {"vendor": "7N김경식세무회계사무소-분기마감", "title": "", "note": "접수내용\t ADF급지에서 스캔시 검정으로 스캔 기타\t-", "model": "ApeosPort-V C3375", "issue": "ADF급지에서 스캔시 검정으로 스캔", "category": "", "kind": "as"}, {"vendor": "포바이포", "title": "박영현-포바이포 9010→8730 교체", "note": "", "model": "", "issue": "", "category": "", "kind": "물류"}, {"vendor": "한왕주 - 미수방문 쇼군웨이크스노우보드", "title": "한왕주 - 미수방문 쇼군웨이크스노우보드", "note": "", "model": "", "issue": "8월 내내 부재중", "category": "미수방문", "kind": "as"}, {"vendor": "효성산업 A/S 요청/2차체크", "title": "", "note": "", "model": "DocuPrint-CP 505d", "issue": "급지 불량", "category": "", "kind": "as"}, {"vendor": "코리아에셋 본사", "title": "", "note": "", "model": "SL-X7400LX", "issue": "스캔 폴더 설정", "category": "", "kind": "as"}, {"vendor": "여분요청 N SL-X3220NR 14N주식회사 퍼뮤니티 역삼", "title": "", "note": "", "model": "SL-X3220NR", "issue": "", "category": "여분요청", "kind": "as"}, {"vendor": "디아트치과", "title": "", "note": "", "model": "DocuCentre-V 3065(헤라클래스)", "issue": "토너 교체 요청", "category": "", "kind": "as"}, {"vendor": "법무법인 수헌", "title": "", "note": "", "model": "SL-X3280NR", "issue": "팩스 수신 안됨", "category": "", "kind": "as"}, {"vendor": "블루닷", "title": "이민구-블루닷 노트북 3대 납품", "note": "", "model": "", "issue": "", "category": "", "kind": "물류"}, {"vendor": "21SS주식회사 공간코리아굿모닝시티분기마감", "title": "", "note": "(10/30 오전) (11/4로 연기)", "model": "SL-X3220NR", "issue": "소음", "category": "", "kind": "as"}], diag: null },
  next1030: { draft: "익일 스케줄\n\n#이민구\n•이민구 납품\n\n#미배정\n•법무법인 X3280NR 팩스 수신 안됨\n  접수자: 김담당 010-1234-5678\n  📍 서울 강남구 테헤란로 1\n•디아트치과 교체", text: "익일 스케줄\n\n#이민구\n•AI1\n\n#미배정\n•AI2\n  접수자: 김담당 010-1234-5678\n  📍 서울 강남구 테헤란로 1\n•AI3", payload: [{"vendor": "블루닷", "title": "이민구-블루닷 노트북 3대 납품", "note": "", "model": "", "issue": "", "category": "", "kind": "물류"}, {"vendor": "법무법인 수헌", "title": "", "note": "", "model": "SL-X3280NR", "issue": "팩스 수신 안됨", "category": "", "kind": "as"}, {"vendor": "디아트치과", "title": "디아트치과 9010→8730 교체", "note": "", "model": "", "issue": "", "category": "", "kind": "물류"}], diag: null },
  today1008: { draft: "14:00 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n#이홍진\n•넥스트라이프 X4220RX 카운터 확인\n\n-------------------\n익일일정\n\n•블루닷 토너\n\n-------------------\n특이사항", text: "14:00 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n#이홍진\n•AI1\n\n-------------------\n익일일정\n\n•AI2\n\n-------------------\n특이사항", payload: [{"vendor": "넥스트라이프본사", "title": "", "note": "", "model": "SL-X4220RX", "issue": "카운터 확인", "category": "", "kind": "as"}, {"vendor": "블루닷 주식회사(bluedot Inc.)", "title": "", "note": "", "model": "", "issue": "토너", "category": "", "kind": "as"}], diag: null },
  empty: { draft: "12:00 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n없음\n\n-------------------\n익일일정\n\n-------------------\n특이사항", text: "12:00 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n없음\n\n-------------------\n익일일정\n\n-------------------\n특이사항", payload: [], diag: "오늘 2026-10-30 · 전체 0건 → C팀 0건 → 이름매칭 0건 · 명단 신정훈·이홍진·이민구·박영현·한왕주·조윤·지경민·이권선·김정민·윤기준·김종희" },
  allDone: { draft: "12:07 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n없음\n\n-------------------\n익일일정\n\n-------------------\n특이사항", text: "12:07 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n없음\n\n-------------------\n익일일정\n\n-------------------\n특이사항", payload: [], diag: "오늘 2026-10-30 · 전체 0건 → C팀 0건 → 이름매칭 0건 · 명단 신정훈·이홍진·이민구·박영현·한왕주·조윤·지경민·이권선·김정민·윤기준·김종희" },
  todayA: { draft: "12:00 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n#이권선\n•A팀 점검\n\n-------------------\n익일일정\n\n-------------------\n특이사항", text: "12:00 중간보고\n(진행중인 업무는 * 표시)\n\n-------------------\n금일 처리예정\n\n#이권선\n•AI1\n\n-------------------\n익일일정\n\n-------------------\n특이사항", payload: [{"vendor": "A팀 업체", "title": "", "note": "", "model": "", "issue": "점검", "category": "", "kind": "as"}], diag: null },
} as const;

describe("중간보고 명단·순서 골든(옮기기 전 값)", () => {
  it("cs_members → 팀별 명단(겸직 B·C·CSS=E·IT파트·퇴사자 제외)", () => {
    expect(teamAssignees).toEqual(LEGACY_TEAM_ASSIGNEES);
  });
  it("보고 순서: 팀장 → 자기 팀 → CSS → 다른 팀 CS", () => {
    expect(orderC).toEqual(LEGACY_ORDER_C);
    expect(reportOrderOf("A", teamAssignees, leadersOf(book))).toEqual(LEGACY_ORDER_A);
  });
  it("금요일 → 월요일, 한글날·주말 건너뜀", () => {
    expect(nextBusinessDay("2026-10-30")).toBe("2026-11-02");
    expect(nextBusinessDay("2026-10-08")).toBe("2026-10-12");
  });
});

describe("중간보고 본문 골든", () => {
  const cases = [

    { key: "today1030" as const, tickets: TICKETS_1030, team: "C", today: "2026-10-30", day: "today" as const, stamp: "12:00" },
    { key: "next1030" as const, tickets: TICKETS_1030, team: "C", today: "2026-10-30", day: "next" as const, stamp: "12:00" },
    { key: "today1008" as const, tickets: TICKETS_1008, team: "C", today: "2026-10-08", day: "today" as const, stamp: "14:00" },
    { key: "empty" as const, tickets: [], team: "C", today: "2026-10-30", day: "today" as const, stamp: "12:00" },
    { key: "allDone" as const, tickets: ALL_DONE, team: "C", today: "2026-10-30", day: "today" as const, stamp: "12:07" },
    { key: "todayA" as const, tickets: TICKETS_1030, team: "A", today: "2026-10-30", day: "today" as const, stamp: "12:00" },
  ];
  for (const c of cases) {
    const order = c.team === "C" ? orderC : reportOrderOf("A", teamAssignees, leadersOf(book));
    const plan = buildMidReportPlan({ tickets: c.tickets, team: c.team, order, todayYmd: c.today, tomorrowYmd: nextBusinessDay(c.today), day: c.day, stamp: c.stamp, detailOf: detailStub });
    const legacy = LEGACY[c.key];
    it(`${c.key}: 초안 = 옛 글에서 두 군데만 뺀 글`, () => {
      expect(plan.draft).toBe(stripManual(legacy.draft));
    });
    it(`${c.key}: AI 재료(payload)·진단 줄은 옛 값 그대로`, () => {
      expect(plan.payload).toEqual(legacy.payload);
      expect(plan.diag ?? null).toBe(legacy.diag);
    });
    it(`${c.key}: AI 줄 조립 = 옛 조립에서 두 군데만 뺀 글`, () => {
      expect(plan.assemble(ai(plan.payload.length))).toBe(stripManual(legacy.text));
    });
  }

  it("제거 전 글(10/30 C팀 12:00) — 옛 모양 그대로 박제", () => {
    expect(LEGACY.today1030.draft).toBe([
      "12:00 중간보고",
      "(진행중인 업무는 * 표시)",
      "",
      "-------------------",
      "금일 처리예정",
      "",
      "#이홍진",
      "•알스퀘어디자인4층 X3220NR 용지제거했는데 엄청 큰 갈…",
      "",
      "#이민구",
      "•김경식세무회계사무소 C3375 ADF급지에서 스캔시 검정…",
      "",
      "#박영현",
      "•김경식세무회계사무소 C3375 ADF급지에서 스캔시 검정…",
      "•박영현 교체",
      "",
      "#한왕주",
      "•미수방문 미수방문 8월 내내 부재중",
      "",
      "#조윤",
      "•효성산업 CP 505d 급지 불량",
      "",
      "#지경민",
      "•코리아에셋 X7400LX 스캔 폴더 설정",
      "",
      "#김정민",
      "•퍼뮤니티 X3220NR 여분요청",
      "",
      "#미배정",
      "•디아트치과 헤라클래스 토너 교체 요청",
      "",
      "-------------------",
      "익일일정",
      "",
      "•법무법인 X3280NR 팩스 수신 안됨",
      "•이민구 납품",
      "•공간코리아굿모닝시티분기… X3220NR 소음 → 11/4",
      "",
      "-------------------",
      "특이사항",
    ].join("\n"));
  });

  it("제거 후 글(10/30 C팀 12:00) — 사용자 결정 2026-10-31: 진행중 줄·특이사항 칸 없음", () => {
    const plan = buildMidReportPlan({ tickets: TICKETS_1030, team: "C", order: orderC, todayYmd: "2026-10-30", tomorrowYmd: "2026-11-02", stamp: "12:00" });
    expect(plan.draft).toBe([
      "12:00 중간보고",
      "",
      "-------------------",
      "금일 처리예정",
      "",
      "#이홍진",
      "•알스퀘어디자인4층 X3220NR 용지제거했는데 엄청 큰 갈…",
      "",
      "#이민구",
      "•김경식세무회계사무소 C3375 ADF급지에서 스캔시 검정…",
      "",
      "#박영현",
      "•김경식세무회계사무소 C3375 ADF급지에서 스캔시 검정…",
      "•박영현 교체",
      "",
      "#한왕주",
      "•미수방문 미수방문 8월 내내 부재중",
      "",
      "#조윤",
      "•효성산업 CP 505d 급지 불량",
      "",
      "#지경민",
      "•코리아에셋 X7400LX 스캔 폴더 설정",
      "",
      "#김정민",
      "•퍼뮤니티 X3220NR 여분요청",
      "",
      "#미배정",
      "•디아트치과 헤라클래스 토너 교체 요청",
      "",
      "-------------------",
      "익일일정",
      "",
      "•법무법인 X3280NR 팩스 수신 안됨",
      "•이민구 납품",
      "•공간코리아굿모닝시티분기… X3220NR 소음 → 11/4",
    ].join("\n"));
    expect(plan.draft).not.toContain("진행중");
    expect(plan.draft).not.toContain("특이사항");
  });
});
