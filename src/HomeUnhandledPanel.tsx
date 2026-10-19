/**
 * 홈 지표 판 — 미처리 토탈(2026-10-19): 접수 6종 미처리 + 지난 일정 미처리를 한 목록으로.
 * 탭: 전체 · A~E · 경영/운영/영업. 목록은 "접수·AS" 묶음 + "물류" 묶음. 접수 행 → 서비스접수 미처리 현황, AS일정 행 → 일정리스트 미처리, 물류 → 네이버 캘린더 안내.
 * 모양·폴링은 OverduePanel 과 같다(60초, 숨은 탭 쉼, 포커스 때 새로).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { selectRows } from "./supabase";
import { kstDate } from "./visits";
import { fieldTicketVendor } from "./ids";
import { overdueAgeTone } from "./overdueLogic";
import { fetchOpenReceptions } from "./deptReceptionApi";
import { RECEPTION_TYPE_META, type ReceptionType } from "./ReceptionTypePicker";
import { RECEPTION_RIGHT_KEY, SHOW_BOARD_EVENT } from "./receptionRightView";
import {
  countUnhandledTabs, mergeUnhandled, rowsForTab, splitByGroup, UNHANDLED_BADGE,
  type TicketInput, type UnhandledKind, type UnhandledRow, type UnhandledTab,
} from "./homeUnhandled";

const card = "rounded-2xl border border-white/[0.08] bg-white/[0.03]";
const TAB_GROUPS: UnhandledTab[][] = [["전체"], ["A", "B", "C", "D", "E"], ["경영", "운영", "영업"]];
const DEPT_TEAMS = new Set(["경영", "운영", "영업"]);

const dotOf = (k: UnhandledKind): string =>
  k === "AS일정" || k === "물류" ? "bg-slate-400" : RECEPTION_TYPE_META[k as ReceptionType]?.dot || "bg-slate-400";

export default function HomeUnhandledPanel({ onOpenOverdue, onOpenReception }: { onOpenOverdue: () => void; onOpenReception: () => void }) {
  const [rows, setRows] = useState<UnhandledRow[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<UnhandledTab>("전체");
  const load = useCallback(async () => {
    const today = kstDate();
    const from = new Date(Date.now() - 180 * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10);
    const [rec, tic] = await Promise.allSettled([
      fetchOpenReceptions(90),
      selectRows<TicketInput>("as_tickets", `select=id,team,date,time,vendor,assignee,status,scheduleType,receptionId,issue&date=lt.${today}&date=gte.${from}&status=neq.${encodeURIComponent("완료")}&scheduleType=neq.${encodeURIComponent("매월점검")}&order=date.desc,time.asc&limit=3000`),
    ]);
    const errs: string[] = [];
    if (rec.status === "rejected") errs.push("접수");
    if (tic.status === "rejected") errs.push("일정");
    // 접수를 못 읽으면 AS 중복 제외도 못 한다 — 숫자가 틀릴 수 있음을 안내문으로 알린다
    setError(errs.length ? `${errs.join("·")} 미처리를 불러오지 못했습니다 — 숫자가 빠지거나 겹쳤을 수 있음` : "");
    setRows(mergeUnhandled(rec.status === "fulfilled" ? rec.value : [], tic.status === "fulfilled" ? tic.value : [], today));
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);
  const counts = useMemo(() => countUnhandledTabs(rows || []), [rows]);
  const list = useMemo(() => rowsForTab(rows || [], tab), [rows, tab]);
  const groups = useMemo(() => splitByGroup(list), [list]);
  const total = counts["전체"];
  // 서비스접수 화면이 이미 떠 있으면(KeepAlive) localStorage 를 다시 읽지 않으므로 이벤트도 같이 보낸다
  const openReception = () => {
    try { localStorage.setItem(RECEPTION_RIGHT_KEY, "board"); } catch { /* 저장 못 해도 이벤트로 연다 */ }
    window.dispatchEvent(new CustomEvent(SHOW_BOARD_EVENT));
    onOpenReception();
  };
  const renderRow = (r: UnhandledRow) => {
    const tone = overdueAgeTone(r.ageDays);
    const vendor = r.source === "ticket" ? (fieldTicketVendor(r.vendor).vendor || r.vendor) : r.vendor;
    const body = (
      <>
        <span className="w-11 shrink-0 font-mono text-[11px] font-bold tabular-nums text-slate-400">{r.date.slice(5).replace("-", "/")}</span>
        <span className={`w-12 shrink-0 text-[10.5px] font-black ${tone === "red" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : "text-slate-400"}`}>{r.ageDays ? `${r.ageDays}일 전` : "오늘"}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-100">{vendor || r.title || "(업체 없음)"}</span>
        <span className="flex shrink-0 items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-black text-slate-300">
          <span className={`h-1.5 w-1.5 rounded-full ${dotOf(r.kind)}`} aria-hidden />
          {UNHANDLED_BADGE[r.kind]}
          {r.team && !DEPT_TEAMS.has(r.team) ? <span className="text-slate-500">{r.team}</span> : null}
        </span>
        <span className={`w-14 shrink-0 truncate text-right text-[11px] font-black ${r.assignee ? "text-slate-400" : "text-rose-300"}`}>{r.assignee || "미배정"}</span>
      </>
    );
    if (r.kind === "물류") return <div className="flex w-full items-center gap-2.5 px-3 py-2 opacity-80">{body}</div>;
    return <button type="button" onClick={r.source === "reception" ? openReception : onOpenOverdue} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/[0.05]">{body}</button>;
  };
  return (
    <div className={`p-4 sm:col-span-2 ${card}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[10.5px] font-black tracking-[0.18em] text-slate-400"><CalendarClock size={13} className={total ? "text-rose-300" : "text-emerald-300"} />미처리 일정</span>
        <span className={`font-mono text-[13px] font-black ${total ? "text-rose-200" : "text-emerald-300"}`}>{rows === null ? "…" : `${total}건`}</span>
        {rows !== null && tab !== "전체" && <span className="text-[10.5px] font-bold text-slate-500">{tab} {list.length}건</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {TAB_GROUPS.map((group, gi) => (
          <span key={gi} className="flex items-center gap-1">
            {gi > 0 && <span className="mx-0.5 h-4 w-px bg-white/10" aria-hidden />}
            {group.map((t) => {
              const n = counts[t];
              const on = tab === t;
              return (
                <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-2.5 py-1 text-[11px] font-black transition ${on ? "bg-white text-slate-950" : n ? "bg-white/[0.06] text-rose-200 hover:text-white" : "bg-white/[0.06] text-slate-500 hover:text-slate-300"}`}>
                  {t}{n ? <span className={`ml-1 font-mono ${on ? "text-rose-600" : ""}`}>{n}</span> : ""}
                </button>
              );
            })}
          </span>
        ))}
      </div>
      {error && <p className="mt-2 text-[11px] font-bold text-amber-300">{error}</p>}
      <div className="mt-3 max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.06]">
        {rows === null && <ul>{Array.from({ length: 3 }).map((_, i) => <li key={i} className="px-3 py-2.5"><div className="h-3.5 animate-pulse rounded bg-white/[0.06]" /></li>)}</ul>}
        {rows !== null && !list.length && <p className="px-3 py-5 text-center text-[12px] font-bold text-emerald-300">{tab === "전체" ? "" : `${tab} `}미처리 없음</p>}
        {rows !== null && groups.work.length > 0 && (
          <section>
            <h4 className="sticky top-0 bg-slate-900/95 px-3 py-1.5 text-[10.5px] font-black tracking-wide text-slate-300">접수·AS <span className="font-mono text-rose-200">{groups.work.length}건</span></h4>
            <ul className="divide-y divide-white/[0.06]">{groups.work.map((r) => <li key={r.key}>{renderRow(r)}</li>)}</ul>
          </section>
        )}
        {rows !== null && groups.logistics.length > 0 && (
          <section>
            <h4 className="sticky top-0 bg-slate-900/95 px-3 py-1.5 text-[10.5px] font-black tracking-wide text-slate-300">물류 <span className="font-mono text-rose-200">{groups.logistics.length}건</span> <span className="ml-1 text-[10px] font-bold text-slate-500">네이버 캘린더에서 완료 처리하면 사라집니다</span></h4>
            <ul className="divide-y divide-white/[0.06]">{groups.logistics.map((r) => <li key={r.key}>{renderRow(r)}</li>)}</ul>
          </section>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" onClick={openReception} className="text-[11px] font-black text-blue-300 transition hover:text-white">접수 미처리 현황 →</button>
        <button type="button" onClick={onOpenOverdue} className="text-[11px] font-black text-blue-300 transition hover:text-white">AS 일정리스트 →</button>
      </div>
    </div>
  );
}
