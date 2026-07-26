-- 자기개발 탭 (1회 실행)
-- ① 독서 게시판 재사용: 글 종류(kind) 컬럼 — 'reading'(독서) / 'tip'(배움·팁 공유)
alter table public.reading_posts add column if not exists kind text not null default 'reading';
create index if not exists reading_posts_kind_idx on public.reading_posts(kind, created_at desc);

-- ② 개인 목표 트래커
create table if not exists public.self_goals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author text not null,
  title text not null,
  memo text not null default '',
  target_date date,
  done boolean not null default false,
  done_at timestamptz
);
create index if not exists self_goals_author_idx on public.self_goals(author, done, created_at desc);

alter table public.self_goals enable row level security;
drop policy if exists "self_goals anon all" on public.self_goals;
create policy "self_goals anon all" on public.self_goals for all to anon using (true) with check (true);
grant select, insert, update, delete on public.self_goals to anon;

notify pgrst, 'reload schema';
