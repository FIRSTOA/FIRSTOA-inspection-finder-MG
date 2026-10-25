/**
 * 미처리 상세 팝업 본문(2026-10-25 사용자 "캘린더 미처리면 캘린더 내용이, 시트면 시트에 있는 내용이 나와야지 — 잘린 듯").
 * 팝업 틀: 머리(업체·종류·팀) → 정보 표(열 이름: 값) → 내용 칸(전체·줄바꿈 그대로) → 단추 줄.
 *
 * 출처별 본문
 *  - 시트 행(영업·경영·원격·IT): 팝업을 열 때 엣지 reception-sheet-open 에 그 한 행만 물어 열 전부(전화번호 열 제외)를 받는다.
 *    목록 응답의 summary 는 40자라 잘려 보였다(엣지 state.ts parseSheetRows clip 40).
 *  - 앱 접수(service_receptions): 팝업을 열 때 그 접수 한 줄을 읽어 내용·증상·처리자·처리내용·비고·사진 수까지.
 *  - 일정(as_tickets): 목록을 읽을 때 이미 받은 값(homeUnhandled.ticketFields·ticketContent) — 새 조회 없음.
 *  - 2026-10-25 밤: 시트 행은 목록 응답 content(내용 원문 600자, 최근 90일)가 row.detail 로 와서 팝업이 내용을 바로 보이고 나머지 열만 뒤에 채운다.
 *    읽은 본문은 세션 캐시(5분), 목록 줄에 손을 올리면 미리 읽기(동시 2개).
 * 화면은 HomeUnhandledPanel UnhandledDetail. 글은 전부 평문(HTML 해석 안 함).
 */
import { selectRows } from "./supabase";
import { fetchSheetRowDetail, type SheetRowDetail } from "./receptionSheetOpen";
import type { UnhandledRow } from "./homeUnhandled";

export type DetailField = { label: string; value: string };
export type UnhandledDetailBody = {
  /** 정보 표(빈 값 없음) */
  fields: DetailField[];
  /** 내용 칸 머리(접수내용·증상·메모 등) */
  contentLabel: string;
  /** 내용 칸 — 자르지 않는다 */
  content: string;
};

/** 빈 값 뺀 표 줄 */
export const compactFields = (pairs: Array<[string, unknown]>): DetailField[] =>
  pairs.map(([label, v]) => ({ label, value: String(v ?? "").trim() })).filter((f) => f.value);

/** 시트 한 행 상세 → 팝업 본문(열 순서 그대로, 빈 칸 생략, 내용은 받은 그대로) */
export function sheetDetailBody(d: SheetRowDetail): UnhandledDetailBody {
  return {
    fields: d.cells.filter((c) => c.label && String(c.value ?? "").trim()).map((c) => ({ label: c.label, value: String(c.value) })),
    contentLabel: d.contentLabel || "내용",
    content: d.content,
  };
}

/** 본문 → "열 이름: 값" 줄 목록(복사·확인용). 내용은 맨 끝에 머리와 함께, 줄바꿈 그대로 */
export function detailBodyText(b: UnhandledDetailBody): string {
  const lines = b.fields.map((f) => `${f.label}: ${f.value}`);
  if (b.content.trim()) lines.push(`${b.contentLabel}: ${b.content}`);
  return lines.join("\n");
}

/** 팝업에서 읽는 service_receptions 칸 */
export type ReceptionDetailRow = {
  id: string; author?: string; route?: string; type?: string; asset_no?: string; serial?: string; model?: string;
  region?: string; grade?: string; lease_no?: string; address?: string; title?: string; symptom?: string; notes?: string;
  field?: string; receiver_name?: string; receiver_phone?: string; photos?: unknown; remote_meta?: Record<string, string> | null;
  receipt_date?: string; created_at?: string;
};
export const RECEPTION_DETAIL_COLS = "id,author,route,type,asset_no,serial,model,region,grade,lease_no,address,title,symptom,notes,field,receiver_name,receiver_phone,photos,remote_meta,receipt_date,created_at";

