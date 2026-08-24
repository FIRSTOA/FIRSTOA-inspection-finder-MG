/**
 * 이카운트 거래처관리대장 I (거래명세서별) 파서 — 재계약 협상 카드의 재료를 뽑는다.
 *
 * 임대리스트에는 "현재 조건 한 줄"만 있다. 조건을 어떻게 올려왔는지·실제로 얼마나 쓰는지·
 * 돈을 제때 넣는지는 이 대장에만 있다. 그래서 재계약 판단의 본체는 여기다.
 *
 * 대장은 두 부분이다.
 *   ① 적요 — 사람이 몇 년간 손으로 쌓은 계약 이력. 표기가 자유롭다:
 *        "mpc2003 **월-12만(칼-500/120,흑-3000/12) **초카-0"
 *        "D450 ... 142,000원(컬600/100 흑 3000/10)"  "→24.8.20 매수수정 (컬1000/100 흑4000/10)"
 *   ② 판매/수금내역 — 월별 청구·수금과 카운터. 재계약에 결정적인 건 이 카운터다:
 *        "컬러A4누계-16801, 전월-16376 [사용-425] / 1 * 0"
 *        "컬러초과사용료 [초과-86(기본-500매)] / 1 * 10,000"
 *
 * 원문에는 오타(기간 "110/11~12/10")·빈 셀·전각 공백이 섞인다. 형식을 믿지 말고 견디게 짠다.
 * 회귀 테스트: tests/recontractLedger.test.ts (tests/fixtures/ecount-ledger-sample.txt)
 */

/** "12만"·"142,000"·"33만" → 숫자 */
export function moneyKo(raw: string): number {
  const text = String(raw || "").replace(/\s/g, "");
  const man = text.match(/^([\d,.]+)만/);
  if (man) return Math.round(Number(man[1].replace(/,/g, "")) * 10_000);
  const plain = text.replace(/[^0-9]/g, "");
  return plain ? Number(plain) : 0;
}

function num(raw: unknown): number {
  const digits = String(raw ?? "").replace(/[^0-9-]/g, "");
  const value = Number(digits);
  return Number.isFinite(value) ? value : 0;
}

