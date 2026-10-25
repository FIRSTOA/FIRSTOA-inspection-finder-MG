import { describe, expect, it } from "vitest";
import { ilikeNeedle, mergeCalSearchHits, normalizeScheduleQuery, scheduleQueryHit, ticketSearchFields, twoYearsBefore, withTimeout, type CalSearchHit } from "../src/scheduleSearch";

describe("일정리스트 검색 필터", () => {
  const t = { vendor: "한국농어민신문", calendarTitle: "김철수-토너 교체", address: "서울 성동구 왕십리로 1", issue: "용지걸림 E-301", assignee: "박영희" };
  it("2자 미만·공백은 거르지 않는다", () => {
    expect(scheduleQueryHit(ticketSearchFields(t), "")).toBe(true);
    expect(scheduleQueryHit(ticketSearchFields(t), " 가 ")).toBe(true);
    expect(normalizeScheduleQuery("a")).toBe("");
  });
  it("업체·제목·주소·내용·담당자 어디든, 대소문자 무시", () => {
    expect(scheduleQueryHit(ticketSearchFields(t), "농어민")).toBe(true);
    expect(scheduleQueryHit(ticketSearchFields(t), "토너")).toBe(true);
    expect(scheduleQueryHit(ticketSearchFields(t), "성동구")).toBe(true);
    expect(scheduleQueryHit(ticketSearchFields(t), "e-301")).toBe(true);
    expect(scheduleQueryHit(ticketSearchFields(t), "박영희")).toBe(true);
    expect(scheduleQueryHit(ticketSearchFields(t), "강남구")).toBe(false);
  });
  it("빈 칸(undefined)도 안전", () => {
    expect(scheduleQueryHit([undefined, null, ""], "토너")).toBe(false);
  });
});

describe("캘린더 검색 메모리+서버 합치기", () => {
  const hit = (kind: "ticket" | "naver", id: string, date: string, title = id): CalSearchHit => ({ kind, id, date, title, key: `${kind === "ticket" ? "t" : "n"}-${id}` });
  it("같은 일정은 한 번만(메모리 쪽 제목 우선), 날짜 내림차순", () => {
    const memory = [hit("ticket", "a", "2026-10-01", "메모리 제목"), hit("naver", "x", "2026-10-20")];
    const server = [hit("ticket", "a", "2026-10-01", "서버 제목"), hit("ticket", "old", "2025-03-05")];
    const out = mergeCalSearchHits(memory, server);
    expect(out.map((r) => r.key)).toEqual(["n-x", "t-a", "t-old"]);
    expect(out.find((r) => r.key === "t-a")?.title).toBe("메모리 제목");
  });
  it("웹앱 일정과 네이버 일정은 id 가 같아도 다른 건", () => {
    expect(mergeCalSearchHits([hit("ticket", "1", "2026-01-01")], [hit("naver", "1", "2026-01-02")])).toHaveLength(2);
  });
  it("limit 까지만", () => {
    const many = Array.from({ length: 80 }, (_, i) => hit("ticket", String(i), `2025-01-${String((i % 28) + 1).padStart(2, "0")}`));
    expect(mergeCalSearchHits([], many, 50)).toHaveLength(50);
  });
});

describe("서버 검색 보조", () => {
  it("필터 문법을 깨는 글자는 지우고 인코딩", () => {
    expect(ilikeNeedle("농어민(신문),*")).toBe(encodeURIComponent("농어민 신문"));
    expect(ilikeNeedle("(*)")).toBe("");
  });
  it("2년 전 날짜(윤일 보정)", () => {
    expect(twoYearsBefore("2026-10-25")).toBe("2024-10-25");
    expect(twoYearsBefore("2028-02-29")).toBe("2026-02-28");
  });
  it("시간 제한 넘으면 실패", async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, "시간 초과")).rejects.toThrow("시간 초과");
    await expect(withTimeout(Promise.resolve(1), 100, "x")).resolves.toBe(1);
  });
});
