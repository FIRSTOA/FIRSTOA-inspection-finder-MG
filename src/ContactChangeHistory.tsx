import { useEffect, useMemo, useState } from "react";
import { selectRows } from "./supabase";

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
          <div>
            <h2 className="text-xl font-black text-slate-950">담당자·주소 변경</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">FIELD에서 전송한 변경 요청을 업체·지역별로 확인합니다.</p>
          </div>
          <div className="text-sm font-black text-slate-700">{filtered.length}건</div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업체명 · 담당자 · 변경 내용 검색" className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
          <div className="flex rounded-md bg-slate-100 p-1">
            {REGIONS.map((value) => <button key={value} type="button" onClick={() => setRegion(value)} className={`rounded px-3 py-1.5 text-xs font-black ${region === value ? "bg-slate-900 text-white" : "text-slate-500"}`}>{value === "전체" ? "전체" : `${value}팀`}</button>)}
          </div>
        </div>
      </section>

      {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">변경 기록을 불러오는 중입니다.</div>}
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">기록을 불러오지 못했습니다. Supabase SQL Editor에서 `contact-changes.sql`을 실행해 주세요.<br /><span className="text-xs">{error}</span></div>}
      {!loading && !error && <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {!filtered.length ? <div className="p-12 text-center text-sm font-semibold text-slate-400">아직 저장된 변경 기록이 없습니다.</div> : <div className="divide-y divide-slate-100">
          {filtered.map((row) => <details key={row.id} className="group">
            <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{row.region || "-"}</span>
              <span className="min-w-0"><b className="block truncate text-sm text-slate-900">{row.company || "업체명 미기재"}</b><span className="block truncate text-xs font-semibold text-slate-500">{row.category || "변경"} · {row.reason || "사유 미기재"}</span></span>
              <span className="text-right text-[11px] font-semibold text-slate-400">{dateLabel(row.change_date || row.created_at)}<br />{row.author || "-"}</span>
            </summary>
            <div className="grid gap-3 border-t border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
              <div><div className="text-[11px] font-black text-slate-400">변경 전</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-700">{row.before_text || "-"}</div></div>
              <div><div className="text-[11px] font-black text-slate-400">변경 후</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-900">{row.after_text || "-"}</div></div>
              {row.notes && <div className="md:col-span-2"><div className="text-[11px] font-black text-slate-400">특이사항</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-700">{row.notes}</div></div>}
              <div className="flex flex-wrap items-center gap-2 md:col-span-2"><span className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-600">등급 {row.grade || "-"}</span>{row.photo_link && <a href={row.photo_link} target="_blank" rel="noreferrer" className="rounded border border-blue-200 bg-white px-3 py-1.5 text-xs font-black text-blue-700">첨부 사진 보기</a>}</div>
            </div>
          </details>)}
        </div>}
      </section>}
    </div>
  );
}
