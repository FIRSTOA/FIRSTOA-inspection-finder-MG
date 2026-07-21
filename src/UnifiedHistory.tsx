/**
 * 통합이력 팝업 (controlled). 자체 거래처 검색박을 가져 점검탭 선택과 무관하게 어떤 거래처든 조회 가능.
 * 9개 카테고리 탭(데이터 있는 것만 색), 탭 클릭 시 해당 카테고리 최근 레코드(최신순). 기존 백엔드 detail 사용.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getVendorDetail, searchVendors, type DetailResp, type VendorHit } from "./api";
import { REGIONS, REGION_LABEL, primaryRegion, vendorRegion } from "./region";

type Props = {
  vendor: string; // 점검탭에서 선택된 거래처(있으면 초기값)
  accent: string;
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
};

const CAT_ORDER = ["점검", "AS", "초과", "미수", "불만", "복합기확장성", "PC확장성", "재계약", "업체정보"];
const CAT_SHORT: Record<string, string> = {
  점검: "점검", AS: "AS", 초과: "초과", 미수: "미수", 불만: "불만",
  복합기확장성: "복합기", PC확장성: "PC", 재계약: "재계약", 업체정보: "업체정보",
};
const DATE_FIELD: Record<string, string> = {
  AS: "작성일", 점검: "작성일", 초과: "날짜", 불만: "날짜", 미수: "입력일",
  PC확장성: "날짜", 복합기확장성: "등록일", 업체정보: "종료일", 재계약: "날짜",
};
// 블랙&화이트: 모든 카테고리 동일 먹색 (구분은 라벨로). 활성=검정, 보유=연회색 틴트, 빈=흐림
const CAT_COLOR: Record<string, string> = {
  점검: "#334155", AS: "#334155", 초과: "#334155", 미수: "#334155", 불만: "#334155",
  복합기확장성: "#334155", PC확장성: "#334155", 재계약: "#334155", 업체정보: "#334155",
};
const MAX_RECORDS = 8;

// 언제/어디팀/누가 한눈에 보이도록 상단 칩으로 뽑을 키들
const WHO_KEYS = ["담당팀", "작성팀", "작성자", "입력자", "등록자", "관리담당자", "전략영업담당자"];
const REGION_KEYS = ["지역", "미팅지역", "시/구"];
function pick(rec: Record<string, unknown>, keys: string[]): { key: string; val: string } {
  for (const k of keys) { const v = String(rec[k] ?? "").trim(); if (v) return { key: k, val: v }; }
  return { key: "", val: "" };
}

const ALBUM_RX = /https?:\/\/\S*[?&]album=[\w-]+/;
type SummaryField = { key: string; value: string };

function vendorAliasKey(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/^(?:\(주\)|㈜|주식회사|유한회사)+/g, "")
    .replace(/(?:의원|병원|클리닉|센터|본점|지점)+$/g, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
}

function vendorSearchTerms(value: string) {
  const original = value.trim();
  const simplified = original
    .replace(/^(?:\(주\)|㈜|주식회사|유한회사)+\s*/g, "")
    .replace(/\s*(?:의원|병원|클리닉|센터|본점|지점)+$/g, "")
    .trim();
  return Array.from(new Set([original, simplified].filter((term) => term.length >= 2)));
}

function hasHistory(detail: DetailResp) {
  return CAT_ORDER.some((cat) => Array.isArray(detail[cat]) && (detail[cat] as unknown[]).length > 0);
}

function recordSummary(cat: string, rec: Record<string, unknown>, exclude: string[]): { date: string; lines: string[]; fields: SummaryField[]; album: string } {
  const dateKey = DATE_FIELD[cat];
  const date = dateKey ? String(rec[dateKey] ?? "") : "";
  const skip = new Set([dateKey, ...exclude]);
  const lines: string[] = [];
  const fields: SummaryField[] = [];
  let album = "";
  for (const [k, v] of Object.entries(rec)) {
    const s = String(v ?? "").trim();
    if (!album) { const m = s.match(ALBUM_RX); if (m) album = m[0]; } // 본문 어디든 첨부 링크 추출
    if (skip.has(k) || k.startsWith("_")) continue; // 내부 컬럼(_원문/_dupKey 등) 숨김
    if (!s) continue;
    lines.push(`${k}: ${s}`);
    fields.push({ key: k, value: s });
  }
  return { date, lines, fields, album };
}

