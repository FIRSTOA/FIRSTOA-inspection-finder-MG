/**
 * 업무 건수 세는 규칙 한 곳(2026-10-22) — 주간현황판 [팀 현황]·[순위표]와 조회 탭이 같은 규칙을 쓴다.
 *
 * 왜: "한왕주 PC확장성 전체 18인데 거래처 16" — 팀 현황은 activity_events 를 그대로 세고(재전송 2건 포함),
 * 순위표만 재전송을 한 건으로 묶고 있었다(2026-10-17 dedupeForRanking). 같은 판의 두 탭이 다른 숫자를 냈다.
 *
 * 규칙(재전송·연타 = 1건)
 *  · 확장성(IT·복합기): 같은 사람·같은 날(KST)·같은 거래처는 1건 — 사양을 채워 한 번 더 보낸 것
 *  · 그 밖: 같은 사람·같은 종류·같은 거래처를 10분 안에 다시 보낸 것은 1건(점검 대수는 큰 값)
 * 거래처 수는 vendorMatchKey(표기 변형 묶음)로 센 서로 다른 거래처 수 — 건수와 뜻이 다르다.
 */
import { vendorMatchKey } from "./ids";
import type { ActivityEvent } from "./operations";

export const EXPANSION_KINDS = new Set<string>(["expansion_it", "expansion_copier"]);
const RESEND_WINDOW_MS = 10 * 60_000;

export function vendorKeyOf(vendor: string): string {
  return vendorMatchKey(vendor || "") || String(vendor || "").trim();
}

