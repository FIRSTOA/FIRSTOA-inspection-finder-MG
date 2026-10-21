// 시트 행 읽기 전용 카드(C3 시트 기준) — 현황판 카드의 단추 자리에 들어간다. [시트 내용] 을 누르면 펼쳐서
// 접수일·업체·분야·처리자·상태·내용 요약과 [시트에서 열기] 링크를 보여 준다. 처리는 시트에서(D6: 앱은 시트 상태를 바꾸지 않음).
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { ReceptionRow } from "./ReceptionBoard";
import { sheetStateLabel } from "./receptionSheetState";

const SOURCE_LABEL: Record<string, string> = { sales: "해지방어접수(영업)", mgmt: "경영지원접수", remote: "원격" };

export default function SheetRowCard({ row }: { row: ReceptionRow }) {
  const [open, setOpen] = useState(false);
  const sheet = row.sheet;
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
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}시트 내용 · 시트에서 처리
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a href={sheet.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-emerald-700 px-3 text-[12px] font-black text-white transition hover:bg-emerald-800">
              <ExternalLink size={13} aria-hidden />시트에서 열기
            </a>
            <span className="text-[11px] font-bold leading-snug text-slate-500">시트 상태 열을 처리완료로 바꾸면 1~2분 뒤 여기서 사라집니다</span>
          </div>
        </div>
      )}
    </div>
  );
}
