// 통합검색 현장 도구(T4~T11, 2026-10-29) 순수 부분 + 기간 풀이·Q1 공개 범위
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_SOURCES, countActivity, inspectionGaps, mergeUnhandledNow, misuFollowup, misuFollowupTool, misuLatestDay, personActivity, pinnedOrders, renewalByTeam, roomFor, scheduleView, summarizeAlbums,
} from "../supabase/functions/_shared/ask/tools-field.ts";
import { askerMaySee, dateRange, inYmd, loadRoster, parseOkrPeriod, rosterTeam, textDateLoose, ymdOf, type AskToolCtx } from "../supabase/functions/_shared/ask/tool-util.ts";
import { askMask } from "../supabase/functions/_shared/ask/mask.ts";

type Row = Record<string, unknown>;
const ctxWith = (data: Record<string, Row[]>, asker = { name: "이민구", team: "C", dept: "CS", title: "" }): AskToolCtx => ({
  rest: {
    async get<T>(path: string) { return (data[path.split("?")[0]] || []) as T[]; },
    async getAll<T>(table: string) { return { rows: (data[table] || []) as T[], truncated: false }; },
    async count() { return 0; },
    async rpc<T>() { return [] as T; },
    async edge<T>() { return {} as T; },
  },
  mask: askMask, today: "2026-10-29", asker, mode: "analysis",
});

describe("기간 풀이", () => {
  it("달·주차·분기·말", () => {
    expect(parseOkrPeriod("2026-10", "2026-10-29").weeks.map((w) => [w.id, w.future])).toEqual([["2026-10-W1", false], ["2026-10-W2", false], ["2026-10-W3", false], ["2026-10-W4", false]]);
    expect(parseOkrPeriod("2026-10-W3", "2026-10-29")).toMatchObject({ kind: "week", id: "2026-10-W3", months: ["2026-10"] });
    expect(parseOkrPeriod("2026-Q4", "2026-10-29")).toMatchObject({ kind: "quarter", months: ["2026-10", "2026-11", "2026-12"] });
    expect(parseOkrPeriod("이번 주", "2026-10-29").id).toBe("2026-10-W4");
    expect(parseOkrPeriod("", "2026-10-29").id).toBe("2026-10");
    expect(parseOkrPeriod("2026-11", "2026-10-29").weeks.every((w) => w.future)).toBe(true);
    expect(dateRange("2026-09", "", "2026-10-29")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(dateRange("", "", "2026-10-29")).toEqual({ from: "2026-10-01", to: "2026-10-29" });
  });
});

describe("Q1 공개 범위", () => {
  it("본인·같은 팀·팀장만", () => {
    const me = { name: "이민구", team: "C", dept: "CS", title: "" };
    expect(askerMaySee(me, { name: "이민구" })).toBe(true);
    expect(askerMaySee(me, { team: "C" })).toBe(true);
    expect(askerMaySee(me, { team: "B" })).toBe(false);
    expect(askerMaySee({ name: "누구", team: "", dept: "", title: "" }, { team: "C" })).toBe(false);
    expect(askerMaySee({ name: "팀장님", team: "팀장", dept: "CS", title: "팀장" }, { team: "B" })).toBe(true);
  });

  it("팀 캘린더는 다른 팀이 물으면 숨긴다", async () => {
    const data = { cs_members: [{ name: "이민구", team: "C", title: "" }], as_tickets: [], team_calendar_events: [{ date: "2026-10-30", title: "회식" }], plan_memos: [] };
    const mine = await scheduleView({ team: "C" }, ctxWith(data));
    expect(mine.teamCalendar).toEqual([expect.objectContaining({ title: "회식" })]);
    const other = await scheduleView({ team: "C" }, ctxWith(data, { name: "홍길동", team: "A", dept: "CS", title: "" }));
    expect(other.teamCalendar).toEqual({ hidden: expect.stringContaining("같은 팀만") });
  });
});

describe("T4 사람 활동", () => {
  it("본인 건수·팀 1인 평균·업체 상위", () => {
    const src = ACTIVITY_SOURCES.find((s) => s.table === "jeomgeom")!;
    const rows = [
      { 작성자: "이민구", 작성일: "2026-10-05", _업체명: "무암" }, { 작성자: "이민구", 작성일: "2026-10-06", _업체명: "무암" },
      { 작성자: "지경민", 작성일: "2026-10-06", _업체명: "잡플러스" }, { 작성자: "남", 작성일: "2026-10-06", _업체명: "x" },
    ];
    const c = countActivity(src, rows, "이민구", ["이민구", "지경민"]);
    expect([c.person, c.teamTotal, c.teamAvg]).toEqual([2, 3, 1.5]);
    expect(c.vendors).toEqual([{ key: "무암", count: 2 }]);
    expect(c.days).toEqual(["2026-10-05", "2026-10-06"]);
    const t = countActivity(ACTIVITY_SOURCES.find((s) => s.table === "as_tickets")!, [{ assignee: "이민구,지경민", date: "2026-10-05", vendor: "a" }], "이민구", ["이민구"]);
    expect([t.person, t.teamTotal]).toEqual([1, null]);
  });
});

describe("T5 점검 누락", () => {
  it("기간 안 기록 없음 + 지도 완료는 따로", () => {
    const r = inspectionGaps([
      { place_name: "1#N무암", label: "", last_date: "2026-10-10", days_since: 19, kind: "quarter" },
      { place_name: "2#S잡플러스", label: "G2", last_date: "2026-07-01", days_since: 120, kind: "quarter" },
      { place_name: "3#N새곳", label: "", last_date: null, days_since: 9999, kind: "monthly" },
      { place_name: "4#N완료", label: "G5", last_date: "2026-08-01", days_since: 90, kind: "quarter" },
    ], "2026-10-01");
    expect(r.total).toBe(4);
    expect(r.missing.map((m) => [m.name, m.lastInspection])).toEqual([["3#N새곳", "(기록 없음)"], ["2#S잡플러스", "2026-07-01"]]);
    expect(r.mapDoneButNoRecord.map((m) => m.name)).toEqual(["4#N완료"]);
  });
});

describe("T6 재계약", () => {
  it("G7 제외·G5 완료·미완료에 재계약 마지막 행", () => {
    const t = renewalByTeam(
      [{ team: "C", label: "G5", name: "가" }, { team: "C", label: "G6", name: "(주)나나" }, { team: "C", label: "G7", name: "다" }, { team: "B", label: "", name: "라" }],
      [{ 날짜: "2026-09-01", _업체명: "나나", 갱신상태: "제안", 진행상황: "옛 글" }, { 날짜: "2026-10-01", _업체명: "나나 주식회사", 갱신상태: "보류", 갱신위험도: "상" }],
      "C",
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ team: "C", target: 2, done: 1, inProgress: 1, excludedG7: 1, pct: 50 });
    expect(t[0].open[0]).toMatchObject({ name: "(주)나나", 갱신상태: "보류", 갱신위험도: "상", 기록일: "2026-10-01" });
  });
});

