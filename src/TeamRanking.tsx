/**
 * 주간현황판 → 순위표 (2026-10-15 팀장 요청)
 * 활동 기록(activity_events)을 사람별로 세어 항목마다 순위를 매기고, 사람마다 "팀 평균보다 뛰어난 것 / 부족한 것"을 짚는다.
 * 점검은 기기 대수, 재계약·불만은 업체 기준 중복 제거, 나머지는 건수. 취소된 기록은 뺀다.
 * 점검·AS 는 2026-10-22부터 jeomgeom·as_records 표 원본(workCount countField, loadWorkEvents 가 갈아 끼움) — 홈·팀 현황·조회 탭과 같은 값.
 * 물류·재계약·불만·초과조정·미수·담당자 변경은 2026-10-24부터 양식 원본 표(formCount, loadWorkEvents 가 갈아 끼움) — 순위표 항목 중 활동 기록으로 세는 것은 없다.
 * 담당자 변경은 CS 밖 작성자(전략영업·경영지원 등)가 팀 미지정이라 순위표(CS 명단)에는 안 나온다.
 */
import { useEffect, useMemo, useState } from "react";
import { OPERATIONS_TEAMS, type ActivityEvent } from "./operations";
import { loadWorkEvents } from "./expansionSource";
import { useMembers } from "./authors";
import { kstDate, weekRange } from "./visits";
import { countableEvents, EXPANSION_BASIS_TEXT, FIELD_BASIS_TEXT } from "./workCount";
import { CONTACT_BASIS_TEXT, countFormEvents, FORM_BASIS_TEXT } from "./formCount";
import { rankingLogisticsCount } from "./rankingLogistics";
import { UI } from "./ui/card";
import StateBox from "./ui/StateBox";

type Period = "week" | "month" | "quarter" | "year";
type Metric = { key: string; label: string; unit: string; count: (evs: ActivityEvent[]) => number };

const byKind = (kind: string) => (evs: ActivityEvent[]) => evs.filter((e) => e.category === kind).length;
// 같은 사람이 같은 업체를 다시 보낸 것(수정 재전송·연타)은 한 건으로 — 2026-10-17 "한왕주 PC 8개인데 실제 6개".
// 규칙(옛 dedupeForRanking)은 workCount.ts 한 곳에 두고 팀 현황(OperationsDashboard)도 같은 것을 쓴다(2026-10-22).

