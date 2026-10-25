// 현황판 CS 접수 칸 = 홈 미처리 CS 접수와 같은 줄(2026-10-25 밤 "홈에선 57 이고 서비스접수 쪽에선 26").
import { describe, expect, it } from "vitest";
import { countUnhandledKinds, mergeUnhandled, type ReceptionInput, type TicketInput } from "../src/homeUnhandled";
import { csTicketToBoardRow, replaceCopierWithTickets, type BoardRow } from "../src/receptionBoardData";

const TODAY = "2026-10-25";
const tk = (id: string, date: string, over: Partial<TicketInput> = {}): TicketInput => ({ id, team: "A", date, vendor: `업체${id}`, assignee: "", status: "예정", scheduleType: "AS", ...over });
const rc = (id: string, type: string, over: Partial<ReceptionInput> = {}): ReceptionInput => ({ id, receipt_date: "2026-10-01", type, vendor: `접수${id}`, region: "A", status: "접수", ...over });
const board = (id: string, type: BoardRow["type"], over: Partial<BoardRow> = {}): BoardRow => ({ id, type, vendor: id, field: "", author: "", handler: "", status: "접수", receipt_date: "2026-10-01", ...over });

describe("현황판 CS 접수 = 홈 CS 접수", () => {
  const tickets = [
    tk("1", "2026-10-20"), tk("2", "2026-10-24", { status: "진행중" }), tk("3", "2026-10-10", { status: "보류" }),
    tk("4", "2026-10-25"), // 오늘 — 미처리 아님
    tk("5", "2026-10-20", { status: "완료" }), // 완료 — 아님
    tk("6", "2026-10-20", { scheduleType: "매월점검" }), // 점검 — 아님
    tk("7", "2026-10-20", { scheduleType: "물류" }), // 물류 칸
  ];
  const receptions = [rc("a", "복합기 AS"), rc("b", "원격이관")];

  it("같은 입력이면 현황판 CS 접수 수 = 홈 CS 접수 수", () => {
    const home = mergeUnhandled(receptions, tickets, TODAY);
    const homeCs = countUnhandledKinds(home).CS접수;
    const rows = [board("a", "복합기 AS", { noTicket: true }), board("b", "원격이관"), board("c", "복합기 AS")];
    const out = replaceCopierWithTickets(rows, home);
    expect(out.rows.filter((r) => r.type === "복합기 AS").length).toBe(homeCs);
    expect(homeCs).toBe(3);
    // 원격은 그대로, 열린 복합기 접수는 빠지고 일정 없는 건만 안내 숫자로
    expect(out.rows.some((r) => r.id === "b")).toBe(true);
    expect(out.rows.some((r) => r.id === "a" || r.id === "c")).toBe(false);
    expect(out.copierOpen).toBe(1);
  });

  it("일정 줄 → 카드: id 는 미처리 key, 상태는 틀이 그리는 값으로, 예정일 없음", () => {
    const [u] = mergeUnhandled([], [tk("9", "2026-10-20", { status: "예정", assignee: "김철수" })], TODAY);
    const b = csTicketToBoardRow(u);
    expect(b.id).toBe("t:9");
    expect(b.type).toBe("복합기 AS");
    expect(b.status).toBe("접수");
    expect(b.handler).toBe("김철수");
    expect(b.scheduled_date).toBeNull();
    expect(csTicketToBoardRow({ ...u, status: "보류" }).status).toBe("보류");
  });

  it("시트에서 온 복합기 줄(있다면)은 건드리지 않는다", () => {
    const sheetRow = board("sheet:remote:3", "복합기 AS", { sheet: { source: "remote", sheetRow: 3, seq: "", state: "", summary: "", region: "", url: "", linked: false } });
    expect(replaceCopierWithTickets([sheetRow], []).rows).toHaveLength(1);
  });
});
