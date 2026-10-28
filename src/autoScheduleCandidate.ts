/**
 * 자동 일정 후보 — 표시 문구·좌표 검사·정렬 (순수 함수, AutoSchedule.tsx 가 쓴다).
 *
 * 2026-10-28 사용자 보고: 후보 카드가 "마지막 null · 9999일 경과", 지도 안 뜸 (연세플러스의원).
 * 실측: 그 업체는 워킨맵 3분기 행(8N연세플러스의원-단순마감마감, G5)이라 4분기 추천 RPC 에 안 잡히고,
 * 기준 업체 고정 폴백(워킨맵 행으로 최소 구성)이 last_date null·days_since 9999·never_visited false 로 만들었다
 * → 화면이 never_visited 만 보고 last_date 를 글자 그대로 찍었다. 점검 기록(jeomgeom 2025-07-14)은 있었다.
 * 같은 행의 좌표가 (0, 0)(3분기 워킨맵 3,586곳 중 3,376곳)이라 기준점이 대서양 한가운데가 되어 지도가 바다만 보였다.
 */

/** RPC(suggest_workin_candidates)가 "점검 기록 없음"에 쓰는 경과일 센티널 — 화면에 숫자로 보이면 안 된다 */
export const NO_RECORD_DAYS = 9999;

/** 쓸 수 있는 좌표인가 — null·NaN·(0,0)·한반도 밖(워킨맵 미지오코딩 값)은 지도·거리에 쓰지 않는다 */
export function hasValidCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a >= 32 && a <= 39.8 && b >= 123.5 && b <= 132.5;
}

type VisitFields = { last_date: string | null; days_since: number; history_error?: boolean };

/** 점검 기록이 있는가 — never_visited 플래그가 아니라 실제 날짜로 판단(폴백 행은 플래그가 틀릴 수 있었다) */
export const hasLastRecord = (p: { last_date: string | null }) => !!(p.last_date && String(p.last_date).trim());

/** 후보 한 곳의 "마지막 점검" 한 줄 */
export function lastVisitText(p: VisitFields): string {
  if (p.history_error && !hasLastRecord(p)) return "마지막 점검 기록 확인 실패";
  if (!hasLastRecord(p)) return "마지막 점검 기록 없음";
  return p.days_since >= 0 && p.days_since < NO_RECORD_DAYS ? `마지막 ${p.last_date} · ${p.days_since}일 경과` : `마지막 ${p.last_date}`;
}

/** 여러 기기(같은 회사) 묶음 — 가장 최근 기록 날짜와, 기록 있는 기기 중 가장 짧은 경과일 */
export function groupLastVisit(members: VisitFields[]): { lastDate: string; daysSince: number | null } {
  const recorded = members.filter(hasLastRecord);
  if (!recorded.length) return { lastDate: "", daysSince: null };
  const lastDate = recorded.map((m) => String(m.last_date)).sort().at(-1) || "";
  const days = recorded.map((m) => m.days_since).filter((d) => d >= 0 && d < NO_RECORD_DAYS);
  return { lastDate, daysSince: days.length ? Math.min(...days) : null };
}

export function groupLastVisitText(members: VisitFields[]): string {
  const { lastDate, daysSince } = groupLastVisit(members);
  if (!lastDate) return members.some((m) => m.history_error) ? "마지막 점검 기록 확인 실패" : "마지막 점검 기록 없음";
  return daysSince != null ? `마지막 ${lastDate} · ${daysSince}일 경과` : `마지막 ${lastDate}`;
}

/** 등록하는 일정 issue 칸 — "정기점검 (마지막 2025-07-14 · 471일 경과)" / "정기점검 (마지막 기록 없음)" */
export function checkIssueText(members: VisitFields[]): string {
  const { lastDate, daysSince } = groupLastVisit(members);
  if (!lastDate) return "정기점검 (마지막 기록 없음)";
  return `정기점검 (마지막 ${lastDate}${daysSince != null ? ` · ${daysSince}일 경과` : ""})`;
}

/** 점검 기록 날짜들(작성일)에서 last/prev·경과일 — 기준 업체 고정 폴백 행용. today 는 KST "YYYY-MM-DD" */
export function visitFromDates(dates: Array<string | null | undefined>, today: string): { last_date: string | null; prev_date: string | null; days_since: number; never_visited: boolean } {
  const days = [...new Set(dates.map((d) => String(d || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "").filter(Boolean))].sort().reverse();
  if (!days.length) return { last_date: null, prev_date: null, days_since: NO_RECORD_DAYS, never_visited: true };
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${days[0]}T00:00:00Z`)) / 86400000);
  return { last_date: days[0], prev_date: days[1] || null, days_since: Number.isFinite(diff) ? Math.max(0, diff) : NO_RECORD_DAYS, never_visited: false };
}

/** 화면에 쓸 거리 — 후보 좌표가 엉터리면(0,0) RPC 거리(수천 km)는 버린다 */
export const candidateDistance = (p: { lat: number | null; lng: number | null; distance_km: number | null }): number | null =>
  hasValidCoords(p.lat, p.lng) && p.distance_km != null && Number.isFinite(Number(p.distance_km)) ? Number(p.distance_km) : null;

type SortRow = VisitFields & { id: number; lat: number | null; lng: number | null; distance_km: number | null };

/**
 * 후보 정렬: ① 고정한 기준 업체 맨 위 ② 거리 가까운 순(좌표 없는 곳은 뒤) ③ 경과일 긴 순 ④ 기록 없는 곳은 같은 거리 무리의 맨 뒤.
 * 센티널 9999 를 "가장 오래됨"으로 읽으면 기준 업체 없이(경과일 순) 볼 때 기록 없는 곳(이름 매칭 실패 포함)이 맨 위를 덮었다.
 * 기록 없는 곳은 빨간 "점검 이력 없음" 배지로 따로 보인다.
 */
export function sortCandidates<T extends SortRow>(rows: T[], pinnedId: number | null = null): T[] {
  return rows
    .map((r, i) => ({ r, i, d: candidateDistance(r), rec: hasLastRecord(r) }))
    .sort((a, b) => {
      if (pinnedId != null && (a.r.id === pinnedId) !== (b.r.id === pinnedId)) return a.r.id === pinnedId ? -1 : 1;
      if (a.d != null && b.d != null && a.d !== b.d) return a.d - b.d;
      if ((a.d == null) !== (b.d == null)) return a.d == null ? 1 : -1;
      if (a.rec !== b.rec) return a.rec ? -1 : 1;
      if (a.rec && b.rec && a.r.days_since !== b.r.days_since) return b.r.days_since - a.r.days_since;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/**
 * 기준 업체 워킨맵 행 고르기 — 이름 점수가 같으면 좌표 있는 행 > 고른 분기 행.
 * 좌표 없는 행만 맞으면 그 행(placeId)은 쓰되 좌표는 주소 지오코딩으로 구한다(부른 쪽).
 */
export function pickAnchorHit<T extends { latitude: number | null; longitude: number | null; quarter?: number | null }>(
  scored: Array<{ h: T; score: number }>, quarter: number,
): T | undefined {
  return scored
    .filter((x) => x.score > 0)
    .map((x, i) => ({ ...x, i, ok: hasValidCoords(x.h.latitude, x.h.longitude), q: x.h.quarter == null || x.h.quarter === quarter }))
    .sort((a, b) => b.score - a.score || Number(b.ok) - Number(a.ok) || Number(b.q) - Number(a.q) || a.i - b.i)[0]?.h;
}
