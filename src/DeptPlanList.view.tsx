// 서비스접수 › 부서 › 일정리스트 표시 틀(props 만, 데이터 호출 없음) — 묶음 칩 3개(금일·익일·예정) + 일정 카드(업체·분야·내용 1줄·예정일·처리자 알약).
// 설계: docs/tasks/dept-mini-workspace.md 4절 3~5. 폰 390px: 칩 3개 한 줄, 단추 줄은 카드 안에서 줄바꿈.
// 2026-10-25 밤 [미처리] 칩 제거(사용자 "미처리현황 탭과 중복") — 미처리는 [미처리현황] 탭에서만.
// 2026-10-28: 시트 접수 카드(kind "sheet", renderSheet 로 그림)·오늘 완료 앱 접수(회색·취소선·"완료" 칩, 단추 없음).
//   칩 숫자 = 안 끝난 것, 끝난 것은 옆에 작게 ✓m. 익일·예정 아래 "시트 접수는 금일로만" 안내(sheetNote).
import type { ReactNode } from "react";
import { CalendarDays, Check, UserRound } from "lucide-react";
import { PLAN_BUCKETS, PLAN_BUCKET_LABEL, planChipCount, type PlanBucket, type PlanItem } from "./deptPlan";
import type { OpenReceptionRow } from "./deptReceptionApi";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (ymd: string) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${WEEK[new Date(`${ymd}T12:00:00`).getDay()]})` : "");

export type DeptPlanListProps = {
  buckets: Record<PlanBucket, PlanItem<OpenReceptionRow>[]>;
  active: PlanBucket;
  onActive: (b: PlanBucket) => void;
  /** 접수 카드 아래 단추 줄(DeptActionBar compact) */
  renderActions: (row: OpenReceptionRow) => ReactNode;
  /** 처리자 알약 누름 */
  onAssign: (row: OpenReceptionRow) => void;
  /** 접수와 연결 안 된 부서 일정 누름(편집 창) */
  onOpenEvent: (ev: Extract<PlanItem, { kind: "event" }>["ev"]) => void;
  /** 배정 저장 중인 접수 id */
  assigningId?: string;
  loading?: boolean;
  /** 시트 접수 카드(DeptSheetPlanCard) */
  renderSheet?: (it: Extract<PlanItem, { kind: "sheet" }>) => ReactNode;
  /** 시트를 읽는 부서(영업·경영)면 익일·예정 아래 안내 한 줄 */
  sheetNote?: boolean;
};

export default function DeptPlanList({ buckets, active, onActive, renderActions, onAssign, onOpenEvent, assigningId, loading, renderSheet, sheetNote }: DeptPlanListProps) {
  const list = buckets[active];
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5 px-3 pt-2" role="tablist" aria-label="일정 묶음">
        {PLAN_BUCKETS.map((b) => {
          const on = b === active;
          const n = planChipCount(buckets[b]);
          return (
            <button key={b} type="button" role="tab" aria-selected={on} onClick={() => onActive(b)} aria-label={`${PLAN_BUCKET_LABEL[b]} 열림 ${n.open}${n.done ? ` · 완료 ${n.done}` : ""}`}
              className={`flex min-h-11 items-center justify-center gap-1 rounded-lg border px-1 text-[12px] font-black transition ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              {PLAN_BUCKET_LABEL[b]}<span className={`font-mono tabular-nums ${on ? "text-white/70" : "text-slate-400"}`}>{n.open}</span>
              {n.done > 0 && <span className={`inline-flex items-center font-mono text-[10px] tabular-nums ${on ? "text-emerald-300" : "text-emerald-600"}`}><Check size={10} aria-hidden />{n.done}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 max-h-[70vh] divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
        {loading && !list.length && <div className="p-8 text-center text-xs font-bold text-slate-400">불러오는 중…</div>}
        {!loading && !list.length && <div className="p-8 text-center text-xs font-bold text-slate-400">{PLAN_BUCKET_LABEL[active]} 일정이 없습니다.</div>}
        {list.map((it) => it.kind === "sheet" ? (
          <div key={`${it.key}:${it.sheet.cls}:${it.sheet.handler}`}>{renderSheet?.(it)}</div>
        ) : it.kind === "reception" && it.done ? (
          <div key={it.key} className="bg-slate-50/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-black text-slate-400 line-through">{it.row.vendor || "업체 미정"}</span>
              {!!it.row.field && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-400">{it.row.field}</span>}
              <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-600">완료</span>
              <span className="ml-auto shrink-0 text-[11px] font-bold text-slate-400">{String(it.row.remote_meta?.handler || "").trim() || ""}</span>
            </div>
            <div className="mt-0.5 truncate text-[12px] font-semibold text-slate-400 line-through">{it.row.symptom || it.row.title || "-"}</div>
          </div>
        ) : it.kind === "event" ? (
          <button key={it.key} type="button" onClick={() => onOpenEvent(it.ev)} className="block min-h-11 w-full px-3 py-2.5 text-left hover:bg-slate-50">
            <div className="flex items-center gap-1.5">
              <CalendarDays size={13} className="shrink-0 text-slate-400" aria-hidden />
              <span className={`min-w-0 flex-1 truncate text-[13px] font-black ${it.ev.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{it.ev.title || "(제목 없음)"}</span>
              <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-500">{dayLabel(it.date)}</span>
            </div>
            <div className="mt-0.5 truncate pl-5 text-[11px] font-semibold text-slate-400">부서 일정{it.ev.memo ? ` · ${it.ev.memo.split("\n")[0]}` : ""}</div>
          </button>
        ) : (
          <div key={it.key} className="space-y-1.5 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-black text-slate-900">{it.row.vendor || "업체 미정"}</span>
                  {!!it.row.field && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600">{it.row.field}</span>}
                  {it.row.status === "보류" && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800">보류</span>}
                </div>
                <div className="mt-0.5 truncate text-[12px] font-semibold text-slate-500">{it.row.symptom || it.row.title || "-"}</div>
                <div className="mt-0.5 text-[11px] font-bold tabular-nums text-slate-400">
                  {it.date ? <>예정 {dayLabel(it.date)}</> : <span className="text-rose-500">예정일 없음</span>} · 접수 {dayLabel(String(it.row.receipt_date || "").slice(0, 10))}
                </div>
              </div>
              {(() => {
                const h = String(it.row.remote_meta?.handler || "").trim();
                return (
                  <button type="button" onClick={() => onAssign(it.row)} disabled={assigningId === it.row.id} aria-label={h ? `처리자 ${h} — 바꾸기` : "처리자 배정"}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-[12px] font-black transition disabled:opacity-50 ${h ? "border-slate-200 bg-white text-slate-700 hover:border-slate-400" : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"}`}>
                    <UserRound size={13} aria-hidden />{assigningId === it.row.id ? "저장 중" : h || "미배정"}
                  </button>
                );
              })()}
            </div>
            {renderActions(it.row)}
          </div>
        ))}
      </div>
      {sheetNote && active !== "today" && (
        <div className="px-3 pt-2 text-[11px] font-semibold text-slate-400">시트 접수는 예정일 칸이 없어 접수일(금일)로만 들어옵니다. 지난 시트 접수는 [미처리 현황].</div>
      )}
    </div>
  );
}
