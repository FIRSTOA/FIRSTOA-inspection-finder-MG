// 부서 [일정리스트]·[달력]에 시트 접수 줄 + 오늘 완료 표시(2026-10-28, docs/tasks/dept-plan-sheet-rows-2026-10-28.md 6절).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, getConfig: vi.fn(), invokeEdgeFunction: vi.fn(), selectAllRows: vi.fn() };
});

import { getConfig, invokeEdgeFunction, selectAllRows } from "../src/supabase";
import {
  appDoneToday, deptSheetSource, doneTodayQuery, groupSheetByDate, hideLikeEvents, hideLinkedLike, kstDayOf, sheetPlanItems,
} from "../src/deptPlanSheet";
import { deptPlanBuckets, isPlanDone, planChipCount, planTodoCount, type PlanRow } from "../src/deptPlan";
import {
  fetchSheetListRows, filterSheetErrorsBySources, filterSheetListBySources, sheetTableQuery, type SheetListRow,
} from "../src/receptionSheetOpen";
import { sheetListUnhandledRow } from "../src/sheetListRowState";
import { sheetListToListRow } from "../src/receptionSheetOpen";
import type { DeptCalEvent } from "../src/deptCalendarView";

const TODAY = "2026-10-28";
const s = (over: Partial<SheetListRow> = {}): SheetListRow => ({
  source: "sales", kind: "영업팀", sheetRow: 100, seq: "10", date: TODAY, author: "김접수", handler: "", state: "", cls: "open",
  vendor: "가나상사", field: "해지", region: "", summary: "해지 문의", month: "2026-10", ...over,
});
const r = (id: string, over: Partial<PlanRow> = {}): PlanRow => ({
  id, type: "영업팀", status: "접수", receipt_date: TODAY, vendor: "앱업체", remote_meta: { schedule_date: TODAY }, ...over,
});
const ev = (id: string, date: string, over: Partial<DeptCalEvent> = {}): DeptCalEvent => ({
  id, team: "영업팀", date, time: "", title: `일정${id}`, memo: "", author: "", receptionId: "", done: false, ...over,
});

describe("deptSheetSource", () => {
  it("영업팀→sales, 경영지원→mgmt, 운영지원→null", () => {
    expect(deptSheetSource("영업팀")).toBe("sales");
    expect(deptSheetSource("경영지원")).toBe("mgmt");
    expect(deptSheetSource("운영지원")).toBeNull();
  });
});

describe("sheetPlanItems — 금일은 오늘 접수일만(Q1)", () => {
  it("open·hold 오늘 → 열림, done 오늘 → 완료, 지난 날·미래·9월 → 빠짐", () => {
    const rows = [
      s({ seq: "1", cls: "open", time: "10:00" }), s({ seq: "2", cls: "hold", time: "09:00" }), s({ seq: "3", cls: "done" }),
      s({ seq: "4", date: "2026-10-27" }), s({ seq: "5", date: "2026-10-30" }), s({ seq: "6", date: "2026-09-30" }),
    ];
    const out = sheetPlanItems(rows, TODAY);
    expect(out.open.map((x) => x.seq)).toEqual(["2", "1"]); // 접수시간 순
    expect(out.done.map((x) => x.seq)).toEqual(["3"]);
  });
  it("시각 없는 줄은 시각 있는 줄 뒤", () => {
    const out = sheetPlanItems([s({ seq: "a" }), s({ seq: "b", time: "13:00" })], TODAY);
    expect(out.open.map((x) => x.seq)).toEqual(["b", "a"]);
  });
});

