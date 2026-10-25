// 미처리 접수 현황판 감싸개(데이터 연결). 표시는 ReceptionBoard(윤화면 틀) — 여기서는 읽기·변환·폴링만.
// 설계: docs/tasks/reception-dept-types.md 4-1. 60초 주기 + 창 복귀 때 새로 읽고, 숨은 탭에서는 쉰다(Home.tsx 관행).
// 2026-10-25 밤: 모든 카드(CS 접수·원격·IT·경영·운영·영업, 앱 행·시트 행)에 같은 [완료][보류][배정](UnhandledActionBar).
// 누른 줄은 unhandledPending(홈과 같은 저장소)으로 바로 빠지거나 상태·처리자가 덮인다 — 60초 기다리지 않는다.
// 2026-10-25 밤(사용자 "홈에선 57 이고 서비스접수 쪽에선 26"): CS 접수 칸 = 홈 미처리 CS 접수와 같은 줄(kpiData.loadUnhandledRows 의 kind "CS접수",
// 지난 날짜·미완료 일정). 열린 복합기 AS 접수는 현황판에서 세지 않고 "일정 없이 열린 접수 n건 → 접수리스트" 안내만.
// 모든 카드 윗줄을 누르면 홈과 같은 상세 팝업(UnhandledDetail). "접수리스트에서 보기"는 팝업 안 보조 단추.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReceptionBoard, { type ReceptionRow } from "./ReceptionBoard";
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";
import { isDeptType } from "./deptReception";
import { applySheetToBoard, loadBoardData, loadScheduleOverdue, replaceCopierWithTickets, requestOpenOverdue, type BoardData, type ScheduleOverdueRow } from "./receptionBoardData";
import type { UnhandledRow } from "./homeUnhandled";
import { UnhandledDetail } from "./HomeUnhandledPanel";
import { prefetchUnhandledDetail } from "./unhandledDetail";
import { loadSheetOpen } from "./receptionSheetOpen";
import SheetRowCard from "./SheetRowCard";
import UnhandledActionBar from "./UnhandledActionBar.view";
import { applyBoardPending, boardRowToUnhandled } from "./unhandledActions";
import { applyPending, usePendingVersion } from "./unhandledPending";
import { notify } from "./toast";
import { kstDate } from "./visits";

