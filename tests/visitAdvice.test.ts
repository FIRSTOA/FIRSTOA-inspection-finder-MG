/**
 * AS 접수 뒤 "방문 판단 안내글" 순수 규칙 회귀 테스트(2026-10-31).
 * 기준 사례: 청오에스떠블유 10-30 접수 — 11-02 교체 일정이 있는데 모르고 급하지 않은 AS를 다녀왔다.
 */
import { describe, expect, it } from "vitest";
import {
  BUNDLE_LINE,
  VISIT_ADVICE_MAX_CHARS,
  buildVisitAdviceText,
  judgeVisit,
  notFoundText,
  sameBuildingKey,
  shouldSend,
  type UpcomingItem,
  type VisitAdviceInput,
} from "../src/visitAdvice";

function base(over: Partial<VisitAdviceInput> = {}): VisitAdviceInput {
  return {
    vendor: "청오에스떠블유 주식회사(써브웨이 본사)",
    grade: "V",
    deviceLine: "D470/31V0123/ABC12345",
    lastInspection: "2026-08-04",
    lastAs: undefined,
    asAfterInspection: [],
    deviceTotal: 2,
    spare: "충분",
    selfRequestOpen: 0,
    workin: { label: "G3", kind: "quarter" },
    upcoming: [],
    today: "2026-10-30",
    thresholds: { quarterDays: 60, monthlyDays: 25 },
    ...over,
  };
}

const swap: UpcomingItem = { date: "2026-11-02", kind: "물류", title: "교체(일반)/기기상향", vendor: "청오에스떠블유 주식회사", sameBuilding: false, source: "운영팀" };

describe("judgeVisit 판정표", () => {
  it("청오 표본: 87일·점검 뒤 AS·워킨맵 있음 → 판단필요 + 묶기 안내", () => {
    const input = base({ lastAs: "2026-10-23", asAfterInspection: [{ date: "2026-10-23", deviceCount: 1 }], upcoming: [swap] });
    const r = judgeVisit(input);
    expect(r.verdict).toBe("판단필요");
    expect(r.elapsedDays).toBe(87);
    const text = buildVisitAdviceText(input, r);
    expect(text).toBe([
      "청오에스떠블유 주식회사(써브웨이 본사) V",
      "D470/31V0123/ABC12345",
      "마지막점검일:2026-08-04",
      "마지막AS일:2026-10-23",
      "4분기 워킨맵:있음(G3 분기점검)",
      "점검여부: 판단필요 (경과 87일 / 기준 60일, 워킨맵 있음)",
      "근거: 기기 2대 · AS 1대 봄(10-23) · 여분 충분 · 자가신청 0건",
      "참고: AS는 1대만 봄 — 나머지 기기 점검 필요 가능성 큼",
      "추가일정:",
      "1.2026-11-02(월) 교체(일반)/기기상향 — 운영팀",
      BUNDLE_LINE,
    ].join("\n"));
    expect(shouldSend(r, input.upcoming)).toBe(true);
  });

  it("59일은 불필요지만 경과일을 적는다", () => {
    const input = base({ lastInspection: "2026-09-01" });
    const r = judgeVisit(input);
    expect(r).toMatchObject({ verdict: "불필요", elapsedDays: 59 });
    const text = buildVisitAdviceText(input, r);
    expect(text).toContain("점검여부: 불필요 (경과 59일 / 기준 60일, 워킨맵 있음)");
    expect(text).toContain("추가일정:없음");
    expect(text).not.toContain(BUNDLE_LINE);
  });

  it("워킨맵 없으면 불필요(경과일은 표시)", () => {
    const input = base({ workin: null });
    const r = judgeVisit(input);
    expect(r.verdict).toBe("불필요");
    const text = buildVisitAdviceText(input, r);
    expect(text).toContain("4분기 워킨맵:없음");
    expect(text).toContain("점검여부: 불필요 (경과 87일 / 기준 60일, 워킨맵 없음)");
  });

  it("G5 점검 완료·G12 이관은 불필요", () => {
    expect(judgeVisit(base({ workin: { label: "G5", kind: "quarter" } })).verdict).toBe("불필요");
    expect(judgeVisit(base({ workin: { label: "G12", kind: "quarter" } })).verdict).toBe("불필요");
    const input = base({ workin: { label: "G5", kind: "quarter" } });
    expect(buildVisitAdviceText(input, judgeVisit(input))).toContain("4분기 워킨맵:있음(G5 이번 분기 점검 완료)");
  });

  it("60일 이상 + 점검 뒤 AS 없음 → 필요", () => {
    const input = base({ lastAs: "2026-07-01" });
    const r = judgeVisit(input);
    expect(r.verdict).toBe("필요");
    expect(buildVisitAdviceText(input, r)).not.toContain("근거:");
  });

  it("매월점검은 25일 기준", () => {
    const input = base({ lastInspection: "2026-10-04", workin: { label: "G7", kind: "monthly" } });
    const r = judgeVisit(input);
    expect(r).toMatchObject({ verdict: "필요", elapsedDays: 26 });
    expect(buildVisitAdviceText(input, r)).toContain("점검여부: 필요 (경과 26일 / 기준 25일, 워킨맵 있음)");
  });

  it("점검 기록 없음 + 워킨맵 있음 → 필요(기록 없음 표시)", () => {
    const input = base({ lastInspection: undefined });
    const r = judgeVisit(input);
    expect(r).toMatchObject({ verdict: "필요", elapsedDays: null });
    const text = buildVisitAdviceText(input, r);
    expect(text).toContain("마지막점검일:기록 없음");
    expect(text).toContain("점검여부: 필요 (점검 기록 없음 / 기준 60일, 워킨맵 있음)");
  });

  it("자료 없음·못 찾음·조회 실패 → 판단불가", () => {
    expect(judgeVisit(base({ lastInspection: undefined, deviceTotal: 0, workin: null })).verdict).toBe("판단불가");
    expect(judgeVisit(base({ notFound: true })).verdict).toBe("판단불가");
    const failed = base({ lookupError: "timeout" });
    const r = judgeVisit(failed);
    expect(r.verdict).toBe("판단불가");
    expect(buildVisitAdviceText(failed, r)).toContain("방문 판단: 자료 못 읽음");
  });

  it("1대·AS 그 기기·여분 충분이면 생략 가능 참고", () => {
    const input = base({ deviceTotal: 1, lastAs: "2026-10-23", asAfterInspection: [{ date: "2026-10-23", deviceCount: 1 }] });
    expect(buildVisitAdviceText(input, judgeVisit(input))).toContain("참고: 1대·여분 충분 — AS 때 점검까지 했으면 생략 가능");
  });
});

