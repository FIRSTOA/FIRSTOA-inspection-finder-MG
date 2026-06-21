/** 확장성(PC·IT·복합기·네트워크) 입력 폼.
 *  - 불러오기: 점검/AS에서 등급·업체명·지역·키맨(이름→업체담당자/IT담당자, 연락처→연락처) 가져옴.
 *  - 키맨 여러 명 드롭다운 + 직접입력. 사무/설계/디자인/개발·세부사양 다중선택. 렌탈/구매/유지보수 드롭다운.
 */
import { useState } from "react";
import { AUTHOR_TEAMS, AUTHOR_BOOK } from "./authors";

const AUTHORS: string[] = AUTHOR_TEAMS.flatMap((t) => AUTHOR_BOOK[t]);

export type PcFormState = {
  purpose: string; spec: string; region: string; company: string; grade: string;
  vendorContact: string; contact: string; itContact: string; rentalBuyMaint: string;
  designatedVendor: string; designatedSat: string; totalPeople: string; peopleNote: string;
  qty: string; amount: string; timing: string; timingNote: string; appeal: string;
};

export const EMPTY_PC_FORM: PcFormState = {
  purpose: "", spec: "", region: "", company: "", grade: "",
  vendorContact: "", contact: "", itContact: "", rentalBuyMaint: "",
  designatedVendor: "", designatedSat: "", totalPeople: "", peopleNote: "",
  qty: "", amount: "", timing: "", timingNote: "", appeal: "",
};

export function buildPcText(f: PcFormState, author: string): string {
  return [
    "/PC DB 활용", "*사양",
    `사무/설계/디자인/개발: ${f.purpose}`, `세부사양: ${f.spec}`,
    `작성자: ${author}`, `지역: ${f.region}`, `업체명: ${f.company}`, `등급: ${f.grade}`,
    `업체담당자: ${f.vendorContact}`, `연락처: ${f.contact}`, `IT담당자: ${f.itContact}`,
    `렌탈or구매or유지보수: ${f.rentalBuyMaint}`, `지정업체: ${f.designatedVendor}`, `지정업체만족도: ${f.designatedSat}`,
    "*총 인원", `총 인원: ${f.totalPeople}`, `인원 추가 설명: ${f.peopleNote}`,
    "*수요", `수량: ${f.qty}`, `금액: ${f.amount}`, `시기: ${f.timing}`, `시기 추가 설명: ${f.timingNote}`,
    `어필 OR 추가영업: ${f.appeal}`,
  ].join("\n");
}

type Keyman = { label: string; name: string; phone: string };
type LoadResult = { grade: string; company: string; region: string; keymen: Keyman[]; author: string };
type Props = {
  form: PcFormState; setForm: (f: PcFormState) => void;
  author: string; setAuthor: (v: string) => void; accent: string;
  onLoad: (src: "inspection" | "as") => LoadResult | null;
  onError: (msg: string) => void;
};

