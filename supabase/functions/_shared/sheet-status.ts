/**
 * 미처리 행 [완료]·[보류]·[배정] → 접수 시트 "상태만 갱신"(statusOnly) 순수 규칙 — 2026-10-25.
 * 설계: docs/tasks/unhandled-actions-2026-10-25.md 3-2절. Deno API 없음 — 엣지(field-sheet-sync/sheet-status.ts)와 vitest 양쪽에서 import.
 *
 * 열 위치는 reception-sheet-open/state.ts 의 SHEET_LAYOUTS 하나만 쓴다(읽는 열 = 쓰는 열).
 * 쓰는 칸은 상태 열(G)과 처리자 열(영업·경영 F, 원격 K) 둘뿐. 접수일·접수·접수자 칸은 이 경로에서 절대 쓰지 않는다.
 *
 * 행 확인: 순번(A)과 상호(영업·경영 P, 원격 R) 앞 6자가 **둘 다** 맞아야 쓴다.
 * 받은 행 번호가 안 맞으면 순번으로 아래→위 검색해 같은 확인을 통과한 행 하나. 못 찾으면 실패(새 행·다른 행 금지).
 */
import { normVendor, SHEET_LAYOUTS, type SheetLayout, type SheetSource } from "../reception-sheet-open/state.ts";

/** 최종 실패(재시도해도 같은 결과) — 잡을 바로 failed 로 두고 HTTP 상태를 이 값으로 돌려준다 */
export class StatusJobError extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "StatusJobError";
    this.httpStatus = httpStatus;
  }
}

export const STATUS_CATEGORY_SOURCE: Record<string, SheetSource> = {
  reception_sales: "sales", reception_mgmt: "mgmt", reception_remote: "remote",
};

/** 시트 G열 허용 값(실측 2026-10-25). 원격에는 '보류'가 없다 — 팀장 결정 Q1: 원격·IT 는 보류 단추를 숨기고 시트에 적지 않는다 */
export const ALLOWED_STATUS: Record<SheetSource, readonly string[]> = {
  sales: ["진행중", "처리완료", "보류", "취소"],
  mgmt: ["진행중", "처리완료", "보류", "취소"],
  remote: ["처리완료", "접수취소", "재접수", "자체해결", "AS이관", "중복접수", "방문이관"],
  copier: [], // AS접수용(CS) 탭은 상태 칸이 없다 — statusOnly 대상 아님(STATUS_CATEGORY_SOURCE 에도 없음, 2026-10-28)
};

export const HANDLER_HEADER = "처리자";
const HANDLER_MAX = 40;

export type StatusOnlyRequest = {
  source: SheetSource;
  sheetRow: number;
  seq: string;
  vendorHead: string;
  status: string;
  handler: string;
};

const squeeze = (v: unknown) => String(v ?? "").replace(/\s+/g, "");
/** 순번 비교값: 쉼표·공백 제거(표시값 '1,234' 대비) */
export const normSeq = (v: unknown) => String(v ?? "").replace(/[,\s]/g, "");
/** 상호 확인 키: normVendor 앞 6자(말줄임표 제거) */
export const vendorKey = (v: unknown) => normVendor(String(v ?? "").replace(/…/g, "")).slice(0, 6);
const clip = (v: unknown, n = 20) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** payload(또는 payload.data)에 statusOnly 표시가 있는지 */
export function isStatusOnlyPayload(payload: unknown): boolean {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const d = (p.data && typeof p.data === "object" ? p.data : {}) as Record<string, unknown>;
  const on = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
  return on(p.statusOnly) || on(d.statusOnly) || on(d._statusOnly);
}

/**
 * 잡 category + payload → 요청. 허용 값 밖·필수 값 없음이면 StatusJobError(400).
 * payload 키는 최상위 또는 payload.data 어느 쪽이어도 된다(최상위 우선).
 */
