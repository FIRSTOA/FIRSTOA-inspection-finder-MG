-- ============================================================================
-- AS 접수 뒤 "방문 판단 안내글" 큐: visit_advice_log + flush_visit_advice() + 크론 (2026-10-31 · 데이터실 표다빈)
-- 설계: docs/tasks/as-reception-visit-advice-2026-10-31.md 3장(데이터)·6장(작업 분해) + 맨 아래 "결정(2026-10-31 사용자)".
-- SQL Editor 에서 통째로 1회 실행. 두 번 실행해도 안전(if not exists · drop policy if exists · create or replace · 같은 이름 cron 덮어씀).
--   앱보다 먼저 실행해도 된다 — VISIT_ADVICE_ENABLED 기본 false 라 크론은 매분 "할 일 없음"으로 끝난다(카톡 0건).
--
-- 왜: AS 접수 글 직후 같은 팀 AS방에 "점검 필요한지 + 앞으로 잡힌 일정" 한 글을 더 올려 중복 방문을 막는다(청오에스떠블유 10-30 사례).
--     판정·글 만들기는 브라우저(entity360 매칭)가 하고, DB 는 "한 접수에 한 번만·10~20시에만·빠짐없이" 를 맡는다.
-- 무엇:
--   1) public.visit_advice_log — 접수 1건 = 1행(reception_id PK = 같은 접수에 두 번 안 보내는 열쇠).
--      status: missing(보충 감지, 아직 글 없음) · queued(보낼 글) · sent(outbox 넣음) · skipped(보낼 일 없음/취소/오래 밀림) · error(방 못 정함 등)
--   2) public.queue_visit_advice(...) RPC(security definer, anon 실행 가능) — 앱이 판정 결과를 넣는 정식 길.
--      새 행이면 insert, 이미 'missing' 으로 감지된 행이면 앱 결과로 바꿔 끼운다(그 외 상태는 건드리지 않음 = 중복 발송 없음).
--      p_send=false 면 status 'skipped'(사용자 결정 Q1 "할 일 있을 때만" — 불필요+추가일정 없음). 이 행이 있어야 보충 감지에 안 걸린다.
--   3) public.flush_visit_advice() (security definer, 크론 전용 — anon 실행 불가) 매분:
--      a. 오래 밀린 queued(due_at + 6시간 지남) → skipped('stale') — 스위치를 켤 때 옛 글이 몰려 나가지 않게(설계 3-2 ③)
--      b. 접수가 지워졌거나(deleted) 처리여부 접수취소·중복접수 → skipped
--      c. VISIT_ADVICE_ENABLED 꺼짐 / KST 10:00~19:59 밖이면 여기서 끝(보내지 않음)
--      d. 보충 감지(사용자 결정 "누락 절대 없어야"): 어제(KST)부터 전송된 복합기 AS 접수(sent_room 있음, 안 지움) +
--         CS 방문이관된 IT 접수(remote_meta.result='방문이관') 중 log 에 행이 없는 것 → status 'missing' 행 생성
--         · 첫 앱 행이 생기기 전에는 감지하지 않는다(기능 켜기 전 접수가 한꺼번에 '판단불가' 로 나가는 것 방지)
--      e. 'missing' 이 VISIT_ADVICE_MISSING_GRACE_MIN(기본 10분) 동안 앱 결과로 안 바뀌면 → "판단불가(자료 못 읽음)" 글로 queued
--         (브라우저가 닫혀 판정을 못 한 경우. 결정: 건너뛰지 말고 판단불가 글로 보낸다). 방을 못 정하면 status 'error'.
--      f. FIELD_KAKAO_SEND_ENABLED 꺼짐(전체 비상 정지)이면 보내지 않는다.
--      g. due_at ≤ now 이고 queued 인 행 최대 20개 → outbox(room, text) insert → sent·sent_at·outbox_id.
--   4) app_config 기본값 6키(없을 때만 넣음 — 관리 탭에서 바꾼 값은 재실행해도 그대로).
--   5) pg_cron 'visit-advice-flush' '* 1-10 * * *'(UTC) = KST 10:00~19:59 매분. 순수 SQL(엣지·vault·HTTP 없음).
--      10시 정각·20시 경계는 함수 안에서 KST 시각으로 한 번 더 막는다(카톡 자동 글 규칙: KST 10시 이후만).
-- 바꾸지 않는 것: service_receptions·outbox·room_map·app_config 의 열·정책·권한·트리거. 메신저봇·outbox_relay.py.
--
-- 라이브 실측(MCP 읽기, 2026-10-31 — "DB 에서 본 값"):
--   · public.visit_advice_log 없음. cron 에 visit% 없음. app_config 에 VISIT_ADVICE_* 없음.
--   · outbox = id uuid default gen_random_uuid() · room text not null · text text not null · created_at. RLS 켬, 정책 "anon all".
--     AFTER DELETE 트리거 2개(outbox_delivery_log·outbox_delivery_record) → 배달되면 kakao_delivery_log(outbox_id) 에 남는다.
--   · service_receptions.id uuid · type check(원격이관|복합기 AS|IT|경영지원|운영지원|영업팀) · status 실제 값 접수·전송완료·익일·진행중·완료·원격대기
--     (설계에 적힌 '접수취소'·'중복접수' 는 지금 데이터에 없음 — 그래도 막아 둔다) · deleted boolean · sent_room text · region 은 '수도권C'·'지방' 같은 글자.
--     CS 방문이관은 type 을 바꾸지 않고 remote_meta {result:'방문이관', csTransferAt:'YYYY-MM-DD'} 만 쓴다(src/ServiceReception.tsx transferToCs) — IT 이관 실측 0건.
--   · room_map(category, region) PK, AS|A~E 5행(강북A as·강서B as·강남C as·경기D as·충청외E 극지방 as).
--   · app_config(key PK, value) — TEST_MODE=false · TEST_ROOM=테스트 전용방 · FIELD_KAKAO_SEND_ENABLED=true. 트리거 2개(app_config_audit·guard).
--   · DB TimeZone = UTC. pg_default_acl 이 anon 에 새 표 권한을 주지 않는다(아래에서 명시 grant).
-- 파일에 적힌 값과 다른 점: 앱 방 규칙(src/api.ts sendServiceReception)은 TEST_MODE 값이 없으면 "켜짐"으로 본다(isTestModeValue) — 아래 보충 방 계산도 같게.
--
-- 앱이 지킬 것(표만으로는 강제 못 함 — 구현 B):
--   · 접수 글 전송 성공 뒤 rpc('queue_visit_advice', ...) 1회. 판정이 "불필요 + 추가일정 없음" 이어도 p_send=false 로 **반드시 부른다**
--     (안 부르면 10분 뒤 보충이 '판단불가' 글을 보낸다).
--   · p_room = 접수 글이 실제로 나간 방(sent_room). 함수가 AS방·테스트방·그 접수의 sent_room 외 방은 거절한다.
--   · p_due_at = adviceDueAt(now) 결과(야간·주말 → 다음 영업일 10:00 KST). 공휴일은 SQL 이 모른다 — 앱이 정한 값을 그대로 쓴다.
-- 되돌리기: 맨 아래 주석.
-- ============================================================================

