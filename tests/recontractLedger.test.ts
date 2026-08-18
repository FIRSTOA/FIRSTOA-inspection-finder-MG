/**
 * 이카운트 거래처관리대장 파서 회귀 테스트.
 *
 * 픽스처는 실제 출력(거래처관리대장 I · 거래명세서별)에서 개인식별 정보만 가명으로 바꾼 것이다.
 * 기대값은 원문을 사람이 직접 더해 확인한 수치 — 파서를 고칠 때 이 숫자가 흔들리면 회귀다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { analyzeLedger, moneyKo, parseLedger, parseRemarks, ymd } from "../src/recontract/ledger";

const sample = readFileSync(new URL("./fixtures/ecount-ledger-sample.txt", import.meta.url), "utf8");

describe("숫자·날짜 표기", () => {
  it("만 단위 한글 금액", () => {
    expect(moneyKo("12만")).toBe(120_000);
    expect(moneyKo("33만")).toBe(330_000);
    expect(moneyKo("142,000")).toBe(142_000);
    expect(moneyKo("")).toBe(0);
  });
  it("두 자리 연도는 2000년대", () => {
    expect(ymd("26.6.23")).toBe("2026-06-23");
    expect(ymd("2025/07/01")).toBe("2025-07-01");
    expect(ymd("없음")).toBe("");
  });
});

describe("머리말", () => {
  const parsed = parseLedger(sample);
  it("업체명·담당·조회기간", () => {
    expect(parsed.vendor).toBe("(주)한빛라이팅");
    expect(parsed.담당).toBe("수도권C");
    expect(parsed.기간).toEqual({ from: "2025-07-01", to: "2026-08-19" });
  });
  it("라벨 다음 줄이 값인 출력 형식", () => {
    expect(parsed.info["대표자"]).toBe("홍길동");
    expect(parsed.info["Email"]).toBe("sample@example.com");
    expect(parsed.info["주소"]).toContain("성동구");
  });
});

describe("적요 → 계약 이력", () => {
  const notes = parseRemarks(parseLedger(sample).remarks);
  it("최근 계약이 먼저", () => {
    expect(notes[0].from).toBe("2026-06-23");
    expect(notes[0].to).toBe("2029-06-22");
    expect(notes[0].years).toBe(3);
    expect(notes[0].label).toBe("재계약");
  });
  it("끼워준 무상 조건을 놓치지 않는다 — 재계약 때 이어받아야 한다", () => {
    expect(notes[0].무상).toContain("공기청정기");
  });
  it("'기존동일' 재계약은 조건 숫자가 없다", () => {
    expect(notes[0].월기본료).toBe(0);
    expect(notes[0].컬러기본).toBe(0);
  });
  it("숫자가 적힌 옛 조건은 읽어낸다", () => {
    const withTerms = notes.find((note) => note.월기본료 > 0);
    expect(withTerms?.월기본료).toBe(120_000);
    expect(withTerms?.컬러기본).toBe(500);
    expect(withTerms?.컬러단가).toBe(120);
    expect(withTerms?.흑백기본).toBe(3_000);
    expect(withTerms?.흑백단가).toBe(12);
  });
  it("한 덩이에 신규·재계약이 이어 적히면 기간별로 라벨을 가른다", () => {
    // "신규(16.8.11~19.8.10)" 와 "20.8.11~22.8.10 재계약하면서…" 가 붙어 있는 덩이
    expect(notes.find((note) => note.from === "2016-08-11")?.label).toBe("신규");
    expect(notes.find((note) => note.from === "2020-08-11")?.label).toBe("재계약");
  });

  it("보증금 표기", () => {
    expect(notes.some((note) => note.보증금 === 330_000)).toBe(true);
  });
  it("연락처·메모만 있는 덩이는 계약으로 세지 않는다", () => {
    expect(notes.every((note) => note.from || note.월기본료 > 0 || note.models.length)).toBe(true);
  });
});

describe("판매/수금내역", () => {
  const parsed = parseLedger(sample);
  it("14개월 · 누계는 표 마지막 줄과 일치", () => {
    expect(parsed.months).toHaveLength(14);
    expect(parsed.months[0].ym).toBe("2025-07");
    expect(parsed.months[13].ym).toBe("2026-08");
    expect(parsed.누계).toEqual({ 판매: 1_727_000, 수금: 1_595_000, 잔액: 132_000 });
  });
  it("첫 달은 무상 반영으로 청구 0", () => {
    expect(parsed.months[0].청구).toBe(0);
    expect(parsed.months[0].counters).toHaveLength(3); // 카운터는 청구가 0이어도 찍힌다
  });
  it("초과가 붙은 달은 청구가 늘어난다", () => {
    const sep = parsed.months.find((month) => month.ym === "2025-09");
    expect(sep?.청구).toBe(143_000);
    expect(sep?.excesses).toEqual([{ kind: "컬러", 초과: 86, 기본: 500, 금액: 11_000 }]);
  });
  it("카운터 사용량 — 누계 차이와 맞는다", () => {
    const aug = parsed.months.find((month) => month.ym === "2025-08");
    const color4 = aug?.counters.find((counter) => counter.kind === "컬러A4");
    expect(color4).toEqual({ kind: "컬러A4", 누계: 16_801, 전월: 16_376, 사용: 425 });
  });
  it("수금일과 지연일", () => {
    const aug = parsed.months.find((month) => month.ym === "2025-08");
    expect(aug?.청구일).toBe("2025-08-07");
    expect(aug?.수금일).toBe("2025-08-19");
    expect(aug?.지연일).toBe(12);
  });
  it("기간 표기 오타(110/11~12/10)를 만나도 죽지 않는다", () => {
    const dec = parsed.months.find((month) => month.ym === "2025-12");
    expect(dec?.items.some((item) => item.기간 === "110/11~12/10")).toBe(true);
    expect(dec?.청구).toBe(132_000);
  });
  it("무상 항목은 금액 0으로 구분된다", () => {
    const free = parsed.months[1].items.find((item) => item.무상);
    expect(free?.label).toContain("공기청정기");
    expect(free?.단가).toBe(0);
  });
});

describe("분석", () => {
  const analysis = analyzeLedger(sample);
  it("컬러 사용량 — A4·A3를 합쳐 기본매수와 비교한다", () => {
    const color = analysis.usage.find((stat) => stat.kind === "컬러");
    expect(color?.개월수).toBe(14);
    expect(color?.월평균).toBe(438);   // 합계 6,133 / 14
    expect(color?.최근3평균).toBe(461);
    expect(color?.최대).toBe(586);
    expect(color?.기본매수).toBe(500);
    expect(color?.기본매수출처).toBe("대장"); // 초과료 줄에서 확인된 값
    expect(color?.여유율).toBe(12);    // 기본 500에 평균 438 — 여유가 거의 없다
    expect(color?.초과월수).toBe(1);
  });
  it("흑백은 기본매수를 크게 밑돈다 — 조건 조정 여지", () => {
    const bw = analysis.usage.find((stat) => stat.kind === "흑백");
    expect(bw?.월평균).toBe(332);      // 합계 4,643 / 14
    expect(bw?.기본매수).toBe(3_000);
    expect(bw?.기본매수출처).toBe("적요"); // 대장에 흑백 초과가 없어 적요에서 가져왔다
    expect(bw?.여유율).toBe(89);
  });
  it("수금 신뢰도", () => {
    expect(analysis.payment.청구월수).toBe(13);
    expect(analysis.payment.평균지연일).toBe(14);
    expect(analysis.payment.최대지연일).toBe(19);
    expect(analysis.payment.미납월).toEqual(["2026-08"]); // 마지막 달은 아직 수금 전
    expect(analysis.payment.판정).toBe("우량");
  });
  it("청구 요약 — 월기본료는 적요보다 대장 실적을 믿는다", () => {
    expect(analysis.billing.월기본료).toBe(120_000);
    expect(analysis.billing.최근청구).toBe(132_000);
    expect(analysis.billing.초과청구합).toBe(11_000);
  });
});
