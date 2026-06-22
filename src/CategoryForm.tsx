/** 스키마 기반 카톡 카테고리 입력 폼 (불만/재계약/초과조정 공용).
 *  - [점검/AS 불러오기]: 작성자·업체명·지역·키맨 가져옴(키맨 다중→드롭다운).
 *  - 작성자는 author 상태 사용. 나머지는 form 상태.
 */
import { useState } from "react";
import { AUTHOR_TEAMS, AUTHOR_BOOK } from "./authors";
import { CATEGORY_SCHEMAS, type FieldDef } from "./categoryForms";

const AUTHORS: string[] = AUTHOR_TEAMS.flatMap((t) => AUTHOR_BOOK[t]);

type Keyman = { label: string; name: string; phone: string };
type LoadResult = { grade: string; company: string; region: string; keymen: Keyman[]; author: string };
type Props = {
  schemaKey: string;
  form: Record<string, string>;
  setForm: (f: Record<string, string>) => void;
  author: string;
  setAuthor: (v: string) => void;
  onLoad: (src: "inspection" | "as") => LoadResult | null;
  onError: (msg: string) => void;
};

export default function CategoryForm({ schemaKey, form, setForm, author, setAuthor, onLoad, onError }: Props) {
  const [keymen, setKeymen] = useState<Keyman[]>([]);
  const schema = CATEGORY_SCHEMAS[schemaKey];
  if (!schema) return null;
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  const handleLoad = (src: "inspection" | "as") => {
    const r = onLoad(src);
    if (!r) { onError(`${src === "inspection" ? "점검" : "AS"} 탭에 입력된 내용이 없어요`); return; }
    if (r.author) setAuthor(r.author);
    setKeymen(r.keymen);
    const k0 = r.keymen[0];
    const next = { ...form };
    for (const sec of schema.sections) for (const f of sec.fields) {
      if (f.fill === "company") next[f.key] = r.company || next[f.key];
      else if (f.fill === "region") next[f.key] = r.region || next[f.key];
      else if (f.fill === "grade") next[f.key] = r.grade || next[f.key];
      else if (f.fill === "keyman") next[f.key] = (k0 ? (k0.phone ? `${k0.name} ${k0.phone}`.trim() : k0.name || k0.label) : next[f.key]);
    }
    setForm(next);
  };

  const keymanKey = schema.sections.flatMap((s) => s.fields).find((f) => f.fill === "keyman")?.key;

  const renderField = (f: FieldDef) => {
    if (f.fill === "author") {
      return (
        <label key={f.key} className="block">
          <span className="text-xs font-medium text-slate-500">{f.label}</span>
          <select value={author} onChange={(e) => setAuthor(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400">
            <option value="">선택</option>
            {AUTHORS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label key={f.key} className="block">
        <span className="text-xs font-medium text-slate-500">{f.label}</span>
        {f.type === "select" ? (
          <select value={form[f.key] || ""} onChange={(e) => set(f.key, e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400">
            <option value="">선택</option>
            {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : f.type === "textarea" ? (
          <textarea value={form[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} rows={2}
            className="mt-0.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
        ) : (
          <input value={form[f.key] || ""} onChange={(e) => set(f.key, e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
        )}
      </label>
    );
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
        <span className="text-xs font-bold text-slate-500">불러오기</span>
        <button type="button" onClick={() => handleLoad("inspection")} className="rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-bold text-[#334155]">점검</button>
        <button type="button" onClick={() => handleLoad("as")} className="rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-bold text-[#334155]">AS</button>
        <span className="ml-auto text-[10px] text-slate-400">업체·지역·등급·키맨 자동</span>
      </div>

      {keymen.length > 1 && keymanKey && (
        <label className="block">
          <span className="text-xs font-medium text-slate-500">키맨 선택 (여러 명)</span>
          <select onChange={(e) => { if (e.target.value !== "manual" && e.target.value !== "") set(keymanKey, e.target.value); }}
            className="mt-0.5 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none">
            <option value="">선택…</option>
            {keymen.map((k, i) => <option key={i} value={k.phone ? `${k.name} ${k.phone}`.trim() : (k.name || k.label)}>{k.label}</option>)}
            <option value="manual">직접입력 (담당자 칸에 직접)</option>
          </select>
        </label>
      )}

      {schema.sections.map((sec) => (
        <div key={sec.title} className="space-y-2">
          <div className="text-[11px] font-bold text-slate-400">■ {sec.title}</div>
          {sec.fields.map(renderField)}
        </div>
      ))}

      <div className="text-[11px] text-slate-400">전송: {schema.category} 방 · 저장: {schema.table}</div>
    </div>
  );
}
