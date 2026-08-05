-- 예약 고객 문자(message_jobs)를 1분마다 처리 — 서울 프로젝트용 (뭄바이 크론 파일은 구버전)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$ begin perform cron.unschedule('customer-message-dispatch'); exception when others then null; end $$;
select cron.schedule('customer-message-dispatch', '* * * * *', $$
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/customer-message-send',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw'),
    body := '{"action":"dispatch_due"}'::jsonb);
$$);
