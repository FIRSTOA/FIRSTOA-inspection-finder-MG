import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEPT_FIELD_CHIPS, DEPT_SHEET_CATEGORY, aggregateVendor, ageDays, boardBuckets, buildDeptReceptionRow, buildDeptSheetPayload,
  buildDeptTitle, DEPT_LABEL, defaultHandler, deptDupKey, deptListState, deptMissing, deptShort, isDeptType, isStaleRemote, normalizeRegion,
  scheduledOverdue, weekCompletionRate, type DeptReceptionInput,
} from "../src/deptReception";

const base: DeptReceptionInput = {
  dept: "영업팀", author: "김수인", route: "전화", vendor: "퍼스트오에이", leaseNo: "1234", grade: "S",
  region: "수도권 c", field: "렌탈문의", content: "복합기 한 대 추가 렌탈 문의\n견적 요청", receiverName: "홍길동", receiverPhone: "010-1111-2222",
};

describe("부서 종류·상수", () => {
  it("isDeptType·deptShort·시트 category", () => {
    expect(isDeptType("경영지원")).toBe(true);
    expect(isDeptType("복합기 AS")).toBe(false);
    expect(deptShort("영업팀")).toBe("영업");
    expect(deptShort("IT")).toBe("IT");
    expect(DEPT_SHEET_CATEGORY.운영지원).toBeNull();
    expect(DEPT_SHEET_CATEGORY.영업팀).toBe("reception_sales");
    expect(DEPT_LABEL.영업팀).toBe("전략영업"); // 표시만 — DB 값은 영업팀 그대로
    expect(buildDeptReceptionRow(base).type).toBe("영업팀");
    expect(DEPT_SHEET_CATEGORY.경영지원).toBe("reception_mgmt");
  });
  it("접수분야 칩 수(영업·경영 13 + 기타, 운영 4)", () => {
    expect(DEPT_FIELD_CHIPS.영업팀).toHaveLength(14);
    expect(DEPT_FIELD_CHIPS.경영지원).toHaveLength(14);
    expect(DEPT_FIELD_CHIPS.운영지원).toEqual(["소모품", "배송/택배", "설치", "기타"]);
  });
});

describe("normalizeRegion", () => {
  it.each([
    ["수도권A", "A"], ["수도권 a", "A"], ["수도권b", "B"], ["수도권 C", "C"], ["수도권c", "C"], ["C", "C"], ["d", "D"],
    ["수도권D", "D"], ["수도권E", "E"], ["C지역", "C"], [" 수도권  B ", "B"],
    ["강원도", "지방"], ["경상도", "지방"], ["전라도", "지방"], ["제주도", "지방"], ["충청도", "지방"], ["지방", "지방"],
    ["신규", ""], ["", ""], ["미정", ""], ["강남", "C"], ["경기", "D"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeRegion(input)).toBe(expected);
  });
  it("null·undefined", () => {
    expect(normalizeRegion(null)).toBe("");
    expect(normalizeRegion(undefined)).toBe("");
  });
});

describe("defaultHandler", () => {
  it("영업: 지역별 담당, 미정은 박진영", () => {
    expect(defaultHandler("영업팀", "수도권A")).toBe("이찬우");
    expect(defaultHandler("영업팀", "B")).toBe("박민");
    expect(defaultHandler("영업팀", "수도권c")).toBe("이정현");
    expect(defaultHandler("영업팀", "수도권D")).toBe("김수인");
    expect(defaultHandler("영업팀", "경상도")).toBe("김수인");
    expect(defaultHandler("영업팀", "")).toBe("박진영");
  });
  it("경영: C는 빈값, D/E 김슬기 / 운영: 빈값", () => {
    expect(defaultHandler("경영지원", "A")).toBe("이윤아");
    expect(defaultHandler("경영지원", "수도권B")).toBe("박수민");
    expect(defaultHandler("경영지원", "C")).toBe("");
    expect(defaultHandler("경영지원", "E")).toBe("김슬기");
    expect(defaultHandler("경영지원", "")).toBe("");
    expect(defaultHandler("운영지원", "A")).toBe("");
  });
});