describe("T7 미수 후속", () => {
  it("최신 행·N개월↑·방문 안 한 곳·약속일 지남", () => {
    const r = misuFollowup({
      misu: [
        { _업체명: "무암", 입력일: "2026-09-01 0:00", 미수개월: "2" }, { _업체명: "무암", 입력일: "2026-10-01 0:00", 미수개월: "4", 입금약속일: "2026-10-20" },
        { _업체명: "잡플러스", 입력일: "2026-10-01 0:00", "실제 개월수": "5개월" }, { _업체명: "작음", 입력일: "2026-10-01", 미수개월: "1" },
      ],
      misuVisits: [{ vendor: "잡플러스", visited_at: "2026-10-10T01:00:00Z", author: "이민구" }],
      visitLogs: [], csChecks: [{ team: "C", vendor: "무암", checked: true }, { team: "C", vendor: "잡플러스", checked: false }],
      minMonths: 3, team: "C", today: "2026-10-29",
    });
    expect(r.count).toBe(2);
    expect(r.notVisited.map((x) => x.vendor)).toEqual(["무암"]);
    expect(r.promiseOverdue.map((x) => [x.vendor, x.promiseDate])).toEqual([["무암", "2026-10-20"]]);
    expect(r.all.find((x) => x.vendor === "잡플러스")).toMatchObject({ months: 5, lastMisuVisit: "2026-10-10", csChecked: false });
  });
});

