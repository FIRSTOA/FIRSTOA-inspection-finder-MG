// [n월] 통합집계(2026-10-20) — 엑셀 '1.통합집계' 꼴: ★핵심방향★ + 파트 카드 + No·Pillar·병목현상·목표·A~D 판정·조치 필요 파트·
// "n월 결과 및 n+1월 개선계획"(okr_cycles.feedback memo). 월 OKR이 아직 팀장 것이 아니면(복사본) 분기 OKR을 읽기 전용으로 보여 준다.
// MonthTeamSummary — 파트 탭 [팀원 집계]: 팀원 × 그 달 주차 판정 점(1주·2주…).
import { useState } from "react";
import RichCell from "./RichCell";
import { tableCellClick } from "./cellNav";
import {
  OKR_TEAMS, achievementRate, actionMembersInMonth, bottleneckText, findReport, isAlert, memberReports, monthlyRollup, normalizeJudgment, resultRowFor, worstInMonth,
  type OkrCycle, type OkrFeedback, type OkrGoal, type OkrReport, type OkrTeam,
} from "./okr";
import { FragmentRows, JudgmentBadge, JudgmentDots, PillarBar, ResizeHandle } from "./OkrCells";
import { TD, TD_EDIT, TD_FIXED, TD_FIXED_EDIT, TD_READ, TD_WRITE, TH_READ, TH_WRITE, goalHtml, pillarRuns, shortBottleneck, teamName, useColWidths } from "./okrUi";

const BTN = "rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-100";
type GoalOps = { onGoal: (no: number, patch: Partial<OkrGoal>) => void; onPillar: (nos: number[], idx: number) => void; onInsert: (afterNo: number, pillarFull: string) => void; onRemove: (goal: OkrGoal) => void };
const nextMonthOf = (m: number) => (m >= 12 ? 1 : m + 1);

