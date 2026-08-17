-- 고객 리포트 2단계: 수신자 관리 + 발송 로그 + 리포트 이미지 저장소 (2026-08-17)
-- 수신자: 업체 core 이름 기준. 삭제는 active=false (익명 DELETE 없음)
create table if not exists report_recipients (
  id bigserial primary key,
  vendor text not null,
  name text not null default '',
  phone text not null,
  memo text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists report_recipients_vendor_idx on report_recipients (vendor);
alter table report_recipients enable row level security;
drop policy if exists "report_recipients anon read" on report_recipients;
create policy "report_recipients anon read" on report_recipients for select to anon using (true);
drop policy if exists "report_recipients anon insert" on report_recipients;
create policy "report_recipients anon insert" on report_recipients for insert to anon with check (true);
drop policy if exists "report_recipients anon update" on report_recipients;
create policy "report_recipients anon update" on report_recipients for update to anon using (true) with check (true);
revoke update on report_recipients from anon;
grant update (name, phone, memo, active) on report_recipients to anon;
grant select, insert on report_recipients to anon;
grant usage on sequence report_recipients_id_seq to anon;

create table if not exists report_send_log (
  id bigserial primary key,
  vendor text not null,
  period text not null default '',
  channel text not null default 'sms',
  recipient_name text not null default '',
  phone text not null default '',
  status text not null default 'sent',
  error text not null default '',
  image_url text not null default '',
  sender text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists report_send_log_vendor_idx on report_send_log (vendor, created_at desc);
alter table report_send_log enable row level security;
drop policy if exists "report_send_log anon read" on report_send_log;
create policy "report_send_log anon read" on report_send_log for select to anon using (true);
drop policy if exists "report_send_log anon insert" on report_send_log;
create policy "report_send_log anon insert" on report_send_log for insert to anon with check (true);
grant select, insert on report_send_log to anon;
grant usage on sequence report_send_log_id_seq to anon;

-- 리포트 이미지 공개 버킷 (문자에 링크로 첨부)
insert into storage.buckets (id, name, public) values ('reports', 'reports', true)
on conflict (id) do update set public = true;
drop policy if exists "reports anon upload" on storage.objects;
create policy "reports anon upload" on storage.objects for insert to anon with check (bucket_id = 'reports');
drop policy if exists "reports public read" on storage.objects;
create policy "reports public read" on storage.objects for select to anon using (bucket_id = 'reports');
