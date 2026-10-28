/**
 * 서비스접수 미처리 = 시트 상태 기준(C3) — 순수 규칙(Deno API 없음). 엣지 index.ts 와 vitest 양쪽에서 import 한다.
 * 설계: docs/tasks/reception-unhandled-sheet-and-dept-search.md 3~5절.
 *
 * 프런트 사본: src/receptionSheetState.ts (sheetStateClass·sheetDate). 두 사본은 tests/receptionSheetState.test.ts 가
 * 같은 표본으로 대조한다 — 한쪽을 고치면 다른 쪽도 같이 고칠 것.
 *
 * 읽는 탭(같은 문서 1QRl…, gid 로 찾음 — 이름이 바뀌어도 동작):
 *  - 해지방어접수(=영업팀) gid 174566767 · 경영지원접수 gid 899183889 : 머리 5행, 데이터 7행~, 상태 G열
 *  - 원격 gid 916322987 : 머리 1행, 데이터 5행~, 상태 G열 '처리여부', L열 '한조처리'에 IT 가 들어가면 IT 접수
 *  - AS접수용(=CS 복합기 AS) gid 1181394897 : 머리 5행, 데이터 8행~, 읽기 A5:T + BD5:BD(2026-10-28 목록 모드). 상태 칸이 없어 cls "record"
 *    (BD "처리완료"는 앱이 적는 메모) — 홈 미처리(openRowsOf)에는 넣지 않는다. 설계 docs/tasks/reception-list-sheet-rows-2026-10-28.md 4절.
 * 고객 전화번호 열(영업 V·경영 X 등)은 읽어도 돌려주지 않는다(필요한 칸만 뽑는다).
 */

export type SheetSource = "sales" | "mgmt" | "remote" | "copier";
export type SheetClass = "done" | "hold" | "open";
/** 행 분류 — 상태 칸 규칙(SheetClass) + CS 시트 행 "record"(상태 없음, 미처리 밖) */
export type SheetRowClass = SheetClass | "record";
export type SheetKind = "영업팀" | "경영지원" | "원격이관" | "IT" | "복합기 AS";

const squeeze = (v: unknown) => String(v ?? "").replace(/\s+/g, "");

/**
 * 상태 칸 → 완료/보류/미처리 (모든 탭 공통, 설계 4절 + D2).
 * - 완료: 완료·취소·중복·이관·해결·재접수가 들어 있거나, 공백 뺀 값이 AS접수·A/S접수
 *   (이관·재접수·AS접수 = 다른 곳으로 넘어감 = 이 칸의 일은 끝)
 * - 보류: 정확히 "보류"
 * - 미처리: 그 밖 전부(공란·진행중·처리중·처리예정·부재중·채널보냄·문의중 등)
 */
export function sheetStateClass(value: unknown): SheetClass {
  const s = squeeze(value);
  if (!s) return "open";
  if (/완료|취소|중복|이관|해결|재접수/.test(s)) return "done";
  const upper = s.toUpperCase();
  if (upper === "AS접수" || upper === "A/S접수") return "done";
  if (s === "보류") return "hold";
  return "open";
}

/** 완료 계열 중 '취소'인지(자가 치유 때 DB 를 취소로) */
export const isCancelState = (value: unknown) => /취소/.test(squeeze(value));

