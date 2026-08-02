-- 시트 기입 실패 잡 자동 재시도 — 10분마다 3분 이상 지난 pending 잡을 배치 처리.
-- (직접 호출 실패·엣지 타임아웃으로 남은 잡을 회수한다. attempts 5회 도달 시 failed 마킹)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('field-sheet-retry');
exception
  when others then null;
end $$;

select cron.schedule(
  'field-sheet-retry',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/field-sheet-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw'
    ),
    body := '{"action":"retry_pending"}'::jsonb
  );
  $$
);
