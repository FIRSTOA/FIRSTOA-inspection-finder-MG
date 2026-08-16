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
import { getVendorFlagsBatch, type VendorWorkFlags } from "./vendorFlags";
import { usageSpareAdvice } from "./spareAdvice";
import { selectRows } from "./supabase";

type Props = {
  vendor: string;
  accent: string;
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
};

const CAT_ORDER = ["접수", "점검", "AS", "초과", "미수", "불만", "복합기확장성", "PC확장성", "재계약", "업체정보"];
const ACTIVITY_CATS = ["접수", "점검", "AS", "초과", "미수", "불만", "복합기확장성", "PC확장성"];
const CAT_SHORT: Record<string, string> = {
  접수: "접수", 점검: "점검", AS: "AS", 초과: "초과", 미수: "미수", 불만: "불만",
  복합기확장성: "복합기", PC확장성: "PC·IT", 재계약: "재계약", 업체정보: "업체정보",
};
const DATE_FIELD: Record<string, string> = {
  접수: "receipt_date", AS: "작성일", 점검: "작성일", 초과: "방문일", 불만: "방문일", 미수: "입력일",
  PC확장성: "날짜", 복합기확장성: "등록일", 업체정보: "종료일", 재계약: "계약종료일",
};
const WHO_KEYS = ["담당팀", "작성팀", "작성자", "입력자", "등록자", "관리담당자", "전략영업담당자", "author"];
const REGION_KEYS = ["지역", "미팅지역", "시/구", "region"];
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
  return String(rec._업체명 || rec.업체명 || rec.상호명 || rec.vendor || "").trim();
}

function displayDate(value: unknown) {
  const raw = String(value ?? "").trim();
  const isoDate = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const localDate = raw.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (localDate) return `${localDate[1]}-${localDate[2].padStart(2, "0")}-${localDate[3].padStart(2, "0")}`;
  return raw;
}

