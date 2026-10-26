/**
 * 자동 일정 등록 — 그 달 같은 업체의 열린 매월점검 일정 처리(2026-10-26 재발 방지).
 * 실사례: 10/27 등록에서 「주식회사 휴메이크 짐석촌점전 위메이크홀딩스, 주식회사 휴메이크」·권's독한과학학원은
 * 10/22 자동일정(미방문·'배정')이 막아 건너뜀 → 그 행은 일정리스트·홈 미처리 어디에도 안 보여 사용자가 풀 방법이 없었다.
 * 이제 지난 날짜 열린 행은 고른 날짜로 옮기고, 오늘·미래 행(비에이컴퍼니 10/27, 1분 전 생성)만 건너뛴다.
 */
import { describe, expect, it, vi } from "vitest";
import { indexOpenChecks, markPlanned, moveNotice, moveOpenCheck, planRegister, skipNotice, type OpenCheckTicket } from "../src/autoScheduleSkip";

const SEOKCHON = "주식회사 휴메이크 짐석촌점전 위메이크홀딩스, 주식회사 휴메이크";
const JAMSIL = "주식회사 휴메이크 짐잠실전 위메이크홀딩스, 주식회사 휴메이크";
const TODAY = "2026-10-26";

const rows: OpenCheckTicket[] = [
  { id: "as-1792578813110-4k7du", vendor: SEOKCHON, date: "2026-10-22", assignee: "한왕주", team: "C" },
  { id: "as-1792578813187-e134y", vendor: "권's독한과학학원", date: "2026-10-22", assignee: "한왕주", team: "C" },
  { id: "as-1793008126158-e5bkq", vendor: "주식회사 비에이컴퍼니", date: "2026-10-27", assignee: "한왕주", team: "C" },
  { id: "as-empty", vendor: "", date: "2026-10-05", assignee: "누구", team: "C" },
];

describe("등록 방식 판단", () => {
  it("지난 날짜 열린 행만 있으면 → 옮김(move)", () => {
    const plan = planRegister(SEOKCHON, indexOpenChecks(rows), TODAY);
    expect(plan).toEqual({ kind: "move", open: rows[0] });
  });
  it("오늘·미래 열린 행이 있으면 → 건너뜀(skip)", () => {
    expect(planRegister("주식회사 비에이컴퍼니", indexOpenChecks(rows), TODAY)).toEqual({ kind: "skip", open: rows[2] });
    const sameDay = indexOpenChecks([{ id: "x", vendor: "에스아이피홀딩스", date: TODAY, assignee: "한왕주" }]);
    expect(planRegister("에스아이피홀딩스", sameDay, TODAY).kind).toBe("skip");
  });
  it("지난 행과 미래 행이 같이 있으면 미래 행 기준으로 건너뜀(같은 달 두 번 만들지 않음)", () => {
    const both = indexOpenChecks([rows[0], { id: "f", vendor: SEOKCHON, date: "2026-10-29", assignee: "이민구" }]);
    expect(planRegister(SEOKCHON, both, TODAY)).toMatchObject({ kind: "skip", open: { id: "f" } });
  });
  it("둘 다 없으면 → 새로 만듦(new) — 휴메이크 다른 지점(잠실)·에스아이피홀딩스는 안 걸린다", () => {
    const index = indexOpenChecks(rows);
    expect(planRegister(JAMSIL, index, TODAY).kind).toBe("new");
    expect(planRegister("에스아이피홀딩스", index, TODAY).kind).toBe("new");
  });
  it("빈 업체명 일정은 색인하지 않는다", () => {
    expect(indexOpenChecks(rows).has("")).toBe(false);
  });
  it("옮기거나 만든 뒤엔 같은 등록 안의 같은 업체가 건너뛰어진다", () => {
    const index = indexOpenChecks(rows);
    markPlanned(index, SEOKCHON, { ...rows[0], date: "2026-10-27", assignee: "이민구" });
    expect(planRegister(SEOKCHON, index, TODAY)).toMatchObject({ kind: "skip", open: { id: rows[0].id, date: "2026-10-27" } });
  });
});

describe("옮김 = 같은 id 행 upsert(새 행 없음)", () => {
  it("as_tickets 에 id·date·assignee·team 만 보내고 on_conflict=id", async () => {
    const upsert = vi.fn(async () => undefined);
    const after = await moveOpenCheck(rows[0], { date: "2026-10-27", assignee: "이민구", team: "C" }, upsert);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [table, row, conflict] = upsert.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
    expect(table).toBe("as_tickets");
    expect(conflict).toBe("id");
    expect(row).toMatchObject({ id: "as-1792578813110-4k7du", date: "2026-10-27", assignee: "이민구", team: "C" });
    expect(Object.keys(row).sort()).toEqual(["assignee", "date", "id", "team", "updated_at"]); // 업체·주소·메모 칸은 건드리지 않는다
    expect(after).toMatchObject({ id: rows[0].id, date: "2026-10-27", assignee: "이민구" });
  });
});

describe("안내 문구", () => {
  it("옮김: 「업체」 10/22 미완료 일정을 10/27로 옮김(담당 한왕주→이민구)", () => {
    const text = moveNotice([{ name: SEOKCHON, from: rows[0], date: "2026-10-27", assignee: "이민구" }]);
    expect(text).toContain(`「${SEOKCHON}」 10/22 미완료 일정을 10/27로 옮김(담당 한왕주→이민구)`);
    expect(moveNotice([{ name: "권's독한과학학원", from: rows[1], date: "2026-10-27", assignee: "한왕주" }])).toContain("(담당 한왕주)");
  });
  it("건너뜀: 「」로 감싸고 날짜·담당을 알려준다", () => {
    const text = skipNotice([{ name: "주식회사 비에이컴퍼니", open: rows[2] }], TODAY);
    expect(text).toContain("「주식회사 비에이컴퍼니」 이미 10/27 한왕주 점검 일정 있음(예정)");
    expect(skipNotice([], TODAY)).toBe("");
    expect(moveNotice([])).toBe("");
  });
});
