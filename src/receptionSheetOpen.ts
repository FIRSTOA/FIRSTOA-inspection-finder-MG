/**
 * 서비스접수 미처리 = 시트 상태 기준(C3, 2026-10-22) — 엣지 reception-sheet-open 호출 + DB 행과 합치기.
 * 설계: docs/tasks/reception-unhandled-sheet-and-dept-search.md 5절 "프런트 합치기 규칙".
 *
 * 기능 스위치: app_config RECEPTION_SHEET_OPEN_ENABLED 가 문자열 'true' 일 때만 시트 기준. 없거나 다른 값이면
 * 엣지를 부르지 않고 지금처럼 DB 기준(숫자 변화 없음).
 *
 * 합치기 규칙
 * - 영업팀·경영지원: 시트 행이 진실. DB 행 중 **지금 시트 행에 이어진 것**(linkedIds, 옛 엣지는 열린 시트 행의 receptionId)만 뺀다.
 *   시트에 짝이 없는 DB 열린 행(기입 전·잡 실패·시트 행을 사람이 지움·접수자 칸이 바뀌어 못 이음)은 남기고 sheetMissing 에 id 를 적는다
 *   → 화면 '시트에 없음' 배지. (2026-10-25 밤 오류진: 예전엔 sheet_row·synced 만 보고 뺐더니, 시트 행이 지워진 접수와
 *   기입 직후 엣지 60초 캐시 사이의 접수가 현황판·홈 어디에도 안 보였다.)
 * - 원격이관·IT: 시트 행이 진실. 시트에 이어진 DB 행만 뺀다. 이어지지 않은 DB 원격대기의 7일 규칙(isStaleRemote)은 부르는 쪽이 그대로.
 * - 운영지원·복합기 AS: 시트를 읽지 않는다 — DB 그대로.
 * - 시트(탭)를 못 읽으면 그 종류는 DB 만으로 보여 주고 안내 한 줄(숫자를 0으로 만들지 않는다).
 * - 기간(D1): 최근 90일만 칸 숫자에, 90일 넘은 시트 행은 over90 으로 따로.
 * - 날짜 모름(2026-10-27): 엣지가 접수일을 끝내 못 읽은 시트 행은 칸 숫자에 넣지 않고 noDate 로 따로("날짜 모름 n" 칩).
 *   예전엔 칸 안에 넣었는데, 경영지원 시트 C열(년월) 빈 행 425건이 2025년 것까지 전부 미처리 숫자에 들어갔다.
 */
import { getConfig, invokeEdgeFunction, selectAllRows } from "./supabase";
import { ageDays } from "./deptReception";
import { kstDate } from "./visits";
import type { ServiceReceptionRow } from "./api";
import { maskPhones, normVendor, SHEET_LIST_START } from "./receptionSheetState";

export type SheetSource = "sales" | "mgmt" | "remote";
export type SheetKind = "영업팀" | "경영지원" | "원격이관" | "IT";

/** 엣지가 돌려주는 시트 미처리 행(전화번호 없음) — supabase/functions/reception-sheet-open/state.ts SheetOpenRow 와 같은 모양 */
export type SheetOpenRow = {
  source: SheetSource;
  kind: SheetKind;
  sheetRow: number;
  seq: string;
  date: string;
  author: string;
  handler: string;
  state: string;
  cls: "open" | "hold";
  vendor: string;
  field: string;
  region: string;
  summary: string;
  /** 내용 열 원문(줄바꿈 그대로·600자) — 최근 90일 행 중 summary 40자로 다 안 보이는 것만(엣지 state.ts listContent). 옛 엣지는 없음 */
  content?: string;
  receptionId?: string;
};

export type SheetOpenResponse = {
  rows: SheetOpenRow[];
  fetchedAt: string;
  errors: string[];
  okSources: SheetSource[];
  coveredIds: string[];
  /** 지금 시트에 있는 행(완료·보류·미처리 무관)에 이어진 접수 id — 2026-10-25 밤 엣지부터. 옛 엣지는 없음(undefined) */
  linkedIds?: string[];
  healed: number;
  healEnabled: boolean;
  cached?: boolean;
};

