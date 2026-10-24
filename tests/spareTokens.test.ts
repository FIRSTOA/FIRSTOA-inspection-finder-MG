/**
 * 필드 양식 여분(spare) 순수 함수 — App.tsx 에서 src/field/fieldFormModel.ts 로 옮긴 뒤(2026-10-24, field-form-tidy S1) 동작을 고정한다.
 * 여분 칸의 ＋/− 단추(SpareQuickEditor)와 원문 붙여넣기 반영이 이 함수들을 쓴다.
 */
import { describe, expect, it } from "vitest";
import { changeSpareStorageLocation, changeSpareToken, spareStorageLocation, spareTokenCount } from "../src/field/fieldFormModel";

describe("spareTokenCount", () => {
  it("띄어 쓴 K/C/M/Y/폐 수량을 읽고, 없는 토큰은 null", () => {
    const raw = "K1 C2 M3 Y4 폐1";
    expect(spareTokenCount(raw, "K")).toBe(1);
    expect(spareTokenCount(raw, "C")).toBe(2);
    expect(spareTokenCount(raw, "Y")).toBe(4);
    expect(spareTokenCount(raw, "폐")).toBe(1);
    expect(spareTokenCount(raw, "드럼")).toBeNull();
  });
  it("붙여 쓴 K2C2M2Y2, 폐통2, 드럼1 도 읽는다", () => {
    expect(spareTokenCount("K2C2M2Y2", "M")).toBe(2);
    expect(spareTokenCount("폐통2", "폐")).toBe(2);
    expect(spareTokenCount("드럼1", "드럼")).toBe(1);
  });
  it("K-2 는 2, 숫자 없는 K- 는 미입력(null)", () => {
    expect(spareTokenCount("K-2", "K")).toBe(2);
    expect(spareTokenCount("K- C1", "K")).toBeNull();
  });
  it("토너1세트·CMY1개씩 묶음 표기", () => {
    expect(spareTokenCount("토너1세트", "K")).toBe(1);
    expect(spareTokenCount("토너1세트", "Y")).toBe(1);
    expect(spareTokenCount("CMY1개씩", "C")).toBe(1);
    expect(spareTokenCount("CMY1개씩", "K")).toBeNull();
  });
});

describe("changeSpareToken", () => {
  it("있는 토큰은 수를 바꾸고 0 아래로 내려가지 않는다", () => {
    expect(changeSpareToken("K1 C1", "K", 1)).toBe("K2 C1");
    expect(changeSpareToken("K0", "K", -1)).toBe("K0");
  });
  it("없는 토큰은 ＋ 일 때만 첫 줄 끝에 1 로 붙인다", () => {
    expect(changeSpareToken("", "M", 1)).toBe("M1");
    expect(changeSpareToken("K1", "M", -1)).toBe("K1");
    expect(changeSpareToken("K1\n보관 위치: 창고", "C", 1)).toBe("K1 C1\n보관 위치: 창고");
  });
  it("묶음 표기는 풀어서 고친다", () => {
    expect(changeSpareToken("토너1세트", "K", 1)).toBe("K2 C1 M1 Y1");
  });
});

describe("보관 위치", () => {
  it("입력 중 끝 공백을 지우지 않는다(띄어쓰기 실사고)", () => {
    expect(spareStorageLocation("K1\n보관 위치: 3층 ")).toBe("3층 ");
    expect(spareStorageLocation("K1")).toBe("");
  });
  it("위치 줄을 새로 쓰거나 비우면 지운다", () => {
    expect(changeSpareStorageLocation("K1", "창고")).toBe("K1\n보관 위치: 창고");
    expect(changeSpareStorageLocation("K1\n보관 위치: 창고", "")).toBe("K1");
  });
});