describe("sheetPlanItems — 접수일로 금일·익일·예정(2026-10-28 사용자 규칙)", () => {
  it("오늘 = 금일, 다음 영업일까지 = 익일, 그 뒤 = 예정(열린 줄만), 지난 날·완료 미래 줄은 빠짐", () => {
    const rows = [
      s({ seq: "t", date: TODAY }), s({ seq: "n", date: "2026-10-29" }), s({ seq: "l", date: "2026-11-05", time: "09:00" }),
      s({ seq: "l0", date: "2026-10-30" }), s({ seq: "nd", date: "2026-10-29", cls: "done" }), s({ seq: "p", date: "2026-10-27" }),
    ];
    const out = sheetPlanItems(rows, TODAY, "2026-10-29");
    expect(out.open.map((x) => x.seq)).toEqual(["t"]);
    expect(out.next.map((x) => x.seq)).toEqual(["n"]);
    expect(out.later.map((x) => x.seq)).toEqual(["l0", "l"]); // 접수일 순
    expect(out.done).toHaveLength(0);
  });
  it("nextDay 없으면 오늘 뒤 줄은 넣지 않음(예전 동작)", () => {
    const out = sheetPlanItems([s({ date: "2026-10-29" })], TODAY);
    expect(out.next).toHaveLength(0);
    expect(out.later).toHaveLength(0);
  });
  it("deptPlanBuckets: 금요일의 익일 = 토·일·월, 화요일부터 예정", () => {
    const FRI = "2026-10-30";
    const sheet = [s({ seq: "sat", date: "2026-10-31" }), s({ seq: "mon", date: "2026-11-02" }), s({ seq: "tue", date: "2026-11-03" }), s({ seq: "fri", date: FRI })];
    const b = deptPlanBuckets("영업팀", [], [], FRI, { sheet });
    expect(b.today.map((x) => x.key)).toEqual(["sh:sales:2026-10:fri"]);
    expect(b.next.map((x) => x.key)).toEqual(["sh:sales:2026-10:sat", "sh:sales:2026-10:mon"]);
    expect(b.later.map((x) => x.key)).toEqual(["sh:sales:2026-10:tue"]);
    expect(planTodoCount(b)).toBe(1); // 익일·예정은 탭 숫자에 안 셈
  });
  it("공휴일 건너뜀: 10-08(목) 다음 영업일 = 10-12(월, 10-09 한글날) → 앱·시트 모두 익일", () => {
    const sheet = [s({ seq: "a", date: "2026-10-12" }), s({ seq: "b", date: "2026-10-13" })];
    const rows = [r("x", { receipt_date: "2026-10-08", remote_meta: { schedule_date: "2026-10-12" } })];
    const b = deptPlanBuckets("영업팀", rows, [], "2026-10-08", { sheet });
    expect(b.next.map((x) => x.key)).toEqual(["r:x", "sh:sales:2026-10:a"]);
    expect(b.later.map((x) => x.key)).toEqual(["sh:sales:2026-10:b"]);
  });
});

describe("hideLinkedLike·hideLikeEvents — 중복 보조 막이", () => {
  it("같은 부서·같은 날·상호 앞 6자 같음 → 시트 숨김", () => {
    const sheet = [s({ vendor: "(주)가나다라마바사", seq: "1" }), s({ vendor: "가나다라마바", seq: "2", date: "2026-10-27" }), s({ vendor: "다른업체", seq: "3" })];
    const app = [{ type: "영업팀", receipt_date: TODAY, vendor: "가나다라마바사 본점" }];
    expect(hideLinkedLike(sheet, app).map((x) => x.seq)).toEqual(["2", "3"]);
  });
  it("다른 부서 앱 접수는 영향 없음", () => {
    expect(hideLinkedLike([s()], [{ type: "경영지원", receipt_date: TODAY, vendor: "가나상사" }])).toHaveLength(1);
  });
  it("달력: 같은 날 접수 일정 제목에 상호가 있으면 시트 칩 숨김(부서 자체 일정은 무시)", () => {
    const evs = [ev("1", TODAY, { title: "[영업] 가나상사 · 해지", receptionId: "x" }), ev("2", "2026-10-27", { title: "다른업체" })];
    expect(hideLikeEvents([s(), s({ seq: "2", date: "2026-10-27", vendor: "다른업체" })], evs).map((x) => x.seq)).toEqual(["2"]);
  });
});

