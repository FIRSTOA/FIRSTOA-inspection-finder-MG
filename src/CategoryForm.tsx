/** 스키마 기반 카톡 카테고리 입력 폼 (불만/재계약/초과조정 공용).
 *  - [점검/AS 불러오기]: 작성자·업체명·지역·키맨 가져옴(키맨 다중→드롭다운).
 *  - 작성자는 author 상태 사용. 나머지는 form 상태.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuthorBook } from "./authors";
import { authorLocked } from "./sso";
import { CATEGORY_SCHEMAS, type FieldDef } from "./categoryForms";
import DatePickSheet from "./DatePickSheet";
import RecontractScheduleSheet from "./RecontractScheduleSheet";
import { onCategorySent } from "./categorySentEvent";
import { formatYmdShort, isYmd, readScheduleOffer, shouldOfferSchedule, type ScheduleOffer } from "./recontractSchedule";
import { kstDate } from "./visits";

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

// 선택 버튼 그룹 — label 밖·모듈 스코프에 둔다.
// (label 안에 있으면 라벨 영역 탭이 '첫 번째 버튼'을 활성화해 모바일에서 항상 첫 항목이 눌리고,
//  컴포넌트 안에 정의하면 렌더마다 타입이 바뀌어 리마운트된다)
function ChoiceInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  const [direct, setDirect] = useState(Boolean(value && !options.includes(value)));
  const choose = (v: string) => {
    setDirect(false);
    onChange(value === v ? "" : v);
  };
  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => choose(o)}
            className={`rounded-lg px-3 py-2 text-xs font-bold ${value === o && !direct ? "bg-slate-700 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>
            {o}
          </button>
        ))}
        <button type="button" onClick={() => { setDirect(true); if (options.includes(value)) onChange(""); }}
          className={`rounded-lg px-3 py-2 text-xs font-bold ${direct ? "bg-slate-700 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>
          직접입력
        </button>
      </div>
      {direct && (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="직접입력"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
      )}
    </div>
  );
}

/** 불러올 업체가 지금 적힌 업체와 다르면 확인 — 다른 업체 키맨·등급이 섞여 들어가지 않게 */
function confirmVendorLoad(current: string, incoming: string, src: "inspection" | "as"): boolean {
  const k = (v: string) => String(v || "").replace(/㈜|\(주\)|주식회사|\s/g, "");
  if (!current.trim() || !incoming.trim() || k(current) === k(incoming) || k(incoming).includes(k(current)) || k(current).includes(k(incoming))) return true;
  return window.confirm(`지금 적힌 업체: ${current}
${src === "inspection" ? "점검" : "AS"} 탭의 업체: ${incoming}

업체가 다릅니다. ${src === "inspection" ? "점검" : "AS"} 탭 내용(업체·등급·지역·키맨)으로 바꿀까요?
취소하면 아무것도 불러오지 않습니다.`);
}

export default function CategoryForm({ schemaKey, form, setForm, author, setAuthor, onLoad, onError }: Props) {
  const [keymen, setKeymen] = useState<Keyman[]>([]);
  const { authors, book } = useAuthorBook();
  // 날짜 칸(재계약 다음확인일): 시트로 고르기, [미정·글로 쓰기]면 글자 입력 칸으로
  const [picking, setPicking] = useState("");
  const [textKeys, setTextKeys] = useState<Record<string, boolean>>({});
  // 재계약 보낸 뒤 "다음 확인일로 일정 만들까요?" — api.ts 저장 성공 신호(창 이벤트) + 기기에 남은 제안(24시간)
  const [offer, setOffer] = useState<ScheduleOffer | null>(() => readScheduleOffer());
  useEffect(() => onCategorySent((d) => {
    if (shouldOfferSchedule(d)) setOffer({ dupKey: d.dupKey, form: { ...d.form }, author: d.author, text: d.text, testMode: d.testMode, at: Date.now() });
  }), []);
  const schema = CATEGORY_SCHEMAS[schemaKey];
  if (!schema) return null;
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  const handleLoad = (src: "inspection" | "as") => {
    const r = onLoad(src);
    if (!r) { onError(`${src === "inspection" ? "점검" : "AS"} 탭에 입력된 내용이 없어요`); return; }
    // 지금 적힌 업체와 점검/AS 탭의 업체가 다르면 묻는다 — 점검 탭에 남아 있던 다른 업체(파트라)가 세원기술단 확장성을 덮어쓰던 것(2026-10-15)
    if (!confirmVendorLoad((schema.sections.flatMap((sec) => sec.fields).filter((f) => f.fill === "company").map((f) => String(form[f.key] || "")).find(Boolean) || ""), r.company, src)) return;

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
          {authorLocked() ? <div className="mt-0.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{author}</div> : <select value={author} onChange={(e) => setAuthor(e.target.value)}
            className="mt-0.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400">
            <option value="">선택</option>
            {authors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>}
        </label>
      );
    }
    if (f.type === "date") {
      const v = String(form[f.key] || "");
      const asText = textKeys[f.key];
      return (
        <div key={f.key} className="block">
          <span className="text-xs font-medium text-slate-500">{f.label}</span>
          {asText ? (
            <div className="mt-0.5 flex gap-2">
              <input value={v} onChange={(e) => set(f.key, e.target.value)} placeholder="예: 차주 중" autoFocus
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
              <button type="button" onClick={() => { setTextKeys({ ...textKeys, [f.key]: false }); setPicking(f.key); }}
                className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700">달력</button>
            </div>
          ) : (
            <div className="mt-0.5 flex gap-2">
              <button type="button" onClick={() => setPicking(f.key)}
                className={`min-w-0 flex-1 truncate rounded-xl border px-3 py-2 text-left text-sm ${v ? "border-purple-200 bg-white font-bold text-slate-800" : "border-dashed border-slate-300 bg-white text-slate-400"}`}>
                {v ? (isYmd(v) ? formatYmdShort(v) : v) : "날짜 고르기"}
              </button>
              {v && <button type="button" onClick={() => set(f.key, "")} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">지우기</button>}
            </div>
          )}
        </div>
      );
    }
    if (f.type === "select") {
      return (
        <div key={f.key} className="block">
          <span className="text-xs font-medium text-slate-500">{f.label}</span>
          <ChoiceInput value={form[f.key] || ""} onChange={(v) => set(f.key, v)} options={f.options || []} />
        </div>
      );
    }
    return (
      <label key={f.key} className="block">
        <span className="text-xs font-medium text-slate-500">{f.label}</span>
        {f.type === "textarea" ? (
          <textarea value={form[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} rows={2}
            className="mt-0.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
        ) : (
          <input value={form[f.key] || ""} onChange={(e) => set(f.key, e.target.value)}
            className="mt-0.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
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
            className="mt-0.5 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
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

      {picking && typeof document !== "undefined" && createPortal(
        <DatePickSheet title={schema.sections.flatMap((sec) => sec.fields).find((f) => f.key === picking)?.label || "날짜 고르기"}
          subtitle={String(form["업체명"] || "") || undefined} value={String(form[picking] || "")} today={kstDate()}
          onPick={(ymd) => { set(picking, ymd); setPicking(""); }}
          onText={() => { setTextKeys({ ...textKeys, [picking]: true }); setPicking(""); }}
          onClose={() => setPicking("")} />,
        document.body,
      )}
      {offer && schemaKey === "recontract" && typeof document !== "undefined" && createPortal(
        <RecontractScheduleSheet key={offer.dupKey} offer={offer} book={book} names={authors} onDone={() => setOffer(null)} />,
        document.body,
      )}
    </div>
  );
}
