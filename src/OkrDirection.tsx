// 핵심방향 띠(2026-10-20) — 월 통합집계 맨 위. 첫 줄은 머리글, 나머지는 "주간 실행 → 월말 확인 → 분기 정리" 단계로 나눠 보인다.
// 저장은 부모(onChange)가 한다. okr.ts 의 directionSteps 는 쓰지 않고(동시 작업) 아래 작은 헬퍼로 같은 일을 한다.
import { useState } from "react";
import { ArrowDown, ArrowRight, Check, Pencil, Target } from "lucide-react";

type StepKey = "week" | "month" | "quarter";
const STEP_META: Array<{ key: StepKey; no: string; title: string; word: RegExp }> = [
  { key: "week", no: "1", title: "주간 실행", word: /주간|매주|주차/ },
  { key: "month", no: "2", title: "월말 확인", word: /월말|매월|월 말/ },
  { key: "quarter", no: "3", title: "분기 정리", word: /분기\s*말|분기말|분기/ },
];

// 첫 줄 = 머리글, 나머지는 쉼표·마침표·줄바꿈 경계로 잘라 낱말로 단계를 고른다. 못 고른 조각은 rest(문단으로 보임).
function splitDirection(text: string): { headline: string; steps: Array<{ key: StepKey; text: string }>; rest: string[] } {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const headline = lines[0] || "";
  // lookbehind 없이(옛 사파리/폰 브라우저에서 (?<=) 는 SyntaxError 로 화면 전체가 안 뜸): 마침표 뒤 공백을 구분자로 바꾼 뒤 자른다
  const SEP = "⁣"; // 보이지 않는 구분자(INVISIBLE SEPARATOR) — 제어 문자가 아니라 eslint no-control-regex 에 걸리지 않는다
  const pieces = lines.slice(1).flatMap((l) => l.replace(/([.。])\s+/g, `$1${SEP}`).split(SEP).flatMap((seg) => seg.split(/,\s*(?=월말|분기|주간|매주)/))).map((s) => s.trim()).filter(Boolean);
  const got = new Map<StepKey, string[]>();
  const rest: string[] = [];
  for (const p of pieces) {
    const hit = STEP_META.find((s) => s.word.test(p));
    if (hit) got.set(hit.key, [...(got.get(hit.key) || []), p]); else rest.push(p);
  }
  return { headline, steps: STEP_META.filter((s) => got.has(s.key)).map((s) => ({ key: s.key, text: got.get(s.key)!.join(" ") })), rest };
}

export default function OkrDirection({ text, editable, onChange, label = "핵심방향" }: { text: string; editable: boolean; onChange: (t: string) => void; label?: string }) {
  const [editing, setEditing] = useState(false);
  const { headline, steps, rest } = splitDirection(text || "");
  const empty = !text.trim();
  return <section className="overflow-hidden rounded-xl border border-indigo-900/20 bg-white shadow-sm">
    <div className="flex items-center gap-2 bg-linear-to-r from-indigo-950 via-indigo-800 to-sky-600 px-3 py-2 text-white">
      <Target size={16} aria-hidden className="shrink-0 text-sky-200" />
      <div className="text-[13px] font-black tracking-wide">★ {label}</div>
      <div className="ml-auto">
        {editable && (editing
          ? <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-white/15 px-3 text-[12px] font-black text-white transition hover:bg-white/25 sm:min-h-8"><Check size={14} aria-hidden />완료</button>
          : <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-white/15 px-3 text-[12px] font-black text-white transition hover:bg-white/25 sm:min-h-8"><Pencil size={13} aria-hidden />고치기</button>)}
      </div>
    </div>
    {editing
      ? <div className="p-3">
        <textarea value={text} onChange={(e) => onChange(e.target.value)} rows={5} autoFocus placeholder="첫 줄은 핵심방향 한 문장, 아래 줄에는 주간 실행·월말 확인·분기 정리를 적어 주세요." className="w-full resize-y rounded-lg border border-slate-300 bg-[#FFFBEB] p-2 text-[13px] leading-relaxed text-slate-900 outline-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-200" />
        <div className="mt-1 text-[11px] text-slate-400">입력하는 대로 자동 저장됩니다. 끝나면 [완료]를 눌러 주세요.</div>
      </div>
      : empty
        ? <div className="px-3 py-4 text-[13px] text-slate-500">{editable ? "아직 핵심방향이 없습니다. [고치기]를 눌러 이번 달 핵심방향을 적어 주세요." : "아직 핵심방향이 등록되지 않았습니다."}</div>
        : <div className="space-y-2 px-3 py-3">
          <div className="text-[15px] font-black leading-snug text-slate-900">{headline}</div>
          {steps.length > 0 && <ol className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-stretch">
            {steps.map((s, i) => {
              const meta = STEP_META.find((m) => m.key === s.key)!;
              return <li key={s.key} className="flex flex-col items-stretch gap-1 sm:flex-1 sm:flex-row sm:items-stretch">
                <div className="flex-1 rounded-lg border border-indigo-100 bg-indigo-50 p-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-700 px-2 py-0.5 text-[11px] font-black text-white"><span className="tabular-nums">{meta.no}</span>{meta.title}</span>
                  <div className="mt-1 text-[12px] leading-snug text-slate-700">{s.text}</div>
                </div>
                {i < steps.length - 1 && <span className="flex items-center justify-center text-indigo-400" aria-hidden><ArrowDown size={16} className="sm:hidden" /><ArrowRight size={16} className="hidden sm:block" /></span>}
              </li>;
            })}
          </ol>}
          {rest.length > 0 && <div className="space-y-0.5 text-[12px] leading-snug text-slate-600">{rest.map((r, i) => <p key={i} className="whitespace-pre-wrap">{r}</p>)}</div>}
        </div>}
  </section>;
}