begin;

-- 1) 표 ----------------------------------------------------------------------
create table if not exists public.visit_advice_log (
  reception_id uuid primary key,                     -- service_receptions.id. FK 일부러 없음(그 표에 잠금·삭제 제약이 새로 생기지 않게)
  room         text not null default '',              -- 접수 글이 나간 방(TEST_MODE 였으면 테스트방). missing 이고 방을 못 정하면 ''
  text         text not null default '' check (char_length(text) <= 1000),   -- 완성된 안내글(앱 상한 600자). missing 동안 ''
  verdict      text check (verdict in ('필요', '불필요', '판단필요', '판단불가')),
  facts        jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(facts) = 'object' and octet_length(facts::text) <= 16000),
                                                       -- 판정에 쓴 값(코드·마지막 점검/AS·경과일·워킨맵·기기 수·여분·일정 id). 전화·주소 넣지 않음
  due_at       timestamptz not null default now(),    -- 이 시각 이후에 보낸다
  status       text not null default 'queued'
                 check (status in ('missing', 'queued', 'sent', 'skipped', 'error')),
  reason       text not null default '' check (char_length(reason) <= 200),   -- skipped 이유(no_action·stale·cancelled·deleted) 또는 fallback
  error        text check (char_length(error) <= 500), -- error 상태 사유(no_room·outbox 실패 메시지)
  outbox_id    uuid,                                   -- 넣은 outbox 행(배달 확인은 kakao_delivery_log.outbox_id)
  author       text not null default '',               -- 접수자(또는 'cron' = 보충 감지)
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
comment on table public.visit_advice_log is
  '방문 판단 안내글 1건 = 접수 1건(reception_id PK). 앱은 rpc queue_visit_advice 로 적재, 상태 변경·outbox 넣기는 flush_visit_advice(크론)만. 2026-10-31 supabase/visit-advice-20261031.sql';

