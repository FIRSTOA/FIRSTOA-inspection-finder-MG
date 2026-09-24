-- 마감 문자 — 완료 표시 · 목록 추가 이력 (2026-09-24)
--
-- 왜: 문자는 보냈는데 마감(카운터 회신)까지 끝났는지 카드에서 구분이 안 됐다 → 보냄(✓) 다음 단계로 완료(✓✓)를 둔다.
--     새 마감 목록을 붙여 넣을 때 기존 목록을 갈아치우지 않고 "없는 업체만 추가"하며, 언제 누가 몇 곳을 추가했고
--     어떤 업체가 중복이라 빠졌는지 목록 머리에 남긴다.
-- Supabase SQL Editor에서 1회 실행. 실행 전에는 앱이 완료 표시·추가 이력 저장을 건너뛰고 안내만 띄운다.

alter table public.counter_sms_targets
  add column if not exists done_at timestamptz,
  add column if not exists done_by text,
  add column if not exists added_at timestamptz,
  add column if not exists added_by text;

alter table public.counter_sms_batches
  add column if not exists log jsonb not null default '[]'::jsonb;

-- 기존 업체는 목록이 올라온 시각을 추가 시각으로 본다
update public.counter_sms_targets t
set added_at = b.created_at
from public.counter_sms_batches b
where t.batch_id = b.id and t.added_at is null;

-- 확인
select count(*) filter (where done_at is not null) as done_rows, count(*) as total_rows from public.counter_sms_targets;
