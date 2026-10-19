/**
 * 지원 부서 시트(영업지원·경영지원) 열 사양 — 순수 TS(Deno API 없음). vitest·deno test 양쪽에서 import 한다.
 *
 * 왜 열 번호 고정인가: 경영 시트는 '자산번호' 머리가 T(20)·BB(54) 두 곳이고, 3행에도 도우미 머리가 있다.
 * 기존 엔진(sheets-api.ts)처럼 머리 이름으로 찾으면 엉뚱한 열·행에 쓴다. 그래서 열 번호로 쓰고,
 * 쓰기 전에 5행 머리를 기대값과 비교해 하나라도 다르면 멈춘다(열 밀림 방지).
 *
 * 출처 구분(kind):
 *  - app          앱이 보낸 값(사람 입력·앱 계산). 대상 칸이 수식이면 쓰지 않는다
 *  - fixed        고정 문구(접수 때 진행상황 '진행중'). 수식이면 쓰지 않는다
 *  - lease        6행 원본 열 번호로 임대리스트 값을 값으로 고정(복합기 fillLeaseValues 와 같은 방식).
 *                 순이 없거나 못 찾으면 fallbackKey 가 있으면 그 앱 값(수식이면 건너뜀), 없으면 비움
 *  - leaseFormula 6행 번호가 없는 자동 열. 수식이 있으면 그대로 두고, 없으면 fallbackKey 앱 값
 *  - manual       시트 사람 전용. 앱은 절대 쓰지 않는다
 *
 * 실측 근거: 2026-10-19 CSV 사본(영업 gid 174566767 5,844행 · 경영 gid 899183889 1,765행) 5·6행.
 */

export type DeptSheetCategory = "reception_sales" | "reception_mgmt";
export type DeptColKind = "app" | "fixed" | "lease" | "leaseFormula" | "manual";
export type DeptValueKey =
  | "seq" | "date" | "yymm" | "time" | "author" | "handler" | "progress" | "outside"
  | "leaseNo" | "route" | "field" | "contractKind" | "receiverName" | "receiverPhone"
  | "symptom" | "handled" | "vendor" | "region" | "grade" | "address";

export type DeptColumn = {
  col: number;           // 1부터 센 열 번호
  header: string;        // 5행 기대 머리(공백·줄바꿈은 비교 때 무시)
  kind: DeptColKind;
  key?: DeptValueKey;    // app 값 키
  fixed?: string;        // fixed 값
  fallbackKey?: DeptValueKey; // lease·leaseFormula 에서 임대리스트 값을 못 쓸 때의 앱 값
  src?: number;          // 6행 원본 열 번호 실측값(참고·테스트용). 실제 기입은 시트 6행을 읽어 쓴다
  update?: boolean;      // 처리 저장(갱신 잡) 때 쓰는 열
};

export type DeptSheetSpec = {
  category: DeptSheetCategory;
  label: string;
  headerRow: number;     // 5
  indexRow: number;      // 6 — 원본 열 번호 행
  dataStart: number;     // 7
  lastCol: number;
  markerCols: number[];  // 마지막 데이터 행 판단(사람이 적는 열)
  fingerprintKeys: DeptValueKey[];
  columns: DeptColumn[];
};

