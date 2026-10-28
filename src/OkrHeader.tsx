// OKR 새 구조 머리(2026-10-21 6차) — 짙은 띠(제목·연도·분기·월 칩)와 흰 카드(탭 → 경로 줄 → 사람 알약 → 주차 칩 → 표)를 한 덩어리로.
// 옛 화면(8·9월·SQL 전)은 OkrHub 의 옛 머리·PersonBox·주차 칩을 그대로 쓴다 — 여기 부품은 새 구조(quarterMode: 분기 화면·새 달)에서만.
import type { ReactNode } from "react";
import PortalSelect from "./PortalSelect";
import { isAlert, normalizeJudgment, type OkrResultRow } from "./okr";

// ── 짙은 띠: "CS팀 OKR" + [연도][분기] + 월 칩(통합집계면 [n분기] 포함). 기간 알약·동기화·큰 제목은 없다 ──
export type BandChip = { id: string; label: string; on: boolean; now: boolean; title?: string; onClick: () => void };
// [엑셀](2026-10-28): onExport 를 줄 때만 보인다(옛 구조 분기면 OkrHub 가 안 줌). exporting = 만드는 중(비활성)
export function OkrTopBand({ years, year, quarter, chips, onYear, onQuarter, onExport, exporting }: { years: number[]; year: number; quarter: number; chips: BandChip[]; onYear: (y: number) => void; onQuarter: (q: number) => void; onExport?: () => void; exporting?: boolean }) {
  const chip = (on: boolean, now: boolean) => `relative shrink-0 rounded-md px-2.5 py-1 text-[12px] font-bold tabular-nums transition ${on ? "bg-white text-slate-950" : now ? "text-white ring-1 ring-inset ring-emerald-400" : "text-slate-300 hover:text-white"}`;
  return <div className="rounded-xl bg-[#1E252F] px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-black tracking-tight text-white lg:text-lg">CS팀 OKR</h2>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs font-bold text-slate-300">
        <PortalSelect tone="dark" width={100} value={String(year)} onChange={(v) => onYear(Number(v))} options={years.map((y) => ({ value: String(y), label: `${y}년` }))} />
        <PortalSelect tone="dark" width={96} value={String(quarter)} onChange={(v) => onQuarter(Number(v))} options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `${q}분기` }))} />
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-white/15 bg-white/10 p-0.5">
          {chips.map((c) => <button key={c.id} type="button" title={c.title} onClick={c.onClick} className={chip(c.on, c.now)}>{c.label}</button>)}
        </div>
        {onExport && <button type="button" onClick={onExport} disabled={exporting} title="보고 있는 분기 전체(요약·분기·월·파트 종합·주차 기록)를 엑셀 파일 하나로"
          className="shrink-0 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 text-[12px] font-bold text-white transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-60">{exporting ? "만드는 중…" : "엑셀"}</button>}
      </div>
    </div>
  </div>;
}

