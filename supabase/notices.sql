-- 공지사항 + 읽음 확인 (2026-08-01)
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author text not null default '',
  title text not null,
  body text not null default '',
  target_type text not null default '전체',   -- 전체 | 팀 | 개인
  target text not null default '',
  pinned boolean not null default false
);
create table if not exists public.notice_reads (
  notice_id uuid not null references public.notices(id) on delete cascade,
  reader text not null,
  read_at timestamptz not null default now(),
  primary key (notice_id, reader)
);
alter table public.notices enable row level security;
alter table public.notice_reads enable row level security;
drop policy if exists "notices anon all" on public.notices;
create policy "notices anon all" on public.notices for all to anon using (true) with check (true);
drop policy if exists "notice_reads anon all" on public.notice_reads;
create policy "notice_reads anon all" on public.notice_reads for all to anon using (true) with check (true);
grant select, insert, update, delete on public.notices to anon;
grant select, insert, update, delete on public.notice_reads to anon;
