import { useEffect, useMemo, useState } from "react";
import {
  ACTIVITY_LABELS,
  OPERATIONS_TEAMS,
  getActivityEvents,
  logisticsKindForEvent,
  setActivityEventCancelled,
  setActivityEventsCancelledBySource,
  teamForAuthor,
  type ActivityEvent,
  type ActivityKind,
} from "./operations";
import { setVisitsCancelledBySource } from "./visits";
import { kstDate, weekRange } from "./visits";

type Period = "week" | "month" | "quarter" | "year";
type Props = { author: string };
type FilterKey = "all" | "inspection" | "as" | "logistics_main" | "logistics_etc" | "expansion" | "contact_change" | "complaint" | "misu" | "overage" | "recontract" | "replacement";

const ACTIVITY_KINDS = Object.keys(ACTIVITY_LABELS) as ActivityKind[];
const CATEGORY_TONES: Record<ActivityKind, string> = {
  inspection: "bg-blue-50 text-blue-700",
  as: "bg-rose-50 text-rose-700",
  logistics: "bg-violet-50 text-violet-700",
  expansion_it: "bg-cyan-50 text-cyan-700",
  expansion_copier: "bg-indigo-50 text-indigo-700",
  contact_change: "bg-slate-100 text-slate-700",
  complaint: "bg-pink-50 text-pink-700",
  misu: "bg-amber-50 text-amber-700",
  overage: "bg-orange-50 text-orange-700",
  recontract: "bg-emerald-50 text-emerald-700",
  replacement: "bg-teal-50 text-teal-700",
};
const FILTER_OPTIONS: Array<{ key: Exclude<FilterKey, "all">; label: string; tone: string }> = [
  { key: "inspection", label: "점검", tone: CATEGORY_TONES.inspection },
  { key: "as", label: "AS", tone: CATEGORY_TONES.as },
  { key: "logistics_main", label: "물류", tone: CATEGORY_TONES.logistics },
  { key: "logistics_etc", label: "기타(여분,마감)", tone: "bg-slate-100 text-slate-700" },
  { key: "expansion", label: "확장성(IT,복합기)", tone: CATEGORY_TONES.expansion_it },
  { key: "complaint", label: "불만", tone: CATEGORY_TONES.complaint },
  { key: "misu", label: "미수", tone: CATEGORY_TONES.misu },
  { key: "overage", label: "초과조정", tone: CATEGORY_TONES.overage },
  { key: "recontract", label: "재계약", tone: CATEGORY_TONES.recontract },
  { key: "contact_change", label: "담당자·주소 변경", tone: CATEGORY_TONES.contact_change },
  { key: "replacement", label: "교체양식", tone: CATEGORY_TONES.replacement },
];

function lastDateOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function rangeFor(period: Period, year: number, month: number, quarter: number, anchor: string) {
  if (period === "week") return weekRange(anchor);
  if (period === "month") return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: lastDateOfMonth(year, month) };
  if (period === "quarter") {
    const startMonth = (quarter - 1) * 3 + 1;
    return {
      start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      end: lastDateOfMonth(year, startMonth + 2),
    };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function countByCategory(events: ActivityEvent[]) {
  return Object.fromEntries(
    ACTIVITY_KINDS.map((kind) => [kind, events.filter((event) => event.category === kind).length]),
  ) as Record<ActivityKind, number>;
}

function isLogisticsEtc(event: ActivityEvent) {
  return event.category === "logistics" && ["여분", "마감"].includes(logisticsKindForEvent(event));
}

function matchesFilter(event: ActivityEvent, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "logistics_main") return event.category === "logistics" && !isLogisticsEtc(event);
  if (filter === "logistics_etc") return isLogisticsEtc(event);
  if (filter === "expansion") return event.category === "expansion_it" || event.category === "expansion_copier";
  return event.category === filter;
}

function filterCount(events: ActivityEvent[], filter: Exclude<FilterKey, "all">) {
  return events.filter((event) => matchesFilter(event, filter)).length;
}

function eventDisplayLabel(event: ActivityEvent) {
  if (isLogisticsEtc(event)) return "기타(여분,마감)";
  if (event.category === "logistics") return "물류";
  if (event.category === "expansion_it" || event.category === "expansion_copier") return "확장성(IT,복합기)";
  return ACTIVITY_LABELS[event.category];
}

