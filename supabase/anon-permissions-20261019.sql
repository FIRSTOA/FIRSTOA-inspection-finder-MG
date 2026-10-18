-- ============================================================================
-- anon 키 권한 줄이기 (2026-10-19 초안 · 데이터실 표다빈)
-- 설계안: docs/tasks/anon-permissions-design.md  ← 실행 전에 반드시 읽을 것
-- 상태: 초안. 아직 사용자에게 건네지 않음(sql-review 통과 후 /sql-handoff 로 건넨다).
--
-- 무엇을 하나
--   1단계(이 파일에서 실제로 실행되는 부분) — 코드가 안 쓰는 권한만 회수. 봇·실행기가 끊길 수 없는 것만.
--     A. 앞으로 생길 표에 anon·authenticated 자동 전권 끊기 (기존 표에는 영향 없음)
--     B. public 의 모든 표에서 TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 회수 (REST·앱·봇·실행기 어디도 안 씀)
--     C. 대상 19개 표: 표마다 필요한 SELECT/INSERT/UPDATE/DELETE 만 다시 grant
--     D. RLS 꺼진 표 중 "웹앱만 쓰는" 10개 표: RLS 켜기 + grant 와 같은 범위의 정책
--   2단계(주석 처리) — 봇·실행기가 쓰는 표의 RLS·컬럼 단위 UPDATE, push_subscriptions 열쇠 컬럼 숨기기.
--     1단계 실행 뒤 하루 이상 심박·outbox 흐름을 본 다음, 시험 블록(T)을 먼저 돌리고 나서.
--
-- 두 번 실행해도 안전: revoke/grant 는 멱등, RLS enable 은 멱등, 정책은 drop if exists 후 create.
-- 비밀값 없음. service_role(엣지 함수·push-send)은 건드리지 않는다 — service_role 은 RLS 를 우회하고 자기 grant 를 그대로 가진다.
-- 크론(pg_cron)·SECURITY DEFINER 함수(log_outbox_delivery 등)는 postgres 권한으로 돌아 영향 없음.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. 앞으로 생길 표: postgres 가 public 에 새로 만드는 표에 anon·authenticated 전권 자동 부여를 끊는다.
--    ※ 이미 있는 표의 권한은 이 줄로 바뀌지 않는다(그건 B·C 가 한다).
--    ※ 이후 새 표 SQL 에는 반드시 "grant select[, insert, update] on public.<표> to anon, authenticated;" 를 직접 적어야 한다.
--      (안 적으면 앱에서 401/42501 permission denied — 원인이 이것임을 db-schema·sql-review 가 알아야 한다)
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. 모든 public 표: TRUNCATE(RLS 를 무시하고 표를 통째로 비움)·REFERENCES·TRIGGER·MAINTAIN 회수.
--    2026-10-19 실측: 87개 표 중 86개에 anon TRUNCATE 가 있었다(naver_oauth 만 없음).
--    앱·봇·실행기·anon 실행 RPC 어디에도 TRUNCATE 없음(pg_proc 검색 0건).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.oid::regclass::text as t
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger, maintain on table %s from anon, authenticated', r.t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- C. 대상 19개 표: 전부 회수한 뒤 필요한 것만 다시 준다(같은 트랜잭션이라 중간에 끊기는 순간 없음).
--    SELECT 는 19개 모두 유지 — 노트북 실행기 02:30 백업(tools/worker/backup_tables.py)이 anon 으로 전 표를 읽는다.
--    근거(코드 grep)는 설계안 표 참고.
-- ---------------------------------------------------------------------------

-- 읽기만: AI 사용량(기록은 엣지 함수 service_role)
revoke all on table public.ai_usage            from anon, authenticated;
grant  select                                  on table public.ai_usage            to anon, authenticated;

-- 읽기·쓰기·수정, 삭제 없음(코드에 DELETE 없음 — 취소·숨김은 UPDATE 로 처리)
revoke all on table public.supply_requests     from anon, authenticated;
grant  select, insert, update                  on table public.supply_requests     to anon, authenticated;
revoke all on table public.supply_events       from anon, authenticated;
grant  select, insert, update                  on table public.supply_events       to anon, authenticated;
revoke all on table public.feedback_items      from anon, authenticated;   -- 삭제는 deleted_at(소프트)
grant  select, insert, update                  on table public.feedback_items      to anon, authenticated;
revoke all on table public.plan_memos          from anon, authenticated;   -- upsert(author,ticket_id)
grant  select, insert, update                  on table public.plan_memos          to anon, authenticated;
revoke all on table public.app_config          from anon, authenticated;   -- 관리 탭은 insert/update 만
grant  select, insert, update                  on table public.app_config          to anon, authenticated;

