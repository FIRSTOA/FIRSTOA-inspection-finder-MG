/**
 * 확장성(PC·복합기) 건수 원본 로더 — 조회 탭·주간현황판 [팀 현황]·[순위표]가 같이 쓴다(2026-10-22).
 * 원본은 pc_expansion / mfp_expansion(시트 미러, 시트 직입력 포함). 세는 규칙은 workCount.ts countExpansion 한 곳.
 */
import { selectAllRowsFast } from "./supabase";
import { getActivityEvents, teamForAuthor, type ActivityEvent } from "./operations";
import { EXPANSION_SOURCES, kstTextRange, mergeExpansionIntoEvents, toExpansionRows, type ExpansionRaw, type ExpansionRow, type ExpansionTable } from "./workCount";

const enc = (name: string) => encodeURIComponent(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : `"${name}"`);

/** 한 표의 기간 안 행(오발송 삭제 제외). from/to 는 KST 날짜, 없으면 전체 */
export async function loadExpansionRaw(table: ExpansionTable, from?: string, to?: string): Promise<ExpansionRaw[]> {
  const src = EXPANSION_SOURCES[table];
  const cols = ["id", "_hidden", src.dateField, src.authorField, ...src.vendorFields, ...(src.regionField ? [src.regionField] : [])];
  const parts = [`select=${cols.map(enc).join(",")}`, "_hidden=not.is.true"];
  if (from && to) {
    const kst = kstTextRange(from, to);
    parts.push(`${encodeURIComponent(src.dateField)}=gte.${kst.gte}`, `${encodeURIComponent(src.dateField)}=lt.${kst.lt}`);
  }
  parts.push("order=id.asc");
  return selectAllRowsFast<ExpansionRaw>(table, parts.join("&"));
}

export async function loadExpansionRows(from?: string, to?: string): Promise<ExpansionRow[]> {
  const tables = Object.keys(EXPANSION_SOURCES) as ExpansionTable[];
  const lists = await Promise.all(tables.map((t) => loadExpansionRaw(t, from, to).then((raws) => toExpansionRows(t, raws, teamForAuthor))));
  return lists.flat();
}

/** 팀 현황·순위표 입구: 활동 기록 + 확장성은 표 원본으로 교체 */
export async function loadWorkEvents(start: string, end: string): Promise<ActivityEvent[]> {
  const [events, expansion] = await Promise.all([getActivityEvents(start, end), loadExpansionRows(start, end)]);
  return mergeExpansionIntoEvents(events, expansion);
}