/** "26.6.23"·"2026/06/23" → 2026-06-23 (2자리 연도는 2000년대로) */
export function ymd(raw: string): string {
  const m = String(raw || "").match(/(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return "";
  const year = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${year}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// ─── 적요: 계약 이력 ────────────────────────────────────────────────────────

export type ContractNote = {
  label: string;          // 재계약 / 교체재계약 / 신규 …
  models: string[];       // APC2060, D450, mpc2003 …
  from: string;
  to: string;
  years: number;
  월기본료: number;
  컬러기본: number;
  컬러단가: number;
  흑백기본: number;
  흑백단가: number;
  보증금: number;
  무상: string[];         // "공기청정기 무상" 같은 끼워준 조건 — 재계약 때 반드시 이어받아야 한다
  raw: string;
};

const LABELS = ["교체재계약", "재계약", "신규", "기기교체", "추가", "임대", "연장", "해지"];

/** 조건 표기 한 덩이에서 기본료·기본매수·단가를 뽑는다 */
function readTerms(text: string) {
  const flat = text.replace(/\s+/g, " ");
  // 월 기본료: "월-12만", "월 12만", "142,000원", "**월-12만"
  const fee = flat.match(/월\s*[-—]?\s*([\d,.]+만|[\d,]{4,})\s*원?/) || flat.match(/([\d,]{5,})\s*원/);
  // 컬러/흑백: "칼-500/120", "컬600/100", "컬러기본 300매 추가 100원", "컬1000/100"
  const color = flat.match(/(?:컬러|컬|칼)\s*(?:기본)?\s*[-—]?\s*([\d,]+)\s*매?\s*(?:추가)?\s*[/,]?\s*([\d,]+)\s*원?/);
  // "훅1000/9" — 흑을 훅으로 적은 오타가 실데이터에 있다 (하이어랭크). 흡수한다
  const bw = flat.match(/(?:흑백|흑|훅)\s*(?:기본)?\s*[-—]?\s*([\d,]+)\s*매?\s*(?:추가)?\s*[/,]?\s*([\d,]+)\s*원?/);
  const deposit = /보증금\s*없음/.test(flat) ? 0 : moneyKo((flat.match(/보증금\s*[-—]?\s*([\d,.]+만|[\d,]{4,})/) || [])[1] || "");
  return {
    월기본료: fee ? moneyKo(fee[1]) : 0,
    컬러기본: color ? num(color[1]) : 0,
    컬러단가: color ? num(color[2]) : 0,
    흑백기본: bw ? num(bw[1]) : 0,
    흑백단가: bw ? num(bw[2]) : 0,
    보증금: deposit,
  };
}

/** 모델명 후보 — 영문+숫자 조합(APC2060, D450, SCX-5545N, mpc2003) */
function readModels(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b([A-Za-z]{1,5}[-]?\d{3,5}[A-Za-z]{0,3}(?:-[A-Za-z0-9]+)?)\b/g)) {
    const token = m[1];
    if (/^\d+$/.test(token)) continue;
    found.add(token);
  }
  return Array.from(found);
}

/**
 * 적요 → 계약 이력. 빈 줄과 구분선(-----, =====)으로 덩이를 나눈다.
 * 한 덩이에 "계약기간 + 조건"이 함께 적히는 관행을 그대로 따른다.
 */
export function parseRemarks(remarks: string): ContractNote[] {
  const blocks = String(remarks || "")
    .split(/\n\s*\n|\n\s*[-=]{3,}\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const out: ContractNote[] = [];
  for (const block of blocks) {
    // 한 덩이 안에 기간이 여러 개면(재계약 이력이 이어 적힌 경우) 기간마다 한 줄로 쪼갠다
    const periods = Array.from(block.matchAll(/(\d{2,4}[.\-/]\d{1,2}[.\-/]\d{1,2})\s*~\s*(\d{2,4}[.\-/]\d{1,2}[.\-/]\d{1,2})/g));
    const terms = readTerms(block);
    const head = block.split("\n")[0];
    const label = LABELS.find((candidate) => head.includes(candidate))
      || LABELS.find((candidate) => block.includes(candidate)) || "";
    const models = readModels(block);
    const 무상 = Array.from(block.matchAll(/([가-힣A-Za-z0-9()]+)\s*(?:무상임대|무상)/g)).map((m) => m[1]);
    if (!periods.length) {
      if (!terms.월기본료 && !models.length) continue; // 연락처·메모만 있는 덩이는 계약이 아니다
      out.push({ label, models, from: "", to: "", years: 0, ...terms, 무상, raw: block });
      continue;
    }
    for (const period of periods) {
      const from = ymd(period[1]);
      const to = ymd(period[2]);
      const yearText = block.slice(period.index || 0).match(/\(?만?\s*(\d)\s*년/);
      // 그 기간이 적힌 줄의 라벨이 가장 정확하다 (한 덩이에 신규·재계약이 이어 적힌다)
      const lineStart = block.lastIndexOf("\n", period.index || 0) + 1;
      const lineEnd = block.indexOf("\n", period.index || 0);
      const line = block.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
      const lineLabel = LABELS.find((candidate) => line.includes(candidate)) || label;
      out.push({
        label: lineLabel, models, from, to,
        years: yearText ? Number(yearText[1]) : (from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 31_536_000_000) : 0),
        ...terms, 무상, raw: block,
      });
    }
  }
  // 최근 계약이 위 — 협상 때 현재 조건부터 본다
  return out.sort((a, b) => (b.from || "").localeCompare(a.from || ""));
}

// ─── 판매/수금내역 ──────────────────────────────────────────────────────────

export type LedgerCounter = { kind: "컬러" | "컬러A4" | "컬러A3" | "흑백"; 누계: number; 전월: number; 사용: number };
export type LedgerExcess = { kind: "컬러" | "흑백"; 초과: number; 기본: number; 기본월: number; 금액: number };
export type LedgerItem = {
  label: string;
  model: string;
  기간: string;
  단가: number;
  금액: number;
  counter?: LedgerCounter;
  excess?: LedgerExcess;
  무상: boolean;
};
export type LedgerVoucher = { date: string; no: string; memo: string; 판매: number; 수금: number; items: LedgerItem[] };
export type LedgerMonth = {
  ym: string;
  청구일: string;
  청구: number;
  수금: number;
  수금일: string;
  지연일: number;         // 청구일 → 수금일. 미수면 -1
  memo: string;
  items: LedgerItem[];
  counters: LedgerCounter[];
  excesses: LedgerExcess[];
};

/** 상세 줄 하나 → 항목. "복사기임대료(APC2060) [6/11~7/10] / 1 * 120,000" 꼴 */
function parseItem(label: string, amount: number): LedgerItem {
  const item: LedgerItem = {
    label,
    model: (label.match(/\(([^)]+)\)/) || [])[1] || "",
    기간: (label.match(/\[([^\]]*~[^\]]*)\]/) || [])[1] || "",
    단가: num((label.match(/\*\s*([\d,]+)\s*$/) || [])[1] || ""),
    금액: amount,
    무상: /\[무상\]/.test(label),
  };
  // 비교 기준 라벨이 업체마다 다르다: "전월-15909" / "9월-13564" / "6월-9962" (3개월 누적 청구).
  // [사용-N]이 없는 줄(누적 중간 달)은 카운터로 세지 않는다 — 그 달 사용량을 모르는 게 사실이다.
  const counter = label.match(/(컬러A4|컬러A3|컬러|흑백)누계\s*[-–—]?\s*([\d,]*)\s*,\s*[^[]*?\[사용\s*[-–—]?\s*(-?[\d,]+)\]/);
  if (counter) {
    item.counter = {
      kind: counter[1] as LedgerCounter["kind"],
      누계: num(counter[2]), 전월: 0, 사용: num(counter[3]),
    };
  }
  const excess = label.match(/(컬러|흑백)초과사용료\s*\[초과\s*[-–—]?\s*([\d,]+)\s*\(기본([^)]*)\)\]/);
  if (excess) {
    // 기본 표기: "기본-1200매" / "기본-400*3=1200매"(3개월 누적) — 월 기본을 따로 뽑는다
    const inside = excess[3];
    const mult = inside.match(/([\d,]+)\s*\*\s*(\d+)\s*=\s*([\d,]+)/);
    const total = mult ? num(mult[3]) : num((inside.match(/([\d,]+)\s*매/) || [])[1] || inside);
    const monthly = mult ? num(mult[1]) : 0; // 곱셈 표기가 없으면 0 — 누적 개월수는 usageStats에서 판단
    item.excess = { kind: excess[1] as LedgerExcess["kind"], 초과: num(excess[2]), 기본: total, 기본월: monthly, 금액: amount };
  }
  return item;
}

