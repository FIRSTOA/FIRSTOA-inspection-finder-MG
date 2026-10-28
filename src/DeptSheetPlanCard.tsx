// 서비스접수 › 경영·영업 [일정리스트] [금일]의 시트 접수 카드(2026-10-28, docs/tasks/dept-plan-sheet-rows-2026-10-28.md 4절 2).
// 업체명 + "시트" 칩 + 분야 / 내용 40자 / "접수 10/28(화) 09:12 · 접수자" / 처리자 알약(빈칸 = 빨간 미배정, Q3).
// 열린 줄은 아래 [완료][보류][배정](UnhandledActionBar statusOnly — 시트 상태·처리자 칸만). 본문을 누르면 SheetListDetail 펼침.
// 완료 줄(오늘 접수돼 끝난 것)은 회색·취소선·"완료" 칩, 단추 없음.
import { useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import { sheetListToListRow, type SheetListRow } from "./receptionSheetOpen";
import { sheetListLine2, sheetListTime, sheetListUnhandledRow } from "./sheetListRowState";
import { kstDate } from "./visits";
import UnhandledActionBar from "./UnhandledActionBar.view";
import SheetListDetail from "./SheetListDetail";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (ymd: string) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${WEEK[new Date(`${ymd}T12:00:00`).getDay()]})` : "");

export default function DeptSheetPlanCard({ sheet, done, author, onSent }: { sheet: SheetListRow; done: boolean; author?: string; onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState("");
  const row = sheetListToListRow(sheet);
  const handler = sheet.handler.trim();
  const urow = done ? null : sheetListUnhandledRow(row, handler, kstDate());
  const time = sheetListTime(sheet.time);

  return (
    <div className={`space-y-1.5 px-3 py-2.5 ${done ? "bg-slate-50/60" : ""} ${after ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-11 min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className={`truncate text-[13px] font-black ${done ? "text-slate-400 line-through" : "text-slate-900"}`}>{sheet.vendor || "업체 미정"}</span>
            <span className="shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-500">시트</span>
            {!!sheet.field && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600">{sheet.field}</span>}
            {done && <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-600">완료</span>}
            {!done && sheet.cls === "hold" && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800">보류</span>}
            <ChevronDown size={13} className={`ml-auto shrink-0 text-slate-300 transition ${open ? "rotate-180" : ""}`} aria-hidden />
          </div>
          <div className={`mt-0.5 truncate text-[12px] font-semibold ${done ? "text-slate-400 line-through" : "text-slate-500"}`}>{sheetListLine2("", sheet.summary) || "-"}</div>
          <div className="mt-0.5 text-[11px] font-bold tabular-nums text-slate-400">
            접수 {dayLabel(sheet.date)}{time !== "--:--" ? ` ${time}` : ""}{sheet.author ? ` · 접수자 ${sheet.author}` : ""}
          </div>
        </button>
        {done ? (
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[12px] font-black text-slate-400">
            <UserRound size={13} aria-hidden />{handler || "-"}
          </span>
        ) : (
          // 처리자 바꾸기는 아래 [배정] 단추(시트 처리자 칸 statusOnly)로 — 앱 접수용 배정 창은 시트 줄에 쓰지 않는다
          <span title={handler ? `처리자 ${handler} — 바꾸려면 아래 [배정]` : "처리자 미배정 — 아래 [배정]"}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-[12px] font-black ${handler ? "border-slate-200 bg-white text-slate-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>
            <UserRound size={13} aria-hidden />{handler || "미배정"}
          </span>
        )}
      </div>
      {urow && (after
        ? <div role="status" className="text-[12px] font-bold text-emerald-700">{after}</div>
        : <UnhandledActionBar row={urow} author={author} onFinished={(action, ok) => {
          if (!ok) return; // 실패는 UnhandledActionBar 가 빨간 토스트로 알린다
          setAfter(action === "done" ? "처리완료로 보냈습니다 — 1~2분 뒤 반영" : action === "hold" ? "보류 상태를 보냈습니다 — 1~2분 뒤 반영" : "처리자를 보냈습니다 — 1~2분 뒤 반영");
          onSent?.();
        }} />)}
      {open && <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5"><SheetListDetail row={row} handler={handler} author={author} actions={false} /></div>}
    </div>
  );
}