export function parseStatusOnly(category: string, payload: unknown): StatusOnlyRequest {
  const source = STATUS_CATEGORY_SOURCE[String(category || "")];
  if (!source) throw new StatusJobError(`statusOnly 는 reception_sales·reception_mgmt·reception_remote 만 됩니다(받은 값 ${category})`, 400);
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const d = (p.data && typeof p.data === "object" ? p.data : {}) as Record<string, unknown>;
  const pick = (k: string) => String(p[k] ?? d[k] ?? "").trim();
  const layout = SHEET_LAYOUTS[source];

  const sheetRow = Number(pick("sheetRow"));
  if (!Number.isInteger(sheetRow) || sheetRow < layout.dataStart) {
    throw new StatusJobError(`sheetRow 가 올바르지 않습니다(받은 값 '${pick("sheetRow")}', ${layout.dataStart}행 이상)`, 400);
  }
  const seq = normSeq(pick("seq"));
  const vendorHead = pick("vendorHead");
  if (!vendorKey(vendorHead)) throw new StatusJobError("vendorHead(상호 앞 6자)가 비어 있습니다", 400);
  const status = squeeze(pick("status"));
  const handler = pick("handler").replace(/\s+/g, " ");
  if (!status && !handler) throw new StatusJobError("status 와 handler 가 모두 비어 있습니다", 400);
  if (status && !ALLOWED_STATUS[source].includes(status)) {
    throw new StatusJobError(`허용되지 않는 상태 '${clip(status)}' — ${source} 허용: ${ALLOWED_STATUS[source].join("·")}`, 400);
  }
  if (handler.length > HANDLER_MAX) throw new StatusJobError(`handler 가 너무 깁니다(${handler.length}자, 최대 ${HANDLER_MAX})`, 400);
  return { source, sheetRow, seq, vendorHead, status, handler };
}

/** 머리 확인 — 상태 열 머리가 기대와 다르거나(항상), 처리자를 쓸 때 처리자 열 머리에 '처리자'가 없으면 오류 문구 */
export function verifyStatusHeaders(layout: SheetLayout, header: string[], needHandler: boolean): string {
  const at = (col: number) => String(header[col - 1] ?? "");
  if (squeeze(at(layout.statusCol)) !== squeeze(layout.statusHeader)) {
    return `시트 머리 변경: ${layout.statusCol}열 머리가 "${clip(at(layout.statusCol), 30)}"(기대 "${layout.statusHeader}") — 쓰지 않음`;
  }
  if (needHandler && !squeeze(at(layout.handlerCol)).includes(HANDLER_HEADER)) {
    return `시트 머리 변경: ${layout.handlerCol}열 머리가 "${clip(at(layout.handlerCol), 30)}"(기대 "${HANDLER_HEADER}") — 쓰지 않음`;
  }
  return "";
}

/**
 * 대상 행 찾기. seqCol·vendorCol 은 dataStart 행부터의 표시값(같은 길이일 필요 없음).
 * 1) 받은 행에서 순번·상호 둘 다 맞으면 그 행 2) 아니면(순번이 있을 때만) 아래→위 검색 3) 못 찾으면 error(기대/실제 값).
 */
export function findTargetRow(
  layout: SheetLayout, req: Pick<StatusOnlyRequest, "sheetRow" | "seq" | "vendorHead">, seqCol: string[], vendorCol: string[],
): { row: number; moved: boolean } | { error: string } {
  const want = vendorKey(req.vendorHead);
  const seqAt = (row: number) => normSeq(seqCol[row - layout.dataStart]);
  const vendorAt = (row: number) => String(vendorCol[row - layout.dataStart] ?? "");
  const ok = (row: number) => seqAt(row) === req.seq && !!want && normVendor(vendorAt(row)).includes(want);
  if (ok(req.sheetRow)) return { row: req.sheetRow, moved: false };
  if (req.seq) {
    const last = layout.dataStart + Math.max(seqCol.length, vendorCol.length) - 1;
    for (let r = last; r >= layout.dataStart; r--) if (ok(r)) return { row: r, moved: true };
  }
  return {
    error: `행 대조 실패(쓰지 않음): ${req.sheetRow}행 기대 순번 '${req.seq}'·상호 '${clip(req.vendorHead)}' / 실제 순번 '${seqAt(req.sheetRow)}'·상호 '${clip(vendorAt(req.sheetRow))}'`
      + (req.seq ? " — 순번 검색에서도 못 찾음" : " — 순번이 비어 검색하지 않음"),
  };
}

/** 쓸 칸(열 번호 → 값). 현재 값과 같으면 빼므로 빈 객체 = 쓸 것 없음(멱등 성공) */
export function planStatusWrite(
  layout: SheetLayout, req: Pick<StatusOnlyRequest, "status" | "handler">, current: { status: string; handler: string },
): Record<number, string> {
  const out: Record<number, string> = {};
  if (req.status && squeeze(current.status) !== squeeze(req.status)) out[layout.statusCol] = safeCell(req.status);
  if (req.handler && String(current.handler ?? "").trim() !== req.handler) out[layout.handlerCol] = safeCell(req.handler);
  return out;
}

/** =,+,@ 로 시작하면 USER_ENTERED 가 수식으로 읽는다 — 앞에 ' (dept-sheet-spec safeText 와 같은 규칙) */
export const safeCell = (v: string) => (/^[=+@]/.test(v) ? `'${v}` : v);