export type ReceptionBoardPanelProps = {
  /** 숫자 띠·열 머리를 눌렀을 때 — ServiceReception 이 종류 선택기·목록 필터를 같은 종류로 맞춘다 */
  onSelectType?: (type: ReceptionType) => void;
  /** 카드 [완료][보류][배정] 처리가 끝난 뒤(바깥 접수리스트 새로 읽기용). 현황판은 스스로 다시 읽는다. */
  onChanged?: () => void;
  /** 처리한 사람(서비스접수 작성자 선택값). 비우면 로그인 이름·기기 작성자 */
  author?: string;
  /** 원격·IT 카드 상세 팝업의 보조 단추 [서비스접수에서 열기](원격/IT 대기열·접수리스트로). 없으면 단추를 숨긴다. */
  onOpenFieldRow?: (row: ReceptionRow) => void;
  /** CS 접수 칸 아래 "일정 없이 열린 접수 n건 → 접수리스트" 를 눌렀을 때 */
  onOpenReceptionList?: () => void;
  /** 제어형: 주면 이 값이 우선(같은 종류 다시 누르면 null 로 onSelectedTypeChange 호출). 안 주면 패널 안에서 토글 */
  selectedType?: ReceptionType | null;
  onSelectedTypeChange?: (type: ReceptionType | null) => void;
  /** DEPT_RECEPTION_ENABLED 가 꺼져 있으면 false — 지원 3종 행을 뺀다 */
  deptEnabled?: boolean;
  /** 바깥에서 값을 바꾸면 즉시 다시 읽는다(예: 접수 저장 뒤 숫자 올리기) */
  reloadKey?: number;
  /** 데이터를 읽을 때마다 종류별 열린 건수(최근 90일) — 서비스접수 종류 선택기 배지가 현황판과 같은 숫자를 쓴다 */
  onCounts?: (counts: Record<ReceptionType, number>) => void;
  /** 물류 미처리(as_tickets 중 물류·납품철수교체휴가교육) 건수 — 서비스접수 오른쪽 전환 칸 N 에 더한다 */
  onScheduleCount?: (n: number) => void;
  /** 오른쪽 기둥 안에 들어갈 때 좁은 배치 */
  compact?: boolean;
  /** 물류 미처리 줄을 눌렀을 때. 안 주면 일정리스트 미처리 탭 열기 신호(localStorage + cs:open-overdue)만 보낸다 */
  onOpenSchedule?: () => void;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function ReceptionBoardPanel({ onSelectType, onChanged, author, onOpenFieldRow, onOpenReceptionList, selectedType, onSelectedTypeChange, deptEnabled = true, reloadKey = 0, onCounts, onScheduleCount, compact = false, onOpenSchedule }: ReceptionBoardPanelProps) {
  const onCountsRef = useRef(onCounts);
  useEffect(() => { onCountsRef.current = onCounts; }, [onCounts]);
  const onScheduleCountRef = useRef(onScheduleCount);
  useEffect(() => { onScheduleCountRef.current = onScheduleCount; }, [onScheduleCount]);
  const [logistics, setLogistics] = useState<ScheduleOverdueRow[] | undefined>(undefined);
  const logisticsFailed = useRef(false);
  const syncFailed = useRef(false);
  const [innerSelected, setInnerSelected] = useState<ReceptionType | null>(null);
  const selected = selectedType !== undefined ? selectedType : innerSelected;
  const [data, setData] = useState<BoardData | null>(null);
  // CS 접수 = 홈과 같은 일정 미처리 줄. null = 아직 못 읽음(실패하면 이전 값을 둔다)
  const [csRows, setCsRows] = useState<UnhandledRow[] | null>(null);
  const [csNotice, setCsNotice] = useState("");
  const csFailed = useRef(false);
  const [detail, setDetail] = useState<{ row: UnhandledRow; board: ReceptionRow } | null>(null);
  const [error, setError] = useState("");
  const [today, setToday] = useState(() => kstDate());
  const alive = useRef(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    const day = kstDate();
    try {
      // 접수 현황과 물류 미처리를 함께 읽는다. 물류 쪽 실패는 접수 현황을 막지 않고, 처음 실패할 때 한 번 알린다(분마다 반복 알림 방지).
      // 시트 기준(C3): 스위치 RECEPTION_SHEET_OPEN_ENABLED 가 'true' 일 때만 엣지를 부른다. loadSheetOpen 은 throw 하지 않는다 —
      // 시트 실패는 DB 숫자 + 안내 한 줄(sheetNotice)로 남고 현황판을 막지 않는다.
      const [base, logi, sheet, cs] = await Promise.all([
        loadBoardData(day),
        loadScheduleOverdue(day).then((r) => ({ ok: true as const, rows: r }), (e: unknown) => ({ ok: false as const, error: errText(e) })),
        loadSheetOpen(),
        // 홈 미처리와 같은 로더(큰 모듈이라 늦게 읽는다) — CS 접수 칸 숫자·목록을 홈과 1:1 로
        import("./kpi/kpiData").then((m) => m.loadUnhandledRows(day)).then((r) => ({ ok: true as const, value: r }), (e: unknown) => ({ ok: false as const, error: errText(e) })),
      ]);
      const next = applySheetToBoard(base, sheet, day);
      if (!alive.current || my !== seq.current) return;
      if (logi.ok) {
        logisticsFailed.current = false;
        setLogistics(logi.rows);
        onScheduleCountRef.current?.(logi.rows.length);
      } else if (!logisticsFailed.current) {
        logisticsFailed.current = true;
        notify(`물류 미처리를 못 읽었습니다: ${logi.error}`, "error");
      }
      // 일정 대조·자가 치유 실패는 현황판을 막지 않고 처음 한 번만 알린다(분마다 반복 방지)
      if (cs.ok) {
        csFailed.current = false;
        setCsRows(cs.value.rows.filter((u) => u.kind === "CS접수"));
        setCsNotice(cs.value.partialError);
      } else {
        setCsNotice(`CS 접수(일정) 미처리를 못 읽었습니다 — 이전 값을 보여 줍니다: ${cs.error}`);
        if (!csFailed.current) { csFailed.current = true; notify(`CS 접수 미처리를 못 읽었습니다: ${cs.error}`, "error"); }
      }
      if (next.syncError) { if (!syncFailed.current) { syncFailed.current = true; notify(next.syncError, "error"); } }
      else syncFailed.current = false;
      if (next.healed) notify(`일정이 완료된 CS 접수 ${next.healed}건을 완료로 맞췄습니다`, "success");
      if (next.sheetHealed) notify(`시트에서 끝난 접수 ${next.sheetHealed}건을 완료로 맞췄습니다`, "success");
      setData(next); // 종류별 건수(onCounts)는 아래 shownAll 효과에서 — 방금 누른 줄을 뺀 숫자
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
  // 처리 뒤: 바깥 목록은 바로, 현황판은 1.5초 모아서 한 번(시트 잡이 따라오는 동안 pending 이 줄을 가린다)
  const settleTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);
  const onFinished = useCallback(() => {
    onChanged?.();
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => { void refresh(); }, 1500);
  }, [refresh, onChanged]);
  const pendingVer = usePendingVersion();
  // 앱 접수·시트 줄은 boardRowKey 로, CS 접수 일정 줄은 미처리 key(t:) 로 pending 을 입힌 뒤 합친다
  const csShown = useMemo(() => (csRows && pendingVer >= 0 ? applyPending(csRows) : []), [csRows, pendingVer]);
  const merged = useMemo(() => (data && pendingVer >= 0 ? replaceCopierWithTickets(applyBoardPending(data.rows), csShown) : { rows: [], copierOpen: 0 }), [data, csShown, pendingVer]);
  const shownAll = merged.rows;
  const csByKey = useMemo(() => new Map(csShown.map((u) => [u.key, u])), [csShown]);
  useEffect(() => {
    if (!data) return;
    onCountsRef.current?.(Object.fromEntries(RECEPTION_TYPES.map((m) => [m.type, shownAll.filter((r) => r.type === m.type).length])) as Record<ReceptionType, number>);
  }, [data, shownAll]);
  const rows = deptEnabled ? shownAll : shownAll.filter((r) => !isDeptType(r.type));
  const over90Rows = useMemo(() => {
    if (!data?.over90) return undefined;
    const list = pendingVer >= 0 ? applyBoardPending(data.over90) : data.over90;
    return deptEnabled ? list : list.filter((r) => !isDeptType(r.type));
  }, [data, deptEnabled, pendingVer]);

  const unhandledOf = (row: ReceptionRow): UnhandledRow | null => csByKey.get(row.id) ?? boardRowToUnhandled(row, today);
  const renderActions = (row: ReceptionRow): ReactNode => {
    // 시트 행: [시트 내용 · 처리] 펼침 안에 같은 단추(이어진 앱 접수면 DB 경로, 아니면 시트 상태·처리자 칸만)
    if (row.sheet) return <SheetRowCard row={row} author={author} onFinished={onFinished} />;
    const u = unhandledOf(row);
    return u ? <div className="w-full"><UnhandledActionBar row={u} author={author} onFinished={(_a, ok) => { if (ok) onFinished(); }} onOpenSchedule={u.source === "ticket" ? openSchedule : undefined} /></div> : null;
  };
  const openDetail = (row: ReceptionRow) => { const u = unhandledOf(row); if (u) setDetail({ row: u, board: row }); };
  const warmDetail = (row: ReceptionRow) => { const u = unhandledOf(row); if (u) prefetchUnhandledDetail(u); }; // 손을 올리면 팝업 본문 미리 읽기(동시 2개)
  // 팝업 안 보조 단추: 일정 줄 = 일정리스트 미처리, 원격·IT 앱 접수 = 원격/IT 대기열·접수리스트. 부서·시트 줄은 없음(팝업의 시트 링크로)
  const detailOpen = (d: { row: UnhandledRow; board: ReceptionRow }): (() => void) | undefined => {
    if (d.row.source === "ticket") return () => { setDetail(null); openSchedule(); };
    if (!d.board.sheet && !isDeptType(d.board.type) && onOpenFieldRow) return () => { setDetail(null); onOpenFieldRow(d.board); };
    return undefined;
  };
  const copierOpen = merged.copierOpen;
  const notice = [data?.sheetNotice, csNotice].filter(Boolean).join(" · ");

  return (
    <>
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
      scheduleRows={logistics}
      onOpenSchedule={openSchedule}
      sheetMode={Boolean(data?.sheetMode)}
      sheetNotice={notice || undefined}
      over90Rows={over90Rows}
      onOpenRow={openDetail}
      onWarmRow={warmDetail}
    />
    {data && copierOpen > 0 && (!selected || selected === "복합기 AS") && (
      <button type="button" onClick={onOpenReceptionList} disabled={!onOpenReceptionList}
        className="mx-3 mt-1 flex min-h-11 w-[calc(100%-1.5rem)] items-center text-left text-[11px] font-bold text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline disabled:no-underline sm:min-h-8">
        <span>CS 접수 칸은 홈과 같은 지난 일정 기준 · 일정 없이 열린 접수 <b className="tabular-nums text-slate-800">{copierOpen}</b>건 → 접수리스트</span>
      </button>
    )}
    {detail && typeof document !== "undefined" && createPortal(
      <UnhandledDetail row={detail.row} onClose={() => setDetail(null)} onOpen={detailOpen(detail)} actions author={author} />, document.body)}
    </>
  );
}
