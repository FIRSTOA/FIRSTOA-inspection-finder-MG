/**
 * 추천 플랜 A/B/C 회귀 테스트 — 옛 calcProposals의 상황 분류 룰이 그대로 지켜지는지.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { analyzeLedger } from "../src/recontract/ledger";
import { judge } from "../src/recontract/judge";
import { calcProposals } from "../src/recontract/proposals";
import { buildCounseling } from "../src/recontract/scenario";

const sample = readFileSync(new URL("./fixtures/ecount-ledger-sample.txt", import.meta.url), "utf8");
const 기준일 = new Date("2026-08-19T00:00:00+09:00");

describe("장기·안정 거래처 (픽스처: 10년차·초과 1회·완납)", () => {
  const analysis = analyzeLedger(sample);
  const verdict = judge(analysis, 기준일);
  const plans = calcProposals(analysis, verdict);

  it("A안 = 혜택 없음 3년 (장기+안정은 혜택 없이 성사 가능)", () => {
    expect(plans[0].rank).toBe("A");
    expect(plans[0].recommended).toBe(true);
    expect(plans[0].label).toBe("3년 + 혜택 없음");
    expect(plans[0].reason).toContain("10년 장기 + 안정");
  });

  it("B안 무상 1개월 · C안 무상 2개월 — 손실 오름차순", () => {
    expect(plans[1].label).toBe("3년 + 무상 1개월");
    expect(plans[2].label).toBe("3년 + 무상 2개월");
  });

  it("혜택 비용·회사 매출·ROI가 숫자로 맞는다 (기본료 12만)", () => {
    expect(plans[0].benefitValue).toBe(0);
    expect(plans[0].companyRevenue).toBe(120_000 * 36);
    expect(plans[0].companyROI).toBe("∞");
    expect(plans[1].benefitValue).toBe(120_000);
    expect(plans[1].companyRevenue).toBe(120_000 * 35);
    expect(plans[1].companyROI).toBe("35.0");
  });

  it("컬러 활용률 88%면 A안 근거에 구조 조정 병행이 붙는다", () => {
    expect(plans[0].reason).toContain("컬러 활용률 88%");
  });
});

describe("AS가 잦으면 기기 교체가 1순위", () => {
  const analysis = analyzeLedger(sample);
  const verdict = judge(analysis, 기준일);
  const plans = calcProposals(analysis, verdict, { asTotal: 7, asRecent: true });
  it("A안 = 동급 기기 교체", () => {
    expect(plans[0].label).toBe("3년 + 동급 기기 교체");
    expect(plans[0].reason).toContain("AS 7건");
  });
});

describe("상담 시나리오", () => {
  const analysis = analyzeLedger(sample);
  const verdict = judge(analysis, 기준일);
  const plan = buildCounseling(analysis, verdict);

  it("관계형이면 관리·신뢰 강조가 1차 방향", () => {
    expect(plan.firstApproach).toContain("관리/신뢰");
  });
  it("기본 3종(고민 보류·타사 비교·결재권자)은 항상 들어간다", () => {
    const reactions = plan.scenarios.map((s) => s.reaction);
    expect(reactions).toContain("고민해보겠다");
    expect(reactions).toContain("다른 업체랑 비교해본다");
    expect(reactions).toContain("대표님 결재 받아야 한다");
  });
  it("최대 6건 · 중복 없음", () => {
    const reactions = plan.scenarios.map((s) => s.reaction);
    expect(reactions.length).toBeLessThanOrEqual(6);
    expect(new Set(reactions).size).toBe(reactions.length);
  });
  it("금지 표현이 정책 그대로", () => {
    expect(plan.avoidPhrases).toContain("타사 조건 맞춰드릴게요 (즉답)");
  });
});
