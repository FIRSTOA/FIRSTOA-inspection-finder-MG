// OKR 종합판정 드롭다운 (2026-09-24) — 셀 어디를 눌러도 열리고, 등급별 색 점이 붙은 목록이 셀 아래(공간이 없으면 위)로 뜬다.
// 표 안(overflow-x-auto)에서 잘리지 않도록 body에 포털로 그린다. 선택 → 즉시 닫힘, Esc·바깥 클릭으로 닫힘.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JUDGMENT_INFO, OKR_JUDGMENTS, type OkrJudgment } from "./okr";
import { dirFromKey, moveCellFocus } from "./cellNav";

export default function JudgmentPicker({ value, onChange, suggested }: { value: OkrJudgment | ""; onChange: (next: string) => void; suggested?: OkrJudgment | "" }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const place = () => {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const need = 6 * 34 + 44; // 항목 6줄 + 여백
    const up = window.innerHeight - box.bottom < need && box.top > need;
    setSpot({ top: up ? box.top - 4 : box.bottom + 4, left: Math.min(Math.max(8, box.left), window.innerWidth - 168), up });
  };
  useEffect(() => {
    if (!spot) return;
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setSpot(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setSpot(null); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [spot]);
  const pick = (next: string) => { onChange(next); setSpot(null); };
  return <>
    <button ref={triggerRef} type="button" data-cell onClick={() => (spot ? setSpot(null) : place())}
      onKeyDown={(e) => {
        const dir = dirFromKey(e.key);
        if (dir && !spot && triggerRef.current) { e.preventDefault(); moveCellFocus(triggerRef.current, dir); return; }
        if (e.key === "Tab" && triggerRef.current) { e.preventDefault(); setSpot(null); moveCellFocus(triggerRef.current, e.shiftKey ? "left" : "right"); return; }
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onChange(""); setSpot(null); }
      }}
      className={`flex min-h-[2.75rem] w-full items-start justify-between gap-1 px-2 py-1.5 text-left text-[12px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${value ? "" : "text-slate-400"}`}>
      <span className="flex items-center gap-1.5">{value && <span className={`h-2 w-2 shrink-0 rounded-full ${JUDGMENT_INFO[value].dot}`} />}{value || "선택"}</span>
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" className={`mt-0.5 shrink-0 ${value ? "opacity-50" : "text-slate-400"}`}><path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {spot && createPortal(
      <div ref={panelRef} style={{ position: "fixed", top: spot.top, left: spot.left, transform: spot.up ? "translateY(-100%)" : undefined, width: 160, zIndex: 3000 }}
        className="overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-[0_12px_32px_rgba(15,23,42,0.18)]">
        {OKR_JUDGMENTS.map((j) => <button key={j} type="button" onClick={() => pick(j)} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-bold text-slate-800 transition hover:bg-slate-100 ${value === j ? "bg-slate-100" : ""}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${JUDGMENT_INFO[j].dot}`} />{j}
          {suggested === j && value !== j && <span className="ml-auto text-[10px] font-bold text-slate-400">제안</span>}
          {value === j && <span className="ml-auto text-[11px] text-slate-500">✓</span>}
        </button>)}
        {value && <button type="button" onClick={() => pick("")} className="mt-0.5 w-full border-t border-slate-100 px-2.5 py-1.5 text-left text-[11px] font-bold text-slate-400 transition hover:bg-slate-50 hover:text-slate-700">지우기</button>}
      </div>,
      document.body,
    )}
  </>;
}
