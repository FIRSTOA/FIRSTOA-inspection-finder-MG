/**
 * 재계약 판정 — 옛 recontract-system judgement.py(3·4·5단계)를 그대로 옮긴 것.
 *
 * 모든 룰 위에 있는 원칙 (원본 주석 그대로):
 *   1. "혜택 없음"이 1순위
 *   2. 카드 1장 원칙
 *   3. 컬러 혜택은 계약기간 전체 가치로 환산해 무상과 숫자 비교
 *   4. 추정 금지
 *
 * 사내 정책(권한 안/밖, 혜택 우선순위)이라 임의로 바꾸지 않는다. 규칙을 손볼 일이 생기면
 * tests/recontractJudge.test.ts의 기대값을 먼저 고치고 여기를 고친다.
 *
 * 원본과 다른 점 하나: 결제 안정성의 '잔액'.
 * 원본은 대장 누계 잔액을 그대로 미수로 봤는데, 마지막 청구월은 아직 수금 전인 게 정상이라
 * 우량 거래처가 '가끔불안'으로 떨어졌다. 여기서는 마지막 청구월의 미수는 빼고 본다.
 */
import type { LedgerAnalysis } from "./ledger";

export type Judgement = {
  거래관계: "장기" | "일반" | "신규" | "판단 불가";
  거래연차: number;
  사용패턴: "안정" | "증가" | "편차" | "초과상시";
  초과수준: "없음" | "보통" | "많음" | "매우많음";
  결제안정성: "안정" | "가끔불안" | "잦은불안";
  거래처유형: "가격형" | "관계형" | "귀찮음형" | "장비민감형" | "혼합형";
  난이도: "쉬움" | "보통" | "어려움" | "매우어려움";
  추천기간: number;
  컬러활용률: number;        // 월평균 사용 / 기본매수 × 100
  혜택필요: boolean;
  구조조정필요: boolean;
  혜택가치: Array<{ card: string; value: number | null; note: string }>;
  추천카드: string;
  차선카드: string;
  권한밖: string[];
  헤드라인: string;
  위험신호: string[];
};

const 권한밖 = [
  "임대료 직접 인하 (가격 조정)",
  "혜택 2개 이상 동시 제공",
  "고급 장비 상향 교체 (동급 외)",
  "예외적 장기 무상 (3개월+)",
  "계약서 외 별도 지원",
];

