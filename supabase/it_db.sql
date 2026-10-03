-- IT 학습·처리이력 — 퍼스트전산 PC DB 시트를 Supabase로 (2026-10-03). Supabase SQL Editor에서 1회 실행.
-- 실행 뒤 앱 IT 학습·처리이력 탭의 [시트에서 가져오기] 단추를 누르면 네 탭(지식·처리이력·영업상담·교육자료)이 들어온다.
-- Apps Script는 더 이상 쓰지 않는다. 누구나(anon) 읽고 쓴다 — 다른 표와 같은 정책.

create extension if not exists pg_trgm;

create table if not exists public.it_rows (
  id bigserial primary key,
  tab text not null check (tab in ('knowledge', 'history', 'sales', 'links')),
  row_no int not null,                       -- 시트 줄 번호(1부터). 앱에서 등록한 줄은 음수(-등록시각)
  source text not null default 'sheet' check (source in ('sheet', 'app')),
  data jsonb not null default '{}'::jsonb,   -- 시트 머리글 그대로의 한 줄
  search text not null default '',           -- 모든 칸을 소문자로 이어 붙인 검색용
  quiz boolean not null default false,       -- 퀴즈문제·퀴즈답이 있는 줄(지식 DB)
  author text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tab, row_no)
);
create index if not exists it_rows_tab_idx on public.it_rows (tab, row_no);
create index if not exists it_rows_search_trgm on public.it_rows using gin (search gin_trgm_ops);
create index if not exists it_rows_quiz_idx on public.it_rows (tab) where quiz;

create table if not exists public.it_quiz_results (
  id bigserial primary key,
  name text not null default '',
  level text not null default '전체',
  score int not null default 0,
  total int not null default 0,
  wrong jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists it_quiz_results_name_idx on public.it_quiz_results (name, created_at desc);

alter table public.it_rows enable row level security;
alter table public.it_quiz_results enable row level security;
drop policy if exists it_rows_anon_all on public.it_rows;
create policy it_rows_anon_all on public.it_rows for all to anon, authenticated using (true) with check (true);
drop policy if exists it_quiz_results_anon_all on public.it_quiz_results;
create policy it_quiz_results_anon_all on public.it_quiz_results for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.it_rows, public.it_quiz_results to anon, authenticated;
grant usage, select on sequence public.it_rows_id_seq, public.it_quiz_results_id_seq to anon, authenticated;

select 'it_rows' as "table", count(*) from public.it_rows
union all select 'it_quiz_results', count(*) from public.it_quiz_results;
