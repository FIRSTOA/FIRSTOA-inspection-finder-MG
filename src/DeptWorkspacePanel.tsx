/**
 * 서비스접수 › 경영·운영·영업 미니 업무공간(2026-10-24) — 오른쪽 기둥의 [일정리스트]·[미처리현황] 본체와 전환 막대·시트 열기 단추.
 * 설계: docs/tasks/dept-mini-workspace.md. 접수리스트는 ServiceReception 의 기존 목록(부서 필터)을 그대로 쓴다.
 *
 * 데이터
 * - 일정리스트 [금일/익일/예정] = fetchOpenReceptions(90) 중 이 부서 + team_calendar_events 중 접수와 연결 안 된 부서 일정(오늘~90일) → deptPlanBuckets.
 *   [미처리] 칩은 없다(2026-10-25 밤 사용자 "미처리현황 탭과 중복" — 2c3f253 의 미처리 묶음을 걷어냄). 미처리는 [미처리현황] 탭에서만.
 * - 달력(2026-10-25) = DeptCalendarPanel compact(그 부서 달력 추가·수정·삭제). 일정·캘린더 탭의 부서 칩은 없어졌다.
 * - 미처리현황 = 홈과 같은 kpi/kpiData.loadUnhandledRows() → homeUnhandled.rowsForTab(부서 탭). 숫자가 홈 "경영/운영/영업" 탭과 같다.
 *   모든 줄(앱 접수·시트 행)에 [완료][보류][배정](UnhandledActionBar — 홈 팝업·현황판과 같은 부품, 확인창 포함, 2026-10-25 밤).
 *   시트만 있는 행은 시트 상태·처리자 칸만(statusOnly), 앱 접수는 runDeptAction. 누른 줄은 unhandledPending 으로 바로 빠지고 1.5초 뒤 다시 읽는다.
 *   미루기·메모는 일정리스트 카드와 접수리스트 상세의 DeptActionBar 에 남아 있다.
 * - 60초마다·창 복귀 때 다시 읽는다. 화면이 숨어 있으면(useScreenActive) 쉰다. 실패는 빨간 줄로 보이고 이전 값은 둔다.
 * 배정 = remote_meta.handler 1명(runDeptAction "assign" → 시트 처리자 칸 갱신). 알림은 보내지 않는다(Q6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ExternalLink, Loader2, Plus } from "lucide-react";
import { selectRows } from "./supabase";
import { fetchOpenReceptions, type OpenReceptionRow } from "./deptReceptionApi";
import { deptCalEditPatch, deptCalFormOf, deptCalQuery, deptMonthGrid, emptyDeptCalForm, shiftDeptMonth, toDeptCalEvent, type DeptCalEvent, type DeptCalForm } from "./deptCalendarView";
import { resolveActor, runDeptAction, saveDeptCalEdit, warnTone, type DeptRowLike } from "./deptReceptionFlow";
import { DEPT_UNHANDLED_TAB, deptMemberNames, deptPlanBuckets, planTodoCount, sheetKeyOf, type PlanBucket } from "./deptPlan";
import { createPortal } from "react-dom";
import { rowsForTab, UNHANDLED_BADGE, type UnhandledRow } from "./homeUnhandled";
import { UnhandledDetail } from "./HomeUnhandledPanel";
import { deptSheetUrl } from "./receptionSheetOpen";
import UnhandledActionBar from "./UnhandledActionBar.view";
import { applyPending, usePendingVersion } from "./unhandledPending";
import { DEPT_RIGHT_VIEWS, type DeptRightView } from "./receptionRightView";
import type { DeptType } from "./deptReception";
import { useMembers } from "./authors";
import { useScreenActive } from "./screenActive";
import { kstDate } from "./visits";
import { notify } from "./toast";
import { openNativePicker } from "./datePicker";
import DeptPlanList from "./DeptPlanList.view";
import DeptCalendarPanel from "./DeptCalendarPanel";
import DeptActionBar from "./DeptActionBar";
import AssigneePicker from "./AssigneePicker";
import FormModal from "./FormModal";

const POLL_MS = 60_000;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type DeptCounts = { plan: number; board: number };

/** 부서 화면 전환 막대 [일정리스트 n | 달력 | 접수리스트 | 미처리현황 n] */
export function DeptRightTabs({ value, onChange, counts }: { value: DeptRightView; onChange: (v: DeptRightView) => void; counts: DeptCounts | null }) {
  const countOf = (v: DeptRightView) => (!counts ? null : v === "plan" ? counts.plan : v === "board" ? counts.board : null);
  const items: Array<[DeptRightView, string, number | null]> = DEPT_RIGHT_VIEWS.map(([v, label]) => [v, label, countOf(v)]);
  return (
    <div className="grid min-h-11 grid-cols-4 divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white sm:min-h-9" role="tablist" aria-label="오른쪽 보기">
      {items.map(([v, label, n]) => {
        const on = value === v;
        return (
          <button key={v} type="button" role="tab" aria-selected={on} onClick={() => onChange(v)}
            className={`flex items-center justify-center px-1 text-[12px] font-bold transition ${on ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            {label}{n !== null && <span className={`ml-1 font-mono tabular-nums ${on ? (n ? "text-rose-300" : "text-white/70") : n ? "text-rose-600" : "text-slate-400"}`}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 머리 [시트 열기 ↗] — 경영·영업만(운영지원은 시트 없음 → 숨김). 폰에서는 "시트"만. */
export function DeptSheetLink({ dept }: { dept: string }) {
  const url = deptSheetUrl(dept);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={`${dept} 접수 시트를 새 창으로 엽니다`}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2.5 text-[11px] font-black text-white hover:bg-white/20 sm:min-h-8">
      <ExternalLink size={12} aria-hidden /><span className="sm:hidden">시트</span><span className="hidden sm:inline">시트 열기</span>
    </a>
  );
}

type Props = {
  dept: DeptType;
  /** "list" 일 때는 아무것도 그리지 않지만 숫자를 위해 계속 읽는다 */
  view: DeptRightView;
  author?: string;
  /** 바깥(접수 저장 등)에서 다시 읽으라는 신호 */
  reloadKey?: number;
  onCounts?: (c: DeptCounts) => void;
  /** 이 화면에서 처리·배정한 뒤(바깥 접수리스트 새로 읽기용, 1.5초 모아서 한 번) */
  onChanged?: () => void;
};

export default function DeptWorkspacePanel({ dept, view, author, reloadKey = 0, onCounts, onChanged }: Props) {
  const active = useScreenActive();
  const members = useMembers();
  const [today, setToday] = useState(kstDate());
  const [rows, setRows] = useState<OpenReceptionRow[]>([]);
  const [events, setEvents] = useState<DeptCalEvent[]>([]);
  const [unhandled, setUnhandled] = useState<UnhandledRow[]>([]);
  const [detail, setDetail] = useState<UnhandledRow | null>(null);
  const [unNote, setUnNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState<PlanBucket | null>(null);
  const [assignRow, setAssignRow] = useState<OpenReceptionRow | null>(null);
  const [freeName, setFreeName] = useState("");
  const [assigningId, setAssigningId] = useState("");
  // ev 가 null 이면 새 부서 일정(일정리스트 [＋ 일정 추가])
  const [edit, setEdit] = useState<{ ev: DeptCalEvent | null; form: DeptCalForm } | null>(null);
  const [calMonth, setCalMonth] = useState(() => `${kstDate().slice(0, 7)}-01`);
  const [calTick, setCalTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    const t = kstDate();
    const [open, cal, un] = await Promise.allSettled([
      fetchOpenReceptions(90),
      selectRows<Parameters<typeof toDeptCalEvent>[0]>("team_calendar_events", deptCalQuery(dept, t, addDays(t, 90))),
      import("./kpi/kpiData").then((m) => m.loadUnhandledRows(t)), // 홈과 같은 로더(큰 모듈이라 늦게 읽는다)
    ]);
    if (my !== seq.current) return;
    const errs: string[] = [];
    setToday(t);
    if (open.status === "fulfilled") setRows(open.value.filter((r) => r.type === dept)); else errs.push(`열린 접수를 못 읽었습니다: ${msg(open.reason)}`);
    if (cal.status === "fulfilled") setEvents(cal.value.map(toDeptCalEvent).filter((ev): ev is DeptCalEvent => !!ev)); else errs.push(`부서 달력을 못 읽었습니다: ${msg(cal.reason)}`);
    if (un.status === "fulfilled") {
      setUnhandled(rowsForTab(un.value.rows, DEPT_UNHANDLED_TAB[dept]));
      setUnNote([un.value.partialError, un.value.info.notice].filter(Boolean).join(" · "));
    } else errs.push(`미처리를 못 읽었습니다: ${msg(un.reason)}`);
    setErrors(errs);
    setLoading(false);
  }, [dept]);

  // 부서가 바뀌면 처음부터
  useEffect(() => { setLoading(true); setRows([]); setEvents([]); setUnhandled([]); setBucket(null); }, [dept]);
  useEffect(() => {
    if (!active) return;
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, active, reloadKey]);

  // 처리 뒤 모아서 다시 읽기(DeptActionBar 는 낙관 값·결과 값으로 두 번 부른다)
  const settleTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);
  const settle = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => { void load(); onChanged?.(); }, 1500);
  };
  const patchRow = (next: DeptRowLike) => setRows((cur) => cur.map((r) => (r.id === next.id ? ({ ...r, ...next } as OpenReceptionRow) : r)));

  const closedIds = useMemo(() => new Set(rows.filter((r) => r.status === "완료" || r.status === "취소").map((r) => r.id)), [rows]);
  const pendingVer = usePendingVersion(); // 방금 누른 줄은 다시 읽기 전에도 먼저 반영(prune 은 로더만 — 여기는 부서 탭 일부라 지우지 않는다)
  const boardRows = useMemo(() => (pendingVer >= 0 ? applyPending(unhandled) : unhandled).filter((u) => !(u.receptionId && closedIds.has(u.receptionId) && !sheetKeyOf(u.key))), [unhandled, closedIds, pendingVer]);
  const buckets = useMemo(() => deptPlanBuckets(dept, rows, events, today), [dept, rows, events, today]);
  const shownBucket: PlanBucket = bucket ?? "today";
  const sheetCount = boardRows.filter((u) => sheetKeyOf(u.key)).length;
  const planCount = planTodoCount(buckets);
  useEffect(() => { if (!loading) onCounts?.({ plan: planCount, board: boardRows.length }); }, [planCount, boardRows.length, loading, onCounts]);

  const names = useMemo(() => deptMemberNames(dept, members), [dept, members]);
  const openAssign = (row: OpenReceptionRow) => { setFreeName(String(row.remote_meta?.handler || "")); setAssignRow(row); };
  const assign = async (row: OpenReceptionRow, handler: string) => {
    setAssignRow(null);
    const prev = row;
    setAssigningId(row.id);
    patchRow({ ...row, remote_meta: { ...(row.remote_meta || {}), handler } }); // 카드 먼저
    try {
      const res = await runDeptAction(row, "assign", { by: resolveActor(author), handler });
      patchRow(res.row);
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      if (!res.warnings.some((w) => warnTone(w) === "error")) notify(handler ? `처리자를 ${handler}(으)로 배정했습니다.` : "처리자를 비웠습니다(미배정).", "success");
      settle();
    } catch (e) {
      patchRow(prev); // 되돌림
      notify(`배정하지 못했습니다: ${msg(e)}`, "error");
    } finally { setAssigningId(""); }
  };

  const saveEvent = async () => {
    if (!edit || saving) return;
    const checked = deptCalEditPatch({ ...edit.form, time: edit.ev?.time || "" });
    if (!checked.ok) { notify(checked.error, "error"); return; }
    setSaving(true);
    try {
      const res = await saveDeptCalEdit(dept, edit.ev, checked.patch, resolveActor(author));
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      if (!res.warnings.length) notify(edit.ev ? "일정을 수정했습니다." : "부서 달력에 일정을 추가했습니다.", "success");
      setEdit(null);
      setCalTick((n) => n + 1);
      void load();
    } catch (e) {
      notify(`일정 저장 실패: ${msg(e)}`, "error");
    } finally { setSaving(false); }
  };

  const actions = (row: DeptRowLike) => <DeptActionBar row={row} compact author={author} onChanged={(next) => { patchRow(next); settle(); }} />;
  // 미처리현황 줄 아래 단추 — 앱 접수·시트 행 모두 홈·현황판과 같은 [완료][보류][배정](확인창 포함)
  const unhandledActions = (u: UnhandledRow) => <UnhandledActionBar row={u} author={author} onFinished={() => settle()} />;

  // 달력에서 고치고 일정리스트로 돌아오면 다시 읽는다(달력은 자기 조회를 따로 한다)
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current === "cal" && view === "plan") void load();
    prevView.current = view;
  }, [view, load]);
  const calDays = useMemo(() => deptMonthGrid(calMonth), [calMonth]);

  if (view === "list") return null;
  return (
    <div className="pb-2">
      {!!errors.length && <div className="mx-3 mt-2 space-y-0.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">{errors.map((e) => <div key={e}>{e}</div>)}</div>}

      {view === "plan" ? (
        <>
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="min-w-0 flex-1 text-[11px] font-bold text-slate-400">처리자 알약을 눌러 배정 · 단추로 완료·미루기. 달력으로 보기·삭제는 [달력].</span>
            <button type="button" onClick={() => setEdit({ ev: null, form: emptyDeptCalForm(today) })}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-blue-600 px-3 text-[11px] font-black text-white hover:bg-blue-700 sm:min-h-8"><Plus size={12} aria-hidden />일정 추가</button>
          </div>
          <DeptPlanList buckets={buckets} active={shownBucket} onActive={setBucket} loading={loading} assigningId={assigningId}
            onAssign={openAssign} onOpenEvent={(ev) => setEdit({ ev, form: deptCalFormOf(ev) })} renderActions={actions} />
        </>
      ) : view === "cal" ? (
        <DeptCalendarPanel key={dept} team={dept} month={calMonth} days={calDays} today={today} mode="calendar" compact
          reloadTick={calTick + reloadKey} onMonth={(d) => setCalMonth((m) => shiftDeptMonth(m, d))} />
      ) : (
        <div>
          <div className="px-3 pt-2 text-[11px] font-bold text-slate-500">
            홈 미처리 "{DEPT_UNHANDLED_TAB[dept]}" 탭과 같은 숫자 · <b className="tabular-nums text-slate-900">{boardRows.length}</b>건
            {sheetCount > 0 && <> · <span className="text-emerald-700">시트 건 {sheetCount} — [완료]·[보류]는 시트 상태 칸에 적힘</span></>}
          </div>
          {!!unNote && <div className="mx-3 mt-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-800">{unNote}</div>}
          <div className="mt-2 max-h-[70vh] divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
            {loading && !boardRows.length && <div className="p-8 text-center text-xs font-bold text-slate-400">불러오는 중…</div>}
            {!loading && !boardRows.length && <div className="p-8 text-center text-xs font-bold text-slate-400">미처리가 없습니다.</div>}
            {boardRows.map((u) => {
              const sk = sheetKeyOf(u.key);
              return (
                <div key={u.key} className="space-y-1.5 px-3 py-2.5">
                  <button type="button" onClick={() => setDetail(u)} aria-haspopup="dialog" className="block min-h-11 w-full space-y-1.5 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${sk ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{sk ? "시트" : UNHANDLED_BADGE[u.kind]}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-black text-slate-900">{u.vendor || "업체 미정"}</span>
                    <span className={`shrink-0 text-[11px] font-bold tabular-nums ${u.ageDays >= 7 ? "text-rose-600" : "text-slate-400"}`}>{u.date ? `${u.date.slice(5)} · ${u.ageDays}일` : "날짜 모름"}</span>
                  </div>
                  <div className="truncate text-[12px] font-semibold text-slate-500">{u.title || "-"}</div>
                  <div className="text-[11px] font-bold text-slate-400">처리 {u.assignee || <span className="text-rose-500">미배정</span>} · {u.status || "접수"}</div>
                  </button>
                  {unhandledActions(u)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {detail && typeof document !== "undefined" && createPortal(<UnhandledDetail row={detail} onClose={() => setDetail(null)} actions author={author} />, document.body)}

      {assignRow && (names.length ? (
        <AssigneePicker names={names} value={String(assignRow.remote_meta?.handler || "")} max={1} title="처리자 배정"
          subtitle={`${assignRow.vendor || "업체 미정"} · 1명 · 영업·경영은 시트 처리자 칸에도 반영`}
          onClose={() => setAssignRow(null)} onSave={(v) => void assign(assignRow, v)} />
      ) : (
        <FormModal title="처리자 배정" subtitle={`${assignRow.vendor || "업체 미정"} · 부서 명단이 비어 있어 이름을 직접 적습니다`} onClose={() => setAssignRow(null)}
          footer={(
            <div className="flex w-full justify-end gap-2">
              <button type="button" onClick={() => setAssignRow(null)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 sm:min-h-9">닫기</button>
              <button type="button" onClick={() => void assign(assignRow, freeName.trim())} className="min-h-11 rounded-lg bg-emerald-600 px-4 text-xs font-black text-white hover:bg-emerald-700 sm:min-h-9">배정 저장</button>
            </div>
          )}>
          <input value={freeName} autoFocus onChange={(e) => setFreeName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void assign(assignRow, freeName.trim()); }}
            placeholder="처리자 이름 (비우면 미배정)" aria-label="처리자 이름" className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-500" />
          <div className="mt-1.5 text-[11px] font-semibold text-slate-400">관리 탭 인원 명단에 이 부서 사람을 올리면 다음부터 고르기로 나옵니다.</div>
        </FormModal>
      ))}

      {edit && (
        <FormModal title={edit.ev ? (edit.ev.title || "(제목 없음)") : "부서 일정 추가"} subtitle={edit.ev ? `부서 일정 · 수정${edit.ev.author ? ` · 작성 ${edit.ev.author}` : ""}` : "부서 달력 · 새 일정"} icon={<CalendarDays size={17} />}
          onClose={() => { if (!saving) setEdit(null); }}
          footer={(
            <div className="flex w-full justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setEdit(null)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 disabled:opacity-40 sm:min-h-9">취소</button>
              <button type="button" disabled={saving} onClick={() => void saveEvent()} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-40 sm:min-h-9">{saving && <Loader2 size={13} className="animate-spin" aria-hidden />}저장</button>
            </div>
          )}>
          <div className="space-y-2">
            <label className="block"><span className="text-[11px] font-bold text-slate-500">예정일</span>
              <input type="date" value={edit.form.date} onClick={openNativePicker} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, date: e.target.value } })} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-500" />
            </label>
            <label className="block"><span className="text-[11px] font-bold text-slate-500">제목</span>
              <input value={edit.form.title} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, title: e.target.value } })} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-500" />
            </label>
            <label className="block"><span className="text-[11px] font-bold text-slate-500">메모</span>
              <textarea value={edit.form.memo} rows={3} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, memo: e.target.value } })} className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
            </label>
            {edit.ev && <div className="text-[11px] font-semibold text-slate-400">삭제·새 일정 추가는 [달력]에서 합니다.</div>}
          </div>
        </FormModal>
      )}
    </div>
  );
}
