// [n분기] 탭(2026-10-20, 2차 피드백 docs/tasks/okr-feedback-2.md 2-2·2-3) — 표 하나로:
// 9목표 × [병목현상·목표·달성기준(실행)(팀장 문서색, 칸마다 바로 고침)] + 10·11·12월 CS 종합 동그라미(누르면 그 달 통합집계) + 분기 종합(자동, 사람이 덮어쓰기).
// QuarterTeamView — [n분기] + 파트 탭: 그 파트 9목표 × 10·11·12월 파트 월 종합 동그라미(● 확정 / ○ 마지막 주차 제안) + 파트 분기 종합(자동, 읽기).
// 달 머리는 늘 세 달(monthsOfQuarter) — 월 행이 없는 달은 빈칸(—).
//
// props(OkrHub 연결용):
//   OkrQuarterView({ quarter, rollup, prevQuarter, onGoal, onPaste, onRestore, onCopyPrev, onTemplate,
//     rollup: OkrQuarterRollup,                                ← progress(OkrQuarterProgress) 대신. quarterRollup(quarter, monthCycles, monthReports, weekReportsByMonth)
//     onQuarterJudgment?: (no: number, judgment: string) => void,  ← 새로: 분기 종합 사람이 고름("" = 자동으로 되돌리기). 없으면 읽기 전용 점
//     onPickMonth?: (monthId: string) => void,                 ← 새로: 달 머리·달 동그라미 → 그 달 [통합집계]
//     onOpenMonth?: (monthId: string) => void,                 ← onPickMonth 와 같은 뜻
//     onPick?: (monthId: string, team: string) => void })      ← 예전 이름. 위 둘이 없으면 onPick(monthId, "all") 로 부른다
//   QuarterTeamView({ team, rollup, quarter?, goals?,
//     onPick?: (monthId: string) => void,                      ← 달 동그라미 → 그 달 그 파트 [파트 종합](member '')
//     onOpenMonth?: (monthId: string, team: OkrTeam) => void,  ← onPick 과 같은 뜻(팀도 같이 넘김)
//     onPickMonthHead?: (monthId: string) => void })           ← 달 머리 → 그 달 그 파트 탭(기본 사람). 없으면 onPick 과 같다
import RichCell from "./RichCell";
import { tableCellClick } from "./cellNav";
import {
  bottleneckText, monthsOfQuarter, parseQuarterId, quarterOf,
  type OkrCycle, type OkrGoal, type OkrJudgedCell, type OkrQuarterRollup, type OkrRolledJudgment, type OkrTeam,
} from "./okr";
import { FragmentRows, JudgmentDot, OkrLegend, PillarBar, ResizeHandle } from "./OkrCells";
import { RolledJudgmentCell } from "./OkrMonthRollup";
import { TD, TD_LEADER, TD_LEADER_EDIT, TD_READ, TH_LEADER, TH_READ, goalHtml, pillarRuns, shortBottleneck, teamName, useColWidths } from "./okrUi";

const BTN = "rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-100";
const EMPTY_CELL: OkrJudgedCell = { judgment: "", source: "" };
const EMPTY_ROLLED: OkrRolledJudgment = { judgment: "", auto: "", manual: false };
// 달 CS 종합 → 동그라미: 사람이 고른 값 ● · 자동값 ○ · 없음 —
const rolledCell = (r?: OkrRolledJudgment): OkrJudgedCell => (!r?.judgment ? EMPTY_CELL : { judgment: r.judgment, source: r.manual ? "set" : "suggest" });

// 분기의 세 달(늘 셋) + 분기 번호 — 분기 행 id(2026-Q4)가 우선, 없으면 rollup 의 첫 달로 짐작
function quarterMonths(quarter: OkrCycle | null | undefined, rollup: OkrQuarterRollup): { q: number; months: Array<{ id: string; month: number; actionTeams: number }> } {
  const pq = quarter ? parseQuarterId(quarter.id) : null;
  const first = rollup.months[0];
  const year = pq?.year ?? (first ? Number(first.id.slice(0, 4)) : quarter?.year ?? 0);
  const q = pq?.quarter ?? (first ? quarterOf(first.month) : quarter ? quarterOf(quarter.month) : 0);
  if (!year || !q) return { q, months: rollup.months };
  return { q, months: monthsOfQuarter(year, q).map((x) => ({ id: x.id, month: x.month, actionTeams: rollup.months.find((m) => m.id === x.id)?.actionTeams || 0 })) };
}
// rollup 행 → 묶음 계산용 goal(병목 n·Pillar 띠)
const goalsFromRollup = (rollup: OkrQuarterRollup): OkrGoal[] => rollup.rows.map((r) => ({ no: r.no, pillar: r.pillar, bottleneck: r.bottleneck, objective: r.objective, criteria: r.criteria }));

