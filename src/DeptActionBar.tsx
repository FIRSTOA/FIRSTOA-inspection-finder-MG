// 부서 접수 처리 단추 5개 [완료][내일로][날짜 고르기][보류][메모] — 현황판 카드(구현서 D)와 목록 펼침(DeptReceptionDetail)이 같이 쓴다.
// 동작은 설계 4-1 표(deptReceptionFlow.runDeptAction). 누르면 카드가 먼저 바뀌고(낙관), 실패하면 되돌리며 빨간 토스트.
// 같은 카드는 저장이 끝날 때까지 단추를 잠근다(두 번 누름 방지).
import { useState } from "react";
import { CalendarDays, Check, ChevronsRight, Loader2, Pause, StickyNote } from "lucide-react";
import { DEPT_PROGRESS_CHIPS } from "./deptReception";
import { nextWeekday, resolveActor, runDeptAction, warnTone, type DeptActionKind, type DeptRowLike } from "./deptReceptionFlow";
import { notify } from "./toast";
import { kstDate } from "./visits";

export type DeptActionBarProps = {
  row: DeptRowLike;
  /** 현황판 카드용 작은 단추 */
  compact?: boolean;
  /** 처리한 사람. 비우면 그룹웨어 로그인 이름 → 기기 작성자(localStorage author) 순 */
  author?: string;
  /** 갱신된 행(낙관 값 → 저장 결과, 실패 시 원래 행) */
  onChanged?: (row: DeptRowLike) => void;
  /** onChanged 와 같음(호환용 이름) */
  onDone?: (row: DeptRowLike) => void;
};