/** enabled=false 면 스위치 꺼짐(DB 기준). enabled=true 인데 data=null 이면 시트 읽기 실패(error). */
export type SheetOpenResult = { enabled: false } | { enabled: true; data: SheetOpenResponse | null; error: string };

export const SHEET_OPEN_SWITCH = "RECEPTION_SHEET_OPEN_ENABLED";
export const SHEET_DAYS = 90;
export const RECEPTION_SPREADSHEET_ID = "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g";
const SHEET_GID: Record<SheetSource, number> = { sales: 174566767, mgmt: 899183889, remote: 916322987 };
const SOURCE_KINDS: Record<SheetSource, SheetKind[]> = { sales: ["영업팀"], mgmt: ["경영지원"], remote: ["원격이관", "IT"] };
const SOURCE_NAME: Record<SheetSource, string> = { sales: "영업", mgmt: "경영", remote: "원격·IT" };
const DEPT_SHEET_KINDS = new Set<string>(["영업팀", "경영지원"]);

export const isSheetOpenOn = (cfg: Record<string, string> | null | undefined) => String(cfg?.[SHEET_OPEN_SWITCH] ?? "").trim() === "true";

/** 시트 행으로 바로 가는 링크(해당 탭·행) */
export const sheetRowUrl = (source: SheetSource, sheetRow: number) =>
  `https://docs.google.com/spreadsheets/d/${RECEPTION_SPREADSHEET_ID}/edit#gid=${SHEET_GID[source]}&range=A${sheetRow}`;

/** 부서 접수 시트 탭 링크(서비스접수 › 경영·영업 [시트 열기]). 운영지원·그 밖은 시트가 없어 null. */
export const deptSheetUrl = (dept: string): string | null =>
  dept === "영업팀" ? `https://docs.google.com/spreadsheets/d/${RECEPTION_SPREADSHEET_ID}/edit#gid=${SHEET_GID.sales}`
    : dept === "경영지원" ? `https://docs.google.com/spreadsheets/d/${RECEPTION_SPREADSHEET_ID}/edit#gid=${SHEET_GID.mgmt}`
      : null;

function normalizeResponse(raw: Partial<SheetOpenResponse> | null | undefined): SheetOpenResponse {
  const r = raw || {};
  return {
    rows: Array.isArray(r.rows) ? r.rows : [],
    fetchedAt: String(r.fetchedAt || ""),
    errors: Array.isArray(r.errors) ? r.errors.map(String) : [],
    okSources: Array.isArray(r.okSources) ? r.okSources.filter((s): s is SheetSource => s === "sales" || s === "mgmt" || s === "remote") : [],
    coveredIds: Array.isArray(r.coveredIds) ? r.coveredIds.map(String) : [],
    ...(Array.isArray(r.linkedIds) ? { linkedIds: r.linkedIds.map(String) } : {}),
    healed: Number(r.healed) || 0,
    healEnabled: Boolean(r.healEnabled),
    cached: Boolean(r.cached),
  };
}

