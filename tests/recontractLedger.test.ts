/**
 * 이카운트 거래처관리대장 파서 회귀 테스트.
 *
 * 픽스처는 실제 출력(거래처관리대장 I · 거래명세서별)에서 개인식별 정보만 가명으로 바꾼 것이다.
 * 기대값은 원문을 사람이 직접 더해 확인한 수치 — 파서를 고칠 때 이 숫자가 흔들리면 회귀다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { analyzeLedger, machineUsage, moneyKo, parseLedger, parseRemarks, simulateBase, windowAnalysis, ymd } from "../src/recontract/ledger";

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
    expect(sep?.excesses).toEqual([{ kind: "컬러", 초과: 86, 기본: 500, 기본월: 0, 금액: 11_000 }]);
  });
  it("카운터 사용량 — 누계 차이와 맞는다", () => {
    const aug = parsed.months.find((month) => month.ym === "2025-08");
    const color4 = aug?.counters.find((counter) => counter.kind === "컬러A4");
    expect(color4).toEqual({ kind: "컬러A4", 누계: 16_801, 전월: 0, 사용: 425 }); // 전월 라벨은 업체마다 달라("9월-") 따로 담지 않는다
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

describe("붙여넣기 형태 변형 — 브라우저 복사는 탭 배치가 제각각이다", () => {
  const sample = readFileSync(new URL("./fixtures/ecount-ledger-sample.txt", import.meta.url), "utf8");

  it("상세 줄의 선행 탭이 사라져도 카운터를 읽는다 (실사용: 사용량 0 사고)", () => {
    // 상세 줄 맨 앞의 빈 셀(탭)이 복사 과정에서 사라진 형태
    const variant = sample.split("\n").map((line) => (line.startsWith(" \t") ? line.slice(2) : line)).join("\n");
    const parsed = parseLedger(variant);
    const aug = parsed.months.find((month) => month.ym === "2025-08");
    expect(aug?.counters.length).toBe(3);
    expect(aug?.counters.find((c) => c.kind === "컬러A4")?.사용).toBe(425);
  });

  it("날짜 셀에 적요가 붙어 와도 전표를 읽는다", () => {
    const variant = sample.replace("2025/09/08 -108\t25.6.4 재계약> 전자확인", "2025/09/08 -108 25.6.4 재계약> 전자확인");
    const parsed = parseLedger(variant);
    const sep = parsed.months.find((month) => month.ym === "2025-09");
    expect(sep?.청구).toBe(143_000);
    expect(sep?.memo).toContain("재계약");
  });

  it("전표 목록(vouchers)이 이카운트형 표 렌더용으로 그대로 노출된다", () => {
    const parsed = parseLedger(sample);
    expect(parsed.vouchers.length).toBeGreaterThan(20); // 청구 14 + 수금 12 + α
    const first = parsed.vouchers.find((v) => v.date === "2025-08-07");
    expect(first?.판매).toBe(132_000);
    expect(first?.수금).toBe(0);      // 판매 전표 — 수금은 별도 전표
    const pay = parsed.vouchers.find((v) => v.date === "2025-08-19");
    expect(pay?.수금).toBe(132_000);
  });
});

describe("3개월 누적 청구 업체 (하이어랭크형 실사용 표본)", () => {
  const quarterly = readFileSync(new URL("./fixtures/ecount-ledger-quarterly.txt", import.meta.url), "utf8");
  const parsed = parseLedger(quarterly);
  const analysis = analyzeLedger(quarterly);

  it("'컬러누계'(A4 접두 없음)와 '6월-' 비교 라벨을 읽는다 — 사용량 0 사고의 원인", () => {
    const sep = parsed.months.find((month) => month.ym === "2024-09");
    const colors = sep?.counters.filter((counter) => counter.kind !== "흑백") || [];
    expect(colors.reduce((sum, counter) => sum + counter.사용, 0)).toBe(3_602 + 1_422 + 37);
    expect(sep?.counters.find((counter) => counter.kind === "흑백" && counter.사용 === 1_152)).toBeTruthy();
  });

  it("[사용]이 없는 누적 중간 달은 카운터로 세지 않는다", () => {
    const jul = parsed.months.find((month) => month.ym === "2024-07");
    expect(jul?.counters).toHaveLength(0);
  });

  it("초과 기본 표기 두 형태를 다 읽는다: '기본-1200매'와 '기본-400*3=1200매'", () => {
    const sep = parsed.months.find((month) => month.ym === "2024-09");
    expect(sep?.excesses.map((excess) => excess.기본)).toEqual([1_200, 1_200]);
    const jun = parsed.months.find((month) => month.ym === "2026-06");
    expect(jun?.excesses[0]).toMatchObject({ 초과: 216, 기본: 1_200, 기본월: 400 });
  });

  it("기본매수는 월 기준으로 환산된다 — 기기 2대(X3220+AC2060) 합산 월 800매", () => {
    const color = analysis.usage.find((stat) => stat.kind === "컬러");
    expect(color?.기본매수).toBe(800);   // X3220 400 (400*3 표기) + AC2060 400 (1200÷3개월누적)
    expect(color?.기본매수출처).toBe("대장");
  });

  it("월평균은 총사용 ÷ 대장 개월수 — 분기에만 찍혀도 평균이 맞다", () => {
    const color = analysis.usage.find((stat) => stat.kind === "컬러");
    // 총 컬러 사용 3602+1422+37+1416 = 6477, 대장 5개월(청구월 기준)
    expect(color?.월평균).toBe(Math.round(6_477 / parsed.months.length));
  });

  it("화면 하단의 출력 시각(오후 9:57:54)은 전표가 아니다", () => {
    expect(parsed.vouchers.some((voucher) => /^오후|^오전/.test(voucher.memo))).toBe(false);
  });

  it("CMS 승인실패 줄이 있어도 죽지 않고, 누계는 표 그대로", () => {
    expect(parsed.누계).toEqual({ 판매: 4_516_600, 수금: 4_235_000, 잔액: 281_600 });
  });
});

describe("결제 판정 — CMS 다음 달 출금 업체를 미납으로 오판하지 않는다", () => {
  const quarterly = readFileSync(new URL("./fixtures/ecount-ledger-quarterly.txt", import.meta.url), "utf8");
  const analysis = analyzeLedger(quarterly);

  it("승인실패 줄을 센다", () => {
    expect(analysis.payment.cms실패).toBe(1);
  });
  it("실질잔액 = 누계 잔액 - 최근 청구 (수금 전이 정상인 몫)", () => {
    // 축약 픽스처의 최근 청구월은 2026-06(96,800원 — X3220 전표만 포함)
    expect(analysis.payment.실질잔액).toBe(281_600 - 96_800);
  });
  it("판정은 잔액·승인실패 기준 — 달 단위 대조가 아니다", () => {
    expect(analysis.payment.판정).toBe("보통"); // 실패 1회 + 잔액 1개월치 — 주의까지는 아니다
  });
});

describe("기간 창(window) — 3년치를 붙여넣고 최근 1년만 본다", () => {
  const quarterly = readFileSync(new URL("./fixtures/ecount-ledger-quarterly.txt", import.meta.url), "utf8");
  const full = analyzeLedger(quarterly);      // 2024-07 ~ 2026-06

  it("창 밖 전표·월이 잘리고 통계가 다시 계산된다", () => {
    const win = windowAnalysis(full, "2026-01-01");
    expect(win.months.map((month) => month.ym)).toEqual(["2026-06"]);
    expect(win.누계.판매).toBe(96_800);
    // 창 안 컬러 사용 1,416 / 1개월
    const color = win.usage.find((stat) => stat.kind === "컬러");
    expect(color?.월평균).toBe(1_416);
  });

  it("잔액은 시점 값 — 창을 씌워도 지금 잔액 그대로", () => {
    const win = windowAnalysis(full, "2026-01-01");
    expect(win.누계.잔액).toBe(full.누계.잔액);
  });

  it("계약 이력·적요는 창과 무관하게 전체 유지 (거래연차 판정 근거)", () => {
    const win = windowAnalysis(full, "2026-01-01");
    expect(win.contracts.length).toBe(full.contracts.length);
    expect(win.remarks).toBe(full.remarks);
  });

  it("창 없음(null)은 원본 그대로", () => {
    expect(windowAnalysis(full, null)).toBe(full);
  });
});

describe("기기별 사용량 — 초과는 기기별 계약이라 합산하지 않는다", () => {
  const quarterly = readFileSync(new URL("./fixtures/ecount-ledger-quarterly.txt", import.meta.url), "utf8");
  const analysis = analyzeLedger(quarterly);
  const machines = machineUsage(analysis);

  it("전표의 임대료 모델과 카운터를 짝지어 두 기기로 가른다", () => {
    expect(machines.map((machine) => machine.model).sort()).toEqual(["AC2060", "X3220"]);
  });
  it("X3220: 컬러 5,018매·초과 2회 / AC2060: 컬러 1,459매·초과 1회 — 기기별로 정확히 갈린다", () => {
    const x = machines.find((machine) => machine.model === "X3220")!;
    const ac = machines.find((machine) => machine.model === "AC2060")!;
    expect(x.total.컬러).toBe(5_018);
    expect(x.초과횟수).toBe(2);           // 2024-09(2,402매) + 2026-06(216매)
    expect(x.초과금액).toBe(237_600 + 20_900);
    expect(ac.total.컬러).toBe(1_459);
    expect(ac.초과횟수).toBe(1);          // 2024-09(259매) — 이 건이 합산 표에선 X3220 것처럼 보였다
    expect(ac.초과금액).toBe(25_300);
  });
  it("월 기본은 기기별 — X3220 400매(1200÷3, 400*3 표기)", () => {
    const x = machines.find((machine) => machine.model === "X3220")!;
    expect(x.기본월.컬러).toBe(400);
    expect(x.accumMonths).toBe(3);
  });
  it("기본매수 시뮬레이션 — 기본을 크게 올리면 초과료 0", () => {
    const x = machines.find((machine) => machine.model === "X3220")!;
    const result = simulateBase(x, "컬러", 2_000);
    expect(result.예상초과료).toBe(0);
    expect(result.절감).toBe(result.현재초과료);
  });
});

describe("시뮬레이터 정합성 — 같은 기본을 넣으면 현재 초과료가 그대로 재현된다", () => {
  const quarterly = readFileSync(new URL("./fixtures/ecount-ledger-quarterly.txt", import.meta.url), "utf8");
  const machines = machineUsage(analyzeLedger(quarterly));
  const x = machines.find((machine) => machine.model === "X3220")!;

  it("현재 기본(400) 입력 = 현재 초과료 (반올림 오차 없음 — 69,300→69,355 실사고 방지)", () => {
    const result = simulateBase(x, "컬러", 400);
    expect(result.예상초과료).toBe(result.현재초과료);
    expect(result.절감).toBe(0);
  });
});

describe("적요 오타 흡수 — '훅1000/9'(흑의 오타)", () => {
  const quarterly = readFileSync(new URL("./fixtures/ecount-ledger-quarterly.txt", import.meta.url), "utf8");
  it("훅 표기도 흑백 기본·단가로 읽는다 (X3220 흑백 활용률 '—' 사고의 원인)", () => {
    const notes = parseLedger(quarterly).contracts;
    const x3220 = notes.find((note) => note.models.includes("X3220") && note.흑백기본 > 0);
    expect(x3220?.흑백기본).toBe(1_000);
    expect(x3220?.흑백단가).toBe(9);
  });
});
