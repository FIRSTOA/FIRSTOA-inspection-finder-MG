const options = ["점검", "AS", "마감", "여분", "세팅", "기타"];

export default function ReportTypeSelector({ selected, other, onSelected, onOther }: { selected: string[]; other: string; onSelected: (v: string[]) => void; onOther: (v: string) => void }) {
  const toggle = (v: string) => onSelected(selected.includes(v) ? selected.filter((x)=>x!==v) : [...selected,v]);
  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="text-sm font-bold text-slate-800">구분 <span className="ml-1 text-[11px] font-normal text-slate-400">중복 선택 가능</span></div><div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">{options.map((v)=><button type="button" key={v} onClick={()=>toggle(v)} className={`rounded-xl py-2.5 text-xs font-bold ${selected.includes(v)?"bg-slate-700 text-white":"border border-slate-200 bg-white text-slate-500"}`}>{v}</button>)}</div>{selected.includes("기타")&&<input value={other} onChange={(e)=>onOther(e.target.value)} placeholder="기타 구분 직접입력" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"/>}</div>;
}
