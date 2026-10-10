import { describe, expect, it } from "vitest";
import { isColorModel, normalizeItems, type SupplyItem } from "../supabase/functions/_shared/supply-requests.ts";

const self = (item: string, qty = ""): SupplyItem => ({ kind: "자가", item, qty, status: "", warranty: "", counter: "", expected: "", raw: "" });
const part = (item: string, qty = ""): SupplyItem => ({ kind: "부품", item, qty, status: "", warranty: "", counter: "", expected: "", raw: "" });
const run = (s: SupplyItem, model = "") => normalizeItems([s], [], model).map((r) => `${r.itemStd || `?${r.item}`}×${r.qty}`);

// 2026-10-11 지난 기록 1,081행에서 실제로 나온 표기 — 전부 사전 없이(기본 품목만으로) 맞아야 한다
describe("자가: 색 토너·폐토너통 섞인 표기", () => {
  it("색+숫자 묶음과 폐토너통", () => {
    expect(run(self("k1 폐", "1"))).toEqual(["토너 K×1", "폐토너통×1"]);
    expect(run(self("K1폐", "1"))).toEqual(["토너 K×1", "폐토너통×1"]);
    expect(run(self("K2폐", "1"))).toEqual(["토너 K×2", "폐토너통×1"]);
    expect(run(self("K폐", "1"))).toEqual(["토너 K×1", "폐토너통×1"]);
    expect(run(self("k1c1m1y2 폐", "1"))).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "토너 Y×2", "폐토너통×1"]);
    expect(run(self("K1 m1 C2 y3 폐", "1"))).toEqual(["토너 K×1", "토너 M×1", "토너 C×2", "토너 Y×3", "폐토너통×1"]);
    expect(run(self("토너 B1C1M1Y1폐", "1"))).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "토너 Y×1", "폐토너통×1"]);
    expect(run(self("K.c.폐통", "1"))).toEqual(["토너 K×1", "토너 C×1", "폐토너통×1"]);
    expect(run(self("K. C. M. Y. 폐통", "5"))).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "토너 Y×1", "폐토너통×1"]);
    expect(run(self("토너CMY 폐통", "1,1,1,2"))).toEqual(["토너 C×1", "토너 M×1", "토너 Y×1", "폐토너통×2"]);
    expect(run(self("KY 폐통", "1,1,1"))).toEqual(["토너 K×1", "토너 Y×1", "폐토너통×1"]);
    expect(run(self("c6m6y6폐", "5"))).toEqual(["토너 C×6", "토너 M×6", "토너 Y×6", "폐토너통×1"]);
  });
  it("기종 약칭이 앞에 붙은 것", () => {
    expect(run(self("420K", "1"), "420")).toEqual(["토너 K×1"]);
    expect(run(self("2271m", "1"))).toEqual(["토너 M×1"]);
    expect(run(self("808M", "1"))).toEqual(["토너 M×1"]);
    expect(run(self("806k1폐", "1"))).toEqual(["토너 K×1", "폐토너통×1"]);
    expect(run(self("450k1c1m1 폐", "1"))).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "폐토너통×1"]);
    expect(run(self("X7500 k5폐", "3"))).toEqual(["토너 K×5", "폐토너통×1"]);
    expect(run(self("D450 k1폐", "1"))).toEqual(["토너 K×1", "폐토너통×1"]);
    expect(run(self("X3220 K1C1Y", "1"))).toEqual(["토너 K×1", "토너 C×1", "토너 Y×1"]);
    expect(run(self("K3250 K", "1"))).toEqual(["토너 K×1"]);
    expect(run(self("5473 K5 m", "1"))).toEqual(["토너 K×5", "토너 M×1"]);
    expect(run(self("K7500LX k토너", "2"))).toEqual(["토너 K×2"]);
    expect(run(self("Mx7 k토너", "1"))).toEqual(["토너 K×1"]);
    expect(run(self("470k토너", "1"))).toEqual(["토너 K×1"]);
    expect(run(self("704폐통2 k토너", "1"))).toEqual(["폐토너통×2", "토너 K×1"]);
    expect(run(self("804(C", "1"))).toEqual(["토너 C×1"]);
    expect(run(self("*C5580 토너 K -", "5"))).toEqual(["토너 K×5"]);
    expect(run(self("M-", "5"))).toEqual(["토너 M×5"]);
    expect(run(self("3220 폐", "1"))).toEqual(["폐토너통×1"]);
    expect(run(self("폐1)", ""))).toEqual(["폐토너통×1"]);
  });
  it("별명(마블·베니·보탄)·정품·토너 낱말은 무시", () => {
    expect(run(self("마블 토너1셋 폐", "1"), "Apeos C2060")).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "토너 Y×1", "폐토너통×1"]);
    expect(run(self("보탄 C", "1"))).toEqual(["토너 C×1"]);
    expect(run(self("마블토너 k", "1"))).toEqual(["토너 K×1"]);
    expect(run(self("베니 토너 k", "2"))).toEqual(["토너 K×2"]);
    expect(run(self("정품토너", "1"), "N501")).toEqual(["토너 K×1"]);
    expect(run(self("검정토너", "2"))).toEqual(["토너 K×2"]);
  });
  it("'1개'·'1개씩'·'각1'은 앞 색들의 수량", () => {
    expect(run(self("K토너 1개 폐토너통", "1"))).toEqual(["토너 K×1", "폐토너통×1"]);
    expect(run(self("K토너4 폐토너통", "1"))).toEqual(["토너 K×4", "폐토너통×1"]);
    expect(run(self("y토너 1개씩 폐토너통", "1"))).toEqual(["토너 Y×1", "폐토너통×1"]);
    expect(run(self("Cmy토너 1개씩 폐토너통", "1"))).toEqual(["토너 C×1", "토너 M×1", "토너 Y×1", "폐토너통×1"]);
    expect(run(self("M토너1.폐통", "2"))).toEqual(["토너 M×1", "폐토너통×1"]);
    expect(run(self("Ma2100 토너cmy1개씩", ""))).toEqual(["토너 C×1", "토너 M×1", "토너 Y×1"]);
    expect(run(self("토너 k3 m1 y", "2"))).toEqual(["토너 K×3", "토너 M×1", "토너 Y×1"]);
  });
  it("세트 — 한세트·1셋·1set·컬1셋, 흑백기는 K만", () => {
    expect(run(self("토너한세트 폐", "1"), "SL-X3220NR")).toEqual(["토너 K×1", "토너 C×1", "토너 M×1", "토너 Y×1", "폐토너통×1"]);
    expect(run(self("토너1set폐", "1"), "SL-X4220RX")).toHaveLength(5);
    expect(run(self("320 토너1 셋 폐", "1"), "D320")).toHaveLength(5);
    expect(run(self("806(토너1세트)", ""), "X7500LX")).toHaveLength(4);
    expect(run(self("토너한셋트", ""), "X3220")).toHaveLength(4);
    expect(run(self("Ma2100 토너한세트", ""), "ma2100")).toHaveLength(4);
    expect(run(self("k2 컬1셋", ""), "M5521")).toEqual(["토너 K×2", "토너 C×1", "토너 M×1", "토너 Y×1"]);
    expect(run(self("토너1셋", ""), "SL-M4080FX")).toEqual(["토너 K×1"]);
    expect(run(self("D450 토너한세트 폐", "1"), "D450")).toHaveLength(5);
  });
  it("색 없는 '토너'는 흑백기면 K, 컬러기면 미정의", () => {
    expect(run(self("토너", "3"), "SL-M3870FW")).toEqual(["토너 K×3"]);
    expect(run(self("토너3 폐", "2"), "K4250")).toEqual(["토너 K×3", "폐토너통×1"]);
    expect(run(self("L5700 토너", "1"), "L5700")).toEqual(["토너 K×1"]);
    expect(run(self("토너", "1"), "SL-X3220NR")).toEqual(["?토너×1"]);
  });
  it("자가 칸에 적힌 부품·모르는 말", () => {
    expect(run(self("k현상기", "1"))).toEqual(["현상기 K×1"]);
    expect(run(self("드럼", "1"))).toEqual(["드럼×1"]);
    expect(run(self("리프팅기어", "2"))).toEqual(["기어×2"]);
    expect(run(self("액시트", "1"))).toEqual(["?액시트×1"]);
    expect(run(self("5700", ""))).toEqual(["?5700×"]);
    expect(run(self("정품", ""))).toEqual(["?정품×"]);
  });
});