export function dedupeResends(evs: ActivityEvent[]): ActivityEvent[] {
  const sorted = [...evs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: ActivityEvent[] = [];
  const lastAt = new Map<string, { at: number; idx: number }>();
  const dayKeys = new Set<string>();
  for (const e of sorted) {
    // 점검·AS 는 표 원본에서 이미 기기 단위로 묶어 넣었다(mergeFieldIntoEvents) — 거래처 10분 묶음을 다시 걸면 다른 기기가 합쳐진다
    if (e.metadata?.counted === true) { out.push(e); continue; }
    const v = vendorKeyOf(e.vendor);
    if (!v) { out.push(e); continue; }
    if (EXPANSION_KINDS.has(e.category)) {
      const k = `${e.author}|${e.category}|${v}|${e.activityDate}`;
      if (dayKeys.has(k)) continue;
      dayKeys.add(k); out.push(e); continue;
    }
    const k = `${e.author}|${e.category}|${v}`;
    const at = new Date(e.createdAt).getTime();
    const prev = lastAt.get(k);
    if (prev && at - prev.at <= RESEND_WINDOW_MS) {
      const kept = out[prev.idx];
      if ((e.machineCount || 0) > (kept.machineCount || 0)) out[prev.idx] = { ...kept, machineCount: e.machineCount };
      lastAt.set(k, { at, idx: prev.idx });
      continue;
    }
    lastAt.set(k, { at, idx: out.length });
    out.push(e);
  }
  return out;
}

/** 집계 대상 = 취소(오발송) 아닌 것 → 재전송 묶음. 팀 현황·순위표가 같은 입구를 쓴다 */
export function countableEvents(evs: ActivityEvent[]): ActivityEvent[] {
  return dedupeResends(evs.filter((e) => e.status !== "cancelled"));
}

/** 서로 다른 거래처 수(표기 변형 묶음) */
export function distinctVendors(vendors: string[]): number {
  return new Set(vendors.map(vendorKeyOf).filter(Boolean)).size;
}

const shiftDay = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * 날짜 칸이 글자(text)인데 두 형식이 섞인 표(pc_expansion.날짜·mfp_expansion.등록일):
 *   웹앱 행 '2026-10-21'(KST 날짜) / 시트 미러 행 '2026-10-20T09:02:41+00:00'(UTC 시각).
 * KST 하루 [start, end] 를 글자 비교로 정확히 자르려면 앞 경계 = 전날 15:00(UTC), 뒤 경계 = 끝날 15:00 미만.
 *   · '2026-09-30'(9/30 KST)        < '2026-09-30T15:00:00' → 빠짐
 *   · '2026-09-30T16:00:00+00:00'(10/1 01시 KST) ≥ 앞 경계 → 들어감
 *   · '2026-10-31'                  < '2026-10-31T15:00:00' → 들어감
 *   · '2026-10-31T15:30:00+00:00'(11/1 KST) → 빠짐
 * (date·timestamptz 형식 칸에는 쓰지 않는다 — date 로 바뀌면 앞 경계가 전날을 포함한다)
 */
export const UTC_TEXT_DATE_TABLES = new Set<string>(["pc_expansion", "mfp_expansion"]);
export function kstTextRange(start: string, end: string): { gte: string; lt: string } {
  return { gte: `${shiftDay(start, -1)}T15:00:00`, lt: `${end}T15:00:00` };
}
export function inKstTextRange(value: string, range: { gte: string; lt: string }): boolean {
  return value >= range.gte && value < range.lt;
}
/** 위 두 형식 어느 쪽이든 KST 날짜(YYYY-MM-DD)로 */
export function kstDayOf(value: string): string {
  const s = String(value || "").trim();
  if (!/T\d{2}:/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(0, 10) : s.slice(0, 10);
}

/* ───────────── 확장성(PC·복합기) 건수 — 원본 하나·함수 하나(2026-10-22) ─────────────
 * 왜: "조회 탭 PC확장성 C팀 이번달 48개인데 주간현황 팀현황엔 45" — 조회 탭은 pc_expansion 행 수(재전송·팀장 포함),
 *     팀 현황·순위표는 activity_events(FIELD 전송 때만 생김 — 시트에 직접 적은 행이 없다)를 재전송 묶음·팀장 제외로 셌다.
 * 원본: pc_expansion / mfp_expansion(시트 미러 = 시트 직입력까지 포함하는 가장 완전한 장부). activity_events 는 확장성 집계에 쓰지 않는다.
 * 규칙(이 함수 하나를 조회 탭·팀 현황·순위표가 같이 쓴다)
 *   · 오발송 삭제(_hidden) 행 제외
 *   · 팀장(명단 팀 '팀장') 기록 제외 — 팀 현황·순위표가 원래 쓰던 규칙
 *   · 같은 종류·같은 작성자·같은 KST 날짜·같은 거래처(vendorMatchKey) = 1건
 *   · 팀 = 지역 칸(PC만, 'C'·'수도권 C'·'c'·'Ｃ'·'D(성남)'·'CSS'→E) → 비었거나 못 읽으면 작성자 명단 팀
 *     (복합기 '미팅지역'은 주소라 팀이 아니다 → 작성자 팀)
 *   · 날짜 칸 'YYYY-MM-DD'(웹앱)·UTC 시각 글자(시트 미러)가 섞여 있어 kstDayOf 로 KST 날짜
 */
export type ExpansionKind = "expansion_it" | "expansion_copier";
export type ExpansionTable = "pc_expansion" | "mfp_expansion";
export const EXPANSION_SOURCES: Record<ExpansionTable, { kind: ExpansionKind; label: string; dateField: string; authorField: string; regionField: string; vendorFields: string[] }> = {
  pc_expansion: { kind: "expansion_it", label: "PC확장성", dateField: "날짜", authorField: "작성자", regionField: "지역", vendorFields: ["_업체명"] },
  mfp_expansion: { kind: "expansion_copier", label: "복합기확장성", dateField: "등록일", authorField: "등록자", regionField: "", vendorFields: ["_업체명", "상호"] },
};
export const EXPANSION_BASIS_TEXT = "같은 날 같은 업체 재전송은 1건 · 오발송 삭제·팀장 기록 제외";

/** 표에서 읽은 한 행(필요한 칸만) */
export type ExpansionRaw = Record<string, unknown> & { id?: unknown; _hidden?: unknown };
/** 집계용으로 정리한 한 행 */
export type ExpansionRow = {
  table: ExpansionTable; kind: ExpansionKind; id: string;
  at: string;      // 날짜 칸 원문(정렬용)
  day: string;     // KST 날짜
  author: string; vendor: string;
  team: string;    // A~E·팀장·미지정 …
  manager: boolean; hidden: boolean;
};

/** 지역 칸 → 팀 글자(A~E). 못 읽으면 "" */
export function regionTeam(value: unknown): string {
  const s = String(value ?? "").normalize("NFKC").toUpperCase().replace(/\s+/g, "").replace(/^(수도권|지역)/, "");
  if (/^CSS/.test(s) || /^지방/.test(s)) return "E";
  return s.match(/^([ABCDE])(?![A-Z])/)?.[1] || "";
}

export function toExpansionRows(table: ExpansionTable, raws: ExpansionRaw[], teamOfAuthor: (author: string) => string): ExpansionRow[] {
  const src = EXPANSION_SOURCES[table];
  return raws.map((r) => {
    const at = String(r[src.dateField] ?? "").trim();
    const author = String(r[src.authorField] ?? "").trim();
    const authorTeam = teamOfAuthor(author);
    const vendor = src.vendorFields.map((f) => String(r[f] ?? "").trim()).find(Boolean) || "";
    return {
      table, kind: src.kind, id: String(r.id ?? ""), at, day: kstDayOf(at), author, vendor,
      team: (src.regionField && regionTeam(r[src.regionField])) || authorTeam,
      manager: authorTeam === "팀장", hidden: r._hidden === true,
    };
  });
}

export type ExpansionScope = { team?: string; author?: string; from?: string; to?: string; kind?: ExpansionKind };

/** 범위 안 행(삭제 제외, 팀장 포함) — 목록 행 수와 견줄 때 쓴다 */
function scoped(rows: ExpansionRow[], s: ExpansionScope): ExpansionRow[] {
  return rows.filter((r) => !r.hidden
    && (!s.kind || r.kind === s.kind)
    && (!s.team || s.team === "전체" || r.team === s.team)
    && (!s.author || r.author === s.author)
    && (!s.from || r.day >= s.from) && (!s.to || r.day <= s.to));
}

/** 세는 대상 행 — 삭제·팀장 제외 → (종류, 작성자, KST 날짜, 거래처) 1건 */
export function countableExpansion(rows: ExpansionRow[], s: ExpansionScope = {}): ExpansionRow[] {
  const seen = new Set<string>();
  const out: ExpansionRow[] = [];
  for (const r of [...scoped(rows, s)].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    if (r.manager) continue;
    const v = vendorKeyOf(r.vendor);
    if (v) {
      const k = `${r.kind}|${r.author}|${r.day}|${v}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(r);
  }
  return out;
}

/** 확장성 건수 — 조회 탭·팀 현황·순위표가 모두 이 값 */
export function countExpansion(rows: ExpansionRow[], s: ExpansionScope = {}): number {
  return countableExpansion(rows, s).length;
}

/** 화면 설명용: 범위 안 행 수와 빠진 이유별 수 */
export function expansionTally(rows: ExpansionRow[], s: ExpansionScope = {}): { count: number; rows: number; managers: number; resends: number } {
  const inScope = scoped(rows, s);
  const managers = inScope.filter((r) => r.manager).length;
  const count = countableExpansion(rows, s).length;
  return { count, rows: inScope.length, managers, resends: inScope.length - managers - count };
}

/** 활동 기록(점검·AS 등)에서 확장성만 표 원본으로 갈아 끼운다 — 팀 현황·순위표가 이 결과에 countableEvents 를 건다 */
export function mergeExpansionIntoEvents(events: ActivityEvent[], expansion: ExpansionRow[]): ActivityEvent[] {
  const fromTables: ActivityEvent[] = countableExpansion(expansion).map((r) => ({
    id: `${r.table}:${r.id}`, createdAt: r.at, activityDate: r.day, author: r.author, team: r.team,
    category: r.kind, vendor: r.vendor, quantity: 1, machineCount: 0, sourceText: "", metadata: { sourceTable: r.table },
    status: "active", cancelledAt: "", cancelledBy: "",
  }));
  return [...events.filter((e) => !EXPANSION_KINDS.has(e.category)), ...fromTables];
}

/* ───────────── 점검·AS 수 — 원본 하나·함수 하나(2026-10-22) ─────────────
 * 왜: "점검 수도 화면마다 세는 원본이 다르다" — 홈은 jeomgeom 행 수(양식 1장 = 1, 팀장 포함, 지역 칸),
 *     팀 현황·순위표는 activity_events(FIELD 전송 때만 생김, 기기 대수, 10분 재전송 묶음, 작성자 팀),
 *     조회 탭은 jeomgeom 행 수(지역·출처 괄호). 같은 C팀 10월이 화면마다 달랐다.
 * 원본: jeomgeom(점검) / as_records(AS) — FIELD 전송·카톡 가져오기 모두 들어가는 장부.
 *       '점검, AS' 양식은 두 표에 다 들어간다(10월 43장) → 점검·AS 각각 1번씩 센다.
 *       activity_events 는 점검·AS 집계에 더 쓰지 않는다(물류 등 다른 종류는 그대로).
 * 규칙(이 함수 하나를 홈·조회 탭·팀 현황·순위표가 같이 쓴다)
 *   · 오발송 삭제(_hidden) 행 제외 · 팀장(명단 팀 '팀장') 기록 제외
 *   · 기기 = 원문(_원문)의 기기 칸(모델명/시리얼넘버/자산기번 묶음) — 1행에 여러 대가 든다(양식 1장 = 1행)
 *     기기 열쇠 = 시리얼 → 없으면 자산기번 → 둘 다 없으면 "모델#순번"
 *   · 재전송 = 같은 종류·같은 작성자·같은 KST 날짜·같은 업체(vendorMatchKey)·같은 기기 — 거래처 단위가 아니라 기기 단위
 *     (거래처로 묶으면 같은 날 같은 업체의 다른 기기 양식이 1로 줄어든다)
 *   · 점검 = 대수(새 기기 1대 = 1) · AS = 건(양식 1장 = 1, 이미 센 기기만 다시 보낸 양식은 재전송)
 *   · 팀 = 지역 칸 → 출처 괄호('카톡:점검(C)') → 작성자 명단 팀
 */
export type FieldKind = "inspection" | "as";
export type FieldTable = "jeomgeom" | "as_records";
export const FIELD_SOURCES: Record<FieldTable, { kind: FieldKind; label: string; unit: string }> = {
  jeomgeom: { kind: "inspection", label: "점검", unit: "대" },
  as_records: { kind: "as", label: "AS", unit: "건" },
};
export const FIELD_TABLE_BY_KIND: Record<FieldKind, FieldTable> = { inspection: "jeomgeom", as: "as_records" };
/** 로더가 읽는 칸 — 원문은 기기 수를 세려고 필요하다 */
export const FIELD_COLUMNS = ["id", "_hidden", "작성일", "작성자", "지역", "_출처", "업체명", "_업체명", "모델명", "시리얼넘버", "자산기번", "_원문", "created_at", "구분"];
export const FIELD_BASIS_TEXT = "점검 = 기기 대수 · AS = 양식 건수 · 같은 날 같은 업체 같은 기기 재전송은 1 · 오발송 삭제·팀장 기록 제외 · 팀 = 지역 칸(없으면 작성자 팀)";

export type FieldRaw = Record<string, unknown> & { id?: unknown; _hidden?: unknown };
export type FieldRow = {
  table: FieldTable; kind: FieldKind; id: string;
  at: string;       // 정렬용(created_at → 작성일)
  day: string;      // KST 날짜
  author: string; vendor: string;
  team: string; manager: boolean; hidden: boolean;
  machines: string[]; // 기기 열쇠(양식 안 순서)
  /** 구분 칸 원문('점검, 여분') — 점검·AS 양식의 여분·마감·세팅을 물류로 셀 때 쓴다(formCount.fieldLogisticsRows, 2026-10-24) */
  reportTypes?: string;
};

/** 시리얼·자산기번 정규화 — 숫자가 하나도 없으면('-'·'없음'·'확인') 빈 값 */
function idKey(value: unknown): string {
  const v = String(value ?? "").normalize("NFKC").toUpperCase().replace(/[^0-9A-Z가-힣]/g, "");
  return /\d/.test(v) ? v : "";
}

/** 원문에서 기기 열쇠 목록. 기기 칸이 없으면 행의 시리얼/자산/모델 한 대 */
export function machineKeysOf(text: unknown, fallback: { model?: unknown; serial?: unknown; asset?: unknown } = {}): string[] {
  type M = { model: string; serial: string; asset: string; has: Set<string> };
  const blocks: M[] = [];
  let cur: M | null = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.trim().match(/^(모델명|시리얼넘버|자산기번)\s*[:：]\s*(.*)$/);
    if (!m) continue;
    const field = m[1];
    if (!cur || cur.has.has(field) || (field === "모델명" && cur.has.size > 0)) { cur = { model: "", serial: "", asset: "", has: new Set() }; blocks.push(cur); }
    cur.has.add(field);
    if (field === "모델명") cur.model = m[2].trim();
    else if (field === "시리얼넘버") cur.serial = m[2].trim();
    else cur.asset = m[2].trim();
  }
  if (!blocks.length) blocks.push({ model: String(fallback.model ?? ""), serial: String(fallback.serial ?? ""), asset: String(fallback.asset ?? ""), has: new Set() });
  return blocks.map((b, i) => idKey(b.serial) || idKey(b.asset) || `${String(b.model).normalize("NFKC").toUpperCase().replace(/\s+/g, "")}#${i + 1}`);
}

/** 출처 라벨 괄호의 팀 — '카톡:점검(C)' → C */
function sourceTeam(value: unknown): string {
  const inner = String(value ?? "").match(/\(([^)]*)\)/)?.[1] || "";
  return regionTeam(inner);
}

export function toFieldRows(table: FieldTable, raws: FieldRaw[], teamOfAuthor: (author: string) => string): FieldRow[] {
  const src = FIELD_SOURCES[table];
  return raws.map((r) => {
    const author = String(r["작성자"] ?? "").trim();
    const authorTeam = teamOfAuthor(author);
    const day = kstDayOf(String(r["작성일"] ?? ""));
    return {
      table, kind: src.kind, id: String(r.id ?? ""),
      at: String(r.created_at ?? "") || day, day, author,
      vendor: String(r["_업체명"] ?? "").trim() || String(r["업체명"] ?? "").trim(),
      team: regionTeam(r["지역"]) || sourceTeam(r["_출처"]) || authorTeam,
      manager: authorTeam === "팀장", hidden: r._hidden === true,
      machines: machineKeysOf(r["_원문"], { model: r["모델명"], serial: r["시리얼넘버"], asset: r["자산기번"] }),
      reportTypes: String(r["구분"] ?? ""),
    };
  });
}

export type FieldScope = { kind?: FieldKind; team?: string; author?: string; from?: string; to?: string };
const fieldScoped = (rows: FieldRow[], s: FieldScope) => rows.filter((r) => !r.hidden
  && (!s.kind || r.kind === s.kind)
  && (!s.team || s.team === "전체" || r.team === s.team)
  && (!s.author || r.author === s.author)
  && (!s.from || r.day >= s.from) && (!s.to || r.day <= s.to));

/** 세는 대상 — 행마다 몇을 셌는지(점검: 새 기기 대수, AS: 새 기기가 하나라도 있으면 1). 0 인 행(재전송)은 빠진다 */
export function countableField(rows: FieldRow[], s: FieldScope = {}): Array<{ row: FieldRow; units: number }> {
  const seen = new Set<string>();
  const out: Array<{ row: FieldRow; units: number }> = [];
  for (const r of [...fieldScoped(rows, s)].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id, undefined, { numeric: true }))) {
    if (r.manager) continue;
    const base = `${r.kind}|${r.author}|${r.day}|${vendorKeyOf(r.vendor)}`;
    const fresh = Array.from(new Set(r.machines)).filter((m) => !seen.has(`${base}|${m}`));
    fresh.forEach((m) => seen.add(`${base}|${m}`));
    const units = r.kind === "inspection" ? fresh.length : fresh.length ? 1 : 0;
    if (units) out.push({ row: r, units });
  }
  return out;
}

/** 점검 대수 / AS 건수 — kind 를 꼭 준다(둘을 더하면 단위가 섞인다) */
export function countField(rows: FieldRow[], s: FieldScope & { kind: FieldKind }): number {
  return countableField(rows, s).reduce((n, c) => n + c.units, 0);
}

/** 화면 설명용: 범위 안 양식 수·센 값·팀장 양식 수·재전송 양식 수 */
export function fieldTally(rows: FieldRow[], s: FieldScope & { kind: FieldKind }): { count: number; rows: number; managers: number; resends: number } {
  const inScope = fieldScoped(rows, s);
  const managers = inScope.filter((r) => r.manager).length;
  const counted = countableField(rows, s);
  return { count: counted.reduce((n, c) => n + c.units, 0), rows: inScope.length, managers, resends: inScope.length - managers - counted.length };
}

/** 활동 기록에서 점검·AS 를 표 원본으로 갈아 끼운다 — 센 단위 하나 = 활동 1개(기기 수 1), countableEvents 재묶음을 건너뛴다 */
export function mergeFieldIntoEvents(events: ActivityEvent[], field: FieldRow[]): ActivityEvent[] {
  const fromTables: ActivityEvent[] = countableField(field).flatMap(({ row, units }) => Array.from({ length: units }, (_, i) => ({
    id: `${row.table}:${row.id}:${i + 1}`, createdAt: row.at, activityDate: row.day, author: row.author, team: row.team,
    category: row.kind, vendor: row.vendor, quantity: 1, machineCount: 1, sourceText: "", metadata: { sourceTable: row.table, counted: true },
    status: "active" as const, cancelledAt: "", cancelledBy: "",
  })));
  return [...events.filter((e) => e.category !== "inspection" && e.category !== "as"), ...fromTables];
}