const pad2 = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad2(m)}-${pad2(d)}` : "";
};

/**
 * 접수일 조립: C열 년월(yyMM, 예 "2610") + B열 "M월 d일" → YYYY-MM-DD.
 * B가 이미 연도가 붙은 날짜(2026-10-20 · 2026. 10. 20)면 그대로. C가 이상하고 B에 연도도 없으면 "" (경과일을 계산하지 않는다).
 */
export function sheetDate(yymm: unknown, md: unknown): string {
  const b = String(md ?? "").trim();
  const full = b.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (full) return validYmd(Number(full[1]), Number(full[2]), Number(full[3]));
  const c = squeeze(yymm);
  const ym = c.match(/^(\d{2})(\d{2})$/);
  if (!ym) return "";
  const year = 2000 + Number(ym[1]);
  const month = Number(ym[2]);
  if (month < 1 || month > 12) return "";
  const md2 = b.match(/^(\d{1,2})\s*[월/.-]\s*(\d{1,2})/);
  if (!md2) return "";
  const m = Number(md2[1]);
  const d = Number(md2[2]);
  // 년월과 접수일의 달이 다르면(드묾) 접수일 달을 믿되, 12월↔1월 경계는 연도를 맞춘다
  let y = year;
  if (m === 12 && month === 1) y -= 1;
  else if (m === 1 && month === 12) y += 1;
  return validYmd(y, m, d);
}

/** B열 "M월 d일"·"M/d" → [월, 일] (연도 없는 꼴만). 못 읽으면 null */
const monthDayOf = (md: unknown): [number, number] | null => {
  const b = String(md ?? "").trim();
  if (/^\d{4}\s*[-./년]/.test(b)) return null;
  const m = b.match(/^(\d{1,2})\s*[월/.-]\s*(\d{1,2})/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 ? [mm, dd] : null;
};

/**
 * C열 년월이 빈 행의 연도 추정(2026-10-27 경영지원접수: 사람이 넣은 행은 C열을 비우고 B열에 "10월 26일"만 적어 425행 날짜가 비었다).
 * 시트는 아래가 최신이므로 아래 → 위로 걸으며 연도를 붙인다.
 *  - 시작 = KST 올해·이번 달. 맨 아래(처음 만나는) 달이 이번 달보다 크면 작년.
 *  - 위 행의 달이 아래 행보다 6 넘게 크면(1월 → 12월 경계) 연도 −1. 단 바로 위 행도 같은 쪽이어야(한 줄만 튄 순서 어긋남으로 연도가 밀리지 않게).
 *  - 아래 행과 6달 넘게 차이 나는데 경계가 아닌 행(순서 어긋남)은 기준 달을 바꾸지 않는다.
 *  - 날짜가 이미 있는 행(C열 있음 = 앱이 쓴 행)은 기준(연도·달)을 그 값으로 다시 맞춘다.
 *  - 오늘(KST)보다 뒤 날짜는 버린다(""). C열 오타로 미래가 된 날짜(예 "9912" → 2099-12-30, 10-25 사본 9행)도 C열을 버리고 다시 추정한다.
 * items[i].date 가 "" 이고 yymmEmpty 인 것, 또는 date 가 오늘 뒤인 것만 채운다. 순수 함수 — 고친 date 배열을 돌려준다.
 */
export function inferMissingYears(items: Array<{ date: string; md: string; yymmEmpty: boolean }>, now: Date = new Date()): string[] {
  const out = items.map((it) => it.date);
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const today = kst.toISOString().slice(0, 10);
  let year = kst.getUTCFullYear();
  let prev = kst.getUTCMonth() + 1;
  let started = false;
  const known = (i: number) => Boolean(items[i].date) && items[i].date <= today;
  const monthAt = (i: number) => (known(i) ? Number(items[i].date.slice(5, 7)) : monthDayOf(items[i].md)?.[0] ?? 0);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (known(i)) {
      year = Number(it.date.slice(0, 4));
      prev = Number(it.date.slice(5, 7));
      started = true;
      continue;
    }
    if (!it.yymmEmpty && !it.date) continue;
    const md = monthDayOf(it.md);
    if (!md) { out[i] = ""; continue; }
    const [m, d] = md;
    if (!started) {
      if (m > prev) year -= 1;
      prev = m;
      started = true;
    } else if (m - prev > 6) {
      let above = 0;
      for (let k = i - 1; k >= 0 && !above; k--) above = monthAt(k);
      if (!above || above - prev > 6) { year -= 1; prev = m; }
    } else if (prev - m <= 6) {
      prev = m;
    }
    const ymd = validYmd(year, m, d);
    out[i] = ymd && ymd <= today ? ymd : "";
  }
  return out;
}

// ── 전화번호 가림(2026-10-27: 공개 엣지 응답에 키맨·접수내용 속 고객 번호가 그대로 나갔다) ──
// 휴대·유선(0으로 시작, 지역번호 2~3자리) → 가운데만 "****"(카톡 수집 _shared/kakao-parse.ts 휴대폰 가림과 같은 꼴: 010-****-5678),
// 대표번호(15xx·16xx·18xx-xxxx) → 뒤 4자리 "****". 영문·숫자에 붙은 숫자열(기기 시리얼)·"숫자-" 뒤(계좌·사업자 번호 조각)는 건드리지 않는다.
// 글자 뒤 하이픈은 가린다("케이웨이컴퍼니-010-…" 꼴, 2026-10-27 영업 시트 실측).
const PHONE = /(?<![\dA-Za-z])(?<!\d-)(0\d{1,2})([-.\s]?)(\d{3,4})([-.\s]?)(\d{4})(?![\dA-Za-z])/g;
const REP_PHONE = /(?<![\dA-Za-z-])(1[5-9]\d{2})-(\d{4})(?![\dA-Za-z-])/g;
/** 글 속 전화번호 가림 */
export function maskPhones(v: unknown): string {
  return String(v ?? "")
    .replace(PHONE, (_m, a: string, s1: string, _mid: string, s2: string, b: string) => `${a}${s1 || "-"}****${s2 || "-"}${b}`)
    .replace(REP_PHONE, (_m, a: string) => `${a}-****`);
}

// ── 탭 배치(열 번호는 1부터) ─────────────────────────
export type SheetLayout = {
  source: SheetSource;
  gid: number;
  /** 읽는 범위의 첫 행(머리행 검증을 같이 하려고 머리부터 읽는다) */
  firstRow: number;
  headerRow: number;
  dataStart: number;
  lastCol: string;
  /** 상세 팝업(한 행 읽기)의 마지막 열 — 목록은 lastCol 까지만 읽고(속도), 팝업은 이 열까지 전부(2026-10-25) */
  detailLastCol: string;
  statusCol: number;
  statusHeader: string;
  hanjoCol?: number;
  hanjoHeader?: string;
  markerCols: number[];
  seqCol: number;
  dateCol: number;
  yymmCol: number;
  authorCol?: number;
  /** 0 = 그 탭에 처리자 열 없음(copier) */
  handlerCol: number;
  /** 0 = 그 탭에 지역 열 없음(copier) */
  regionCol: number;
  vendorCol: number;
  fieldCol?: number;
  summaryCol: number;
  /** 접수시간 열(CS D·원격 D) */
  timeCol?: number;
  /** 퍼스트순 열(CS F) — CS 잇기 키 */
  firstNoCol?: number;
  /** 제목 열(CS S) — summary 를 "제목 — 내용"으로 */
  titleCol?: number;
  /** lastCol 밖에서 따로 읽는 한 열 범위(copier BD = 56). 읽은 값은 mergeExtraColumns 로 제자리에 넣는다 */
  extraCols?: number[];
  /** 이 칸들로만 머리 검증(copier 전용 — 상태 열 검사 대신). 값은 공백 무시 정확히 같아야 한다 */
  headerChecks?: Array<{ col: number; text: string }>;
};

export const SPREADSHEET_ID = "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g";

export const SHEET_LAYOUTS: Record<SheetSource, SheetLayout> = {
  sales: {
    source: "sales", gid: 174566767, firstRow: 5, headerRow: 5, dataStart: 7, lastCol: "W", detailLastCol: "AG",
    statusCol: 7, statusHeader: "진행중/처리완료/보류/취소", markerCols: [2, 4, 5],
    seqCol: 1, dateCol: 2, yymmCol: 3, authorCol: 5, handlerCol: 6, regionCol: 15, vendorCol: 16, fieldCol: 18, summaryCol: 23,
  },
  mgmt: {
    source: "mgmt", gid: 899183889, firstRow: 5, headerRow: 5, dataStart: 7, lastCol: "Z", detailLastCol: "BE",
    statusCol: 7, statusHeader: "진행중/처리완료/보류/취소", markerCols: [2, 4, 5],
    seqCol: 1, dateCol: 2, yymmCol: 3, authorCol: 5, handlerCol: 6, regionCol: 15, vendorCol: 16, fieldCol: 18, summaryCol: 25,
  },
  remote: {
    source: "remote", gid: 916322987, firstRow: 1, headerRow: 1, dataStart: 5, lastCol: "W", detailLastCol: "AF",
    statusCol: 7, statusHeader: "처리여부", hanjoCol: 12, hanjoHeader: "한조처리", markerCols: [2, 4, 10],
    seqCol: 1, dateCol: 2, yymmCol: 3, authorCol: 10, timeCol: 4, handlerCol: 11, regionCol: 17, vendorCol: 18, summaryCol: 23,
  },
  // 2026-10-28 CSV 머리 실측. 3·4행(머리 사본·최신 미리보기)은 firstRow 5 라 읽지 않는다. 상세는 AV(48)까지(전화 열은 PRIVATE_HEADER 로 빠짐)
  copier: {
    source: "copier", gid: 1181394897, firstRow: 5, headerRow: 5, dataStart: 8, lastCol: "T", detailLastCol: "AV",
    statusCol: 56, statusHeader: "처리완료", markerCols: [2, 5, 6],
    seqCol: 1, dateCol: 2, yymmCol: 3, timeCol: 4, authorCol: 5, firstNoCol: 6, handlerCol: 0, regionCol: 0, vendorCol: 8, fieldCol: 10,
    titleCol: 19, summaryCol: 20, extraCols: [56],
    headerChecks: [{ col: 2, text: "날짜" }, { col: 5, text: "접수자" }, { col: 6, text: "퍼스트순" }, { col: 20, text: "내용" }],
  },
};

export const SOURCE_LABEL: Record<SheetSource, string> = { sales: "해지방어접수(영업팀)", mgmt: "경영지원접수", remote: "원격", copier: "AS접수용(CS)" };

/** 열 번호(1부터) → 글자(1=A, 56=BD) */
export function colLetter(n: number): string {
  let s = "";
  let x = Math.floor(n);
  while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

/**
 * 따로 읽은 한 열 범위(같은 firstRow 부터)를 본 범위 행에 끼워 넣는다 — extras[k].values[i][0] → out[i][col-1].
 * 본 범위가 짧으면(뒤쪽 빈 행 생략) 행을 늘린다. 원본 배열은 바꾸지 않는다.
 */
export function mergeExtraColumns(main: string[][], extras: Array<{ col: number; values: string[][] }>): string[][] {
  const height = Math.max(main.length, ...extras.map((e) => e.values.length));
  const out: string[][] = [];
  for (let i = 0; i < height; i++) {
    const row = [...(main[i] || [])];
    for (const e of extras) {
      const v = String(e.values[i]?.[0] ?? "");
      if (!v) continue;
      while (row.length < e.col - 1) row.push("");
      row[e.col - 1] = v;
    }
    out.push(row);
  }
  return out;
}

/** 접수시간 칸("9:06"·"09:06:00"·"오후 2:05") → "HH:MM", 못 읽으면 "" */
export function sheetTime(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = s.match(/^(오전|오후|AM|PM)?\s*(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?\s*(오전|오후|AM|PM)?$/i);
  if (!m) return "";
  let h = Number(m[2]);
  const min = Number(m[3]);
  const ap = String(m[1] || m[4] || "").toUpperCase();
  if (ap) {
    if (h < 1 || h > 12) return "";
    if ((ap === "오후" || ap === "PM") && h < 12) h += 12;
    if ((ap === "오전" || ap === "AM") && h === 12) h = 0;
  }
  return h <= 23 && min <= 59 ? `${pad2(h)}:${pad2(min)}` : "";
}

/** 시트 한 행(분류 포함 — 완료 행도 연결·자가 치유에 쓰려고 남긴다) */
export type ParsedSheetRow = {
  source: SheetSource;
  kind: SheetKind;
  sheetRow: number;
  seq: string;
  date: string;
  author: string;
  handler: string;
  state: string;
  cls: SheetRowClass;
  vendor: string;
  field: string;
  region: string;
  summary: string;
  /** 접수시간 "HH:MM"(CS D열·원격 D열) — 읽은 값이 있을 때만 */
  time?: string;
  /** 퍼스트순(CS F열) — 있을 때만. 가리지 않는다(고객 번호가 아니라 임대 순번, 잇기 키) */
  firstNo?: string;
  /**
   * 내용 열 원문(줄바꿈 그대로, 최대 LIST_CONTENT_MAX 자) — summary(한 줄 40자)로 다 보이지 않을 때만 있다.
   * 상세 팝업이 엣지 한 행 조회(1~2초)를 기다리지 않고 바로 보여 주려고(2026-10-25 밤). 최근 LIST_CONTENT_DAYS 일 행만 응답에 싣는다(openRowsOf).
   */
  content?: string;
};

/** 목록 응답에 싣는 내용 최대 글자 */
export const LIST_CONTENT_MAX = 600;
/** 이보다 오래된 행은 내용 원문을 싣지 않는다(프런트가 90일 넘은 행은 접어 둠 — 응답 크기, 2026-10-25 실측 644행 중 307행만 최근) */
export const LIST_CONTENT_DAYS = 90;

/** 내용 칸 원문 → 목록에 실을 값. 한 줄 40자(summary)로 다 보이면 "" */
export function listContent(raw: string): string {
  const full = keepText(raw, LIST_CONTENT_MAX);
  return full && (full.length > 40 || full.includes("\n")) ? full : "";
}

/** 프런트로 돌려주는 모양(미처리·보류만) */
export type SheetOpenRow = Omit<ParsedSheetRow, "cls"> & { cls: "open" | "hold"; receptionId?: string };

/** 목록 모드 한 줄(2026-10-28) — 완료·기록 행 포함, 이어진 행(앱 접수가 대신 보임)은 빠짐, content 없음(상세는 row 모드) */
export type SheetListRow = Omit<ParsedSheetRow, "content">;

const cell = (row: string[], col: number | undefined) => (col ? String(row[col - 1] ?? "").trim() : "");
const clip = (v: string, n: number) => {
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** 머리행 검증(상태 G열·원격 L열, copier 는 headerChecks 네 칸만) — 다르면 오류 문구, 같으면 "" */
export function headerError(layout: SheetLayout, header: string[]): string {
  if (layout.headerChecks?.length) {
    for (const h of layout.headerChecks) {
      const got = cell(header, h.col);
      if (squeeze(got) !== squeeze(h.text)) {
        return `시트 머리 변경: ${SOURCE_LABEL[layout.source]} ${colLetter(h.col)}${layout.headerRow} 머리가 "${clip(got, 30)}"(기대 "${h.text}")`;
      }
    }
    return "";
  }
  const statusHead = cell(header, layout.statusCol);
  if (squeeze(statusHead) !== squeeze(layout.statusHeader)) {
    return `시트 머리 변경: ${SOURCE_LABEL[layout.source]} G열 머리가 "${clip(statusHead, 30)}"(기대 "${layout.statusHeader}")`;
  }
  if (layout.hanjoCol && layout.hanjoHeader && !squeeze(cell(header, layout.hanjoCol)).includes(squeeze(layout.hanjoHeader))) {
    return `시트 머리 변경: ${SOURCE_LABEL[layout.source]} L열 머리가 "${clip(cell(header, layout.hanjoCol), 30)}"(기대 "${layout.hanjoHeader}")`;
  }
  return "";
}

/**
 * 읽은 값(범위 첫 행 = layout.firstRow) → 행 목록. 머리가 다르면 error 를 주고 행은 비운다(그 탭만 빠짐 — 조용히 틀리지 않게).
 * 마커 열이 모두 비면 행이 아니다(맨 끝 순번만 있는 빈 줄 제외).
 */
export function parseSheetRows(layout: SheetLayout, values: string[][], now: Date = new Date()): { rows: ParsedSheetRow[]; error: string } {
  const header = values[layout.headerRow - layout.firstRow] || [];
  const headErr = headerError(layout, header);
  if (headErr) return { rows: [], error: headErr };
  const rows: ParsedSheetRow[] = [];
  const dateIn: Array<{ date: string; md: string; yymmEmpty: boolean }> = [];
  const txt = (row: string[], col: number | undefined) => maskPhones(cell(row, col));
  for (let i = layout.dataStart - layout.firstRow; i < values.length; i++) {
    const row = values[i] || [];
    if (!layout.markerCols.some((c) => cell(row, c))) continue;
    const state = cell(row, layout.statusCol);
    const hanjo = layout.hanjoCol ? squeeze(cell(row, layout.hanjoCol)).toUpperCase() : "";
    const copier = layout.source === "copier";
    const kind: SheetKind = layout.source === "sales" ? "영업팀" : layout.source === "mgmt" ? "경영지원" : copier ? "복합기 AS" : hanjo.includes("IT") ? "IT" : "원격이관";
    const title = copier ? txt(row, layout.titleCol) : "";
    const body = txt(row, layout.summaryCol);
    rows.push({
      source: layout.source,
      kind,
      sheetRow: layout.firstRow + i,
      seq: cell(row, layout.seqCol),
      date: sheetDate(cell(row, layout.yymmCol), cell(row, layout.dateCol)),
      author: txt(row, layout.authorCol),
      handler: txt(row, layout.handlerCol),
      state: maskPhones(state),
      cls: copier ? "record" : sheetStateClass(state),
      vendor: clip(txt(row, layout.vendorCol), 40),
      field: clip(txt(row, layout.fieldCol), 30),
      region: txt(row, layout.regionCol),
      summary: clip(title && body ? `${title} — ${body}` : title || body, 40),
    });
    const last = rows[rows.length - 1];
    const time = layout.timeCol ? sheetTime(cell(row, layout.timeCol)) : "";
    if (time) last.time = time;
    const firstNo = layout.firstNoCol ? cell(row, layout.firstNoCol) : "";
    if (firstNo) last.firstNo = firstNo;
    dateIn.push({ date: rows[rows.length - 1].date, md: cell(row, layout.dateCol), yymmEmpty: !squeeze(cell(row, layout.yymmCol)) });
    const content = listContent(maskPhones(row[layout.summaryCol - 1] ?? ""));
    if (content) rows[rows.length - 1].content = content;
  }
  inferMissingYears(dateIn, now).forEach((d, i) => { rows[i].date = d; });
  return { rows, error: "" };
}

// ── DB 행 잇기 ────────────────────────────────────
export type DeptJob = { category: string; sheet_row: number | null; _dupKey: string | null; author: string | null };
export type RemoteReception = { id: string; type: string; vendor: string; receipt_date: string; sheet_row: number | null };

const JOB_SOURCE: Record<string, SheetSource> = { reception_sales: "sales", reception_mgmt: "mgmt" };
/** dupKey `dept:<접수id>:append` → 접수 id */
export const receptionIdOfDupKey = (k: unknown) => String(k ?? "").match(/^dept:(.+):append$/)?.[1] || "";

/** 비교용 상호(공백·㈜·(주)·주식회사 제거) */
export const normVendor = (v: unknown) =>
  String(v ?? "").replace(/\s+/g, "").replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, "").toLowerCase();

/**
 * 영업·경영: 잡(synced)의 sheet_row 로 시트 행 → 접수 id. 그 행의 접수자(E)가 잡 author 와 같을 때만 인정(행 밀림 방지).
 * 원격: service_receptions.sheet_row, 이번 달 접수이면서 R열 상호가 vendor 앞 6자를 포함할 때만.
 * 돌려주는 key 는 `${source}:${sheetRow}`.
 */
export function linkRows(rows: ParsedSheetRow[], jobs: DeptJob[], remotes: RemoteReception[], thisMonth: string): Map<string, string> {
  const out = new Map<string, string>();
  const byKey = new Map(rows.map((r) => [`${r.source}:${r.sheetRow}`, r]));
  for (const j of jobs) {
    const source = JOB_SOURCE[String(j.category || "")];
    const id = receptionIdOfDupKey(j._dupKey);
    const row = source && j.sheet_row ? byKey.get(`${source}:${j.sheet_row}`) : undefined;
    if (!row || !id) continue;
    const a = squeeze(row.author);
    if (!a || a !== squeeze(j.author)) continue;
    out.set(`${source}:${row.sheetRow}`, id);
  }
  for (const r of remotes) {
    if (!r.sheet_row || !String(r.receipt_date || "").startsWith(thisMonth)) continue;
    const row = byKey.get(`remote:${r.sheet_row}`);
    if (!row) continue;
    const want = normVendor(r.vendor).slice(0, 6);
    if (!want || !normVendor(row.vendor).includes(want)) continue;
    out.set(`remote:${row.sheetRow}`, r.id);
  }
  return out;
}

// ── CS(AS접수용) 잇기(2026-10-28) ────────────────────
/** 이번 달 앱 CS 접수(service_receptions type=복합기 AS) — 읽기만 */
export type CopierReception = {
  id: string; receipt_date: string; first_no: string | null; lease_no: string | null; author: string | null; vendor: string | null;
};
/** 이은 규칙(보관 표 link_rule): job=영업·경영 잡 sheet_row · sheet_row=원격 · copier1~3 = CS 1~3단계 */
export type LinkRule = "job" | "sheet_row" | "copier1" | "copier2" | "copier3";
export type CopierLink = { id: string; rule: "copier1" | "copier2" | "copier3" };

/** 퍼스트순 비교값(공백·쉼표 제거) */
const normNo = (v: unknown) => String(v ?? "").replace(/[\s,]/g, "");

/**
 * CS 시트 행 ↔ 앱 CS 접수 잇기. 1:1 소비(한 시트 행·한 접수는 한 번만), 시트 위 → 아래 순서.
 *  ① (접수일, 퍼스트순 = first_no 또는 lease_no, 접수자) → copier1
 *  ② (접수일, 퍼스트순) → copier2
 *  ③ 퍼스트순이 빈 시트 행(신규 거래처)만: (접수일, 접수자) 같고 상호(normVendor)가 서로의 앞 6자를 포함 → copier3
 * 접수일 없는 시트 행은 잇지 않는다. 돌려주는 key 는 `copier:${sheetRow}`.
 */
export function linkCopierRows(rows: ParsedSheetRow[], db: CopierReception[]): Map<string, CopierLink> {
  const out = new Map<string, CopierLink>();
  const sheet = rows.filter((r) => r.source === "copier" && r.date);
  const used = new Set<string>();
  const dbDate = (d: CopierReception) => String(d.receipt_date || "").slice(0, 10);
  const nosOf = (d: CopierReception) => Array.from(new Set([normNo(d.first_no), normNo(d.lease_no)].filter(Boolean)));
  const pass = (rule: CopierLink["rule"], sheetKey: (r: ParsedSheetRow) => string, dbKeys: (d: CopierReception) => string[]) => {
    const bucket = new Map<string, CopierReception[]>();
    for (const d of db) {
      if (used.has(d.id)) continue;
      for (const k of dbKeys(d)) {
        if (!k) continue;
        const list = bucket.get(k) || [];
        list.push(d);
        bucket.set(k, list);
      }
    }
    for (const r of sheet) {
      const key = `copier:${r.sheetRow}`;
      if (out.has(key)) continue;
      const k = sheetKey(r);
      if (!k) continue;
      const hit = (bucket.get(k) || []).find((d) => !used.has(d.id));
      if (!hit) continue;
      used.add(hit.id);
      out.set(key, { id: hit.id, rule });
    }
  };
  pass("copier1",
    (r) => (normNo(r.firstNo) && squeeze(r.author) ? `${r.date}|${normNo(r.firstNo)}|${squeeze(r.author)}` : ""),
    (d) => (squeeze(d.author) ? nosOf(d).map((n) => `${dbDate(d)}|${n}|${squeeze(d.author)}`) : []));
  pass("copier2",
    (r) => (normNo(r.firstNo) ? `${r.date}|${normNo(r.firstNo)}` : ""),
    (d) => nosOf(d).map((n) => `${dbDate(d)}|${n}`));
  // ③ 상호는 정확히 같은 키가 아니라 "한쪽 상호(normVendor)가 다른 쪽 앞 6자를 포함"(linkRows 원격 규칙과 같은 꼴) — 시트 상호에 지점명이 붙는 경우
  for (const r of sheet) {
    const key = `copier:${r.sheetRow}`;
    if (out.has(key) || normNo(r.firstNo) || !squeeze(r.author)) continue;
    const sv = normVendor(r.vendor.replace(/…/g, ""));
    if (!sv) continue;
    const hit = db.find((d) => {
      if (used.has(d.id) || dbDate(d) !== r.date || squeeze(d.author) !== squeeze(r.author)) return false;
      const dv = normVendor(d.vendor);
      return Boolean(dv) && (sv.includes(dv.slice(0, 6)) || dv.includes(sv.slice(0, 6)));
    });
    if (!hit) continue;
    used.add(hit.id);
    out.set(key, { id: hit.id, rule: "copier3" });
  }
  return out;
}

/** 시트 동기화가 끝난(synced) 부서 접수 id — 이 접수는 시트 행이 진실이라 DB 쪽에서 뺀다(R5: remote_meta.sheet_state 가 queued 로 남는 버그와 무관하게) */
export function syncedReceptionIds(jobs: DeptJob[]): string[] {
  return Array.from(new Set(jobs.map((j) => receptionIdOfDupKey(j._dupKey)).filter(Boolean)));
}

/** 자가 치유 후보: 이어진 시트 행이 '완료'인 접수 → 완료/취소. DB 상태 확인·조건부 PATCH 는 index.ts 가 한다. */
export function healCandidates(rows: ParsedSheetRow[], links: Map<string, string>): Array<{ id: string; to: "완료" | "취소" }> {
  const out: Array<{ id: string; to: "완료" | "취소" }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.cls !== "done") continue;
    const id = links.get(`${r.source}:${r.sheetRow}`);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, to: isCancelState(r.state) ? "취소" : "완료" });
  }
  return out;
}

/**
 * 미처리·보류 행만 + 이어진 접수 id. contentSince(YYYY-MM-DD)를 주면 그보다 오래된 행(날짜 있는 것)은 내용 원문(content)을 뺀다 —
 * 날짜를 모르는 행은 프런트가 최근 칸에 넣으므로 남긴다. 안 주면 그대로.
 */
export function openRowsOf(rows: ParsedSheetRow[], links: Map<string, string>, contentSince = ""): SheetOpenRow[] {
  const out: SheetOpenRow[] = [];
  for (const r of rows) {
    // CS(copier) 시트 행은 홈 미처리에 넣지 않는다(CS 접수 = 일정 기준 유지, 2026-10-28 Q4)
    if (r.source === "copier" || r.cls === "done" || r.cls === "record") continue;
    const id = links.get(`${r.source}:${r.sheetRow}`);
    const { content, ...rest } = r;
    const keep = content && !(contentSince && r.date && r.date < contentSince);
    out.push({ ...rest, cls: r.cls, ...(keep ? { content } : {}), ...(id ? { receptionId: id } : {}) });
  }
  return out;
}

/** KST 오늘에서 days 일 전(YYYY-MM-DD) */
export function kstDaysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10);
}

/** KST 이번 달(YYYY-MM) */
export function kstMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}

// ── 상세 팝업: 한 행의 열 전부(2026-10-25 사용자 "시트면 시트에 있는 내용이 나와야지 — 잘린 듯") ──
// 목록 응답의 summary 는 40자(clip)라 팝업이 잘려 보였다. 목록 응답은 그대로 두고(60초마다 홈이 읽는 묶음 — 열 전부를 실으면
// 수백 KB 늘어난다), 팝업을 열 때 그 한 행만 머리행과 같이 읽어 돌려준다.

/** 칸 하나 최대 글자(접수내용·처리내용 포함) */
export const DETAIL_TEXT_MAX = 4000;
/** 돌려주지 않는 열(고객 전화번호 — 이 엣지는 공개 호출) */
const PRIVATE_HEADER = /전화|연락처|휴대|핸드폰|폰번호|팩스|phone|tel/i; // 키맨 열은 이름이 쓸모 있어 남기고 번호만 maskPhones 로 가린다(2026-10-27)

export type SheetCell = { label: string; value: string };
export type SheetRowDetail = {
  source: SheetSource;
  sheetRow: number;
  seq: string;
  state: string;
  cls: SheetRowClass;
  /** 내용 열을 뺀 나머지 열(시트 순서, 빈 칸·전화번호 열·머리 없는 열 생략) */
  cells: SheetCell[];
  /** 내용 열 머리(접수내용·증상 등)와 값 — 줄바꿈 그대로, 최대 DETAIL_TEXT_MAX 자 */
  contentLabel: string;
  content: string;
};

const headLabel = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
/** 줄바꿈은 살리고 앞뒤 공백만 — 넘치면 자르고 … */
export const keepText = (v: unknown, n = DETAIL_TEXT_MAX) => {
  const s = String(v ?? "").replace(/\r\n?/g, "\n").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** 머리행 + 한 행 → 상세(순수). 상태 열 머리(영업·경영 "진행중/처리완료/보류/취소")는 "상태"로 줄인다. 같은 머리·같은 값이 두 번(경영 자산번호 T·BB)이면 한 번만 */
export function sheetRowDetail(layout: SheetLayout, header: string[], row: string[], sheetRow: number): SheetRowDetail {
  const cells: SheetCell[] = [];
  const seen = new Set<string>();
  const width = Math.max(header.length, row.length);
  for (let c = 1; c <= width; c++) {
    if (c === layout.summaryCol) continue;
    let label = headLabel(header[c - 1]);
    if (!label || PRIVATE_HEADER.test(label.replace(/\s/g, ""))) continue;
    if (c === layout.statusCol && (layout.source === "sales" || layout.source === "mgmt")) label = "상태";
    const value = maskPhones(keepText(row[c - 1]));
    if (!value) continue;
    const k = `${label}|${value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push({ label, value });
  }
  const state = cell(row, layout.statusCol);
  return {
    source: layout.source, sheetRow, seq: cell(row, layout.seqCol), state, cls: layout.source === "copier" ? "record" : sheetStateClass(state), cells,
    contentLabel: headLabel(header[layout.summaryCol - 1]) || "내용", content: maskPhones(keepText(row[layout.summaryCol - 1])),
  };
}

