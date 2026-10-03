/**
 * IT 학습·처리이력 상세 — 표를 그대로 나열하던 창 대신, 탭마다 '한눈에 들어오는' 카드(2026-10-03 사용자 요청).
 *  - 지식 DB: 부품 머리띠 → 설명 → 원인|증상 두 칸 → 교체기준 → 조치 단계(번호) → 주의 → AI 해설 → 이 항목 퀴즈
 *  - 처리이력: 증상 → 원인 → 조치 → 결과를 세로 흐름으로, 설정경로는 경로 조각, 고객응대는 말풍선
 *  - 영업상담: 상황 → 실전 멘트(말풍선·복사) → 핵심 포인트 → 접근·주의
 *  텍스트 안의 "→"·번호·줄바꿈을 단계로 쪼개 보여 준다. 남는 칸은 맨 아래 작은 표로.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, Copy, Cpu, ExternalLink, Lightbulb, Megaphone, Sparkles, Wrench } from "lucide-react";
import FormModal from "./FormModal";
import type { ItRow, ItTabKey } from "./itSheet";
import { splitChips, splitPath, splitSteps } from "./itText";

const str = (row: ItRow, ...keys: string[]) => { for (const k of keys) { const v = String(row[k] ?? "").trim(); if (v) return v; } return ""; };

const stripLead = (text: string, lead: RegExp) => text.replace(lead, "").trim();

type Tone = "cyan" | "emerald" | "violet" | "amber" | "rose" | "blue" | "slate";
const TONE: Record<Tone, { bg: string; border: string; text: string; dot: string; chip: string; hero: string }> = {
  cyan: { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-900", dot: "bg-cyan-500", chip: "bg-cyan-500/15 text-cyan-100", hero: "from-[#0B1F2A] to-[#0E3A4A]" },
  emerald: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-900", dot: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-100", hero: "from-[#0B1F17] to-[#0E3D2B]" },
  violet: { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-900", dot: "bg-violet-500", chip: "bg-violet-500/15 text-violet-100", hero: "from-[#1A1030] to-[#2E1A5E]" },
  amber: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-900", dot: "bg-amber-500", chip: "bg-amber-500/15 text-amber-100", hero: "" },
  rose: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-900", dot: "bg-rose-500", chip: "bg-rose-500/15 text-rose-100", hero: "" },
  blue: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-900", dot: "bg-blue-500", chip: "bg-blue-500/15 text-blue-100", hero: "" },
  slate: { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-800", dot: "bg-slate-400", chip: "bg-white/10 text-slate-200", hero: "" },
};

function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1600); } catch { /* 권한 없음 */ }
  };
  return <button type="button" onClick={() => void copy()} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black transition ${done ? "bg-emerald-600 text-white" : "bg-slate-900 text-white hover:bg-slate-700"}`}>{done ? <Check size={12} /> : <Copy size={12} />}{done ? "복사됨" : label}</button>;
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[10.5px] font-black uppercase tracking-[0.14em] text-slate-400">{children}</div>;
}

function Hero({ tone, icon, chips, title, sub }: { tone: Tone; icon: ReactNode; chips: string[]; title: string; sub?: string }) {
  const t = TONE[tone];
  return <div className={`-mx-5 -mt-5 mb-4 bg-gradient-to-br ${t.hero} px-5 py-4 text-white`}>
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${t.chip}`}>{icon}</span>
      {chips.filter(Boolean).map((c, i) => <span key={i} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${t.chip}`}>{c}</span>)}
    </div>
    <h2 className="mt-2.5 text-xl font-black leading-tight tracking-tight sm:text-2xl">{title}</h2>
    {sub && <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-white/75">{sub}</p>}
  </div>;
}

function Callout({ tone, icon, title, children }: { tone: Tone; icon?: ReactNode; title: string; children: ReactNode }) {
  const t = TONE[tone];
  return <div className={`rounded-2xl border ${t.border} ${t.bg} px-4 py-3`}>
    <div className={`flex items-center gap-1.5 text-[11px] font-black ${t.text}`}>{icon}{title}</div>
    <div className={`mt-1 text-[14px] font-semibold leading-relaxed ${t.text}`}>{children}</div>
  </div>;
}

function Text({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap break-words text-[14px] font-semibold leading-relaxed text-slate-800">{text}</div>;
}

function Steps({ items, tone }: { items: string[]; tone: Tone }) {
  const t = TONE[tone];
  if (items.length <= 1) return <Text text={items[0] || ""} />;
  return <ol className="space-y-1.5">
    {items.map((s, i) => <li key={i} className="flex items-start gap-2.5">
      <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${t.dot}`}>{i + 1}</span>
      <span className="pt-0.5 text-[14px] font-semibold leading-relaxed text-slate-800">{s}</span>
    </li>)}
  </ol>;
}

