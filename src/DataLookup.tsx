import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, X } from "lucide-react";
import { selectRows } from "./supabase";
import { LOOKUP_CATEGORIES, LOOKUP_GROUPS, type LookupCategory, type LookupColumn } from "./lookupCatalog";
import PortalSelect from "./PortalSelect";
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

function text(row: Row, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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

export default function DataLookup() {
  const [categoryKey, setCategoryKey] = useState<string>(() => window.localStorage.getItem("cs_lookup_category_v1") || "jeomgeom");
  const [period, setPeriod] = useState<PeriodKey>("3m");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);

  const category = useMemo<LookupCategory>(
    () => LOOKUP_CATEGORIES.find((item) => item.key === categoryKey) || LOOKUP_CATEGORIES[0],
    [categoryKey],
  );

  useEffect(() => { window.localStorage.setItem("cs_lookup_category_v1", categoryKey); }, [categoryKey]);
  useEffect(() => { setRows([]); setReachedEnd(false); }, [categoryKey]);

  // 조회 한 번에 필요한 쿼리를 만든다. offset만 바꿔 "더 보기"에 재사용.
  const buildQuery = useCallback((offset: number) => {
    const parts = ["select=*"];
    if (category.filterQuery) parts.push(category.filterQuery);
    if (period !== "all") {
      const months = period === "1m" ? -1 : period === "3m" ? -3 : period === "6m" ? -6 : -12;
      parts.push(`${encodeURIComponent(category.dateField)}=gte.${shiftMonths(kstDate(), months)}`);
    }
    if (query.trim()) {
      // PostgREST or 조건 — 정의된 검색 필드를 한 번에 훑는다
      const needle = query.trim().replace(/[(),*]/g, " ").trim();
      parts.push(`or=(${category.searchFields.map((field) => `${field}.ilike.*${needle}*`).join(",")})`);
    }
    parts.push(`order=${encodeURIComponent(category.orderField)}.desc`, `limit=${PAGE}`);
    if (offset > 0) parts.push(`offset=${offset}`);
    return parts.join("&");
  }, [category, period, query]);

  const fetchPage = useCallback(async (offset: number) => {
    setLoading(true);
    setError("");
    try {
      const next = await selectRows<Row>(category.table, buildQuery(offset));
      setReachedEnd(next.length < PAGE);
      setRows((current) => (offset > 0 ? [...current, ...next] : next));
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#151A23] px-4 py-3">
          <p className="text-[11px] font-semibold text-slate-400">기록이 저장된 표를 그대로 조회합니다. 행을 누르면 모든 항목과 원문을 볼 수 있습니다.</p>
          <div className="ml-auto flex items-center gap-2">
            <PortalSelect tone="dark" width={150} value={period} onChange={(next) => setPeriod(next as PeriodKey)}
              options={PERIODS.map(([value, label]) => ({ value, label }))} />
            <button type="button" onClick={() => void fetchPage(0)} title="새로고침"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-slate-300 transition hover:bg-white/20 hover:text-white">
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

      {/* 검색 + 결과 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={queryDraft} onChange={(e) => setQueryDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setQuery(queryDraft); }}
                placeholder={`${category.label} 검색 — 업체명 · 작성자 · 내용`}
                className="h-9 w-full rounded-lg border border-slate-300 pl-9 pr-8 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              {queryDraft && <button type="button" onClick={() => { setQueryDraft(""); setQuery(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>}
            </div>
            <button type="button" onClick={() => setQuery(queryDraft)} className="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">검색</button>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black tabular-nums text-slate-500">{rows.length}{reachedEnd ? "" : "+"}건</span>
            <button type="button" onClick={exportCsv} disabled={!rows.length}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
              <Download size={13} />CSV
            </button>
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
      </section>

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
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {detailFields.filter(([key]) => key !== "_원문" && key !== "원문" && key !== "source_text" && key !== "report_text" && key !== "_raw").map(([key, value]) => (
                  <div key={key} className="min-w-0 rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-black text-slate-400">{key.replace(/^_/, "")}</div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] font-bold text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              {detailFields.filter(([key]) => key === "_원문" || key === "원문" || key === "source_text" || key === "report_text").map(([key, value]) => (
                <div key={key} className="mt-4">
                  <div className="text-[11px] font-black text-slate-400">{key.replace(/^_/, "")}</div>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-700">{value}</pre>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={() => { void navigator.clipboard.writeText(detailFields.map(([key, value]) => `${key}: ${value}`).join("\n")); }}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50">전체 복사</button>
              <button type="button" onClick={() => setDetail(null)} className="rounded-full bg-slate-900 px-5 py-2 text-sm font-black text-white transition hover:bg-slate-800">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
