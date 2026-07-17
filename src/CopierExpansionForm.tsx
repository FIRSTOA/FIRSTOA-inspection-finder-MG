import { AUTHOR_BOOK, AUTHOR_TEAMS } from "./authors";
import { GRADE_OPTIONS } from "./formOptions";

const AUTHORS: string[] = AUTHOR_TEAMS.flatMap((t) => AUTHOR_BOOK[t]);

export type CopierExpansionFormState = {
  registrant: string;
  salesOwner: string;
  company: string;
  industryPeopleRevenue: string;
  meetingAddress: string;
  projectStatus: string;
  keymanNameTitle: string;
  contact: string;
  decisionPower: string;
  personalHistory: string;
  itemRaw: string;
  expectedAmount: string;
  expectedOrderMonth: string;
  contractEndDate: string;
  notes: string;
  grade: string;
};

export const EMPTY_COPIER_EXPANSION_FORM: CopierExpansionFormState = {
  registrant: "",
  salesOwner: "",
  company: "",
  industryPeopleRevenue: "",
  meetingAddress: "",
  projectStatus: "",
  keymanNameTitle: "",
  contact: "",
  decisionPower: "",
  personalHistory: "",
  itemRaw: "",
  expectedAmount: "",
  expectedOrderMonth: "",
  contractEndDate: "",
  notes: "",
  grade: "",
};

export function buildCopierExpansionText(f: CopierExpansionFormState, author: string): string {
  return [
    "■[영업 확장성 DB 업데이트 양식]",
    "■ 기본 정보",
    `1. 등록자 : ${f.registrant || author} / 전략영업 담당자 : ${f.salesOwner}`,
    `2. 상호명: ${f.company}`,
    `3. 업종 및 인원(매출): ${f.industryPeopleRevenue}`,
    `4. 실제 미팅 주소: ${f.meetingAddress}`,
    `5. 프로젝트/진행상황: ${f.projectStatus}`,
    "",
    "■ 키맨 정보",
    `6. 성함 및 직함: ${f.keymanNameTitle}`,
    `7. 연락처: ${f.contact}`,
    `8. 의사결정 파급력: ${f.decisionPower}`,
    `9. 개인 히스토리: ${f.personalHistory}`,
    "",
    "■ 영업 파이프라인",
    `10. 품목(원문): ${f.itemRaw}`,
    `11. 예상 발주금액(만원): ${f.expectedAmount}`,
    `12. 예상 발주시기(YYYY-MM): ${f.expectedOrderMonth}`,
    `13. 계약 종료(예정)일: ${f.contractEndDate}`,
    "",
    "■ 활동 내용",
    "14. 특이사항(미팅내용): ",
    f.notes,
    "",
    `15. 관리등급 (V/SS/S/NN/N): ${f.grade}`,
  ].join("\n");
}

type Keyman = { label: string; name: string; phone: string };
type LoadResult = { grade: string; company: string; region: string; keymen: Keyman[]; author: string };
type Props = {
  form: CopierExpansionFormState;
  setForm: (f: CopierExpansionFormState) => void;
  author: string;
  setAuthor: (v: string) => void;
  onLoad: (src: "inspection" | "as") => LoadResult | null;
  onError: (msg: string) => void;
};

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#334155]" />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#334155]">
        <option value="">선택</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={5} placeholder={placeholder}
        className="mt-0.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#334155]" />
    </label>
  );
}

export default function CopierExpansionForm({ form, setForm, author, setAuthor, onLoad, onError }: Props) {
  const set = (k: keyof CopierExpansionFormState) => (v: string) => setForm({ ...form, [k]: v });

  const handleLoad = (src: "inspection" | "as") => {
    const r = onLoad(src);
    if (!r) { onError(`${src === "inspection" ? "점검" : "AS"} 탭에 입력된 내용이 없어요`); return; }
    if (r.author) setAuthor(r.author);
    const k = r.keymen[0];
    setForm({
      ...form,
      registrant: form.registrant || r.author || author,
      company: r.company || form.company,
      meetingAddress: form.meetingAddress || r.region,
      keymanNameTitle: k?.name || form.keymanNameTitle,
      contact: k?.phone || form.contact,
      grade: r.grade || form.grade,
    });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
        <span className="text-xs font-bold text-slate-500">불러오기</span>
        <button type="button" onClick={() => handleLoad("inspection")} className="rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-bold text-[#334155]">점검</button>
        <button type="button" onClick={() => handleLoad("as")} className="rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-bold text-[#334155]">AS</button>
        <span className="ml-auto text-[10px] text-slate-400">상호·키맨·등급 자동</span>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-slate-500">작성자</span>
        <select value={author} onChange={(e) => setAuthor(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#334155]">
          <option value="">선택</option>
          {AUTHORS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      <div className="text-[11px] font-bold text-slate-400">■ 기본 정보</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="등록자" value={form.registrant} onChange={set("registrant")} />
        <Field label="전략영업 담당자" value={form.salesOwner} onChange={set("salesOwner")} />
      </div>
      <Field label="상호명" value={form.company} onChange={set("company")} />
      <Field label="업종 및 인원(매출)" value={form.industryPeopleRevenue} onChange={set("industryPeopleRevenue")} placeholder="모를 경우 미기재" />
      <Field label="실제 미팅 주소" value={form.meetingAddress} onChange={set("meetingAddress")} />
      <Select label="프로젝트/진행상황" value={form.projectStatus} onChange={set("projectStatus")} options={["정보확인", "간단견적제출", "견적대기", "미팅예정", "진행중", "보류", "종료"]} />

      <div className="text-[11px] font-bold text-slate-400">■ 키맨 정보</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="성함 및 직함" value={form.keymanNameTitle} onChange={set("keymanNameTitle")} />
        <Field label="연락처" value={form.contact} onChange={set("contact")} />
      </div>
      <Select label="의사결정 파급력" value={form.decisionPower} onChange={set("decisionPower")} options={["최종결정", "실무책임자", "실무자", "창업멤버", "영향력 낮음", "확인필요"]} />
      <Field label="개인 히스토리" value={form.personalHistory} onChange={set("personalHistory")} placeholder="전직장, 관심사 등 친밀도 형성용" />

      <div className="text-[11px] font-bold text-slate-400">■ 영업 파이프라인</div>
      <Field label="품목(원문)" value={form.itemRaw} onChange={set("itemRaw")} placeholder="예: 복합기 1대, PC 3대" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="예상 발주금액(만원)" value={form.expectedAmount} onChange={set("expectedAmount")} />
        <Field label="예상 발주시기(YYYY-MM)" value={form.expectedOrderMonth} onChange={set("expectedOrderMonth")} />
      </div>
      <Field label="계약 종료(예정)일" value={form.contractEndDate} onChange={set("contractEndDate")} placeholder="경쟁사 종료일" />

      <div className="text-[11px] font-bold text-slate-400">■ 활동 내용</div>
      <TextArea label="특이사항(미팅내용)" value={form.notes} onChange={set("notes")} placeholder="경쟁사이름, 불만사항, 고객성향, 요청자료 등을 자유롭게 적어주세요." />
      <Select label="관리등급 (N/NN/S/SS/V)" value={form.grade} onChange={set("grade")} options={GRADE_OPTIONS} />
    </div>
  );
}
