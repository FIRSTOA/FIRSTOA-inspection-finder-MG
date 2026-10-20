// [n월] 통합집계(2026-10-20, 2차 피드백 docs/tasks/okr-feedback-2.md 2-1) — '팀원 집계'와 같은 틀:
// 핵심방향 띠(OkrDirection) + 파트 카드 + No·Pillar 띠·병목현상·목표(팀장 문서색)·A~D 파트 월 종합 동그라미·CS 종합(월)·조치 필요 파트·
// "n월 결과 및 n+1월 개선계획"(okr_cycles.feedback memo). 11·12월(팀장 월 OKR 대기, fromQuarter)도 ops 가 있으면 고칠 수 있다(첫 편집은 부모가 월 OKR로 굳힘).
// MonthTeamSummary — 파트 탭 [팀원 집계]: 병목현상·목표 + 팀원 × 그 달 주차 판정 점 + 파트 종합(확정 ● / 마지막 주차 제안 ○).
// 3차(2026-10-21): 범례 없음 · 색은 병목현상·목표만(달성기준은 노랑) · 팀원 집계의 "병목 n" 번호 열 삭제.
// 4차(2026-10-21): 통합집계 No("병목 n") 열 삭제 — 목표 삭제 ×는 병목현상 칸 오른쪽 위로. 병목현상 굵게·글자색(html.bottleneck). "팀장 문서" 말·판정 "제안" 글자 삭제.
//
// props(OkrHub 연결용):
//   OkrMonthRollup({ cycle, quarter, goals, goalsOf, fromQuarter, quarterLabel, reports, weekRows, otherMonths,
//     onDirection, onFeedback, onPaste, onStartFromQuarter, onCopyGoals, onRestore, onTemplate, ops,   ← 예전 그대로
//     onCsJudgment?: (no: number, judgment: string) => void,  ← 새로: CS 종합 사람이 고름("" = 되돌리기 → 자동). 없으면 읽기 전용 점
//     onPickTeam?: (team: OkrTeam) => void,                    ← 새로: A~D 동그라미 → 그 달 그 파트 [파트 종합]
//     onOpenTeam?: (team: OkrTeam) => void })                  ← onPickTeam 과 같은 뜻(둘 중 하나만 넘기면 된다)
//   editable = !!ops (fromQuarter 여도). weekRows = 그 달 주차 기록(정식 …-Wn id) — monthlyRollup 4번째 인자로 제안(○)을 만든다.
//   MonthTeamSummary — props 변화 없음.
//   RolledJudgmentCell({ value: OkrRolledJudgment, label, onChange? }) — CS 종합·분기 종합 칸(OkrQuarterView 도 씀).
import { useState } from "react";
import RichCell from "./RichCell";
import JudgmentPicker from "./JudgmentPicker";
import OkrDirection from "./OkrDirection";
import { tableCellClick } from "./cellNav";
import {
  OKR_TEAMS, achievementRate, actionMembersInMonth, bottleneckText, findReport, isAlert, lastJudgmentInMonth, memberReports, monthlyRollup, normalizeJudgment, resultRowFor,
  type OkrCycle, type OkrFeedback, type OkrGoal, type OkrJudgedCell, type OkrReport, type OkrRolledJudgment, type OkrTeam,
} from "./okr";
import { FragmentRows, JudgmentDot, PillarBar, ResizeHandle, TeamCard } from "./OkrCells";
import { TD, TD_LEADER, TD_LEADER_EDIT, TD_READ, TD_WRITE, TH_LEADER, TH_READ, TH_WRITE, goalHtml, pillarRuns, shortBottleneck, teamName, useColWidths } from "./okrUi";

const BTN = "rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-100";
type GoalOps = { onGoal: (no: number, patch: Partial<OkrGoal>) => void; onPillar: (nos: number[], idx: number) => void; onInsert: (afterNo: number, pillarFull: string) => void; onRemove: (goal: OkrGoal) => void };
const nextMonthOf = (m: number) => (m >= 12 ? 1 : m + 1);
const EMPTY_CELL: OkrJudgedCell = { judgment: "", source: "" };
const EMPTY_ROLLED: OkrRolledJudgment = { judgment: "", auto: "", manual: false };
// 종합 판정(자동/사람) → 동그라미 칸: 사람이 고른 값 ● · 자동값 ○ · 없음 —
const rolledCell = (r?: OkrRolledJudgment): OkrJudgedCell => (!r?.judgment ? EMPTY_CELL : { judgment: r.judgment, source: r.manual ? "set" : "suggest" });

