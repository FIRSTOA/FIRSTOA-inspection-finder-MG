// OKR 표 칸 부품 — OkrHub.tsx 에 있던 것을 그대로 옮겼다(2026-10-20). FreshBottleneckCell·JudgmentDots 만 새로 더했다(분기 → 월 → 주 화면).
import type { ReactNode } from "react";
import { JUDGMENT_INFO, OKR_PILLARS, bottleneckText, normalizeJudgment, type OkrGoal } from "./okr";
import { TD_READ, shortBottleneck } from "./okrUi";

export const ResizeHandle = ({ onDrag, onReset }: { onDrag: (e: React.MouseEvent) => void; onReset: () => void }) => <span onMouseDown={onDrag} onDoubleClick={onReset} title="끌어서 너비 조절 · 두 번 누르면 기본" className="absolute -right-[3px] top-0 z-10 h-full w-[7px] cursor-col-resize select-none hover:bg-slate-400/60" />;

// Pillar 행 머리 — 표 위 가로 막대. 고칠 수 있는 화면(파트 종합·통합집계)에서는 여기서 Pillar를 바꾸고 병목을 추가한다.
export function PillarBar({ idx, colSpan, editable, onPillar, onAdd }: { idx: number; colSpan: number; editable: boolean; onPillar: (i: number) => void; onAdd: () => void }) {
  return <tr><td colSpan={colSpan} className="border border-slate-800 bg-slate-800 px-2 py-1 text-[12px] font-black text-white">
    <div className="flex items-center gap-3">
      {editable
        ? <select value={String(idx)} onChange={(e) => onPillar(Number(e.target.value))} className="cursor-pointer bg-slate-800 text-[12px] font-black text-white outline-none">
          <option value="-1">Pillar 미정</option>
          {OKR_PILLARS.map((p, i) => <option key={p.label} value={String(i)}>Pillar {i + 1} · {p.label}</option>)}
        </select>
        : <span className="px-1">{idx >= 0 ? `Pillar ${idx + 1} · ${OKR_PILLARS[idx].label}` : "Pillar 미정"}</span>}
      {editable && <button type="button" onClick={onAdd} className="ml-auto text-[11px] font-bold text-slate-400 hover:text-white">＋ 병목</button>}
    </div>
  </td></tr>;
}

// 병목 칸 — "병목 n" + 작은 ×(목표 삭제, 고칠 수 있을 때만)
export function BottleneckCell({ goals, goal, alert, alertTone, editable, onRemove }: { goals: OkrGoal[]; goal: OkrGoal; alert: boolean; alertTone: string; editable: boolean; onRemove: (g: OkrGoal) => void }) {
  return <td className={`${TD_READ} text-[11px] font-bold text-slate-500 ${alert ? `border-l-4 ${alertTone}` : ""}`}>
    <div className="flex items-start justify-between gap-1">{shortBottleneck(goals, goal.no)}{editable && <button type="button" title="이 목표 삭제" onClick={() => onRemove(goal)} className="text-slate-300 hover:text-rose-600">×</button>}</div>
  </td>;
}

// 병목현상 칸(새 구조, 읽기) — 위 작은 회색 "병목 n" + 아래 병목현상 글(옛 꼬리표뿐이면 빈 글)
export function FreshBottleneckCell({ goals, goal, alert, alertTone, extra }: { goals: OkrGoal[]; goal: OkrGoal; alert: boolean; alertTone: string; extra?: ReactNode }) {
  const text = bottleneckText(goal.bottleneck);
  return <td className={`${TD_READ} ${alert ? `border-l-4 ${alertTone}` : ""}`}>
    <div className="text-[10px] font-bold text-slate-400">{shortBottleneck(goals, goal.no)}</div>
    {text && <div className="whitespace-pre-wrap text-[11px] leading-snug text-slate-600">{text}</div>}
    {extra}
  </td>;
}

export function JudgmentBadge({ value }: { value: string }) {
  const j = normalizeJudgment(value);
  if (!j) return <span className="text-[11px] text-slate-300">—</span>;
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-bold ${JUDGMENT_INFO[j].tone}`}>{j}</span>;
}

// 주차 판정 점 — 1주·2주… 순서로 등급 색 점(빈 주는 회색 테두리)
export function JudgmentDots({ values, titles }: { values: string[]; titles?: string[] }) {
  return <span className="inline-flex items-center gap-0.5">
    {values.map((v, i) => { const j = normalizeJudgment(v); return <span key={i} title={titles?.[i] ? `${titles[i]}${j ? ` · ${j}` : ""}` : j || undefined} className={`inline-block h-2 w-2 rounded-full ${j ? JUDGMENT_INFO[j].dot : "border border-slate-300 bg-white"}`} />; })}
  </span>;
}

// 판정 동그라미(새 구조, 2026-10-20) — 채운 ● = 사람이 고른 판정(set), 속 빈 ○ = 아래 단계에서 계산한 제안(suggest), 없으면 —.
// cell 은 okr.ts 의 OkrJudgedCell 과 같은 모양(구조가 같아 그대로 넘기면 된다). label = 열 머리 이름(툴팁·스크린리더용, 예 "A파트"·"10월").
export type JudgedCellLike = { judgment: string; source: "set" | "suggest" | "" };
const DOT_RING: Record<string, string> = { 완료: "border-emerald-500", 해당없음: "border-slate-400", 부분달성: "border-amber-400", 미흡: "border-orange-500", 미착수: "border-rose-500" };
export function JudgmentDot({ cell, size = 14, onClick, title, label }: { cell: JudgedCellLike; size?: number; onClick?: () => void; title?: string; label?: string }) {
  const j = normalizeJudgment(cell.judgment);
  const kind = !j ? "없음" : cell.source === "set" ? "확정" : "제안";
  const tip = title || [label, j || "기록 없음", j ? kind : ""].filter(Boolean).join(" · ");
  const shape = !j
    ? <span className="text-[11px] text-slate-300">—</span>
    : cell.source === "set"
      ? <span style={{ width: size, height: size }} className={`inline-block rounded-full ${JUDGMENT_INFO[j].dot}`} />
      : <span style={{ width: size, height: size }} className={`inline-block rounded-full border-2 bg-white ${DOT_RING[j]}`} />;
  if (!onClick) return <span title={tip} aria-label={tip} className="inline-flex min-h-6 min-w-6 items-center justify-center">{shape}</span>;
  // 눌러서 이동하는 점 — 폰에서도 누르기 쉽게 눌림 영역만 키운다(점 크기는 그대로)
  return <button type="button" title={tip} aria-label={tip} onClick={(e) => { e.stopPropagation(); onClick(); }} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 sm:min-h-7 sm:min-w-7">{shape}</button>;
}

// tbody 안에서 여러 행을 묶는 용도
export function FragmentRows({ children }: { children: ReactNode }) { return <>{children}</>; }