/** 엣지 한 번 호출. 실패는 throw 하지 않고 { data: null, error } — 현황판 전체를 막지 않게 */
export async function fetchSheetOpenRows(): Promise<{ data: SheetOpenResponse | null; error: string }> {
  try {
    const raw = await invokeEdgeFunction<Partial<SheetOpenResponse>>("reception-sheet-open", {}, 25_000);
    return { data: normalizeResponse(raw), error: "" };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 스위치 확인 → 켜졌으면 엣지 호출. 설정을 못 읽으면 꺼진 것으로 본다(DB 기준 = 지금 화면 그대로). throw 하지 않는다. */
export async function loadSheetOpen(): Promise<SheetOpenResult> {
  let on = false;
  try { on = isSheetOpenOn(await getConfig()); } catch { on = false; }
  if (!on) return { enabled: false };
  const res = await fetchSheetOpenRows();
  return { enabled: true, data: res.data, error: res.error };
}

/** 시트 행 → 현황판 상태 칸(보류 / 진행중·처리중 = 진행중 / 그 밖 = 접수) */
export function sheetRowStatus(row: Pick<SheetOpenRow, "cls" | "state">): "접수" | "진행중" | "보류" {
  if (row.cls === "hold") return "보류";
  const s = String(row.state || "").replace(/\s+/g, "");
  return s === "진행중" || s === "처리중" ? "진행중" : "접수";
}

type DbLike = { id: string; type: string; sheet_row?: number | null; remote_meta?: Record<string, string> | null };

export type SheetMerge<T> = {
  /** 남길 DB 행 */
  db: T[];
  /** 칸 숫자에 넣을 시트 행(최근 90일) */
  sheet: SheetOpenRow[];
  /** 90일 넘은 시트 행(따로 접어 둠) */
  over90: SheetOpenRow[];
  /** 접수일을 못 읽은 시트 행(따로 접어 둠 — 칸 숫자 밖) */
  noDate: SheetOpenRow[];
  /** 화면 안내 한 줄(없으면 "") */
  notice: string;
  /** 시트 기준으로 센 종류 */
  sheetKinds: SheetKind[];
  /** 남긴 DB 행 중 시트에 짝이 없는 영업·경영 접수 id(화면 '시트에 없음' 배지) */
  sheetMissing: string[];
};

/** '시트에 없음' 배지·상세 줄 문구 */
export const SHEET_MISSING_LABEL = "시트에 없음";
export const SHEET_MISSING_HINT = "앱 접수는 열려 있는데 시트에 이 행이 없습니다(기입 전이거나 시트에서 행이 지워짐) — 시트에 다시 적거나 앱에서 완료·삭제하세요";

/**
 * DB 열린 행 + 엣지 결과 → 남길 DB 행·시트 행. resp 가 null(시트 읽기 실패)이면 DB 그대로 + 안내.
 * 순수 함수 — today 는 kstDate() 값.
 */
export function mergeSheetAndDb<T extends DbLike>(db: T[], resp: SheetOpenResponse | null, today: string, error = "", days = SHEET_DAYS): SheetMerge<T> {
  if (!resp) {
    return { db, sheet: [], over90: [], noDate: [], sheetKinds: [], sheetMissing: [], notice: `시트를 못 읽어 영업·경영·원격 숫자가 빠졌을 수 있음 — 앱 접수(DB) 기준으로 표시${error ? ` (${error})` : ""}` };
  }
  const okSources = resp.okSources;
  const sheetKinds = okSources.flatMap((s) => SOURCE_KINDS[s]);
  const okKind = new Set<string>(sheetKinds);
  const covered = new Set(resp.coveredIds);
  // 영업·경영: 지금 시트 행에 이어진 접수만 시트가 대신한다. 옛 엣지(linkedIds 없음)는 열린 시트 행의 receptionId 로 —
  // 시트 '완료' 행에 이어진 접수는 엣지 자가 치유가 DB 를 완료로 바꿔 열린 목록에서 빠진다.
  const linked = new Set(resp.linkedIds ?? resp.rows.map((r) => String(r.receptionId || "")).filter(Boolean));
  const sheetMissing: string[] = [];
  const keptDb = db.filter((r) => {
    if (!okKind.has(r.type)) return true;
    if (DEPT_SHEET_KINDS.has(r.type)) {
      if (linked.has(r.id)) return false;
      sheetMissing.push(r.id);
      return true;
    }
    return !covered.has(r.id);
  });
  const sheet: SheetOpenRow[] = [];
  const over90: SheetOpenRow[] = [];
  const noDate: SheetOpenRow[] = [];
  for (const row of resp.rows) {
    if (!okSources.includes(row.source)) continue;
    if (!row.date) noDate.push(row);
    else if (ageDays(row.date, today) > days) over90.push(row);
    else sheet.push(row);
  }
  const missing = (["sales", "mgmt", "remote"] as SheetSource[]).filter((s) => !okSources.includes(s));
  const notes: string[] = [];
  if (missing.length) notes.push(`시트를 못 읽어 ${missing.map((s) => SOURCE_NAME[s]).join("·")} 숫자는 앱 접수(DB) 기준`);
  if (resp.errors.length) notes.push(resp.errors.join(" / ").slice(0, 200));
  return { db: keptDb, sheet, over90, noDate, sheetKinds, sheetMissing, notice: notes.join(" — ") };
}

/**
 * 미처리 행(mergeUnhandled 결과) 중 시트에 짝 없는 DB 접수 줄(key "r:<id>")에 sheetMissing 표시 + 상세 정보 줄 하나.
 * 숫자는 바꾸지 않는다(줄을 더하거나 빼지 않음). ids 가 비면 rows 그대로.
 */
export function markSheetMissing<T extends { key: string; fields?: Array<{ label: string; value: string }> }>(rows: T[], ids: readonly string[]): Array<T & { sheetMissing?: true }> {
  if (!ids.length) return rows;
  const keys = new Set(ids.map((id) => `r:${id}`));
  return rows.map((r) => (keys.has(r.key)
    ? { ...r, sheetMissing: true as const, fields: [...(r.fields || []), { label: SHEET_MISSING_LABEL, value: SHEET_MISSING_HINT }] }
    : r));
}

/** 종류별 90일 넘은 건수 */
export function over90Counts(rows: SheetOpenRow[]): Partial<Record<SheetKind, number>> {
  const out: Partial<Record<SheetKind, number>> = {};
  for (const r of rows) out[r.kind] = (out[r.kind] || 0) + 1;
  return out;
}

// ── 상세 한 행(2026-10-25 사용자 "시트면 시트에 있는 내용이 나와야지 — 잘린 듯") ──
// 목록 응답의 summary 는 접수내용 40자(엣지 state.ts clip). 팝업을 열 때 그 행만 다시 읽어 열 전부를 받는다.

/** 엣지 state.ts SheetRowDetail 과 같은 모양 */
export type SheetCell = { label: string; value: string };
export type SheetRowDetail = {
  source: SheetSource;
  sheetRow: number;
  seq: string;
  state: string;
  cells: SheetCell[];
  contentLabel: string;
  content: string;
};

/** 엣지 응답 → 모양 맞추기(빈 값·이상한 칸은 버린다) */
export function normalizeSheetRowDetail(raw: unknown): SheetRowDetail | null {
  const d = (raw && typeof raw === "object" ? raw : null) as Partial<SheetRowDetail> | null;
  if (!d || (d.source !== "sales" && d.source !== "mgmt" && d.source !== "remote")) return null;
  const cells = Array.isArray(d.cells)
    ? d.cells.map((c) => ({ label: String(c?.label ?? "").trim(), value: String(c?.value ?? "") })).filter((c) => c.label && c.value.trim())
    : [];
  return {
    source: d.source, sheetRow: Number(d.sheetRow) || 0, seq: String(d.seq ?? ""), state: String(d.state ?? ""),
    cells, contentLabel: String(d.contentLabel || "내용"), content: String(d.content ?? ""),
  };
}

/** 시트 한 행 상세 — 실패(순번 바뀜·이미 처리됨·시트 못 읽음)는 throw(부르는 쪽이 안내문으로) */
export async function fetchSheetRowDetail(source: SheetSource, sheetRow: number, seq = ""): Promise<SheetRowDetail> {
  const raw = await invokeEdgeFunction<{ detail?: unknown }>("reception-sheet-open", { row: { source, sheetRow, seq } }, 20_000);
  const detail = normalizeSheetRowDetail(raw?.detail);
  if (!detail) throw new Error("시트 행 상세를 받지 못했습니다(엣지 함수가 아직 옛 버전일 수 있음)");
  return detail;
}


// ── 접수리스트 시트 줄(2026-10-28, docs/tasks/reception-list-sheet-rows-2026-10-28.md 4·5절) ──
// 앱 접수 ∪ 시트에만 적힌 접수(2026-10-01부터). 이번 달(과 탭에 남은 영업·경영 지난 행)은 엣지 목록 모드 { list: { from, to } },
// 이번 달 1일 이전 구간은 보관 표 reception_sheet_rows(anon select). 둘이 겹치면 엣지 쪽 우선.
// 숫자 규칙: 홈 미처리·현황판은 그대로(이 목록 함수는 접수리스트만 쓴다).

export type SheetListSource = SheetSource | "copier";
export type SheetListKind = SheetKind | "복합기 AS";
export type SheetListCls = "open" | "hold" | "done" | "record";

/** 접수리스트 시트 줄 — SheetOpenRow 모양 + 완료·기록(copier) + 접수시간·퍼스트순·달. 전화번호 원문 없음, content 없음 */
export type SheetListRow = {
  source: SheetListSource;
  kind: SheetListKind;
  sheetRow: number;
  /** 시트 A열 순번(보관 표에서 온 순번 빈 행은 "h:…" 해시) */
  seq: string;
  date: string;
  author: string;
  handler: string;
  state: string;
  cls: SheetListCls;
  vendor: string;
  field: string;
  region: string;
  summary: string;
  /** 접수시간 "HH:MM"(원격·CS D열) */
  time?: string;
  /** 퍼스트순(CS F열) */
  firstNo?: string;
  /** "YYYY-MM"(접수일 기준) */
  month?: string;
};

const LIST_SOURCES = new Set<string>(["sales", "mgmt", "remote", "copier"]);
const LIST_CLS = new Set<string>(["open", "hold", "done", "record"]);
const LIST_KINDS = new Set<string>(["영업팀", "경영지원", "원격이관", "IT", "복합기 AS"]);
const SOURCE_KIND: Record<SheetListSource, SheetListKind> = { sales: "영업팀", mgmt: "경영지원", remote: "원격이관", copier: "복합기 AS" };
const SHEET_LIST_GID: Record<SheetListSource, number> = { ...SHEET_GID, copier: 1181394897 };

const listText = (v: unknown) => maskPhones(String(v ?? "").trim());
const hhmm = (v: unknown) => {
  const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};

/** 시트 줄로 바로 가는 링크(copier 포함) */
export const sheetListRowUrl = (source: SheetListSource, sheetRow: number) =>
  `https://docs.google.com/spreadsheets/d/${RECEPTION_SPREADSHEET_ID}/edit#gid=${SHEET_LIST_GID[source]}&range=A${sheetRow}`;

/** 엣지 응답 한 줄 → SheetListRow(모양이 틀리면 null). 가림을 한 번 더 건다(옛 엣지 대비) */
export function normalizeSheetListRow(raw: unknown): SheetListRow | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || !LIST_SOURCES.has(String(r.source))) return null;
  const source = r.source as SheetListSource;
  const date = String(r.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const cls = LIST_CLS.has(String(r.cls)) ? (r.cls as SheetListCls) : source === "copier" ? "record" : "open";
  const kind = LIST_KINDS.has(String(r.kind)) ? (r.kind as SheetListKind) : SOURCE_KIND[source];
  const time = hhmm(r.time);
  const firstNo = String(r.firstNo ?? "").trim();
  return {
    source, kind, sheetRow: Number(r.sheetRow) || 0, seq: String(r.seq ?? "").trim(), date,
    author: listText(r.author), handler: listText(r.handler), state: listText(r.state), cls,
    vendor: listText(r.vendor), field: listText(r.field), region: listText(r.region), summary: listText(r.summary),
    ...(time ? { time } : {}), ...(firstNo ? { firstNo } : {}),
    month: /^\d{4}-\d{2}$/.test(String(r.month ?? "")) ? String(r.month) : date.slice(0, 7),
  };
}

/** 보관 표 reception_sheet_rows 한 행(읽는 열만) */
export type SheetTableRow = {
  source: string; month: string; seq: string; sheet_row: number | null; kind: string; receipt_date: string; receipt_time: string | null;
  author: string | null; handler: string | null; state: string | null; cls: string; vendor: string | null; first_no: string | null;
  field: string | null; region: string | null; summary: string | null; reception_id?: string | null;
};
export const SHEET_TABLE = "reception_sheet_rows";
export const SHEET_TABLE_COLUMNS = "source,month,seq,sheet_row,kind,receipt_date,receipt_time,author,handler,state,cls,vendor,first_no,field,region,summary,reception_id";

/** 보관 표 한 행 → SheetListRow (receipt_time "09:06:00" → "09:06") */
export function tableRowToSheetListRow(r: SheetTableRow): SheetListRow {
  const out = normalizeSheetListRow({
    source: r.source, kind: r.kind, sheetRow: r.sheet_row ?? 0, seq: r.seq, date: r.receipt_date, author: r.author, handler: r.handler,
    state: r.state, cls: r.cls, vendor: r.vendor, field: r.field, region: r.region, summary: r.summary,
    time: r.receipt_time, firstNo: r.first_no, month: r.month,
  });
  if (out) return out;
  // 표 제약(source·cls·날짜)상 오지 않지만, 와도 버리지 않고 모양만 맞춘다
  const source: SheetListSource = LIST_SOURCES.has(r.source) ? (r.source as SheetListSource) : "sales";
  return {
    source, kind: SOURCE_KIND[source], sheetRow: r.sheet_row ?? 0, seq: String(r.seq ?? ""), date: String(r.receipt_date ?? "").slice(0, 10),
    author: listText(r.author), handler: listText(r.handler), state: listText(r.state), cls: source === "copier" ? "record" : "open",
    vendor: listText(r.vendor), field: listText(r.field), region: listText(r.region), summary: listText(r.summary), month: String(r.month ?? ""),
  };
}

/** 겹침 판정 키: (source, month, seq). 순번이 비었거나 보관 표 해시("h:")면 (source, 날짜, 접수자, 상호 앞 6자) */
export function sheetListKey(r: SheetListRow): string {
  const seq = String(r.seq || "").trim();
  if (seq && !seq.startsWith("h:")) return `${r.source}|${r.month || r.date.slice(0, 7)}|${seq}`;
  return `${r.source}|${r.date}|${r.author.replace(/\s+/g, "")}|${normVendor(r.vendor).slice(0, 6)}`;
}

/** 엣지 줄 + 보관 표 줄 → 겹치는 것은 엣지 쪽만 남김(엣지가 최신 시트) */
export function dedupeSheetRows(edgeRows: SheetListRow[], tableRows: SheetListRow[]): SheetListRow[] {
  const seen = new Set<string>();
  const out: SheetListRow[] = [];
  for (const r of [...edgeRows, ...tableRows]) {
    const k = sheetListKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** 표가 아직 없음(SQL 실행 대기) — selectRows 오류 글 "조회 실패 표(404): … PGRST205/42P01 …" */
const tableMissing = (m: string) => /\(404\)|PGRST205|42P01|does not exist|Could not find the table/i.test(m);

/** "YYYY-MM-DD" 하루 전 */
const dayBefore = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export type SheetListResult = { rows: SheetListRow[]; noDate: number; errors: string[]; ok: boolean };

/**
 * 접수리스트 시트 줄 읽기. throw 하지 않는다.
 * - 스위치(RECEPTION_SHEET_OPEN_ENABLED) 꺼짐·설정 못 읽음 → { ok:false, rows:[], errors:[] } (지금 화면 그대로, 안내 없음)
 * - 엣지 실패 → ok:false + errors 첫 줄 "시트 접수를 못 읽음 — 앱 접수만 표시 (…)". 보관 표 줄은 읽혔으면 그대로 싣는다.
 * - 범위 중 이번 달 1일 이전 구간(2026-10-01 이후만)은 보관 표에서. 표 없음·실패는 errors 한 줄, 엣지 결과만.
 * from·to 는 kstDate() 기준 "YYYY-MM-DD". today 는 테스트용(기본 kstDate()).
 * opts.sources(2026-10-28, 부서 일정리스트·달력): 이 출처 줄만. 엣지 본문 list.sources 로도 보내지만(옛 엣지는 무시),
 * 결과·오류 글은 프런트에서 한 번 더 거르고 보관 표는 source=in.(…) 로 읽는다. 없으면 지금처럼 전부(접수리스트 무변경).
 */
export async function fetchSheetListRows(from: string, to: string, today: string = kstDate(), opts: { sources?: SheetListSource[] } = {}): Promise<SheetListResult> {
  const sources = (opts.sources || []).filter((x) => LIST_SOURCES.has(x));
  let on = false;
  try { on = isSheetOpenOn(await getConfig()); } catch { on = false; }
  if (!on) return { rows: [], noDate: 0, errors: [], ok: false };
  const errors: string[] = [];
  const monthStart = `${today.slice(0, 7)}-01`;
  const tableFrom = from > SHEET_LIST_START ? from : SHEET_LIST_START;
  const tableTo = to < monthStart ? to : dayBefore(monthStart);

  const edgeCall = invokeEdgeFunction<{ ok?: boolean; rows?: unknown[]; noDate?: number; errors?: unknown[] }>("reception-sheet-open", { list: { from, to, ...(sources.length ? { sources } : {}) } }, 25_000)
    .then((raw) => ({ raw, error: "" }), (e: unknown) => ({ raw: null, error: e instanceof Error ? e.message : String(e) }));
  const tableCall = tableFrom <= tableTo
    ? selectAllRows<SheetTableRow>(SHEET_TABLE,
      sheetTableQuery(tableFrom, tableTo, sources))
      .then((rows) => ({ rows, error: "" }), (e: unknown) => ({ rows: [] as SheetTableRow[], error: e instanceof Error ? e.message : String(e) }))
    : Promise.resolve({ rows: [] as SheetTableRow[], error: "" });
  const [edge, table] = await Promise.all([edgeCall, tableCall]);

  let edgeRows: SheetListRow[] = [];
  let noDate = 0;
  let ok = false;
  if (edge.raw && Array.isArray(edge.raw.rows)) {
    ok = edge.raw.ok !== false;
    // 기간 밖 행은 버린다 — 엣지가 범위를 잘랐거나(92일), 옛 엣지(목록 모드 없음)가 미처리 행을 돌려줘도 화면 기간과 어긋나지 않게
    edgeRows = edge.raw.rows.map(normalizeSheetListRow).filter((r): r is SheetListRow => r !== null && r.date >= from && r.date <= to);
    noDate = Number(edge.raw.noDate) || 0;
    if (Array.isArray(edge.raw.errors)) errors.push(...edge.raw.errors.map(String).filter(Boolean));
  } else {
    errors.unshift(`시트 접수를 못 읽음 — 앱 접수만 표시${edge.error ? ` (${edge.error.slice(0, 120)})` : " (엣지 함수가 아직 목록 모드를 모름)"}`);
  }
  if (table.error) {
    errors.push(tableMissing(table.error)
      ? "지난달 시트 줄 보관 표가 아직 없음(SQL 실행 대기) — 이번 달 시트 줄만 표시"
      : `지난달 시트 줄을 못 읽음 — 이번 달 시트 줄만 표시 (${table.error.slice(0, 120)})`);
  }
  const tableRows = table.rows.map(tableRowToSheetListRow).filter((r) => r.date >= tableFrom && r.date <= tableTo);
  const rows = dedupeSheetRows(edgeRows, tableRows);
  if (!sources.length) return { rows, noDate, errors, ok };
  return { rows: filterSheetListBySources(rows, sources), noDate, errors: filterSheetErrorsBySources(errors, sources), ok };
}

/** 보관 표 조회문 — sources 가 있으면 source=in.(…) */
export function sheetTableQuery(from: string, to: string, sources: readonly SheetListSource[] = []): string {
  return `select=${SHEET_TABLE_COLUMNS}&receipt_date=gte.${from}&receipt_date=lte.${to}&reception_id=is.null&gone_at=is.null`
    + `${sources.length ? `&source=in.(${sources.join(",")})` : ""}&order=receipt_date.desc,id.desc`;
}

/** 출처 거르기(옛 엣지가 sources 를 무시하고 전부 돌려줘도 결과는 고른 출처만) */
export function filterSheetListBySources<T extends { source: string }>(rows: T[], sources: readonly string[]): T[] {
  if (!sources.length) return rows;
  const want = new Set(sources);
  return rows.filter((r) => want.has(r.source));
}

/** 엣지 오류 글의 시트 이름(state.ts SOURCE_LABEL 앞부분) — 다른 출처 이름만 적힌 오류 글은 부서 화면에 띄우지 않는다 */
const SOURCE_ERROR_HINT: Record<SheetListSource, string> = { sales: "해지방어접수", mgmt: "경영지원접수", remote: "원격", copier: "AS접수용" };
export function filterSheetErrorsBySources(errors: string[], sources: readonly SheetListSource[]): string[] {
  if (!sources.length) return errors;
  const mine = sources.map((x) => SOURCE_ERROR_HINT[x]);
  const others = (Object.keys(SOURCE_ERROR_HINT) as SheetListSource[]).filter((x) => !sources.includes(x)).map((x) => SOURCE_ERROR_HINT[x]);
  return errors.filter((e) => mine.some((h) => e.includes(h)) || !others.some((h) => e.includes(h)));
}

/** 접수리스트에 섞는 시트 줄 — ServiceReceptionRow 꼴 + sheet 표시 */
export type SheetListReceptionRow = ServiceReceptionRow & {
  sheet: true;
  sheetSource: SheetListSource;
  sheetRow: number;
  sheetSeq: string;
  sheetMonth: string;
  sheetCls: SheetListCls;
  /** 시트 상태 칸 원문(CS 는 BD 메모) */
  sheetState: string;
  /** 처리자(시트 칸) */
  sheetHandler: string;
  /** 접수시간 "HH:MM", 없으면 "" (화면 "--:--") */
  receipt_time: string;
};

/** 시트 분류 → 앱 상태값: 미처리 = 접수(시트 칸이 진행중·처리중이면 진행중), 보류 = 보류, 완료 = 완료, 기록(CS) = "" */
export function sheetListStatus(r: Pick<SheetListRow, "cls" | "state">): string {
  if (r.cls === "record") return "";
  if (r.cls === "done") return "완료";
  return sheetRowStatus({ cls: r.cls, state: r.state });
}

/** 시트 줄 → 접수리스트 줄. id = sheet:source:month:seq(순번 없으면 행 번호). created_at = 접수일·시각(KST, 시각 없으면 00:00) */
export function sheetListToListRow(r: SheetListRow): SheetListReceptionRow {
  const month = r.month || r.date.slice(0, 7);
  const seq = r.seq || String(r.sheetRow);
  const time = r.time || "";
  return {
    id: `sheet:${r.source}:${month}:${seq}`,
    created_at: `${r.date}T${time || "00:00"}:00+09:00`,
    receipt_date: r.date,
    receipt_time: time,
    author: r.author,
    route: "시트",
    type: r.kind,
    vendor: r.vendor,
    asset_no: "", serial: "", model: "",
    region: r.region,
    title: "",
    symptom: r.summary,
    paid: "", notes: "", report_text: "",
    status: sheetListStatus(r),
    sent_room: "", grade: "", receiver_name: "", receiver_phone: "", keyman_info: "",
    lease_no: "", address: "",
    field: r.field,
    first_no: r.firstNo || "",
    sheet_row: r.sheetRow || null,
    sheet: true,
    sheetSource: r.source,
    sheetRow: r.sheetRow,
    sheetSeq: r.seq,
    sheetMonth: month,
    sheetCls: r.cls,
    sheetState: r.state,
    sheetHandler: r.handler,
  };
}

/** 시트 줄인가(합친 목록에서 가르기) */
export const isSheetListRow = (r: ServiceReceptionRow): r is SheetListReceptionRow => (r as Partial<SheetListReceptionRow>).sheet === true;

/** 정렬 키 "YYYY-MM-DD HH:MM" — 앱 줄은 created_at 의 KST 시각, 시트 줄은 접수시간(없으면 날짜만 → 그날 맨 아래) */
function sortKeyOf(r: ServiceReceptionRow): string {
  const date = String(r.receipt_date || "").slice(0, 10);
  if (isSheetListRow(r)) return r.receipt_time ? `${date} ${r.receipt_time}` : date;
  const t = Date.parse(String(r.created_at || ""));
  if (!Number.isFinite(t)) return date;
  return `${date} ${new Date(t + 9 * 3600_000).toISOString().slice(11, 16)}`;
}

/** 앱 접수 + 시트 줄 → 날짜·시각 내림차순 한 목록(같은 id 한 번만, 같은 시각은 앱 줄 먼저) */
export function mergeListWithSheet(db: ServiceReceptionRow[], sheet: SheetListRow[]): { rows: Array<ServiceReceptionRow | SheetListReceptionRow>; appCount: number; sheetCount: number } {
  const seen = new Set<string>();
  const app: ServiceReceptionRow[] = [];
  for (const r of db) { if (!seen.has(r.id)) { seen.add(r.id); app.push(r); } }
  const sheetRows: SheetListReceptionRow[] = [];
  for (const s of sheet) {
    const row = sheetListToListRow(s);
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    sheetRows.push(row);
  }
  const keyed = [...app, ...sheetRows].map((r, i) => ({ r, i, k: sortKeyOf(r) }));
  keyed.sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : a.i - b.i));
  return { rows: keyed.map((x) => x.r), appCount: app.length, sheetCount: sheetRows.length };
}
