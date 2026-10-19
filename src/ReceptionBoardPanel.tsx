// 미처리 접수 현황판 감싸개(데이터 연결). 표시는 ReceptionBoard(윤화면 틀) — 여기서는 읽기·변환·폴링만.
// 설계: docs/tasks/reception-dept-types.md 4-1. 60초 주기 + 창 복귀 때 새로 읽고, 숨은 탭에서는 쉰다(Home.tsx 관행).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import ReceptionBoard, { type ReceptionRow } from "./ReceptionBoard";
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";
import type { OpenReceptionRow } from "./deptReceptionApi";
import { isDeptType } from "./deptReception";
import { loadBoardData, loadScheduleOverdue, requestOpenOverdue, type BoardData, type ScheduleOverdueRow } from "./receptionBoardData";
import { notify } from "./toast";
import { kstDate } from "./visits";

export type ReceptionBoardPanelProps = {
  /** 숫자 띠·열 머리를 눌렀을 때 — ServiceReception 이 종류 선택기·목록 필터를 같은 종류로 맞춘다 */
  onSelectType?: (type: ReceptionType) => void;
  /** 지원 3종 카드 단추 줄(DeptActionBar). 처리 뒤 ctx.onDone() 을 부르면 현황판을 다시 읽는다. */
  renderDeptActions?: (row: ReceptionRow, ctx: { source: OpenReceptionRow | undefined; onDone: () => void }) => ReactNode;
  /** 현장 3종 카드를 눌러 기존 흐름(일정리스트·원격/IT 대기열)으로 보낼 때. 없으면 안내 글자만 보인다. */
  onOpenFieldRow?: (row: ReceptionRow) => void;
  /** 제어형: 주면 이 값이 우선(같은 종류 다시 누르면 null 로 onSelectedTypeChange 호출). 안 주면 패널 안에서 토글 */
  selectedType?: ReceptionType | null;
  onSelectedTypeChange?: (type: ReceptionType | null) => void;
  /** DEPT_RECEPTION_ENABLED 가 꺼져 있으면 false — 지원 3종 행을 뺀다 */
  deptEnabled?: boolean;
  /** 바깥에서 값을 바꾸면 즉시 다시 읽는다(예: 접수 저장 뒤 숫자 올리기) */
  reloadKey?: number;
  /** 데이터를 읽을 때마다 종류별 열린 건수(최근 90일) — 서비스접수 종류 선택기 배지가 현황판과 같은 숫자를 쓴다 */
  onCounts?: (counts: Record<ReceptionType, number>) => void;
  /** 일정 미처리(as_tickets, 홈 OverduePanel 과 같은 규칙) 건수 — 서비스접수 오른쪽 전환 칸 N 에 더한다 */
  onScheduleCount?: (n: number) => void;
  /** 오른쪽 기둥 안에 들어갈 때 좁은 배치 */
  compact?: boolean;
  /** 일정 미처리 줄을 눌렀을 때. 안 주면 일정리스트 미처리 탭 열기 신호(localStorage + cs:open-overdue)만 보낸다 */
  onOpenSchedule?: () => void;
};

const fieldHint = (type: ReceptionType) => (type === "원격이관" ? "원격 대기열에서 처리" : "일정리스트에서 처리");

export default function ReceptionBoardPanel({ onSelectType, renderDeptActions, onOpenFieldRow, selectedType, onSelectedTypeChange, deptEnabled = true, reloadKey = 0, onCounts, onScheduleCount, compact = false, onOpenSchedule }: ReceptionBoardPanelProps) {
  const onCountsRef = useRef(onCounts);
  useEffect(() => { onCountsRef.current = onCounts; }, [onCounts]);
  const onScheduleCountRef = useRef(onScheduleCount);
  useEffect(() => { onScheduleCountRef.current = onScheduleCount; }, [onScheduleCount]);
  const [schedule, setSchedule] = useState<ScheduleOverdueRow[] | undefined>(undefined);
  const scheduleFailed = useRef(false);
  const [innerSelected, setInnerSelected] = useState<ReceptionType | null>(null);
  const selected = selectedType !== undefined ? selectedType : innerSelected;
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const [today, setToday] = useState(() => kstDate());
  const alive = useRef(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    const day = kstDate();
    try {
      // 접수 현황과 일정 미처리를 함께 읽는다. 일정 쪽 실패는 접수 현황을 막지 않고, 처음 실패할 때 한 번 알린다(분마다 반복 알림 방지).
      const [next, sched] = await Promise.all([
        loadBoardData(day),
        loadScheduleOverdue(day).then((r) => ({ ok: true as const, rows: r }), (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
      ]);
      if (!alive.current || my !== seq.current) return;
      if (sched.ok) {
        scheduleFailed.current = false;
        setSchedule(sched.rows);
        onScheduleCountRef.current?.(sched.rows.length);
      } else if (!scheduleFailed.current) {
        scheduleFailed.current = true;
        notify(`일정 미처리를 못 읽었습니다: ${sched.error}`, "error");
      }
      setData(next);
      onCountsRef.current?.(Object.fromEntries(RECEPTION_TYPES.map((m) => [m.type, next.rows.filter((r) => r.type === m.type).length])) as Record<ReceptionType, number>);
      setToday(day);
      setError("");
    } catch (e) {
      if (!alive.current || my !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive.current = false; window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh, reloadKey]);

  const openSchedule = useCallback(() => { if (onOpenSchedule) onOpenSchedule(); else requestOpenOverdue(); }, [onOpenSchedule]);
  const onDone = useCallback(() => { void refresh(); }, [refresh]);
  const rows = data ? (deptEnabled ? data.rows : data.rows.filter((r) => !isDeptType(r.type))) : [];

  const renderActions = (row: ReceptionRow): ReactNode => {
    if (isDeptType(row.type)) {
      return renderDeptActions
        ? renderDeptActions(row, { source: data?.sources[row.id], onDone })
        : <span className="text-[11px] font-bold text-slate-400">상세에서 처리</span>;
    }
    const hint = fieldHint(row.type);
    return onOpenFieldRow
      ? <button type="button" onClick={() => onOpenFieldRow(row)} className="min-h-9 rounded-lg border border-slate-200 px-2.5 text-[11px] font-black text-slate-600 transition hover:border-slate-400 hover:text-slate-900">{hint} →</button>
      : <span className="text-[11px] font-bold text-slate-400">{hint}</span>;
  };

  return (
    <ReceptionBoard
      rows={rows}
      today={today}
      onSelectType={(t) => {
        const next = selected === t ? null : t;
        if (selectedType === undefined) setInnerSelected(next);
        onSelectedTypeChange?.(next);
        onSelectType?.(t);
      }}
      selectedType={selected}
      deptEnabled={deptEnabled}
      renderActions={renderActions}
      loading={!data && !error}
      error={error || undefined}
      todayCount={data?.todayCount}
      weekDoneRate={data?.weekDoneRate ?? null}
      compact={compact}
      scheduleRows={schedule}
      onOpenSchedule={openSchedule}
    />
  );
}