describe("buildDeptReceptionRow", () => {
  it("필수값·컬럼·remote_meta 구조", () => {
    const row = buildDeptReceptionRow({ ...base, outside: true, scheduleDate: "2026-10-25" });
    expect(row.type).toBe("영업팀");
    expect(row.route).toBe("전화");
    expect(row.region).toBe("수도권C");
    expect(row.lease_no).toBe("1234");
    expect(row.first_no).toBe("1234");
    expect(row.field).toBe("렌탈문의");
    expect(row.title).toBe("렌탈문의 · 복합기 한 대 추가 렌탈 문의");
    expect(row.symptom).toContain("견적 요청");
    expect(row.status).toBe("접수");
    expect(row.report_text).toContain("[전략영업 접수]");
    expect(row.remote_meta).toEqual({
      handler: "이정현", via: "", outside: "외근요청", contract_kind: "", progress: "", handled: "", sheet_seq: "",
      sheet_state: "queued", schedule_date: "2026-10-25", calendar_id: "", kakao: "", vendor_code: "",
    });
    Object.values(row.remote_meta).forEach((v) => expect(typeof v).toBe("string"));
  });
  it("사내 요청은 이름 필수, 경영 계약서구분, 운영은 시트 none", () => {
    expect(() => buildDeptReceptionRow({ ...base, route: "사내" })).toThrow(/사내 요청자/);
    const mg = buildDeptReceptionRow({ ...base, dept: "경영지원", route: "사내", via: "이정현", contractKind: "전자", handler: "최영지" });
    expect(mg.remote_meta.via).toBe("이정현");
    expect(mg.remote_meta.contract_kind).toBe("전자");
    expect(mg.remote_meta.handler).toBe("최영지");
    const op = buildDeptReceptionRow({ ...base, dept: "운영지원", contractKind: "전자" });
    expect(op.remote_meta.sheet_state).toBe("none");
    expect(op.remote_meta.contract_kind).toBe("");
  });
  it("신규(순 없음)·빈 필수값", () => {
    const row = buildDeptReceptionRow({ ...base, leaseNo: "", region: "신규" });
    expect(row.lease_no).toBe("");
    expect(row.region).toBe("");
    expect(row.remote_meta.handler).toBe("박진영");
    expect(deptMissing({ dept: "영업팀" })).toEqual(["업체", "접수유형", "접수분야", "접수내용", "접수자"]);
    expect(() => buildDeptReceptionRow({ ...base, content: "  " })).toThrow(/접수내용/);
  });
  it("제목은 분야 · 첫 줄 30자", () => {
    expect(buildDeptTitle("청구관련", "\n" + "가".repeat(40))).toBe(`청구관련 · ${"가".repeat(30)}`);
  });
});

