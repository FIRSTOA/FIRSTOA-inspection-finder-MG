/**
 * 홈 실시간 전송 현황판 (2026-10-17 홈 개편의 중심).
 * 왼쪽: 방 20~30개를 상태 색(지연·전송 중·정상·조용)으로 한눈에 — 어느 방이 막혔는지 바로 보이게.
 * 오른쪽: 최근 전송 흐름 — 오늘 누가 어느 양식을 어디로 보냈는지 한 줄씩(activity_events) + 지금 밀린 글(outbox).
 * 위: 폰 봇 / 노트북 실행기 / 밀린 글 / 오늘 배달 요약. 15초마다 새로 읽는다(홈 나머지 지표는 60초).
 * 2026-10-24(사용자 9): 머리 큰 숫자 = "봇 n · 노트북 n"(오늘 배달한 방 수), 방 줄마다 배달 주체 📱(폰 봇)·💻(노트북).
 *   room_activity 는 방마다 마지막 활동 한 줄뿐이라(배달 건수 칸 없음) 숫자는 "방" 단위다 — 건수를 세려면 배달 기록 표가 필요.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Laptop, RefreshCw } from "lucide-react";
import { selectRows } from "./supabase";
import { buildRoomRows, CATEGORY_LABEL, relMin, SOURCE_LABEL, STATUS_LABEL, summarizeRooms, type ActRow, type OutRow, type RoomMapRow, type RoomRow, type RoomStatus } from "./roomDelivery";

type EventRow = { id: string; created_at: string; author: string; category: string; vendor: string | null; team: string | null; status: string | null };
type Heartbeat = { name: string; host: string; last_seen: string; note: string | null };
type Snapshot = { rows: RoomRow[]; events: EventRow[]; worker: Heartbeat | null; at: number; error: string };

const card = "rounded-2xl border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const eyebrow = "text-[10px] font-black uppercase tracking-[0.16em] text-slate-500";
const STATUS_STYLE: Record<RoomStatus, { tile: string; dot: string }> = {
  delay: { tile: "border-rose-400/40 bg-rose-500/15 text-rose-100", dot: "bg-rose-400" },
  sending: { tile: "border-amber-400/40 bg-amber-500/15 text-amber-100", dot: "bg-amber-400" },
  ok: { tile: "border-emerald-400/25 bg-emerald-500/10 text-emerald-50", dot: "bg-emerald-400" },
  quiet: { tile: "border-white/[0.08] bg-white/[0.03] text-slate-400", dot: "bg-slate-500" },
};
/** 배달 주체 아이콘 — 방 마지막 활동이 봇/노트북 배달일 때만 */
const DELIVERER: Record<string, { icon: string; label: string }> = { bot_send: { icon: "📱", label: "폰 봇" }, pc_send: { icon: "💻", label: "노트북" } };
const kstDayStartIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

async function load(): Promise<Snapshot> {
  const errors: string[] = [];
  const safe = async <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch (e) { errors.push(`${label} ${(e as Error).message}`); return fallback; } };
  const [map, acts, out, events, hb] = await Promise.all([
    safe("방", selectRows<RoomMapRow>("room_map", "select=category,region,room"), []),
    safe("활동", selectRows<ActRow>("room_activity", "select=room,last_at,source&limit=500"), []),
    safe("대기", selectRows<OutRow>("outbox", "select=room,created_at&order=created_at.asc&limit=500"), []),
    safe("흐름", selectRows<EventRow>("activity_events", `select=id,created_at,author,category,vendor,team,status&created_at=gte.${encodeURIComponent(kstDayStartIso())}&order=created_at.desc&limit=40`), []),
    safe("실행기", selectRows<Heartbeat>("worker_heartbeat", "select=name,host,last_seen,note&order=last_seen.desc&limit=1"), []),
  ]);
  return { rows: buildRoomRows(map, acts, out), events: events.filter((e) => e.status !== "cancelled"), worker: hb[0] || null, at: Date.now(), error: errors.join(" · ") };
}

