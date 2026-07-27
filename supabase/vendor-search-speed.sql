-- 거래처 검색(FIELD탭) 속도 개선 — trigram 인덱스 (1회 실행)
-- search_vendors RPC와 기기번호 검색이 jeomgeom(16,591행)·as_records(12,489행)를
-- ilike '%키워드%'로 훑는데, 이 형태는 pg_trgm GIN 인덱스가 있어야 빨라진다.
create extension if not exists pg_trgm;

create index if not exists jeomgeom_vendor_trgm  on public.jeomgeom   using gin ("_업체명" gin_trgm_ops);
create index if not exists jeomgeom_vendor2_trgm on public.jeomgeom   using gin ("업체명" gin_trgm_ops);
create index if not exists jeomgeom_serial_trgm  on public.jeomgeom   using gin ("시리얼넘버" gin_trgm_ops);
create index if not exists jeomgeom_asset_trgm   on public.jeomgeom   using gin ("자산기번" gin_trgm_ops);

create index if not exists as_records_vendor_trgm  on public.as_records using gin ("_업체명" gin_trgm_ops);
create index if not exists as_records_vendor2_trgm on public.as_records using gin ("업체명" gin_trgm_ops);
create index if not exists as_records_serial_trgm  on public.as_records using gin ("시리얼넘버" gin_trgm_ops);
create index if not exists as_records_asset_trgm   on public.as_records using gin ("자산기번" gin_trgm_ops);

-- 그래도 느리면 RPC 본문을 확인해 추가 튜닝: 아래 결과를 붙여주면 된다.
-- select pg_get_functiondef('public.search_vendors'::regproc);
