/**
 * 통합이력 팝업 (controlled). 자체 거래처 검색박을 가져 점검탭 선택과 무관하게 어떤 거래처든 조회 가능.
 * 9개 카테고리 탭(데이터 있는 것만 색), 탭 클릭 시 해당 카테고리 최근 레코드(최신순). 기존 백엔드 detail 사용.
 */
import { useEffect, useRef, useState } from "react";
import { getVendorDetail, searchVendors, type DetailResp, type VendorHit } from "./api";

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

function recordSummary(cat: string, rec: Record<string, unknown>, exclude: string[]): { date: string; lines: string[] } {
  const dateKey = DATE_FIELD[cat];
  const date = dateKey ? String(rec[dateKey] ?? "") : "";
  const skip = new Set([dateKey, ...exclude]);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (skip.has(k)) continue;
    const s = String(v ?? "").trim();
    if (!s) continue;
    lines.push(`${k}: ${s}`);
  }
  return { date, lines };
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
  const reqSeq = useRef(0);
  const loadedFor = useRef<string>("");

  // 팝업 열릴 때: 점검탭에서 고른 거래처명을 검색창에 미리 채우고 "목록"을 보여준다(자동 선택 X).
  // 같은 회사라도 업체명 표기가 다른 경우가 있어, 사용자가 목록에서 직접 고르게 한다.
  useEffect(() => {
    if (open) { setOverride(""); setDetail(null); setHits([]); setQ(""); }
  }, [open, vendor]);

  // 후보 검색 (이미 고른 거래처와 같은 검색어면 목록을 다시 띄우지 않음)
  useEffect(() => {
    const query = q.trim();
    if (!open || !query || query === override) { setHits([]); return; }
    setSearching(true);
    setShowHits(true);
    const my = ++reqSeq.current;
    const h = window.setTimeout(() => {
      searchVendors(query)
        .then((r) => { if (my === reqSeq.current) setHits(r.results || []); })
        .catch((e) => onError(e.message || "검색 실패"))
        .finally(() => { if (my === reqSeq.current) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(h);
  }, [q, open, override, onError]);

  // 상세 로드 (목록에서 고른 거래처 기준)
  useEffect(() => {
    if (!open || !override) { setDetail(null); return; }
    if (loadedFor.current === override && detail) return;
    setLoading(true);
    setDetail(null);
    getVendorDetail(override)
      .then((d) => {
        setDetail(d);
        loadedFor.current = override;
        const first = CAT_ORDER.find((c) => Array.isArray(d[c]) && (d[c] as unknown[]).length > 0);
        setActiveCat(first || "");
      })
      .catch((e) => onError(e.message || "통합이력 조회 실패"))
      .finally(() => setLoading(false));
  }, [open, override, detail, onError]);

  if (!open) return null;

  const count = (c: string) => (Array.isArray(detail?.[c]) ? (detail![c] as unknown[]).length : 0);
  let recs = activeCat ? ((detail?.[activeCat] as Array<Record<string, unknown>>) || []).slice() : [];
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
              {!searching && hits.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">결과 없음</div>}
              {!searching && hits.map((h) => {
                const cs = CAT_ORDER.filter((c) => (h.counts?.[c] || 0) > 0).map((c) => `${CAT_SHORT[c]} ${h.counts[c]}`);
                // 가장 최근 날짜 + 지역(팀) — 겹치는 업체명 구분용
                let recent: { d: string; r: string } | null = null;
                for (const k in (h.meta || {})) {
                  const e = h.meta[k];
                  if (e?.d && (!recent || e.d > recent.d)) recent = { d: e.d, r: e.r };
                }
                return (
                  <button
                    key={h.vendor}
                    type="button"
                    onClick={() => { setOverride(h.vendor); setQ(h.vendor); setShowHits(false); }}
                    className="block w-full border-b border-slate-50 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                  >
                    <div className="truncate text-sm text-slate-800">{h.vendor}</div>
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
          {!loading &&
            recs.slice(0, MAX_RECORDS).map((rec, i) => {
              const who = pick(rec, WHO_KEYS);
              const region = pick(rec, REGION_KEYS);
              const { date, lines } = recordSummary(activeCat, rec, [who.key, region.key]);
              return (
                <div key={i} className="rounded-2xl bg-white p-3 shadow-sm">
                  {/* 언제 · 어디팀 · 누가 */}
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {date && (
                      <span className="rounded-md px-2 py-0.5 text-xs font-bold text-white" style={{ background: CAT_COLOR[activeCat] }}>
                        📅 {date}
                      </span>
                    )}
                    {region.val && <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">{region.val}</span>}
                    {who.val && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{who.val}</span>}
                  </div>
                  <div className="space-y-0.5">
                    {lines.map((ln, j) => (
                      <div key={j} className="break-words text-xs leading-snug text-slate-600">{ln}</div>
                    ))}
                  </div>
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
