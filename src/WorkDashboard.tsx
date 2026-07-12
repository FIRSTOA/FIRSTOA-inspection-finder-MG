import { useEffect, useMemo, useState } from "react";
import { EMPTY_WEEKLY_NOTE, getVisits, getWeeklyNote, kstDate, saveWeeklyNote, weekRange, WORK_LABELS, type VisitRow, type WeeklyNote, type WorkKind } from "./visits";

const KINDS = Object.keys(WORK_LABELS) as WorkKind[];
const COLORS: Record<WorkKind, string> = { inspection: "#2563eb", as: "#dc2626", delivery: "#9333ea", etc: "#64748b", pc: "#0891b2", misu: "#d97706", bulman: "#e11d48", recontract: "#16a34a", overage: "#ca8a04" };
const icons: Record<WorkKind, string> = { inspection: "✅", as: "🔧", delivery: "📦", etc: "📌", pc: "💻", misu: "💰", bulman: "💢", recontract: "📝", overage: "📈" };

function summarize(rows: VisitRow[]) {
  const count = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<WorkKind, number>;
  const minutes = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<WorkKind, number>;
  const visitMachines = new Map<string, number>();
  for (const r of rows) {
    if (r.visited) { const key = `${r.workDate}|${r.vendor}`; visitMachines.set(key, Math.max(visitMachines.get(key) || 0, r.machineCount)); }
    for (const k of KINDS) { const m = Number(r.minutes[k] || 0); if (r.workKinds.includes(k)) count[k]++; minutes[k] += m; }
  }
  return { count, minutes, visits: visitMachines.size, machines: [...visitMachines.values()].reduce((a, b) => a + b, 0), totalMinutes: Object.values(minutes).reduce((a, b) => a + b, 0) };
}
const hm = (m: number) => m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default function WorkDashboard({ kind, author }: { kind: "daily" | "weekly"; author: string }) {
  const today = kstDate();
  const range = kind === "daily" ? { start: today, end: today } : weekRange(today);
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState<WeeklyNote>({ ...EMPTY_WEEKLY_NOTE });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true; setLoading(true); setError("");
    Promise.all([getVisits(author, range.start, range.end), kind === "weekly" ? getWeeklyNote(author, range.start) : Promise.resolve({ ...EMPTY_WEEKLY_NOTE })])
      .then(([v, n]) => { if (alive) { setRows(v); setNote(n); } })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [author, kind, range.start, range.end]);

  const sum = useMemo(() => summarize(rows), [rows]);
  const commute = [...rows].reverse().find((r) => r.commute)?.commute;
  const grouped = useMemo(() => rows.reduce<Record<string, VisitRow[]>>((a, r) => ((a[r.workDate] ||= []).push(r), a), {}), [rows]);
  const setText = <K extends keyof WeeklyNote>(k: K, v: WeeklyNote[K]) => setNote({ ...note, [k]: v });
  const save = async () => { setSaving(true); setSaved(false); try { await saveWeeklyNote(author, range.start, note); setSaved(true); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } };

  if (!author) return <div className="rounded-2xl bg-amber-50 p-5 text-sm text-amber-800">FIELD에서 작성자를 먼저 선택해 주세요.</div>;
  return <div className="space-y-4 pb-12">
    <div className="rounded-3xl bg-gradient-to-br from-slate-700 to-slate-900 p-5 text-white">
      <div className="text-xs font-semibold text-white/60">{kind === "daily" ? today : `${range.start} ~ ${range.end}`}</div>
      <div className="mt-1 text-2xl font-bold">{kind === "daily" ? "오늘 업무" : "주간 현황판"}</div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/10 p-2"><div className="text-xl font-bold">{sum.visits}</div><div className="text-[10px] text-white/60">방문</div></div>
        <div className="rounded-xl bg-white/10 p-2"><div className="text-xl font-bold">{sum.machines}</div><div className="text-[10px] text-white/60">기기</div></div>
        <div className="rounded-xl bg-white/10 p-2"><div className="text-xl font-bold">{hm(sum.totalMinutes)}</div><div className="text-[10px] text-white/60">업무시간</div></div>
      </div>
      {kind === "daily" && commute && <div className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-bold">오늘 마감: {commute}</div>}
    </div>
    {loading && <div className="p-8 text-center text-sm text-slate-400">불러오는 중…</div>}
    {error && <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}<br />Supabase 방문기록 SQL이 아직 적용되지 않았다면 먼저 적용해야 합니다.</div>}
    {!loading && <div className="grid grid-cols-2 gap-2">
      {KINDS.filter((k) => sum.count[k] > 0 || (kind === "weekly" && ["inspection", "as", "pc", "misu", "bulman", "recontract", "overage"].includes(k))).map((k) => {
        const goal = Number(note.goals[k] || 0); const pct = goal ? Math.round(sum.count[k] / goal * 100) : 0;
        return <div key={k} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-600">{icons[k]} {WORK_LABELS[k]}</span><span className="text-lg font-bold" style={{ color: COLORS[k] }}>{sum.count[k]}</span></div>
          <div className="mt-1 text-[11px] text-slate-400">{hm(sum.minutes[k])}{kind === "weekly" && goal > 0 ? ` · 목표 ${goal} (${pct}%)` : ""}</div>
          {kind === "weekly" && <input type="number" min="0" value={note.goals[k] || ""} onChange={(e) => setText("goals", { ...note.goals, [k]: Number(e.target.value) || 0 })} placeholder="주간 목표" className="mt-2 w-full rounded-lg bg-slate-50 px-2 py-1.5 text-xs outline-none" />}
        </div>;
      })}
    </div>}
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><div className="mb-3 text-sm font-bold text-slate-800">날짜별 방문</div>
      {!rows.length && !loading && <div className="py-4 text-center text-xs text-slate-400">저장된 방문 기록이 없습니다.</div>}
      {Object.entries(grouped).map(([date, list]) => <div key={date} className="mb-4 last:mb-0"><div className="mb-1 text-xs font-bold text-slate-400">{shortDate(date)}</div>{list.map((r) => {
        const active = r.workKinds;
        return <div key={r.id} className="border-t border-slate-50 py-2"><div className="flex justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-700">{r.vendor}</span><span className="shrink-0 text-xs text-slate-400">{r.machineCount ? `${r.machineCount}대 · ` : ""}{hm(active.reduce((n, k) => n + Number(r.minutes[k] || 0), 0))}</span></div><div className="mt-0.5 text-[11px] text-slate-400">{!r.visited ? "📞 비방문 · " : ""}{active.map((k) => `${icons[k]}${WORK_LABELS[k]}`).join(" · ") || "방문"}</div></div>;
      })}</div>)}
    </div>
    {kind === "weekly" && <div className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><div className="text-sm font-bold text-slate-800">직접 작성하는 주간 기록</div>
      {([['review','이번 주 목표·결과 및 미진행 사유'],['growth','💡 성장노트'],['challenge','🎯 새로운 도전·아이디어'],['special','🧡 특이사항'],['learning','🧡 배운 점'],['request','🤝 지원·요청·건의사항'],['praise','🤝 칭찬']] as const).map(([k,label]) => <label key={k} className="block text-xs font-semibold text-slate-500">{label}<textarea value={note[k]} onChange={(e) => setText(k,e.target.value)} rows={3} className="mt-1 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm font-normal outline-none focus:border-slate-400" /></label>)}
      <button onClick={save} disabled={saving} className="w-full rounded-xl bg-slate-800 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? "저장 중…" : saved ? "저장 완료 ✓" : "주간 기록 저장"}</button>
    </div>}
  </div>;
}
