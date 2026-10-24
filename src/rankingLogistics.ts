/**
 * 순위표 '물류' 칸 셈(2026-10-24 개선 목록 A1).
 * 예전 순위표는 물류 활동 전부(byKind("logistics"))를 세어 여분·마감까지 들어갔다 — 팀 현황 '물류' 칸·홈 K24 와 숫자가 달랐다.
 * 이제 같은 판정(kpiCompute.isMainLogistics: 여분·마감 제외)을 쓴다. 여분·마감은 팀 현황 "기타(여분,마감)" 칸에서 본다.
 * 테스트: tests/rankingLogistics.test.ts
 */
import type { ActivityEvent } from "./operations";
import { isMainLogistics } from "./kpi/kpiCompute";

export function rankingLogisticsCount(events: ActivityEvent[]): number {
  return events.filter(isMainLogistics).length;
}
