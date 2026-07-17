import { useState } from "react";
import { AUTHOR_BOOK, AUTHOR_TEAMS } from "./authors";
import type { AuthorTeam } from "./authors";
import type { LogisticsFormState } from "./api";
const categories = ["납품", "교체", "철수", "이전", "셋팅(세팅)", "이전세팅", "기타"];

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><input value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400"/></label>;
}
function Choice({ label, value, onChange, values }: { label: string; value: string; onChange: (v: string) => void; values: string[] }) {
  return <div><div className="text-xs font-semibold text-slate-500">{label}</div><div className="mt-1 flex flex-wrap gap-1.5">{values.map((v)=><button type="button" key={v} onClick={()=>onChange(v)} className={`rounded-lg px-3 py-2 text-xs font-bold ${value===v?"bg-slate-700 text-white":"border border-slate-200 bg-white text-slate-500"}`}>{v}</button>)}</div></div>;
}

function LogisticsAuthorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<AuthorTeam>("팀장");
  return <><button type="button" onClick={()=>setOpen(true)} className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-left text-sm font-semibold text-slate-700"><span>{value || "작성자 선택"}</span><span className="text-xs text-slate-400">▾</span></button>{open&&<div className="fixed inset-0 z-[90] flex items-end bg-black/40" onClick={()=>setOpen(false)}><div className="w-full rounded-t-2xl bg-white shadow-2xl" onClick={(e)=>e.stopPropagation()}><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><b className="text-sm text-slate-700">작성자 선택</b><button onClick={()=>setOpen(false)} className="text-xs text-slate-500">닫기</button></div><div className="grid grid-cols-5 gap-1 border-b border-slate-100 p-3">{AUTHOR_TEAMS.map((t)=><button type="button" key={t} onClick={()=>setTeam(t)} className={`rounded-lg py-2 text-xs font-bold ${team===t?"bg-slate-700 text-white":"bg-slate-100 text-slate-500"}`}>{t==="팀장"?t:`${t}팀`}</button>)}</div><div className="max-h-[50vh] overflow-y-auto pb-5">{AUTHOR_BOOK[team].map((name)=><button type="button" key={name} onClick={()=>{onChange(name);setOpen(false);}} className={`block w-full border-b border-slate-50 px-5 py-3 text-left text-sm ${value===name?"bg-slate-50 font-bold text-slate-900":"text-slate-600"}`}>{name}</button>)}</div></div></div>}</>;
}

export default function LogisticsForm({ form, setForm, author, setAuthor }: { form: LogisticsFormState; setForm: (f: LogisticsFormState) => void; author: string; setAuthor: (a: string) => void }) {
  const [hanjoDirect, setHanjoDirect] = useState(false);
  const set = (key: keyof LogisticsFormState, value: string) => setForm({ ...form, [key]: value });
  return <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">작성자</span><LogisticsAuthorPicker value={author} onChange={setAuthor}/></label>
    <div><div className="text-xs font-semibold text-slate-500">구분</div><div className="mt-1 grid grid-cols-4 gap-1.5">{categories.map((c)=><button type="button" key={c} onClick={()=>set("category",c)} className={`rounded-xl px-2 py-2.5 text-xs font-bold ${form.category===c?"bg-slate-700 text-white":"border border-slate-200 bg-white text-slate-500"}`}>{c}</button>)}</div>{form.category==="기타"&&<input value={form.categoryOther} onChange={(e)=>set("categoryOther",e.target.value)} placeholder="구분 직접입력" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"/>}</div>
    <TextField label="거래처명 (지점/현장명 필수)" value={form.vendor} onChange={(v)=>set("vendor",v)} placeholder="업체명과 지점/현장명"/>
    <div className="grid grid-cols-2 gap-3"><TextField label="품목" value={form.item} onChange={(v)=>set("item",v)}/><TextField label="수량" value={form.quantity} onChange={(v)=>set("quantity",v)}/></div>
    <Choice label="소모품 (납품/청구여부)" value={form.consumableBilling} onChange={(v)=>set("consumableBilling",v)} values={["납품", "청구", "해당없음"]}/>
    <Choice label="셋팅 여부" value={form.setup} onChange={(v)=>set("setup",v)} values={["완료", "미완료", "해당없음"]}/>
    <div className="grid gap-3 sm:grid-cols-2"><Choice label="이메일카운터 셋팅" value={form.emailCounter} onChange={(v)=>set("emailCounter",v)} values={["완료", "미완료", "해당없음"]}/><div><div className="text-xs font-semibold text-slate-500">한조 셋팅</div><div className="mt-1 flex flex-wrap gap-1.5">{["한조","모바일한조","한조공유기","설치불가","직접입력"].map((v)=><button type="button" key={v} onClick={()=>{if(v==="직접입력"){setHanjoDirect(true);set("hanjo","");}else{setHanjoDirect(false);set("hanjo",v);}}} className={`rounded-lg px-3 py-2 text-xs font-bold ${(v==="직접입력"?hanjoDirect:form.hanjo===v)?"bg-slate-700 text-white":"border border-slate-200 bg-white text-slate-500"}`}>{v}</button>)}</div>{hanjoDirect&&<input value={form.hanjo} onChange={(e)=>set("hanjo",e.target.value)} placeholder="한조 셋팅 직접입력" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"/>}</div></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Choice label="상태체크" value={form.condition} onChange={(v)=>set("condition",v)} values={["내부", "외부", "내부+외부", "이상없음"]}/>
      <Choice label="여분토너체크 (철수 시)" value={form.spareToner} onChange={(v)=>set("spareToner",v)} values={["회수완료", "현장보관", "없음", "확인필요", "해당없음"]}/>
    </div>
    <label className="block"><span className="text-xs font-semibold text-slate-500">특이사항</span><textarea value={form.notes} onChange={(e)=>set("notes",e.target.value)} rows={4} className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm"/></label>
  </div>;
}
