/**
 * 재계약 판정 회귀 테스트 — 사내 정책(혜택 우선순위·권한 한계)이 그대로 지켜지는지 박아둔다.
 * 규칙을 바꿔야 할 때는 여기 기대값을 먼저 고치고 judge.ts를 고친다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { analyzeLedger } from "../src/recontract/ledger";
import { judge } from "../src/recontract/judge";

const sample = readFileSync(new URL("./fixtures/ecount-ledger-sample.txt", import.meta.url), "utf8");
// 판정은 '올해'를 쓴다 — 픽스처 기준 시점을 고정해야 거래연차가 흔들리지 않는다
const 기준일 = new Date("2026-08-19T00:00:00+09:00");

describe("장기·우량 거래처 (픽스처)", () => {
  const result = judge(analyzeLedger(sample), 기준일);

  it("거래 관계는 적요의 가장 빠른 계약 시작연도로 잡는다", () => {
    expect(result.거래연차).toBe(10); // 2016 신규 → 2026
    expect(result.거래관계).toBe("장기");
  });

  it("초과 1회는 '보통' — 상시 초과가 아니다", () => {
    expect(result.사용패턴).toBe("안정");
    expect(result.초과수준).toBe("보통");
  });

  it("마지막 청구월 미수는 실질 미수로 세지 않는다", () => {
    // 대장 누계 잔액 132,000은 2026-08 청구분(아직 수금 전)이다
    expect(result.결제안정성).toBe("안정");
    expect(result.위험신호.some((flag) => flag.includes("미수 잔액"))).toBe(false);
  });

  it("유형·난이도·추천기간", () => {
    expect(result.거래처유형).toBe("관계형");
    expect(result.난이도).toBe("쉬움");
    expect(result.추천기간).toBe(3);
  });

  it("'혜택 없음'이 1순위 — 장기+안정+초과 보통", () => {
    expect(result.혜택필요).toBe(false);
    expect(result.추천카드).toBe("혜택 없음");
    expect(result.차선카드).toBe("관계 유지용 무상 1개월");
    expect(result.헤드라인).toContain("혜택 없이도 성사 가능");
  });

  it("컬러 한계 근접을 짚어준다 — 협상 카드 준비 근거", () => {
    expect(result.컬러활용률).toBe(88); // 월평균 438 / 기본 500
    expect(result.위험신호).toContain("컬러 활용률 88% (기본매수 한계 근접)");
  });

  it("끼워준 무상 조건은 반드시 이어받게 경고한다", () => {
    expect(result.위험신호).toContain("공기청정기 무상 조건 유지 필요");
  });

  it("혜택 가치는 계약기간 전체로 환산한다", () => {
    const 컬러100 = result.혜택가치.find((card) => card.card === "컬러 100매");
    expect(컬러100?.value).toBe(120 * 100 * 36); // 컬러단가 120원 × 100매 × 36개월
    const 무상1 = result.혜택가치.find((card) => card.card === "무상 1개월");
    expect(무상1?.value).toBe(120_000);
  });

  it("권한 밖 항목은 정책 그대로 노출한다", () => {
    expect(result.권한밖).toContain("임대료 직접 인하 (가격 조정)");
    expect(result.권한밖).toContain("혜택 2개 이상 동시 제공");
    expect(result.권한밖).toHaveLength(5);
  });
});

describe("상시 초과 거래처는 혜택보다 구조 조정", () => {
  // 픽스처를 변형해 매달 초과가 나는 상황을 만든다 (기본 500 → 사용 900대)
  const heavy = sample
    .replace(/컬러A4누계-(\d+), 전월-(\d+) \[사용-(\d+)\]/g, (line, cum, prev) => `컬러A4누계-${cum}, 전월-${prev} [사용-900]`)
    .replace(/공기청정기 임대료 \[무상\] \/ 1 \* 0\t \t \t /g,
      "컬러초과사용료 [초과-400(기본-500매)] / 1 * 40,000\t44,000\t \t ");
  const result = judge(analyzeLedger(heavy), 기준일);

  it("초과 누적이면 구조 조정이 1순위", () => {
    expect(result.초과수준).toBe("매우많음");
    expect(result.구조조정필요).toBe(true);
    expect(result.추천카드).toBe("구조 조정 (기본매수 상향)");
    expect(result.헤드라인).toContain("기본매수 상향이 본질");
  });

  it("추천기간이 3년에서 내려간다", () => {
    expect(result.추천기간).toBe(2);
  });
});
