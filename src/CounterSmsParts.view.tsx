/**
 * 카운터 문자전송 표시 부품(2026-10-24 단순화, docs/tasks/counter-sms-simplify.md).
 * 표시 틀만 — DB·저장 상태 없음. 값과 단추 동작은 CounterSms.tsx 가 props 로 넘긴다.
 * 폰 390px 기준, 단추 높이 44px(min-h-11), 글자 11px 이상.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, RotateCcw } from "lucide-react";
import type { LogLine, StatusLine, WarnBadge } from "./counterSmsView";

export type SheetItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string };

/** ⋯ 더보기 — 카드 overflow 에 잘리지 않게 화면 아래에서 올라오는 시트로 연다 */
export function MoreMenu({ title, items, label = "더보기" }: { title: string; items: SheetItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <>
      <button type="button" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="fixed inset-0 z-220 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-3 pb-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="truncate px-1 pb-2 text-[13px] font-black text-slate-900">{title}</div>
            <div className="space-y-1.5">
              {items.map((it) => (
                <button key={it.label} type="button" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
                  className={`flex min-h-11 w-full flex-col items-start justify-center rounded-lg border px-3 py-2 text-left text-[13px] font-black disabled:opacity-40 ${it.danger ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"}`}>
                  {it.label}
                  {it.hint && <span className="text-[11px] font-bold text-slate-500">{it.hint}</span>}
                </button>
              ))}
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 w-full rounded-lg bg-slate-100 text-[13px] font-black text-slate-600">닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** 머리 상태 한 줄: 10월 마감 · 24곳 · 보냄 4 · 완료 0 · 신규 3 (신규 누르면 신규만) */
export function StatusHeader({ s, sub, newOnly, onToggleNew, onRefresh, more }: {
  s: StatusLine; sub: string; newOnly: boolean; onToggleNew: () => void; onRefresh: () => void; more: SheetItem[];
}) {
  return (
    <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-black text-slate-900">
          <span>{s.title}</span>
          <span className="text-slate-400">·</span><span className="tabular-nums">{s.total}곳</span>
          <span className="text-slate-400">·</span><span className="tabular-nums text-emerald-700">보냄 {s.sent}</span>
          <span className="text-slate-400">·</span><span className="tabular-nums text-indigo-700">완료 {s.done}</span>
          <span className="text-slate-400">·</span>
          <button type="button" onClick={onToggleNew} disabled={!s.fresh && !newOnly} title="새로 추가된 업체만 보기"
            className={`rounded-full border px-2 py-0.5 tabular-nums transition disabled:opacity-60 ${newOnly ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-500 bg-white text-emerald-700"}`}>
            신규 {s.fresh}
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-200 sm:w-40">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${s.sentPct}%` }} />
          </div>
          <span className="truncate text-[11px] font-bold text-slate-500">{sub}</span>
        </div>
      </div>
      <button type="button" onClick={onRefresh} aria-label="새로고침" title="새로고침"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500"><RotateCcw size={16} /></button>
      <MoreMenu title={`${s.title} 목록`} items={more} label="목록 더보기" />
    </div>
  );
}

const HELP_KEY = "cs_counter_help_closed_v1";
/** "이 화면은?" — 처음엔 펼쳐 두고, 접으면 기기에 기억 */
export function HelpBox({ photoNote }: { photoNote: boolean }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(HELP_KEY) !== "1"; } catch { return true; } });
  const toggle = () => setOpen((v) => { const next = !v; try { localStorage.setItem(HELP_KEY, next ? "0" : "1"); } catch { /* 저장 못 해도 화면엔 지장 없음 */ } return next; });
  return (
    <div className="border-b border-slate-100 px-3 py-1">
      <button type="button" onClick={toggle} className="flex min-h-11 w-full items-center gap-1 text-left text-[12px] font-black text-slate-700">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}이 화면은?
      </button>
      {open && (
        <div className="space-y-1 pb-2 text-[12px] font-bold leading-relaxed text-slate-600">
          <div>① 관리부가 마감방에 올린 목록이 자동으로 들어옵니다. 새로 생긴 업체에는 <b className="text-emerald-700">신규</b>가 붙습니다.</div>
          <div>② 업체 카드를 눌러 고객에게 카운터 요청 문자를 보내면 <b className="text-emerald-700">보냄</b>이 됩니다.</div>
          <div>③ 고객이 보낸 카운터 사진을 <b>[📷 카운터 전송]</b>{photoNote ? "" : "(시험 중인 팀만, 아니면 [완료])"}으로 마감방에 올리면 <b className="text-indigo-700">완료</b>가 됩니다.</div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
            배지 뜻: <b>다시 올라옴</b> = 관리부 목록에 또 나옴(완료 뒤면 빨강, 보낸 뒤면 주황) · <b>CMS</b> = 따로 오는 CMS 마감(숫자 = 결제일) · <b>⭐</b> 새 담당 · <b>🚫</b> 막은 번호 · 그 밖의 단추는 카드의 <b>⋯</b>
          </div>
        </div>
      )}
    </div>
  );
}

