/**
 * 접수 카톡 글 = 각 방에서 사람이 붙여 오던 실물 양식 그대로(2026-10-27).
 * 설계: docs/tasks/dept-kakao-card-2026-10-27.md
 *
 * - 카드(경영지원·전략영업·운영지원·IT): 시트 "접수 카드" 범위를 복사해 붙인 글자 배열 — 공통 직렬화 serializeCard + 양식별 칸 목록(MGMT_CARD·SALES_CARD·IT_CARD).
 * - 운영지원도 카드(OPS_CARD, 경영 틀 기반 — 2026-10-27 자유 글 틀 폐기). 카드 칸에 없는 폼 값(예정일·외근요청 등)은 접수내용 뒤 한 줄씩.
 * 값은 임대리스트 행(LeaseHit = vendor_info._raw 키)과 폼 값(DeptReceptionRow)에서. 시트 수식 오류(28000개월·76. 8. 28)는 재현하지 않는다.
 *
 * 순수 모듈 — ServiceReception.tsx 의 포맷터(fmtDot·fmtWon)를 import 하지 않는다(순환 import·큰 화면 파일 끌어옴). 같은 규칙을 옮기고 tests 로 고정.
 */
import { kstDate } from "./visits";
import { sheetVendorName } from "./vendorName";

// ── 구분자(한 곳) ─────────────────────────────────────
// 탭이 폰 카톡에서 붙어 보이면 SEP_CELL 하나를 공백 3칸으로 바꾼다(QA 사진 확인 대상).
export const SEP_CELL = "\t";
export const SEP_LV = ":   ";
export const SEP_PAIR = "   /   ";
export type CardSeps = { cell: string; lv: string; pair: string };
export const DEFAULT_SEPS: CardSeps = { cell: SEP_CELL, lv: SEP_LV, pair: SEP_PAIR };

/** 카톡 글 안전 상한 — 넘으면 접수내용 끝을 자른다(DB symptom 은 원문 그대로) */
export const KAKAO_CARD_MAX = 3000;
const CUT_SUFFIX = "…(앱 접수에 전체)";

// ── 줄 종류 ─────────────────────────────────────────
/** 칸: 글자 그대로(라벨) 또는 값 자리 { v: 키 } */
export type CardCell = string | { v: string };
export type CardLineSpec =
  | { kind: "cells"; cells: CardCell[] }
  | { kind: "pairs"; pairs: Array<[label: CardCell, value: CardCell, lv?: string]> } // 라벨이 빈 글자로 풀리면 그 쌍은 뺀다. lv 를 주면 그 쌍만 라벨·값 사이 글자를 바꾼다(영업 "접수자연락처" 콜론 없음)
  | { kind: "blank" }
  | { kind: "text"; prefix: string; value: CardCell };
export type CardLine =
  | { kind: "cells"; cells: string[] }
  | { kind: "pairs"; pairs: Array<[string, string, string?]> }
  | { kind: "blank" }
  | { kind: "text"; prefix: string; value: string };

const cellValue = (c: CardCell, values: Record<string, string>): string => (typeof c === "string" ? c : values[c.v] ?? "");

/** 칸 목록 + 값 → 줄 목록 */
export function resolveCard(spec: readonly CardLineSpec[], values: Record<string, string>): CardLine[] {
  return spec.map((line): CardLine => {
    if (line.kind === "cells") return { kind: "cells", cells: line.cells.map((c) => cellValue(c, values)) };
    if (line.kind === "pairs") return { kind: "pairs", pairs: line.pairs.map(([l, v, lv]): [string, string, string?] => [cellValue(l, values), cellValue(v, values), lv]).filter(([l]) => l) };
    if (line.kind === "text") return { kind: "text", prefix: line.prefix, value: cellValue(line.value, values) };
    return { kind: "blank" };
  });
}

