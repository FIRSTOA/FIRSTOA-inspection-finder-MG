-- 오전송 처리: 주간현황판/일일방문일지/업무현황에서 같은 전송을 함께 제외하기 위한 1회 실행 SQL
alter table public.visit_logs add column if not exists status text not null default 'active' check (status in ('active', 'cancelled'));
alter table public.visit_logs add column if not exists cancelled_at timestamptz;
alter table public.visit_logs add column if not exists cancelled_by text;
create index if not exists visit_logs_status_date_idx on public.visit_logs(status, work_date desc);

drop policy if exists "visit_logs anon update" on public.visit_logs;
create policy "visit_logs anon update"
  on public.visit_logs for update to anon using (true) with check (true);

grant update on public.visit_logs to anon;
