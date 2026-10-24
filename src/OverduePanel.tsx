/**
 * 홈 지표 판 — 미처리 일정(지난 날짜·미완료) 팀 탭 A~E (2026-10-13)
 * 탭을 누르면 그 팀 목록(날짜·업체·담당·상태). 줄이나 [일정리스트에서 처리]를 누르면 일정리스트의 미처리 탭으로.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { selectRows } from "./supabase";
import { kstDate } from "./visits";
import { fieldTicketVendor } from "./ids";
import { formatAssignees } from "./assignees";
import { UI } from "./ui/card";
import { filterOverdue, overdueAgeTone, overdueBadge, overdueKind, type KindFilter } from "./overdueLogic";

type Row = { id: string; team: string; date: string; time: string; vendor: string; assignee: string; status: string; scheduleType: string };
const card = "rounded-2xl border border-white/[0.08] bg-white/[0.03]";
const TEAMS = ["A", "B", "C", "D", "E"];

export default function OverduePanel({ onOpen }: { onOpen: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [team, setTeam] = useState("");
  const [kind, setKind] = useState<KindFilter>("");
  const load = useCallback(async () => {
    const today = kstDate();
    const from = new Date(Date.now() - 180 * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10);
    try {
      setRows(await selectRows<Row>("as_tickets", `select=id,team,date,time,vendor,assignee,status,scheduleType&date=lt.${today}&date=gte.${from}&status=neq.${encodeURIComponent("완료")}&scheduleType=neq.${encodeURIComponent("매월점검")}&order=date.desc,time.asc&limit=3000`));
    } catch { setRows([]); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);
  const count = useMemo(() => { const m = new Map<string, number>(); for (const r of filterOverdue(rows || [], "", kind)) m.set(r.team, (m.get(r.team) || 0) + 1); return m; }, [rows, kind]);
  // 처음엔 가장 많은 팀
  const shown = team || TEAMS.slice().sort((a, b) => (count.get(b) || 0) - (count.get(a) || 0))[0];
  const list = filterOverdue(rows || [], shown, kind);
  const total = list.length;
  const allTotal = rows?.length ?? 0;
  const days = (d: string) => Math.max(1, Math.round((Date.parse(kstDate()) - Date.parse(d)) / 86400_000));
  return (
    <div className={`p-4 sm:col-span-2 ${card}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-black tracking-[0.18em] text-slate-400"><CalendarClock size={13} className={total ? "text-rose-300" : "text-emerald-300"} />미처리 일정</span>
        <span className={`font-mono text-[13px] font-black ${total ? "text-rose-200" : "text-emerald-300"}`}>{rows === null ? "…" : `${total}건`}</span>
        {rows !== null && total !== allTotal && <span className="text-[11px] font-bold text-slate-400">전체 {allTotal}건</span>}
        <span className="ml-auto flex rounded-full bg-white/[0.06] p-0.5">
          {TEAMS.map((t) => { const n = count.get(t) || 0; const on = shown === t; return (
            <button key={t} type="button" onClick={() => setTeam(t)} className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-black transition lg:min-h-9 ${on ? "bg-white text-slate-950" : n ? "text-rose-200 hover:text-white" : "text-slate-500 hover:text-slate-300"}`}>
              {t}{n ? <span className={`ml-1 font-mono ${on ? "text-rose-600" : ""}`}>{n}</span> : ""}
            </button>
          ); })}
        </span>
      </div>
      <div className="mt-2 flex gap-1.5">
        {([["", "전체"], ["AS", "AS"], ["물류", "물류"]] as [KindFilter, string][]).map(([k, label]) => (
          <button key={label} type="button" onClick={() => setKind(k)} className={UI.chipDark(kind === k)}>{label}</button>
        ))}
      </div>
      <ul className="mt-3 max-h-[220px] divide-y divide-white/[0.06] overflow-y-auto rounded-xl border border-white/[0.06]">
        {rows === null && Array.from({ length: 3 }).map((_, i) => <li key={i} className="px-3 py-2.5"><div className="h-3.5 animate-pulse rounded bg-white/[0.06]" /></li>)}
        {rows !== null && !list.length && <li className="px-3 py-5 text-center text-[12px] font-bold text-emerald-300">{shown}팀은 미처리 일정이 없습니다.</li>}
        {list.map((r) => {
          const d = days(r.date);
          const tone = overdueAgeTone(d);
          const logistics = overdueKind(r.scheduleType) === "물류";
          const body = (
            <>
              <span className="w-11 shrink-0 font-mono text-[11px] font-bold tabular-nums text-slate-400">{r.date.slice(5).replace("-", "/")}</span>
              <span className={`w-12 shrink-0 text-[11px] font-black ${tone === "red" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : "text-slate-400"}`}>{d}일 전</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-100">{fieldTicketVendor(r.vendor).vendor || r.vendor}</span>
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-black text-slate-300">{overdueBadge(r.scheduleType)}</span>
              <span className={`w-14 shrink-0 truncate text-right text-[11px] font-black ${r.assignee ? "text-slate-400" : "text-rose-300"}`}>{formatAssignees(r.assignee, { short: true }) || "미배정"}</span>
              {logistics && <span className="shrink-0 text-[11px] font-bold text-slate-400">네이버 캘린더에서 완료</span>}
            </>
          );
          return (
            <li key={r.id}>
              {logistics
                ? <div className="flex w-full items-center gap-2.5 px-3 py-2 opacity-80">{body}</div>
                : <button type="button" onClick={onOpen} className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/[0.05]">{body}</button>}
            </li>
          );
        })}
      </ul>
      {kind === "물류"
        ? <p className="mt-2 text-[11px] font-bold text-slate-500">물류는 네이버 캘린더에서 완료 처리하면 다음 동기화 뒤 사라집니다</p>
        : <button type="button" onClick={onOpen} className="mt-1 inline-flex min-h-11 items-center text-xs font-black text-blue-300 transition hover:text-white">AS 는 일정리스트에서 처리 →</button>}
    </div>
  );
}