// CS 종합(월)·분기 종합 칸 — 판정 고르기(사람 덮어쓰기). 고른 값이 있으면 아래에 "자동 ○○ · 되돌리기", 자동값이면 "자동".
// onChange 가 없으면 동그라미만(읽기).
export function RolledJudgmentCell({ value, label, onChange }: { value: OkrRolledJudgment; label: string; onChange?: (judgment: string) => void }) {
  if (!onChange) return <div className="flex justify-center py-1"><JudgmentDot cell={rolledCell(value)} label={label} /></div>;
  return <div>
    <JudgmentPicker value={value.judgment} suggested={value.auto} onChange={(v) => onChange(v)} />
    {value.manual
      ? <div className="px-2 pb-1 text-[10px] font-bold text-slate-400">자동 {value.auto || "없음"} · <button type="button" onClick={() => onChange("")} className="text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline">되돌리기</button></div>
      : value.auto ? <div className="px-2 pb-1 text-[10px] font-bold text-slate-400">자동</div> : null}
  </div>;
}

export default function OkrMonthRollup({ cycle, quarter, goals, goalsOf, fromQuarter, reports, weekRows, onDirection, onFeedback, onTemplate, ops, onCsJudgment, onPickTeam, onOpenTeam }: {
  cycle: OkrCycle; quarter: OkrCycle | null; goals: OkrGoal[]; goalsOf: (team: OkrTeam) => OkrGoal[]; fromQuarter: boolean; quarterLabel: string; reports: OkrReport[]; weekRows: OkrReport[]; otherMonths: OkrCycle[];
  onDirection: (text: string) => void; onFeedback: (no: number, memo: string, memoHtml?: string) => void; onPaste: () => void; onStartFromQuarter: (() => void) | null; onCopyGoals: (id: string) => void; onRestore: () => void; onTemplate: () => void;
  ops: GoalOps | null; // null = 읽기 전용
  onCsJudgment?: (no: number, judgment: string) => void; // CS 종합 사람이 고름("" = 자동으로 되돌리기)
  onPickTeam?: (team: OkrTeam) => void; // A~D 동그라미 → 그 파트 [파트 종합]
  onOpenTeam?: (team: OkrTeam) => void; // onPickTeam 과 같은 뜻
}) {
  const [openNo, setOpenNo] = useState<Record<number, boolean>>({});
  const m = cycle.month;
  const editable = !!ops; // 11·12월(fromQuarter)도 고칠 수 있다 — 첫 편집 때 부모가 월 OKR로 굳힌다(설계안 3-4)
  const pickTeam = onPickTeam || onOpenTeam;
  const rollup = monthlyRollup(cycle, reports, quarter, weekRows);
  const byNo = new Map(rollup.map((r) => [r.no, r]));
  const runs = pillarRuns(goals);
  const partRows = reports.filter((r) => !r.member);
  const perTeam = OKR_TEAMS.map((t) => {
    const rep = partRows.find((r) => r.team === t);
    const teamGoals = goalsOf(t);
    const rows = teamGoals.map((g) => resultRowFor(rep, g.no));
    return { team: t, total: teamGoals.length, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, alerts: rows.filter((r) => isAlert(r.judgment)).length, rate: achievementRate(rows), leader: rep?.header.leader || "" };
  });
  const DOT0 = 2; // A~D 첫 열 위치(그 뒤 CS 종합까지 가운데 정렬). 4차: No 열 삭제
  const heads = ["병목현상", "목표", ...OKR_TEAMS.map(teamName), "CS 종합", "조치·확인 필요 파트", `${m}월 결과 및 ${nextMonthOf(m)}월 개선계획`];
  const col = useColWidths("okr_cols_summary_v4", [220, 260, ...OKR_TEAMS.map(() => 64), 112, 140, 320]);
  const thClass = (i: number) => (i === heads.length - 1 ? TH_WRITE : i === 0 || i === 1 ? TH_LEADER : `${TH_READ} ${i >= DOT0 && i <= DOT0 + OKR_TEAMS.length ? "text-center" : ""}`);
  const fb = (no: number): OkrFeedback | undefined => cycle.feedback?.[String(no)];
  return <div className="space-y-3">
    <OkrDirection text={cycle.direction || ""} editable onChange={(t) => onDirection(t)} label={`${m}월 핵심방향`} />

    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {perTeam.map((card) => <TeamCard key={card.team} card={card} />)}
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {fromQuarter && <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-900">{m}월 OKR이 아직 없습니다 — 아래 빈 틀에 바로 적으면 {m}월 OKR로 저장됩니다</div>}
      {/* 붙여넣기·분기 OKR로 시작·되돌리기·다른 달에서 가져오기 단추는 2026-10-21 사용자 지시로 뺐다(props 는 OkrHub 연결 유지). 목표가 하나도 없을 때만 [3 × 3 빈 틀]. */}
      {!goals.length && <div className="flex items-center justify-end border-b border-slate-200 px-3 py-1.5"><button type="button" onClick={onTemplate} className={BTN}>3 × 3 빈 틀</button></div>}
      <div className="overflow-x-auto">
        <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: "100%", minWidth: col.total }}>
          <colgroup>{heads.map((h, i) => <col key={`${h}-${i}`} style={col.colStyle(i)} />)}</colgroup>
          <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={`relative ${thClass(i)}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
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
                    <td className={`relative ${editable ? TD_LEADER_EDIT : TD_LEADER} ${actions.length ? "border-l-4 border-l-orange-500" : ""}`}>
                      {editable && <button type="button" title={`${shortBottleneck(goals, goal.no)} 목표 삭제`} onClick={() => ops?.onRemove(goal)} className="absolute right-0.5 top-0 z-[1] px-1 text-[11px] font-bold text-slate-300 hover:text-rose-600">×</button>}
                      <RichCell readOnly={!editable} text={bottleneckText(goal.bottleneck)} html={goal.html?.bottleneck} minRows={2} className="font-bold text-slate-800" onChange={editable ? (t, h) => ops?.onGoal(goal.no, { bottleneck: t, html: goalHtml(goal, "bottleneck", h) }) : undefined} />
                    </td>
                    <td className={editable ? TD_LEADER_EDIT : TD_LEADER}>
                      <RichCell readOnly={!editable} text={goal.objective} html={goal.html?.objective} minRows={2} className="font-semibold text-indigo-950" onChange={editable ? (t, h) => ops?.onGoal(goal.no, { objective: t, html: goalHtml(goal, "objective", h) }) : undefined} />
                      <button type="button" onClick={() => setOpenNo((cur) => ({ ...cur, [goal.no]: !open }))} className="px-2 pb-1 text-[10px] font-bold text-slate-400 hover:text-slate-700">{open ? "달성기준 접기" : "달성기준 ▾"}</button>
                    </td>
                    {OKR_TEAMS.map((t) => <td key={t} className={`${TD} min-w-14 px-1 py-1 text-center`}>
                      <JudgmentDot cell={r?.dots[t] || EMPTY_CELL} label={`${teamName(t)} ${m}월 종합`} onClick={pickTeam ? () => pickTeam(t) : undefined} />
                    </td>)}
                    <td className={`${TD} p-0`}><RolledJudgmentCell value={r?.cs || EMPTY_ROLLED} label={`CS ${m}월 종합`} onChange={onCsJudgment ? (v) => onCsJudgment(goal.no, v) : undefined} /></td>
                    <td className={`${TD_READ} text-[11px] leading-snug`}>{actions.length ? actions.map((t) => <div key={t}><span className="font-black text-rose-600">{t}파트</span>{who[t]?.length ? <span className="text-slate-500"> · {who[t].join(", ")}</span> : null}</div>) : <span className="text-slate-300">—</span>}</td>
                    <td className={TD_WRITE}><RichCell text={fb(goal.no)?.memo || ""} html={fb(goal.no)?.memoHtml} minRows={2} onChange={(t, h) => onFeedback(goal.no, t, h)} /></td>
                  </tr>
                  {open && <tr><td colSpan={heads.length} className={editable ? TD_WRITE : TD_READ}>
                    <div className="px-2 pt-1 text-[10px] font-black text-slate-500">달성기준(실행)</div>
                    {editable
                      ? <RichCell text={goal.criteria} html={goal.html?.criteria} minRows={2} onChange={(t, h) => ops?.onGoal(goal.no, { criteria: t, html: goalHtml(goal, "criteria", h) })} />
                      : <div className="whitespace-pre-wrap px-2 pb-1 text-slate-600">{goal.criteria || "—"}</div>}
                  </td></tr>}
                </FragmentRows>;
              })}
            </FragmentRows>)}
            {!goals.length && <tr><td colSpan={heads.length} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다 — [3 × 3 빈 틀]로 시작하세요</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}

// 파트 탭 [팀원 집계](새 구조) — 병목현상·목표(팀장 문서, 읽기) + 팀원 × 그 달 주차 판정 점, 조치 필요 인원(그 달 주차 전체),
// 파트 종합판정(월: 확정 ● / 마지막 기록 주차 제안 ○), 파트장 피드백(월 파트 종합 행)
export function MonthTeamSummary({ team, goals, names, weeks, weekRows, partReport, onPick, onFeedback }: {
  team: OkrTeam; goals: OkrGoal[]; names: string[]; weeks: Array<{ id: string; weekNo: number; label: string }>; weekRows: OkrReport[]; partReport: OkrReport;
  onPick: (name: string, weekNo: number) => void; onFeedback: (no: number, memo: string, memoHtml?: string) => void;
}) {
  const runs = pillarRuns(goals);
  const teamRows = weekRows.filter((r) => r.team === team);
  const NAME0 = 2; // 이름 첫 열 위치(그 뒤 파트 종합까지 가운데 정렬). 3차: "병목 n" 번호 열은 지웠다
  const heads = ["병목현상", "목표", ...names, "조치 필요 인원", "파트 종합", "미흡항목 피드백 & 다음 달 개선 방향"];
  const col = useColWidths(`okr_cols_teamsum_v4_${team}_${names.length}`, [200, 240, ...names.map(() => 16 + weeks.length * 24), 140, 96, 320]);
  const thClass = (i: number) => (i === heads.length - 1 ? TH_WRITE : i === 0 || i === 1 ? TH_LEADER : `${TH_READ} ${i >= NAME0 ? "text-center" : ""}`);
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
      <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: "100%", minWidth: col.total }}>
        <colgroup>{heads.map((h, i) => <col key={`${h}-${i}`} style={col.colStyle(i)} />)}</colgroup>
        <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={`relative ${thClass(i)}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
        <tbody>
          {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
            <PillarBar idx={run.idx} colSpan={heads.length} editable={false} onPillar={() => undefined} onAdd={() => undefined} />
            {run.goals.map((goal) => {
              const alertNames = actionMembersInMonth(teamRows, goal.no)[team] || [];
              const part = resultRowFor(partReport, goal.no);
              const set = normalizeJudgment(part.judgment);
              const suggested = set ? "" : lastJudgmentInMonth(teamRows, team, goal.no);
              const partCell: OkrJudgedCell = set ? { judgment: set, source: "set" } : suggested ? { judgment: suggested, source: "suggest" } : EMPTY_CELL;
              return <tr key={goal.no}>
                <td className={`${TD_LEADER} ${alertNames.length ? "border-l-4 border-l-orange-500" : ""}`}><RichCell readOnly text={bottleneckText(goal.bottleneck)} html={goal.html?.bottleneck} minRows={1} className="font-bold text-slate-800" /></td>
                <td className={TD_LEADER}><div className="whitespace-pre-wrap px-2 py-1.5 font-semibold leading-snug text-indigo-950">{goal.objective}</div></td>
                {names.map((name) => <td key={name} className={`${TD} px-1 py-1 text-center`}>
                  <span className="inline-flex flex-wrap justify-center">{weeks.map((w) => {
                    const j = normalizeJudgment(rowOf(name, w.id, goal.no).judgment);
                    return <button key={w.id} type="button" onClick={() => onPick(name, w.weekNo)} className="rounded hover:bg-slate-100">
                      <JudgmentDot cell={j ? { judgment: j, source: "set" } : EMPTY_CELL} size={10} label={`${name} ${w.label}`} />
                    </button>;
                  })}</span>
                </td>)}
                <td className={`${TD_READ} text-[11px] leading-snug`}>{alertNames.length ? <span className="font-black text-blue-700">{alertNames.join(", ")}</span> : <span className="text-slate-300">—</span>}</td>
                <td className={`${TD} min-w-14 px-1 py-1 text-center`}>
                  <JudgmentDot cell={partCell} label={`${teamName(team)} 종합`} />
                  {partCell.judgment && <div className="text-[10px] font-bold text-slate-400">{partCell.judgment /* 4차: "제안" 글자 없이 값만 — 제안은 ○ 점으로 */}</div>}
                </td>
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
