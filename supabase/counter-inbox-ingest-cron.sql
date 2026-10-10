-- 관리부 마감 목록 자동 반영 크론 (2026-10-10)
-- 봇이 마감방 글을 counter_sms_inbox 에 넣으면, 2분마다 엣지 함수 counter-inbox-ingest 가
-- 있는 업체는 그대로 두고 없는 업체만 팀 목록에 넣는다(앱이 탭을 열 때도 같은 함수를 부른다).
-- Supabase SQL Editor 에서 1회 실행. 앞서 pg_cron·pg_net 은 켜져 있다(worker-watchdog 과 같은 방식).

select cron.unschedule('counter-inbox-ingest') where exists (select 1 from cron.job where jobname = 'counter-inbox-ingest');
select cron.schedule(
  'counter-inbox-ingest',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/counter-inbox-ingest',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  )
  where exists (select 1 from public.counter_sms_inbox where applied_at is null and (note is null or note not like '자동 처리 실패%'));
  $$
);

-- 확인
select jobid, jobname, schedule, active from cron.job where jobname = 'counter-inbox-ingest';