describe("shouldSend(할 일 있을 때만)", () => {
  it("네 경우", () => {
    expect(shouldSend({ verdict: "불필요", elapsedDays: 10, reasons: [] }, [])).toBe(false);
    expect(shouldSend({ verdict: "불필요", elapsedDays: 10, reasons: [] }, [swap])).toBe(true);
    expect(shouldSend({ verdict: "필요", elapsedDays: 90, reasons: [] }, [])).toBe(true);
    expect(shouldSend({ verdict: "판단필요", elapsedDays: 90, reasons: [] }, [])).toBe(true);
    expect(shouldSend({ verdict: "판단불가", elapsedDays: null, reasons: [] }, [])).toBe(true);
  });
});

describe("추가일정 줄", () => {
  it("날짜순·같은 건물 다른 업체 표시·지난 미완료 표시", () => {
    const input = base({
      lastInspection: "2026-09-20",
      upcoming: [
        swap,
        { date: "2026-10-29", kind: "AS", title: "AS(용지걸림)", vendor: "x", sameBuilding: false, source: "" },
        { date: "2026-11-01", kind: "물류", title: "납품", vendor: "옆집상사", sameBuilding: true, source: "운영팀" },
      ],
    });
    const text = buildVisitAdviceText(input, judgeVisit(input));
    expect(text).toContain("1.2026-10-29(목) AS(용지걸림) (지남·미완료)\n2.2026-11-01(일) [같은 건물] 옆집상사 — 납품 — 운영팀\n3.2026-11-02(월) 교체(일반)/기기상향 — 운영팀");
    expect(text.endsWith(BUNDLE_LINE)).toBe(true);
  });

  it("5줄 넘으면 외 N건", () => {
    const many = Array.from({ length: 8 }, (_, i): UpcomingItem => ({ ...swap, date: `2026-11-${String(i + 3).padStart(2, "0")}` }));
    const text = buildVisitAdviceText(base({ upcoming: many }), judgeVisit(base({ upcoming: many })));
    expect(text).toContain("5.2026-11-07");
    expect(text).not.toContain("6.2026-11-08");
    expect(text).toContain("외 3건 — 일정리스트 확인");
  });

  it("600자를 넘으면 줄을 줄여 600자 이내", () => {
    const long = Array.from({ length: 5 }, (_, i): UpcomingItem => ({ ...swap, date: `2026-11-0${i + 3}`, title: "아주 긴 일정 설명 ".repeat(8) }));
    const input = base({ upcoming: long });
    const text = buildVisitAdviceText(input, judgeVisit(input));
    expect(text.length).toBeLessThanOrEqual(VISIT_ADVICE_MAX_CHARS);
    expect(text).toMatch(/외 \d+건 — 일정리스트 확인/);
    expect(text.endsWith(BUNDLE_LINE)).toBe(true);
  });
});

describe("notFoundText", () => {
  it("3줄, 빈 칸 뺌", () => {
    expect(notFoundText("청오에스떠블유", "V", "D470/-/ABC12345")).toBe(
      "청오에스떠블유 V\nD470/ABC12345\n방문 판단: 임대리스트에서 못 찾음 — 마지막 점검·추가일정을 직접 확인해 주세요",
    );
    expect(notFoundText("청오에스떠블유").split("\n")).toHaveLength(3);
  });
});

describe("sameBuildingKey(같은 건물)", () => {
  it("같은 건물은 같은 키", () => {
    expect(sameBuildingKey("서울 강남구 테헤란로 152 강남파이낸스센터 12층")).toBe(sameBuildingKey("서울특별시 강남구 테헤란로 152 (역삼동) 3층"));
    expect(sameBuildingKey("서울 서초구 서초대로 77길 17 지하1층 (블럭77 빌딩)")).toBe(sameBuildingKey("서울시 서초구 서초대로77길 17 5층"));
    expect(sameBuildingKey("서울 강남구 역삼동 837-11 유니온센터 1707호")).toBe(sameBuildingKey("서울시 강남구 역삼동 837-11번지 2층"));
  });
  it("다른 건물은 다른 키", () => {
    expect(sameBuildingKey("서울 중구 세종대로 110")).not.toBe(sameBuildingKey("서울 중구 세종대로 124"));
    expect(sameBuildingKey("서울 강남구 테헤란로 152")).not.toBe(sameBuildingKey("서울 강남구 테헤란로 152-1"));
    expect(sameBuildingKey("서울 동대문구 천호대로 1")).not.toBe(sameBuildingKey("서울 성동구 천호대로 1"));
  });
  it("빈 주소는 빈 키", () => {
    expect(sameBuildingKey("")).toBe("");
  });
});
