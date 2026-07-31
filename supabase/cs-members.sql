-- CS 인원 명단 — 코드에 박혀 있던 명단을 DB로 옮긴다.
-- 브라우저 localStorage에만 있으면 신입·퇴사 반영이 그 사람 PC에서만 보인다.
create table if not exists public.cs_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team text not null,                       -- 팀장 / A / B / C / D
  active boolean not null default true,     -- 재직 여부 (퇴사자는 false로 남긴다 — 과거 기록의 작성자명이 살아 있어야 함)
  joined_on date,
  left_on date,
  note text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cs_members_name_team_key on public.cs_members (name, team);
create index if not exists cs_members_active_idx on public.cs_members (active, team);

alter table public.cs_members enable row level security;
drop policy if exists "cs_members anon all" on public.cs_members;
create policy "cs_members anon all" on public.cs_members for all to anon using (true) with check (true);