const SALES_COLUMNS: DeptColumn[] = [
  { col: 1, header: "순번", kind: "app", key: "seq" },
  { col: 2, header: "접수일", kind: "app", key: "date" },
  { col: 3, header: "년월", kind: "app", key: "yymm" },
  { col: 4, header: "접수시간", kind: "app", key: "time" },
  { col: 5, header: "접수자", kind: "app", key: "author" },
  { col: 6, header: "처리자", kind: "app", key: "handler", update: true },
  { col: 7, header: "진행중/처리완료/보류/취소", kind: "fixed", fixed: "진행중", update: true },
  { col: 8, header: "승인여부", kind: "app", key: "progress", update: true },
  { col: 9, header: "외근요청\n여부", kind: "app", key: "outside" },
  { col: 10, header: "2차\n담당자", kind: "manual" },
  { col: 11, header: "2차\n체크여부", kind: "manual" },
  { col: 12, header: "순", kind: "app", key: "leaseNo" },
  { col: 13, header: "임대여부", kind: "lease", src: 31 },
  { col: 14, header: "등급", kind: "lease", src: 19, fallbackKey: "grade" },
  { col: 15, header: "지역", kind: "leaseFormula", fallbackKey: "region" },
  { col: 16, header: "업체명", kind: "lease", src: 79, fallbackKey: "vendor" },
  { col: 17, header: "접수유형", kind: "app", key: "route" },
  { col: 18, header: "접수분야", kind: "app", key: "field" },
  { col: 19, header: "자산번호", kind: "lease", src: 35 },
  { col: 20, header: "미수개월수", kind: "lease", src: 62 },
  { col: 21, header: "업체담당자", kind: "app", key: "receiverName" },
  { col: 22, header: "전화번호", kind: "app", key: "receiverPhone" },
  { col: 23, header: "접수내용", kind: "app", key: "symptom" },
  { col: 24, header: "처리내용", kind: "app", key: "handled", update: true },
  { col: 25, header: "모델명", kind: "lease", src: 38 },
  { col: 26, header: "기본금액", kind: "lease", src: 14 },
  { col: 27, header: "연평균", kind: "lease", src: 15 },
  { col: 28, header: "계약일", kind: "lease", src: 9 },   // 6행 표시 '1900. 1. 8' = 일련번호 9
  { col: 29, header: "종료일", kind: "lease", src: 10 },  // '1900. 1. 9' = 10
  { col: 30, header: "남은개월", kind: "lease", src: 11 },
  { col: 31, header: "기본매수", kind: "leaseFormula" },
  { col: 32, header: "초과장당금액", kind: "leaseFormula" },
  { col: 33, header: "주소", kind: "leaseFormula", fallbackKey: "address" },
];

const MGMT_COLUMNS: DeptColumn[] = [
  { col: 1, header: "-", kind: "app", key: "seq" },
  { col: 2, header: "날짜", kind: "app", key: "date" },
  { col: 3, header: "년월", kind: "app", key: "yymm" },
  { col: 4, header: "접수시간", kind: "app", key: "time" },
  { col: 5, header: "접수자", kind: "app", key: "author" },
  { col: 6, header: "처리자", kind: "app", key: "handler", update: true },
  { col: 7, header: "진행중/처리완료/보류/취소", kind: "fixed", fixed: "진행중", update: true },
  { col: 8, header: "", kind: "manual" },
  { col: 9, header: "PC판촉여부", kind: "manual" },
  { col: 10, header: "외근요청여부\n(외근요청)", kind: "app", key: "outside" },
  { col: 11, header: "순", kind: "app", key: "leaseNo" },
  { col: 12, header: "담당자", kind: "lease", src: 25 },
  { col: 13, header: "임대여부", kind: "lease", src: 31 },
  { col: 14, header: "등급", kind: "lease", src: 19, fallbackKey: "grade" },
  { col: 15, header: "지역", kind: "leaseFormula", fallbackKey: "region" },
  { col: 16, header: "업체명", kind: "lease", src: 79, fallbackKey: "vendor" },
  { col: 17, header: "접수유형", kind: "app", key: "route" },
  { col: 18, header: "접수분야", kind: "app", key: "field" },
  { col: 19, header: "계약서구분", kind: "app", key: "contractKind" },
  { col: 20, header: "자산번호", kind: "lease", src: 35 },
  { col: 21, header: "미수개월수", kind: "lease", src: 62 },
  { col: 22, header: "일반전화", kind: "lease", src: 28 },
  { col: 23, header: "업체담당자", kind: "app", key: "receiverName" },
  { col: 24, header: "전화번호", kind: "app", key: "receiverPhone" },
  { col: 25, header: "접수내용", kind: "app", key: "symptom" },
  { col: 26, header: "처리내용", kind: "app", key: "handled", update: true },
  { col: 27, header: "발송여부", kind: "manual" },
  { col: 28, header: "작성여부", kind: "manual" },
  { col: 29, header: "반영여부", kind: "manual" },
  { col: 30, header: "특이사항", kind: "lease", src: 18 },  // 임대리스트 특이사항. 앱 특이사항은 DB 에만
  { col: 31, header: "확장성", kind: "lease", src: 80 },
  { col: 32, header: "모델명", kind: "lease", src: 38 },
  { col: 33, header: "품목", kind: "lease", src: 33 },
  { col: 34, header: "제조사", kind: "lease", src: 34 },
  { col: 35, header: "기종", kind: "lease", src: 38 },
  { col: 36, header: "기본금액", kind: "lease", src: 14 },
  { col: 37, header: "연평균", kind: "lease", src: 15 },
  { col: 38, header: "계약일", kind: "lease", src: 9 },
  { col: 39, header: "종료일", kind: "lease", src: 10 },
  { col: 40, header: "남은개월", kind: "lease", src: 11 },
  { col: 41, header: "자동연장여부", kind: "leaseFormula" },
  { col: 42, header: "교체일", kind: "lease", src: 32 },
  { col: 43, header: "주소", kind: "lease", src: 51, fallbackKey: "address" },
  { col: 44, header: "기기상태", kind: "lease", src: 30 },
  { col: 45, header: "관리\n담당자", kind: "lease", src: 48 },
  { col: 46, header: "시/도", kind: "lease", src: 52 },
  { col: 47, header: "시/구", kind: "lease", src: 53 },
  { col: 48, header: "방문주기", kind: "manual" },          // 6행 #N/A
  { col: 49, header: "납품담당", kind: "lease", src: 44 },
  { col: 50, header: "키맨", kind: "lease", src: 27 },
  { col: 51, header: "추가조건", kind: "lease", src: 58 },
  { col: 52, header: "장비소유주", kind: "lease", src: 46 },
  { col: 53, header: "시리얼번호(기번)", kind: "lease", src: 36 },
  { col: 54, header: "자산번호", kind: "lease", src: 35 },
  { col: 55, header: "위탁/유지보수및기타사항", kind: "lease", src: 45 },
  { col: 56, header: "기본매수", kind: "leaseFormula" },      // 6행 #N/A
  { col: 57, header: "초과장당금액", kind: "leaseFormula" },
];