-- 2) 인덱스 (하루 AS 접수 수십 건 — 최소만) -----------------------------------------
create index if not exists visit_advice_log_due_idx     on public.visit_advice_log (due_at) where status in ('queued', 'missing');
create index if not exists visit_advice_log_created_idx on public.visit_advice_log (created_at desc);

-- 3) 권한 (2026-10-19 이후 새 표에 anon 기본 권한 없음) -------------------------------
revoke all on public.visit_advice_log from anon, authenticated;
grant select on public.visit_advice_log to anon, authenticated;
grant insert (reception_id, room, text, verdict, facts, due_at, status, reason, author)
  on public.visit_advice_log to anon, authenticated;            -- 직접 insert 는 열 제한 + 아래 정책(queued|skipped). 앱 정식 길은 RPC
-- update·delete 권한 없음 — 상태 바꾸기는 security definer 함수(소유자 postgres)만.

-- 4) RLS ---------------------------------------------------------------------
alter table public.visit_advice_log enable row level security;

drop policy if exists "visit_advice_log read" on public.visit_advice_log;
create policy "visit_advice_log read" on public.visit_advice_log
  for select to anon, authenticated using (true);

drop policy if exists "visit_advice_log insert" on public.visit_advice_log;
create policy "visit_advice_log insert" on public.visit_advice_log
  for insert to anon, authenticated
  with check (
    status in ('queued', 'skipped')
    and sent_at is null and outbox_id is null and error is null
    and due_at between now() - interval '10 minutes' and now() + interval '7 days'
    and exists (select 1 from public.service_receptions s where s.id = reception_id and not s.deleted)
    and (status = 'skipped' or (btrim(text) <> '' and (
          room in (select m.room from public.room_map m where m.category = 'AS')
          or room = (select c.value from public.app_config c where c.key = 'TEST_ROOM'))))
  );

