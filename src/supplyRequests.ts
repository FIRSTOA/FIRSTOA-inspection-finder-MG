/**
 * 부품·자가 신청을 표(supply_requests)에 쌓기 (2026-10-11)
 *  - 전송 때: api.sendForm 이 점검·AS 기록을 저장한 뒤 같은 글로 saveSupplyRequests — 품목마다 한 행
 *  - 지난 기록: 관리 탭 [지난 기록 채우기] → backfillSupplyMonth — 점검·AS 원문에서 물품이 적힌 것만 달별로 읽어 넣는다
 *  - 표준화: 재고 탭의 품목 사전(stock_items 부품·자가: 별칭·쓰는 기종·색)으로 이름을 맞추고 "1세트"를 색별로 푼다(사전은 5분 캐시)
 *  같은 보고·같은 품목은 _dupKey(유니크)로 한 번만 들어간다(insertRow 가 409 를 dup 으로 돌려준다).
 */
import { md5 } from "./md5";
import { insertRow, selectRows, updateRows } from "./supabase";
import { firstDeviceOf, modeOf, normalizeItems, parseSupplyRequests, supplyDupSource, type CatalogItem, type NormalizedItem } from "../supabase/functions/_shared/supply-requests.ts";

export type SupplyContext = {
  sourceTable: "jeomgeom" | "as_records";
  sourceId?: string | number | null;
  date: string;            // YYYY-MM-DD
  author: string;
  team: string;
  vendor: string;
  text: string;            // 보고 원문(※부품신청※·※자가신청※ 칸 포함)
};

const KOR_CONT = /[가-힣]/;
const regionLetter = (v: string) => { const m = String(v || "").toUpperCase().match(/[A-E]/); return m ? m[0] : ""; };

let catalogCache: { at: number; p: Promise<CatalogItem[]> } | null = null;
/** 품목 사전 — 재고 표의 부품·자가 행. 표에 새 칸(aliases 등)이 없으면 빈 사전(이름 그대로 저장) */
export function loadSupplyCatalog(force = false): Promise<CatalogItem[]> {
  if (!force && catalogCache && Date.now() - catalogCache.at < 5 * 60_000) return catalogCache.p;
  const p = selectRows<{ id: string; kind: string; name: string; category?: string; color?: string; aliases?: string[]; models?: string[] }>("stock_items", "select=id,kind,name,category,color,aliases,models&kind=in.(부품,자가)&_hidden=not.is.true&limit=2000")
    .then((rows) => rows.map((r) => ({ id: String(r.id), kind: r.kind, name: r.name, category: r.category || "", color: r.color || "", aliases: Array.isArray(r.aliases) ? r.aliases : [], models: Array.isArray(r.models) ? r.models : [] })))
    .catch(() => [] as CatalogItem[]);
  catalogCache = { at: Date.now(), p };
  return p;
}

export function rowsFor(ctx: SupplyContext, catalog: CatalogItem[] = []): Array<Record<string, unknown>> {
  const parsed = parseSupplyRequests(ctx.text);
  if (!parsed.length) return [];
  const dev = firstDeviceOf(ctx.text);
  const items = normalizeItems(parsed, catalog, dev.model);
  return items.map((s: NormalizedItem) => ({
    request_date: ctx.date.slice(0, 10), kind: s.kind, vendor: String(ctx.vendor || "").trim(), team: regionLetter(ctx.team), author: String(ctx.author || "").trim(),
    model: dev.model, serial: dev.serial, asset: dev.asset,
    item: s.item, qty: s.qty, status: s.status, warranty: s.warranty, counter: s.counter, expected: s.expected,
    item_std: s.itemStd, category: s.category, color: s.color, stock_item_id: s.stockItemId, set_label: s.setLabel,
    // 차량 재고로 바로 줬으면 그 업체에 이미 지급된 것(출고는 차량 보충). 아니면 출고 뒤 [지급]·[반납]·[불량]
    ...(modeOf(s.status, s.raw) === "차량재고"
      ? { mode: "차량재고", stage: "지급", used_vendor: String(ctx.vendor || "").trim(), used_at: `${ctx.date.slice(0, 10)}T09:00:00+09:00`, used_by: String(ctx.author || "").trim() }
      : { mode: "출고요청", stage: "신청" }),
    source_table: ctx.sourceTable, source_id: ctx.sourceId == null ? "" : String(ctx.sourceId), raw: s.raw.slice(0, 2000),
    _dupKey: md5(supplyDupSource(ctx.sourceTable, ctx.date.slice(0, 10), String(ctx.author || "").trim(), ctx.vendor, s)),
  }));
}