const VOUCHER_DATE = /^(\d{4})[./-](\d{2})[./-](\d{2})(?:\s+(-?\d+))?\s*/;

/** 셀이 금액(숫자·쉼표·원)뿐인지 */
function isAmountCell(cell: string): boolean {
  const t = cell.trim();
  return !!t && /^[-₩\d,.]+원?$/.test(t) && /\d/.test(t);
}

/** 표 영역 → 전표 목록. 복사 형태(선행 탭 유무, 날짜+적요 한 셀)가 제각각이라 셀 위치를 못 박지 않는다 */
function parseVouchers(lines: string[]): LedgerVoucher[] {
  const out: LedgerVoucher[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split("\t").map((cell) => cell.replace(/ /g, " ").trim());
    const first = cells.find((cell) => cell) || "";           // 선행 빈 셀은 건너뛴다
    if (/^(일자|이월잔액|누계)/.test(first) || /^\d{4}[./-]\d{2}\s*계$/.test(first)) continue; // 머리·이월·월계·누계 줄
    const stamp = first.match(VOUCHER_DATE);
    if (stamp) {
      const firstIdx = cells.indexOf(first);
      const rest = first.slice(stamp[0].length).trim();       // 날짜 셀에 적요가 붙어 온 경우
      if (/^(오전|오후)\s*\d/.test(rest)) continue;            // 화면 하단의 출력 시각 — 전표가 아니다
      const after = cells.slice(firstIdx + 1);
      // 적요 셀 다음부터는 위치가 곧 뜻이다: [판매, 수금, 잔액].
      // 빈 셀을 걸러내면 잔액이 수금 자리로 밀린다 — 위치를 지키고 빈 칸은 0으로 둔다.
      const memoIdx = after.findIndex((cell) => cell && !isAmountCell(cell));
      const memoCell = memoIdx >= 0 ? after[memoIdx] : "";
      // 적요가 빈 전표도 적요 "자리"는 있다 — 첫 셀이 빈칸이면 그게 적요 자리다
      const tail = memoIdx >= 0 ? after.slice(memoIdx + 1) : (after[0] === "" ? after.slice(1) : after);
      out.push({
        date: `${stamp[1]}-${stamp[2]}-${stamp[3]}`,
        no: stamp[4] || "",
        memo: [rest, memoCell].filter(Boolean).join(" ").trim(),
        판매: isAmountCell(tail[0] || "") ? num(tail[0]) : 0,
        수금: isAmountCell(tail[1] || "") ? num(tail[1]) : 0,
        items: [],
      });
      continue;
    }
    // 날짜가 없는 줄 = 앞 전표의 상세 — 글자가 있는 첫 셀이 라벨이다
    const current = out[out.length - 1];
    if (!current) continue;
    const label = cells.find((cell) => cell && !isAmountCell(cell)) || "";
    if (!label) continue;
    const amounts = cells.filter(isAmountCell);
    current.items.push(parseItem(label, num(amounts[0] ?? "")));
  }
  return out;
}

