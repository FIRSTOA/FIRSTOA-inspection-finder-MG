/**
 * 추천 플랜 A/B/C — 옛 recontract_webapp의 calcProposals를 그대로 옮긴 것.
 *
 * 상황을 우선순위로 분류해(장비 이슈 > 불만 > 결제 불안 > 초과 과다 > 장기 안정 > 신규 > 일반)
 * 카드 3장을 권장 순서로 내놓는다. 카드는 손실이 낮은 것부터: 혜택 없음 → 무상 1개월 →
 * 무상 2개월 → 동급 기기 교체(비용은 보수적으로 임대료 2개월치로 추정).
 * 사내 룰이므로 임의로 바꾸지 않는다 — 바꿀 일이 생기면 테스트 기대값부터 고친다.
 */
import type { LedgerAnalysis } from "./ledger";
import type { Judgement } from "./judge";

export type Proposal = {
  rank: "A" | "B" | "C";
  recommended: boolean;
  reason: string;          // 왜 이 카드가 이 순위인가 (상황 근거)
  label: string;
  termYears: number;
  benefitValue: number;    // 회사가 쓰는 비용
  companyRevenue: number;  // 계약기간 회사 매출
  companyROI: string;      // 매출/비용 (혜택 없음이면 ∞)
  highlights: string[];
  note: string;
};

/** 대장 밖에서 오는 신호 — 없으면 0으로 두면 된다 (붙여넣기 단독 분석도 가능해야 한다) */
export type ExtraSignals = {
  complaintTotal?: number;     // 불만 건수
  complaintSevere?: number;    // 심각 불만
  complaintDevice?: boolean;   // 장비 관련 불만 여부
  asTotal?: number;            // AS 건수 (최근 18개월)
  asRecent?: boolean;          // 최근 60일 내 AS 있었나
};

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const roi = (revenue: number, cost: number) => (cost > 0 ? (revenue / cost).toFixed(1) : "∞");

type Card = Omit<Proposal, "rank" | "recommended" | "reason">;

function cardNoFreebie(base: number, yr: number): Card {
  const months = yr * 12;
  return {
    label: `${yr}년 + 혜택 없음`, termYears: yr,
    benefitValue: 0, companyRevenue: base * months, companyROI: "∞",
    highlights: [`현 조건 그대로 ${yr}년 연장`, `${months}개월 안정 거래 락인`, "회사 손실 0원 — 최우선 시도"],
    note: "안정 거래처는 혜택 없이도 성사 가능.",
  };
}
function cardFree1(base: number, yr: number): Card {
  const months = yr * 12;
  const revenue = base * (months - 1);
  return {
    label: `${yr}년 + 무상 1개월`, termYears: yr,
    benefitValue: base, companyRevenue: revenue, companyROI: roi(revenue, base),
    highlights: [`임대료 1개월 무상 (${fmt(base)}원 즉시 절감)`, `${months - 1}개월 안정 거래`, "체감 큼 / 회사 손실 적음"],
    note: "가장 무난한 1순위 혜택.",
  };
}
function cardFree2(base: number, yr: number): Card {
  const months = yr * 12;
  const benefit = base * 2;
  const revenue = base * (months - 2);
  return {
    label: `${yr}년 + 무상 2개월`, termYears: yr,
    benefitValue: benefit, companyRevenue: revenue, companyROI: roi(revenue, benefit),
    highlights: [`임대료 2개월 무상 (${fmt(benefit)}원 즉시 절감)`, "사과 / 관리 책임 강화 메시지", `${months - 2}개월 락인`],
    note: "성사 직전 마지막 카드.",
  };
}
function cardDeviceSwap(base: number, yr: number): Card {
  const months = yr * 12;
  const benefit = base * 2; // 동급 교체 회사 비용 — 보수적으로 임대료 2개월치(이설 + 잔존가치)
  const revenue = base * months;
  return {
    label: `${yr}년 + 동급 기기 교체`, termYears: yr,
    benefitValue: benefit, companyRevenue: revenue, companyROI: roi(revenue, benefit),
    highlights: ["동급 상태 좋은 장비 또는 1단계 상향", "장비 불만 직접 해결 — 무상보다 효과적", `${months}개월 신규 안정 운영`],
    note: "장비 문제 핵심 거래처에 가장 효과적.",
  };
}