export const DEPT_SHEET_SPECS: Record<DeptSheetCategory, DeptSheetSpec> = {
  reception_sales: {
    category: "reception_sales", label: "영업지원", headerRow: 5, indexRow: 6, dataStart: 7,
    lastCol: 33, markerCols: [2, 4, 5],
    fingerprintKeys: ["date", "time", "author", "leaseNo", "symptom"],
    columns: SALES_COLUMNS,
  },
  reception_mgmt: {
    category: "reception_mgmt", label: "경영지원", headerRow: 5, indexRow: 6, dataStart: 7,
    lastCol: 57, markerCols: [2, 4, 5],
    fingerprintKeys: ["date", "time", "author", "leaseNo", "symptom"],
    columns: MGMT_COLUMNS,
  },
};

export function isDeptSheetCategory(category: unknown): category is DeptSheetCategory {
  return category === "reception_sales" || category === "reception_mgmt";
}

export function colLetter(col: number): string {
  let out = "";
  while (col > 0) { const r = (col - 1) % 26; out = String.fromCharCode(65 + r) + out; col = Math.floor((col - 1) / 26); }
  return out;
}

/** 머리 비교용 정규화 — 공백·줄바꿈 전부 제거(셀 안 줄바꿈 "외근요청⏎여부", 앞 공백 " 품목") */
export const normHeader = (v: unknown) => String(v ?? "").replace(/\s+/g, "");

/** 5행 머리 검증. 하나라도 다르면 throw — 열 밀림이면 쓰지 않는다 */
export function verifyDeptHeaders(spec: DeptSheetSpec, headerRowValues: unknown[]): void {
  for (const c of spec.columns) {
    const actual = String(headerRowValues[c.col - 1] ?? "");
    if (normHeader(actual) !== normHeader(c.header)) {
      throw new Error(`시트 머리 변경: ${colLetter(c.col)}열 기대 '${c.header.replace(/\n/g, " ")}' 실제 '${actual.replace(/\n/g, " ")}'`);
    }
  }
}