export type LedgerParsed = {
  vendor: string;
  담당: string;
  기간: { from: string; to: string };
  info: Record<string, string>;
  remarks: string;
  contracts: ContractNote[];
  vouchers: LedgerVoucher[];   // 전표 그대로 — 이카운트형 표(일자/적요/판매/수금) 렌더용
  months: LedgerMonth[];
  누계: { 판매: number; 수금: number; 잔액: number };
};

/** 전표 → 월 묶음 — 청구 전표와 수금 전표가 같은 달에 따로 있다. 기간 창(window)에서도 재사용 */
export function buildMonths(vouchers: LedgerVoucher[]): LedgerMonth[] {
  const byMonth = new Map<string, LedgerVoucher[]>();
  for (const voucher of vouchers) {
    const ym = voucher.date.slice(0, 7);
    const list = byMonth.get(ym);
    if (list) list.push(voucher);
    else byMonth.set(ym, [voucher]);
  }
  return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([ym, list]) => {
    const billing = list.find((voucher) => voucher.items.length) || list[0];
    const paid = list.filter((voucher) => voucher.수금 > 0);
    const 수금일 = paid.length ? paid[paid.length - 1].date : "";
    const items = list.flatMap((voucher) => voucher.items);
    return {
      ym,
      청구일: billing?.date || "",
      청구: list.reduce((sum, voucher) => sum + voucher.판매, 0),
      수금: list.reduce((sum, voucher) => sum + voucher.수금, 0),
      수금일,
      지연일: 수금일 && billing?.date
        ? Math.round((Date.parse(수금일) - Date.parse(billing.date)) / 86_400_000)
        : -1,
      memo: billing?.memo || "",
      items,
      counters: items.map((item) => item.counter).filter((counter): counter is LedgerCounter => !!counter),
      excesses: items.map((item) => item.excess).filter((excess): excess is LedgerExcess => !!excess),
    };
  });
}

const INFO_LABELS = ["사업자등록번호", "대표자", "여신한도", "전화", "Email", "Fax", "주 소", "주소"];

/** 대장 텍스트 전체 → 구조 */
export function parseLedger(text: string): LedgerParsed {
  const clean = String(text || "").replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const lines = clean.split("\n");

  const titleLine = lines.find((line) => /관리대장\(거래명세서별\)/.test(line)) || "";
  const vendor = titleLine.replace(/\s*관리대장\(거래명세서별\).*$/, "").trim();
  const ownerLine = lines.find((line) => /회사명\s*:/.test(line)) || "";
  const 담당 = (ownerLine.match(/담당\s*:\s*([^\t]+)/) || [])[1]?.trim() || "";
  const span = ownerLine.match(/(\d{4}[./-]\d{2}[./-]\d{2})\s*~\s*(\d{4}[./-]\d{2}[./-]\d{2})/);

  // 라벨 줄 다음의 첫 내용 줄이 값 — 사이에 빈 줄이 끼는 출력 형식
  const info: Record<string, string> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const label = lines[i].trim();
    if (!INFO_LABELS.includes(label)) continue;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j += 1) {
      const value = lines[j].trim();
      if (!value) continue;
      if (INFO_LABELS.includes(value) || value === "적요") break;
      info[label === "주 소" ? "주소" : label] = value;
      break;
    }
  }

  const remarkStart = lines.findIndex((line) => line.trim() === "적요");
  const tableStart = lines.findIndex((line) => /^판매\/수금내역/.test(line.trim()));
  const remarks = remarkStart >= 0
    ? lines.slice(remarkStart + 1, tableStart > remarkStart ? tableStart : undefined).join("\n").trim()
    : "";

  const vouchers = tableStart >= 0 ? parseVouchers(lines.slice(tableStart + 1)) : [];

  const months = buildMonths(vouchers);

  const totalLine = lines.find((line) => /^누계\t/.test(line)) || "";
  const totals = totalLine.split("\t").map((cell) => num(cell));

  return {
    vendor,
    담당,
    기간: { from: span ? ymd(span[1]) : "", to: span ? ymd(span[2]) : "" },
    info,
    remarks,
    contracts: parseRemarks(remarks),
    vouchers,
    months,
    누계: { 판매: totals[1] || 0, 수금: totals[2] || 0, 잔액: totals[3] || 0 },
  };
}

