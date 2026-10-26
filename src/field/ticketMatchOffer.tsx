/* eslint-disable react-refresh/only-export-components -- 고르기 창(TicketPickSheet)과 그 창을 띄우는 함수(findTicketToFinish·askTicketPick)는 한 묶음이라 같은 파일에 둔다(2026-10-27) */
/**
 * FIELD 전송 뒤 일정 정리 제안 — 조회 + 고르기 창 (2026-10-27, 오류진).
 * 고르는 규칙은 ./ticketMatch.ts(순수 함수, 테스트 tests/ticketMatch.test.ts). 여기는 조회와 화면만.
 * 후보가 2건 이상이면 자동으로 하나를 고르지 않고 창을 띄운다(날짜·종류·담당·제목 + [해당 없음]).
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { selectRows } from "../supabase";
import { notify } from "../toast";
import { extractVendorFromText } from "../vendorLine";
import {
  OPEN_TICKET_STATUSES, describeTicket, pickTicketsForSentForm, sentFormKind, ticketTypesFor,
  type MatchTicketRow, type TicketCandidate,
} from "./ticketMatch";

export type TicketToFinish = { id: string; receptionId: string; vendor: string; detail: string };

function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function findTicketToFinish(args: { formText: string; destination?: string; mode: string; author: string; today: string }): Promise<TicketToFinish | null> {
  const kind = sentFormKind(args.destination, args.mode);
  if (!kind) return null;
  const vendor = extractVendorFromText(args.formText);
  if (!vendor.trim()) return null;
  const statusList = OPEN_TICKET_STATUSES.map(encodeURIComponent).join(",");
  const typeList = ticketTypesFor(kind).map(encodeURIComponent).join(",");
  let rows: MatchTicketRow[];
  try {
    rows = await selectRows<MatchTicketRow>("as_tickets",
      `select=id,vendor,date,team,status,scheduleType,assignee,receptionId,serial,asset,issue,source&date=gte.${addDays(args.today, -14)}&date=lte.${addDays(args.today, 2)}&status=in.(${statusList})&scheduleType=in.(${typeList})&limit=300`);
  } catch (e) {
    notify(`전송은 됐어요. 일정 맞춤 조회만 실패 — 일정리스트에서 직접 정리해 주세요 (${(e as Error).message})`, "info", { ms: 7000 });
    return null;
  }
  const { candidates, needsChoice } = pickTicketsForSentForm(rows, { vendor, kind, today: args.today, author: args.author, formText: args.formText });
  if (!candidates.length) return null;
  const chosen = needsChoice ? await askTicketPick(candidates) : candidates[0];
  if (!chosen) return null;
  return { id: chosen.row.id, receptionId: String(chosen.row.receptionId || ""), vendor: String(chosen.row.vendor || ""), detail: describeTicket(chosen) };
}

/** 후보 고르기 창 — 고르면 그 후보, [해당 없음]·바깥 누르면 null */
export function askTicketPick(candidates: TicketCandidate[]): Promise<TicketCandidate | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(null); return; }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (value: TicketCandidate | null) => {
      root.unmount();
      host.remove();
      resolve(value);
    };
    root.render(<TicketPickSheet candidates={candidates} onDone={done} />);
  });
}

export function TicketPickSheet({ candidates, onDone }: { candidates: TicketCandidate[]; onDone: (value: TicketCandidate | null) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-[300] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => onDone(null)}>
      <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="text-lg font-black text-slate-950">전송 완료 — 정리할 일정을 고르세요</div>
        <div className="mt-1 text-[12px] font-bold leading-5 text-slate-500">
          같은 업체의 미완료 일정이 {candidates.length}건 있어요. 방금 다녀온 일정만 고르세요. 관계없으면 [해당 없음].
        </div>
        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {candidates.map((c, i) => (
            <button key={c.row.id} type="button" onClick={() => setPicked(i)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left text-[13px] font-bold leading-5 transition ${picked === i ? "border-blue-500 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
              {describeTicket(c)}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onDone(null)} className="rounded-lg border border-slate-200 py-3 text-sm font-bold text-slate-500">해당 없음</button>
          <button type="button" disabled={picked === null} onClick={() => picked !== null && onDone(candidates[picked])}
            className="rounded-full bg-blue-600 py-3 text-sm font-black text-white disabled:bg-slate-200">이 일정 정리</button>
        </div>
      </div>
    </div>
  );
}
