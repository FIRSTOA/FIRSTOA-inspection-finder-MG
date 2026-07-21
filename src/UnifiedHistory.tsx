import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  Layers3,
  MapPin,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { getVendorHistoryDetail, searchVendorHistoryCandidates, type DetailResp, type VendorHit } from "./api";
import { normRegion, primaryRegion, REGIONS, REGION_LABEL, vendorRegion } from "./region";

type Props = {
  vendor: string;
  accent: string;
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
};

const CAT_ORDER = ["점검", "AS", "초과", "미수", "불만", "복합기확장성", "PC확장성", "재계약", "업체정보"];
const ACTIVITY_CATS = ["점검", "AS", "초과", "미수", "불만", "복합기확장성", "PC확장성"];
const CAT_SHORT: Record<string, string> = {
  점검: "점검", AS: "AS", 초과: "초과", 미수: "미수", 불만: "불만",
  복합기확장성: "복합기", PC확장성: "PC·IT", 재계약: "재계약", 업체정보: "업체정보",
};
const DATE_FIELD: Record<string, string> = {
  AS: "작성일", 점검: "작성일", 초과: "방문일", 불만: "방문일", 미수: "입력일",
  PC확장성: "날짜", 복합기확장성: "등록일", 업체정보: "종료일", 재계약: "계약종료일",
};
const WHO_KEYS = ["담당팀", "작성팀", "작성자", "입력자", "등록자", "관리담당자", "전략영업담당자"];
const REGION_KEYS = ["지역", "미팅지역", "시/구"];
const ALBUM_RX = /https?:\/\/\S*[?&]album=[\w-]+/;

type SummaryField = { key: string; value: string };

function pick(rec: Record<string, unknown>, keys: string[]): { key: string; val: string } {
  for (const key of keys) {
    const value = String(rec[key] ?? "").trim();
    if (value) return { key, val: value };
  }
  return { key: "", val: "" };
}

function recordVendor(rec: Record<string, unknown>) {
  return String(rec._업체명 || rec.업체명 || rec.상호명 || "").trim();
}

function recordSummary(cat: string, rec: Record<string, unknown>, exclude: string[]) {
  const dateKey = DATE_FIELD[cat];
  const date = dateKey ? String(rec[dateKey] ?? "") : "";
  const skip = new Set([dateKey, ...exclude]);
  const fields: SummaryField[] = [];
  let album = "";
  for (const [key, value] of Object.entries(rec)) {
    const text = String(value ?? "").trim();
    if (!album) album = text.match(ALBUM_RX)?.[0] || "";
    if (skip.has(key) || key.startsWith("_") || !text) continue;
    fields.push({ key, value: text });
  }
  return { date, fields, album };
}

function recordRegionCode(rec: Record<string, unknown>, hits: VendorHit[]) {
  const direct = pick(rec, REGION_KEYS).val;
  const normalized = normRegion(direct);
  if (REGIONS.includes(normalized)) return normalized;
  const vendor = recordVendor(rec);
  const hit = hits.find((candidate) => candidate.vendor === vendor);
  const fallback = hit ? primaryRegion(hit) : "";
  if (REGIONS.includes(fallback)) return fallback;
  const groupRegions = Array.from(new Set(hits.map(primaryRegion).filter((region) => REGIONS.includes(region))));
  return groupRegions.length === 1 ? groupRegions[0] : "기타";
}

function latestRecord(cat: string, rows: Array<Record<string, unknown>>) {
  const dateKey = DATE_FIELD[cat];
  return [...rows].sort((left, right) => String(right[dateKey] ?? "").localeCompare(String(left[dateKey] ?? "")))[0];
}

