create extension if not exists pgcrypto;

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  activity_date date not null,
  author text not null,
  team text not null default '미지정',
  category text not null,
  vendor text not null default '',
  quantity integer not null default 0,
  machine_count integer not null default 0,
  source_text text,
  metadata jsonb not null default '{}'::jsonb,
  "_dupKey" text not null
);

create unique index if not exists activity_events_dupkey_idx
  on public.activity_events("_dupKey");
create index if not exists activity_events_date_idx
  on public.activity_events(activity_date desc);
create index if not exists activity_events_team_author_idx
  on public.activity_events(team, author, activity_date desc);
create index if not exists activity_events_category_idx
  on public.activity_events(category, activity_date desc);

alter table public.activity_events enable row level security;
drop policy if exists "activity_events anon read" on public.activity_events;
drop policy if exists "activity_events anon insert" on public.activity_events;
create policy "activity_events anon read"
  on public.activity_events for select to anon using (true);
create policy "activity_events anon insert"
  on public.activity_events for insert to anon with check (true);
grant select, insert on public.activity_events to anon;

-- 기존 일일방문 원장을 최초 1회 운영현황으로 가져옵니다.
-- 이후 FIELD 전송은 웹앱이 activity_events에 직접 기록합니다.
with visit_activity as (
  select
    v.id,
    v.work_date,
    v.author,
    v.vendor,
    v.machine_count,
    v.source_text,
    k.kind,
    case k.kind
      when 'inspection' then 'inspection'
      when 'as' then 'as'
      when 'delivery' then 'logistics'
      when 'etc' then 'logistics'
      when 'pc' then 'expansion_it'
      when 'misu' then 'misu'
      when 'bulman' then 'complaint'
      when 'recontract' then 'recontract'
      when 'overage' then 'overage'
      else k.kind
    end as category,
    case
      when k.kind = 'inspection' then greatest(coalesce(v.machine_count, 0), 1)
      else coalesce(v.machine_count, 0)
    end as activity_machine_count
  from public.visit_logs v
  cross join lateral unnest(coalesce(v.work_kinds, array[]::text[])) as k(kind)
  where k.kind in ('inspection', 'as', 'delivery', 'etc', 'pc', 'misu', 'bulman', 'recontract', 'overage')
)
insert into public.activity_events (
  activity_date, author, team, category, vendor, quantity, machine_count,
  source_text, metadata, "_dupKey"
)
select
  v.work_date,
  v.author,
  case
    when v.author = '신정훈' then '팀장'
    when v.author in ('김정민', '심태현', '정웅', '정웅만') then 'A'
    when v.author in ('권태혁', '조윤', '윤기준') then 'B'
    when v.author in ('이홍진', '박영현', '이민구', '한왕주') then 'C'
    when v.author in ('양승원', '김종희', '이호준') then 'D'
    else '미지정'
  end,
  v.category,
  coalesce(v.vendor, ''),
  1,
  v.activity_machine_count,
  v.source_text,
  jsonb_build_object('backfilled_from', 'visit_logs', 'visit_id', v.id),
  md5(
    concat_ws(
      '|',
      v.work_date::text,
      v.author,
      v.category,
      coalesce(v.vendor, ''),
      '1',
      v.activity_machine_count::text,
      coalesce(v.source_text, '')
    )
  )
from visit_activity v
on conflict ("_dupKey") do nothing;
