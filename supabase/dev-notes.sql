-- 복합기 학습·처리이력 + 주소확인 이력 + 목표 카테고리 (1회 실행)

-- ① 주소확인 처리 이력 보존 (완료해도 기록이 남고, 누가 처리했는지 확인 가능)
alter table public.service_receptions add column if not exists address_resolved_at timestamptz;
alter table public.service_receptions add column if not exists address_resolved_by text not null default '';

-- ② 개인 목표 카테고리
alter table public.self_goals add column if not exists category text not null default '기타';

-- ③ 복합기 학습·처리이력 (브랜드/기종별 노트)
create table if not exists public.copier_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author text not null default '',
  brand text not null,
  model text not null default '',
  kind text not null default '학습' check (kind in ('학습', '처리이력')),
  title text not null default '',
  content text not null default ''
);
create index if not exists copier_notes_brand_idx on public.copier_notes(brand, model, created_at desc);

alter table public.copier_notes enable row level security;
drop policy if exists "copier_notes anon all" on public.copier_notes;
create policy "copier_notes anon all" on public.copier_notes for all to anon using (true) with check (true);
grant select, insert, update, delete on public.copier_notes to anon;

notify pgrst, 'reload schema';
