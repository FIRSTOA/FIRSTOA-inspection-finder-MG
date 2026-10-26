import { useState } from "react";
import { joinAssignees, MAX_ASSIGNEES, parseAssignees } from "./assignees";

/**
 * 담당자 배정 시트 — 여러 명 고르기(2026-10-22). 칩을 눌러 켜고 끄고, 켜진 칩의 번호 1번이 대표.
 * 최대 인원을 채우면 남은 칩은 잠긴다. [배정 저장]으로 한 번에 저장(아무도 안 고르면 미배정).
 * 폰은 바닥 시트, PC 는 가운데 창 — 예전 배정 팝업과 같은 색·크기.
 */
type Props = {
  names: string[];
  value: string;
  max?: number;
  title?: string;
  subtitle?: string;
  onSave: (value: string) => void;
  onClose: () => void;
};

export default function AssigneePicker({ names, value, max = MAX_ASSIGNEES, title = "담당자 배정", subtitle, onSave, onClose }: Props) {
  const [picked, setPicked] = useState<string[]>(() => parseAssignees(value).slice(0, max));
  // 지금 걸린 사람이 이 팀 명단에 없어도(다른 팀 지원 등) 칩으로 보여 준다 — 안 보이면 저장할 때 말없이 빠진다
  const candidates = [...names, ...parseAssignees(value).filter((n) => !names.includes(n))];
  const toggle = (name: string) => setPicked((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));

  return (
    <div className="fixed inset-0 z-[140] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-lg font-black text-slate-950">{title}</div>
        {subtitle && <div className="mt-1 text-sm font-semibold text-slate-500">{subtitle}</div>}
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-700">
            {picked.length ? <>선택: {picked.join(" · ")} <span className="font-bold text-slate-400">({picked.length}명)</span></> : <span className="text-slate-400">선택 없음 — 저장하면 미배정</span>}
          </span>
          {!!picked.length && <button type="button" onClick={() => setPicked([])} className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-500 hover:bg-slate-100">모두 해제</button>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {candidates.map((name) => {
            const index = picked.indexOf(name);
            const on = index >= 0;
            return (
              <button key={name} type="button" onClick={() => toggle(name)} aria-pressed={on}
                className={`relative rounded-full border px-3 py-3 text-sm font-black ${on ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                {on && <span className="absolute left-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-600 text-[11px] text-white">{index + 1}</span>}
                {name}
              </button>
            );
          })}
        </div>
        {!candidates.length && <div className="mt-3 text-sm font-semibold text-slate-400">이 팀은 배정할 명단이 없습니다.</div>}
        <div className="mt-2 text-[11px] font-bold text-slate-400">1번이 대표 · 한 명이 완료하면 일정 전체가 완료됩니다</div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-black text-slate-600 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">닫기</button>
          <button type="button" onClick={() => onSave(joinAssignees(picked, max))} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-black text-white hover:bg-emerald-700">배정 저장</button>
        </div>
      </div>
    </div>
  );
}
