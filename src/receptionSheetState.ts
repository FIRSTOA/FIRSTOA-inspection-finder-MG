/**
 * 접수 시트 상태 규칙(프런트 사본) — 서비스접수 미처리 = 시트 상태 기준(C3, 2026-10-22).
 * 원본: supabase/functions/reception-sheet-open/state.ts. 두 사본은 tests/receptionSheetState.test.ts 가 같은 표본으로 대조한다.
 * 한쪽을 고치면 다른 쪽도 같이 고칠 것.
 *
 * 2026-10-28(접수리스트에 시트 줄, docs/tasks/reception-list-sheet-rows-2026-10-28.md 4절 1단계): 엣지와 같은 순수 함수를
 * 여기에도 둔다 — 탭 배치(copier 추가·remote 접수자/접수시간), parseSheetRows(copier 분기 = cls "record"), linkRows,
 * linkCopierRows(CS 잇기), listRowsOf(목록 모드), openRowsOf(copier 제외). 프런트 화면은 엣지 응답을 쓰고,
 * 이 사본은 규칙 대조·테스트용이다(tests/receptionListSheet.test.ts).
 */
export type SheetClass = "done" | "hold" | "open";
/** 시트 행 분류 — copier(AS접수용) 행은 상태 칸이 없어 "record"(기록, 미처리 밖) */
export type SheetRowClass = SheetClass | "record";
export type SheetSource = "sales" | "mgmt" | "remote" | "copier";
export type SheetKind = "영업팀" | "경영지원" | "원격이관" | "IT" | "복합기 AS";

const squeeze = (v: unknown) => String(v ?? "").replace(/\s+/g, "");

/** 상태 칸 → 완료/보류/미처리. 완료 = 완료·취소·중복·이관·해결·재접수 포함 또는 AS접수·A/S접수, 보류 = 정확히 "보류", 그 밖(공란 포함) = 미처리 */
export function sheetStateClass(value: unknown): SheetClass {
  const s = squeeze(value);
  if (!s) return "open";
  if (/완료|취소|중복|이관|해결|재접수/.test(s)) return "done";
  const upper = s.toUpperCase();
  if (upper === "AS접수" || upper === "A/S접수") return "done";
  if (s === "보류") return "hold";
  return "open";
}

export const isCancelState = (value: unknown) => /취소/.test(squeeze(value));

