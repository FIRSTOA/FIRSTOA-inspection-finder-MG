/**
 * 확장성(PC·복합기) 건수 원본 로더 — 조회 탭·주간현황판 [팀 현황]·[순위표]가 같이 쓴다(2026-10-22).
 * 원본은 pc_expansion / mfp_expansion(시트 미러, 시트 직입력 포함). 세는 규칙은 workCount.ts countExpansion 한 곳.
 */
import { selectAllRowsFast } from "./supabase";
import { getActivityEvents, teamForAuthor, type ActivityEvent } from "./operations";
import {
  EXPANSION_SOURCES, FIELD_COLUMNS, FIELD_SOURCES, kstTextRange, mergeExpansionIntoEvents, mergeFieldIntoEvents, toExpansionRows, toFieldRows,
  type ExpansionRaw, type ExpansionRow, type ExpansionTable, type FieldRaw, type FieldRow, type FieldTable,
} from "./workCount";

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

/** 점검(jeomgeom)·AS(as_records) 한 표의 기간 안 행(오발송 삭제 제외). 작성일은 'YYYY-MM-DD' 글자(KST) — 2026-10-22 실측 비정형 3행뿐 */
export async function loadFieldRaw(table: FieldTable, from?: string, to?: string): Promise<FieldRaw[]> {
  const parts = [`select=${FIELD_COLUMNS.map(enc).join(",")}`, "_hidden=not.is.true"];
  if (from) parts.push(`${encodeURIComponent("작성일")}=gte.${from}`);
  if (to) parts.push(`${encodeURIComponent("작성일")}=lte.${to}`);
  parts.push("order=id.asc");
  return selectAllRowsFast<FieldRaw>(table, parts.join("&"));
}

/** 점검·AS 수 원본 로더 — 홈·조회 탭·팀 현황·순위표가 같이 쓴다. 세는 규칙은 workCount.ts countField 한 곳 */
export async function loadFieldRows(from?: string, to?: string): Promise<FieldRow[]> {
  const tables = Object.keys(FIELD_SOURCES) as FieldTable[];
  const lists = await Promise.all(tables.map((t) => loadFieldRaw(t, from, to).then((raws) => toFieldRows(t, raws, teamForAuthor))));
  return lists.flat();
}

/** 팀 현황·순위표 입구: 활동 기록 + 확장성·점검·AS 는 표 원본으로 교체 */
export async function loadWorkEvents(start: string, end: string): Promise<ActivityEvent[]> {
  const [events, expansion, field] = await Promise.all([getActivityEvents(start, end), loadExpansionRows(start, end), loadFieldRows(start, end)]);
  return mergeFieldIntoEvents(mergeExpansionIntoEvents(events, expansion), field);
}
