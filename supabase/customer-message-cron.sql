-- Supabase SQL Editor에서 한 번 실행합니다.
-- 예약된 고객 문자를 1분마다 확인하여 customer-message-send 함수로 전달합니다.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('customer-message-dispatch');
exception
  when others then null;
end $$;

select cron.schedule(
  'customer-message-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://jwhwicplfwrorrgtqrlw.supabase.co/functions/v1/customer-message-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3aHdpY3BsZndyb3JyZ3Rxcmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3ODg0MTQsImV4cCI6MjA5NzM2NDQxNH0.Dx227ZN2b8w6116mrjimoRiYkElddB3pqk9ys4DL72U'
    ),
    body := '{"action":"dispatch_due"}'::jsonb
  );
  $$
);
