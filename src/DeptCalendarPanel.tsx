/**
 * 캘린더 탭 — 부서 달력(경영·운영·영업) 읽기 전용 보기. 원본은 team_calendar_events(네이버 미러 없음).
 * 서비스접수의 예정일이 이 표에 1건씩 올라온다(deptReceptionApi.upsertDeptCalendar). 처리·수정은 접수 화면에서만.
 * as_tickets·네이버 캘린더와는 섞지 않는다 — 일정 추가·완료·배정 단추가 없다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { selectRows } from "./supabase";
import FormModal from "./FormModal";
import { RECEPTION_TYPE_META } from "./ReceptionTypePicker";
import { DEPT_CAL_LABEL, deptCalQuery, groupDeptEventsByDate, toDeptCalEvent, type DeptCalEvent, type DeptCalTeam } from "./deptCalendarView";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} (${WEEK[new Date(`${ymd}T12:00:00`).getDay()]})`;

export default function DeptCalendarPanel({ team, month, days, today, mode, reloadTick, onMonth }: {
  team: DeptCalTeam;
  month: string;          // yyyy-MM-01 (화면 달)
  days: string[];         // 달력 격자 42칸(앞뒤 달 포함) — 조회 범위도 이것과 같게
  today: string;          // 오늘(KST)
  mode: "calendar" | "list";
  reloadTick: number;     // 바깥 달력 폴링(45초·창 복귀)에 묶는다
  onMonth?: (delta: number) => void; // 있으면 머리에 ‹ 달 › 이동(달 이동이 없는 일정리스트 화면용)
}) {
  const meta = RECEPTION_TYPE_META[team];
  const label = DEPT_CAL_LABEL[team];
  const [events, setEvents] = useState<DeptCalEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(today);
  const [detail, setDetail] = useState<DeptCalEvent | null>(null);
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

  const byDate = useMemo(() => groupDeptEventsByDate(events), [events]);
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
        <span className="min-w-0 flex-1">{label} 부서 달력 · 서비스접수 예정일(읽기 전용, 처리는 접수에서)</span>
        <span className="shrink-0 tabular-nums text-slate-400">{loading ? "불러오는 중" : `이달 ${monthEvents.length}건`}</span>
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
          <div className="md:hidden">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEK.map((d, i) => <div key={d} className={`py-2 text-center text-[11px] font-black ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((date) => {
                const list = byDate.get(date) || [];
                const inMonth = date.slice(0, 7) === monthKey;
                return (
                  <button key={date} type="button" onClick={() => setSelected(date)}
                    className={`min-h-16 border-b border-r border-slate-200 p-1 text-left ${inMonth ? "bg-white" : "bg-slate-50"} ${date === selected ? "ring-2 ring-inset ring-blue-500" : ""}`}>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black ${date === today ? "bg-blue-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{Number(date.slice(8, 10))}</span>
                    <span className="mt-1 flex flex-wrap gap-0.5">
                      {list.slice(0, 4).map((ev) => <span key={ev.id} className={`h-1.5 w-1.5 rounded-full ${ev.done ? "bg-slate-300" : meta.bar}`} />)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-sm font-black text-slate-900">{Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일 · {selectedList.length}건</div>
              <div className="space-y-1.5">
                {selectedList.map(row)}
                {!selectedList.length && <div className="py-4 text-center text-xs font-semibold text-slate-400">등록된 일정이 없습니다.</div>}
              </div>
            </div>
          </div>
          {/* PC: 칸 안에 칩 */}
          <div className="hidden overflow-x-auto md:block">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {WEEK.map((d, i) => <div key={d} className={`px-2 py-2.5 text-center text-[11px] font-black ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}>{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {days.map((date) => {
                  const list = byDate.get(date) || [];
                  const inMonth = date.slice(0, 7) === monthKey;
                  return (
                    <div key={date} className={`min-h-28 border-b border-r border-slate-200 p-1.5 sm:min-h-32 2xl:min-h-40 ${inMonth ? "bg-white" : "bg-slate-50/70"}`}>
                      <div className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-black tabular-nums ${date === today ? "bg-blue-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{Number(date.slice(8, 10))}</div>
                      <div className="max-h-36 space-y-1 overflow-y-auto">
                        {list.map((ev) => (
                          <button key={ev.id} type="button" onClick={() => setDetail(ev)} title={ev.title}
                            className={`block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-bold transition hover:brightness-95 ${chip(ev)}`}>
                            {ev.time && `${ev.time} `}{ev.title || "(제목 없음)"}
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

      {detail && (
        <FormModal title={detail.title || "(제목 없음)"} subtitle={`${label} 부서 달력 · 읽기 전용`} icon={<CalendarDays size={17} />}
          onClose={() => setDetail(null)}
          footer={<button type="button" onClick={() => setDetail(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">닫기</button>}>
          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="font-bold text-slate-400">예정일</dt><dd className="font-black text-slate-900">{dayLabel(detail.date)}{detail.time && ` ${detail.time}`}</dd>
            <dt className="font-bold text-slate-400">작성자</dt><dd className="font-bold text-slate-800">{detail.author || "-"}</dd>
            <dt className="font-bold text-slate-400">메모</dt><dd className="whitespace-pre-wrap font-semibold text-slate-700">{detail.memo || "-"}</dd>
          </dl>
          {!!detail.receptionId && (
            <div className={`rounded-lg px-3 py-2.5 text-xs font-bold ${meta.badge}`}>서비스접수에서 온 일정입니다. 완료·수정은 접수 화면({team})에서 처리하세요.</div>
          )}
        </FormModal>
      )}
    </div>
  );
}