// ─── 분석 ───────────────────────────────────────────────────────────────────

export type UsageStat = {
  kind: string;
  월평균: number;
  최근3평균: number;
  최대: number;
  최소: number;
  개월수: number;
  기본매수: number;      // 대장 초과료 줄이나 적요에서 알아낸 기본 매수
  기본매수출처: "대장" | "적요" | "없음"; // 대장 초과료 줄이 가장 믿을 만하다 — 적요는 옛 조건일 수 있다
  여유율: number;        // (기본 - 평균) / 기본. 음수면 상시 초과
  초과월수: number;
  추세: "증가" | "감소" | "유지";
};

export type PaymentStat = {
  청구월수: number;
  완납월수: number;
  미납월: string[];        // 같은 달 안에 수금 안 된 달 — CMS는 다음 달 출금이 정상이라 판정에는 쓰지 않는다
  평균지연일: number;
  최대지연일: number;
  cms실패: number;         // "승인실패" 줄 수 — 진짜 결제 불안 신호
  실질잔액: number;        // 누계 잔액 - 최근 청구(아직 수금 전이 정상인 몫)
  잔액개월치: number;      // 실질잔액이 월평균 청구의 몇 달치인가
  판정: "우량" | "보통" | "주의";
};

export type LedgerAnalysis = LedgerParsed & {
  usage: UsageStat[];
  payment: PaymentStat;
  billing: { 월기본료: number; 최근청구: number; 평균청구: number; 초과청구합: number };
  현재계약?: ContractNote;
  인상이력: Array<{ 시점: string; 월기본료: number; 컬러기본: number; 흑백기본: number; label: string }>;
};

function trendOf(values: number[]): "증가" | "감소" | "유지" {
  if (values.length < 6) return "유지";
  const half = Math.floor(values.length / 2);
  const early = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const late = values.slice(-half).reduce((a, b) => a + b, 0) / half;
  if (!early) return "유지";
  const change = (late - early) / early;
  return change > 0.12 ? "증가" : change < -0.12 ? "감소" : "유지";
}

/**
 * 카운터 종류별 사용량 통계. 컬러는 A4·A3를 합쳐 본다.
 *
 * 청구 방식이 업체마다 다르다:
 *  - 매월 청구: 매달 [사용-N]이 찍힌다 → 다달이 합산
 *  - 3개월 누적 청구: 분기 달에만 [사용-N](3개월치 합)이 찍힌다 → 월평균 = 총사용 ÷ 대장 개월수
 * 기본매수도 월 기준으로 환산한다: "기본-400*3=1200매"면 월 400,
 * "기본-1200매"인데 "N개월누적" 문구가 있으면 1200÷N. 기기가 여러 대면 기기별 월 기본을 합산한다.
 */