describe("deptPlanBuckets + 시트·오늘 완료", () => {
  it("인자 없음 = 예전과 같음(회귀)", () => {
    const rows = [r("a"), r("b", { remote_meta: { schedule_date: "2026-10-29" } })];
    const a = deptPlanBuckets("영업팀", rows, [ev("1", TODAY)], TODAY);
    const b = deptPlanBuckets("영업팀", rows, [ev("1", TODAY)], TODAY, {});
    expect(b).toEqual(a);
    expect(a.today.map((x) => x.key)).toEqual(["e:1", "r:a"]);
  });

  it("금일 = 앱·일정 → 열린 시트(시각 순) → 오늘 완료 앱 → 완료 시트, key 충돌 없음", () => {
    const sheet = [s({ seq: "1", time: "11:00", vendor: "시트1" }), s({ seq: "2", time: "09:00", vendor: "시트2" }), s({ seq: "3", cls: "done", vendor: "시트3" }),
      s({ seq: "4", date: "2026-10-27", vendor: "지난" }), s({ seq: "5", source: "mgmt", kind: "경영지원", vendor: "경영" })];
    const done = [r("d1", { status: "완료", vendor: "완료업체" }), r("d2", { status: "완료", type: "경영지원" })];
    const b = deptPlanBuckets("영업팀", [r("a")], [ev("1", TODAY)], TODAY, { sheet, done });
    expect(b.today.map((x) => x.key)).toEqual(["e:1", "r:a", "sh:sales:2026-10:2", "sh:sales:2026-10:1", "d:d1", "sh:sales:2026-10:3"]);
    expect(b.today.filter(isPlanDone).map((x) => x.key)).toEqual(["d:d1", "sh:sales:2026-10:3"]);
    expect(new Set(b.today.map((x) => x.key)).size).toBe(b.today.length);
    expect(b.next).toHaveLength(0);
  });

  it("planTodoCount: 금일 앱 1 + 열린 시트 2 → 3(완료는 세지 않음), 칩은 열림·완료 따로", () => {
    const b = deptPlanBuckets("영업팀", [r("a")], [ev("x", TODAY, { done: true })], TODAY,
      { sheet: [s({ seq: "1", vendor: "가" }), s({ seq: "2", vendor: "나" }), s({ seq: "3", cls: "done", vendor: "다" })], done: [r("d", { status: "완료" })] });
    expect(planTodoCount(b)).toBe(3);
    expect(planChipCount(b.today)).toEqual({ open: 3, done: 3 });
  });

  it("앱 접수(열림·오늘 완료)와 같은 날·같은 상호 시트 줄은 숨김", () => {
    const b = deptPlanBuckets("영업팀", [r("a", { vendor: "가나상사" })], [], TODAY, { sheet: [s({ vendor: "가나상사" }), s({ seq: "2", vendor: "역락" })], done: [r("d", { status: "완료", vendor: "역락" })] });
    expect(b.today.map((x) => x.key)).toEqual(["r:a", "d:d"]);
  });

  it("사용자 사례(경영): 열린 앱 1(역락) + 오늘 완료 앱 1(테스트) + 시트 열림·완료 → 금일에 완료까지 보임", () => {
    const rows = [r("yr", { type: "경영지원", vendor: "역락" }), r("old", { type: "경영지원", vendor: "위앤유텍", receipt_date: "2026-10-26", remote_meta: { schedule_date: "2026-10-26" } })];
    const done = [r("t", { type: "경영지원", status: "완료", vendor: "테스트" })];
    const sheet = [s({ source: "mgmt", kind: "경영지원", vendor: "시트경영", seq: "1" }), s({ source: "mgmt", kind: "경영지원", vendor: "끝난경영", seq: "2", cls: "done" })];
    const b = deptPlanBuckets("경영지원", rows, [], TODAY, { sheet, done });
    expect(b.today.map((x) => x.key)).toEqual(["r:yr", "sh:mgmt:2026-10:1", "d:t", "sh:mgmt:2026-10:2"]);
    expect(planTodoCount(b)).toBe(2);
  });
});

