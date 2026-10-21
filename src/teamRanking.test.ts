import { describe, expect, it } from "vitest";
import { dedupeResends as dedupeForRanking } from "./workCount";
import type { ActivityEvent } from "./operations";

const ev = (category: string, vendor: string, createdAt: string, machineCount = 1): ActivityEvent => ({
  id: createdAt + vendor + category, createdAt, activityDate: createdAt.slice(0, 10), author: "한왕주", team: "A", category, vendor,
  quantity: 0, machineCount, sourceText: "", metadata: {}, status: "active", cancelledAt: "", cancelledBy: "",
} as unknown as ActivityEvent);

describe("dedupeForRanking", () => {
  it("확장성은 같은 날 같은 업체를 1곳으로", () => {
    const out = dedupeForRanking([
      ev("expansion_it", "주식회사 세원기술단", "2026-10-15T05:53:24Z"),
      ev("expansion_it", "주식회사 세원기술단", "2026-10-15T09:15:42Z"),
      ev("expansion_it", "파트라", "2026-10-14T02:26:21Z"),
    ]);
    expect(out.filter((e) => e.category === "expansion_it")).toHaveLength(2);
  });
  it("AS 연타는 1건, 떨어진 시간은 따로", () => {
    const out = dedupeForRanking([
      ev("as", "비피도", "2026-10-13T02:00:57Z"),
      ev("as", "비피도", "2026-10-13T02:01:00Z"),
      ev("as", "비피도", "2026-10-13T06:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });
  it("점검 재전송은 큰 대수로 1건", () => {
    const out = dedupeForRanking([ev("inspection", "파트라", "2026-10-14T02:26:00Z", 5), ev("inspection", "파트라", "2026-10-14T02:27:00Z", 6)]);
    expect(out).toHaveLength(1);
    expect(out[0].machineCount).toBe(6);
  });
});
