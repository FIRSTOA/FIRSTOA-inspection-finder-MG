/**
 * 부서 달력(경영·운영·영업) — 서비스접수 › 부서 화면 [달력] 보기(2026-10-25부터, 그 전엔 캘린더 탭·일정리스트 팀 칩). 원본은 team_calendar_events(네이버 미러 없음).
 * 서비스접수의 예정일이 이 표에 1건씩 올라온다(deptReceptionApi.upsertDeptCalendar).
 * 2026-10-19: 상세에서 제목·메모·날짜 수정(시간 칸 없음)·삭제, 빈 칸 더블클릭/[이 날에 추가]로 새 부서 일정(reception_id 없음).
 * 접수에서 온 일정은 날짜를 바꾸면 접수 예정일도, 지우면 접수 예정일이 비워진다(deptReceptionFlow.saveDeptCalEdit/deleteDeptCalEdit).
 * as_tickets·네이버 캘린더와는 섞지 않는다.
 * 2026-10-28: 선택 prop sheetRows(시트에만 적힌 접수, 접수일 칸) — 속 빈 점·"시트" 칩(완료는 회색 취소선, Q2), 누르면 SheetListDetail 창.
 *   같은 날 같은 업체의 앱 일정이 있으면 시트 칩은 숨긴다(deptPlanSheet.hideLikeEvents). 달력 자체 조회는 그대로.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, Plus, Trash2 } from "lucide-react";
import { selectRows } from "./supabase";
import FormModal from "./FormModal";
import { RECEPTION_TYPE_META } from "./ReceptionTypePicker";
import {
  DEPT_CAL_LABEL, deptCalEditPatch, deptCalFormOf, deptCalQuery, emptyDeptCalForm, groupDeptEventsByDate, toDeptCalEvent,
  type DeptCalEvent, type DeptCalForm, type DeptCalTeam,
} from "./deptCalendarView";
import { deleteDeptCalEdit, resolveActor, saveDeptCalEdit, warnTone } from "./deptReceptionFlow";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { openNativePicker } from "./datePicker";
import { sheetListToListRow, type SheetListRow } from "./receptionSheetOpen";
import { groupSheetByDate, hideLikeEvents } from "./deptPlanSheet";
import SheetListDetail from "./SheetListDetail";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} (${WEEK[new Date(`${ymd}T12:00:00`).getDay()]})`;

export default function DeptCalendarPanel({ team, month, days, today, mode, reloadTick, onMonth, compact = false, sheetRows, author, onSheetChanged }: {
  team: DeptCalTeam;
  month: string;          // yyyy-MM-01 (화면 달)
  days: string[];         // 달력 격자 42칸(앞뒤 달 포함) — 조회 범위도 이것과 같게
  today: string;          // 오늘(KST)
  mode: "calendar" | "list";
  reloadTick: number;     // 바깥 달력 폴링(45초·창 복귀)에 묶는다
  onMonth?: (delta: number) => void; // 있으면 머리에 ‹ 달 › 이동(달 이동이 없는 일정리스트 화면용)
  compact?: boolean;      // 좁은 기둥(서비스접수 부서 업무공간): 화면 폭과 상관없이 점 격자 + 고른 날 목록
  sheetRows?: SheetListRow[]; // 이 부서 출처 시트 줄(격자 범위) — 없으면 예전 그대로
  author?: string;            // 시트 줄 처리 단추의 작성자
  onSheetChanged?: () => void; // 시트 줄 처리 단추를 보낸 뒤
}) {
  const meta = RECEPTION_TYPE_META[team];
  const label = DEPT_CAL_LABEL[team];
  const [events, setEvents] = useState<DeptCalEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(today);
  // 편집 모달 — ev 가 null 이면 새 일정
  const [edit, setEdit] = useState<{ ev: DeptCalEvent | null; form: DeptCalForm } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState<SheetListRow | null>(null);
  const setDetail = (ev: DeptCalEvent) => setEdit({ ev, form: deptCalFormOf(ev) });
  const openNew = (date: string) => { setSelected(date); setEdit({ ev: null, form: emptyDeptCalForm(date) }); };
  const from = days[0];
  const to = days[days.length - 1];

  const load = useCallback(async (signal: { stale: boolean }) => {
    try {
      const rows = await selectRows<Parameters<typeof toDeptCalEvent>[0]>("team_calendar_events", deptCalQuery(team, from, to));
      if (signal.stale) return;
      setEvents(rows.map(toDeptCalEvent).filter((ev): ev is DeptCalEvent => !!ev));
      setError("");
    } catch (e) {
      if (!signal.stale) setError(`${label} 달력을 못 읽었습니다: ${(e as Error).message}`); // 이전 목록은 그대로 두고 안내만
    } finally {
      if (!signal.stale) setLoading(false);
    }
  }, [team, from, to, label]);
  useEffect(() => {
    const signal = { stale: false };
    void load(signal);
    return () => { signal.stale = true; };
  }, [load, reloadTick]);

  const save = async () => {
    if (!edit || busy) return;
    const checked = deptCalEditPatch({ ...edit.form, time: "" });
    if (!checked.ok) { notify(checked.error, "error"); return; }
    setBusy(true);
    try {
      const res = await saveDeptCalEdit(team, edit.ev, checked.patch, resolveActor());
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      if (!res.warnings.length) notify(edit.ev ? "일정을 수정했습니다." : `${label} 부서 달력에 추가했습니다.`, "success");
      setEdit(null);
      setSelected(checked.patch.date);
      await load({ stale: false });
    } catch (e) {
      notify(`일정 저장 실패: ${(e as Error).message}`, "error");
    } finally { setBusy(false); }
  };
  const remove = async () => {
    const ev = edit?.ev;
    if (!ev || busy) return;
    const msg = ev.receptionId
      ? `"${ev.title || "일정"}" 일정을 지울까요?\n접수에서 온 일정이라 접수의 예정일도 비워집니다(접수는 남습니다).`
      : `"${ev.title || "일정"}" 일정을 지울까요?`;
    if (!(await askConfirm(msg, { danger: true, okLabel: "지우기" }))) return;
    setBusy(true);
    try {
      const res = await deleteDeptCalEdit(ev);
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      if (!res.warnings.length) notify("일정을 지웠습니다.", "success");
      setEdit(null);
      await load({ stale: false });
    } catch (e) {
      notify(`일정 삭제 실패: ${(e as Error).message}`, "error");
    } finally { setBusy(false); }
  };

  const byDate = useMemo(() => groupDeptEventsByDate(events), [events]);
  const sheetByDate = useMemo(() => groupSheetByDate(hideLikeEvents(sheetRows || [], events)), [sheetRows, events]);
  const monthSheetCount = Array.from(sheetByDate.entries()).reduce((n, [d, l]) => n + (d.slice(0, 7) === month.slice(0, 7) ? l.length : 0), 0);
  const sheetChip = (r: SheetListRow) => (r.cls === "done" ? "border-slate-200 bg-slate-50 text-slate-400 line-through" : "border-slate-300 bg-white text-slate-700");
  const sheetKey = (r: SheetListRow) => `${r.source}:${r.month}:${r.seq || r.sheetRow}`;
  const monthKey = month.slice(0, 7);
  const monthEvents = events.filter((ev) => ev.date.slice(0, 7) === monthKey);
  const chip = (ev: DeptCalEvent) => (ev.done ? "bg-slate-100 text-slate-400 line-through" : meta.badge);
  const row = (ev: DeptCalEvent) => (
    <button key={ev.id} type="button" onClick={() => setDetail(ev)} className={`block w-full rounded-lg px-3 py-2.5 text-left ${chip(ev)}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-black">{ev.time && `${ev.time} `}{ev.title || "(제목 없음)"}</span>
        {!!ev.author && <span className="shrink-0 text-[10px] font-black opacity-70">{ev.author}</span>}
      </div>
      {!!ev.memo && <div className="mt-1 truncate text-xs font-semibold opacity-75">{ev.memo.split("\n")[0]}</div>}
    </button>
  );
  const selectedList = byDate.get(selected) || [];
  const selectedSheet = sheetByDate.get(selected) || [];
  const sheetRowBtn = (r: SheetListRow) => (
    <button key={sheetKey(r)} type="button" onClick={() => setSheetOpen(r)} className={`block w-full rounded-lg border px-3 py-2 text-left ${sheetChip(r)}`}>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 rounded border border-slate-300 px-1 text-[10px] font-black text-slate-500">시트</span>
        <span className="min-w-0 flex-1 truncate text-sm font-black">{r.time && `${r.time} `}{r.vendor || "업체 미정"}{r.field ? ` · ${r.field}` : ""}</span>
        {r.cls === "done" ? <span className="shrink-0 text-[10px] font-black">완료</span> : r.cls === "hold" ? <span className="shrink-0 text-[10px] font-black text-amber-700">보류</span> : null}
      </div>
      {!!r.summary && <div className="mt-0.5 truncate text-xs font-semibold opacity-75">{r.summary}</div>}
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-[11px] font-bold text-slate-500 sm:px-4">
        {onMonth && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button type="button" aria-label="이전 달" onClick={() => onMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-full text-base text-slate-500 hover:bg-slate-100">‹</button>
            <span className="text-xs font-black tabular-nums text-slate-900">{Number(month.slice(0, 4))}.{Number(month.slice(5, 7))}</span>
            <button type="button" aria-label="다음 달" onClick={() => onMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-full text-base text-slate-500 hover:bg-slate-100">›</button>
          </span>
        )}
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.bar}`} />
        <span className="min-w-0 flex-1">{label} 부서 달력 · 서비스접수 예정일 + 부서 일정</span>
        <span className="shrink-0 tabular-nums text-slate-400">{loading ? "불러오는 중" : `이달 ${monthEvents.length}건${monthSheetCount ? ` (시트 ${monthSheetCount})` : ""}`}</span>
        <button type="button" onClick={() => openNew(selected.slice(0, 7) === monthKey ? selected : today.slice(0, 7) === monthKey ? today : month)}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-blue-600 px-2.5 text-[11px] font-black text-white hover:bg-blue-700"><Plus size={12} aria-hidden />추가</button>
      </div>
      {!!error && <div className="mx-3 mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 sm:mx-4">{error}</div>}

      {mode === "list" ? (
        <div className="space-y-4 p-3 sm:p-4">
          {Array.from(groupDeptEventsByDate(monthEvents).entries()).map(([date, list]) => (
            <div key={date}>
              <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${date === today ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                <span className="text-sm font-black">{dayLabel(date)}</span>
                {date === today && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">오늘</span>}
                <span className="text-[11px] font-bold text-slate-400">{list.length}건</span>
              </div>
              <div className="mt-1 space-y-1.5">{list.map(row)}</div>
            </div>
          ))}
          {!loading && !monthEvents.length && <div className="p-12 text-center text-sm font-semibold text-slate-400">이 달의 {label} 일정이 없습니다.</div>}
        </div>
      ) : (
        <>
          {/* 모바일: 점 격자 + 고른 날 목록 */}
          <div className={compact ? "" : "md:hidden"}>
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEK.map((d, i) => <div key={d} className={`py-2 text-center text-[11px] font-black ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((date) => {
                const list = byDate.get(date) || [];
                const inMonth = date.slice(0, 7) === monthKey;
                return (
                  <button key={date} type="button" onClick={() => setSelected(date)} onDoubleClick={() => openNew(date)}
                    className={`min-h-16 border-b border-r border-slate-200 p-1 text-left ${inMonth ? "bg-white" : "bg-slate-50"} ${date === selected ? "ring-2 ring-inset ring-blue-500" : ""}`}>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black ${date === today ? "bg-blue-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{Number(date.slice(8, 10))}</span>
                    <span className="mt-1 flex flex-wrap gap-0.5">
                      {list.slice(0, 4).map((ev) => <span key={ev.id} className={`h-1.5 w-1.5 rounded-full ${ev.done ? "bg-slate-300" : meta.bar}`} />)}
                    </span>
                    {(sheetByDate.get(date) || []).length > 0 && (
                      // 시트 줄 = 속 빈 점(테두리만). 4개 넘으면 숫자
                      <span className="mt-0.5 flex flex-wrap items-center gap-0.5" aria-label={`시트 ${(sheetByDate.get(date) || []).length}건`}>
                        {(sheetByDate.get(date) || []).slice(0, 4).map((r) => <span key={sheetKey(r)} className={`h-1.5 w-1.5 rounded-full border ${r.cls === "done" ? "border-slate-300" : "border-slate-500"}`} />)}
                        {(sheetByDate.get(date) || []).length > 4 && <span className="text-[9px] font-black leading-none text-slate-400">{(sheetByDate.get(date) || []).length}</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-black text-slate-900">{Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일 · {selectedList.length}건{selectedSheet.length ? ` · 시트 ${selectedSheet.length}` : ""}</span>
                <button type="button" onClick={() => openNew(selected)} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-[11px] font-black text-slate-600 hover:bg-slate-100"><Plus size={12} aria-hidden />이 날에 추가</button>
              </div>
              <div className="space-y-1.5">
                {selectedList.map(row)}
                {selectedSheet.map(sheetRowBtn)}
                {!selectedList.length && !selectedSheet.length && <div className="py-4 text-center text-xs font-semibold text-slate-400">등록된 일정이 없습니다.</div>}
              </div>
            </div>
          </div>
          {/* PC: 칸 안에 칩 */}
          <div className={compact ? "hidden" : "hidden overflow-x-auto md:block"}>
            <div className="min-w-[760px]">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {WEEK.map((d, i) => <div key={d} className={`px-2 py-2.5 text-center text-[11px] font-black ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}>{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {days.map((date) => {
                  const list = byDate.get(date) || [];
                  const inMonth = date.slice(0, 7) === monthKey;
                  return (
                    <div key={date} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) openNew(date); }} title="빈 곳을 두 번 누르면 이 날에 일정 추가"
                      className={`min-h-28 border-b border-r border-slate-200 p-1.5 sm:min-h-32 2xl:min-h-40 ${inMonth ? "bg-white" : "bg-slate-50/70"}`}>
                      <div className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-black tabular-nums ${date === today ? "bg-blue-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{Number(date.slice(8, 10))}</div>
                      <div className="max-h-36 space-y-1 overflow-y-auto">
                        {list.map((ev) => (
                          <button key={ev.id} type="button" onClick={() => setDetail(ev)} title={ev.title}
                            className={`block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-bold transition hover:brightness-95 ${chip(ev)}`}>
                            {ev.time && `${ev.time} `}{ev.title || "(제목 없음)"}
                          </button>
                        ))}
                        {(sheetByDate.get(date) || []).map((r) => (
                          <button key={sheetKey(r)} type="button" onClick={() => setSheetOpen(r)} title={`시트 · ${r.vendor}`}
                            className={`block w-full truncate rounded-md border px-2 py-1 text-left text-[11px] font-bold transition hover:brightness-95 ${sheetChip(r)}`}>
                            시트 · {r.vendor || "업체 미정"}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {sheetOpen && (
        <FormModal title={sheetOpen.vendor || "업체 미정"} subtitle={`${label} 시트 접수 · ${dayLabel(sheetOpen.date)}${sheetOpen.time ? ` ${sheetOpen.time}` : ""}${sheetOpen.author ? ` · 접수자 ${sheetOpen.author}` : ""}`}
          icon={<CalendarDays size={17} />} onClose={() => setSheetOpen(null)}
          footer={<div className="flex w-full justify-end"><button type="button" onClick={() => setSheetOpen(null)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-50 sm:min-h-9">닫기</button></div>}>
          <div className="space-y-2">
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-600">시트에서 적은 접수라 날짜를 바꾸거나 지울 수 없습니다 — 시트에서 고치세요.</div>
            <SheetListDetail key={sheetKey(sheetOpen)} row={sheetListToListRow(sheetOpen)} handler={sheetOpen.handler} author={author} onFinished={onSheetChanged} />
          </div>
        </FormModal>
      )}

      {edit && (
        <FormModal title={edit.ev ? (edit.ev.title || "(제목 없음)") : `${label} 부서 일정 추가`}
          subtitle={`${label} 부서 달력 · ${edit.ev ? "수정" : "새 일정"}${edit.ev?.author ? ` · 작성 ${edit.ev.author}` : ""}`} icon={<CalendarDays size={17} />}
          onClose={() => { if (!busy) setEdit(null); }}
          footer={(
            <div className="flex w-full items-center gap-2">
              {edit.ev && (
                <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 size={13} aria-hidden />삭제</button>
              )}
              <button type="button" disabled={busy} onClick={() => setEdit(null)} className="ml-auto rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40">취소</button>
              <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-40">{busy && <Loader2 size={13} className="animate-spin" aria-hidden />}{edit.ev ? "저장" : "추가"}</button>
            </div>
          )}>
          <div className="space-y-2">
            {!!edit.ev?.receptionId && (
              <div className={`rounded-lg px-3 py-2.5 text-xs font-bold ${meta.badge}`}>접수에서 온 일정: 날짜를 바꾸면 접수 예정일도 바뀝니다. 지우면 접수 예정일이 비워집니다(접수는 남음).</div>
            )}
            <div>
              <label className="block"><span className="text-[11px] font-bold text-slate-500">예정일</span>
                <input type="date" value={edit.form.date} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, date: e.target.value } })} onClick={openNativePicker} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-500" />
              </label>
            </div>
            <label className="block"><span className="text-[11px] font-bold text-slate-500">제목</span>
              <input value={edit.form.title} autoFocus={!edit.ev} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, title: e.target.value } })} placeholder="예: 가나상사 계약서 회수"
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold outline-none focus:border-blue-500" />
            </label>
            <label className="block"><span className="text-[11px] font-bold text-slate-500">메모</span>
              <textarea value={edit.form.memo} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, memo: e.target.value } })} rows={3}
                className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold leading-5 outline-none focus:border-blue-500" />
            </label>
            {!!edit.ev?.receptionId && <div className="text-[11px] font-semibold text-slate-400">제목·메모는 접수에서 예정일·분야·내용을 다시 저장하면 접수 내용으로 다시 맞춰집니다.</div>}
            {edit.ev && <div className="text-[11px] font-semibold text-slate-400">현재: {dayLabel(edit.ev.date)}{edit.ev.time && ` ${edit.ev.time}`}</div>}
          </div>
        </FormModal>
      )}
    </div>
  );
}
