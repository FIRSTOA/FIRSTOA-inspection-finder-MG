/**
 * 미처리 한 줄 [완료]·[보류]·[배정] — 출처별로 어느 함수를 부를지 한 곳에서(2026-10-25).
 * 설계: docs/tasks/unhandled-actions-2026-10-25.md 5절 표. 화면 3곳(홈 팝업·부서 미니 업무공간·접수 현황판 시트 카드)이 같은 UnhandledActionBar → 이 파일.
 *
 * | 줄                         | 완료                         | 보류                 | 배정            |
 * | 부서 접수(앱, 시트 이어짐 포함) | runDeptAction done           | runDeptAction hold   | runDeptAction assign |
 * | 원격·IT 접수(앱)             | remoteHandling.completeRemote | (없음 — Q1)          | assignRemote    |
 * | 시트만 있는 영업·경영 줄        | statusOnly 처리완료            | 보류 ↔ 진행중        | statusOnly 처리자 |
 * | 시트만 있는 원격·IT 줄         | statusOnly 처리완료            | (없음)               | statusOnly 처리자 |
 * | CS접수·물류(일정)             | ticketCompletion.completeTicket + 완료 창(DoneReasonModal) | — | — |
 * | CS 접수(앱 접수, 현황판 r: 줄) | 열린 연결 일정 있으면 그 일정 completeTicket(완료 창) / 없으면 접수 상태만 완료 | — | — |
 * 2026-10-25 밤: 현황판 앱 접수 줄(원격·IT·CS 접수·부서)도 같은 단추(boardRowToUnhandled). [완료]·[보류]는 확인창(confirmTextFor) — 취소면 아무 변화 없음.
 * 앱 접수에 이어진 부서 시트 줄은 DB 경로(runDeptAction)만 — 시트 잡을 따로 쌓지 않는다(이중 기입 금지).
 *
 * 실패 규칙: 누르면 unhandledPending 에 먼저 적어 줄을 가리고, 실패(throw·잡 failed)면 지워서 되살리고 빨간 토스트. 삼키지 않는다.
 */
import { ageDaysOf, type UnhandledKind, type UnhandledRow } from "./homeUnhandled";
import type { ReceptionRow } from "./ReceptionBoard";
import { kstDate } from "./visits";
import { clearPending, markPending, readPending, type PendingAction } from "./unhandledPending";

export type UnhandledActionKind = PendingAction;
export type UnhandledRoute = "dept" | "remote" | "copier" | "sheet" | "ticket" | null;
export type UnhandledButtons = { done: boolean; hold: boolean; assign: boolean; openSchedule: boolean };

const DEPT_KINDS = new Set<string>(["경영지원", "운영지원", "영업팀"]);
const REMOTE_KINDS = new Set<string>(["원격이관", "IT"]);
const SHEET_KEY = /^s:(sales|mgmt|remote):(\d+)$/;

/** 시트 출처면 { source, row, seq, author, vendor } — row.sheet 가 없으면 key 에서 출처·행만 */
export function sheetRefOf(row: Pick<UnhandledRow, "key" | "sheet" | "vendor">): NonNullable<UnhandledRow["sheet"]> | null {
  if (row.sheet) return row.sheet;
  const m = SHEET_KEY.exec(String(row.key || ""));
  return m ? { source: m[1] as "sales" | "mgmt" | "remote", row: Number(m[2]), seq: "", author: "", vendor: row.vendor } : null;
}

/** [보류]에 사유가 필수인 줄 — 부서 접수(DB·후속 글에 사유가 남는다)이고 아직 보류가 아닐 때(풀기는 불필요). 시트만 있는 줄은 사유를 적을 칸이 없다 */
export function holdNeedsReason(row: Pick<UnhandledRow, "key" | "source" | "kind" | "receptionId" | "sheet" | "vendor" | "status">): boolean {
  return unhandledRoute(row) === "dept" && String(row.status || "").replace(/\s+/g, "") !== "보류";
}

/** 줄 → 처리 경로(순수) */
export function unhandledRoute(row: Pick<UnhandledRow, "key" | "source" | "kind" | "receptionId" | "sheet" | "vendor">): UnhandledRoute {
  if (row.source === "ticket") return "ticket";
  if (row.receptionId && DEPT_KINDS.has(row.kind)) return "dept";
  if (row.receptionId && REMOTE_KINDS.has(row.kind)) return "remote";
  if (row.receptionId && row.kind === "CS접수" && String(row.key || "").startsWith("r:")) return "copier"; // 현황판 CS 접수(복합기 AS 앱 접수) 줄
  if (sheetRefOf(row)) return "sheet";
  return null;
}

