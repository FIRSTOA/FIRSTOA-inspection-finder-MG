import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";
import { UI } from "./card";

/**
 * 로딩·빈·에러 공용 상태 박스. 문구는 존댓말.
 *  - inside: 카드 안에 넣을 때(테두리 없이 안쪽 여백만). 기본은 단독 카드.
 *  - onRetry: 에러일 때 [다시 시도] 단추(min-h-11).
 */
export type StateKind = "loading" | "empty" | "error";

const DEFAULT_TEXT: Record<StateKind, string> = {
  loading: "불러오는 중입니다…",
  empty: "표시할 내용이 없습니다.",
  error: "불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

export default function StateBox({ kind, message, hint, inside = false, onRetry }: {
  kind: StateKind;
  message?: string;
  hint?: string;
  inside?: boolean;
  onRetry?: () => void;
}) {
  const text = message || DEFAULT_TEXT[kind];
  const color = kind === "error" ? "text-rose-700" : "text-slate-400";
  return (
    <div role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}
      className={`${inside ? "" : UI.card} flex flex-col items-center justify-center gap-2 px-4 py-10 text-center`}>
      {kind === "loading" && <LoaderCircle size={22} className="animate-spin text-blue-600" aria-hidden="true" />}
      {kind === "empty" && <Inbox size={24} className="text-slate-300" aria-hidden="true" />}
      {kind === "error" && <AlertCircle size={24} className="text-rose-500" aria-hidden="true" />}
      <p className={`max-w-md break-keep text-sm font-bold ${color}`}>{text}</p>
      {hint && <p className="max-w-md break-keep text-[11px] font-semibold text-slate-400">{hint}</p>}
      {kind === "error" && onRetry && <button type="button" onClick={onRetry} className={`${UI.btnGhost} mt-1`}>다시 시도</button>}
    </div>
  );
}
