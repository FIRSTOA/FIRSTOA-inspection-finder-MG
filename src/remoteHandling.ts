/**
 * 원격·IT 접수 처리(서비스접수 컴포넌트 밖에서 부르는 판) — 미처리 [완료]·[배정](2026-10-25).
 * 설계: docs/tasks/unhandled-actions-2026-10-25.md 5절 "원격/IT" 줄.
 *
 * DB: service_receptions.remote_meta 를 merge_reception_handling RPC 로 원자 병합(ServiceReception saveHandling 과 같은 RPC).
 * 시트(원격 탭):
 *  · 시트 확인 재료(순번 있는 시트 행)가 있으면 statusOnly 잡 — 상태(G)·처리자(K) 칸만.
 *  · 없으면(앱 접수 r: 줄) ServiceReception.syncRemoteSheet 와 같은 갱신 전용 잡(sendReceptionRemoteSheetJob updateOnly)
 *    — 앱이 만든 행이라 접수일·접수자 값도 앱 값이고, 새 행은 만들지 않는다.
 * 보류는 없다(팀장 결정 Q1: 원격 시트 처리여부에 보류가 없어 단추를 숨김).
 * 실패 규칙: DB 실패는 throw, 시트 실패는 warnings(부르는 쪽이 토스트).
 */
import { getServiceReceptionById, mergeReceptionHandling, sendReceptionRemoteSheetJob, updateServiceReception } from "./api";
import { enqueueSheetStatusJob, type SheetStatusResult } from "./deptReceptionApi";

export type RemoteSheetRef = { row: number; seq: string; vendor: string };
export type RemoteActionResult = { warnings: string[]; sheet: SheetStatusResult | null; sheetMessage: string };

/** 접수 당시 시트 표기("7월 31일" / "20:22") — ServiceReception receiptParts 와 같은 규칙 */
export function remoteReceiptParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  const md = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(base);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(base);
  return { date: md.replace(/\.$/, "").replace(/(\d+)\.\s*(\d+)/, "$1월 $2일"), time };
}

async function writeRemoteSheet(id: string, sheet: RemoteSheetRef | null, change: { status?: string; handler?: string }, by: string, warnings: string[]): Promise<{ res: SheetStatusResult | null; msg: string }> {
  if (sheet && sheet.row && sheet.seq) {
    try {
      const res = await enqueueSheetStatusJob({ source: "remote", sheetRow: sheet.row, seq: sheet.seq, vendor: sheet.vendor, status: change.status, handler: change.handler, by });
      if (res.state === "failed") warnings.push(`원격 시트 미반영: ${res.message}`);
      return { res, msg: res.message };
    } catch (e) {
      warnings.push(`원격 시트 미반영: ${(e as Error).message}`);
      return { res: { state: "failed", row: null, message: (e as Error).message }, msg: "" };
    }
  }
  // 앱 접수 줄 — 최신 행으로 갱신 전용 잡(새 행 없음)
  try {
    const row = await getServiceReceptionById(id);
    if (!row) { warnings.push("원격 시트 미반영: 접수를 찾지 못했습니다"); return { res: null, msg: "" }; }
    if (!row.lease_no && !row.sheet_row && !row.vendor) { warnings.push("원격 시트 미반영: 시트 행을 찾을 재료(순번·행·상호)가 없습니다"); return { res: null, msg: "" }; }
    const meta = (row.remote_meta || {}) as Record<string, string>;
    const parts = remoteReceiptParts(row.created_at);
    const out = await sendReceptionRemoteSheetJob({
      author: row.author, vendor: row.vendor, leaseNo: row.lease_no, route: row.route,
      hanjo: meta.hanjo || (row.type === "IT" ? "IT" : ""),
      start: meta.start || "", end: meta.end || "", result: meta.result || "", handler: meta.handler || "",
      contact: [row.receiver_name, row.receiver_phone].filter(Boolean).join("\n"),
      symptom: row.symptom || "", extraCount: meta.extraCount || "", handled: meta.handled || "", linked: meta.linked || "",
      receiptDate: parts.date, receiptTime: parts.time, receiptAuthor: row.author,
    }, row.sheet_row ?? null, { updateOnly: true });
    if (out.row && out.row !== row.sheet_row) {
      try { await updateServiceReception(id, { sheet_row: out.row }); } catch (e) { warnings.push(`시트 행 번호 기록 실패: ${(e as Error).message}`); }
    }
    return { res: null, msg: out.message };
  } catch (e) {
    warnings.push(`원격 시트 미반영: ${(e as Error).message}`);
    return { res: null, msg: "" };
  }
}

/** [완료] — 처리여부 처리완료·상태 완료(처리자가 비었으면 누른 사람) + 원격 시트 */
export async function completeRemote(id: string, opts: { by: string; sheet?: RemoteSheetRef | null }): Promise<RemoteActionResult> {
  if (!id) throw new Error("접수 id 가 없습니다");
  const cur = await getServiceReceptionById(id);
  if (!cur) throw new Error("접수를 찾지 못했습니다(삭제됐을 수 있음)");
  const meta = (cur.remote_meta || {}) as Record<string, string>;
  const handler = String(meta.handler || "").trim() || String(opts.by || "").trim();
  const patch: Record<string, string> = { result: "처리완료", ...(handler ? { handler } : {}) };
  await mergeReceptionHandling(id, patch, cur.status === "완료" ? undefined : "완료");
  const warnings: string[] = [];
  const out = await writeRemoteSheet(id, opts.sheet ?? null, { status: "처리완료", handler: meta.handler ? "" : handler }, opts.by, warnings);
  return { warnings, sheet: out.res, sheetMessage: out.msg };
}

/** [배정] — 처리자 1명(빈 값 = 미배정) + 원격 시트 처리자 칸 */
export async function assignRemote(id: string, handler: string, opts: { by: string; sheet?: RemoteSheetRef | null }): Promise<RemoteActionResult> {
  if (!id) throw new Error("접수 id 가 없습니다");
  const name = String(handler || "").trim().split(/[,·]/)[0].trim();
  await mergeReceptionHandling(id, { handler: name });
  const warnings: string[] = [];
  if (!name && opts.sheet?.seq) return { warnings: ["시트 처리자 칸은 비우지 않습니다(시트에서 직접 지워 주세요)"], sheet: null, sheetMessage: "" };
  const out = await writeRemoteSheet(id, opts.sheet ?? null, { handler: name }, opts.by, warnings);
  return { warnings, sheet: out.res, sheetMessage: out.msg };
}