/** 단추 노출 규칙(순수) — 원격·IT 는 보류 없음(Q1), 일정 줄은 완료만(+ CS접수는 일정리스트 열기) */
export function unhandledButtons(row: Pick<UnhandledRow, "key" | "source" | "kind" | "receptionId" | "sheet" | "vendor">): UnhandledButtons {
  const route = unhandledRoute(row);
  if (!route) return { done: false, hold: false, assign: false, openSchedule: false };
  if (route === "ticket") return { done: true, hold: false, assign: false, openSchedule: row.kind !== "물류" };
  if (route === "copier") return { done: true, hold: false, assign: false, openSchedule: false };
  const remote = REMOTE_KINDS.has(row.kind);
  return { done: true, hold: !remote, assign: true, openSchedule: false };
}

/** 시트 상태 열에 쓸 값 — 완료 = 처리완료, 보류 = 보류(이미 보류면 진행중) */
export function sheetStatusFor(action: UnhandledActionKind, current: string): string {
  if (action === "done") return "처리완료";
  if (action === "hold") return String(current || "").replace(/\s+/g, "") === "보류" ? "진행중" : "보류";
  return "";
}

/** pending 에 적을 값(보류 = 바뀔 상태, 배정 = 새 처리자) */
export function pendingValueFor(action: UnhandledActionKind, row: Pick<UnhandledRow, "status">, handler = ""): string {
  if (action === "hold") return String(row.status || "").replace(/\s+/g, "") === "보류" ? "진행중" : "보류";
  if (action === "assign") return String(handler || "").trim();
  return "";
}

export type UnhandledActionOutcome = { warnings: string[]; message: string };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SOURCE_SHEET_NAME: Record<string, string> = { sales: "영업시트", mgmt: "경영시트", remote: "원격시트" };
const isNetwork = (m: string) => /Failed to fetch|NetworkError|Load failed|network/i.test(m);
/** 사용자에게 보일 실패 문구 — 연결 실패는 한 가지 안내로, 엣지·DB 오류는 문구 그대로 */
export const friendlyError = (e: unknown) => { const m = msg(e); return isNetwork(m) ? "인터넷 연결을 확인해 주세요" : m; };

/**
 * 부서·원격·시트 줄 처리(네트워크). 일정 줄은 performTicketDone. DB·잡 실패는 throw, 뒷단계 실패는 warnings.
 */
