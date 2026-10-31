// AS 접수 뒤 "방문 판단 안내글" — 순수 규칙(2026-10-31, docs/tasks/as-reception-visit-advice-2026-10-31.md).
// 자료 모으기(supabase)는 visitAdviceData.ts(구현 B)가 한다. 여기는 판정·글 만들기만.
import { addressCore } from "./address";
import { isBusinessDay } from "./planDate";

export type VisitVerdict = "불필요" | "필요" | "판단필요" | "판단불가";
export type SpareState = "충분" | "부족" | "모름";

export type UpcomingItem = {
  date: string; // YYYY-MM-DD
  kind: string; // AS · 물류 · 매월점검 · 재계약 …
  title: string; // 글에 찍을 일정 설명(예: "교체(일반)/기기상향")
  vendor: string; // 일정의 업체명
  sameBuilding: boolean; // 같은 건물(주소)의 다른 업체 일정이면 true
  source: string; // 누가 잡은 일정인지(예: "운영팀")
};

export type VisitAdviceInput = {
  vendor: string;
  grade: string;
  deviceLine: string; // 기종/자산기번/시리얼 한 줄
  lastInspection?: string; // YYYY-MM-DD
  lastAs?: string; // YYYY-MM-DD (이번 접수 제외, 다녀온 AS만)
  asAfterInspection: Array<{ date: string; deviceCount: number }>;
  deviceTotal: number;
  spare: SpareState;
  selfRequestOpen: number;
  /**
   * 이번 분기 워킨맵. label = 글에 찍을 값(팀 이름 또는 G5·G12).
   * 매월점검이면 closingDay(이름 맨 앞 숫자 = 마감일)·progress(그 장소의 실제 라벨 G1·G2·G3 …)를 같이 준다.
   */
  workin: null | { label: string; kind: "quarter" | "monthly"; closingDay?: number | null; progress?: string };
  upcoming: UpcomingItem[];
  today: string; // KST YYYY-MM-DD (kstDate())
  /** quarterDays = 분기점검 경과 기준일, monthlyWindowDays = 매월점검 마감 전 창(영업일 수, 마감일 포함) */
  thresholds: { quarterDays: number; monthlyWindowDays: number };
  /** 자료 조회가 실패했으면 그 사유. 있으면 판단불가(자료 못 읽음). */
  lookupError?: string;
  /** 임대리스트에서 업체·지점을 못 찾았으면 true. 있으면 판단불가. */
  notFound?: boolean;
};

export type VisitAdviceResult = {
  verdict: VisitVerdict;
  elapsedDays: number | null;
  reasons: string[];
};

export const VISIT_ADVICE_MAX_CHARS = 600;
export const VISIT_ADVICE_MAX_LINES = 5;
export const BUNDLE_LINE = "추가일정이 있으므로 같이 묶어서 진행할 수 있는지 확인이 필요합니다";

