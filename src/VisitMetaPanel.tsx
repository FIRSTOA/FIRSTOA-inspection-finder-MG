import type { VisitDraft, WorkKind } from "./visits";
import { WORK_LABELS } from "./visits";

const CORE: WorkKind[] = ["inspection", "as", "delivery", "etc", "pc", "misu", "bulman", "recontract", "overage"];

export default function VisitMetaPanel({ value, onChange, primaryKind }: { value: VisitDraft; onChange: (v: VisitDraft) => void; primaryKind: WorkKind }) {
  const set = <K extends keyof VisitDraft>(key: K, v: VisitDraft[K]) => onChange({ ...value, [key]: v });
  const setMin = (key: WorkKind, v: string) => {
    const n = Math.max(0, Number(v) || 0);
    onChange({ ...value, workKinds: n > 0 && !value.workKinds.includes(key) ? [...value.workKinds, key] : value.workKinds, minutes: { ...value.minutes, [key]: n } });
  };
  const toggle = (key: WorkKind) => onChange({ ...value, workKinds: value.workKinds.includes(key) ? value.workKinds.filter((k) => k !== key) : [...value.workKinds, key] });
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <div><div className="text-sm font-bold text-slate-800">📊 방문 집계</div><div className="text-[11px] text-slate-400">일일업무·주간현황에 자동 반영</div></div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={value.visited} onChange={(e) => set("visited", e.target.checked)} /> 실제 방문</label>
      </div>
      {value.visited && <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">기기 대수<input type="number" min="0" value={value.machineCount || ""} onChange={(e) => set("machineCount", Number(e.target.value) || 0)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-500">도착 시간<input type="time" value={value.arrivalTime} onChange={(e) => set("arrivalTime", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">거래처 등급<input value={value.grade} onChange={(e) => set("grade", e.target.value.toUpperCase())} placeholder="N, S, SS, V" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
          <label className="flex items-end gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={value.contractEnded} onChange={(e) => set("contractEnded", e.target.checked)} /> 계약종료 확인</label>
        </div>
        <div><div className="mb-1 text-xs font-semibold text-slate-500">업무별 소요시간(분)</div><div className="grid grid-cols-3 gap-2">
          {CORE.map((k) => <label key={k} className="text-[10px] text-slate-500"><span className="flex items-center gap-1"><input type="checkbox" checked={k === primaryKind || value.workKinds.includes(k)} disabled={k === primaryKind} onChange={() => toggle(k)} />{WORK_LABELS[k]}</span><input type="number" min="0" value={value.minutes[k] || ""} onChange={(e) => setMin(k, e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" /></label>)}
        </div></div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">IT 영업<select value={value.salesIt} onChange={(e) => set("salesIt", e.target.value as VisitDraft["salesIt"])} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"><option value="">없음</option><option>1차</option><option>2차</option></select></label>
          <label className="text-xs text-slate-500">복합기 영업<select value={value.salesCopier} onChange={(e) => set("salesCopier", e.target.value as VisitDraft["salesCopier"])} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"><option value="">없음</option><option>1차</option><option>2차</option></select></label>
        </div>
        <div><div className="mb-1 text-xs font-semibold text-slate-500">마지막 일정이면 선택</div><div className="grid grid-cols-3 gap-2">
          {(["", "귀사", "직퇴"] as const).map((v) => <button type="button" key={v || "none"} onClick={() => set("commute", v)} className={`rounded-lg py-2 text-xs font-bold ${value.commute === v ? "bg-slate-700 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>{v || "해당없음"}</button>)}
        </div></div>
        <label className="block text-xs text-slate-500">메모<input value={value.note} onChange={(e) => set("note", e.target.value)} placeholder="배송·마감 등" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      </div>}
    </div>
  );
}
