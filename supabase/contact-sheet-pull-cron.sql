-- 담당자변경 시트 → contact_changes 자동 당기기 (2026-09-17)
--
-- 왜: 월요일 키맨·주소 브리핑(weekly-keyman-poster)은 contact_changes 표를 읽는다.
--   그런데 시트에 쌓이는 변경(카톡방 봇 + Make "/양식")은 누군가 앱의 키맨 화면을 열 때만
--   contact-sheet-pull이 돌아 들어왔다 → 주말에 아무도 안 열면 브리핑에 FIELD 작성분만 실렸다.
--   여기서 매일 아침 + 브리핑 직전에 서버가 직접 당긴다. 사람 손이 안 간다.
--
-- pg_cron은 UTC로 돈다. 카톡은 10시(KST) 전에 방에 올리지 않는다(출근 전 알림 금지 — 2026-09-17 규칙).
--   · 매일 01:00 UTC = 10:00 KST — 하루 한 번 최신화 + 새 변경을 지역 점검방에 공유 (share 기본값)
--   · 월요일 00:30 UTC = 09:30 KST — 브리핑(월 01:00 UTC) 30분 전 저장만 (share:false — 카톡은 안 나감)
--   함수 자체도 10시 전에는 공유를 보류하므로(shareNewChanges 가드) 앱에서 아침에 열어도 카톡이 먼저 나가지 않는다.
-- 키는 anon만 쓴다(service_role은 코드·SQL에 넣지 않는다). 시트는 읽기만 한다.

select cron.unschedule(jobid) from cron.job where jobname in ('contact-sheet-pull-daily', 'contact-sheet-pull-before-briefing');

select cron.schedule(
  'contact-sheet-pull-daily',
  '0 1 * * *',
  $$
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/contact-sheet-pull',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw"}'::jsonb,
    body := '{"days":60}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'contact-sheet-pull-before-briefing',
  '30 0 * * 1',
  $$
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/contact-sheet-pull',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw"}'::jsonb,
    body := '{"days":30,"share":false}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- 확인
select jobid, jobname, schedule, active from cron.job where jobname like 'contact-sheet-pull%' order by jobid;
