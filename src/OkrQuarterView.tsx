// [n분기] 탭(2026-10-20, 2차 피드백 docs/tasks/okr-feedback-2.md 2-2·2-3) — 표 하나로:
// 9목표 × [병목현상·목표(남보라)·달성기준(실행)(노랑), 칸마다 바로 고침] + 10·11·12월 CS 종합 동그라미(누르면 그 달 통합집계) + 분기 종합(자동, 사람이 덮어쓰기).
// 3차(2026-10-21): 분기 화면은 통합집계 탭에서만 — 파트 탭(QuarterTeamView)은 지웠다(파트 탭을 누르면 OkrHub가 그 분기 지금 달의 [파트 종합]으로 보낸다). 범례 없음.
// 달 머리는 늘 세 달(monthsOfQuarter) — 월 행이 없는 달은 빈칸(—).
//
// props(OkrHub 연결용):
//   OkrQuarterView({ quarter, rollup, prevQuarter, onGoal, onPaste, onRestore, onCopyPrev, onTemplate,
//     rollup: OkrQuarterRollup,                                ← progress(OkrQuarterProgress) 대신. quarterRollup(quarter, monthCycles, monthReports, weekReportsByMonth)
//     onQuarterJudgment?: (no: number, judgment: string) => void,  ← 새로: 분기 종합 사람이 고름("" = 자동으로 되돌리기). 없으면 읽기 전용 점
//     onPickMonth?: (monthId: string) => void,                 ← 새로: 달 머리·달 동그라미 → 그 달 [통합집계]
//     onOpenMonth?: (monthId: string) => void,                 ← onPickMonth 와 같은 뜻
//     onPick?: (monthId: string, team: string) => void,        ← 예전 이름. 위 둘이 없으면 onPick(monthId, "all") 로 부른다
//     onFeedback?: (no: number, memo: string, memoHtml?: string) => void })  ← 새로(2026-10-21): "n분기 결과 및 다음 분기 개선계획" 칸(분기 행 feedback[no].memo). 없으면 읽기
// 표 끝 두 열(월 통합집계와 같은 꼴): "조치·확인 필요 달"(월 CS 종합이 미흡·미착수인 달, alertMonths) · "n분기 결과 및 다음 분기 개선계획".
import RichCell from "./RichCell";
import { tableCellClick } from "./cellNav";
import {
  alertMonths, bottleneckText, monthsOfQuarter, parseQuarterId, quarterOf,
  type OkrCycle, type OkrGoal, type OkrJudgedCell, type OkrQuarterRollup, type OkrRolledJudgment,
} from "./okr";
import { FragmentRows, JudgmentDot, PillarBar, ResizeHandle } from "./OkrCells";
import { RolledJudgmentCell } from "./OkrMonthRollup";
import { TD, TD_LEADER_EDIT, TD_READ, TD_WRITE, TH_LEADER, TH_READ, TH_WRITE, goalHtml, pillarRuns, shortBottleneck, useColWidths } from "./okrUi";

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

export default function OkrQuarterView({ quarter, rollup, prevQuarter, onGoal, onPaste, onRestore, onCopyPrev, onTemplate, onQuarterJudgment, onPickMonth, onOpenMonth, onPick, onFeedback }: {
  quarter: OkrCycle; rollup: OkrQuarterRollup; prevQuarter: OkrCycle | null;
  onGoal: (no: number, patch: Partial<OkrGoal>) => void; onPaste: () => void; onRestore: () => void; onCopyPrev: () => void; onTemplate: () => void;
  onQuarterJudgment?: (no: number, judgment: string) => void;
  onPickMonth?: (monthId: string) => void;
  onOpenMonth?: (monthId: string) => void;
  onPick?: (monthId: string, team: string) => void;
  onFeedback?: (no: number, memo: string, memoHtml?: string) => void;
}) {
  const goals = quarter.goals;
  const runs = pillarRuns(goals);
  const hasText = goals.some((g) => bottleneckText(g.bottleneck) || g.objective.trim() || g.criteria.trim());
  const { q, months } = quarterMonths(quarter, rollup);
  const openMonth = onPickMonth || onOpenMonth || (onPick ? (id: string) => onPick(id, "all") : undefined);
  const byNo = new Map(rollup.rows.map((r) => [r.no, r]));
  const MON0 = 4; // 첫 달 열 위치(그 뒤 분기 종합까지 가운데 정렬)
  const heads = ["", "병목현상", "목표", "달성기준(실행)", ...months.map((m) => `${m.month}월`), `${q}분기 종합`, "조치·확인 필요 달", `${q}분기 결과 및 다음 분기 개선계획`];
  const col = useColWidths("okr_cols_quarter_v3", [58, 220, 260, 280, ...months.map(() => 72), 112, 120, 320]);
  const QSUM = MON0 + months.length; // 분기 종합 열 위치(가운데 정렬은 여기까지)
  const thClass = (i: number) => (i === 1 || i === 2 ? TH_LEADER : i === 3 || i === heads.length - 1 ? TH_WRITE : `${TH_READ} ${i >= MON0 && i <= QSUM ? "text-center" : ""}`); // 색은 병목현상·목표만, 달성기준·개선계획은 노랑(3차)
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
                const alerts = alertMonths(r?.byMonth, months);
                const fb = quarter.feedback?.[String(goal.no)];
                return <tr key={goal.no}>
                  <td className={`${TD_READ} text-[11px] font-bold text-slate-500`}>{shortBottleneck(goals, goal.no)}</td>
                  <td className={TD_LEADER_EDIT}><RichCell colors={false} text={bottleneckText(goal.bottleneck)} minRows={2} onChange={(t) => onGoal(goal.no, { bottleneck: t })} /></td>
                  <td className={TD_LEADER_EDIT}><RichCell text={goal.objective} html={goal.html?.objective} minRows={2} className="font-semibold text-indigo-950" onChange={(t, h) => onGoal(goal.no, { objective: t, html: goalHtml(goal, "objective", h) })} /></td>
                  <td className={TD_WRITE}><RichCell text={goal.criteria} html={goal.html?.criteria} minRows={2} onChange={(t, h) => onGoal(goal.no, { criteria: t, html: goalHtml(goal, "criteria", h) })} /></td>
                  {months.map((m) => <td key={m.id} className={`${TD} min-w-14 px-1 py-1 text-center`}>
                    <JudgmentDot cell={rolledCell(r?.byMonth[m.id])} label={`${m.month}월 CS 종합`} onClick={openMonth ? () => openMonth(m.id) : undefined} />
                  </td>)}
                  <td className={`${TD} p-0`}><RolledJudgmentCell value={r?.quarter || EMPTY_ROLLED} label={`${q}분기 종합`} onChange={onQuarterJudgment ? (v) => onQuarterJudgment(goal.no, v) : undefined} /></td>
                  <td className={`${TD_READ} text-[11px] leading-snug`}>{alerts.length ? <span className="font-black text-rose-600">{alerts.join(", ")}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className={onFeedback ? TD_WRITE : TD_READ}>{onFeedback
                    ? <RichCell text={fb?.memo || ""} html={fb?.memoHtml} minRows={2} onChange={(t, h) => onFeedback(goal.no, t, h)} />
                    : <div className="whitespace-pre-wrap leading-snug text-slate-600">{fb?.memo || ""}</div>}</td>
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