-- 봇·실행기가 쓰는 표: 쓰는 동작은 그대로 두고 아무도 안 쓰는 DELETE 만 뺀다
revoke all on table public.worker_heartbeat    from anon, authenticated;   -- 실행기 upsert(on_conflict=name), 앱 읽기
grant  select, insert, update                  on table public.worker_heartbeat    to anon, authenticated;
revoke all on table public.worker_jobs         from anon, authenticated;   -- 앱 insert, 실행기 select·PATCH(claim/done/failed)
grant  select, insert, update                  on table public.worker_jobs         to anon, authenticated;
revoke all on table public.room_activity       from anon, authenticated;   -- 봇·카톡PC upsert(merge-duplicates), 앱 읽기
grant  select, insert, update                  on table public.room_activity       to anon, authenticated;
revoke all on table public.counter_sms_inbox   from anon, authenticated;   -- 봇 insert, 앱 읽기·적용 표시 PATCH
grant  select, insert, update                  on table public.counter_sms_inbox   to anon, authenticated;
revoke all on table public.outbox              from anon, authenticated;   -- 앱·실행기 insert, 봇·카톡PC select·DELETE(ack). UPDATE 쓰는 곳 없음
grant  select, insert, delete                  on table public.outbox              to anon, authenticated;

-- 웹앱에서 실제로 지우는 표: 4개 동작 유지(TRUNCATE 등만 빠짐)
revoke all on table public.counter_sms_batches from anon, authenticated;
grant  select, insert, update, delete          on table public.counter_sms_batches to anon, authenticated;
revoke all on table public.counter_sms_targets from anon, authenticated;
grant  select, insert, update, delete          on table public.counter_sms_targets to anon, authenticated;
revoke all on table public.copier_playbook     from anon, authenticated;
grant  select, insert, update, delete          on table public.copier_playbook     to anon, authenticated;
revoke all on table public.vendor_notes        from anon, authenticated;
grant  select, insert, update, delete          on table public.vendor_notes        to anon, authenticated;
revoke all on table public.push_subscriptions  from anon, authenticated;   -- 구독 upsert·해지 delete·prefs update·prefs 읽기
grant  select, insert, update, delete          on table public.push_subscriptions  to anon, authenticated;
revoke all on table public.room_map            from anon, authenticated;
grant  select, insert, update, delete          on table public.room_map            to anon, authenticated;
revoke all on table public.as_tickets          from anon, authenticated;
grant  select, insert, update, delete          on table public.as_tickets          to anon, authenticated;
revoke all on table public.contact_changes     from anon, authenticated;
grant  select, insert, update, delete          on table public.contact_changes     to anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. RLS 꺼진 표 중 웹앱만 쓰는 10개: RLS 켜기 + 정책(grant 와 같은 범위, 조건은 true).
--    앱이 로그인 없이 anon 하나로 쓰므로 행 단위로 사람을 가를 수는 없다 — 목적은
--    "누가 실수로 grant 를 다시 넓혀도 정책에 없는 동작(예: ai_usage 쓰기)은 막히게" 이중 잠금.
--    봇·실행기가 쓰는 4개(worker_heartbeat·worker_jobs·room_activity·counter_sms_inbox)는 2단계.
-- ---------------------------------------------------------------------------

-- ai_usage: 읽기 정책만(쓰기는 service_role 이 RLS 를 우회해서 한다)
alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage anon select" on public.ai_usage;
create policy "ai_usage anon select" on public.ai_usage for select to anon, authenticated using (true);