const photoCount = (p: unknown): number => (Array.isArray(p) ? p.filter(Boolean).length : 0);

/** 앱 접수 한 줄 → 팝업 본문. 내용 칸 = 제목(요청 내용) + 증상(다르면), 처리내용·비고는 표에(줄바꿈 유지) */
export function receptionDetailBody(r: ReceptionDetailRow): UnhandledDetailBody {
  const m = r.remote_meta || {};
  const n = photoCount(r.photos);
  const title = String(r.title || "").trim();
  const symptom = String(r.symptom || "").trim();
  const content = [title, symptom && symptom !== title ? symptom : ""].filter(Boolean).join("\n\n");
  return {
    fields: compactFields([
      ["접수자", r.author],
      ["접수경로", r.route],
      ["분야", r.field],
      ["처리자", m.handler],
      ["진행", m.progress],
      ["처리내용", m.handled],
      ["한조처리", m.hanjo],
      ["예정일", m.schedule_date],
      ["외근", m.outside],
      ["계약서", m.contract_kind],
      ["지역/등급", [r.region, r.grade].filter(Boolean).join(" / ")],
      ["순", r.lease_no],
      ["자산/모델", [r.asset_no, r.model].filter(Boolean).join(" · ")],
      ["기번", r.serial],
      ["업체담당자", [r.receiver_name, r.receiver_phone].filter(Boolean).join(" ")],
      ["주소", r.address],
      ["비고", r.notes],
      ["사진", n ? `${n}장` : ""],
    ]),
    contentLabel: "접수 내용",
    content,
  };
}

/**
 * 팝업 본문을 새로 읽어야 하는 행인가 — 시트 행(row.sheet) 또는 앱 접수 행(key r:…). 일정은 이미 받은 값으로 충분(null).
 */
export function detailSourceOf(row: Pick<UnhandledRow, "key" | "sheet" | "receptionId" | "source">): "sheet" | "reception" | null {
  if (row.sheet && row.sheet.row > 0) return "sheet";
  if (row.source === "reception" && row.key.startsWith("r:") && row.receptionId) return "reception";
  return null;
}

/* ── 본문 캐시·미리 읽기(2026-10-25 밤 사용자 "서비스접수 상세 팝업 내용이 조금 늦게 나온다") ──
 * 시트 행 상세는 엣지 → Sheets API 왕복(1~2초). 같은 행을 다시 열면 세션 메모리 값으로 즉시, 목록 줄에 손을 올리면(마우스·터치 시작) 미리 읽는다.
 * 실패는 캐시하지 않는다(팝업이 다시 읽고 안내문을 보인다). 처리 단추를 누르면 그 행 캐시를 버린다(상태가 바뀜).
 */

/** 캐시 키 — 시트 행 = 탭·행·순번, 앱 접수 = id. 읽을 게 없는 행(일정)은 "" */
export function detailCacheKey(row: Pick<UnhandledRow, "key" | "sheet" | "receptionId" | "source">): string {
  const kind = detailSourceOf(row);
  if (kind === "sheet" && row.sheet) return `s:${row.sheet.source}:${row.sheet.row}:${row.sheet.seq}`;
  if (kind === "reception" && row.receptionId) return `r:${row.receptionId}`;
  return "";
}

export const DETAIL_CACHE_TTL_MS = 5 * 60_000;
export const DETAIL_CACHE_MAX = 200;
export type DetailCache = {
  get: (key: string, now: number) => UnhandledDetailBody | null | undefined;
  set: (key: string, body: UnhandledDetailBody | null, now: number) => void;
  delete: (key: string) => void;
  size: () => number;
};
/** 세션 메모리 캐시(순수 — 시각은 부르는 쪽). ttl 지나면 없음, max 넘으면 가장 먼저 넣은 것부터 버린다 */
export function createDetailCache(max = DETAIL_CACHE_MAX, ttl = DETAIL_CACHE_TTL_MS): DetailCache {
  const m = new Map<string, { at: number; body: UnhandledDetailBody | null }>();
  return {
    get: (key, now) => {
      const hit = m.get(key);
      if (!hit) return undefined;
      if (now - hit.at > ttl) { m.delete(key); return undefined; }
      return hit.body;
    },
    set: (key, body, now) => {
      m.delete(key);
      m.set(key, { at: now, body });
      while (m.size > max) { const first = m.keys().next().value; if (first === undefined) break; m.delete(first); }
    },
    delete: (key) => { m.delete(key); },
    size: () => m.size,
  };
}

