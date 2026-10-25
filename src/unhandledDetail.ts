/**
 * 미처리 상세 팝업 본문(2026-10-25 사용자 "캘린더 미처리면 캘린더 내용이, 시트면 시트에 있는 내용이 나와야지 — 잘린 듯").
 * 팝업 틀: 머리(업체·종류·팀) → 정보 표(열 이름: 값) → 내용 칸(전체·줄바꿈 그대로) → 단추 줄.
 *
 * 출처별 본문
 *  - 시트 행(영업·경영·원격·IT): 팝업을 열 때 엣지 reception-sheet-open 에 그 한 행만 물어 열 전부(전화번호 열 제외)를 받는다.
 *    목록 응답의 summary 는 40자라 잘려 보였다(엣지 state.ts parseSheetRows clip 40).
 *  - 앱 접수(service_receptions): 팝업을 열 때 그 접수 한 줄을 읽어 내용·증상·처리자·처리내용·비고·사진 수까지.
 *  - 일정(as_tickets): 목록을 읽을 때 이미 받은 값(homeUnhandled.ticketFields·ticketContent) — 새 조회 없음.
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

/** 팝업 본문 읽기 — 실패는 throw(팝업이 안내문 + 목록 값으로 보여 준다). 읽을 게 없는 행은 null */
export async function loadUnhandledDetail(row: UnhandledRow): Promise<UnhandledDetailBody | null> {
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
