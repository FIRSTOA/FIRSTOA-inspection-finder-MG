-- Supabase SQL Editor에서 1회 실행: 일일업무/주간현황판
create extension if not exists pgcrypto;

create table if not exists public.visit_logs (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  author text not null,
  vendor text not null,
  visited boolean not null default true,
  arrival_time time,
  machine_count integer not null default 0 check (machine_count >= 0),
  work_kinds text[] not null default '{}',
  minutes jsonb not null default '{}'::jsonb,
  sales_it text,
  sales_copier text,
  commute text,
  note text,
  "_dupKey" text not null unique,
  created_at timestamptz not null default now()
);
alter table public.visit_logs add column if not exists work_kinds text[] not null default '{}';
create index if not exists visit_logs_author_date_idx on public.visit_logs(author, work_date desc);

create table if not exists public.weekly_notes (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  week_start date not null,
  goals jsonb not null default '{}'::jsonb,
  review text not null default '', growth text not null default '', challenge text not null default '',
  special text not null default '', learning text not null default '', request text not null default '', praise text not null default '',
  updated_at timestamptz not null default now(),
  unique(author, week_start)
);

alter table public.visit_logs enable row level security;
alter table public.weekly_notes enable row level security;
-- 현재 앱이 anon 기반이므로 기존 운영 방식과 맞춘 정책. 직원 로그인 도입 시 auth.uid() 기반으로 교체한다.
drop policy if exists "visit_logs anon read" on public.visit_logs;
drop policy if exists "visit_logs anon insert" on public.visit_logs;
drop policy if exists "weekly_notes anon all" on public.weekly_notes;
create policy "visit_logs anon read" on public.visit_logs for select to anon using (true);
create policy "visit_logs anon insert" on public.visit_logs for insert to anon with check (true);
create policy "weekly_notes anon all" on public.weekly_notes for all to anon using (true) with check (true);
grant select, insert on public.visit_logs to anon;
grant select, insert, update on public.weekly_notes to anon;
