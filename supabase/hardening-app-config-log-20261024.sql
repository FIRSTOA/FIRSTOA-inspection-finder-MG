-- ============================================================================
-- app_config 변경 이력(감사 로그) + 선택적 잠금 키 — 2026-10-24 · 데이터실 표다빈
-- SQL Editor 에서 통째로 1회 실행. 두 번 실행해도 안전(create ... if not exists / create or replace / drop ... if exists).
-- 설계: docs/tasks/db-hardening-2026-10-24.md (A) — 선택지 ① "지금" 단계. ②(엣지 함수 쓰기)는 다음 단계.
--
-- 왜: docs/tasks/risk-audit-2026-10-24.md 요약 3. app_config 는 anon 이 INSERT·UPDATE 할 수 있다
--     (관리 탭 SystemAdmin.saveConfig, authors.ts TEAM_GROUPS 저장이 anon 키로 쓴다). 그래서 단순 revoke 는 관리 탭을 깨뜨린다.
--     지금은 "누가 언제 무엇을 바꿨나"가 아무 데도 남지 않는다 → SSO_REQUIRED 를 누가 껐는지 알 수 없다.
-- 무엇:
--   1) 새 표 public.app_config_log — 변경 1건 = 1행(키·이전 값·새 값·역할·User-Agent·IP). 적재는 트리거만.
--   2) 트리거 app_config_audit (AFTER INSERT/UPDATE/DELETE) — SECURITY DEFINER 함수가 로그에 넣는다(anon 에 INSERT 권한 불필요).
--      SHEET_WRITE_LOCK(엣지 field-sheet-sync 의 2분마다 잠금 행)과 값이 안 바뀐 UPDATE 는 기록하지 않는다.
--   3) 새 표 public.app_config_lock + 트리거 app_config_guard (BEFORE) — 여기 적힌 키는 anon·authenticated 가 바꾸면 거절.
--      **기본은 비어 있다(아무 동작도 안 바뀜).** 잠글 키는 사용자 결정(맨 아래 "잠그기" 예시).
--   4) 처음 실행 때 현재 값 전체를 op='snapshot' 으로 한 번 적어 둔다(기준점).
-- 바꾸지 않는 것: app_config 의 열·정책("app_config anon write")·권한. 관리 탭·엣지 함수 동작은 그대로.
--
-- 권한나 검사(2026-10-24): 실행 금지 없음, 이 파일은 고칠 것 없음.
-- 라이브 실측(MCP 읽기, 2026-10-24 — "DB 에서 본 값"):
--   · app_config(key text PK, value text) 23행. RLS 켜짐, 정책 "app_config anon write" ALL to anon using(true) check(true).
--   · has_table_privilege(anon): SELECT·INSERT·UPDATE = true, DELETE = false (anon-permissions-20261019.sql 1단계 실행됨).
--   · pg_default_acl public 표: anon 없음 → 새 표는 아래 grant 를 꼭 적어야 앱에서 보인다.
--   · app_config 에 걸린 트리거 없음. 쓰는 곳: 앱(anon) SystemAdmin.tsx:124·authors.ts:288, 엣지(service_role)
--     field-sheet-sync(SHEET_WRITE_LOCK)·weekly-keyman-poster(KEYMAN_POSTER_SENT)·naver-calendar-push(NAVER_CALENDAR_ID).
-- 역할 판별: PostgREST 가 넣어 주는 request.jwt.claims 의 role(anon/service_role), 없으면 SET ROLE 값, 그것도 없으면 session_user
--   (SQL Editor·pg_cron = postgres). request.headers 가 없으면 via='sql'.
-- 추정: IP 헤더 이름(x-forwarded-for / cf-connecting-ip / x-real-ip) 중 무엇이 오는지는 실측 못 함 — 셋 중 있는 것을 적는다.
-- ============================================================================

begin;

