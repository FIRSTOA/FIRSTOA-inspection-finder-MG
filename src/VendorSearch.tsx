/**
 * 거래처 검색 패널 (팝업 안에 렌더됨).
 *   거래처명 입력 → 후보 → 선택 → 구분별(점검/AS) 최근 1건 카드(기종·댓수·지역·작성자·날짜)
 *   → "불러오기"가 _원문을 변환기에 주입(onLoadForm)한다. 점검+AS는 점검으로 병합.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { searchVendors, getInspForms, type InspForm, type VendorHit, type VendorMetaEntry } from "./api";

// 거래처명 기준이름: 괄호·공백·구분기호 제거 후 끝의 위치 수식어(본사/지점/N층/N호/공장 등) 반복 제거.
// "질경이 본사", "질경이본사3층", "질경이(지하1층)" → "질경이" 로 묶기 위한 휴리스틱(완벽X, 정밀통합은 별칭테이블 단계).
const QUALIFIER =
  /(본사|본점|지사|지점|영업점|본관|별관|신관|공장|창고|물류센터|센터|지하)?\d*(층|호|동|관)$|(본사|본점|지사|지점|영업점|공장|창고)$/;
export function vendorBaseName(name: string): string {
  const orig = String(name || "").trim();
  let s = orig.replace(/[(（][^)）]*[)）]/g, "").replace(/[\s\-–—·/]+/g, "");
  let prev = "";
  while (s.length > 2 && s !== prev) { prev = s; s = s.replace(QUALIFIER, ""); }
  return s || orig;
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

  // 기준이름으로 후보 묶기 (질경이 본사/질경이본사 → "질경이" 그룹). 표시만, 선택은 변형 단위 유지.
  const groups = useMemo(() => {
    const m = new Map<string, VendorHit[]>();
    for (const h of hits) {
      const b = vendorBaseName(h.vendor);
      const arr = m.get(b);
      if (arr) arr.push(h); else m.set(b, [h]);
    }
    return Array.from(m.entries());
  }, [hits]);

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
          <div className="absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            {searching && <div className="px-3.5 py-2.5 text-sm text-slate-400">검색 중…</div>}
            {!searching && hits.length === 0 && (
              <div className="px-3.5 py-2.5 text-sm text-slate-400">일치하는 거래처가 없어요</div>
            )}
            {!searching && groups.map(([base, items]) => (
              <div key={base}>
                {items.length > 1 && (
                  <div className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-3.5 py-1 text-[11px] font-semibold text-slate-500 backdrop-blur">
                    {base} · {items.length}곳
                  </div>
                )}
                {items.map((h) => {
                  const j = h.meta?.["점검"];
                  const a = h.meta?.["AS"];
                  return (
                    <button
                      key={h.vendor}
                      type="button"
                      onClick={() => pickVendor(h.vendor)}
                      className={`block w-full border-b border-slate-50 px-3.5 py-2.5 text-left last:border-0 hover:bg-slate-50 ${items.length > 1 ? "pl-5" : ""}`}
                    >
                      <div className="truncate text-[15px] font-medium text-slate-800">{h.vendor}</div>
                      <div className="mt-1 space-y-0.5">
                        {j && <MetaLine gubun="점검" e={j} />}
                        {a && <MetaLine gubun="AS" e={a} />}
                        {!j && !a && <span className="text-[11px] text-slate-400">점검/AS 기록 없음</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
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
