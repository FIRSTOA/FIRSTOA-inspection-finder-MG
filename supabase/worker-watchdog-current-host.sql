-- 실행기 파수꾼: "지금 쓰는 실행기" 한 대만 감시 (2026-10-19)
--
-- 문제: worker_heartbeat 에 데스크톱(worker@DESKTOP-VLFH92B, 2026-10-10 시험 실행 1회)의 옛 행이 남아
--       파수꾼이 2시간마다 "노트북 작업 실행기가 멈췄어요" 웹푸시를 보냈다. 노트북(worker@D6110)은 정상.
--       FIELD 화면(실시간 전송 현황)은 가장 최근 행만 보여 줘서 "살아 있음"으로 보임 → 알림과 화면이 다른 이유.
-- 고침: ① 옛 데스크톱 행 삭제 ② 파수꾼은 가장 최근에 심박을 찍은 실행기 한 대만 본다.
--       (데스크톱에서 시험으로 worker.py 를 또 돌려도, 노트북이 더 최근이면 알림 대상이 아니다)

-- ① 옛 행 삭제 (데스크톱 시험 실행 흔적)
delete from public.worker_heartbeat where name = 'worker@DESKTOP-VLFH92B';

-- ② 파수꾼 교체: 10분마다, 가장 최근 실행기 한 대의 심박이 15분 넘게 없으면 웹푸시(2시간에 한 번)
select cron.unschedule('worker-watchdog') where exists (select 1 from cron.job where jobname = 'worker-watchdog');
select cron.schedule(
  'worker-watchdog',
  '*/10 * * * *',
  $$
  with stale as (
    update public.worker_heartbeat
       set alerted_at = now()
     where name = (select name from public.worker_heartbeat order by last_seen desc limit 1)
       and last_seen < now() - interval '15 minutes'
       and (alerted_at is null or alerted_at < now() - interval '2 hours')
    returning name, host, last_seen
  )
  select net.http_post(
    url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/push-send',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw"}'::jsonb,
    body := jsonb_build_object(
      'title', '노트북 작업 실행기가 멈췄어요',
      'body', (select string_agg(name || ' 마지막 심박 ' || to_char(last_seen at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), ', ') from stale)
              || ' — 노트북 전원·로그인·작업 스케줄러(FIRSTOA Worker)를 확인하세요',
      'tag', 'worker-stale',
      'category', 'admin',
      'targets', jsonb_build_array('이민구')
    ),
    timeout_milliseconds := 20000
  )
  where exists (select 1 from stale);
  $$
);

-- 확인: 행이 노트북 한 줄만 남고, 크론이 active 여야 한다
select name, host, last_seen at time zone 'Asia/Seoul' as last_seen_kst, alerted_at from public.worker_heartbeat;
select jobid, jobname, schedule, active from cron.job where jobname = 'worker-watchdog';
