/** 홈 미처리 일정 칸의 순수 로직: 종류 판정·필터·경과일 색 */
export type OverdueKind = "AS" | "물류";
export type KindFilter = "" | OverdueKind;

/** AS 만 일정리스트에서 처리, 나머지(납품철수교체휴가교육·물류)는 네이버 캘린더에서 완료 */
export const overdueKind = (scheduleType: string): OverdueKind => (scheduleType === "AS" ? "AS" : "물류");

export const overdueBadge = (scheduleType: string): string =>
  scheduleType === "납품철수교체휴가교육" ? "납품" : scheduleType === "물류" ? "물류" : scheduleType;

export function filterOverdue<T extends { team: string; scheduleType: string }>(rows: T[], team: string, kind: KindFilter): T[] {
  return rows.filter((r) => (!team || r.team === team) && (!kind || overdueKind(r.scheduleType) === kind));
}

/** 현황판과 같게: 7일↑ red, 3일↑ amber, 그 아래 기본 */
export const overdueAgeTone = (days: number): "red" | "amber" | "plain" => (days >= 7 ? "red" : days >= 3 ? "amber" : "plain");
