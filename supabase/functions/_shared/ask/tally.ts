/**
 * 통합검색 "무엇이든 묻기" — tally 도구(T3): 행 대신 묶음별 건수 (2026-10-29, 설계 5-3 T3·4장 5)
 *
 * 모델이 300행을 받아 세면 틀리고 비싸다 → 서버가 1,000행씩 최대 20,000행을 넘겨 읽어 묶음별로 센다.
 *  - group_by: 표 칸(최대 3개) + 가상 칸 `_author_team`(작성자 칸 → cs_members 명단 팀, KPI 와 같은 기준 — jeomgeom.지역은 대부분 'A')
 *  - date_bucket: day / week(그 주 월요일) / month — 표의 날짜 칸으로. ISO 시각(…T…Z)은 KST 로 바꿔 자른다
 *  - distinct: 묶음마다 서로 다른 값 수(true 면 업체 칸 = 업체 중복 제거 수)
 * tallyRows 는 순수(tests/askTally.test.ts), runTally 는 rest 로 읽어 tallyRows 에 넘긴다.
 */
import { CATALOG, pkOf, type Cat } from "./catalog.ts";
import { buildFilterParts, colSql, type AskRest } from "./rest.ts";
import { ymdOf } from "./tool-util.ts";

export const AUTHOR_TEAM = "_author_team";
export type DateBucket = "day" | "week" | "month";
export type TallyGroup = { key: Record<string, string>; count: number; distinct?: number };
export type TallyResult = { total: number; distinct_total?: number; groups: TallyGroup[]; other?: { groups: number; count: number } };

const EMPTY = "(빈칸)";

/** 날짜 글 → KST 'YYYY-MM-DD' — tool-util.ymdOf 와 같은 규칙(섞인 형식·ISO 시각 KST) */
export const kstDay = (value: unknown): string => ymdOf(value);

const DATE_OPS: Record<string, (d: string, v: string) => boolean> = { eq: (d, v) => d === v, gte: (d, v) => d >= v, gt: (d, v) => d > v, lte: (d, v) => d <= v, lt: (d, v) => d < v };
export type DateCond = { op: string; value: string };
/** 형식 섞인 글자 날짜 칸(cat.dateText)의 날짜 조건 — 서버 글자 비교('2026.1.7' > '2026-09-14') 대신 읽은 뒤 날짜로 거른다 */
export function splitDateFilters(cat: Cat, filters: unknown): { rest: unknown[]; dateConds: DateCond[] } {
  const list = Array.isArray(filters) ? filters as Array<Record<string, unknown>> : [];
  if (!cat.dateText || !cat.date) return { rest: list, dateConds: [] };
  const dateConds: DateCond[] = []; const rest: unknown[] = [];
  for (const f of list) {
    const op = String(f?.op || "eq"); const v = ymdOf(f?.value);
    if (String(f?.col || "") === cat.date && DATE_OPS[op] && v) dateConds.push({ op, value: v }); else rest.push(f);
  }
  return { rest, dateConds };
}
export const passDateConds = (value: unknown, conds: DateCond[]) => { if (!conds.length) return true; const d = ymdOf(value); return !!d && conds.every((c) => DATE_OPS[c.op](d, c.value)); };

/** 날짜 묶음 이름 — week 는 그 주 월요일 */
export function bucketDate(value: unknown, bucket: DateBucket): string {
  const d = kstDay(value);
  if (!d) return EMPTY;
  if (bucket === "month") return d.slice(0, 7);
  if (bucket === "week") {
    const t = Date.parse(`${d}T00:00:00Z`);
    const dow = (new Date(t).getUTCDay() + 6) % 7;   // 월=0
    return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
  }
  return d;
}