// ── 목록 모드(2026-10-28 접수리스트에 시트 줄) ──────────────
// 설계 docs/tasks/reception-list-sheet-rows-2026-10-28.md 4절 1단계. 시트 행 중 앱 접수와 이어지지 않은 것만, 2026-10-01부터.

/** 목록·보관이 다루는 첫 날(이전 시트 행은 다루지 않음) */
export const SHEET_LIST_START = "2026-10-01";
/** 목록 요청 범위 최대 일수(공개 호출) */
export const LIST_MAX_DAYS = 92;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ymdShift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * 목록 요청 범위 검사·자르기. 형식이 틀리거나(YYYY-MM-DD 아님·없는 날짜) from > to 면 null(400).
 * to 를 두고 from 을 당겨 최대 maxDays 일(양 끝 포함)로 자른다 — clipped=true.
 */
export function clampListRange(fromRaw: unknown, toRaw: unknown, maxDays = LIST_MAX_DAYS): { from: string; to: string; clipped: boolean } | null {
  const ok = (v: string) => {
    const m = v.match(YMD_RE);
    return Boolean(m && validYmd(Number(m[1]), Number(m[2]), Number(m[3])));
  };
  const from = String(fromRaw ?? "").trim();
  const to = String(toRaw ?? "").trim();
  if (!ok(from) || !ok(to) || from > to) return null;
  const minFrom = ymdShift(to, -(Math.max(1, Math.floor(maxDays)) - 1));
  return from < minFrom ? { from: minFrom, to, clipped: true } : { from, to, clipped: false };
}

