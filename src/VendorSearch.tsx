/**
 * 거래처 검색 패널 (팝업 안에 렌더됨).
 *   거래처명 입력 → 후보 → 선택 → 구분별(점검/AS) 최근 1건 카드(기종·댓수·지역·작성자·날짜)
 *   → "불러오기"가 _원문을 변환기에 주입(onLoadForm)한다. 점검+AS는 점검으로 병합.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { searchVendors, getInspForms, type InspForm, type VendorHit, type VendorMetaEntry } from "./api";
import { REGIONS, REGION_LABEL, normRegion, primaryRegion, vendorRegion } from "./region";

type Props = {
  accent: string;
  onLoadForm: (text: string) => void;
  onVendor: (vendor: string) => void;
  onError: (msg: string) => void;
};

const GUBUN_STYLE: Record<string, { bg: string; fg: string }> = {
  "점검": { bg: "#334155", fg: "#FFFFFF" },
  "AS": { bg: "#E2E8F0", fg: "#475569" },
};

// 후보 한 줄: [구분] 날짜·기종·N대·지역·작성자
function MetaLine({ gubun, e }: { gubun: string; e: VendorMetaEntry }) {
  const st = GUBUN_STYLE[gubun] ?? GUBUN_STYLE["점검"];
  const chips: string[] = [];
  if (e.d) chips.push(e.d);
  if (e.model) chips.push(e.model);
  if (e.count) chips.push(`${e.count}대`);
  if (e.r) chips.push(e.r);
  if (e.author) chips.push(e.author);
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: st.bg, color: st.fg }}>{gubun}</span>
      <span className="truncate">{chips.join(" · ")}</span>
    </div>
  );
}

export default function VendorSearch({ accent, onLoadForm, onVendor, onError }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VendorHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showHits, setShowHits] = useState(false);

  const [vendor, setVendor] = useState("");
  const [forms, setForms] = useState<InspForm[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const [activeRegion, setActiveRegion] = useState<string>("전체");
  const [sortMode, setSortMode] = useState<"recent" | "name">("recent");

  const reqSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === vendor) {
      setHits([]);
      return;
    }
    setSearching(true);
    setShowHits(true); // 검색 시작과 동시에 드롭다운(검색 중…) 표시
    const myReq = ++reqSeq.current;
    const handle = window.setTimeout(() => {
      searchVendors(q)
        .then((resp) => {
          if (myReq !== reqSeq.current) return;
          setHits(resp.results || []);
          setShowHits(true);
        })
        .catch((e) => onError(e.message || "검색 실패"))
        .finally(() => {
          if (myReq === reqSeq.current) setSearching(false);
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, vendor, onError]);

  const pickVendor = (v: string) => {
    setVendor(v);
    setQuery(v);
    setHits([]);
    setShowHits(false);
    setForms([]);
    setLoadingForms(true);
    onVendor(v);
    getInspForms(v)
      .then((resp) => setForms(resp.forms || []))
      .catch((e) => onError(e.message || "양식 조회 실패"))
      .finally(() => setLoadingForms(false));
  };

  const clearAll = () => {
    setQuery("");
    setVendor("");
    setHits([]);
    setForms([]);
    setShowHits(false);
  };

  // 거래처 점검검색: 점검/AS 기록 있는 거래처만 (불만/임대만 있는 곳은 제외).
  const base = useMemo(
    () => hits.filter((h) => (h.counts?.["점검"] || 0) > 0 || (h.counts?.["AS"] || 0) > 0),
    [hits]
  );

  // 탭: 전체 + A~E(고정) + 기타(확인 안 된 게 있을 때만)
  const regionTabs = useMemo(() => {
    const hasEtc = base.some((h) => vendorRegion(h) === "기타");
    return ["전체", ...REGIONS, ...(hasEtc ? ["기타"] : [])];
  }, [base]);

  // 결과 바뀌면 지역 탭 초기화
  useEffect(() => { setActiveRegion("전체"); }, [hits]);

  const hitLatestDate = (hit: VendorHit) => {
    const entries = Object.entries(hit.meta || {})
      .filter(([gubun, entry]) => (gubun === "점검" || gubun === "AS") && entry?.d)
      .filter(([, entry]) => activeRegion === "전체" || normRegion(String(entry.r || "")) === activeRegion);
    return entries.map(([, entry]) => entry.d).sort().at(-1) || "";
  };

  // 기본은 최근 점검·AS 순. 필요할 때 이름순으로 전환한다.
  const filtered = (activeRegion === "전체" ? base : base.filter((h) => vendorRegion(h) === activeRegion))
    .slice()
    .sort((a, b) => sortMode === "recent"
      ? hitLatestDate(b).localeCompare(hitLatestDate(a)) || a.vendor.localeCompare(b.vendor)
      : a.vendor.localeCompare(b.vendor));

  const sortedForms = useMemo(
    () => forms.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))),
    [forms],
  );

  return (
    <div>
      {/* 검색 입력 */}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (vendor) setVendor("");
          }}
          onFocus={() => hits.length && setShowHits(true)}
          placeholder="업체명·주소·자산기번·시리얼 검색"
          autoFocus
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[15px] outline-none transition focus:border-slate-300 focus:bg-white"
          style={{ borderColor: query ? accent : undefined }}
        />
        {query && (
          <button
            type="button"
            onClick={clearAll}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400"
            aria-label="지우기"
          >
            ✕
          </button>
        )}

        {/* 후보 드롭다운 */}
        {showHits && (
          <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            {searching && <div className="px-3.5 py-2.5 text-sm text-slate-400">검색 중…</div>}
            {!searching && base.length === 0 && (
              <div className="px-3.5 py-2.5 text-sm text-slate-400">점검/AS 기록이 있는 거래처가 없어요</div>
            )}

            {/* 지역 탭 (전체 / A 강북 / B 강서 / C 강남 / D 경기 / E 지방 / 기타) */}
            {!searching && base.length > 0 && (
              <div className="border-b border-slate-100 bg-slate-50">
                <div className="flex items-center justify-between gap-2 px-3 pt-2">
                  <span className="text-[11px] font-semibold text-slate-400">검색 결과 {base.length}곳</span>
                  <div className="flex rounded-md bg-slate-200/70 p-0.5">
                    <button type="button" onClick={() => setSortMode("recent")} className={`rounded px-2 py-1 text-[10px] font-bold ${sortMode === "recent" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>최근순</button>
                    <button type="button" onClick={() => setSortMode("name")} className={`rounded px-2 py-1 text-[10px] font-bold ${sortMode === "name" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>이름순</button>
                  </div>
                </div>
                <div className="flex gap-1 overflow-x-auto px-2 py-1.5">
                {regionTabs.map((rg) => (
                  <button
                    key={rg}
                    type="button"
                    onClick={() => setActiveRegion(rg)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                      activeRegion === rg
                        ? "bg-slate-800 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {REGION_LABEL[rg] ? `${rg} ${REGION_LABEL[rg]}` : rg}
                  </button>
                ))}
                </div>
              </div>
            )}

            {/* 결과 목록. 특정 지역 탭이면 그 지역 줄만 표시 */}
            {!searching && base.length > 0 && (
              <div className="max-h-64 overflow-y-auto">
                {filtered.length === 0 && (
                  <div className="px-3.5 py-2.5 text-sm text-slate-400">이 지역엔 없어요</div>
                )}
                {filtered.map((h) => {
                  const showAll = activeRegion === "전체";
                  const j = h.meta?.["점검"];
                  const a = h.meta?.["AS"];
                  const jShow = j && (showAll || normRegion(String(j.r || "")) === activeRegion) ? j : undefined;
                  const aShow = a && (showAll || normRegion(String(a.r || "")) === activeRegion) ? a : undefined;
                  const reg = primaryRegion(h);
                  return (
                    <button
                      key={h.vendor}
                      type="button"
                      onClick={() => pickVendor(h.vendor)}
                      className="block w-full border-b border-slate-50 px-3.5 py-2.5 text-left last:border-0 hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-1.5">
                        {reg && (
                          <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-white">{reg}</span>
                        )}
                        <span className="truncate text-[15px] font-medium text-slate-800">{h.vendor}</span>
                        {h.matchedBy && <span className="ml-auto shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">{h.matchedBy}</span>}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {jShow && <MetaLine gubun="점검" e={jShow} />}
                        {aShow && <MetaLine gubun="AS" e={aShow} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 선택된 거래처의 구분별 최근 양식 */}
      {vendor && (
        <div className="mt-4">
          <div className="mb-2 flex items-end justify-between px-1">
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-400">선택한 거래처</div>
              <div className="truncate text-sm font-black text-slate-900">{vendor}</div>
            </div>
            {!loadingForms && <div className="shrink-0 text-xs font-bold text-slate-400">최신순 · {forms.length}건</div>}
          </div>
          {loadingForms && <div className="px-1 py-3 text-sm text-slate-400">양식 불러오는 중…</div>}
          {!loadingForms && forms.length === 0 && (
            <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
              이 거래처의 점검/AS 기록이 없어요
            </div>
          )}
          <div className="space-y-2.5">
            {sortedForms.map((f, i) => {
              const st = GUBUN_STYLE[f.gubun] ?? GUBUN_STYLE["점검"];
              const isAS = f.gubun === "AS";
              const chips: string[] = [];
              if (f.model) chips.push(f.model);
              if (f.count) chips.push(`${f.count}대`);
              if (f.region) chips.push(f.region);
              if (f.author) chips.push(f.author);
              return (
                <div key={i} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold"
                        style={{ background: st.bg, color: st.fg }}
                      >
                        {f.gubun}
                      </span>
                      <span className="shrink-0 text-sm font-medium text-slate-600">{f.date || "-"}</span>
                    </div>
                    {f.text && (
                      <button
                        type="button"
                        onClick={() => onLoadForm(f.text)}
                        className="shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition active:scale-95"
                        style={{ background: accent }}
                      >
                        불러오기
                      </button>
                    )}
                  </div>

                  {/* 기종·댓수·지역·작성자 칩 */}
                  {chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {chips.map((c, j) => (
                        <span key={j} className="rounded-lg bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}

                  {isAS && (f.content || f.serial) && (
                    <div className="mt-2 rounded-xl bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
                      {!f.text && <div className="mb-0.5 text-[11px] text-slate-400">과거 AS(이관분)는 요약만 표시</div>}
                      {f.serial && <div>시리얼: {f.serial}</div>}
                      {f.content && <div>내용: {f.content}</div>}
                      {f.handled && <div>처리: {f.handled}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
