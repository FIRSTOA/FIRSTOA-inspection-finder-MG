import { describe, expect, it } from "vitest";
import { countableEvents, dedupeResends, distinctVendors, inKstTextRange, kstDayOf, kstTextRange } from "../src/workCount";
import type { ActivityEvent } from "../src/operations";

const ev = (category: string, vendor: string, createdAt: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `${createdAt}|${vendor}|${category}`, createdAt, activityDate: kstDayOf(createdAt), author: "한왕주", team: "C", category, vendor,
  quantity: 1, machineCount: 0, sourceText: "", metadata: {}, status: "active", cancelledAt: "", cancelledBy: "", ...extra,
} as ActivityEvent);

// 2026-10 한왕주 expansion_it 실제 18행(activity_events, 시각은 UTC) — 팀 현황 "전체 18 / 거래처 16" 재현
const HAN_OCT_PC: Array<[string, string]> = [
  ["주식회사 와이엘아이앤씨", "2026-10-02T02:33:57Z"], ["주식회사 프리앤제이2", "2026-10-02T02:36:54Z"],
  ["한성모직", "2026-10-06T02:13:51Z"], ["백화세무회계", "2026-10-07T01:15:40Z"], ["포튼가먼트", "2026-10-08T01:53:26Z"],
  ["문워크디자인", "2026-10-12T04:26:34Z"], ["주식회사 브레디스헬스케어", "2026-10-12T04:55:56Z"],
  ["비피도 (BIFIDO. Co. Ltd.)", "2026-10-13T02:02:36Z"], ["파트라", "2026-10-14T02:26:21Z"],
  ["주식회사 세원기술단사무실백업/합산", "2026-10-15T05:53:24Z"], ["주식회사 세원기술단사무실백업/합산", "2026-10-15T09:15:42Z"], // a789130c · 05bfe353
  ["주식회사 에스에이치파트너스그럭-전 씨에스 컨설팅(CS consulting)", "2026-10-16T02:13:22Z"], // 9fc181ff
  ["주식회사 에스에이치파트너스그럭-전 씨에스 컨설팅(CS consulting)", "2026-10-16T02:14:39Z"], // e2ec74d3 (pc_expansion 107237 숨김)
  ["31N좋은당 보아스네집좋은당보아스네집분기마감", "2026-10-19T07:28:35Z"], ["주식회사 비에이렌탈전 스튜디오통통통,성진에프앤에스", "2026-10-20T09:02:47Z"],
  ["주식회사 이너웨이브", "2026-10-21T02:53:10Z"], ["델타엔지니어링", "2026-10-21T04:37:54Z"], ["이노하스레디투잇", "2026-10-21T06:53:47Z"],
];

describe("업무 건수 규칙 한 곳(workCount)", () => {
  it("한왕주 10월 PC확장성: 기록 18행 → 재전송 묶으면 16건 = 조회 탭(pc_expansion 숨김 제외) 16건, 거래처 16곳", () => {
    const events = HAN_OCT_PC.map(([v, at]) => ev("expansion_it", v, at));
    expect(events).toHaveLength(18);
    const counted = countableEvents(events);
    expect(counted).toHaveLength(16);
    expect(distinctVendors(counted.map((e) => e.vendor))).toBe(16);
  });

  it("팀 현황(OperationsDashboard)과 순위표(TeamRanking)가 같은 입구(countableEvents)를 쓴다", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/OperationsDashboard.tsx", "src/TeamRanking.tsx"]) {
      expect(readFileSync(file, "utf8")).toMatch(/countableEvents\(/);
    }
    expect(countableEvents([ev("as", "비피도", "2026-10-13T02:00:57Z"), ev("as", "비피도", "2026-10-13T02:01:00Z")])).toEqual(dedupeResends([ev("as", "비피도", "2026-10-13T02:00:57Z")]));
  });

  it("오발송 취소분은 빠진다", () => {
    const out = countableEvents([ev("expansion_it", "파트라", "2026-10-14T02:26:21Z", { status: "cancelled" }), ev("expansion_it", "포튼가먼트", "2026-10-08T01:53:26Z")]);
    expect(out.map((e) => e.vendor)).toEqual(["포튼가먼트"]);
  });

  it("확장성은 다른 날 같은 거래처면 따로 센다", () => {
    expect(countableEvents([ev("expansion_it", "백화세무회계", "2026-10-07T01:15:40Z"), ev("expansion_it", "백화세무회계", "2026-10-12T01:23:09Z")])).toHaveLength(2);
  });

  it("점검 재전송(10분 안)은 1건·큰 대수, 떨어진 시각은 따로", () => {
    const out = countableEvents([
      ev("inspection", "티더블유에이테크", "2026-10-06T03:02:00Z", { machineCount: 1 }),
      ev("inspection", "티더블유에이테크", "2026-10-06T03:10:00Z", { machineCount: 2 }),
      ev("inspection", "알스퀘어디자인 본사", "2026-10-01T01:50:31Z", { machineCount: 12 }),
      ev("inspection", "알스퀘어디자인 본사", "2026-10-01T03:02:11Z", { machineCount: 12 }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.find((e) => e.vendor === "티더블유에이테크")?.machineCount).toBe(2);
  });
});

describe("확장성 날짜 칸 KST 경계(글자 비교)", () => {
  const oct = kstTextRange("2026-10-01", "2026-10-31");
  it("경계 글자", () => {
    expect(oct).toEqual({ gte: "2026-09-30T15:00:00", lt: "2026-10-31T15:00:00" });
    expect(kstTextRange("2026-03-01", "2026-03-01").gte).toBe("2026-02-28T15:00:00");
  });
  it.each([
    ["2026-09-30", false], ["2026-10-01", true], ["2026-10-31", true], ["2026-11-01", false],
    ["2026-09-30T14:59:59+00:00", false], // 9/30 23:59 KST
    ["2026-09-30T15:00:00+00:00", true],  // 10/1 00:00 KST
    ["2026-10-31T14:59:59+00:00", true],  // 10/31 23:59 KST
    ["2026-10-31T15:30:00+00:00", false], // 11/1 00:30 KST — 예전 lte.2026-10-31T23:59:59 는 10월에 넣었다
  ])("%s → %s", (value, inside) => {
    expect(inKstTextRange(value, oct)).toBe(inside);
    expect(kstDayOf(value) >= "2026-10-01" && kstDayOf(value) <= "2026-10-31").toBe(inside);
  });
  it("kstDayOf 는 두 형식을 KST 날짜로", () => {
    expect(kstDayOf("2026-10-20T09:02:41.986128+00:00")).toBe("2026-10-20");
    expect(kstDayOf("2026-10-20T16:00:00+00:00")).toBe("2026-10-21");
    expect(kstDayOf("2026-10-21")).toBe("2026-10-21");
  });
});
