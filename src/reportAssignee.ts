/**
 * 중간보고 담당자 판정 — 배정 컬럼이 원본.
 * 2026-10-31: 본문은 supabase/functions/_shared/report/assignee-rules.ts (엣지 schedule-report 가 같은 규칙으로 자동 중간보고를 만든다).
 * 여기선 다시 내보낸다 — tests/reportAssignee.test.ts 가 실제 사고 케이스로 그대로 지킨다.
 */
export * from "../supabase/functions/_shared/report/assignee-rules.ts";