const YMD = /^(\d{4})-(\d{2})-(\d{2})/;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function ymdToUtc(ymd: string | undefined): number | null {
  const m = YMD.exec(String(ymd || ""));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 두 날짜(YYYY-MM-DD) 사이 일수. 못 읽으면 null. */
export function daysBetween(from: string | undefined, to: string | undefined): number | null {
  const a = ymdToUtc(from);
  const b = ymdToUtc(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}

/** "2026-11-02" → "2026-11-02(월)" */
export function ymdWithWeekday(ymd: string): string {
  const t = ymdToUtc(ymd);
  const day = String(ymd || "").slice(0, 10);
  if (t === null) return day;
  return `${day}(${WEEKDAYS[new Date(t).getUTCDay()]})`;
}

function quarterOf(ymd: string): number {
  const m = YMD.exec(String(ymd || ""));
  return m ? Math.floor((Number(m[2]) - 1) / 3) + 1 : 0;
}

/** 워킨맵 라벨이 점검 완료(G5)·이관(G12)인지 */
function workinDoneLabel(label: string): "G5" | "G12" | null {
  const v = String(label || "").toUpperCase().replace(/\s+/g, "");
  if (/(^|[^0-9])G12([^0-9]|$)/.test(v)) return "G12";
  if (/(^|[^0-9])G5([^0-9]|$)/.test(v)) return "G5";
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdOf(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function shiftYmd(ymd: string, days: number): string {
  const t = ymdToUtc(ymd) ?? 0;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/** "2026-11-16" → "11/16" */
function md(ymd: string): string {
  const m = YMD.exec(ymd);
  return m ? `${Number(m[2])}/${Number(m[3])}` : ymd;
}

export type MonthlyWindow = { start: string; end: string };

/**
 * 그 달(year·month)의 매월점검 창 = 마감일(달 길이 넘으면 말일)을 끝으로 하는 영업일 N일.
 * 마감일이 주말·공휴일이면 그 전 영업일이 끝. 시작은 끝에서 거꾸로 영업일 N개째(주말·공휴일은 세지 않으므로 창이 늘어난다).
 */
export function monthlyWindow(year: number, month: number, closingDay: number, businessDays: number): MonthlyWindow {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let end = ymdOf(year, month, Math.min(Math.max(1, closingDay), last));
  while (!isBusinessDay(end)) end = shiftYmd(end, -1);
  let start = end;
  for (let counted = 1; counted < Math.max(1, Math.floor(businessDays)); ) {
    start = shiftYmd(start, -1);
    if (isBusinessDay(start)) counted += 1;
  }
  return { start, end };
}

export type MonthlyWindowJudge = { inWindow: boolean; window: MonthlyWindow };

/**
 * 접수일(today)이 매월점검 창 안인가. 이번 달 마감(창 끝)이 이미 지났으면 다음 달 창으로 본다
 * (보통 밖 — 마감일이 월초면 다음 달 창이 이번 달 말에 걸칠 수 있어 그때는 안).
 */
export function judgeMonthlyWindow(today: string, closingDay: number, businessDays: number): MonthlyWindowJudge | null {
  const m = YMD.exec(String(today || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = String(today).slice(0, 10);
  let window = monthlyWindow(y, mo, closingDay, businessDays);
  if (day > window.end) window = mo === 12 ? monthlyWindow(y + 1, 1, closingDay, businessDays) : monthlyWindow(y, mo + 1, closingDay, businessDays);
  return { inWindow: day >= window.start && day <= window.end, window };
}

/** 매월점검 라벨 → 이번 분기 완료 개월 수(G1 시작 전 0 · G2 1 · G3 2). 그 밖은 null(모름). */
function monthlyDoneMonths(label: string | undefined): number | null {
  const v = String(label || "").toUpperCase().replace(/\s+/g, "");
  if (v === "G1") return 0;
  if (v === "G2") return 1;
  if (v === "G3") return 2;
  return null;
}

/** 이번 달이 분기에서 몇 번째 달인지(1·4·7·10월 = 1 … 3·6·9·12월 = 3) */
function monthInQuarter(ymd: string): number {
  const m = YMD.exec(String(ymd || ""));
  return m ? ((Number(m[2]) - 1) % 3) + 1 : 0;
}

function monthlyWindowText(closingDay: number, j: MonthlyWindowJudge): string {
  const range = `${md(j.window.start)}~${md(j.window.end)}`;
  return `매월점검 마감 ${closingDay}일 · ${j.inWindow ? `창 ${range}` : `창 밖(${range})`}`;
}

function windowDaysOf(input: VisitAdviceInput): number {
  const n = Number(input.thresholds.monthlyWindowDays);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
}

/** 매월점검 지점 판정(G5·G12 는 앞에서 처리). 마감일 모르면 판단필요. */
function judgeMonthly(input: VisitAdviceInput, elapsedDays: number | null): VisitAdviceResult {
  const closing = input.workin?.closingDay ?? null;
  if (closing === null) return { verdict: "판단필요", elapsedDays, reasons: ["매월점검 마감일 모름(워킨맵 이름 앞 숫자 없음)"] };
  const j = judgeMonthlyWindow(input.today, closing, windowDaysOf(input));
  if (!j) return { verdict: "판단불가", elapsedDays, reasons: ["접수일을 읽지 못함"] };
  if (!j.inWindow) return { verdict: "불필요", elapsedDays, reasons: [monthlyWindowText(closing, j)] };
  const done = monthlyDoneMonths(input.workin?.progress);
  if (done !== null && done >= monthInQuarter(input.today)) {
    return { verdict: "불필요", elapsedDays, reasons: [`이번 달 매월점검 완료(${String(input.workin?.progress).toUpperCase().trim()})`, monthlyWindowText(closing, j)] };
  }
  return { verdict: "필요", elapsedDays, reasons: [monthlyWindowText(closing, j)] };
}

function hasAsAfterInspection(input: VisitAdviceInput): boolean {
  if (input.asAfterInspection.length > 0) return true;
  if (!input.lastAs) return false;
  if (!input.lastInspection) return true;
  return String(input.lastAs).slice(0, 10) > String(input.lastInspection).slice(0, 10);
}

/** 점검여부 판정표(설계안 4-3, 위에서부터 먼저 맞는 것). */
export function judgeVisit(input: VisitAdviceInput): VisitAdviceResult {
  const elapsed = input.lastInspection ? daysBetween(input.lastInspection, input.today) : null;
  const elapsedDays = elapsed === null ? null : Math.max(0, elapsed);
  const threshold = input.thresholds.quarterDays;

  // 0. 자료 조회 실패 / 못 찾음 / 판단할 자료가 하나도 없음
  if (input.lookupError) return { verdict: "판단불가", elapsedDays, reasons: [`자료 못 읽음: ${input.lookupError}`] };
  if (input.notFound) return { verdict: "판단불가", elapsedDays, reasons: ["임대리스트에서 못 찾음"] };
  if (input.deviceTotal <= 0 && !input.lastInspection && !input.lastAs && !input.workin) {
    return { verdict: "판단불가", elapsedDays, reasons: ["판단할 자료 없음(기기·점검·AS·워킨맵 모두 없음)"] };
  }
  // 1. 이번 분기 워킨맵 없음
  if (!input.workin) return { verdict: "불필요", elapsedDays, reasons: ["이번 분기 워킨맵 없음"] };
  // 2. G5(점검 완료)·G12(이관)
  const done = workinDoneLabel(input.workin.label);
  if (done) return { verdict: "불필요", elapsedDays, reasons: [done === "G5" ? "워킨맵 G5 점검 완료" : "워킨맵 G12 이관"] };
  // 2-1. 매월점검 = 마감일 기준 영업일 창(2026-10-31 사용자 결정, 경과일 기준 아님)
  if (input.workin.kind === "monthly") return judgeMonthly(input, elapsedDays);
  // 3. 기준 미만
  if (elapsedDays !== null && elapsedDays < threshold) {
    return { verdict: "불필요", elapsedDays, reasons: [`경과 ${elapsedDays}일 < 기준 ${threshold}일`] };
  }
  const over = elapsedDays === null ? "점검 기록 없음" : `경과 ${elapsedDays}일 ≥ 기준 ${threshold}일`;
  // 4. 점검 뒤 AS 다녀옴 → 사람이 판단
  if (hasAsAfterInspection(input)) return { verdict: "판단필요", elapsedDays, reasons: [over, "마지막 점검 뒤 AS 다녀옴"] };
  // 5. 점검 필요
  return { verdict: "필요", elapsedDays, reasons: [over, "점검 뒤 AS 없음"] };
}

/** 할 일이 있을 때만 보낸다: 불필요 + 추가일정 0 이면 false. */
export function shouldSend(result: VisitAdviceResult, upcoming: ReadonlyArray<unknown>): boolean {
  return result.verdict !== "불필요" || upcoming.length > 0;
}

function workinText(input: VisitAdviceInput): string {
  const w = input.workin;
  if (!w) return "없음";
  const done = workinDoneLabel(w.label);
  if (done === "G5") return "있음(G5 이번 분기 점검 완료)";
  if (done === "G12") return "있음(G12 이관)";
  const label = String(w.label || "").trim();
  if (w.kind === "monthly") return label ? `있음(${label} 매월점검)` : "있음(매월점검)";
  return label ? `있음(${label} 분기점검)` : "있음(분기점검)";
}

function verdictLine(input: VisitAdviceInput, result: VisitAdviceResult): string {
  const elapsed = result.elapsedDays === null ? "점검 기록 없음" : `경과 ${result.elapsedDays}일`;
  const done = input.workin ? workinDoneLabel(input.workin.label) : null;
  const workin = !input.workin ? "워킨맵 없음" : done === "G5" ? "워킨맵 G5 점검 완료" : done === "G12" ? "워킨맵 G12 이관" : "워킨맵 있음";
  const closing = input.workin?.kind === "monthly" && !done ? input.workin.closingDay ?? null : null;
  const j = closing !== null ? judgeMonthlyWindow(input.today, closing, windowDaysOf(input)) : null;
  const basis = input.workin?.kind === "monthly" && !done
    ? j && closing !== null
      ? `마감 ${closing}일 · ${j.inWindow ? "창" : "창 밖"} ${md(j.window.start)}~${md(j.window.end)}`
      : "마감일 모름"
    : `기준 ${input.thresholds.quarterDays}일`;
  return `점검여부: ${result.verdict} (${elapsed} / ${basis}, ${workin})`;
}

function latestAs(input: VisitAdviceInput): { date: string; deviceCount: number } | null {
  if (!input.asAfterInspection.length) return null;
  return [...input.asAfterInspection].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
}

function evidenceLines(input: VisitAdviceInput): string[] {
  const as = latestAs(input);
  const asCount = as ? Math.max(0, as.deviceCount) : 0;
  const asDate = as ? String(as.date).slice(5, 10) : input.lastAs ? String(input.lastAs).slice(5, 10) : "";
  const spare = `여분 ${input.spare}`;
  const lines = [`근거: 기기 ${input.deviceTotal}대 · AS ${asCount}대 봄${asDate ? `(${asDate})` : ""} · ${spare} · 자가신청 ${input.selfRequestOpen}건`];
  if (input.deviceTotal === 1 && asCount >= 1 && input.spare === "충분") {
    lines.push("참고: 1대·여분 충분 — AS 때 점검까지 했으면 생략 가능");
  } else if (input.deviceTotal >= 2 && asCount < input.deviceTotal) {
    lines.push(`참고: AS는 ${asCount}대만 봄 — 나머지 기기 점검 필요 가능성 큼`);
  }
  return lines;
}

/** 추가일정 한 줄(번호 제외). */
export function upcomingLineText(item: UpcomingItem, today: string): string {
  const what = String(item.title || item.kind || "일정").trim();
  const head = item.sameBuilding ? `[같은 건물] ${String(item.vendor || "").trim()} — ${what}` : what;
  const src = String(item.source || "").trim();
  const past = String(item.date).slice(0, 10) < String(today).slice(0, 10) ? " (지남·미완료)" : "";
  return `${ymdWithWeekday(item.date)} ${head}${src ? ` — ${src}` : ""}${past}`;
}

/** 날짜순(같은 날은 제목순). */
export function sortUpcoming(items: ReadonlyArray<UpcomingItem>): UpcomingItem[] {
  return [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
}

function upcomingBlock(items: UpcomingItem[], today: string, maxLines: number): string[] {
  if (!items.length) return ["추가일정:없음"];
  const shown = items.slice(0, Math.max(0, maxLines));
  const lines = ["추가일정:", ...shown.map((it, i) => `${i + 1}.${upcomingLineText(it, today)}`)];
  const rest = items.length - shown.length;
  if (rest > 0) lines.push(`외 ${rest}건 — 일정리스트 확인`);
  lines.push(BUNDLE_LINE);
  return lines;
}

// 600자를 넘으면 추가일정 줄을 하나씩 줄인다. 그래도 넘으면 끝을 자른다.
function fitText(build: (maxLines: number) => string, maxLines: number): string {
  for (let n = maxLines; n >= 0; n--) {
    const text = build(n);
    if (text.length <= VISIT_ADVICE_MAX_CHARS) return text;
  }
  const text = build(0);
  return `${text.slice(0, VISIT_ADVICE_MAX_CHARS - 1)}…`;
}

function headLines(vendor: string, grade: string, deviceLine: string): string[] {
  const head = [String(vendor || "").trim(), String(grade || "").trim()].filter(Boolean).join(" ");
  const device = String(deviceLine || "").split("/").map((s) => s.trim()).filter((s) => s && s !== "-").join("/");
  return [head || "(업체명 없음)", ...(device ? [device] : [])];
}

/** 임대리스트에서 못 찾았을 때 3줄 글. */
export function notFoundText(vendor: string, grade = "", deviceLine = ""): string {
  const [head, device] = headLines(vendor, grade, deviceLine);
  return [head, device || "기종/자산기번/시리얼 없음", "방문 판단: 임대리스트에서 못 찾음 — 마지막 점검·추가일정을 직접 확인해 주세요"].join("\n");
}

/** 안내글 전체(600자 이내). */
export function buildVisitAdviceText(input: VisitAdviceInput, result: VisitAdviceResult): string {
  const items = sortUpcoming(input.upcoming);
  if (result.verdict === "판단불가") {
    const base = input.lookupError
      ? [...headLines(input.vendor, input.grade, input.deviceLine), "방문 판단: 자료 못 읽음 — 마지막 점검·추가일정을 직접 확인해 주세요"].join("\n")
      : notFoundText(input.vendor, input.grade, input.deviceLine);
    if (!items.length) return fitText(() => base, 0);
    return fitText((n) => [base, ...upcomingBlock(items, input.today, n)].join("\n"), VISIT_ADVICE_MAX_LINES);
  }
  const fixed = [
    ...headLines(input.vendor, input.grade, input.deviceLine),
    `마지막점검일:${input.lastInspection ? String(input.lastInspection).slice(0, 10) : "기록 없음"}`,
    `마지막AS일:${input.lastAs ? String(input.lastAs).slice(0, 10) : "기록 없음"}`,
    `${quarterOf(input.today)}분기 워킨맵:${workinText(input)}`,
    verdictLine(input, result),
    ...(result.verdict === "판단필요" ? evidenceLines(input) : []),
  ];
  return fitText((n) => [...fixed, ...upcomingBlock(items, input.today, n)].join("\n"), VISIT_ADVICE_MAX_LINES);
}

const SIDO = /^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:도|특별자치도|특별자치시|특별시|광역시)?\s+/;

/**
 * 같은 건물(주소) 키. 도로명+건물번호 / 동+번지까지만 남기고(층·호·괄호·건물명·메모 제거)
 * 시도 표기·공백을 지운다. 도로명·지번을 못 읽으면 다듬은 주소 앞부분(건물명 쪽)을 공백 없이. 빈 주소는 "".
 */
export function sameBuildingKey(address: string): string {
  const raw = String(address || "").trim();
  if (!raw) return "";
  return addressCore(raw.replace(/(\d+)\s*번지/g, "$1"))
    .replace(/,.*$/, "")
    .replace(SIDO, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
