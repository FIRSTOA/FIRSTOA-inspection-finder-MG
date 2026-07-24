-- FIELD 4종(확장성 IT/복합기, 담당자·주소 변경, 불만) 외부 동기화 작업 큐
-- 한 번만 Supabase SQL Editor에서 실행합니다.

create extension if not exists pgcrypto;

create table if not exists public.field_sheet_sync_jobs (
  id uuid primary key,
  created_at timestamptz not null default now(),
  category text not null check (category in ('expansion_it', 'expansion_copier', 'contact_change', 'complaint')),
  author text not null default '',
  vendor text not null default '',
  region text not null default '',
  room text not null default '',
  source_text text not null default '',
  payload jsonb not null default '{}'::jsonb,
  sheet_status text not null default 'pending' check (sheet_status in ('pending', 'synced', 'failed', 'disabled')),
  kakao_status text not null default 'held' check (kakao_status in ('held', 'queued', 'failed', 'disabled')),
  sheet_row integer,
  last_error text,
  synced_at timestamptz,
  attempts integer not null default 0,
  "_dupKey" text not null unique
);

create index if not exists field_sheet_sync_jobs_created_idx
  on public.field_sheet_sync_jobs(created_at desc);
create index if not exists field_sheet_sync_jobs_status_idx
  on public.field_sheet_sync_jobs(sheet_status, kakao_status, created_at desc);

alter table public.field_sheet_sync_jobs enable row level security;
drop policy if exists "field sheet sync jobs anon read" on public.field_sheet_sync_jobs;
drop policy if exists "field sheet sync jobs anon insert" on public.field_sheet_sync_jobs;
create policy "field sheet sync jobs anon read"
  on public.field_sheet_sync_jobs for select to anon using (true);
create policy "field sheet sync jobs anon insert"
  on public.field_sheet_sync_jobs for insert to anon with check (true);
grant select, insert on public.field_sheet_sync_jobs to anon;

-- 오늘은 두 기능 모두 꺼진 상태로 시작합니다.
-- 준비 후 true로 바꾸면 이후 웹앱 전송부터 각각 동작합니다.
insert into public.app_config(key, value) values
  ('FIELD_SHEET_SYNC_ENABLED', 'false'),
  ('FIELD_KAKAO_SEND_ENABLED', 'false'),
  ('FIELD_SHEET_TEST_MODE', 'false')
on conflict (key) do nothing;
