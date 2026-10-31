// 파트 탭 [n분기] 화면(OkrPartQuarterView, 2026-11-01 docs/tasks/okr-part-quarter-2026-11-01.md)의 순수 규칙 — 화면·OkrHub 가 같이 쓴다.
// 2026-11-01 사용자 피드백("더 헷갈릴 것 같아"): 달 판정 점·분기 판정 열·달별 진행 띠를 뺐다. 표 = 병목현상 | 목표 | 달성기준 | 분기 실제결과 | 사유 | 다음 분기 개선계획 | 근거자료.
//   - 탭 머리(분기 화면) = "분기 실제결과가 적힌 목표 수/목표 수" (판정 열이 없어 미흡 수·필수 표시는 쓰지 않는다)
import type { PartQuarterRow } from "./okr";

export function partQuarterTabCount(rows: Array<Pick<PartQuarterRow, "row">>): { count?: string; alerts: number } {
  if (!rows.length) return { alerts: 0 };
  return { count: `${rows.filter((r) => (r.row?.actual || "").trim()).length}/${rows.length}`, alerts: 0 };
}