function Quote({ text, tone = "violet" }: { text: string; tone?: Tone }) {
  const t = TONE[tone];
  return <div className={`relative rounded-2xl ${t.bg} border ${t.border} px-4 py-3 pl-5`}>
    <span className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${t.dot}`} />
    <div className={`whitespace-pre-wrap break-words text-[15px] font-bold leading-[1.7] ${t.text}`}>“{text}”</div>
    <div className="mt-2 flex justify-end"><CopyButton text={text} label="멘트 복사" /></div>
  </div>;
}

function Flow({ items }: { items: Array<{ label: string; text: string; tone: Tone; steps?: boolean }> }) {
  const shown = items.filter((i) => i.text);
  return <ol className="relative ml-3 space-y-3 border-l-2 border-slate-200 pl-5">
    {shown.map((it, i) => <li key={i} className="relative">
      <span className={`absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-white ${TONE[it.tone].dot}`} />
      <div className={`text-[11px] font-black ${TONE[it.tone].text}`}>{it.label}</div>
      <div className="mt-0.5">{it.steps ? <Steps items={splitSteps(it.text)} tone={it.tone} /> : <Text text={it.text} />}</div>
    </li>)}
  </ol>;
}

function Chips({ items }: { items: string[] }) {
  return <div className="flex flex-wrap gap-1.5">{items.map((c, i) => <span key={i} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-bold text-slate-600">{c}</span>)}</div>;
}

function PathCrumbs({ text }: { text: string }) {
  const parts = splitPath(text);
  if (parts.length <= 1) return <code className="block rounded-xl bg-slate-900 px-3 py-2 text-[12.5px] font-bold text-emerald-200">{text}</code>;
  return <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-900 px-3 py-2">
    {parts.map((p, i) => <span key={i} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-emerald-200">{i > 0 && <ArrowRight size={12} className="text-slate-500" />}{p}</span>)}
  </div>;
}

/** 위 카드에서 안 쓴 칸들 — 작은 표로 */
function Rest({ row, used }: { row: ItRow; used: string[] }) {
  const keys = Object.keys(row).filter((k) => !used.includes(k) && !k.startsWith("_") && k !== "ID" && String(row[k] ?? "").trim());
  if (!keys.length) return null;
  return <details className="rounded-xl border border-slate-200">
    <summary className="cursor-pointer px-3 py-2 text-[11px] font-black text-slate-500">그 밖의 칸 {keys.length}개</summary>
    <div className="divide-y divide-slate-100 border-t border-slate-100">
      {keys.map((k) => <div key={k} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[120px_1fr]"><div className="text-[11px] font-black text-slate-400">{k}</div><div className="whitespace-pre-wrap text-[13px] font-semibold text-slate-700">{String(row[k])}</div></div>)}
    </div>
  </details>;
}

function Knowledge({ row }: { row: ItRow }) {
  const part = str(row, "부품명/항목", "부품명");
  const [showAnswer, setShowAnswer] = useState(false);
  const used = ["카테고리", "부품명/항목", "부품명", "설명", "대표원인", "증상", "교체기준", "조치방법", "퀴즈문제", "퀴즈답", "난이도", "AI설명", "AI해설", "소요시간", "주의사항"];
  const cause = str(row, "대표원인"), symptom = str(row, "증상"), ai = str(row, "AI해설", "AI설명"), quizQ = str(row, "퀴즈문제"), quizA = str(row, "퀴즈답");
  return <div className="space-y-3">
    <Hero tone="cyan" icon={<Cpu size={15} />} chips={[str(row, "카테고리"), str(row, "난이도") && `Lv.${str(row, "난이도")}`, str(row, "소요시간") && `⏱ ${str(row, "소요시간")}`]} title={part || "IT 지식"} sub={str(row, "설명")} />
    {(cause || symptom) && <div className="grid gap-2 sm:grid-cols-2">
      {cause && <Callout tone="rose" title="대표 원인"><Steps items={splitSteps(cause)} tone="rose" /></Callout>}
      {symptom && <Callout tone="amber" title="이런 증상"><Steps items={splitSteps(symptom)} tone="amber" /></Callout>}
    </div>}
    {str(row, "교체기준") && <div><Label>교체 기준</Label><Text text={str(row, "교체기준")} /></div>}
    {str(row, "조치방법") && <div><Label>조치 순서</Label><Steps items={splitSteps(str(row, "조치방법"))} tone="emerald" /></div>}
    {str(row, "주의사항") && <Callout tone="amber" icon={<AlertTriangle size={13} />} title="주의"><Text text={str(row, "주의사항")} /></Callout>}
    {ai && <Callout tone="violet" icon={<Sparkles size={13} />} title="AI 해설"><Text text={ai} /></Callout>}
    {quizQ && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-black text-slate-500">이 항목 퀴즈</div>
      <div className="mt-1 text-[14px] font-black text-slate-900">{quizQ}</div>
      <div className="mt-2">{showAnswer ? <span className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[13px] font-black text-white">{quizA}</span> : <button type="button" onClick={() => setShowAnswer(true)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11.5px] font-black text-slate-600 hover:bg-slate-100">정답 보기</button>}</div>
    </div>}
    <Rest row={row} used={used} />
  </div>;
}

function History({ row }: { row: ItRow }) {
  const used = ["등록자", "업체명", "자산번호", "자산기번", "레벨", "분류", "제조사", "모델명", "부품", "제목", "증상", "중지코드", "점검순서", "원인", "조치", "처리내용", "결과", "설정경로", "고객응대", "히스토리", "키워드", "원본링크", "등록일"];
  const device = [str(row, "제조사"), str(row, "모델명")].filter(Boolean).join(" ");
  const link = str(row, "원본링크");
  return <div className="space-y-3">
    <Hero tone="emerald" icon={<Wrench size={15} />} chips={[str(row, "분류"), str(row, "레벨") && `Lv.${str(row, "레벨")}`, device, str(row, "자산번호", "자산기번") && `#${str(row, "자산번호", "자산기번")}`, str(row, "부품")]}
      title={str(row, "제목") || str(row, "증상") || "처리이력"} sub={[str(row, "업체명"), str(row, "중지코드") && `중지코드 ${str(row, "중지코드")}`].filter(Boolean).join(" · ")} />
    <Flow items={[
      { label: "증상", text: str(row, "증상"), tone: "rose" },
      { label: "점검 순서", text: str(row, "점검순서"), tone: "amber", steps: true },
      { label: "원인", text: str(row, "원인"), tone: "amber" },
      { label: "조치", text: str(row, "조치", "처리내용"), tone: "blue", steps: true },
      { label: "결과", text: str(row, "결과"), tone: "emerald" },
    ]} />
    {str(row, "설정경로") && <div><Label>설정 경로</Label><PathCrumbs text={str(row, "설정경로")} /></div>}
    {str(row, "고객응대") && <div><Label>고객 응대</Label><Quote text={str(row, "고객응대")} tone="violet" /></div>}
    {str(row, "히스토리") && <Callout tone="slate" title="히스토리"><Text text={str(row, "히스토리")} /></Callout>}
    {str(row, "키워드") && <div><Label>키워드</Label><Chips items={splitChips(str(row, "키워드"))} /></div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11.5px] font-bold text-slate-400">
      <span>{[str(row, "등록자") && `등록 ${str(row, "등록자")}`, str(row, "등록일"), String(row._source || "") === "app" ? "앱에서 등록" : ""].filter(Boolean).join(" · ")}</span>
      {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white hover:bg-slate-700"><ExternalLink size={12} />원본 열기</a>}
    </div>
    <Rest row={row} used={used} />
  </div>;
}

function Sales({ row }: { row: ItRow }) {
  const used = ["구분", "항목명", "업무특성 및 상황", "고객 공감 및 실전 영업멘트", "권장사양 / 핵심 포인트", "접근방법 및 주의사항"];
  const ment = str(row, "고객 공감 및 실전 영업멘트"), point = str(row, "권장사양 / 핵심 포인트"), how = str(row, "접근방법 및 주의사항");
  return <div className="space-y-3">
    <Hero tone="violet" icon={<Megaphone size={15} />} chips={[str(row, "구분")]} title={str(row, "항목명") || "상담"} sub={str(row, "업무특성 및 상황")} />
    {ment && <div><Label>실전 멘트 — 이렇게 말하세요</Label><Quote text={ment} tone="violet" /></div>}
    {point && <Callout tone="blue" icon={<Lightbulb size={13} />} title="핵심 포인트"><Steps items={splitSteps(stripLead(point, /^핵심\s*[:：]\s*/))} tone="blue" /></Callout>}
    {how && <Callout tone="amber" icon={<AlertTriangle size={13} />} title="접근 방법 · 주의"><Steps items={splitSteps(how)} tone="amber" /></Callout>}
    <Rest row={row} used={used} />
  </div>;
}

export default function ItDetail({ row, tab, onClose }: { row: ItRow; tab: ItTabKey; onClose: () => void }) {
  const body = tab === "knowledge" ? <Knowledge row={row} /> : tab === "history" ? <History row={row} /> : tab === "sales" ? <Sales row={row} /> : <Rest row={row} used={[]} />;
  const title = tab === "knowledge" ? "지식 DB" : tab === "history" ? "처리이력" : tab === "sales" ? "영업상담" : "교육자료";
  return <FormModal wide onClose={onClose} title={<span className="text-sm font-black text-slate-500">IT 학습 · {title}</span>}
    footer={<button type="button" onClick={onClose} className="rounded-full bg-slate-900 px-6 py-2 text-xs font-black text-white transition hover:bg-slate-800">닫기</button>}>
    {body}
  </FormModal>;
}
