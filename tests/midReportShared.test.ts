// 자동 중간보고(2026-10-31): 순수부를 _shared 로 옮기고 src 는 다시 내보낸다 — 같은 함수·KST 고정·변동 해시·엣지 진입 함수
import { describe, expect, it } from "vitest";
import * as srcAssignees from "../src/assignees";
import * as srcReportAssignee from "../src/reportAssignee";
import * as srcIds from "../src/ids";
import * as srcPlanDate from "../src/planDate";
import { AUTHOR_TEAMS } from "../src/authors";
import * as assignees from "../supabase/functions/_shared/report/assignees.ts";
import * as rules from "../supabase/functions/_shared/report/assignee-rules.ts";
import * as vendorCore from "../supabase/functions/_shared/vendor-core.ts";
import * as holidays from "../supabase/functions/_shared/kr-holidays.ts";
import { BOOK_TEAMS, reportOrderFromMembers } from "../supabase/functions/_shared/report/team-order.ts";
import {
  buildMidReportPlan, buildMidReportText, midReportDraftHash, midReportPlanFor, midReportStamp, toReportTicket,
} from "../supabase/functions/_shared/report/mid-report.ts";
import { parsePolishOutput, sanitizePolishLines } from "../supabase/functions/_shared/report/polish.ts";
import { MEMBERS_1030, TICKETS_1030 } from "./fixtures/midReportC1030";

describe("재수출 패리티 — src 와 _shared 는 같은 함수", () => {
  it("assignees·reportAssignee·ids·planDate", () => {
    for (const name of ["parseAssignees", "joinAssignees", "hasAssignee", "formatAssignees", "titleAssigneeLabel", "primaryAssignee", "addedAssignees", "MAX_ASSIGNEES"]) {
      expect((srcAssignees as Record<string, unknown>)[name], name).toBe((assignees as Record<string, unknown>)[name]);
    }
    for (const name of ["escapeRegExp", "reportHeadOf", "matchReportAssignees", "matchReportAssignee", "groupReportTickets", "hasReportMember", "extractIssue", "extractCategory"]) {
      expect((srcReportAssignee as Record<string, unknown>)[name], name).toBe((rules as Record<string, unknown>)[name]);
    }
    expect(srcIds.historyCoreName).toBe(vendorCore.historyCoreName);
    expect(srcIds.workinVendorName).toBe(vendorCore.workinVendorName);
    expect(srcPlanDate.nextBusinessDay).toBe(holidays.nextBusinessDay);
    expect(srcPlanDate.isBusinessDay).toBe(holidays.isBusinessDay);
    expect(srcPlanDate.KR_HOLIDAYS).toBe(holidays.KR_HOLIDAYS);
  });
  it("명단 칸은 authors.ts AUTHOR_TEAMS 와 같다", () => {
    expect([...BOOK_TEAMS]).toEqual(AUTHOR_TEAMS);
  });
});

describe("KST 날짜·영업일 — 실행 환경 시간대(UTC 서버)에 기대지 않는다", () => {
  it("kstNow: UTC 순간 → KST 날짜·시·분", () => {
    expect(holidays.kstNow(new Date("2026-10-30T03:00:05Z"))).toEqual({ ymd: "2026-10-30", hh: "12", mm: "00" });
    expect(holidays.kstNow(new Date("2026-10-30T05:00:00Z"))).toEqual({ ymd: "2026-10-30", hh: "14", mm: "00" });
    // 아침 9시 전(UTC 자정 전후) — toISOString 이면 전날로 틀리는 구간
    expect(holidays.kstNow(new Date("2026-10-29T15:30:00Z"))).toEqual({ ymd: "2026-10-30", hh: "00", mm: "30" });
    expect(holidays.kstNow(new Date("2026-10-29T14:59:00Z"))).toEqual({ ymd: "2026-10-29", hh: "23", mm: "59" });
  });
  it("nextBusinessDay: 주말·공휴일·연휴·해 넘김", () => {
    expect(holidays.nextBusinessDay("2026-10-30")).toBe("2026-11-02");
    expect(holidays.nextBusinessDay("2026-09-23")).toBe("2026-09-28");   // 추석 24~26 + 일요일
    expect(holidays.nextBusinessDay("2026-12-31")).toBe("2027-01-04");   // 신정(금) + 주말
    expect(holidays.nextBusinessDay("2026-10-02")).toBe("2026-10-06");   // 개천절 대체(10/5)
    expect(holidays.isBusinessDay("2026-10-31")).toBe(false);
    expect(holidays.isBusinessDay("2026-10-09")).toBe(false);
    expect(holidays.isBusinessDay("2026-10-30")).toBe(true);
  });
  it("nextBusinessDay 는 1년 내내 '다음 날부터 첫 영업일'과 같다(요일 계산이 시간대와 무관)", () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    for (let i = 0; i < 365; i += 1) {
      const ymd = d.toISOString().slice(0, 10);
      const probe = new Date(d);
      let expected = "";
      do { probe.setUTCDate(probe.getUTCDate() + 1); expected = probe.toISOString().slice(0, 10); }
      while ([0, 6].includes(probe.getUTCDay()) || holidays.KR_HOLIDAYS.has(expected));
      expect(holidays.nextBusinessDay(ymd), ymd).toBe(expected);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  });
});

