-- 미수현황 CS체크(관리부 체크 → CS팀 방문/전화 대상) 동기화 테이블 (1회 실행)
-- 미수 시트의 CS체크 열은 새벽 적재(misu)에 포함되지 않아 별도 테이블로 받는다.
-- 쓰기는 First-DATA GAS(syncMisuCsToSupabase, service_role)만 하고 웹앱은 읽기 전용.
create table if not exists public.misu_cs_checks (
  key text primary key,               -- 시트명|거래처명
  team text not null default '',      -- A~E (수도권A~E 시트에서 파생)
  vendor text not null default '',
  checked boolean not null default false,
  cs_manager text not null default '',
  cs1 text not null default '',       -- CS-1회 기록
  cs2 text not null default '',       -- CS-2회 기록
  synced_at timestamptz not null default now()
);

create index if not exists misu_cs_checks_checked_idx on public.misu_cs_checks(checked, team);

alter table public.misu_cs_checks enable row level security;
drop policy if exists "misu cs checks anon read" on public.misu_cs_checks;
create policy "misu cs checks anon read" on public.misu_cs_checks for select to anon using (true);
grant select on public.misu_cs_checks to anon;
