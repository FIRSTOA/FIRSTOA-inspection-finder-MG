/**
 * 공용 날짜 시트 — "언제로 미룰까요?"(App.tsx 전송 뒤 미루기)와 같은 모양: 하단 시트 · 2열 칩 · 보라 강조.
 * 칩을 누르면 바로 고르고 닫힘. 아래 날짜 칸(폰 기본 달력, 오늘 이전 막음) + [이 날짜로].
 * onText 가 있으면 [미정·글로 쓰기] 비상구("차주 중" 같은 글자값).
 * 포털은 부르는 쪽이 씌운다(서버 렌더 테스트에서 그대로 그려지게).
 */
import { useState } from "react";
import { openNativePicker } from "./datePicker";
import { formatYmdShort, isYmd, nextCheckChips, type DateChip } from "./recontractSchedule";

type Props = {
  title?: string;
  subtitle?: string;
  value: string;
  today: string;
  onPick: (ymd: string) => void;
  onClose: () => void;
  onText?: () => void;
  chips?: DateChip[];
};

export default function DatePickSheet({ title = "날짜 고르기", subtitle, value, today, onPick, onClose, onText, chips }: Props) {
  const list = chips || nextCheckChips(today);
  const [custom, setCustom] = useState(isYmd(value) && value >= today ? value : "");
  const customOk = isYmd(custom) && custom >= today;
  return (
    <div className="fixed inset-0 z-[300] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-sm sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black text-slate-950">{title}</div>
            {subtitle && <div className="mt-1 truncate text-sm font-semibold text-slate-500">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm font-bold text-slate-400 hover:bg-slate-100">닫기</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {list.map((c) => {
            const picked = value === c.ymd;
            return (
              <button key={c.label} type="button" onClick={() => onPick(c.ymd)}
                className={`rounded-xl border py-3 text-sm font-black transition ${picked ? "border-purple-400 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                {c.label}<div className="mt-0.5 text-xs font-bold text-slate-400">{formatYmdShort(c.ymd)}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input type="date" value={custom} min={today} onChange={(e) => setCustom(e.target.value)} onClick={openNativePicker} aria-label="날짜 직접 고르기"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <button type="button" disabled={!customOk} onClick={() => onPick(custom)}
            className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-black text-white transition hover:bg-purple-700 disabled:opacity-35">이 날짜로</button>
        </div>
        {custom && !customOk && <div className="mt-1.5 text-[11px] font-bold text-rose-500">오늘 이후 날짜를 골라 주세요</div>}
        {onText && (
          <button type="button" onClick={onText} className="mt-2 w-full rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-500">미정·글로 쓰기</button>
        )}
      </div>
    </div>
  );
}
