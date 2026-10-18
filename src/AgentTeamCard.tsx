import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AGENT_DEPTS, AGENT_FLOW, AGENT_LEADER, type AgentModel } from "./agentTeam";

const card = "rounded-2xl border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const eyebrow = "text-[10px] font-black uppercase tracking-[0.16em] text-slate-500";
const MODEL_STYLE: Record<AgentModel, string> = {
  opus: "bg-violet-500/20 text-violet-200",
  sonnet: "bg-sky-500/20 text-sky-200",
  haiku: "bg-emerald-500/20 text-emerald-200",
};

/** 홈 하단 안내 카드: 팀장 + 부서 단추 → 고른 부서 역할 인라인 펼침 (온보딩 스테퍼와 같은 방식). */
export default function AgentTeamCard() {
  const [openDept, setOpenDept] = useState(AGENT_DEPTS[0].name);
  const dept = AGENT_DEPTS.find((d) => d.name === openDept);
  return (
    <div className="relative border-t border-white/[0.08] px-4 py-5 sm:px-6">
      <div className={`min-w-0 ${card}`}>
        <div className="border-b border-white/[0.08] px-4 py-3.5">
          <div className={eyebrow}>AI Agent Team</div>
          <h3 className="mt-0.5 text-[13.5px] font-black text-white">FIELD를 만들고 지키는 AI 에이전트 팀</h3>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">2026-10-19 도입 · 역할 파일은 저장소 .claude/agents/ · 급에 따라 모델을 나눠 씁니다</p>
          <div className="mt-3 flex items-start gap-3 rounded-xl bg-white/[0.04] p-3">
            <span className="text-2xl leading-none" aria-hidden>{AGENT_LEADER.emoji}</span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-black text-white">{AGENT_LEADER.title} · {AGENT_LEADER.name}</div>
              <div className="mt-0.5 text-[11.5px] font-semibold leading-4 text-slate-400">{AGENT_LEADER.desc}</div>
            </div>
          </div>
          <div className="mt-2 text-[11.5px] font-black text-slate-300">{AGENT_FLOW}</div>
        </div>
        <div className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-4 lg:grid-cols-7">
          {AGENT_DEPTS.map((d) => {
            const open = openDept === d.name;
            return (
              <button key={d.name} type="button" aria-expanded={open} onClick={() => setOpenDept(open ? "" : d.name)} className={`flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[12.5px] font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${open ? "bg-white text-slate-950" : "bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"}`}>
                <span>{d.name} <span className="text-[10.5px] font-bold text-slate-500">{d.roles.length}</span></span>
                <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
              </button>
            );
          })}
        </div>
        {dept && (
          <ul className="grid grid-cols-1 gap-2 border-t border-white/[0.08] p-3 sm:grid-cols-2 lg:grid-cols-3">
            {dept.roles.length === 0 && <li className="text-[12px] font-semibold text-slate-500">준비 중</li>}
            {dept.roles.map((r) => (
              <li key={r.key} className="rounded-xl bg-white/[0.04] p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl leading-none" aria-hidden>{r.emoji}</span>
                  <span className="text-[13px] font-black text-white">{r.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${MODEL_STYLE[r.model]}`}>{r.model}</span>
                </div>
                <div className="mt-1 font-mono text-[10.5px] font-semibold text-slate-500">{r.key}</div>
                <div className="mt-1.5 text-[12px] font-bold leading-4 text-slate-200">{r.desc}</div>
                <div className="mt-1 text-[11px] font-semibold leading-4 text-slate-400">언제: {r.trigger}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
