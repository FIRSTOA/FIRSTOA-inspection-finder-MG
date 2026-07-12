import { AUTHOR_BOOK, AUTHOR_TEAMS } from "./authors";
import type { LogisticsFormState } from "./api";
const categories = ["납품", "교체", "철수", "이전", "셋팅(세팅)", "이전세팅", "기타"];
const authors = AUTHOR_TEAMS.flatMap((t) => AUTHOR_BOOK[t]);

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><input value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400"/></label>;
}
function Choice({ label, value, onChange, values }: { label: string; value: string; onChange: (v: string) => void; values: string[] }) {
  return <div><div className="text-xs font-semibold text-slate-500">{label}</div><div className="mt-1 flex flex-wrap gap-1.5">{values.map((v)=><button type="button" key={v} onClick={()=>onChange(v)} className={`rounded-lg px-3 py-2 text-xs font-bold ${value===v?"bg-slate-700 text-white":"border border-slate-200 bg-white text-slate-500"}`}>{v}</button>)}</div></div>;
}

export default function LogisticsForm({ form, setForm, author, setAuthor }: { form: LogisticsFormState; setForm: (f: LogisticsFormState) => void; author: string; setAuthor: (a: string) => void }) {
  const set = (key: keyof LogisticsFormState, value: string) => setForm({ ...form, [key]: value });
  return <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div><div className="text-base font-bold text-slate-800">📦 물류 업무</div><div className="text-xs text-slate-400">납품·교체·철수·이전·세팅을 기록하고 물류방에 전송합니다.</div></div>
    <label className="block"><span className="text-xs font-semibold text-slate-500">작성자</span><select value={author} onChange={(e)=>setAuthor(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">선택</option>{authors.map((a)=><option key={a}>{a}</option>)}</select></label>
    <div><div className="text-xs font-semibold text-slate-500">구분</div><div className="mt-1 grid grid-cols-4 gap-1.5">{categories.map((c)=><button type="button" key={c} onClick={()=>set("category",c)} className={`rounded-xl px-2 py-2.5 text-xs font-bold ${form.category===c?"bg-slate-700 text-white":"border border-slate-200 bg-white text-slate-500"}`}>{c}</button>)}</div>{form.category==="기타"&&<input value={form.categoryOther} onChange={(e)=>set("categoryOther",e.target.value)} placeholder="구분 직접입력" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"/>}</div>
    <TextField label="거래처명 (지점/현장명 필수)" value={form.vendor} onChange={(v)=>set("vendor",v)} placeholder="업체명과 지점/현장명"/>
    <div className="grid grid-cols-2 gap-3"><TextField label="품목" value={form.item} onChange={(v)=>set("item",v)}/><TextField label="수량" value={form.quantity} onChange={(v)=>set("quantity",v)}/></div>
    <Choice label="소모품 (납품/청구여부)" value={form.consumableBilling} onChange={(v)=>set("consumableBilling",v)} values={["납품", "청구", "해당없음"]}/>
    <Choice label="셋팅 여부" value={form.setup} onChange={(v)=>set("setup",v)} values={["완료", "미완료", "해당없음"]}/>
    <div className="grid gap-3 sm:grid-cols-2"><Choice label="이메일카운터 셋팅" value={form.emailCounter} onChange={(v)=>set("emailCounter",v)} values={["완료", "미완료", "해당없음"]}/><Choice label="한조 셋팅" value={form.hanjo} onChange={(v)=>set("hanjo",v)} values={["완료", "미완료", "해당없음"]}/></div>
    <div className="grid gap-3 sm:grid-cols-2"><Choice label="상태체크" value={form.condition} onChange={(v)=>set("condition",v)} values={["내부", "외부", "내부+외부"]}/><Choice label="여분토너체크 (철수 시)" value={form.spareToner} onChange={(v)=>set("spareToner",v)} values={["완료", "미완료", "해당없음"]}/></div>
    <label className="block"><span className="text-xs font-semibold text-slate-500">특이사항</span><textarea value={form.notes} onChange={(e)=>set("notes",e.target.value)} rows={4} className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm"/></label>
  </div>;
}
