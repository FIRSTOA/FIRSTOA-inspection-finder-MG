/**
 * 주간현황판 → 순위표 (2026-10-15 팀장 요청)
 * 활동 기록(activity_events)을 사람별로 세어 항목마다 순위를 매기고, 사람마다 "팀 평균보다 뛰어난 것 / 부족한 것"을 짚는다.
 * 점검은 기기 대수, 재계약·불만은 업체 기준 중복 제거, 나머지는 건수. 취소된 기록은 뺀다.
 */
import { useEffect, useMemo, useState } from "react";
import { getActivityEvents, OPERATIONS_TEAMS, type ActivityEvent } from "./operations";
import { useMembers } from "./authors";
import { kstDate, weekRange } from "./visits";
import { vendorMatchKey } from "./ids";
import { countableEvents } from "./workCount";

type Period = "week" | "month" | "quarter" | "year";
type Metric = { key: string; label: string; unit: string; count: (evs: ActivityEvent[]) => number };

const byKind = (kind: string) => (evs: ActivityEvent[]) => evs.filter((e) => e.category === kind).length;
const byVendor = (kind: string) => (evs: ActivityEvent[]) => new Set(evs.filter((e) => e.category === kind).map((e) => vendorMatchKey(e.vendor) || e.vendor)).size;
// 같은 사람이 같은 업체를 다시 보낸 것(수정 재전송·연타)은 한 건으로 — 2026-10-17 "한왕주 PC 8개인데 실제 6개".
// 규칙(옛 dedupeForRanking)은 workCount.ts 한 곳에 두고 팀 현황(OperationsDashboard)도 같은 것을 쓴다(2026-10-22).

const METRICS: Metric[] = [
  { key: "inspection", label: "점검", unit: "대", count: (evs) => evs.filter((e) => e.category === "inspection").reduce((n, e) => n + (e.machineCount || 1), 0) },
  { key: "as", label: "AS", unit: "건", count: byKind("as") },
  { key: "logistics", label: "물류", unit: "건", count: byKind("logistics") },
  { key: "expansion", label: "확장성", unit: "곳", count: (evs) => evs.filter((e) => e.category === "expansion_it" || e.category === "expansion_copier").length },
  { key: "recontract", label: "재계약", unit: "곳", count: byVendor("recontract") },
  { key: "misu", label: "미수", unit: "건", count: byKind("misu") },
  { key: "overage", label: "초과조정", unit: "건", count: byKind("overage") },
  { key: "contact_change", label: "담당자 변경", unit: "건", count: byKind("contact_change") },
  { key: "complaint", label: "불만 처리", unit: "곳", count: byVendor("complaint") },
];

function rangeOf(period: Period): { start: string; end: string; label: string } {
  const today = kstDate();
  const [y, m] = today.split("-").map(Number);
  if (period === "week") { const w = weekRange(today); return { start: w.start, end: w.end, label: "이번 주" }; }
  if (period === "month") return { start: `${y}-${String(m).padStart(2, "0")}-01`, end: today, label: `${m}월` };
  if (period === "quarter") { const q = Math.floor((m - 1) / 3); return { start: `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`, end: today, label: `${q + 1}분기` }; }
  return { start: `${y}-01-01`, end: today, label: `${y}년` };
}

