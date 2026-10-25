/**
 * CS 접수·물류 일정 완료 — 일정리스트 [완료]와 홈 미처리 [완료]가 같은 규칙을 쓰게 한 곳에 모은 모듈
 * (설계 docs/tasks/unhandled-actions-2026-10-25.md 5-1절).
 *
 * - 판정 순수 함수 3개(naverCompleteAction · receptionStatusFromSiblings · copierDoneText)는
 *   일정리스트(CsAsWorkspace)도 그대로 부른다 — 규칙이 두 벌로 갈라지지 않게.
 * - completeTicket 은 화면 상태 없이 DB 기준으로 완료 전 과정을 순서대로 한다:
 *   ① as_tickets 최신 행 읽기 → 완료 + 메모 블록 PATCH (실패면 여기서 멈춤)
 *   ② 연결 접수 상태(형제 일정 중 가장 앞선 단계) ③ 접수 시트 BD열 ④ 네이버 완료
 *   ⑤ 매월 반복 다음 달 행 ⑥ 방문일지 ⑦ 팀 AS방 공유
 *   ②~⑦ 실패는 삼키지 않고 warnings 로 돌려준다(완료 자체는 유지).
 * - App.tsx finishTicket(FIELD 전송 뒤 완료)은 세 번째 사본으로 남아 있다 — 후속 과제.
 *
 * 물류(납품철수교체) 네이버: 2026-08-26 "영업부 소관 — 안 건드림" 결정을 2026-10-25 사용자가 바꿈 →
 * 그 캘린더 그 자리에서 완료 체크만 한다. 옮기기·지우기·내용 덧붙이기는 여전히 하지 않는다.
 */
import type { AsTicket } from "./CsAsWorkspace";
import { buildActionBlock, type ActionTicketLike } from "./actionBlock";
import { getServiceReceptionById, sendReceptionCopierCompleteJob, sendServiceReception, setServiceReceptionStatus } from "./api";
import { fieldTicketVendor } from "./ids";
import { invokeEdgeFunction, selectRows, updateRows, upsertRow } from "./supabase";
import { kstDate, saveVisit, type VisitDraft } from "./visits";

/** 납품철수교체휴가교육 네이버 캘린더 id (CsAsWorkspace NAVER_DELIVERY_CAL 과 같은 값) */
export const NAVER_DELIVERY_CAL_ID = "75632617";
/** 완료되면 창에 쏘는 이벤트 — 떠 있는 일정리스트가 다시 읽는다 */
export const TICKETS_CHANGED_EVENT = "tickets-changed";

export type DoneMode = "visit" | "phone";
/** 완료 창(DoneReasonModal)에서 받은 값 — text 는 처리 내용, mode 는 방문/전화(물류는 없음) */
export type DoneReason = { text: string; mode?: DoneMode };

export function isDeliveryTicket(t: { scheduleType?: string | null }): boolean {
  return t.scheduleType === "납품철수교체휴가교육" || t.scheduleType === "물류";
}

// ── 판정 순수 함수 ──────────────────────────────────────────────

/**
 * 네이버 완료 방식.
 * - none: 네이버 미러 없음
 * - check: 그 캘린더 그 자리에서 완료 체크(IT 캘린더·물류 캘린더). writeNote=false 면 내용 덧붙이기도 안 함(물류)
 * - move: 팀 완료 캘린더로 이동 + 완료 체크(caldav_move)
 * calId 가 비면 엣지 함수가 설정 캘린더(NAVER_CALENDAR_ID)에서 찾는다.
 */
export type NaverCompletePlan =
  | { kind: "none" }
  | { kind: "check"; calId: string; writeNote: boolean; target: "it" | "delivery" }
  | { kind: "move"; team: string; writeNote: true };

export function naverCompleteAction(
  t: { naverUid?: string | null; scheduleType?: string | null; source?: string | null; team?: string | null },
  opts: { itCalId?: string } = {},
): NaverCompletePlan {
  if (!String(t.naverUid || "").trim()) return { kind: "none" };
  if (isDeliveryTicket(t)) return { kind: "check", calId: NAVER_DELIVERY_CAL_ID, writeNote: false, target: "delivery" };
  if (t.source === "it") return { kind: "check", calId: opts.itCalId || "", writeNote: true, target: "it" };
  return { kind: "move", team: String(t.team || ""), writeNote: true };
}

