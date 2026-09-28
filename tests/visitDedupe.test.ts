import { describe, expect, it } from "vitest";
import { sameWorkKinds, visitCoreText } from "../src/visits";

describe("방문 기록 중복 판정", () => {
  it("앨범 링크 꼬리를 떼면 재전송 원문이 같아진다", () => {
    const base = "작성자:김종희\n구분: 점검, AS\n업체명:테스트업체\n지역:C\n※부품신청※\n물품명:";
    const a = `${base}\n\n📷 현장사진 7장 모아보기:\nhttps://firstoa-inspection-finder-mg.vercel.app/?album=64ff3d20-8135-41ed-88f4-b8b9384bcf57`;
    const b = `${base}\n\n📷 현장사진 7장 모아보기:\nhttps://firstoa-inspection-finder-mg.vercel.app/?album=630a00ac-2151-45a5-8bbd-6e552295eb51`;
    expect(visitCoreText(a)).toBe(base);
    expect(visitCoreText(a)).toBe(visitCoreText(b));
    expect(visitCoreText("  \n")).toBe("");
  });
  it("작업 종류는 순서·중복과 무관하게 같으면 같다", () => {
    expect(sameWorkKinds(["inspection", "as"], ["as", "inspection", "as"])).toBe(true);
    expect(sameWorkKinds(["inspection"], ["pc"])).toBe(false);
    expect(sameWorkKinds([], [])).toBe(true);
    expect(sameWorkKinds(["as"], [])).toBe(false);
  });
});
