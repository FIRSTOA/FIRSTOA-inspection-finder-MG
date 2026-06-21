/** IT통합(PC·복합기·IT·네트워크 확장성) 입력 폼.
 *  - [점검 불러오기][AS 불러오기]: 이번 세션 점검/AS 출력에서 작성자·업체명·지역·키맨을 가져와 채움.
 *  - 키맨 여러 명이면 드롭다운 선택, 직접 수정도 가능.
 *  - 양식은 추후 변경 예정 → 필드 추가/수정 쉽게 단순 구조로.
 */
import { useState } from "react";
import { AUTHOR_TEAMS, AUTHOR_BOOK } from "./authors";

const AUTHORS: string[] = AUTHOR_TEAMS.flatMap((t) => AUTHOR_BOOK[t]);

export type PcFormState = {
  purpose: string;        // 사무/설계/디자인/개발
  spec: string;           // 세부사양
  region: string;
  company: string;
  grade: string;
  vendorContact: string;  // 업체담당자 (키맨 불러오기 대상)
  contact: string;        // 연락처
  itContact: string;      // IT담당자
  rentalBuyMaint: string; // 렌탈or구매or유지보수
  designatedVendor: string;     // 지정업체
  designatedSat: string;        // 지정업체만족도
  totalPeople: string;    // 총 인원
  peopleNote: string;     // 인원 추가 설명
  qty: string;            // 수량
  amount: string;         // 금액
  timing: string;         // 시기
  timingNote: string;     // 시기 추가 설명
  appeal: string;         // 어필 OR 추가영업
};

export const EMPTY_PC_FORM: PcFormState = {
  purpose: "", spec: "", region: "", company: "", grade: "",
  vendorContact: "", contact: "", itContact: "", rentalBuyMaint: "",
  designatedVendor: "", designatedSat: "", totalPeople: "", peopleNote: "",
  qty: "", amount: "", timing: "", timingNote: "", appeal: "",
};

// 폼 → 카톡 전송 텍스트(/PC DB 활용 양식)
export function buildPcText(f: PcFormState, author: string): string {
  return [
    "/PC DB 활용",
    "*사양",
    `사무/설계/디자인/개발: ${f.purpose}`,
    `세부사양: ${f.spec}`,
    `작성자: ${author}`,
    `지역: ${f.region}`,
    `업체명: ${f.company}`,
    `등급: ${f.grade}`,
    `업체담당자: ${f.vendorContact}`,
    `연락처: ${f.contact}`,
    `IT담당자: ${f.itContact}`,
    `렌탈or구매or유지보수: ${f.rentalBuyMaint}`,
    `지정업체: ${f.designatedVendor}`,
    `지정업체만족도: ${f.designatedSat}`,
    "*총 인원",
    `총 인원: ${f.totalPeople}`,
    `인원 추가 설명: ${f.peopleNote}`,
    "*수요",
    `수량: ${f.qty}`,
    `금액: ${f.amount}`,
    `시기: ${f.timing}`,
    `시기 추가 설명: ${f.timingNote}`,
    `어필 OR 추가영업: ${f.appeal}`,
  ].join("\n");
}

type LoadResult = { company: string; region: string; keymen: string[]; author: string };

type Props = {
  form: PcFormState;
  setForm: (f: PcFormState) => void;
  author: string;
  setAuthor: (v: string) => void;
  accent: string;
  onLoad: (src: "inspection" | "as") => LoadResult | null;
  onError: (msg: string) => void;
};

function Field({ label, value, onChange, star }: { label: string; value: string; onChange: (v: string) => void; star?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{star && <span className="text-rose-400">* </span>}{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
      />
    </label>
  );
}

export default function PcForm({ form, setForm, author, setAuthor, accent, onLoad, onError }: Props) {
  const [keymen, setKeymen] = useState<string[]>([]);
  const set = (k: keyof PcFormState) => (v: string) => setForm({ ...form, [k]: v });

  const handleLoad = (src: "inspection" | "as") => {
    const r = onLoad(src);
    if (!r) { onError(`${src === "inspection" ? "점검" : "AS"} 탭에 입력된 내용이 없어요`); return; }
    if (r.author) setAuthor(r.author);
    setKeymen(r.keymen);
    setForm({ ...form, company: r.company || form.company, region: r.region || form.region, vendorContact: r.keymen[0] || form.vendorContact });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      {/* 불러오기 */}
      <div className="flex gap-2">
        <button type="button" onClick={() => handleLoad("inspection")}
          className="flex-1 rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
          ↓ 점검에서 불러오기
        </button>
        <button type="button" onClick={() => handleLoad("as")}
          className="flex-1 rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
          ↓ AS에서 불러오기
        </button>
      </div>

      {/* 작성자 */}
      <label className="block">
        <span className="text-xs font-medium text-slate-500">작성자</span>
        <select value={author} onChange={(e) => setAuthor(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400">
          <option value="">선택</option>
          {AUTHORS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      {/* 키맨 여러 명이면 선택 (업체담당자에 채움) */}
      {keymen.length > 1 && (
        <label className="block">
          <span className="text-xs font-medium text-slate-500">키맨 선택 → 업체담당자</span>
          <select value={form.vendorContact} onChange={(e) => set("vendorContact")(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none">
            {keymen.map((k, i) => <option key={i} value={k}>{k}</option>)}
          </select>
        </label>
      )}

      <div className="text-[11px] font-bold text-slate-400">＊사양</div>
      <Field label="사무/설계/디자인/개발" value={form.purpose} onChange={set("purpose")} />
      <Field label="세부사양" value={form.spec} onChange={set("spec")} />
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
        <Field label="렌탈/구매/유지보수" value={form.rentalBuyMaint} onChange={set("rentalBuyMaint")} />
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

      <div className="text-[11px] text-slate-400">저장: PC확장성(pc_expansion) · 전송: PC방 (양식은 추후 변경 가능)</div>
      <input type="hidden" style={{ display: "none" }} value={accent} readOnly />
    </div>
  );
}
