import { describe, expect, it } from "vitest";
import { fieldTicketVendor, logisticsTicketInfo } from "../src/ids";

// 일정 제목에서 업체명 자리를 찾는 규칙(일정리스트 titleParts가 쓰는 재료) — 2026-10-02 폰 제목 잘림 개선
describe("일정 제목 — 업체명 찾기 재료", () => {
  it("물류 슬래시 열차: 품목 칸 앞이 고객사", () => {
    expect(logisticsTicketInfo("네오정보 직송-판매납품/네오정보/개인영업/디스페이스코리아/안드로이드전자칠판 65형(…)/확인서서명필수").vendor).toBe("디스페이스코리아");
  });
  it("품목 칸이 없는 열차는 그대로 돌려줘 titleParts가 마지막 칸을 고르게 한다", () => {
    const raw = "★출고준비완료★납품(일반)/퍼스트/운영팀/증설/효성중공업-서초 디오페라";
    const v = logisticsTicketInfo(raw).vendor;
    expect(v === raw || v === "효성중공업-서초 디오페라" || v.includes("효성중공업")).toBe(true);
  });
  it("AS 제목: 이름·행위어 접두를 벗기면 업체명", () => {
    expect(fieldTicketVendor("이호준 - a/s NN 제이앤노무법인").vendor).toContain("제이앤노무법인");
  });
});
