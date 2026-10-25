/** 홈 미처리 일정 칸의 순수 로직: 종류 판정·필터·경과일 색 */
export type OverdueKind = "AS" | "물류";
export type KindFilter = "" | OverdueKind;

/**
 * 물류 미처리로 세는 일정 유형(서비스접수 현황판 물류 칸·홈 미처리·일정리스트 미처리 패널이 함께 쓰는 한 정의, 2026-10-24).
 * 전에는 "AS" 가 아니면 전부 물류로 봐서 익일AS 를 물류로 셌다 — 홈 물류 46 ≠ 현황판 44 의 원인.
 */
export const LOGISTICS_SCHEDULE_TYPES = ["물류", "납품철수교체휴가교육"] as const;
export const isLogisticsSchedule = (scheduleType: string): boolean => (LOGISTICS_SCHEDULE_TYPES as readonly string[]).includes(String(scheduleType || ""));

/** 물류(납품철수교체휴가교육·물류)는 네이버 캘린더에서 완료, 그 밖(AS·익일AS)은 AS — 일정리스트에서 처리 */
export const overdueKind = (scheduleType: string): OverdueKind => (isLogisticsSchedule(scheduleType) ? "물류" : "AS");

export const overdueBadge = (scheduleType: string): string =>
  scheduleType === "납품철수교체휴가교육" ? "납품" : scheduleType === "물류" ? "물류" : scheduleType;

export function filterOverdue<T extends { team: string; scheduleType: string }>(rows: T[], team: string, kind: KindFilter): T[] {
  return rows.filter((r) => (!team || r.team === team) && (!kind || overdueKind(r.scheduleType) === kind));
}

/** 현황판과 같게: 7일↑ red, 3일↑ amber, 그 아래 기본 */
export const overdueAgeTone = (days: number): "red" | "amber" | "plain" => (days >= 7 ? "red" : days >= 3 ? "amber" : "plain");

/**
 * 일정리스트 [미처리] 배지와 같은 판정(CsAsWorkspace overdueCount): 지난 날짜 · 완료 아님 · 매월점검 아님.
 * 홈 미처리의 복합기 AS·물류 칸도 이 함수로 센다(2026-10-25 사용자 "복합기 AS 는 캘린더 기준") — 두 화면 숫자가 같아야 한다.
 */
export function isOverdueTicket(t: { date: string; status: string; scheduleType: string }, today: string): boolean {
  return String(t.date || "").slice(0, 10) < today && String(t.status || "") !== "완료" && String(t.scheduleType || "") !== "매월점검";
}