export async function runUnhandledAction(row: UnhandledRow, action: UnhandledActionKind, opts: { by: string; handler?: string; reason?: string }): Promise<UnhandledActionOutcome> {
  const route = unhandledRoute(row);
  const btn = unhandledButtons(row);
  if (!route || route === "ticket") throw new Error("이 줄은 여기서 처리할 수 없습니다");
  if (route === "copier") {
    // 열린 연결 일정이 없을 때만 여기로 온다(있으면 화면이 완료 창 → performTicketDone). 접수 상태만 완료 + 완료자·시각.
    if (action !== "done") throw new Error("이 줄에는 그 단추가 없습니다");
    const { setServiceReceptionStatus } = await import("./api");
    await setServiceReceptionStatus(String(row.receptionId), "완료", { at: new Date().toISOString(), by: opts.by });
    return { warnings: [], message: "CS 접수를 완료로 바꿨습니다(연결 일정 없음)" };
  }
  if ((action === "hold" && !btn.hold) || (action === "assign" && !btn.assign)) throw new Error("이 줄에는 그 단추가 없습니다");
  const sheet = sheetRefOf(row);

  if (route === "dept") {
    const { runDeptAction } = await import("./deptReceptionFlow");
    const res = await runDeptAction({ id: String(row.receptionId), type: row.kind, vendor: row.vendor, author: "", status: row.status }, action, { by: opts.by, handler: opts.handler, text: opts.reason });
    const deptSheet = row.kind !== "운영지원" ? " — 부서 시트 처리자 칸에 적힘" : "";
    const kakaoTail = res.summary ? ` · ${res.summary}` : "";
    return { warnings: res.warnings, message: (action === "done" ? "처리완료로 바꿨습니다" : action === "hold" ? `${res.row.status === "보류" ? "보류" : "진행중"}로 바꿨습니다` : (opts.handler ? `${opts.handler} 에게 배정${deptSheet}` : "처리자를 비웠습니다")) + kakaoTail };
  }

  if (route === "remote") {
    const { completeRemote, assignRemote } = await import("./remoteHandling");
    const ref = sheet && sheet.source === "remote" ? { row: sheet.row, seq: sheet.seq, vendor: sheet.vendor || row.vendor } : null;
    const res = action === "done"
      ? await completeRemote(String(row.receptionId), { by: opts.by, sheet: ref })
      : await assignRemote(String(row.receptionId), opts.handler || "", { by: opts.by, sheet: ref });
    if (res.sheet?.state === "failed") throw new Error(`DB 는 바뀌었지만 시트에 못 적었습니다 — ${res.sheet.message}`);
    const tail = res.sheetMessage ? ` · ${res.sheetMessage}` : "";
    const name = String(opts.handler || "").trim();
    return { warnings: res.warnings, message: `${action === "done" ? "처리완료로 바꿨습니다" : name ? `${name} 에게 배정 — 원격 시트 처리자 칸에 적힘` : "처리자를 비웠습니다"}${tail}` };
  }

  // 시트만 있는 줄 — statusOnly 잡(상태·처리자 칸만)
  if (!sheet) throw new Error("시트 행 정보가 없습니다");
  const status = sheetStatusFor(action, row.status);
  const handler = action === "assign" ? String(opts.handler || "").trim() : "";
  if (action === "assign" && !handler) throw new Error("시트 처리자 칸은 비우지 않습니다 — 시트에서 직접 지워 주세요");
  const { enqueueSheetStatusJob } = await import("./deptReceptionApi");
  const res = await enqueueSheetStatusJob({ source: sheet.source, sheetRow: sheet.row, seq: sheet.seq, vendor: sheet.vendor || row.vendor, status, handler, by: opts.by });
  const where = `${SOURCE_SHEET_NAME[sheet.source] || "시트"} ${res.row ?? sheet.row}행`;
  if (res.state === "failed") throw new Error(`${where}에 못 적었습니다 — ${res.message}`);
  if (res.state === "held") throw new Error(res.message);
  if (res.state === "queued") return { warnings: [`${where} 반영 대기 — ${res.message}`], message: "" };
  return { warnings: [], message: action === "assign" ? `${handler} 에게 배정 — ${where} 처리자 칸에 적힘 ✓` : `${where} ${status} ✓` };
}

type Notify = (text: string, kind?: "success" | "error" | "info") => void;
const toneOf = (w: string): "error" | "info" => (/실패|미반영|못 /.test(w) ? "error" : "info");

/**
 * 누름 → 줄 먼저 가리기 → 처리 → 결과 토스트. 실패면 되살리고 빨간 토스트. 화면(컴포넌트)이 사라져도 끝까지 돈다.
 * 돌려주는 값: 성공 true / 실패 false.
 */
export async function performUnhandledAction(row: UnhandledRow, action: UnhandledActionKind, opts: { by: string; handler?: string; reason?: string }, notify: Notify): Promise<boolean> {
  markPending(row.key, action, pendingValueFor(action, row, opts.handler));
  const viaSheet = unhandledRoute(row) === "sheet" || (unhandledRoute(row) === "remote" && !!sheetRefOf(row));
  if (viaSheet) notify("시트 반영 중…", "info");
  try {
    const out = await runUnhandledAction(row, action, opts);
    out.warnings.forEach((w) => notify(w, toneOf(w)));
    if (out.message) notify(`${row.vendor || "접수"} — ${out.message}`, "success");
    return true;
  } catch (e) {
    clearPending(row.key);
    notify(`${row.vendor || "접수"} ${action === "done" ? "완료" : action === "hold" ? "보류" : "배정"} 실패: ${friendlyError(e)}`, "error");
    return false;
  }
}

