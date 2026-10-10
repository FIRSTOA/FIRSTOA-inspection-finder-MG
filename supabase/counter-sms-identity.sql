-- 마감 문자 — 업체·기기 식별 칸 + 관리부 목록 도착함 (2026-10-10)
--
-- 왜: ① 🚫·⭐ 연락처 규칙이 "업체명 키가 똑같을 때"만 잡혔다. 관리부 목록의 기기 줄("23013 / 모델 / 기번 / 자산")에 든
--       임대 코드·기번을 카드와 규칙에 저장해 이름 표기가 달라져도(층·메모·글자 빠짐) 같은 업체·기기로 잇는다.
--     ② 관리부가 마감방에 목록을 올리면 봇 폰이 그 글을 counter_sms_inbox 에 넣는다(gas-and-bot/counter-list-collector.js).
--       앱은 "새 목록 도착"을 보여 주고 [목록 맞추기]로 바로 넣는다. 붙여넣기가 사라진다.
-- Supabase SQL Editor 에서 1회 실행. 실행 전에는 앱이 이 기능만 건너뛴다.

alter table public.counter_sms_targets
  add column if not exists lease_code text,                     -- 임대 코드(5자리) — 관리부 목록 기기 줄 맨 앞
  add column if not exists serials jsonb not null default '[]'::jsonb,
  add column if not exists assets  jsonb not null default '[]'::jsonb;

alter table public.counter_sms_contact_rules
  add column if not exists lease_code text not null default '',
  add column if not exists serial     text not null default '';

create table if not exists public.counter_sms_inbox (
  id bigserial primary key,
  room text not null default '',          -- 올라온 카톡방
  sender text not null default '',        -- 올린 사람(관리부)
  text text not null,                     -- 목록 원문 그대로
  received_at timestamptz not null default now(),
  applied_at timestamptz,                 -- 앱에서 목록으로 넣은 때
  applied_by text,
  batch_id text,                          -- 넣은 목록(counter_sms_batches.id)
  note text
);
create index if not exists counter_sms_inbox_open_idx on public.counter_sms_inbox(applied_at, received_at desc);
grant select, insert, update on public.counter_sms_inbox to anon;     -- 봇(anon)이 넣고, 앱(anon)이 읽고 적용 표시
grant usage, select on sequence public.counter_sms_inbox_id_seq to anon;

-- 확인
select count(*) filter (where lease_code is not null) as targets_with_code from public.counter_sms_targets;
select count(*) as inbox_rows from public.counter_sms_inbox;
