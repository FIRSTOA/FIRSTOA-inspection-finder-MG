-- CS 워킨맵을 PC와 모바일에서 공용으로 사용하기 위한 1회 실행 SQL
create table if not exists public.workin_map_places (
  id bigint primary key,
  number integer not null default 0,
  team text not null check (team in ('A', 'B', 'C', 'D')),
  quarter smallint not null check (quarter between 1 and 4),
  kind text not null check (kind in ('quarter', 'monthly', 'renewal')),
  label text not null default 'G12',
  visible boolean not null default true,
  name text not null default '',
  comment text not null default '',
  phone text not null default '',
  address text not null default '',
  address_detail text not null default '',
  latitude double precision not null default 0,
  longitude double precision not null default 0,
  memos jsonb not null default '[]'::jsonb,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists workin_map_scope_idx
  on public.workin_map_places(team, quarter, kind);

alter table public.workin_map_places enable row level security;

drop policy if exists "workin_map_places anon all"
  on public.workin_map_places;

create policy "workin_map_places anon all"
  on public.workin_map_places
  for all to anon
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.workin_map_places to anon;

-- 2026-09-12: updated_at을 서버 시각으로 강제 — 브라우저 시계로 쓰던 값은 증분 폴링(updated_at=gt.)에서 빠질 수 있었다
create or replace function set_workin_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists workin_map_places_updated_at on workin_map_places;
create trigger workin_map_places_updated_at before insert or update on workin_map_places
for each row execute function set_workin_updated_at();