export default function UnifiedHistory({ vendor, accent, open, onClose, onError }: Props) {
  const [override, setOverride] = useState("");
  const [detail, setDetail] = useState<DetailResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCat, setActiveCat] = useState<string>("");

  // 내부 검색박
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VendorHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const [activeRegion, setActiveRegion] = useState<string>("전체");
  const reqSeq = useRef(0);
  const loadedFor = useRef<string>("");

  // 통합이력 9개 탭(CAT_ORDER) 중 하나라도 기록 있는 거래처만 (임대현황표 등만 있는 빈 거래처 제외).
  const base = useMemo(() => hits.filter((h) => CAT_ORDER.some((c) => (h.counts?.[c] || 0) > 0)), [hits]);

  // 지역 탭(전체 + A~E + 기타)
  const regionTabs = useMemo(() => {
    const hasEtc = base.some((h) => vendorRegion(h) === "기타");
    return ["전체", ...REGIONS, ...(hasEtc ? ["기타"] : [])];
  }, [base]);
  const filteredHits = activeRegion === "전체" ? base : base.filter((h) => vendorRegion(h) === activeRegion);

  // FIELD에서 인식한 거래처가 있으면 바로 상세를 열고, 필요할 때만 검색으로 바꾼다.
  useEffect(() => {
    if (open) {
      const initialVendor = vendor.trim();
      loadedFor.current = "";
      setOverride(initialVendor);
      setDetail(null);
      setHits([]);
      setQ(initialVendor);
      setActiveCat("전체");
    }
  }, [open, vendor]);

  // 후보 검색 (이미 고른 거래처와 같은 검색어면 목록을 다시 띄우지 않음)
  useEffect(() => {
    const query = q.trim();
    if (!open || query.length < 2 || query === override) { setHits([]); return; }
    setSearching(true);
    setShowHits(true);
    const my = ++reqSeq.current;
    const h = window.setTimeout(() => {
      Promise.all(vendorSearchTerms(query).map((term) => searchVendors(term)))
        .then((responses) => {
          if (my !== reqSeq.current) return;
          const merged = new Map<string, VendorHit>();
          responses.flatMap((response) => response.results || []).forEach((hit) => merged.set(hit.vendor, hit));
          setHits(Array.from(merged.values()));
        })
        .catch((e) => onError(e.message || "검색 실패"))
        .finally(() => { if (my === reqSeq.current) setSearching(false); });
    }, 300);
    return () => window.clearTimeout(h);
  }, [q, open, override, onError]);

  // 결과 바뀌면 지역 탭 초기화
  useEffect(() => { setActiveRegion("전체"); }, [hits]);

  // 상세 로드 (목록에서 고른 거래처 기준)
  useEffect(() => {
    if (!open || !override) { setDetail(null); return; }
    if (loadedFor.current === override && detail) return;
    setLoading(true);
    setDetail(null);
    getVendorDetail(override)
      .then(async (d) => {
        if (!hasHistory(d)) {
          const terms = vendorSearchTerms(override);
          const responses = await Promise.all(terms.map((term) => searchVendors(term)));
          const alias = vendorAliasKey(override);
          const candidate = responses.flatMap((response) => response.results || [])
            .find((hit) => hit.vendor !== override && vendorAliasKey(hit.vendor) === alias && CAT_ORDER.some((cat) => (hit.counts?.[cat] || 0) > 0));
          if (candidate) {
            loadedFor.current = "";
            setOverride(candidate.vendor);
            setQ(candidate.vendor);
            return;
          }
        }
        setDetail(d);
        loadedFor.current = override;
        setActiveCat("전체");
      })
      .catch((e) => onError(e.message || "통합이력 조회 실패"))
      .finally(() => setLoading(false));
  }, [open, override, detail, onError]);

  if (!open) return null;

  const count = (c: string) => (Array.isArray(detail?.[c]) ? (detail![c] as unknown[]).length : 0);
  const recs = activeCat && activeCat !== "전체" ? ((detail?.[activeCat] as Array<Record<string, unknown>>) || []).slice() : [];
  const dk = DATE_FIELD[activeCat];
  if (dk) recs.sort((a, b) => String(b[dk] ?? "").localeCompare(String(a[dk] ?? ""))); // 최신순

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-slate-900/40 backdrop-blur-sm sm:items-center sm:justify-center" onClick={onClose}>
      <div
        className="flex h-[90vh] w-full flex-col rounded-t-3xl bg-slate-50 sm:h-[85vh] sm:max-w-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between rounded-t-3xl px-5 py-4 text-white" style={{ background: accent }}>
          <div className="min-w-0">
            <div className="truncate text-base font-bold">{override || "통합이력"}</div>
            <div className="text-[11px] opacity-80">거래처 전체 이력</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-xl bg-white/20 px-3 py-1.5 text-sm font-semibold">
            닫기
          </button>
        </div>

        {/* 자체 검색박 */}
        <div className="relative border-b border-slate-200 bg-white px-3 py-2.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => hits.length && setShowHits(true)}
            placeholder="다른 거래처 검색…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:bg-white"
          />
          {showHits && (
            <div className="absolute left-3 right-3 z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
              {searching && <div className="px-3 py-2 text-xs text-slate-400">검색 중…</div>}
              {!searching && base.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">결과 없음</div>}

              {/* 지역 탭 (전체 / A 강북 … / 기타) */}
              {!searching && base.length > 0 && (
                <div className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50 px-2 py-1.5">
                  {regionTabs.map((rg) => (
                    <button
                      key={rg}
                      type="button"
                      onClick={() => setActiveRegion(rg)}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                        activeRegion === rg ? "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {REGION_LABEL[rg] ? `${rg} ${REGION_LABEL[rg]}` : rg}
                    </button>
                  ))}
                </div>
              )}

              {!searching && base.length > 0 && filteredHits.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">이 지역엔 없어요</div>
              )}
              {!searching && filteredHits.map((h) => {
                const cs = CAT_ORDER.filter((c) => (h.counts?.[c] || 0) > 0).map((c) => `${CAT_SHORT[c]} ${h.counts[c]}`);
                // 가장 최근 날짜 + 지역(팀) — 겹치는 업체명 구분용
                let recent: { d: string; r: string } | null = null;
                for (const k in (h.meta || {})) {
                  const e = h.meta[k];
                  if (e?.d && (!recent || e.d > recent.d)) recent = { d: e.d, r: e.r };
                }
                const reg = primaryRegion(h);
                return (
                  <button
                    key={h.vendor}
                    type="button"
                    onClick={() => { setOverride(h.vendor); setQ(h.vendor); setShowHits(false); }}
                    className="block w-full border-b border-slate-50 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-1.5">
                      {reg && <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-white">{reg}</span>}
                      <span className="truncate text-sm text-slate-800">{h.vendor}</span>
                    </div>
                    {recent && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span>📅 {recent.d}</span>
                        {recent.r && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{recent.r}</span>}
                      </div>
                    )}
                    {cs.length > 0 && <div className="mt-0.5 truncate text-[11px] text-slate-400">{cs.join(" · ")}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 9개 카테고리 탭 */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-3 py-2.5">
          <button type="button" disabled={!detail} onClick={() => setActiveCat("전체")} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${activeCat === "전체" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>요약</button>
          {CAT_ORDER.map((c) => {
            const n = count(c);
            const has = n > 0;
            const active = c === activeCat;
            const color = CAT_COLOR[c];
            return (
              <button
                key={c}
                type="button"
                disabled={!has}
                onClick={() => setActiveCat(c)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
                style={{
                  background: active ? color : has ? `${color}1A` : "#F1F5F9",
                  color: active ? "#fff" : has ? color : "#CBD5E1",
                  cursor: has ? "pointer" : "default",
                }}
              >
                {CAT_SHORT[c]}{has ? ` ${n}` : ""}
              </button>
            );
          })}
        </div>

        {/* 내용 */}
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {loading && <div className="py-8 text-center text-sm text-slate-400">불러오는 중…</div>}
          {!loading && !override && <div className="py-10 text-center text-sm text-slate-400">위 검색창에서 거래처를 골라주세요</div>}
          {!loading && override && detail && !activeCat && (
            <div className="py-8 text-center text-sm text-slate-400">표시할 이력이 없어요</div>
          )}
          {!loading && detail && activeCat === "전체" && <div className="grid gap-2 sm:grid-cols-2">
            {CAT_ORDER.map((cat) => {
              const rows = Array.isArray(detail[cat]) ? detail[cat] as Array<Record<string, unknown>> : [];
              if (!rows.length) return null;
              const dateKey = DATE_FIELD[cat];
              const latest = [...rows].sort((a, b) => String(b[dateKey] ?? "").localeCompare(String(a[dateKey] ?? "")))[0];
              const who = pick(latest, WHO_KEYS);
              const region = pick(latest, REGION_KEYS);
              const summary = recordSummary(cat, latest, [who.key, region.key]);
              return <button key={cat} type="button" onClick={() => setActiveCat(cat)} className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-slate-400">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-black text-slate-900">{CAT_SHORT[cat]}</span><span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{rows.length}건</span></div>
                <div className="mt-2 text-xs font-bold text-slate-600">최근 {summary.date || "날짜 없음"}{who.val ? ` · ${who.val}` : ""}</div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">{summary.lines.slice(0, 2).join(" · ") || "상세 내용을 확인하세요."}</div>
              </button>;
            })}
            {!CAT_ORDER.some((cat) => Array.isArray(detail[cat]) && (detail[cat] as unknown[]).length > 0) && <div className="col-span-full py-8 text-center text-sm text-slate-400">표시할 이력이 없어요</div>}
          </div>}
          {!loading &&
            recs.slice(0, MAX_RECORDS).map((rec, i) => {
              const who = pick(rec, WHO_KEYS);
              const region = pick(rec, REGION_KEYS);
              const { date, fields, album } = recordSummary(activeCat, rec, [who.key, region.key]);
              return (
                <div key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {/* 언제 · 어디팀 · 누가 */}
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3 py-2.5">
                    <span className="mr-auto text-sm font-black text-slate-900">{CAT_SHORT[activeCat]} 이력</span>
                    {date && (
                      <span className="rounded-md px-2 py-0.5 text-xs font-bold text-white" style={{ background: CAT_COLOR[activeCat] }}>
                        {date}
                      </span>
                    )}
                    {region.val && <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">{region.val}</span>}
                    {who.val && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{who.val}</span>}
                  </div>
                  <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
                    {fields.map((field, j) => (
                      <div key={`${field.key}-${j}`} className={`bg-white px-3 py-2.5 ${field.value.length > 48 || field.value.includes("\n") ? "sm:col-span-2" : ""}`}>
                        <div className="text-[10px] font-black text-slate-400">{field.key}</div>
                        <div className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-slate-700">{field.value}</div>
                      </div>
                    ))}
                    {!fields.length && <div className="bg-white px-3 py-5 text-center text-xs font-semibold text-slate-400 sm:col-span-2">표시할 상세 내용이 없습니다.</div>}
                  </div>
                  {album && (
                    <a href={album} target="_blank" rel="noreferrer"
                      className="m-3 inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-white">
                      사진·영상 보기
                    </a>
                  )}
                </div>
              );
            })}
          {!loading && activeCat && recs.length > MAX_RECORDS && (
            <div className="py-1 text-center text-[11px] text-slate-400">최신 {MAX_RECORDS}건만 표시 (+{recs.length - MAX_RECORDS}건)</div>
          )}
        </div>
      </div>
    </div>
  );
}