describe("엣지 진입 함수 buildMidReportText", () => {
  const nowKst = holidays.kstNow(new Date("2026-10-30T03:00:05Z")); // 크론 12:00:05 KST
  it("차수 12 → 머리 '12:00', 오늘·익일은 KST 기준(금 → 월)", () => {
    const text = buildMidReportText({ tickets: TICKETS_1030, members: MEMBERS_1030, nowKst, team: "C", slot: "12" });
    expect(text.split("\n")[0]).toBe("12:00 중간보고");
    expect(text).toContain("•법무법인 X3280NR 팩스 수신 안됨");      // 11/2(월) 건이 익일일정에
    expect(text).toContain("→ 11/4");
    expect(text).not.toContain("특이사항");
  });
  it("화면 계획과 같은 글(명단·순서·날짜를 엣지가 스스로 계산)", () => {
    const order = reportOrderFromMembers("C", MEMBERS_1030);
    const screen = buildMidReportPlan({ tickets: TICKETS_1030, team: "C", order, todayYmd: "2026-10-30", tomorrowYmd: "2026-11-02", stamp: "14:00" });
    expect(buildMidReportText({ tickets: TICKETS_1030, members: MEMBERS_1030, nowKst, team: "C", slot: "14" })).toBe(screen.draft);
  });
  it("차수 now → 지금 KST 시각", () => {
    expect(midReportStamp("now", { ymd: "2026-10-30", hh: "10", mm: "07" })).toBe("10:07");
  });
  it("REST 행의 null 칸은 빈 글자로", () => {
    const row = { team: "C", date: "2026-10-30", status: "배정", scheduleType: "AS", source: null, vendor: "디아트치과", calendarTitle: null, note: null, issue: "토너", model: null, assignee: "이홍진" };
    expect(toReportTicket(row)).toMatchObject({ source: "", calendarTitle: "", note: "", model: "" });
    const text = buildMidReportText({ tickets: [row], members: MEMBERS_1030, nowKst, team: "C", slot: "12" });
    expect(text).toContain("#이홍진\n•디아트치과 토너");
  });
  it("오늘 대상 0건이면 eligibleTodayCount 0(자동 발송 'empty'), 전부 완료면 0 아님", () => {
    expect(midReportPlanFor({ tickets: [], members: MEMBERS_1030, nowKst, team: "C", slot: "12" }).eligibleTodayCount).toBe(0);
    const done = TICKETS_1030.map((t) => ({ ...t, status: "완료" }));
    const plan = midReportPlanFor({ tickets: done, members: MEMBERS_1030, nowKst, team: "C", slot: "12" });
    expect(plan.eligibleTodayCount).toBeGreaterThan(0);
    expect(plan.pending).toHaveLength(0);
  });
});

describe("draftHash — 머리 시각만 다르면 같고, 일정이 바뀌면 다르다", () => {
  const order = reportOrderFromMembers("C", MEMBERS_1030);
  const base = { team: "C", order, todayYmd: "2026-10-30", tomorrowYmd: "2026-11-02" };
  it("12:00 과 14:00 초안 해시가 같다", () => {
    const a = buildMidReportPlan({ ...base, tickets: TICKETS_1030, stamp: "12:00" });
    const b = buildMidReportPlan({ ...base, tickets: TICKETS_1030, stamp: "14:00" });
    expect(a.draft).not.toBe(b.draft);
    expect(a.draftHash).toBe(b.draftHash);
    expect(a.draftHash).toMatch(/^[0-9a-f]{8}$/);
  });
  it("한 건 완료 처리 → 해시가 바뀐다", () => {
    const a = buildMidReportPlan({ ...base, tickets: TICKETS_1030, stamp: "12:00" });
    const changed = TICKETS_1030.map((t) => (t.id === "t01" ? { ...t, status: "완료" } : t));
    const b = buildMidReportPlan({ ...base, tickets: changed, stamp: "14:00" });
    expect(b.draftHash).not.toBe(a.draftHash);
    expect(midReportDraftHash(a.draft)).toBe(a.draftHash);
  });
});

