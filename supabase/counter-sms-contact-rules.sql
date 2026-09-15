-- 마감 문자 — 업체별 연락처 규칙 (팀 전체 공유). Supabase SQL Editor에서 1회 실행. 2026-09-16
--
-- 같은 업체를 분기마다 2~3번 보내다 보면 "이 사람한테 보내도 되나?"를 매번 다시 확인하던 것을,
-- 한 번 표시해 두면 다음 마감에 그 업체가 다시 올라와도 바로 보이게 한다.
--   · block  : 이 번호로는 보내지 말 것 (담당 아님·퇴사·연락 거부) — 사유·기록자·날짜
--   · prefer : 새 마감 담당자 연락처 — 다음부터 이 번호를 먼저 고른다
-- 컬럼명은 프론트 ContactRule 타입(src/counterSmsContacts.ts)과 1:1.
create table if not exists public.counter_sms_contact_rules (
  id text primary key,                                   -- 클라이언트 생성 (ccr-…)
  vendor_key text not null,                              -- 업체 비교키 (등급·순번·법인표기 제거 — vendorMatchKey)
  vendor text not null default '',                       -- 표시용 업체명 (그때 올라온 이름 그대로)
  phone text not null default '',                        -- 숫자만 (01012345678)
  kind text not null check (kind in ('block', 'prefer')),
  name text not null default '',                         -- 담당자 이름·직함 (prefer)
  memo text not null default '',                         -- 사유·비고
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 한 업체·한 번호에는 규칙 하나 (block ↔ prefer 바꾸면 덮어쓴다)
create unique index if not exists counter_sms_contact_rules_vendor_phone on public.counter_sms_contact_rules(vendor_key, phone);
create index if not exists counter_sms_contact_rules_vendor on public.counter_sms_contact_rules(vendor_key);

alter table public.counter_sms_contact_rules enable row level security;
drop policy if exists "counter_sms_contact_rules anon read" on public.counter_sms_contact_rules;
drop policy if exists "counter_sms_contact_rules anon insert" on public.counter_sms_contact_rules;
drop policy if exists "counter_sms_contact_rules anon update" on public.counter_sms_contact_rules;
drop policy if exists "counter_sms_contact_rules anon delete" on public.counter_sms_contact_rules;
create policy "counter_sms_contact_rules anon read" on public.counter_sms_contact_rules for select to anon using (true);
create policy "counter_sms_contact_rules anon insert" on public.counter_sms_contact_rules for insert to anon with check (true);
create policy "counter_sms_contact_rules anon update" on public.counter_sms_contact_rules for update to anon using (true) with check (true);
create policy "counter_sms_contact_rules anon delete" on public.counter_sms_contact_rules for delete to anon using (true);
grant select, insert, update, delete on public.counter_sms_contact_rules to anon;
