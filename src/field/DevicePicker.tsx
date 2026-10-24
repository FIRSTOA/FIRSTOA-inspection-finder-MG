/**
 * 점검·AS 양식의 기기 고르기·추가·순서 바꾸기·삭제. App.tsx에서 글자 그대로 옮겨 왔다(2026-10-24, docs/tasks/field-form-tidy.md S5).
 */
import { useState, type PointerEvent } from "react";
import { EMPTY_DEVICE_INFO, type DeviceInfo, type PerItemForm } from "./fieldFormModel";

export function DevicePicker({ forms, labels, selected, onSelect, onAdd, onUpdate, onMove, onReorder, onRemove }: {
  forms: PerItemForm[];
  labels: string[];
  selected: number;
  onSelect: (i: number) => void;
  onAdd: (info: DeviceInfo) => void;
  onUpdate: (i: number, info: DeviceInfo) => void;
  onMove: (i: number, direction: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DeviceInfo>({ ...EMPTY_DEVICE_INFO });
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const beginEdit = (index: number | "new") => {
    setEditing(index);
    setDraft(index === "new" ? { ...EMPTY_DEVICE_INFO } : {
      location: forms[index]?.location || "",
      model: forms[index]?.model || "", serial: forms[index]?.serial || "",
      asset: forms[index]?.asset || "", content: forms[index]?.content || "",
    });
    setOpen(true);
  };
  const save = () => {
    if (!Object.values(draft).some((value) => value.trim())) return;
    if (editing === "new") onAdd(draft);
    else if (typeof editing === "number") onUpdate(editing, draft);
    setEditing(null);
  };
  const beginDrag = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (forms.length <= 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragFrom(index);
    setDragOver(index);
  };
  const trackDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (dragFrom === null) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-device-index]") as HTMLElement | null;
    const index = target ? Number(target.dataset.deviceIndex) : NaN;
    if (Number.isInteger(index) && index >= 0 && index < forms.length) setDragOver(index);
  };
  const finishDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) onReorder(dragFrom, dragOver);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragFrom(null);
    setDragOver(null);
  };
  const cancelDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };
  const closeModal = () => {
    if (editing !== null) {
      setEditing(null);
      return;
    }
    setOpen(false);
  };
  const rowClass = (index: number) => {
    if (dragFrom === index) return "border-blue-700 bg-blue-100 shadow-lg shadow-blue-200/70 ring-2 ring-blue-500 scale-[0.99]";
    if (dragOver === index && dragFrom !== null) return "border-amber-500 bg-amber-100 ring-2 ring-amber-400";
    if (selected === index) return "border-blue-300 bg-blue-50";
    return "border-slate-100 bg-white";
  };

  return <div className="relative mb-2 rounded-lg bg-slate-50 p-2">
    <button type="button" onClick={() => beginEdit("new")} className="absolute right-2 top-2 rounded-full bg-blue-700 px-2 py-1 text-[10px] font-bold leading-none text-white shadow-sm">＋ 추가</button>
    <div className="mb-1 flex items-center justify-between pr-14">
      <span className="text-sm font-bold text-slate-900">기기 선택</span>
      <span className="text-[10px] text-slate-500">{labels.length ? `${forms.length}대 중 ${selected + 1}번 편집 중` : "기기 없음"}</span>
    </div>
    <div>
      {labels.length
        ? <button type="button" onClick={() => { setEditing(null); setOpen(true); }} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-800">
            <span className="min-w-0 whitespace-normal break-words leading-5">{labels[selected] || `${selected + 1}. (미상)`}</span><span className="shrink-0 text-[10px] text-slate-400">▾</span>
          </button>
        // 양식이 아직 없으면 "(미상)" 기기를 보여 주지 않는다 — 추가해야 1번이 생긴다(2026-10-12)
        : <button type="button" onClick={() => beginEdit("new")} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-500">
            <span className="min-w-0 leading-5">기기 없음 — ＋ 추가로 넣으면 점검 양식이 만들어집니다</span><span className="shrink-0 text-[12px] font-black text-blue-700">＋</span>
          </button>}
    </div>

    {open && <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setOpen(false)} role="dialog">
      <div className="flex max-h-[82vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-bold text-slate-800">{editing === "new" ? "새 기기 추가" : typeof editing === "number" ? `${editing + 1}번 기기 정보 수정` : "기기 선택·순서변경"}</div>
          <div className="flex items-center gap-1.5">
            {editing === null && <button type="button" onClick={() => beginEdit(selected)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">수정</button>}
            <button type="button" onClick={closeModal} className="rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">닫기</button>
          </div>
        </div>
        {editing !== null ? <div className="space-y-2 overflow-y-auto p-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">기기위치</span>
            <textarea autoFocus value={draft.location} onChange={(e) => setDraft((prev) => ({ ...prev, location: e.target.value }))} rows={2} placeholder={'예: 201호\n기업부설연구소'} className="mt-1 w-full resize-y rounded-xl border border-slate-200 px-3 py-3 text-base outline-none focus:border-slate-500" />
            <span className="mt-1 block text-[10px] text-slate-400">기기 번호는 자동으로 붙습니다. 여러 줄 입력도 가능합니다.</span>
          </label>
          {([['model','모델명'],['serial','시리얼넘버'],['asset','자산기번'],['content','내용']] as [keyof DeviceInfo,string][]).map(([key, label]) =>
            <label key={key} className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><input value={draft[key]} onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-base outline-none focus:border-slate-500" /></label>)}
          <div className="flex gap-2 pt-2"><button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600">뒤로</button><button type="button" onClick={save} className="flex-1 rounded-xl bg-blue-700 py-3 text-sm font-bold text-white">{editing === "new" ? "기기 추가" : "정보 저장"}</button></div>
        </div> : <div className="flex-1 overflow-y-auto p-2">
          {forms.map((_, i) => <div key={i} data-device-index={i} className={`mb-1 flex items-stretch gap-1 rounded-xl border p-1.5 transition ${rowClass(i)}`}>
            <button type="button" onPointerDown={(e) => beginDrag(e, i)} onPointerMove={trackDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} className={`w-9 shrink-0 touch-none rounded-lg text-lg font-bold leading-none active:bg-blue-200 ${dragFrom === i ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-500"}`}>≡</button>
            <button type="button" onClick={() => { onSelect(i); setOpen(false); }} className="min-w-0 flex-1 px-2 py-2 text-left"><div className="whitespace-normal break-words text-sm font-bold leading-5 text-slate-800">{labels[i] || `${i + 1}. (미상)`}</div></button>
            <button type="button" disabled={i === 0} onClick={() => onMove(i, -1)} className="hidden h-9 w-9 rounded-lg bg-slate-100 text-sm font-bold text-slate-600 disabled:opacity-25 sm:block">↑</button>
            <button type="button" disabled={i === forms.length - 1} onClick={() => onMove(i, 1)} className="hidden h-9 w-9 rounded-lg bg-slate-100 text-sm font-bold text-slate-600 disabled:opacity-25 sm:block">↓</button>
            {forms.length > 1 && <button type="button" onClick={() => onRemove(i)} className="h-9 rounded-lg bg-rose-50 px-2 text-[11px] font-bold text-rose-600">삭제</button>}
          </div>)}
        </div>}
      </div>
    </div>}
  </div>;
}
