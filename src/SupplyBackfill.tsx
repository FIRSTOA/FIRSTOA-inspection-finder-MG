/**
 * 관리 탭 — 부품·자가 신청 지난 기록 채우기 (2026-10-11)
 * 점검·AS 원문의 ※부품신청※·※자가신청※ 칸을 달별로 읽어 supply_requests 에 넣는다. 사람이 누를 때만 돈다(같은 건은 한 번만).
 */
import { useEffect, useState } from "react";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { selectRows } from "./supabase";
import { backfillSupplyMonth, recentMonths, renormalizeUndefined } from "./supplyRequests";

export default function SupplyBackfill() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const [months, setMonths] = useState(6);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [undefinedItems, setUndefinedItems] = useState<Array<{ item: string; kind: string; n: number }>>([]);
  const [renorm, setRenorm] = useState(false);

  const refresh = async () => {
    try {
      const rows = await selectRows<{ id: number }>("supply_requests", "select=id&order=id.desc&limit=1");
      setReady(true);
      setCount(rows[0]?.id || 0);
      // 미정의 품목 — 사전에 없는 이름. 재고 탭에서 별칭을 넣고 [다시 맞추기]
      const und = await selectRows<{ item: string; kind: string }>("supply_requests", "select=item,kind&item_std=eq.&limit=2000").catch(() => [] as Array<{ item: string; kind: string }>);
      const m = new Map<string, { item: string; kind: string; n: number }>();
      und.forEach((r) => { const k = `${r.kind}|${r.item}`; m.set(k, { item: r.item, kind: r.kind, n: (m.get(k)?.n || 0) + 1 }); });
      setUndefinedItems(Array.from(m.values()).sort((a, b) => b.n - a.n).slice(0, 40));
    } catch { setReady(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const run = async () => {
    const list = recentMonths(months);
    if (!await askConfirm(`${list[list.length - 1]} ~ ${list[0]} 점검·AS 원문에서 부품·자가 신청을 읽어 넣을까요?\n이미 들어간 건은 건너뜁니다. 달마다 몇 초씩 걸립니다.`, { okLabel: "채우기" })) return;
    setBusy(true); setLog([]);
    let total = 0;
    try {
      for (const ym of list) {
        const r = await backfillSupplyMonth(ym);
        total += r.inserted;
        setLog((cur) => [`${ym}: 글 ${r.read}건 → 새로 ${r.inserted}행 · 이미 있음 ${r.skipped}행`, ...cur]);
      }
      notify(`부품·자가 신청 ${total}행을 채웠습니다`, "success");
      await refresh();
    } catch (e) { notify(`채우기 중단: ${(e as Error).message}`, "error"); } finally { setBusy(false); }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <h3 className="text-base font-black text-slate-950 lg:text-lg">부품·자가 신청 기록</h3>
        <p className="mt-0.5 text-[11px] font-semibold text-slate-400">점검·AS 양식의 ※부품신청※·※자가신청※ 칸을 품목 단위로 쌓습니다. 전송할 때 자동으로 들어가고, 지난 기록은 여기서 한 번 채웁니다. 통합검색·전체 데이터 질문이 이 표를 읽습니다.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 p-4">
        {ready === false && <span className="text-[12px] font-bold text-amber-700">표가 아직 없습니다 — supabase/supply-requests.sql 을 한 번 실행하세요.</span>}
        {ready && <span className="text-[12px] font-bold text-slate-700">지금 약 <b>{count.toLocaleString()}</b>행</span>}
        <label className="ml-auto text-[11px] font-black text-slate-500">최근
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-bold">
            {[3, 6, 12, 18, 24].map((n) => <option key={n} value={n}>{n}달</option>)}
          </select>
        </label>
        <button type="button" disabled={!ready || busy} onClick={() => void run()} className="rounded-full bg-blue-600 px-4 py-2 text-[12px] font-black text-white disabled:opacity-40">{busy ? "채우는 중…" : "지난 기록 채우기"}</button>
      </div>
      {log.length > 0 && <div className="border-t border-slate-100 px-4 py-2 text-[11px] font-bold text-slate-600">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
      {ready && undefinedItems.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-black text-slate-800">미정의 품목 {undefinedItems.length}종 <span className="font-bold text-slate-400">· 아는 표기는 화면을 열 때 저절로 맞춰집니다. 남은 것은 재고 탭(부품·자가)에서 품목의 "품목 정보 → 별칭"에 이 이름을 넣은 뒤 [다시 맞추기]</span>
            <button type="button" disabled={renorm} onClick={() => void (async () => { setRenorm(true); try { const r = await renormalizeUndefined((d, t) => setLog([`맞추는 중 ${d}/${t}`])); setLog([]); notify(`${r.checked}행 확인 · ${r.fixed}행 맞춤`, "success"); await refresh(); } catch (e) { notify(`다시 맞추기 실패: ${(e as Error).message}`, "error"); } finally { setRenorm(false); } })()} className="ml-auto rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50">{renorm ? "맞추는 중…" : "다시 맞추기"}</button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{undefinedItems.map((u) => <span key={`${u.kind}|${u.item}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700"><span className="mr-1 text-[9px] font-black text-slate-400">{u.kind}</span>{u.item} <span className="text-slate-400">×{u.n}</span></span>)}</div>
        </div>
      )}
    </section>
  );
}