/** 공통 직렬화 — 줄마다 끝의 탭·공백은 지운다(가운데 빈 칸은 남겨 라벨 위치를 실물과 맞춘다) */
export function serializeCard(lines: readonly CardLine[], seps: CardSeps = DEFAULT_SEPS): string {
  const out = lines.map((line) => {
    if (line.kind === "cells") return line.cells.join(seps.cell);
    if (line.kind === "pairs") {
      return line.pairs.map(([label, value, lv]) => {
        const sep = lv ?? seps.lv;
        return value ? `${label}${sep}${value}` : `${label}${sep.trimEnd()}`;
      }).join(seps.pair);
    }
    if (line.kind === "text") return line.prefix ? `${line.prefix}${seps.lv}${line.value}` : line.value;
    return "";
  });
  return out.join("\n").split("\n").map((s) => s.trimEnd()).join("\n").replace(/\n+$/, "");
}

// ── 작은 포맷터 ──────────────────────────────────────
const str = (v: unknown) => String(v ?? "").trim();
/** 값 안 줄바꿈 → " / " (접수내용만 예외) */
export const oneLine = (v: unknown): string =>
  String(v ?? "").split(/_x000d_|\r\n|\r|\n/).map((s) => s.trim()).filter(Boolean).join(" / ");
const spaceLine = (v: unknown): string => String(v ?? "").replace(/_x000d_|\r|\n/g, " ").replace(/\s+/g, " ").trim();

export function pickRaw(lease: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!lease) return "";
  for (const key of keys) {
    const v = str(lease[key]);
    if (v) return v;
  }
  return "";
}