/** 거래 시작 연도 — 보증금 입금일 > 임대개시 명시 > 적요의 가장 빠른 계약 시작 > 첫 거래내역 */
function earliestYear(analysis: LedgerAnalysis): number | null {
  const remarks = analysis.remarks;
  const deposit = remarks.match(/보증금[^\n]*?(\d{2})[.\/](\d{1,2})[.\/](\d{1,2})\s*입?/)
    || remarks.match(/보\s*\d+만?\s*\(\s*(\d{2})[.\/](\d{1,2})[.\/](\d{1,2})\s*入/);
  if (deposit) return 2000 + Number(deposit[1]);
  const start = remarks.match(/임대\s*개시[^0-9]*(\d{2})[.\/](\d{1,2})[.\/](\d{1,2})/)
    || remarks.match(/최초임대\s*\(?\s*(\d{2})[.\/](\d{1,2})[.\/](\d{1,2})/);
  if (start) return 2000 + Number(start[1]);
  const years = Array.from(remarks.matchAll(/(\d{2})[.\/]\d{1,2}[.\/]\d{1,2}\s*~/g)).map((m) => 2000 + Number(m[1]));
  if (years.length) return Math.min(...years);
  const first = analysis.months[0]?.ym;
  return first ? Number(first.slice(0, 4)) : null;
}

export function judge(analysis: LedgerAnalysis, today = new Date()): Judgement {
  const color = analysis.usage.find((stat) => stat.kind === "컬러");
  const 컬러활용률 = color?.기본매수 ? Math.round((color.월평균 / color.기본매수) * 100) : 0;
  const 초과횟수 = analysis.usage.reduce((sum, stat) => sum + stat.초과월수, 0);
  const 사용개월수 = Math.max(...analysis.usage.map((stat) => stat.개월수), 0);
  const 기본료 = analysis.billing.월기본료;

  // ── 3단계 ─────────────────────────────────────────────────────────────────
  const year = earliestYear(analysis);
  const 거래연차 = year ? today.getFullYear() - year : 0;
  const 거래관계: Judgement["거래관계"] = !year ? "판단 불가" : 거래연차 >= 7 ? "장기" : 거래연차 >= 3 ? "일반" : "신규";

  let 사용패턴: Judgement["사용패턴"];
  let 초과수준: Judgement["초과수준"];
  if (초과횟수 === 0) { 사용패턴 = "안정"; 초과수준 = "없음"; }
  else if (초과횟수 >= Math.max(6, 사용개월수 * 0.4)) { 사용패턴 = "초과상시"; 초과수준 = "매우많음"; }
  else if (초과횟수 >= 3) { 사용패턴 = 컬러활용률 > 70 ? "증가" : "편차"; 초과수준 = "많음"; }
  else { 사용패턴 = "안정"; 초과수준 = "보통"; }
  // 초과료 규모가 기본료의 절반을 넘으면 횟수와 무관하게 심각하다
  if (기본료 && analysis.billing.초과청구합 && 초과횟수) {
    if (analysis.billing.초과청구합 / 초과횟수 >= 기본료 * 0.5) 초과수준 = "매우많음";
  }

  // 결제 판정은 잔액·승인실패 기준 — 달 단위 대조는 CMS(다음 달 출금) 업체를 미납으로 오판한다(실사고)
  const cms실패 = analysis.payment.cms실패;
  const 잔액 = analysis.payment.실질잔액;
  const 결제안정성: Judgement["결제안정성"] = cms실패 === 0 && 잔액 === 0 ? "안정"
    : cms실패 >= 3 || 잔액 > 500_000 ? "잦은불안" : "가끔불안";

  const signals: string[] = [];
  if (초과수준 === "많음" || 초과수준 === "매우많음") signals.push("가격형");
  if (/할인|가격/.test(analysis.remarks)) signals.push("가격형");
  if (거래관계 === "장기" && 결제안정성 === "안정") signals.push("관계형");
  if (/자동연장|자동갱신/.test(analysis.remarks)) signals.push("귀찮음형");
  if ((analysis.remarks.match(/교체/g) || []).length >= 2) signals.push("장비민감형");
  let 거래처유형: Judgement["거래처유형"] = "관계형";
  if (signals.length) {
    const unique = new Set(signals);
    if (unique.size === 1) 거래처유형 = signals[0] as Judgement["거래처유형"];
    else {
      거래처유형 = "혼합형";
      for (const candidate of ["가격형", "장비민감형", "관계형", "귀찮음형"]) {
        if (signals.filter((signal) => signal === candidate).length >= 2) {
          거래처유형 = candidate as Judgement["거래처유형"];
          break;
        }
      }
    }
  }

  let score = 0;
  if (거래관계 === "장기") score -= 1;
  if (거래관계 === "신규") score += 1;
  if (결제안정성 === "안정") score -= 1;
  if (결제안정성 === "잦은불안") score += 2;
  if (초과수준 === "없음") score -= 1;
  if (초과수준 === "많음") score += 1;
  if (초과수준 === "매우많음") score += 2;
  const 난이도: Judgement["난이도"] = score <= -2 ? "쉬움" : score <= 0 ? "보통" : score <= 2 ? "어려움" : "매우어려움";

  const 추천기간 = 거래관계 === "장기" && 결제안정성 === "안정" && 초과수준 !== "매우많음" ? 3
    : 거래관계 === "신규" || 결제안정성 === "잦은불안" ? 1 : 2;

  // ── 4단계: 혜택 가치를 계약기간 전체로 환산해 숫자로 비교 ────────────────
  const months = 추천기간 * 12;
  const 컬러단가 = analysis.현재계약?.컬러단가 || analysis.contracts.find((note) => note.컬러단가 > 0)?.컬러단가 || 0;
  const 혜택가치 = [
    { card: "무상 1개월", value: 기본료, note: "기본료 1개월" },
    { card: "무상 2개월", value: 기본료 * 2, note: "기본료 2개월" },
    { card: "컬러 100매", value: 컬러단가 * 100 * months, note: `${컬러단가}원 × 100매 × ${months}개월` },
    { card: "컬러 200매", value: 컬러단가 * 200 * months, note: `${컬러단가}원 × 200매 × ${months}개월` },
    { card: "기기업그레이드", value: null, note: "동급 교체는 비용 거의 없음 · 상위는 권한 밖" },
  ];

  let 혜택필요 = true;
  let 구조조정필요 = false;
  let 순위 = "무상 1개월";
  let 차선 = "혜택 없음";
  let 헤드라인 = "";

  if (초과수준 === "매우많음") {
    구조조정필요 = true;
    순위 = "구조 조정 (기본매수 상향)";
    차선 = "기기업그레이드 (상위 모델)";
    헤드라인 = "초과료 구조가 누적된 거래처 — 단순 혜택보다 기본매수 상향이 본질 해결";
  } else if (거래처유형 === "장비민감형") {
    순위 = "동급 기기업그레이드";
    차선 = "무상 1개월";
    헤드라인 = "장비 만족도가 핵심 — 무상보다 장비 해결이 체감 효과 큼";
  } else if (거래관계 === "장기" && 결제안정성 === "안정" && (초과수준 === "없음" || 초과수준 === "보통")) {
    혜택필요 = false;
    순위 = "혜택 없음";
    차선 = "관계 유지용 무상 1개월";
    헤드라인 = "혜택 없이도 성사 가능 — 1차 시도는 카드 없이";
  } else if (초과수준 === "많음") {
    const color200 = 혜택가치.find((item) => item.card === "컬러 200매")?.value || 0;
    const free2 = 혜택가치.find((item) => item.card === "무상 2개월")?.value || 0;
    if (컬러활용률 >= 80 && 추천기간 === 3 && color200 > free2) {
      순위 = "무상 2개월";
      차선 = "컬러 100매";
      헤드라인 = `컬러 활용률 ${컬러활용률}% — 무상 2개월이 컬러 200매보다 회사 손해 적음`;
    } else {
      순위 = "무상 1개월";
      차선 = "컬러 100매";
    }
  }

  // ── 위험 신호 ──────────────────────────────────────────────────────────────
  const 위험신호: string[] = [];
  if (컬러활용률 >= 150) 위험신호.push(`컬러 활용률 ${컬러활용률}% (기본매수의 ${(컬러활용률 / 100).toFixed(1)}배)`);
  else if (컬러활용률 >= 100) 위험신호.push(`컬러 활용률 ${컬러활용률}% (기본매수 초과 사용)`);
  else if (컬러활용률 >= 80) 위험신호.push(`컬러 활용률 ${컬러활용률}% (기본매수 한계 근접)`);
  if (초과횟수 >= 5) 위험신호.push(`초과료 ${초과횟수}회 누계 ${analysis.billing.초과청구합.toLocaleString("ko-KR")}원 (반복 발생)`);
  else if (초과횟수 >= 3) 위험신호.push(`초과료 ${초과횟수}회 누계 ${analysis.billing.초과청구합.toLocaleString("ko-KR")}원`);
  if (cms실패 >= 3) 위험신호.push(`CMS 승인실패 ${cms실패}회 (반복적)`);
  else if (cms실패) 위험신호.push(`CMS 승인실패 ${cms실패}회`);
  if (잔액 > 0) 위험신호.push(`미수 잔액 ${잔액.toLocaleString("ko-KR")}원${analysis.payment.잔액개월치 >= 1 ? ` (약 ${analysis.payment.잔액개월치}개월치)` : ""}`);
  if (거래관계 === "신규") 위험신호.push("거래 관계 신규 — 혜택 신중");
  // 끼워준 무상 조건은 재계약 때 빠지면 사고가 된다
  for (const note of analysis.contracts) {
    for (const free of note.무상) {
      const label = `${free} 무상 조건 유지 필요`;
      if (!위험신호.includes(label)) 위험신호.push(label);
    }
  }

  return {
    거래관계, 거래연차, 사용패턴, 초과수준, 결제안정성, 거래처유형, 난이도, 추천기간, 컬러활용률,
    혜택필요, 구조조정필요, 혜택가치,
    추천카드: 순위,
    차선카드: 차선,
    권한밖,
    헤드라인: 헤드라인 || `${거래관계} 거래처 / ${거래처유형} / 난이도 ${난이도} → ${순위}`,
    위험신호,
  };
}
