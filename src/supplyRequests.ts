/**
 * 부품·자가 신청을 표(supply_requests)에 쌓기 (2026-10-11)
 *  - 전송 때: api.sendForm 이 점검·AS 기록을 저장한 뒤 같은 글로 saveSupplyRequests — 품목마다 한 행
 *  - 지난 기록: 관리 탭 [지난 기록 채우기] → backfillSupplyRequests — 점검·AS 원문에서 물품이 적힌 것만 달별로 읽어 넣는다
 *  같은 보고·같은 품목은 _dupKey(유니크)로 한 번만 들어간다(insertRow 가 409 를 dup 으로 돌려준다).
 */
import { md5 } from "./md5";
import { insertRow, selectRows } from "./supabase";
import { firstDeviceOf, parseSupplyRequests, supplyDupSource, type SupplyItem } from "../supabase/functions/_shared/supply-requests.ts";

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

export function rowsFor(ctx: SupplyContext): Array<Record<string, unknown>> {
  const items = parseSupplyRequests(ctx.text);
  if (!items.length) return [];
  const dev = firstDeviceOf(ctx.text);
  return items.map((s: SupplyItem) => ({
    request_date: ctx.date.slice(0, 10), kind: s.kind, vendor: String(ctx.vendor || "").trim(), team: regionLetter(ctx.team), author: String(ctx.author || "").trim(),
    model: dev.model, serial: dev.serial, asset: dev.asset,
    item: s.item, qty: s.qty, status: s.status, warranty: s.warranty, counter: s.counter, expected: s.expected,
    source_table: ctx.sourceTable, source_id: ctx.sourceId == null ? "" : String(ctx.sourceId), raw: s.raw.slice(0, 2000),
    _dupKey: md5(supplyDupSource(ctx.sourceTable, ctx.date.slice(0, 10), String(ctx.author || "").trim(), ctx.vendor, s)),
  }));
}

/** 전송 직후 — 실패해도 전송은 막지 않는다(표가 없으면 조용히) */
export async function saveSupplyRequests(ctx: SupplyContext): Promise<number> {
  let n = 0;
  for (const row of rowsFor(ctx)) {
    try { if ((await insertRow("supply_requests", row)) === "new") n += 1; } catch { /* 표 없음·권한 — 다음 기회(채우기)에 */ }
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
  let read = 0, inserted = 0, skipped = 0;
  for (const table of ["jeomgeom", "as_records"] as const) {
    const rows = await selectRows<RecRow>(table, `select=id,${col("작성일")},${col("작성자")},${col("_업체명")},${col("지역")},${col("_원문")}&${col("작성일")}=gte.${from}&${col("작성일")}=lt.${to}&${filter}&_hidden=not.is.true&order=id.asc&limit=1000`);
    for (const r of rows) {
      read += 1;
      const text = String(r._원문 || "");
      if (!KOR_CONT.test(text)) continue;
      const list = rowsFor({ sourceTable: table, sourceId: r.id, date: String(r.작성일 || "").slice(0, 10), author: String(r.작성자 || ""), team: String(r.지역 || ""), vendor: String(r._업체명 || ""), text });
      for (const row of list) {
        try { const res = await insertRow("supply_requests", row); if (res === "new") inserted += 1; else skipped += 1; } catch (e) { throw new Error(`${table} #${r.id}: ${(e as Error).message}`); }
      }
    }
  }
  return { read, inserted, skipped };
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
