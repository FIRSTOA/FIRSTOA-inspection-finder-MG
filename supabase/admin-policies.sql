-- 관리 화면에서 값을 바꿀 수 있도록 쓰기 정책 추가.
-- (기존 stock_items·cs_members·message_templates와 동일한 수준)
--
-- ※ anon key는 프론트엔드에 공개된 키다. 아래 표는 앱을 아는 사람이면 바꿀 수 있다.
--   특히 app_config의 전송 스위치는 끄면 회사 전체 카톡 전송이 멈춘다.
--   정식 로그인(Auth) 도입 시 이 정책들을 authenticated 로 좁혀야 한다.

-- 전송·연동 설정
drop policy if exists "app_config anon write" on public.app_config;
create policy "app_config anon write" on public.app_config for all to anon using (true) with check (true);

-- 카톡방 매핑
drop policy if exists "room_map anon write" on public.room_map;
create policy "room_map anon write" on public.room_map for all to anon using (true) with check (true);

-- 담당자·주소 변경이력: 삭제·수정 (테스트로 남은 기록 정리용)
drop policy if exists "contact_changes anon write" on public.contact_changes;
create policy "contact_changes anon write" on public.contact_changes for update to anon using (true) with check (true);
drop policy if exists "contact_changes anon delete" on public.contact_changes;
create policy "contact_changes anon delete" on public.contact_changes for delete to anon using (true);

-- RLS 정책만으로는 부족하다 — 테이블 권한(GRANT)도 함께 있어야 PostgREST가 통과시킨다.
grant insert, update, delete on public.app_config to anon;
grant insert, update, delete on public.room_map to anon;
grant update, delete on public.contact_changes to anon;

-- 시트 미러(전체교체) 복구: supabaseReplaceAll_(GAS)이 anon 키로 delete+insert 하는데
-- 서울 이전 때 pc_expansion·mfp_expansion에 DELETE/UPDATE GRANT가 빠져 미러가 조용히 멈췄었다 (2026-08-01 발견)
grant delete, update on public.pc_expansion to anon;
grant delete, update on public.mfp_expansion to anon;

-- 부서 요청 대상 지정 (2026-08-01): 전체 / 팀 / 개인
-- alter table dept_requests add column target_type text default '전체', target text default '';

-- 키맨 인사 관리 (2026-08-27) — 키맨이 바뀌면 초반에 인사를 드려야 재계약·친밀도가 다르다(대표님 취지).
-- 담당자변경 이력에 "인사 완료" 체크를 붙이고, FIELD 전송 때 지역 점검방에도 공유한다. (이미 적용됨)
alter table public.contact_changes
  add column if not exists greeting_done boolean not null default false,
  add column if not exists greeting_by text not null default '',
  add column if not exists greeting_at timestamptz,
  add column if not exists greeting_memo text not null default '';
grant update (greeting_done, greeting_by, greeting_at, greeting_memo) on public.contact_changes to anon;
notify pgrst, 'reload schema';