-- 5) 앱 적재 RPC ------------------------------------------------------------------
create or replace function public.queue_visit_advice(
  p_reception_id uuid,
  p_room         text,
  p_text         text,
  p_verdict      text,
  p_send         boolean     default true,
  p_due_at       timestamptz default null,
  p_facts        jsonb       default '{}'::jsonb,
  p_author       text        default '',
  p_reason       text        default ''
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_sent_room text;
  v_deleted   boolean;
  v_test_room text;
  v_due       timestamptz := least(greatest(coalesce(p_due_at, now()), now()), now() + interval '7 days');
  v_status    text := case when coalesce(p_send, true) then 'queued' else 'skipped' end;
  v_prev      text;
  v_out       text;
begin
  select sent_room, deleted into v_sent_room, v_deleted from service_receptions where id = p_reception_id;
  if not found then
    raise exception 'queue_visit_advice: 접수를 찾을 수 없습니다 (%)', p_reception_id using errcode = 'P0002';
  end if;
  if v_deleted then
    return jsonb_build_object('status', 'ignored', 'reason', 'deleted');
  end if;
  if p_verdict is not null and p_verdict not in ('필요', '불필요', '판단필요', '판단불가') then
    raise exception 'queue_visit_advice: verdict 값 오류 (%)', p_verdict using errcode = '22023';
  end if;
  if v_status = 'queued' then
    if coalesce(btrim(p_text), '') = '' or char_length(p_text) > 1000 then
      raise exception 'queue_visit_advice: 안내글이 비었거나 1000자를 넘습니다' using errcode = '22023';
    end if;
    select value into v_test_room from app_config where key = 'TEST_ROOM';
    -- 방 제한: AS방 · 테스트방 · 그 접수 글이 실제로 나간 방만(anon 이 아무 방에나 글을 넣지 못하게)
    if coalesce(btrim(p_room), '') = ''
       or not (p_room = v_sent_room
               or p_room = coalesce(v_test_room, '테스트 전용방')
               or exists (select 1 from room_map m where m.category = 'AS' and m.room = p_room)) then
      raise exception 'queue_visit_advice: 보낼 수 없는 방 (%)', p_room using errcode = '22023';
    end if;
  end if;

  select status into v_prev from visit_advice_log where reception_id = p_reception_id;

  insert into visit_advice_log as l (reception_id, room, text, verdict, facts, due_at, status, reason, author)
  values (p_reception_id, coalesce(p_room, ''), coalesce(p_text, ''), p_verdict,
          case when jsonb_typeof(p_facts) = 'object' then p_facts else '{}'::jsonb end,
          v_due, v_status, left(coalesce(nullif(btrim(p_reason), ''), case when v_status = 'skipped' then 'no_action' else '' end), 200),
          left(coalesce(p_author, ''), 80))
  on conflict (reception_id) do update
     set room = excluded.room, text = excluded.text, verdict = excluded.verdict, facts = excluded.facts,
         due_at = excluded.due_at, status = excluded.status, reason = excluded.reason, author = excluded.author,
         error = null
   where l.status = 'missing'                         -- 보충 감지 행만 앱 결과로 바꿔 끼운다. queued·sent 등은 그대로(중복 없음)
  returning l.status into v_out;

  if v_out is null then
    return jsonb_build_object('status', 'exists', 'existing', v_prev);   -- 이미 처리된 접수 — 아무것도 안 바뀜
  end if;
  return jsonb_build_object('status', v_out, 'replaced_missing', v_prev = 'missing', 'due_at', v_due);
end
$fn$;
revoke all on function public.queue_visit_advice(uuid, text, text, text, boolean, timestamptz, jsonb, text, text) from public;
grant execute on function public.queue_visit_advice(uuid, text, text, text, boolean, timestamptz, jsonb, text, text) to anon, authenticated;

-- 6) 크론 함수 --------------------------------------------------------------------
create or replace function public.flush_visit_advice(p_limit int default 20, p_stale_hours int default 72)  -- 72h: 금요일 저녁 큐 → 주말 보류 → 월요일 발송이 stale 로 버려지지 않게(팀장 2026-10-31, 옛 6h)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_kst        timestamp := now() at time zone 'Asia/Seoul';
  v_hour       int       := extract(hour from (now() at time zone 'Asia/Seoul'));
  v_isodow     int       := extract(isodow from (now() at time zone 'Asia/Seoul'));
  v_from       timestamptz := (date_trunc('day', now() at time zone 'Asia/Seoul') - interval '1 day') at time zone 'Asia/Seoul';  -- 어제 00:00 KST
  v_enabled    boolean;
  v_kakao      boolean;
  v_test       boolean;
  v_test_room  text;
  v_grace      int;
  v_since      timestamptz;
  v_next_open  timestamptz;
  r            record;
  v_oid        uuid;
  n_stale int := 0; n_cancel int := 0; n_missing int := 0; n_fallback int := 0; n_noroom int := 0; n_sent int := 0; n_err int := 0;