const pad2 = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad2(m)}-${pad2(d)}` : "";
};

/** C열 년월(yyMM) + B열 "M월 d일" → YYYY-MM-DD. B에 연도가 붙어 있으면 그대로, C가 이상하면 "" */
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
  let y = year;
  if (m === 12 && month === 1) y -= 1;
  else if (m === 1 && month === 12) y += 1;
  return validYmd(y, m, d);
}

/** 화면 표기: 공란은 "상태 비어 있음" */
export const sheetStateLabel = (state: unknown) => (squeeze(state) ? String(state).trim() : "상태 비어 있음");

/** 접수시간 칸("9:06"·"09:06:00"·"오후 2:05") → "HH:MM", 못 읽으면 "" (엣지 sheetTime 과 같음) */
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

/** C열 년월이 빈 행의 연도 추정(엣지 inferMissingYears 와 같음 — 아래(최신) → 위로, 오늘(KST) 뒤 날짜는 "") */
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

// ── 전화번호 가림(엣지 maskPhones 와 같음) ──
const PHONE = /(?<![\dA-Za-z])(?<!\d-)(0\d{1,2})([-.\s]?)(\d{3,4})([-.\s]?)(\d{4})(?![\dA-Za-z])/g;
const REP_PHONE = /(?<![\dA-Za-z-])(1[5-9]\d{2})-(\d{4})(?![\dA-Za-z-])/g;
export function maskPhones(v: unknown): string {
  return String(v ?? "")
    .replace(PHONE, (_m, a: string, s1: string, _mid: string, s2: string, b: string) => `${a}${s1 || "-"}****${s2 || "-"}${b}`)
    .replace(REP_PHONE, (_m, a: string) => `${a}-****`);
}

// ── 탭 배치(열 번호는 1부터) ─────────────────────────
export type SheetLayout = {
  source: SheetSource;
  gid: number;
  firstRow: number;
  headerRow: number;
  dataStart: number;
  lastCol: string;
  detailLastCol: string;
  /** copier: A~T 와 따로 읽는 열(BD = 56, 상태 메모) */
  extraCols?: number[];
  statusCol: number;
  statusHeader: string;
  hanjoCol?: number;
  hanjoHeader?: string;
  /** copier 전용 머리 검사 [열, 기대 머리] — 있으면 상태 열 검사 대신 이것만 본다 */
  headerChecks?: Array<{ col: number; text: string }>;
  markerCols: number[];
  seqCol: number;
  dateCol: number;
  yymmCol: number;
  timeCol?: number;
  authorCol?: number;
  handlerCol?: number;
  regionCol?: number;
  vendorCol: number;
  firstNoCol?: number;
  fieldCol?: number;
  titleCol?: number;
  summaryCol: number;
};

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
    seqCol: 1, dateCol: 2, yymmCol: 3, timeCol: 4, authorCol: 10, handlerCol: 11, regionCol: 17, vendorCol: 18, summaryCol: 23,
  },
  // AS접수용(CS) — 2026-10-28 CSV 머리 실측. 3행(머리 사본)·4행(최신 미리보기)은 firstRow 5 라 읽지 않는다.
  copier: {
    source: "copier", gid: 1181394897, firstRow: 5, headerRow: 5, dataStart: 8, lastCol: "T", detailLastCol: "AV",
    statusCol: 56, statusHeader: "처리완료", markerCols: [2, 5, 6],
    seqCol: 1, dateCol: 2, yymmCol: 3, timeCol: 4, authorCol: 5, firstNoCol: 6, vendorCol: 8, fieldCol: 10,
    titleCol: 19, summaryCol: 20, extraCols: [56],
    headerChecks: [{ col: 2, text: "날짜" }, { col: 5, text: "접수자" }, { col: 6, text: "퍼스트순" }, { col: 20, text: "내용" }],
  },
};

export const SOURCE_LABEL: Record<SheetSource, string> = { sales: "해지방어접수(영업팀)", mgmt: "경영지원접수", remote: "원격", copier: "AS접수용(CS)" };

/** 접수리스트 시트 줄 시작일(이보다 앞 행은 목록에 넣지 않는다) */
export const SHEET_LIST_START = "2026-10-01";

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
  /** 접수시간 "HH:MM"(원격·CS D열) */
  time?: string;
  /** 퍼스트순(CS F열) */
  firstNo?: string;
  content?: string;
};

export const LIST_CONTENT_MAX = 600;
export const DETAIL_TEXT_MAX = 4000;
export const keepText = (v: unknown, n = DETAIL_TEXT_MAX) => {
  const s = String(v ?? "").replace(/\r\n?/g, "\n").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
export function listContent(raw: string): string {
  const full = keepText(raw, LIST_CONTENT_MAX);
  return full && (full.length > 40 || full.includes("\n")) ? full : "";
}

/** 홈 미처리로 돌려주는 모양(미처리·보류만, copier 없음) */
export type SheetOpenStateRow = Omit<ParsedSheetRow, "cls"> & { cls: "open" | "hold"; receptionId?: string };

/** 접수리스트 목록 모드로 돌려주는 모양(content 없음, 이어진 행 없음) — 엣지 SheetListRow 와 같음 */
export type SheetListStateRow = Omit<ParsedSheetRow, "content">;

const cell = (row: string[], col: number | undefined) => (col ? String(row[col - 1] ?? "").trim() : "");
const clip = (v: string, n: number) => {
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
/** 열 번호 → 글자(1 → A, 56 → BD) */
export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** 머리행 검증 — 다르면 오류 문구, 같으면 "". copier 는 headerChecks 네 칸(B·E·F·T)만 본다 */
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

const kindOf = (layout: SheetLayout, row: string[]): SheetKind => {
  if (layout.source === "sales") return "영업팀";
  if (layout.source === "mgmt") return "경영지원";
  if (layout.source === "copier") return "복합기 AS";
  const hanjo = layout.hanjoCol ? squeeze(cell(row, layout.hanjoCol)).toUpperCase() : "";
  return hanjo.includes("IT") ? "IT" : "원격이관";
};

/**
 * 읽은 값(범위 첫 행 = layout.firstRow, copier 는 BD 열이 56번째 칸에 붙은 행) → 행 목록.
 * 머리가 다르면 error 를 주고 행은 비운다(그 탭만 빠짐). 마커 열이 모두 비면 행이 아니다.
 */
export function parseSheetRows(layout: SheetLayout, values: string[][], now: Date = new Date()): { rows: ParsedSheetRow[]; error: string } {
  const header = values[layout.headerRow - layout.firstRow] || [];
  const headErr = headerError(layout, header);
  if (headErr) return { rows: [], error: headErr };
  const rows: ParsedSheetRow[] = [];
  const dateIn: Array<{ date: string; md: string; yymmEmpty: boolean }> = [];
  const txt = (row: string[], col: number | undefined) => maskPhones(cell(row, col));
  const copier = layout.source === "copier";
  for (let i = layout.dataStart - layout.firstRow; i < values.length; i++) {
    const row = values[i] || [];
    if (!layout.markerCols.some((c) => cell(row, c))) continue;
    const state = cell(row, layout.statusCol);
    const title = txt(row, layout.titleCol);
    const body = txt(row, layout.summaryCol);
    const parsed: ParsedSheetRow = {
      source: layout.source,
      kind: kindOf(layout, row),
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
    };
    const time = layout.timeCol ? sheetTime(cell(row, layout.timeCol)) : "";
    if (time) parsed.time = time;
    const firstNo = layout.firstNoCol ? cell(row, layout.firstNoCol) : "";
    if (firstNo) parsed.firstNo = firstNo;
    rows.push(parsed);
    dateIn.push({ date: parsed.date, md: cell(row, layout.dateCol), yymmEmpty: !squeeze(cell(row, layout.yymmCol)) });
    const content = listContent(maskPhones(row[layout.summaryCol - 1] ?? ""));
    if (content) parsed.content = content;
  }
  inferMissingYears(dateIn, now).forEach((d, i) => { rows[i].date = d; });
  return { rows, error: "" };
}

// ── DB 행 잇기 ────────────────────────────────────
export type DeptJob = { category: string; sheet_row: number | null; _dupKey: string | null; author: string | null };
export type RemoteReception = { id: string; type: string; vendor: string; receipt_date: string; sheet_row: number | null };
/** 이번 달 CS 앱 접수(type=복합기 AS, deleted=false) — 엣지가 select id,receipt_date,first_no,lease_no,author,vendor */
export type CopierReception = {
  id: string; receipt_date: string; first_no: string | null; lease_no: string | null; author: string | null; vendor: string | null;
};
/** 이은 규칙(보관 표 link_rule): job=영업·경영 잡 sheet_row · sheet_row=원격 · copier1~3 = CS 1~3단계 */
export type LinkRule = "job" | "sheet_row" | "copier1" | "copier2" | "copier3";
export type CopierLink = { id: string; rule: "copier1" | "copier2" | "copier3" };

/** 퍼스트순 비교값(공백·쉼표 제거) */
const normNo = (v: unknown) => String(v ?? "").replace(/[\s,]/g, "");

const JOB_SOURCE: Record<string, SheetSource> = { reception_sales: "sales", reception_mgmt: "mgmt" };
export const receptionIdOfDupKey = (k: unknown) => String(k ?? "").match(/^dept:(.+):append$/)?.[1] || "";
export const normVendor = (v: unknown) =>
  String(v ?? "").replace(/\s+/g, "").replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, "").toLowerCase();

/** 영업·경영: 잡 sheet_row + 접수자 일치. 원격: 이번 달 + 상호 앞 6자. key = `${source}:${sheetRow}` (copier 는 linkCopierRows) */
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

/**
 * CS 잇기(설계 4절): copier 시트 행 ↔ 이번 달 CS 앱 접수. 1:1 소비(한 시트 행·한 접수는 한 번만), 시트 위 → 아래 순서.
 *  ① (접수일, 퍼스트순 = first_no 또는 lease_no, 접수자) → copier1
 *  ② (접수일, 퍼스트순) → copier2
 *  ③ 퍼스트순이 빈 시트 행(신규 거래처)만: (접수일, 접수자, 상호 normVendor 앞 6자 같음) → copier3
 * 접수일 없는 시트 행은 잇지 않는다. key = `copier:${sheetRow}`.
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
  pass("copier3",
    (r) => {
      const v = normVendor(r.vendor.replace(/…/g, "")).slice(0, 6);
      return !normNo(r.firstNo) && squeeze(r.author) && v ? `${r.date}|${squeeze(r.author)}|${v}` : "";
    },
    (d) => {
      const v = normVendor(d.vendor).slice(0, 6);
      return squeeze(d.author) && v ? [`${dbDate(d)}|${squeeze(d.author)}|${v}`] : [];
    });
  return out;
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

export function syncedReceptionIds(jobs: DeptJob[]): string[] {
  return Array.from(new Set(jobs.map((j) => receptionIdOfDupKey(j._dupKey)).filter(Boolean)));
}

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

/** 홈 미처리: 미처리·보류 행만 + 이어진 접수 id. copier(CS 기록)는 넣지 않는다(CS 접수 = 일정 기준 유지) */
export function openRowsOf(rows: ParsedSheetRow[], links: Map<string, string>, contentSince = ""): SheetOpenStateRow[] {
  const out: SheetOpenStateRow[] = [];
  for (const r of rows) {
    if (r.source === "copier" || (r.cls !== "open" && r.cls !== "hold")) continue;
    const id = links.get(`${r.source}:${r.sheetRow}`);
    const { content, ...rest } = r;
    const keep = content && !(contentSince && r.date && r.date < contentSince);
    out.push({ ...rest, cls: r.cls, ...(keep ? { content } : {}), ...(id ? { receptionId: id } : {}) });
  }
  return out;
}

/**
 * 접수리스트 목록 모드: 이어진 행(앱 줄이 대신 보임) 빼고, start ≤ date 이고 from ≤ date ≤ to 인 행만(완료·기록 포함).
 * 날짜를 못 읽은 행(미래 날짜 포함 — inferMissingYears 가 "" 로 만듦)은 개수만 noDate. content 는 싣지 않는다.
 */
export function listRowsOf(
  rows: ParsedSheetRow[], links: Map<string, unknown>, from: string, to: string, start = SHEET_LIST_START,
): { rows: SheetListStateRow[]; noDate: number } {
  const out: SheetListStateRow[] = [];
  let noDate = 0;
  for (const r of rows) {
    if (links.has(`${r.source}:${r.sheetRow}`)) continue;
    if (!r.date) { noDate += 1; continue; }
    if (r.date < start || r.date < from || r.date > to) continue;
    const { content: _content, ...rest } = r;
    void _content;
    out.push(rest);
  }
  return { rows: out, noDate };
}
