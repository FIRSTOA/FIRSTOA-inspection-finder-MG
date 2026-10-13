/**
 * 홈 관제 덱 — 미처리 일정(지난 날짜인데 완료가 안 된 일정) 팀별 건수 (2026-10-13)
 * 왜: 네이버 캘린더에 완료 체크가 안 된 지난 일정이 쌓여 "누락인지 그냥 지나간 건지" 몰랐다. 팀마다 보고 완료 처리하거나 다시 잡게.
 * 60초마다·창 복귀 때 새로 센다. 누르면 일정리스트의 [미처리] 탭으로.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { selectRows } from "./supabase";
import { kstDate } from "./visits";

type Row = { team: string; date: string };
const card = "rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm";

export default function OverdueTile({ onOpen }: { onOpen: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    const today = kstDate();
    const from = new Date(Date.now() - 180 * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10);
    try {
      setRows(await selectRows<Row>("as_tickets", `select=team,date&date=lt.${today}&date=gte.${from}&status=neq.${encodeURIComponent("완료")}&scheduleType=neq.${encodeURIComponent("매월점검")}&limit=3000`));
    } catch { setRows([]); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const n = rows?.length ?? 0;
  const byTeam = new Map<string, number>();
  for (const r of rows || []) byTeam.set(r.team || "?", (byTeam.get(r.team || "?") || 0) + 1);
  const teams = Array.from(byTeam.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const dot = rows === null ? "bg-slate-500" : n ? "bg-rose-500" : "bg-emerald-400";
  return (
    <button type="button" onClick={onOpen} title="지난 날짜인데 완료 처리가 안 된 일정 — 누르면 일정리스트의 미처리 탭" className={`flex items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/[0.08] ${card}`}>
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {n > 0 && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${dot}`} />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
      </span>
      <CalendarClock size={14} className="shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-black tracking-wide text-slate-400">미처리 일정</span>
        <span className={`block truncate text-[12.5px] font-black ${n ? "text-rose-200" : "text-white"}`}>
          {rows === null ? "세는 중…" : n === 0 ? "없음" : `${n}건 · ${teams.map(([t, c]) => `${t} ${c}`).join(" · ")}`}
        </span>
      </span>
    </button>
  );
}
