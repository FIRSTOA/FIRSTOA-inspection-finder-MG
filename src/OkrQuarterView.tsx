// [n분기] 탭(2026-10-20) — 팀장 분기 OKR 표(Pillar 3 × 병목 3: 병목현상·목표·달성기준(실행), 칸마다 바로 고침)
// + 분기 진행 표(묶음 × 달 × A~D 파트 종합판정, okr.ts quarterProgress). 판정 칸을 누르면 그 달·그 파트로 간다.
import RichCell from "./RichCell";
import { tableCellClick } from "./cellNav";
import { OKR_TEAMS, bottleneckText, type OkrCycle, type OkrGoal, type OkrQuarterProgress } from "./okr";
import { FragmentRows, JudgmentBadge, PillarBar, ResizeHandle } from "./OkrCells";
import { TD_EDIT, TD_FIXED_EDIT, TD_READ, TH_READ, goalHtml, pillarRuns, shortBottleneck, useColWidths } from "./okrUi";

const BTN = "rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-100";

export default function OkrQuarterView({ quarter, progress, prevQuarter, onGoal, onPaste, onRestore, onCopyPrev, onTemplate, onPick }: {
  quarter: OkrCycle; progress: OkrQuarterProgress; prevQuarter: OkrCycle | null;
  onGoal: (no: number, patch: Partial<OkrGoal>) => void; onPaste: () => void; onRestore: () => void; onCopyPrev: () => void; onTemplate: () => void;
  onPick: (monthId: string, team: string) => void;
}) {
  const goals = quarter.goals;
  const runs = pillarRuns(goals);
  const hasText = goals.some((g) => bottleneckText(g.bottleneck) || g.objective.trim() || g.criteria.trim());
  const col = useColWidths("okr_cols_quarter_v1", [70, 260, 280, 380]);
  const heads = ["", "병목현상", "목표", "달성기준(실행)"];
  return <div className="space-y-3">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-[12px] font-black text-slate-700">{quarter.title || "분기 OKR"}</span>
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
          <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={`relative ${TH_READ}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
          <tbody>
            {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
              <PillarBar idx={run.idx} colSpan={heads.length} editable={false} onPillar={() => undefined} onAdd={() => undefined} />
              {run.goals.map((goal) => <tr key={goal.no}>
                <td className={`${TD_READ} text-[11px] font-bold text-slate-500`}>{shortBottleneck(goals, goal.no)}</td>
                <td className={TD_EDIT}><RichCell colors={false} text={bottleneckText(goal.bottleneck)} minRows={2} onChange={(t) => onGoal(goal.no, { bottleneck: t })} /></td>
                <td className={TD_FIXED_EDIT}><RichCell text={goal.objective} html={goal.html?.objective} minRows={2} className="font-semibold text-sky-950" onChange={(t, h) => onGoal(goal.no, { objective: t, html: goalHtml(goal, "objective", h) })} /></td>
                <td className={TD_EDIT}><RichCell text={goal.criteria} html={goal.html?.criteria} minRows={2} onChange={(t, h) => onGoal(goal.no, { criteria: t, html: goalHtml(goal, "criteria", h) })} /></td>
              </tr>)}
            </FragmentRows>)}
            {!goals.length && <tr><td colSpan={heads.length} className="border border-slate-200 p-8 text-center text-sm font-bold text-slate-400">분기 OKR이 없습니다 — [팀장 분기 OKR 붙여넣기] 또는 [3 × 3 빈 틀]</td></tr>}
          </tbody>
        </table>
      </div>
      {!hasText && goals.length > 0 && <div className="border-t border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-400">비어 있는 분기 OKR — 팀장 문서를 붙여 넣으면 9묶음이 한 번에 채워집니다</div>}
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-3 py-1.5 text-[12px] font-black text-slate-700">분기 진행 — 달마다 파트 종합판정</div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-left text-[12px]" style={{ minWidth: 340 + progress.months.length * 4 * 56 }}>
          <thead className="text-[11px] font-bold">
            <tr>
              <th rowSpan={2} className={`${TH_READ} w-[64px]`} />
              <th rowSpan={2} className={`${TH_READ} min-w-[260px]`}>목표</th>
              {progress.months.map((m) => <th key={m.id} colSpan={OKR_TEAMS.length} className={`${TH_READ} text-center`}>{m.month}월{m.actionTeams > 0 && <span className="ml-1 text-rose-600">조치 {m.actionTeams}</span>}</th>)}
            </tr>
            <tr>{progress.months.flatMap((m) => OKR_TEAMS.map((t) => <th key={`${m.id}-${t}`} className={`${TH_READ} w-[56px] text-center`}>{t}</th>))}</tr>
          </thead>
          <tbody>
            {progress.rows.map((r) => <tr key={r.no}>
              <td className={`${TD_READ} text-[11px] font-bold text-slate-500`}>{shortBottleneck(goals.length ? goals : progress.rows.map((x) => ({ no: x.no, pillar: x.pillar, bottleneck: "", objective: "", criteria: "" })), r.no)}</td>
              <td className={`${TD_READ} whitespace-pre-wrap leading-snug text-slate-800`}>{r.objective || <span className="text-slate-300">—</span>}</td>
              {progress.months.flatMap((m) => OKR_TEAMS.map((t) => <td key={`${m.id}-${t}`} className={`${TD_READ} px-1 text-center`}>
                <button type="button" title={`${m.month}월 ${t}파트 열기`} onClick={() => onPick(m.id, t)}><JudgmentBadge value={r.cells[m.id]?.[t] || ""} /></button>
              </td>))}
            </tr>)}
            {!progress.months.length && <tr><td colSpan={2} className="border border-slate-200 p-6 text-center text-[12px] font-bold text-slate-400">이 분기에 아직 월 기록이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
