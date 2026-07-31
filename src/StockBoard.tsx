/**
 * 기기/부품 재고현황 — 관리부가 수량을 관리하고, CS팀이 현장에서 즉시 확인한다.
 * (교체 약속 전 기기 재고 확인, 부품 없어서 재방문하는 일 방지 — supabase/stock.sql)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import { ALL_MODEL_NAMES, CATALOG_BRANDS, brandOfModel } from "./modelCatalog";
import { notify } from "./toast";

type StockItem = {
  id: string; created_at: string; updated_at: string; updated_by: string;
  kind: "기기" | "부품"; brand: string; name: string;
  condition: "" | "새기기" | "리퍼"; qty: number; note: string;
};

// 기종 카탈로그(modelCatalog.ts)와 같은 제조사 체계를 쓴다
const BRAND_NAMES = [...CATALOG_BRANDS, "기타"];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}분 전`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 60 / 24)}일 전`;
}

export default function StockBoard({ author }: { author: string }) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"기기" | "부품">("기기");
  const [brand, setBrand] = useState("전체");
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [condition, setCondition] = useState<"전체" | "새기기" | "리퍼">("전체");
  const [sortMode, setSortMode] = useState<"name" | "qty">("name");
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ brand: "삼성", name: "", condition: "새기기" as "새기기" | "리퍼" | "", qty: 0, note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await selectRows<StockItem>("stock_items", "select=*&order=brand.asc,name.asc,condition.asc&limit=2000"));
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/stock.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // 관리부 갱신분이 바로 보이게 탭 복귀 시 새로고침
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = items.filter((item) => {
      if (item.kind !== kind) return false;
      if (kind === "기기" && brand !== "전체" && item.brand !== brand) return false;
      if (kind === "기기" && condition !== "전체" && item.condition !== condition) return false;
      if (lowOnly && item.qty > 2) return false;
      if (!keyword) return true;
      return [item.name, item.brand, item.note].join(" ").toLowerCase().includes(keyword);
    });
    return sortMode === "qty" ? [...list].sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name)) : list;
  }, [items, kind, brand, query, lowOnly, sortMode, condition]);

  const byBrand = useMemo(() => {
    const map = new Map<string, StockItem[]>();
    for (const item of filtered) {
      const key = item.brand || "기타";
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [filtered]);

  const totalOf = (targetKind: "기기" | "부품") => items.filter((i) => i.kind === targetKind).reduce((sum, i) => sum + i.qty, 0);
  const kindItems = items.filter((i) => i.kind === kind);
  const summary = {
    qty: kindItems.reduce((sum, i) => sum + i.qty, 0),
    types: kindItems.length,
    soldOut: kindItems.filter((i) => i.qty === 0).length,
    low: kindItems.filter((i) => i.qty > 0 && i.qty <= 2).length,
  };

  const changeQty = async (item: StockItem, delta: number) => {
    const qty = Math.max(0, item.qty + delta);
    setItems((current) => current.map((i) => i.id === item.id ? { ...i, qty, updated_by: author || "미지정", updated_at: new Date().toISOString() } : i));
    try {
      await updateRows("stock_items", `id=eq.${item.id}`, { qty, updated_by: author || "미지정" });
    } catch (e) {
      notify(`수량 변경 실패: ${(e as Error).message}`, "error");
      void load();
    }
  };

  const removeItem = async (item: StockItem) => {
    if (!window.confirm(`"${item.name}${item.condition ? ` (${item.condition})` : ""}" 항목을 삭제할까요?`)) return;
    try {
      await deleteRows("stock_items", `id=eq.${item.id}`);
      setItems((current) => current.filter((i) => i.id !== item.id));
    } catch (e) {
      notify(`삭제 실패: ${(e as Error).message}`, "error");
    }
  };

  const submit = async () => {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    try {
      await insertRow("stock_items", {
        kind, brand: kind === "기기" ? draft.brand : (draft.brand || ""), name: draft.name.trim(),
        condition: kind === "기기" ? draft.condition : "", qty: Math.max(0, Number(draft.qty) || 0),
        note: draft.note.trim(), updated_by: author || "미지정",
      });
      setDraft({ ...draft, name: "", qty: 0, note: "" });
      setAddOpen(false);
      await load();
    } catch (e) {
      notify(`추가 실패: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // 수량이 이 화면의 유일한 신호 — 색은 여기에만 쓰고 나머지는 무채색으로 둔다
  const qtyTone = (qty: number) => qty === 0 ? "border-rose-200 bg-rose-50 text-rose-600" : qty <= 2 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-700";

  const renderRow = (item: StockItem) => (
    <div key={item.id} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3.5 transition hover:bg-slate-50/70 first:border-t-0 2xl:border-t 2xl:first:border-t 2xl:[&:nth-child(-n+2)]:border-t-0 2xl:[&:nth-child(odd)]:border-r">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14px] font-black text-slate-900">{item.name}</span>
          {item.condition && <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${item.condition === "새기기" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"}`}>{item.condition}</span>}
        </div>
        {item.note && <div className="mt-0.5 text-xs font-semibold text-slate-500">{item.note}</div>}
        <div className="mt-0.5 text-[10px] font-bold text-slate-300">{item.updated_by || "-"} · {timeAgo(item.updated_at)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => void changeQty(item, -1)} className="h-9 w-9 rounded-full border border-slate-200 text-base font-black text-slate-500 transition hover:bg-slate-50">−</button>
        <span className={`min-w-14 rounded-full border px-3 py-1.5 text-center text-base font-black tabular-nums ${qtyTone(item.qty)}`}>{item.qty}</span>
        <button type="button" onClick={() => void changeQty(item, 1)} className="h-9 w-9 rounded-full border border-slate-200 text-base font-black text-slate-500 transition hover:bg-slate-50">＋</button>
        <button type="button" onClick={() => void removeItem(item)} className="ml-1 text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-16">
      <div className="flex items-stretch justify-between gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex">
          {(["기기", "부품"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setKind(value)}
              className={`relative px-6 py-3.5 text-sm font-black transition ${kind === value ? "text-slate-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}>
              {value} <span className={`ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${kind === value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"}`}>{totalOf(value)}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setAddOpen(true)} className="my-2 mr-3 shrink-0 rounded-full bg-slate-900 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800">+ 항목 추가</button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8">
        {([
          [`${summary.qty}${kind === "기기" ? "대" : "개"}`, `${kind} 총수량`, "text-slate-950"],
          [`${summary.types}종`, "품목 수", "text-slate-950"],
          [`${summary.soldOut}종`, "품절 (0)", summary.soldOut ? "text-rose-600" : "text-slate-950"],
          [`${summary.low}종`, "부족 (1~2)", summary.low ? "text-amber-600" : "text-slate-950"],
        ] as [string, string, string][]).map(([value, label, tone]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm">
            <div className={`text-xl font-black tabular-nums lg:text-2xl ${tone}`}>{value}</div>
            <div className="mt-1 text-[11px] font-bold text-slate-400">{label}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold text-slate-500">교체 약속 전 기기 재고, 재방문 전 부품 재고를 여기서 바로 확인하세요. 수량은 관리부가 관리하며 마지막 수정자·시각이 함께 남습니다.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "기기" ? "기종 검색" : "부품명 검색"} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <div className="flex flex-wrap items-center gap-1">
            {kind === "기기" && <span className="flex rounded-full bg-slate-100 p-1">
              {(["전체", "새기기", "리퍼"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setCondition(value)} className={`rounded-full px-2 py-1 text-[11px] font-black ${condition === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{value}</button>
              ))}
            </span>}
            <button type="button" onClick={() => setLowOnly((v) => !v)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${lowOnly ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}>⚠ 부족만</button>
            <span className="flex rounded-full bg-slate-100 p-1">
              {([["name", "이름순"], ["qty", "수량 적은순"]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setSortMode(value)} className={`rounded-full px-2 py-1 text-[11px] font-black ${sortMode === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </span>
          </div>
        </div>
        {kind === "기기" && <div className="mt-2 flex flex-wrap gap-1">
          {["전체", ...BRAND_NAMES].map((name) => (
            <button key={name} type="button" onClick={() => setBrand(name)} className={`rounded-full px-2.5 py-1.5 text-xs font-black ${brand === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>
          ))}
        </div>}
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && !filtered.length && <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">{items.some((i) => i.kind === kind) ? "조건에 맞는 항목이 없어요." : `${kind} 재고 항목을 추가해 주세요. (관리부와 함께 채워가는 표입니다)`}</div>}

      {kind === "기기" ? (
        Array.from(byBrand.entries()).map(([brandName, rows]) => (
          <section key={brandName} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-black text-slate-700">
              <span>{brandName} <span className="ml-1 font-bold text-slate-400">{rows.length}종</span></span>
              <span className="text-slate-500">{rows.reduce((sum, r) => sum + r.qty, 0)}대</span>
            </div>
            {rows.map(renderRow)}
          </section>
        ))
      ) : (
        !loading && filtered.length > 0 && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm 2xl:grid 2xl:grid-cols-2 2xl:gap-x-0">{filtered.map(renderRow)}</section>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setAddOpen(false)}>
          <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <b className="text-slate-950">{kind} 항목 추가</b>
            <div className="mt-4 space-y-3">
              {kind === "기기" && <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-slate-500">브랜드
                  <select value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                    {BRAND_NAMES.map((name) => <option key={name}>{name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-500">구분
                  <select value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value as "새기기" | "리퍼" })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                    <option>새기기</option><option>리퍼</option>
                  </select>
                </label>
              </div>}
              <label className="block text-xs font-bold text-slate-500">{kind === "기기" ? "기종명 (입력하면 브랜드 자동 선택)" : "부품명"}
                <input value={draft.name} list={kind === "기기" ? "stock-model-catalog" : undefined}
                  onChange={(e) => {
                    const name = e.target.value;
                    const detected = kind === "기기" ? brandOfModel(name) : "";
                    setDraft({ ...draft, name, ...(detected ? { brand: detected } : {}) });
                  }}
                  placeholder={kind === "기기" ? "예: SL-X3220NR" : "예: X3220 픽업롤러"} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                {kind === "기기" && <datalist id="stock-model-catalog">{ALL_MODEL_NAMES.map((name) => <option key={name} value={name} />)}</datalist>}
              </label>
              <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2">
                <label className="text-xs font-bold text-slate-500">수량
                  <input type="number" min={0} value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
                <label className="text-xs font-bold text-slate-500">메모 (선택)
                  <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder={kind === "부품" ? "적용 기종 등" : "위치·상태 등"} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAddOpen(false)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">취소</button>
              <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void submit()} className="rounded-full bg-slate-900 transition hover:bg-slate-800 px-5 py-2 text-sm font-black text-white disabled:opacity-40">{busy ? "저장 중…" : "추가"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
