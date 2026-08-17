/**
 * 전역 확인 모달 — window.confirm 대체.
 * 브라우저 기본 confirm은 웹뷰·팝업차단 환경에서 창이 안 뜬 채 false를 돌려줘
 * "버튼을 눌렀는데 아무 일도 없는" 무음 실패를 만든다(분기안내 공용문구 사고의 원인 중 하나).
 * askConfirm은 앱이 직접 그리는 모달이라 어디서든 뜨고, Promise<boolean>으로 같은 형태로 쓴다:
 *   if (!await askConfirm("삭제할까요?")) return;
 */
import { useEffect, useState } from "react";

type ConfirmRequest = { message: string; danger?: boolean; okLabel?: string; resolve: (value: boolean) => void };

let pushRequest: ((req: ConfirmRequest) => void) | null = null;

export function askConfirm(message: string, opts?: { danger?: boolean; okLabel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushRequest) { resolve(window.confirm(message)); return; } // 호스트 미장착(테스트 등) 폴백
    pushRequest({ message, danger: opts?.danger, okLabel: opts?.okLabel, resolve });
  });
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<ConfirmRequest | null>(null);
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  useEffect(() => {
    pushRequest = (req) => setQueue((prev) => [...prev, req]);
    return () => { pushRequest = null; };
  }, []);
  useEffect(() => {
    if (!current && queue.length) {
      setCurrent(queue[0]);
      setQueue((prev) => prev.slice(1));
    }
  }, [current, queue]);
  if (!current) return null;
  const answer = (value: boolean) => { current.resolve(value); setCurrent(null); };
  return (
    <div className="fixed inset-0 z-[4000] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" onMouseDown={() => answer(false)}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="whitespace-pre-wrap px-5 pb-4 pt-5 text-[14px] font-bold leading-6 text-slate-800">{current.message}</div>
        <div className="flex gap-2 px-4 pb-4">
          <button type="button" onClick={() => answer(false)} className="flex-1 rounded-xl border border-slate-200 bg-white py-3 text-sm font-black text-slate-500 transition hover:bg-slate-50">취소</button>
          <button type="button" autoFocus onClick={() => answer(true)}
            className={`flex-[1.4] rounded-xl py-3 text-sm font-black text-white transition ${current.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-900 hover:bg-slate-800"}`}>
            {current.okLabel || "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
