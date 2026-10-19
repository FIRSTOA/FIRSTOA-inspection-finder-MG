-- 원격이관 접수 '원격대기' 일괄 완료 (2026-10-19) — Supabase SQL Editor 에서 1회 실행
-- 배경: 원격팀은 FIELD 의 [원격 처리 시작/끝] 단추를 쓰지 않고 자기 시트에서 처리한다. 그래서 2026-08-25~09-29 접수 54건이
--   FIELD 에는 '원격대기'로 남아 미처리 현황판·홈 미처리 칸에 잡혔다. 사용자 확인: "원격은 다 처리된 것".
-- 앞으로: 앱이 '원격대기' 7일 지난 건을 미처리로 세지 않는다(2026-10-19 배포). 이 SQL 은 이미 쌓인 54건만 닫는다.
-- 되돌리기: update public.service_receptions set status='원격대기', completed_at=null, completed_by='' where completed_by='원격팀 처리 확인(일괄 2026-10-19)';
-- 두 번 실행해도 안전(이미 완료된 행은 조건에서 빠진다).

update public.service_receptions
   set status = '완료',
       completed_at = coalesce(completed_at, now()),
       completed_by = '원격팀 처리 확인(일괄 2026-10-19)'
 where type = '원격이관'
   and status = '원격대기'
   and deleted = false
   and receipt_date < (now() at time zone 'Asia/Seoul')::date - 7;

-- 확인: 원격대기가 최근 7일 안의 것만 남아야 한다(2026-10-19 기준 0건)
select status, count(*) as 건수, min(receipt_date) as 가장오래, max(receipt_date) as 최근
  from public.service_receptions where type = '원격이관' and deleted = false group by status;
