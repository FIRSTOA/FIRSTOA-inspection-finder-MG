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
