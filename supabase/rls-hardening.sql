-- =====================================================================
-- RLS/권한 최소화 (백로그 C) — Supabase SQL Editor에서 실행
--
-- 원칙: anon 키는 번들에 공개되어 있으므로, 프론트가 실제로 쓰지 않는
--       권한(DELETE/UPDATE)은 회수한다. 앱 코드 전수 조사 기준:
--   · DELETE 사용: reading_posts, reading_votes, workin_map_places 뿐
--   · UPDATE 사용: workin_map_places, visit_logs, activity_events,
--                  service_receptions, message_jobs, message_templates, promo_materials
--   · 나머지 테이블은 INSERT/SELECT만 사용
--
-- ※ 외부 소비자 주의:
--   - Edge Function(field-sheet-sync)은 service_role 키 사용 → 영향 없음
--   - 메신저봇 outbox 폴러, 미수/임대리스트 시트 동기화 스크립트가
--     anon 키로 DELETE/UPDATE를 쓸 수 있어 outbox·misu·vendor_info는 건드리지 않음
-- =====================================================================

-- 1) 이력·기록 테이블: 한 번 쌓이면 앱에서 지울 일 없음 → DELETE·UPDATE 회수
--    (수정이 필요하면 관리자가 SQL로 처리)
revoke delete, update on table jeomgeom          from anon;
revoke delete, update on table as_records        from anon;
revoke delete, update on table contact_changes   from anon;
revoke delete, update on table logistics_records from anon;
revoke delete, update on table pc_expansion      from anon;
revoke delete, update on table mfp_expansion     from anon;
revoke delete, update on table happycall_messages from anon;

-- 2) 업데이트는 쓰지만 삭제는 안 쓰는 테이블 → DELETE만 회수
revoke delete on table visit_logs         from anon;
revoke delete on table activity_events    from anon;
revoke delete on table service_receptions from anon;
revoke delete on table message_jobs       from anon;
revoke delete on table message_templates  from anon;
revoke delete on table promo_materials    from anon;

-- 3) upsert(INSERT+UPDATE)만 쓰는 테이블 → DELETE만 회수
revoke delete on table weekly_notes     from anon;
revoke delete on table office_logs      from anon;
revoke delete on table quarterly_plans  from anon;
revoke delete on table golden_cards     from anon;

-- 4) 설정 테이블: 프론트는 읽기만 함 → 쓰기 전체 회수
revoke insert, update, delete on table app_config from anon;
revoke insert, update, delete on table room_map   from anon;

-- 5) field_sheet_sync_jobs: 프론트는 INSERT만 (처리·마킹은 Edge Function=service_role)
revoke update, delete on table field_sheet_sync_jobs from anon;

-- ---------------------------------------------------------------------
-- 보류(실행 전 반드시 확인 후 주석 해제할 것):
--
-- vendor_info(임대리스트): 시트 동기화 스크립트가 anon으로 delete-reload 하면 깨짐.
--   동기화가 service_role/개인 실행이면 아래 해제 가능.
-- -- revoke insert, update, delete on table vendor_info from anon;
--
-- misu(미수) 등 시트 유입 테이블: 동기화 방식 확인 전까지 보류.
-- -- revoke delete, update on table misu from anon;
--
-- outbox: 메신저봇 폴러가 anon 키로 상태 갱신/삭제할 가능성 → 보류.
-- ---------------------------------------------------------------------

-- 되돌리기(문제 발생 시):
-- grant all on table <테이블명> to anon;
