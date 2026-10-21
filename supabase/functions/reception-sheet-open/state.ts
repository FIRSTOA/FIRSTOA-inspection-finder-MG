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
 * 고객 전화번호 열(영업 V·경영 X 등)은 읽어도 돌려주지 않는다(필요한 칸만 뽑는다).
 */

export type SheetSource = "sales" | "mgmt" | "remote";
export type SheetClass = "done" | "hold" | "open";
export type SheetKind = "영업팀" | "경영지원" | "원격이관" | "IT";

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

// ── 탭 배치(열 번호는 1부터) ─────────────────────────
export type SheetLayout = {
  source: SheetSource;
  gid: number;
  /** 읽는 범위의 첫 행(머리행 검증을 같이 하려고 머리부터 읽는다) */
  firstRow: number;
  headerRow: number;
  dataStart: number;
  lastCol: string;
  statusCol: number;
  statusHeader: string;
  hanjoCol?: number;
  hanjoHeader?: string;
  markerCols: number[];
  seqCol: number;
  dateCol: number;
  yymmCol: number;
  authorCol?: number;
  handlerCol: number;
  regionCol: number;
  vendorCol: number;
  fieldCol?: number;
  summaryCol: number;
};

export const SPREADSHEET_ID = "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g";

export const SHEET_LAYOUTS: Record<SheetSource, SheetLayout> = {
  sales: {
    source: "sales", gid: 174566767, firstRow: 5, headerRow: 5, dataStart: 7, lastCol: "W",
    statusCol: 7, statusHeader: "진행중/처리완료/보류/취소", markerCols: [2, 4, 5],
    seqCol: 1, dateCol: 2, yymmCol: 3, authorCol: 5, handlerCol: 6, regionCol: 15, vendorCol: 16, fieldCol: 18, summaryCol: 23,
  },
  mgmt: {
    source: "mgmt", gid: 899183889, firstRow: 5, headerRow: 5, dataStart: 7, lastCol: "Z",
    statusCol: 7, statusHeader: "진행중/처리완료/보류/취소", markerCols: [2, 4, 5],
    seqCol: 1, dateCol: 2, yymmCol: 3, authorCol: 5, handlerCol: 6, regionCol: 15, vendorCol: 16, fieldCol: 18, summaryCol: 25,
  },
  remote: {
    source: "remote", gid: 916322987, firstRow: 1, headerRow: 1, dataStart: 5, lastCol: "W",
    statusCol: 7, statusHeader: "처리여부", hanjoCol: 12, hanjoHeader: "한조처리", markerCols: [2, 4, 10],
    seqCol: 1, dateCol: 2, yymmCol: 3, handlerCol: 11, regionCol: 17, vendorCol: 18, summaryCol: 23,
  },
};

export const SOURCE_LABEL: Record<SheetSource, string> = { sales: "해지방어접수(영업팀)", mgmt: "경영지원접수", remote: "원격" };

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
  cls: SheetClass;
  vendor: string;
  field: string;
  region: string;
  summary: string;
};

/** 프런트로 돌려주는 모양(미처리·보류만) */
export type SheetOpenRow = Omit<ParsedSheetRow, "cls"> & { cls: "open" | "hold"; receptionId?: string };

const cell = (row: string[], col: number | undefined) => (col ? String(row[col - 1] ?? "").trim() : "");
const clip = (v: string, n: number) => {
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/**
 * 읽은 값(범위 첫 행 = layout.firstRow) → 행 목록. 머리가 다르면 error 를 주고 행은 비운다(그 탭만 빠짐 — 조용히 틀리지 않게).
 * 마커 열이 모두 비면 행이 아니다(맨 끝 순번만 있는 빈 줄 제외).
 */
export function parseSheetRows(layout: SheetLayout, values: string[][]): { rows: ParsedSheetRow[]; error: string } {
  const header = values[layout.headerRow - layout.firstRow] || [];
  const statusHead = cell(header, layout.statusCol);
  if (squeeze(statusHead) !== squeeze(layout.statusHeader)) {
    return { rows: [], error: `시트 머리 변경: ${SOURCE_LABEL[layout.source]} G열 머리가 "${clip(statusHead, 30)}"(기대 "${layout.statusHeader}")` };
  }
  if (layout.hanjoCol && layout.hanjoHeader && !squeeze(cell(header, layout.hanjoCol)).includes(squeeze(layout.hanjoHeader))) {
    return { rows: [], error: `시트 머리 변경: ${SOURCE_LABEL[layout.source]} L열 머리가 "${clip(cell(header, layout.hanjoCol), 30)}"(기대 "${layout.hanjoHeader}")` };
  }
  const rows: ParsedSheetRow[] = [];
  for (let i = layout.dataStart - layout.firstRow; i < values.length; i++) {
    const row = values[i] || [];
    if (!layout.markerCols.some((c) => cell(row, c))) continue;
    const state = cell(row, layout.statusCol);
    const hanjo = layout.hanjoCol ? squeeze(cell(row, layout.hanjoCol)).toUpperCase() : "";
    const kind: SheetKind = layout.source === "sales" ? "영업팀" : layout.source === "mgmt" ? "경영지원" : hanjo.includes("IT") ? "IT" : "원격이관";
    rows.push({
      source: layout.source,
      kind,
      sheetRow: layout.firstRow + i,
      seq: cell(row, layout.seqCol),
      date: sheetDate(cell(row, layout.yymmCol), cell(row, layout.dateCol)),
      author: cell(row, layout.authorCol),
      handler: cell(row, layout.handlerCol),
      state,
      cls: sheetStateClass(state),
      vendor: clip(cell(row, layout.vendorCol), 40),
      field: clip(cell(row, layout.fieldCol), 30),
      region: cell(row, layout.regionCol),
      summary: clip(cell(row, layout.summaryCol), 40),
    });
  }
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

/** 미처리·보류 행만 + 이어진 접수 id */
export function openRowsOf(rows: ParsedSheetRow[], links: Map<string, string>): SheetOpenRow[] {
  const out: SheetOpenRow[] = [];
  for (const r of rows) {
    if (r.cls === "done") continue;
    const id = links.get(`${r.source}:${r.sheetRow}`);
    out.push({ ...r, cls: r.cls, ...(id ? { receptionId: id } : {}) });
  }
  return out;
}

/** KST 이번 달(YYYY-MM) */
export function kstMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}