/**
 * 목록 행 고르기(순수). links 에 있는 행(앱 접수와 이어짐 — 앱 줄이 대신 보임)은 뺀다. 날짜를 못 읽은 행(연도 추정 실패·미래 날짜 포함)은
 * 개수(noDate)만 센다. 그 밖엔 start ≤ date 이고 from ≤ date ≤ to 인 행. 완료·보류·기록 모두 포함, content 는 싣지 않는다. 시트 순서 그대로.
 */
export function listRowsOf(
  rows: ParsedSheetRow[], links: Map<string, unknown>, from: string, to: string, start = SHEET_LIST_START,
): { rows: SheetListRow[]; noDate: number } {
  const out: SheetListRow[] = [];
  let noDate = 0;
  for (const r of rows) {
    if (links.has(`${r.source}:${r.sheetRow}`)) continue;
    if (!r.date) { noDate += 1; continue; }
    if (r.date < start || r.date < from || r.date > to) continue;
    const item: ParsedSheetRow = { ...r };
    delete item.content;
    out.push(item);
  }
  return { rows: out, noDate };
}

/** 영업·경영·원격 links(linkRows) + CS links(linkCopierRows) → 하나의 key→id 와 key→규칙 */
export function combineLinks(base: Map<string, string>, copier: Map<string, CopierLink>): { links: Map<string, string>; rules: Map<string, LinkRule> } {
  const links = new Map<string, string>();
  const rules = new Map<string, LinkRule>();
  for (const [k, id] of base) {
    links.set(k, id);
    rules.set(k, k.startsWith("remote:") ? "sheet_row" : "job");
  }
  for (const [k, v] of copier) {
    links.set(k, v.id);
    rules.set(k, v.rule);
  }
  return { links, rules };
}

