import { useAuthorBook } from "./authors";
import type { ContactChangeFormState } from "./contactChange";

function Field({ label, value, onChange, multiline = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return <label className="block">
    <span className="text-xs font-black text-slate-500">{label}</span>
    {multiline
      ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={2} className="mt-1 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold leading-6 text-slate-700 outline-none focus:border-blue-300" />
      : <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-blue-300" />}
  </label>;
}

export default function ContactChangeForm({ form, setForm, author, setAuthor }: {
  form: ContactChangeFormState;
  setForm: (form: ContactChangeFormState) => void;
  author: string;
  setAuthor: (author: string) => void;
}) {
  const { authors } = useAuthorBook();
  const set = (key: keyof ContactChangeFormState, value: string) => setForm({ ...form, [key]: value });

  return <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div>
      <div className="text-sm font-black text-slate-950">담당자/주소 변경</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-slate-400">변경 전·후 정보를 작성하고 명함 사진이 있으면 하단 사진 버튼으로 첨부합니다.</div>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="업체명(본사/지점 등)" value={form.company} onChange={(value) => set("company", value)} />
      <label className="block">
        <span className="text-xs font-black text-slate-500">퍼스트전산직원</span>
        <select value={author} onChange={(event) => setAuthor(event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-blue-300">
          <option value="">선택</option>
          {authors.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <Field label="수도권지역" value={form.region} onChange={(value) => set("region", value)} />
      <Field label="구분" value={form.category} onChange={(value) => set("category", value)} />
      <Field label="등급" value={form.grade} onChange={(value) => set("grade", value)} />
      <Field label="사유" value={form.reason} onChange={(value) => set("reason", value)} />
    </div>
    <Field label="변경전" value={form.before} onChange={(value) => set("before", value)} multiline />
    <Field label="변경후" value={form.after} onChange={(value) => set("after", value)} multiline />
    <Field label="특이사항" value={form.notes} onChange={(value) => set("notes", value)} multiline />
  </div>;
}