// 분류 기본 날짜 칸이 비어 있으면(재계약 계약종료일, 초과료 원장 등) 흔한 날짜 칸으로 폴백
function recordDateRaw(cat: string, rec: Record<string, unknown>) {
  const primary = String(rec[DATE_FIELD[cat]] ?? "").trim();
  if (primary) return primary;
  for (const key of ["날짜", "작성일", "입력일", "등록일", "방문일"]) {
    const value = String(rec[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function recordSummary(cat: string, rec: Record<string, unknown>, exclude: string[]) {
  const dateKey = DATE_FIELD[cat];
  const date = displayDate(recordDateRaw(cat, rec));
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
  return [...rows].sort((left, right) => recordDateRaw(cat, right).localeCompare(recordDateRaw(cat, left)))[0];
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
      {region && <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-black text-white">{region}</span>}
      <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-800">{hit.vendor}</span>
      {hit.matchedBy && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">{hit.matchedBy}</span>}
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
  const [scopeOpen, setScopeOpen] = useState(false); // 조회 범위는 기본 접힘 — 처음 화면을 단순하게

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
      setScopeOpen(false);
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
  const latestDate = displayDate(ACTIVITY_CATS.flatMap((cat) => rowsForCategory(cat).map((record) => recordDateRaw(cat, record))).filter(Boolean).sort().at(-1)) || "없음";
  const records = activeCat === "전체" ? [] : rowsForCategory(activeCat).slice().sort((left, right) => recordDateRaw(activeCat, right).localeCompare(recordDateRaw(activeCat, left)));
  // 접수 탭은 복합기 AS·원격이관·IT를 나눠 볼 수 있다
  const [receptionType, setReceptionType] = useState("전체");
  const visibleRecords = activeCat === "접수" && receptionType !== "전체" ? records.filter((r) => String(r["type"] || "") === receptionType) : records;

  // ── 이번 분기 체크 — 워킨맵·미수·초과·불만(일정리스트 배지와 같은 기준) + 최근 2회 점검으로 사용량·여분 계산
  const [flags, setFlags] = useState<VendorWorkFlags | null>(null);
  useEffect(() => {
    if (!open || !detail) { setFlags(null); return; }
    const names = Array.from(new Set([queryVendor, ...includedHits.map((hit) => hit.vendor)].map((n) => n.trim()).filter(Boolean)));
    if (!names.length) { setFlags(null); return; }
    let active = true;
    getVendorFlagsBatch(names).then((map) => {
      if (!active) return;
      const merged: VendorWorkFlags = { inspection: null, misu: null, renewal: null, overage: null, bulman: null };
      for (const name of names) {
        const f = map.get(name);
        if (!f) continue;
        merged.inspection = merged.inspection || f.inspection;
        merged.misu = merged.misu || f.misu;
        merged.renewal = merged.renewal || f.renewal;
        merged.overage = merged.overage || f.overage;
        merged.bulman = merged.bulman || f.bulman;
      }
      setFlags(merged);
    }).catch(() => { if (active) setFlags(null); });
    return () => { active = false; };
  }, [open, detail, queryVendor, includedHits]);
  const quarterCheck = useMemo(() => {
    const rows = Array.isArray(detail?.["점검"]) ? detail["점검"] as Array<Record<string, unknown>> : [];
    const sorted = [...rows].sort((a, b) => recordDateRaw("점검", b).localeCompare(recordDateRaw("점검", a)));
    const snap = (rec?: Record<string, unknown>) => rec ? {
      date: displayDate(recordDateRaw("점검", rec)), counts: String(rec["매수"] || ""), toner: String(rec["토너잔량"] || ""),
      spare: String(rec["여분"] || ""), waste: String(rec["폐통"] || ""), serial: String(rec["자산기번"] || ""),
    } : undefined;
    const latest = snap(sorted[0]);
    const previous = snap(sorted[1]);
    const advice = usageSpareAdvice(latest, previous, String(sorted[0]?.["모델명"] || ""));
    const specialRaw = String(sorted[0]?.["특이사항"] || "");
    const special = specialRaw.replace(/[ㅡ\-_.\s]/g, "") ? specialRaw.trim() : ""; // "ㅡㅡㅡ" 채움표시 제외
    return { latest, previous, advice, special };
  }, [detail]);
  // 임대리스트 기기 요약 — 임대중만 세고 복합기/PC/기타 구분, 최근 1년 내 납품/교체 감지
  const [devices, setDevices] = useState<{ mfp: number; pc: number; monitor: number; etc: number; ended: number; recentSwap: string } | null>(null);
  useEffect(() => {
    if (!open || !detail) { setDevices(null); return; }
    const names = Array.from(new Set([queryVendor, ...includedHits.map((hit) => hit.vendor)].map((n) => n.trim()).filter((n) => n.length >= 2))).slice(0, 6);
    if (!names.length) { setDevices(null); return; }
    let active = true;
    // "납품/교체일"의 슬래시는 PostgREST select가 못 읽어서 따옴표 별칭(swap:"납품/교체일")으로 우회
    const cols = `${encodeURIComponent("id,품목,임대여부")},swap:${encodeURIComponent("\"납품/교체일\"")}`;
    Promise.all(names.map((name) => selectRows<Record<string, unknown>>("vendor_info",
      `select=${cols}&${encodeURIComponent("_업체명")}=ilike.*${encodeURIComponent(name.slice(0, 24))}*&_hidden=not.is.true&limit=400`).catch(() => [])))
      .then((groups) => {
        if (!active) return;
        const rows = new Map<string, Record<string, unknown>>();
        groups.flat().forEach((row) => rows.set(String(row.id), row));
        const summary = { mfp: 0, pc: 0, monitor: 0, etc: 0, ended: 0, recentSwap: "" };
        const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        for (const row of rows.values()) {
          if (String(row["임대여부"] || "") !== "임대중") { summary.ended += 1; continue; }
          const item = String(row["품목"] || "");
          if (/복합기|프린터|플로터/.test(item)) summary.mfp += 1;
          else if (/모니터/i.test(item)) summary.monitor += 1; // "PC모니터"가 PC로 합산되면 대수가 부풀어 보인다 — 분리
          else if (/pc|데스크|노트북|태블릿|소프트웨어/i.test(item)) summary.pc += 1;
          else summary.etc += 1;
          // 납품/교체일: "2025-04-03" 또는 엑셀 일련번호("46140") 혼재
          const raw = String(row["swap"] || "").trim();
          const swap = /^\d{5}$/.test(raw)
            ? new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000).toISOString().slice(0, 10)
            : (raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "");
          if (swap && swap >= yearAgo && swap > summary.recentSwap && swap <= new Date().toISOString().slice(0, 10)) summary.recentSwap = swap;
        }
        setDevices(summary);
      })
      .catch(() => { if (active) setDevices(null); });
    return () => { active = false; };
  }, [open, detail, queryVendor, includedHits]);

  const selectNewVendor = (nextVendor: string) => {
    setQueryVendor(nextVendor);
    setQ(nextVendor);
    setShowHits(false);
    loadedFor.current = "";
  };

  // 같은 건물·같은 그룹에 법인이 여러 개인 경우(청연 등) — 업종 접두를 뗀 짧은 이름으로 넓혀 검색하는 지름길.
  // 자동으로 합치지는 않는다: 법인이 다르면 미수·초과도 다른 회사 것이라 섞으면 사고다.
  const broaderQuery = useMemo(() => {
    const q = queryVendor.trim();
    const stripped = q
      .replace(/^(세무그룹|세무법인|법무법인|회계법인|법률사무소|특허법인|노무법인|의료법인|주식회사|유한회사|㈜|\(주\))+\s*/, "")
      .replace(/(본사|지사|지점|사옥|타워|빌딩)$/, "")
      .trim();
    return stripped && stripped !== q && stripped.length >= 2 ? stripped : "";
  }, [queryVendor]);

  if (!open) return null;

  return <div className="fixed inset-0 z-[2600] flex items-end bg-slate-950/45 sm:items-center sm:justify-center" onClick={onClose}>
    <div className="flex h-[94vh] w-full flex-col overflow-hidden rounded-t-lg bg-slate-100 shadow-2xl sm:h-[88vh] sm:max-w-4xl sm:rounded-xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center gap-3 bg-slate-950 px-4 py-3 text-white sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10"><Layers3 size={19} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black sm:text-base">통합이력</h2>
          <p className="truncate text-[11px] font-semibold text-slate-400">{queryVendor || "거래처를 검색하세요"}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white"><X size={19} /></button>
      </header>

      <div className="relative border-b border-slate-200 bg-white p-3 sm:px-5">
        <Search size={17} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 sm:left-8" />
        <input value={q} onChange={(event) => { const value = event.target.value; setQ(value); setHits([]); setShowHits(value.trim().length >= 2); }} onFocus={() => hits.length && setShowHits(true)} placeholder="거래처 이름 검색" className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm font-semibold outline-none focus:border-blue-500 focus:bg-white" />
        {showHits && <div className="absolute left-3 right-3 top-[54px] z-30 max-h-[55vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl sm:left-5 sm:right-5">
          {searching && <div className="px-3 py-3 text-xs font-semibold text-slate-400">검색 중...</div>}
          {!searching && searchBase.length > 0 && <div className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50 px-2 py-2">{searchRegionTabs.map((region) => <button key={region} type="button" onClick={() => setSearchRegion(region)} className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${searchRegion === region ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{REGION_LABEL[region] ? `${region} ${REGION_LABEL[region]}` : region}</button>)}</div>}
          {!searching && visibleSearchHits.map((hit) => <SearchResult key={hit.vendor} hit={hit} onSelect={selectNewVendor} />)}
          {!searching && visibleSearchHits.length === 0 && <div className="px-3 py-3 text-xs font-semibold text-slate-400">이력이 있는 거래처가 없습니다.</div>}
        </div>}
      </div>

      {!loading && detail && broaderQuery && <div className="border-b border-slate-100 bg-white px-3 py-2 sm:px-5">
        <button type="button" onClick={() => selectNewVendor(broaderQuery)} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700 transition hover:bg-blue-100">
          🔍 "{broaderQuery}"(으)로 넓게 보기 — 같은 이름을 쓰는 다른 법인·지점까지
        </button>
      </div>}
      {!loading && detail && <section className="border-b border-slate-200 bg-white">
        <div className="grid grid-cols-3 divide-x divide-slate-200">
          <div className="px-3 py-3 sm:px-5"><div className="text-[10px] font-black text-slate-400">통합 이름</div><div className="mt-1 text-base font-black text-slate-950">{includedHits.length}개</div></div>
          <div className="px-3 py-3 sm:px-5"><div className="text-[10px] font-black text-slate-400">현재 기록</div><div className="mt-1 text-base font-black text-slate-950">{totalCount}건</div></div>
          <div className="px-3 py-3 sm:px-5"><div className="text-[10px] font-black text-slate-400">최근 기록</div><div className="mt-1 truncate text-sm font-black text-slate-950">{latestDate}</div></div>
        </div>
        <button type="button" onClick={() => setScopeOpen(!scopeOpen)} className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left sm:px-5"><Building2 size={16} className="text-slate-500" /><span className="flex-1 text-xs font-black text-slate-700">조회 범위</span><span className="text-[10px] font-bold text-slate-400">{historyRegion === "전체" ? "전체 지역" : `${historyRegion} ${REGION_LABEL[historyRegion] || ""}`} · {historyVendor === "전체" ? "전체 이름" : historyVendor}</span><ChevronDown size={16} className={`text-slate-400 transition ${scopeOpen ? "rotate-180" : ""}`} /></button>
        {scopeOpen && <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-3 py-3 sm:px-5">
          <div><div className="mb-1.5 text-[10px] font-black text-slate-400">지역</div><div className="flex gap-1.5 overflow-x-auto pb-0.5">{historyRegionTabs.map((region) => <button key={region} type="button" onClick={() => { setHistoryRegion(region); setHistoryVendor("전체"); setActiveCat("전체"); }} className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-black ${historyRegion === region ? "text-white" : "border border-slate-200 bg-white text-slate-600"}`} style={historyRegion === region ? { background: accent } : undefined}>{REGION_LABEL[region] ? `${region} ${REGION_LABEL[region]}` : region}<span className="ml-1 opacity-70">{region === "전체" ? allRows.length : regionCounts[region] || 0}</span></button>)}</div></div>
          <div><div className="mb-1.5 text-[10px] font-black text-slate-400">포함된 거래처 이름</div><div className="flex gap-1.5 overflow-x-auto pb-0.5"><button type="button" onClick={() => { setHistoryVendor("전체"); setActiveCat("전체"); }} className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-black ${historyVendor === "전체" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>전체 이름</button>{visibleAliases.map((hit) => {
            const normalizedAliasRegion = normRegion(primaryRegion(hit));
            const aliasRegion = REGIONS.includes(normalizedAliasRegion) ? normalizedAliasRegion : "-";
            return <button key={hit.vendor} type="button" onClick={() => { setHistoryVendor(hit.vendor); setActiveCat("전체"); }} className={`flex max-w-[260px] shrink-0 items-center rounded-full px-2.5 py-1.5 text-[11px] font-black ${historyVendor === hit.vendor ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}><span className="mr-1 shrink-0 text-[9px] text-slate-400">{aliasRegion}</span><span className="truncate">{hit.vendor}</span></button>;
          })}</div></div>
        </div>}
      </section>}

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 sm:px-5">
        <button type="button" onClick={() => setActiveCat("전체")} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black ${activeCat === "전체" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>요약 {totalCount || ""}</button>
        {CAT_ORDER.map((cat) => {
          const count = rowsForCategory(cat).length;
          return <button key={cat} type="button" disabled={!count} onClick={() => setActiveCat(cat)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black ${activeCat === cat ? "text-white" : count ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-300"}`} style={activeCat === cat ? { background: accent } : undefined}>{CAT_SHORT[cat]}{count ? ` ${count}` : ""}</button>;
        })}
      </nav>

      <main className="flex-1 overflow-y-auto p-3 sm:p-5">
        {loading && <div className="py-16 text-center text-sm font-semibold text-slate-400">전체 이력을 모으는 중...</div>}
        {!loading && !queryVendor && <div className="py-16 text-center text-sm font-semibold text-slate-400">거래처를 검색해 주세요.</div>}
        {!loading && detail && activeCat === "전체" && (() => {
          const chip = (tone: string, text: string, key: string) => <span key={key} title={text} className={`inline-flex max-w-[300px] items-center overflow-hidden rounded-full border px-2.5 py-1 text-[11px] font-black ${tone}`}><span className="truncate">{text}</span></span>;
          const items: ReturnType<typeof chip>[] = [];
          const f = flags;
          if (f?.inspection) items.push(chip(f.inspection.done ? "border-slate-200 bg-slate-50 text-slate-500" : f.inspection.carried ? "border-slate-200 bg-slate-50 text-slate-500" : "border-blue-300 bg-blue-50 text-blue-700", f.inspection.done ? `점검 완료 (${f.inspection.quarter}분기)` : f.inspection.carried ? "점검 다음분기 이관" : `${f.inspection.quarter}분기 점검 대상`, "insp"));
          if (f?.renewal) items.push(chip(f.renewal.done ? "border-slate-200 bg-slate-50 text-slate-500" : "border-blue-300 bg-blue-50 text-blue-700", f.renewal.done ? "재계약 완료" : `재계약 도래${f.renewal.due ? ` · ${f.renewal.due}` : ""}`, "renew"));
          if (f?.misu) items.push(chip(f.misu.cleared ? "border-slate-200 bg-slate-50 text-slate-500" : "border-rose-300 bg-rose-50 text-rose-700", f.misu.cleared ? `미수 완납 (${f.misu.date})` : `미수 ${f.misu.balance}${f.misu.months ? ` · ${f.misu.months}개월` : ""}`, "misu"));
          if (f?.overage) items.push(chip("border-amber-300 bg-amber-50 text-amber-800", `초과 ${f.overage.total} (${f.overage.date})`, "over"));
          if (f?.bulman) items.push(chip("border-rose-300 bg-rose-50 text-rose-700", `불만 ${f.bulman.date} · ${f.bulman.content}`, "bul"));
          if (quarterCheck.advice?.usageLine) items.push(chip("border-blue-200 bg-blue-50 text-blue-700", `📈 ${quarterCheck.advice.usageLine}`, "usage"));
          if (quarterCheck.advice?.adviceLine) items.push(chip("border-emerald-300 bg-emerald-50 text-emerald-700", `🧰 ${quarterCheck.advice.adviceLine}`, "spare"));
          if (quarterCheck.advice?.warning) items.push(chip("border-amber-300 bg-amber-50 text-amber-800", `⚠ ${quarterCheck.advice.warning}`, "warn"));
          if (quarterCheck.special) items.push(chip("border-rose-200 bg-rose-50 text-rose-600", `❗ ${quarterCheck.special}`, "special"));
          if (devices && devices.mfp + devices.pc + devices.monitor + devices.etc > 0) {
            const parts = [devices.mfp && `복합기 ${devices.mfp}`, devices.pc && `PC ${devices.pc}`, devices.monitor && `모니터 ${devices.monitor}`, devices.etc && `기타 ${devices.etc}`].filter(Boolean).join(" · ");
            items.push(chip("border-slate-200 bg-slate-50 text-slate-600", `🖨 임대중 ${parts}${devices.ended ? ` (종료 ${devices.ended}대 제외)` : ""}`, "dev"));
          }
          if (devices?.recentSwap) items.push(chip("border-indigo-300 bg-indigo-50 text-indigo-700", `🔄 최근 1년 내 납품·교체 ${devices.recentSwap}`, "swap"));
          return <section className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3"><h3 className="text-sm font-black text-slate-950">이번 분기 체크</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-500">방문 전에 확인할 것들 — 워킨맵·미수·초과·불만·최근 2회 점검(사용량·여분) 기준.</p></div>
            <div className="flex flex-wrap gap-1.5 px-4 py-3">
              {items.length ? items : <span className="text-xs font-semibold text-slate-400">이번 분기에 특별히 체크할 항목이 없습니다.</span>}
            </div>
            {quarterCheck.latest && <div className="truncate border-t border-slate-100 px-4 py-2 text-[11px] font-semibold text-slate-500" title={`최근 점검 ${quarterCheck.latest.date} — 매수 ${quarterCheck.latest.counts || "-"} · 여분 ${quarterCheck.latest.spare || "-"}${quarterCheck.previous ? ` ｜ 전전 ${quarterCheck.previous.date} — 매수 ${quarterCheck.previous.counts || "-"}` : ""}`}>최근 점검 {quarterCheck.latest.date} — 매수 {quarterCheck.latest.counts || "-"} · 여분 {quarterCheck.latest.spare || "-"}{quarterCheck.previous ? ` ｜ 전전 ${quarterCheck.previous.date} — 매수 ${quarterCheck.previous.counts || "-"}` : ""}</div>}
          </section>;
        })()}
        {!loading && detail && activeCat === "전체" && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3"><h3 className="text-sm font-black text-slate-950">업무별 현황</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-500">선택한 지역과 거래처 이름에 해당하는 최근 기록입니다.</p></div>
          <div className="divide-y divide-slate-100">{CAT_ORDER.map((cat) => {
            const rows = rowsForCategory(cat);
            if (!rows.length) return null;
            const latest = latestRecord(cat, rows);
            const who = pick(latest, WHO_KEYS);
            const region = recordRegionCode(latest, includedHits);
            const vendorName = recordVendor(latest) || queryVendor;
            const summary = recordSummary(cat, latest, [who.key, ...REGION_KEYS]);
            const preview = summary.fields.slice(0, 2).map((field) => `${field.key} ${field.value.replace(/\s+/g, " ")}`).join(" · ");
            return <button key={cat} type="button" onClick={() => setActiveCat(cat)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"><span className="flex h-9 min-w-[52px] shrink-0 items-center justify-center rounded-xl bg-slate-100 px-2 text-xs font-black text-slate-700">{CAT_SHORT[cat]}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-sm font-black text-slate-950">{CAT_SHORT[cat]}</span><span className="text-[11px] font-black text-blue-600">{rows.length}건</span>{cat === "접수" && (() => {
                const countOf = (t: string) => rows.filter((r) => String(r["type"] || "") === t).length;
                const parts = [countOf("복합기 AS") ? `AS ${countOf("복합기 AS")}` : "", countOf("원격이관") ? `원격 ${countOf("원격이관")}` : "", countOf("IT") ? `IT ${countOf("IT")}` : ""].filter(Boolean).join(" · ");
                return parts ? <span className="text-[10px] font-bold text-slate-400">({parts})</span> : null;
              })()}</span><span className="mt-0.5 block truncate text-xs font-bold text-slate-600">{vendorName}</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-400">{summary.date || "날짜 없음"} · {region}{who.val ? ` · ${who.val}` : ""}{preview ? ` · ${preview}` : ""}</span></span><ChevronRight size={17} className="shrink-0 text-slate-300" /></button>;
          })}{totalCount === 0 && <div className="py-12 text-center text-sm font-semibold text-slate-400">선택한 범위에 이력이 없습니다.</div>}</div>
        </section>}

        {!loading && detail && activeCat !== "전체" && <section className="space-y-2">
          <div className="flex items-end justify-between px-1 pb-1"><div><h3 className="text-sm font-black text-slate-950">{CAT_SHORT[activeCat]} 이력</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-500">최신순 · 항목을 누르면 전체 내용이 열립니다.</p></div><span className="text-xs font-black text-slate-500">{visibleRecords.length}건</span></div>
          {activeCat === "접수" && <div className="flex flex-wrap gap-1.5 px-1 pb-2">
            {["전체", "복합기 AS", "원격이관", "IT"].map((t) => {
              const count = t === "전체" ? records.length : records.filter((r) => String(r["type"] || "") === t).length;
              return <button key={t} type="button" onClick={() => setReceptionType(t)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${receptionType === t ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{t} <span className="opacity-60">{count}</span></button>;
            })}
          </div>}
          {visibleRecords.map((record, index) => {
            const who = pick(record, WHO_KEYS);
            const directRegion = pick(record, REGION_KEYS);
            const region = recordRegionCode(record, includedHits);
            const vendorName = recordVendor(record) || queryVendor;
            const { date, fields, album } = recordSummary(activeCat, record, [who.key, directRegion.key]);
            const preview = fields.slice(0, 2).map((field) => `${field.key}: ${field.value.replace(/\s+/g, " ")}`).join(" · ");
            return <details key={`${vendorName}-${date}-${index}`} className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden sm:px-4">
                <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-slate-100 text-slate-700"><CalendarDays size={15} /><span className="mt-0.5 text-[9px] font-black">{date ? date.slice(5).replace("-", "/") : "-"}</span></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-slate-950">{vendorName}</span><span className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-slate-500">{activeCat === "접수" && !!record["type"] && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 font-black text-blue-700">{String(record["type"])}</span>}<span className="flex items-center gap-0.5"><MapPin size={11} />{region}</span>{who.val && <span className="flex min-w-0 items-center gap-0.5 truncate"><UserRound size={11} />{who.val}</span>}</span>{preview && <span className="mt-1 block truncate text-[11px] font-semibold text-slate-400">{preview}</span>}</span>
                <ChevronDown size={17} className="shrink-0 text-slate-400 transition group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-200 bg-slate-50">
                <div className="grid gap-px bg-slate-200 sm:grid-cols-2">{fields.map((field, fieldIndex) => <div key={`${field.key}-${fieldIndex}`} className={`bg-white px-3 py-2.5 ${field.value.length > 48 || field.value.includes("\n") ? "sm:col-span-2" : ""}`}><div className="text-[10px] font-black text-slate-400">{field.key}</div><div className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-slate-700">{field.value}</div></div>)}{!fields.length && <div className="bg-white px-3 py-5 text-center text-xs font-semibold text-slate-400 sm:col-span-2">표시할 상세 내용이 없습니다.</div>}</div>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[10px] font-bold text-slate-500"><Clock3 size={13} />{date || "날짜 없음"}<span>·</span><Building2 size={13} />{vendorName}{album && <a href={album} target="_blank" rel="noreferrer" className="ml-auto rounded-full bg-slate-900 transition hover:bg-slate-800 px-3 py-1.5 text-white">사진·영상 보기</a>}</div>
              </div>
            </details>;
          })}
          {!records.length && <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm font-semibold text-slate-400">선택한 범위에 이력이 없습니다.</div>}
        </section>}
      </main>
    </div>
  </div>;
}
