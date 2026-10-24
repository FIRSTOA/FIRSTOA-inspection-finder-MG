-- ============================================================================
-- cron → 엣지 함수 호출에서 박힌 JWT 걷어내기(vault) + 응답 감시 — 2026-10-24 · 데이터실 표다빈
-- SQL Editor 에서 통째로 1회 실행. 두 번 실행해도 안전(비밀은 없을 때만 만들고, 원래 명령 백업은 처음 것만 남긴다).
-- 설계: docs/tasks/db-hardening-2026-10-24.md (B)
--
-- 왜: docs/tasks/risk-audit-2026-10-24.md 요약 4·부록 E2·E3.
--   (1) cron 12개 명령에 같은 anon JWT 가 글자로 박혀 있다. 키를 회전하면 12곳을 손으로 고쳐야 한다(10/19 사례).
--   (2) net.http_post 기본 5초 타임아웃 — 최근 6시간 응답 1,027건 중 366건이 timed_out. 그래도 cron 기록은 succeeded.
--       net._http_response 에는 URL·job 이름이 없어서 "어느 cron 이 실패했는지" 알 수 없다.
-- 무엇:
--   1) vault 비밀 'field_cron_jwt' — 지금 cron 명령에서 키를 꺼내 넣는다(이 파일에 키 글자 없음). role=anon 인지 검사.
--   2) 비노출 스키마 ops (PostgREST 노출 안 됨, anon·authenticated 사용 권한 회수)
--      · ops.call_edge(함수, body, timeout_ms, tag) — vault 에서 키를 읽어 net.http_post, 요청 id 를 ops.edge_calls 에 적는다.
--      · ops.edge_calls — 호출 1건 = 1행(어느 cron, 어느 함수). 5분마다 net._http_response 결과를 옮겨 적는다(응답 표는 6시간 뒤 사라짐).
--      · ops.edge_call_status(호출별 상태) · ops.edge_call_health(cron 별 24시간 요약) 뷰 — ops-monitor 가 MCP 로 읽는다.
--      · ops.cron_command_backup — 바꾸기 전 원래 명령(되돌리기용). 원래 명령에 키가 들어 있어 anon 접근 없음.
--   3) cron.alter_job 으로 12개 명령 교체(일정·활성 여부는 그대로). 타임아웃은 함수 실측 시간에 맞춰 늘린다.
--   4) 새 cron 'edge-call-collect' (*/5) — 응답 옮겨 적기 + 7일 지난 호출 기록 삭제. HTTP 호출 없음.
-- 바꾸지 않는 것: 엣지 함수 코드, cron 일정, job 11(비활성·HTTP 없음)·24(purge-cron-log).
--
-- 라이브 실측(MCP 읽기, 2026-10-24 — "DB 에서 본 값"):
--   · JWT 박힌 job: 3,4,5,8,9,10,12,17,18,21,22,23 (12개), 서로 다른 키 1개(모두 같은 anon 키, payload role=anon).
--   · vault 확장 있음, vault.secrets 0개. pg_net 0.20.4, pg_net.ttl 6 hours. postgres 가 vault.decrypted_secrets·net._http_response SELECT 가능.
--   · 응답 시각 분포: 타임아웃은 매분 :00 에 몰림 = 매분 job(3 customer-message-dispatch, 8 naver-calendar-sync).
--     엣지 로그 24h: naver-calendar-sync 5,632회 평균 5.8초·최대 48초(→ 5초 타임아웃의 원인), customer-message-send 최대 7.3초,
--     field-sheet-sync 최대 16.5초, contact-sheet-pull 최대 4.5초.
--   · 주의: pg_net 의 timed_out 은 "DB 가 기다리기를 그만뒀다"는 뜻이지 함수 실패가 아니다. 엣지 로그상 함수는 끝까지 돈다.
--     그래서 상태를 ok / http_error(함수가 4xx·5xx) / no_wait(기다리다 포기) / net_error / lost 로 나눠 보인다.
--   · 파일에 적힌 값과 다른 점: supabase/*-cron.sql 10개 파일에는 옛 방식(키 글자)이 그대로 있다.
--     이 파일 실행 뒤 그 파일들을 다시 실행하면 키가 다시 박힌다 → 재실행 금지(문서 (B) 후속).
--
-- 대상 12개(jobname): customer-message-dispatch(3) field-sheet-retry(4) photo-drive-archive(5) naver-calendar-sync(8)
--   contact-sheet-share(9) weekly-keyman-poster(10) kakao-bot-watchdog(12) contact-sheet-pull-daily(17)
--   contact-sheet-pull-before-briefing(18) counter-inbox-ingest(21) solapi-import(22) worker-watchdog(23).
--   **job 11 kakao-bot-heartbeat 는 대상 아님** — active=false 이고 HTTP 호출·키가 없다(outbox insert 만). job 24 purge-cron-log 도 아님.
-- 권한나 검사(2026-10-24): 실행 금지 없음, 고친 뒤 실행 — 반영함: 6번 블록 앞 가드 3개
--   ① 키 박힌 job 의 username 이 current_user 가 아니면 중단 ② 대상 jobname 12개가 모두 있어야 진행 ③ 박힌 키 종류가 1개가 아니면 중단(1번 블록에도).
--   팀장 사전 조회: pg_cron 1.6.4 · pg_net 0.20.4 · supabase_vault 0.3.1, cron job 전부 username=postgres, 박힌 키 distinct 1, vault field_cron_jwt 0 · ops 스키마 0.
-- 키 회전할 때(이 파일 실행 뒤): Supabase 대시보드 → Project Settings → Vault 에서 field_cron_jwt 값만 바꾸면 12개가 같이 바뀐다.
--   SQL 로 하려면: select vault.update_secret((select id from vault.secrets where name = 'field_cron_jwt'), '<새 anon 키>');
--   (그 한 줄은 파일로 저장하지 말 것)
-- ============================================================================

begin;

-- 0) 비노출 스키마 ---------------------------------------------------------------
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

-- 1) vault 비밀 — 지금 cron 명령에서 꺼낸다(없을 때만) -------------------------------
do $$
declare
  jwt text;
  p   text;
begin
  -- 가드 ③: 박힌 키가 여러 종류면 어느 것을 넣을지 모르므로 중단(교체가 끝난 뒤 재실행이면 0종류 — 통과)
  if (select count(distinct substring(command from 'Bearer (eyJ[A-Za-z0-9_.-]+)')) from cron.job where command ~ 'Bearer eyJ') > 1 then
    raise exception 'cron 명령에 서로 다른 JWT 가 2개 이상 — 중단(어느 키를 vault 에 넣을지 사람이 정할 것)';
  end if;
  if exists (select 1 from vault.secrets where name = 'field_cron_jwt') then
    raise notice 'vault field_cron_jwt 이미 있음 — 건너뜀';
    return;
  end if;
  select substring(command from 'Bearer (eyJ[A-Za-z0-9_.-]+)') into jwt
    from cron.job where jobname = 'customer-message-dispatch';
  if jwt is null then
    select substring(command from 'Bearer (eyJ[A-Za-z0-9_.-]+)') into jwt
      from cron.job where command ~ 'Bearer eyJ' order by jobid limit 1;
  end if;
  if jwt is null then
    raise exception 'cron 명령에서 JWT 를 찾지 못했습니다 — 대시보드 Vault 에 field_cron_jwt(anon 키)를 직접 만든 뒤 다시 실행';
  end if;
  p := split_part(jwt, '.', 2);
  p := translate(p, '-_', '+/') || repeat('=', (4 - length(p) % 4) % 4);
  if convert_from(decode(p, 'base64'), 'UTF8')::jsonb ->> 'role' is distinct from 'anon' then
    raise exception 'cron 에 박힌 키가 anon 이 아닙니다 — 중단(서비스 키를 vault 에 넣지 않는다)';
  end if;
  perform vault.create_secret(jwt, 'field_cron_jwt', 'pg_cron → 엣지 함수 호출용 공개 anon JWT (2026-10-24, service_role 아님)');
end $$;

-- 2) 호출 기록 표 ----------------------------------------------------------------
create table if not exists ops.edge_calls (
  request_id  bigint primary key,          -- net.http_post 가 돌려준 id = net._http_response.id
  tag         text not null,               -- 보통 cron 이름
  fn          text not null,               -- 엣지 함수 이름
  timeout_ms  int,
  called_at   timestamptz not null default now(),
  status_code int,
  timed_out   boolean,
  error_msg   text,
  body_head   text,                        -- 4xx·5xx 일 때 응답 앞 300자
  checked_at  timestamptz
);
create index if not exists edge_calls_called_idx on ops.edge_calls (called_at desc);
create index if not exists edge_calls_open_idx on ops.edge_calls (request_id) where checked_at is null;
alter table ops.edge_calls enable row level security;          -- 정책 없음 = anon 은 못 본다(스키마 사용권도 없음). postgres 는 소유자라 통과.
revoke all on table ops.edge_calls from public, anon, authenticated;

create table if not exists ops.cron_command_backup (
  jobid     bigint primary key,
  jobname   text,
  schedule  text,
  command   text not null,                 -- 원래 명령(키 포함) — 그래서 ops 스키마·RLS·권한 없음
  saved_at  timestamptz not null default now()
);
alter table ops.cron_command_backup enable row level security;
revoke all on table ops.cron_command_backup from public, anon, authenticated;

-- 3) 호출 도우미 ------------------------------------------------------------------
create or replace function ops.call_edge(p_fn text, p_body jsonb default '{}'::jsonb, p_timeout_ms int default 30000, p_tag text default null)
returns bigint
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  jwt text;
  rid bigint;
  t   int := greatest(1000, least(coalesce(p_timeout_ms, 30000), 300000));
begin
  if p_fn is null or p_fn !~ '^[a-z0-9][a-z0-9-]{0,62}$' then
    raise exception 'ops.call_edge: 함수 이름 형식 오류 (%)', p_fn;
  end if;
  select decrypted_secret into jwt from vault.decrypted_secrets where name = 'field_cron_jwt' limit 1;
  if coalesce(jwt, '') = '' then
    raise exception 'ops.call_edge: vault 비밀 field_cron_jwt 가 없습니다';   -- cron 기록이 failed 로 남아 감시에 걸린다
  end if;
  rid := net.http_post(
    url                  := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/' || p_fn,
    body                 := coalesce(p_body, '{}'::jsonb),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || jwt),
    timeout_milliseconds := t);
  insert into ops.edge_calls (request_id, tag, fn, timeout_ms) values (rid, coalesce(p_tag, p_fn), p_fn, t)
    on conflict (request_id) do nothing;
  return rid;
end $$;
revoke all on function ops.call_edge(text, jsonb, int, text) from public, anon, authenticated;

-- 4) 감시 뷰 ----------------------------------------------------------------------
create or replace view ops.edge_call_status as
select c.request_id, c.tag, c.fn, c.called_at, c.timeout_ms,
       coalesce(c.status_code, r.status_code) as status_code,
       coalesce(c.timed_out, r.timed_out)     as timed_out,
       coalesce(c.error_msg, r.error_msg)     as error_msg,
       c.body_head,
       case
         when coalesce(c.status_code, r.status_code) between 200 and 299 then 'ok'
         when coalesce(c.status_code, r.status_code) is not null          then 'http_error'
         when coalesce(c.timed_out, r.timed_out)                          then 'no_wait'
         when coalesce(c.error_msg, r.error_msg) is not null              then 'net_error'
         when c.called_at > now() - make_interval(secs => coalesce(c.timeout_ms, 30000) / 1000.0 + 120) then 'pending'
         else 'lost'
       end as state
  from ops.edge_calls c
  left join net._http_response r on r.id = c.request_id;

create or replace view ops.edge_call_health as
select tag, fn,
       count(*) filter (where called_at > now() - interval '1 hour')                                      as calls_1h,
       count(*) filter (where called_at > now() - interval '1 hour' and state not in ('ok', 'pending'))   as bad_1h,
       count(*)                                                                                           as calls_24h,
       count(*) filter (where state = 'ok')                                                               as ok_24h,
       count(*) filter (where state = 'http_error')                                                       as http_error_24h,
       count(*) filter (where state = 'no_wait')                                                          as no_wait_24h,
       count(*) filter (where state in ('net_error', 'lost'))                                             as net_error_24h,
       max(called_at) filter (where state = 'ok')                                                         as last_ok_at,
       max(called_at)                                                                                     as last_called_at
  from ops.edge_call_status
 where called_at > now() - interval '24 hours'
 group by tag, fn;
revoke all on ops.edge_call_status, ops.edge_call_health from public, anon, authenticated;

-- 5) 원래 명령 백업(처음 것만) ----------------------------------------------------------
insert into ops.cron_command_backup (jobid, jobname, schedule, command)
select jobid, jobname, schedule, command from cron.job where command ~ 'Bearer eyJ'
on conflict (jobid) do nothing;

-- 6) 명령 교체 — 이름으로 찾는다. 비밀이 없으면 아무것도 바꾸지 않고 중단 ---------------------
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'field_cron_jwt' and coalesce(decrypted_secret, '') <> '') then
    raise exception 'vault field_cron_jwt 가 없어 cron 교체를 중단합니다';
  end if;
  -- 가드 ①: 다른 사용자 소유 job 을 postgres 가 바꾸면 실행 주체가 달라진다 — 키 박힌 job 은 모두 current_user 소유여야 한다
  if exists (select 1 from cron.job where command ~ 'Bearer eyJ' and username <> current_user) then
    raise exception 'JWT 박힌 cron 중 소유자가 % 아닌 것이 있음 — 중단: %', current_user,
      (select string_agg(jobid || ':' || jobname || '(' || username || ')', ', ') from cron.job where command ~ 'Bearer eyJ' and username <> current_user);
  end if;
  -- 가드 ②: 대상 12개 이름이 모두 있어야 한다(이름이 바뀌었거나 지워진 job 이 있으면 일부만 바뀌는 것을 막는다)
  if (select count(distinct jobname) from cron.job where jobname in (
        'customer-message-dispatch', 'field-sheet-retry', 'photo-drive-archive', 'naver-calendar-sync', 'contact-sheet-share',
        'weekly-keyman-poster', 'kakao-bot-watchdog', 'contact-sheet-pull-daily', 'contact-sheet-pull-before-briefing',
        'counter-inbox-ingest', 'solapi-import', 'worker-watchdog')) <> 12 then
    raise exception '대상 cron 12개 중 없는 이름이 있음 — 중단(select jobid, jobname from cron.job order by jobid; 로 확인)';
  end if;
  -- 가드 ③(교체 직전 한 번 더)
  if (select count(distinct substring(command from 'Bearer (eyJ[A-Za-z0-9_.-]+)')) from cron.job where command ~ 'Bearer eyJ') > 1 then
    raise exception 'cron 명령에 서로 다른 JWT 가 2개 이상 — 중단';
  end if;

  -- 3 customer-message-dispatch (매분) 5초 → 30초 (함수 최대 7.3초)
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('customer-message-send', '{"action":"dispatch_due"}'::jsonb, 30000, 'customer-message-dispatch');$c$)
     from cron.job where jobname = 'customer-message-dispatch';
  -- 4 field-sheet-retry (2분) 5초 → 30초 (최대 16.5초)
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('field-sheet-sync', '{"action":"retry_pending"}'::jsonb, 30000, 'field-sheet-retry');$c$)
     from cron.job where jobname = 'field-sheet-retry';
  -- 5 photo-drive-archive (매시 25분) 5초 → 150초 (사진 60장 옮김)
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('photo-drive-archive', '{"action":"archive","days":90,"limit":60}'::jsonb, 150000, 'photo-drive-archive');$c$)
     from cron.job where jobname = 'photo-drive-archive';
  -- 8 naver-calendar-sync (매분) 5초 → 60초 (평균 5.8초, 최대 48초)
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('naver-calendar-sync', '{"action":"sync3"}'::jsonb, 60000, 'naver-calendar-sync');$c$)
     from cron.job where jobname = 'naver-calendar-sync';
  -- 9 contact-sheet-share (3분) 55초 그대로
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('contact-sheet-pull', '{"days":21}'::jsonb, 55000, 'contact-sheet-share');$c$)
     from cron.job where jobname = 'contact-sheet-share';
  -- 10 weekly-keyman-poster (월 10:30 KST) 300초 그대로
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('weekly-keyman-poster', '{"action":"run","ifMissing":true}'::jsonb, 300000, 'weekly-keyman-poster');$c$)
     from cron.job where jobname = 'weekly-keyman-poster';
  -- 12 kakao-bot-watchdog (매시 20분) — 앞의 [봇점검] 청소 delete 는 그대로, 푸시 20초 그대로
  perform cron.alter_job(jobid, command := $c$
  delete from outbox where text like '%[봇점검]' and created_at < now() - interval '6 hours';
  select ops.call_edge('push-send', jsonb_build_object(
      'title', '카톡봇이 잠든 방이 있어요',
      'body', coalesce((select string_agg(distinct room, ', ') from outbox where created_at < now() - interval '30 minutes'), '') || ' — 그 방에 아무 메시지나 한 번 보내면 살아납니다',
      'tag', 'bot-stale',
      'category', 'admin',
      'targets', jsonb_build_array('이민구')
    ), 20000, 'kakao-bot-watchdog')
  where exists (select 1 from outbox where created_at < now() - interval '30 minutes');
$c$)
     from cron.job where jobname = 'kakao-bot-watchdog';
  -- 17 contact-sheet-pull-daily (10:00 KST) 120초 그대로
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('contact-sheet-pull', '{"days":60}'::jsonb, 120000, 'contact-sheet-pull-daily');$c$)
     from cron.job where jobname = 'contact-sheet-pull-daily';
  -- 18 contact-sheet-pull-before-briefing (월 09:30 KST) 120초 그대로
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('contact-sheet-pull', '{"days":30,"share":false}'::jsonb, 120000, 'contact-sheet-pull-before-briefing');$c$)
     from cron.job where jobname = 'contact-sheet-pull-before-briefing';
  -- 21 counter-inbox-ingest (2분, 미처리 있을 때만) 25초 그대로
  perform cron.alter_job(jobid, command := $c$
  select ops.call_edge('counter-inbox-ingest', '{}'::jsonb, 25000, 'counter-inbox-ingest')
  where exists (select 1 from public.counter_sms_inbox where applied_at is null and (note is null or note not like '자동 처리 실패%'));
$c$)
     from cron.job where jobname = 'counter-inbox-ingest';
  -- 22 solapi-import (23:50 KST) 120초 그대로
  perform cron.alter_job(jobid, command := $c$select ops.call_edge('customer-message-send', '{"action":"import_history","days":3}'::jsonb, 120000, 'solapi-import');$c$)
     from cron.job where jobname = 'solapi-import';
  -- 23 worker-watchdog (10분) — 심박 판정 update 그대로, 푸시 20초 그대로
  perform cron.alter_job(jobid, command := $c$
  with stale as (
    update public.worker_heartbeat
       set alerted_at = now()
     where name = (select name from public.worker_heartbeat order by last_seen desc limit 1)
       and last_seen < now() - interval '15 minutes'
       and (alerted_at is null or alerted_at < now() - interval '2 hours')
    returning name, host, last_seen
  )
  select ops.call_edge('push-send', jsonb_build_object(
      'title', '노트북 작업 실행기가 멈췄어요',
      'body', (select string_agg(name || ' 마지막 심박 ' || to_char(last_seen at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), ', ') from stale)
              || ' — 노트북 전원·로그인·작업 스케줄러(FIRSTOA Worker)를 확인하세요',
      'tag', 'worker-stale',
      'category', 'admin',
      'targets', jsonb_build_array('이민구')
    ), 20000, 'worker-watchdog')
  where exists (select 1 from stale);
$c$)
     from cron.job where jobname = 'worker-watchdog';
end $$;

-- 7) 응답 옮겨 적기 cron (5분마다, HTTP 없음) ---------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'edge-call-collect';
select cron.schedule('edge-call-collect', '*/5 * * * *', $c$
  update ops.edge_calls c
     set status_code = r.status_code,
         timed_out   = r.timed_out,
         error_msg   = left(r.error_msg, 300),
         body_head   = case when r.status_code >= 400 then left(r.content, 300) end,
         checked_at  = now()
    from net._http_response r
   where r.id = c.request_id and c.checked_at is null;
  delete from ops.edge_calls where called_at < now() - interval '7 days';