export default function OkrQuarterView({ quarter, rollup, prevQuarter, onGoal, onPaste, onRestore, onCopyPrev, onTemplate, onQuarterJudgment, onPickMonth, onOpenMonth, onPick }: {
  quarter: OkrCycle; rollup: OkrQuarterRollup; prevQuarter: OkrCycle | null;
  onGoal: (no: number, patch: Partial<OkrGoal>) => void; onPaste: () => void; onRestore: () => void; onCopyPrev: () => void; onTemplate: () => void;
  onQuarterJudgment?: (no: number, judgment: string) => void;
  onPickMonth?: (monthId: string) => void;
  onOpenMonth?: (monthId: string) => void;
  onPick?: (monthId: string, team: string) => void;
}) {
  const goals = quarter.goals;
  const runs = pillarRuns(goals);
  const hasText = goals.some((g) => bottleneckText(g.bottleneck) || g.objective.trim() || g.criteria.trim());
  const { q, months } = quarterMonths(quarter, rollup);
  const openMonth = onPickMonth || onOpenMonth || (onPick ? (id: string) => onPick(id, "all") : undefined);
  const byNo = new Map(rollup.rows.map((r) => [r.no, r]));
  const MON0 = 4; // 첫 달 열 위치(그 뒤 분기 종합까지 가운데 정렬)
  const heads = ["", "병목현상", "목표", "달성기준(실행)", ...months.map((m) => `${m.month}월`), `${q}분기 종합`];
  const col = useColWidths("okr_cols_quarter_v2", [58, 220, 260, 280, ...months.map(() => 72), 112]);
  const thClass = (i: number) => (i >= 1 && i < MON0 ? TH_LEADER : `${TH_READ} ${i >= MON0 ? "text-center" : ""}`);
  return <div className="space-y-3">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-[12px] font-black text-slate-700">{quarter.title || "분기 OKR"}<span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-black text-indigo-900">팀장 문서</span></span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={onPaste} className={BTN}>📋 팀장 분기 OKR 붙여넣기</button>
          {prevQuarter && <button type="button" onClick={onCopyPrev} className={BTN}>↩ 지난 분기에서 가져오기</button>}
          {quarter.goals_prev?.length ? <button type="button" onClick={onRestore} className={BTN}>직전 목표로 되돌리기</button> : null}
          {!goals.length && <button type="button" onClick={onTemplate} className={BTN}>3 × 3 빈 틀</button>}
        </div>
      </div>
      <div className="border-b border-slate-100 px-3 py-1.5"><OkrLegend split={false} /></div>
      <div className="overflow-x-auto">
        <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
          <colgroup>{heads.map((h, i) => <col key={`${h}-${i}`} style={{ width: col.widths[i] }} />)}</colgroup>
          <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => {
            const mon = i >= MON0 && i < MON0 + months.length ? months[i - MON0] : null;
            return <th key={`${h}-${i}`} className={`relative ${thClass(i)}`}>
              {mon && openMonth
                ? <button type="button" onClick={() => openMonth(mon.id)} title={`${mon.month}월 통합집계 열기`} className="hover:underline">{h}</button>
                : h}
              {mon && mon.actionTeams > 0 && <span className="ml-1 text-rose-600">조치 {mon.actionTeams}</span>}
              <ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} />
            </th>;
          })}</tr></thead>
          <tbody>
            {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
              <PillarBar idx={run.idx} colSpan={heads.length} editable={false} onPillar={() => undefined} onAdd={() => undefined} />
              {run.goals.map((goal) => {
                const r = byNo.get(goal.no);
                return <tr key={goal.no}>
                  <td className={`${TD_READ} text-[11px] font-bold text-slate-500`}>{shortBottleneck(goals, goal.no)}</td>
                  <td className={TD_LEADER_EDIT}><RichCell colors={false} text={bottleneckText(goal.bottleneck)} minRows={2} onChange={(t) => onGoal(goal.no, { bottleneck: t })} /></td>
                  <td className={TD_LEADER_EDIT}><RichCell text={goal.objective} html={goal.html?.objective} minRows={2} className="font-semibold text-indigo-950" onChange={(t, h) => onGoal(goal.no, { objective: t, html: goalHtml(goal, "objective", h) })} /></td>
                  <td className={TD_LEADER_EDIT}><RichCell text={goal.criteria} html={goal.html?.criteria} minRows={2} onChange={(t, h) => onGoal(goal.no, { criteria: t, html: goalHtml(goal, "criteria", h) })} /></td>
                  {months.map((m) => <td key={m.id} className={`${TD} min-w-14 px-1 py-1 text-center`}>
                    <JudgmentDot cell={rolledCell(r?.byMonth[m.id])} label={`${m.month}월 CS 종합`} onClick={openMonth ? () => openMonth(m.id) : undefined} />
                  </td>)}
                  <td className={`${TD} p-0`}><RolledJudgmentCell value={r?.quarter || EMPTY_ROLLED} label={`${q}분기 종합`} onChange={onQuarterJudgment ? (v) => onQuarterJudgment(goal.no, v) : undefined} /></td>
                </tr>;
              })}
            </FragmentRows>)}
            {!goals.length && <tr><td colSpan={heads.length} className="border border-slate-200 p-8 text-center text-sm font-bold text-slate-400">분기 OKR이 없습니다 — [팀장 분기 OKR 붙여넣기] 또는 [3 × 3 빈 틀]</td></tr>}
          </tbody>
        </table>
      </div>
      {!hasText && goals.length > 0 && <div className="border-t border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-400">비어 있는 분기 OKR — 팀장 문서를 붙여 넣으면 9묶음이 한 번에 채워집니다</div>}
      {!rollup.months.length && goals.length > 0 && <div className="border-t border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-400">이 분기에 아직 월 기록이 없습니다 — 달 칸은 월 기록이 생기면 채워집니다</div>}
    </section>
  </div>;
}

