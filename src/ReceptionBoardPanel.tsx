// 미처리 접수 현황판 감싸개(데이터 연결). 표시는 ReceptionBoard(윤화면 틀) — 여기서는 읽기·변환·폴링만.
// 설계: docs/tasks/reception-dept-types.md 4-1. 60초 주기 + 창 복귀 때 새로 읽고, 숨은 탭에서는 쉰다(Home.tsx 관행).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import ReceptionBoard, { type ReceptionRow } from "./ReceptionBoard";
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";
import type { OpenReceptionRow } from "./deptReceptionApi";
import { isDeptType } from "./deptReception";
import { loadBoardData, type BoardData } from "./receptionBoardData";
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
};

const fieldHint = (type: ReceptionType) => (type === "원격이관" ? "원격 대기열에서 처리" : "일정리스트에서 처리");

export default function ReceptionBoardPanel({ onSelectType, renderDeptActions, onOpenFieldRow, selectedType, onSelectedTypeChange, deptEnabled = true, reloadKey = 0, onCounts }: ReceptionBoardPanelProps) {
  const onCountsRef = useRef(onCounts);
  useEffect(() => { onCountsRef.current = onCounts; }, [onCounts]);
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
      const next = await loadBoardData(day);
      if (!alive.current || my !== seq.current) return;
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
    />
  );
}
