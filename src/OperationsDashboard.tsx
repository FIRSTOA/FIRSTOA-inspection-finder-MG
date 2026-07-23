import { useEffect, useMemo, useState } from "react";
import {
  ACTIVITY_LABELS,
  OPERATIONS_TEAMS,
  getActivityEvents,
  type ActivityEvent,
  type ActivityKind,
} from "./operations";
import { kstDate, weekRange } from "./visits";

type Period = "week" | "month" | "quarter" | "year";

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

function lastDateOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function rangeFor(period: Period, year: number, month: number, quarter: number, anchor: string) {
  if (period === "week") return weekRange(anchor);
  if (period === "month") {
    return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: lastDateOfMonth(year, month) };
  }
  if (period === "quarter") {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      end: lastDateOfMonth(year, endMonth),
    };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function countByCategory(events: ActivityEvent[]) {
  return Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, events.filter((event) => event.category === kind).length])) as Record<ActivityKind, number>;
}

export default function OperationsDashboard() {
  const today = kstDate();
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(today);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [quarter, setQuarter] = useState(Math.ceil(currentMonth / 3));
  const [team, setTeam] = useState("전체");
  const [category, setCategory] = useState<"all" | ActivityKind>("all");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loadedRange, setLoadedRange] = useState("");
  const [loadError, setLoadError] = useState<{ range: string; message: string } | null>(null);
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
        if (!active) return;
        setLoadError({ range: `${range.start}:${range.end}`, message: (reason as Error).message });
      });
    return () => { active = false; };
  }, [range.start, range.end]);

  const filtered = useMemo(() => events.filter((event) =>
    (team === "전체" || event.team === team)
    && (category === "all" || event.category === category)), [events, team, category]);
  const categories = useMemo(() => countByCategory(filtered), [filtered]);
  const vendors = useMemo(() => new Set(filtered.map((event) => event.vendor.trim()).filter(Boolean)).size, [filtered]);
  const people = useMemo(() => new Set(filtered.map((event) => event.author).filter(Boolean)).size, [filtered]);
  const machineCount = useMemo(() => filtered.reduce((sum, event) => sum + Number(event.machineCount || 0), 0), [filtered]);

  const teamRows = useMemo(() => {
    return OPERATIONS_TEAMS.map((name) => {
      const rows = filtered.filter((event) => event.team === name);
      return {
        name,
        total: rows.length,
        people: new Set(rows.map((event) => event.author)).size,
        vendors: new Set(rows.map((event) => event.vendor).filter(Boolean)).size,
        categories: countByCategory(rows),
      };
    }).filter((row) => row.total > 0 || ["A", "B", "C", "D"].includes(row.name));
  }, [filtered]);

  const peopleRows = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    filtered.forEach((event) => map.set(event.author, [...(map.get(event.author) || []), event]));
    return Array.from(map.entries())
      .map(([author, rows]) => ({
        author,
        team: rows[0]?.team || "미지정",
        total: rows.length,
        vendors: new Set(rows.map((event) => event.vendor).filter(Boolean)).size,
        machines: rows.reduce((sum, event) => sum + Number(event.machineCount || 0), 0),
        categories: countByCategory(rows),
      }))
      .sort((a, b) => b.total - a.total || a.author.localeCompare(b.author, "ko"));
  }, [filtered]);
  const recentRows = useMemo(() => filtered.slice(0, 50), [filtered]);

  return (
    <div className="space-y-4 pb-16">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">CS 운영현황</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">성과 평가가 아니라 업무량·누락·팀 운영 상태를 확인하는 통합 현황입니다.</p>
          </div>
          <div className="grid grid-cols-4 rounded-md bg-slate-100 p-1">
            {([["week", "주간"], ["month", "월간"], ["quarter", "분기"], ["year", "연간"]] as Array<[Period, string]>).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setPeriod(value)} className={`rounded px-3 py-2 text-xs font-black ${period === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {period === "week" && <input type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold" />}
          {period !== "week" && <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold">{Array.from({ length: 6 }, (_, index) => currentYear - 4 + index).map((value) => <option key={value} value={value}>{value}년</option>)}</select>}
          {period === "month" && <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold">{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}월</option>)}</select>}
          {period === "quarter" && <div className="flex gap-1">{[1, 2, 3, 4].map((value) => <button key={value} type="button" onClick={() => setQuarter(value)} className={`rounded-md px-3 py-2 text-xs font-black ${quarter === value ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{value}분기</button>)}</div>}
          <span className="rounded-md bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">{range.start} ~ {range.end}</span>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {["전체", "A", "B", "C", "D", "팀장", "미지정"].map((value) => (
            <button key={value} type="button" onClick={() => setTeam(value)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-black ${team === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{value === "전체" ? "전체 팀" : value.length === 1 ? `${value}팀` : value}</button>
          ))}
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
          <button type="button" onClick={() => setCategory("all")} className={`shrink-0 rounded-md px-3 py-2 text-xs font-black ${category === "all" ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600"}`}>전체 업무</button>
          {ACTIVITY_KINDS.map((kind) => <button key={kind} type="button" onClick={() => setCategory(kind)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-black ${category === kind ? "bg-blue-600 text-white" : CATEGORY_TONES[kind]}`}>{ACTIVITY_LABELS[kind]}</button>)}
        </div>
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">운영현황을 불러오지 못했습니다.<br /><span className="text-xs">Supabase SQL Editor에서 supabase/operations.sql을 한 번 실행해 주세요.</span></div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm font-semibold text-slate-400">운영현황을 불러오는 중…</div>}

      {!loading && !error && <>
        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[["업무 기록", `${filtered.length}건`], ["거래처", `${vendors}곳`], ["기기·물품", `${machineCount}대`], ["활동 인원", `${people}명`]].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold text-slate-500">{label}</div><div className="mt-2 text-2xl font-black text-slate-950">{value}</div></div>
          ))}
        </section>

        <section>
          <div className="mb-2"><h3 className="text-base font-black text-slate-950">업무별 현황</h3><p className="text-xs font-semibold text-slate-400">업무 성격이 다르므로 건수를 서로 점수처럼 합산하지 않습니다.</p></div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {ACTIVITY_KINDS.map((kind) => <button key={kind} type="button" onClick={() => setCategory(category === kind ? "all" : kind)} className="rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm"><span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-black ${CATEGORY_TONES[kind]}`}>{ACTIVITY_LABELS[kind]}</span><div className="mt-3 text-2xl font-black text-slate-950">{categories[kind]}<span className="ml-1 text-xs text-slate-400">건</span></div></button>)}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3"><h3 className="font-black text-slate-950">팀별 현황</h3><p className="text-xs font-semibold text-slate-400">팀 업무량과 참여 인원을 함께 봅니다.</p></div>
            <div className="divide-y divide-slate-100">{teamRows.map((row) => <button key={row.name} type="button" onClick={() => setTeam(row.name)} className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 text-left hover:bg-slate-50"><div><b className="text-sm text-slate-900">{row.name.length === 1 ? `${row.name}팀` : row.name}</b><div className="mt-1 text-[11px] font-semibold text-slate-400">거래처 {row.vendors}곳</div></div><div className="text-right"><div className="text-lg font-black text-slate-950">{row.total}건</div></div><div className="w-12 text-right text-xs font-bold text-slate-500">{row.people}명</div></button>)}</div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3"><h3 className="font-black text-slate-950">개인별 현황</h3><p className="text-xs font-semibold text-slate-400">순위가 아니라 담당 분포와 기록 누락을 확인합니다.</p></div>
            <div className="divide-y divide-slate-100 md:hidden">{peopleRows.map((row) => <div key={row.author} className="px-4 py-3"><div className="flex items-center justify-between"><div><b className="text-sm text-slate-900">{row.author}</b><span className="ml-2 text-[11px] font-black text-slate-400">{row.team}팀</span></div><b className="text-base text-slate-950">{row.total}건</b></div><div className="mt-2 flex flex-wrap gap-1">{ACTIVITY_KINDS.filter((kind) => row.categories[kind] > 0).map((kind) => <span key={kind} className={`rounded px-1.5 py-0.5 text-[10px] font-black ${CATEGORY_TONES[kind]}`}>{ACTIVITY_LABELS[kind]} {row.categories[kind]}</span>)}</div></div>)}</div>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><th className="px-4 py-3">작성자</th><th className="px-3 py-3">팀</th><th className="px-3 py-3 text-right">전체</th><th className="px-3 py-3 text-right">거래처</th><th className="px-3 py-3 text-right">점검</th><th className="px-3 py-3 text-right">AS</th><th className="px-3 py-3 text-right">물류</th><th className="px-3 py-3 text-right">확장성</th><th className="px-3 py-3 text-right">미수·불만</th><th className="px-3 py-3 text-right">계약·변경</th></tr></thead><tbody>{peopleRows.map((row) => <tr key={row.author} className="border-b border-slate-100 last:border-0"><td className="px-4 py-3 font-black text-slate-900">{row.author}</td><td className="px-3 py-3 text-slate-500">{row.team}</td><td className="px-3 py-3 text-right font-black">{row.total}</td><td className="px-3 py-3 text-right">{row.vendors}</td><td className="px-3 py-3 text-right">{row.categories.inspection}</td><td className="px-3 py-3 text-right">{row.categories.as}</td><td className="px-3 py-3 text-right">{row.categories.logistics}</td><td className="px-3 py-3 text-right">{row.categories.expansion_it + row.categories.expansion_copier}</td><td className="px-3 py-3 text-right">{row.categories.misu + row.categories.complaint}</td><td className="px-3 py-3 text-right">{row.categories.recontract + row.categories.overage + row.categories.contact_change + row.categories.replacement}</td></tr>)}</tbody></table></div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div><h3 className="font-black text-slate-950">업무 기록 확인</h3><p className="text-xs font-semibold text-slate-400">현재 조건의 최근 50건입니다. 원문은 필요한 기록만 펼쳐 봅니다.</p></div>
            <span className="shrink-0 text-xs font-black text-slate-500">{filtered.length}건</span>
          </div>
          {recentRows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm font-semibold text-slate-400">선택한 기간에 기록이 없습니다.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentRows.map((event) => (
                <details key={event.id} className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className={`rounded-md px-2 py-1 text-[10px] font-black ${CATEGORY_TONES[event.category]}`}>{ACTIVITY_LABELS[event.category]}</span>
                    <span className="min-w-0">
                      <b className="block truncate text-sm text-slate-900">{event.vendor || "거래처 미기재"}</b>
                      <span className="mt-0.5 block text-[11px] font-semibold text-slate-400">{event.activityDate} · {event.team}팀 · {event.author}</span>
                    </span>
                    <span className="text-xs font-black text-slate-400 group-open:text-blue-600">{event.machineCount ? `${event.machineCount}대` : "보기"}</span>
                  </summary>
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-600">{event.sourceText || "저장된 원문이 없습니다."}</pre>
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </>}
    </div>
  );
}
