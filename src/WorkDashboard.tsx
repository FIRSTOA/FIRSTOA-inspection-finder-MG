import { useEffect, useMemo, useState } from "react";
import {
  EMPTY_WEEKLY_NOTE, OFFICE_LABELS, WORK_LABELS, emptyOfficeValues, getOfficeLogs, getVisits,
  getWeeklyNote, kstDate, saveOfficeLog, saveWeeklyNote, weekRange,
  type OfficeKind, type OfficeLog, type VisitRow, type WeeklyNote, type WorkKind,
} from "./visits";

const KINDS = Object.keys(WORK_LABELS) as WorkKind[];
const OFFICE_KINDS = Object.keys(OFFICE_LABELS) as OfficeKind[];
const icons: Record<WorkKind, string> = { inspection: "✅", as: "🔧", delivery: "📦", etc: "📌", pc: "💻", misu: "💰", bulman: "💢", recontract: "📝", overage: "📈" };
const tones: Record<WorkKind, string> = { inspection: "bg-blue-50 text-blue-700", as: "bg-rose-50 text-rose-700", delivery: "bg-violet-50 text-violet-700", etc: "bg-slate-100 text-slate-600", pc: "bg-cyan-50 text-cyan-700", misu: "bg-amber-50 text-amber-700", bulman: "bg-pink-50 text-pink-700", recontract: "bg-emerald-50 text-emerald-700", overage: "bg-yellow-50 text-yellow-700" };

function summarize(rows: VisitRow[]) {
  const count = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<WorkKind, number>;
  const minutes = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<WorkKind, number>;
  const visitMachines = new Map<string, number>();
  const sales = { nsIt: 0, nsCopier: 0, ssvIt: 0, ssvCopier: 0, nsEnd: 0, ssvEnd: 0 };
  for (const r of rows) {
    if (r.visited) { const key = `${r.workDate}|${r.vendor}`; visitMachines.set(key, Math.max(visitMachines.get(key) || 0, r.machineCount)); }
    for (const k of KINDS) { if (r.workKinds.includes(k)) count[k]++; minutes[k] += Number(r.minutes[k] || 0); }
    const high = /^(SS|V)/i.test(r.grade.trim());
    if (r.salesIt) { if (high) sales.ssvIt++; else sales.nsIt++; }
    if (r.salesCopier) { if (high) sales.ssvCopier++; else sales.nsCopier++; }
    if (r.contractEnded) { if (high) sales.ssvEnd++; else sales.nsEnd++; }
  }
  return { count, minutes, sales, visits: visitMachines.size, machines: [...visitMachines.values()].reduce((a, b) => a + b, 0), fieldMinutes: Object.values(minutes).reduce((a, b) => a + b, 0) };
}

const officeMinutes = (logs: OfficeLog[]) => logs.reduce((total, log) => total + OFFICE_KINDS.reduce((n, k) => n + Number(log.values[k]?.minutes || 0), 0), 0);
const hm = (m: number) => m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
type Period = "day" | "week" | "month" | "quarter" | "year";
type WeeklyTextKey = "thisWeekGoal" | "thisWeekResult" | "nextWeekGoal" | "review" | "growth" | "challenge" | "special" | "learning" | "request" | "praise";
const weeklyCards: Array<{ key: WeeklyTextKey; label: string; icon: string; tone: string }> = [
  { key: "growth", label: "성장노트", icon: "💡", tone: "bg-amber-50" }, { key: "challenge", label: "새로운 도전·아이디어", icon: "🎯", tone: "bg-blue-50" },
  { key: "special", label: "특이사항", icon: "🧡", tone: "bg-orange-50" }, { key: "learning", label: "배운 점", icon: "📚", tone: "bg-emerald-50" },
  { key: "request", label: "지원·요청·건의사항", icon: "🤝", tone: "bg-violet-50" }, { key: "praise", label: "칭찬", icon: "👏", tone: "bg-pink-50" },
];
const pad = (n: number) => String(n).padStart(2, "0");
function periodRange(period: Period, year: number, month: number, quarter: number, today: string) {
  if (period === "day") return { start: today, end: today };
  if (period === "week") return weekRange(today);
  const firstMonth = period === "quarter" ? (quarter - 1) * 3 + 1 : period === "year" ? 1 : month;
  const lastMonth = period === "quarter" ? firstMonth + 2 : period === "year" ? 12 : month;
  const lastDay = new Date(year, lastMonth, 0).getDate();
  return { start: `${year}-${pad(firstMonth)}-01`, end: `${year}-${pad(lastMonth)}-${pad(lastDay)}` };
}

function weeksInMonth(year: number, month: number) {
  const lastDay = new Date(year, month, 0).getDate();
  const seen = new Set<string>();
  const out: Array<{ start: string; end: string; label: string }> = [];
  for (let day = 1; day <= lastDay; day++) {
    const wr = weekRange(`${year}-${pad(month)}-${pad(day)}`);
    if (seen.has(wr.start)) continue;
    seen.add(wr.start);
    out.push({ ...wr, label: `${out.length + 1}주` });
  }
  return out;
}

