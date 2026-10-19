-- =====================================================================
-- reception-dept-types.sql — 서비스접수 부서 3종(경영지원·운영지원·영업지원) 받을 자리
-- 날짜: 2026-10-19 (작성: 데이터실 표다빈 / 설계: docs/tasks/reception-dept-types.md 3-2절)
--
-- 목적
--   1) service_receptions.type 에 '경영지원','운영지원','영업지원' 허용
--   2) service_receptions.route 에 '메일','사내' 허용(기존 '카카오','전화' 유지)
--   3) field_sheet_sync_jobs.category 에 'reception_sales','reception_mgmt' 허용(기존 8개 유지)
--   4) team_calendar_events.team 에 부서 3종 허용 + reception_id(uuid) 컬럼·부분 인덱스
--   5) app_config 에 켜기 스위치 DEPT_RECEPTION_ENABLED = 'false' (관리 탭에서 켬)
--   새 표 없음 · 컬럼/표 삭제 없음 · 데이터 수정 없음 · 비밀값 없음.
--
-- 실행: Supabase SQL Editor 에서 이 파일 전체를 1회 실행.
--   두 번 실행해도 안전하다(제약은 drop if exists → add, 컬럼·인덱스는 if not exists,
--   설정은 on conflict do nothing — 이미 켠 스위치를 다시 끄지 않는다).
--
-- 라이브 제약 이름(2026-10-19 MCP 실측):
--   select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid in ('public.service_receptions'::regclass,'public.field_sheet_sync_jobs'::regclass,
--                       'public.team_calendar_events'::regclass) and contype='c';
--   service_receptions_type_check        = ('원격이관','복합기 AS','IT')
--   service_receptions_route_check       = ('카카오','전화')
--   field_sheet_sync_jobs_category_check = 8개(expansion_it, expansion_copier, contact_change, complaint,
--                                           praise, reception_copier, reception_copier_new, reception_remote)
--   team_calendar_events_team_check      = ('A','B','C','D','E','팀장')
--
-- 주의(재실행 금지 파일): service-receptions.sql(옛 'IT AS' 되살림), field-sheet-sync.sql(category 옛 5개로 되돌림)
--   을 이 파일 뒤에 다시 돌리면 이번에 넓힌 CHECK 가 되돌아간다.
--
-- 이 SQL 실행 전 앱 동작
--   관리 탭 DEPT_RECEPTION_ENABLED 가 없거나 'false' 라서 [부서] 탭이 화면에 안 보인다.
--   스위치를 먼저 켜면 탭은 보이지만 저장 시 CHECK 위반(23514, HTTP 400)이 나고 앱이 "DB 설정 SQL 실행 필요" 안내를 띄운다.
--   → 이 SQL 실행 + 아래 확인 쿼리 통과 뒤에 관리자가 스위치를 켠다.
--
-- 권한: 새 표가 없어 grant 불필요. team_calendar_events 는 표 단위 grant(anon/authenticated arwd)이고
--   컬럼 단위 grant 가 없으므로(2026-10-19 실측 attacl 없음) 새 컬럼 reception_id 도 기존 grant 로 읽고 쓴다.
--
-- 인덱스 판단: service_receptions (type, status, receipt_date desc) 는 만들지 않는다.
--   기존 service_receptions_type_idx (type, receipt_date desc) 가 type 앞머리로 미처리 보드 조회를 받치고,
--   표가 952행·6.8MB(2026-10-19), 부서 접수 월 약 300건 규모라 status 를 더한 인덱스는 거의 중복이다.
--   느려지면 그때 추가: create index if not exists service_receptions_type_status_idx
--                        on public.service_receptions (type, status, receipt_date desc);
--
-- 되돌리기(필요할 때만). 먼저 새 값 행이 없는지 확인:
--   select type, route, count(*) from public.service_receptions
--    where type in ('경영지원','운영지원','영업지원') or route in ('메일','사내') group by 1, 2;
--   (field_sheet_sync_jobs 의 reception_sales/reception_mgmt, team_calendar_events 의 부서 팀 행도 같은 식으로 확인)
--   새 값 행이 남아 있으면 아래 CHECK 추가가 23514 로 실패한다 — 그 행을 정리하거나 not valid 를 붙인다.
--   alter table public.service_receptions drop constraint if exists service_receptions_type_check;
--   alter table public.service_receptions add constraint service_receptions_type_check
--     check (type = any (array['원격이관'::text, '복합기 AS'::text, 'IT'::text]));
--   alter table public.service_receptions drop constraint if exists service_receptions_route_check;
--   alter table public.service_receptions add constraint service_receptions_route_check
--     check (route = any (array['카카오'::text, '전화'::text]));
--   alter table public.field_sheet_sync_jobs drop constraint if exists field_sheet_sync_jobs_category_check;
--   alter table public.field_sheet_sync_jobs add constraint field_sheet_sync_jobs_category_check
--     check (category = any (array['expansion_it'::text, 'expansion_copier'::text, 'contact_change'::text,
--       'complaint'::text, 'praise'::text, 'reception_copier'::text, 'reception_copier_new'::text, 'reception_remote'::text]));
--   alter table public.team_calendar_events drop constraint if exists team_calendar_events_team_check;
--   alter table public.team_calendar_events add constraint team_calendar_events_team_check
--     check (team = any (array['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, '팀장'::text]));
--   update public.app_config set value = 'false' where key = 'DEPT_RECEPTION_ENABLED';
--   notify pgrst, 'reload schema';
--   (reception_id 컬럼·인덱스는 남겨도 무해하다. 이 파일은 컬럼을 지우지 않는다.)
-- =====================================================================

begin;

-- 1) service_receptions.type — 부서 3종 추가 (옛 'IT AS' 는 되살리지 않는다)
alter table public.service_receptions drop constraint if exists service_receptions_type_check;
alter table public.service_receptions add constraint service_receptions_type_check
  check (type = any (array['원격이관'::text, '복합기 AS'::text, 'IT'::text,
                           '경영지원'::text, '운영지원'::text, '영업지원'::text]));

-- 1-2) service_receptions.route — '메일','사내' 추가 (값을 넓히기만 하므로 기존 행 검증은 항상 통과)
alter table public.service_receptions drop constraint if exists service_receptions_route_check;
alter table public.service_receptions add constraint service_receptions_route_check
  check (route = any (array['카카오'::text, '전화'::text, '메일'::text, '사내'::text]));

-- 2) field_sheet_sync_jobs.category — 기존 8개 + reception_sales, reception_mgmt = 10개
alter table public.field_sheet_sync_jobs drop constraint if exists field_sheet_sync_jobs_category_check;
alter table public.field_sheet_sync_jobs add constraint field_sheet_sync_jobs_category_check
  check (category = any (array['expansion_it'::text, 'expansion_copier'::text, 'contact_change'::text,
                               'complaint'::text, 'praise'::text, 'reception_copier'::text,
                               'reception_copier_new'::text, 'reception_remote'::text,
                               'reception_sales'::text, 'reception_mgmt'::text]));