describe("오늘 완료 앱 접수", () => {
  it("kstDayOf: UTC 15시 이후는 다음 날", () => {
    expect(kstDayOf("2026-10-27T15:30:00Z")).toBe("2026-10-28");
    expect(kstDayOf("2026-10-27T14:59:00Z")).toBe("2026-10-27");
    expect(kstDayOf("")).toBe("");
  });
  it("완료 시각이 오늘(KST)·완료 시각 없으면 예정일/접수일 오늘, 다른 부서·취소는 뺀다", () => {
    const rows = [
      { id: "a", type: "경영지원", status: "완료", completed_at: "2026-10-28T01:00:00Z", receipt_date: "2026-10-20" },
      { id: "b", type: "경영지원", status: "완료", completed_at: "2026-10-27T01:00:00Z", receipt_date: TODAY },
      { id: "c", type: "경영지원", status: "완료", completed_at: null, receipt_date: TODAY },
      { id: "d", type: "영업팀", status: "완료", completed_at: "2026-10-28T01:00:00Z" },
      { id: "e", type: "경영지원", status: "취소", completed_at: "2026-10-28T01:00:00Z" },
    ];
    expect(appDoneToday(rows, "경영지원", TODAY).map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("조회문: 한글 값 인코딩, 오늘 0시 KST = 전날 15시 UTC('+' 없음)", () => {
    const q = doneTodayQuery("경영지원", TODAY);
    expect(q).toContain(`type=eq.${encodeURIComponent("경영지원")}`);
    expect(q).toContain(`status=eq.${encodeURIComponent("완료")}`);
    expect(q).toContain("completed_at.gte.2026-10-27T15:00:00.000Z");
    expect(q).toContain("deleted=eq.false");
    expect(q).not.toContain("+");
  });
  it("조회문: 완료 카드 상세(DeptReceptionDetail)에 쓰는 칸도 읽는다", () => {
    const q = doneTodayQuery("경영지원", TODAY);
    for (const c of ["receiver_name", "receiver_phone", "notes", "address", "asset_no", "model", "photos", "completed_by"]) expect(q).toContain(c);
  });
});

describe("달력 묶기", () => {
  it("날짜별·시각 순, 9월 칸·CS 기록 줄 없음", () => {
    const m = groupSheetByDate([s({ seq: "1", time: "10:00" }), s({ seq: "2", time: "08:00" }), s({ seq: "3", date: "2026-09-30" }), s({ seq: "4", cls: "record", source: "copier" })]);
    expect(m.get(TODAY)?.map((x) => x.seq)).toEqual(["2", "1"]);
    expect(m.has("2026-09-30")).toBe(false);
  });
});

describe("출처 거르기·처리 단추 행", () => {
  it("filterSheetListBySources·sheetTableQuery", () => {
    const rows = [s(), s({ source: "mgmt" }), s({ source: "remote" })];
    expect(filterSheetListBySources(rows, ["sales"]).map((x) => x.source)).toEqual(["sales"]);
    expect(filterSheetListBySources(rows, [])).toHaveLength(3);
    expect(sheetTableQuery("2026-10-01", "2026-10-27", ["sales"])).toContain("&source=in.(sales)");
    expect(sheetTableQuery("2026-10-01", "2026-10-27")).not.toContain("source=in");
  });
  it("오류 글: 다른 출처 이름만 있는 글은 뺀다, 공통 글은 남긴다", () => {
    const errs = ["시트 머리 변경: 경영지원접수 B2", "시트 머리 변경: 해지방어접수(영업팀) C2", "시트 접수를 못 읽음 — 앱 접수만 표시 (timeout)"];
    expect(filterSheetErrorsBySources(errs, ["sales"])).toEqual([errs[1], errs[2]]);
  });
  it("sheetListUnhandledRow: 열린 줄은 statusOnly 행, 완료·순번 빈 줄은 null", () => {
    const u = sheetListUnhandledRow(sheetListToListRow(s({ seq: "7", sheetRow: 55, handler: "" })), "", TODAY);
    expect(u?.key).toBe("s:sales:55");
    expect(u?.sheet).toEqual({ source: "sales", row: 55, seq: "7", author: "김접수", vendor: "가나상사" });
    expect(u?.kind).toBe("영업팀");
    expect(sheetListUnhandledRow(sheetListToListRow(s({ cls: "done" })), "", TODAY)).toBeNull();
    expect(sheetListUnhandledRow(sheetListToListRow(s({ seq: "" })), "", TODAY)).toBeNull();
  });
});

describe("fetchSheetListRows(sources) — 옛 엣지가 sources 를 무시해도 결과는 고른 출처만", () => {
  afterEach(() => vi.clearAllMocks());
  it("엣지 응답에 mgmt·remote 섞여도 sales 만, 엣지 본문에 sources 실림, 보관 표는 source=in.(sales)", async () => {
    vi.mocked(getConfig).mockResolvedValue({ RECEPTION_SHEET_OPEN_ENABLED: "true" });
    vi.mocked(invokeEdgeFunction).mockResolvedValue({ ok: true, rows: [
      { source: "sales", date: "2026-10-28", seq: "1", sheetRow: 5, cls: "open", vendor: "A" },
      { source: "mgmt", date: "2026-10-28", seq: "2", sheetRow: 6, cls: "open", vendor: "B" },
      { source: "remote", date: "2026-10-28", seq: "3", sheetRow: 7, cls: "open", vendor: "C" },
    ], noDate: 0, errors: ["시트 머리 변경: 경영지원접수 B2"] });
    vi.mocked(selectAllRows).mockResolvedValue([]);
    // 오늘 11-03 → 10-20~10-31 구간은 보관 표
    const res = await fetchSheetListRows("2026-10-20", "2026-11-03", "2026-11-03", { sources: ["sales"] });
    expect(res.rows.map((x) => x.source)).toEqual(["sales"]);
    expect(res.errors).toEqual([]);
    expect(invokeEdgeFunction).toHaveBeenCalledWith("reception-sheet-open", { list: { from: "2026-10-20", to: "2026-11-03", sources: ["sales"] } }, 25_000);
    expect(String(vi.mocked(selectAllRows).mock.calls[0]?.[1])).toContain("&source=in.(sales)");
  });
  it("sources 없음 = 엣지 본문 그대로(접수리스트 회귀)", async () => {
    vi.mocked(getConfig).mockResolvedValue({ RECEPTION_SHEET_OPEN_ENABLED: "true" });
    vi.mocked(invokeEdgeFunction).mockResolvedValue({ ok: true, rows: [], noDate: 0, errors: [] });
    await fetchSheetListRows("2026-10-01", "2026-10-28", TODAY);
    expect(invokeEdgeFunction).toHaveBeenCalledWith("reception-sheet-open", { list: { from: "2026-10-01", to: "2026-10-28" } }, 25_000);
  });
});
