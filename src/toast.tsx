import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

/**
 * 전역 알림.
 *
 * 브라우저 window.alert은 화면을 멈추고, 창 모양도 OS마다 달라 앱과 겉돈다.
 * 어느 컴포넌트에서든 notify()로 부를 수 있게 모듈 함수로 둔다.
 */
export type ToastKind = "success" | "error" | "info";
type Toast = { id: number; message: string; kind: ToastKind };

let seq = 0;
let listeners: Array<(toasts: Toast[]) => void> = [];
let items: Toast[] = [];

function emit() {
  listeners.forEach((listener) => listener([...items]));
}

export function notify(message: string, kind: ToastKind = "info") {
  const text = String(message || "").trim();
  if (!text) return;
  const toast: Toast = { id: ++seq, message: text, kind };
  items = [...items.slice(-3), toast];   // 4개까지만 쌓는다
  emit();
  // 오류는 읽을 시간이 더 필요하다
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== toast.id);
    emit();
  }, kind === "error" ? 7000 : 3500);
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>(items);
  useEffect(() => {
    listeners.push(setToasts);
    return () => { listeners = listeners.filter((listener) => listener !== setToasts); };
  }, []);
  if (!toasts.length) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[9000] flex flex-col items-center gap-2 px-3">
      {toasts.map((toast) => {
        const tone = toast.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800"
          : toast.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-white text-slate-800";
        const Icon = toast.kind === "error" ? CircleAlert : toast.kind === "success" ? CheckCircle2 : Info;
        return (
          <div key={toast.id}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-[13px] font-bold shadow-[0_10px_30px_rgba(15,23,42,0.16)] ${tone}`}>
            <Icon size={17} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{toast.message}</span>
            <button type="button" aria-label="닫기"
              onClick={() => { items = items.filter((item) => item.id !== toast.id); emit(); }}
              className="shrink-0 rounded-full p-0.5 opacity-50 transition hover:opacity-100"><X size={15} /></button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
