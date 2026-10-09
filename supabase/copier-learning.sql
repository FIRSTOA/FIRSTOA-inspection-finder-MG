-- 복합기 학습자료 게시판 (2026-10-09) — 복합기 학습·처리이력 › [학습자료] 탭.
-- 누구나 글을 올리고 고치는 게시판(가이드 위키와 같은 신뢰 모델). 본문은 가이드와 같은 미니 마크다운(## 제목 · - 목록 · ::: 토글 · 사진 · 파일).
-- 다른 직원이 만든 "구동원리" 교육가이드는 표에 넣지 않고 앱이 고정 글로 보여 준다(public/learn/copier-principle.inline.json).
create table if not exists public.copier_learning_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  author text not null default '',
  title text not null,
  category text not null default '기타',     -- 구동원리 / 급지·반송 / 화상·화질 / 정착 / 전장·보드 / 네트워크·설정 / 교육자료 / 기타
  brand text not null default '',            -- 비우면 공통
  summary text not null default '',          -- 목록에 보이는 한 줄
  content text not null default '',
  attachments jsonb not null default '[]',   -- [{name, url}] 사진 외 파일(PDF 등)
  pinned boolean not null default false      -- 목록 맨 위 고정
);
create index if not exists copier_learning_posts_created_idx on public.copier_learning_posts (pinned desc, created_at desc);
alter table public.copier_learning_posts enable row level security;
drop policy if exists "copier_learning_posts anon all" on public.copier_learning_posts;
create policy "copier_learning_posts anon all" on public.copier_learning_posts for all to anon using (true) with check (true);
grant select, insert, update, delete on public.copier_learning_posts to anon, authenticated;
notify pgrst, 'reload schema';
