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