/** 표에 아직 2차 칸(item_std 등)이 없으면 그 칸을 빼고 넣는다 — SQL 실행 전에도 1차 칸으로는 쌓이게 */
async function insertSupplyRow(row: Record<string, unknown>): Promise<"new" | "dup"> {
  try { return await insertRow("supply_requests", row); }
  catch (e) {
    if (!/item_std|category|color|stock_item_id|set_label|stage|mode|used_|issued_|PGRST204|42703/.test(String((e as Error).message))) throw e;
    const slim = { ...row }; for (const k of ["item_std", "category", "color", "stock_item_id", "set_label", "stage", "mode", "used_vendor", "used_at", "used_by"]) delete slim[k];
    return insertRow("supply_requests", slim);
  }
}

/** 전송 직후 — 실패해도 전송은 막지 않는다(표가 없으면 조용히) */
export async function saveSupplyRequests(ctx: SupplyContext): Promise<number> {
  let n = 0;
  const catalog = await loadSupplyCatalog();
  for (const row of rowsFor(ctx, catalog)) {
    try { if ((await insertSupplyRow(row)) === "new") n += 1; } catch { /* 표 없음·권한 — 다음 기회(채우기)에 */ }
  }
  return n;
}

type RecRow = { id: number; 작성일: string; 작성자: string; _업체명: string; 지역: string; _원문: string };

/** 달 하나(YYYY-MM)의 점검·AS 원문 중 물품이 적힌 것만 읽어 넣는다. 돌려주는 값: 읽은 글 수·새로 넣은 행 수 */
export async function backfillSupplyMonth(ym: string): Promise<{ read: number; inserted: number; skipped: number }> {
  const [y, m] = ym.split("-").map(Number);
  const from = `${ym}-01`;
  const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const col = (c: string) => encodeURIComponent(c);
  // LIKE 의 _ 는 글자 하나 — "물품명: 드럼"처럼 뒤에 글자가 있는 것만(빈 양식 "물품명:\n" 제외). 자가는 "물품: K2"
  const filter = `or=(${col("_원문")}.like.*${encodeURIComponent("물품명: _")}*,${col("_원문")}.like.*${encodeURIComponent("물품: _")}*)`;
  const catalog = await loadSupplyCatalog(true);
  let read = 0, inserted = 0, skipped = 0;
  for (const table of ["jeomgeom", "as_records"] as const) {
    const rows = await selectRows<RecRow>(table, `select=id,${col("작성일")},${col("작성자")},${col("_업체명")},${col("지역")},${col("_원문")}&${col("작성일")}=gte.${from}&${col("작성일")}=lt.${to}&${filter}&_hidden=not.is.true&order=id.asc&limit=1000`);
    for (const r of rows) {
      read += 1;
      const text = String(r._원문 || "");
      if (!KOR_CONT.test(text)) continue;
      const list = rowsFor({ sourceTable: table, sourceId: r.id, date: String(r.작성일 || "").slice(0, 10), author: String(r.작성자 || ""), team: String(r.지역 || ""), vendor: String(r._업체명 || ""), text }, catalog);
      for (const row of list) {
        try { const res = await insertSupplyRow(row); if (res === "new") inserted += 1; else skipped += 1; } catch (e) { throw new Error(`${table} #${r.id}: ${(e as Error).message}`); }
      }
    }
  }
  return { read, inserted, skipped };
}

/** 미정의 품목(item_std 가 빈 행)을 사전으로 다시 맞춘다 — 관리 탭에서 별칭을 추가한 뒤 누른다 */
export async function renormalizeUndefined(): Promise<{ checked: number; fixed: number }> {
  const catalog = await loadSupplyCatalog(true);
  const rows = await selectRows<{ id: number; kind: "부품" | "자가"; item: string; qty: string; model: string }>("supply_requests", "select=id,kind,item,qty,model&item_std=eq.&order=id.desc&limit=2000");
  let fixed = 0;
  for (const r of rows) {
    const [n] = normalizeItems([{ kind: r.kind, item: r.item, qty: r.qty, status: "", warranty: "", counter: "", expected: "", raw: "" }], catalog, r.model);
    if (n && n.itemStd && !n.setLabel) {
      await updateRows("supply_requests", `id=eq.${r.id}`, { item_std: n.itemStd, category: n.category, color: n.color, stock_item_id: n.stockItemId });
      fixed += 1;
    }
  }
  return { checked: rows.length, fixed };
}

/** 최근 N달(이번 달 포함) 목록 — 최신 달부터 */
export function recentMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.now() + 9 * 3600_000);
  for (let i = 0; i < n; i += 1) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1 - i;
    const yy = m <= 0 ? y - 1 : y, mm = m <= 0 ? m + 12 : m;
    out.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}