export default function WorkDashboard({ kind, author }: { kind: "daily" | "weekly"; author: string }) {
  const today = kstDate();
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const [period, setPeriod] = useState<Period>("day");
  const [selectedDay, setSelectedDay] = useState(today);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [quarter, setQuarter] = useState(Math.ceil(currentMonth / 3));
  useEffect(() => {
    if (kind === "weekly" && period !== "day" && period !== "month") setPeriod("day");
  }, [kind, period]);
  const editWeek = useMemo(() => weekRange(selectedDay), [selectedDay]);
  const range = useMemo(() => {
    if (kind === "weekly") return period === "day" ? { start: today, end: today } : editWeek;
    return periodRange(period, year, month, quarter, selectedDay);
  }, [kind, period, year, month, quarter, selectedDay, editWeek, today]);
  const monthWeeks = useMemo(() => weeksInMonth(year, month), [year, month]);
  const selectedWeekLabel = monthWeeks.find((w) => w.start === editWeek.start)?.label || `${Math.ceil(Number(editWeek.start.slice(8, 10)) / 7)}주차`;
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [officeLogs, setOfficeLogs] = useState<OfficeLog[]>([]);
  const [office, setOffice] = useState<OfficeLog>({ workDate: today, author, returnTime: "", values: emptyOfficeValues() });
  const [note, setNote] = useState<WeeklyNote>({ ...EMPTY_WEEKLY_NOTE });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"" | "office" | "weekly">("");
  const [saved, setSaved] = useState("");
  const [editField, setEditField] = useState<WeeklyTextKey | "">("");

  useEffect(() => {
    let alive = true; setLoading(true); setError("");
    Promise.all([
      getVisits(author, range.start, range.end),
      getOfficeLogs(author, range.start, range.end),
      kind === "weekly" ? getWeeklyNote(author, editWeek.start) : Promise.resolve({ ...EMPTY_WEEKLY_NOTE }),
    ])
      .then(([visits, offices, weekly]) => { if (!alive) return; setRows(visits); setOfficeLogs(offices); setNote(weekly); setOffice(offices.find((o) => o.workDate === selectedDay) || { workDate: selectedDay, author, returnTime: "", values: emptyOfficeValues() }); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [author, kind, range.start, range.end, editWeek.start, selectedDay]);

  const sum = useMemo(() => summarize(rows), [rows]);
  const insideMinutes = officeMinutes(officeLogs);
  const commute = [...rows].reverse().find((r) => r.commute)?.commute;
  const grouped = useMemo(() => rows.reduce<Record<string, VisitRow[]>>((a, r) => ((a[r.workDate] ||= []).push(r), a), {}), [rows]);
  const setNoteField = <K extends keyof WeeklyNote>(k: K, v: WeeklyNote[K]) => setNote({ ...note, [k]: v });
  const setOfficeValue = (k: OfficeKind, field: "count" | "minutes", value: number) => setOffice({ ...office, values: { ...office.values, [k]: { ...office.values[k], [field]: Math.max(0, value || 0) } } });
  const saveOffice = async () => { setSaving("office"); setSaved(""); try { const next = { ...office, author, workDate: selectedDay }; await saveOfficeLog(next); setOfficeLogs([next]); setSaved("내근업무 저장 완료"); } catch (e) { setError((e as Error).message); } finally { setSaving(""); } };
  const saveWeekly = async () => { setSaving("weekly"); setSaved(""); try { await saveWeeklyNote(author, editWeek.start, note); setSaved("주간 기록 저장 완료"); } catch (e) { setError((e as Error).message); } finally { setSaving(""); } };
  const periodTitle = period === "day" ? "일일 업무 현황" : period === "week" ? `${selectedWeekLabel} 주간 업무 현황` : period === "month" ? `${year}년 ${month}월 업무 현황` : period === "quarter" ? `${year}년 ${quarter}분기 업무 현황` : `${year}년 연간 업무 현황`;
  const periodTabs = kind === "weekly" ? ([["day", "일간"], ["month", "월간"]] as [Period, string][]) : ([["day", "일간"], ["week", "주간"], ["month", "월간"], ["quarter", "분기"], ["year", "연간"]] as [Period, string][]);

  if (!author) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">FIELD에서 작성자를 먼저 선택해 주세요.</div>;
  return <div className="space-y-4 pb-16">
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className={`grid gap-1 rounded-md bg-slate-100 p-1 ${kind === "weekly" ? "grid-cols-2" : "grid-cols-5"}`}>{periodTabs.map(([p, label]) => <button key={p} onClick={() => { setPeriod(p); if (kind === "weekly" && p === "day") setSelectedDay(today); }} className={`rounded px-5 py-2 text-sm font-bold transition ${period === p ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        {kind === "daily" && period === "day" && <input type="date" value={selectedDay} onChange={(e) => { setSelectedDay(e.target.value); setYear(Number(e.target.value.slice(0, 4))); setMonth(Number(e.target.value.slice(5, 7))); setQuarter(Math.ceil(Number(e.target.value.slice(5, 7)) / 3)); }} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold" />}
        {period === "day" && kind === "weekly" && <div className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">금일</div>}
        {(period === "week" || period === "month" || period === "quarter" || period === "year") && <select value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); if (period === "week" || (kind === "weekly" && period === "month")) setSelectedDay(weeksInMonth(y, month)[0]?.start || selectedDay); }} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">{Array.from({ length: 6 }, (_, i) => currentYear - 4 + i).map((y) => <option key={y} value={y}>{y}년</option>)}</select>}
        {(period === "week" || period === "month") && <>
          <select value={month} onChange={(e) => { const m = Number(e.target.value); setMonth(m); if (period === "week" || kind === "weekly") setSelectedDay(weeksInMonth(year, m)[0]?.start || selectedDay); }} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}</select>
          {(period === "week" || kind === "weekly") && <select value={editWeek.start} onChange={(e) => setSelectedDay(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">{monthWeeks.map((w) => <option key={w.start} value={w.start}>{w.label} {shortDate(w.start)}~{shortDate(w.end)}</option>)}</select>}
        </>}
        {kind === "daily" && period === "quarter" && <div className="flex gap-1">{[1,2,3,4].map((q) => <button key={q} onClick={() => setQuarter(q)} className={`rounded px-4 py-2 text-sm font-bold ${quarter === q ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{q}분기</button>)}</div>}
        <div className="rounded-md bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">{range.start} ~ {range.end}</div>
      </div>
    </section>
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="text-xs font-bold uppercase tracking-wide text-blue-600">{author} · {kind === "daily" ? `${range.start} ~ ${range.end}` : `${range.start} ~ ${range.end}`}</div><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 lg:text-3xl">{kind === "daily" ? periodTitle : "주간 현황판"}</h2><p className="mt-2 text-sm font-medium text-slate-500">FIELD 기록을 기준으로 자동 집계됩니다.</p></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[620px]">
          {[['방문 거래처', `${sum.visits}곳`], ['기계 대수', `${sum.machines}대`], ['외근 시간', hm(sum.fieldMinutes)], ['내근 시간', hm(insideMinutes)]].map(([l, v]) => <div key={l} className="rounded-md border border-slate-200 bg-slate-50 p-3"><div className="text-[11px] font-bold text-slate-500">{l}</div><div className="mt-1 text-xl font-black text-slate-950">{v}</div></div>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 px-6 py-3 text-xs font-semibold text-slate-500 lg:px-8"><span>총 활동시간 <b className="ml-1 text-slate-950">{hm(sum.fieldMinutes + insideMinutes)}</b></span>{kind === "daily" && period === "day" && <><span>마감 <b className="ml-1 text-slate-950">{commute || "미선택"}</b></span><span>복귀시간 <b className="ml-1 text-slate-950">{office.returnTime || "미입력"}</b></span></>}</div>
    </section>

    {loading && <div className="rounded-2xl bg-white p-12 text-center text-sm text-slate-400">현황을 불러오는 중…</div>}
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}<br /><span className="text-xs">업데이트된 supabase/visits.sql을 다시 실행했는지 확인해 주세요.</span></div>}
    {saved && <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">✓ {saved}</div>}

    {!loading && <>
      <section><div className="mb-3 flex items-end justify-between"><div><h3 className="text-lg font-bold text-slate-900">외근</h3><p className="text-xs text-slate-400">방문·현장 업무 건수와 소요시간</p></div></div><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {KINDS.map((k) => {
          const target = Number(note.goals[k] || 0);
          const actual = sum.count[k];
          const percent = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
          const gap = actual - target;
          return <div key={k} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className={`inline-flex rounded-md px-2 py-1 text-xs font-bold ${tones[k]}`}>{icons[k]} {WORK_LABELS[k]}</div><div className="mt-4 flex items-end justify-between"><div className="text-2xl font-black text-slate-950">{actual}<span className="ml-1 text-xs font-semibold text-slate-400">건</span></div><div className="text-xs font-bold text-slate-500">{hm(sum.minutes[k])}</div></div>{kind === "weekly" && <div className="mt-3 space-y-2 border-t border-slate-100 pt-3"><div className="flex items-center gap-2"><span className="text-[11px] font-bold text-slate-500">목표</span><input type="number" min="0" value={note.goals[k] || ""} onChange={(e) => setNoteField("goals", { ...note.goals, [k]: Number(e.target.value) || 0 })} className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right text-xs font-bold outline-none" /></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${target > 0 && actual >= target ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${target > 0 ? percent : 0}%` }} /></div><div className="flex items-center justify-between text-[11px] font-bold"><span className={target ? "text-slate-500" : "text-slate-300"}>{target ? `달성률 ${percent}%` : "목표 미입력"}</span>{target > 0 && <span className={gap >= 0 ? "text-emerald-600" : "text-rose-600"}>{gap >= 0 ? `+${gap}건` : `${gap}건`}</span>}</div></div>}</div>;
        })}
      </div></section>

      {kind === "daily" && period === "day" ? <div className="space-y-6"><div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(420px,1fr)]">
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-bold text-slate-900">외근 영업 활동</h3><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">{[
            ["N~S IT 영업", sum.sales.nsIt], ["N~S 복합기 영업", sum.sales.nsCopier], ["SS~V IT 영업", sum.sales.ssvIt], ["SS~V 복합기 영업", sum.sales.ssvCopier], ["N~S 계약종료", sum.sales.nsEnd], ["SS~V 계약종료", sum.sales.ssvEnd],
          ].map(([l, v]) => <div key={String(l)} className="rounded-md border border-slate-200 bg-slate-50 p-3"><div className="text-xs text-slate-500">{l}</div><div className="mt-1 text-xl font-bold text-slate-900">{v}<span className="ml-1 text-xs text-slate-400">건</span></div></div>)}</div></section>
          <HierarchicalVisitList period={period} rows={rows} year={year} month={month} quarter={quarter} start={range.start} end={range.end} />
        </div>
        <section className="h-fit rounded-lg border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-6"><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold text-slate-900">내근 업무 입력</h3><p className="text-xs text-slate-400">수량·건수와 시간을 입력하세요.</p></div><label className="text-xs text-slate-500">복귀시간<input type="time" value={office.returnTime} onChange={(e) => setOffice({ ...office, returnTime: e.target.value })} className="ml-2 rounded-md border border-slate-300 px-2 py-1.5" /></label></div>
          <div className="mt-4 divide-y divide-slate-100">{OFFICE_KINDS.map((k) => <div key={k} className="grid grid-cols-[1fr_90px_100px] items-center gap-2 py-2.5"><div className="text-sm font-semibold text-slate-700">{OFFICE_LABELS[k]}</div><label className="text-[10px] text-slate-400">수량/건<input type="number" min="0" value={office.values[k].count || ""} onChange={(e) => setOfficeValue(k, "count", Number(e.target.value))} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label><label className="text-[10px] text-slate-400">시간(분)<input type="number" min="0" value={office.values[k].minutes || ""} onChange={(e) => setOfficeValue(k, "minutes", Number(e.target.value))} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label></div>)}</div>
          <div className="mt-4 flex items-center justify-between rounded-md bg-slate-50 p-3"><span className="text-sm font-semibold text-slate-600">내근 총시간</span><b className="text-lg text-slate-900">{hm(OFFICE_KINDS.reduce((n, k) => n + office.values[k].minutes, 0))}</b></div><button onClick={saveOffice} disabled={saving === "office"} className="mt-3 w-full rounded-md bg-blue-600 py-3 text-sm font-bold text-white disabled:opacity-50">{saving === "office" ? "저장 중…" : "내근 업무 저장"}</button>
        </section>
      </div></div> : kind === "daily" ? <div className="space-y-6"><PeriodBreakdown period={period} rows={rows} officeLogs={officeLogs} start={range.start} end={range.end} year={year} month={month} quarter={quarter} /><HierarchicalVisitList period={period} rows={rows} year={year} month={month} quarter={quarter} start={range.start} end={range.end} /></div> : <div className="flex flex-col gap-6">
        <section className="order-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4"><div><h3 className="text-lg font-bold text-slate-900">주간 목표·회고 문서</h3><p className="mt-0.5 text-xs text-slate-400">한 화면에서 읽고, 편집기에서 집중해서 작성합니다.</p></div><button onClick={()=>setEditField("thisWeekGoal")} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white">전체 편집</button></div>
          <div className="grid divide-y divide-slate-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">{([['thisWeekGoal','이번 주 목표','🎯'],['thisWeekResult','이번 주 결과·미진행 사유','✅'],['nextWeekGoal','다음 주 목표','➡️']] as [WeeklyTextKey,string,string][]).map(([key,label,icon])=><button key={key} onClick={()=>setEditField(key)} className="min-h-52 p-5 text-left transition hover:bg-blue-50/40"><div className="flex items-center justify-between"><span className="text-sm font-bold text-slate-800">{icon} {label}</span><span className="text-xs font-bold text-blue-600">편집</span></div><div className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{note[key] || <span className="text-slate-300">작성된 내용이 없습니다.</span>}</div></button>)}</div>
          <div className="border-t border-slate-200"><div className="grid grid-cols-[170px_1fr_70px] border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-500"><span>회고 항목</span><span>작성 내용</span><span className="text-center">관리</span></div>{weeklyCards.map((item)=><button type="button" key={item.key} onClick={()=>setEditField(item.key)} className="grid min-h-20 w-full grid-cols-[170px_1fr_70px] items-center border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50"><div className="text-sm font-bold text-slate-700">{item.icon} {item.label}</div><div className="line-clamp-2 whitespace-pre-wrap pr-4 text-sm leading-6 text-slate-600">{note[item.key] || <span className="text-slate-300">미작성</span>}</div><span className="rounded-lg border border-slate-200 px-2 py-2 text-center text-xs font-bold text-slate-600">편집</span></button>)}</div>
          <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-3"><button onClick={saveWeekly} disabled={saving === "weekly"} className="rounded-md bg-blue-600 px-8 py-3 text-sm font-bold text-white disabled:opacity-50">{saving === "weekly" ? "저장 중…" : "주간 기록 저장"}</button></div>
        </section>
        <div className="order-2"><VisitList grouped={grouped} /></div>
      </div>}
    </>}
    {editField && <WeeklyEditModal field={editField} setField={setEditField} note={note} onChange={setNoteField} onSave={saveWeekly} saving={saving === "weekly"} onClose={()=>setEditField("")} />}
  </div>;
}

function WeeklyEditModal({ field, setField, note, onChange, onSave, saving, onClose }: { field: WeeklyTextKey; setField: (field: WeeklyTextKey) => void; note: WeeklyNote; onChange: <K extends keyof WeeklyNote>(k: K, v: WeeklyNote[K]) => void; onSave: () => Promise<void>; saving: boolean; onClose: () => void }) {
  const meta: Record<WeeklyTextKey, [string,string]> = { thisWeekGoal:["이번 주 목표",""], thisWeekResult:["이번 주 결과",""], nextWeekGoal:["다음 주 목표",""], review:["",""], growth:["성장노트",""], challenge:["새로운 도전·아이디어",""], special:["특이사항",""], learning:["배운 점",""], request:["지원·요청·건의사항",""], praise:["칭찬",""] };
  const nav = (["thisWeekGoal","thisWeekResult","nextWeekGoal","growth","challenge","special","learning","request","praise"] as WeeklyTextKey[]);
  const templates: Partial<Record<WeeklyTextKey, string>> = {
    growth: "상황:\n문제점:\n개선해야 할 점:\n실행:\n",
    learning: "날짜:\n소요시간:\n브랜드:\n기종:\n교육자:\n배운 점:\n",
  };
  const applyTemplate = () => {
    const template = templates[field];
    if (!template) return;
    const current = String(note[field]).trim();
    onChange(field, current ? `${current}\n\n${template}` : template);
  };
  const structureGrowth = () => {
    const current = String(note.growth).trim();
    const alreadyStructured = ["상황:", "문제점:", "개선해야 할 점:", "실행:"].some((label) => current.includes(label));
    onChange("growth", alreadyStructured ? current : `상황: ${current}\n문제점:\n개선해야 할 점:\n실행:\n`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-5 backdrop-blur-sm"><div className="grid h-[86vh] w-full max-w-6xl grid-cols-[240px_1fr] overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl"><aside className="flex flex-col bg-slate-950 p-3 text-white"><div className="px-3 py-3"><div className="text-lg font-extrabold">주간 기록 편집기</div></div><nav className="mt-2 flex-1 space-y-1 overflow-y-auto">{nav.map((key)=><button key={key} onClick={()=>setField(key)} className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm ${field===key?"bg-white font-bold text-slate-900":"text-slate-300 hover:bg-white/10"}`}><span>{meta[key][0]}</span><span className={`h-2 w-2 rounded-full ${String(note[key]).trim()?"bg-emerald-400":"bg-slate-600"}`}/></button>)}</nav><button onClick={onClose} className="rounded-md border border-white/15 py-2.5 text-sm font-bold text-slate-300">편집기 닫기</button></aside><main className="flex min-w-0 flex-col"><header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-7 py-5"><div className="text-xl font-black text-slate-950">{meta[field][0]}</div><div className="flex gap-2">{templates[field] && <button type="button" onClick={applyTemplate} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600">틀 넣기</button>}{field==="growth" && <button type="button" onClick={structureGrowth} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-black text-white">정리틀 적용</button>}</div></header><textarea autoFocus value={String(note[field])} onChange={(e)=>onChange(field,e.target.value)} className="min-h-0 flex-1 resize-none p-8 text-base leading-8 text-slate-700 outline-none"/><footer className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-7 py-4"><span className="text-xs text-slate-400">{String(note[field]).length.toLocaleString()}자</span><div className="flex gap-2"><button onClick={onClose} className="rounded-md border border-slate-100 bg-white px-5 py-3 text-sm font-bold text-slate-600">닫기</button><button disabled={saving} onClick={async()=>{await onSave();onClose();}} className="rounded-md bg-blue-600 px-7 py-3 text-sm font-bold text-white disabled:opacity-50">{saving?"저장 중…":"저장하고 닫기"}</button></div></footer></main></div></div>;
}

function PeriodBreakdown({ period, rows, officeLogs, start, end, year, month, quarter }: { period: Period; rows: VisitRow[]; officeLogs: OfficeLog[]; start: string; end: string; year: number; month: number; quarter: number }) {
  const inRange = (d: string, s: string, e: string) => d >= s && d <= e;
  const daysBetween = () => {
    const days: Array<{ label: string; start: string; end: string; sub?: string }> = [];
    const cursor = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    while (cursor <= last) {
      const d = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
      days.push({ label: shortDate(d), start: d, end: d });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  };
  const buckets = period === "week" ? daysBetween()
    : period === "month" ? weeksInMonth(year, month).map((w) => ({ label: w.label, start: w.start < start ? start : w.start, end: w.end > end ? end : w.end, sub: `${shortDate(w.start)}~${shortDate(w.end)}` }))
    : period === "quarter" ? Array.from({ length: 3 }, (_, i) => {
      const m = (quarter - 1) * 3 + i + 1;
      const lastDay = new Date(year, m, 0).getDate();
      return { label: `${m}월`, start: `${year}-${pad(m)}-01`, end: `${year}-${pad(m)}-${pad(lastDay)}`, sub: `${quarter}분기` };
    })
    : [1, 2, 3, 4].map((q) => {
      const firstMonth = (q - 1) * 3 + 1;
      const lastMonth = firstMonth + 2;
      const lastDay = new Date(year, lastMonth, 0).getDate();
      return { label: `${q}분기`, start: `${year}-${pad(firstMonth)}-01`, end: `${year}-${pad(lastMonth)}-${pad(lastDay)}`, sub: `${firstMonth}~${lastMonth}월` };
    });
  const title = period === "week" ? "일별 실적 비교" : period === "month" ? "주별 실적 비교" : period === "quarter" ? "월별 실적 비교" : "분기별 실적 비교";
  const desc = period === "week" ? "선택한 주의 일별 흐름을 확인하세요." : period === "month" ? "선택한 월의 주차별 흐름을 확인하세요." : period === "quarter" ? "선택한 분기의 월별 흐름을 확인하세요." : "선택한 연도의 분기별 흐름을 확인하세요.";
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h3 className="text-lg font-bold text-slate-900">{title}</h3><p className="text-xs text-slate-400">{desc}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-slate-200 text-xs text-slate-400"><th className="px-3 py-3">구분</th><th className="px-3 py-3 text-right">방문</th><th className="px-3 py-3 text-right">기기</th><th className="px-3 py-3 text-right">점검</th><th className="px-3 py-3 text-right">AS</th><th className="px-3 py-3 text-right">납품</th><th className="px-3 py-3 text-right">PC·IT</th><th className="px-3 py-3 text-right">미수</th><th className="px-3 py-3 text-right">불만</th><th className="px-3 py-3 text-right">외근시간</th><th className="px-3 py-3 text-right">내근시간</th></tr></thead><tbody>{buckets.map((b) => { const s = summarize(rows.filter((r) => inRange(r.workDate, b.start, b.end))); const offices = officeLogs.filter((o) => inRange(o.workDate, b.start, b.end)); return <tr key={`${b.start}-${b.end}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50"><td className="px-3 py-4 font-bold text-slate-800">{b.label} {b.sub && <span className="ml-1 text-[10px] font-normal text-slate-400">{b.sub}</span>}</td><td className="px-3 py-4 text-right font-semibold">{s.visits}</td><td className="px-3 py-4 text-right">{s.machines}</td><td className="px-3 py-4 text-right">{s.count.inspection}</td><td className="px-3 py-4 text-right">{s.count.as}</td><td className="px-3 py-4 text-right">{s.count.delivery}</td><td className="px-3 py-4 text-right">{s.count.pc}</td><td className="px-3 py-4 text-right">{s.count.misu}</td><td className="px-3 py-4 text-right">{s.count.bulman}</td><td className="px-3 py-4 text-right font-semibold text-blue-700">{hm(s.fieldMinutes)}</td><td className="px-3 py-4 text-right font-semibold text-emerald-700">{hm(officeMinutes(offices))}</td></tr>; })}</tbody></table></div></section>;
}

function HierarchicalVisitList({ period, rows, year, month, quarter, start, end }: { period: Period; rows: VisitRow[]; year: number; month: number; quarter: number; start: string; end: string }) {
  const [open, setOpen] = useState(false);
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  const inRange = (d: string, s: string, e: string) => d >= s && d <= e;
  const rowsBetween = (s: string, e: string) => rows.filter((r) => inRange(r.workDate, s, e));
  const grouped = rows.reduce<Record<string, VisitRow[]>>((acc, row) => ((acc[row.workDate] ||= []).push(row), acc), {});
  const monthBucket = (m: number) => {
    const lastDay = new Date(year, m, 0).getDate();
    return { label: `${m}월`, start: `${year}-${pad(m)}-01`, end: `${year}-${pad(m)}-${pad(lastDay)}` };
  };
  const dayBuckets = (s: string, e: string) => {
    const out: Array<{ start: string }> = [];
    const cursor = new Date(`${s}T00:00:00`);
    const last = new Date(`${e}T00:00:00`);
    while (cursor <= last) {
      out.push({ start: `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}` });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  };
  const summaryChips = (list: VisitRow[]) => {
    const s = summarize(list);
    const items = [
      ["방문", s.visits],
      ["기기", s.machines],
      ["점검", s.count.inspection],
      ["AS", s.count.as],
      ["납품", s.count.delivery],
      ["PC·IT", s.count.pc],
      ["미수", s.count.misu],
      ["불만", s.count.bulman],
      ["외근시간", hm(s.fieldMinutes)],
    ];
    return <div className="flex flex-wrap gap-1.5">{items.map(([label, value]) => <span key={label} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600"><b className="mr-1 text-slate-400">{label}</b>{value}</span>)}</div>;
  };
  const visitRows = (list: VisitRow[]) => <div className="divide-y divide-slate-100">{list.map((r) => <div key={r.id} className="grid gap-2 px-5 py-3 md:grid-cols-[90px_1fr_auto] md:items-center"><div className="text-xs font-semibold text-slate-400">{r.arrivalTime || "시간 미입력"}</div><div><div className="font-semibold text-slate-800">{r.vendor} {r.grade && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{r.grade}</span>}</div><div className="mt-1 flex flex-wrap gap-1">{!r.visited && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">미방문</span>}{r.workKinds.map((k) => <span key={k} className={`rounded px-2 py-0.5 text-[10px] font-semibold ${tones[k]}`}>{icons[k]} {WORK_LABELS[k]}</span>)}</div></div><div className="text-right text-xs text-slate-500">{r.machineCount > 0 && <div>{r.machineCount}대</div>}<div className="font-semibold">{hm(r.workKinds.reduce((n, k) => n + Number(r.minutes[k] || 0), 0))}</div></div></div>)}</div>;
  const leafDay = (date: string, depth = 0) => {
    const list = grouped[date] || [];
    const key = `day:${date}`;
    const isOpen = !!openKeys[key];
    return <div key={key} className={`border-b border-slate-100 last:border-0 ${depth ? "border-l-4 border-l-blue-200 bg-white" : "border-l-4 border-l-slate-300"}`}><button type="button" onClick={() => toggle(key)} className={`grid w-full gap-3 px-5 py-3 text-left md:grid-cols-[210px_1fr_60px] md:items-center ${depth ? "bg-white" : "bg-slate-50"}`}><span className="text-xs font-black text-slate-700">{shortDate(date)} · {list.length}건</span>{summaryChips(list)}<span className="text-right text-xs font-bold text-blue-600">{isOpen ? "접기" : "펼치기"}</span></button>{isOpen && (list.length ? visitRows(list) : <div className="px-5 py-4 text-sm text-slate-400">방문 기록이 없습니다.</div>)}</div>;
  };
  const weekNode = (w: { label: string; start: string; end: string }, prefix = "") => {
    const s = w.start < start ? start : w.start;
    const e = w.end > end ? end : w.end;
    if (e < start || s > end) return null;
    const list = rowsBetween(s, e);
    const key = `${prefix}week:${s}`;
    const isOpen = !!openKeys[key];
    return <div key={key} className="border-b border-l-4 border-l-emerald-300 border-b-slate-100 bg-emerald-50/30 last:border-b-0"><button type="button" onClick={() => toggle(key)} className="grid w-full gap-3 px-5 py-3 text-left md:grid-cols-[250px_1fr_60px] md:items-center"><span className="text-sm font-black text-slate-800">{w.label} {shortDate(s)}~{shortDate(e)} · {list.length}건</span>{summaryChips(list)}<span className="text-right text-xs font-bold text-blue-600">{isOpen ? "접기" : "펼치기"}</span></button>{isOpen && <div className="bg-white/70">{dayBuckets(s, e).map((d) => leafDay(d.start, 1))}</div>}</div>;
  };
  const monthNode = (m: number) => {
    const mb = monthBucket(m);
    const list = rowsBetween(mb.start, mb.end);
    const key = `month:${m}`;
    const isOpen = !!openKeys[key];
    return <div key={key} className="border-b border-l-4 border-l-blue-500 border-b-slate-100 bg-blue-50/50 last:border-b-0"><button type="button" onClick={() => toggle(key)} className="grid w-full gap-3 px-5 py-3 text-left md:grid-cols-[180px_1fr_60px] md:items-center"><span className="text-base font-black text-slate-900">{mb.label} · {list.length}건</span>{summaryChips(list)}<span className="text-right text-xs font-bold text-blue-700">{isOpen ? "접기" : "펼치기"}</span></button>{isOpen && <div className="bg-white/60">{weeksInMonth(year, m).map((w) => weekNode(w, `month:${m}:`))}</div>}</div>;
  };
  const title = period === "day" ? "금일 방문 상세" : period === "week" ? "주간 방문 상세" : period === "month" ? "월간 방문 상세" : period === "quarter" ? "분기 방문 상세" : "연간 방문 상세";
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between border-b border-slate-100 px-5 py-4 text-left"><div><h3 className="text-lg font-bold text-slate-900">{title}</h3><p className="mt-0.5 text-xs font-semibold text-slate-400">조회 범위에 맞춰 접었다 펼쳐서 확인합니다.</p></div><span className="text-xs font-bold text-slate-500">{open ? "접기" : "펼치기"}</span></button>{open && <>{!rows.length && <div className="p-10 text-center text-sm text-slate-400">저장된 방문 기록이 없습니다.</div>}{period === "day" && leafDay(start)}{period === "week" && dayBuckets(start, end).map((d) => leafDay(d.start))}{period === "month" && weeksInMonth(year, month).map((w) => weekNode(w))}{period === "quarter" && [0, 1, 2].map((i) => monthNode((quarter - 1) * 3 + i + 1))}{period === "year" && [1, 2, 3, 4].map((q) => { const first = (q - 1) * 3 + 1; const lastMonth = first + 2; const key = `quarter:${q}`; const isOpen = !!openKeys[key]; const qEnd = `${year}-${pad(lastMonth)}-${pad(new Date(year, lastMonth, 0).getDate())}`; const list = rowsBetween(`${year}-${pad(first)}-01`, qEnd); return <div key={key} className="border-b border-l-4 border-l-indigo-500 border-b-slate-100 bg-indigo-50/50 last:border-b-0"><button type="button" onClick={() => toggle(key)} className="grid w-full gap-3 px-5 py-3 text-left md:grid-cols-[180px_1fr_60px] md:items-center"><span className="text-base font-black text-slate-900">{q}분기 · {list.length}건</span>{summaryChips(list)}<span className="text-right text-xs font-bold text-blue-700">{isOpen ? "접기" : "펼치기"}</span></button>{isOpen && <div className="bg-white/60">{[0, 1, 2].map((i) => monthNode(first + i))}</div>}</div>; })}</>}</section>;
}

function VisitList({ grouped }: { grouped: Record<string, VisitRow[]> }) {
  const [open, setOpen] = useState(false);
  const [closedDates, setClosedDates] = useState<Record<string, boolean>>({});
  const entries = Object.entries(grouped);
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between border-b border-slate-100 px-5 py-4 text-left"><h3 className="text-lg font-bold text-slate-900">날짜별 방문 상세</h3><span className="text-xs font-bold text-slate-500">{open ? "접기" : "펼치기"}</span></button>{open && <>{!entries.length && <div className="p-10 text-center text-sm text-slate-400">저장된 방문 기록이 없습니다.</div>}{entries.map(([date, list]) => {
    const closed = closedDates[date];
    return <div key={date} className="border-b border-slate-100 last:border-0"><button type="button" onClick={() => setClosedDates({ ...closedDates, [date]: !closed })} className="flex w-full items-center justify-between bg-slate-50 px-5 py-2 text-left text-xs font-bold text-slate-500"><span>{shortDate(date)} · {list.length}건</span><span>{closed ? "펼치기" : "접기"}</span></button>{!closed && <div className="divide-y divide-slate-100">{list.map((r) => <div key={r.id} className="grid gap-2 px-5 py-3 md:grid-cols-[90px_1fr_auto] md:items-center"><div className="text-xs font-semibold text-slate-400">{r.arrivalTime || "시간 미입력"}</div><div><div className="font-semibold text-slate-800">{r.vendor} {r.grade && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{r.grade}</span>}</div><div className="mt-1 flex flex-wrap gap-1">{!r.visited && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">비방문</span>}{r.workKinds.map((k) => <span key={k} className={`rounded px-2 py-0.5 text-[10px] font-semibold ${tones[k]}`}>{icons[k]} {WORK_LABELS[k]}</span>)}</div></div><div className="text-right text-xs text-slate-500">{r.machineCount > 0 && <div>{r.machineCount}대</div>}<div className="font-semibold">{hm(r.workKinds.reduce((n, k) => n + Number(r.minutes[k] || 0), 0))}</div></div></div>)}</div>}</div>;
  })}</>}</section>;
}