/** 일정 줄 완료 창에 필요한 값 — 일정 표에서 읽는다(실패는 throw) */
export type TicketForDone = { id: string; vendor: string; scheduleType: string; team: string; naverUid?: string; source?: string; status?: string };
export async function loadTicketForDone(id: string): Promise<TicketForDone> {
  const { selectRows } = await import("./supabase");
  const rows = await selectRows<TicketForDone>("as_tickets", `select=id,vendor,scheduleType,team,naverUid,source,status&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!rows[0]) throw new Error("일정을 찾지 못했습니다(지워졌을 수 있음)");
  return rows[0];
}

/** 일정 id(t:<id> 키에서) */
export const ticketIdOf = (row: Pick<UnhandledRow, "key">) => (String(row.key || "").startsWith("t:") ? String(row.key).slice(2) : "");

/** CS접수·물류 완료 — 완료 창에서 받은 사유로 ticketCompletion.completeTicket. 1단계 실패면 되살리고 빨간 토스트 */
export async function performTicketDone(row: UnhandledRow, reason: { text: string; mode?: "visit" | "phone" }, by: string, notify: Notify, ticketId: string = ticketIdOf(row)): Promise<boolean> {
  const id = ticketId; // 현황판 CS 접수 줄(r:)은 연결 일정 id 를 따로 받는다 — pending 은 줄 key(r:) 로 적어 현황판에서 빠진다
  if (!id) { notify("일정 id 가 없어 완료할 수 없습니다", "error"); return false; }
  markPending(row.key, "done");
  try {
    const { completeTicket } = await import("./ticketCompletion");
    const res = await completeTicket(id, reason, { author: by });
    if (!res.ok) throw new Error(res.error || "완료 저장 실패");
    res.warnings.forEach((w) => notify(w, "error"));
    res.infos.forEach((w) => notify(w, "info"));
    notify(`${row.vendor || "일정"} — ${res.alreadyDone ? "이미 완료된 일정입니다" : "완료했습니다"}`, "success");
    return true;
  } catch (e) {
    clearPending(row.key);
    notify(`${row.vendor || "일정"} 완료 실패: ${friendlyError(e)}`, "error");
    return false;
  }
}

/** 현황판 시트 행 → 미처리 줄 모양(단추 줄이 같은 규칙을 쓰게). 앱 접수에 이어진 행만 receptionId */
export function boardSheetToUnhandled(row: ReceptionRow, today: string = kstDate()): UnhandledRow | null {
  const s = row.sheet;
  if (!s) return null;
  const date = String(row.receipt_date || "").slice(0, 10);
  return {
    key: `s:${s.source}:${s.sheetRow}`, source: "reception", kind: row.type as UnhandledKind, team: "", date,
    vendor: row.vendor || "", title: s.summary || row.field || "", assignee: row.handler || "", status: s.state || "",
    ageDays: date ? ageDaysOf(date, today) : 0, ...(s.linked && !row.id.startsWith("sheet:") ? { receptionId: row.id } : {}),
    ...(s.content ? { detail: s.content } : {}),
    sheet: { source: s.source, row: s.sheetRow, seq: s.seq || "", author: row.author || "", vendor: row.vendor || "" },
  };
}

/** CS 접수(앱 접수) 줄의 열린 연결 일정 1건(가장 최근 날짜) — 없으면 null. 실패는 throw */
export async function findOpenCopierTicket(receptionId: string): Promise<TicketForDone | null> {
  const { selectRows } = await import("./supabase");
  const rows = await selectRows<TicketForDone>("as_tickets",
    `select=id,vendor,scheduleType,team,naverUid,source,status&receptionId=eq.${encodeURIComponent(receptionId)}&status=neq.${encodeURIComponent("완료")}&order=date.desc&limit=1`);
  return rows[0] || null;
}

/**
 * 현황판 카드 → 미처리 줄 모양(2026-10-25 밤 — 모든 카드에 같은 단추). 시트 행은 boardSheetToUnhandled,
 * 앱 접수는 key r:<id>(홈 미처리와 같은 key → 누른 줄 pending 을 홈·현황판이 같이 쓴다). 복합기 AS 는 kind "CS접수".
 */
export function boardRowToUnhandled(row: ReceptionRow, today: string = kstDate()): UnhandledRow | null {
  if (row.sheet) return boardSheetToUnhandled(row, today);
  if (!row.id || row.id.startsWith("sheet:")) return null;
  const date = String(row.receipt_date || "").slice(0, 10);
  const kind = (row.type === "복합기 AS" ? "CS접수" : row.type) as UnhandledKind;
  return {
    key: `r:${row.id}`, source: "reception", kind, team: "", date, vendor: row.vendor || "", title: row.field || "",
    assignee: row.handler || "", status: row.status || "", ageDays: date ? ageDaysOf(date, today) : 0, receptionId: row.id,
  };
}

/** 현황판 카드 key(누른 줄 pending 과 맞추는 값) */
export const boardRowKey = (row: Pick<ReceptionRow, "id" | "sheet">): string => (row.sheet ? `s:${row.sheet.source}:${row.sheet.sheetRow}` : `r:${row.id}`);

/** 현황판 카드에 pending(방금 누른 [완료]·[보류]·[배정])을 입힌다 — 완료는 빼고, 보류는 상태, 배정은 처리자만 덮는다(60초 기다리지 않게) */
export function applyBoardPending<T extends Pick<ReceptionRow, "id" | "sheet" | "status" | "handler">>(rows: T[], now: number = Date.now()): T[] {
  const map = readPending(now);
  if (!Object.keys(map).length) return rows;
  const out: T[] = [];
  for (const r of rows) {
    const p = map[boardRowKey(r)];
    if (!p) { out.push(r); continue; }
    if (p.action === "done") continue;
    out.push(p.action === "hold" ? { ...r, status: p.value } : { ...r, handler: p.value });
  }
  return out;
}

const SHEET_LABEL: Record<string, string> = { sales: "영업시트", mgmt: "경영시트", remote: "원격시트" };
const isHeld = (s: string) => String(s || "").replace(/\s+/g, "") === "보류";

/**
 * [완료]·[보류] 확인창 문구 — "무엇이 일어나는지"(2026-10-25 밤 사용자 "누르면 확인 팝업").
 * null = 이 화면에서 확인창 없이 다른 창이 확인 역할(일정 줄·연결 일정 있는 CS 접수 → 완료 창). 배정은 이름 고르기 창이 확인 역할.
 * copierNoTicket: CS 접수 줄인데 열린 연결 일정이 없을 때.
 */
export function confirmTextFor(row: UnhandledRow, action: "done" | "hold", opts: { copierNoTicket?: boolean } = {}): string | null {
  const route = unhandledRoute(row);
  const who = row.vendor || "이 접수";
  const sheet = sheetRefOf(row);
  if (route === "ticket") return null;
  if (route === "copier") return action === "done" && opts.copierNoTicket ? `${who} — 연결된 일정이 없어 CS 접수 상태만 '완료'로 바꿉니다(완료자·시각 기록). 목록에서 빠집니다.` : null;
  if (route === "sheet" && sheet) {
    const where = `${SHEET_LABEL[sheet.source] || "시트"} ${sheet.row}행`;
    if (action === "done") return `${who} — ${where} 상태를 '처리완료'로 바꿉니다(접수일·내용은 그대로). 목록에서 빠집니다.`;
    return isHeld(row.status)
      ? `${who} — 보류를 풉니다. ${where} 상태를 '진행중'으로 바꿉니다(접수일·내용은 그대로).`
      : `${who} — ${where} 상태를 '보류'로 바꿉니다(접수일·내용은 그대로). 목록에는 '보류' 표시로 남습니다.`;
  }
  if (route === "remote") {
    return action === "done" ? `${who} — FIELD 접수를 완료로 바꾸고 원격 시트 처리여부를 '처리완료'로 적습니다(처리자가 비었으면 누른 사람). 목록에서 빠집니다.` : null;
  }
  if (route === "dept") {
    const deptSheet = row.kind !== "운영지원" ? " 부서 시트 상태 칸에도 적힙니다." : "";
    if (action === "done") return `${who} — 접수 상태를 '완료'로 바꿉니다(연결된 부서 달력 일정도 완료).${deptSheet} 목록에서 빠집니다.`;
    return isHeld(row.status)
      ? `${who} — 보류를 풉니다. 접수 상태를 '진행중'으로 바꿉니다.${deptSheet}`
      : `${who} — 접수 상태를 '보류'로 바꿉니다.${deptSheet} 목록에는 '보류' 표시로 남습니다.`;
  }
  return null;
}

/**
 * 확인창 → 처리. 취소면 아무것도 하지 않는다(pending·토스트·네트워크·onGo 없음). 확인창이 필요 없는 줄(null)은 바로 처리.
 * onGo = 확인 뒤 처리 직전(화면의 busy 표시·팝업 닫기).
 * 돌려주는 값: 취소 = null, 그 밖 = performUnhandledAction 결과.
 */
export async function confirmAndPerform(
  row: UnhandledRow, action: UnhandledActionKind, opts: { by: string; handler?: string; copierNoTicket?: boolean; reason?: string },
  ask: (text: string) => Promise<boolean>, notify: Notify, onGo?: () => void,
): Promise<boolean | null> {
  if (action === "hold" && holdNeedsReason(row) && !String(opts.reason || "").trim()) { notify("보류 사유를 적어 주세요", "error"); return false; }
  if (action !== "assign") {
    const text = confirmTextFor(row, action, { copierNoTicket: opts.copierNoTicket });
    if (text && !(await ask(text))) return null;
  }
  onGo?.();
  return performUnhandledAction(row, action, { by: opts.by, handler: opts.handler, reason: opts.reason }, notify);
}
