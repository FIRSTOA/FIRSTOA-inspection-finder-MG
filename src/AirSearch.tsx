/** 청정기 거래처검색 — 모델명이 청정기 브랜드인 점검기록만. 선택 시 지난 청정기 양식(_원문) 불러오기. */
import { useEffect, useRef, useState } from "react";
import { searchAircleaner, getAirForms, type AirHit, type AirForm } from "./api";

type Props = {
  accent: string;
  onLoadForm: (text: string) => void;
  onVendor: (vendor: string) => void;
  onError: (msg: string) => void;
};

export default function AirSearch({ accent, onLoadForm, onVendor, onError }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AirHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const [vendor, setVendor] = useState("");
  const [forms, setForms] = useState<AirForm[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const reqSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === vendor) { setHits([]); return; }
    setSearching(true);
    setShowHits(true);
    const my = ++reqSeq.current;
    const h = window.setTimeout(() => {
      searchAircleaner(q)
        .then((r) => { if (my === reqSeq.current) { setHits(r); setShowHits(true); } })
        .catch((e) => onError(e.message || "검색 실패"))
        .finally(() => { if (my === reqSeq.current) setSearching(false); });
    }, 300);
    return () => window.clearTimeout(h);
  }, [query, vendor, onError]);

  const pick = (v: string) => {
    setVendor(v); setQuery(v); setHits([]); setShowHits(false); setForms([]); setLoadingForms(true);
    onVendor(v);
    getAirForms(v)
      .then(setForms)
      .catch((e) => onError(e.message || "양식 조회 실패"))
      .finally(() => setLoadingForms(false));
  };

  return (
    <div>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (vendor) setVendor(""); }}
          onFocus={() => hits.length && setShowHits(true)}
          placeholder="청정기 거래처명 입력"
          autoFocus
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[15px] outline-none transition focus:bg-white"
          style={{ borderColor: query ? accent : undefined }}
        />
        {query && (
          <button type="button" onClick={() => { setQuery(""); setVendor(""); setHits([]); setForms([]); setShowHits(false); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">✕</button>
        )}

        {showHits && (
          <div className="absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            {searching && <div className="px-3.5 py-2.5 text-sm text-slate-400">검색 중…</div>}
            {!searching && hits.length === 0 && <div className="px-3.5 py-2.5 text-sm text-slate-400">청정기 기록이 있는 거래처가 없어요</div>}
            {!searching && hits.map((h) => (
              <button key={h.vendor} type="button" onClick={() => pick(h.vendor)}
                className="block w-full border-b border-slate-50 px-3.5 py-2.5 text-left last:border-0 hover:bg-slate-50">
                <div className="truncate text-[15px] font-medium text-slate-800">{h.vendor}</div>
                <div className="mt-0.5 truncate text-[11px] text-slate-500">
                  {[h.date, h.model, h.region, h.author].filter(Boolean).join(" · ")}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {vendor && (
        <div className="mt-4 space-y-2.5">
          {loadingForms && <div className="px-1 py-3 text-sm text-slate-400">양식 불러오는 중…</div>}
          {!loadingForms && forms.length === 0 && (
            <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">이 거래처의 청정기 기록이 없어요</div>
          )}
          {forms.map((f, i) => (
            <div key={i} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-white" style={{ background: accent }}>청정기</span>
                  <span className="shrink-0 text-sm font-medium text-slate-600">{f.date || "-"}</span>
                </div>
                {f.text && (
                  <button type="button" onClick={() => onLoadForm(f.text)}
                    className="shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition active:scale-95" style={{ background: accent }}>
                    불러오기
                  </button>
                )}
              </div>
              {(f.model || f.region || f.author) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[f.model, f.region, f.author].filter(Boolean).map((c, j) => (
                    <span key={j} className="rounded-lg bg-slate-50 px-2 py-0.5 text-xs text-slate-500">{c}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
