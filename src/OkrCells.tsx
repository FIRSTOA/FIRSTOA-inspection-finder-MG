// OKR 표 칸 부품 — OkrHub.tsx 에 있던 것을 그대로 옮겼다(2026-10-20). FreshBottleneckCell·JudgmentDots 만 새로 더했다(분기 → 월 → 주 화면).
import { useState, type ReactNode } from "react";
import { JUDGMENT_INFO, OKR_PILLARS, bottleneckText, normalizeJudgment, pillarLabel, type OkrGoal, type OkrTeamCard } from "./okr";
import { TD_READ, shortBottleneck, teamName } from "./okrUi";
import { layerChipLabel, type LayerFold, type LayerFoldGroup } from "./okrLayerView";

// 파트 카드(월·분기 통합집계 공용, 2026-10-21 OkrMonthRollup 에서 옮김) — 파트 이름 · 판정 n/총 · 달성 % · 미흡·미착수 · 파트장. onClick 이 있으면 단추
// note(2026-10-25 저녁): 판정 칸 아래 작은 글 — 예) "(전용 2행 포함)"(카드 분모 = 공통 + 그 파트 전용 + 파트원 개인 전용, 표는 공통만)
export function TeamCard({ card, onClick, note }: { card: OkrTeamCard; onClick?: () => void; note?: string }) {
  const { team, total, judged, alerts, rate, leader } = card;
  const body = <>
    <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{teamName(team)}</div><div className="text-right text-[11px] font-bold tabular-nums text-slate-400">{judged >= total && total ? "제출 완료" : `판정 ${judged}/${total}`}{note && <div className="text-[10px] font-semibold text-slate-400">{note}</div>}</div></div>
    <div className="mt-1 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{rate === null ? "—" : `${rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-right text-[11px] font-bold">{alerts > 0 ? <span className="text-rose-600">미흡·미착수 {alerts}</span> : <span className="text-slate-300">미흡 없음</span>}</div></div>
    <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-400">{leader ? `파트장 ${leader}` : "파트장 미기재"}</div>
  </>;
  if (!onClick) return <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">{body}</div>;
  return <button type="button" onClick={onClick} title={`${teamName(team)} 열기`} className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-400">{body}</button>;
}

export const ResizeHandle = ({ onDrag, onReset }: { onDrag: (e: React.MouseEvent) => void; onReset: () => void }) => <span onMouseDown={onDrag} onDoubleClick={onReset} title="끌어서 너비 조절 · 두 번 누르면 기본" className="absolute -right-[3px] top-0 z-10 h-full w-[7px] cursor-col-resize select-none hover:bg-slate-400/60" />;

// Pillar 행 머리 — 표 위 가로 막대. 고칠 수 있는 화면에서는 여기서 Pillar를 바꾼다.
// 2026-10-25: 새 구조 화면(분기·월 통합집계)은 띠 위 "＋ 병목" 대신 묶음 맨 아래 AddGoalRow 를 쓴다 — onAdd 를 넘기는 옛 화면(9월 이하)만 띠 위 단추가 남는다.
export function PillarBar({ idx, colSpan, editable, onPillar, onAdd }: { idx: number; colSpan: number; editable: boolean; onPillar: (i: number) => void; onAdd?: () => void }) {
  return <tr><td colSpan={colSpan} className="border border-slate-800 bg-slate-800 px-2 py-1 text-[12px] font-black text-white">
    <div className="flex items-center gap-3">
      {editable
        ? <select value={String(idx)} onChange={(e) => onPillar(Number(e.target.value))} className="cursor-pointer bg-slate-800 text-[12px] font-black text-white outline-none">
          <option value="-1">Pillar 미정</option>
          {OKR_PILLARS.map((p, i) => <option key={p.label} value={String(i)}>Pillar {i + 1} · {p.label}</option>)}
        </select>
        : <span className="px-1">{idx >= 0 ? `Pillar ${idx + 1} · ${OKR_PILLARS[idx].label}` : "Pillar 미정"}</span>}
      {editable && onAdd && <button type="button" onClick={onAdd} className="ml-auto text-[11px] font-bold text-slate-400 hover:text-white">＋ 병목</button>}
    </div>
  </td></tr>;
}

// [＋ 병목 추가] 줄(2026-10-25) — Pillar 묶음 맨 아래, 표 폭 전체 점선. 누르면 그 Pillar 끝에 빈 행.
// note(2026-10-25 파트 탭): 단추 오른쪽 작은 글 — 예) "모든 파트 공통"
export function AddGoalRow({ colSpan, pillarIdx, onAdd, note }: { colSpan: number; pillarIdx: number; onAdd: () => void; note?: string }) {
  const name = pillarIdx >= 0 ? `Pillar ${pillarIdx + 1} · ${OKR_PILLARS[pillarIdx].label}` : "Pillar 미정";
  return <tr><td colSpan={colSpan} className="border border-slate-200 bg-white p-1">
    <button type="button" onClick={onAdd} title={`${name} 묶음 끝에 병목 한 줄 추가`} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-[12px] font-black text-slate-500 transition hover:border-slate-500 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-500">
      <span aria-hidden className="text-base leading-none">＋</span>병목 추가<span className="font-semibold text-slate-400"> · {name}</span>
      {note && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{note}</span>}
    </button>
  </td></tr>;
}

// 행 주인 칩(2026-10-25 저녁, 밤 글 바꿈) — 병목현상 칸 위 작은 글 "A파트" · "홍길동". 공통 행은 label 이 빈 글이라 안 그린다.
export function LayerChip({ label }: { label: string }) {
  if (!label) return null;
  return <span className="mb-0.5 inline-flex rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-violet-700">{label}</span>;
}

