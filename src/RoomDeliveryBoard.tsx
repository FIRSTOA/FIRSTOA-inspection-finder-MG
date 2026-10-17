/**
 * 카톡 발송 현황 — 방별로 "마지막에 누가 보냈나(폰 봇 / 노트북 PC) · 밀린 글 · 지연" 을 한 표로 (2026-10-17).
 * 왜: 홈 타일은 "N건 대기"까지만 보여서, 20~30개 방 중 어느 방이 막혔는지(봇 통로가 없는 조용한 방) 알 수 없었다.
 * 재료: room_map(방 목록) · room_activity(방별 마지막 활동 — 봇 트리거 bot_send, 노트북 pc_send, 수신 message) · outbox(아직 안 나간 글)
 */
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { selectRows } from "./supabase";
import { buildRoomRows, relMin as rel, SOURCE_LABEL, summarizeRooms, type ActRow, type OutRow, type RoomMapRow, type RoomRow as Row } from "./roomDelivery";

const STATUS: Record<Row["status"], { label: string; cls: string }> = {
  delay: { label: "지연", cls: "bg-rose-100 text-rose-700" },
  sending: { label: "전송 중", cls: "bg-amber-100 text-amber-800" },
  ok: { label: "정상", cls: "bg-emerald-100 text-emerald-700" },
  quiet: { label: "조용", cls: "bg-slate-100 text-slate-500" },
};

export default function RoomDeliveryBoard() {
  const [map, setMap] = useState<RoomMapRow[]>([]);
  const [acts, setActs] = useState<ActRow[]>([]);
  const [out, setOut] = useState<OutRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [at, setAt] = useState<number>(0);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [m, a, o] = await Promise.all([
        selectRows<RoomMapRow>("room_map", "select=category,region,room"),
        selectRows<ActRow>("room_activity", "select=room,last_at,source&limit=500"),
        selectRows<OutRow>("outbox", "select=room,created_at&order=created_at.asc&limit=500"),
      ]);
      setMap(m); setActs(a); setOut(o); setAt(Date.now());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => window.clearInterval(t);
  }, []);

  const rows = useMemo<Row[]>(() => buildRoomRows(map, acts, out), [map, acts, out]);
  const summary = useMemo(() => summarizeRooms(rows), [rows]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div>
          <h3 className="text-base font-black text-slate-950 lg:text-lg">카톡 발송 현황 · 방별</h3>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">폰 봇이 못 보낸 글은 노트북 PC 카톡이 2분 뒤 대신 보냅니다 · 30초마다 새로 읽음{at ? ` · ${rel(new Date(at).toISOString())}` : ""}</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />새로고침
        </button>
      </div>
      {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}
      <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-5">
        {[
          ["방", `${summary.rooms}개`], ["밀린 글", `${summary.pending}건`], ["지연 방", `${summary.delayed}개`],
          ["오늘 폰 봇 배달", `${summary.botToday}방`], ["오늘 노트북 배달", `${summary.pcToday}방`],
        ].map(([l, v]) => (
          <div key={l} className="bg-white px-4 py-3"><div className="text-[10.5px] font-black text-slate-400">{l}</div><div className={`text-lg font-black ${l === "지연 방" && summary.delayed ? "text-rose-600" : "text-slate-900"}`}>{v}</div></div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead><tr className="text-left text-[10.5px] font-black text-slate-400">
            <th className="px-4 py-2">상태</th><th className="py-2">방</th><th className="py-2">쓰임</th><th className="py-2">마지막 활동</th><th className="py-2 text-right pr-4">밀린 글</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.room} className="border-t border-slate-100">
                <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-[10.5px] font-black ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                <td className="py-2 font-bold text-slate-800">{r.room}</td>
                <td className="py-2"><div className="flex flex-wrap gap-1">{r.uses.slice(0, 4).map((u) => <span key={u} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{u}</span>)}{r.uses.length > 4 && <span className="text-[10px] font-bold text-slate-400">+{r.uses.length - 4}</span>}</div></td>
                <td className="py-2 text-slate-600">{r.act ? <>{SOURCE_LABEL[r.act.source || ""] || r.act.source || "활동"} · {rel(r.act.last_at)}</> : <span className="text-slate-400">기록 없음</span>}{r.status === "quiet" && <div className="text-[10.5px] font-semibold text-slate-400">24시간 넘게 활동 없음 — 봇 통로가 없을 수 있어 노트북이 대신 보냅니다</div>}</td>
                <td className="py-2 pr-4 text-right font-mono font-black text-slate-800">{r.pending ? `${r.pending}건${r.oldestMin ? ` · ${r.oldestMin}분` : ""}` : <span className="text-slate-300">—</span>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="p-8 text-center text-sm font-bold text-slate-400">{loading ? "불러오는 중…" : "방 기록이 없습니다"}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