-- 3) team_calendar_events.team — 부서 3종 추가
alter table public.team_calendar_events drop constraint if exists team_calendar_events_team_check;
alter table public.team_calendar_events add constraint team_calendar_events_team_check
  check (team = any (array['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, '팀장'::text,
                           '경영지원'::text, '운영지원'::text, '영업지원'::text]));

-- 3-2) 접수와 연결된 일정 찾기용 컬럼. FK 는 걸지 않는다(접수 삭제 시 일정은 앱이 지운다 — 설계안).
alter table public.team_calendar_events add column if not exists reception_id uuid;
comment on column public.team_calendar_events.reception_id is
  '부서 접수(service_receptions.id)에서 만든 일정이면 그 id. FK 없음 - 접수 삭제·완료 시 앱이 정리. 2026-10-19';
create index if not exists team_calendar_events_reception_id_idx
  on public.team_calendar_events (reception_id) where reception_id is not null;

-- 5) 켜기 스위치 — 기본 꺼짐. 이미 있으면(관리자가 켰으면) 건드리지 않는다.
insert into public.app_config (key, value) values ('DEPT_RECEPTION_ENABLED', 'false')
on conflict (key) do nothing;

commit;

-- 6) PostgREST 스키마 캐시 새로고침(새 컬럼을 API 가 바로 보게)
notify pgrst, 'reload schema';

-- =====================================================================
-- 확인 쿼리(실행 후 따로 돌려 본다)
-- select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--  where conname in ('service_receptions_type_check','service_receptions_route_check',
--                    'field_sheet_sync_jobs_category_check','team_calendar_events_team_check')
--  order by 2;
--   → category 10개, route 4개, type 6개, team 9개
-- select column_name, data_type, is_nullable from information_schema.columns
--  where table_schema='public' and table_name='team_calendar_events' and column_name='reception_id';
--   → reception_id | uuid | YES
-- select indexdef from pg_indexes where schemaname='public' and indexname='team_calendar_events_reception_id_idx';
-- select key, value from public.app_config where key='DEPT_RECEPTION_ENABLED';
--   → DEPT_RECEPTION_ENABLED | false (켠 뒤라면 true)
-- =====================================================================