describe("시트 payload·dupKey", () => {
  it("사내 요청은 접수유형에 이름, KST 날짜 형식", () => {
    const row = buildDeptReceptionRow({ ...base, dept: "경영지원", route: "사내", via: "박민", contractKind: "수기" });
    const p = buildDeptSheetPayload({ ...row, id: "abc", created_at: "2026-10-18T23:30:00Z" }); // KST 10/19 08:30
    expect(p.receiptDate).toBe("10월 19일");
    expect(p.receiptTime).toBe("08:30");
    expect(p.receiptYm).toBe("2610");
    expect(p.routeLabel).toBe("박민");
    expect(p.contractKind).toBe("수기");
    expect(p.state).toBe("진행중");
    expect(p.leaseNo).toBe("1234");
    expect(p.route).toBe("사내"); expect(p.via).toBe("박민"); expect(p.status).toBe("접수"); expect(p.receiverName).toBe("홍길동"); expect(p.symptom).toContain("견적");
    for (const k of ["author", "handler", "progress", "field", "contactName", "contactPhone", "content", "notes", "outing", "vendor", "region", "grade", "address"]) expect(p).toHaveProperty(k);
  });
  it("같은 날·업체·분야·내용이면 같은 키", () => {
    const a = deptDupKey({ receipt_date: "2026-10-19", vendor: "가", field: "렌탈문의", symptom: "x" });
    expect(a).toBe(deptDupKey({ receipt_date: "2026-10-19", vendor: " 가 ", field: "렌탈문의", symptom: "x" }));
    expect(a).not.toBe(deptDupKey({ receipt_date: "2026-10-20", vendor: "가", field: "렌탈문의", symptom: "x" }));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("보드·통계", () => {
  const rows = [
    { id: "1", status: "접수", receipt_date: "2026-10-19", created_at: "b" },
    { id: "2", status: "보류", receipt_date: "2026-10-14", created_at: "a" },
    { id: "3", status: "취소", receipt_date: "2026-10-20" },
    { id: "4", status: "완료", receipt_date: "2026-10-21" },
    { id: "5", status: "진행중", receipt_date: "2026-10-12" },
    { id: "6", status: "원격대기", receipt_date: "2026-10-01" },
    { id: "7", status: "접수", receipt_date: "2026-10-17" },
  ];
  it("deptListState·boardBuckets(보류→진행중, 취소→완료, 오래된 순)", () => {
    expect(deptListState({ status: "보류" })).toBe("진행중");
    expect(deptListState({ status: "취소" })).toBe("완료");
    const b = boardBuckets(rows);
    expect(b.접수.map((r) => r.id)).toEqual(["6", "7", "1"]);
    expect(b.진행중.map((r) => r.id)).toEqual(["5", "2"]);
    expect(b.완료.map((r) => r.id)).toEqual(["3", "4"]);
  });
  it("weekCompletionRate: 2026-10-19(월)~25(일)", () => {
    expect(weekCompletionRate(rows, "2026-10-22")).toEqual({ total: 3, done: 2, rate: 2 / 3 });
    expect(weekCompletionRate(rows, "2026-10-25")).toEqual({ total: 3, done: 2, rate: 2 / 3 });
    expect(weekCompletionRate([], "2026-10-22")).toEqual({ total: 0, done: 0, rate: 0 });
  });
  it("ageDays", () => {
    expect(ageDays("2026-10-19", "2026-10-19")).toBe(0);
    expect(ageDays("2026-09-30", "2026-10-19")).toBe(19);
    expect(ageDays("", "2026-10-19")).toBe(0);
  });
  it("scheduledOverdue", () => {
    expect(scheduledOverdue({ status: "접수", remote_meta: { schedule_date: "2026-10-18" } }, "2026-10-19")).toBe(true);
    expect(scheduledOverdue({ status: "완료", remote_meta: { schedule_date: "2026-10-18" } }, "2026-10-19")).toBe(false);
    expect(scheduledOverdue({ status: "보류", remote_meta: { schedule_date: "2026-10-19" } }, "2026-10-19")).toBe(false);
    expect(scheduledOverdue({ status: "접수", remote_meta: {} }, "2026-10-19")).toBe(false);
  });
});

describe("aggregateVendor", () => {
  it("등급·지역 최빈, 임대중·계약 전체 수, 첫 주소, 숨김 제외", () => {
    const agg = aggregateVendor([
      { 등급: "S", 주소상세주소: "", 임대여부: "임대중", _raw: { "관리 담당자": "수도권c" } },
      { 등급: "SS", 주소상세주소: "서울 강남구 1", 임대여부: "종료", _raw: { "관리 담당자": "수도권C" } },
      { 등급: "S", 주소상세주소: "서울 강남구 2", _raw: { "관리 담당자": "수도권A", 임대여부: "임대중" } },
      { 등급: "V", _hidden: true, 임대여부: "임대중", _raw: { "관리 담당자": "수도권A" } },
      { 등급: "V", _hidden: true },
    ]);
    // 임대중 2(컬럼 1 + _raw 1, 숨김 제외) · 계약 전체 3(종료 포함, 숨김 제외)
    expect(agg).toEqual({ grade: "S", region: "C", leasingCount: 2, totalCount: 3, address: "서울 강남구 1" });
  });
});

describe("API (fetch 모킹)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("saveDeptReception 은 insert 한 번뿐 — 웹푸시(push-send)를 부르지 않는다", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify([{ id: "11111111-1111-1111-1111-111111111111" }]), { status: 201 });
    }));
    const { saveDeptReception } = await import("../src/deptReceptionApi");
    const id = await saveDeptReception(buildDeptReceptionRow(base));
    expect(id).toBe("11111111-1111-1111-1111-111111111111");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/rest\/v1\/service_receptions$/);
    expect(calls.some((u) => u.includes("push-send") || u.includes("/functions/"))).toBe(false);
  });

  it("sendDeptReceptionKakao: 방 매핑 없으면 no_room, outbox 에 쌓지 않는다", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/app_config")) return new Response(JSON.stringify([{ key: "TEST_MODE", value: "false" }]), { status: 200 });
      if (u.includes("/room_map")) return new Response(JSON.stringify([{ category: "IT접수", region: "*", room: "IT방" }]), { status: 200 });
      return new Response("", { status: 201 });
    }));
    const { sendDeptReceptionKakao } = await import("../src/deptReceptionApi");
    expect(await sendDeptReceptionKakao("경영지원", "본문")).toEqual({ kakao: "no_room", room: "" });
    expect(calls.some((u) => u.includes("/outbox"))).toBe(false);
  });

  it("sendDeptReceptionKakao: 매핑 있으면 그 방으로 sent", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/app_config")) return new Response(JSON.stringify([{ key: "TEST_MODE", value: "false" }]), { status: 200 });
      if (u.includes("/room_map")) return new Response(JSON.stringify([{ category: "영업접수", region: "*", room: "영업방" }]), { status: 200 });
      if (u.includes("/outbox") && init?.method === "POST") { bodies.push(String(init.body)); return new Response("", { status: 201 }); }
      return new Response("[]", { status: 200 });
    }));
    const { sendDeptReceptionKakao } = await import("../src/deptReceptionApi");
    expect(await sendDeptReceptionKakao("영업팀", "본문")).toEqual({ kakao: "sent", room: "영업방" });
    expect(JSON.parse(bodies[0])).toEqual({ room: "영업방", text: "본문" });
  });
});

describe("isStaleRemote", () => {
  it("원격대기가 접수일 7일을 넘으면 true, 7일 이내면 false", () => {
    expect(isStaleRemote({ type: "원격이관", status: "원격대기", receipt_date: "2026-10-12" }, "2026-10-20")).toBe(true);
    expect(isStaleRemote({ type: "원격이관", status: "원격대기", receipt_date: "2026-10-13" }, "2026-10-20")).toBe(false);
  });
  it("다른 종류·다른 상태는 오래돼도 false", () => {
    expect(isStaleRemote({ type: "원격이관", status: "접수", receipt_date: "2026-08-25" }, "2026-10-20")).toBe(false);
    expect(isStaleRemote({ type: "IT", status: "원격대기", receipt_date: "2026-08-25" }, "2026-10-20")).toBe(false);
  });
});