export type ReceptionStage = "완료" | "진행중" | "접수";
/** 같은 접수에 걸린 일정들의 상태 → 접수 상태. 가장 앞선 단계로 집계(재방문 B 일정이 A 완료를 되돌리지 않게) */
export function receptionStatusFromSiblings(statuses: Array<string | null | undefined>): ReceptionStage {
  const mappedOf = (st: string | null | undefined): ReceptionStage => (st === "완료" ? "완료" : st === "배정" ? "진행중" : "접수");
  const rank: Record<ReceptionStage, number> = { 완료: 2, 진행중: 1, 접수: 0 };
  return statuses.map(mappedOf).reduce<ReceptionStage>((a, b) => (rank[a] >= rank[b] ? a : b), "접수");
}

/** 접수 시트 BD열(처리완료) 문구 — "완료 M/D HH:mm 이름" · "익일 M/D HH:mm" · 되돌림 "-" (시각은 기기 시각, 기존과 같음) */
export function copierDoneText(kind: "완료" | "익일" | "-", at: Date, by = ""): string {
  if (kind === "-") return "-";
  const stamp = `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return `${kind} ${stamp}${kind === "완료" && by ? ` ${by}` : ""}`;
}

/** 상태 변화 → BD열에 쓸 종류. 완료/익일은 표기, 완료·익일에서 되돌리면 "-", 그 외는 안 씀("") */
export function copierDoneKind(next: string, before: string): "완료" | "익일" | "-" | "" {
  if (next === "완료") return "완료";
  if (next === "익일") return "익일";
  return before === "완료" || before === "익일" ? "-" : "";
}

// ── 완료 실행 ───────────────────────────────────────────────

type TicketRow = Partial<AsTicket> & { id: string; vendor?: string; team?: string; status?: string };
type ReceptionLite = { type?: string | null; lease_no?: string | null; author?: string | null; vendor?: string | null; sheet_row?: number | null };

/** 바깥 의존(네트워크) — 테스트에서 갈아 끼운다 */
export type CompletionDeps = {
  readTicket: (id: string) => Promise<TicketRow | null>;
  patchTicket: (id: string, patch: Record<string, unknown>) => Promise<void>;
  readSiblings: (receptionId: string) => Promise<Array<{ id: string; status: string; assignee?: string }>>;
  setReceptionStatus: (id: string, status: ReceptionStage, done: { at: string | null; by: string }) => Promise<void>;
  getReception: (id: string) => Promise<ReceptionLite | null>;
  sendCopierDone: (input: { author: string; vendor: string; firstNo: string; sheetRow: number | null; doneText: string }) => Promise<void>;
  loadItCalId: () => Promise<string>;
  naver: <T>(body: Record<string, unknown>) => Promise<T>;
  findMonthlyDup: (clone: Record<string, unknown>) => Promise<boolean>;
  buildMonthlyClone: (row: Record<string, unknown>) => Promise<Record<string, unknown>>;
  saveClone: (clone: Record<string, unknown>) => Promise<void>;
  findVisitDup: (author: string, vendor: string, day: string) => Promise<boolean>;
  saveVisit: (draft: VisitDraft, sourceText: string) => Promise<unknown>;
  sendKakao: (region: string, text: string) => Promise<{ ok?: boolean; error?: string }>;
  now: () => Date;
  emitChanged: (id: string) => void;
};

const enc = encodeURIComponent;

export const defaultCompletionDeps: CompletionDeps = {
  readTicket: async (id) => (await selectRows<TicketRow>("as_tickets", `id=eq.${enc(id)}&select=*&limit=1`))[0] || null,
  patchTicket: (id, patch) => updateRows("as_tickets", `id=eq.${enc(id)}`, patch),
  readSiblings: (rid) => selectRows<{ id: string; status: string; assignee?: string }>("as_tickets", `select=id,status,assignee&receptionId=eq.${enc(rid)}&limit=100`),
  setReceptionStatus: (id, status, done) => setServiceReceptionStatus(id, status, done),
  getReception: (id) => getServiceReceptionById(id),
  sendCopierDone: (input) => sendReceptionCopierCompleteJob(input),
  loadItCalId: async () => {
    const rows = await selectRows<{ value: string }>("app_config", "select=value&key=eq.NAVER_TEAM_CALENDAR_IT&limit=1");
    return String(rows[0]?.value || "").trim();
  },
  naver: (body) => invokeEdgeFunction("naver-calendar-push", body),
  // 같은 업체·날짜·유형 일정이 이미 있으면(시리즈 미리 생성분) 만들지 않는다 — App.tsx spawnMonthlyCloneIfMissing 과 같은 조회
  findMonthlyDup: async (clone) => (await selectRows<{ id: string }>("as_tickets",
    `select=id&vendor=eq.${enc(String(clone["vendor"] || ""))}&date=eq.${enc(String(clone["date"] || ""))}&${enc("scheduleType")}=eq.${enc(String(clone["scheduleType"] || ""))}&limit=1`)).length > 0,
  // 드물게 쓰는 길이라 그때 받는다(App.tsx 와 같은 방식) — 홈 묶음에 일정리스트 화면이 딸려 오지 않게
  buildMonthlyClone: async (row) => (await import("./CsAsWorkspace")).buildMonthlyCloneRow(row),
  saveClone: (clone) => upsertRow("as_tickets", clone, "id"),
  findVisitDup: async (author, vendor, day) => (await selectRows<{ id: string }>("visit_logs",
    `select=id&author=eq.${enc(author)}&vendor=eq.${enc(vendor)}&work_date=eq.${day}&limit=1`)).length > 0,
  saveVisit: (draft, sourceText) => saveVisit(draft, sourceText),
  sendKakao: (region, text) => sendServiceReception("AS", region, text),
  now: () => new Date(),
  emitChanged: (id) => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TICKETS_CHANGED_EVENT, { detail: { id } }));
  },
};

export type CompletionResult = {
  ok: boolean;
  /** ①이 실패했을 때 이유(나머지는 안 함) */
  error?: string;
  /** ②~⑦ 중 실패한 것 — 완료는 유지, 화면에 토스트로 */
  warnings: string[];
  /** 성공 안내(네이버 이동·체크 등) — 원하면 토스트로 */
  infos: string[];
  /** 이미 완료된 일정이라 아무것도 안 했음 */
  alreadyDone?: boolean;
  /** 실제로 거친 단계 이름(순서대로) — 확인·테스트용 */
  steps: string[];
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e || "오류"));

/**
 * 일정 1건 완료. ticket 은 id 만 있어도 된다 — 메모 덮어쓰기를 막으려고 항상 DB 최신 행을 다시 읽는다.
 * ctx.author = 누른 사람(블록의 작성자·방문일지 작성자). ctx.today 를 안 주면 KST 오늘.
 */
export async function completeTicket(
  ticket: string | { id: string },
  reason: DoneReason,
  ctx: { author: string; today?: string; itCalId?: string },
  deps: CompletionDeps = defaultCompletionDeps,
): Promise<CompletionResult> {
  const id = typeof ticket === "string" ? ticket : ticket.id;
  const warnings: string[] = [];
  const infos: string[] = [];
  const steps: string[] = [];
  const author = (ctx.author || "").trim();
  const text = (reason.text || "").trim();

  // ① 최신 행 읽기 → 완료 PATCH. 여기 실패면 멈춘다(나머지 단계가 완료 안 된 일정을 건드리지 않게)
  let row: TicketRow | null;
  try {
    row = await deps.readTicket(id);
  } catch (e) {
    return { ok: false, error: `일정을 못 읽어 멈췄어요(메모 덮어쓰기 방지) — 저장 안 함, 다시 시도해 주세요. (${errText(e)})`, warnings, infos, steps };
  }
  if (!row) return { ok: false, error: "일정을 찾지 못했어요 — 이미 지워졌을 수 있습니다", warnings, infos, steps };
  if (row.status === "완료") return { ok: true, alreadyDone: true, warnings, infos, steps };
  const delivery = isDeliveryTicket(row);
  const block = buildActionBlock(row as unknown as ActionTicketLike, { author: author || String(row.assignee || ""), reason: reason.text || "" });
  const note = block ? `${String(row.note || "").trim() ? `${row.note}\n\n` : ""}${block}` : String(row.note || "");
  try {
    await deps.patchTicket(id, { status: "완료", note });
    steps.push("patch");
  } catch (e) {
    return { ok: false, error: `완료 저장 실패: ${errText(e)}`, warnings, infos, steps };
  }
  const now = deps.now();

  // ② 연결 접수 상태 — 형제 일정 중 가장 앞선 단계
  const receptionId = String(row.receptionId || "").trim();
  let doneBy = String(row.assignee || "") || author;
  if (receptionId) {
    steps.push("reception");
    try {
      const sibs = await deps.readSiblings(receptionId);
      // 방금 PATCH 한 행이 아직 옛 상태로 오더라도 완료로 본다
      const list = [...sibs.filter((s) => s.id !== id), { id, status: "완료", assignee: String(row.assignee || "") }];
      const stage = receptionStatusFromSiblings(list.map((s) => s.status));
      const doneTicket = list.find((s) => s.status === "완료");
      doneBy = (doneTicket?.assignee || "") || author;
      await deps.setReceptionStatus(receptionId, stage, stage === "완료" ? { at: now.toISOString(), by: doneBy } : { at: null, by: "" });
    } catch (e) {
      warnings.push(`접수 상태 반영 실패: ${errText(e)}`);
    }

    // ③ 접수 시트 BD열 — 복합기 AS + 퍼스트순 있을 때만
    steps.push("sheet");
    try {
      const rec = await deps.getReception(receptionId);
      if (rec && rec.type === "복합기 AS" && rec.lease_no) {
        await deps.sendCopierDone({ author: String(rec.author || ""), vendor: String(rec.vendor || ""), firstNo: String(rec.lease_no), sheetRow: rec.sheet_row ?? null, doneText: copierDoneText("완료", now, doneBy) });
      }
    } catch (e) {
      warnings.push(`접수 시트 완료 표시 실패: ${errText(e)}`);
    }
  }

  // ④ 네이버 — 내용 기록(get→update) 다음 이동/체크. 두 요청을 겹치지 않게 이 순서로(2026-09-16 사고)
  let itCalId = ctx.itCalId || "";
  if (row.naverUid && row.source === "it" && !itCalId) itCalId = await deps.loadItCalId().catch(() => "");
  const plan = naverCompleteAction(row, { itCalId });
  if (plan.kind !== "none") {
    steps.push(`naver:${plan.kind}`);
    const uid = String(row.naverUid);
    const calPart = plan.kind === "check" && plan.calId ? { calId: plan.calId } : {};
    try {
      if (plan.writeNote && text) {
        const cur = await deps.naver<{ description?: string }>({ action: "caldav_get", uid, ...calPart });
        await deps.naver({ action: "caldav_update", uid, description: `${cur.description || ""}\n\n${block}`, ...calPart });
      }
      if (plan.kind === "check") {
        await deps.naver({ action: "caldav_check", uid, done: true, ...calPart });
        infos.push(plan.target === "it" ? "네이버: IT 캘린더에서 완료 체크 ✓" : "네이버: 납품철수교체 캘린더에서 완료 체크 ✓ (이동 없음)");
      } else {
        const r = await deps.naver<{ status?: string }>({ action: "caldav_move", uid, team: plan.team });
        if (r.status === "moved") infos.push(`네이버: ${plan.team}팀 완료 캘린더로 이동 + 완료 체크 ✓`);
      }
    } catch (e) {
      warnings.push(`네이버 완료 처리 실패: ${errText(e)}`);
    }
  }

  // ⑤ 매월 반복 — 다음 달 일정이 없을 때만 1행
  if (row.repeatMonthly) {
    steps.push("monthly");
    try {
      const clone = await deps.buildMonthlyClone(row as unknown as Record<string, unknown>);
      if (!(await deps.findMonthlyDup(clone))) await deps.saveClone(clone);
    } catch (e) {
      warnings.push(`다음 달 반복 일정 생성 실패: ${errText(e)}`);
    }
  }

  // ⑥ 방문일지 — 방문이면 방문 1·AS 1, 전화·원격이면 기록만(visited=false). 같은 날 같은 업체가 이미 있으면 건너뜀
  if (reason.mode && author) {
    steps.push("visit");
    try {
      const day = ctx.today || kstDate(now);
      const vendor = fieldTicketVendor(String(row.vendor || "")).vendor || String(row.vendor || "");
      const dup = await deps.findVisitDup(author, vendor, day).catch(() => false);
      if (!dup) {
        await deps.saveVisit({
          visited: reason.mode === "visit", vendor, author, workDate: day, arrivalTime: "", machineCount: 1, grade: String(row.grade || ""),
          contractEnded: false, workKinds: ["as"], minutes: {}, salesIt: "", salesCopier: "", commute: "",
          note: `일정리스트 완료(${reason.mode === "visit" ? "방문" : "전화·원격"})${text ? ` — ${text}` : ""}`,
        }, `as-ticket:${id}`);
      }
    } catch (e) {
      warnings.push(`방문일지 기록 실패: ${errText(e)}`);
    }
  }

  // ⑦ 팀 AS방 공유 — 처리 내용이 있을 때만, 물류는 보내지 않음(물류방 보고는 FIELD 물류 양식이 담당, 2026-08-25)
  if (text && !delivery) {
    steps.push("kakao");
    try {
      const r = await deps.sendKakao(`수도권${row.team || ""}`, block);
      if (!r.ok) warnings.push(`카톡 전송 실패: ${r.error || "오류"}`);
    } catch (e) {
      warnings.push(`카톡 전송 실패: ${errText(e)}`);
    }
  }

  deps.emitChanged(id);
  return { ok: true, warnings, infos, steps };
}
