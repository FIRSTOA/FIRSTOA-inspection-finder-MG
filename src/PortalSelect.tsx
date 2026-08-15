import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/**
 * 공용 드롭다운.
 *
 * 네이티브 select는 OS가 목록을 그려서 그룹 구분이 흐리고 앱 톤과 겉돈다.
 * 목록은 body에 fixed로 띄운다 — 카드에 overflow-hidden(둥근 모서리)이 걸려 있으면
 * 안쪽에 absolute로 띄운 목록이 카드 경계에서 잘린다.
 */
export type PortalOption = { value: string; label: string; group?: string; hint?: string };

export default function PortalSelect({
  value, onChange, options, tone = "light", placeholder = "선택", hint, width = 220, className = "", disabled, direction = "auto",
}: {
  value: string;
  onChange: (next: string) => void;
  options: PortalOption[];
  tone?: "light" | "dark";
  placeholder?: string;
  hint?: string;            // 트리거에 함께 보여줄 부가정보 (예: 소속팀)
  width?: number;
  className?: string;
  disabled?: boolean;
  direction?: "auto" | "down"; // down = 항상 상자 바로 아래로 (모달 안에서 위로 튀는 것 방지)
}) {
  const [spot, setSpot] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom - 16;
    const above = box.top - 16;
    const openUp = direction === "auto" && below < 240 && above > below;   // 아래가 좁으면 위로 펼친다 (down 지정 시 항상 아래)
    const maxHeight = Math.min(420, Math.max(140, openUp ? above : below));
    const panelWidth = Math.max(width, box.width);
    setSpot({
      top: openUp ? box.top - 8 - maxHeight : box.bottom + 8,
      left: Math.min(Math.max(8, box.left), Math.max(8, window.innerWidth - panelWidth - 8)),
      maxHeight,
    });
  };

  useEffect(() => {
    if (!spot) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setSpot(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSpot(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [spot]);

  const current = options.find((option) => option.value === value);
  const groups: Array<[string, PortalOption[]]> = [];
  for (const option of options) {
    const key = option.group || "";
    const bucket = groups.find(([name]) => name === key);
    if (bucket) bucket[1].push(option);
    else groups.push([key, [option]]);
  }

  const triggerTone = tone === "dark"
    ? "border-white/15 bg-white/10 text-white hover:bg-white/20"
    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <>
      <button ref={triggerRef} type="button" disabled={disabled} aria-expanded={!!spot}
        onClick={() => (spot ? setSpot(null) : place())}
        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition disabled:opacity-40 ${triggerTone} ${className}`}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{current?.label || placeholder}</span>
          {hint && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black ${tone === "dark" ? "bg-white/10 text-slate-300" : "bg-slate-100 text-slate-500"}`}>{hint}</span>}
        </span>
        <ChevronDown size={14} className={`shrink-0 ${tone === "dark" ? "text-slate-400" : "text-slate-400"} transition ${spot ? "rotate-180" : ""}`} />
      </button>
      {spot && createPortal(
        <div ref={panelRef} style={{ position: "fixed", top: spot.top, left: spot.left, minWidth: width, maxHeight: spot.maxHeight }}
          className="z-[4000] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.22)]">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.map(([group, items]) => (
              <div key={group || "_"}>
                {group && <div className="sticky top-0 z-10 bg-slate-50/95 px-4 py-1.5 text-[10px] font-black tracking-wide text-slate-400 backdrop-blur">{group}</div>}
                {items.map((option) => (
                  <button key={option.value} type="button" onClick={() => { onChange(option.value); setSpot(null); }}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm ${option.value === value ? "bg-blue-50 font-black text-blue-700" : "font-bold text-slate-700 hover:bg-slate-50"}`}>
                    <span className="truncate">{option.label}</span>
                    {option.value === value ? <Check size={15} className="shrink-0" /> : option.hint ? <span className="shrink-0 text-[11px] font-bold text-slate-400">{option.hint}</span> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