// ── 보관 표 reception_sheet_rows 적재(2단계, { snapshot: true }) ──────
// 규칙은 supabase/reception-sheet-rows-20261028.sql 머리 주석 "엣지 upsert 규칙".

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
/** md5 16진 32자(UTF-8) — Postgres md5() 와 같은 값. WebCrypto 에 MD5 가 없어 직접 계산(순수) */
export function md5Hex(text: string): string {
  const msg = new TextEncoder().encode(text);
  const len = msg.length;
  const total = (((len + 8) >>> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (len * 8) >>> 0, true);
  dv.setUint32(total - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let off = 0; off < total; off += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + dv.getUint32(off + g * 4, true)) | 0;
      A = D; D = C; C = B;
      const sh = MD5_S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << sh) | (F >>> (32 - sh)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v >>> 0, true));
  return Array.from(new Uint8Array(out.buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 상호 앞 6자(normVendor, 말줄임표 제거) — 보관 표 fingerprint·빈 순번 해시 재료 */
export const vendorHead6 = (v: unknown) => normVendor(String(v ?? "").replace(/…/g, "")).slice(0, 6);

/** fingerprint = md5(접수일|접수자(공백 제거)|상호 앞 6자) — 같은 순번에 다른 접수가 오면(재번호·행 밀림) 다르게 나온다 */
export function snapshotFingerprint(row: { date: string; author: string; vendor: string }): string {
  return md5Hex(`${row.date}|${squeeze(row.author)}|${vendorHead6(row.vendor)}`);
}

/**
 * 보관 표 seq = 시트 A열 순번(쉼표·공백 제거). 비었거나 40자 넘거나 '#'(수식 오류 #REF! 등)으로 시작하면
 * 'h:' + md5(source|접수일|접수자(공백 제거)|상호 앞 6자) 앞 12자. 프런트 시트 줄 id(sheet:source:month:seq)도 이 값을 쓸 것.
 */
export function snapshotSeq(row: { source: SheetSource; seq: string; date: string; author: string; vendor: string }): string {
  const s = String(row.seq ?? "").replace(/[,\s]/g, "");
  if (s && s.length <= 40 && !s.startsWith("#")) return s;
  return `h:${md5Hex(`${row.source}|${row.date}|${squeeze(row.author)}|${vendorHead6(row.vendor)}`).slice(0, 12)}`;
}

/** raw jsonb 최대 바이트(표 제약 32,000 — 여유 2,000) */
export const RAW_MAX_BYTES = 30_000;
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/**
 * 행 원문 {머리 이름: 값}(순수). 머리 없는 열·전화 열(PRIVATE_HEADER)·빈 칸은 뺀다. 값은 maskPhones·칸당 2,000자.
 * 같은 머리가 또 나오면 "머리 (열글자)". JSON 이 RAW_MAX_BYTES 를 넘으면 가장 긴 값부터 반으로 줄인다.
 */
export function rowRawOf(header: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const width = Math.max(header.length, row.length);
  for (let c = 1; c <= width; c++) {
    const label0 = headLabel(header[c - 1]);
    if (!label0 || PRIVATE_HEADER.test(label0.replace(/\s/g, ""))) continue;
    const value = maskPhones(keepText(row[c - 1], 2000));
    if (!value) continue;
    const label = label0 in out ? `${label0} (${colLetter(c)})` : label0;
    out[label] = value;
  }
  for (let guard = 0; guard < 200 && utf8Len(JSON.stringify(out)) > RAW_MAX_BYTES; guard++) {
    const keys = Object.keys(out);
    if (!keys.length) break;
    const longest = keys.reduce((a, b) => (out[b].length > out[a].length ? b : a));
    if (out[longest].length <= 20) { delete out[keys[keys.length - 1]]; continue; }
    out[longest] = `${out[longest].slice(0, Math.floor(out[longest].length / 2))}…`;
  }
  return out;
}

/** 보관 표 한 행(POST 본문) — 모든 객체가 같은 키를 가진다(PostgREST 일괄 upsert). first_seen_at 은 싣지 않는다 */
export type SnapshotRecord = {
  source: SheetSource;
  month: string;
  seq: string;
  sheet_row: number;
  kind: SheetKind;
  receipt_date: string;
  receipt_time: string | null;
  author: string;
  handler: string;
  state: string;
  cls: SheetRowClass;
  vendor: string;
  first_no: string | null;
  field: string;
  region: string;
  summary: string;
  content: string | null;
  raw: Record<string, string>;
  fingerprint: string;
  reception_id: string | null;
  link_rule: LinkRule | null;
  last_seen_at: string;
  gone_at: null;
};

/**
 * 한 탭의 파싱된 행 → 보관 표 행(순수). 날짜 없는 행은 noDate 로 세고 빼며, start 이전 행은 뺀다.
 * values = 그 탭에서 읽은 값(firstRow 부터, copier 는 mergeExtraColumns 뒤) — raw·content 원문용.
 * 같은 (month, seq) 가 두 번이면 처음 것만 두고 duplicates 에 적는다(한 요청 안 중복 키 = upsert 오류).
 */
export function buildSnapshotRecords(
  layout: SheetLayout, values: string[][], rows: ParsedSheetRow[], links: Map<string, string>, rules: Map<string, LinkRule>,
  seenAt: string, start = SHEET_LIST_START,
): { records: SnapshotRecord[]; duplicates: string[]; noDate: number } {
  const header = values[layout.headerRow - layout.firstRow] || [];
  const records: SnapshotRecord[] = [];
  const duplicates: string[] = [];
  const keys = new Set<string>();
  let noDate = 0;
  for (const r of rows) {
    if (r.source !== layout.source) continue;
    if (!r.date) { noDate += 1; continue; }
    if (r.date < start) continue;
    const month = r.date.slice(0, 7);
    const seq = snapshotSeq(r);
    const k = `${month}|${seq}`;
    if (keys.has(k)) { duplicates.push(`${month} 순번 ${seq}(${r.sheetRow}행)`); continue; }
    keys.add(k);
    const rowVals = values[r.sheetRow - layout.firstRow] || [];
    const key = `${r.source}:${r.sheetRow}`;
    const content = maskPhones(keepText(rowVals[layout.summaryCol - 1], LIST_CONTENT_MAX));
    records.push({
      source: r.source, month, seq, sheet_row: r.sheetRow, kind: r.kind, receipt_date: r.date, receipt_time: r.time || null,
      author: r.author, handler: r.handler, state: r.state, cls: r.cls, vendor: r.vendor, first_no: r.firstNo || null,
      field: r.field, region: r.region, summary: r.summary.slice(0, 120), content: content || null,
      raw: rowRawOf(header, rowVals), fingerprint: snapshotFingerprint(r),
      reception_id: links.get(key) || null, link_rule: links.has(key) ? rules.get(key) || null : null,
      last_seen_at: seenAt, gone_at: null,
    });
  }
  return { records, duplicates, noDate };
}

/** 보관 표에 이미 있는 행(같은 source, 이번 읽기에 나온 달만 조회) */
export type StoredSheetKey = { month: string; seq: string; fingerprint: string | null; gone_at: string | null };

/**
 * 적재 계획(순수, 한 탭 = 한 source).
 *  - upsert: 저장 행이 없거나 fingerprint 가 비었거나 같은 것
 *  - conflicts: 저장 fingerprint 와 다른 것(덮지 않음 — 재번호·행 밀림 의심, errors 로)
 *  - gone: 이번 읽기에 1행 이상 나온 달에서, 저장돼 있고 gone_at 이 비었는데 이번에 안 보인 seq.
 *    이번 읽기에 한 행도 없는 달(탭 비워짐 = 달 바뀜)은 손대지 않는다.
 *    한 달에 사라진 행이 max(20, 그 달 저장 행의 절반)을 넘으면 찍지 않고 suspicious 로 돌린다(읽기 이상·대량 재번호 대비).
 */
export function planSnapshot(records: SnapshotRecord[], stored: StoredSheetKey[]): {
  upsert: SnapshotRecord[]; conflicts: SnapshotRecord[]; gone: Array<{ month: string; seqs: string[] }>; suspicious: Array<{ month: string; count: number; stored: number }>;
} {
  const byKey = new Map(stored.map((s) => [`${s.month}|${s.seq}`, s]));
  const upsert: SnapshotRecord[] = [];
  const conflicts: SnapshotRecord[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const k = `${r.month}|${r.seq}`;
    seen.add(k);
    const s = byKey.get(k);
    if (s && s.fingerprint && s.fingerprint !== r.fingerprint) conflicts.push(r);
    else upsert.push(r);
  }
  const months = Array.from(new Set(records.map((r) => r.month))).sort();
  const gone: Array<{ month: string; seqs: string[] }> = [];
  const suspicious: Array<{ month: string; count: number; stored: number }> = [];
  for (const month of months) {
    const inMonth = stored.filter((s) => s.month === month);
    const seqs = inMonth.filter((s) => !s.gone_at && !seen.has(`${month}|${s.seq}`)).map((s) => s.seq);
    if (!seqs.length) continue;
    if (seqs.length > Math.max(20, Math.floor(inMonth.length / 2))) suspicious.push({ month, count: seqs.length, stored: inMonth.length });
    else gone.push({ month, seqs });
  }
  return { upsert, conflicts, gone, suspicious };
}
