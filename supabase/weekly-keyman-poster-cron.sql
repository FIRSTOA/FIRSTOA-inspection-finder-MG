-- 주간 키맨·주소 변경 포스터 — 서버 안전망 발송 (2026-08-28)
--
-- 발송은 두 갈래다.
--   ① 기본: 사무실 PC의 작업 스케줄러가 월요일 08:00에 카톡 PC 방 창에 **사진으로** 붙여 보낸다
--           (tools/kakao-pc/poster_send.py — 메신저봇은 알림 답장 통로라 글자만 보낼 수 있어서)
--   ② 안전망: PC가 꺼져 있었으면 월요일 10:00(KST)에 서버가 **문구+링크**로 보낸다.
--            ifMissing=true 라서 ①이 이미 보낸 주에는 아무것도 하지 않는다.
--
-- pg_cron은 UTC로 돈다: 01:00 UTC = 10:00 KST.  키는 anon만 쓴다(service_role은 코드·SQL에 넣지 않는다).
select cron.schedule(
  'weekly-keyman-poster',
  '0 1 * * 1',
  $$
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/weekly-keyman-poster',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw"}'::jsonb,
    body := '{"action":"run","ifMissing":true}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- 확인
select jobid, jobname, schedule, active from cron.job order by jobid;
