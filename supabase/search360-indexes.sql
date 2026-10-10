-- 통합 검색 360 — 원문 속 기번 검색을 빠르게 (2026-10-10, 선택 실행)
--
-- 왜: 기번이 글 속에만 적힌 옛 기록을 찾으려고 _원문 ilike 를 쓰는데, 2만 행짜리 표에서 statement timeout 이 났다.
--     앱은 그 조회를 따로 던져 실패해도 나머지 결과를 보여 주지만, 아래 trigram 색인을 만들면 그 조회도 즉시 끝난다.
-- Supabase SQL Editor 에서 1회 실행(수십 초). 색인 크기는 표당 수십 MB.

create extension if not exists pg_trgm;

create index if not exists jeomgeom_raw_trgm      on public.jeomgeom      using gin ("_원문" gin_trgm_ops);
create index if not exists as_records_raw_trgm    on public.as_records    using gin ("_원문" gin_trgm_ops);
create index if not exists receptions_report_trgm on public.service_receptions using gin (report_text gin_trgm_ops);
create index if not exists visit_logs_src_trgm    on public.visit_logs    using gin (source_text gin_trgm_ops);
create index if not exists overage_raw_trgm       on public.overage       using gin ("_원문" gin_trgm_ops);
create index if not exists logistics_raw_trgm     on public.logistics_records using gin ("_원문" gin_trgm_ops);

-- 이름·기기 칸 정확 일치(in 목록)는 b-tree 로
create index if not exists jeomgeom_vendor_idx    on public.jeomgeom ("_업체명");
create index if not exists jeomgeom_asset_idx     on public.jeomgeom ("자산기번");
create index if not exists jeomgeom_serial_idx    on public.jeomgeom ("시리얼넘버");
create index if not exists as_records_vendor_idx  on public.as_records ("_업체명");
create index if not exists as_records_asset_idx   on public.as_records ("자산기번");
create index if not exists as_records_serial_idx  on public.as_records ("시리얼넘버");
create index if not exists vendor_info_code_idx   on public.vendor_info ("코드");
create index if not exists vendor_info_vendor_idx on public.vendor_info ("_업체명");

-- 확인
select indexname from pg_indexes where schemaname = 'public' and indexname like '%trgm%' order by 1;
