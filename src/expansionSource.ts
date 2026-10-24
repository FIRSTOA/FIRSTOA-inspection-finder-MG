/**
 * 확장성(PC·복합기)·점검·AS·양식(물류·재계약·불만·초과조정·미수) 건수 원본 로더 — 조회 탭·주간현황판 [팀 현황]·[순위표]가 같이 쓴다(2026-10-22, 양식 2026-10-24).
 * 원본은 pc_expansion / mfp_expansion(시트 미러, 시트 직입력 포함). 세는 규칙은 workCount.ts countExpansion 한 곳.
 */
import { selectAllRowsFast } from "./supabase";
import { getActivityEvents, teamForAuthor, type ActivityEvent } from "./operations";
import {
  EXPANSION_SOURCES, FIELD_COLUMNS, FIELD_SOURCES, kstTextRange, mergeExpansionIntoEvents, mergeFieldIntoEvents, toExpansionRows, toFieldRows,
  type ExpansionRaw, type ExpansionRow, type ExpansionTable, type FieldRaw, type FieldRow, type FieldTable,
} from "./workCount";
import {
  FORM_SOURCES, mergeFormsIntoEvents, misuFormRows, toFormTableRows, withFieldLogistics,
  type FormRaw, type FormSet, type FormTable,
} from "./formCount";
import { isTableMissingError, loadMisuVisits } from "./misuVisitHistoryData";

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

/** KST 날짜 0시 = 전날 15:00 UTC(timestamptz 비교용) */
const kstStartIso = (ymd: string, backDays = 0) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1 - backDays);
  return `${d.toISOString().slice(0, 10)}T15:00:00Z`;
};

/**
 * 양식 표(물류·재계약·불만·초과조정) 한 표의 기간 안 행(오발송 삭제 제외) — 세는 규칙은 formCount.ts countForms 한 곳(2026-10-24).
 * 물류는 작성일(date) 칸으로 자른다. 재계약·불만·초과조정의 날짜 칸은 글자('26-07-13'·'6월 19일'·UTC 시각)가 섞여 서버에서 못 자른다
 *   → created_at 으로 넉넉히(14일 앞까지) 받고 KST 날짜(looseYmd → 없으면 created_at)는 countForms 가 거른다.
 *   (불만 시트 미러 행은 밤마다 created_at 이 새로 찍혀 넓게 들어오지만 날짜 칸으로 다시 거르므로 숫자는 같다)
 */
export async function loadFormRaw(table: FormTable, from?: string, to?: string): Promise<FormRaw[]> {
  const src = FORM_SOURCES[table];
  const parts = [`select=${src.columns.map(enc).join(",")}`, "_hidden=not.is.true"];
  if (table === "logistics_records") {
    if (from) parts.push(`${encodeURIComponent(src.dateField)}=gte.${from}`);
    if (to) parts.push(`${encodeURIComponent(src.dateField)}=lte.${to}`);
  } else if (from) {
    parts.push(`created_at=gte.${kstStartIso(from, 14)}`);
  }
  parts.push("order=id.asc");
  return selectAllRowsFast<FormRaw>(table, parts.join("&"));
}

/**
 * 양식 건수 원본 로더 — 팀 현황·순위표가 같이 쓴다(홈 KPI 는 kpiData 가 같은 변환으로 따로 읽는다).
 * 미수 방문 표(misu_visits)가 아직 없으면 미수만 비워 둔다(그 종류는 활동 기록 그대로) — 다른 오류는 그대로 던진다.
 * 물류의 점검·AS 양식 여분·마감·세팅은 loadWorkEvents 가 점검·AS 행으로 붙인다(withFieldLogistics).
 */
export async function loadFormRows(from?: string, to?: string): Promise<FormSet> {
  const tables = Object.keys(FORM_SOURCES) as FormTable[];
  const [lists, misu] = await Promise.all([
    Promise.all(tables.map((t) => loadFormRaw(t, from, to).then((raws) => [FORM_SOURCES[t].kind, toFormTableRows(t, raws, teamForAuthor)] as const))),
    loadMisuVisits({ from: from || "", to: to || "" }).then((v) => misuFormRows(v, teamForAuthor), (e: unknown) => {
      if (isTableMissingError(e)) return undefined;
      throw e;
    }),
  ]);
  const out: FormSet = Object.fromEntries(lists);
  if (misu) out.misu = misu;
  return out;
}

/** 팀 현황·순위표 입구: 활동 기록 + 확장성·점검·AS·양식(물류·재계약·불만·초과조정·미수)은 표 원본으로 교체 — 활동 기록은 담당자 변경·교체양식만 센다 */
export async function loadWorkEvents(start: string, end: string): Promise<ActivityEvent[]> {
  const [events, expansion, field, forms] = await Promise.all([getActivityEvents(start, end), loadExpansionRows(start, end), loadFieldRows(start, end), loadFormRows(start, end)]);
  return mergeFormsIntoEvents(mergeFieldIntoEvents(mergeExpansionIntoEvents(events, expansion), field), withFieldLogistics(forms, field));
}
