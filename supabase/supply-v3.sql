-- 자가·부품 3차 (2026-10-11): 신청의 두 가지 성격과 "지급" 단계
--  · 차량재고 지급(보충 요청): 현장에서 차량 재고를 바로 줬다 → 그 업체에 이미 '지급'된 것이고, 운영지원 출고는 차량 보충
--  · 출고 요청: 재고가 없어 다음에 가져다준다 → 출고 뒤 엔지니어가 [지급](어느 업체에 줬는지 고칠 수 있음) 또는 [반납]·[불량]
--  단계(stage)는 고객 쪽만 본다: 신청 → 지급 / 반납 / 불량. 출고 여부는 issued_at 로 따로(줄 긋기 표시).
-- supply-requests.sql, supply-v2.sql 다음에 실행("Run without RLS").

alter table public.supply_requests
  add column if not exists mode text not null default '출고요청',     -- 차량재고 | 출고요청
  add column if not exists issued_at timestamptz,                     -- 운영지원 출고(차량으로)
  add column if not exists issued_by text not null default '',
  add column if not exists used_vendor text not null default '',      -- 실제로 지급(장착)한 업체 — 신청 업체와 다를 수 있다
  add column if not exists used_at timestamptz,
  add column if not exists used_by text not null default '';
create index if not exists supply_requests_issued_idx on public.supply_requests(issued_at);
create index if not exists supply_requests_used_vendor_idx on public.supply_requests(used_vendor);

alter table public.supply_events drop constraint if exists supply_events_type_check;
alter table public.supply_events add constraint supply_events_type_check check (type in ('출고', '지급', '수령', '사용완료', '반납', '불량', '메모'));

alter table public.supply_events
  add column if not exists photo_url text not null default '',          -- 반납·불량 사진(어디에 뒀는지 / 불량접수 용지 붙인 사진)
  add column if not exists detail jsonb not null default '{}'::jsonb;   -- 불량 양식 값(정품/재생·재테스트·리포트·증상)

-- 확인
select mode, stage, count(*) from public.supply_requests group by mode, stage order by mode, stage;
