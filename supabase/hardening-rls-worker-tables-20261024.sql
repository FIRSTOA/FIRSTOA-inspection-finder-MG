-- ============================================================================
-- RLS 꺼진 표 4개에 최소 정책 — worker_jobs · worker_heartbeat · room_activity · counter_sms_inbox — 2026-10-24 · 데이터실 표다빈
-- SQL Editor 에서 통째로 1회 실행(한 트랜잭션 — 중간 실패면 전부 취소). 두 번 실행해도 안전(drop policy if exists → create).
-- 설계: docs/tasks/db-hardening-2026-10-24.md (C). anon-permissions-20261019.sql 의 "2단계(주석)"를 실측에 맞춰 좁힌 판이다
--   — 그 파일의 2-1·2-2 는 실행하지 말고 이 파일로 대신한다.
-- 실행 시각: 평일 낮(봇·노트북이 살아 있고 사람이 화면을 볼 때). 10분 관찰 표는 문서 (C).
--
-- 왜: docs/tasks/risk-audit-2026-10-24.md 요약 5. 공개 anon 키만 있으면
--   · worker_jobs 에 아무 일감(relay·poster·backup·ping·kakao_photo 를 아무 방으로)이나 넣어 노트북 카톡 PC 로 보내게 할 수 있고,
--   · worker_heartbeat.last_seen 을 먼 미래로 써서 worker-watchdog 경보를 영영 끌 수 있고,
--   · 일감의 payload 를 고쳐 다른 방·다른 사진을 보내게 할 수 있다(UPDATE 가 모든 열에 열려 있음).
--
-- 누가 무엇을 쓰나 (코드 grep, 2026-10-24) — 이 범위만 열어 둔다:
--   worker_jobs      앱(anon) INSERT kind='kakao_photo' {kind,payload,created_by} — SupplyBoard.tsx:210, counterSmsPhoto.ts:152
--                    노트북 worker.py(anon, Python-urllib) SELECT queued + PATCH {status,claimed_at,claimed_by,finished_at,result,error}
--                    (claim·done·failed·멈춘 일감 재대기 — worker.py:120,122,129,140,143)
--                    ping·backup·relay·poster 일감은 사람이 SQL Editor(postgres)로 넣는다 — RLS 영향 없음(tools/worker/README.md:58)
--   worker_heartbeat 노트북 upsert on_conflict=name {name,host,version,note,last_seen} (worker.py:45), 앱 SELECT,
--                    cron worker-watchdog(postgres) UPDATE alerted_at — 소유자라 RLS 영향 없음
--   room_activity    봇 upsert {room,last_at,source:'message'} (supabase-outbox-poller.js:101), 카톡 PC upsert source:'pc_send'
--                    (outbox_relay.py:83), 앱 SELECT. 'bot_send' 는 outbox 트리거 log_outbox_delivery(SECURITY DEFINER, 소유자) — 영향 없음
--   counter_sms_inbox 봇 INSERT {room,sender,text,received_at} (supabase-outbox-poller.js:212), 앱 SELECT·PATCH
--                    {applied_at,applied_by,batch_id,note} (CounterSms.tsx:204), 엣지 counter-inbox-ingest 는 service_role(RLS 우회)
--
-- 라이브 실측(MCP 읽기, 2026-10-24 — "DB 에서 본 값"):
--   · 4개 모두 relrowsecurity=false, 정책 0. anon: SELECT·INSERT·UPDATE=true, DELETE=false, TRUNCATE=false (10/19 1단계 실행됨).
--   · worker_jobs 0행(완료 일감도 남아 있지 않음). worker_heartbeat 1행 worker@D6110. room_activity 40행(message 30·bot_send 9·pc_send 1).
--     counter_sms_inbox 18행, text 최대 500자. room_map 26행(TEST_ROOM '테스트 전용방' 은 room_map 에 없음 → 아래 조건에 따로 넣음).
--   · 표 소유자 postgres, FORCE RLS 아님 → cron·트리거(소유자 권한)는 정책과 무관.
-- 권한나 검사(2026-10-24): 실행 금지 없음, 고친 뒤 실행 — 반영함: 사진 일감 방 비교를 btrim 양쪽으로,
--   COUNTER_KAKAO_ROOM 경로 추가. 팀장 사전 조회: room_map 마감|C = '강남,지방(수도권C,D,E)일반마감방', COUNTER_KAKAO_ROOM 도 같은 값.
-- 한계: anon 키가 공개인 한 "실행기만 심박을 쓴다"는 DB 로 증명할 수 없다. 여기서는 값의 범위(미래 시각·종류·방)를 막는다.
--   실행기 전용 비밀이 필요하면 문서 (C) 후속 — x-worker-token 헤더 + 정책 검사(실행기 코드 수정).
-- ============================================================================

