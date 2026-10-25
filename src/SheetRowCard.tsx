// 시트 행 카드(C3 시트 기준) — 현황판 카드의 단추 자리에 들어간다. [시트 내용] 을 누르면 펼쳐서
// 접수일·업체·분야·처리자·상태·내용 요약과 [완료][보류][배정](UnhandledActionBar — 홈 미처리 팝업과 같은 부품, 2026-10-25).
// 단추는 시트 상태·처리자 칸만 적는다(field-sheet-sync statusOnly). 시트 링크는 확인용 작은 글자.
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { ReceptionRow } from "./ReceptionBoard";
import { sheetStateLabel } from "./receptionSheetState";
import { boardSheetToUnhandled } from "./unhandledActions";
import UnhandledActionBar from "./UnhandledActionBar.view";


const SOURCE_LABEL: Record<string, string> = { sales: "해지방어접수(영업)", mgmt: "경영지원접수", remote: "원격" };

export default function SheetRowCard({ row, author, onFinished }: { row: ReceptionRow; author?: string; onFinished?: () => void }) {
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState("");
  const sheet = row.sheet;
  const urow = boardSheetToUnhandled(row);
  if (!sheet) return null;
  const items: Array<[string, string]> = [
    ["접수일", row.receipt_date || "날짜 모름"],
    ["업체", row.vendor || "업체 미정"],
    ["분야", row.field || "-"],
    ["접수", row.author || "-"],
    ["처리", row.handler || "미지정"],
    ["상태", sheetStateLabel(sheet.state)],
  ];
  return (
    <div className="w-full">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-bold text-slate-600 transition hover:border-slate-400 hover:text-slate-900">
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}시트 내용 · 처리
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
          <div className="text-[11px] font-black text-emerald-800">{SOURCE_LABEL[sheet.source] || "시트"} {sheet.sheetRow}행{sheet.seq ? ` · 순번 ${sheet.seq}` : ""}</div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[12px]">
            {items.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-bold text-slate-400">{k}</dt>
                <dd className="min-w-0 wrap-break-word font-semibold text-slate-700">{v}</dd>
              </div>
            ))}
          </dl>
          {sheet.summary && <p className="mt-1.5 wrap-break-word rounded bg-white px-2 py-1 text-[12px] font-semibold text-slate-700">{sheet.summary}</p>}
          <div className="mt-2 space-y-1.5">
            {after ? <div role="status" className="text-[12px] font-bold text-emerald-700">{after}</div>
              : urow && <UnhandledActionBar row={urow} author={author} onFinished={(action, ok) => { if (ok) { onFinished?.(); setAfter(action === "done" ? "처리완료로 보냈습니다 — 1~2분 뒤 목록에서 사라집니다" : action === "hold" ? "보류 상태를 보냈습니다 — 1~2분 뒤 반영" : "처리자를 보냈습니다 — 1~2분 뒤 반영"); } }} />}
            <a href={sheet.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-700 underline-offset-2 hover:underline">
              시트 {sheet.sheetRow}행 확인<ExternalLink size={11} aria-hidden />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
