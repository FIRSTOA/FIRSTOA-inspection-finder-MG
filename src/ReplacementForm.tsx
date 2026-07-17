import type { ReplacementFormState } from "./replacement";

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-blue-300"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black text-slate-500">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="mt-1 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold leading-6 text-slate-700 outline-none focus:border-blue-300"
      />
    </label>
  );
}

export default function ReplacementForm({
  form,
  setForm,
}: {
  form: ReplacementFormState;
  setForm: (form: ReplacementFormState) => void;
}) {
  const set = (key: keyof ReplacementFormState, value: string) => setForm({ ...form, [key]: value });

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <div className="text-sm font-black text-slate-950">교체양식</div>
        <div className="mt-1 text-xs font-semibold leading-5 text-slate-400">
          퍼스트전산 채널에 복사해서 붙여넣는 전용 양식입니다.
        </div>
      </div>
      <TextAreaField label="1. 캘린더 글머리에 중요내용 넣어줘야할사항" value={form.calendarMemo} onChange={(v) => set("calendarMemo", v)} />
      <TextField label="2. 날짜(랜선/팩스선 유무)" value={form.dateLine} onChange={(v) => set("dateLine", v)} />
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="3. 유입경로" value={form.source} onChange={(v) => set("source", v)} />
        <TextField label="4. 영업(요청)담당자" value={form.salesOwner} onChange={(v) => set("salesOwner", v)} />
      </div>
      <TextField label="5. 수리배정 담당자 (고장교체시 CS인원 필수입력)" value={form.repairOwner} onChange={(v) => set("repairOwner", v)} />
      <TextAreaField label="6. 교체/철수사유" value={form.reason} onChange={(v) => set("reason", v)} />
      <TextField label="7. 상호(사업자등록증 유/무)" value={form.company} onChange={(v) => set("company", v)} />
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="8. 성함" value={form.name} onChange={(v) => set("name", v)} />
        <TextField label="9. 연락처" value={form.phone} onChange={(v) => set("phone", v)} />
      </div>
      <TextAreaField label="10. 주소(엘리베이터 유무)" value={form.address} onChange={(v) => set("address", v)} />
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="11. 장비소유주(위탁/퍼스트)" value={form.owner} onChange={(v) => set("owner", v)} />
        <TextField label="12. 물품" value={form.items} onChange={(v) => set("items", v)} />
      </div>
    </div>
  );
}
