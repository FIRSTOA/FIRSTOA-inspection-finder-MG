// 접수리스트 시트 줄(2026-10-28, docs/tasks/reception-list-sheet-rows-2026-10-28.md 7절 표본)
// 프런트 사본 src/receptionSheetState.ts(copier 파싱·CS 잇기·목록 모드) + src/receptionSheetOpen.ts(합치기·보관 표·엣지 호출)
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, getConfig: vi.fn(), invokeEdgeFunction: vi.fn(), selectAllRows: vi.fn() };
});

import { getConfig, invokeEdgeFunction, selectAllRows } from "../src/supabase";
import {
  combineLinks, linkCopierRows, linkRows, listRowsOf, openRowsOf, parseSheetRows, SHEET_LAYOUTS, sheetTime, type CopierReception, type ParsedSheetRow,
} from "../src/receptionSheetState";
import {
  dedupeSheetRows, fetchSheetListRows, isSheetListRow, mergeListWithSheet, sheetListRowUrl, sheetListToListRow, tableRowToSheetListRow,
  type SheetListRow, type SheetTableRow,
} from "../src/receptionSheetOpen";
import { authorStats } from "../src/receptionAuthorStats";
import type { ServiceReceptionRow } from "../src/api";

const NOW = new Date("2026-10-28T03:00:00Z"); // KST 2026-10-28 12:00

const mk = (width: number) => (cells: Record<number, string>): string[] => {
  const row = Array(width).fill("");
  for (const [c, v] of Object.entries(cells)) row[Number(c) - 1] = v;
  return row;
};

// AS접수용(CS) 탭: 읽는 범위 A5:T + BD5:BD 를 한 행으로(BD = 56번째 칸). 5행 머리, 6·7행 머리 밑 줄, 8행~ 데이터
const copierRow = mk(56);
const COPIER_HEADER = copierRow({ 1: "순", 2: "날짜", 3: "년월", 4: "접수시간", 5: "접수자", 6: "퍼스트순", 8: "업체명", 10: "접수분야", 19: "제목", 20: "내용", 56: "처리완료" });
const COPIER_VALUES: string[][] = [
  COPIER_HEADER,
  copierRow({ 1: "748", 2: "10월 28일", 5: "미리보기", 6: "1" }), // 6행: 데이터 시작 전 — 무시
  copierRow({ 2: "날짜", 5: "접수자", 6: "퍼스트순" }), // 7행: 머리 사본 꼴 — 무시
  copierRow({ 1: "1", 2: "10월 1일", 3: "2610", 4: "9:06", 5: "김광태", 6: "19655", 8: "가나상사", 10: "복합기", 19: "용지걸림", 20: "고객 010-1234-5678 연락 요망", 56: "완료 10/2 양승원" }),
  copierRow({ 1: "2", 2: "10월 1일", 3: "2610", 4: "13:40", 5: "김광태", 6: "19655", 8: "가나상사", 19: "토너" }), // 같은 날·같은 퍼스트순·같은 접수자 재접수
  copierRow({ 1: "3", 2: "10월 2일", 3: "2610", 4: "10:00", 5: "신동원", 6: "20001", 8: "다라상회", 19: "소음" }),
  copierRow({ 1: "4", 2: "10월 3일", 3: "2610", 4: "오후 2:05", 5: "지경민", 6: "", 8: "㈜새거래처 본점", 19: "신규 설치" }),
  copierRow({ 1: "5" }), // 순번만 — 행 아님
];

