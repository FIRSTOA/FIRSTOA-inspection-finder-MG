/**
 * 미처리 한 줄 단추 줄 [완료] [보류] [배정] — 홈 미처리 팝업·서비스접수 부서 미니 업무공간·접수 현황판 시트 카드가 같이 쓴다(2026-10-25).
 * 설계: docs/tasks/unhandled-actions-2026-10-25.md 4절(화면 흐름)·5절(단추 → 함수, unhandledActions.ts).
 *  · 완료 = 초록 실선, 보류 = 회색 외곽, 배정 = 처리자 알약. 폰은 3등분(min-h-11).
 *  · 원격·IT 는 보류 없음(Q1). CS접수·물류(일정)는 [완료]만 — 일정리스트와 같은 완료 창(DoneReasonModal, Q3).
 *  · 처리 중에는 단추 잠금(두 번 누름 방지). 결과·실패는 토스트(unhandledActions.performUnhandledAction).
 *  · 2026-10-25 밤: [완료]·[보류]는 "무엇이 바뀌는지" 확인창(unhandledActions.confirmTextFor) — 취소면 아무 변화 없음.
 *    CS 접수(현황판 앱 접수 줄)는 열린 연결 일정이 있으면 그 일정의 완료 창, 없으면 확인창 뒤 접수 상태만 완료.
 * 겹침: FormModal(z-200) 위에서 배정 창·완료 창을 띄우므로 body 포털 + z-[300] 감싸기.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, Loader2, Pause, UserRound } from "lucide-react";
import type { UnhandledRow } from "./homeUnhandled";
import {
  confirmAndPerform, findOpenCopierTicket, holdNeedsReason, confirmTextFor, loadTicketForDone, performTicketDone, sheetRefOf, unhandledButtons, unhandledRoute,
  friendlyError, type TicketForDone, type UnhandledActionKind,
} from "./unhandledActions";
import { sheetRowUrl } from "./receptionSheetOpen";
import { useAuthorBook, useMembers } from "./authors";
import { deptMemberNames } from "./deptPlan";
import { isDeptType } from "./deptReception";
import { resolveActor } from "./deptReceptionFlow";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { formatAssignees } from "./assignees";
import AssigneePicker from "./AssigneePicker";
import FormModal from "./FormModal";
import { forgetUnhandledDetail } from "./unhandledDetail";

const DoneReasonModal = lazy(() => import("./DoneReasonModal"));

const SOURCE_NAME: Record<string, string> = { sales: "영업시트", mgmt: "경영시트", remote: "원격시트" };

/** 시트 출처 줄의 작은 글자 링크 "영업시트 12행 ↗"(확인용, 단추 아님). 시트 출처가 아니면 null */
export function SheetRowLink({ row }: { row: Pick<UnhandledRow, "key" | "sheet" | "vendor"> }) {
  const s = sheetRefOf(row);
  if (!s) return null;
  return (
    <a href={sheetRowUrl(s.source, s.row)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-700 underline-offset-2 hover:underline">
      {SOURCE_NAME[s.source] || "시트"} {s.row}행<ExternalLink size={11} aria-hidden />
    </a>
  );
}

type ButtonsProps = {
  row: UnhandledRow;
  busy: UnhandledActionKind | "";
  onDone: () => void;
  onHold: () => void;
  onAssign: () => void;
  onOpenSchedule?: () => void;
};

/** 표시 전용 단추 줄(렌더 테스트용으로 따로) */
export function UnhandledActionButtons({ row, busy, onDone, onHold, onAssign, onOpenSchedule }: ButtonsProps) {
  const b = unhandledButtons(row);
  if (!b.done && !b.hold && !b.assign) return null;
  const locked = !!busy;
  const spin = (k: UnhandledActionKind) => (busy === k ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null);
  const holdLabel = String(row.status || "").replace(/\s+/g, "") === "보류" ? "보류 풀기" : "보류";
  const assignee = formatAssignees(row.assignee, { short: true });
  const base = "inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl px-3 text-[13px] font-black transition disabled:opacity-50 sm:min-h-9 sm:flex-none";
  return (
    <div className="flex w-full flex-wrap items-stretch gap-1.5" role="group" aria-label="미처리 처리">
      {b.done && (
        <button type="button" disabled={locked} onClick={onDone} data-act="done"
          className={`${base} bg-emerald-600 text-white hover:bg-emerald-700`}>
          {spin("done") || <Check size={14} aria-hidden />}{busy === "done" ? "처리 중…" : "완료"}
        </button>
      )}
      {b.hold && (
        <button type="button" disabled={locked} onClick={onHold} data-act="hold"
          className={`${base} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}>
          {spin("hold") || <Pause size={14} aria-hidden />}{busy === "hold" ? "처리 중…" : holdLabel}
        </button>
      )}
      {b.assign && (
        <button type="button" disabled={locked} onClick={onAssign} data-act="assign" title="처리자 배정"
          className={`${base} rounded-full border ${assignee ? "border-blue-200 bg-blue-50 text-blue-800" : "border-rose-200 bg-rose-50 text-rose-700"} hover:brightness-95`}>
          {spin("assign") || <UserRound size={14} aria-hidden />}<span className="truncate">{busy === "assign" ? "처리 중…" : assignee || "미배정"}</span>
        </button>
      )}
      {b.openSchedule && onOpenSchedule && (
        <button type="button" onClick={onOpenSchedule} data-act="open"
          className={`${base} border border-slate-200 bg-white text-[12px] text-slate-500 hover:bg-slate-50`}>
          일정리스트에서 열기
        </button>
      )}
    </div>
  );
}

type Props = {
  row: UnhandledRow;
  /** 화면의 작성자 선택값(없으면 로그인 이름·기기 작성자) */
  author?: string;
  /** 처리를 시작했을 때(낙관 제거 직후) — 팝업 닫기 등 */
  onStarted?: (action: UnhandledActionKind) => void;
  /** 처리가 끝났을 때(성공 여부) — 목록 다시 읽기 등 */
  onFinished?: (action: UnhandledActionKind, ok: boolean) => void;
  /** CS접수 줄 보조 단추 [일정리스트에서 열기] */
  onOpenSchedule?: () => void;
};

const layer = (node: React.ReactNode) => (typeof document === "undefined" ? null : createPortal(<div className="relative z-[300]">{node}</div>, document.body));

export default function UnhandledActionBar({ row, author, onStarted, onFinished, onOpenSchedule }: Props) {
  const [busy, setBusy] = useState<UnhandledActionKind | "">("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [freeName, setFreeName] = useState("");
  const [holdOpen, setHoldOpen] = useState(false); // 보류 사유 창(부서 접수 줄, 2026-10-27)
  const [holdReason, setHoldReason] = useState("");
  const [ticket, setTicket] = useState<TicketForDone | null>(null);
  const members = useMembers();
  const { book } = useAuthorBook();
  const route = unhandledRoute(row);
  const names = useMemo(() => {
    if (route === "remote" || row.kind === "원격이관" || row.kind === "IT") return book.IT || [];
    return isDeptType(row.kind) ? deptMemberNames(row.kind, members) : [];
  }, [route, row.kind, book, members]);

  // 확인창(완료·보류) → 처리. 취소면 busy·pending·토스트 모두 그대로(아무 변화 없음)
  const run = async (action: UnhandledActionKind, handler?: string, extra: { copierNoTicket?: boolean; reason?: string } = {}) => {
    if (busy) return;
    const ok = await confirmAndPerform(row, action, { by: resolveActor(author), handler, ...extra },
      (text) => extra.reason ? Promise.resolve(true) : // 사유 창이 확인 역할을 이미 했다
 askConfirm(text, { okLabel: action === "done" ? "완료" : String(row.status || "").replace(/\s+/g, "") === "보류" ? "보류 풀기" : "보류" }),
      notify, () => { setBusy(action); onStarted?.(action); });
    if (ok === null) return;
    setBusy("");
    forgetUnhandledDetail(row); // 처리 끝난 행의 상세 캐시 버림(처리 중 미리 읽기로 옛 본문이 다시 캐시되는 틈 막기, 검수아 2026-10-25)
    onFinished?.(action, ok);
  };

  const onDone = async () => {
    if (busy) return;
    if (route === "ticket") {
      setBusy("done");
      try {
        const t = await loadTicketForDone(row.key.slice(2));
        if (t.status === "완료") { notify(`${row.vendor || "일정"} — 이미 완료된 일정입니다`, "info"); onFinished?.("done", true); return; }
        setTicket(t);
      } catch (e) {
        notify(`일정을 못 읽었습니다: ${friendlyError(e)}`, "error");
      } finally { setBusy(""); }
      return;
    }
    if (route === "copier") {
      // CS 접수(앱 접수): 열린 연결 일정이 있으면 그 일정 완료 창(일정리스트와 같은 completeTicket), 없으면 접수만 완료
      setBusy("done");
      let t: TicketForDone | null = null;
      try {
        t = await findOpenCopierTicket(String(row.receptionId));
      } catch (e) {
        notify(`연결 일정을 못 읽었습니다: ${friendlyError(e)}`, "error");
        setBusy("");
        return;
      }
      setBusy("");
      if (t) { setTicket(t); return; }
      await run("done", undefined, { copierNoTicket: true });
      return;
    }
    await run("done");
  };

  const applyTicket = async (reason: string, mode?: "visit" | "phone") => {
    const t = ticket;
    setTicket(null);
    setBusy("done");
    onStarted?.("done");
    const ok = await performTicketDone(row, { text: reason, mode }, resolveActor(author), notify, route === "copier" && t ? t.id : undefined);
    setBusy("");
    forgetUnhandledDetail(row);
    onFinished?.("done", ok);
  };

  const onHold = () => { if (holdNeedsReason(row)) { setHoldReason(""); setHoldOpen(true); } else void run("hold"); };
  const saveHold = () => { const reason = holdReason.trim(); if (!reason) return; setHoldOpen(false); void run("hold", undefined, { reason }); };
  const openAssign = () => { setFreeName(String(row.assignee || "").split(/[,·]/)[0].trim()); setAssignOpen(true); };
  const saveAssign = (v: string) => { setAssignOpen(false); void run("assign", String(v || "").split(/[,·]/)[0].trim()); };

  return (
    <>
      <UnhandledActionButtons row={row} busy={busy} onDone={() => void onDone()} onHold={onHold} onAssign={openAssign} onOpenSchedule={onOpenSchedule} />
      {assignOpen && layer(names.length ? (
        <AssigneePicker names={names} value={String(row.assignee || "")} max={1} title="처리자 배정"
          subtitle={`${row.vendor || "업체 미정"} · 1명${sheetRefOf(row) || route === "remote" || (route === "dept" && row.kind !== "운영지원") ? " · 저장하면 시트 처리자 칸에 적힘" : ""}`}
          onClose={() => setAssignOpen(false)} onSave={saveAssign} />
      ) : (
        <FormModal title="처리자 배정" subtitle={`${row.vendor || "업체 미정"} · 명단이 비어 있어 이름을 직접 적습니다`} onClose={() => setAssignOpen(false)}
          footer={(
            <div className="flex w-full justify-end gap-2">
              <button type="button" onClick={() => setAssignOpen(false)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 sm:min-h-9">닫기</button>
              <button type="button" onClick={() => saveAssign(freeName)} className="min-h-11 rounded-lg bg-emerald-600 px-4 text-xs font-black text-white hover:bg-emerald-700 sm:min-h-9">배정 저장</button>
            </div>
          )}>
          <input value={freeName} autoFocus onChange={(e) => setFreeName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveAssign(freeName); }}
            placeholder="처리자 이름" aria-label="처리자 이름" className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-500" />
        </FormModal>
      ))}
      {holdOpen && layer(
        <FormModal title="보류" subtitle={confirmTextFor(row, "hold") || row.vendor || ""} onClose={() => setHoldOpen(false)}
          footer={(
            <div className="flex w-full justify-end gap-2">
              <button type="button" onClick={() => setHoldOpen(false)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 sm:min-h-9">닫기</button>
              <button type="button" disabled={!holdReason.trim()} onClick={saveHold} className="min-h-11 rounded-lg bg-amber-500 px-4 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-40 sm:min-h-9">보류 확정</button>
            </div>
          )}>
          <input value={holdReason} autoFocus onChange={(e) => setHoldReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveHold(); }}
            placeholder="사유(필수)" aria-label="보류 사유" className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-500" />
          {!holdReason.trim() && <p className="mt-1.5 text-[11px] font-bold text-amber-700">사유를 적어야 보류할 수 있습니다.</p>}
        </FormModal>,
      )}
      {ticket && layer(
        <Suspense fallback={null}>
          <DoneReasonModal ticket={ticket} onClose={() => setTicket(null)} onApply={(reason, mode) => void applyTicket(reason, mode)} />
        </Suspense>,
      )}
    </>
  );
}