/** 미리 읽기 문지기 — 동시에 limit 개까지만, 넘치면 그 요청은 건너뛴다(줄 위를 훑을 때 요청이 쌓이지 않게). 실패는 무시 */
export function createPrefetcher(limit = 2) {
  let active = 0;
  return {
    run(task: () => Promise<unknown>): boolean {
      if (active >= limit) return false;
      active++;
      task().catch(() => undefined).finally(() => { active--; }); // 미리 읽기 실패는 버린다 — 팝업을 열면 다시 읽고 실패면 안내문
      return true;
    },
    active: () => active,
  };
}

const detailCache = createDetailCache();
const detailInflight = new Map<string, Promise<UnhandledDetailBody | null>>();
const prefetcher = createPrefetcher(2);

async function fetchUnhandledDetail(row: UnhandledRow): Promise<UnhandledDetailBody | null> {
  const kind = detailSourceOf(row);
  if (kind === "sheet" && row.sheet) {
    return sheetDetailBody(await fetchSheetRowDetail(row.sheet.source, row.sheet.row, row.sheet.seq));
  }
  if (kind === "reception" && row.receptionId) {
    const rows = await selectRows<ReceptionDetailRow>("service_receptions", `select=${RECEPTION_DETAIL_COLS}&id=eq.${encodeURIComponent(row.receptionId)}&limit=1`);
    if (!rows[0]) throw new Error("접수를 찾지 못했습니다(삭제됐을 수 있음)");
    return receptionDetailBody(rows[0]);
  }
  return null;
}

/** 캐시에 있으면 그 값(동기) — 팝업 첫 그림용. 없으면 undefined */
export function peekUnhandledDetail(row: UnhandledRow, now: number = Date.now()): UnhandledDetailBody | null | undefined {
  const key = detailCacheKey(row);
  return key ? detailCache.get(key, now) : undefined;
}

/** 처리 단추를 누른 행 — 상태가 바뀌므로 캐시를 버린다 */
export function forgetUnhandledDetail(row: UnhandledRow): void {
  const key = detailCacheKey(row);
  if (key) detailCache.delete(key);
}

/** 팝업 본문 읽기 — 실패는 throw(팝업이 안내문 + 목록 값으로 보여 준다). 읽을 게 없는 행은 null. 캐시·같은 행 동시 읽기는 한 번 */
export async function loadUnhandledDetail(row: UnhandledRow): Promise<UnhandledDetailBody | null> {
  const key = detailCacheKey(row);
  if (!key) return null;
  const hit = detailCache.get(key, Date.now());
  if (hit !== undefined) return hit;
  const running = detailInflight.get(key);
  if (running) return running;
  const p = fetchUnhandledDetail(row)
    .then((body) => { detailCache.set(key, body, Date.now()); return body; })
    .finally(() => { detailInflight.delete(key); });
  detailInflight.set(key, p);
  return p;
}

/** 목록 줄에 마우스를 올리거나 터치를 시작하면 — 이미 있거나 읽는 중이면 아무것도 안 함. 시작했으면 true */
export function prefetchUnhandledDetail(row: UnhandledRow): boolean {
  const key = detailCacheKey(row);
  if (!key || detailInflight.has(key) || detailCache.get(key, Date.now()) !== undefined) return false;
  return prefetcher.run(() => loadUnhandledDetail(row));
}