function usageStats(months: LedgerMonth[], contracts: ContractNote[], vouchers: LedgerVoucher[]): UsageStat[] {
  // 누적 청구 감지 — 상세 줄에 "N개월누적" 문구
  const accumMatch = vouchers.flatMap((voucher) => voucher.items)
    .map((item) => item.label.match(/(\d+)\s*개월\s*누적/)).find(Boolean);
  const accumMonths = accumMatch ? Math.max(1, Number(accumMatch[1])) : 1;

  // 월별 사용 합(그 달에 [사용]이 찍힌 것만) — 매월 청구 업체의 추세·최근 계산용
  const monthlySums = new Map<string, number[]>();
  const usageMonthCount = new Map<string, number>();
  for (const month of months) {
    const sums = new Map<string, number>();
    for (const counter of month.counters) {
      const kind = counter.kind === "흑백" ? "흑백" : "컬러";
      sums.set(kind, (sums.get(kind) || 0) + counter.사용);
    }
    for (const [kind, used] of sums) {
      const list = monthlySums.get(kind) || [];
      list.push(used);
      monthlySums.set(kind, list);
      usageMonthCount.set(kind, (usageMonthCount.get(kind) || 0) + 1);
    }
  }

  // 기기별 월 기본매수 — 전표 안에서 임대료 줄의 모델과 초과 줄을 짝지어 최신값을 남긴다
  const baseByModel = new Map<string, Map<string, number>>(); // kind → (model → 월 기본)
  const excessMonths = new Map<string, number>();
  for (const voucher of vouchers) {
    const model = voucher.items.find((item) => /임대료/.test(item.label) && item.model)?.model || "?";
    for (const item of voucher.items) {
      if (!item.excess) continue;
      const kind = item.excess.kind;
      excessMonths.set(kind, (excessMonths.get(kind) || 0) + 1);
      const monthly = item.excess.기본월 || Math.round(item.excess.기본 / accumMonths);
      if (monthly > 0) {
        const byModel = baseByModel.get(kind) || new Map<string, number>();
        byModel.set(model, monthly);
        baseByModel.set(kind, byModel);
      }
    }
  }

  const fromRemarks = (kind: string) => {
    for (const note of contracts) {
      const value = kind === "컬러" ? note.컬러기본 : note.흑백기본;
      if (value > 0) return value;
    }
    return 0;
  };

  const span = Math.max(1, months.length);
  const out: UsageStat[] = [];
  for (const [kind, values] of monthlySums) {
    const total = values.reduce((a, b) => a + b, 0);
    const usageMonths = usageMonthCount.get(kind) || 0;
    // "N개월누적" 문구가 있으면 누적 청구 확정 — 총사용 ÷ 대장 개월수.
    // 문구가 없고 매달 찍히면 매월 청구 — 그 달들 평균(기존 계산).
    const monthlyPattern = accumMonths === 1 && usageMonths >= span - 1;
    const 월평균 = monthlyPattern ? Math.round(total / Math.max(1, usageMonths)) : Math.round(total / span);
    const recent = values.slice(-3);
    const ledgerBase = Array.from((baseByModel.get(kind) || new Map()).values()).reduce((a, b) => a + b, 0);
    const base = ledgerBase || fromRemarks(kind);
    out.push({
      kind,
      월평균,
      최근3평균: monthlyPattern && recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 월평균,
      최대: Math.max(...values, 0),
      최소: Math.min(...values, 0),
      개월수: span,
      기본매수: base,
      기본매수출처: ledgerBase ? "대장" : base ? "적요" : "없음",
      여유율: base ? Math.round(((base - 월평균) / base) * 100) : 0,
      초과월수: excessMonths.get(kind) || 0,
      추세: trendOf(values),
    });
  }
  return out.sort((a, b) => (a.kind === "컬러" ? -1 : 1) - (b.kind === "컬러" ? -1 : 1));
}

/**
 * 결제 신뢰도 — 달 단위 대조가 아니라 잔액 기준으로 본다.
 *
 * CMS 업체는 청구가 이달, 출금이 다음 달인 게 정상 주기라 "같은 달 수금 여부"로 재면
 * 성실 결제 업체가 미납 8개월로 찍힌다(실사고). 믿을 신호는 두 가지뿐이다:
 *   ① 승인실패 줄("CMS 6/30 승인실패 [잔액부족]") — 실제로 출금이 튕긴 기록
 *   ② 실질잔액 — 누계 잔액에서 최근 청구(아직 수금 전이 정상인 몫)를 뺀 나머지
 */
function paymentStats(months: LedgerMonth[], vouchers: LedgerVoucher[], 누계: { 판매: number; 수금: number; 잔액: number }): PaymentStat {
  const billed = months.filter((month) => month.청구 > 0);
  const delays = billed.filter((month) => month.지연일 >= 0).map((month) => month.지연일);
  const 미납월 = billed.filter((month) => month.수금 < month.청구).map((month) => month.ym);
  const 평균지연일 = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : -1;
  const cms실패 = vouchers.flatMap((voucher) => voucher.items).filter((item) => /승인\s*실패/.test(item.label)).length;
  const 최근청구 = billed.length ? billed[billed.length - 1].청구 : 0;
  const 실질잔액 = Math.max(0, 누계.잔액 - 최근청구);
  const 월평균청구 = billed.length ? billed.reduce((sum, month) => sum + month.청구, 0) / billed.length : 0;
  const 잔액개월치 = 월평균청구 > 0 ? Math.round((실질잔액 / 월평균청구) * 10) / 10 : 0;
  return {
    청구월수: billed.length,
    완납월수: billed.length - 미납월.length,
    미납월,
    평균지연일,
    최대지연일: delays.length ? Math.max(...delays) : -1,
    cms실패,
    실질잔액,
    잔액개월치,
    판정: cms실패 >= 3 || 잔액개월치 >= 2 ? "주의" : cms실패 >= 1 || 실질잔액 > 0 ? "보통" : "우량",
  };
}

