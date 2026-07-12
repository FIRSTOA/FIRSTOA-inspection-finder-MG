import { useState } from "react";

const options = ["점검", "AS", "마감", "여분", "세팅", "기타"];

export default function ReportTypeSelector({ selected, other, onSelected, onOther, accent = "#334155" }: {
  selected: string[];
  other: string;
  onSelected: (v: string[]) => void;
  onOther: (v: string) => void;
  accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (value: string) => onSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  const summary = selected.map((value) => value === "기타" && other.trim() ? other.trim() : value).join("·");

  return <>
    <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-2 py-2 text-left text-sm outline-none" style={{ borderLeft: selected.length ? `3px solid ${accent}` : undefined }}>
      <span className={`truncate ${selected.length ? "font-semibold text-slate-900" : "text-slate-500"}`}>{summary || "구분 선택"}</span>
      <span className="ml-1 text-[10px] text-slate-400">▾</span>
    </button>
    {open && <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setOpen(false)} role="dialog">
      <div className="w-full rounded-t-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><div className="text-sm font-bold text-slate-800">구분 선택</div><div className="text-[11px] text-slate-400">점검과 AS처럼 여러 개를 함께 선택할 수 있습니다.</div></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-xs text-slate-500">닫기</button></div>
        <div className="grid grid-cols-3 gap-2 p-4">{options.map((value) => <button type="button" key={value} onClick={() => toggle(value)} className={`rounded-xl py-3 text-sm font-bold ${selected.includes(value) ? "text-white" : "border border-slate-200 bg-white text-slate-500"}`} style={selected.includes(value) ? { background: accent } : undefined}>{selected.includes(value) ? "✓ " : ""}{value}</button>)}</div>
        {selected.includes("기타") && <div className="px-4 pb-3"><input value={other} onChange={(e) => onOther(e.target.value)} placeholder="기타 구분 직접입력" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base outline-none" /></div>}
        <div className="border-t border-slate-100 p-3"><button type="button" onClick={() => setOpen(false)} className="w-full rounded-xl py-3 text-sm font-bold text-white" style={{ background: accent }}>선택 완료{selected.length ? ` (${selected.length}개)` : ""}</button></div>
      </div>
    </div>}
  </>;
}
