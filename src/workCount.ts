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