describe("copier(AS접수용) 파싱", () => {
  it("배치: 3·4행은 firstRow 5 라 읽지 않고, 데이터는 8행부터", () => {
    expect(SHEET_LAYOUTS.copier).toMatchObject({ gid: 1181394897, firstRow: 5, headerRow: 5, dataStart: 8, statusCol: 56 });
    const { rows, error } = parseSheetRows(SHEET_LAYOUTS.copier, COPIER_VALUES, NOW);
    expect(error).toBe("");
    expect(rows.map((r) => r.sheetRow)).toEqual([8, 9, 10, 11]);
  });

  it("8행 → 2026-10-01 · 09:06 · 김광태 · 순번 1 · record · 복합기 AS · 전화번호 가림", () => {
    const [first, , , fourth] = parseSheetRows(SHEET_LAYOUTS.copier, COPIER_VALUES, NOW).rows;
    expect(first).toMatchObject({
      source: "copier", kind: "복합기 AS", date: "2026-10-01", time: "09:06", author: "김광태", seq: "1", cls: "record",
      firstNo: "19655", vendor: "가나상사", state: "완료 10/2 양승원", handler: "", region: "",
    });
    expect(first.summary.startsWith("용지걸림 — 고객")).toBe(true);
    expect(JSON.stringify(first)).not.toContain("1234-5678");
    expect(fourth.time).toBe("14:05");
    expect(fourth.firstNo).toBeUndefined();
  });

  it("머리 변경(F5 가 퍼스트순 아님): copier 만 errors, 다른 탭은 그대로", () => {
    const bad = COPIER_VALUES.map((r) => [...r]);
    bad[0][5] = "퍼스트번호";
    const out = parseSheetRows(SHEET_LAYOUTS.copier, bad, NOW);
    expect(out.rows).toEqual([]);
    expect(out.error).toContain("F5");
    expect(out.error).toContain("퍼스트순");
    expect(parseSheetRows(SHEET_LAYOUTS.sales, SALES_VALUES, NOW).error).toBe("");
  });

  it("접수시간 읽기", () => {
    expect(sheetTime("9:06")).toBe("09:06");
    expect(sheetTime("09:06:00")).toBe("09:06");
    expect(sheetTime("오후 12:30")).toBe("12:30");
    expect(sheetTime("오전 12:10")).toBe("00:10");
    expect(sheetTime("")).toBe("");
    expect(sheetTime("25:00")).toBe("");
  });
});

// 영업 탭(기존 표본과 같은 꼴)
const salesRow = mk(23);
const SALES_VALUES: string[][] = [
  salesRow({ 1: "순번", 2: "접수일", 5: "접수자", 7: "진행중/처리완료/보류/취소" }),
  salesRow({ 12: "31" }),
  salesRow({ 1: "5846", 2: "10월 20일", 3: "2610", 4: "10:01", 5: "손영근", 6: "박영업", 7: "처리완료", 15: "C", 16: "㈜세안이엔씨", 18: "해지", 22: "010-1111-2222", 23: "해지 문의" }),
  salesRow({ 1: "5847", 2: "10월 21일", 3: "2610", 4: "11:00", 5: "김수인", 7: "", 15: "A", 16: "가나상사", 18: "재계약", 22: "010-3333-4444", 23: "재계약 상담" }),
  salesRow({ 1: "5848", 2: "9월 30일", 3: "2609", 5: "이영업", 7: "보류", 16: "다라" }),
];

