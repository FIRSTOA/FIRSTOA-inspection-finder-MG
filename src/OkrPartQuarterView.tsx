// 파트 탭 [n분기] 화면(2026-11-01, docs/tasks/okr-part-quarter-2026-11-01.md 후보 ② · 목업 윤화면 okr-part-quarter-mockup.html)
// "C파트 › 4분기" — 표 = 병목현상 | 목표 | 달성기준 | 분기 실제결과 | 사유 | 다음 분기 개선계획 | 근거자료(통합집계·월 파트 종합과 같은 모양).
//   병목현상·목표 = 팀장 분기 글(남보라 읽기), 달성기준 = 파트가 분기용으로 고쳐 씀(남보라 편집 칸, header.goals putGoalField criteria, 층별 독립 — OkrHub onCriteria),
//   뒤 넷 = 노란 입력 칸(월 파트 종합과 같은 빈 칸, 안내 글 없음). 분기 실제결과는 한 칸 — 파트가 알아서 달을 나눠 적는다.
// 같은 날 사용자 피드백("더 헷갈릴 것 같아")으로 달 판정 점 3열·분기 종합 판정 열·달별 진행 띠는 뺐다(달 이동은 상단 칩 [10월][11월][12월]).
// 저장 위치 = okr_reports(cycle_id 분기 id, team, member '') — OkrHub 의 updateResult·patchReport 그대로(열린 기간 id = 분기 id).
// 통합집계 [4분기] 표(OkrQuarterView)·셈법은 건드리지 않는다(사용자 Q2 = (가) 통합집계 불변).
import RichCell from "./RichCell";
import { tableCellClick } from "./cellNav";
import { FragmentRows, PillarBar, ResizeHandle } from "./OkrCells";
import {
  bottleneckText, emptyResultRow, overlayGoals, parseQuarterId, quarterOf, resultRowFor, visibleGoals,
  type OkrCycle, type OkrReport, type OkrResultRow, type OkrTeam, type RichField,
} from "./okr";
import { TD_LEADER, TD_LEADER_EDIT, TD_WRITE, TH_LEADER, TH_WRITE, pillarRuns, teamName, useColWidths, withHtml } from "./okrUi";

// 열 폭: 병목현상 160 · 목표 200 · 달성기준 200 · 분기 실제결과 220 · 사유 150 · 다음 분기 개선계획 160 · 근거자료(마지막, 남는 폭)
const WIDTHS = [160, 200, 200, 220, 150, 160, 120];
const NCOLS = WIDTHS.length;

export default function OkrPartQuarterView({ team, quarter, report, error, onRetry, onResult, onCriteria }: {
  team: OkrTeam;
  quarter: OkrCycle; // 분기 행(팀장 분기 목표)
  report: OkrReport | null; // 그 파트 분기 기록(cycle_id 분기 id, member '') — 없으면 null(적는 순간 생긴다)
  error?: string; // 분기 기록을 못 읽었을 때
  onRetry?: () => void;
  onResult: (no: number, patch: Partial<OkrResultRow>) => void;
  onCriteria: (no: number, text: string, html?: string) => void;
}) {
  const col = useColWidths("okr_cols_partq_v1", WIDTHS);
  const pq = parseQuarterId(quarter.id);
  const q = pq?.quarter ?? quarterOf(quarter.month);
  const part = teamName(team);
  const goals = overlayGoals(visibleGoals(quarter.goals), report?.goals); // 달성기준만 파트 분기 층이 덮는다(병목현상·목표는 팀장 글)
  const runs = pillarRuns(goals);

  if (error) return <div className="border-t border-rose-200 bg-rose-50 p-4 text-[12px] text-rose-700">
    <div className="text-[11px] font-black">오류</div>
    <p className="mt-1 font-semibold">분기 기록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.</p>
    <p className="mt-1 break-all text-[11px] text-rose-500">{error}</p>
    {onRetry && <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-full border border-rose-300 bg-white px-4 text-[12px] font-black text-rose-700 hover:bg-rose-100">다시 불러오기</button>}
  </div>;

  const rich = (no: number, row: OkrResultRow, field: RichField) =>
    <RichCell text={row[field]} html={row.html?.[field]} minRows={3} onChange={(t, h) => onResult(no, { [field]: t, html: withHtml(row, field, h) })} />;
  const heads: Array<[string, string]> = [
    ["병목현상", TH_LEADER], ["목표", TH_LEADER], ["달성기준", TH_LEADER],
    [`${q}분기 실제결과`, TH_WRITE], ["사유", TH_WRITE], ["다음 분기 개선계획", TH_WRITE], ["근거자료", TH_WRITE],
  ];

  return <div>
    <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-600 sm:hidden">↔ 표는 옆으로 밀어서 봅니다 (병목현상·목표가 먼저 보입니다)</div>
    <div className="overflow-x-auto border-t border-slate-200">
      <table onClick={tableCellClick} className="table-fixed border-collapse text-left text-[12px]" style={{ width: "100%", minWidth: col.total }}>
        <colgroup>{WIDTHS.map((_, i) => <col key={i} style={col.colStyle(i)} />)}</colgroup>
        <thead className="text-[11px] font-bold">
          <tr>{heads.map(([h, cls], i) => <th key={h} className={`relative ${cls}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr>
        </thead>
        <tbody>
          {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
            <PillarBar idx={run.idx} colSpan={NCOLS} editable={false} onPillar={() => undefined} />
            {run.goals.map((goal) => {
              const row = report ? resultRowFor(report, goal.no) : emptyResultRow(goal.no);
              return <tr key={goal.no}>
                <td className={TD_LEADER}><RichCell readOnly text={bottleneckText(goal.bottleneck)} html={goal.html?.bottleneck} minRows={2} className="font-bold text-slate-800" /></td>
                <td className={TD_LEADER}><RichCell readOnly text={goal.objective} html={goal.html?.objective} minRows={2} className="font-semibold text-indigo-950" /></td>
                <td className={TD_LEADER_EDIT}><RichCell text={goal.criteria} html={goal.html?.criteria} minRows={2} onChange={(t, h) => onCriteria(goal.no, t, h)} /></td>
                <td className={TD_WRITE}>{rich(goal.no, row, "actual")}</td>
                <td className={TD_WRITE}>{rich(goal.no, row, "reason")}</td>
                <td className={TD_WRITE}>{rich(goal.no, row, "plan")}</td>
                <td className={TD_WRITE}>{rich(goal.no, row, "evidence")}</td>
              </tr>;
            })}
          </FragmentRows>)}
          {!goals.length && <tr><td colSpan={NCOLS} className="border border-slate-200 p-8 text-center text-sm font-bold text-slate-400">분기 OKR이 없습니다 — 통합집계 [{q}분기]에 목표가 적히면 여기에 보입니다</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="border-t border-slate-100 px-4 py-2.5 text-[11px] font-semibold leading-relaxed text-slate-500">
      <p>병목현상·목표는 팀장 글(통합집계)을 그대로 보여줍니다. 달성기준은 {part} 분기용으로 고쳐 적을 수 있고, 비우면 팀장 달성기준이 보입니다.</p>
    </div>
  </div>;
}
