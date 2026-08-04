import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, X } from "lucide-react";
import { selectRows, updateRows, SUPABASE_ANON, SUPABASE_URL } from "./supabase";
import { setActivityEventsCancelledBySource } from "./operations";
import { setVisitsCancelledBySource, setVisitsCancelledByVendor } from "./visits";
import { LOOKUP_CATEGORIES, LOOKUP_GROUPS, type LookupCategory, type LookupColumn } from "./lookupCatalog";
import { MisuBoard, OverageBoard } from "./MisuOverageBoards";
import StockBoard from "./StockBoard";
import { kstDate } from "./visits";

type Row = Record<string, unknown>;

const PAGE = 300;
const PERIODS = [
  ["1m", "최근 1개월"], ["3m", "최근 3개월"], ["6m", "최근 6개월"], ["1y", "최근 1년"], ["all", "전체"],
] as const;
type PeriodKey = typeof PERIODS[number][0];

function shiftMonths(date: string, months: number) {
  const base = new Date(`${date}T12:00:00+09:00`);
  base.setMonth(base.getMonth() + months);
  return base.toISOString().slice(0, 10);
}

const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|ERROR!?)$/i;
function text(row: Row, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  const out = String(value);
  return SHEET_ERROR.test(out.trim()) ? "" : out;   // 시트 수식 에러값은 빈칸 취급
}