// [n분기] + 파트 탭 — 그 파트 9목표 × 달마다 파트 월 종합(● 확정 / ○ 마지막 주차 제안) + 파트 분기 종합(마지막 기록 달, 자동·읽기 전용, 설계 D4)
export function QuarterTeamView({ team, rollup, quarter, goals, onPick, onOpenMonth, onPickMonthHead }: {
  team: OkrTeam; rollup: OkrQuarterRollup; quarter?: OkrCycle | null; goals?: OkrGoal[];
  onPick?: (monthId: string) => void;
  onOpenMonth?: (monthId: string, team: OkrTeam) => void;
  onPickMonthHead?: (monthId: string) => void;
}) {
  const base = goals?.length ? goals : goalsFromRollup(rollup);
  const runs = pillarRuns(base);
  const { q, months } = quarterMonths(quarter, rollup);
  const openCell = onPick || (onOpenMonth ? (id: string) => onOpenMonth(id, team) : undefined);
  const openHead = onPickMonthHead || openCell;
  const byNo = new Map(rollup.rows.map((r) => [r.no, r]));
  const MON0 = 3;
  const heads = ["", "병목현상", "목표", ...months.map((m) => `${m.month}월`), `${teamName(team)} 분기 종합`];
  const col = useColWidths("okr_cols_quarter_team_v1", [58, 220, 260, ...months.map(() => 72), 112]);
  const thClass = (i: number) => (i === 1 || i === 2 ? TH_LEADER : `${TH_READ} ${i >= MON0 ? "text-center" : ""}`);
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
      <span className="text-[12px] font-black text-slate-700">{teamName(team)} · {q ? `${q}분기` : "분기"}</span>
      <OkrLegend split={false} />
    </div>
    <div className="overflow-x-auto">
      <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
        <colgroup>{heads.map((h, i) => <col key={`${h}-${i}`} style={{ width: col.widths[i] }} />)}</colgroup>
        <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => {
          const mon = i >= MON0 && i < MON0 + months.length ? months[i - MON0] : null;
          return <th key={`${h}-${i}`} className={`relative ${thClass(i)}`}>
            {mon && openHead
              ? <button type="button" onClick={() => openHead(mon.id)} title={`${mon.month}월 ${teamName(team)} 열기`} className="hover:underline">{h}</button>
              : h}
            <ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} />
          </th>;
        })}</tr></thead>
        <tbody>
          {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
            <PillarBar idx={run.idx} colSpan={heads.length} editable={false} onPillar={() => undefined} onAdd={() => undefined} />
            {run.goals.map((goal) => {
              const cells = byNo.get(goal.no)?.byTeam[team];
              const quarterJ = cells?.quarter || "";
              return <tr key={goal.no}>
                <td className={`${TD_READ} text-[11px] font-bold text-slate-500`}>{shortBottleneck(base, goal.no)}</td>
                <td className={TD_LEADER}><div className="whitespace-pre-wrap px-2 py-1.5 text-[11px] leading-snug text-slate-700">{bottleneckText(goal.bottleneck) || <span className="text-slate-300">—</span>}</div></td>
                <td className={TD_LEADER}><div className="whitespace-pre-wrap px-2 py-1.5 font-semibold leading-snug text-indigo-950">{goal.objective || <span className="text-slate-300">—</span>}</div></td>
                {months.map((m) => <td key={m.id} className={`${TD} min-w-14 px-1 py-1 text-center`}>
                  <JudgmentDot cell={cells?.byMonth[m.id] || EMPTY_CELL} label={`${m.month}월 ${teamName(team)} 종합`} onClick={openCell ? () => openCell(m.id) : undefined} />
                </td>)}
                <td className={`${TD} px-1 py-1 text-center`}>
                  <JudgmentDot cell={quarterJ ? { judgment: quarterJ, source: "suggest" } : EMPTY_CELL} label={`${teamName(team)} 분기 종합(자동)`} />
                  {quarterJ && <div className="text-[10px] font-bold text-slate-400">자동 {quarterJ}</div>}
                </td>
              </tr>;
            })}
          </FragmentRows>)}
          {!base.length && <tr><td colSpan={heads.length} className="border border-slate-200 p-8 text-center text-sm font-bold text-slate-400">분기 OKR이 없습니다 — [통합집계] 탭에서 팀장 분기 OKR을 붙여 넣으세요</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
