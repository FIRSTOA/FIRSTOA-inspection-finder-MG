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
  judgeMonthlyWindow,
  monthlyWindow,
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
    thresholds: { quarterDays: 60, monthlyWindowDays: 5 },
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

  it("매월점검은 경과일이 아니라 마감일 창으로 본다(26일 지나도 창 밖이면 불필요)", () => {
    const input = base({ lastInspection: "2026-10-04", today: "2026-10-30", workin: { label: "C팀", kind: "monthly", closingDay: 20, progress: "G1" } });
    const r = judgeVisit(input);
    expect(r).toMatchObject({ verdict: "불필요", elapsedDays: 26 });
    expect(buildVisitAdviceText(input, r)).toContain("점검여부: 불필요 (경과 26일 / 마감 20일 · 창 밖 11/16~11/20, 워킨맵 있음)");
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

// 2026-10-31 밤 사용자 결정: 매월점검 = 마감일 기준 주말 제외 5영업일. 웍스피어(마감 20) 11/20(금) → 11/16(월)~11/20(금)
describe("매월점검 마감일 창(영업일)", () => {
  const works = (today: string, over: Partial<NonNullable<VisitAdviceInput["workin"]>> = {}) =>
    base({ today, lastInspection: "2026-10-19", workin: { label: "C팀", kind: "monthly", closingDay: 20, progress: "G2", ...over } });

  it("웍스피어: 11/2 접수 → 불필요(창 밖), 11/16·11/18·11/20 → 필요", () => {
    const early = judgeVisit(works("2026-11-02"));
    expect(early.verdict).toBe("불필요");
    expect(early.reasons).toEqual(["매월점검 마감 20일 · 창 밖(11/16~11/20)"]);
    for (const d of ["2026-11-16", "2026-11-18", "2026-11-20"]) {
      const r = judgeVisit(works(d));
      expect(r.verdict, d).toBe("필요");
      expect(r.reasons).toEqual(["매월점검 마감 20일 · 창 11/16~11/20"]);
    }
    const input = works("2026-11-18");
    expect(buildVisitAdviceText(input, judgeVisit(input))).toContain("점검여부: 필요 (경과 30일 / 마감 20일 · 창 11/16~11/20, 워킨맵 있음)");
  });

  it("11/23 접수(마감 지남) → 다음 달 창으로 계산해 불필요", () => {
    const r = judgeVisit(works("2026-11-23"));
    expect(r.verdict).toBe("불필요");
    // 12/20 은 일요일 → 끝 12/18(금), 5영업일 12/14~12/18
    expect(r.reasons).toEqual(["매월점검 마감 20일 · 창 밖(12/14~12/18)"]);
  });

  it("마감일이 주말이면 그 전 영업일이 끝(11/22 일 → 11/16~11/20)", () => {
    expect(monthlyWindow(2026, 11, 22, 5)).toEqual({ start: "2026-11-16", end: "2026-11-20" });
    expect(judgeVisit(works("2026-11-20", { closingDay: 22 })).verdict).toBe("필요");
    expect(judgeVisit(works("2026-11-13", { closingDay: 22 })).verdict).toBe("불필요");
  });

  it("마감일 31인데 11월은 30일까지 → 말일 11/30(월), 창 11/24~11/30(주말 제외 5일)", () => {
    expect(monthlyWindow(2026, 11, 31, 5)).toEqual({ start: "2026-11-24", end: "2026-11-30" });
    expect(judgeVisit(works("2026-11-28", { closingDay: 31 })).verdict).toBe("필요"); // 토요일 접수도 창 안
    expect(judgeVisit(works("2026-11-23", { closingDay: 31 })).verdict).toBe("불필요");
  });

  it("공휴일이 끼면 창이 늘어난다(10/9 한글날 마감 → 끝 10/8, 10/5 대체공휴일 건너뛰어 10/1~10/8)", () => {
    expect(monthlyWindow(2026, 10, 9, 5)).toEqual({ start: "2026-10-01", end: "2026-10-08" });
    expect(judgeVisit(works("2026-10-01", { closingDay: 9, progress: "G1" })).verdict).toBe("필요");
    expect(judgeVisit(works("2026-09-30", { closingDay: 9, progress: "G1" })).verdict).toBe("불필요");
  });

  it("월초 마감은 다음 달 창이 이번 달 말에 걸친다(12/1 마감 → 11/25~12/1)", () => {
    expect(judgeMonthlyWindow("2026-11-26", 1, 5)).toEqual({ inWindow: true, window: { start: "2026-11-25", end: "2026-12-01" } });
  });

  it("라벨로 이번 달 완료: 11월(분기 2번째 달) G3 → 불필요, G2 → 필요; 10월 G2 → 불필요", () => {
    const g3 = judgeVisit(works("2026-11-18", { progress: "G3" }));
    expect(g3.verdict).toBe("불필요");
    expect(g3.reasons[0]).toBe("이번 달 매월점검 완료(G3)");
    expect(judgeVisit(works("2026-11-18", { progress: "G2" })).verdict).toBe("필요");
    expect(judgeVisit(works("2026-10-15", { progress: "G2" })).verdict).toBe("불필요");
    expect(judgeVisit(works("2026-10-15", { progress: "G1" })).verdict).toBe("필요");
  });

  it("G5·G12 는 창 안이어도 불필요(기존대로)", () => {
    expect(judgeVisit(works("2026-11-18", { label: "G5" })).verdict).toBe("불필요");
    expect(judgeVisit(works("2026-11-18", { label: "G12" })).verdict).toBe("불필요");
  });

  it("마감일 모르면(이름 앞 숫자 없음) 판단필요", () => {
    const input = works("2026-11-18", { closingDay: null });
    const r = judgeVisit(input);
    expect(r.verdict).toBe("판단필요");
    expect(buildVisitAdviceText(input, r)).toContain("점검여부: 판단필요 (경과 30일 / 마감일 모름, 워킨맵 있음)");
  });

  it("분기점검은 그대로 60일 기준", () => {
    expect(judgeVisit(base({ lastInspection: "2026-09-01" })).verdict).toBe("불필요");
    expect(judgeVisit(base({ lastAs: "2026-07-01" })).verdict).toBe("필요");
  });
});