/** 6행 원본 열 번호 해석. UNFORMATTED 숫자가 정상 경로, 서식 붙은 표시값(₩ 14, 62개월, 1900. 1. 8)도 받는다. #N/A·빈칸은 0 */
export function parseSourceIndex(v: unknown): number {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : 0;
  const s = String(v ?? "").trim();
  if (!s || s.startsWith("#")) return 0;
  const date = s.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?$/);
  if (date) {
    // 시트 날짜 일련번호: 1899-12-30 = 0
    const ms = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])) - Date.UTC(1899, 11, 30);
    const serial = Math.round(ms / 86400000);
    return serial > 0 ? serial : 0;
  }
  const n = Number(s.replace(/[₩,\s]|개월/g, ""));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** KST 기준 날짜 조각 — 접수일 'M월 d일', 년월 'yyMM', 접수시간 'HH:mm' */
export function kstStamp(at: Date): { date: string; yymm: string; time: string } {
  const k = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`,
    yymm: `${String(k.getUTCFullYear()).slice(2)}${two(k.getUTCMonth() + 1)}`,
    time: `${two(k.getUTCHours())}:${two(k.getUTCMinutes())}`,
  };
}

/** 순번: 데이터 구간 A열에서 숫자인 값의 최댓값 + 1(빈 시트면 1). 사람 기재 병행이라 쓸 때마다 다시 센다 */
export function nextSeq(aColumn: unknown[]): number {
  let max = 0;
  for (const v of aColumn) {
    const n = Number(String(v ?? "").replace(/[,\s]/g, ""));
    if (String(v ?? "").trim() !== "" && Number.isFinite(n) && n > max) max = Math.floor(n);
  }
  return max + 1;
}

/** 마커 열들(데이터 시작 행부터 읽은 열 값)에서 마지막으로 값이 있는 행 번호. 없으면 0 */
export function lastFilledRow(dataStart: number, markerValues: unknown[][]): number {
  let last = 0;
  for (const values of markerValues) {
    for (let i = values.length - 1; i >= 0; i--) {
      if (String(values[i] ?? "").trim() !== "") { last = Math.max(last, dataStart + i); break; }
    }
  }
  return last;
}

/** DB 상태 → 시트 진행상황 문구 */
export function sheetStatusText(status: unknown): string {
  const s = String(status ?? "").trim();
  const map: Record<string, string> = {
    "접수": "진행중", "진행중": "진행중", "보류": "보류", "완료": "처리완료", "처리완료": "처리완료", "취소": "취소",
  };
  return map[s] || "";
}

/** 문자열 칸이 =,+,@ 로 시작하면 USER_ENTERED 가 수식으로 읽는다 — 앞에 ' 를 붙여 글자로 고정 */
export function safeText(v: string): string {
  return /^[=+@]/.test(v) ? `'${v}` : v;
}

/** 앱 페이로드(data)에서 키 값 꺼내기 — 프런트 이름 차이(camel/snake)를 흡수 */
const ALIASES: Record<DeptValueKey, string[]> = {
  seq: ["sheetSeq", "sheet_seq"],
  date: [],
  yymm: [],
  time: [],
  author: ["receiptAuthor", "author"],
  handler: ["handler"],
  progress: ["progress"],
  outside: ["outside"],
  leaseNo: ["leaseNo", "lease_no", "firstNo", "first_no"],
  route: ["route"],
  field: ["field"],
  contractKind: ["contractKind", "contract_kind"],
  receiverName: ["receiverName", "receiver_name"],
  receiverPhone: ["receiverPhone", "receiver_phone"],
  symptom: ["symptom"],
  handled: ["handled"],
  vendor: ["vendor", "company"],
  region: ["region"],
  grade: ["grade"],
  address: ["address"],
};

