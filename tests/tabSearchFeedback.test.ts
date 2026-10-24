/**
 * 탭 검색 사용자 피드백(2026-10-24) 재발 방지.
 *  (1) 점검·AS 탭에 접수·일정이 섞임  (3) 일정으로 처리한 물류(디지털자산 거래소 10/23 납품)가 물류 이력에 없음
 *  (4) 재계약 "어울림스튜디오디자인" 이 업체 "어울림디자인스튜디오" 로 안 걸림  (5) 칭찬 탭 검색칸 없음  (6) 결과 줄 상세(같은 업체 이력)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, selectRows: vi.fn() };
});

import { selectRows } from "../src/supabase";
import { coreNameOf, sameVendorKey, SOURCES, withKeys, type Entity, type SourceResult } from "../src/entity360";
import {
  buildHeadQuery, dedupeLogistics, EXTRA_SOURCES, gatherLogisticsTickets, keepRow, lastEvents, relatedLines, runTabSearch, summaryText,
  TAB_SPECS, tabKeyOf, ticketLogiKind, ticketMatches, ticketVendorOf, toLines, type TabLine,
} from "../src/tabSearch";

const mocked = vi.mocked(selectRows);
afterEach(() => mocked.mockReset());
const dec = (q: unknown) => decodeURIComponent(String(q));
const src = (t: string) => SOURCES.find((s) => s.table === t)!;

// ── (1) ───────────────────────────────────────────────────────
describe("(1) 점검·AS 탭에서 접수·일정 제외", () => {
  it("표·칩·요약 어디에도 service_receptions·as_tickets 가 없다", () => {
    const spec = TAB_SPECS.inspection;
    expect(spec.tables).not.toContain("service_receptions");
    expect(spec.tables).not.toContain("as_tickets");
    expect((spec.chips || []).flatMap((c) => c.tables)).not.toContain("service_receptions");
    expect(spec.summary.map((s) => s.label)).not.toContain("접수");
  });
  it("점검·AS 탭 검색은 접수·일정 표를 조회하지 않는다", async () => {
    mocked.mockResolvedValue([]);
    const e = withKeys({ code: "1", leaseCode: "", name: "무암", names: ["무암"], serials: [], assets: [], core: "무암", query: "무암", leaseRows: [] });
    await runTabSearch(TAB_SPECS.inspection, e);
    const asked = new Set(mocked.mock.calls.map((c) => c[0]));
    expect(asked.has("service_receptions")).toBe(false);
    expect(asked.has("as_tickets")).toBe(false);
  });
});

// ── (3) 디지털자산 거래소 10/23 납품 — 실데이터 모양(2026-10-24 MCP 조회) ───────────
const DAXA_NAME = "디지털자산 거래소 공동협의체";
const daxa: Entity = withKeys({
  code: "2138270281", leaseCode: "23045", name: DAXA_NAME,
  names: [DAXA_NAME, "디지털자산거래소공동협의체(DAXA)", "디지털자산 거래소 공동협의체디지털자산거래소공동협의체"],
  serials: [], assets: [], core: coreNameOf(DAXA_NAME), query: "디지털자산", leaseRows: [],
});
// 캘린더 제목이 100자 근처에서 잘려 고객사 칸이 없다 — 물류 양식 거래처명에도 이 제목이 그대로 들어갔다
const TITLE = "⭐오후 4시반 이후, 각 자리별 IP 현황 사진 참조(노란색 표시 자리는 브라더를 기본 프린터로 하되, 후지도 사용)⭐-납품(일반)/퍼스트/운영";
const ticketDeliver = {
  id: "nv-20261020T023755Z-356@naver106", date: "2026-10-23", scheduleType: "납품철수교체휴가교육", status: "배정", vendor: TITLE, vendor_code: null,
  note: "납품  (일반/장기)\n＃. 특이사항: 각 자리별 IP 현황 사진 참조\n1. 상호명 : 디지털자산 거래소 공동협의체-메인복합기\n2. 날짜 : 10.23(금) 오후 4시반 이후",
};
const ticketSwap = {
  id: "nv-20261020T023442Z-188@naver116", date: "2026-10-23", scheduleType: "납품철수교체휴가교육", status: "배정",
  vendor: "⭐오후 4시반 이후, 각 자리별 IP 현황 사진 참조(노란색 표시 자리는 브라더를 기본 프린터로 하되, 후지도 사용)⭐-교체(일반)/퍼스트/운영", vendor_code: null,
  note: "교체\n1. 날짜 : 10.23(금) 오후 4시반 이후\n4. 상호 : 디지털자산 거래소 공동협의체 (순 20890) - 서브복합기",
};
const ticketDoneSep = {
  id: "nv-0928", date: "2026-09-28", scheduleType: "납품철수교체휴가교육", status: "완료",
  vendor: "점심시간 피해 방문-IT/납품(일반)/퍼스트/운영팀/증설/디지털자산거래소공동협의체(DAXA)/LG그램14인치노트북(새기기)/전자", vendor_code: null, note: "납품 (일반/장기)",
};
const ticketOther = { id: "nv-x", date: "2026-10-20", scheduleType: "납품철수교체휴가교육", status: "완료", vendor: "납품(일반)/퍼스트/운영팀/증설/디지털자산운용/X3220/전자", vendor_code: null, note: "납품\n1. 상호명 : 디지털자산운용" };
const lr85 = { id: 85, 작성일: "2026-10-23", 구분: "납품", 거래처명: TITLE, _업체명: TITLE, 품목: "브라더 8900 1대 제록스 C3530", 작성자: "한왕주", _원문: `작성자: 한왕주\n구분: 납품\n거래처명(지점/현장명 必) : ${TITLE}` };
const ae85 = { id: "f1719d97", activity_date: "2026-10-23", category: "logistics", vendor: TITLE, metadata: { logisticsCategory: "납품" }, author: "한왕주", source_text: "구분: 납품" };

describe("(3) 물류 — 일정으로 처리한 납품도 이력에", () => {
  it("일정 본문 상호명 줄에서 고객사, 첫 줄에서 종류를 꺼낸다(잘린 제목 말고)", () => {
    expect(ticketVendorOf(ticketDeliver)).toBe("디지털자산 거래소 공동협의체-메인복합기");
    expect(ticketLogiKind(ticketDeliver)).toBe("납품");
    expect(ticketLogiKind(ticketSwap)).toBe("교체");
    expect(ticketLogiKind({ vendor: "전일연락필수/철수(일반)/퍼스트/계약종료/탑에프에이/X3220NR/확인서서명필수", note: "" })).toBe("철수");
    expect(ticketMatches(ticketDeliver, daxa)).toBe(true);
    expect(ticketMatches(ticketSwap, daxa)).toBe(true);
    expect(ticketMatches(ticketDoneSep, daxa)).toBe(true);   // 본문 없음 → 제목 슬래시 열차의 고객사
    expect(ticketMatches(ticketOther, daxa)).toBe(false);    // 이름 앞부분만 같은 다른 업체
  });
  it("물류 일정은 완료만 보이고, 활동은 물류 종류만", () => {
    expect(keepRow("logistics", "as_tickets", ticketDeliver)).toBe(false);
    expect(keepRow("logistics", "as_tickets", ticketDoneSep)).toBe(true);
    expect(keepRow("logistics", "activity_events", { category: "inspection" })).toBe(false);
    expect(keepRow("logistics", "activity_events", ae85)).toBe(true);
  });
  it("일정 제목 그대로 거래처명이 적힌 물류 기록·활동을 이 업체 것으로 잇는다(2주 넘게 떨어지면 제외)", async () => {
    mocked.mockImplementation(async (t: string, q: string) => {
      if (t === "as_tickets") return [ticketDeliver, ticketSwap, ticketDoneSep, ticketOther];
      if (t === "logistics_records") return [lr85, { ...lr85, id: 1, 작성일: "2026-06-01" }];
      if (t === "activity_events") return dec(q).includes("category=eq.logistics") ? [ae85] : [];
      return [];
    });
    const { tickets, bridge } = await gatherLogisticsTickets(daxa);
    const ticketQuery = dec(mocked.mock.calls.find((c) => c[0] === "as_tickets")![1]);
    expect(ticketQuery).toContain('scheduleType=in.("물류","납품철수교체휴가교육")');
    expect(ticketQuery).toContain("vendor_code.eq.2138270281");
    expect(ticketQuery).toContain("note.ilike.*디지털자산*");
    expect(tickets.exact.map((r) => r.id)).toEqual([ticketDeliver.id, ticketSwap.id, ticketDoneSep.id]);
    expect(tickets.loose.map((r) => r.id)).toEqual(["nv-x"]);
    expect(bridge.logistics_records.map((r) => r.id)).toEqual([85]);
    expect(bridge.activity_events.map((r) => r.id)).toEqual(["f1719d97"]);
  });
  it("물류 탭 한 번 → 10/23 납품이 한 줄(물류 기록·활동 중복 묶음), 9/28 완료 일정 납품도 보임, 배정 일정은 안 보임", async () => {
    mocked.mockImplementation(async (t: string, q: string) => {
      const d = dec(q);
      if (t === "as_tickets") return [ticketDeliver, ticketSwap, ticketDoneSep];
      // 업체명으로 찾는 조회(gather)에는 안 걸린다 — 거래처명이 일정 제목이라서(원인)
      if (t === "logistics_records") return d.includes(TITLE) ? [lr85] : [];
      if (t === "activity_events") return d.includes(TITLE) ? [ae85] : [];
      return [];
    });
    const results = await runTabSearch(TAB_SPECS.logistics, daxa);
    const lines = toLines("logistics", results, daxa).filter((l) => !l.loose);
    const oct23 = lines.filter((l) => l.date === "2026-10-23");
    expect(oct23.map((l) => [l.table, l.logiKind])).toEqual([["logistics_records", "납품"]]);
    expect(oct23[0].vendor).toBe("디지털자산 거래소 공동협의체-메인복합기");
    expect(oct23[0].otherVendor).toBe("");
    expect(lines.some((l) => l.table === "as_tickets" && l.date === "2026-09-28" && /납품 완료/.test(l.title))).toBe(true);
    expect(summaryText(lastEvents(TAB_SPECS.logistics, lines))).toBe("마지막 납품 2026-10-23 · 철수 없음 · 교체 없음");
  });
  it("중복 묶음: 같은 날·같은 종류는 물류 기록 > 일정 > 활동, 종류가 다르면 따로", () => {
    const L = (table: string, key: string, logiKind: string, date = "2026-10-23"): TabLine => ({
      key, table, kind: table, tone: "", date, title: logiKind, detail: "", author: "", team: "", device: "", raw: "", loose: false, otherVendor: "", vendor: "", logiKind,
    });
    const out = dedupeLogistics([L("activity_events", "a", "납품"), L("as_tickets", "t", "납품"), L("logistics_records", "r", "납품"), L("as_tickets", "t2", "교체"), L("lease_status", "s", "")]);
    expect(out.map((l) => l.key)).toEqual(["r", "t2", "s"]);
  });
});

// ── (4) 재계약 — 낱말 순서가 바뀐 업체명 ───────────────────────────
describe("(4) 재계약 어울림스튜디오디자인 이 어울림디자인스튜디오 로 찾아진다", () => {
  const e = withKeys({ code: "7422900390", leaseCode: "18445", name: "어울림디자인스튜디오", names: ["어울림디자인스튜디오"], serials: [], assets: [], core: coreNameOf("어울림디자인스튜디오"), query: "어울림디자인", leaseRows: [] });
  it("같은 글자 구성(6자 이상)이면 같은 업체, 아니면 아님", () => {
    expect(sameVendorKey("어울림디자인스튜디오", "어울림스튜디오디자인")).toBe(true);
    expect(sameVendorKey("어울림디자인스튜디오", "어울림에프")).toBe(false);
    expect(sameVendorKey("가나다라", "라다나가")).toBe(false); // 짧은 이름은 우연히 같을 수 있어 안 본다
  });
  it("정확·느슨이 0건이면 핵심 이름 앞 3글자로 한 번 더 찾고, 같은 업체는 정확으로", async () => {
    expect(dec(buildHeadQuery(src("recontract"), e))).toContain('"_업체명".ilike.*어울림*');
    mocked.mockImplementation(async (t: string, q: string) => {
      if (t !== "recontract") return [];
      return dec(q).includes("ilike.*어울림*") ? [{ id: 3536, _업체명: "어울림스튜디오디자인", 업체명: "어울림스튜디오디자인", 날짜: "2026-10-22", 갱신상태: "제안완료" }, { id: 9, _업체명: "어울림에프" }] : [];
    });
    const results = await runTabSearch(TAB_SPECS.recontract, e);
    const r = results.find((x) => x.source.table === "recontract")!;
    expect(r.exact.map((x) => x.id)).toEqual([3536]);
    expect(r.loose.map((x) => x.id)).toEqual([9]);
    expect(summaryText(lastEvents(TAB_SPECS.recontract, toLines("recontract", results, e)))).toBe("마지막 재계약 2026-10-22");
  });
  it("한 번 더 찾기가 실패하면 없음이 아니라 실패로 알린다", async () => {
    mocked.mockImplementation(async (t: string, q: string) => {
      if (t === "recontract" && dec(q).includes("ilike.*어울림*")) throw new Error("조회 실패 recontract(500): boom");
      return [];
    });
    const results = await runTabSearch(TAB_SPECS.recontract, e);
    expect(results.find((x) => x.source.table === "recontract")!.ok).toBe(false);
  });
});

// ── (5) 칭찬 탭 ───────────────────────────────────────────────
describe("(5) 칭찬 탭 검색 = 고객 칭찬(field_sheet_sync_jobs category=praise)", () => {
  it("칭찬 탭에 검색칸, 칭찬 표만 조회, 날짜·이유는 payload 에서", async () => {
    expect(tabKeyOf("praise")).toBe("praise");
    expect(EXTRA_SOURCES.some((s) => s.table === "field_sheet_sync_jobs")).toBe(true);
    mocked.mockImplementation(async (_t: string, q: string) => (dec(q).includes("ilike") ? [] : [{ id: "p1", vendor: "한국에스엠에이", author: "박영현", created_at: "2026-10-22T23:49:46Z", praise_date: "2026-10-22", praise_reason: "AS 서비스 만족", source_text: "[칭찬] 한국에스엠에이" }]));
    const e = withKeys({ code: "", leaseCode: "", name: "한국에스엠에이", names: ["한국에스엠에이"], serials: [], assets: [], core: "한국에스엠에이", query: "한국에스엠에이", leaseRows: [] });
    const results = await runTabSearch(TAB_SPECS.praise, e);
    expect(new Set(mocked.mock.calls.map((c) => c[0]))).toEqual(new Set(["field_sheet_sync_jobs"]));
    const q = dec(mocked.mock.calls[0][1]);
    expect(q).toContain("category=eq.praise");
    expect(q).toContain("praise_date:payload->data->>date");
    const lines = toLines("praise", results, e);
    expect(lines[0]).toMatchObject({ date: "2026-10-22", title: "칭찬 — AS 서비스 만족", author: "박영현" });
  });
});

// ── (6) 상세 ─────────────────────────────────────────────────
describe("(6) 결과 줄 상세 — 같은 업체 같은 종류 최근 5건·주민번호 가림", () => {
  const e = withKeys({ code: "1", leaseCode: "", name: "주식회사 무암", names: ["주식회사 무암"], serials: [], assets: [], core: "무암", query: "무암", leaseRows: [] });
  const jeom = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, 작성일: `2026-09-${String(10 + i).padStart(2, "0")}`, 처리내용: `점검 ${i + 1}`, _업체명: "주식회사 무암", _원문: i === 7 ? "대표 900101-1234567" : "" }));
  const res = (t: string, exact: Record<string, unknown>[], loose: Record<string, unknown>[] = []): SourceResult => ({ source: src(t), exact, loose, ok: true });
  const lines = toLines("inspection", [res("jeomgeom", jeom, [{ id: 99, 작성일: "2026-09-30", 처리내용: "다른 곳", _업체명: "무암건설" }]), res("as_records", [{ id: 50, 작성일: "2026-09-29", 내용: "용지걸림", _업체명: "주식회사 무암" }])], e);
  it("자기 자신 빼고 같은 종류(점검)·정확 일치만 최신순 5건", () => {
    const top = lines.find((l) => l.key === "jeomgeom:8")!;
    expect(relatedLines(lines, top).map((l) => l.key)).toEqual(["jeomgeom:7", "jeomgeom:6", "jeomgeom:5", "jeomgeom:4", "jeomgeom:3"]);
  });
  it("이름 일부 일치 줄은 같은 이름의 이름 일부 일치끼리만", () => {
    const loose = lines.find((l) => l.key === "jeomgeom:99")!;
    expect(relatedLines(lines, loose)).toEqual([]);
  });
  it("펼침에 쓰는 업체·원문도 주민번호 가림", () => {
    const top = lines.find((l) => l.key === "jeomgeom:8")!;
    expect(top.raw).toBe("대표 900101-1******");
    expect(top.vendor).toBe("주식회사 무암");
  });
});