// ── 흰 카드 탭 줄(통합집계 · A~D 파트 n/9) ──
export type CardTab = { key: string; label: string; on: boolean; count?: string; alerts: number; onClick: () => void };
export function OkrCardTabs({ tabs }: { tabs: CardTab[] }) {
  return <div className="flex gap-1 overflow-x-auto px-3 pt-2">
    {tabs.map((t) => <button key={t.key} type="button" onClick={t.onClick} className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-black transition ${t.on ? "border-slate-900 text-slate-950" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
      {t.label}{t.count && <span className="text-[11px] font-bold tabular-nums text-slate-400">{t.count}</span>}
      {t.alerts > 0 && <span className="text-[11px] font-bold text-rose-600">미흡 {t.alerts}</span>}
    </button>)}
  </div>;
}

// ── 경로 줄 — 큰 제목 대신. 오른쪽 작은 글자: 저장 상태 · 동기화 HH:MM. 초안이면 아래 작은 안내 ──
export function OkrCrumbBar({ crumbs, saveStatus, syncedAt, draftNote }: { crumbs: string[]; saveStatus: string; syncedAt: string; draftNote?: string }) {
  return <div className="border-t border-slate-200 px-4 py-2">
    <div className="flex items-center gap-3">
      <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-500" title={crumbs.join(" › ")}>
        {crumbs.map((c, i) => <span key={i}>{i > 0 && <span className="mx-1.5 text-slate-300">›</span>}<span className={i === crumbs.length - 1 ? "font-black text-slate-900" : ""}>{c}</span></span>)}
      </p>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums">
        {saveStatus === "saving" && <span className="text-slate-400">저장 중…</span>}
        {saveStatus === "error" && <span className="text-rose-600">저장 실패</span>}
        {saveStatus !== "saving" && saveStatus !== "error" && syncedAt && <span className="text-slate-400" title="15초마다, 창을 다시 볼 때 다른 사람이 적은 내용을 가져옵니다">동기화 {syncedAt}</span>}
      </span>
    </div>
    {draftNote && <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400" title={draftNote}>{draftNote}</p>}
  </div>;
}

// ── 사람 알약 — 연한 알약(고른 것은 진한 알약). 숫자는 알약 안 작은 배지(판정 n/9 · 미흡·미착수 수) ──
const pillCls = (on: boolean) => `relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-black transition ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`;
export function PersonPill({ label, mine, rows, total, badge, selected, onClick, onRemove }: { label: string; mine?: boolean; rows?: OkrResultRow[]; total?: number; badge?: string; selected: boolean; onClick: () => void; onRemove?: () => void }) {
  const judged = rows ? rows.filter((r) => normalizeJudgment(r.judgment)).length : 0;
  const alerts = rows ? rows.filter((r) => isAlert(r.judgment)).length : 0;
  const dim = selected ? "text-slate-300" : "text-slate-400";
  return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }} className={pillCls(selected)}>
    <span className="max-w-[96px] truncate">{label}</span>
    {mine && <span className={`text-[10px] font-bold ${selected ? "text-emerald-300" : "text-emerald-600"}`}>나</span>}
    {badge !== undefined ? <span className={`text-[10px] font-bold tabular-nums ${dim}`}>{badge}</span>
      : rows && total ? <span className={`text-[10px] font-bold tabular-nums ${dim}`}>{judged}/{total}</span> : null}
    {alerts > 0 && <span title={`미흡·미착수 ${alerts}`} className={`rounded-full px-1.5 text-[10px] font-black tabular-nums ${selected ? "bg-rose-400/30 text-rose-200" : "bg-rose-100 text-rose-600"}`}>{alerts}</span>}
    {onRemove && selected && <button type="button" title="이 사람의 이 달 기록 삭제" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-1 ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-black text-white hover:bg-rose-500">×</button>}
  </div>;
}
// 사람 알약 줄: [팀원 집계][파트 종합] | 파트원들 ＋ 이름
export function PeoplePillRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-3 py-2">{children}</div>;
}
export const PillDivider = () => <span className="mx-0.5 h-4 w-px shrink-0 bg-slate-300" />;
export function AddNamePill({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="shrink-0 rounded-full border border-dashed border-slate-300 px-3 py-1 text-[12px] font-bold text-slate-400 hover:bg-slate-50 hover:text-slate-600">＋ 이름</button>;
}

// ── 주차 칩 줄(파트원 골랐을 때만) — 연한 톤. 날짜·이번주·기록 점 유지 ──
export type WeekChip = { id: string; weekNo: number; label: string; start: string; end: string; on: boolean; now: boolean; filled: boolean };
export function OkrWeekStrip({ weeks, onPick }: { weeks: WeekChip[]; onPick: (weekNo: number) => void }) {
  return <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 bg-slate-50 px-3 py-1.5">
    {weeks.map((w) => <button key={w.id} type="button" title={`${w.start} ~ ${w.end}${w.now ? " · 이번 주" : ""}`} onClick={() => onPick(w.weekNo)}
      className={`relative shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums transition ${w.on ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300" : w.now ? "text-slate-700 ring-1 ring-inset ring-emerald-400 hover:bg-white" : "text-slate-500 hover:bg-white hover:text-slate-800"}`}>
      {w.label}{w.now && <span className="ml-1 text-[9px] font-black text-emerald-600">이번주</span>}
      {w.filled && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />}
    </button>)}
  </div>;
}
