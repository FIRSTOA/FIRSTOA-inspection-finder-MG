-- =====================================================================
-- reception-dept-types-rename.sql — 서비스접수 부서 종류 이름 변경 '영업지원' → '영업팀'
-- 날짜: 2026-10-19 (사용자 지시. 작성: 개발실 구현서)
--
-- 목적
--   1) service_receptions.type CHECK 의 '영업지원' 을 '영업팀' 으로 교체(나머지 값은 그대로)
--   2) team_calendar_events.team CHECK 의 '영업지원' 을 '영업팀' 으로 교체(나머지 값은 그대로)
--   새 표·컬럼 없음 · 데이터 수정 없음 · 비밀값 없음.
--   (시트 category 'reception_sales', 카톡 room_map 키 '영업접수|*' 는 바뀌지 않는다.)
--
-- 전제: reception-dept-types.sql 이 먼저 실행돼 있어야 한다(2026-10-19 실행됨).
--   2026-10-19 기준 type='영업지원' 접수 0건이라 값 변환 없이 제약만 바꾼다.
--   만약 아래 사전 확인에서 0 이 아니면 add constraint 가 23514 로 실패하고 트랜잭션 전체가 취소된다
--   → 그때는 실행하지 말고 개발실에 알린다.
--
-- 실행: Supabase SQL Editor 에서 이 파일 전체를 1회 실행.
--   두 번 실행해도 안전하다(drop if exists → add, 같은 결과).
--
-- 이 SQL 실행 전 앱 동작: 앱은 이미 '영업팀' 으로 저장하므로, 영업팀 접수 저장·달력 일정 저장이
--   check 위반(23514)으로 막힌다. 경영지원·운영지원·현장 3종은 영향 없음.
--
-- 사전 확인(0 이어야 함)
--   select (select count(*) from public.service_receptions where type = '영업지원') as rec,
--          (select count(*) from public.team_calendar_events where team = '영업지원') as cal;
--
-- 되돌리기(영업팀 행이 0 일 때만 가능)
--   begin;
--   alter table public.service_receptions drop constraint if exists service_receptions_type_check;
--   alter table public.service_receptions add constraint service_receptions_type_check
--     check (type = any (array['원격이관'::text, '복합기 AS'::text, 'IT'::text,
--                              '경영지원'::text, '운영지원'::text, '영업지원'::text]));
--   alter table public.team_calendar_events drop constraint if exists team_calendar_events_team_check;
--   alter table public.team_calendar_events add constraint team_calendar_events_team_check
--     check (team = any (array['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, '팀장'::text,
--                              '경영지원'::text, '운영지원'::text, '영업지원'::text]));
--   commit;
--   notify pgrst, 'reload schema';
--
-- 주의(재실행 금지): reception-dept-types.sql 을 이 파일 뒤에 다시 돌리면 '영업지원' 으로 되돌아간다.
-- =====================================================================

begin;

-- 1) service_receptions.type
alter table public.service_receptions drop constraint if exists service_receptions_type_check;
alter table public.service_receptions add constraint service_receptions_type_check
  check (type = any (array['원격이관'::text, '복합기 AS'::text, 'IT'::text,
                           '경영지원'::text, '운영지원'::text, '영업팀'::text]));

-- 2) team_calendar_events.team
alter table public.team_calendar_events drop constraint if exists team_calendar_events_team_check;
alter table public.team_calendar_events add constraint team_calendar_events_team_check
  check (team = any (array['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, '팀장'::text,
                           '경영지원'::text, '운영지원'::text, '영업팀'::text]));

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- 확인 쿼리(실행 후) — 두 제약 모두 '영업팀' 이 보이고 '영업지원' 이 없어야 한다
--   select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('service_receptions_type_check', 'team_calendar_events_team_check');
-- =====================================================================