describe("CS 잇기 linkCopierRows", () => {
  const rows = parseSheetRows(SHEET_LAYOUTS.copier, COPIER_VALUES, NOW).rows;
  const db = (p: Partial<CopierReception> & { id: string }): CopierReception => ({ receipt_date: "2026-10-01", first_no: null, lease_no: null, author: null, vendor: null, ...p });
  const flat = (m: Map<string, { id: string; rule: string }>) => [...m.entries()].map(([k, v]) => [k, v.id, v.rule]);
  it("① (날짜·퍼스트순·접수자) 같은 시트 행 2개 + DB 1건 → 1개만(위 행)", () => {
    const links = linkCopierRows(rows, [db({ id: "a1", first_no: "19655", lease_no: "", author: "김광태", vendor: "가나" })]);
    expect(flat(links)).toEqual([["copier:8", "a1", "copier1"]]);
  });
  it("② 퍼스트순 같고 접수자 다름 → 2차 규칙(날짜·퍼스트순), lease_no 로도", () => {
    const links = linkCopierRows(rows, [
      db({ id: "a1", first_no: "19655", author: "김광태" }),
      db({ id: "a2", first_no: "19655", author: "다른사람" }),
      db({ id: "a3", receipt_date: "2026-10-02", lease_no: "20001", author: "누구" }),
    ]);
    expect(flat(links)).toEqual([["copier:8", "a1", "copier1"], ["copier:9", "a2", "copier2"], ["copier:10", "a3", "copier2"]]);
  });
  it("③ 퍼스트순 빈 신규 → (날짜·접수자·상호 앞 6자 같음)", () => {
    const ok = linkCopierRows(rows, [db({ id: "n1", receipt_date: "2026-10-03", first_no: "", author: "지경민", vendor: "(주)새거래처 본점" })]);
    expect(flat(ok)).toEqual([["copier:11", "n1", "copier3"]]);
    expect(linkCopierRows(rows, [db({ id: "n2", receipt_date: "2026-10-03", author: "지경민", vendor: "딴회사" })]).size).toBe(0);
    expect(linkCopierRows(rows, [db({ id: "n3", receipt_date: "2026-10-04", author: "지경민", vendor: "새거래처 본점" })]).size).toBe(0);
    expect(linkCopierRows(rows, [db({ id: "n4", receipt_date: "2026-10-03", author: "김광태", vendor: "새거래처 본점" })]).size).toBe(0);
  });
  it("combineLinks: 영업·원격 + CS → key→id, 규칙", () => {
    const copier = linkCopierRows(rows, [db({ id: "a1", first_no: "19655", author: "김광태" })]);
    const { links, rules } = combineLinks(new Map([["sales:7", "rec-1"], ["remote:5", "rem-1"]]), copier);
    expect([...links.entries()]).toEqual([["sales:7", "rec-1"], ["remote:5", "rem-1"], ["copier:8", "a1"]]);
    expect([...rules.values()]).toEqual(["job", "sheet_row", "copier1"]);
  });
});