describe("T8 미처리", () => {
  const roomMap = [{ category: "AS", region: "C", room: "C팀 AS방" }, { category: "AS", region: "*", room: "공통 AS방" }, { category: "원격이관", region: "*", room: "원격방" }];
  it("방 매칭 — 팀 방 우선, 없으면 * 공통", () => {
    expect(roomFor(roomMap, "AS", "C")).toBe("C팀 AS방");
    expect(roomFor(roomMap, "AS", "B")).toBe("공통 AS방");
    expect(roomFor(roomMap, "IT", "B")).toBe("");
  });
  it("지난 일정·앱 접수·시트 줄을 합치고, 시트와 짝인 앱 접수·복합기 AS 접수는 뺀다", () => {
    const items = mergeUnhandledNow({
      tickets: [
        { date: "2026-10-20", status: "접수", scheduleType: "AS", team: "C", vendor: "무암", assignee: "이민구" },
        { date: "2026-10-20", status: "완료", scheduleType: "AS", team: "C", vendor: "끝" },
        { date: "2026-10-20", status: "", scheduleType: "매월점검", team: "C", vendor: "점검" },
        { date: "2026-10-29", status: "", scheduleType: "AS", team: "C", vendor: "오늘" },
      ],
      receptions: [{ id: "r1", type: "원격이관", status: "접수", receipt_date: "2026-10-27", region: "수도권B", vendor: "원격사" }, { id: "r2", type: "IT", status: "접수", vendor: "짝" }, { id: "r3", type: "복합기 AS", status: "접수", vendor: "앱AS" }],
      sheet: [{ source: "remote", cls: "open", receipt_date: "2026-10-28", reception_id: "r2", vendor: "짝", region: "B" }, { source: "sales", cls: "done", vendor: "끝난시트" }, { source: "mgmt", cls: "hold", gone_at: "2026-10-28", vendor: "사라진줄" }],
      roomMap, today: "2026-10-29",
    });
    expect(items.map((x) => [x.source, x.vendor, x.ageDays])).toEqual([["일정", "무암", 9], ["앱 접수", "원격사", 2], ["시트", "짝", 1]]);
    expect(items[0].room).toBe("C팀 AS방");
    expect(items[1].room).toBe("원격방");
  });
});

describe("T9·T11", () => {
  it("고정 순서 행 풀기", () => {
    expect(pinnedOrders([{ ticket_id: "__order__:2026-10-30", memo: '["t2","t1","t2"]' }, { ticket_id: "t1", memo: "메모" }, { ticket_id: "__order__:2026-10-31", memo: "깨짐" }]))
      .toEqual({ "2026-10-30": ["t2", "t1"], "2026-10-31": [] });
  });
  it("사진 — 장수는 세기만, 안 올린 팀원", () => {
    const s = summarizeAlbums([{ id: 1, author: "이민구", category: "점검", vendor: "무암", urls: ["a", "b"], created_at: "2026-10-28T00:00:00Z" }], [{ name: "이민구", team: "C", title: "", dept: "" }, { name: "지경민", team: "C", title: "", dept: "" }], "C");
    expect([s.albums, s.photos]).toEqual([1, 2]);
    expect(s.membersWithoutAlbums).toEqual(["지경민"]);
    expect(JSON.stringify(s)).not.toContain('"a"');
  });
});

