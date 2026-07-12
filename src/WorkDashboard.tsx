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
type Period = "day" | "month" | "quarter" | "year";
const pad = (n: number) => String(n).padStart(2, "0");
function periodRange(period: Period, year: number, month: number, quarter: number, today: string) {
  if (period === "day") return { start: today, end: today };
  const firstMonth = period === "quarter" ? (quarter - 1) * 3 + 1 : period === "year" ? 1 : month;
  const lastMonth = period === "quarter" ? firstMonth + 2 : period === "year" ? 12 : month;
  const lastDay = new Date(year, lastMonth, 0).getDate();
  return { start: `${year}-${pad(firstMonth)}-01`, end: `${year}-${pad(lastMonth)}-${pad(lastDay)}` };
}

export default function WorkDashboard({ kind, author }: { kind: "daily" | "weekly"; author: string }) {
  const today = kstDate();
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const [period, setPeriod] = useState<Period>("day");
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [quarter, setQuarter] = useState(Math.ceil(currentMonth / 3));
  const range = useMemo(() => kind === "daily" ? periodRange(period, year, month, quarter, today) : weekRange(today), [kind, period, year, month, quarter, today]);
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [officeLogs, setOfficeLogs] = useState<OfficeLog[]>([]);
  const [office, setOffice] = useState<OfficeLog>({ workDate: today, author, returnTime: "", values: emptyOfficeValues() });
  const [note, setNote] = useState<WeeklyNote>({ ...EMPTY_WEEKLY_NOTE });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"" | "office" | "weekly">("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let alive = true; setLoading(true); setError("");
    Promise.all([getVisits(author, range.start, range.end), getOfficeLogs(author, range.start, range.end), kind === "weekly" ? getWeeklyNote(author, range.start) : Promise.resolve({ ...EMPTY_WEEKLY_NOTE })])
      .then(([visits, offices, weekly]) => { if (!alive) return; setRows(visits); setOfficeLogs(offices); setNote(weekly); setOffice(offices[0] || { workDate: today, author, returnTime: "", values: emptyOfficeValues() }); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [author, kind, range.start, range.end, today]);

  const sum = useMemo(() => summarize(rows), [rows]);
  const insideMinutes = officeMinutes(officeLogs);
  const commute = [...rows].reverse().find((r) => r.commute)?.commute;
  const grouped = useMemo(() => rows.reduce<Record<string, VisitRow[]>>((a, r) => ((a[r.workDate] ||= []).push(r), a), {}), [rows]);
  const setNoteField = <K extends keyof WeeklyNote>(k: K, v: WeeklyNote[K]) => setNote({ ...note, [k]: v });
  const setOfficeValue = (k: OfficeKind, field: "count" | "minutes", value: number) => setOffice({ ...office, values: { ...office.values, [k]: { ...office.values[k], [field]: Math.max(0, value || 0) } } });
  const saveOffice = async () => { setSaving("office"); setSaved(""); try { const next = { ...office, author }; await saveOfficeLog(next); setOfficeLogs([next]); setSaved("내근업무 저장 완료"); } catch (e) { setError((e as Error).message); } finally { setSaving(""); } };
  const saveWeekly = async () => { setSaving("weekly"); setSaved(""); try { await saveWeeklyNote(author, range.start, note); setSaved("주간 기록 저장 완료"); } catch (e) { setError((e as Error).message); } finally { setSaving(""); } };
  const periodTitle = period === "day" ? "일일 업무 현황" : period === "month" ? `${year}년 ${month}월 업무 현황` : period === "quarter" ? `${year}년 ${quarter}분기 업무 현황` : `${year}년 연간 업무 현황`;

  if (!author) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">FIELD에서 작성자를 먼저 선택해 주세요.</div>;
  return <div className="space-y-6 pb-16">
    {kind === "daily" && <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">{([['day','일간'],['month','월간'],['quarter','분기'],['year','연간']] as [Period,string][]).map(([p, label]) => <button key={p} onClick={() => setPeriod(p)} className={`rounded-lg px-5 py-2 text-sm font-bold transition ${period === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>{label}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        {period !== "day" && <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">{Array.from({ length: 6 }, (_, i) => currentYear - 4 + i).map((y) => <option key={y} value={y}>{y}년</option>)}</select>}
        {period === "month" && <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}</select>}
        {period === "quarter" && <div className="flex gap-1">{[1,2,3,4].map((q) => <button key={q} onClick={() => setQuarter(q)} className={`rounded-xl px-4 py-2 text-sm font-bold ${quarter === q ? "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>{q}분기</button>)}</div>}
        <div className="rounded-xl bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700">{range.start} ~ {range.end}</div>
      </div>
    </section>}
    <section className="overflow-hidden rounded-3xl bg-[#172033] text-white shadow-xl shadow-slate-200">
      <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
        <div><div className="text-sm font-semibold text-blue-300">{author} · {kind === "daily" ? `${range.start} ~ ${range.end}` : `${range.start} ~ ${range.end}`}</div><h2 className="mt-2 text-3xl font-extrabold tracking-tight lg:text-4xl">{kind === "daily" ? periodTitle : "주간 현황판"}</h2><p className="mt-2 text-sm text-slate-400">FIELD 기록을 기준으로 자동 집계됩니다.</p></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[620px]">
          {[['방문 거래처', `${sum.visits}곳`], ['기계 대수', `${sum.machines}대`], ['외근 시간', hm(sum.fieldMinutes)], ['내근 시간', hm(insideMinutes)]].map(([l, v]) => <div key={l} className="rounded-2xl bg-white/10 p-3 backdrop-blur"><div className="text-[11px] text-slate-400">{l}</div><div className="mt-1 text-lg font-bold">{v}</div></div>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 px-6 py-3 text-xs text-slate-300 lg:px-8"><span>총 활동시간 <b className="ml-1 text-white">{hm(sum.fieldMinutes + insideMinutes)}</b></span>{kind === "daily" && period === "day" && <><span>마감 <b className="ml-1 text-white">{commute || "미선택"}</b></span><span>복귀시간 <b className="ml-1 text-white">{office.returnTime || "미입력"}</b></span></>}</div>
    </section>

    {loading && <div className="rounded-2xl bg-white p-12 text-center text-sm text-slate-400">현황을 불러오는 중…</div>}
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}<br /><span className="text-xs">업데이트된 supabase/visits.sql을 다시 실행했는지 확인해 주세요.</span></div>}
    {saved && <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">✓ {saved}</div>}

    {!loading && <>
      <section><div className="mb-3 flex items-end justify-between"><div><h3 className="text-lg font-bold text-slate-900">외근 기본 활동</h3><p className="text-xs text-slate-400">건수와 소요시간</p></div></div><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {KINDS.map((k) => <div key={k} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ${tones[k]}`}>{icons[k]} {WORK_LABELS[k]}</div><div className="mt-4 flex items-end justify-between"><div className="text-2xl font-extrabold text-slate-900">{sum.count[k]}<span className="ml-1 text-xs font-medium text-slate-400">건</span></div><div className="text-xs font-semibold text-slate-500">{hm(sum.minutes[k])}</div></div>{kind === "weekly" && <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3"><span className="text-[11px] text-slate-400">목표</span><input type="number" min="0" value={note.goals[k] || ""} onChange={(e) => setNoteField("goals", { ...note.goals, [k]: Number(e.target.value) || 0 })} className="w-full rounded-lg bg-slate-50 px-2 py-1.5 text-right text-xs outline-none" /></div>}</div>)}
      </div></section>

      {kind === "daily" && period === "day" ? <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(420px,1fr)]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-bold text-slate-900">외근 영업 활동</h3><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">{[
            ["N~S IT 영업", sum.sales.nsIt], ["N~S 복합기 영업", sum.sales.nsCopier], ["SS~V IT 영업", sum.sales.ssvIt], ["SS~V 복합기 영업", sum.sales.ssvCopier], ["N~S 계약종료", sum.sales.nsEnd], ["SS~V 계약종료", sum.sales.ssvEnd],
          ].map(([l, v]) => <div key={String(l)} className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">{l}</div><div className="mt-1 text-xl font-bold text-slate-900">{v}<span className="ml-1 text-xs text-slate-400">건</span></div></div>)}</div></section>
          <VisitList grouped={grouped} />
        </div>
        <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-6"><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold text-slate-900">내근 업무 입력</h3><p className="text-xs text-slate-400">수량·건수와 시간을 입력하세요.</p></div><label className="text-xs text-slate-500">복귀시간<input type="time" value={office.returnTime} onChange={(e) => setOffice({ ...office, returnTime: e.target.value })} className="ml-2 rounded-lg border border-slate-200 px-2 py-1.5" /></label></div>
          <div className="mt-4 divide-y divide-slate-100">{OFFICE_KINDS.map((k) => <div key={k} className="grid grid-cols-[1fr_90px_100px] items-center gap-2 py-2.5"><div className="text-sm font-semibold text-slate-700">{OFFICE_LABELS[k]}</div><label className="text-[10px] text-slate-400">수량/건<input type="number" min="0" value={office.values[k].count || ""} onChange={(e) => setOfficeValue(k, "count", Number(e.target.value))} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label><label className="text-[10px] text-slate-400">시간(분)<input type="number" min="0" value={office.values[k].minutes || ""} onChange={(e) => setOfficeValue(k, "minutes", Number(e.target.value))} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label></div>)}</div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="text-sm font-semibold text-slate-600">내근 총시간</span><b className="text-lg text-slate-900">{hm(OFFICE_KINDS.reduce((n, k) => n + office.values[k].minutes, 0))}</b></div><button onClick={saveOffice} disabled={saving === "office"} className="mt-3 w-full rounded-xl bg-[#172033] py-3 text-sm font-bold text-white disabled:opacity-50">{saving === "office" ? "저장 중…" : "내근 업무 저장"}</button>
        </section>
      </div> : kind === "daily" ? <div className="space-y-6"><MonthBreakdown rows={rows} officeLogs={officeLogs} start={range.start} end={range.end} /><VisitList grouped={grouped} /></div> : <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(520px,1fr)]">
        <VisitList grouped={grouped} />
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h3 className="text-lg font-bold text-slate-900">주간 회고·성장 기록</h3><p className="text-xs text-slate-400">수치로 알 수 없는 내용만 직접 작성합니다.</p></div><div className="grid gap-4 md:grid-cols-2">{([['review','이번 주 목표·결과 및 미진행 사유'],['growth','💡 성장노트'],['challenge','🎯 새로운 도전·아이디어'],['special','🧡 특이사항'],['learning','🧡 배운 점'],['request','🤝 지원·요청·건의사항'],['praise','🤝 칭찬']] as const).map(([k, label]) => <label key={k} className={k === "review" ? "md:col-span-2" : ""}><span className="text-xs font-bold text-slate-600">{label}</span><textarea value={note[k]} onChange={(e) => setNoteField(k, e.target.value)} rows={k === "review" ? 4 : 3} className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-slate-400 focus:bg-white" /></label>)}</div><button onClick={saveWeekly} disabled={saving === "weekly"} className="mt-4 w-full rounded-xl bg-[#172033] py-3 text-sm font-bold text-white disabled:opacity-50">{saving === "weekly" ? "저장 중…" : "주간 기록 저장"}</button></section>
      </div>}
    </>}
  </div>;
}

function MonthBreakdown({ rows, officeLogs, start, end }: { rows: VisitRow[]; officeLogs: OfficeLog[]; start: string; end: string }) {
  const startMonth = Number(start.slice(5, 7));
  const endMonth = Number(end.slice(5, 7));
  const year = Number(start.slice(0, 4));
  const months = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => startMonth + i);
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h3 className="text-lg font-bold text-slate-900">월별 실적 비교</h3><p className="text-xs text-slate-400">월을 따라 전체 흐름을 확인하세요.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-slate-200 text-xs text-slate-400"><th className="px-3 py-3">월</th><th className="px-3 py-3 text-right">방문</th><th className="px-3 py-3 text-right">기기</th><th className="px-3 py-3 text-right">점검</th><th className="px-3 py-3 text-right">AS</th><th className="px-3 py-3 text-right">납품</th><th className="px-3 py-3 text-right">PC·IT</th><th className="px-3 py-3 text-right">미수</th><th className="px-3 py-3 text-right">불만</th><th className="px-3 py-3 text-right">외근시간</th><th className="px-3 py-3 text-right">내근시간</th></tr></thead><tbody>{months.map((m) => { const prefix = `${year}-${pad(m)}`; const s = summarize(rows.filter((r) => r.workDate.startsWith(prefix))); const offices = officeLogs.filter((o) => o.workDate.startsWith(prefix)); return <tr key={m} className="border-b border-slate-100 last:border-0 hover:bg-slate-50"><td className="px-3 py-4 font-bold text-slate-800">{m}월 <span className="ml-1 text-[10px] font-normal text-slate-400">{Math.ceil(m / 3)}분기</span></td><td className="px-3 py-4 text-right font-semibold">{s.visits}</td><td className="px-3 py-4 text-right">{s.machines}</td><td className="px-3 py-4 text-right">{s.count.inspection}</td><td className="px-3 py-4 text-right">{s.count.as}</td><td className="px-3 py-4 text-right">{s.count.delivery}</td><td className="px-3 py-4 text-right">{s.count.pc}</td><td className="px-3 py-4 text-right">{s.count.misu}</td><td className="px-3 py-4 text-right">{s.count.bulman}</td><td className="px-3 py-4 text-right font-semibold text-blue-700">{hm(s.fieldMinutes)}</td><td className="px-3 py-4 text-right font-semibold text-emerald-700">{hm(officeMinutes(offices))}</td></tr>; })}</tbody></table></div></section>;
}

function VisitList({ grouped }: { grouped: Record<string, VisitRow[]> }) {
  const entries = Object.entries(grouped);
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h3 className="text-lg font-bold text-slate-900">날짜별 방문 상세</h3></div>{!entries.length && <div className="p-10 text-center text-sm text-slate-400">저장된 방문 기록이 없습니다.</div>}{entries.map(([date, list]) => <div key={date} className="border-b border-slate-100 last:border-0"><div className="bg-slate-50 px-5 py-2 text-xs font-bold text-slate-500">{shortDate(date)}</div><div className="divide-y divide-slate-100">{list.map((r) => <div key={r.id} className="grid gap-2 px-5 py-3 md:grid-cols-[90px_1fr_auto] md:items-center"><div className="text-xs font-semibold text-slate-400">{r.arrivalTime || "시간 미입력"}</div><div><div className="font-semibold text-slate-800">{r.vendor} {r.grade && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{r.grade}</span>}</div><div className="mt-1 flex flex-wrap gap-1">{!r.visited && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">비방문</span>}{r.workKinds.map((k) => <span key={k} className={`rounded px-2 py-0.5 text-[10px] font-semibold ${tones[k]}`}>{icons[k]} {WORK_LABELS[k]}</span>)}</div></div><div className="text-right text-xs text-slate-500">{r.machineCount > 0 && <div>{r.machineCount}대</div>}<div className="font-semibold">{hm(r.workKinds.reduce((n, k) => n + Number(r.minutes[k] || 0), 0))}</div></div></div>)}</div></div>)}</section>;
}