$c$);

commit;

-- ---------------------------------------------------------------------------
-- 확인 (실행 직후)
select 'JWT 남은 cron' as 항목, count(*)::text as 값 from cron.job where command ~ 'Bearer eyJ'                 -- 기대: 0
union all select 'ops.call_edge 쓰는 cron', count(*)::text from cron.job where command like '%ops.call_edge%'    -- 기대: 12
union all select 'vault field_cron_jwt', count(*)::text from vault.secrets where name = 'field_cron_jwt'          -- 기대: 1
union all select '백업된 원래 명령', count(*)::text from ops.cron_command_backup                                   -- 기대: 12
union all select 'edge-call-collect', coalesce((select active::text || ' ' || schedule from cron.job where jobname = 'edge-call-collect'), '없음')
union all select 'anon ops 사용권', has_schema_privilege('anon', 'ops', 'USAGE')::text                            -- 기대: false
union all select 'anon call_edge 실행', has_function_privilege('anon', 'ops.call_edge(text, jsonb, int, text)', 'EXECUTE')::text; -- 기대: false
-- 2~3분 뒤:
--   select tag, state, status_code, timed_out, called_at at time zone 'Asia/Seoul' from ops.edge_call_status order by called_at desc limit 20;
--     → customer-message-dispatch·naver-calendar-sync 가 ok(200). 'pending' 은 아직 응답 대기.
--   select * from ops.edge_call_health order by bad_1h desc, tag;   ← ops-monitor 가 보는 요약
--   select jobid, status, return_message, start_time at time zone 'Asia/Seoul' from cron.job_run_details
--    where start_time > now() - interval '10 minutes' and status <> 'succeeded';   → 0행
--   앱: 일정리스트 새 네이버 일정 들어옴, 고객 문자 예약 발송, 카운터 도착함 자동 반영(2분)이 그대로인지.