describe("부품: 색 붙는 부품·여러 부품 한 줄", () => {
  it("색 접두 — k현상제·K드럼·컬러드럼·흑백 드럼", () => {
    expect(run(part("k현상제", "1"))).toEqual(["현상제 K×1"]);
    expect(run(part("K드럼", ""))).toEqual(["드럼 K×1"]);
    expect(run(part("컬러드럼", "1"))).toEqual(["드럼 컬러×1"]);
    expect(run(part("컬드럼", "3"))).toEqual(["드럼 컬러×3"]);
    expect(run(part("흑백 드럼 각1개씩", "1"))).toEqual(["드럼 K×1"]);
    expect(run(part("모노 드럼", "1"))).toEqual(["드럼 K×1"]);
    expect(run(part("컬러드럼칩", "4"))).toEqual(["드럼칩 컬러×4"]);
    expect(run(part("KC현상기 KC현상제", "1,1,1,1"))).toEqual(["현상기 K×1", "현상기 C×1", "현상제 K×1", "현상제 C×1"]);
    expect(run(part("KCMY 드럼", "1.2.2.2"))).toEqual(["드럼 K×1", "드럼 C×2", "드럼 M×2", "드럼 Y×2"]);
    expect(run(part("KY드럼", "1111"))).toEqual(["드럼 K×1", "드럼 Y×1"]);
    expect(run(part("C.M 현상기", "3"))).toEqual(["현상기 C×1", "현상기 M×1"]);
    expect(run(part("M 현상제", "2"))).toEqual(["현상제 M×2"]);
    expect(run(part("현상제(c", "1"))).toEqual(["현상제 C×1"]);
    expect(run(part("2060 드럼 K 1 C 1 M", "1"))).toEqual(["드럼 K×1", "드럼 C×1", "드럼 M×1"]);
    expect(run(part("현상제 k1y1", "1"))).toEqual(["현상제 K×1", "현상제 Y×1"]);
  });
  it("여러 부품이 한 줄에", () => {
    expect(run(part("현상기 2 현상제 k1y1 전사블레이드", "1"))).toEqual(["현상기×2", "현상제 K×1", "현상제 Y×1", "전사벨트 블레이드×1"]);
    expect(run(part("k드럼 전사벨트", "1,1"))).toEqual(["드럼 K×1", "전사벨트×1"]);
    expect(run(part("k현상제2c현상제", "1"))).toEqual(["현상제 K×2", "현상제 C×1"]);
    expect(run(part("정착기1.블레아드", "1"))).toEqual(["정착기×1", "블레이드×1"]);
    expect(run(part("현상기 1개 k현상제", "1"))).toEqual(["현상기×1", "현상제 K×1"]);
    expect(run(part("마블 드럼1개 마블드럼칩", "4"))).toEqual(["드럼×1", "드럼칩×1"]);
    expect(run(part("D420 컬러드럼1 블랙드럼", "1"))).toEqual(["드럼 컬러×1", "드럼 K×1"]);
    expect(run(part("드럼 1 현상기1 y현상제1 정창기2 전사벨트", "1"))).toEqual(["드럼×1", "현상기×1", "현상제 Y×1", "정착기×2", "전사벨트×1"]);
    expect(run(part("정착기 정품k현상기", "1,1"))).toEqual(["정착기×1", "현상기 K×1"]);
    expect(run(part("2061 드럼칩 1셋", "1"), "2060")).toEqual(["드럼칩 K×1", "드럼칩 C×1", "드럼칩 M×1", "드럼칩 Y×1"]);
  });
  it("기종·수식어가 붙은 한 부품", () => {
    expect(run(part("X7500 정착기", "1"))).toEqual(["정착기×1"]);
    expect(run(part("MX3정착기", "1"))).toEqual(["정착기×1"]);
    expect(run(part("5575세이토 드럼", "1"))).toEqual(["드럼×1"]);
    expect(run(part("삼성 리퍼하드", "1"))).toEqual(["하드×1"]);
    expect(run(part("Adf 유상수리 외관", "1"))).toEqual(["ADF×1"]);
    expect(run(part("V6680 헤라 정착기", "1"))).toEqual(["정착기×1"]);
    expect(run(part("Y수리품현상기", "1"))).toEqual(["현상기 Y×1"]);
    expect(run(part("정품 X7600 M 드럼", "1"))).toEqual(["드럼 M×1"]);
    expect(run(part("벨트 아쎄이", "1"))).toEqual(["전사벨트×1"]);
    expect(run(part("2ndBTR", "1"))).toEqual(["전사벨트×1"]);
    expect(run(part("2nd btr", "1"))).toEqual(["전사벨트×1"]);
    expect(run(part("iH보드", "3"))).toEqual(["IH보드×3"]);
    expect(run(part("K디스팬스 모터", "2"))).toEqual(["모터×2"]);
    expect(run(part("1단급지부", "1"))).toEqual(["트레이×1"]);
    expect(run(part("K카트리지", "1"))).toEqual(["토너 K×1"]);
    expect(run(part("정착모터", "1,1,1,1,1"))).toEqual(["정착모터×1"]);
    expect(run(part("C현상기", "1111"))).toEqual(["현상기 C×1"]);
    expect(run(part("R", "804"))).toEqual(["?R×804"]);
    expect(run(part("상태좋은것", "1"))).toEqual(["?상태좋은것×1"]);
  });
});

describe("컬러기 짐작(2026-10-11 실제 기종)", () => {
  it("숫자 약칭·교세라·신도·HP", () => {
    for (const m of ["320", "D450", "3220", "7400", "2060", "ECOSYS-M5521CDN", "ma2100", "ES5473", "HP 9010(5층)", "ApeosPort-V C3375(세이토)", "APVIIC5573", "x4255", "M5526CDN"]) expect(isColorModel(m), m).toBe(true);
    for (const m of ["SL-M3870FW", "K4250", "SL-K4305LX", "L5700", "MFC-L5700DN", "BIZHUB-128DN", "5700", "K7500", "N501"]) expect(isColorModel(m), m).toBe(false);
  });
});
