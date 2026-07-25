-- 독서 탭: 익명 좋은글 공유 + 추천 포인트 (1회 실행)
-- 글은 익명으로 노출되지만 author를 저장해 추천 포인트를 집계한다(리더보드는 합계만 공개).
create extension if not exists pgcrypto;

create table if not exists public.reading_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author text not null default '',
  title text not null default '',
  content text not null default ''
);

create table if not exists public.reading_votes (
  post_id uuid not null references public.reading_posts(id) on delete cascade,
  voter text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, voter)
);

create index if not exists reading_posts_date_idx on public.reading_posts(created_at desc);

alter table public.reading_posts enable row level security;
alter table public.reading_votes enable row level security;
drop policy if exists "reading_posts anon all" on public.reading_posts;
drop policy if exists "reading_votes anon all" on public.reading_votes;
create policy "reading_posts anon all" on public.reading_posts for all to anon using (true) with check (true);
create policy "reading_votes anon all" on public.reading_votes for all to anon using (true) with check (true);
grant select, insert, update, delete on public.reading_posts to anon;
grant select, insert, delete on public.reading_votes to anon;
