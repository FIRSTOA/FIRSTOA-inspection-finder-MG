-- OKR — 월별 목표 · 파트별 실행결과 · 통합집계 (2026-09-24)
--
-- 왜: 엑셀 'CS팀_8월_OKR_실행결과' 워크북(작성가이드 / 통합집계 / A~D파트 시트)을 웹앱 기록·성과 > OKR 탭으로 옮긴다.
--     파트마다 파일을 따로 내고 팀장이 다시 모으던 것을, 한 화면에서 파트별로 적으면 통합집계가 자동으로 모이게.
-- Supabase SQL Editor에서 1회 실행(다시 실행해도 안전). 표만 만든다 —
-- 8월·9월 데이터는 OKR 탭의 [엑셀 데이터 불러오기] 버튼으로 넣는다(또는 okr-seed.sql).
--
-- okr_cycles : 기간 하나(월간 '2026-08' / 주간 '2026-09-W2'). 목표(goals)와 팀장 피드백(feedback)을 든다.
--   goals    = [{no, pillar, bottleneck, objective, criteria}]
--   feedback = {"3": {action: '조치 필요 파트', memo: '미흡항목 피드백 & 다음 달 개선 방향'}}
-- okr_reports: 기간 × 파트 × 사람(member ''=파트 종합). header = {leader, author, headcount, submitted}, rows = [{no, actual, judgment, reason, plan, evidence}]

create table if not exists public.okr_cycles (
  id text primary key,
  kind text not null default 'month' check (kind in ('month', 'week')),
  title text not null default '',
  year integer not null,
  month integer not null check (month between 1 and 12),
  week_no integer,
  start_date date not null,
  end_date date not null,
  parent_id text references public.okr_cycles(id) on delete set null,
  goals jsonb not null default '[]'::jsonb,
  feedback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.okr_reports (
  cycle_id text not null references public.okr_cycles(id) on delete cascade,
  team text not null,
  member text not null default '',        -- '' = 파트 종합, 그 외 = 팀원 이름
  header jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (cycle_id, team, member)
);
-- 먼저 만든 표(기본키가 cycle_id, team)였다면 member 열과 새 기본키로 올린다
alter table public.okr_reports add column if not exists member text not null default '';
do $$ begin
  if not exists (select 1 from information_schema.key_column_usage where table_schema = 'public' and table_name = 'okr_reports' and constraint_name = 'okr_reports_pkey' and column_name = 'member') then
    alter table public.okr_reports drop constraint if exists okr_reports_pkey;
    alter table public.okr_reports add primary key (cycle_id, team, member);
  end if;
end $$;

create index if not exists okr_cycles_start_idx on public.okr_cycles (start_date desc);

alter table public.okr_cycles enable row level security;
alter table public.okr_reports enable row level security;
drop policy if exists "okr_cycles anon all" on public.okr_cycles;
drop policy if exists "okr_reports anon all" on public.okr_reports;
-- 앱이 anon 키로 읽고 쓰는 기존 방식과 같다(직원 로그인 도입 시 auth.uid() 기반으로 교체).
create policy "okr_cycles anon all" on public.okr_cycles for all to anon using (true) with check (true);
create policy "okr_reports anon all" on public.okr_reports for all to anon using (true) with check (true);
grant select, insert, update, delete on public.okr_cycles to anon;
grant select, insert, update, delete on public.okr_reports to anon;

-- 확인
select table_name from information_schema.tables where table_schema = 'public' and table_name in ('okr_cycles', 'okr_reports');
