// 홈 관제 덱용 "미처리 접수" 작은 카드(표시 전용, 카드 전체가 단추).
// props: counts(종류별 미처리 건수) · oldest(가장 오래된 건 1줄, 없으면 null) · onClick · loading · error.
// 카드 모양은 Home.tsx 의 card 클래스(어두운 바탕 rounded-2xl border-white/[0.08])와 같다.
import { AlertCircle, ChevronRight, Inbox, Loader2 } from "lucide-react";
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";

type Props = {
  counts: Record<ReceptionType, number>;
  oldest: { vendor: string; type: ReceptionType; days: number } | null;
  onClick: () => void;
  loading?: boolean;
  error?: string;
  over7?: number;
  scheduleOverdue?: number; // 일정리스트 미처리 일정 건수(있으면 큰 숫자 아래 한 줄)
};

export default function HomeReceptionCard({ counts, oldest, onClick, loading, error, over7, scheduleOverdue }: Props) {
  const total = RECEPTION_TYPES.reduce((s, m) => s + (counts[m.type] ?? 0), 0);
  const ageTone = oldest && oldest.days >= 7 ? "text-red-300" : oldest && oldest.days >= 3 ? "text-amber-300" : "text-slate-400";
  return (
    <button type="button" onClick={onClick} aria-label={`미처리 접수 ${total}건, 눌러서 현황판 열기`}
      className="group block min-h-11 w-full rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500"><Inbox size={13} aria-hidden />미처리 접수</span>
        <ChevronRight size={16} className="text-slate-500 transition group-hover:translate-x-0.5" aria-hidden />
      </div>
      {loading ? (
        <div role="status" className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-400"><Loader2 size={15} className="animate-spin" />불러오는 중입니다.</div>
      ) : error ? (
        <div role="alert" className="mt-3 flex items-start gap-2 text-sm font-bold text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" />불러오지 못했습니다. 눌러서 다시 확인해 주세요.</div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className={`text-4xl font-black tabular-nums ${total > 0 ? "text-white" : "text-emerald-300"}`}>{total}</span>
            <span className="text-sm font-black text-slate-400">건</span>
            {total === 0 && <span className="ml-1 text-xs font-black text-emerald-300">모두 처리됨 ✓</span>}
            {(over7 ?? 0) > 0 && <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-black text-red-300"><span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />7일↑ {over7}건</span>}
          </div>
          {scheduleOverdue !== undefined && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] font-black text-slate-400">
              <span className={`h-2 w-2 rounded-full ${scheduleOverdue >= 1 ? "bg-red-500" : "bg-slate-600"}`} aria-hidden />일정 미처리 <span className={`tabular-nums ${scheduleOverdue >= 1 ? "text-red-300" : "text-slate-500"}`}>{scheduleOverdue}</span>건
            </div>
          )}
          <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-1.5">
            {RECEPTION_TYPES.map((m) => (
              <div key={m.type} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
                <span className="truncate">{m.label}</span>
                <span className={`ml-auto font-black tabular-nums ${(counts[m.type] ?? 0) > 0 ? "text-white" : "text-slate-600"}`}>{counts[m.type] ?? 0}</span>
              </div>
            ))}
          </div>
          <div className={`mt-3 truncate border-t border-white/[0.06] pt-2 text-[11px] font-bold ${ageTone}`}>
            {oldest ? `가장 오래된 건 · ${oldest.vendor || "업체 미정"} (${oldest.days}일)` : "오래 걸린 건이 없습니다."}
          </div>
        </>
      )}
    </button>
  );
}
