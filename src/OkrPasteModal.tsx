// 팀장 문서 붙여넣기(2026-10-20) — 팀장 OKR 글(카톡·한글 복사) 또는 엑셀 표 복사를 붙여 넣으면 9묶음으로 나눠 미리 보여 주고,
// [적용]을 눌러야 바뀐다. 바뀌는 칸만 노랗게. 덮기 직전 목표는 화면이 goals_prev 에 남긴다(직전 목표로 되돌리기).
import { useMemo, useState } from "react";
import FormModal from "./FormModal";
import { bottleneckText, parseOkrPaste, type OkrGoal, type OkrPasteResult } from "./okr";

export default function OkrPasteModal({ title, current, onApply, onClose }: { title: string; current: OkrGoal[]; onApply: (result: OkrPasteResult) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseOkrPaste(text) : null), [text]);
  const cell = (now: string, next: string) => {
    const changed = now.trim() !== next.trim();
    return <td className={`whitespace-pre-wrap border border-slate-200 px-2 py-1 align-top ${changed ? "bg-amber-100" : "text-slate-400"}`}>{next || <span className="text-slate-300">(빈칸)</span>}</td>;
  };
  return <FormModal wide="xl" title={title} subtitle="팀장 문서 글 또는 엑셀 표를 그대로 붙여 넣으세요" onClose={onClose}
    footer={<>
      <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">취소</button>
      <button type="button" disabled={!parsed?.goals.length} onClick={() => parsed && onApply(parsed)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700 disabled:opacity-40">적용</button>
    </>}>
    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={"★ 핵심방향 ★\nPillar 1. AI · 효율성 · 비용절감\n병목현상 1 …\n목표 1 …\n실행 1\n· …"} className="w-full rounded-lg border border-slate-300 p-3 text-[13px] outline-none focus:border-slate-500" />
    {parsed && <div className="space-y-2">
      {parsed.warnings.length > 0 && <ul className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {parsed.direction && <div className="rounded-lg border border-slate-200 p-2 text-[12px]"><div className="text-[11px] font-black text-slate-500">핵심방향</div><div className="whitespace-pre-wrap text-slate-800">{parsed.direction}</div></div>}
      {parsed.goals.length > 0 && <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12px]">
          <thead><tr className="text-[11px] font-bold text-slate-600">{["No", "병목현상", "목표", "달성기준(실행)"].map((h) => <th key={h} className="border border-slate-300 bg-slate-100 px-2 py-1 text-left">{h}</th>)}</tr></thead>
          <tbody>{parsed.goals.map((g) => {
            const now = current.find((x) => x.no === g.no);
            return <tr key={g.no}>
              <td className="border border-slate-200 px-2 py-1 align-top font-black text-slate-500">{g.no}</td>
              {cell(bottleneckText(now?.bottleneck || ""), g.bottleneck)}
              {cell(now?.objective || "", g.objective)}
              {g.criteria.trim() ? cell(now?.criteria || "", g.criteria) : <td className="border border-slate-200 px-2 py-1 align-top text-slate-300">(지금 것 유지)</td>}
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </div>}
  </FormModal>;
}
