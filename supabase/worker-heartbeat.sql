-- 노트북 작업 실행기 — 심박·일감 표 + 파수꾼 크론 (2026-10-10)
--
-- 왜: 노트북이 24시간 서버 역할(야간 백업·카톡 PC 중계·포스터·일감 처리)을 맡는다.
--     죽었는데 아무도 모르는 일을 막으려고 1분마다 심박을 적고, 15분 끊기면 담당자에게 웹푸시(카톡봇 파수꾼과 같은 통로).
-- Supabase SQL Editor 에서 1회 실행. 실행 전에는 실행기가 "표 없음" 로그만 남기고 백업·중계는 그대로 한다.

create table if not exists public.worker_heartbeat (
  name text primary key,            -- worker@<컴퓨터이름>
  host text,
  version text,
  note text,                        -- 마지막 백업 날짜·결과 요약
  last_seen timestamptz not null default now(),
  alerted_at timestamptz            -- 파수꾼이 마지막으로 알린 때(2시간에 한 번만)
);
create table if not exists public.worker_jobs (
  id bigserial primary key,
  kind text not null,               -- ping · backup · relay · poster · (whisper · ocr 예정)
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',   -- queued → running → done | failed
  run_at timestamptz not null default now(),
  claimed_at timestamptz, claimed_by text,
  finished_at timestamptz, result text, error text,
  created_at timestamptz not null default now(), created_by text
);
create index if not exists worker_jobs_queue_idx on public.worker_jobs(status, run_at);
grant select, insert, update on public.worker_heartbeat to anon;
grant select, insert, update on public.worker_jobs to anon;
grant usage, select on sequence public.worker_jobs_id_seq to anon;

-- 파수꾼: 10분마다. 15분 넘게 심박이 없는 실행기가 있으면 웹푸시(같은 실행기는 2시간에 한 번만 알림)
select cron.unschedule('worker-watchdog') where exists (select 1 from cron.job where jobname = 'worker-watchdog');
select cron.schedule(
  'worker-watchdog',
  '*/10 * * * *',
  $$
  with stale as (
    update public.worker_heartbeat
       set alerted_at = now()
     where last_seen < now() - interval '15 minutes'
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

-- 확인
select name, host, version, note, last_seen at time zone 'Asia/Seoul' as last_seen_kst from public.worker_heartbeat;
select jobid, jobname, schedule, active from cron.job where jobname = 'worker-watchdog';
