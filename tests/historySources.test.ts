// 2026-10-24 개선 목록 C4·C5 — 미수 방문(misu_visits)·물류(logistics_records)가 통합 검색 360·통합이력에 나온다
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, selectRows: vi.fn(), rpc: vi.fn() };
});

import { rpc, selectRows } from "../src/supabase";
import { gather, MISU_VISITS_SOURCE, toEvent, withKeys, type Entity } from "../src/entity360";
import { EXTRA_SOURCES } from "../src/tabSearch";
import { getVendorHistoryDetail } from "../src/api";

const sel = vi.mocked(selectRows);
const rpcMock = vi.mocked(rpc);
afterEach(() => { sel.mockReset(); rpcMock.mockReset(); });

const entity: Entity = withKeys({ code: "1234567890", leaseCode: "21462", name: "주식회사 무암", names: ["주식회사 무암"], serials: [], assets: [], core: "무암", query: "무암", leaseRows: [] });

const MISU_ROW = { id: "u1", visited_at: "2026-10-20T03:00:00+00:00", visit_round: "1차 안내", judgment: "계속 독촉", vendor: "주식회사 무암", author: "홍길동", region: "C", dun_reply: "주민번호 900101-1234567 로 확인", created_at: "2026-10-20T03:01:00+00:00" };
const LOGI_ROW = { id: 7, 작성일: "2026-10-21", 작성자: "홍길동", 구분: "납품", 거래처명: "주식회사 무암", 품목: "토너", 수량: "2", _업체명: "주식회사 무암", _dupKey: "k7" };

describe("통합 검색 360 gather — 미수 방문·물류 포함", () => {
  it("인자 없이 부르면 misu_visits·logistics_records 둘 다 결과에 있다", async () => {
    sel.mockImplementation(async (table: string) => (table === "misu_visits" ? [MISU_ROW] : table === "logistics_records" ? [LOGI_ROW] : []) as never);
    const out = await gather(entity);
    const misu = out.find((r) => r.source.table === "misu_visits");
    const logi = out.find((r) => r.source.table === "logistics_records");
    expect(misu?.exact.length).toBe(1);
    expect(logi?.exact.length).toBe(1);
    // 미수 방문 조회는 업체명·거래처코드(company_code)로
    const misuQueries = sel.mock.calls.filter((c) => c[0] === "misu_visits").map((c) => String(c[1]));
    expect(misuQueries.some((q) => q.includes("company_code"))).toBe(true);
  });
  it("{ only } 에 없으면 미수 방문을 조회하지 않는다(탭 검색은 따로 모음 — 두 번 조회 방지)", async () => {
    sel.mockResolvedValue([]);
    const out = await gather(entity, { only: ["misu"] });
    expect(out.map((r) => r.source.table)).toEqual(["misu"]);
    expect(sel.mock.calls.some((c) => c[0] === "misu_visits")).toBe(false);
  });
  it("탭 검색의 미수 방문 정의는 360 과 같은 객체(재사용)", () => {
    expect(EXTRA_SOURCES.find((s) => s.table === "misu_visits")).toBe(MISU_VISITS_SOURCE);
  });
  it("화면 줄로 바꿀 때 주민번호는 가린다", () => {
    const ev = toEvent(MISU_VISITS_SOURCE, MISU_ROW, false);
    expect(ev.snippet).not.toContain("1234567");
    expect(ev.title).toBe("미수 1차 안내 · 계속 독촉");
  });
});

describe("통합이력 — 미수방문·물류 분류", () => {
  it("직접 조회한 두 표가 상세의 '미수방문'·'물류' 분류로 들어온다", async () => {
    rpcMock.mockResolvedValue([] as never);
    sel.mockImplementation(async (table: string) => (table === "misu_visits" ? [MISU_ROW] : table === "logistics_records" ? [LOGI_ROW] : []) as never);
    const { detail, candidates } = await getVendorHistoryDetail("무암");
    expect((detail["미수방문"] as unknown[]).length).toBe(1);
    expect((detail["물류"] as unknown[]).length).toBe(1);
    expect(candidates[0]?.counts).toMatchObject({ 미수방문: 1, 물류: 1 });
    // 미수 방문은 vendor 칸으로 찾고, 사진·확인 항목 같은 큰 칸은 가져오지 않는다
    const q = String(sel.mock.calls.find((c) => c[0] === "misu_visits")?.[1] || "");
    expect(q).toContain("vendor=ilike");
    expect(q).not.toContain("photos");
  });
});