export default function TeamRanking({ author }: { author: string }) {
  const [period, setPeriod] = useState<Period>("month");
  const [team, setTeam] = useState<string>("전체");
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [metric, setMetric] = useState("inspection");
  const [person, setPerson] = useState(author);
  const members = useMembers();
  const range = rangeOf(period);

  useEffect(() => {
    let alive = true; setEvents(null);
    void getActivityEvents(range.start, range.end).then((rows) => { if (alive) setEvents(countableEvents(rows)); }).catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // 대상 인원 — 명단(CS A~E 팀)에서. 기록이 0이어도 순위표에 나온다
  const people = useMemo(() => {
    const roster = members.filter((m) => m.active && (OPERATIONS_TEAMS as string[]).includes(m.team) && (team === "전체" || m.team === team));
    const names = new Map(roster.map((m) => [m.name, m.team]));
    for (const e of events || []) if (!names.has(e.author) && (team === "전체" || e.team === team) && (OPERATIONS_TEAMS as string[]).includes(e.team || "")) names.set(e.author, e.team || "");
    return Array.from(names.entries()).map(([name, t]) => ({ name, team: t }));
  }, [members, events, team]);

  // 사람 × 항목 표
  const table = useMemo(() => {
    const evBy = new Map<string, ActivityEvent[]>();
    for (const e of events || []) evBy.set(e.author, [...(evBy.get(e.author) || []), e]);
    return people.map((p) => ({ ...p, values: Object.fromEntries(METRICS.map((mt) => [mt.key, mt.count(evBy.get(p.name) || [])])) as Record<string, number> }));
  }, [people, events]);
  const avg = useMemo(() => Object.fromEntries(METRICS.map((mt) => [mt.key, table.length ? table.reduce((n, r) => n + r.values[mt.key], 0) / table.length : 0])), [table]);
  const ranked = useMemo(() => [...table].sort((a, b) => b.values[metric] - a.values[metric] || a.name.localeCompare(b.name)), [table, metric]);
  const cur = METRICS.find((m) => m.key === metric)!;
  const max = Math.max(1, ...ranked.map((r) => r.values[metric]));

  // 한 사람의 강점·보완 — 팀 평균 대비(평균이 0인 항목은 뺀다)
  const me = table.find((r) => r.name === person);
  const insight = useMemo(() => {
    if (!me) return null;
    const rows = METRICS.filter((mt) => avg[mt.key] > 0).map((mt) => {
      const v = me.values[mt.key], a = avg[mt.key];
      const rank = [...table].sort((x, y) => y.values[mt.key] - x.values[mt.key]).findIndex((r) => r.name === me.name) + 1;
      return { mt, v, a, ratio: v / a, rank };
    });
    return { strong: rows.filter((r) => r.ratio >= 1.2).sort((x, y) => y.ratio - x.ratio).slice(0, 3), weak: rows.filter((r) => r.ratio < 0.8).sort((x, y) => x.ratio - y.ratio).slice(0, 3), rows };
  }, [me, avg, table]);

  const chip = (on: boolean) => `rounded-full px-3 py-1 text-[12px] font-black ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex rounded-full bg-slate-100 p-0.5">{(["week", "month", "quarter", "year"] as Period[]).map((p) => <button key={p} type="button" onClick={() => setPeriod(p)} className={`rounded-full px-3 py-1 text-[12px] font-black ${period === p ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{rangeOf(p).label}</button>)}</span>
        <span className="flex rounded-full bg-slate-100 p-0.5">{["전체", ...OPERATIONS_TEAMS].map((t) => <button key={t} type="button" onClick={() => setTeam(t)} className={`rounded-full px-2.5 py-1 text-[12px] font-black ${team === t ? "bg-slate-900 text-white" : "text-slate-500"}`}>{t === "전체" ? "전체" : `${t}팀`}</button>)}</span>
        <span className="ml-auto text-[11px] font-bold text-slate-400">{range.start} ~ {range.end} · 활동 기록 기준 · 취소 제외</span>
      </div>

      {/* 항목별 순위 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="mr-1 text-[14px] text-slate-900">순위표</b>
          {METRICS.map((mt) => <button key={mt.key} type="button" onClick={() => setMetric(mt.key)} className={chip(metric === mt.key)}>{mt.label}</button>)}
        </div>
        {events === null ? <div className="py-10 text-center text-[12px] font-bold text-slate-400">불러오는 중…</div> : (
          <ol className="mt-3 space-y-1">
            {ranked.map((r, i) => (
              <li key={r.name}>
                <button type="button" onClick={() => setPerson(r.name)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left ${person === r.name ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                  <span className="w-7 shrink-0 text-center text-[13px] font-black text-slate-500">{medal(i)}</span>
                  <span className="w-20 shrink-0 truncate text-[13px] font-black text-slate-900">{r.name}{r.name === author ? " (나)" : ""}</span>
                  <span className="w-8 shrink-0 text-[11px] font-bold text-slate-400">{r.team}팀</span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400" style={{ width: `${(r.values[metric] / max) * 100}%` }} /></span>
                  <span className="w-16 shrink-0 text-right font-mono text-[13px] font-black tabular-nums text-slate-900">{r.values[metric]}{cur.unit}</span>
                </button>
              </li>
            ))}
            {!ranked.length && <li className="py-6 text-center text-[12px] font-bold text-slate-400">대상 인원이 없습니다</li>}
          </ol>
        )}
        <div className="mt-2 text-[11px] font-semibold text-slate-400">팀 평균 {avg[metric]?.toFixed(1)}{cur.unit} · 이름을 누르면 아래에 그 사람의 강점·보완점</div>
      </section>

      {/* 한 사람 — 잘한 것·부족한 것 */}
      {insight && me && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-2"><b className="text-[14px] text-slate-900">{me.name}</b><span className="text-[11px] font-bold text-slate-400">{me.team}팀 · {range.label} · 비교 대상 {table.length}명 평균</span></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-[12px] font-black text-emerald-800">뛰어난 부분</div>
              {insight.strong.length ? insight.strong.map((r) => <div key={r.mt.key} className="mt-1 text-[12.5px] font-bold text-emerald-900">{r.mt.label} {r.v}{r.mt.unit} — 평균의 {Math.round(r.ratio * 100)}% · {r.rank}위</div>) : <div className="mt-1 text-[12px] font-semibold text-emerald-700">평균보다 20% 이상 높은 항목이 없습니다</div>}
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-[12px] font-black text-amber-800">보완할 부분</div>
              {insight.weak.length ? insight.weak.map((r) => <div key={r.mt.key} className="mt-1 text-[12.5px] font-bold text-amber-900">{r.mt.label} {r.v}{r.mt.unit} — 평균 {r.a.toFixed(1)}{r.mt.unit}의 {Math.round(r.ratio * 100)}% · {r.rank}위</div>) : <div className="mt-1 text-[12px] font-semibold text-amber-700">평균보다 20% 이상 낮은 항목이 없습니다</div>}
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[11px] font-black text-slate-400"><th className="py-1">항목</th><th className="py-1 text-right">나</th><th className="py-1 text-right">평균</th><th className="py-1 text-right">순위</th></tr></thead>
              <tbody>{insight.rows.map((r) => <tr key={r.mt.key} className="border-t border-slate-100"><td className="py-1 font-bold text-slate-700">{r.mt.label}</td><td className={`py-1 text-right font-mono font-black ${r.ratio >= 1.2 ? "text-emerald-700" : r.ratio < 0.8 ? "text-amber-700" : "text-slate-800"}`}>{r.v}{r.mt.unit}</td><td className="py-1 text-right font-mono text-slate-500">{r.a.toFixed(1)}</td><td className="py-1 text-right font-mono text-slate-500">{r.rank}/{table.length}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mt-2 text-[10.5px] font-semibold text-slate-400">숫자는 FIELD 보고·확장성·불만·미수 등 활동 기록을 센 것입니다. 같은 업체를 10분 안에 다시 보낸 것은 1건, 확장성은 하루 한 업체 1곳으로 셉니다. 맡은 지역·업체 수·휴가에 따라 차이가 있으니 참고용입니다.</div>
        </section>
      )}
    </div>
  );
}