export function pickData(data: Record<string, unknown>, key: DeptValueKey): string {
  for (const name of ALIASES[key]) {
    const v = data[name];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/**
 * 접수 행의 앱 값(열 번호 → 값). 임대리스트 고정 값은 따로(dept-sheets.ts) 덮는다.
 * - formulaCols: 대상 행에서 수식이 들어 있는 열 — app·fixed·fallback 값은 쓰지 않는다
 * - leaseFilled: 임대리스트 값을 실제로 얻었는지. 얻었으면 lease 열의 fallback 은 쓰지 않는다
 */
export function buildAppendValues(
  spec: DeptSheetSpec,
  input: { data: Record<string, unknown>; author: string; submittedAt: Date; seq: number },
  opts: { formulaCols?: Set<number>; leaseFilled?: boolean } = {},
): Record<number, string> {
  const { data, author, submittedAt, seq } = input;
  const stamp = kstStamp(submittedAt);
  const route = pickData(data, "route");
  const via = String(data["via"] ?? "").trim();
  const value = (key: DeptValueKey): string => {
    switch (key) {
      case "seq": return seq > 0 ? String(seq) : "";
      case "date": return stamp.date;
      case "yymm": return stamp.yymm;
      case "time": return stamp.time;
      case "author": return pickData(data, "author") || author;
      case "route": return route === "사내" && via ? via : route; // 시트 관행: 사내 요청은 요청자 이름
      default: return pickData(data, key);
    }
  };
  const formula = opts.formulaCols || new Set<number>();
  const out: Record<number, string> = {};
  for (const c of spec.columns) {
    if (formula.has(c.col)) continue;
    let v = "";
    if (c.kind === "app" && c.key) v = value(c.key);
    else if (c.kind === "fixed") v = c.fixed || "";
    else if (c.kind === "leaseFormula" && c.fallbackKey) v = value(c.fallbackKey);
    else if (c.kind === "lease" && c.fallbackKey && !opts.leaseFilled) v = value(c.fallbackKey);
    if (v !== "") out[c.col] = safeText(v);
  }
  return out;
}

/** 처리 저장(갱신 잡) 값 — 진행상황·처리자·진행 메모(영업)·처리내용. 빈 값은 쓰지 않는다(시트에서 사람이 적은 값 보존) */
export function buildUpdateValues(spec: DeptSheetSpec, data: Record<string, unknown>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of spec.columns) {
    if (!c.update) continue;
    const v = c.kind === "fixed" ? sheetStatusText(data["status"]) : c.key ? pickData(data, c.key) : "";
    if (v !== "") out[c.col] = safeText(v);
  }
  return out;
}

/** 임대리스트 행 값 → lease 열 값. 6행 번호(srcIndexRow)로 원본 열을 고르고, leaseFix(머리 이름 기준)가 우선 */
export function buildLeaseValues(
  spec: DeptSheetSpec,
  srcIndexRow: unknown[],
  leaseHeaders: unknown[],
  leaseValues: unknown[],
  overrides: Record<string, string> = {},
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of spec.columns) {
    if (c.kind !== "lease") continue;
    const src = parseSourceIndex(srcIndexRow[c.col - 1]);
    if (!src) continue;
    const headerName = String(leaseHeaders[src - 1] ?? "").trim();
    const fix = headerName && Object.prototype.hasOwnProperty.call(overrides, headerName) ? String(overrides[headerName] ?? "") : "";
    const v = fix !== "" ? fix : String(leaseValues[src - 1] ?? "");
    if (v.trim() !== "") out[c.col] = v; // 빈 값은 쓰지 않는다(있던 수식을 공백으로 덮지 않게)
  }
  return out;
}

/** 중복 지문 비교용 정규화 — 공백 제거, 시각 앞자리 0 제거(시트 표시 '9:19' ↔ 앱 '09:19') */
export function normFingerprint(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "").replace(/^'/, "").replace(/^0(\d:)/, "$1");
}

/** 지문 열 번호(앱이 실제로 값을 쓰는 열만). 3개 미만이면 빈 배열 — 판단하지 않는다 */
export function fingerprintCols(spec: DeptSheetSpec, appValues: Record<number, string>): number[] {
  const cols = spec.fingerprintKeys
    .map((key) => spec.columns.find((c) => c.kind === "app" && c.key === key)?.col || 0)
    .filter((col) => col > 0 && String(appValues[col] ?? "").trim() !== "");
  return cols.length >= 3 ? cols : [];
}
