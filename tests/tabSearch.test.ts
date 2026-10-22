import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, selectRows: vi.fn() };
});

import { selectRows } from "../src/supabase";
import { gather, SOURCES, withKeys, type Entity, type SourceResult } from "../src/entity360";
import {
  coverageOf, EXTRA_SOURCES, filterByChip, gatherExtra, keepRow, lastEvents, maskRrn, maxRequestsOf, runTabSearch, sourcesOf, summaryText,
  TAB_SPECS, tabKeyOf, toLines, type TabResult,
} from "../src/tabSearch";

const mocked = vi.mocked(selectRows);
afterEach(() => mocked.mockReset());

const entity: Entity = withKeys({ code: "1234567890", leaseCode: "21462", name: "주식회사 무암", names: ["주식회사 무암"], serials: ["ZPBLBJST8000GQV"], assets: ["A5571"], core: "무암", query: "무암", leaseRows: [] });
const src = (t: string) => SOURCES.find((s) => s.table === t)!;
const res = (t: string, exact: Record<string, unknown>[], loose: Record<string, unknown>[] = []): SourceResult => ({ source: src(t), exact, loose, ok: true });

describe("gather — 통합 검색 360 무회귀", () => {
  it("인자 없이 부르면 SOURCES 표 전부(일정 메모 포함)를 같은 순서로 돌려준다", async () => {
    mocked.mockResolvedValue([]);
    const out = await gather(entity);
    expect(out.map((r) => r.source.table)).toEqual([...SOURCES.filter((s) => s.table !== "plan_memos").map((s) => s.table), "plan_memos"]);
    const asked = new Set(mocked.mock.calls.map((c) => c[0]));
    // 표에 조건이 하나도 안 맞는 counter_sms_targets 처럼 조회 안 하는 표가 있어도, 조회한 표는 모두 SOURCES 안
    asked.forEach((t) => expect(SOURCES.some((s) => s.table === t) || t === "workin_vendor_code").toBe(true));
    expect(asked.has("jeomgeom")).toBe(true);
    expect(asked.has("recontract")).toBe(true);
  });
  it("{ only } 면 그 표만 조회하고 plan_memos 는 붙이지 않는다", async () => {
    mocked.mockResolvedValue([]);
    const out = await gather(entity, { only: ["logistics_records", "lease_status", "vendor_info"] });
    expect(out.map((r) => r.source.table)).toEqual(["vendor_info", "lease_status", "logistics_records"]);
    const asked = new Set(mocked.mock.calls.map((c) => c[0]));
    expect([...asked].sort()).toEqual(["lease_status", "logistics_records", "vendor_info"]);
  });
  it("표 하나가 실패해도 나머지는 그대로(ok:false)", async () => {
    mocked.mockImplementation(async (t: string) => { if (t === "as_records") throw new Error("조회 실패 as_records(500): x"); return [{ id: 1, 작성일: "2026-09-01" }]; });
    const out = await gather(entity, { only: ["jeomgeom", "as_records"] });
    expect(out.find((r) => r.source.table === "as_records")!.ok).toBe(false);
    expect(out.find((r) => r.source.table === "jeomgeom")!.exact.length).toBe(1);
  });
});

describe("탭 → 표", () => {
  it("필드 탭 mode 를 검색 탭으로, 칭찬·테스트는 숨김(null)", () => {
    expect(tabKeyOf("inspection")).toBe("inspection");
    expect(tabKeyOf("blank-report")).toBe("inspection");
    expect(tabKeyOf("air-purifier")).toBe("air");
    expect(tabKeyOf("pc", "it")).toBe("it");
    expect(tabKeyOf("pc", "copier")).toBe("copier-exp");
    expect(tabKeyOf("pc", "bo")).toBeNull();
    expect(tabKeyOf("praise")).toBeNull();
    expect(tabKeyOf("overage-adjust")).toBe("overage");
  });
  it("모든 탭의 표가 SOURCES 또는 EXTRA_SOURCES 에 있다(오타 방지)", () => {
    Object.values(TAB_SPECS).forEach((spec) => {
      expect(sourcesOf(spec).length).toBe(spec.tables.length + (spec.extra || []).length);
      spec.summary.forEach((k) => k.tables.forEach((t) => expect([...spec.tables, ...(spec.extra || [])]).toContain(t)));
    });
    expect(EXTRA_SOURCES.some((s) => SOURCES.some((x) => x.table === s.table))).toBe(false);
  });
  it("조회 요청 수 상한 — 점검·AS 5표 = 15, 미수 = misu 3 + misu_visits 2", () => {
    expect(maxRequestsOf(TAB_SPECS.inspection)).toBe(15);
    expect(maxRequestsOf(TAB_SPECS.misu)).toBe(5);
  });
});