function SearchResult({ hit, onSelect }: { hit: VendorHit; onSelect: (vendor: string) => void }) {
  const normalizedRegion = normRegion(primaryRegion(hit));
  const region = REGIONS.includes(normalizedRegion) ? normalizedRegion : "";
  const categories = CAT_ORDER.filter((cat) => Number(hit.counts?.[cat] || 0) > 0).map((cat) => `${CAT_SHORT[cat]} ${hit.counts[cat]}`);
  let recentDate = "";
  let recentRegion = "";
  Object.values(hit.meta || {}).forEach((entry) => {
    if (entry?.d && entry.d > recentDate) {
      recentDate = entry.d;
      recentRegion = entry.r;
    }
  });
  return <button type="button" onClick={() => onSelect(hit.vendor)} className="block w-full border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50">
    <div className="flex items-center gap-2">
      {region && <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-black text-white">{region}</span>}
      <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-800">{hit.vendor}</span>
    </div>
    {recentDate && <div className="mt-1 text-[11px] font-semibold text-slate-500">최근 {recentDate}{recentRegion ? ` · ${recentRegion}` : ""}</div>}
    {categories.length > 0 && <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{categories.join(" · ")}</div>}
  </button>;
}

export default function UnifiedHistory({ vendor, accent, open, onClose, onError }: Props) {
  const [queryVendor, setQueryVendor] = useState("");
  const [detail, setDetail] = useState<DetailResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCat, setActiveCat] = useState("전체");
  const [includedHits, setIncludedHits] = useState<VendorHit[]>([]);
  const [historyRegion, setHistoryRegion] = useState("전체");
  const [historyVendor, setHistoryVendor] = useState("전체");
  const [scopeOpen, setScopeOpen] = useState(true);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VendorHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const [searchRegion, setSearchRegion] = useState("전체");
  const requestSequence = useRef(0);
  const loadedFor = useRef("");

  const searchBase = useMemo(() => hits.filter((hit) => CAT_ORDER.some((cat) => Number(hit.counts?.[cat] || 0) > 0)), [hits]);
  const searchRegionTabs = useMemo(() => {
    const hasEtc = searchBase.some((hit) => vendorRegion(hit) === "기타");
    return ["전체", ...REGIONS, ...(hasEtc ? ["기타"] : [])];
  }, [searchBase]);
  const visibleSearchHits = searchRegion === "전체" ? searchBase : searchBase.filter((hit) => vendorRegion(hit) === searchRegion);

  useEffect(() => {
    let active = true;
    if (open) queueMicrotask(() => {
      if (!active) return;
      const initialVendor = vendor.trim();
      loadedFor.current = "";
      setQueryVendor(initialVendor);
      setDetail(null);
      setHits([]);
      setQ(initialVendor);
      setActiveCat("전체");
      setIncludedHits([]);
      setHistoryRegion("전체");
      setHistoryVendor("전체");
      setScopeOpen(true);
      setShowHits(false);
    });
    return () => { active = false; };
  }, [open, vendor]);

  useEffect(() => {
    const query = q.trim();
    if (!open || query.length < 2) return;
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchVendorHistoryCandidates(query)
        .then((response) => {
          if (sequence !== requestSequence.current) return;
          setHits(response.results || []);
          setSearchRegion("전체");
        })
        .catch((error) => onError(error.message || "검색 실패"))
        .finally(() => { if (sequence === requestSequence.current) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, open, onError]);

  useEffect(() => {
    if (!open || !queryVendor || loadedFor.current === queryVendor) return;
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoading(true);
        setDetail(null);
        return getVendorHistoryDetail(queryVendor);
      })
      .then((result) => {
        if (!active || !result) return;
        setDetail(result.detail);
        setIncludedHits(result.candidates);
        setHistoryRegion("전체");
        setHistoryVendor("전체");
        setActiveCat("전체");
        loadedFor.current = queryVendor;
      })
      .catch((error) => onError(error.message || "통합이력 조회 실패"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, queryVendor, onError]);

  const allRows = useMemo(() => CAT_ORDER.flatMap((cat) => {
    const rows = Array.isArray(detail?.[cat]) ? detail[cat] as Array<Record<string, unknown>> : [];
    return rows.map((record) => ({ cat, record }));
  }), [detail]);

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allRows.forEach(({ record }) => {
      const region = recordRegionCode(record, includedHits);
      counts[region] = (counts[region] || 0) + 1;
    });
    return counts;
  }, [allRows, includedHits]);

  const historyRegionTabs = useMemo(() => ["전체", ...REGIONS.filter((region) => regionCounts[region]), ...(regionCounts.기타 ? ["기타"] : [])], [regionCounts]);

  const rowsForCategory = (cat: string) => {
    const rows = Array.isArray(detail?.[cat]) ? detail[cat] as Array<Record<string, unknown>> : [];
    return rows.filter((record) => {
      if (historyRegion !== "전체" && recordRegionCode(record, includedHits) !== historyRegion) return false;
      if (historyVendor !== "전체" && recordVendor(record) !== historyVendor) return false;
      return true;
    });
  };

  const visibleAliases = useMemo(() => includedHits.filter((hit) => {
    if (historyRegion === "전체") return true;
    return allRows.some(({ record }) => recordVendor(record) === hit.vendor && recordRegionCode(record, includedHits) === historyRegion)
      || vendorRegion(hit) === historyRegion;
  }), [includedHits, historyRegion, allRows]);

  const totalCount = CAT_ORDER.reduce((sum, cat) => sum + rowsForCategory(cat).length, 0);
  const latestDate = ACTIVITY_CATS.flatMap((cat) => rowsForCategory(cat).map((record) => String(record[DATE_FIELD[cat]] || ""))).filter(Boolean).sort().at(-1) || "없음";
  const records = activeCat === "전체" ? [] : rowsForCategory(activeCat).slice().sort((left, right) => String(right[DATE_FIELD[activeCat]] ?? "").localeCompare(String(left[DATE_FIELD[activeCat]] ?? "")));

  const selectNewVendor = (nextVendor: string) => {
    setQueryVendor(nextVendor);
    setQ(nextVendor);
    setShowHits(false);
    loadedFor.current = "";
  };

  if (!open) return null;

  return <div className="fixed inset-0 z-[70] flex items-end bg-slate-950/45 sm:items-center sm:justify-center" onClick={onClose}>
    <div className="flex h-[94vh] w-full flex-col overflow-hidden rounded-t-lg bg-slate-100 shadow-2xl sm:h-[88vh] sm:max-w-4xl sm:rounded-lg" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center gap-3 bg-slate-950 px-4 py-3 text-white sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/10"><Layers3 size={19} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black sm:text-base">통합이력</h2>
          <p className="truncate text-[11px] font-semibold text-slate-400">{queryVendor || "거래처를 검색하세요"}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white"><X size={19} /></button>
      </header>

      <div className="relative border-b border-slate-200 bg-white p-3 sm:px-5">
        <Search size={17} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 sm:left-8" />
        <input value={q} onChange={(event) => { const value = event.target.value; setQ(value); setHits([]); setShowHits(value.trim().length >= 2); }} onFocus={() => hits.length && setShowHits(true)} placeholder="거래처 이름 검색" className="h-10 w-full rounded-md border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm font-semibold outline-none focus:border-blue-500 focus:bg-white" />
        {showHits && <div className="absolute left-3 right-3 top-[54px] z-30 max-h-[55vh] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl sm:left-5 sm:right-5">
          {searching && <div className="px-3 py-3 text-xs font-semibold text-slate-400">검색 중...</div>}
          {!searching && searchBase.length > 0 && <div className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50 px-2 py-2">{searchRegionTabs.map((region) => <button key={region} type="button" onClick={() => setSearchRegion(region)} className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-black ${searchRegion === region ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{REGION_LABEL[region] ? `${region} ${REGION_LABEL[region]}` : region}</button>)}</div>}
          {!searching && visibleSearchHits.map((hit) => <SearchResult key={hit.vendor} hit={hit} onSelect={selectNewVendor} />)}
          {!searching && visibleSearchHits.length === 0 && <div className="px-3 py-3 text-xs font-semibold text-slate-400">이력이 있는 거래처가 없습니다.</div>}
        </div>}
      </div>

      {!loading && detail && <section className="border-b border-slate-200 bg-white">
        <div className="grid grid-cols-3 divide-x divide-slate-200">
          <div className="px-3 py-3 sm:px-5"><div className="text-[10px] font-black text-slate-400">통합 이름</div><div className="mt-1 text-base font-black text-slate-950">{includedHits.length}개</div></div>
          <div className="px-3 py-3 sm:px-5"><div className="text-[10px] font-black text-slate-400">현재 기록</div><div className="mt-1 text-base font-black text-slate-950">{totalCount}건</div></div>
          <div className="px-3 py-3 sm:px-5"><div className="text-[10px] font-black text-slate-400">최근 기록</div><div className="mt-1 truncate text-sm font-black text-slate-950">{latestDate}</div></div>
        </div>
        <button type="button" onClick={() => setScopeOpen(!scopeOpen)} className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left sm:px-5"><Building2 size={16} className="text-slate-500" /><span className="flex-1 text-xs font-black text-slate-700">조회 범위</span><span className="text-[10px] font-bold text-slate-400">{historyRegion === "전체" ? "전체 지역" : `${historyRegion} ${REGION_LABEL[historyRegion] || ""}`} · {historyVendor === "전체" ? "전체 이름" : historyVendor}</span><ChevronDown size={16} className={`text-slate-400 transition ${scopeOpen ? "rotate-180" : ""}`} /></button>
        {scopeOpen && <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-3 py-3 sm:px-5">
          <div><div className="mb-1.5 text-[10px] font-black text-slate-400">지역</div><div className="flex gap-1.5 overflow-x-auto pb-0.5">{historyRegionTabs.map((region) => <button key={region} type="button" onClick={() => { setHistoryRegion(region); setHistoryVendor("전체"); setActiveCat("전체"); }} className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-black ${historyRegion === region ? "text-white" : "border border-slate-200 bg-white text-slate-600"}`} style={historyRegion === region ? { background: accent } : undefined}>{REGION_LABEL[region] ? `${region} ${REGION_LABEL[region]}` : region}<span className="ml-1 opacity-70">{region === "전체" ? allRows.length : regionCounts[region] || 0}</span></button>)}</div></div>
          <div><div className="mb-1.5 text-[10px] font-black text-slate-400">포함된 거래처 이름</div><div className="flex gap-1.5 overflow-x-auto pb-0.5"><button type="button" onClick={() => { setHistoryVendor("전체"); setActiveCat("전체"); }} className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-black ${historyVendor === "전체" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>전체 이름</button>{visibleAliases.map((hit) => {
            const normalizedAliasRegion = normRegion(primaryRegion(hit));
            const aliasRegion = REGIONS.includes(normalizedAliasRegion) ? normalizedAliasRegion : "-";
            return <button key={hit.vendor} type="button" onClick={() => { setHistoryVendor(hit.vendor); setActiveCat("전체"); }} className={`flex max-w-[260px] shrink-0 items-center rounded-md px-2.5 py-1.5 text-[11px] font-black ${historyVendor === hit.vendor ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}><span className="mr-1 shrink-0 text-[9px] text-slate-400">{aliasRegion}</span><span className="truncate">{hit.vendor}</span></button>;
          })}</div></div>
        </div>}
      </section>}

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 sm:px-5">
        <button type="button" onClick={() => setActiveCat("전체")} className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-black ${activeCat === "전체" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>요약 {totalCount || ""}</button>
        {CAT_ORDER.map((cat) => {
          const count = rowsForCategory(cat).length;
          return <button key={cat} type="button" disabled={!count} onClick={() => setActiveCat(cat)} className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-black ${activeCat === cat ? "text-white" : count ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-300"}`} style={activeCat === cat ? { background: accent } : undefined}>{CAT_SHORT[cat]}{count ? ` ${count}` : ""}</button>;
        })}
      </nav>

      <main className="flex-1 overflow-y-auto p-3 sm:p-5">
        {loading && <div className="py-16 text-center text-sm font-semibold text-slate-400">전체 이력을 모으는 중...</div>}
        {!loading && !queryVendor && <div className="py-16 text-center text-sm font-semibold text-slate-400">거래처를 검색해 주세요.</div>}
        {!loading && detail && activeCat === "전체" && <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-black text-slate-950">업무별 현황</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-500">선택한 지역과 거래처 이름에 해당하는 최근 기록입니다.</p></div>
          <div className="divide-y divide-slate-100">{CAT_ORDER.map((cat) => {
            const rows = rowsForCategory(cat);
            if (!rows.length) return null;
            const latest = latestRecord(cat, rows);
            const who = pick(latest, WHO_KEYS);
            const region = recordRegionCode(latest, includedHits);
            const vendorName = recordVendor(latest) || queryVendor;
            const summary = recordSummary(cat, latest, [who.key, ...REGION_KEYS]);
            const preview = summary.fields.slice(0, 2).map((field) => `${field.key} ${field.value.replace(/\s+/g, " ")}`).join(" · ");
            return <button key={cat} type="button" onClick={() => setActiveCat(cat)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"><span className="flex h-9 min-w-[52px] shrink-0 items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-black text-slate-700">{CAT_SHORT[cat]}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-sm font-black text-slate-950">{CAT_SHORT[cat]}</span><span className="text-[11px] font-black text-blue-600">{rows.length}건</span></span><span className="mt-0.5 block truncate text-xs font-bold text-slate-600">{vendorName}</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-400">{summary.date || "날짜 없음"} · {region}{who.val ? ` · ${who.val}` : ""}{preview ? ` · ${preview}` : ""}</span></span><ChevronRight size={17} className="shrink-0 text-slate-300" /></button>;
          })}{totalCount === 0 && <div className="py-12 text-center text-sm font-semibold text-slate-400">선택한 범위에 이력이 없습니다.</div>}</div>
        </section>}

        {!loading && detail && activeCat !== "전체" && <section className="space-y-2">
          <div className="flex items-end justify-between px-1 pb-1"><div><h3 className="text-sm font-black text-slate-950">{CAT_SHORT[activeCat]} 이력</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-500">최신순 · 항목을 누르면 전체 내용이 열립니다.</p></div><span className="text-xs font-black text-slate-500">{records.length}건</span></div>
          {records.map((record, index) => {
            const who = pick(record, WHO_KEYS);
            const directRegion = pick(record, REGION_KEYS);
            const region = recordRegionCode(record, includedHits);
            const vendorName = recordVendor(record) || queryVendor;
            const { date, fields, album } = recordSummary(activeCat, record, [who.key, directRegion.key]);
            const preview = fields.slice(0, 2).map((field) => `${field.key}: ${field.value.replace(/\s+/g, " ")}`).join(" · ");
            return <details key={`${vendorName}-${date}-${index}`} className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden sm:px-4">
                <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md bg-slate-100 text-slate-700"><CalendarDays size={15} /><span className="mt-0.5 text-[9px] font-black">{date ? date.slice(5).replace("-", "/") : "-"}</span></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-slate-950">{vendorName}</span><span className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-slate-500"><span className="flex items-center gap-0.5"><MapPin size={11} />{region}</span>{who.val && <span className="flex min-w-0 items-center gap-0.5 truncate"><UserRound size={11} />{who.val}</span>}</span>{preview && <span className="mt-1 block truncate text-[11px] font-semibold text-slate-400">{preview}</span>}</span>
                <ChevronDown size={17} className="shrink-0 text-slate-400 transition group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-200 bg-slate-50">
                <div className="grid gap-px bg-slate-200 sm:grid-cols-2">{fields.map((field, fieldIndex) => <div key={`${field.key}-${fieldIndex}`} className={`bg-white px-3 py-2.5 ${field.value.length > 48 || field.value.includes("\n") ? "sm:col-span-2" : ""}`}><div className="text-[10px] font-black text-slate-400">{field.key}</div><div className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-slate-700">{field.value}</div></div>)}{!fields.length && <div className="bg-white px-3 py-5 text-center text-xs font-semibold text-slate-400 sm:col-span-2">표시할 상세 내용이 없습니다.</div>}</div>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[10px] font-bold text-slate-500"><Clock3 size={13} />{date || "날짜 없음"}<span>·</span><Building2 size={13} />{vendorName}{album && <a href={album} target="_blank" rel="noreferrer" className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-white">사진·영상 보기</a>}</div>
              </div>
            </details>;
          })}
          {!records.length && <div className="rounded-lg border border-slate-200 bg-white py-12 text-center text-sm font-semibold text-slate-400">선택한 범위에 이력이 없습니다.</div>}
        </section>}
      </main>
    </div>
  </div>;
}
