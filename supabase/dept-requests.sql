-- 부서 요청 (1회 실행): 타부서가 CS팀에 남기는 요청 목록
create table if not exists public.dept_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  requester text not null default '',          -- 요청 부서/이름 (예: 관리부 김OO)
  kind text not null default '기타' check (kind in ('카운터확인', '미수체크', '방문요청', '기타')),
  vendor text not null default '',
  content text not null default '',
  due_date date,
  status text not null default '대기' check (status in ('대기', '처리중', '완료')),
  handled_by text not null default '',
  handled_at timestamptz,
  memo text not null default ''
);
create index if not exists dept_requests_status_idx on public.dept_requests(status, created_at desc);
alter table public.dept_requests enable row level security;
drop policy if exists "dept_requests anon all" on public.dept_requests;
create policy "dept_requests anon all" on public.dept_requests for all to anon using (true) with check (true);
grant select, insert, update, delete on public.dept_requests to anon;
notify pgrst, 'reload schema';