export default function DeptActionBar({ row, compact = false, author, onChanged, onDone }: DeptActionBarProps) {
  const [busy, setBusy] = useState<DeptActionKind | null>(null);
  const [panel, setPanel] = useState<"done" | "date" | "memo" | null>(null);
  const [handled, setHandled] = useState("");
  const [date, setDate] = useState("");
  const [memo, setMemo] = useState("");
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const emit = (r: DeptRowLike) => { onChanged?.(r); onDone?.(r); };
  const closed = row.status === "완료" || row.status === "취소";
  const meta = row.remote_meta || {};

  const run = async (kind: DeptActionKind, opts: { date?: string; text?: string; handled?: string; progress?: string } = {}) => {
    if (busy) return;
    const by = resolveActor(author);
    const today = kstDate();
    // 낙관 값
    const optimistic: DeptRowLike = kind === "done" ? { ...row, status: "완료" }
      : kind === "hold" ? { ...row, status: row.status === "보류" ? "진행중" : "보류" }
      : kind === "tomorrow" ? { ...row, status: (row.status || "접수") === "접수" ? "진행중" : row.status, remote_meta: { ...meta, schedule_date: nextWeekday(today) } }
      : kind === "date" ? { ...row, remote_meta: { ...meta, schedule_date: opts.date || "" } }
      : row;
    setBusy(kind);
    if (optimistic !== row) emit(optimistic);
    try {
      const res = await runDeptAction(row, kind, { by, today, ...opts });
      emit(res.row);
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      setPanel(null); setHandled(""); setMemo(""); setDate(""); setProgress(undefined);
      if (!res.warnings.some((w) => warnTone(w) === "error")) {
        notify(kind === "done" ? "완료 처리했습니다." : kind === "tomorrow" ? `예정일을 ${String(res.row.remote_meta?.schedule_date || "").slice(5)}로 옮겼습니다.`
          : kind === "date" ? "예정일을 바꿨습니다." : kind === "hold" ? (res.row.status === "보류" ? "보류로 바꿨습니다." : "보류를 풀었습니다.") : "메모를 남겼습니다.", "success");
      }
    } catch (e) {
      emit(row); // 되돌림
      notify(`처리하지 못했습니다: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const btn = compact
    ? "inline-flex min-h-9 items-center gap-1 rounded-full border px-2.5 text-[11px] font-black transition disabled:opacity-40"
    : "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-black transition disabled:opacity-40 sm:min-h-9";
  const plain = "border-slate-200 bg-white text-slate-600 hover:border-slate-400";
  const icon = compact ? 13 : 14;
  const spin = (k: DeptActionKind) => busy === k ? <Loader2 size={icon} className="animate-spin" aria-hidden /> : null;
  const input = "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-bold text-slate-900 outline-none focus:border-slate-700";

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="처리 단추">
        <button type="button" disabled={!!busy || closed} onClick={() => setPanel(panel === "done" ? null : "done")} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
          {spin("done") || <Check size={icon} aria-hidden />}완료
        </button>
        <button type="button" disabled={!!busy || closed} onClick={() => void run("tomorrow")} className={`${btn} ${plain}`} title="다음 영업일(토·일 건너뜀)로 예정일을 옮깁니다">
          {spin("tomorrow") || <ChevronsRight size={icon} aria-hidden />}내일로
        </button>
        <button type="button" disabled={!!busy || closed} onClick={() => { setDate(meta.schedule_date || ""); setPanel(panel === "date" ? null : "date"); }} className={`${btn} ${plain}`}>
          {spin("date") || <CalendarDays size={icon} aria-hidden />}날짜 고르기
        </button>
        <button type="button" disabled={!!busy || closed} onClick={() => void run("hold")} aria-pressed={row.status === "보류"}
          className={`${btn} ${row.status === "보류" ? "border-amber-400 bg-amber-100 text-amber-800" : plain}`}>
          {spin("hold") || <Pause size={icon} aria-hidden />}{row.status === "보류" ? "보류 풀기" : "보류"}
        </button>
        <button type="button" disabled={!!busy} onClick={() => setPanel(panel === "memo" ? null : "memo")} className={`${btn} ${plain}`}>
          {spin("memo") || <StickyNote size={icon} aria-hidden />}메모
        </button>
      </div>

      {panel === "done" && (
        <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
          <textarea value={handled} onChange={(e) => setHandled(e.target.value)} rows={2} placeholder="처리내용 (선택)" aria-label="처리내용"
            className="w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-[13px] font-bold text-slate-900 outline-none focus:border-slate-700" />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setPanel(null)} className={`${btn} ${plain}`}>닫기</button>
            <button type="button" disabled={!!busy} onClick={() => void run("done", { handled })} className={`${btn} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}>{spin("done")}완료 확정</button>
          </div>
        </div>
      )}

      {panel === "date" && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <input type="date" value={date} min={kstDate()} onChange={(e) => setDate(e.target.value)} aria-label="예정일" className={`${input} w-auto flex-1`} />
          <button type="button" disabled={!!busy || !date} onClick={() => void run("date", { date })} className={`${btn} border-slate-900 bg-slate-900 text-white`}>{spin("date")}예정일 저장</button>
        </div>
      )}

      {panel === "memo" && (
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          {row.type === "영업팀" && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="진행 메모">
              {DEPT_PROGRESS_CHIPS.map((c) => {
                const on = (progress ?? meta.progress ?? "") === c;
                return <button key={c} type="button" aria-pressed={on} onClick={() => setProgress(on ? "" : c)}
                  className={`min-h-9 rounded-full border px-2.5 text-[11px] font-black ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500"}`}>{c}</button>;
              })}
            </div>
          )}
          <input value={memo} onChange={(e) => setMemo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (memo.trim() || progress !== undefined)) void run("memo", { text: memo, progress }); }}
            placeholder="메모 한 줄" aria-label="메모" className={input} />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => { setPanel(null); setProgress(undefined); }} className={`${btn} ${plain}`}>닫기</button>
            <button type="button" disabled={!!busy || (!memo.trim() && progress === undefined)} onClick={() => void run("memo", { text: memo, progress })} className={`${btn} border-slate-900 bg-slate-900 text-white`}>{spin("memo")}메모 저장</button>
          </div>
        </div>
      )}
    </div>
  );
}