export function calcProposals(analysis: LedgerAnalysis, verdict: Judgement, extra: ExtraSignals = {}): Proposal[] {
  const base = analysis.billing.월기본료 || 0;

  // ── 거래처 신호 수집 ──
  const colorUtil = verdict.컬러활용률;
  const overCount = analysis.usage.reduce((sum, stat) => sum + stat.초과월수, 0);
  const overTotal = analysis.billing.초과청구합;
  const years = verdict.거래연차;
  const 미납 = analysis.payment.미납월.length > 1 ? analysis.payment.미납월.length - 1 : 0; // 마지막 청구월 제외
  const finalBalance = analysis.누계.잔액;
  const severeComplaints = extra.complaintSevere || 0;
  const totalComplaints = extra.complaintTotal || 0;
  const totalAS = extra.asTotal || 0;
  const heavyAS = totalAS >= 5;

  // ── 상황 분류 (우선순위 — 원본 룰 그대로) ──
  const isLongStable = years >= 7 && severeComplaints === 0 && totalAS < 3 && 미납 === 0;
  const hasDeviceIssue = heavyAS || !!extra.complaintDevice;
  const hasIssue = severeComplaints > 0;
  const hasHeavyOverage = overTotal >= 500_000 || overCount >= 4;
  const hasPaymentRisk = 미납 > 0 || (finalBalance >= 500_000 && analysis.payment.판정 !== "우량");
  const isNewVendor = years > 0 && years <= 2;

  let a: Card, b: Card, c: Card;
  let aR = "", bR = "", cR = "";
  if (hasDeviceIssue) {
    a = cardDeviceSwap(base, 3); aR = `장비 이슈 (AS ${totalAS}건${extra.asRecent ? " · 최근 발생" : ""}) — 교체가 무상보다 효과적`;
    b = cardDeviceSwap(base, 2); bR = "2년 단위 + 교체";
    c = cardFree2(base, 3); cR = "교체 거부 시 보상 카드";
  } else if (hasIssue) {
    a = cardFree2(base, 3); aR = `불만 ${totalComplaints}건 (심각 ${severeComplaints}) — 사과 + 신뢰 회복`;
    b = cardFree1(base, 2); bR = "2년 단기 + 신뢰 회복";
    c = cardDeviceSwap(base, 3); cR = "장비 동반 불만 시 대안";
  } else if (hasPaymentRisk) {
    a = cardNoFreebie(base, 2); aR = `결제 불안 (미납 ${미납}개월${finalBalance ? ` / 잔액 ${fmt(finalBalance)}원` : ""}) — 보수적 접근`;
    b = cardFree1(base, 2); bR = "거래처 부담 호소 시 1개월 무상";
    c = cardNoFreebie(base, 1); cR = "리스크 통제 — 1년 단기";
  } else if (hasHeavyOverage) {
    a = cardFree1(base, 3); aR = `초과 ${overCount}회 / ${fmt(overTotal)}원 — 무상으로 사과 + 구조 설명 별도 상담`;
    b = cardFree1(base, 2); bR = "계약기간 절충";
    c = cardFree2(base, 3); cR = "추가 보상 필요 시";
  } else if (isLongStable) {
    a = cardNoFreebie(base, 3); aR = `${years}년 장기 + 안정 — 혜택 없이 성사 가능`;
    b = cardFree1(base, 3); bR = "관계 유지 보너스";
    c = cardFree2(base, 3); cR = "거래처 망설임 시 마지막 카드";
  } else if (isNewVendor) {
    a = cardFree1(base, 2); aR = `${years}년차 신규 — 진입 부담 완화 + 검토 후 장기 전환`;
    b = cardNoFreebie(base, 2); bR = "관계 형성 우선 — 혜택 없이 시도";
    c = cardFree1(base, 3); cR = "장기 락인 검토";
  } else {
    a = cardFree1(base, 3); aR = "안정 거래 — 표준 균형안 (가장 무난한 1개 혜택)";
    b = cardNoFreebie(base, 3); bR = "혜택 불필요 시 — 시도해볼 가치 있음";
    c = cardFree1(base, 2); cR = "계약기간 부담 호소 시";
  }
  // 컬러 활용률이 한계에 붙어 있으면 A안 근거에 덧붙인다 (구조 조정 여지)
  if (colorUtil >= 80) aR += ` · 컬러 활용률 ${colorUtil}% — 기본매수 조정 상담 병행`;

  return [
    { ...a, rank: "A", recommended: true, reason: aR },
    { ...b, rank: "B", recommended: false, reason: bR },
    { ...c, rank: "C", recommended: false, reason: cR },
  ];
}
