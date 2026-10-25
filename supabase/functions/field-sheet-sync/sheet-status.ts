/**
 * 미처리 행 [완료]·[보류]·[배정] 의 시트 쓰기 — statusOnly 잡(2026-10-25). 설계 docs/tasks/unhandled-actions-2026-10-25.md 3-2절.
 *
 * 하는 일: 잠금 → 탭(gid) 찾기 → 머리·순번·상호·상태·처리자 열 읽기 → 행 대조(순번 + 상호 앞 6자 둘 다)
 *        → 대상 칸이 수식이면 멈춤 → 바뀐 칸만 쓰기(상태 G열·처리자 열). 같은 값이면 쓰지 않는다(멱등).
 * 하지 않는 일: 새 행, 다른 칸(접수일·접수·접수자 등), appendViaSheetsApi/appendDeptRow 경로 사용.
 * 머리 변경·행 대조 실패·수식 칸은 StatusJobError(409) — 호출부가 잡을 바로 failed 로 둔다(재시도해도 같음).
 */
import { acquireLock, batchGetValues, batchSetValues, getValues, quoteTitle, releaseLock, segmentsOf, spreadsheetMeta } from "./sheets-api.ts";
import { colLetter } from "./dept-sheet-spec.ts";
import { SHEET_LAYOUTS, SPREADSHEET_ID } from "../reception-sheet-open/state.ts";
import { findTargetRow, planStatusWrite, StatusJobError, type StatusOnlyRequest, verifyStatusHeaders } from "../_shared/sheet-status.ts";

type Env = { rest: string; headers: Record<string, string> };
export type SheetStatusResult = { row: number; sheet: string; moved: boolean; unchanged: boolean; wroteCols: number[] };

export async function writeSheetStatus(req: StatusOnlyRequest, env: Env): Promise<SheetStatusResult> {
  const layout = SHEET_LAYOUTS[req.source];
  const lockToken = await acquireLock(env.rest, env.headers);
  try {
    const meta = await spreadsheetMeta(SPREADSHEET_ID);
    const sheetMeta = meta.sheets.get(layout.gid);
    if (!sheetMeta) throw new Error(`접수 시트 탭(gid ${layout.gid})을 찾지 못했습니다`);
    const title = sheetMeta.title;
    const T = quoteTitle(title);
    const L = (col: number) => colLetter(col);
    const headerRange = `${T}!A${layout.headerRow}:${layout.lastCol}${layout.headerRow}`;
    const colRange = (col: number) => `${T}!${L(col)}${layout.dataStart}:${L(col)}`;
    const cols = [layout.seqCol, layout.vendorCol, layout.statusCol, layout.handlerCol];
    const got = await batchGetValues(SPREADSHEET_ID, [headerRange, ...cols.map(colRange)]);
    const colVals = (col: number) => (got.get(colRange(col)) || []).map((r) => String(r[0] ?? ""));

    const headErr = verifyStatusHeaders(layout, got.get(headerRange)?.[0] || [], !!req.handler);
    if (headErr) throw new StatusJobError(headErr, 409);

    const found = findTargetRow(layout, req, colVals(layout.seqCol), colVals(layout.vendorCol));
    if ("error" in found) throw new StatusJobError(found.error, 409);
    const row = found.row;
    const at = (col: number) => colVals(col)[row - layout.dataStart] ?? "";
    const writes = planStatusWrite(layout, req, { status: at(layout.statusCol), handler: at(layout.handlerCol) });
    const wroteCols = Object.keys(writes).map(Number);
    if (!wroteCols.length) return { row, sheet: title, moved: found.moved, unchanged: true, wroteCols };

    // 쓰려는 칸이 수식이면 멈춘다(시트 담당자 수식 보존)
    for (const col of wroteCols) {
      const f = (await getValues(SPREADSHEET_ID, `${T}!${L(col)}${row}`, "FORMULA"))[0]?.[0] || "";
      if (String(f).startsWith("=")) throw new StatusJobError(`${row}행 ${L(col)}열이 수식이라 쓰지 않습니다`, 409);
    }
    await batchSetValues(SPREADSHEET_ID, segmentsOf(row, title, writes));
    return { row, sheet: title, moved: found.moved, unchanged: false, wroteCols };
  } finally {
    await releaseLock(env.rest, env.headers, lockToken);
  }
}