const METRICS: Metric[] = [
  { key: "inspection", label: "점검", unit: "대", count: (evs) => evs.filter((e) => e.category === "inspection").reduce((n, e) => n + (e.machineCount || 1), 0) },
  { key: "as", label: "AS", unit: "건", count: byKind("as") },
  // 물류 = 여분·마감 제외(팀 현황 '물류' 칸·홈 K24 와 같은 판정, 2026-10-24)
  { key: "logistics", label: "물류", unit: "건", count: rankingLogisticsCount },
  { key: "expansion", label: "확장성", unit: "곳", count: (evs) => evs.filter((e) => e.category === "expansion_it" || e.category === "expansion_copier").length },
  // 재계약·미수·초과조정·불만 = 양식 원본 표(loadWorkEvents 가 갈아 끼움) · 단위는 formCount 한 곳(재계약·불만 = 업체 수, 2026-10-24)
  { key: "recontract", label: "재계약", unit: "곳", count: (evs) => countFormEvents("recontract", evs) },
  { key: "misu", label: "미수", unit: "건", count: (evs) => countFormEvents("misu", evs) },
  { key: "overage", label: "초과조정", unit: "건", count: (evs) => countFormEvents("overage", evs) },
  // 담당자 변경 = contact_changes 원본 표(키맨체크 시트 행 포함, 2026-10-24 3단계)
  { key: "contact_change", label: "담당자 변경", unit: "건", count: (evs) => countFormEvents("contact_change", evs) },
  { key: "complaint", label: "불만 처리", unit: "곳", count: (evs) => countFormEvents("complaint", evs) },
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
  const [loadFailed, setLoadFailed] = useState(false); // 조회 실패 표시용(숫자 계산과 무관) — 실패하면 빈 목록 대신 에러 안내
  const [retry, setRetry] = useState(0);
  const members = useMembers();
  const range = rangeOf(period);

  useEffect(() => {
    let alive = true; setEvents(null); setLoadFailed(false);
    // 확장성은 pc_expansion·mfp_expansion(시트 포함) 원본 — 팀 현황·조회 탭과 같은 함수(2026-10-22)
    void loadWorkEvents(range.start, range.end).then((rows) => { if (alive) setEvents(countableEvents(rows)); }).catch(() => { if (alive) { setEvents([]); setLoadFailed(true); } });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, retry]);

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

  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);
  return (
    <div className={UI.gap}>
      {/* 카드 1장 — 기간·팀 머리 / 항목별 순위 / 한 사람 강점·보완(구분선으로 나눔, 2026-10-24) */}
      <section className={UI.card}>
        <div className={UI.head}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className={UI.seg}>{(["week", "month", "quarter", "year"] as Period[]).map((p) => <button key={p} type="button" onClick={() => setPeriod(p)} className={`${UI.segBtn(period === p)} px-3.5`}>{rangeOf(p).label}</button>)}</span>
            <span className="flex flex-wrap items-center gap-1.5">{["전체", ...OPERATIONS_TEAMS].map((t) => <button key={t} type="button" onClick={() => setTeam(t)} className={UI.chip(team === t)}>{t === "전체" ? "전체" : `${t}팀`}</button>)}</span>
          </div>
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-[11px] font-bold text-slate-400 lg:px-5">{range.start} ~ {range.end} · 원본 표 기준(점검·AS·확장성·물류·재계약·불만·초과조정·미수·담당자 변경) · 오발송 제외</p>

        {/* 항목별 순위 */}
        <div className="p-4 lg:p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className={`${UI.title} mr-1`}>순위표</h3>
            {METRICS.map((mt) => <button key={mt.key} type="button" onClick={() => setMetric(mt.key)} className={UI.chip(metric === mt.key)}>{mt.label}</button>)}
          </div>
          {events === null ? <StateBox kind="loading" inside message="순위표를 불러오는 중입니다…" /> : loadFailed ? <StateBox kind="error" inside message="순위표를 불러오지 못했습니다." hint="잠시 후 다시 시도해 주세요." onRetry={() => setRetry((n) => n + 1)} /> : (
            <ol className="mt-3 space-y-1">
              {ranked.map((r, i) => (
                <li key={r.name}>
                  <button type="button" onClick={() => setPerson(r.name)} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left ${person === r.name ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                    <span className="w-7 shrink-0 text-center text-[13px] font-black text-slate-500">{medal(i)}</span>
                    <span className="w-20 shrink-0 truncate text-[13px] font-black text-slate-900">{r.name}{r.name === author ? " (나)" : ""}</span>
                    <span className="w-8 shrink-0 text-[11px] font-bold text-slate-400">{r.team}팀</span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400" style={{ width: `${(r.values[metric] / max) * 100}%` }} /></span>
                    <span className="w-16 shrink-0 text-right font-mono text-[13px] font-black tabular-nums text-slate-900">{r.values[metric]}{cur.unit}</span>
                  </button>
                </li>
              ))}
              {!ranked.length && <li><StateBox kind="empty" inside message="대상 인원이 없습니다." hint="팀을 바꾸거나 기간을 늘려 보세요." /></li>}
            </ol>
          )}
          <div className="mt-2 text-[11px] font-semibold text-slate-400">팀 평균 {avg[metric]?.toFixed(1)}{cur.unit} · 이름을 누르면 아래에 그 사람의 강점·보완점</div>
        </div>

        {/* 한 사람 — 잘한 것·부족한 것 (순위표 아래 구분선 구역) */}
        {insight && me && (
          <div className={UI.section}>
            <div className="flex flex-wrap items-baseline gap-2"><h3 className={UI.title}>{me.name}</h3><span className="text-[11px] font-bold text-slate-400">{me.team}팀 · {range.label} · 비교 대상 {table.length}명 평균</span></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="border-l-4 border-emerald-400 pl-3">
                <div className="text-[12px] font-black text-emerald-800">뛰어난 부분</div>
                {insight.strong.length ? insight.strong.map((r) => <div key={r.mt.key} className="mt-1 text-[12.5px] font-bold text-emerald-900">{r.mt.label} {r.v}{r.mt.unit} — 평균의 {Math.round(r.ratio * 100)}% · {r.rank}위</div>) : <div className="mt-1 text-[12px] font-semibold text-emerald-700">평균보다 20% 이상 높은 항목이 없습니다</div>}
              </div>
              <div className="border-l-4 border-amber-400 pl-3">
                <div className="text-[12px] font-black text-amber-800">보완할 부분</div>
                {insight.weak.length ? insight.weak.map((r) => <div key={r.mt.key} className="mt-1 text-[12.5px] font-bold text-amber-900">{r.mt.label} {r.v}{r.mt.unit} — 평균 {r.a.toFixed(1)}{r.mt.unit}의 {Math.round(r.ratio * 100)}% · {r.rank}위</div>) : <div className="mt-1 text-[12px] font-semibold text-amber-700">평균보다 20% 이상 낮은 항목이 없습니다</div>}
              </div>
            </div>
            <div className="mt-3">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[11px] font-black text-slate-400"><th className="py-1">항목</th><th className="py-1 text-right">나</th><th className="py-1 text-right">평균</th><th className="py-1 text-right">순위</th></tr></thead>
                <tbody>{insight.rows.map((r) => <tr key={r.mt.key} className="border-t border-slate-100"><td className="py-1.5 font-bold text-slate-700">{r.mt.label}</td><td className={`py-1.5 text-right font-mono font-black ${r.ratio >= 1.2 ? "text-emerald-700" : r.ratio < 0.8 ? "text-amber-700" : "text-slate-800"}`}>{r.v}{r.mt.unit}</td><td className="py-1.5 text-right font-mono text-slate-500">{r.a.toFixed(1)}</td><td className="py-1.5 text-right font-mono text-slate-500">{r.rank}/{table.length}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] font-semibold text-slate-400">숫자는 각 양식의 원본 표를 센 것입니다. 물류·재계약·불만·초과조정·미수 기준: {FORM_BASIS_TEXT}. 담당자 변경 기준: {CONTACT_BASIS_TEXT}. 점검·AS 기준: 점검·AS 표, {FIELD_BASIS_TEXT}. 확장성 기준: PC·복합기 확장성 표(시트 포함), {EXPANSION_BASIS_TEXT}. 맡은 지역·업체 수·휴가에 따라 차이가 있으니 참고용입니다.</div>
          </div>
        )}
      </section>
    </div>
  );
}
