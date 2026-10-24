/**
 * 필드 양식 숫자·항목 고르기(아래에서 올라오는 시트). App.tsx에서 글자 그대로 옮겨 왔다(2026-10-24, docs/tasks/field-form-tidy.md S2).
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export type NumSelectProps = {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: string[];
  placeholder?: string;
  accent: string;
  suffix?: string;
};

export function NumSelect({ value, onChange, options, labels, placeholder, accent, suffix }: NumSelectProps) {
  const [open, setOpen] = useState(false);
  const filled = value !== "";
  const label = placeholder ?? "선택";
  const labelFor = (v: string): string => {
    if (labels) {
      const idx = options.indexOf(v);
      if (idx >= 0) return labels[idx];
    }
    return `${v}${suffix ?? ""}`;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm outline-none transition active:scale-[0.99]"
        style={{
          background: "white",
          border: "1px solid #CBD5E1",
          borderLeft: filled ? `3px solid ${accent}` : "1px solid #CBD5E1",
          fontWeight: filled ? 600 : 400,
          color: filled ? "#0F172A" : "#64748B",
        }}
      >
        <span className="truncate">{filled ? labelFor(value) : label}</span>
        <ChevronDown size={14} className="ml-1 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <div
            className="flex w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-xl"
            style={{ maxHeight: "75vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full px-2.5 py-1 text-xs text-slate-500 transition hover:bg-slate-100"
              >
                닫기
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="block w-full px-5 py-3 text-left text-sm text-slate-500 transition active:bg-slate-100"
              >
                해제
              </button>
              {options.map((opt: string, i: number) => {
                const active = value === opt;
                const text = labels?.[i] ?? `${opt}${suffix ?? ""}`;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className="block w-full px-5 py-3 text-left text-sm transition active:bg-slate-100"
                    style={{
                      background: active ? accent : "transparent",
                      color: active ? "white" : "#0F172A",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
