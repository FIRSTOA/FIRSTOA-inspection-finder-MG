-- 카톡봇 심박 + 파수꾼 (2026-09-02)
--
-- 문제: 메신저봇은 알림 답장 통로라, 방이 하루~주말 조용하면 세션이 만료돼 못 보낸다.
--       아침마다 사람이 "봇테스트"를 쳐야 살아났다(실사용 컴플레인).
-- 원리: 대화가 있는 방은 죽지 않는다 → 봇이 살아 있는 동안 매일 한 줄을 스스로 보내
--       세션을 갱신하면 조용한 방도 죽지 않는다. (죽어버린 방은 사람이 한 번 살려줘야 시작)
--
-- ① 심박: 매일 07:45 KST(22:45 UTC) — room_map의 모든 방에 상태 한 줄
select cron.schedule(
  'kakao-bot-heartbeat',
  '45 22 * * *',
  $$
  insert into outbox (room, text)
  select distinct room,
    '🤖 ' || to_char(now() at time zone 'Asia/Seoul', 'MM/DD') || ' 카톡봇 정상 대기 중 [봇점검]'
  from room_map
  where coalesce(trim(room), '') <> ''
  $$
);

-- ② 파수꾼: 매시 20분 — 30분 넘게 안 나간 메시지가 있으면(=그 방 봇이 잠듦) 관리자에게 웹푸시,
--    6시간 지난 심박은 삭제(늦게 살아난 방에 아침 인사가 뒷북으로 가지 않게)
select cron.schedule(
  'kakao-bot-watchdog',
  '20 * * * *',
  $$
  delete from outbox where text like '%[봇점검]' and created_at < now() - interval '6 hours';
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/push-send',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw"}'::jsonb,
    body := jsonb_build_object(
      'title', '카톡봇이 잠든 방이 있어요',
      'body', coalesce((select string_agg(distinct room, ', ') from outbox where created_at < now() - interval '30 minutes'), '') || ' — 그 방에 아무 메시지나 한 번 보내면 살아납니다',
      'tag', 'bot-stale',
      'category', 'admin',
      'targets', jsonb_build_array('이민구')
    ),
    timeout_milliseconds := 20000
  )
  where exists (select 1 from outbox where created_at < now() - interval '30 minutes');
  $$
);

select jobid, jobname, schedule, active from cron.job order by jobid;
