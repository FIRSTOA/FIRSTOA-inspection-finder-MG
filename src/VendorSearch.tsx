/**
 * 거래처 검색 패널 (팝업 안에 렌더됨).
 *   거래처명 입력 → 후보 → 선택 → 구분별(점검/AS) 최근 1건 카드(기종·댓수·지역·작성자·날짜)
 *   → "불러오기"가 _원문을 변환기에 주입(onLoadForm)한다. 점검+AS는 점검으로 병합.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { searchVendors, getInspForms, type InspForm, type VendorHit, type VendorMetaEntry } from "./api";

// 지역 정규화: "수도권A"·"A" → "A". A~E 글자 있으면 그 글자, 없으면 원문(강남/지방 등).
function normRegion(r: string): string {
  const s = String(r || "").trim();
  const m = s.match(/[A-Ea-e]/);
  return m ? m[0].toUpperCase() : s;
}
// 거래처의 대표 지역 (점검 > AS > 그 외 순). 정렬·뱃지용.
const REGION_PREF = ["점검", "AS", "미수", "불만", "임대현황표", "초과", "PC확장성", "복합기확장성", "재계약", "업체정보"];
function primaryRegion(h: VendorHit): string {
  const m = h.meta || {};
  for (const k of REGION_PREF) { const r = m[k]?.r; if (r) return normRegion(String(r)); }
  return "";
}
// 거래처가 가진 모든 지역(카테고리별 지역 합집합) — 지역 탭 필터용.
function vendorRegions(h: VendorHit): string[] {
  const s = new Set<string>();
  const m = h.meta || {};
  for (const k in m) { const r = m[k]?.r; if (r) s.add(normRegion(String(r))); }
  return [...s];
}

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

  // 결과에 등장하는 지역들 → 탭 (전체 + 정렬된 지역). A~E 먼저, 나머지 뒤.
  const regionTabs = useMemo(() => {
    const s = new Set<string>();
    for (const h of hits) for (const r of vendorRegions(h)) s.add(r);
    const arr = [...s].sort((a, b) => {
      const ai = /^[A-E]$/.test(a), bi = /^[A-E]$/.test(b);
      if (ai && bi) return a.localeCompare(b);
      if (ai !== bi) return ai ? -1 : 1;
      return a.localeCompare(b);
    });
    return ["전체", ...arr];
  }, [hits]);

  // 결과 바뀌면 지역 탭 초기화
  useEffect(() => { setActiveRegion("전체"); }, [hits]);

  // 활성 지역으로 필터 (전체면 전부). 지역순 → 이름순 정렬.
  const filtered = (activeRegion === "전체" ? hits : hits.filter((h) => vendorRegions(h).includes(activeRegion)))
    .slice()
    .sort((a, b) => primaryRegion(a).localeCompare(primaryRegion(b)) || a.vendor.localeCompare(b.vendor));

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
          placeholder="거래처명 입력 (예: 가락중학교)"
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
            {!searching && hits.length === 0 && (
              <div className="px-3.5 py-2.5 text-sm text-slate-400">일치하는 거래처가 없어요</div>
            )}

            {/* 지역 탭 — 지역이 2개 이상일 때만. 클릭으로 지역 필터 */}
            {!searching && regionTabs.length > 2 && (
              <div className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50 px-2 py-1.5">
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
                    {rg}
                  </button>
                ))}
              </div>
            )}

            {/* 결과 목록 (지역순 정렬, 지역 뱃지) */}
            {!searching && filtered.length > 0 && (
              <div className="max-h-64 overflow-y-auto">
                {filtered.map((h) => {
                  const j = h.meta?.["점검"];
                  const a = h.meta?.["AS"];
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
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {j && <MetaLine gubun="점검" e={j} />}
                        {a && <MetaLine gubun="AS" e={a} />}
                        {!j && !a && <span className="text-[11px] text-slate-400">점검/AS 기록 없음</span>}
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
          {loadingForms && <div className="px-1 py-3 text-sm text-slate-400">양식 불러오는 중…</div>}
          {!loadingForms && forms.length === 0 && (
            <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
              이 거래처의 점검/AS 기록이 없어요
            </div>
          )}
          <div className="space-y-2.5">
            {forms.map((f, i) => {
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
