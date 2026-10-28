// 접수리스트 시트 줄(2026-10-28, docs/tasks/reception-list-sheet-rows-2026-10-28.md 5절) — 화면이 쓰는 순수 규칙.
// 시트 줄 = receptionSheetOpen.sheetListToListRow 결과(id "sheet:…", sheet: true, 판별은 receptionSheetOpen.isSheetListRow). 앱 줄은 여기 함수를 타지 않는다.
//  · 상태 칩 칸(접수/진행중/완료): open = 접수(시트 상태가 진행중·처리중이면 진행중), hold = 진행중, done = 완료,
//    record(CS 시트 줄 — 시트에 상태 칸 없음, Q4) = 완료 칸에 센다(열린 칸 숫자를 부풀리지 않게). 보이는 글자는 "기록".
//  · 처리 단추: 영업·경영·원격·IT 의 열린 줄(open/hold)만, 순번이 빈 줄(영업 A열 수식 사고)은 숨김.

import { ageDaysOf, type UnhandledKind, type UnhandledRow } from "./homeUnhandled";

export type SheetListCls = "open" | "hold" | "done" | "record";
export type SheetListBucket = "접수" | "진행중" | "완료";
export type SheetListLabel = "접수" | "진행중" | "보류" | "완료" | "기록";

const squeeze = (v: unknown) => String(v ?? "").replace(/\s+/g, "");

/** 상태 칩 칸 */
export function sheetListBucket(cls: SheetListCls | string | undefined, state = ""): SheetListBucket {
  if (cls === "done" || cls === "record") return "완료";
  if (cls === "hold") return "진행중";
  const s = squeeze(state);
  return s === "진행중" || s === "처리중" ? "진행중" : "접수";
}

/** 줄 오른쪽 상태 글자 */
export function sheetListLabel(cls: SheetListCls | string | undefined, state = ""): SheetListLabel {
  if (cls === "record") return "기록";
  if (cls === "hold") return "보류";
  return sheetListBucket(cls, state);
}

/** 처리 단추를 보일 줄 — 열린 줄(open/hold)·CS(copier) 아님·순번 있음 */
export function sheetListCanAct(row: { cls?: string; source?: string; seq?: string }): boolean {
  if (row.cls !== "open" && row.cls !== "hold") return false;
  if (row.source !== "sales" && row.source !== "mgmt" && row.source !== "remote") return false;
  return squeeze(row.seq) !== "";
}

/** 시각 자리 — 시트 접수시간 "9:06" → "09:06", 없으면 "--:--" */
export function sheetListTime(time: unknown): string {
  const m = String(time ?? "").trim().match(/^(\d{1,2})\s*[:시]\s*(\d{2})/);
  if (!m) return "--:--";
  const h = Number(m[1]);
  return h <= 23 ? `${String(h).padStart(2, "0")}:${m[2]}` : "--:--";
}

/** 둘째 줄 — 내용 40자(CS 는 "제목 — 내용") */
export function sheetListLine2(title: unknown, content: unknown, max = 40): string {
  const t = String(title ?? "").trim();
  const c = String(content ?? "").replace(/\s+/g, " ").trim();
  const text = t && c ? `${t} — ${c}` : t || c;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 기간 줄 "(앱 n · 시트 m)" — 시트 줄이 없으면 "" */
export function sheetListCountNote(appCount: number, sheetCount: number): string {
  return sheetCount > 0 ? `(앱 ${appCount} · 시트 ${sheetCount})` : "";
}

/** 처리 단추(UnhandledActionBar statusOnly)에 넘길 행 — 단추를 못 보이는 줄(sheetListCanAct 거짓)이면 null.
 *  접수리스트 펼침(SheetListDetail)·부서 일정리스트 시트 카드가 같이 쓴다(2026-10-28, dept-plan-sheet-rows 3-3). */
export function sheetListUnhandledRow(
  row: { sheetSource: string; sheetRow: number; sheetSeq: string; sheetCls: string; sheetState?: string; type?: string; receipt_date?: string; vendor?: string; symptom?: string; title?: string; author?: string },
  handler: string,
  today: string,
): UnhandledRow | null {
  const { sheetSource: source, sheetRow, sheetSeq: seq, sheetCls: cls } = row;
  if (!sheetListCanAct({ cls, source, seq })) return null;
  const date = String(row.receipt_date || "").slice(0, 10);
  return {
    key: `s:${source}:${sheetRow}`, source: "reception", kind: row.type as UnhandledKind, team: "", date,
    vendor: row.vendor || "", title: row.symptom || row.title || "", assignee: handler, status: row.sheetState || (cls === "hold" ? "보류" : ""),
    ageDays: date ? ageDaysOf(date, today) : 0,
    sheet: { source: source as "sales" | "mgmt" | "remote", row: sheetRow, seq, author: row.author || "", vendor: row.vendor || "" },
  };
}