-- 1) 변경 이력 표 -------------------------------------------------------------
create table if not exists public.app_config_log (
  id          bigserial primary key,
  changed_at  timestamptz not null default now(),
  op          text not null,             -- insert | update | delete | snapshot
  key         text not null,
  old_value   text,
  new_value   text,
  actor_role  text,                      -- anon | service_role | postgres ...
  via         text,                      -- rest | sql
  user_agent  text,
  client_ip   text                       -- anon 에는 보이지 않게 열 권한에서 뺀다
);
create index if not exists app_config_log_key_idx on public.app_config_log (key, changed_at desc);

alter table public.app_config_log enable row level security;
drop policy if exists "app_config_log anon select" on public.app_config_log;
create policy "app_config_log anon select" on public.app_config_log for select to anon, authenticated using (true);
revoke all on table public.app_config_log from anon, authenticated;
-- 읽기만, client_ip 열은 빼고. 쓰기(insert/update/delete)는 주지 않는다 — 적재는 SECURITY DEFINER 트리거만.
grant select (id, changed_at, op, key, old_value, new_value, actor_role, via, user_agent)
  on table public.app_config_log to anon, authenticated;

-- 2) 잠금 키 표 (기본 비어 있음) ------------------------------------------------
create table if not exists public.app_config_lock (
  key        text primary key,
  reason     text,
  locked_at  timestamptz not null default now()
);
alter table public.app_config_lock enable row level security;
drop policy if exists "app_config_lock anon select" on public.app_config_lock;
create policy "app_config_lock anon select" on public.app_config_lock for select to anon, authenticated using (true);
revoke all on table public.app_config_lock from anon, authenticated;
grant select on table public.app_config_lock to anon, authenticated;   -- 관리 탭이 자물쇠 표시를 할 수 있게. 넣기·빼기는 SQL Editor 만.

-- 3) 요청 역할 판별 (트리거 공용) ---------------------------------------------
create or replace function public.app_config_actor_role()
returns text language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    nullif(nullif(current_setting('role', true), ''), 'none'),
    session_user::text)
$$;
revoke all on function public.app_config_actor_role() from public, anon, authenticated;

-- 4) 기록 트리거 (AFTER) -------------------------------------------------------
create or replace function public.app_config_audit()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  hdrs jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  k text;
begin
  k := case when tg_op = 'UPDATE' and new.key is distinct from old.key then old.key || ' -> ' || new.key
            else coalesce(new.key, old.key) end;
  if coalesce(new.key, old.key) = 'SHEET_WRITE_LOCK' then return null; end if;          -- 잠금 행(2분마다) 소음 제외
  if tg_op = 'UPDATE' and new.key = old.key and new.value is not distinct from old.value then return null; end if;
  insert into public.app_config_log (op, key, old_value, new_value, actor_role, via, user_agent, client_ip)
  values (lower(tg_op), k,
          case when tg_op in ('UPDATE', 'DELETE') then old.value end,
          case when tg_op in ('UPDATE', 'INSERT') then new.value end,
          public.app_config_actor_role(),
          case when hdrs is null then 'sql' else 'rest' end,
          left(hdrs ->> 'user-agent', 300),
          left(coalesce(hdrs ->> 'x-forwarded-for', hdrs ->> 'cf-connecting-ip', hdrs ->> 'x-real-ip'), 100));
  return null;
end $$;
revoke all on function public.app_config_audit() from public, anon, authenticated;

drop trigger if exists app_config_audit on public.app_config;
create trigger app_config_audit after insert or update or delete on public.app_config
  for each row execute function public.app_config_audit();

-- 5) 잠금 트리거 (BEFORE) — app_config_lock 에 있는 키만, anon·authenticated 요청만 거절 --------
create or replace function public.app_config_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare r text := public.app_config_actor_role();
begin
  if r in ('anon', 'authenticated')
     and exists (select 1 from public.app_config_lock l
                  where l.key = coalesce(new.key, old.key) or (tg_op <> 'INSERT' and l.key = old.key)) then
    raise exception '설정 % 은(는) 잠겨 있습니다 — SQL Editor 에서만 바꿀 수 있습니다(app_config_lock)', coalesce(new.key, old.key)
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.app_config_guard() from public, anon, authenticated;

