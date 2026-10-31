-- ============================================================================
-- 2026-10-31 전체 디버깅 후속 정리 2건 (팀장 클로드 · 실행은 사용자 SQL Editor)
-- 두 번 실행해도 안전(delete 는 조건 행이 없으면 0행, revoke 는 멱등).
--
-- 1) 담당자변경 쓰레기 행 삭제 — 키맨체크 시트 '청현세무회계컨설팅' 행의 날짜 칸이 수식(오늘)이라
--    매일 자정 새 건으로 들어온 13행(2026-10-19 ~ 10-31, 접수자 '프로', 지역 빈칸, 변경후 빈칸, shared_at null = 카톡 공유 안 됨).
--    진짜 기록(2025-04-10 박영현, 김용범→남주현)은 조건에 안 걸려 남는다.
--    엣지 contact-sheet-pull(dedupe.ts, 2026-10-31)이 같은 내용·다른 날짜 행을 이제 막으므로 지운 뒤 다시 쌓이지 않는다.
--    (시트 쪽 그 행은 담당자가 날짜를 값으로 고치거나 지우면 더 깨끗하다 — 필수는 아님)
-- 2) 트리거 전용 함수 log_outbox_delivery() 의 EXECUTE 를 anon·authenticated 에서 회수.
--    Supabase advisor(2026-10-31) "anon 이 부를 수 있는 SECURITY DEFINER 함수". 이 함수는 outbox AFTER DELETE 트리거가
--    소유자 권한으로 부르는 것이라 REST /rpc 로 누가 불러도 될 일이 없다. 트리거 동작은 EXECUTE 권한과 무관(소유자 실행).
--    나머지 4개(create_photo_album·get_photo_album·queue_visit_advice = 앱이 anon 으로 부름, merge_reception_handling = 앱 remoteHandling)는 의도라 그대로.
-- ============================================================================

begin;

-- 1) 실행 전 확인(기대 13행 → 12행 삭제, 최근 1행 유지): select count(*) from public.contact_changes where company = '청현세무회계컨설팅' and author = '프로' and coalesce(region,'') = '' and shared_at is null;
delete from public.contact_changes
 where company = '청현세무회계컨설팅'
   and author = '프로'
   and coalesce(region, '') = ''
   and shared_at is null
   and change_date >= '2026-10-01'
   and change_date < (select max(change_date) from public.contact_changes where company = '청현세무회계컨설팅' and author = '프로');
   -- 되돌릴 수 없는 문장(쓰레기 행만: 2025-04-10 진짜 기록은 author 박영현·shared_at 있음).
   -- 가장 최근 1행은 일부러 남긴다 — dedupe 규칙 2 가 "이미 있는 같은 내용 행"과 비교하므로, 다 지우면 다음 pull 때 1건이 다시 들어온다(권한나 검사).

-- 2)
revoke execute on function public.log_outbox_delivery() from public, anon, authenticated;   -- PUBLIC 기본 EXECUTE 까지(권한나 검사)

commit;

-- 확인:
--   select count(*) from public.contact_changes where company = '청현세무회계컨설팅';            -- 2 (2025-04-10 박영현 + 최근 '프로' 1행)
--   select has_function_privilege('anon', 'public.log_outbox_delivery()', 'execute');            -- false
--   -- 봇이 outbox 1건 지운 뒤: select count(*) from kakao_delivery_log where created_at > now() - interval '1 hour';  -- 트리거 계속 동작
-- 되돌리기: grant execute on function public.log_outbox_delivery() to public, anon, authenticated;  (삭제한 행은 되돌리지 않음 — 쓰레기 행)
