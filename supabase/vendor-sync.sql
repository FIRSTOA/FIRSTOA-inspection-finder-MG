-- 임대리스트 주간 동기화 준비 (1회 실행)
-- First-DATA-MG의 syncLeaseToSupabase()가 순번 기준으로 업서트할 수 있게
-- 순번 유니크 인덱스를 만든다. (NULL 순번은 여러 개 허용 — 업서트 대상 아님)

-- 혹시 있을 순번 중복 정리 (최신 id 유지)
delete from public.vendor_info a
using public.vendor_info b
where a."순번" is not null and a."순번" = b."순번" and a.id < b.id;

create unique index if not exists vendor_info_seq_uidx on public.vendor_info("순번");

-- 동기화 시간 필터(_등록시각 정렬·비교)용 인덱스
create index if not exists vendor_info_synced_idx on public.vendor_info("_등록시각");

notify pgrst, 'reload schema';
