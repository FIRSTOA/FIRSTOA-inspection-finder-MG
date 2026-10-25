import { useState } from "react";
import { isDeliveryTicket, naverCompleteAction, type DoneMode } from "./ticketCompletion";

export type DoneReasonTicket = { vendor: string; scheduleType: string; team: string; naverUid?: string; source?: string };

// 완료 사유 입력 — 적으면 팀 AS방 카톡 + 네이버 일정 내용에 남고, 비우면 조용히 완료만
// 일정리스트(CsAsWorkspace)와 홈 미처리 [완료]가 같은 창을 띄운다(2026-10-25)
export default function DoneReasonModal({ ticket, onClose, onApply }: { ticket: DoneReasonTicket; onClose: () => void; onApply: (reason: string, mode?: DoneMode) => void }) {
  const [reason, setReason] = useState("");
  // 방문해서 처리했는지, 전화·원격으로 끝냈는지 — 주간현황판의 AS·방문 건수가 여기서 갈린다(2026-09-24)
  const [mode, setMode] = useState<DoneMode>("visit");
  const isDelivery = isDeliveryTicket(ticket);
  const plan = naverCompleteAction(ticket);
  return (
    <div className="fixed inset-0 z-[130] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-lg font-black text-slate-950">✓ 완료 처리하시겠습니까?</div>
        <div className="mt-1 text-sm font-semibold text-slate-500">{ticket.vendor}</div>
        {isDelivery
          ? <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold leading-5 text-slate-600">물류(납품·철수·교체) 일정입니다. 카톡은 보내지 않습니다 — 물류방 보고는 FIELD 물류 양식 [보내기]가 이미 했습니다.{plan.kind !== "none" && <><br />네이버 캘린더(납품철수교체)에는 그 자리에서 <b>완료 체크만</b> 합니다 — 옮기거나 지우지 않습니다.</>}</div>
          : plan.kind === "check"
            ? <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">네이버 IT 캘린더에서 그 자리에 완료 체크됩니다.</div>
            : plan.kind === "move" && <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">네이버 캘린더 일정에 완료 체크됩니다. {ticket.team}팀 완료 캘린더로 이동합니다.</div>}
        {!isDelivery && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("visit")} className={`rounded-xl border-2 px-3 py-2.5 text-left transition ${mode === "visit" ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
              <span className="block text-sm font-black text-slate-900">🚗 방문 처리</span>
              <span className="block text-[11px] font-bold text-slate-500">방문해서 처리한 건 — 방문 거래처 1·AS 1건으로 집계</span>
            </button>
            <button type="button" onClick={() => setMode("phone")} className={`rounded-xl border-2 px-3 py-2.5 text-left transition ${mode === "phone" ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
              <span className="block text-sm font-black text-slate-900">📞 전화·원격 처리</span>
              <span className="block text-[11px] font-bold text-slate-500">전화·원격으로 처리한 건 — 기록만 남고 집계에는 안 들어감</span>
            </button>
          </div>
        )}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
          placeholder={isDelivery
            ? "처리 내용 (선택) — 일정리스트 기록에만 남습니다. 비워도 완료됩니다"
            : "처리 내용 (필수) — 팀 AS방으로 전송되고 네이버 일정에도 기록됩니다"}
          className="mt-4 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600">취소</button>
          <button type="button" disabled={!isDelivery && !reason.trim()} onClick={() => onApply(reason, isDelivery ? undefined : mode)} className="flex-1 rounded-full bg-blue-600 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40">완료</button>
        </div>
      </div>
    </div>
  );
}