function finalize(parsed: LedgerParsed): LedgerAnalysis {
  const 청구목록 = parsed.months.filter((month) => month.청구 > 0).map((month) => month.청구);
  const 임대료 = parsed.months.flatMap((month) => month.items.filter((item) => /임대료/.test(item.label) && !item.무상 && item.단가 > 0));
  return {
    ...parsed,
    usage: usageStats(parsed.months, parsed.contracts, parsed.vouchers),
    payment: paymentStats(parsed.months, parsed.vouchers, parsed.누계),
    billing: {
      월기본료: 임대료.length ? 임대료[임대료.length - 1].단가 : parsed.contracts[0]?.월기본료 || 0,
      최근청구: 청구목록.length ? 청구목록[청구목록.length - 1] : 0,
      평균청구: 청구목록.length ? Math.round(청구목록.reduce((a, b) => a + b, 0) / 청구목록.length) : 0,
      초과청구합: parsed.months.reduce((sum, month) => sum + month.excesses.reduce((s, excess) => s + excess.금액, 0), 0),
    },
    현재계약: parsed.contracts[0],
    // 조건이 어떻게 올라왔는지 — 협상에서 "지난번에 이만큼 올려드렸다"의 근거
    인상이력: parsed.contracts
      .filter((note) => note.월기본료 > 0)
      .map((note) => ({ 시점: note.from, 월기본료: note.월기본료, 컬러기본: note.컬러기본, 흑백기본: note.흑백기본, label: note.label }))
      .sort((a, b) => (a.시점 || "").localeCompare(b.시점 || "")),
  };
}

export function analyzeLedger(text: string): LedgerAnalysis {
  return finalize(parseLedger(text));
}

/**
 * 기간 창 — 3년치를 붙여넣고 "최근 1년만" 볼 수 있게 전표를 날짜로 자르고 통계를 다시 계산한다.
 * 모든 탭(요약·사용량·대장·이력 KPI)이 이 결과 하나를 읽으므로 자동으로 동기화된다.
 *
 * 창을 씌워도 그대로 두는 것:
 *  - 계약 이력·적요: 계약은 기간 밖이라도 현재를 설명한다 (거래연차 판정도 적요 기준)
 *  - 잔액: 시점 값이라 창과 무관하게 "지금 잔액" 그대로 (판매·수금 합계만 창 기준)
 */
export function windowAnalysis(full: LedgerAnalysis, fromYmd: string | null): LedgerAnalysis {
  if (!fromYmd) return full;
  const vouchers = full.vouchers.filter((voucher) => voucher.date >= fromYmd);
  const months = buildMonths(vouchers);
  const result = finalize({
    ...full,
    기간: { from: fromYmd, to: full.기간.to },
    vouchers,
    months,
    누계: {
      판매: vouchers.reduce((sum, voucher) => sum + voucher.판매, 0),
      수금: vouchers.reduce((sum, voucher) => sum + voucher.수금, 0),
      잔액: full.누계.잔액,
    },
  });
  // 기본매수는 계약 조건이라 기간 창과 무관하다 — 창 안에 초과가 없어 기본을 잃으면
  // 전체 데이터의 기본을 이어받는다 (합산 활용률 126% 왜곡의 원인)
  result.usage = result.usage.map((stat) => {
    const fullStat = full.usage.find((entry) => entry.kind === stat.kind);
    if (!fullStat || stat.기본매수 >= fullStat.기본매수) return stat;
    return {
      ...stat,
      기본매수: fullStat.기본매수,
      기본매수출처: fullStat.기본매수출처,
      여유율: fullStat.기본매수 ? Math.round(((fullStat.기본매수 - stat.월평균) / fullStat.기본매수) * 100) : 0,
    };
  });
  return result;
}

// ─── 기기별 사용량 — "합산은 이상하다"(사용자 지적): 초과는 기기별 계약인데 사용량만 합치면 어긋난다 ───

export type MachineMonth = { ym: string; 컬러: number; 흑백: number; excesses: LedgerExcess[] };
export type MachineUsage = {
  model: string;
  months: MachineMonth[];          // 카운터가 찍힌 달만
  임대료단가: number;              // 임대료 줄의 단가 — "기존동일" 계약을 기본료 일치로 찾는 열쇠
  total: { 컬러: number; 흑백: number };
  기본월: { 컬러: number; 흑백: number };   // 월 기준 기본매수 (누적 청구면 환산)
  초과단가: { 컬러: number; 흑백: number }; // 초과금액 ÷ 초과매수 실효 단가
  초과횟수: number;
  초과금액: number;
  accumMonths: number;             // 1=매월 청구, 3=3개월 누적
};