// 판정 잠금 칸(2026-10-25 밤) — 이 화면이 그 행의 판정 대상이 아닐 때 실제결과~근거자료 자리를 한 칸 빗금으로("홍길동 전용 — 본인이 판정")
export function JudgmentLockCell({ colSpan, text }: { colSpan: number; text: string }) {
  return <td colSpan={colSpan} className="border border-slate-200 bg-[repeating-linear-gradient(135deg,#f1f5f9_0,#f1f5f9_4px,#fff_4px,#fff_8px)] px-3 py-2 align-middle">
    <span className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">{text}</span>
  </td>;
}

// 아래 층 행 접힘(2026-10-25 저녁) — 그 화면 표에는 없는 전용 행 목록(읽기). 줄을 누르면 그 파트 종합/그 사람 주차로.
//   kind rollup = 통합집계("파트 전용 n행 · 개인 전용 m행") · part = 파트 종합("개인 전용 m행(홍길동 2·김철수 1)")
//   orphan(명단에 없는 이름) 묶음은 "주인 없음"으로 드러내고 onArchive 가 있으면 줄마다 [정리](삭제·보관 확인창은 부모가)
export function LayerRowsFold({ fold, kind, onOpen, onArchive }: { fold: LayerFold; kind: "rollup" | "part"; onOpen?: (g: LayerFoldGroup) => void; onArchive?: (goal: OkrGoal) => void }) {
  const [open, setOpen] = useState(false);
  if (!fold.groups.length) return null;
  const people = fold.groups.filter((g) => g.member).map((g) => `${g.member} ${g.goals.length}`).join("·");
  const head = kind === "rollup" ? `파트 전용 ${fold.teamRows}행 · 개인 전용 ${fold.memberRows}행` : `개인 전용 ${fold.memberRows}행${people ? `(${people})` : ""}`;
  return <div className="border-t border-slate-200 bg-slate-50 px-3 py-1">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-1 text-left text-[12px] font-black text-slate-600 hover:text-slate-900">
      <span aria-hidden className="w-3">{open ? "▾" : "▸"}</span>{head}<span className="font-semibold text-slate-400"> — {kind === "rollup" ? "표에는 공통 행만, 판정은 파트 카드 % 에 들어갑니다" : "표에는 없고 판정은 % 에 들어갑니다"}</span>
    </button>
    {open && <ul className="space-y-1.5 pb-2">
      {fold.groups.map((grp) => <li key={`${grp.team}|${grp.member || ""}`} className="rounded-lg border border-slate-200 bg-white px-2 py-1">
        <button type="button" disabled={!onOpen} onClick={() => onOpen?.(grp)} className="flex min-h-9 w-full items-center gap-1.5 text-left text-[11px] font-black text-slate-700 enabled:hover:underline">
          {grp.member ? `${teamName(grp.team)} · ${grp.member}` : `${teamName(grp.team)} 전용`}
          {grp.orphan && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">주인 없음(명단에 없는 이름)</span>}
          <span className="font-semibold text-slate-400">{grp.goals.length}행</span>
        </button>
        <ul className="space-y-0.5">{grp.goals.map((g) => <li key={g.no} className="flex items-center gap-2 text-[12px] leading-snug">
          <span className="w-20 shrink-0 truncate text-[10px] font-bold text-slate-400">{pillarLabel(g.pillar) || "Pillar 미정"}</span>
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{bottleneckText(g.bottleneck) || g.objective.trim() || "(빈 병목)"}</span>
          {grp.orphan && onArchive && <button type="button" onClick={() => onArchive(g)} className="min-h-9 shrink-0 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] font-black text-slate-600 hover:bg-slate-100">정리</button>}
        </li>)}</ul>
      </li>)}
    </ul>}
  </div>;
}

// 보관된 병목(2026-10-25) — 표 아래 접힘. 기록(실제결과·판정)이 있어 지우는 대신 숨긴 행. [되살리기] = 같은 자리·같은 번호로.
export function ArchivedGoals({ goals, onRestore }: { goals: OkrGoal[]; onRestore?: (no: number) => void }) {
  const [open, setOpen] = useState(false);
  if (!goals.length) return null;
  return <div className="border-t border-slate-200 bg-slate-50 px-3 py-1">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-1 text-left text-[12px] font-black text-slate-600 hover:text-slate-900">
      <span aria-hidden className="w-3">{open ? "▾" : "▸"}</span>보관된 병목 {goals.length}개<span className="font-semibold text-slate-400"> — 지난 판정은 그대로 남아 있습니다</span>
    </button>
    {open && <ul className="space-y-1 pb-2">
      {goals.map((g) => <li key={g.no} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
        <div className="min-w-0 flex-1 text-[12px] leading-snug">
          <div className="text-[10px] font-bold text-slate-400">{pillarLabel(g.pillar) || "Pillar 미정"}{layerChipLabel(g) && <span className="ml-1 text-violet-700">· {layerChipLabel(g)}</span>}</div>
          <div className="truncate font-bold text-slate-700">{bottleneckText(g.bottleneck) || g.objective.trim() || "(빈 병목)"}</div>
        </div>
        {onRestore && <button type="button" onClick={() => onRestore(g.no)} className="min-h-11 shrink-0 rounded-full border border-slate-300 bg-white px-3 text-[12px] font-black text-slate-700 hover:bg-slate-100">되살리기</button>}
      </li>)}
    </ul>}
  </div>;
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
  const kind = !j ? "없음" : cell.source === "set" ? "확정" : "자동(마지막 주차)";
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