drop trigger if exists app_config_guard on public.app_config;
create trigger app_config_guard before insert or update or delete on public.app_config
  for each row execute function public.app_config_guard();

-- 6) 기준점 — 처음 한 번만 현재 값 전체를 적는다 --------------------------------
insert into public.app_config_log (op, key, new_value, actor_role, via)
select 'snapshot', c.key, c.value, public.app_config_actor_role(), 'sql'
  from public.app_config c
 where not exists (select 1 from public.app_config_log where op = 'snapshot');

commit;

-- ---------------------------------------------------------------------------
-- 확인 (실행 직후)
select 'log 행(snapshot)' as 항목, count(*)::text as 값 from public.app_config_log where op = 'snapshot'      -- 기대: 23 전후
union all select 'trigger', string_agg(tgname, ',' order by tgname) from pg_trigger
  where tgrelid = 'public.app_config'::regclass and not tgisinternal                                         -- 기대: app_config_audit,app_config_guard
union all select 'anon log select', has_table_privilege('anon', 'public.app_config_log', 'SELECT')::text      -- 기대: false (열 단위라 표 전체 SELECT 는 false)
union all select 'anon log key 열', has_column_privilege('anon', 'public.app_config_log', 'key', 'SELECT')::text -- 기대: true
union all select 'anon log ip 열', has_column_privilege('anon', 'public.app_config_log', 'client_ip', 'SELECT')::text -- 기대: false
union all select 'anon log insert', has_table_privilege('anon', 'public.app_config_log', 'INSERT')::text      -- 기대: false
union all select 'lock 키 수', count(*)::text from public.app_config_lock;                                     -- 기대: 0
-- 동작 시험: 관리 탭에서 TEST_ROOM 칸을 한 글자 바꿨다 되돌린 뒤
--   select changed_at at time zone 'Asia/Seoul', op, key, old_value, new_value, actor_role, via, user_agent
--     from public.app_config_log order by id desc limit 5;     → actor_role=anon, via=rest 2줄

-- ---------------------------------------------------------------------------
-- 잠그기 (사용자 결정 뒤, 필요할 때만 — 주석을 풀어 실행)
--   잠근 키는 관리 탭 스위치로 못 바꾼다(저장 실패 토스트). 바꿀 때는 SQL Editor 에서 update public.app_config ... 로.
-- insert into public.app_config_lock (key, reason) values ('SSO_REQUIRED', '로그인 강제 스위치 — 공개 키로 끌 수 없게') on conflict (key) do nothing;
-- 풀기: delete from public.app_config_lock where key = 'SSO_REQUIRED';

-- ---------------------------------------------------------------------------
-- 되돌리기 (주석을 풀어 실행) — app_config 자체는 이 파일이 바꾼 것이 없으므로 트리거·표만 지우면 원상태.
-- drop trigger if exists app_config_guard on public.app_config;
-- drop trigger if exists app_config_audit on public.app_config;
-- drop function if exists public.app_config_guard();
-- drop function if exists public.app_config_audit();
-- drop function if exists public.app_config_actor_role();
-- drop table if exists public.app_config_lock;
-- drop table if exists public.app_config_log;      -- 이력이 필요하면 이 줄은 남겨 둔다

-- 프런트 사용 예 (src/supabase.ts 래퍼만, select=* 금지 — client_ip 열 권한이 없어 * 는 permission denied):
--   const log = await selectRows<AppConfigLogRow>("app_config_log", "select=changed_at,op,key,old_value,new_value,actor_role,via,user_agent&order=changed_at.desc&limit=50");
--   const ssoHistory = await selectRows<AppConfigLogRow>("app_config_log", "select=changed_at,old_value,new_value,actor_role,user_agent&key=eq.SSO_REQUIRED&order=changed_at.desc&limit=20");
--   const locked = await selectRows<{ key: string; reason: string }>("app_config_lock", "select=key,reason");