/** 전표 단위로 모델과 카운터·초과가 붙어 있다 — 그 짝을 그대로 살려 기기별로 가른다 */
export function machineUsage(analysis: LedgerAnalysis): MachineUsage[] {
  const accumMatch = analysis.vouchers.flatMap((voucher) => voucher.items)
    .map((item) => item.label.match(/(\d+)\s*개월\s*누적/)).find(Boolean);
  const accumMonths = accumMatch ? Math.max(1, Number(accumMatch[1])) : 1;

  const byModel = new Map<string, MachineUsage>();
  for (const voucher of analysis.vouchers) {
    const model = voucher.items.find((item) => /임대료/.test(item.label) && item.model)?.model;
    if (!model) continue;
    const machine = byModel.get(model) || {
      model, months: [], 임대료단가: 0, total: { 컬러: 0, 흑백: 0 }, 기본월: { 컬러: 0, 흑백: 0 },
      초과단가: { 컬러: 0, 흑백: 0 }, 초과횟수: 0, 초과금액: 0, accumMonths,
    };
    byModel.set(model, machine);
    const feeItem = voucher.items.find((item) => /임대료/.test(item.label) && item.단가 > 0);
    if (feeItem) machine.임대료단가 = feeItem.단가;
    const ym = voucher.date.slice(0, 7);
    let row = machine.months.find((month) => month.ym === ym);
    for (const item of voucher.items) {
      if (item.counter && item.counter.사용 !== 0) {
        if (!row) { row = { ym, 컬러: 0, 흑백: 0, excesses: [] }; machine.months.push(row); }
        if (item.counter.kind === "흑백") { row.흑백 += item.counter.사용; machine.total.흑백 += item.counter.사용; }
        else { row.컬러 += item.counter.사용; machine.total.컬러 += item.counter.사용; }
      }
      if (item.excess) {
        if (!row) { row = { ym, 컬러: 0, 흑백: 0, excesses: [] }; machine.months.push(row); }
        row.excesses.push(item.excess);
        machine.초과횟수 += 1;
        machine.초과금액 += item.excess.금액;
        const monthly = item.excess.기본월 || Math.round(item.excess.기본 / accumMonths);
        if (monthly > 0) machine.기본월[item.excess.kind] = monthly;
        if (item.excess.초과 > 0 && item.excess.금액 > 0) {
          machine.초과단가[item.excess.kind] = Math.round(item.excess.금액 / item.excess.초과);
        }
      }
    }
  }
  return Array.from(byModel.values())
    .filter((machine) => machine.months.length > 0)
    .map((machine) => ({ ...machine, months: machine.months.sort((a, b) => a.ym.localeCompare(b.ym)) }))
    .sort((a, b) => b.total.컬러 + b.total.흑백 - (a.total.컬러 + a.total.흑백));
}

/**
 * 기본매수 조정 시뮬레이션 — 재계약 구조조정 카드의 숫자 근거.
 * 이 기기의 과거 사용량에 "새 월 기본매수"를 적용하면 초과료가 얼마가 됐을지 재계산한다.
 */
export function simulateBase(machine: MachineUsage, kind: "컬러" | "흑백", newMonthlyBase: number): { 현재초과료: number; 예상초과료: number; 절감: number } {
  // 실효 단가는 반올림 없이 — 매당 단가를 먼저 반올림하면 같은 기본을 넣어도 현재와 어긋난다
  let 초과매수합 = 0, 초과금액합 = 0;
  for (const month of machine.months) {
    for (const excess of month.excesses) if (excess.kind === kind) { 초과매수합 += excess.초과; 초과금액합 += excess.금액; }
  }
  const rate = 초과매수합 > 0 ? 초과금액합 / 초과매수합 : machine.초과단가[kind] || 0;
  let 현재 = 0, 예상 = 0;
  for (const month of machine.months) {
    const used = kind === "컬러" ? month.컬러 : month.흑백;
    for (const excess of month.excesses) if (excess.kind === kind) 현재 += excess.금액;
    const allowance = newMonthlyBase * machine.accumMonths;
    if (used > allowance && rate > 0) 예상 += (used - allowance) * rate;
  }
  return { 현재초과료: 현재, 예상초과료: Math.round(예상), 절감: Math.round(현재 - 예상) };
}
