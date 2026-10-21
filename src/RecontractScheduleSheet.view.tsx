/**
 * 재계약 보낸 뒤 "다음 확인일로 일정 만들까요?" 시트 — 겉모양만(상태·저장은 RecontractScheduleSheet.tsx).
 * 단계: form(입력) → dup(같은 업체 열린 재계약 일정 있음: 옮기기·새로 하나 더·취소) → naverFailed(네이버만 실패: 다시 시도).
 * 하단 시트 모양은 App.tsx "언제로 미룰까요?"와 같다(PC 는 가운데 창).
 */
import { openNativePicker } from "./datePicker";
import { formatYmdShort, SCHEDULE_TEAMS, type OpenRecontractTicket } from "./recontractSchedule";

export type ScheduleSheetPhase = "form" | "dup" | "naverFailed";

export type RecontractScheduleSheetViewProps = {
  phase: ScheduleSheetPhase;
  vendor: string;
  today: string;
  date: string;
  team: string;
  title: string;
  address: string;
  note: string;
  naverLine: string;
  error: string;
  busy: boolean;
  duplicates: OpenRecontractTicket[];
  naverError?: string;
  onDate: (v: string) => void;
  onTeam: (v: string) => void;
  onTitle: (v: string) => void;
  onAddress: (v: string) => void;
  onNote: (v: string) => void;
  onCreate: () => void;
  onSkip: () => void;
  onMove: (id: string) => void;
  onCreateAnyway: () => void;
  onBackToForm: () => void;
  onRetryNaver: () => void;
  onFinish: () => void;
};

const input = "mt-0.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-400";

export default function RecontractScheduleSheetView(p: RecontractScheduleSheetViewProps) {
  return (
    <div className="fixed inset-0 z-[300] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4">
      <div role="dialog" aria-label="다음 확인일로 일정 만들기" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-sm sm:rounded-xl">
        {p.phase === "form" && <>
          <div className="text-lg font-black text-slate-950">다음 확인일로 일정 만들까요?</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-500">{p.vendor || "이 업체"} · 재계약 전송 완료</div>
          <div className="mt-2 rounded-lg bg-purple-50 px-3 py-2 text-[12px] font-bold leading-5 text-purple-800">{p.naverLine}</div>

          <div className="mt-3 space-y-2.5">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">날짜 {p.date ? `· ${formatYmdShort(p.date)}` : ""}</span>
              <input type="date" value={p.date} min={p.today} onChange={(e) => p.onDate(e.target.value)} onClick={openNativePicker} className={`${input} font-bold`} />
            </label>
            <div>
              <span className="text-xs font-medium text-slate-500">팀</span>
              <div className="mt-1 grid grid-cols-5 gap-1.5">
                {SCHEDULE_TEAMS.map((t) => (
                  <button key={t} type="button" onClick={() => p.onTeam(t)}
                    className={`rounded-lg py-2 text-sm font-black ${p.team === t ? "bg-purple-600 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>{t === "E" ? "CSS" : t}</button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">제목</span>
              <input value={p.title} onChange={(e) => p.onTitle(e.target.value)} className={input} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">장소</span>
              <input value={p.address} onChange={(e) => p.onAddress(e.target.value)} placeholder="주소 (모르면 비워 둬도 됩니다)" className={input} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">내용</span>
              <textarea value={p.note} onChange={(e) => p.onNote(e.target.value)} rows={5} className={`${input} resize-y text-[13px] leading-5`} />
            </label>
          </div>

          {p.error && <div className="mt-2 text-[12px] font-bold text-rose-600">{p.error}</div>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={p.busy} onClick={p.onSkip} className="rounded-lg border border-slate-200 py-3 text-sm font-bold text-slate-500 disabled:opacity-40">안 만들기</button>
            <button type="button" disabled={p.busy || Boolean(p.error)} onClick={p.onCreate} className="rounded-lg bg-purple-600 py-3 text-sm font-black text-white disabled:opacity-40">{p.busy ? "만드는 중…" : "일정 만들기"}</button>
          </div>
        </>}

        {p.phase === "dup" && <>
          <div className="text-lg font-black text-slate-950">이미 재계약 일정이 있습니다</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-500">{p.vendor}</div>
          <ul className="mt-3 space-y-1.5">
            {p.duplicates.map((t) => (
              <li key={t.id} className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] font-bold text-slate-700">
                {formatYmdShort(t.date)} · {String(t.issue || "재계약 일정").slice(0, 40)}
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2">
            {p.duplicates[0] && (
              <button type="button" disabled={p.busy} onClick={() => p.onMove(p.duplicates[0].id)} className="w-full rounded-lg bg-purple-600 py-3 text-sm font-black text-white disabled:opacity-40">
                {`그 일정을 ${formatYmdShort(p.date)}로 옮기기`}
              </button>
            )}
            <button type="button" disabled={p.busy} onClick={p.onCreateAnyway} className="w-full rounded-lg border border-purple-200 bg-purple-50 py-3 text-sm font-black text-purple-700 disabled:opacity-40">새로 하나 더</button>
            <button type="button" disabled={p.busy} onClick={p.onBackToForm} className="w-full rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-500 disabled:opacity-40">취소</button>
          </div>
        </>}

        {p.phase === "naverFailed" && <>
          <div className="text-lg font-black text-slate-950">네이버 등록만 실패했습니다</div>
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-bold leading-5 text-amber-800">
            일정리스트·캘린더에는 정상으로 들어갔습니다. 네이버 캘린더만 다시 시도하면 됩니다(여러 번 눌러도 1건).
            {p.naverError && <><br /><span className="font-semibold text-amber-700">사유: {p.naverError}</span></>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={p.busy} onClick={p.onFinish} className="rounded-lg border border-slate-200 py-3 text-sm font-bold text-slate-500 disabled:opacity-40">나중에</button>
            <button type="button" disabled={p.busy} onClick={p.onRetryNaver} className="rounded-lg bg-purple-600 py-3 text-sm font-black text-white disabled:opacity-40">{p.busy ? "다시 보내는 중…" : "네이버 다시 시도"}</button>
          </div>
        </>}
      </div>
    </div>
  );
}
