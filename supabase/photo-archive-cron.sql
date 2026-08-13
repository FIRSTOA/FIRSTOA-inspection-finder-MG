-- 사진 드라이브 아카이브 정기 실행 — 매시 60장씩, 90일 지난 사진을 GAS 경유로 이관.
-- 대상이 없으면 조용히 no-op (첫 대상은 2026-10월 말부터 생긴다).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('photo-drive-archive');
exception
  when others then null;
end $$;

select cron.schedule(
  'photo-drive-archive',
  '25 * * * *',
  $$
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/photo-drive-archive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw'
    ),
    body := '{"action":"archive","days":90,"limit":60}'::jsonb
  );
  $$
);
