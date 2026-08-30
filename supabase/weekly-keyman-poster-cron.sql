-- 주간 키맨 브리핑 자동 발송 (2026-08-28)
--
-- 매주 월요일 아침 8시(KST)에 지역별 한 장 이미지를 만들고,
-- 각 지역 점검방에 **문구 + 사진 링크**를 봇이 보낸다. 사람 손이 전혀 안 간다.
--   · 봇(메신저봇)은 안드로이드 알림 답장 통로라 글자만 보낼 수 있다 → 링크로 보낸다.
--     카톡이 이미지 링크에 미리보기 썸네일을 붙여 사진처럼 보인다.
--   · 진짜 파일 사진으로 올리고 싶으면 사무실 PC 경로(tools/kakao-pc/poster_send.py)를 함께 쓴다.
--
-- pg_cron은 UTC로 돈다: 일요일 23:00 UTC = 월요일 08:00 KST.
-- 키는 anon만 쓴다(service_role은 코드·SQL에 넣지 않는다).
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