/** 순수 집계 */
export function tallyRows(rows: Array<Record<string, unknown>>, opts: {
  groupBy: string[]; distinctCol?: string; dateCol?: string; bucket?: DateBucket | ""; authorCol?: string;
  teamOf?: (name: string) => string; maxGroups?: number;
}): TallyResult {
  const groupBy = opts.groupBy.slice(0, 3);
  const map = new Map<string, { key: Record<string, string>; count: number; set?: Set<string> }>();
  const allDistinct = opts.distinctCol ? new Set<string>() : undefined;
  for (const r of rows) {
    const key: Record<string, string> = {};
    for (const g of groupBy) {
      if (g === AUTHOR_TEAM) {
        const who = String(r[opts.authorCol || ""] ?? "").trim();
        key[g] = (who && opts.teamOf?.(who)) || "(명단 밖)";
      } else key[g] = String(r[g] ?? "").trim() || EMPTY;
    }
    if (opts.bucket && opts.dateCol) key[`${opts.dateCol}:${opts.bucket}`] = bucketDate(r[opts.dateCol], opts.bucket);
    const k = JSON.stringify(key);
    let hit = map.get(k);
    if (!hit) { hit = { key, count: 0, set: opts.distinctCol ? new Set() : undefined }; map.set(k, hit); }
    hit.count += 1;
    if (opts.distinctCol) {
      const v = String(r[opts.distinctCol] ?? "").trim();
      if (v) { hit.set!.add(v); allDistinct!.add(v); }
    }
  }
  const sorted = [...map.values()].sort((a, b) => b.count - a.count || JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)));
  const max = opts.maxGroups ?? 200;
  const groups = sorted.slice(0, max).map((g) => ({ key: g.key, count: g.count, ...(g.set ? { distinct: g.set.size } : {}) }));
  const rest = sorted.slice(max);
  return {
    total: rows.length,
    ...(allDistinct ? { distinct_total: allDistinct.size } : {}),
    groups,
    ...(rest.length ? { other: { groups: rest.length, count: rest.reduce((n, g) => n + g.count, 0) } } : {}),
  };
}

export type TallyArgs = { table?: unknown; filters?: unknown; group_by?: unknown; distinct?: unknown; date_bucket?: unknown };

/** 인자 검사 + 읽을 칸 정하기(순수) */
export function planTally(args: TallyArgs): { error: string } | { table: string; cat: Cat; groupBy: string[]; distinctCol?: string; bucket: DateBucket | ""; select: string[]; filterParts: string[]; dateConds: DateCond[] } {
  const table = String(args.table || "");
  const cat = CATALOG[table];
  if (!cat) return { error: `허용되지 않은 표: ${table}` };
  const groupBy = (Array.isArray(args.group_by) ? args.group_by : []).map(String).filter(Boolean).slice(0, 3);
  for (const g of groupBy) {
    if (g === AUTHOR_TEAM) { if (!cat.author) return { error: `${table} 에는 작성자 칸이 없어 ${AUTHOR_TEAM} 로 묶을 수 없습니다` }; continue; }
    if (!cat.cols.includes(g)) return { error: `묶을 수 없는 칸: ${g} (표 ${table} 의 칸: ${cat.cols.join(", ")})` };
  }
  const distinctCol = args.distinct === true || args.distinct === "true" ? (cat.vendor || undefined)
    : typeof args.distinct === "string" && args.distinct ? (cat.cols.includes(args.distinct) ? args.distinct : "") : undefined;
  if (distinctCol === "") return { error: `distinct 칸이 표에 없습니다: ${String(args.distinct)}` };
  const b = String(args.date_bucket || "");
  const bucket: DateBucket | "" = b === "day" || b === "week" || b === "month" ? b : "";
  if (bucket && !cat.date) return { error: `${table} 에는 날짜 칸이 없어 date_bucket 을 쓸 수 없습니다` };
  const split = splitDateFilters(cat, args.filters);
  const f = buildFilterParts(table, cat, split.rest);
  if ("error" in f) return f;
  const select = new Set<string>(groupBy.filter((g) => g !== AUTHOR_TEAM));
  if (groupBy.includes(AUTHOR_TEAM) && cat.author) select.add(cat.author);
  if (distinctCol) select.add(distinctCol);
  if ((bucket || split.dateConds.length) && cat.date) select.add(cat.date);
  if (cat.scope === "author" && cat.author) select.add(cat.author);
  if (cat.scope === "team") select.add(cat.team || "team");
  if (!select.size) select.add(pkOf(cat));
  return { table, cat, groupBy, distinctCol, bucket, select: [...select], filterParts: f.parts, dateConds: split.dateConds };
}

