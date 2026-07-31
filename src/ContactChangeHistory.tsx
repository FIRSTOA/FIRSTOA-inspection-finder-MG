import { useEffect, useMemo, useState } from "react";
import { selectAllRows, selectRows, updateRows } from "./supabase";
import { vendorMatchKey } from "./ids";

type ContactChangeRow = {
  id: string;
  created_at: string;
  change_date: string;
  author: string;
  company: string;
  region: string;
  category: string;
  reason: string;
  grade: string;
  before_text: string;
  after_text: string;
  notes: string;
  source_text: string;
  photo_link: string;
};

const REGIONS = ["전체", "A", "B", "C", "D"];

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function ContactChangeHistory() {
  const [rows, setRows] = useState<ContactChangeRow[]>([]);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("전체");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applyBusyId, setApplyBusyId] = useState("");

  // 변경 후 정보를 워킨맵(앱이 원본인 DB)에 반영한다.
  // 임대리스트(vendor_info)는 구글시트가 원본이라 여기서 바꾸면 다음 동기화 때 덮이므로 반영하지 않는다.
  const applyToWorkinMap = async (row: ContactChangeRow) => {
    if (applyBusyId) return;
    const after = String(row.after_text || "").trim();
    if (!after) { window.alert("변경 후 내용이 비어 있어 반영할 수 없습니다."); return; }
    const key = vendorMatchKey(row.company);
    if (!key) { window.alert("업체명으로 워킨맵을 매칭할 수 없습니다."); return; }
    setApplyBusyId(row.id);
    try {
      const places = await selectAllRows<{ id: number; name: string; memos: string[] | null }>("workin_map_places", "select=id,name,memos");
      const matches = places.filter((place) => {
        const placeKey = vendorMatchKey(place.name || "");
        return placeKey && (placeKey === key || (placeKey.length >= 5 && key.length >= 5 && (placeKey.includes(key) || key.includes(placeKey))));
      });
      if (!matches.length) { window.alert("워킨맵에서 일치하는 거래처를 찾지 못했습니다."); return; }
      const isAddress = /주소/.test(row.category);
      const fieldLabel = isAddress ? "주소" : "연락처";
      const names = matches.slice(0, 5).map((m) => m.name).join("\n");
      if (!window.confirm(`워킨맵 ${matches.length}곳의 ${fieldLabel}를 아래 내용으로 바꿉니다.

${names}${matches.length > 5 ? `
외 ${matches.length - 5}곳` : ""}

변경 후: ${after}
계속할까요?`)) return;
      for (const match of matches) {
        const memos = Array.isArray(match.memos) ? match.memos.map(String) : [];
        memos.push(`[변경반영] ${new Date().toISOString().slice(0, 10)} ${row.category || "변경"} → ${after}`.slice(0, 300));
        await updateRows("workin_map_places", `id=eq.${match.id}`, isAddress ? { address: after, address_detail: "", memos } : { phone: after, memos });
      }
      window.alert(`워킨맵 ${matches.length}곳에 반영했습니다.`);
    } catch (e) {
      window.alert(`반영 실패: ${(e as Error).message}`);
    } finally {
      setApplyBusyId("");
    }
  };

  useEffect(() => {
    let mounted = true;
    selectRows<ContactChangeRow>("contact_changes", "select=*&order=change_date.desc,created_at.desc&limit=500")
      .then((result) => { if (mounted) setRows(result); })
      .catch((reason) => { if (mounted) setError((reason as Error).message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (region !== "전체" && row.region.trim().toUpperCase() !== region) return false;
      if (!keyword) return true;
      return [row.company, row.author, row.category, row.reason, row.before_text, row.after_text, row.notes]
        .join(" ").toLowerCase().includes(keyword);
    });
  }, [rows, query, region]);

  return (
    <div className="space-y-3 pb-12">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-xs font-semibold text-slate-500">FIELD에서 전송한 변경 요청을 업체·지역별로 확인하고, 워킨맵에 반영합니다.</p>
          <div className="text-sm font-black text-slate-700">{filtered.length}건</div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업체명 · 담당자 · 변경 내용 검색" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <div className="flex rounded-full bg-slate-100 p-1">
            {REGIONS.map((value) => <button key={value} type="button" onClick={() => setRegion(value)} className={`rounded-full px-3 py-1.5 text-xs font-black ${region === value ? "bg-slate-900 text-white" : "text-slate-500"}`}>{value === "전체" ? "전체" : `${value}팀`}</button>)}
          </div>
        </div>
      </section>

      {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">변경 기록을 불러오는 중입니다.</div>}
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">기록을 불러오지 못했습니다. Supabase SQL Editor에서 `contact-changes.sql`을 실행해 주세요.<br /><span className="text-xs">{error}</span></div>}
      {!loading && !error && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {!filtered.length ? <div className="p-12 text-center text-sm font-semibold text-slate-400">아직 저장된 변경 기록이 없습니다.</div> : <div className="divide-y divide-slate-100">
          {filtered.map((row) => <details key={row.id} className="group">
            <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">{row.region || "-"}</span>
              <span className="min-w-0"><b className="block truncate text-sm text-slate-900">{row.company || "업체명 미기재"}</b><span className="block truncate text-xs font-semibold text-slate-500">{row.category || "변경"} · {row.reason || "사유 미기재"}</span></span>
              <span className="text-right text-[11px] font-semibold text-slate-400">{dateLabel(row.change_date || row.created_at)}<br />{row.author || "-"}</span>
            </summary>
            <div className="grid gap-3 border-t border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
              <div><div className="text-[11px] font-black text-slate-400">변경 전</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-700">{row.before_text || "-"}</div></div>
              <div><div className="text-[11px] font-black text-slate-400">변경 후</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-900">{row.after_text || "-"}</div></div>
              {row.notes && <div className="md:col-span-2"><div className="text-[11px] font-black text-slate-400">특이사항</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-700">{row.notes}</div></div>}
              <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                <span className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-600">등급 {row.grade || "-"}</span>
                {row.photo_link && <a href={row.photo_link} target="_blank" rel="noreferrer" className="rounded border border-blue-200 bg-white px-3 py-1.5 text-xs font-black text-blue-700">첨부 사진 보기</a>}
                <button type="button" disabled={applyBusyId === row.id} onClick={() => void applyToWorkinMap(row)} className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 disabled:opacity-50">{applyBusyId === row.id ? "반영 중…" : "워킨맵 반영"}</button>
                <span className="text-[10px] font-semibold text-slate-400">임대리스트는 시트가 원본이라 시트에서 수정해야 합니다</span>
              </div>
            </div>
          </details>)}
        </div>}
      </section>}
    </div>
  );
}
