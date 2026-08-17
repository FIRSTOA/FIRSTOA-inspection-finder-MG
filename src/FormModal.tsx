import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * 등록/작성·상세 모달 공통 틀 — 다크 헤더 + 흰 본문 + 연회색 푸터.
 * 화면들의 [다크 상태줄 + 흰 카드] 문법을 모달에도 그대로 적용한다.
 * title/subtitle은 노드도 받는다 — 상세 모달은 칩 줄 + 큰 제목을 헤더에 넣는다.
 */
export default function FormModal({
  title, subtitle, icon, onClose, children, footer, wide = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean | "xl";
}) {
  // Esc로 닫기 — 바깥 클릭·X만 되던 것을 키보드로도. 여러 모달이 겹치면 가장 위(마지막 마운트)만 닫힌다
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-end bg-black/45 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${wide === "xl" ? "sm:max-w-4xl" : wide ? "sm:max-w-xl" : "sm:max-w-lg"}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 bg-[#1E252F] px-5 py-4">
          {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">{icon}</span>}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-black leading-snug text-white">{title}</div>
            {subtitle && <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white">
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">{children}</div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3.5">{footer}</div>
      </div>
    </div>
  );
}