function Field({ label, value, onChange, star }: { label: string; value: string; onChange: (v: string) => void; star?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{star && <span className="text-rose-400">* </span>}{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#3182F6]" />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#3182F6]">
        <option value="">선택</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

// 다중선택 칩 + 직접입력
function ChipMulti({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState("");
  const sel = value.split(",").map((s) => s.trim()).filter(Boolean);
  const set = (arr: string[]) => onChange(arr.join(", "));
  const toggle = (o: string) => set(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]);
  const addCustom = () => { const c = custom.trim(); if (c && !sel.includes(c)) set([...sel, c]); setCustom(""); };
  return (
    <div className="block">
      <span className="text-xs font-medium text-slate-500">{label} <span className="text-slate-300">(중복 가능)</span></span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => toggle(o)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${sel.includes(o) ? "bg-[#3182F6] text-white" : "bg-slate-100 text-slate-600"}`}>
            {o}
          </button>
        ))}
        {sel.filter((s) => !options.includes(s)).map((s) => (
          <button key={s} type="button" onClick={() => toggle(s)}
            className="rounded-full bg-[#3182F6] px-3 py-1 text-xs font-semibold text-white">{s} ✕</button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
          placeholder="직접입력 후 추가" className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-[#3182F6]" />
        <button type="button" onClick={addCustom} className="shrink-0 rounded-lg bg-slate-700 px-3 text-xs font-bold text-white">추가</button>
      </div>
    </div>
  );
}

// 그룹별 다중선택 칩 (인텔/라이젠/맥/세대 등) + 직접입력
function ChipGroups({ label, groups, value, onChange }: { label: string; groups: { title: string; options: string[] }[]; value: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState("");
  const sel = value.split(",").map((s) => s.trim()).filter(Boolean);
  const known = groups.flatMap((g) => g.options);
  const set = (arr: string[]) => onChange(arr.join(", "));
  const toggle = (o: string) => set(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]);
  const addCustom = () => { const c = custom.trim(); if (c && !sel.includes(c)) set([...sel, c]); setCustom(""); };
  return (
    <div className="block">
      <span className="text-xs font-medium text-slate-500">{label} <span className="text-slate-300">(중복 가능)</span></span>
      {groups.map((g) => (
        <div key={g.title} className="mt-1.5">
          <div className="text-[10px] font-bold text-slate-400">{g.title}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {g.options.map((o) => (
              <button key={o} type="button" onClick={() => toggle(o)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${sel.includes(o) ? "bg-[#3182F6] text-white" : "bg-slate-100 text-slate-600"}`}>{o}</button>
            ))}
          </div>
        </div>
      ))}
      {sel.filter((s) => !known.includes(s)).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sel.filter((s) => !known.includes(s)).map((s) => (
            <button key={s} type="button" onClick={() => toggle(s)} className="rounded-full bg-[#3182F6] px-3 py-1 text-xs font-semibold text-white">{s} ✕</button>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex gap-1.5">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
          placeholder="직접입력 후 추가" className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-[#3182F6]" />
        <button type="button" onClick={addCustom} className="shrink-0 rounded-lg bg-slate-700 px-3 text-xs font-bold text-white">추가</button>
      </div>
    </div>
  );
}

export default function PcForm({ form, setForm, author, setAuthor, onLoad, onError }: Props) {
  const [keymen, setKeymen] = useState<Keyman[]>([]);
  const set = (k: keyof PcFormState) => (v: string) => setForm({ ...form, [k]: v });

  const handleLoad = (src: "inspection" | "as") => {
    const r = onLoad(src);
    if (!r) { onError(`${src === "inspection" ? "점검" : "AS"} 탭에 입력된 내용이 없어요`); return; }
    if (r.author) setAuthor(r.author);
    setKeymen(r.keymen);
    const k = r.keymen[0];
    setForm({
      ...form,
      grade: r.grade || form.grade, company: r.company || form.company, region: r.region || form.region,
      vendorContact: k?.name || form.vendorContact, itContact: k?.name || form.itContact, contact: k?.phone || form.contact,
    });
  };

  const pickKeyman = (v: string) => {
    if (v === "manual" || v === "") return;
    const k = keymen[Number(v)];
    if (k) setForm({ ...form, vendorContact: k.name, itContact: k.name, contact: k.phone });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      {/* 불러오기 — 세련되게 */}
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
        <span className="text-xs font-bold text-slate-500">불러오기</span>
        <button type="button" onClick={() => handleLoad("inspection")} className="rounded-full bg-[#EFF6FF] px-3 py-1 text-xs font-bold text-[#3182F6]">점검</button>
        <button type="button" onClick={() => handleLoad("as")} className="rounded-full bg-[#EFF6FF] px-3 py-1 text-xs font-bold text-[#3182F6]">AS</button>
        <span className="ml-auto text-[10px] text-slate-400">업체·지역·등급·키맨 자동</span>
      </div>

      {/* 작성자 */}
      <label className="block">
        <span className="text-xs font-medium text-slate-500">작성자</span>
        <select value={author} onChange={(e) => setAuthor(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#3182F6]">
          <option value="">선택</option>
          {AUTHORS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      {/* 키맨 선택 (여러 명/직접입력) */}
      {keymen.length > 0 && (
        <label className="block">
          <span className="text-xs font-medium text-slate-500">키맨 선택 → 담당자/연락처 채움</span>
          <select onChange={(e) => pickKeyman(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none">
            <option value="">선택…</option>
            {keymen.map((k, i) => <option key={i} value={i}>{k.label}</option>)}
            <option value="manual">직접입력 (아래 칸에 직접)</option>
          </select>
        </label>
      )}

      <div className="text-[11px] font-bold text-slate-400">＊사양</div>
      <ChipMulti label="사무/설계/디자인/개발" options={["사무", "설계", "디자인", "개발"]} value={form.purpose} onChange={set("purpose")} />
      <ChipGroups label="세부사양" value={form.spec} onChange={set("spec")} groups={[
        { title: "인텔", options: ["i3", "i5", "i7", "i9"] },
        { title: "라이젠", options: ["라이젠3", "라이젠5", "라이젠7", "라이젠9"] },
        { title: "맥", options: ["M1", "M2", "M3", "M4"] },
        { title: "세대", options: ["11세대", "12세대", "13세대", "14세대"] },
      ]} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="지역" value={form.region} onChange={set("region")} />
        <Field label="등급" value={form.grade} onChange={set("grade")} />
      </div>
      <Field label="업체명" value={form.company} onChange={set("company")} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="업체담당자" value={form.vendorContact} onChange={set("vendorContact")} />
        <Field label="연락처" value={form.contact} onChange={set("contact")} />
      </div>
      <Field label="IT담당자" value={form.itContact} onChange={set("itContact")} />
      <div className="grid grid-cols-2 gap-2">
        <Select label="렌탈/구매/유지보수" value={form.rentalBuyMaint} onChange={set("rentalBuyMaint")} options={["렌탈", "구매", "유지보수"]} />
        <Field label="지정업체" value={form.designatedVendor} onChange={set("designatedVendor")} />
      </div>
      <Field label="지정업체만족도" value={form.designatedSat} onChange={set("designatedSat")} />

      <div className="text-[11px] font-bold text-slate-400">＊총 인원</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="총 인원" value={form.totalPeople} onChange={set("totalPeople")} star />
        <Field label="인원 추가 설명" value={form.peopleNote} onChange={set("peopleNote")} />
      </div>

      <div className="text-[11px] font-bold text-slate-400">＊수요</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="수량" value={form.qty} onChange={set("qty")} />
        <Field label="금액" value={form.amount} onChange={set("amount")} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="시기" value={form.timing} onChange={set("timing")} />
        <Field label="시기 추가 설명" value={form.timingNote} onChange={set("timingNote")} />
      </div>
      <Field label="어필 OR 추가영업" value={form.appeal} onChange={set("appeal")} />
    </div>
  );
}