begin
  -- 매분 크론이 겹치지 않게(앞 실행이 아직 돌면 이번 분은 건너뜀)
  if not pg_try_advisory_xact_lock(hashtext('flush_visit_advice')) then
    return jsonb_build_object('skipped', 'locked');
  end if;

  -- a. 오래 밀린 queued
  update visit_advice_log set status = 'skipped', reason = 'stale'
   where status = 'queued' and due_at < now() - make_interval(hours => greatest(coalesce(p_stale_hours, 72), 1));
  get diagnostics n_stale = row_count;

  -- b. 지워졌거나 취소된 접수(접수 행 자체가 없어진 것 포함)
  update visit_advice_log l set status = 'skipped', reason = 'cancelled'
   where l.status in ('queued', 'missing')
     and not exists (select 1 from service_receptions s
                      where s.id = l.reception_id and not s.deleted and s.status not in ('접수취소', '중복접수'));
  get diagnostics n_cancel = row_count;

  -- c. 스위치·시간대
  select lower(btrim(coalesce(value, ''))) = 'true' into v_enabled from app_config where key = 'VISIT_ADVICE_ENABLED';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false, 'stale', n_stale, 'cancelled', n_cancel);
  end if;
  if v_hour < 10 or v_hour >= 20 then
    return jsonb_build_object('enabled', true, 'outside_hours', v_kst, 'stale', n_stale, 'cancelled', n_cancel);
  end if;

  select lower(btrim(coalesce(value, ''))) = 'true' into v_kakao from app_config where key = 'FIELD_KAKAO_SEND_ENABLED';
  select coalesce(lower(btrim(value)), 'true') = 'true' into v_test from app_config where key = 'TEST_MODE';   -- 값 없으면 켜짐(앱 isTestModeValue 와 같게)
  v_test := coalesce(v_test, true);
  select nullif(btrim(value), '') into v_test_room from app_config where key = 'TEST_ROOM';
  v_test_room := coalesce(v_test_room, '테스트 전용방');
  select case when btrim(value) ~ '^[0-9]{1,3}$' then btrim(value)::int end into v_grace from app_config where key = 'VISIT_ADVICE_MISSING_GRACE_MIN';
  v_grace := greatest(coalesce(v_grace, 10), 2);

  -- 주말이면 보충 글은 월요일 10:00 KST 로(공휴일은 SQL 이 모름 — 앱 판정 행은 앱이 정한 due_at 을 따른다)
  v_next_open := case when v_isodow in (6, 7)
                      then ((date_trunc('day', v_kst) + make_interval(days => 8 - v_isodow) + interval '10 hours') at time zone 'Asia/Seoul')
                      else now() end;

  -- d. 보충 감지 — 앱이 실제로 쓰기 시작한 뒤의 접수만
  select min(created_at) into v_since from visit_advice_log where author <> 'cron';
  if v_since is not null then
    insert into visit_advice_log (reception_id, room, text, verdict, due_at, status, reason, author)
    select s.id,
           case
             when s.type = '복합기 AS' then s.sent_room
             when v_test then v_test_room
             else coalesce((select m.room from room_map m
                             where m.category = 'AS'
                               and m.region = case when btrim(s.region) = '' then '' else coalesce(substring(upper(s.region) from '[A-E]'), 'E') end), '')
           end,
           '', null, now(), 'missing', '', 'cron'
      from service_receptions s
     where not s.deleted
       and s.status not in ('접수취소', '중복접수')
       and (
             (s.type = '복합기 AS' and btrim(s.sent_room) <> '' and s.created_at >= greatest(v_from, v_since))
          or (s.type = 'IT' and s.remote_meta ->> 'result' = '방문이관'
              and coalesce(s.remote_meta ->> 'csTransferAt', '') ~ '^\d{4}-\d{2}-\d{2}'
              and left(s.remote_meta ->> 'csTransferAt', 10) >= to_char(greatest(v_from, v_since) at time zone 'Asia/Seoul', 'YYYY-MM-DD'))
           )
       and s.created_at < now() - interval '1 minute'          -- 앱이 막 저장·전송 중인 접수는 다음 분에
       and not exists (select 1 from visit_advice_log l where l.reception_id = s.id)
    on conflict (reception_id) do nothing;
    get diagnostics n_missing = row_count;
  end if;

  -- e. 앱 결과가 끝내 안 온 missing → 판단불가 글(방 못 정하면 error)
  update visit_advice_log l set status = 'error', error = 'no_room: 보낼 AS방을 정하지 못함(지역·room_map 확인)'
   where l.status = 'missing' and btrim(l.room) = '' and l.created_at < now() - make_interval(mins => v_grace);
  get diagnostics n_noroom = row_count;

  update visit_advice_log l
     set status  = 'queued',
         verdict = '판단불가',
         reason  = 'fallback',
         due_at  = v_next_open,
         text    = left(
                     btrim(coalesce(nullif(btrim(s.vendor), ''), '(업체명 없음)') || ' ' || coalesce(s.grade, ''))
                     || case when (s.created_at at time zone 'Asia/Seoul')::date <> v_kst::date
                               or extract(hour from s.created_at at time zone 'Asia/Seoul') not between 10 and 19
                             then ' (' || to_char(s.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' 접수분)' else '' end
                     || coalesce(E'\n' || nullif(concat_ws('/', nullif(btrim(s.model), ''), nullif(btrim(s.asset_no), ''), nullif(btrim(s.serial), '')), ''), '')
                     || E'\n방문 판단: 판단불가(자료 못 읽음) — 마지막 점검·추가일정을 직접 확인해 주세요',
                   1000)
    from service_receptions s
   where s.id = l.reception_id
     and l.status = 'missing' and btrim(l.room) <> ''
     and l.created_at < now() - make_interval(mins => v_grace);
  get diagnostics n_fallback = row_count;

  -- f. 전체 카톡 정지면 보내지 않음(행은 queued 로 남는다 — 6시간 넘으면 a 에서 stale)
  if not coalesce(v_kakao, false) then
    return jsonb_build_object('enabled', true, 'kakao_off', true, 'stale', n_stale, 'cancelled', n_cancel,
                              'missing', n_missing, 'fallback', n_fallback, 'no_room', n_noroom);
  end if;

  -- f2. 주말에는 보내지 않는다(권한나 2026-10-31 — 앱 due_at 이 틀리거나 직접 insert 돼도 토·일 발송 차단, 월요일 10시 뒤에 나감)
  if v_isodow in (6, 7) then
    return jsonb_build_object('enabled', true, 'weekend_hold', true, 'sent', 0, 'stale', n_stale, 'cancelled', n_cancel,
                              'missing', n_missing, 'fallback', n_fallback, 'no_room', n_noroom);
  end if;

  -- g. 보내기 — 한 행 실패가 다른 행을 막지 않게 행마다 예외 처리
  for r in
    select reception_id, room, text from visit_advice_log
     where status = 'queued' and due_at <= now()
     order by due_at, created_at
     limit greatest(least(coalesce(p_limit, 20), 100), 1)
     for update skip locked
  loop
    begin
      -- 보내는 순간의 TEST_MODE 를 다시 본다(큐에 넣은 뒤 켜졌으면 테스트방으로 — 권한나 2026-10-31)
      insert into outbox (room, text) values (case when v_test then coalesce(v_test_room, '테스트 전용방') else r.room end, r.text) returning id into v_oid;
      update visit_advice_log set status = 'sent', sent_at = now(), outbox_id = v_oid where reception_id = r.reception_id;
      n_sent := n_sent + 1;
    exception when others then
      update visit_advice_log set status = 'error', error = left('outbox: ' || sqlerrm, 500) where reception_id = r.reception_id;
      n_err := n_err + 1;
    end;
  end loop;

  return jsonb_build_object('enabled', true, 'stale', n_stale, 'cancelled', n_cancel, 'missing', n_missing,
                            'fallback', n_fallback, 'no_room', n_noroom, 'sent', n_sent, 'error', n_err);
end
$fn$;
revoke all on function public.flush_visit_advice(int, int) from public, anon, authenticated;   -- 크론(postgres)만

-- 7) 설정 기본값 (없을 때만 — 관리 탭에서 바꾼 값은 그대로) -----------------------------
insert into public.app_config (key, value) values
  ('VISIT_ADVICE_ENABLED',           'false'),   -- 전체 스위치. 꺼져 있으면 앱은 행을 안 만들고 크론은 보내지 않는다
  ('VISIT_ADVICE_MIN_DAYS',          '60'),      -- 분기점검 경과 기준일
  ('VISIT_ADVICE_MONTHLY_DAYS',      '25'),      -- 매월점검 지점 기준일
  ('VISIT_ADVICE_HOURS',             '10-20'),   -- 보내는 시간대(앱 due_at 계산용. 크론 함수는 10~19시 고정)
  ('VISIT_ADVICE_PAST_DAYS',         '30'),      -- 지난 미완료 일정을 며칠 전까지 추가일정에 넣을지
  ('VISIT_ADVICE_MISSING_GRACE_MIN', '10')       -- 보충 감지 뒤 앱 결과를 기다리는 분(지나면 판단불가 글)