export default function LiveSendBoard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [showAll, setShowAll] = useState(false);
  const busy = useRef(false);
  const refresh = async () => { if (busy.current) return; busy.current = true; try { setSnap(await load()); } finally { busy.current = false; } };
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    return () => window.clearInterval(t);
  }, []);

  const rows = snap?.rows || [];
  const sum = useMemo(() => summarizeRooms(rows), [rows]);
  const visible = showAll ? rows : rows.filter((r) => r.status !== "quiet" && r.status !== "ok").concat(rows.filter((r) => r.status === "ok").slice(0, 12));
  const hiddenCount = rows.length - visible.length;

  // 상태 한 단어 — 폰 봇 / 노트북 실행기
  const botTone = !snap ? "idle" : sum.delayed ? "bad" : sum.sending ? "warn" : "ok";
  const botText = !snap ? "확인 중" : sum.delayed ? `지연 ${sum.delayed}방 · 밀린 글 ${sum.pending}건` : sum.sending ? `전송 중 ${sum.pending}건` : "정상 · 밀린 글 없음";
  const workerMin = snap?.worker ? Math.round((Date.now() - new Date(snap.worker.last_seen).getTime()) / 60000) : null;
  const workerTone = !snap ? "idle" : workerMin !== null && workerMin <= 15 ? "ok" : "bad";
  const workerText = !snap ? "확인 중" : snap.worker ? (workerMin! <= 15 ? `살아 있음 · ${snap.worker.host} · 심박 ${relMin(snap.worker.last_seen)}` : `끊김 · 마지막 심박 ${relMin(snap.worker.last_seen)} (${snap.worker.host})`) : "아직 설치 안 됨";
  const dotOf = (tone: string) => tone === "ok" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : tone === "bad" ? "bg-rose-500" : "bg-slate-500";

  return (
    <div className="relative border-b border-white/[0.08] px-4 py-5 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className={`flex items-center gap-2 ${eyebrow}`}><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>Live · 카톡 전송 현황</div>
          <h3 className="mt-0.5 text-[15px] font-black text-white">모든 방과 전송을 한눈에 <span className="text-[11px] font-bold text-slate-500">· 15초마다 갱신{snap ? ` · ${relMin(new Date(snap.at).toISOString())}` : ""}</span></h3>
        </div>
        <div className="ml-auto flex items-baseline gap-3 font-mono tabular-nums" aria-label="오늘 배달한 방 수">
          <span className="text-[22px] font-black leading-none text-white"><span className="mr-1 text-[12px] font-black text-slate-400">📱 봇</span>{snap ? sum.botToday : "—"}</span>
          <span className="text-[22px] font-black leading-none text-white"><span className="mr-1 text-[12px] font-black text-slate-400">💻 노트북</span>{snap ? sum.pcToday : "—"}</span>
          <span className="text-[10.5px] font-bold text-slate-500">방 · 오늘</span>
        </div>
        <button type="button" onClick={() => void refresh()} className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-black text-slate-300 transition hover:bg-white/20"><RefreshCw size={11} />새로고침</button>
      </div>

      {/* 요약 띠 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className={`flex items-center gap-2.5 px-3 py-2 lg:col-span-2 ${card}`}>
          <span className="relative flex h-2.5 w-2.5 shrink-0">{botTone !== "idle" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${dotOf(botTone)}`} />}<span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotOf(botTone)}`} /></span>
          <Bot size={14} className="shrink-0 text-slate-400" /><span className="min-w-0"><span className={`block ${eyebrow}`}>업무폰 카톡 봇</span><span className="block truncate text-[12.5px] font-black text-slate-100">{botText}</span></span>
        </div>
        <div className={`flex items-center gap-2.5 px-3 py-2 lg:col-span-2 ${card}`}>
          <span className="relative flex h-2.5 w-2.5 shrink-0">{workerTone === "ok" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />}<span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotOf(workerTone)}`} /></span>
          <Laptop size={14} className="shrink-0 text-slate-400" /><span className="min-w-0"><span className={`block ${eyebrow}`}>노트북 실행기 · 대신 보내기</span><span className="block truncate text-[12.5px] font-black text-slate-100">{workerText}</span></span>
        </div>
        {[["방", `${sum.rooms}`], ["밀린 글", snap ? `${sum.pending}건` : "—"]].map(([l, v]) => (
          <div key={l} className={`px-3 py-2 ${card}`}><span className={`block ${eyebrow}`}>{l}</span><span className="block truncate font-mono text-[14px] font-black tabular-nums text-white">{v}</span></div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* 방 격자 */}
        <div className={`min-w-0 p-3 lg:col-span-7 ${card}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className={eyebrow}>방별 상태 <span className="normal-case tracking-normal text-slate-600">· 지연·전송 중인 방이 먼저</span></span>
            <span className="flex items-center gap-2 text-[10px] font-black text-slate-400">
              {(["delay", "sending", "ok", "quiet"] as RoomStatus[]).map((s) => <span key={s} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${STATUS_STYLE[s].dot}`} />{STATUS_LABEL[s]}</span>)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((r) => (
              <div key={r.room} title={`${r.room}\n${r.uses.join(", ") || "매핑 없음"}\n${r.act ? `${SOURCE_LABEL[r.act.source || ""] || r.act.source} · ${relMin(r.act.last_at)}` : "활동 기록 없음"}`} className={`flex min-w-0 flex-col gap-0.5 rounded-xl border px-2.5 py-2 ${STATUS_STYLE[r.status].tile}`}>
                <span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_STYLE[r.status].dot}`} /><span className="min-w-0 flex-1 truncate text-[11.5px] font-black">{r.room}</span>{DELIVERER[r.act?.source || ""] && <span className="shrink-0 text-[11px]" role="img" aria-label={`${DELIVERER[r.act!.source!].label}가 배달`}>{DELIVERER[r.act!.source!].icon}</span>}</span>
                <span className="truncate text-[10px] font-semibold opacity-80">{r.pending ? `밀림 ${r.pending}건 · ${r.oldestMin}분` : r.act ? `${(SOURCE_LABEL[r.act.source || ""] || "활동").replace("이 배달", "").replace("가 배달", "")} · ${relMin(r.act.last_at)}` : "기록 없음"}</span>
              </div>
            ))}
            {!snap && Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[46px] animate-pulse rounded-xl bg-white/[0.05]" />)}
          </div>
          {snap && rows.length > 0 && (hiddenCount > 0 || showAll) && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 w-full rounded-lg py-1.5 text-[11px] font-black text-slate-400 transition hover:bg-white/5 hover:text-white">{showAll ? "접기" : `조용한 방 ${hiddenCount}개 더 보기`}</button>
          )}
        </div>

        {/* 최근 전송 흐름 */}
        <div className={`flex min-h-0 flex-col lg:col-span-5 ${card}`}>
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5"><span className={eyebrow}>오늘 전송 흐름 <span className="normal-case tracking-normal text-slate-600">· 누가 무엇을 어디로</span></span><span className="font-mono text-[10.5px] font-black text-slate-500">{snap ? `${snap.events.length}건` : ""}</span></div>
          <ul className="max-h-[320px] divide-y divide-white/[0.06] overflow-y-auto">
            {rows.filter((r) => r.pending).map((r) => (
              <li key={`pend-${r.room}`} className="flex items-center gap-3 px-4 py-2 bg-amber-500/[0.06]">
                <span className="w-[42px] shrink-0 font-mono text-[10.5px] font-bold tabular-nums text-amber-300">{r.oldestMin}분째</span>
                <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-black text-amber-200">대기</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-slate-100">{r.room}</span>
                <span className="shrink-0 text-[11px] font-black text-slate-400">{r.pending}건</span>
              </li>
            ))}
            {(snap?.events || []).map((e) => {
              const d = new Date(e.created_at);
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-[42px] shrink-0 font-mono text-[10.5px] font-bold tabular-nums text-slate-500">{String(d.getHours()).padStart(2, "0")}:{String(d.getMinutes()).padStart(2, "0")}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${e.category === "as" ? "bg-violet-500/20 text-violet-200" : e.category === "inspection" ? "bg-blue-500/20 text-blue-200" : "bg-white/10 text-slate-200"}`}>{CATEGORY_LABEL[e.category] || e.category}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-slate-100">{e.vendor || "—"}</span>
                  <span className="shrink-0 text-[11px] font-black text-slate-400">{e.author}{e.team ? ` · ${e.team}` : ""}</span>
                </li>
              );
            })}
            {!snap && Array.from({ length: 6 }).map((_, i) => <li key={i} className="px-4 py-2.5"><div className="h-3.5 animate-pulse rounded bg-white/[0.06]" /></li>)}
            {snap && !snap.events.length && !sum.pending && <li className="px-4 py-6 text-center text-xs font-bold text-slate-500">오늘 보낸 기록이 아직 없습니다</li>}
          </ul>
        </div>
      </div>
      {snap?.error && <div className="mt-2 text-[11px] font-bold text-amber-300">일부를 못 불러왔습니다: {snap.error}</div>}
    </div>
  );
}
