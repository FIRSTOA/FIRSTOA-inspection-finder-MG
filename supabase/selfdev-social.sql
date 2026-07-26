-- 자기개발/지식공유 소셜 기능 (1회 실행): 댓글 + 칭찬
create table if not exists public.reading_comments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  post_id uuid not null references public.reading_posts(id) on delete cascade,
  author text not null,
  content text not null
);
create index if not exists reading_comments_post_idx on public.reading_comments(post_id, created_at asc);
alter table public.reading_comments enable row level security;
drop policy if exists "reading_comments anon all" on public.reading_comments;
create policy "reading_comments anon all" on public.reading_comments for all to anon using (true) with check (true);
grant select, insert, delete on public.reading_comments to anon;

-- 칭찬 릴레이: 보낸 사람(from_author)은 저장만 하고 화면에는 익명으로 표시
create table if not exists public.praise_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  from_author text not null default '',
  to_name text not null,
  content text not null
);
create index if not exists praise_posts_to_idx on public.praise_posts(to_name, created_at desc);
alter table public.praise_posts enable row level security;
drop policy if exists "praise_posts anon all" on public.praise_posts;
create policy "praise_posts anon all" on public.praise_posts for all to anon using (true) with check (true);
grant select, insert, delete on public.praise_posts to anon;

notify pgrst, 'reload schema';