/** 1,234 형태로 보이는 값이면 숫자로 취급해 오른쪽 정렬·등폭이 자연스럽게 */
function shortValue(value: string, key: string) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 16).replace("T", " ");
  if (key === "photos" || value.startsWith("[")) return value === "[]" ? "-" : value;
  return value;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default function DataLookup({ author = "" }: { author?: string }) {
  const [categoryKey, setCategoryKey] = useState<string>(() => window.localStorage.getItem("cs_lookup_category_v1") || "jeomgeom");
  const [period, setPeriod] = useState<PeriodKey>("3m");
  const [team, setTeam] = useState("전체");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  // 잘못된 기록 숨김(soft delete) — 원문 보존, 누가·언제 숨겼는지 기록. 지원 테이블에만 노출
  const HIDEABLE = useMemo(() => new Set(["jeomgeom", "as_records", "logistics_records", "bulman", "misu", "overage", "overage_adjust", "recontract", "churn_defense", "mgmt_support", "pc_expansion", "mfp_expansion", "contact_changes", "stock_items"]), []);
  const [showHidden, setShowHidden] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const category = useMemo<LookupCategory>(
    () => LOOKUP_CATEGORIES.find((item) => item.key === categoryKey) || LOOKUP_CATEGORIES[0],
    [categoryKey],
  );

  useEffect(() => { window.localStorage.setItem("cs_lookup_category_v1", categoryKey); }, [categoryKey]);
  useEffect(() => { setRows([]); setReachedEnd(false); }, [categoryKey, team]);

  // 조회 한 번에 필요한 쿼리를 만든다. offset만 바꿔 "더 보기"에 재사용.
  const buildQuery = useCallback((offset: number) => {
    const parts = ["select=*"];
    if (HIDEABLE.has(category.table)) parts.push(`_hidden=${showHidden ? "is.true" : "not.is.true"}`);
    if (category.filterQuery) parts.push(category.filterQuery);
    if (period !== "all") {
      const months = period === "1m" ? -1 : period === "3m" ? -3 : period === "6m" ? -6 : -12;
      parts.push(`${encodeURIComponent(category.dateField)}=gte.${shiftMonths(kstDate(), months)}`);
    }
    if (query.trim()) {
      // PostgREST or 조건 — 정의된 검색 필드를 한 번에 훑는다.
      // 컬럼 이름을 반드시 따옴표로 감싼다: "관심품목(세분화)"처럼 괄호가 든 이름이 있어
      // 그냥 넣으면 or 구문이 깨진다(400).
      const needle = query.trim().replace(/[(),*"]/g, " ").trim();
      parts.push(`or=(${category.searchFields.map((field) => `"${field}".ilike.*${needle}*`).join(",")})`);
    }
    if (team !== "전체" && (category.teamField || category.teamSourceParen)) {
      // 팀 컬럼('수도권C'·'C'·'C,D')과 출처 라벨의 괄호("카톡:재계약(A)")를 함께 본다 —
      // 시트 동기화분은 지역 칸이 빈 경우가 많아(재계약은 100%) 컬럼만으로는 다 빠진다.
      const conds: string[] = [];
      if (category.teamField) conds.push(`"${category.teamField}".ilike."*${team}*"`);
      if (category.teamSourceParen) conds.push(`"_출처".ilike."*(*${team}*)*"`);
      parts.push(`or=(${conds.map((cond) => encodeURIComponent(cond)).join(",")})`);
    }
    parts.push(`order=${encodeURIComponent(category.orderField)}.desc`, `limit=${PAGE}`);
    if (offset > 0) parts.push(`offset=${offset}`);
    return parts.join("&");
  }, [category, period, query, team, HIDEABLE, showHidden]);

  const fetchPage = useCallback(async (offset: number) => {
    setLoading(true);
    setError("");
    try {
      if (offset === 0) {
        // 첫 페이지는 직접 fetch — content-range 헤더에서 필터 반영 총 건수를 같이 받는다
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${category.table}?${buildQuery(0)}`, {
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, Prefer: "count=exact" },
        });
        if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
        const next = (await res.json()) as Row[];
        const exact = Number((res.headers.get("content-range") || "").split("/")[1]);
        setTotalCount(Number.isFinite(exact) ? exact : null);
        setReachedEnd(next.length < PAGE);
        setRows(next);
      } else {
        const next = await selectRows<Row>(category.table, buildQuery(offset));
        setReachedEnd(next.length < PAGE);
        setRows((current) => [...current, ...next]);
      }
    } catch (e) {
      setError((e as Error).message || "조회에 실패했습니다.");
      if (!offset) setRows([]);
    } finally {
      setLoading(false);
    }
  }, [buildQuery, category.table]);

  // 카테고리·기간·검색어가 바뀌면 처음부터 다시 읽는다
  useEffect(() => { void fetchPage(0); }, [fetchPage]);

  const visibleColumns = category.columns;
  const template = visibleColumns.map((column) => column.width || "minmax(0,1fr)").join(" ");
  const hideClass = (column: LookupColumn) => column.hideBelow === "lg" ? "hidden lg:block" : column.hideBelow === "sm" ? "hidden sm:block" : "";

  const exportCsv = () => {
    const header = visibleColumns.map((column) => column.label);
    const lines = [header.map(csvCell).join(",")];
    rows.forEach((row) => lines.push(visibleColumns.map((column) => csvCell(text(row, column.key))).join(",")));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${category.label}_${kstDate()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const detailFields = useMemo(() => {
    if (!detail) return [] as Array<[string, string]>;
    return Object.entries(detail)
      .filter(([key]) => !key.startsWith("_dupKey") && key !== "id")
      .map(([key, value]) => [key, value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)] as [string, string])
      .filter(([, value]) => value.trim());
  }, [detail]);

  return (
    <div className="space-y-4">
      {/* 카테고리 — 그룹별로 묶어 한 줄씩 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <p className="text-[11px] font-semibold text-slate-400">기록이 저장된 표를 그대로 조회합니다. 행을 누르면 모든 항목과 원문을 볼 수 있습니다.</p>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => void fetchPage(0)} title="새로고침"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        <div className="space-y-2 p-3">
          {LOOKUP_GROUPS.map((group) => {
            const items = LOOKUP_CATEGORIES.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="flex flex-wrap items-center gap-1.5">
                <span className="w-20 shrink-0 text-[10px] font-black tracking-wide text-slate-400">{group}</span>
                {items.map((item) => (
                  <button key={item.key} type="button" onClick={() => setCategoryKey(item.key)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${item.key === categoryKey ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                    {item.label}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {/* 전용 보드가 있는 카테고리: CS체크·정렬·수량조절 등 기능이 범용 표보다 풍부해 그대로 흡수 */}
      {category.custom === "misu" && <MisuBoard />}
      {category.custom === "overage" && <OverageBoard />}
      {category.custom === "stock" && <StockBoard author={author} />}

      {/* KPI — 미수 보드와 같은 요약 카드 (필터가 그대로 반영된 정확한 수) */}
      {!category.custom && (
        <div className="grid grid-cols-3 gap-2">
          {([
            [totalCount != null ? totalCount.toLocaleString() + "건" : "…", `${PERIODS.find(([value]) => value === period)?.[1] || ""} 기록`],
            [rows.length ? shortValue(text(rows[0], category.dateField), category.dateField) : "-", "가장 최근 기록"],
            [team === "전체" ? "전 팀" : `${team}팀`, query ? `"${query}" 검색 중` : "보는 범위"],
          ] as [string, string][]).map(([value, label]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm">
              <div className="truncate text-lg font-black tabular-nums text-slate-950 sm:text-xl">{value}</div>
              <div className="mt-1 text-[11px] font-bold text-slate-400">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 검색 + 결과 (범용) */}
      {!category.custom && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-8 shrink-0 text-[10px] font-black text-slate-400">기간</span>
            {PERIODS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setPeriod(value)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${period === value ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>{label.replace("최근 ", "")}</button>
            ))}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button type="button" onClick={exportCsv} disabled={!rows.length}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                <Download size={13} />CSV
              </button>
            </div>
          </div>
          {category.teamField && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-8 shrink-0 text-[10px] font-black text-slate-400">팀</span>
              {["전체", "A", "B", "C", "D"].map((value) => (
                <button key={value} type="button" onClick={() => setTeam(value)}
                  className={`rounded-full px-3.5 py-1.5 text-[11px] font-black transition ${team === value ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
                  {value === "전체" ? "전체" : `${value}팀`}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={queryDraft} onChange={(e) => setQueryDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setQuery(queryDraft); }}
                placeholder={`${category.label} 검색 — 업체명 · 작성자 · 내용`}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              {queryDraft && <button type="button" onClick={() => { setQueryDraft(""); setQuery(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>}
            </div>
            <button type="button" onClick={() => setQuery(queryDraft)} className="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">검색</button>
          </div>
        </div>

        {category.note && <div className="border-b border-amber-100 bg-amber-50/60 px-4 py-2 text-[11px] font-bold text-amber-800">{category.note}</div>}
        {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}

        {/* 표 머리 */}
        <div className="hidden gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-2.5 sm:grid" style={{ gridTemplateColumns: template }}>
          {visibleColumns.map((column) => (
            <span key={column.key} className={`truncate text-[11px] font-black text-slate-500 ${column.align === "right" ? "text-right" : ""} ${hideClass(column)}`}>{column.label}</span>
          ))}
        </div>

        {HIDEABLE.has(category.table) && (
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-1.5">
            <span className="text-[10px] font-bold text-slate-400">{showHidden ? "숨긴 기록만 보는 중 — 잘못 숨긴 건 상세에서 복원" : "잘못된 기록은 상세에서 숨길 수 있습니다 (원문 보존)"}</span>
            <button type="button" onClick={() => { setShowHidden((v) => !v); setRows([]); }}
              className={`rounded-full px-2.5 py-1 text-[10px] font-black transition ${showHidden ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {showHidden ? "일반 기록 보기" : "숨긴 기록 보기"}
            </button>
          </div>
        )}
        <div className="max-h-[68vh] divide-y divide-slate-100 overflow-y-auto">
          {loading && !rows.length && <div className="p-12 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {!loading && !rows.length && !error && <div className="p-12 text-center text-sm font-bold text-slate-400">조건에 맞는 기록이 없습니다.</div>}

          {rows.map((row, index) => (
            <button key={String(row.id ?? index)} type="button" onClick={() => setDetail(row)}
              className="block w-full px-4 py-3 text-left transition hover:bg-blue-50/40">
              {/* PC: 표 / 모바일: 카드 */}
              <span className="hidden gap-2 sm:grid" style={{ gridTemplateColumns: template }}>
                {visibleColumns.map((column) => {
                  const value = shortValue(text(row, column.key), column.key);
                  return (
                    <span key={column.key}
                      className={`truncate text-xs ${column.align === "right" ? "text-right" : ""} ${column.mono ? "font-mono tabular-nums" : ""} ${column.strong ? "text-[13px] font-black text-slate-900" : "font-semibold text-slate-600"} ${hideClass(column)}`}
                      title={value}>{value}</span>
                  );
                })}
              </span>
              <span className="block sm:hidden">
                <span className="flex items-center justify-between gap-2">
                  <b className="truncate text-[13px] font-black text-slate-900">{shortValue(text(row, category.vendorField), category.vendorField)}</b>
                  <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-slate-400">{shortValue(text(row, category.dateField), category.dateField)}</span>
                </span>
                <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">
                  {visibleColumns.filter((column) => column.key !== category.vendorField && column.key !== category.dateField).slice(0, 3)
                    .map((column) => `${column.label} ${shortValue(text(row, column.key), column.key)}`).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>

        {!reachedEnd && rows.length > 0 && (
          <div className="border-t border-slate-100 p-3 text-center">
            <button type="button" disabled={loading} onClick={() => void fetchPage(rows.length)}
              className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
              {loading ? "불러오는 중…" : `${PAGE}건 더 보기`}
            </button>
          </div>
        )}
      </section>}

      {detail && (
        <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setDetail(null)}>
          <div className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-3xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-black text-blue-600">{category.label}</div>
                <div className="truncate text-base font-black text-slate-950">{text(detail, category.vendorField) || "제목 없음"}</div>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              {/* 미수 상세와 같은 라벨-값 줄 — 전화번호가 보이면 바로 걸 수 있게 */}
              <div className="rounded-lg border border-slate-200 p-3">
                {detailFields.filter(([key]) => !["_원문", "원문", "source_text", "report_text", "_raw", "photos", "remote_meta"].includes(key)).map(([key, value]) => {
                  const phone = value.match(/0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/)?.[0];
                  return (
                    <div key={key} className="flex items-start justify-between gap-3 border-b border-slate-50 py-1.5 last:border-0">
                      <span className="w-24 shrink-0 pt-0.5 text-[11px] font-black text-slate-400">{key.replace(/^_/, "")}</span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm font-bold leading-5 text-slate-800">{value}</span>
                      {phone && <a href={`tel:${phone.replace(/[^0-9]/g, "")}`} className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white transition hover:bg-emerald-700">📞</a>}
                    </div>
                  );
                })}
              </div>
              {detailFields.filter(([key]) => ["_원문", "원문", "source_text", "report_text"].includes(key)).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 text-[10px] font-black tracking-wide text-slate-400">{key.replace(/^_/, "")}</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-700">{value}</pre>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={() => { void navigator.clipboard.writeText(detailFields.map(([key, value]) => `${key}: ${value}`).join("\n")); }}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50">전체 복사</button>
              {HIDEABLE.has(category.table) && detail.id != null && (
                <button type="button" disabled={hideBusy}
                  onClick={() => {
                    const hiding = !showHidden;
                    if (!window.confirm(hiding ? "이 기록을 숨길까요?\n목록·집계에서 빠지고, 원문은 보존됩니다 (숨긴 기록 보기에서 복원 가능)" : "이 기록을 복원할까요?")) return;
                    setHideBusy(true);
                    void updateRows(category.table, `id=eq.${encodeURIComponent(String(detail.id))}`, hiding ? { _hidden: true, _hidden_by: author || "미지정", _hidden_at: new Date().toISOString() } : { _hidden: false })
                      .then(() => {
                        // 현장 기록(점검·AS·물류)은 업무현황판 집계에서도 같이 제외/복원 — 오발송 기능 일원화
                        if (["jeomgeom", "as_records", "logistics_records"].includes(category.table)) {
                          const sourceText = String(detail["_원문"] ?? detail["원문"] ?? detail["source_text"] ?? "");
                          const rowAuthor = String(detail["작성자"] ?? detail["author"] ?? "");
                          const rowDate = String(detail[category.dateField] ?? "").slice(0, 10);
                          const rowVendor = String(detail["_업체명"] ?? detail["업체명"] ?? "");
                          if (sourceText.trim() && rowAuthor && rowDate) {
                            void setActivityEventsCancelledBySource(sourceText, rowAuthor, rowDate, hiding, author || "미지정").catch(() => {});
                            void setVisitsCancelledBySource(sourceText, rowAuthor, rowDate, hiding, author || "미지정").catch(() => {});
                          }
                          // 원문이 조금 달라진 중복 전송분까지 — 업체+작성자+날짜 기준으로 한 번 더
                          if (rowVendor.trim() && rowAuthor && rowDate) {
                            void setVisitsCancelledByVendor(rowVendor, rowAuthor, rowDate, hiding, author || "미지정").catch(() => {});
                          }
                        }
                        setRows((current) => current.filter((r) => r.id !== detail.id));
                        setDetail(null);
                      })
                      .catch((e: unknown) => window.alert(`처리 실패: ${(e as Error).message}`))
                      .finally(() => setHideBusy(false));
                  }}
                  className={`rounded-full border px-4 py-2 text-sm font-black transition disabled:opacity-40 ${showHidden ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"}`}>
                  {hideBusy ? "처리 중…" : showHidden ? "복원" : "숨김 (오발송·오기록)"}
                </button>
              )}
              <button type="button" onClick={() => setDetail(null)} className="rounded-full bg-slate-900 px-5 py-2 text-sm font-black text-white transition hover:bg-slate-800">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