/** 읽어서 센다. rowAllowed 는 Q1 범위(scope 표) 거름 */
export async function runTally(args: TallyArgs, deps: { rest: AskRest; teamOf: (name: string) => string; rowAllowed?: (cat: Cat, row: Record<string, unknown>) => boolean }): Promise<Record<string, unknown>> {
  const plan = planTally(args);
  if ("error" in plan) return plan;
  const { table, cat } = plan;
  const query = [`select=${encodeURIComponent(plan.select.map(colSql).join(","))}`, ...plan.filterParts, ...(cat.hidden ? [cat.hidden] : [])].join("&");
  try {
    const { rows, truncated } = await deps.rest.getAll<Record<string, unknown>>(table, query, { orderBy: pkOf(cat) });
    const dated = plan.dateConds.length ? rows.filter((r) => passDateConds(r[cat.date || ""], plan.dateConds)) : rows;
    const allowed = deps.rowAllowed ? dated.filter((r) => deps.rowAllowed!(cat, r)) : dated;
    const result = tallyRows(allowed, { groupBy: plan.groupBy, distinctCol: plan.distinctCol, dateCol: cat.date, bucket: plan.bucket, authorCol: cat.author, teamOf: deps.teamOf });
    return {
      table, ...result, read: rows.length, truncated,
      ...(plan.dateConds.length ? { date_filtered_out: rows.length - dated.length } : {}),
      ...(truncated ? { note: "20,000행에서 멈춰 실제보다 적을 수 있습니다 — 기간·조건을 좁혀 다시 세세요" } : {}),
      ...(allowed.length < dated.length ? { hidden_by_scope: dated.length - allowed.length } : {}),
    };
  } catch (e) { return { error: String((e as Error).message) }; }
}

/** 날짜 조건들 → 서버 넉넉한 거름(textDateLoose)에 줄 범위. 아래·위가 없으면 끝없이 */
export function dateCondRange(conds: DateCond[]): { from: string; to: string } {
  const lo = conds.filter((c) => c.op === "gte" || c.op === "gt" || c.op === "eq").map((c) => c.value).sort();
  const hi = conds.filter((c) => c.op === "lte" || c.op === "lt" || c.op === "eq").map((c) => c.value).sort();
  return { from: lo[lo.length - 1] || "1900-01-01", to: hi[0] || "9999-12-31" };
}

/**
 * 순수 — 형식 섞인 글자 날짜 칸(cat.dateText) 행 고르기: 날짜 조건 거르기 → ymdOf 날짜로 정렬(못 읽는 행은 맨 뒤) → limit.
 * 서버 order=<날짜>.desc 는 글자 정렬이라 '마장역 …' 같은 쓰레기 행·'Fri Mar …'·'2026.9.8' 이 맨 앞에 온다(2026-10-29 misu 실측).
 * rows 는 id 오름차순으로 들어온다고 보고, 같은 날이면 desc 는 나중 id 먼저.
 */
export function pickDateTextRows<T extends Record<string, unknown>>(rows: T[], dateCol: string, conds: DateCond[], dir: "asc" | "desc", limit: number): { rows: T[]; total: number } {
  const kept = rows.map((r, i) => ({ r, i, d: ymdOf(r[dateCol]) })).filter((x) => passDateConds(x.r[dateCol], conds));
  kept.sort((a, b) => {
    if (!a.d !== !b.d) return a.d ? -1 : 1;
    if (a.d !== b.d) return (a.d < b.d ? -1 : 1) * (dir === "desc" ? -1 : 1);
    return dir === "desc" ? b.i - a.i : a.i - b.i;
  });
  return { rows: kept.slice(0, Math.max(0, limit)).map((x) => x.r), total: kept.length };
}
