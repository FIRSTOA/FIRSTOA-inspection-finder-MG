/**
 * 점검·AS 양식 여분 칸 — K/C/M/Y/폐/드럼 ＋/− 와 보관 위치. App.tsx에서 글자 그대로 옮겨 왔다(2026-10-24, docs/tasks/field-form-tidy.md S2).
 */
import { SPARE_TOKENS, changeSpareStorageLocation, changeSpareToken, spareStorageLocation, spareTokenCount } from "./fieldFormModel";

export function SpareQuickEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div>
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">{SPARE_TOKENS.map((token) => { const count = spareTokenCount(value, token); return <div key={token} className="rounded-xl border border-slate-200 bg-white p-1.5"><div className="text-center text-[10px] font-bold text-slate-500">{token}</div><div className="mt-1 grid grid-cols-3 items-center"><button type="button" onClick={()=>onChange(changeSpareToken(value,token,-1))} className="rounded bg-slate-100 py-1 text-xs text-slate-500">−</button><span className="text-center text-sm font-bold text-slate-700">{count ?? "-"}</span><button type="button" onClick={()=>onChange(changeSpareToken(value,token,1))} className="rounded bg-slate-700 py-1 text-xs text-white">＋</button></div></div>; })}</div>
    <input value={spareStorageLocation(value)} onChange={(e)=>onChange(changeSpareStorageLocation(value,e.target.value))} placeholder="여분 보관 위치 (예: 3층 창고 안쪽)" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold outline-none focus:border-slate-400" />
    <textarea value={value} onChange={(e)=>onChange(e.target.value)} rows={3} placeholder="예: K1 C1 M1 Y1 폐1" className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white p-2 font-mono text-xs leading-5 outline-none focus:border-slate-400" />
    <div className="mt-1 text-[10px] text-slate-400">K-2·토너1세트·CMY1개씩도 인식하며, 보관 위치는 점검기록과 워킨맵에 함께 남습니다.</div>
  </div>;
}