-- ---------------------------------------------------------------------------
-- 되돌리기 (주석을 풀어 실행) — 12개 명령을 원래 글자 그대로 되돌린다(키 포함 원문, 5초 기본 타임아웃 포함).
-- select cron.alter_job(b.jobid, command := b.command) from ops.cron_command_backup b join cron.job j on j.jobid = b.jobid;
-- select cron.unschedule(jobid) from cron.job where jobname = 'edge-call-collect';
-- 완전히 지우려면(명령을 되돌린 뒤에만):
-- drop view if exists ops.edge_call_health; drop view if exists ops.edge_call_status;
-- drop function if exists ops.call_edge(text, jsonb, int, text);
-- drop table if exists ops.edge_calls;
-- -- ops.cron_command_backup 은 다시 쓸 일이 없다고 확인한 뒤 drop. vault 비밀은 대시보드 Vault 에서 지운다.

-- 이 표·뷰는 앱(anon)에서 보지 않는다(비노출 스키마). 프런트에서 보려면 따로 public 뷰 + grant 를 만드는 작업이 필요(문서 (B) 선택 항목).
-- 엣지 함수를 새 cron 으로 부를 때 쓰는 한 줄(키 글자 없이):
--   select cron.schedule('<이름>', '<일정>', $c$select ops.call_edge('<함수>', '{"action":"..."}'::jsonb, 30000, '<이름>');$c$);
