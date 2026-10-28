/**
 * 서비스접수 › 경영·운영·영업 [일정리스트]·[달력] 두 보기 부품(2026-10-24 → 2026-10-25 밤 축소).
 * 설계: docs/tasks/dept-mini-workspace.md. 2026-10-25 밤 사용자 "CS 접수·원격·IT 처럼 똑같이 가자":
 * 오른쪽 기둥 뼈대([접수리스트][미처리 현황] + 현황판 ReceptionBoardPanel)는 6종 공통으로 ServiceReception 이 그리고,
 * 부서일 때만 탭 줄 뒤에 붙는 [일정리스트][달력] 본체가 이 파일이다. 옛 4탭 전환 막대(DeptRightTabs)·부서 미처리 목록은 걷어냄.
 *
 * 데이터
 * - 일정리스트 [금일/익일/예정] = fetchOpenReceptions(90) 중 이 부서 + team_calendar_events 중 접수와 연결 안 된 부서 일정(오늘~90일) → deptPlanBuckets.
 * - 달력 = DeptCalendarPanel compact(그 부서 달력 추가·수정·삭제).
 * - 60초마다·창 복귀 때 다시 읽는다. 화면이 숨어 있으면(useScreenActive) 쉰다. 실패는 빨간 줄로 보이고 이전 값은 둔다.
 *   view 가 plan·cal 이 아니어도(접수리스트·미처리 현황 보기 중) 탭 숫자를 위해 계속 읽는다.
 * 2026-10-28(docs/tasks/dept-plan-sheet-rows-2026-10-28.md): 영업·경영은 시트에만 적힌 접수도 보인다(운영지원은 시트 없음 → 안 읽음).
 *   일정리스트 [금일] = 오늘 접수일 열린 시트 줄 + 오늘 완료(앱 접수·시트 줄, 맨 아래 회색). 달력 = 격자 범위 시트 줄(view "cal" 일 때만 읽음).
 *   시트 읽기 실패는 회색 한 줄("앱 접수만 표시") — 빨간 오류 줄과 구분. 스위치 RECEPTION_SHEET_OPEN_ENABLED 꺼짐이면 부르지 않는다(fetchSheetListRows).
 * 배정 = remote_meta.handler 1명(runDeptAction "assign" → 시트 처리자 칸 갱신). 푸시 알림은 보내지 않는다(Q6). 부서 방에는 [배정] 후속 글이 간다(2026-10-27, deptReceptionFlow).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ExternalLink, Loader2, Plus } from "lucide-react";
import { selectRows } from "./supabase";
import { fetchOpenReceptions, type OpenReceptionRow } from "./deptReceptionApi";
import { deptCalEditPatch, deptCalFormOf, deptCalQuery, deptMonthGrid, emptyDeptCalForm, shiftDeptMonth, toDeptCalEvent, type DeptCalEvent, type DeptCalForm } from "./deptCalendarView";
import { resolveActor, runDeptAction, saveDeptCalEdit, warnTone, type DeptRowLike } from "./deptReceptionFlow";
import { deptMemberNames, deptPlanBuckets, planTodoCount, type PlanBucket } from "./deptPlan";
import { deptSheetUrl, fetchSheetListRows, type SheetListRow } from "./receptionSheetOpen";
import { deptSheetSource, fetchDoneToday } from "./deptPlanSheet";
import DeptSheetPlanCard from "./DeptSheetPlanCard";
import DeptReceptionDetail from "./DeptReceptionDetail";
import type { ReceptionRightView } from "./receptionRightView";
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

export type DeptCounts = { plan: number };

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
  /** "plan"·"cal" 일 때만 그린다. 다른 보기(접수리스트·미처리 현황)일 때는 아무것도 그리지 않지만 탭 숫자를 위해 계속 읽는다 */
  view: ReceptionRightView;
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
  const sheetSource = deptSheetSource(dept);
  const [sheetToday, setSheetToday] = useState<SheetListRow[]>([]);
  const [doneRows, setDoneRows] = useState<OpenReceptionRow[]>([]);
  const [sheetNote, setSheetNote] = useState("");
  const [calSheet, setCalSheet] = useState<SheetListRow[]>([]);
  const [calSheetNote, setCalSheetNote] = useState("");
  const calSeq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    const t = kstDate();
    const src = deptSheetSource(dept);
    const [open, cal, done, sheet] = await Promise.allSettled([
      fetchOpenReceptions(90),
      selectRows<Parameters<typeof toDeptCalEvent>[0]>("team_calendar_events", deptCalQuery(dept, t, addDays(t, 90))),
      fetchDoneToday<OpenReceptionRow & { completed_at?: string | null }>(dept, t),
      // 오늘 ~ 90일(익일·예정 묶음용, 2026-10-28). 엣지 목록 최대 92일 안. 이번 달 안이면 보관 표는 안 읽는다
      src ? fetchSheetListRows(t, addDays(t, 90), t, { sources: [src] }) : Promise.resolve(null),
    ]);
    if (my !== seq.current) return;
    const errs: string[] = [];
    setToday(t);
    if (open.status === "fulfilled") setRows(open.value.filter((r) => r.type === dept)); else errs.push(`열린 접수를 못 읽었습니다: ${msg(open.reason)}`);
    if (cal.status === "fulfilled") setEvents(cal.value.map(toDeptCalEvent).filter((ev): ev is DeptCalEvent => !!ev)); else errs.push(`부서 달력을 못 읽었습니다: ${msg(cal.reason)}`);
    if (done.status === "fulfilled") setDoneRows(done.value); else errs.push(`오늘 완료한 접수를 못 읽었습니다: ${msg(done.reason)}`);
    // 시트 줄: 읽혔으면 바꾸고, 못 읽었으면 이전 줄을 두고 회색 안내(스위치 꺼짐 = 줄 없음·안내 없음)
    if (sheet.status === "rejected") setSheetNote(`시트 접수를 못 읽음 — 앱 접수만 표시 (${msg(sheet.reason).slice(0, 120)})`);
    else if (!sheet.value) { setSheetToday([]); setSheetNote(""); }
    else {
      if (sheet.value.ok || !sheet.value.errors.length) setSheetToday(sheet.value.rows);
      setSheetNote(sheet.value.errors.join(" · "));
    }
    setErrors(errs);
    setLoading(false);
  }, [dept]);

  // 부서가 바뀌면 처음부터
  useEffect(() => { setLoading(true); setRows([]); setEvents([]); setBucket(null); setSheetToday([]); setDoneRows([]); setSheetNote(""); setCalSheet([]); setCalSheetNote(""); }, [dept]);
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

  const buckets = useMemo(() => deptPlanBuckets(dept, rows, events, today, { sheet: sheetToday, done: doneRows }), [dept, rows, events, today, sheetToday, doneRows]);
  const shownBucket: PlanBucket = bucket ?? "today";
  const planCount = planTodoCount(buckets);
  useEffect(() => { if (!loading) onCounts?.({ plan: planCount }); }, [planCount, loading, onCounts]);

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
      if (!res.warnings.some((w) => warnTone(w) === "error")) notify(`${handler ? `처리자를 ${handler}(으)로 배정했습니다.` : "처리자를 비웠습니다(미배정)."}${res.summary ? ` · ${res.summary}` : ""}`, "success");
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

  // 달력에서 고치고 일정리스트로 돌아오면 다시 읽는다(달력은 자기 조회를 따로 한다)
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current === "cal" && view === "plan") void load();
    prevView.current = view;
  }, [view, load]);
  const calDays = useMemo(() => deptMonthGrid(calMonth), [calMonth]);

  // 달력 시트 줄 — [달력]을 볼 때만, 격자 42칸 범위. 60초마다·창 복귀 때, 숨은 화면이면 쉼
  const calFrom = calDays[0];
  const calTo = calDays[calDays.length - 1];
  const loadCalSheet = useCallback(async () => {
    if (!sheetSource) return;
    const my = ++calSeq.current;
    try {
      const res = await fetchSheetListRows(calFrom, calTo, kstDate(), { sources: [sheetSource] });
      if (my !== calSeq.current) return;
      if (res.ok || !res.errors.length) setCalSheet(res.rows);
      setCalSheetNote(res.errors.join(" · "));
    } catch (e) {
      if (my === calSeq.current) setCalSheetNote(`시트 접수를 못 읽음 — 앱 일정만 표시 (${msg(e).slice(0, 120)})`);
    }
  }, [sheetSource, calFrom, calTo]);
  useEffect(() => {
    if (!active || view !== "cal" || !sheetSource) return;
    void loadCalSheet();
    const refresh = () => { if (document.visibilityState === "visible") void loadCalSheet(); };
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [active, view, sheetSource, loadCalSheet, reloadKey, calTick]);
  // 달 이동 때 다른 달 줄이 잠깐 남지 않게
  useEffect(() => { setCalSheet([]); }, [calFrom]);

  if (view !== "plan" && view !== "cal") return null;
  return (
    <div className="pb-2">
      {!!errors.length && <div className="mx-3 mt-2 space-y-0.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">{errors.map((e) => <div key={e}>{e}</div>)}</div>}

      {view === "plan" && !!sheetNote && <div className="mx-3 mt-2 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-500">{sheetNote}</div>}
      {view === "cal" && !!calSheetNote && <div className="mx-3 mt-2 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-500">{calSheetNote}</div>}

      {view === "plan" ? (
        <>
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="min-w-0 flex-1 text-[11px] font-bold text-slate-400">처리자 알약을 눌러 배정 · 단추로 완료·미루기. 달력으로 보기·삭제는 [달력].</span>
            <button type="button" onClick={() => setEdit({ ev: null, form: emptyDeptCalForm(today) })}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-blue-600 px-3 text-[11px] font-black text-white hover:bg-blue-700 sm:min-h-8"><Plus size={12} aria-hidden />일정 추가</button>
          </div>
          <DeptPlanList buckets={buckets} active={shownBucket} onActive={setBucket} loading={loading} assigningId={assigningId}
            onAssign={openAssign} onOpenEvent={(ev) => setEdit({ ev, form: deptCalFormOf(ev) })} renderActions={actions}
            renderDoneDetail={(row) => <DeptReceptionDetail row={row} author={author} actions={false} onChanged={(next) => { setDoneRows((cur) => cur.map((r) => (r.id === next.id ? ({ ...r, ...next } as OpenReceptionRow) : r))); settle(); }} />}
            renderSheet={(it) => <DeptSheetPlanCard sheet={it.sheet} done={it.done} author={author} onSent={settle} />} />
        </>
      ) : (
        <DeptCalendarPanel key={dept} team={dept} month={calMonth} days={calDays} today={today} mode="calendar" compact
          reloadTick={calTick + reloadKey} onMonth={(d) => setCalMonth((m) => shiftDeptMonth(m, d))}
          sheetRows={sheetSource ? calSheet : undefined} author={author} onSheetChanged={() => { window.setTimeout(() => void loadCalSheet(), 1500); }} />
      )}

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
