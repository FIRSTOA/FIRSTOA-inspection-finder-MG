/** 미처리 정렬 토글 [오래된 순 | 최근 순] — 세 곳 공유(unhandledSort). dark = 어두운 배경(홈·현황판 머리) */
import type { UnhandledSortOrder } from "./homeUnhandled";

const OPTIONS: Array<[UnhandledSortOrder, string]> = [["old", "오래된 순"], ["recent", "최근 순"]];

export default function UnhandledSortToggle({ order, onChange, dark = false }: { order: UnhandledSortOrder; onChange: (o: UnhandledSortOrder) => void; dark?: boolean }) {
  return (
    <span role="radiogroup" aria-label="미처리 정렬" className={`inline-flex shrink-0 rounded-full p-0.5 ${dark ? "bg-white/[0.08]" : "bg-slate-100"}`}>
      {OPTIONS.map(([v, label]) => {
        const on = order === v;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onChange(v)}
            className={`inline-flex min-h-8 items-center rounded-full px-2.5 text-[11px] font-black transition ${on ? (dark ? "bg-white text-slate-950" : "bg-slate-800 text-white") : dark ? "text-slate-300 hover:text-white" : "text-slate-500 hover:text-slate-800"}`}>
            {label}
          </button>
        );
      })}
    </span>
  );
}