describe("AI 조립 검증 — 실패면 null(→ 초안)", () => {
  const plan = buildMidReportPlan({ tickets: TICKETS_1030, team: "C", order: reportOrderFromMembers("C", MEMBERS_1030), todayYmd: "2026-10-30", tomorrowYmd: "2026-11-02", stamp: "12:00" });
  it("개수 불일치·빈 줄·배열 아님", () => {
    expect(plan.assemble(["a"])).toBeNull();
    expect(plan.assemble(plan.payload.map((_, i) => (i === 2 ? "  " : "x")))).toBeNull();
    expect(plan.assemble(undefined)).toBeNull();
    expect(plan.assemble(plan.payload.map(() => "x"))).toContain("#이홍진\n•x");
  });
});

describe("polish.ts 입력·출력 정리(report-polish 와 같은 규칙)", () => {
  it("40줄까지·길이 자르기·kind 정규화", () => {
    const out = sanitizePolishLines(Array.from({ length: 45 }, (_, i) => ({ vendor: "v".repeat(300), kind: i ? "as" : "물류" })));
    expect(out).toHaveLength(40);
    expect(out[0]).toMatchObject({ kind: "물류", title: "" });
    expect(out[0].vendor).toHaveLength(200);
    expect(sanitizePolishLines("x")).toEqual([]);
  });
  it("응답에서 머리 기호를 떼고 60자", () => {
    expect(parsePolishOutput({ output_text: JSON.stringify({ lines: ["• 알스퀘어 3220 소음", "-x".padEnd(80, "y")] }) }))
      .toEqual(["알스퀘어 3220 소음", "x".padEnd(60, "y")]);
    expect(parsePolishOutput({ output: [{ content: [{ text: "{\"lines\":[\"a\"]}" }] }] })).toEqual(["a"]);
  });
});

describe("보고 한 줄 — 업체 칸 첫 토막이 담당자 이름뿐일 때(2026-10-31 dryRun '• → 11/6')", () => {
  it("다음 토막으로 넘어가고 전화번호 토막은 쓰지 않는다", async () => {
    const { reportLineOf } = await import("../supabase/functions/_shared/report/mid-report.ts");
    const line = reportLineOf(toReportTicket({
      team: "C", date: "2026-11-06", status: "익일", scheduleType: "익일AS", source: "naver", assignee: "신정훈",
      vendor: "신정훈 / 계약갱신제안 2차체크 / SS/ C / 손나래영어학원 / 이다연 010-6669-0973",
      calendarTitle: "신정훈 / 계약갱신제안 2차체크 / SS/ C / 손나래영어학원 / 이다연 010-6669-0973", note: "", issue: "", model: "",
    }), ["이민구", "신정훈"]);
    expect(line).toMatch(/^•\S/);
    expect(line).toContain("계약갱신제안");
    expect(line).not.toMatch(/010-\d{4}-\d{4}/);
  });
});

describe("연기 꼬리 범위 — 이번 달 또는 7일 안(2026-10-31 사용자: 다음 달 건은 그 달에)", () => {
  it("inDeferredWindow", async () => {
    const { inDeferredWindow } = await import("../supabase/functions/_shared/report/mid-report.ts");
    expect(inDeferredWindow("2026-10-28", "2026-10-15")).toBe(true);   // 같은 달
    expect(inDeferredWindow("2026-11-04", "2026-10-30")).toBe(true);   // 다음 달이지만 5일 안
    expect(inDeferredWindow("2026-11-20", "2026-10-30")).toBe(false);  // 다음 달·3주 뒤
    expect(inDeferredWindow("2027-02-02", "2026-10-31")).toBe(false);  // 산모피아 실측(일부러 미룬 건)
    expect(inDeferredWindow("2026-11-20", "2026-11-02")).toBe(true);   // 그 달이 되면 뜬다
  });
  it("계획: 3주 뒤로 미룬 건은 꼬리에서 빠지고, 같은 달 건은 남는다", () => {
    const base = { team: "C", status: "익일", scheduleType: "익일AS", source: "", assignee: "이민구", calendarTitle: "", model: "", issue: "소음" };
    const plan = buildMidReportPlan({
      tickets: [
        toReportTicket({ ...base, date: "2026-11-20", vendor: "멀리상사", note: "(11/20로 연기)" }),
        toReportTicket({ ...base, date: "2026-10-29", vendor: "가까운상사", note: "(10/29로 연기)" }),
      ],
      team: "C", order: ["이민구"], todayYmd: "2026-10-27", tomorrowYmd: "2026-10-28", stamp: "12:00",
    });
    expect(plan.draft).toContain("가까운상사");
    expect(plan.draft).not.toContain("멀리상사");
  });
});