describe("목록 모드 listRowsOf", () => {
  it("이어진 행 제외 · 2026-09-30 제외 · 완료·기록 포함 · 미래 날짜(원격 10월 30일) → noDate", () => {
    const remoteRow = mk(23);
    const remoteValues = [
      remoteRow({ 7: "처리여부", 12: "한조처리" }), remoteRow({}), remoteRow({}), remoteRow({}),
      remoteRow({ 1: "1", 2: "10월 27일", 3: "2610", 4: "9:30", 10: "지경민", 11: "원격1", 7: "처리완료", 18: "원격회사" }),
      remoteRow({ 1: "2", 2: "10월 30일", 3: "2610", 10: "지경민", 18: "미래회사" }),
    ];
    const sales = parseSheetRows(SHEET_LAYOUTS.sales, SALES_VALUES, NOW).rows;
    const remote = parseSheetRows(SHEET_LAYOUTS.remote, remoteValues, NOW).rows;
    const copier = parseSheetRows(SHEET_LAYOUTS.copier, COPIER_VALUES, NOW).rows;
    expect(remote[0]).toMatchObject({ author: "지경민", time: "09:30", cls: "done" });
    expect(remote[1].date).toBe("");
    const links = new Map([["sales:7", "rec-1"], ["copier:8", "a1"]]);
    const out = listRowsOf([...sales, ...remote, ...copier], links, "2026-09-01", "2026-10-31");
    expect(out.noDate).toBe(1);
    expect(out.rows.map((r) => `${r.source}:${r.sheetRow}`)).toEqual(["sales:8", "remote:5", "copier:9", "copier:10", "copier:11"]);
    expect(out.rows.some((r) => "content" in r)).toBe(false);
    // 범위 좁히기
    expect(listRowsOf(copier, new Map(), "2026-10-02", "2026-10-02").rows.map((r) => r.sheetRow)).toEqual([10]);
  });

  it("경영 연도 추정: C 빈 위쪽 '10월 29~30일'(2025-12 위)은 2025-10 → 목록(2026-10-01~)에서 빠짐", () => {
    const mgmtRow = mk(26);
    const values = [
      mgmtRow({ 1: "-", 2: "날짜", 3: "년월", 5: "접수자", 7: "진행중/처리완료/보류/취소" }), mgmtRow({}),
      ...["10월 29일", "10월 30일", "12월 5일", "1월 5일", "5월 5일", "9월 30일", "10월 1일", "10월 28일"].map((b, i) => mgmtRow({ 1: String(1700 + i), 2: b, 5: "박민", 16: "가" })),
    ];
    const rows = parseSheetRows(SHEET_LAYOUTS.mgmt, values, NOW).rows;
    expect(rows.map((r) => r.date)).toEqual(["2025-10-29", "2025-10-30", "2025-12-05", "2026-01-05", "2026-05-05", "2026-09-30", "2026-10-01", "2026-10-28"]);
    const out = listRowsOf(rows, new Map(), "2025-01-01", "2026-10-31");
    expect(out.rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-28"]);
    expect(out.noDate).toBe(0);
  });

  it("사이 달이 없이 '10월 29~31일'이 바로 위에 있으면 연도를 못 넘겨 날짜 모름(noDate) — 그래도 목록에는 안 들어감", () => {
    const mgmtRow = mk(26);
    const values = [
      mgmtRow({ 1: "-", 2: "날짜", 3: "년월", 5: "접수자", 7: "진행중/처리완료/보류/취소" }), mgmtRow({}),
      ...["10월 29일", "10월 31일", "10월 1일", "10월 28일"].map((b) => mgmtRow({ 2: b, 5: "박민" })),
    ];
    const out = listRowsOf(parseSheetRows(SHEET_LAYOUTS.mgmt, values, NOW).rows, new Map(), "2026-10-01", "2026-10-31");
    expect(out.rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-28"]);
    expect(out.noDate).toBe(2);
  });
});

describe("회귀", () => {
  it("openRowsOf 에 copier 0행, 영업 미처리 숫자 그대로(8·9행 — 9행은 9월 보류)", () => {
    const sales = parseSheetRows(SHEET_LAYOUTS.sales, SALES_VALUES, NOW).rows;
    const copier = parseSheetRows(SHEET_LAYOUTS.copier, COPIER_VALUES, NOW).rows;
    const open = openRowsOf([...sales, ...copier], new Map([["sales:7", "rec-1"]]));
    expect(open.filter((r) => r.source === "copier")).toHaveLength(0);
    expect(open.map((r) => r.sheetRow)).toEqual([8, 9]);
  });

  it("remote authorCol·timeCol 추가 뒤에도 linkRows 결과 불변", () => {
    const remoteRow = mk(23);
    const values = [
      remoteRow({ 7: "처리여부", 12: "한조처리" }), remoteRow({}), remoteRow({}), remoteRow({}),
      remoteRow({ 2: "10월 21일", 3: "2610", 4: "11:11", 10: "신동원", 18: "(주)원격회사 본점" }),
    ];
    const rows = parseSheetRows(SHEET_LAYOUTS.remote, values, NOW).rows;
    expect(rows[0]).toMatchObject({ author: "신동원", time: "11:11" });
    const withoutAuthor: ParsedSheetRow[] = rows.map((r) => ({ ...r, author: "", time: undefined }));
    const remotes = [{ id: "rem-1", type: "원격이관", vendor: "원격회사", receipt_date: "2026-10-21", sheet_row: 5 }];
    const a = [...linkRows(rows, [], remotes, "2026-10").entries()];
    const b = [...linkRows(withoutAuthor, [], remotes, "2026-10").entries()];
    expect(a).toEqual([["remote:5", "rem-1"]]);
    expect(a).toEqual(b);
  });
});

// ── 합치기 ──
const sl = (p: Partial<SheetListRow>): SheetListRow => ({
  source: "remote", kind: "원격이관", sheetRow: 10, seq: "1", date: "2026-10-20", author: "지경민", handler: "", state: "", cls: "open",
  vendor: "가", field: "", region: "", summary: "", month: "2026-10", ...p,
});
const app = (p: Partial<ServiceReceptionRow>): ServiceReceptionRow => ({
  id: "x", created_at: "2026-10-20T01:00:00Z", receipt_date: "2026-10-20", author: "김광태", route: "", type: "복합기 AS", vendor: "v",
  asset_no: "", serial: "", model: "", region: "", title: "", symptom: "", paid: "", notes: "", report_text: "", status: "접수", sent_room: "",
  grade: "", receiver_name: "", receiver_phone: "", keyman_info: "", lease_no: "", address: "", ...p,
});

describe("mergeListWithSheet", () => {
  const db = [
    app({ id: "a1", created_at: "2026-10-20T01:00:00Z" }), // KST 10:00
    app({ id: "a2", created_at: "2026-10-21T05:00:00Z", receipt_date: "2026-10-21", type: "영업팀", author: "손영근" }), // KST 14:00
    app({ id: "a3", created_at: "2026-10-19T23:30:00Z", receipt_date: "2026-10-20", type: "IT", author: "지경민" }), // KST 10-20 08:30
  ];
  const sheet = [
    sl({ seq: "1", time: "09:30" }),
    sl({ seq: "2", time: "11:00", kind: "IT" }),
    sl({ source: "sales", kind: "영업팀", seq: "5847", date: "2026-10-21", time: undefined, author: "김수인", cls: "done" }),
    sl({ source: "copier", kind: "복합기 AS", seq: "3", date: "2026-10-22", time: "08:00", author: "김광태", cls: "record" }),
    sl({ source: "mgmt", kind: "경영지원", seq: "1790", date: "2026-10-19", author: "박민", cls: "hold", state: "보류" }),
  ];

  it("앱 3 + 시트 5 → 8줄, 날짜·시각 내림차순, 같은 id 한 번만", () => {
    const out = mergeListWithSheet([...db, db[0]], [...sheet, sheet[0]]);
    expect(out).toMatchObject({ appCount: 3, sheetCount: 5 });
    expect(out.rows).toHaveLength(8);
    expect(out.rows.map((r) => r.id)).toEqual([
      "sheet:copier:2026-10:3", "a2", "sheet:sales:2026-10:5847", "sheet:remote:2026-10:2", "a1", "sheet:remote:2026-10:1", "a3", "sheet:mgmt:2026-10:1790",
    ]);
    expect(new Set(out.rows.map((r) => r.id)).size).toBe(8);
  });

  it("종류 칩 숫자·상태 매핑·접수자별 합(시트 포함)", () => {
    const { rows } = mergeListWithSheet(db, sheet);
    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
    expect(byType).toEqual({ "복합기 AS": 2, 영업팀: 2, IT: 2, 원격이관: 1, 경영지원: 1 });
    const status = Object.fromEntries(rows.filter(isSheetListRow).map((r) => [r.id, r.status]));
    expect(status).toEqual({
      "sheet:remote:2026-10:1": "접수", "sheet:remote:2026-10:2": "접수", "sheet:sales:2026-10:5847": "완료",
      "sheet:copier:2026-10:3": "", "sheet:mgmt:2026-10:1790": "보류",
    });
    const stats = Object.fromEntries(authorStats(rows));
    expect(stats["김광태"]).toMatchObject({ total: 2, cs: 2 });
    expect(stats["지경민"]).toMatchObject({ total: 3, it: 2, remote: 1 });
    expect(stats["손영근"]).toMatchObject({ total: 1, sales: 1 });
    expect(stats["김수인"]).toMatchObject({ total: 1, sales: 1 });
    expect(stats["박민"]).toMatchObject({ total: 1, mgmt: 1 });
    expect(authorStats(rows, { start: "2026-10-20", end: "2026-10-21" }).reduce((n, [, s]) => n + s.total, 0)).toBe(6);
  });

  it("sheetListToListRow: id·시각·상태·표시 칸, 순번 없으면 행 번호, 진행중", () => {
    const r = sheetListToListRow(sl({ seq: "", sheetRow: 77, time: "09:06", state: "진행중", handler: "원격1", summary: "요약" }));
    expect(r).toMatchObject({
      id: "sheet:remote:2026-10:77", receipt_time: "09:06", created_at: "2026-10-20T09:06:00+09:00", status: "진행중", type: "원격이관",
      sheet: true, sheetSource: "remote", sheetRow: 77, sheetSeq: "", sheetCls: "open", sheetHandler: "원격1", symptom: "요약", route: "시트",
    });
    expect(isSheetListRow(r)).toBe(true);
    expect(isSheetListRow(app({}))).toBe(false);
    expect(sheetListRowUrl("copier", 8)).toContain("gid=1181394897&range=A8");
  });
});

describe("보관 표·겹침", () => {
  const tableRow = (p: Partial<SheetTableRow>): SheetTableRow => ({
    source: "remote", month: "2026-10", seq: "1", sheet_row: 5, kind: "원격이관", receipt_date: "2026-10-20", receipt_time: "09:06:00",
    author: "지경민", handler: null, state: "", cls: "open", vendor: "가", first_no: null, field: null, region: null, summary: "요약", reception_id: null, ...p,
  });

  it("tableRowToSheetListRow: 시각 HH:MM, null → 빈칸, 가림", () => {
    const r = tableRowToSheetListRow(tableRow({ source: "copier", kind: "복합기 AS", cls: "record", first_no: "19655", summary: "연락 010-1234-5678" }));
    expect(r).toMatchObject({ source: "copier", kind: "복합기 AS", time: "09:06", cls: "record", firstNo: "19655", handler: "", month: "2026-10", seq: "1" });
    expect(JSON.stringify(r)).not.toContain("1234-5678");
  });

  it("dedupeSheetRows: 같은 (source·month·seq) 는 엣지 우선, 순번 해시 행은 (날짜·접수자·상호)로", () => {
    const edge = [sl({ seq: "1", state: "처리완료", cls: "done" }), sl({ seq: "", sheetRow: 30, vendor: "㈜가나다라마바사" })];
    const table = [
      tableRowToSheetListRow(tableRow({ seq: "1", cls: "open" })),
      tableRowToSheetListRow(tableRow({ seq: "2" })),
      tableRowToSheetListRow(tableRow({ seq: "h:abc123", vendor: "가나다라마바사 지점" })),
      tableRowToSheetListRow(tableRow({ source: "sales", kind: "영업팀", seq: "1" })),
    ];
    const out = dedupeSheetRows(edge, table);
    expect(out.map((r) => `${r.source}:${r.seq}:${r.cls}`)).toEqual(["remote:1:done", "remote::open", "remote:2:open", "sales:1:open"]);
  });
});

describe("fetchSheetListRows", () => {
  afterEach(() => vi.clearAllMocks());
  const on = () => vi.mocked(getConfig).mockResolvedValue({ RECEPTION_SHEET_OPEN_ENABLED: "true" });

  it("스위치 꺼짐 → 부르지 않음, ok:false·rows []", async () => {
    vi.mocked(getConfig).mockResolvedValue({});
    expect(await fetchSheetListRows("2026-10-01", "2026-10-28", "2026-10-28")).toEqual({ rows: [], noDate: 0, errors: [], ok: false });
    expect(invokeEdgeFunction).not.toHaveBeenCalled();
    expect(selectAllRows).not.toHaveBeenCalled();
  });

  it("이번 달만이면 보관 표를 읽지 않고 엣지 목록 모드만", async () => {
    on();
    vi.mocked(invokeEdgeFunction).mockResolvedValue({ ok: true, rows: [sl({}), { source: "x" }], noDate: 2, errors: [] });
    const out = await fetchSheetListRows("2026-10-01", "2026-10-28", "2026-10-28");
    expect(invokeEdgeFunction).toHaveBeenCalledWith("reception-sheet-open", { list: { from: "2026-10-01", to: "2026-10-28" } }, 25_000);
    expect(selectAllRows).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, noDate: 2, errors: [] });
    expect(out.rows).toHaveLength(1);
  });

  it("지난달 구간은 보관 표(조건 reception_id·gone_at null, 2026-10-01 이후), 겹치면 엣지 우선", async () => {
    on();
    vi.mocked(invokeEdgeFunction).mockResolvedValue({ ok: true, rows: [sl({ source: "sales", kind: "영업팀", seq: "5847", date: "2026-10-21", cls: "done" })], noDate: 0, errors: [] });
    vi.mocked(selectAllRows).mockResolvedValue([
      { source: "sales", month: "2026-10", seq: "5847", sheet_row: 9, kind: "영업팀", receipt_date: "2026-10-21", receipt_time: null, author: "", handler: "", state: "", cls: "open", vendor: "", first_no: null, field: "", region: "", summary: "" },
      { source: "copier", month: "2026-10", seq: "3", sheet_row: 10, kind: "복합기 AS", receipt_date: "2026-10-22", receipt_time: "08:00:00", author: "김광태", handler: "", state: "", cls: "record", vendor: "다", first_no: "1", field: "", region: "", summary: "" },
    ]);
    const out = await fetchSheetListRows("2026-09-15", "2026-11-05", "2026-11-05");
    const q = String(vi.mocked(selectAllRows).mock.calls[0][1]);
    expect(vi.mocked(selectAllRows).mock.calls[0][0]).toBe("reception_sheet_rows");
    expect(q).toContain("receipt_date=gte.2026-10-01&receipt_date=lte.2026-10-31");
    expect(q).toContain("reception_id=is.null&gone_at=is.null");
    expect(out.rows.map((r) => `${r.source}:${r.seq}:${r.cls}`)).toEqual(["sales:5847:done", "copier:3:record"]);
    expect(out.ok).toBe(true);
  });

  it("보관 표 없음(42P01) → 엣지 결과만 + errors 한 줄 / 엣지 실패 → ok:false + 안내, 표 줄은 유지", async () => {
    on();
    vi.mocked(invokeEdgeFunction).mockResolvedValue({ ok: true, rows: [sl({})], noDate: 0, errors: [] });
    vi.mocked(selectAllRows).mockRejectedValue(new Error("조회 실패 reception_sheet_rows(404): PGRST205"));
    const a = await fetchSheetListRows("2026-10-01", "2026-11-05", "2026-11-05");
    expect(a.ok).toBe(true);
    expect(a.rows).toHaveLength(1);
    expect(a.errors).toEqual(["지난달 시트 줄 보관 표가 아직 없음(SQL 실행 대기) — 이번 달 시트 줄만 표시"]);

    vi.mocked(invokeEdgeFunction).mockRejectedValue(new Error("서버 함수(reception-sheet-open) 응답 시간 초과"));
    vi.mocked(selectAllRows).mockResolvedValue([
      { source: "remote", month: "2026-10", seq: "9", sheet_row: 9, kind: "IT", receipt_date: "2026-10-30", receipt_time: null, author: "", handler: "", state: "", cls: "open", vendor: "", first_no: null, field: "", region: "", summary: "" },
    ]);
    const b = await fetchSheetListRows("2026-10-01", "2026-11-05", "2026-11-05");
    expect(b.ok).toBe(false);
    expect(b.errors[0]).toContain("시트 접수를 못 읽음 — 앱 접수만 표시");
    expect(b.rows.map((r) => r.kind)).toEqual(["IT"]);
  });
});

describe("개인정보", () => {
  it("전화번호 원문이 SheetListRow(파싱→목록→정규화)에 없음", () => {
    const sales = parseSheetRows(SHEET_LAYOUTS.sales, SALES_VALUES, NOW).rows;
    const copier = parseSheetRows(SHEET_LAYOUTS.copier, COPIER_VALUES, NOW).rows;
    const out = listRowsOf([...sales, ...copier], new Map(), "2026-10-01", "2026-10-31");
    const json = JSON.stringify([out.rows, mergeListWithSheet([], out.rows as SheetListRow[]).rows]);
    expect(json).not.toMatch(/1111-2222|3333-4444|1234-5678/);
  });
});
