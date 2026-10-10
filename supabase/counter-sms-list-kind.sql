-- 마감 문자 — 목록 종류(일반 / CMS) 구분 (2026-10-10)
--
-- 왜: 관리부는 "【수도권C】 26-10" 일반 마감 목록과 별도로 "[수도권C] … CMS.15" CMS 마감 목록을 따로 올린다.
--     앱의 [목록 맞추기](붙여넣은 목록에 없는 열린 업체를 자동 완료)가 CMS 목록을 전체 목록으로 오해하면
--     일반 마감 업체가 전부 완료돼 버린다 → 카드마다 종류를 저장해 같은 종류끼리만 맞춘다.
-- Supabase SQL Editor에서 1회 실행. 실행 전에는 앱이 CMS 목록을 "추가만"으로 올리고 안내만 띄운다.

alter table public.counter_sms_targets
  add column if not exists list_kind text not null default '',   -- '' 일반 마감 · 'CMS' CMS 마감
  add column if not exists cms_day int;                            -- "CMS.15" → 15 (CMS 결제일)

-- 확인
select list_kind, count(*) from public.counter_sms_targets group by 1;
