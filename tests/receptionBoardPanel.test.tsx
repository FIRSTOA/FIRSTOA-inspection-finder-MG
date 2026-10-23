// 현황판·홈 카드 감싸개: 행 변환, 이번 주 완료율·오늘 접수 수 조회, 서버 렌더
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ReceptionBoardPanel from "../src/ReceptionBoardPanel";
import { daysBefore, loadBoardData, loadScheduleOverdue, postponeOf, summarizeForHome, toBoardRows, weekStartOf, type ScheduleOverdueRow } from "../src/receptionBoardData";
import { parseRightView, unhandledTotal } from "../src/receptionRightView";
import HomeReceptionPanel from "../src/HomeReceptionPanel";
import type { OpenReceptionRow } from "../src/deptReceptionApi";

const base = { created_at: "2026-10-01T00:00:00Z", route: "", region: "A", grade: "", lease_no: "", title: "", symptom: "", sheet_row: null };
const openRows: OpenReceptionRow[] = [
  { ...base, id: "d1", receipt_date: "2026-10-05", author: "김수인", type: "영업팀", vendor: "가나상사", field: "해지문의", status: "접수", remote_meta: { handler: "박영업", schedule_date: "2026-10-10", postpone_count: "2" } },
  { ...base, id: "f1", receipt_date: "2026-10-18", author: "박민", type: "IT", vendor: "다라전자", field: "", title: "PC 느림", status: "진행중", remote_meta: { handler: "무시돼야함", schedule_date: "2026-10-01" } },
  { ...base, id: "r1", receipt_date: "2026-10-19", author: "이원격", type: "원격이관", vendor: "마바", status: "원격대기", remote_meta: null },
  { ...base, id: "x1", receipt_date: "2026-10-19", author: "?", type: "알수없음", vendor: "?", status: "접수" },
];
const weekRows = [
  { status: "완료", receipt_date: "2026-10-13" },
  { status: "접수", receipt_date: "2026-10-15" },
  { status: "취소", receipt_date: "2026-10-19" },
  { status: "진행중", receipt_date: "2026-10-19" },
];

