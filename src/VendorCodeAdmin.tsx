/**
 * 거래처 코드 미매칭 확정 — 워킨맵 지점 중 자동 매핑(시리얼>자산>이름)이 못 이은
 * 곳을 사람이 임대리스트 거래처와 직접 연결한다. 확정분(method='manual')은
 * 자동 재매핑(map_workin_vendor_codes)이 다시 돌아도 보존된다.
 */
import { useEffect, useMemo, useState } from "react";
import { Link2, RefreshCw, Search } from "lucide-react";
import { selectAllRows, selectRows, upsertRow } from "./supabase";
import { clearWorkinCodeCache } from "./vendorCodes";

type PlaceRow = { id: number; name: string; team: string; kind: string; quarter: number };
type MasterRow = { code: string; name: string; device_count: number };

export default function VendorCodeAdmin() {
  const [unmatched, setUnmatched] = useState<PlaceRow[]>([]);
  const [methodCounts, setMethodCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MasterRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingCode, setSavingCode] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [places, codes] = await Promise.all([
        selectAllRows<PlaceRow>("workin_map_places", "select=id,name,team,kind,quarter&visible=not.is.false&order=team.asc,name.asc"),
        selectAllRows<{ place_id: number; method: string }>("workin_vendor_code", "select=place_id,method&order=place_id.asc"),
      ]);
      const mapped = new Set(codes.map((c) => Number(c.place_id)));
      const counts = new Map<string, number>();
      for (const c of codes) counts.set(c.method, (counts.get(c.method) || 0) + 1);
      setMethodCounts(counts);
      setUnmatched(places.filter((p) => !mapped.has(Number(p.id))));
    } catch (e) {
      setNotice(`불러오기 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const search = async (raw: string) => {
    const q = raw.trim();
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const rows = await selectRows<MasterRow>("vendor_master", `select=code,name,device_count&name=ilike.*${encodeURIComponent(q)}*&order=device_count.desc&limit=8`);
      setResults(rows);
    } catch { setResults([]); } finally { setSearching(false); }
  };

  const confirm = async (place: PlaceRow, master: MasterRow) => {
    setSavingCode(master.code);
    try {
      await upsertRow("workin_vendor_code", { place_id: place.id, code: master.code, method: "manual", matched: `수동확정: ${master.name}` }, "place_id");
      clearWorkinCodeCache(); // 뱃지·재계약 매칭이 다음 로드에서 새 코드를 쓰게
      setUnmatched((cur) => cur.filter((p) => p.id !== place.id));
      setMethodCounts((cur) => { const next = new Map(cur); next.set("manual", (next.get("manual") || 0) + 1); return next; });
      setActiveId(null); setQuery(""); setResults([]);
      setNotice(`✅ ${place.name.slice(0, 20)} → ${master.name} 연결됨`);
    } catch (e) {
      setNotice(`저장 실패: ${(e as Error).message}`);
    } finally { setSavingCode(""); }
  };

  const summary = useMemo(() => {
    const total = ["serial", "asset", "name", "manual"].reduce((sum, m) => sum + (methodCounts.get(m) || 0), 0);
    return `연결됨 ${total}곳 (시리얼 ${methodCounts.get("serial") || 0} · 자산 ${methodCounts.get("asset") || 0} · 이름 ${methodCounts.get("name") || 0} · 수동 ${methodCounts.get("manual") || 0})`;
  }, [methodCounts]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div>
          <h3 className="text-base font-black text-slate-950 lg:text-lg">거래처 코드 미매칭 확정</h3>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">워킨맵 지점을 임대리스트 거래처와 연결합니다 — {summary}</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />새로고침
        </button>
      </div>
      {notice && <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700">{notice}</div>}
      <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
        {unmatched.map((place) => (
          <div key={place.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{place.team}팀 · {place.kind === "renewal" ? "재계약" : place.kind === "monthly" ? "매월" : "점검"}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700" title={place.name}>{place.name}</span>
              <button type="button" onClick={() => { setActiveId(activeId === place.id ? null : place.id); setQuery(""); setResults([]); }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-700 transition hover:bg-blue-100">
                <Link2 size={11} />{activeId === place.id ? "닫기" : "연결"}
              </button>
            </div>
            {activeId === place.id && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex items-center gap-1.5">
                  <Search size={13} className="shrink-0 text-slate-400" />
                  <input value={query} autoFocus
                    onChange={(e) => { setQuery(e.target.value); void search(e.target.value); }}
                    placeholder="임대리스트 거래처명 검색 (2자 이상)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold outline-none transition focus:border-blue-500" />
                </div>
                <div className="mt-1.5 space-y-1">
                  {results.map((m) => (
                    <button key={m.code} type="button" disabled={savingCode === m.code} onClick={() => void confirm(place, m)}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left transition hover:border-blue-400 hover:bg-blue-50 disabled:opacity-40">
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">{m.name}</span>
                      <span className="shrink-0 text-[10px] font-bold text-slate-400">기기 {m.device_count}대</span>
                      <span className="shrink-0 font-mono text-[10px] font-bold text-slate-300">{m.code}</span>
                    </button>
                  ))}
                  {!results.length && query.trim().length >= 2 && !searching && <div className="px-1 py-1 text-[11px] font-semibold text-slate-400">검색 결과 없음 — 임대리스트에 없는 곳(신규·타사)일 수 있습니다.</div>}
                </div>
              </div>
            )}
          </div>
        ))}
        {!unmatched.length && <div className="p-8 text-center text-sm font-bold text-slate-400">{loading ? "불러오는 중…" : "🎉 미매칭 지점이 없습니다 — 전부 연결됐습니다."}</div>}
      </div>
    </section>
  );
}
