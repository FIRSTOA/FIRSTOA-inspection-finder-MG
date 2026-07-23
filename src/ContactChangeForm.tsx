import { useAuthorBook } from "./authors";
import type { ContactChangeFormState } from "./contactChange";

type Keyman = { label: string; name: string; phone: string };
type LoadResult = { grade: string; company: string; region: string; keymen: Keyman[]; author: string };

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

export default function ContactChangeForm({ form, setForm, author, setAuthor, onLoad, onError }: {
  form: ContactChangeFormState;
  setForm: (form: ContactChangeFormState) => void;
  author: string;
  setAuthor: (author: string) => void;
  onLoad: (source: "inspection" | "as") => LoadResult | null;
  onError: (message: string) => void;
}) {
  const { authors } = useAuthorBook();
  const set = (key: keyof ContactChangeFormState, value: string) => setForm({ ...form, [key]: value });
  const handleLoad = (source: "inspection" | "as") => {
    const loaded = onLoad(source);
    if (!loaded) {
      onError(`${source === "inspection" ? "점검" : "AS"} 탭에 입력된 내용이 없어요`);
      return;
    }
    if (loaded.author) setAuthor(loaded.author);
    setForm({
      ...form,
      company: loaded.company || form.company,
      region: loaded.region || form.region,
      grade: loaded.grade || form.grade,
      before: loaded.keymen.length ? loaded.keymen.map((keyman) => keyman.label).join("\n") : form.before,
    });
  };

  return <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div>
      <div className="text-sm font-black text-slate-950">담당자/주소 변경</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-slate-400">변경 전·후 정보를 작성하고 명함 사진이 있으면 하단 사진 버튼으로 첨부합니다.</div>
    </div>
    <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
      <span className="text-xs font-black text-slate-500">불러오기</span>
      <button type="button" onClick={() => handleLoad("inspection")} className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 shadow-sm">점검</button>
      <button type="button" onClick={() => handleLoad("as")} className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 shadow-sm">AS</button>
      <span className="ml-auto text-[10px] font-bold text-slate-400">업체·지역·등급·기존 담당자</span>
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
