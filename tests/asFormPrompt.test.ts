import { describe, expect, it } from "vitest";
import { shouldAskAsForm } from "../src/asFormPrompt";

const t = (o: Partial<{ scheduleType: string; status: string; vendor: string; note: string }>) => ({ scheduleType: "AS", status: "배정", vendor: "주식회사 무암", note: "", ...o });

describe("일정 [완료] — AS 양식 물어볼 일정", () => {
  it("완료 전 AS·익일AS 는 묻는다", () => {
    expect(shouldAskAsForm(t({}))).toBe(true);
    expect(shouldAskAsForm(t({ scheduleType: "익일AS", status: "익일" }))).toBe(true);
    expect(shouldAskAsForm(t({ status: "접수", note: "처리: 토너 교체" }))).toBe(true);
  });
  it("물류·점검 등 AS 가 아닌 일정은 묻지 않는다", () => {
    expect(shouldAskAsForm(t({ scheduleType: "납품철수교체휴가교육" }))).toBe(false);
    expect(shouldAskAsForm(t({ scheduleType: "물류" }))).toBe(false);
    expect(shouldAskAsForm(t({ scheduleType: "매월점검" }))).toBe(false);
  });
  it("이미 완료(완료 취소 경로)·휴가·양식 보낸 일정은 묻지 않는다", () => {
    expect(shouldAskAsForm(t({ status: "완료" }))).toBe(false);
    expect(shouldAskAsForm(t({ vendor: "홍길동 연차" }))).toBe(false);
    expect(shouldAskAsForm(t({ note: "메모\n\n[2026-10-24 전송 양식]\n업체명: 무암" }))).toBe(false);
  });
});
