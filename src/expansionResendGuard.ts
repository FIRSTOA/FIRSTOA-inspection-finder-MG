/**
 * 확장성(PC·복합기) 보낼 때 중복 막기(2026-10-22, 사용자 "중복만 안 되면 된다").
 * 같은 작성자·같은 KST 날짜·같은 업체(vendorMatchKey)로 이미 보낸 행이 pc_expansion/mfp_expansion 에 있으면
 * 보내기 전에 확인창. 조회가 실패하면 막지 않고 그냥 보낸다(전송이 먼저).
 * 집계는 어차피 같은 날 같은 업체를 1건으로 세지만(workCount countExpansion), 방에 두 번 올라가고 표에 두 줄 남는 것을 줄인다.
 */
import { askConfirm } from "./confirmModal";
import { selectRows } from "./supabase";
import { EXPANSION_SOURCES, kstDayOf, kstTextRange, vendorKeyOf, type ExpansionRaw, type ExpansionTable } from "./workCount";

const enc = (name: string) => encodeURIComponent(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : `"${name}"`);

/** 이미 보낸 행 중 같은 작성자·같은 KST 날짜·같은 업체인 첫 행(삭제 제외). 없으면 null */
export function findSameDaySend(table: ExpansionTable, rows: ExpansionRaw[], author: string, vendor: string, day: string): ExpansionRaw | null {
  const src = EXPANSION_SOURCES[table];
  const key = vendorKeyOf(vendor);
  if (!key || !author.trim()) return null;
  return rows.find((r) => r._hidden !== true
    && String(r[src.authorField] ?? "").trim() === author.trim()
    && kstDayOf(String(r[src.dateField] ?? "")) === day
    && src.vendorFields.some((f) => vendorKeyOf(String(r[f] ?? "")) === key)) || null;
}

/** 시각 글자(UTC 시각이면 KST HH:MM, 날짜만이면 "오늘") */
export function sentAtLabel(value: string): string {
  const s = String(value || "");
  if (!/T\d{2}:/.test(s)) return "시각 미상";
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(11, 16) : "시각 미상";
}

/** true = 보낸다, false = 사용자가 취소 */
export async function confirmExpansionResend(table: ExpansionTable, author: string, vendor: string, ts?: string): Promise<boolean> {
  const src = EXPANSION_SOURCES[table];
  const day = kstDayOf(ts || new Date().toISOString());
  let hit: ExpansionRaw | null = null;
  try {
    const kst = kstTextRange(day, day);
    const cols = ["id", "_hidden", "created_at", src.dateField, src.authorField, ...src.vendorFields];
    const rows = await selectRows<ExpansionRaw>(table, [
      `select=${cols.map(enc).join(",")}`, "_hidden=not.is.true",
      `${encodeURIComponent(src.authorField)}=eq.${encodeURIComponent(author.trim())}`,
      `${encodeURIComponent(src.dateField)}=gte.${kst.gte}`, `${encodeURIComponent(src.dateField)}=lt.${kst.lt}`, "limit=200",
    ].join("&"));
    hit = findSameDaySend(table, rows, author, vendor, day);
  } catch {
    return true; // 조회 실패는 막지 않는다 — 전송이 먼저(집계는 같은 날 같은 업체 1건으로 세므로 숫자는 안 틀어진다)
  }
  if (!hit) return true;
  const date = String(hit[src.dateField] ?? "");
  const at = /T\d{2}:/.test(date) ? sentAtLabel(date) : sentAtLabel(String(hit.created_at ?? ""));
  return askConfirm(`오늘 이미 보낸 업체입니다(${at}).\n다시 보내면 중복입니다 — 고친 내용이면 먼저 보낸 건을 조회 탭에서 오발송 삭제하세요.\n그래도 보낼까요?`);
}
