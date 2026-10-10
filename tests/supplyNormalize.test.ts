import { describe, expect, it } from "vitest";
import { isColorModel, matchCatalog, normalizeItems, type CatalogItem, type SupplyItem } from "../supabase/functions/_shared/supply-requests.ts";

const CAT: CatalogItem[] = [
  { id: "t-k", kind: "자가", name: "토너 K", category: "토너", color: "K", aliases: ["K", "검정토너", "BK"], models: ["SL-X3220NR", "SL-M4080FX"] },
  { id: "t-c", kind: "자가", name: "토너 C", category: "토너", color: "C", aliases: ["C", "시안"], models: ["SL-X3220NR"] },
  { id: "t-m", kind: "자가", name: "토너 M", category: "토너", color: "M", aliases: ["M", "마젠타"], models: ["SL-X3220NR"] },
  { id: "t-y", kind: "자가", name: "토너 Y", category: "토너", color: "Y", aliases: ["Y", "옐로우"], models: ["SL-X3220NR"] },
  { id: "w", kind: "자가", name: "폐토너통", category: "폐토너통", color: "", aliases: ["폐통", "폐토너"], models: [] },
  { id: "d", kind: "부품", name: "드럼", category: "드럼", color: "", aliases: ["드럼유닛", "DRUM"], models: [] },
  { id: "p", kind: "부품", name: "픽업롤러", category: "롤러", color: "", aliases: ["픽업", "급지롤러"], models: [] },
];
const self = (item: string, qty = ""): SupplyItem => ({ kind: "자가", item, qty, status: "", warranty: "", counter: "", expected: "", raw: "" });
const part = (item: string, qty = ""): SupplyItem => ({ kind: "부품", item, qty, status: "", warranty: "", counter: "", expected: "", raw: "" });
const short = (rows: ReturnType<typeof normalizeItems>) => rows.map((r) => `${r.itemStd || `?${r.item}`}×${r.qty}`);

describe("품목 표준화·세트 풀기 (2026-10-11)", () => {
  it("컬러기 '1세트' → K·C·M·Y 각 1, 흑백기 → K 1. 사전의 기종표가 우선, 없으면 기종명으로 짐작", () => {
    expect(short(normalizeItems([self("토너 1세트")], CAT, "SL-X3220NR"))).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "토너 Y×1"]);
    expect(short(normalizeItems([self("1set")], CAT, "SL-M4080FX"))).toEqual(["토너 K×1"]);
    expect(short(normalizeItems([self("세트 2")], CAT, "CLX-9201NA"))).toHaveLength(4);
    expect(normalizeItems([self("풀세트")], CAT, "SL-X3220NR")[0].setLabel).toBe("풀세트");
    expect(isColorModel("DOCUCENTRE-V C2263(마블)")).toBe(true);
    expect(isColorModel("SL-M4080FX", CAT)).toBe(false);
  });
  it("'K2' · 'K2 C1' · 'KCMY 각1' · '검정토너 2개'", () => {
    expect(short(normalizeItems([self("K", "2")], CAT, ""))).toEqual(["토너 K×2"]);
    expect(short(normalizeItems([self("K2 C1")], CAT, ""))).toEqual(["토너 K×2", "토너 C×1"]);
    expect(short(normalizeItems([self("KCMY 각1")], CAT, ""))).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "토너 Y×1"]);
    expect(short(normalizeItems([self("검정토너", "2")], CAT, ""))).toEqual(["토너 K×2"]);
    expect(short(normalizeItems([self("폐통", "1")], CAT, ""))).toEqual(["폐토너통×1"]);
  });
  it("부품은 별칭·포함으로 사전에 맞추고, 못 맞추면 미정의(itemStd 빈값)로 남긴다", () => {
    expect(short(normalizeItems([part("드럼", "1"), part("DRUM유닛", "1"), part("급지롤러", "2"), part("듣보잡부품", "1")], CAT, ""))).toEqual(["드럼×1", "드럼×1", "픽업롤러×2", "?듣보잡부품×1"]);
    expect(matchCatalog("픽업 롤러", CAT)?.name).toBe("픽업롤러");
    expect(matchCatalog("", CAT)).toBeNull();
  });
});