export default function OkrMonthRollup({ cycle, quarter, goals, goalsOf, fromQuarter, quarterLabel, reports, weekRows, otherMonths, onDirection, onFeedback, onPaste, onStartFromQuarter, onCopyGoals, onRestore, onTemplate, ops }: {
  cycle: OkrCycle; quarter: OkrCycle | null; goals: OkrGoal[]; goalsOf: (team: OkrTeam) => OkrGoal[]; fromQuarter: boolean; quarterLabel: string; reports: OkrReport[]; weekRows: OkrReport[]; otherMonths: OkrCycle[];
  onDirection: (text: string) => void; onFeedback: (no: number, memo: string, memoHtml?: string) => void; onPaste: () => void; onStartFromQuarter: (() => void) | null; onCopyGoals: (id: string) => void; onRestore: () => void; onTemplate: () => void;
  ops: GoalOps | null; // null = 읽기 전용(분기 OKR을 대신 보여 줄 때)
}) {
  const [openNo, setOpenNo] = useState<Record<number, boolean>>({});
  const m = cycle.month;
  const editable = !!ops && !fromQuarter;
  const rollup = monthlyRollup(cycle, reports, quarter);
  const byNo = new Map(rollup.map((r) => [r.no, r]));
  const runs = pillarRuns(goals);
  const partRows = reports.filter((r) => !r.member);
  const perTeam = OKR_TEAMS.map((t) => {
    const rep = partRows.find((r) => r.team === t);
    const teamGoals = goalsOf(t);
    const rows = teamGoals.map((g) => resultRowFor(rep, g.no));
    return { team: t, rep, total: teamGoals.length, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, alerts: rows.filter((r) => isAlert(r.judgment)).length, rate: achievementRate(rows) };
  });
  const heads = ["", "병목현상", "목표", ...OKR_TEAMS.map(teamName), "조치·확인 필요 파트", `${m}월 결과 및 ${nextMonthOf(m)}월 개선계획`];
  const col = useColWidths("okr_cols_summary_v2", [58, 220, 260, ...OKR_TEAMS.map(() => 72), 140, 320]);
  const fb = (no: number): OkrFeedback | undefined => cycle.feedback?.[String(no)];
  return <div className="space-y-3">
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-1 text-[11px] font-black text-slate-500">★ 핵심방향</div>
      <div className="rounded border border-slate-200 bg-[#FFFBEB] focus-within:bg-white"><RichCell colors={false} text={cycle.direction || ""} minRows={2} onChange={(t) => onDirection(t)} /></div>
    </section>

    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {perTeam.map(({ team, rep, total, judged, alerts, rate }) => <div key={team} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{teamName(team)}</div><div className="text-[11px] font-bold tabular-nums text-slate-400">{judged >= total && total ? "제출 완료" : `판정 ${judged}/${total}`}</div></div>
        <div className="mt-1 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{rate === null ? "—" : `${rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-right text-[11px] font-bold">{alerts > 0 ? <span className="text-rose-600">미흡·미착수 {alerts}</span> : <span className="text-slate-300">미흡 없음</span>}</div></div>
        <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-400">{rep?.header.leader ? `파트장 ${rep.header.leader}` : "파트장 미기재"}</div>
      </div>)}
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {fromQuarter && <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-900">팀장 {m}월 OKR 대기 — {quarterLabel} OKR을 보여줍니다(읽기 전용)</div>}
      <div className="flex flex-wrap items-center justify-end gap-1.5 border-b border-slate-200 px-3 py-1.5">
        <button type="button" onClick={onPaste} className={BTN}>📋 팀장 {m}월 OKR 붙여넣기</button>
        {onStartFromQuarter && <button type="button" onClick={onStartFromQuarter} className={BTN}>분기 OKR로 시작</button>}
        {cycle.goals_prev?.length ? <button type="button" onClick={onRestore} className={BTN}>직전 목표로 되돌리기</button> : null}
        {!goals.length && <button type="button" onClick={onTemplate} className={BTN}>3 × 3 빈 틀</button>}
        {otherMonths.length > 0 && <select value="" onChange={(e) => e.target.value && onCopyGoals(e.target.value)} className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600">
          <option value="">다른 달에서 가져오기…</option>
          {otherMonths.map((c) => <option key={c.id} value={c.id}>{c.year}년 {c.month}월 ({c.goals.length}개)</option>)}
        </select>}
      </div>
      <div className="overflow-x-auto">
        <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
          <colgroup>{heads.map((h, i) => <col key={`${h}-${i}`} style={{ width: col.widths[i] }} />)}</colgroup>
          <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={`relative ${i === heads.length - 1 ? TH_WRITE : TH_READ} ${i >= 3 && i < 3 + OKR_TEAMS.length ? "text-center" : ""}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
          <tbody>
            {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
              <PillarBar idx={run.idx} colSpan={heads.length} editable={editable} onPillar={(i) => ops?.onPillar(run.goals.map((g) => g.no), i)} onAdd={() => ops?.onInsert(run.goals[run.goals.length - 1].no, run.goals[0].pillar)} />
              {run.goals.map((goal) => {
                const r = byNo.get(goal.no);
                const actions = r?.actionTeams || [];
                const who = actionMembersInMonth(weekRows, goal.no);
                const open = !!openNo[goal.no];
                return <FragmentRows key={goal.no}>
                  <tr>
                    <td className={`${TD_READ} text-[11px] font-bold text-slate-500 ${actions.length ? "border-l-4 border-l-orange-500" : ""}`}>
                      <div className="flex items-start justify-between gap-1">{shortBottleneck(goals, goal.no)}{editable && <button type="button" title="이 목표 삭제" onClick={() => ops?.onRemove(goal)} className="text-slate-300 hover:text-rose-600">×</button>}</div>
                    </td>
                    <td className={editable ? TD_EDIT : `${TD_READ} text-slate-500`}>{editable
                      ? <RichCell colors={false} text={bottleneckText(goal.bottleneck)} minRows={2} onChange={(t) => ops?.onGoal(goal.no, { bottleneck: t })} />
                      : <div className="whitespace-pre-wrap leading-snug">{bottleneckText(goal.bottleneck)}</div>}</td>
                    <td className={editable ? TD_FIXED_EDIT : TD_FIXED}>
                      <RichCell readOnly={!editable} text={goal.objective} html={goal.html?.objective} minRows={2} className={`font-semibold ${editable ? "text-sky-950" : "text-slate-500"}`} onChange={editable ? (t, h) => ops?.onGoal(goal.no, { objective: t, html: goalHtml(goal, "objective", h) }) : undefined} />
                      <button type="button" onClick={() => setOpenNo((cur) => ({ ...cur, [goal.no]: !open }))} className="px-2 pb-1 text-[10px] font-bold text-slate-400 hover:text-slate-700">{open ? "달성기준 접기" : "달성기준 ▾"}</button>
                    </td>
                    {OKR_TEAMS.map((t) => <td key={t} className={`${TD} px-1 py-1.5 text-center`}><JudgmentBadge value={r?.byTeam[t] || ""} /></td>)}
                    <td className={`${TD_READ} text-[11px] leading-snug`}>{actions.length ? actions.map((t) => <div key={t}><span className="font-black text-rose-600">{t}파트</span>{who[t]?.length ? <span className="text-slate-500"> · {who[t].join(", ")}</span> : null}</div>) : <span className="text-slate-300">—</span>}</td>
                    <td className={TD_WRITE}><RichCell text={fb(goal.no)?.memo || ""} html={fb(goal.no)?.memoHtml} minRows={2} onChange={(t, h) => onFeedback(goal.no, t, h)} /></td>
                  </tr>
                  {open && <tr><td colSpan={heads.length} className={editable ? TD_EDIT : TD_READ}>
                    <div className="px-2 pt-1 text-[10px] font-black text-slate-400">달성기준(실행)</div>
                    {editable
                      ? <RichCell text={goal.criteria} html={goal.html?.criteria} minRows={2} onChange={(t, h) => ops?.onGoal(goal.no, { criteria: t, html: goalHtml(goal, "criteria", h) })} />
                      : <div className="whitespace-pre-wrap px-2 pb-1 text-slate-600">{goal.criteria || "—"}</div>}
                  </td></tr>}
                </FragmentRows>;
              })}
            </FragmentRows>)}
            {!goals.length && <tr><td colSpan={heads.length} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다 — [팀장 {m}월 OKR 붙여넣기] 또는 [3 × 3 빈 틀]</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}

// 파트 탭 [팀원 집계](새 구조) — 팀원 × 그 달 주차 판정 점, 조치 필요 인원(그 달 주차 전체), 파트 종합판정(월), 파트장 피드백(월 파트 종합 행)
export function MonthTeamSummary({ team, goals, names, weeks, weekRows, partReport, onPick, onFeedback }: {
  team: OkrTeam; goals: OkrGoal[]; names: string[]; weeks: Array<{ id: string; weekNo: number; label: string }>; weekRows: OkrReport[]; partReport: OkrReport;
  onPick: (name: string, weekNo: number) => void; onFeedback: (no: number, memo: string, memoHtml?: string) => void;
}) {
  const runs = pillarRuns(goals);
  const teamRows = weekRows.filter((r) => r.team === team);
  const heads = ["", "목표", ...names, "조치 필요 인원", "파트 종합", "미흡항목 피드백 & 다음 달 개선 방향"];
  const col = useColWidths(`okr_cols_teamsum_v2_${team}_${names.length}`, [58, 240, ...names.map(() => 30 + weeks.length * 12), 140, 100, 320]);
  const rowOf = (name: string, weekId: string, no: number) => resultRowFor(findReport(teamRows.filter((r) => r.cycle_id === weekId), team, name), no);
  const stats = names.map((name) => { const mine = memberReports(teamRows, team).filter((r) => r.member === name); const rows = mine.flatMap((r) => goals.map((g) => resultRowFor(r, g.no))); return { name, weeksFilled: weeks.filter((w) => mine.some((r) => r.cycle_id === w.id && r.rows.some((x) => x.actual.trim() || x.judgment.trim()))).length, alerts: rows.filter((x) => isAlert(x.judgment)).length, rate: achievementRate(rows) }; });
  return <div className="space-y-3 p-3">
    {stats.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((st) => <button key={st.name} type="button" onClick={() => onPick(st.name, weeks[0]?.weekNo || 1)} className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-400">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{st.name}</div><div className="text-[11px] font-bold tabular-nums text-slate-400">주차 {st.weeksFilled}/{weeks.length}</div></div>
        <div className="mt-1 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{st.rate === null ? "—" : `${st.rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-[11px] font-bold">{st.alerts > 0 ? <span className="text-rose-600">미흡·미착수 {st.alerts}</span> : <span className="text-slate-300">미흡 없음</span>}</div></div>
      </button>)}
    </div>}
    <div className="overflow-x-auto">
      <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
        <colgroup>{heads.map((h, i) => <col key={`${h}-${i}`} style={{ width: col.widths[i] }} />)}</colgroup>
        <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={`relative ${i === heads.length - 1 ? TH_WRITE : TH_READ} ${i >= 2 && i < heads.length - 1 ? "text-center" : ""}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
        <tbody>
          {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
            <PillarBar idx={run.idx} colSpan={heads.length} editable={false} onPillar={() => undefined} onAdd={() => undefined} />
            {run.goals.map((goal) => {
              const alertNames = actionMembersInMonth(teamRows, goal.no)[team] || [];
              const part = resultRowFor(partReport, goal.no);
              const suggested = worstInMonth(teamRows, team, goal.no);
              return <tr key={goal.no}>
                <td className={`${TD_READ} text-[11px] font-bold text-slate-500 ${alertNames.length ? "border-l-4 border-l-orange-500" : ""}`}>{shortBottleneck(goals, goal.no)}</td>
                <td className={`${TD_READ} whitespace-pre-wrap font-semibold leading-snug text-slate-800`}>{goal.objective}</td>
                {names.map((name) => <td key={name} className={`${TD} px-1 py-1.5 text-center`}>
                  <span className="inline-flex gap-1">{weeks.map((w) => <button key={w.id} type="button" title={`${name} ${w.label}`} onClick={() => onPick(name, w.weekNo)} className="p-0.5"><JudgmentDots values={[rowOf(name, w.id, goal.no).judgment]} /></button>)}</span>
                </td>)}
                <td className={`${TD_READ} text-[11px] leading-snug`}>{alertNames.length ? <span className="font-black text-blue-700">{alertNames.join(", ")}</span> : <span className="text-slate-300">—</span>}</td>
                <td className={`${TD} px-1 py-1.5 text-center`}><JudgmentBadge value={part.judgment} />{!normalizeJudgment(part.judgment) && suggested && <div className="mt-0.5 text-[10px] font-bold text-slate-400">제안 {suggested}</div>}</td>
                <td className={TD_WRITE}><RichCell text={partReport.feedback?.[String(goal.no)]?.memo || ""} html={partReport.feedback?.[String(goal.no)]?.memoHtml} minRows={2} onChange={(t, h) => onFeedback(goal.no, t, h)} /></td>
              </tr>;
            })}
          </FragmentRows>)}
          {!goals.length && <tr><td colSpan={heads.length} className="border border-slate-200 p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다</td></tr>}
        </tbody>
      </table>
    </div>
    {!names.length && <div className="text-center text-[12px] font-semibold text-slate-400">관리 › 인원 명단에 이 파트 인원을 넣으면 여기 열이 생깁니다</div>}
  </div>;
}