/** 변경 이력 — 접힌 채로 "변경 이력 n", 한 줄 요약 + [보기]로 업체명 칩 */
export function LogPanel({ lines }: { lines: LogLine[] }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  if (!lines.length) return null;
  return (
    <div className="border-b border-slate-100 px-3 py-1">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-11 w-full items-center gap-1 text-left text-[12px] font-black text-slate-700">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}변경 이력 {lines.length}
        {!open && <span className="ml-1 min-w-0 truncate text-[11px] font-bold text-slate-400">최근 {lines[0].summary}</span>}
      </button>
      {open && (
        <ul className="space-y-1 pb-2">
          {lines.map((l) => {
            const canShow = l.groups.some((g) => g.names.length);
            return (
              <li key={l.id} className="rounded-lg bg-slate-50 px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[11px] font-bold text-slate-600"><b className="text-slate-800">{l.mode}</b> {l.summary}</span>
                  {canShow && (
                    <button type="button" onClick={() => setShown(shown === l.id ? null : l.id)} className="min-h-11 shrink-0 px-2 text-[11px] font-black text-blue-600">{shown === l.id ? "접기" : "보기"}</button>
                  )}
                </div>
                {shown === l.id && (
                  <div className="space-y-1.5 pb-1.5">
                    {l.groups.filter((g) => g.names.length).map((g) => (
                      <div key={g.key}>
                        <div className="text-[11px] font-black text-slate-700">{g.label} {g.count}{g.hint && <span className="font-bold text-amber-700"> — {g.hint}</span>}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {g.names.map((n, i) => <span key={`${n}-${i}`} className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${g.key === "added" ? "border-emerald-400 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-600"}`}>{n}</span>)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 칩 한 줄(등급 탭 아래 정렬·필터) */
export function ChipGroup<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`min-h-9 rounded-full px-3 text-[11px] font-black transition ${value === k ? "bg-slate-900 text-white" : "text-slate-500"}`}>{label}</button>
      ))}
    </div>
  );
}

/** 켜고 끄는 필터 칩 하나(예: 목록 밖 n) — 0개이고 꺼져 있으면 눌리지 않는다 */
export function ToggleChip({ on, count, label, onClick }: { on: boolean; count: number; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!count && !on}
      className={`min-h-9 rounded-full border px-3 text-[11px] font-black tabular-nums transition disabled:opacity-50 ${on ? "border-amber-600 bg-amber-600 text-white" : "border-amber-400 bg-white text-amber-800"}`}>{label} {count}</button>
  );
}

const WARN_TONE: Record<WarnBadge["tone"], string> = { red: "bg-rose-600 text-white", orange: "bg-amber-500 text-white", gray: "bg-slate-200 text-slate-700" };

/** 카드 한 장 — 1줄 업체명+상태 알약+신규 / 2줄 대수·번호+주의 배지 / 3줄 날짜 / 주 단추 1개 + ⋯ */
export function CounterCard({ vendor, status, newLabel, offList = false, warn, extraBadges, infoLine, dateLine, dateTitle, onOpen, primary, more }: {
  vendor: string; status: "none" | "sent" | "done"; newLabel: string; offList?: boolean; warn: WarnBadge | null; extraBadges: ReactNode;
  infoLine: string; dateLine: string; dateTitle?: string; onOpen: () => void;
  primary: { label: string; onClick: () => void; disabled?: boolean; title?: string; tone: "blue" | "dark" | "indigo" } | null; more: SheetItem[];
}) {
  const box = status === "done" ? "border-indigo-300 bg-indigo-50/70" : status === "sent" ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-blue-300";
  const tone = primary?.tone === "dark" ? "bg-slate-900 text-white hover:bg-slate-700" : primary?.tone === "indigo" ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-blue-600 text-white hover:bg-blue-700";
  return (
    <div className={`min-w-0 overflow-hidden rounded-lg border px-3 py-2.5 transition ${box}`}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[14px] font-black text-slate-900">{vendor}</span>
          {newLabel && <span className="shrink-0 rounded-full border border-emerald-500 px-1.5 py-0.5 text-[11px] font-black text-emerald-700">{newLabel}</span>}
          {status === "sent" && <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-black text-white">보냄</span>}
          {status === "done" && <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white">완료</span>}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
          <span className="min-w-0 max-w-full truncate text-[12px] font-bold text-slate-500">{infoLine}</span>
          {offList && <span title="가장 최근 목록 맞춤에서 관리부 목록에 없던 열린 업체 — 관리부가 끝낸 곳이면 카드 ⋯ 에서 완료" className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-black text-amber-800">관리부 목록 밖</span>}
          {warn && <span title={warn.title} className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-black ${WARN_TONE[warn.tone]}`}>{warn.label}</span>}
          {extraBadges}
        </div>
        {dateLine && <div title={dateTitle} className={`mt-0.5 truncate text-[11px] font-bold ${status === "done" ? "text-indigo-700" : status === "sent" ? "text-emerald-700" : "text-slate-400"}`}>{dateLine}</div>}
      </button>
      <div className="mt-2 flex items-center gap-1.5">
        {primary
          ? <button type="button" disabled={primary.disabled} onClick={primary.onClick} title={primary.title} className={`min-h-11 flex-1 rounded-lg px-3 text-[13px] font-black disabled:opacity-40 ${tone}`}>{primary.label}</button>
          : <span className="flex-1" />}
        <MoreMenu title={vendor} items={more} />
      </div>
    </div>
  );
}
