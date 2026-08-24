/**
 * 예상 상담 시나리오 — 옛 scenario.py(분석 엔진 6단계)를 그대로 옮긴 것.
 * 거래처 유형 + 핵심 이슈에 따라 예상 고객 반응과 응대 멘트를 우선순위로 고른다.
 * 멘트는 사내에서 다듬은 문장 그대로 — 임의로 고치지 않는다.
 */
import type { LedgerAnalysis } from "./ledger";
import type { Judgement } from "./judge";

export type Scenario = { reaction: string; intent: string; response: string; followUp: string };
export type CounselingPlan = { firstApproach: string; scenarios: Scenario[]; avoidPhrases: string[]; closing: string };

const T: Record<string, Scenario> = {
  초과료_불만: {
    reaction: "초과료가 너무 많이 나온다",
    intent: "혜택보다 구조 문제로 전환",
    response: "그 부분은 단순히 혜택을 드리는 것보다 구조를 조정하는 게 더 실질적으로 도움이 됩니다. 사용량을 보니까 기본 매수보다 꾸준히 초과되는 패턴이면 재계약하면서 기본 조건을 조금 손보는 게 오히려 안정적입니다.",
    followUp: "지금처럼 쓰실 기준으로 어떤 구조가 제일 유리한지 계산해서 말씀드릴게요.",
  },
  가격_인하_요청: {
    reaction: "가격을 깎아달라",
    intent: "직접 가격 인하 대신 다른 카드로 유도",
    response: "가격 자체를 바로 조정해드리는 방식보다는, 계약기간 조건에 따라 무상 적용이나 조건 조정으로 도와드리는 방향이 더 현실적입니다. 사용량을 같이 보면 단순 할인보다 지금 구조를 조금 손보는 게 더 유리할 수도 있습니다.",
    followUp: "최근 사용량 기준으로 어떤 방식이 제일 부담이 덜한지 같이 봐드릴게요.",
  },
  장기계약_부담: {
    reaction: "3년 계약이 부담스럽다",
    intent: "2년 절충안 제시",
    response: "부담스러우실 수 있어서 무조건 길게만 권해드리진 않습니다. 다만 2년이나 3년으로 가면 조건을 조금 더 안정적으로 맞춰드릴 수 있는 장점은 있습니다. 부담 적은 쪽으로 2년 기준도 같이 말씀드릴게요.",
    followUp: "대표님 입장에서 부담 덜한 조건으로 비교해서 보시면 결정하시기 편하실 겁니다.",
  },
  추가_혜택_요구: {
    reaction: "혜택을 더 달라",
    intent: "1개 카드 원칙 유지",
    response: "혜택을 여러 가지로 같이 드리는 경우는 많지 않아서, 실제로 가장 체감되는 방향으로 하나를 맞춰드리는 게 현실적입니다. 무상 쪽이 나으신지, 아니면 사용량 쪽 조정이 더 나으신지 보고 맞춰드리는 게 좋습니다.",
    followUp: "실제로 대표님 입장에서 뭐가 더 이득인지 기준 잡아서 말씀드릴게요.",
  },
  장비_불만: {
    reaction: "기기가 자꾸 말썽이다",
    intent: "장비 해결 우선, 재계약 저항 낮추기",
    response: "그 상태에서 계약 이야기 먼저 드리는 건 맞지 않아서, 장비 상태부터 먼저 점검하는 게 맞습니다. 사용하시는데 불편이 있으면 그 부분부터 해결해드리고 조건을 말씀드리겠습니다.",
    followUp: "어떤 증상이 가장 불편하셨는지 먼저 확인해볼게요.",
  },
  고민_보류: {
    reaction: "고민해보겠다",
    intent: "압박하지 않고 다음 액션 확보",
    response: "네, 바로 결정하실 내용은 아니니까 편하게 보셔도 됩니다. 다만 조건은 제가 정리해서 다시 한 번 보기 쉽게 말씀드리겠습니다.",
    followUp: "언제쯤 다시 말씀드리면 편하실지만 알려주시면 그때 맞춰 연락드리겠습니다.",
  },
  타사_비교: {
    reaction: "다른 업체랑 비교해본다",
    intent: "맞대응 약속 금지, 차이점 안내",
    response: "비교해보시는 건 당연히 필요합니다. 다만 겉조건만 보면 비슷해 보여도 실제로는 사용량 구조나 장비 관리에서 차이가 있을 수 있어서 그 부분까지 같이 보셔야 합니다.",
    followUp: "혹시 비교하시는 포인트가 가격인지 장비인지 말씀 주시면 그 기준으로 맞춰드릴게요.",
  },
  자동연장_선호: {
    reaction: "그냥 자동연장하면 안 되냐",
    intent: "편의성 인정, 그래도 재계약 장점 안내",
    response: "그대로 쓰시는 건 가능하신데, 재계약으로 정리해두시면 조건이나 관리 측면에서 더 안정적으로 맞춰드릴 수 있습니다. 특히 사용량이나 장비 상태가 바뀐 부분이 있으면 지금 한 번 정리해두시는 게 더 유리할 수 있습니다.",
    followUp: "기존 그대로가 좋은지, 이번에 한 번 조건 정리하는 게 좋은지 비교해서 말씀드릴게요.",
  },
  결재권자_확인: {
    reaction: "대표님 결재 받아야 한다",
    intent: "결재용 요약 자료 톤으로 정리",
    response: "네, 그런 경우가 많아서 대표님 보시기 편하게 핵심만 간단히 정리드릴 수 있습니다. 조건, 비용, 장비 부분만 딱 비교되게 말씀드리겠습니다.",
    followUp: "결재 보시기 편한 방식으로 1안, 2안 정도로 정리해드릴게요.",
  },
};