export default function OperationsDashboard({ author }: Props) {
  const today = kstDate();
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(today);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [quarter, setQuarter] = useState(Math.ceil(currentMonth / 3));
  const [team, setTeam] = useState("전체");
  const [member, setMember] = useState("전체");
  const [category, setCategory] = useState<FilterKey>("all");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loadedRange, setLoadedRange] = useState("");
  const [loadError, setLoadError] = useState<{ range: string; message: string } | null>(null);
  const [updatingId, setUpdatingId] = useState("");
  const [notice, setNotice] = useState("");
  const range = useMemo(() => rangeFor(period, year, month, quarter, anchor), [period, year, month, quarter, anchor]);
  const rangeKey = `${range.start}:${range.end}`;
  const error = loadError?.range === rangeKey ? loadError.message : "";
  const loading = loadedRange !== rangeKey && !error;

  useEffect(() => {
    let active = true;
    getActivityEvents(range.start, range.end)
      .then((rows) => {
        if (!active) return;
        setEvents(rows);
        setLoadError(null);
        setLoadedRange(`${range.start}:${range.end}`);
      })
      .catch((reason) => {
        if (active) setLoadError({ range: `${range.start}:${range.end}`, message: (reason as Error).message });
      });
    return () => { active = false; };
  }, [range.start, range.end]);

  const nonManagerEvents = useMemo(
    () => events.filter((event) => teamForAuthor(event.author) !== "팀장"),
    [events],
  );
  const activeEvents = useMemo(() => nonManagerEvents.filter((event) => event.status !== "cancelled"), [nonManagerEvents]);
  const cancelledEvents = useMemo(() => nonManagerEvents.filter((event) => event.status === "cancelled"), [nonManagerEvents]);
  const cancelledFiltered = useMemo(
    () => cancelledEvents.filter((event) =>
      (team === "전체" || event.team === team)
      && (member === "전체" || event.author === member)
      && matchesFilter(event, category)),
    [cancelledEvents, team, member, category],
  );
  const categoryScoped = useMemo(
    () => activeEvents.filter((event) => matchesFilter(event, category)),
    [activeEvents, category],
  );
  const filtered = useMemo(
    () => categoryScoped.filter((event) =>
      (team === "전체" || event.team === team)
      && (member === "전체" || event.author === member)),
    [categoryScoped, team, member],
  );
  const teamScopedAllCategories = useMemo(
    () => activeEvents.filter((event) =>
      (team === "전체" || event.team === team)
      && (member === "전체" || event.author === member)),
    [activeEvents, team, member],
  );
  const memberOptions = useMemo(() => {
    const names = activeEvents
      .filter((event) => team === "전체" || event.team === team)
      .map((event) => event.author.trim())
      .filter(Boolean);
    if (member !== "전체") names.push(member);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "ko"));
  }, [activeEvents, team, member]);
  const vendors = useMemo(() => new Set(filtered.map((event) => event.vendor.trim()).filter(Boolean)).size, [filtered]);
  const people = useMemo(() => new Set(filtered.map((event) => event.author).filter(Boolean)).size, [filtered]);
  const machineCount = useMemo(() => filtered.reduce((sum, event) => sum + Number(event.machineCount || 0), 0), [filtered]);

  const teamRows = useMemo(() => {
    const max = Math.max(1, ...OPERATIONS_TEAMS.map((name) => categoryScoped.filter((event) => event.team === name).length));
    return OPERATIONS_TEAMS.map((name) => {
      const rows = categoryScoped.filter((event) => event.team === name);
      return {
        name,
        total: rows.length,
        people: new Set(rows.map((event) => event.author)).size,
        width: `${Math.max(0, Math.round((rows.length / max) * 100))}%`,
      };
    });
  }, [categoryScoped]);

  const peopleRows = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    filtered.forEach((event) => map.set(event.author, [...(map.get(event.author) || []), event]));
    return Array.from(map.entries())
      .map(([name, rows]) => ({
        name,
        team: rows[0]?.team || "미지정",
        total: rows.length,
        vendors: new Set(rows.map((event) => event.vendor).filter(Boolean)).size,
        categories: countByCategory(rows),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
  }, [filtered]);

  const changeCancelled = async (event: ActivityEvent, cancelled: boolean) => {
    const sourceText = event.sourceText || "";
    const grouped = Boolean(sourceText.trim());
    const prompt = grouped
      ? (cancelled
        ? "이 전송을 오전송으로 처리할까요?\n업무현황, 주간현황판, 일일방문일지에서 함께 제외됩니다. 카톡 메시지와 원본 DB는 삭제되지 않습니다."
        : "이 전송의 오전송 처리를 복원할까요?\n업무현황, 주간현황판, 일일방문일지에 다시 반영됩니다.")
      : (cancelled ? "이 기록을 업무현황 집계에서 제외할까요?" : "이 기록을 다시 집계에 반영할까요?");
    if (!window.confirm(prompt)) return;
    setUpdatingId(event.id);
    setNotice("");
    try {
      if (grouped) {
        await Promise.all([
          setActivityEventsCancelledBySource(sourceText, event.author, event.activityDate, cancelled, author),
          setVisitsCancelledBySource(sourceText, event.author, event.activityDate, cancelled, author),
        ]);
        setEvents((current) => current.map((row) => (
          row.sourceText === sourceText && row.author === event.author && row.activityDate === event.activityDate
            ? { ...row, status: cancelled ? "cancelled" : "active", cancelledBy: cancelled ? author : "" }
            : row
        )));
        setNotice(cancelled ? "오전송 처리했습니다. 모든 업무 집계에서 제외됩니다." : "오전송 처리를 복원했습니다.");
      } else {
        await setActivityEventCancelled(event.id, cancelled, author);
        setEvents((current) => current.map((row) => row.id === event.id
          ? { ...row, status: cancelled ? "cancelled" : "active", cancelledBy: cancelled ? author : "" }
          : row));
        setNotice(cancelled ? "업무현황 집계에서 제외했습니다." : "집계 기록으로 복원했습니다.");
      }
    } catch (reason) {
      setNotice(`처리하지 못했습니다: ${(reason as Error).message}`);
    } finally {
      setUpdatingId("");
    }
  };

  return (
    <div className="space-y-3 pb-16">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">업무현황</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">팀 운영량과 기록 누락을 확인합니다. 팀장 기록은 집계하지 않습니다.</p>
          </div>
          <div className="grid grid-cols-4 rounded-md bg-slate-100 p-1">
            {([["week", "주간"], ["month", "월간"], ["quarter", "분기"], ["year", "연간"]] as Array<[Period, string]>).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setPeriod(value)} className={`rounded px-3 py-2 text-xs font-black ${period === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {period === "week" && <input type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-bold" />}
          {period !== "week" && <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-bold">{Array.from({ length: 6 }, (_, index) => currentYear - 4 + index).map((value) => <option key={value} value={value}>{value}년</option>)}</select>}
          {period === "month" && <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-bold">{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}월</option>)}</select>}
          {period === "quarter" && <select value={quarter} onChange={(event) => setQuarter(Number(event.target.value))} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-bold">{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}분기</option>)}</select>}
          <span className="mr-auto rounded-md bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">{range.start} ~ {range.end}</span>

          <div className="flex rounded-md bg-slate-100 p-1">
            {["전체", ...OPERATIONS_TEAMS].map((value) => (
              <button key={value} type="button" onClick={() => { setTeam(value); setMember("전체"); }} className={`rounded px-3 py-1.5 text-xs font-black ${team === value ? "bg-slate-900 text-white" : "text-slate-500"}`}>{value === "전체" ? "전체" : `${value}팀`}</button>
            ))}
          </div>
          <select value={member} onChange={(event) => setMember(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-700">
            <option value="전체">전체 팀원</option>
            {memberOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value as FilterKey)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-700">
            <option value="all">전체 업무</option>
            {FILTER_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </div>
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">운영현황을 불러오지 못했습니다.<br /><span className="text-xs">Supabase SQL Editor에서 최신 operations.sql을 실행해 주세요.</span></div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm font-semibold text-slate-400">운영현황을 불러오는 중…</div>}
      {notice && <div className="rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white">{notice}</div>}

      {!loading && !error && (
        <>
          <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[["업무", `${filtered.length}건`], ["거래처", `${vendors}곳`], ["기기·물품", `${machineCount}대`], ["활동 인원", `${people}명`]].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs font-bold text-slate-400">{label}</div>
                <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="font-black text-slate-950">업무 구성</h3>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 xl:grid-cols-6">
              {FILTER_OPTIONS.map((option) => (
                <button key={option.key} type="button" onClick={() => setCategory(category === option.key ? "all" : option.key)} className={`flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 ${category === option.key ? "bg-blue-50" : ""}`}>
                  <span className={`rounded px-2 py-1 text-[11px] font-black ${option.tone}`}>{option.label}</span>
                  <b className="text-lg text-slate-950">{filterCount(teamScopedAllCategories, option.key)}</b>
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3"><h3 className="font-black text-slate-950">팀별 현황</h3></div>
              <div className="divide-y divide-slate-100">
                {teamRows.map((row) => (
                  <button key={row.name} type="button" onClick={() => { setTeam(team === row.name ? "전체" : row.name); setMember("전체"); }} className="block w-full px-4 py-3 text-left hover:bg-slate-50">
                    <div className="flex items-center justify-between text-sm"><b>{row.name}팀</b><span><b>{row.total}</b>건 · {row.people}명</span></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: row.width }} /></div>
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3"><h3 className="font-black text-slate-950">인원별 현황</h3></div>
              {peopleRows.length === 0 ? (
                <div className="p-10 text-center text-sm font-semibold text-slate-400">기록이 없습니다.</div>
              ) : (
                <>
                  <div className="divide-y divide-slate-100 md:hidden">
                    {peopleRows.map((row) => {
                      const personEvents = filtered.filter((event) => event.author === row.name);
                      return (
                        <button key={row.name} type="button" onClick={() => setMember(row.name)} className={`block w-full px-4 py-3 text-left ${member === row.name ? "bg-blue-50" : ""}`}>
                          <div className="flex items-center justify-between"><b className="text-sm">{row.name} <span className="text-xs text-slate-400">{row.team}팀</span></b><b>{row.total}건</b></div>
                          <div className="mt-1 text-xs font-semibold text-slate-400">거래처 {row.vendors}곳</div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {FILTER_OPTIONS.filter((option) => filterCount(personEvents, option.key) > 0).map((option) => (
                              <span key={option.key} className={`rounded px-2 py-1 text-[10px] font-black ${option.tone}`}>{option.label} {filterCount(personEvents, option.key)}</span>
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[1320px] text-sm">
                      <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><th className="px-4 py-3 text-left">작성자</th><th>팀</th><th>전체</th><th>거래처</th><th>점검</th><th>AS</th><th>물류</th><th>기타(여분,마감)</th><th>확장성(IT,복합기)</th><th>불만</th><th>미수</th><th>초과조정</th><th>재계약</th><th>담당자 변경</th><th>교체양식</th></tr></thead>
                      <tbody>{peopleRows.map((row) => {
                        const personEvents = filtered.filter((event) => event.author === row.name);
                        return <tr key={row.name} onClick={() => setMember(row.name)} className={`cursor-pointer border-b border-slate-100 text-center last:border-0 hover:bg-slate-50 ${member === row.name ? "bg-blue-50" : ""}`}><td className="px-4 py-3 text-left font-black">{row.name}</td><td>{row.team}</td><td className="font-black">{row.total}</td><td>{row.vendors}</td><td>{row.categories.inspection}</td><td>{row.categories.as}</td><td>{filterCount(personEvents, "logistics_main")}</td><td>{filterCount(personEvents, "logistics_etc")}</td><td>{filterCount(personEvents, "expansion")}</td><td>{row.categories.complaint}</td><td>{row.categories.misu}</td><td>{row.categories.overage}</td><td>{row.categories.recontract}</td><td>{row.categories.contact_change}</td><td>{row.categories.replacement}</td></tr>;
                      })}</tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </section>

          <details className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
              <div><h3 className="font-black text-slate-950">업무 기록 확인</h3><p className="mt-0.5 text-xs font-semibold text-slate-400">오전송은 원문을 남긴 채 집계에서 제외할 수 있습니다.</p></div>
              <span className="text-xs font-black text-slate-500">{filtered.length}건</span>
            </summary>
            <div className="divide-y divide-slate-100 border-t border-slate-200">
              {filtered.slice(0, 50).map((event) => (
                <details key={event.id} className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className={`rounded px-2 py-1 text-[10px] font-black ${CATEGORY_TONES[event.category]}`}>{eventDisplayLabel(event)}</span>
                    <span className="min-w-0"><b className="block truncate text-sm">{event.vendor || "거래처 미기재"}</b><span className="text-[11px] font-semibold text-slate-400">{event.activityDate} · {event.team}팀 · {event.author}</span></span>
                    <span className="text-xs font-bold text-slate-400">{event.machineCount ? `${event.machineCount}대` : "보기"}</span>
                  </summary>
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-600">{event.sourceText || "저장된 원문이 없습니다."}</pre>
                    <div className="mt-3 flex justify-end"><button type="button" disabled={updatingId === event.id} onClick={() => void changeCancelled(event, true)} className="rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-600 disabled:opacity-50">{event.sourceText ? "오전송 처리" : "집계 제외"}</button></div>
                  </div>
                </details>
              ))}
              {!filtered.length && <div className="p-10 text-center text-sm font-semibold text-slate-400">기록이 없습니다.</div>}
            </div>
          </details>

          {cancelledFiltered.length > 0 && (
            <details className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-black text-slate-600"><span>집계 제외 기록</span><span>{cancelledFiltered.length}건</span></summary>
              <div className="divide-y divide-slate-100 border-t border-slate-200">
                {cancelledFiltered.slice(0, 50).map((event) => (
                  <div key={event.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`rounded px-2 py-1 text-[10px] font-black ${CATEGORY_TONES[event.category]}`}>{eventDisplayLabel(event)}</span>
                    <div className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-500 line-through">{event.vendor || "거래처 미기재"}</b><span className="text-[11px] text-slate-400">{event.activityDate} · {event.author}</span></div>
                    <button type="button" disabled={updatingId === event.id} onClick={() => void changeCancelled(event, false)} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50">복원</button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
