/**
 * 팀 전용 캘린더 — 일정리스트·네이버 캘린더와 전혀 동기화되지 않는, 팀끼리만 보는 메모 캘린더.
 * 팀원이 만든 일정은 같은 팀 전원에게 보이고 다른 팀에는 안 보인다(작성자의 팀으로 걸러 표시).
 * 회식·교육·휴무 공지·팀 내부 약속처럼 고객 일정이 아닌 것을 여기에 둔다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";

export type TeamCalendarEvent = { id: string; team: string; date: string; time: string; title: string; memo: string; author: string; created_at: string };

const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStartOf = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const addMonths = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00`); d.setMonth(d.getMonth() + n, 1); return ymdOf(d); };
const lastDayOf = (ymd: string) => { const d = new Date(`${ymd}T12:00:00`); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };

export default function TeamCalendar({ team, author }: { team: string; author: string }) {
  const today = ymdOf(new Date());
  const [month, setMonth] = useState(monthStartOf(today));
  const [events, setEvents] = useState<TeamCalendarEvent[]>([]);
  const [selected, setSelected] = useState(today);
  const [form, setForm] = useState<{ id: string; date: string; time: string; title: string; memo: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const from = addMonths(month, -1);
    const to = `${addMonths(month, 1).slice(0, 7)}-${lastDayOf(addMonths(month, 1))}`;
    try {
      const rows = await selectRows<TeamCalendarEvent>("team_calendar_events",
        `select=*&team=eq.${encodeURIComponent(team)}&date=gte.${from}&date=lte.${to}&order=date.asc,time.asc,created_at.asc`);
      setEvents(rows);
    } catch (e) { notify(`팀 캘린더를 못 읽었습니다: ${(e as Error).message}`, "error"); }
  }, [team, month]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // 팀원이 방금 넣은 것도 보이게 — 60초 주기 + 창 복귀
    const timer = window.setInterval(() => { void load(); }, 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // 달력 칸: 그 달 1일의 요일(일=0)만큼 앞을 비우고 말일까지
  const cells = useMemo(() => {
    const first = new Date(`${month}T12:00:00`);
    const lead = first.getDay();
    const days = lastDayOf(month);
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) out.push(`${month.slice(0, 7)}-${pad(d)}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);
  const byDate = useMemo(() => {
    const map = new Map<string, TeamCalendarEvent[]>();
    for (const ev of events) map.set(ev.date, [...(map.get(ev.date) || []), ev]);
    return map;
  }, [events]);

  const openNew = (date: string) => { setSelected(date); setForm({ id: "", date, time: "", title: "", memo: "" }); };
  const openEdit = (ev: TeamCalendarEvent) => { setSelected(ev.date); setForm({ id: ev.id, date: ev.date, time: ev.time, title: ev.title, memo: ev.memo }); };
  const save = async () => {
    if (!form || busy) return;
    const title = form.title.trim();
    if (!title) { notify("제목을 적어 주세요", "error"); return; }
    setBusy(true);
    try {
      const patch = { team, date: form.date, time: form.time.trim(), title, memo: form.memo.trim(), updated_at: new Date().toISOString() };
      if (form.id) await updateRows("team_calendar_events", `id=eq.${form.id}`, patch);
      else await insertRow("team_calendar_events", { ...patch, author });
      setForm(null);
      setMonth(monthStartOf(form.date));
      setSelected(form.date);
      await load();
      notify(form.id ? "수정했습니다" : `${team}팀 캘린더에 추가했습니다 (팀원에게만 보입니다)`, "success");
    } catch (e) { notify(`저장 실패: ${(e as Error).message}`, "error"); }
    finally { setBusy(false); }
  };
  const remove = async (ev: TeamCalendarEvent) => {
    if (!(await askConfirm(`"${ev.title}" 일정을 지울까요? 팀 전원에게서 사라집니다.`, { danger: true, okLabel: "지우기" }))) return;
    try { await deleteRows("team_calendar_events", `id=eq.${ev.id}`); setForm(null); await load(); notify("지웠습니다", "success"); }
    catch (e) { notify(`삭제 실패: ${(e as Error).message}`, "error"); }
  };

  const selectedEvents = byDate.get(selected) || [];
  const dow = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#1E252F] px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-black">🔒 {team}팀 전용 캘린더</div>
          <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{team}팀만 봅니다 · 일정리스트·네이버 캘린더와 동기화되지 않습니다 · 회식·교육·휴무·팀 약속용</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))} className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold text-slate-300 hover:bg-white/10">‹</button>
          <span className="whitespace-nowrap text-sm font-black">{Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월</span>
          <button type="button" aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))} className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold text-slate-300 hover:bg-white/10">›</button>
          <button type="button" onClick={() => { setMonth(monthStartOf(today)); setSelected(today); }} className="ml-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-slate-200 hover:bg-white/20">오늘</button>
          <button type="button" onClick={() => openNew(selected)} className="ml-1 rounded-full bg-blue-600 px-3 py-1.5 text-[12px] font-black text-white shadow hover:bg-blue-500">+ 일정 추가</button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {dow.map((d, i) => <div key={d} className={`py-2 text-center text-[11px] font-black ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-600" : "text-slate-500"}`}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, index) => {
            if (!date) return <div key={`e${index}`} className="min-h-[64px] border-b border-r border-slate-100 bg-slate-50/40 sm:min-h-[96px]" />;
            const list = byDate.get(date) || [];
            const isToday = date === today;
            const isSel = date === selected;
            return (
              <button key={date} type="button" onClick={() => setSelected(date)} onDoubleClick={() => openNew(date)}
                className={`min-h-[64px] border-b border-r border-slate-100 p-1 text-left align-top transition sm:min-h-[96px] sm:p-1.5 ${isSel ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                <div className={`mb-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black ${isToday ? "bg-slate-900 text-white" : index % 7 === 0 ? "text-rose-500" : index % 7 === 6 ? "text-blue-600" : "text-slate-700"}`}>{Number(date.slice(8, 10))}</div>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((ev) => (
                    <div key={ev.id} className="truncate rounded bg-blue-100 px-1 py-0.5 text-[10px] font-bold text-blue-800 sm:text-[11px]" title={`${ev.time ? `${ev.time} ` : ""}${ev.title}`}>
                      {ev.time && <span className="mr-0.5 text-blue-500">{ev.time}</span>}{ev.title}
                    </div>
                  ))}
                  {list.length > 3 && <div className="text-[10px] font-bold text-slate-400">+{list.length - 3}</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <div className="text-[13px] font-black text-slate-900">{Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일 ({dow[new Date(`${selected}T12:00:00`).getDay()]}) · {selectedEvents.length}건</div>
          <button type="button" onClick={() => openNew(selected)} className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-50">이 날에 추가</button>
        </div>
        {!selectedEvents.length && <div className="px-4 py-6 text-center text-[12px] font-semibold text-slate-400">이 날 팀 일정이 없습니다 — 칸을 두 번 누르거나 [이 날에 추가]</div>}
        <ul className="divide-y divide-slate-100">
          {selectedEvents.map((ev) => (
            <li key={ev.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="w-12 shrink-0 pt-0.5 text-[12px] font-black tabular-nums text-slate-500">{ev.time || "종일"}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-black text-slate-900">{ev.title}</span>
                {ev.memo && <span className="block whitespace-pre-wrap text-[12px] leading-5 text-slate-600">{ev.memo}</span>}
                <span className="block text-[10px] font-semibold text-slate-400">{ev.author || "이름 없음"} · {ev.created_at.slice(0, 10)}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button type="button" onClick={() => openEdit(ev)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-50">수정</button>
                <button type="button" onClick={() => void remove(ev)} className="rounded-full border border-rose-200 px-2.5 py-1 text-[11px] font-black text-rose-600 hover:bg-rose-50">삭제</button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {form && (
        <div className="fixed inset-0 z-[160] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setForm(null)}>
          <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-lg font-black text-slate-950">{form.id ? "팀 일정 수정" : `${team}팀 일정 추가`}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{team}팀원에게만 보입니다 · 일정리스트·네이버에는 올라가지 않습니다</div>
            <div className="mt-4 grid grid-cols-[1fr_6.5rem] gap-2">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500" />
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm font-bold outline-none focus:border-blue-500" />
            </div>
            <input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="제목 (예: 팀 회식, 교육, 오전 휴무)"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-500" />
            <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} rows={3} placeholder="메모 (장소·준비물 등, 선택)"
              className="mt-2 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold leading-5 outline-none focus:border-blue-500" />
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setForm(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-black text-slate-500">취소</button>
              <button type="button" disabled={busy} onClick={() => void save()} className="flex-[2] rounded-xl bg-blue-600 py-2.5 text-sm font-black text-white shadow disabled:opacity-50">{busy ? "저장 중…" : form.id ? "수정 저장" : "추가"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
