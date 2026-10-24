import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../src/operations";
import { rankingLogisticsCount } from "../src/rankingLogistics";

const ev = (id: string, category: ActivityEvent["category"], kind?: string, sourceText?: string): ActivityEvent => ({
  id, createdAt: "2026-10-20T01:00:00Z", status: "active", activityDate: "2026-10-20", author: "홍길동", team: "C",
  category, vendor: `업체${id}`, metadata: kind ? { logisticsCategory: kind } : undefined, sourceText,
});

describe("순위표 물류 = 여분·마감 제외(팀 현황·홈 K24 와 같은 판정)", () => {
  const events = [
    ev("1", "logistics", "납품"), ev("2", "logistics", "교체"), ev("3", "logistics", "세팅"),
    ev("4", "logistics", "여분"), ev("5", "logistics", "마감"),
    ev("6", "logistics", undefined, "구분: 여분 토너"), // 메타 없이 원문 '구분:' 줄로 판정
    ev("7", "logistics"),                                // 구분 없음 = 기타 → 물류로 센다
    ev("8", "as"),
  ];
  it("예전(byKind) 7건 → 지금 4건 — 여분·마감 3건 차이", () => {
    const before = events.filter((e) => e.category === "logistics").length;
    expect(before).toBe(7);
    expect(rankingLogisticsCount(events)).toBe(4);
  });
  it("물류가 아닌 종류는 세지 않는다", () => {
    expect(rankingLogisticsCount([ev("9", "as"), ev("10", "inspection")])).toBe(0);
  });
});
