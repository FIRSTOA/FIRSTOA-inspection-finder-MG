import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { ItLogsMissingError, savePracticeLog } from "./itLogs";
import { uploadPhoto } from "./supabase";
import { notify } from "./toast";
import { kstDate } from "./visits";

/** IT 학습 탭 상단 접이식 [실습 기록] — 제목(필수)·메모·사진 1장 → it_practice_logs. 홈 KPI 에 건수로 잡힌다. */
export default function ItPracticeForm({ author }: { author: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (saving) return;
    if (!author) { notify("작성자를 먼저 선택하세요.", "error"); return; }
    if (!title.trim()) { notify("제목은 필수입니다.", "error"); return; }
    setSaving(true);
    try {
      let photoUrl: string | undefined;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
        photoUrl = await uploadPhoto(`it-practice/${kstDate()}/${Date.now()}.${ext}`, file, file.type || "image/jpeg");
      }
      await savePracticeLog({ author, title: title.trim(), memo: memo.trim(), photoUrl });
      notify("기록됨 · 홈 KPI 에 반영", "success");
      setTitle(""); setMemo(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (error) {
      if (error instanceof ItLogsMissingError) setMissing(true);
      else notify(error instanceof Error ? error.message : "실습 기록을 저장하지 못했습니다.", "error");
    } finally { setSaving(false); }
  };

  return <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm font-black text-slate-800">
      <span>실습 기록</span>{open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
    </button>
    {open && <div className="space-y-2.5 border-t border-slate-100 p-4">
      {missing && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">표 준비 중(SQL 실행 대기) — 지금은 저장할 수 없습니다.</p>}
      {!author && <p className="text-[11px] font-semibold text-slate-400">작성자를 선택하면 실습 기록이 KPI 에 잡힙니다.</p>}
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="제목 (필수) — 예: 복합기 정착기 분해 실습" className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
      <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} placeholder="메모 (선택)" className="w-full resize-y rounded-lg border border-slate-300 p-3 text-sm font-semibold outline-none focus:border-blue-500" />
      <input ref={fileRef} type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-xs font-semibold text-slate-500 file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-slate-100 file:px-4 file:text-xs file:font-black file:text-slate-700" />
      <button type="button" onClick={() => void submit()} disabled={saving || missing} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-blue-600 text-sm font-black text-white transition hover:bg-blue-700 disabled:bg-slate-300">
        {saving && <LoaderCircle size={15} className="animate-spin" />}{saving ? "저장 중…" : "기록 저장"}
      </button>
    </div>}
  </section>;
}