begin;

-- ── worker_jobs ───────────────────────────────────────────────────────────
alter table public.worker_jobs enable row level security;

drop policy if exists "worker_jobs anon select" on public.worker_jobs;
create policy "worker_jobs anon select" on public.worker_jobs
  for select to anon, authenticated using (true);

-- 앱이 넣는 사진 일감만. 방은 카톡방 매핑(room_map)에 있는 방, 옛 설정 COUNTER_KAKAO_ROOM(counterSmsPhoto.ts:107-113 —
-- room_map 에 마감방이 없을 때 쓰는 경로), 또는 테스트방. 앱이 방 이름을 trim 해서 쓰므로(str()) 양쪽 btrim 으로 비교.
drop policy if exists "worker_jobs anon insert kakao_photo" on public.worker_jobs;
create policy "worker_jobs anon insert kakao_photo" on public.worker_jobs
  for insert to anon, authenticated
  with check (
    kind = 'kakao_photo'
    and status = 'queued'
    and claimed_at is null and claimed_by is null and finished_at is null and result is null and error is null
    and run_at <= now() + interval '10 minutes'
    and coalesce(worker_jobs.payload ->> 'room', '') <> ''
    and (exists (select 1 from public.room_map m where btrim(m.room) = btrim(worker_jobs.payload ->> 'room'))
         or btrim(worker_jobs.payload ->> 'room') = (select btrim(c.value) from public.app_config c where c.key = 'COUNTER_KAKAO_ROOM')
         or btrim(worker_jobs.payload ->> 'room') = (select btrim(c.value) from public.app_config c where c.key = 'TEST_ROOM'))
  );

-- 실행기 상태 바꾸기: 끝난(done·failed) 일감은 다시 못 건드린다
drop policy if exists "worker_jobs anon update state" on public.worker_jobs;
create policy "worker_jobs anon update state" on public.worker_jobs
  for update to anon, authenticated
  using (status in ('queued', 'running'))
  with check (status in ('queued', 'running', 'done', 'failed'));

revoke insert, update on table public.worker_jobs from anon, authenticated;
grant insert (kind, payload, created_by) on table public.worker_jobs to anon, authenticated;                       -- 나머지는 기본값
grant update (status, claimed_at, claimed_by, finished_at, result, error) on table public.worker_jobs to anon, authenticated; -- payload·kind 고치기 불가
grant select on table public.worker_jobs to anon, authenticated;
grant usage on sequence public.worker_jobs_id_seq to anon, authenticated;   -- 이미 있으면 그대로(기본 권한), 없으면 insert 가 막혀서 명시

-- ── worker_heartbeat ──────────────────────────────────────────────────────
alter table public.worker_heartbeat enable row level security;

drop policy if exists "worker_heartbeat anon select" on public.worker_heartbeat;
create policy "worker_heartbeat anon select" on public.worker_heartbeat
  for select to anon, authenticated using (true);

-- upsert(merge-duplicates) = INSERT ... ON CONFLICT DO UPDATE → insert·update 정책 둘 다 필요.
-- 미래 시각 금지(경보 끄기 방지): 노트북 시계 오차 15분까지 허용.
drop policy if exists "worker_heartbeat anon insert" on public.worker_heartbeat;
create policy "worker_heartbeat anon insert" on public.worker_heartbeat
  for insert to anon, authenticated
  with check (name like 'worker@%' and last_seen <= now() + interval '15 minutes' and coalesce(length(note), 0) <= 500);

