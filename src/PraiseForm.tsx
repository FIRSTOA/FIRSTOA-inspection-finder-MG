/**
 * 칭찬 접수 폼 (FIELD 더보기 → 칭찬)
 * 저장하면 퍼스트전산 DB통합시트 '칭찬' 탭에 자동 기입된다 (카톡 전송 없음).
 * 분기·월·분류(칭찬)는 날짜와 작성자로 자동 채워지므로 입력받지 않는다.
 */
import { useEffect, useState } from "react";
import { sendPraiseForm, type PraiseFormState } from "./api";
import { kstDate } from "./visits";

const REASON_PRESETS = ["AS 서비스 만족", "점검 서비스 만족", "친절한 응대", "빠른 문제 해결", "상담 만족"];
const GRADES = ["", "N", "NN", "S", "SS", "V"];

const emptyForm = (): PraiseFormState => ({ date: kstDate(), grade: "", company: "", manager: "", contact: "", phone: "", reason: "", short: "" });

export default function PraiseForm({ author, onToast, bindSubmit, onReadyChange }: { author: string; onToast: (message: string, kind?: "success" | "error") => void; bindSubmit?: (fn: () => void) => void; onReadyChange?: (ready: boolean) => void }) {
  const [form, setForm] = useState<PraiseFormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof PraiseFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await sendPraiseForm(form, author);
      if (result.ok) {
        onToast(result.message || "칭찬을 접수했어요", "success");
        setForm((current) => ({ ...emptyForm(), date: current.date }));
      } else {
        onToast(result.error || "칭찬 접수에 실패했습니다", "error");
      }
    } finally {
      setBusy(false);
    }
  };
  // 제출은 우측 미리보기 버튼줄의 [보내기]가 담당 — 여기서 함수와 활성화 조건을 넘겨준다
  useEffect(() => { bindSubmit?.(() => void submit()); });
  useEffect(() => { onReadyChange?.(!busy && !!form.company.trim() && !!form.reason.trim()); }, [busy, form.company, form.reason, onReadyChange]);

  const field = "h-10 w-full rounded-lg border border-slate-300 px-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-black text-slate-950">칭찬 접수</h3>
        <p className="mt-1 text-xs font-semibold text-slate-500">고객이 칭찬한 내용을 기록하면 DB통합시트 칭찬 탭에 바로 기입됩니다. 분기·월·분류는 자동으로 채워져요.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="mb-1 block text-xs font-black text-slate-600">날짜</span>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={field} />
        </label>
        <label><span className="mb-1 block text-xs font-black text-slate-600">등급</span>
          <select value={form.grade} onChange={(e) => set("grade", e.target.value)} className={`${field} bg-white`}>
            {GRADES.map((grade) => <option key={grade} value={grade}>{grade || "선택"}</option>)}
          </select>
        </label>
        <label><span className="mb-1 block text-xs font-black text-slate-600">거래처명 <b className="text-rose-500">*</b></span>
          <input value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="예: 시민언론뉴탐사" className={field} />
        </label>
        <label><span className="mb-1 block text-xs font-black text-slate-600">담당자 (칭찬해 주신 분)</span>
          <input value={form.manager} onChange={(e) => set("manager", e.target.value)} className={field} />
        </label>
        <label><span className="mb-1 block text-xs font-black text-slate-600">연락처</span>
          <input value={form.contact} onChange={(e) => set("contact", e.target.value)} className={field} />
        </label>
        <label><span className="mb-1 block text-xs font-black text-slate-600">전화번호</span>
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={field} />
        </label>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-black text-slate-600">칭찬이유 <b className="text-rose-500">*</b> — 누르면 바로 채워져요</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REASON_PRESETS.map((preset) => (
              <button key={preset} type="button" onClick={() => setForm((current) => ({ ...current, reason: preset, short: preset }))}
                className={`rounded-full border px-3 py-2 text-xs font-black ${form.reason === preset ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {preset}
              </button>
            ))}
          </div>
          <textarea value={form.reason} onChange={(e) => set("reason", e.target.value)} rows={2} placeholder="직접 입력하거나 위 버튼으로 선택" className="w-full resize-y rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-500" />
        </div>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-black text-slate-600">간단 (한 줄 요약 — 비우면 칭찬이유가 들어가요)</span>
          <input value={form.short} onChange={(e) => set("short", e.target.value)} className={field} />
        </label>
      </div>

    </section>
  );
}
