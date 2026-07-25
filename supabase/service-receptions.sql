-- 서비스접수 기록 테이블 (1회 실행)
-- 접수 리스트·누적 건수·접수자별 통계·날짜별 조회의 원본. 원격이관은 대기/완료 상태를 가진다.
create extension if not exists pgcrypto;

create table if not exists public.service_receptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  receipt_date date not null default ((now() at time zone 'Asia/Seoul'))::date,
  author text not null default '',
  route text not null default '카카오' check (route in ('카카오', '전화')),
  type text not null check (type in ('원격이관', '복합기 AS', 'IT AS')),
  vendor text not null default '',
  asset_no text not null default '',
  serial text not null default '',
  model text not null default '',
  region text not null default '',
  title text not null default '',
  symptom text not null default '',
  paid text not null default '무상',
  notes text not null default '',
  report_text text not null default '',
  status text not null default '접수' check (status in ('접수', '전송완료', '원격대기', '원격완료')),
  sent_room text not null default ''
);

create index if not exists service_receptions_date_idx on public.service_receptions(receipt_date desc, created_at desc);
create index if not exists service_receptions_type_idx on public.service_receptions(type, receipt_date desc);

alter table public.service_receptions enable row level security;
drop policy if exists "service_receptions anon read" on public.service_receptions;
drop policy if exists "service_receptions anon insert" on public.service_receptions;
drop policy if exists "service_receptions anon update" on public.service_receptions;
create policy "service_receptions anon read" on public.service_receptions for select to anon using (true);
create policy "service_receptions anon insert" on public.service_receptions for insert to anon with check (true);
create policy "service_receptions anon update" on public.service_receptions for update to anon using (true) with check (true);
grant select, insert, update on public.service_receptions to anon;
