-- 팀 전용 캘린더 (2026-08-25): 일정리스트·네이버와 동기화되지 않는, 팀끼리만 보는 메모 캘린더.
-- 앱은 익명 키 단일 모델이라 "팀만 본다"는 화면(작성자의 팀)에서 걸러진다 — 다른 팀 데이터를 API로 막는 구조는 아니다.
create table if not exists public.team_calendar_events (
  id uuid primary key default gen_random_uuid(),
  team text not null check (team in ('A','B','C','D','E','팀장')),
  date date not null,
  time text not null default '',
  title text not null,
  memo text not null default '',
  author text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_calendar_events_team_date_idx on public.team_calendar_events(team, date);
alter table public.team_calendar_events enable row level security;
drop policy if exists team_calendar_anon_all on public.team_calendar_events;
create policy team_calendar_anon_all on public.team_calendar_events for all to anon using (true) with check (true);
grant select, insert, update, delete on table public.team_calendar_events to anon, authenticated;
notify pgrst, 'reload schema';