// 2026-10-29 검수아 실데이터 검사 실패 재현 — misu.입력일 은 글자 칸이고 형식이 섞여 있다(8,297행 중 39행 비표준)
describe("글자 날짜 칸(실데이터 형태)", () => {
  it("ymdOf — 시각 붙은 값·점 표기·띄어 쓴 점·한글·JS Date 글·쓰레기", () => {
    expect(ymdOf("2026-06-22 00:00:00")).toBe("2026-06-22");
    expect(ymdOf("2026.9.8")).toBe("2026-09-08");
    expect(ymdOf("2026.1.7")).toBe("2026-01-07");
    expect(ymdOf("2026. 3. 10.")).toBe("2026-03-10");
    expect(ymdOf("2025. 12 .11")).toBe("2025-12-11");
    expect(ymdOf("2026년 6월 10일")).toBe("2026-06-10");
    expect(ymdOf("Fri Mar 20 2026 00:00:00 GMT+0900 (Korean Standard Time)")).toBe("2026-03-20");
    expect(ymdOf("2026-10-04T16:30:00Z")).toBe("2026-10-05");
    expect(ymdOf("마장역 역세권 장기전세 재개발추진 준비위원회")).toBe("");
    expect(ymdOf("2026.13.40")).toBe("");
    expect(inYmd("2026.1.7", "2026-09-14", "2026-10-29")).toBe(false);
  });
  it("textDateLoose — 연도 접두 + 숫자로 시작하지 않는 줄(서버는 넉넉히)", () => {
    expect(decodeURIComponent(textDateLoose("입력일", "2025-12-31", "2026-10-29"))).toBe('or=(and("입력일".gte.2025,"입력일".lt.2027),"입력일".gte.A)');
    expect(decodeURIComponent(textDateLoose("입력일", "2026-09-14", "9999-12-31"))).toBe('"입력일"=gte.2026');   // 위 끝 없음 — '10000' 글자 비교 함정
  });
  it("misuLatestDay — 글자 정렬 1등(한글 쓰레기 행)이 아니라 읽히는 날짜 중 최댓값, 오늘 뒤 오타는 뺀다", () => {
    const rows = [{ 입력일: "마장역 역세권 장기전세 재개발추진 준비위원회" }, { 입력일: "2026.9.8" }, { 입력일: "2026-10-29 00:00:00" }, { 입력일: "2062-01-01" }];
    expect(misuLatestDay(rows, "2026-10-29")).toBe("2026-10-29");
    expect(misuLatestDay([{ 입력일: "쓰레기" }], "2026-10-29")).toBe("");
  });
  it("misu_followup 도구 — 쓰레기 행이 있어도 오류 없이, 45일 창은 날짜로(점 표기 옛 행이 새지 않음), 없는 칸 최종상태 안 읽음", async () => {
    const misu = [
      { _업체명: "마장역", 입력일: "마장역 역세권 장기전세 재개발추진 준비위원회", 미수개월: "9" },
      { _업체명: "옛점", 입력일: "2026.1.7", 미수개월: "6" },                 // 글자 비교로는 '2026.' > '2026-09-14' → 새던 행
      { _업체명: "무암", 입력일: "2026-10-29 00:00:00", 미수개월: "4", 고객반응: "다음 주 입금" },
      { _업체명: "점새", 입력일: "2026.10.08", "실제 개월수": "3개월" },
      { _업체명: "창밖", 입력일: "2026-09-13 00:00:00", 미수개월: "8" },      // 10-29 - 45일 = 09-14 → 밖
    ];
    const urls: string[] = [];
    const ctx = ctxWith({ misu, misu_visits: [], visit_logs: [], misu_cs_checks: [] });
    const getAll = ctx.rest.getAll;
    ctx.rest.getAll = (async (t: string, q: string, o?: object) => { urls.push(decodeURIComponent(q)); return getAll(t, q, o); }) as typeof getAll;
    const r = await misuFollowupTool({ min_months: 3 }, ctx) as Record<string, unknown> & { all: Array<Record<string, unknown>> };
    expect(r.error).toBeUndefined();
    expect(r.misuListDate).toBe("2026-10-29");
    expect(r.all.map((x) => x.vendor).sort()).toEqual(["무암", "점새"]);
    expect(r.all.find((x) => x.vendor === "무암")).toMatchObject({ customerReaction: "다음 주 입금" });
    const misuQs = urls.filter((u) => u.includes("입력일"));
    expect(misuQs.join(" ")).not.toContain("최종상태");
    expect(misuQs.join(" ")).not.toMatch(/"입력일"=(gte|lt|lte)\./);
    expect(misuQs.join(" ")).not.toContain("order=");
  });
  it("person_activity — 불만 표의 JS Date 글·점 표기도 기간 안이면 센다", async () => {
    const ctx = ctxWith({
      cs_members: [{ name: "이민구", team: "C", title: "" }],
      bulman: [{ 처리자: "이민구", 날짜: "Fri Mar 20 2026 00:00:00 GMT+0900", _업체명: "가" }, { 처리자: "이민구", 날짜: "2026. 3. 10.", _업체명: "나" }, { 처리자: "이민구", 날짜: "2026-04-01", _업체명: "다" }],
    });
    const r = await personActivity({ person: "이민구", from: "2026-03-01", to: "2026-03-31" }, ctx) as { sources: Array<{ table: string; person: number }> };
    expect(r.sources.find((x) => x.table === "bulman")?.person).toBe(2);
  });
});

describe("명단 겸직", () => {
  it("rosterTeam — 'A·B'·'B/C'·'CSS' 는 앱 rosterFromMembers 와 같이 첫 A~E", () => {
    expect(rosterTeam("A·B")).toBe("A");
    expect(rosterTeam("B/C")).toBe("B");
    expect(rosterTeam("CSS·A")).toBe("E");
    expect(rosterTeam("C")).toBe("C");
    expect(rosterTeam("수도권B")).toBe("B");
    expect(rosterTeam("경영지원")).toBe("경영지원");
  });
  it("loadRoster 가 겸직을 나눠 같은 팀 평균에 들어간다", async () => {
    const roster = await loadRoster(ctxWith({ cs_members: [{ name: "겸직", team: "A·B", title: "" }, { name: "에이", team: "A", title: "" }] }));
    expect(roster.map((r) => [r.name, r.team])).toEqual([["겸직", "A"], ["에이", "A"]]);
  });
});
