import { describe, expect, it } from "vitest";
import { normalizeItems, type SupplyItem } from "../supabase/functions/_shared/supply-requests.ts";

const self = (item: string, qty = ""): SupplyItem => ({ kind: "자가", item, qty, status: "", warranty: "", counter: "", expected: "", raw: "" });
const short = (rows: ReturnType<typeof normalizeItems>) => rows.map((r) => `${r.itemStd || `?${r.item}`}×${r.qty}`);

// 2026-10-11 지난 기록 채우기에서 실제로 나온 미정의 품목들 — 사전(재고 표)이 비어 있어도 기본 품목으로 맞아야 한다
describe("미정의로 남았던 실제 표기", () => {
  it("'폐토너통'만 적은 것은 토너가 아니다(흑백기·기종 미상에서도 K 가 생기면 안 된다)", () => {
    expect(short(normalizeItems([self("폐토너통", "1")], [], ""))).toEqual(["폐토너통×1"]);
    expect(short(normalizeItems([self("폐토너통", "2")], [], "SL-M4080FX"))).toEqual(["폐토너통×2"]);
    expect(short(normalizeItems([self("폐토너박스", "")], [], "K4250"))).toEqual(["폐토너통×1"]);
    expect(short(normalizeItems([self("폐 토너 통 2", "")], [], ""))).toEqual(["폐토너통×2"]);
    expect(short(normalizeItems([self("k1 폐토너통", "1")], [], "K4250"))).toEqual(["토너 K×1", "폐토너통×1"]);
  });
  it("'폐' → 폐토너통, '폐통' → 폐토너통", () => {
    expect(short(normalizeItems([self("폐", "1")], [], ""))).toEqual(["폐토너통×1"]);
    expect(short(normalizeItems([self("폐통", "1")], [], ""))).toEqual(["폐토너통×1"]);
  });
  it("'K1 폐' → 토너 K 1 + 폐토너통 1", () => {
    expect(short(normalizeItems([self("K1 폐")], [], "3220"))).toEqual(["토너 K×1", "폐토너통×1"]);
  });
  it("'420K' → 토너 K (420 기종의 K)", () => {
    expect(short(normalizeItems([self("420K", "1")], [], "420"))).toEqual(["토너 K×1"]);
  });
  it("'토너1셋' = 1세트 → 컬러기면 K·C·M·Y, 흑백기면 K", () => {
    expect(short(normalizeItems([self("토너1셋")], [], "SL-X3220NR"))).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "토너 Y×1"]);
    expect(short(normalizeItems([self("토너1셋")], [], "SL-M4080FX"))).toEqual(["토너 K×1"]);
  });
  it("'토너 K'·'토너 M'은 사전이 없어도 표준으로", () => {
    expect(short(normalizeItems([self("토너 K", "1"), self("토너 M", "1")], [], ""))).toEqual(["토너 K×1", "토너 M×1"]);
  });
});
