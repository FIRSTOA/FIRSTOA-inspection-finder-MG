import { describe, expect, it } from "vitest";
import { countUnhandledTabs, filterUnhandled, mergeUnhandled, receptionTeam, rowsForTab, type ReceptionInput, type TicketInput } from "../src/homeUnhandled";

const today = "2026-10-19";
const rec = (id: string, type: string, region: string, date: string, handler = ""): ReceptionInput => ({
  id, type, region, receipt_date: date, vendor: `업체${id}`, status: "접수", remote_meta: handler ? { handler } : null,
});
const tic = (id: string, scheduleType: string, team: string, date: string, receptionId = ""): TicketInput => ({
  id, scheduleType, team, date, vendor: `일정${id}`, assignee: "", status: "배정", receptionId,
});

const receptions = [
  rec("r1", "복합기 AS", "수도권A", "2026-10-10"),
  rec("r2", "원격이관", "강원도", "2026-10-15"),
  rec("r3", "경영지원", "수도권B", "2026-10-12", "이윤아"),
  rec("r4", "영업팀", "", "2026-10-18"),
];
const tickets = [
  tic("t1", "AS", "A", "2026-10-11", "r1"),       // 열린 접수 r1 과 중복 → 제외
  tic("t2", "AS", "C", "2026-10-05", "gone"),     // 접수가 닫혔거나 90일 밖 → AS일정
  tic("t3", "AS", "D", "2026-10-16"),             // 접수 연결 없음 → AS일정
  tic("t4", "납품철수교체휴가교육", "B", "2026-10-01", "r3"), // 물류는 연결 있어도 포함
  tic("t5", "물류", "E", "2026-10-17"),
];

describe("홈 미처리 토탈", () => {
  const rows = mergeUnhandled(receptions, tickets, today);

  it("AS 일정은 열린 접수와 겹치면 빼고, 아니면 AS일정으로 넣는다", () => {
    expect(rows.find((r) => r.key === "t:t1")).toBeUndefined();
    expect(rows.find((r) => r.key === "t:t2")?.kind).toBe("AS일정");
    expect(rows.find((r) => r.key === "t:t3")?.kind).toBe("AS일정");
    expect(rows.filter((r) => r.source === "reception")).toHaveLength(4);
    expect(rows).toHaveLength(8);
  });

  it("물류(납품철수교체휴가교육·물류)는 전부 들어가고 팀은 일정 팀", () => {
    const logi = rows.filter((r) => r.kind === "물류");
    expect(logi.map((r) => r.key).sort()).toEqual(["t:t4", "t:t5"]);
    expect(logi.find((r) => r.key === "t:t4")?.team).toBe("B");
  });

  it("팀·부서 매핑과 담당, 오래된 순", () => {
    expect(receptionTeam("복합기 AS", "수도권A")).toBe("A");
    expect(receptionTeam("원격이관", "강원도")).toBe("E");
    expect(receptionTeam("IT", "")).toBe("");
    expect(receptionTeam("경영지원", "수도권B")).toBe("경영");
    expect(receptionTeam("운영지원", "수도권C")).toBe("운영");
    expect(receptionTeam("영업팀", "")).toBe("영업");
    const r3 = rows.find((r) => r.key === "r:r3");
    expect(r3?.assignee).toBe("이윤아");
    expect(r3?.ageDays).toBe(7);
    expect(rows[0].key).toBe("t:t4");
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
  });

  it("필터와 탭별 건수", () => {
    const c = countUnhandledTabs(rows);
    expect(c["전체"]).toBe(8);
    expect(c.A).toBe(1);
    expect(c.B).toBe(1);
    expect(c.C).toBe(1);
    expect(c.D).toBe(1);
    expect(c.E).toBe(2);
    expect(c["경영"]).toBe(1);
    expect(c["운영"]).toBe(0);
    expect(c["영업"]).toBe(1);
    expect(c["물류"]).toBe(2);
    expect(filterUnhandled(rows, "E", "물류").map((r) => r.key)).toEqual(["t:t5"]);
    expect(rowsForTab(rows, "물류")).toHaveLength(2);
  });
});
