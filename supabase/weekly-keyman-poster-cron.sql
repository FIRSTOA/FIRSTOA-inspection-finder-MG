-- 주간 키맨·주소 변경 포스터 정기 발송 (2026-08-28)
-- 매주 월요일 아침 8시(KST) = 일요일 23:00 UTC. pg_cron은 UTC로 돈다.
-- 지난주(월~일) 변경을 지역별 한 장 이미지로 만들어 각 지역 점검방에 보낸다.
-- 키는 anon만 쓴다(service_role은 절대 SQL·코드에 넣지 않는다).
select cron.schedule(
  'weekly-keyman-poster',
  '0 23 * * 0',
  $$
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/weekly-keyman-poster',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw"}'::jsonb,
    body := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- 확인
select jobid, jobname, schedule, active from cron.job order by jobid;