-- select·insert·update 세 정책 표
do $$
declare t text;
begin
  foreach t in array array['supply_requests', 'supply_events', 'feedback_items', 'plan_memos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || ' anon select', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || ' anon select', t);
    execute format('drop policy if exists %I on public.%I', t || ' anon insert', t);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check (true)', t || ' anon insert', t);
    execute format('drop policy if exists %I on public.%I', t || ' anon update', t);
    execute format('create policy %I on public.%I for update to anon, authenticated using (true) with check (true)', t || ' anon update', t);
  end loop;
end $$;

-- select·insert·update·delete 네 정책 표
do $$
declare t text;
begin
  foreach t in array array['counter_sms_batches', 'counter_sms_targets', 'copier_playbook', 'vendor_notes', 'push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || ' anon select', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || ' anon select', t);
    execute format('drop policy if exists %I on public.%I', t || ' anon insert', t);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check (true)', t || ' anon insert', t);
    execute format('drop policy if exists %I on public.%I', t || ' anon update', t);
    execute format('create policy %I on public.%I for update to anon, authenticated using (true) with check (true)', t || ' anon update', t);
    execute format('drop policy if exists %I on public.%I', t || ' anon delete', t);
    execute format('create policy %I on public.%I for delete to anon, authenticated using (true)', t || ' anon delete', t);
  end loop;
end $$;

commit;


-- ============================================================================
-- T. 시험 블록 — 2단계 전에, 또는 1단계 직후 "봇·실행기 동작이 anon 으로 되는지" 확인용.
--    마지막이 rollback 이라 아무것도 남지 않는다. 한 줄이라도 permission denied / row-level security 가 나면 그 동작이 막힌 것.
--    (SQL Editor 의 postgres 는 set local role anon 으로 anon 을 흉내 낼 수 있다)
-- ============================================================================
-- begin;
-- set local role anon;
-- -- 실행기 심박 upsert (worker.py heartbeat)
-- insert into public.worker_heartbeat (name, host, version, note, last_seen) values ('__test__', 'h', 'v', 'n', now())
--   on conflict (name) do update set host = excluded.host, version = excluded.version, note = excluded.note, last_seen = excluded.last_seen;
-- -- 실행기 일감 claim (조건부 PATCH, 없는 id 라 0행)
-- update public.worker_jobs set status = 'running', claimed_at = now(), claimed_by = '__test__' where id = -1 and status = 'queued';
-- update public.worker_jobs set status = 'done', finished_at = now(), result = 'x', error = null where id = -1;
-- -- 앱 일감 넣기
-- insert into public.worker_jobs (kind, payload, created_by) values ('ping', '{}'::jsonb, '__test__');
-- -- 봇·카톡PC 방 활동 upsert
-- insert into public.room_activity (room, last_at, source) values ('__test__', now(), 'bot_seen')
--   on conflict (room) do update set last_at = excluded.last_at, source = excluded.source;
-- -- 봇 마감 목록 저장 / 앱 적용 표시
-- insert into public.counter_sms_inbox (room, sender, text) values ('__test__', '__test__', 'x');
-- update public.counter_sms_inbox set applied_at = now(), applied_by = '__test__', batch_id = null, note = 'x' where room = '__test__';
-- -- outbox: 앱 insert, 봇 select·delete(ack) — 지우면 트리거가 room_activity 에 bot_send 기록(SECURITY DEFINER)
-- insert into public.outbox (room, text) values ('__test__', 'x');
-- select id from public.outbox where room = '__test__';
-- delete from public.outbox where room = '__test__';
-- -- push 구독 upsert (앱 push.ts)
-- insert into public.push_subscriptions (endpoint, person, team, p256dh, auth, ua, prefs) values ('__test__', 'p', 't', 'k', 'a', 'ua', '{}'::jsonb)
--   on conflict (endpoint) do update set person = excluded.person, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, updated_at = now();
-- select prefs from public.push_subscriptions where endpoint = '__test__';
-- update public.push_subscriptions set prefs = '{}'::jsonb, updated_at = now() where endpoint = '__test__';
-- delete from public.push_subscriptions where endpoint = '__test__';
-- -- 막혀야 하는 것(여기서 에러가 나야 정상 — 확인 후 이 세 줄은 하나씩 따로 돌린다. 에러가 나면 트랜잭션이 끝나므로)
-- -- truncate public.outbox;                       → permission denied 이어야 함
-- -- delete from public.supply_requests where false; → permission denied 이어야 함
-- -- insert into public.ai_usage (fn) values ('x');  → permission denied 이어야 함
-- rollback;


-- ============================================================================
-- 2단계 (주석 처리 — 실행하지 말 것. 1단계 뒤 하루 이상 심박·outbox 정상 + 시험 블록 통과 후)
-- ============================================================================
-- begin;
--
-- -- 2-1. 봇·실행기 표 RLS 켜기 + 정책. upsert(merge-duplicates)는 select·insert·update 정책이 모두 있어야 한다.
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['worker_heartbeat', 'worker_jobs', 'room_activity', 'counter_sms_inbox'] loop
--     execute format('alter table public.%I enable row level security', t);
--     execute format('drop policy if exists %I on public.%I', t || ' anon select', t);
--     execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || ' anon select', t);
--     execute format('drop policy if exists %I on public.%I', t || ' anon insert', t);
--     execute format('create policy %I on public.%I for insert to anon, authenticated with check (true)', t || ' anon insert', t);
--     execute format('drop policy if exists %I on public.%I', t || ' anon update', t);
--     execute format('create policy %I on public.%I for update to anon, authenticated using (true) with check (true)', t || ' anon update', t);
--   end loop;
-- end $$;
--
-- -- 2-2. 컬럼 단위 UPDATE (코드가 고치는 컬럼만). PostgREST upsert 는 보낸 컬럼 전부(키 포함)를 SET 하므로 키 컬럼도 넣는다.
-- revoke update on table public.worker_heartbeat from anon, authenticated;
-- grant  update (name, host, version, note, last_seen) on table public.worker_heartbeat to anon, authenticated;   -- alerted_at 은 크론(postgres)만
-- revoke update on table public.worker_jobs from anon, authenticated;
-- grant  update (status, claimed_at, claimed_by, finished_at, result, error) on table public.worker_jobs to anon, authenticated;
-- revoke update on table public.room_activity from anon, authenticated;
-- grant  update (room, last_at, source) on table public.room_activity to anon, authenticated;
-- revoke update on table public.counter_sms_inbox from anon, authenticated;
-- grant  update (applied_at, applied_by, batch_id, note) on table public.counter_sms_inbox to anon, authenticated;
--
-- -- 2-3. push_subscriptions: 브라우저 열쇠(p256dh·auth)를 anon 이 못 읽게. push-send 는 service_role 이라 계속 읽는다.
-- --      선행 조건 ① tools/worker/backup_tables.py TABLES 에서 push_subscriptions 를 빼거나 select 컬럼을 좁힐 것
-- --                  (안 그러면 02:30 백업이 이 표에서 permission denied — 구독은 브라우저가 다시 만들 수 있어 백업 가치 낮음)
-- --              ② 시험 블록의 push upsert 가 컬럼 SELECT 제한 상태에서도 되는지 확인
-- --                  (ON CONFLICT DO UPDATE 가 excluded.p256dh 를 읽는 데 SELECT 권한을 요구하면 구독 갱신이 막힌다
-- --                   → 그때는 SECURITY DEFINER RPC push_subscribe(...) 로 바꾸는 코드 작업이 먼저)
-- revoke select on table public.push_subscriptions from anon, authenticated;
-- grant  select (endpoint, person, team, ua, created_at, updated_at, prefs) on table public.push_subscriptions to anon, authenticated;
--
-- commit;


-- ============================================================================
-- 되돌리기 (문제가 생기면 이 블록 주석을 풀어 실행 — 1단계 이전 상태로)
-- 실행 전 상태(2026-10-19 실측): naver_oauth 를 뺀 public 의 모든 표에 anon·authenticated 전권(arwdDxtm), 대상 14개 표 RLS 꺼짐.
-- ※ 이 전체 롤백은 TRUNCATE 까지 되살린다. 표 하나가 막힌 것뿐이면 전체 롤백 대신 한 줄만:
--     grant <빠진 동작> on public.<표> to anon, authenticated;   (예: grant delete on public.worker_jobs to anon, authenticated;)
-- 검사(권한나 2026-10-19): 조건부 → 사전 조회 3개 확인 완료. pg_default_acl 소유자 postgres(r: anon=arwdDxtm), public 표 중
--   postgres 소유가 아닌 표 0개(B 절 permission denied 없음), D 절 10개 표에 기존 정책 0개(이중 잠금 유효). PostgreSQL 17.6.
-- ============================================================================
-- begin;
-- alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
-- -- B 되돌리기: 뺀 4가지(TRUNCATE·REFERENCES·TRIGGER·MAINTAIN)만 원래 가졌던 표에 돌려준다
-- do $$
-- declare r record;
-- begin
--   for r in
--     select c.oid::regclass::text as t from pg_class c
--      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
--        and c.relname <> 'naver_oauth'          -- 원래부터 anon 권한 없음 — 되돌리기로 열면 안 된다
--   loop
--     execute format('grant truncate, references, trigger, maintain on table %s to anon, authenticated', r.t);
--   end loop;
-- end $$;
-- -- C 되돌리기: 19개 표 전권(실행 전 실측 상태 그대로)
-- grant all on table public.ai_usage, public.supply_requests, public.supply_events, public.worker_heartbeat, public.worker_jobs,
--   public.feedback_items, public.plan_memos, public.room_activity, public.counter_sms_batches, public.counter_sms_targets,
--   public.counter_sms_inbox, public.copier_playbook, public.vendor_notes, public.push_subscriptions, public.outbox,
--   public.app_config, public.room_map, public.as_tickets, public.contact_changes
--   to anon, authenticated;
-- -- D 되돌리기: RLS 끄기(정책은 남아 있어도 RLS 가 꺼지면 무시된다 — 깔끔히 하려면 drop policy 도)
-- alter table public.ai_usage            disable row level security;
-- alter table public.supply_requests     disable row level security;
-- alter table public.supply_events       disable row level security;
-- alter table public.feedback_items      disable row level security;
-- alter table public.plan_memos          disable row level security;
-- alter table public.counter_sms_batches disable row level security;
-- alter table public.counter_sms_targets disable row level security;
-- alter table public.copier_playbook     disable row level security;
-- alter table public.vendor_notes        disable row level security;
-- alter table public.push_subscriptions  disable row level security;
-- commit;


-- ============================================================================
-- 확인 쿼리 (실행 직후 — 읽기만)
-- ============================================================================
with t(n) as (values
  ('ai_usage'), ('supply_requests'), ('supply_events'), ('worker_heartbeat'), ('worker_jobs'), ('feedback_items'),
  ('plan_memos'), ('room_activity'), ('counter_sms_batches'), ('counter_sms_targets'), ('counter_sms_inbox'),
  ('copier_playbook'), ('vendor_notes'), ('push_subscriptions'), ('outbox'), ('app_config'), ('room_map'),
  ('as_tickets'), ('contact_changes'))
select t.n as 표,
       c.relrowsecurity as rls,
       concat_ws(',',
         case when has_table_privilege('anon', c.oid, 'SELECT')   then 'S' end,
         case when has_table_privilege('anon', c.oid, 'INSERT')   then 'I' end,
         case when has_table_privilege('anon', c.oid, 'UPDATE')   then 'U' end,
         case when has_table_privilege('anon', c.oid, 'DELETE')   then 'D' end,
         case when has_table_privilege('anon', c.oid, 'TRUNCATE') then 'T!' end,
         case when has_table_privilege('anon', c.oid, 'TRIGGER')  then 'Tg!' end,
         case when has_table_privilege('anon', c.oid, 'MAINTAIN') then 'M!' end) as anon,
       concat_ws(',',
         case when has_table_privilege('authenticated', c.oid, 'SELECT') then 'S' end,
         case when has_table_privilege('authenticated', c.oid, 'INSERT') then 'I' end,
         case when has_table_privilege('authenticated', c.oid, 'UPDATE') then 'U' end,
         case when has_table_privilege('authenticated', c.oid, 'DELETE') then 'D' end) as authenticated,
       has_table_privilege('service_role', c.oid, 'SELECT') as service_role_읽기,   -- push-send·엣지 함수용, 계속 true 여야 함
       (select count(*) from pg_policy p where p.polrelid = c.oid) as 정책수
  from t join pg_class c on c.relname = t.n and c.relnamespace = 'public'::regnamespace
 order by 1;
-- 기대값(1단계 직후):
--   ai_usage S / supply_requests·supply_events·feedback_items·plan_memos·app_config·worker_heartbeat·worker_jobs·room_activity·counter_sms_inbox S,I,U
--   outbox S,I,D / 나머지 8개 S,I,U,D / 어디에도 T!·Tg!·M! 없음 / service_role_읽기 전부 true
--   rls: 14개 중 worker_heartbeat·worker_jobs·room_activity·counter_sms_inbox 만 false(2단계)
-- 전체 표 TRUNCATE 남은 수(0 이어야 함):
--   select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and has_table_privilege('anon', c.oid, 'TRUNCATE');
-- 기본 권한(public·postgres 줄에 anon/authenticated 가 없어야 함):
--   select defaclacl from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r';