on conflict (key) do nothing;

-- 8) 크론 (같은 이름이면 덮어씀) ---------------------------------------------------
select cron.schedule('visit-advice-flush', '* 1-10 * * *', $$select public.flush_visit_advice();$$);

commit;

-- ============================================================================
-- 확인(실행 뒤):
--   select relrowsecurity from pg_class where oid = 'public.visit_advice_log'::regclass;                     -- true
--   select has_table_privilege('anon','public.visit_advice_log','select') sel,                               -- true
--          has_table_privilege('anon','public.visit_advice_log','update') upd,                               -- false
--          has_table_privilege('anon','public.visit_advice_log','delete') del,                               -- false
--          has_function_privilege('anon','public.flush_visit_advice(int,int)','execute') flush_anon,          -- false
--          has_function_privilege('anon','public.queue_visit_advice(uuid,text,text,text,boolean,timestamptz,jsonb,text,text)','execute') q; -- true
--   select jobname, schedule, active from cron.job where jobname = 'visit-advice-flush';                     -- * 1-10 * * * · true
--   select key, value from public.app_config where key like 'VISIT_ADVICE%' order by key;                    -- 6행
--   select public.flush_visit_advice();   -- 스위치 꺼짐이면 {"enabled": false, ...} — 카톡 0건
--   -- 켠 뒤 하루: select status, reason, verdict, count(*) from public.visit_advice_log
--   --              where created_at > now() - interval '1 day' group by 1,2,3;     -- missing·error 가 0 이어야 정상
--
-- 되돌리기(SQL Editor) — 기존 표는 하나도 건드리지 않았다:
--   select cron.unschedule('visit-advice-flush');
--   drop function if exists public.flush_visit_advice(int, int);
--   drop function if exists public.queue_visit_advice(uuid, text, text, text, boolean, timestamptz, jsonb, text, text);
--   drop table if exists public.visit_advice_log;     -- 보낸 안내글 기록이 지워짐(이미 outbox 로 간 글은 그대로)
--   delete from public.app_config where key in ('VISIT_ADVICE_ENABLED','VISIT_ADVICE_MIN_DAYS','VISIT_ADVICE_MONTHLY_DAYS',
--     'VISIT_ADVICE_HOURS','VISIT_ADVICE_PAST_DAYS','VISIT_ADVICE_MISSING_GRACE_MIN');   -- 선택
--   급히 멈추기만: update public.app_config set value = 'false' where key = 'VISIT_ADVICE_ENABLED';   (관리 탭 스위치와 같음)
--
-- 프런트(src/supabase.ts 래퍼만 — 쓰기는 RPC 하나):
--   const r = await rpc<{ status: string }>("queue_visit_advice", { p_reception_id: id, p_room: room, p_text: text, p_verdict: verdict, p_send: send, p_due_at: dueAt.toISOString(), p_facts: facts, p_author: author });
--   const one = await selectRows<VisitAdviceRow>("visit_advice_log", `select=reception_id,status,reason,verdict,text,due_at,sent_at,outbox_id,error&reception_id=eq.${id}&limit=1`);
--   const open = await selectRows<VisitAdviceRow>("visit_advice_log", `select=reception_id,status,room,created_at,error&status=in.(missing,error)&created_at=gte.${since}&order=created_at.desc`);  // 관리 탭 누락 감시
-- ============================================================================