drop policy if exists "worker_heartbeat anon update" on public.worker_heartbeat;
create policy "worker_heartbeat anon update" on public.worker_heartbeat
  for update to anon, authenticated
  using (true)
  with check (name like 'worker@%' and last_seen <= now() + interval '15 minutes' and coalesce(length(note), 0) <= 500);

revoke insert, update on table public.worker_heartbeat from anon, authenticated;
grant insert (name, host, version, note, last_seen) on table public.worker_heartbeat to anon, authenticated;
grant update (name, host, version, note, last_seen) on table public.worker_heartbeat to anon, authenticated;   -- alerted_at 은 cron 만
grant select on table public.worker_heartbeat to anon, authenticated;

-- ── room_activity ─────────────────────────────────────────────────────────
alter table public.room_activity enable row level security;

drop policy if exists "room_activity anon select" on public.room_activity;
create policy "room_activity anon select" on public.room_activity
  for select to anon, authenticated using (true);

-- 봇 'message'·카톡 PC 'pc_send' 만. 'bot_send' 는 트리거(소유자)만 쓴다. 폰 시계 오차 1시간까지 허용.
drop policy if exists "room_activity anon insert" on public.room_activity;
create policy "room_activity anon insert" on public.room_activity
  for insert to anon, authenticated
  with check (source in ('message', 'pc_send') and last_at <= now() + interval '1 hour' and length(room) between 1 and 200);

drop policy if exists "room_activity anon update" on public.room_activity;
create policy "room_activity anon update" on public.room_activity
  for update to anon, authenticated
  using (true)
  with check (source in ('message', 'pc_send') and last_at <= now() + interval '1 hour' and length(room) between 1 and 200);

revoke insert, update on table public.room_activity from anon, authenticated;
grant insert (room, last_at, source) on table public.room_activity to anon, authenticated;
grant update (room, last_at, source) on table public.room_activity to anon, authenticated;
grant select on table public.room_activity to anon, authenticated;

-- ── counter_sms_inbox ─────────────────────────────────────────────────────
alter table public.counter_sms_inbox enable row level security;

drop policy if exists "counter_sms_inbox anon select" on public.counter_sms_inbox;
create policy "counter_sms_inbox anon select" on public.counter_sms_inbox
  for select to anon, authenticated using (true);

-- 봇은 "아직 처리 안 된 글"만 넣을 수 있다(처리 표시를 미리 붙여 넣기 불가).
drop policy if exists "counter_sms_inbox anon insert" on public.counter_sms_inbox;
create policy "counter_sms_inbox anon insert" on public.counter_sms_inbox
  for insert to anon, authenticated
  with check (applied_at is null and applied_by is null and batch_id is null and note is null and length(text) <= 20000);

-- 앱의 [직접 넣기] 처리 표시
drop policy if exists "counter_sms_inbox anon update" on public.counter_sms_inbox;
create policy "counter_sms_inbox anon update" on public.counter_sms_inbox
  for update to anon, authenticated
  using (true) with check (true);

revoke insert, update on table public.counter_sms_inbox from anon, authenticated;
grant insert (room, sender, text, received_at) on table public.counter_sms_inbox to anon, authenticated;
grant update (applied_at, applied_by, batch_id, note) on table public.counter_sms_inbox to anon, authenticated;  -- 글 내용(text)은 못 고침
grant select on table public.counter_sms_inbox to anon, authenticated;
grant usage on sequence public.counter_sms_inbox_id_seq to anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- 확인 (실행 직후)
select c.relname as 표, c.relrowsecurity as rls,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as 정책수,
       has_table_privilege('anon', c.oid, 'DELETE') as anon_delete
  from pg_class c
 where c.oid in ('public.worker_jobs'::regclass, 'public.worker_heartbeat'::regclass, 'public.room_activity'::regclass, 'public.counter_sms_inbox'::regclass);