function mockFetch() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    const body = String(url).includes("select=status,receipt_date") ? weekRows : openRows;
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("현황판 감싸개", () => {
  it("행 변환: 부서는 처리자·예정일·미룸 횟수, 현장은 빈값, 원격대기는 그대로, 모르는 종류 제외", () => {
    const rows = toBoardRows(openRows);
    expect(rows.map((r) => r.id)).toEqual(["d1", "f1", "r1"]);
    expect(rows[0]).toMatchObject({ handler: "박영업", scheduled_date: "2026-10-10", field: "해지문의", postponeCount: 2 });
    expect(rows[1]).toMatchObject({ handler: "", scheduled_date: null, field: "PC 느림", postponeCount: 0 });
    expect(rows[2].status).toBe("원격대기");
    expect(postponeOf("x")).toBe(0);
    expect(postponeOf(3)).toBe(3);
  });

  it("이번 주 시작은 월요일", () => {
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19"); // 월
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19"); // 일
    expect(weekStartOf("2026-10-21")).toBe("2026-10-19");
  });

  it("loadBoardData: 이번 주 조회 1회로 완료율·오늘 접수 수", async () => {
    const calls = mockFetch();
    const data = await loadBoardData("2026-10-19");
    const weekCall = calls.find((u) => u.includes("select=status,receipt_date"));
    expect(weekCall).toContain("receipt_date=gte.2026-10-19");
    expect(weekCall).toContain("deleted=eq.false");
    // 이번 주(10-19~) 접수 2건 중 취소 1건 = 완료 취급 → 50%
    expect(data.weekDoneRate).toBe(50);
    expect(data.todayCount).toBe(2);
    expect(data.rows).toHaveLength(3);
    expect(data.sources.d1.vendor).toBe("가나상사");
  });

  it("이번 주 접수가 없으면 완료율 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" }) as unknown as Response));
    const data = await loadBoardData("2026-10-19");
    expect(data.weekDoneRate).toBeNull();
    expect(data.todayCount).toBe(0);
  });

  it("홈 요약: 종류별 건수와 가장 오래된 건", () => {
    const s = summarizeForHome(toBoardRows(openRows), "2026-10-19");
    expect(s.counts["영업팀"]).toBe(1);
    expect(s.counts["복합기 AS"]).toBe(0);
    expect(s.oldest).toEqual({ vendor: "가나상사", type: "영업팀", days: 14 });
    expect(summarizeForHome([], "2026-10-19").oldest).toBeNull();
  });

  it("홈 요약: 경과 7일 이상 건수(over7)", () => {
    const rows = toBoardRows(openRows); // 10-05(14일)·10-18(1일)·10-19(0일)
    expect(summarizeForHome(rows, "2026-10-19").over7).toBe(1);
    expect(summarizeForHome(rows, "2026-10-25").over7).toBe(2); // 10-18 이 7일째
    expect(summarizeForHome([], "2026-10-19").over7).toBe(0);
  });

  it("loadScheduleOverdue: 물류 미처리 조건(오늘 이전·180일·완료 제외·물류·납품철수교체휴가교육만·3000건) + 업체명 정리", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => [{ id: 7, team: "B", date: "2026-10-10", time: "", vendor: "가나상사 (물류)", assignee: "", status: "접수", scheduleType: "물류" }], text: async () => "" } as unknown as Response;
    }));
    const rows = await loadScheduleOverdue("2026-10-19");
    expect(calls).toHaveLength(1);
    const u = calls[0];
    expect(u).toContain("/as_tickets?");
    expect(u).toContain("select=id,team,date,time,vendor,assignee,status,scheduleType");
    expect(u).toContain("date=lt.2026-10-19");
    expect(u).toContain(`date=gte.${daysBefore("2026-10-19", 180)}`);
    expect(daysBefore("2026-10-19", 180)).toBe("2026-04-22");
    expect(u).toContain(`status=neq.${encodeURIComponent("완료")}`);
    expect(u).toContain(`scheduleType=in.(${encodeURIComponent('"물류"')},${encodeURIComponent('"납품철수교체휴가교육"')})`);
    expect(u).not.toContain(encodeURIComponent("매월점검"));
    expect(u).toContain("order=date.desc,time.asc&limit=3000");
    expect(rows[0]).toMatchObject({ id: "7", team: "B", date: "2026-10-10", status: "접수", scheduleType: "물류" });
    expect(rows[0].time).toBeUndefined();
  });

  it("홈 요약 scheduleOverdue 와 전환 칸 N 합산", () => {
    const sched: ScheduleOverdueRow[] = [
      { id: "1", vendor: "a", scheduleType: "AS", team: "A", assignee: "", date: "2026-10-01", status: "접수" },
      { id: "2", vendor: "b", scheduleType: "물류", team: "C", assignee: "", date: "2026-10-18", status: "진행중" },
    ];
    const s = summarizeForHome(toBoardRows(openRows), "2026-10-19", sched);
    expect(s.scheduleOverdue).toBe(2);
    expect(summarizeForHome([], "2026-10-19").scheduleOverdue).toBe(0);
    // 접수 3건(영업팀·IT·원격) + 일정 2건; 지원 꺼지면 영업팀 1건 빠짐
    expect(unhandledTotal(s.counts, 2, true)).toBe(5);
    expect(unhandledTotal(s.counts, 2, false)).toBe(4);
    expect(unhandledTotal(null, 0, true)).toBe(0);
    expect(parseRightView("board")).toBe("board");
    expect(parseRightView(null)).toBe("list");
  });

  it("서버 렌더: 첫 화면은 불러오는 중", () => {
    expect(renderToString(createElement(ReceptionBoardPanel, {}))).toContain("불러오는 중");
    expect(renderToString(createElement(HomeReceptionPanel, { onOpen: () => {} }))).toContain("미처리 전체"); // 2026-10-24 홈 개편: 미처리 전체 합산 카드
  });
});
