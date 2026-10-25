/**
 * 서비스접수 미처리 = 시트 상태 기준(C3, 2026-10-22) — 엣지 reception-sheet-open 호출 + DB 행과 합치기.
 * 설계: docs/tasks/reception-unhandled-sheet-and-dept-search.md 5절 "프런트 합치기 규칙".
 *
 * 기능 스위치: app_config RECEPTION_SHEET_OPEN_ENABLED 가 문자열 'true' 일 때만 시트 기준. 없거나 다른 값이면
 * 엣지를 부르지 않고 지금처럼 DB 기준(숫자 변화 없음).
 *
 * 합치기 규칙
 * - 영업팀·경영지원: 시트 행이 진실. DB 행 중 시트에 이어졌거나(coveredIds) 시트 동기화가 끝난 것(sheet_row 있음)은 뺀다.
 *   아직 시트에 안 간(잡 대기·실패) DB 행만 DB 상태로 남긴다.
 * - 원격이관·IT: 시트 행이 진실. 시트에 이어진 DB 행만 뺀다. 이어지지 않은 DB 원격대기의 7일 규칙(isStaleRemote)은 부르는 쪽이 그대로.
 * - 운영지원·복합기 AS: 시트를 읽지 않는다 — DB 그대로.
 * - 시트(탭)를 못 읽으면 그 종류는 DB 만으로 보여 주고 안내 한 줄(숫자를 0으로 만들지 않는다).
 * - 기간(D1): 최근 90일만 칸 숫자에, 90일 넘은 시트 행은 over90 으로 따로.
 */
import { getConfig, invokeEdgeFunction } from "./supabase";
import { ageDays } from "./deptReception";

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
  /** 칸 숫자에 넣을 시트 행(최근 90일, 날짜 모르는 행 포함) */
  sheet: SheetOpenRow[];
  /** 90일 넘은 시트 행(따로 접어 둠) */
  over90: SheetOpenRow[];
  /** 화면 안내 한 줄(없으면 "") */
  notice: string;
  /** 시트 기준으로 센 종류 */
  sheetKinds: SheetKind[];
};

/**
 * DB 열린 행 + 엣지 결과 → 남길 DB 행·시트 행. resp 가 null(시트 읽기 실패)이면 DB 그대로 + 안내.
 * 순수 함수 — today 는 kstDate() 값.
 */
export function mergeSheetAndDb<T extends DbLike>(db: T[], resp: SheetOpenResponse | null, today: string, error = "", days = SHEET_DAYS): SheetMerge<T> {
  if (!resp) {
    return { db, sheet: [], over90: [], sheetKinds: [], notice: `시트를 못 읽어 영업·경영·원격 숫자가 빠졌을 수 있음 — 앱 접수(DB) 기준으로 표시${error ? ` (${error})` : ""}` };
  }
  const okSources = resp.okSources;
  const sheetKinds = okSources.flatMap((s) => SOURCE_KINDS[s]);
  const okKind = new Set<string>(sheetKinds);
  const covered = new Set(resp.coveredIds);
  const keptDb = db.filter((r) => {
    if (!okKind.has(r.type)) return true;
    if (covered.has(r.id)) return false;
    if (DEPT_SHEET_KINDS.has(r.type) && (r.sheet_row || String(r.remote_meta?.sheet_state || "") === "synced")) return false;
    return true;
  });
  const sheet: SheetOpenRow[] = [];
  const over90: SheetOpenRow[] = [];
  for (const row of resp.rows) {
    if (!okSources.includes(row.source)) continue;
    if (row.date && ageDays(row.date, today) > days) over90.push(row);
    else sheet.push(row);
  }
  const missing = (["sales", "mgmt", "remote"] as SheetSource[]).filter((s) => !okSources.includes(s));
  const notes: string[] = [];
  if (missing.length) notes.push(`시트를 못 읽어 ${missing.map((s) => SOURCE_NAME[s]).join("·")} 숫자는 앱 접수(DB) 기준`);
  if (resp.errors.length) notes.push(resp.errors.join(" / ").slice(0, 200));
  return { db: keptDb, sheet, over90, sheetKinds, notice: notes.join(" — ") };
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