-- 기대: rls 4개 모두 true · 정책수 worker_jobs 3, 나머지 3 · anon_delete false
-- 10분 관찰(문서 (C) 표): worker_heartbeat.last_seen 1~2분 안 · room_activity 새 message/pc_send · 카운터 도착함 · 사진 일감 done.
-- 에러 구분: "permission denied for table/column" = grant(열 목록) 문제, "new row violates row-level security policy" = 정책 문제.

-- 시험 블록 (선택, 실행 직후) — anon 흉내. 마지막 rollback 이라 흔적 없음. 막혀야 하는 줄은 하나씩 따로 실행.
-- begin; set local role anon;
--   insert into public.worker_heartbeat (name, host, version, note, last_seen) values ('worker@__test__', 'h', 'v', 'n', now())
--     on conflict (name) do update set host = excluded.host, version = excluded.version, note = excluded.note, last_seen = excluded.last_seen;  -- 통과
--   insert into public.room_activity (room, last_at, source) values ('__test__', now(), 'message')
--     on conflict (room) do update set last_at = excluded.last_at, source = excluded.source;                                                  -- 통과
--   insert into public.counter_sms_inbox (room, sender, text) values ('__test__', '__test__', 'x');                                            -- 통과
--   update public.counter_sms_inbox set applied_at = now(), applied_by = '__test__', batch_id = null, note = 'x' where room = '__test__';     -- 통과
--   update public.worker_jobs set status = 'running', claimed_at = now(), claimed_by = '__test__' where id = -1 and status = 'queued';      -- 통과(0행)
-- rollback;
-- 막혀야 함(각각 따로: begin; set local role anon; <한 줄>; rollback;):
--   insert into public.worker_jobs (kind, payload, created_by) values ('relay', '{}'::jsonb, 'x');                         -- RLS 위반
--   insert into public.worker_jobs (kind, payload, created_by) values ('kakao_photo', '{"room":"아무방"}'::jsonb, 'x');    -- RLS 위반
--   update public.worker_jobs set payload = '{}'::jsonb where id = -1;                                                    -- permission denied (열)
--   insert into public.worker_heartbeat (name, last_seen) values ('worker@x', now() + interval '1 day');                 -- RLS 위반
--   update public.worker_heartbeat set alerted_at = null;                                                                 -- permission denied (열)
--   insert into public.room_activity (room, last_at, source) values ('x', now(), 'bot_send');                            -- RLS 위반

-- ---------------------------------------------------------------------------
-- 되돌리기 (주석을 풀어 실행) — 실행 전과 같은 상태: RLS 끔 + 표 단위 S·I·U (정책은 남아도 RLS 가 꺼지면 무시됨)
-- begin;
-- alter table public.worker_jobs       disable row level security;
-- alter table public.worker_heartbeat  disable row level security;
-- alter table public.room_activity     disable row level security;
-- alter table public.counter_sms_inbox disable row level security;
-- grant select, insert, update on table public.worker_jobs, public.worker_heartbeat, public.room_activity, public.counter_sms_inbox to anon, authenticated;
-- commit;
-- 부분 되돌리기: 한 표만 막히면 그 표만 "disable row level security" + "grant insert, update on ..." 두 줄.

-- 프런트 사용 예 (src/supabase.ts 래퍼만 — 지금 코드 그대로 동작해야 정상):
--   await insertRow("worker_jobs", { kind: "kakao_photo", payload: { room, image_url, caption }, created_by: author });   // room 은 room_map·COUNTER_KAKAO_ROOM·TEST_ROOM 중 하나(앞뒤 공백 무시)
--   const hb = await selectRows<{ last_seen: string }>("worker_heartbeat", "select=last_seen&order=last_seen.desc&limit=1");
--   await updateRows("counter_sms_inbox", `id=eq.${id}`, { applied_at: new Date().toISOString(), applied_by: author, batch_id, note });