describe("거르기·줄·요약", () => {
  it("주민번호 모양만 가린다(전화·긴 숫자는 그대로)", () => {
    expect(maskRrn("대표 900101-1234567 연락")).toBe("대표 900101-1****** 연락");
    // 2026-10-22: 이름표 없는 13자리는 기기 시리얼(8001104…)과 구별이 안 돼 그대로 둔다 — 이름표가 있으면 가린다(tests/privacy.test.ts)
    expect(maskRrn("9001012234567")).toBe("9001012234567");
    expect(maskRrn("주민번호 9001012234567")).toBe("주민번호 900101-2******");
    expect(maskRrn("010-1234-5678")).toBe("010-1234-5678");
    expect(maskRrn("12345678901234")).toBe("12345678901234");
    expect(maskRrn("900101-5234567")).toBe("900101-5234567");
  });
  it("청정기·교체·방문기록(점검)을 거른다", () => {
    expect(keepRow("air", "jeomgeom", { 모델명: "블루스카이 5000" })).toBe(true);
    expect(keepRow("air", "jeomgeom", { 모델명: "SL-X7400" })).toBe(false);
    expect(keepRow("replacement", "lease_status", { 구분: "교체" })).toBe(true);
    expect(keepRow("replacement", "lease_status", { 구분: "신규납품" })).toBe(false);
    expect(keepRow("inspection", "visit_logs", { work_kinds: "AS" })).toBe(false);
    expect(keepRow("inspection", "visit_logs", { work_kinds: "점검,AS" })).toBe(true);
    expect(keepRow("logistics", "lease_status", { 구분: "신규" })).toBe(true);
  });
  it("한 줄 타임라인: 최신 위, 원문 주민번호 가림, 이름 일부 일치 표시", () => {
    const lines = toLines("inspection", [
      res("jeomgeom", [{ id: 1, 작성일: "2026.9.14", 처리내용: "정기점검", 작성자: "이민구", _원문: "고객 900101-1234567" }]),
      res("as_records", [{ id: 2, 작성일: "2026-10-02", 내용: "용지걸림" }], [{ id: 3, 작성일: "2026-10-05", 내용: "다른 곳", _업체명: "무암건설" }]),
    ], entity);
    expect(lines.map((l) => l.key)).toEqual(["as_records:3", "as_records:2", "jeomgeom:1"]);
    expect(lines.find((l) => l.key === "jeomgeom:1")!.raw).toBe("고객 900101-1******");
    expect(lines.find((l) => l.key === "as_records:3")!.loose).toBe(true);
    expect(filterByChip(lines, TAB_SPECS.inspection, "jeom").map((l) => l.key)).toEqual(["jeomgeom:1"]);
    expect(filterByChip(lines, TAB_SPECS.inspection, "all").length).toBe(3);
  });
  it("요약 = 그 탭 종류의 마지막 사건(정확 일치만, 건수 없음)", () => {
    const lines = toLines("logistics", [
      res("logistics_records", [{ id: 1, 작성일: "2025-03-10", 구분: "납품" }, { id: 2, 작성일: "2026-02-04", 구분: "교체" }], [{ id: 9, 작성일: "2026-05-01", 구분: "철수" }]),
    ], entity);
    expect(summaryText(lastEvents(TAB_SPECS.logistics, lines))).toBe("마지막 납품 2025-03-10 · 철수 없음 · 마지막 교체 2026-02-04");
  });
  it("어디까지 찾았나 — 성공·실패·표 없음·원문 건너뜀", () => {
    const results: TabResult[] = [
      res("misu", []),
      { source: EXTRA_SOURCES[0], exact: [], loose: [], ok: true, missing: true },
      { source: src("jeomgeom"), exact: [], loose: [], ok: false, error: "x" },
      { source: src("as_records"), exact: [], loose: [], ok: true, rawSkipped: true },
    ];
    expect(coverageOf(results)).toEqual({ searched: ["미수", "AS"], failed: ["점검"], missing: ["미수 방문"], rawSkipped: ["AS"] });
  });
});

describe("덧붙인 표(misu_visits)", () => {
  it("표가 없으면(404) 실패가 아니라 '표 없음'으로 건너뛴다", async () => {
    mocked.mockRejectedValue(new Error("조회 실패 misu_visits(404): PGRST205"));
    const r = await gatherExtra(EXTRA_SOURCES[0], entity);
    expect(r.ok).toBe(true);
    expect(r.missing).toBe(true);
  });
  it("다른 오류는 ok:false — 화면이 실패 줄을 보인다", async () => {
    mocked.mockRejectedValue(new Error("조회 실패 misu_visits(500): boom"));
    expect((await gatherExtra(EXTRA_SOURCES[0], entity)).ok).toBe(false);
  });
  it("정확 조건은 거래처코드·이름, 느슨 결과 중 같은 업체 키는 정확으로 승격", async () => {
    mocked.mockImplementation(async (_t: string, q: string) => (q.includes("ilike") ? [{ id: "b", vendor: "무암" }, { id: "c", vendor: "무암건설" }] : [{ id: "a", vendor: "주식회사 무암" }]));
    const r = await gatherExtra(EXTRA_SOURCES[0], entity);
    expect(String(mocked.mock.calls[0][1])).toContain("company_code.eq.1234567890");
    expect(r.exact.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.loose.map((x) => x.id)).toEqual(["c"]);
  });
  it("미수 탭 한 번 = misu(gather) + misu_visits 병렬, 결과에 둘 다", async () => {
    mocked.mockResolvedValue([]);
    const out = await runTabSearch(TAB_SPECS.misu, entity);
    expect(out.map((r) => r.source.table)).toEqual(["misu", "misu_visits"]);
  });
});