export function buildCounseling(
  analysis: LedgerAnalysis,
  verdict: Judgement,
  extra: { asTotal?: number } = {},
): CounselingPlan {
  const firstApproach = verdict.거래처유형 === "가격형" ? "초과료/사용량 구조 설명을 먼저, 가격 직접 인하 대신 조건 조정으로 유도"
    : verdict.거래처유형 === "관계형" ? "관리/신뢰 부분 강조. 혜택은 보조 수단으로만"
    : verdict.거래처유형 === "귀찮음형" ? "짧고 간단하게 — '기존처럼 편하게 정리해드리는 느낌'"
    : verdict.거래처유형 === "장비민감형" ? "장비 점검/교체 먼저, 조건 얘기는 그 다음"
    : "가장 큰 불만 1순위를 먼저 해결";

  const overCount = analysis.usage.reduce((sum, stat) => sum + stat.초과월수, 0);
  const selected: Scenario[] = [];
  if (overCount >= 3) selected.push(T.초과료_불만);
  if (verdict.거래처유형 === "가격형") selected.push(T.가격_인하_요청);
  if (verdict.추천기간 === 3) selected.push(T.장기계약_부담);
  if (verdict.혜택필요) selected.push(T.추가_혜택_요구);
  if (verdict.거래처유형 === "장비민감형" || (extra.asTotal || 0) >= 5) selected.push(T.장비_불만);
  if (/자동연장|자동갱신/.test(analysis.remarks)) selected.push(T.자동연장_선호);
  selected.push(T.고민_보류, T.타사_비교, T.결재권자_확인);

  const seen = new Set<string>();
  const scenarios = selected.filter((s) => (seen.has(s.reaction) ? false : (seen.add(s.reaction), true))).slice(0, 6);

  return {
    firstApproach,
    scenarios,
    avoidPhrases: ["그건 안 됩니다", "제 권한이 아닙니다", "불가능합니다", "타사 조건 맞춰드릴게요 (즉답)"],
    closing: "오늘 말씀 나눈 내용은 정리해서 다시 한 번 깔끔하게 보내드리겠습니다. 결정 급하신 거 아니니까 천천히 보시고, 추가로 봐드릴 부분 있으면 편하게 연락 주세요.",
  };
}