/** 날짜 값 → {y,m,d} (엑셀 일련번호 20000~60000 포함). 날짜 모양이 아니면 null */
function parseDate(value: string): { y: number; m: number; d: number } | null {
  const raw = str(value);
  if (!raw) return null;
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial < 20000 || serial > 60000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  const m = raw.match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
const inRange = (p: { y: number }) => p.y >= 2000 && p.y <= 2060;

/** 본문 날짜 "YYYY. M. D". 연도 2000~2060 밖이면 빈칸, 날짜가 아닌 글자("가구")는 그대로 */
export function cardDate(value: string): string {
  const p = parseDate(value);
  if (!p) return oneLine(value);
  return inRange(p) ? `${p.y}. ${p.m}. ${p.d}` : "";
}
/** 머리 줄 날짜 "YY. M. D" */
export function cardDateYY(value: string): string {
  const p = parseDate(value);
  if (!p) return oneLine(value);
  return inRange(p) ? `${String(p.y).slice(2)}. ${p.m}. ${p.d}` : "";
}

const ymdOf = (now: Date) => {
  const s = kstDate(now);
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
};
const dayKey = (p: { y: number; m: number; d: number }) => p.y * 10000 + p.m * 100 + p.d;

/** 남은개월 = 종료일 − 오늘(KST) 월수. 지난 계약은 "만료", 날짜가 아니면 빈칸 */
export function monthsLeft(end: string, now: Date = new Date()): string {
  const p = parseDate(end);
  if (!p || !inRange(p)) return "";
  const t = ymdOf(now);
  if (dayKey(p) < dayKey(t)) return "만료";
  return `${(p.y - t.y) * 12 + (p.m - t.m)}개월`;
}
/** 사용개월 = 오늘 − 시작일 월수. 날짜가 아니거나 미래면 빈칸 */
export function monthsUsed(start: string, now: Date = new Date()): string {
  const p = parseDate(start);
  if (!p || !inRange(p)) return "";
  const t = ymdOf(now);
  const months = (t.y - p.y) * 12 + (t.m - p.m);
  return months >= 0 ? `${months}개월` : "";
}

/** 금액 "₩150,000" — 소수는 반올림(연평균 97666.66667), 글자면 그대로, 빈 값은 빈칸 */
export function cardWon(value: string): string {
  const raw = str(value);
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return raw;
  const amount = Number(cleaned.split(".").slice(0, 2).join("."));
  return Number.isFinite(amount) ? `₩${Math.round(amount).toLocaleString("en-US")}` : raw;
}

/** 접수일 "M. D"(KST) */
export function receiptMD(now: Date = new Date()): string {
  const t = ymdOf(now);
  return `${t.m}. ${t.d}`;
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** "2026-08-24" → "8월 24일(월)". 날짜가 아니면 빈칸 */
export function korDayWithWeekday(ymd: string): string {
  const m = str(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${Number(m[2])}월 ${Number(m[3])}일(${WEEKDAY[dow]})`;
}

/** "컬러500/흑백3000" — 둘 다 없으면 빈칸, 하나면 그 하나 */
function colorMono(color: string, mono: string): string {
  return [color ? `컬러${oneLine(color)}` : "", mono ? `흑백${oneLine(mono)}` : ""].filter(Boolean).join("/");
}
const misuOf = (v: string) => (str(v) === "0" ? "" : oneLine(v));

// ── 칸 목록(양식별 데이터) ─────────────────────────────
const v = (key: string) => ({ v: key });
const row4 = (a: string, b: string, c: string, d: string): CardLineSpec => ({ kind: "cells", cells: [a, v(b), c, v(d)] });

/** 경영지원 — 시트 "접수 카드" A1:M15 (B1:D1 병합, J1 방문주기 값은 빈칸 Q9). 둘째 줄 작성자(AS방 CS 카드와 같은 자리, 2026-10-27 사용자) */
export const MGMT_CARD: readonly CardLineSpec[] = [
  { kind: "cells", cells: [v("field"), v("vendor"), "", "", "종료일", v("endYY"), "지역", v("region"), "방문주기", v("visitCycle"), "", "접수일", v("receipt")] },
  { kind: "cells", cells: ["작성자", v("author"), v("handlerLabel"), v("handlerText")] },
  row4("기번", "serial", "급한여부", "urgent"),
  row4("임대여부", "leaseState", "접수분야", "field"),
  row4("임대리스트순번", "seq", "장비소유주", "owner"),
  row4("계약일", "contract", "종료일", "end"),
  row4("납품/교체일", "delivered", "남은개월", "left"),
  row4("기본임대료", "baseRent", "평균임대료", "avgRent"),
  row4("기본매수", "baseCount", "추가장당", "extraRate"),
  row4("설치업체", "installer", "유지보수업체", "maintainer"),
  row4("접수자성함", "receiverName", "접수자연락처", "receiverPhone"),
  row4("미수개월", "misu", "★키맨성함/번호", "keyman"),
  row4("방문담당자", "region", "사용여부", "used"),
  row4("주소", "address", "확장성", "expand"),
  row4("기종", "model", "기번", "serial"),
  { kind: "cells", cells: ["접수내용", v("content")] },
];

/** 전략영업 — 머리 줄은 셀 복사(탭), 본문은 "라벨:   값   /   라벨:   값" */
export const SALES_CARD: readonly CardLineSpec[] = [
  { kind: "cells", cells: [v("grade"), v("field"), v("model"), v("vendor"), "종료일", v("endYY"), "지역", v("region"), "접수일", v("receipt")] },
  { kind: "blank" },
  { kind: "pairs", pairs: [["작성자", v("author")], [v("handlerLabel"), v("handlerText")]] },
  { kind: "pairs", pairs: [["임대여부", v("leaseState")], ["접수분야", v("field")]] },
  { kind: "pairs", pairs: [["상호", v("vendor")], ["임대리스트순번", v("seq")]] },
  { kind: "pairs", pairs: [["계약일", v("contract")], ["종료일", v("end")]] },
  { kind: "pairs", pairs: [["기본임대료", v("baseRent")], ["평균임대료", v("avgRent")]] },
  { kind: "pairs", pairs: [["기본매수", v("baseCount")], ["추가장당", v("extraRate")]] },
  { kind: "pairs", pairs: [["접수자성함", v("receiverName")], ["접수자연락처", v("receiverPhone"), "   "]] }, // 실물 그대로 콜론 없음(Q11)
  { kind: "pairs", pairs: [["미수개월", v("misu")], ["남은개월", v("left")]] },
  { kind: "pairs", pairs: [["주소", v("address")]] },
  { kind: "text", prefix: "🔹 접수내용", value: v("content") },
];

/**
 * 운영지원 — 경영 카드 틀을 운영 양식에 맞춘 것(2026-10-27 사용자 "양식을 만들어 그냥", 자유 글 틀 폐기).
 * 값이 빈 칸은 라벨만 두고 값은 빈칸. 운영 폼에 없는 칸(방문주기·급한여부 등)은 넣지 않는다.
 */
export const OPS_CARD: readonly CardLineSpec[] = [
  { kind: "cells", cells: [v("field"), v("vendor"), "", "", "종료일", v("endYY"), "지역", v("region"), "접수일", v("receipt")] },
  { kind: "cells", cells: ["작성자", v("author"), v("handlerLabel"), v("handlerText")] },
  row4("접수유형", "route", "접수분야", "field"),
  row4("예정일", "schedule", "외근요청", "outside"),
  row4("임대여부", "leaseState", "임대리스트순번", "seq"),
  row4("계약일", "contract", "종료일", "end"),
  row4("기본임대료", "baseRent", "기본매수", "baseCount"),
  row4("설치업체", "installer", "유지보수업체", "maintainer"),
  row4("업체담당자", "receiverName", "연락처", "receiverPhone"),
  { kind: "cells", cells: ["★키맨성함/번호", v("keyman")] },
  row4("주소", "address", "확장성", "expand"),
  row4("기종", "model", "기번", "serial"),
  { kind: "cells", cells: ["접수내용", v("content")] },
];

/** IT — 방 "신)it접수 as" 실물. 난이도·긴급도·이관여부·사양·처리내용은 앱 폼에 없어 빈칸(Q12) */
export const IT_CARD: readonly CardLineSpec[] = [
  { kind: "cells", cells: ["IT", v("kind"), v("grade"), v("item"), v("vendor")] },
  { kind: "cells", cells: ["작성자", v("author")] },
  { kind: "cells", cells: ["난이도", "", "긴급도"] },
  row4("자산번호", "assetNo", "시리얼번호", "serial"),
  { kind: "cells", cells: ["지역", v("region"), "이관여부"] },
  row4("접수유형", "route", "임대여부", "leaseState"),
  row4("임대리스트순번", "seq", "장비소유주", "owner"),
  row4("계약일", "contract", "종료일", "end"),
  row4("납품/교체일", "delivered", "남은개월", "left"),
  row4("기본임대료", "baseRent", "평균임대료", "avgRent"),
  row4("설치업체", "installer", "유지보수업체", "maintainer"),
  row4("접수자성함연락처", "receiver", "제조사", "maker"),
  { kind: "cells", cells: ["기종", v("model"), "사양"] },
  { kind: "cells", cells: ["일반전화", v("tel")] },
  { kind: "cells", cells: ["미수개월", v("misu")] },
  { kind: "cells", cells: ["★키맨성함/번호", v("keyman")] },
  row4("주소", "address", "확장성", "expand"),
  { kind: "cells", cells: ["증상", v("content"), "처리내용"] },
];

/** 상한을 넘으면 접수내용(값 키 content) 끝을 잘라 다시 만든다 */
function withCap(build: (content: string) => string, content: string): string {
  const text = build(content);
  if (text.length <= KAKAO_CARD_MAX) return text;
  const over = text.length - KAKAO_CARD_MAX + CUT_SUFFIX.length;
  const keep = Math.max(0, content.length - over);
  return build(`${content.slice(0, keep).trimEnd()}${CUT_SUFFIX}`);
}

// ── 임대리스트 공통 값 ──────────────────────────────────
type Lease = Record<string, unknown> | null | undefined;
function leaseValues(lease: Lease, now: Date): Record<string, string> {
  const L = (...keys: string[]) => pickRaw(lease, ...keys);
  const 납품 = L("납품/교체일");
  return {
    leaseState: oneLine(L("임대여부")),
    owner: oneLine(L("장비소유주")), // CS 카드의 "퍼스트전산" 기본값은 안 쓴다(경영 실물 빈칸)
    contract: cardDate(L("계약일", "첫계약일")),
    end: cardDate(L("종료일")),
    endYY: cardDateYY(L("종료일")),
    delivered: cardDate(납품),
    left: monthsLeft(L("종료일"), now),
    used: monthsUsed(납품, now), // 사용여부(사용개월) = 오늘 − 납품/교체일(팀장 0단계 지시)
    baseRent: cardWon(L("기본금액")),
    avgRent: cardWon(L("연평균")),
    baseCount: colorMono(L("기본(컬)"), L("기본(흑)")),
    extraRate: colorMono(L("추가(컬)"), L("추가(흑)")),
    installer: oneLine(L("납품담당")),
    maintainer: oneLine(L("위탁/유지보수및기타사항")),
    misu: misuOf(L("미수개월수", "미수개월")),
    keyman: oneLine(L("세금계산서", "키맨")), // 키맨 연락처는 임대리스트 '세금계산서' 칸에 들어 있다(0단계 실측)
    expand: oneLine(L("확장성")),
    maker: oneLine(L("제조사")),
    tel: oneLine(L("일반전화")),
  };
}

// ── 부서 접수(경영·영업·운영) ──────────────────────────
/** buildDeptKakaoText 가 읽는 행 칸(DeptReceptionRow 의 부분) */
export type DeptCardRow = {
  type: string; author: string; route: string; vendor: string; grade: string; region: string;
  lease_no: string; serial: string; model: string; address: string; field: string; symptom: string;
  receiver_name: string; receiver_phone: string;
  remote_meta?: Partial<Record<"handler" | "via" | "outside" | "contract_kind" | "schedule_date" | "progress", string>>;
};

/** 작성자 줄의 처리자 칸 — 사내 요청자는 처리자 뒤 괄호로만(2026-10-27 사용자). 처리자가 비면 칸째 뺀다 */
function handlerText(row: DeptCardRow): string {
  const handler = str(row.remote_meta?.handler);
  if (!handler) return "";
  const via = row.route === "사내" ? str(row.remote_meta?.via) : "";
  return via ? `${handler}(사내 ${via})` : handler;
}

function deptValues(row: DeptCardRow, lease: Lease, now: Date): Record<string, string> {
  const L = (...keys: string[]) => pickRaw(lease, ...keys);
  const vendor = spaceLine(L("업체명")) || sheetVendorName(lease as Record<string, string> | null) || str(row.vendor);
  return {
    ...leaseValues(lease, now),
    field: oneLine(row.field),
    vendor,
    grade: str(row.grade) || L("등급"),
    model: oneLine(L("모델명", "기종") || row.model),
    region: str(row.region),
    visitCycle: "", // Q9 — 임대리스트에 없음, 빈칸
    urgent: "",     // Q5 — 폼에 없음, 빈칸
    receipt: receiptMD(now),
    serial: oneLine(L("시리얼번호(기번)", "기번") || row.serial), // Q4 — 두 칸 모두 진짜 기번
    seq: str(row.lease_no) || L("순") || (lease ? "" : "신규"),
    receiverName: oneLine(row.receiver_name),
    receiverPhone: oneLine(row.receiver_phone),
    address: oneLine(row.address || L("주소(실납품주소,도로명주소)", "주소")),
    author: str(row.author),
    handlerText: handlerText(row),
    handlerLabel: handlerText(row) ? "처리자" : "",
  };
}

/**
 * 카드 칸에 대응이 없는 폼 값 — 실물 양식엔 없지만 기재한 값은 버리지 않는다(2026-10-27 사용자).
 * 접수내용 줄 다음에 한 줄씩. 값이 있는 것만.
 */
function deptExtras(row: DeptCardRow): Array<[string, string]> {
  const m = row.remote_meta || {};
  const sched = cardDate(str(m.schedule_date));
  const via = row.route === "사내" ? str(m.via) : "";
  const out: Array<[string, string]> = [];
  if (row.type !== "운영지원") { // 운영 카드는 접수유형·예정일·외근요청 칸이 본문에 있다
    if (str(row.route)) out.push(["접수유형", str(row.route)]); // 경영·영업 카드엔 칸이 없다 — 접수내용 다음 첫 줄
    if (sched) out.push(["예정일", `${sched}${korWeekday(str(m.schedule_date))}`]);
    if (str(m.outside)) out.push(["외근요청", "예"]);
  }
  if (str(m.contract_kind)) out.push(["계약서구분", str(m.contract_kind)]);
  if (str(m.progress)) out.push(["진행메모", oneLine(m.progress)]);
  if (via && !str(m.handler)) out.push(["사내 요청자", via]); // 처리자가 있으면 처리자 칸 괄호에 이미 있다
  return out;
}

/** "(월)" — 날짜가 아니면 빈 글자 */
function korWeekday(ymd: string): string {
  const k = korDayWithWeekday(ymd);
  const m = k.match(/\(.\)$/);
  return m ? m[0] : "";
}

/**
 * 부서 접수 사진 줄(2026-10-28 사용자 "운영·경영·영업에도 사진 첨부") — "📷 사진 n장 {링크}". 사진이 없거나 링크가 비면 빈 글자(줄 없음).
 * 카톡은 글만 가므로 사진은 모아보기 링크 하나로(CS·IT 접수와 같은 ?album= 링크).
 */
export function deptPhotoLine(count: number, link: string): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const url = str(link);
  return n > 0 && url ? `📷 사진 ${n}장 ${url}` : "";
}

/** 부서 접수 카톡 글 — 경영지원·전략영업·운영지원 모두 카드. photoLine(deptPhotoLine)은 접수내용 바로 다음 줄(값 있을 때만) */
export function buildDeptKakaoText(row: DeptCardRow, lease: Lease, now: Date = new Date(), photoLine = ""): string {
  const spec = row.type === "경영지원" ? MGMT_CARD : row.type === "운영지원" ? OPS_CARD : SALES_CARD;
  const m = row.remote_meta || {};
  const values = {
    ...deptValues(row, lease, now),
    route: row.route === "사내" ? "사내" : str(row.route),
    schedule: cardDate(str(m.schedule_date)) ? `${cardDate(str(m.schedule_date))}${korWeekday(str(m.schedule_date))}` : "",
    outside: str(m.outside) ? "예" : "",
  };
  const extras = deptExtras(row);
  const sep = spec === SALES_CARD ? SEP_LV : SEP_CELL; // 영업 본문은 "라벨:   값" 꼴
  return withCap((content) => {
    const card = serializeCard(resolveCard(spec, { ...values, content }));
    return [card, str(photoLine), ...extras.map(([l, val]) => `${l}${sep}${val}`)].filter(Boolean).join("\n");
  }, String(row.symptom ?? "").trim());
}

// ── IT 접수 ────────────────────────────────────────
export type ItCardSource = {
  lease: Lease;              // 임대리스트 행(신규면 pseudoLease)
  manual: { 접수자성함?: string; 접수자연락처?: string; 제목?: string; 증상?: string; 참고사항?: string; 주소?: string };
  route: string;
  region: string;
  author: string;
  paid?: string;
  photoLines?: string[];     // 사진 링크 2줄 — 카톡은 글만 가므로 유지
  kind?: string;             // 종류(기본 "AS")
};

/** IT 카드 — 실물 "IT⇥AS⇥등급⇥장비종류⇥업체명" 틀(둘째 줄 작성자) + 사진 링크 + 끝 줄(유상/무상·참고사항, 값 있는 것만) */
export function buildItKakaoCard(src: ItCardSource, now: Date = new Date()): string {
  const { lease, manual } = src;
  const L = (...keys: string[]) => pickRaw(lease, ...keys);
  const options = ["옵션1 (FAX/CPU)", "옵션2 (트레이/램/SSD)", "옵션3 (피니셔/그래픽)", "옵션4 (솔루션/윈도우)"].map((k) => L(k)).join("");
  const modelName = L("모델명", "기종");
  const values: Record<string, string> = {
    ...leaseValues(lease, now),
    kind: str(src.kind) || "AS",
    grade: L("등급"),
    item: oneLine(L("품목")),
    vendor: sheetVendorName(lease as Record<string, string> | null),
    assetNo: oneLine(L("자산번호")),
    serial: oneLine(L("시리얼번호(기번)", "기번")),
    region: str(src.region),
    route: str(src.route),
    seq: L("순"),
    receiver: [oneLine(manual.접수자성함), oneLine(manual.접수자연락처)].filter(Boolean).join(" / "),
    model: oneLine(modelName && options ? `${modelName}/${options}` : modelName || options),
    address: oneLine(str(manual.주소) || L("주소(실납품주소,도로명주소)", "주소")),
    author: str(src.author),
  };
  const tail = [
    str(src.paid) ? `유상/무상 ${str(src.paid)}` : "",
    oneLine(manual.참고사항) ? `참고사항 ${oneLine(manual.참고사항)}` : "",
  ].filter(Boolean).join(" · ");
  const content = [str(manual.제목), str(manual.증상)].filter(Boolean).join(" / "); // Q13 제목 / 증상
  const photos = (src.photoLines || []).filter(Boolean);
  return withCap((c) => {
    const card = serializeCard(resolveCard(IT_CARD, { ...values, content: c }));
    return [card, ...photos, tail].filter(Boolean).join("\n");
  }, content);
}
// ── IT 일정·네이버 제목(2026-10-31 IT 파트 요청 새 형식) ─────────────────
// as_tickets.calendarTitle·네이버 제목·일정리스트가 모두 이 한 줄을 쓴다(탭 구분, 탭은 공백으로 바꾸지 않는다).
//   IT A/S⇥등급⇥자산번호⇥시리얼⇥품목⇥모델명⇥증상⇥거래처명
// 거래처명이 맨 끝 칸이라 fieldTicketVendor(_shared/ticket-title.ts)가 탭 칸으로 정확히 꺼낸다 —
// 한글 품목("노트북")·증상이 업체명 앞에 와도 섞이지 않는다(2026-10-27 새 카드 첫 줄 사고 재발 방지).
// 빈 값은 칸만 비우고 탭 수(7개)는 유지한다. 기존 일정은 바꾸지 않는다(신규 접수부터).

/** 제목 칸 머리 — fieldTicketVendor 의 IT 탭 형식 판별과 같은 글자 */
export const IT_TITLE_HEAD = "IT A/S";
/** 제목의 증상 칸 최대 글자 — 넘으면 자르고 "…" */
export const IT_TITLE_SYMPTOM_MAX = 30;

const titleCell = (v: unknown): string => spaceLine(v);

/** 새 IT 일정 제목인가 — "IT A/S" 로 시작하는 탭 8칸(옛 IT 제목은 10칸 이상이라 여기서 갈린다) */
export function isItScheduleTitle(line: string): boolean {
  const cells = String(line || "").split("\t");
  return cells.length === 8 && cells[0] === IT_TITLE_HEAD;
}

/** 증상 칸: 한 줄로 펴고 30자에서 자른다(뒤 "…") */
export function itTitleSymptom(symptom: unknown): string {
  const s = titleCell(symptom);
  return s.length > IT_TITLE_SYMPTOM_MAX ? `${s.slice(0, IT_TITLE_SYMPTOM_MAX).trimEnd()}…` : s;
}

function itTitleFromCells(cells: { grade: string; assetNo: string; serial: string; item: string; model: string; symptom: string; vendor: string }): string {
  return [IT_TITLE_HEAD, cells.grade, cells.assetNo, cells.serial, cells.item, cells.model, itTitleSymptom(cells.symptom), cells.vendor]
    .map(titleCell).join("\t");
}

/**
 * IT 접수 일정 제목 — `IT A/S⇥등급⇥자산번호⇥시리얼⇥품목⇥모델명⇥증상⇥거래처명`.
 * 값: 임대리스트 행(IT_CARD 와 같은 키) + 폼 증상(증상 없으면 제목). 거래처명은 sheetVendorName(발행·등급 접두 없음).
 */
export function itScheduleTitle(lease: Lease, symptom: string): string {
  const L = (...keys: string[]) => pickRaw(lease, ...keys);
  return itTitleFromCells({
    grade: L("등급"),
    assetNo: L("자산번호"),
    serial: L("시리얼번호(기번)", "기번"),
    item: L("품목"),
    model: L("모델명", "기종"),
    symptom,
    vendor: sheetVendorName(lease as Record<string, string> | null),
  });
}

/** 저장된 새 IT 카드 글에서 일정 제목 줄을 다시 만든다(title_line 이 빈 행 대비). 새 IT 카드가 아니면 null */
function itCardToTitle(reportText: string): string | null {
  const lines = String(reportText || "").split("\n");
  const head = lines[0].split("\t");
  if (!(head[0] === "IT" && /^A\/?S$/.test(head[1] || ""))) return null;
  const cellsOf = (label: string) => lines.map((l) => l.split("\t")).find((c) => c.includes(label)) || [];
  const after = (label: string) => { const c = cellsOf(label); const i = c.indexOf(label); return i >= 0 ? str(c[i + 1]) : ""; };
  return itTitleFromCells({
    grade: str(head[2]),
    assetNo: after("자산번호"),
    serial: after("시리얼번호"),
    item: str(head[3]),
    model: after("기종").split("/")[0].trim(), // 카드 기종 칸은 "모델명/옵션"
    symptom: after("증상"),
    vendor: str(head[4]),
  });
}

/**
 * 일정(as_tickets.calendarTitle)·네이버 제목 줄 — 보고양식 첫 줄(탭→공백).
 * IT 는 새 일정 제목 형식(탭 유지). legacyHead(저장 직후 폼에서 만든 정확한 제목 줄, title_line)가 있으면 그것.
 */
export function receptionTitleLine(reportText: string | null | undefined, legacyHead?: string): string {
  const text = String(reportText || "");
  const head = String(legacyHead ?? "").replace(/[\r\n]+/g, "");
  const first = (head.trim() ? head : "") || itCardToTitle(text) || text.split("\n")[0] || "";
  if (isItScheduleTitle(first)) return first; // 탭 칸 유지(끝 칸이 비어도 탭 수 그대로)
  return first.replace(/\t/g, " ").trim();
}

// ── 부서 접수 후속 글(처리완료·보류·배정·일정 변경·취소, 2026-10-27) ─────
/** 후속 글 종류 */
export type DeptFollowupKind = "done" | "hold" | "assign" | "date" | "cancel";
/** 후속 글이 읽는 접수 행 칸 */
export type DeptFollowupRow = { vendor: string; field?: string; receipt_date?: string; created_at?: string };
/** handler: 처리자 · handled: 처리내용 · reason: 사유 · from/to: 이전·새 예정일(YYYY-MM-DD) */
export type DeptFollowupDetail = { handler?: string; handled?: string; reason?: string; from?: string; to?: string };

const FOLLOWUP_TAG: Record<DeptFollowupKind, string> = { done: "처리완료", hold: "보류", assign: "배정", date: "일정 변경", cancel: "취소" };
const FOLLOWUP_MAX = 1000;

/** "2026-10-27" → "10/27". 날짜가 아니면 빈 글자 */
function mdSlash(ymd: string): string {
  const m = str(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : "";
}
/** 접수일 M/D — receipt_date(YYYY-MM-DD) 우선, 없으면 created_at 의 KST 날짜 */
function receiptSlash(row: DeptFollowupRow): string {
  const r = mdSlash(str(row.receipt_date));
  if (r) return r;
  const at = new Date(str(row.created_at));
  return Number.isNaN(at.getTime()) ? "" : mdSlash(kstDate(at));
}
/** "10/27(화)" — 날짜가 아니면 "미정" */
const mdDow = (ymd: string): string => (mdSlash(ymd) ? `${mdSlash(ymd)}${korWeekday(ymd)}` : "미정");

/**
 * 부서 접수 처리 뒤 같은 방에 보내는 짧은 후속 글(카드 아님, 탭 없음).
 * 첫 줄 = `[종류] 업체명 · 접수 M/D 접수분야` — 방에서 원 접수 카드를 알아보는 머리.
 * 값이 빈 줄(처리내용·사유)은 뺀다. 처리자가 비면 "미정".
 */
export function buildDeptFollowupText(row: DeptFollowupRow, kind: DeptFollowupKind, detail: DeptFollowupDetail = {}): string {
  const md = receiptSlash(row);
  const tail = [md ? `접수 ${md}` : "", oneLine(row.field)].filter(Boolean).join(" ");
  const head = `[${FOLLOWUP_TAG[kind]}] ${spaceLine(row.vendor) || "업체 미상"}${tail ? ` · ${tail}` : ""}`;
  const handler = oneLine(detail.handler) || "미정";
  const reason = oneLine(detail.reason);
  const lines = [head];
  if (kind === "done") {
    lines.push(`처리자 ${handler}`);
    const handled = str(detail.handled);
    if (handled) lines.push(`처리내용: ${handled}`);
  } else if (kind === "hold") {
    if (reason) lines.push(`사유: ${reason}`);
  } else if (kind === "assign") {
    lines.push(`처리자 ${handler}`);
  } else if (kind === "date") {
    lines.push(`${mdDow(str(detail.from))} → ${mdDow(str(detail.to))}`);
    if (reason) lines.push(`사유: ${reason}`);
  } else if (kind === "cancel") {
    if (reason) lines.push(`사유: ${reason}`);
  }
  const text = lines.join("\n");
  return text.length > FOLLOWUP_MAX ? `${text.slice(0, FOLLOWUP_MAX - CUT_SUFFIX.length)}${CUT_SUFFIX}` : text;
}
