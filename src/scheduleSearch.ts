/**
 * 일정 검색 순수 함수 (2026-10-25)
 *  - 일정리스트 탭 검색칸: 업체·제목·주소·내용·담당자 중 하나라도 검색어를 품으면 남긴다(2자 미만이면 거르지 않음).
 *  - 캘린더 검색: 화면이 이미 받은 일정(최근 6개월 + 열어 본 달) + 서버 검색(최근 2년)을 합쳐 날짜 내림차순, 같은 일정은 한 번만.
 */

export const SCHEDULE_SEARCH_MIN = 2;

/** 검색어 정리 — 앞뒤 공백 제거·소문자. 2자 미만이면 "" (= 거르지 않음) */
export function normalizeScheduleQuery(raw: string): string {
  const q = (raw || "").trim().toLowerCase();
  return q.length >= SCHEDULE_SEARCH_MIN ? q : "";
}

/** 필드 중 하나라도 검색어를 포함하면 true. 검색어가 비면(2자 미만) 늘 true */
export function scheduleQueryHit(fields: ReadonlyArray<string | null | undefined>, rawQuery: string): boolean {
  const q = normalizeScheduleQuery(rawQuery);
  if (!q) return true;
  return fields.some((v) => String(v || "").toLowerCase().includes(q));
}

/** 일정리스트 행(웹앱 일정) 검색 대상 — 업체·일정 제목·주소·내용·담당자 */
export function ticketSearchFields(t: { vendor?: string; calendarTitle?: string; address?: string; issue?: string; assignee?: string }): Array<string | undefined> {
  return [t.vendor, t.calendarTitle, t.address, t.issue, t.assignee];
}

export type CalSearchHit = { kind: "ticket" | "naver"; id: string; date: string; title: string; key: string };

/** 메모리 결과 + 서버 결과 합치기 — key 로 중복 제거(메모리 쪽이 먼저 = 최신 편집 반영), 날짜 내림차순, limit 개까지 */
export function mergeCalSearchHits(memory: CalSearchHit[], server: CalSearchHit[], limit = 50): CalSearchHit[] {
  const seen = new Set<string>();
  const out: CalSearchHit[] = [];
  for (const hit of [...memory, ...server]) {
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    out.push(hit);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

/**
 * PostgREST or=(...ilike...) 안에 넣을 검색어 — 쉼표·괄호·따옴표·별표·백슬래시는 필터 문법을 깨므로 공백으로 바꾼다.
 * 결과는 encodeURIComponent 까지 한 값. 정리 뒤 2자 미만이면 "".
 */
export function ilikeNeedle(raw: string): string {
  const cleaned = (raw || "").replace(/[,()"*\\%:]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length >= SCHEDULE_SEARCH_MIN ? encodeURIComponent(cleaned) : "";
}

/** ymd 기준 2년 전 같은 날(2월 29일은 28일로) */
export function twoYearsBefore(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = m === 2 && d === 29 ? 28 : d;
  return `${y - 2}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 시간 제한 — 응답이 ms 안에 안 오면 message 로 실패(조회 래퍼에 제한이 없어 검색이 무한 대기하지 않게) */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); });
  });
}
