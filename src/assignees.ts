/**
 * 일정 담당자 여러 명 — as_tickets.assignee 한 칸에 쉼표 목록("김A,이B")으로 저장한다(2026-10-22, SQL 없음).
 * 2026-10-31: 본문은 supabase/functions/_shared/report/assignees.ts (엣지 schedule-report 와 같은 규칙) — 여기선 다시 내보낸다.
 * 설계: docs/tasks/schedule-multi-assignee.md
 */
export * from "../supabase/functions/_shared/report/assignees.ts";
