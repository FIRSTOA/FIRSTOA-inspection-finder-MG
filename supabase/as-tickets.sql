-- 일정리스트/캘린더 공유 테이블 (1회 실행) — 백로그 D
-- 기존에는 브라우저 localStorage에만 저장돼 기기·직원 간 공유가 안 됐다.
-- 컬럼명은 프론트 AsTicket 타입과 1:1 (scheduleType은 따옴표로 camelCase 유지).
create table if not exists public.as_tickets (
  id text primary key,               -- 클라이언트 생성 id (기존 localStorage id 그대로 이관)
  team text not null default 'A' check (team in ('A', 'B', 'C', 'D')),
  date text not null,                -- YYYY-MM-DD
  time text not null default '09:00',
  vendor text not null default '',
  contact text not null default '',
  address text not null default '',
  department text not null default '',
  model text not null default '',
  serial text not null default '',
  issue text not null default '',
  assignee text not null default '',
  status text not null default '접수' check (status in ('접수', '배정', '완료', '익일')),
  "scheduleType" text not null default 'AS' check ("scheduleType" in ('AS', '익일AS', '물류', '휴가')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists as_tickets_date_idx on public.as_tickets(date, time);

-- 저장 시 updated_at 자동 갱신
create or replace function public.as_tickets_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists as_tickets_touch on public.as_tickets;
create trigger as_tickets_touch before update on public.as_tickets
  for each row execute function public.as_tickets_touch();

alter table public.as_tickets enable row level security;
drop policy if exists "as_tickets anon read" on public.as_tickets;
drop policy if exists "as_tickets anon insert" on public.as_tickets;
drop policy if exists "as_tickets anon update" on public.as_tickets;
drop policy if exists "as_tickets anon delete" on public.as_tickets;
create policy "as_tickets anon read" on public.as_tickets for select to anon using (true);
create policy "as_tickets anon insert" on public.as_tickets for insert to anon with check (true);
create policy "as_tickets anon update" on public.as_tickets for update to anon using (true) with check (true);
create policy "as_tickets anon delete" on public.as_tickets for delete to anon using (true);
grant select, insert, update, delete on public.as_tickets to anon;

-- 포인트 점검 유형 추가 (2026-07-27)
alter table public.as_tickets drop constraint if exists "as_tickets_scheduleType_check";
alter table public.as_tickets add constraint "as_tickets_scheduleType_check"
  check ("scheduleType" in ('AS', '익일AS', '물류', '휴가', '포인트 점검'));

-- 매월 반복 (2026-07-27)
alter table public.as_tickets add column if not exists "repeatMonthly" boolean not null default false;
