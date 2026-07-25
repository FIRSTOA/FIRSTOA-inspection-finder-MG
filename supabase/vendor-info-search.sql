-- 서비스접수 임대리스트 검색용: vendor_info 에 자산번호·순번 컬럼 승격 + 인덱스 + 트리거.
-- _raw(JSONB)에 원본 80컬럼 전체가 있으나 JSONB 스캔은 22,000행에서 타임아웃난다.
-- 자주 검색하는 키(자산번호·순번)만 정식 컬럼으로 빼고 인덱스를 건다.
-- 트리거로 _raw에서 자동 파생하므로, 외부 시트동기화가 _raw만 갱신해도 항상 유지된다. (1회 실행)

create extension if not exists pg_trgm;

alter table public.vendor_info add column if not exists "자산번호" text;
alter table public.vendor_info add column if not exists "순번" integer;

-- _raw → 컬럼 자동 파생 트리거
create or replace function public.vendor_info_sync_search() returns trigger as $$
begin
  new."자산번호" := nullif(new._raw->>'자산번호', '');
  new."순번" := case when new._raw->>'순' ~ '^\d+$' then (new._raw->>'순')::int else null end;
  return new;
end;
$$ language plpgsql;

drop trigger if exists vendor_info_sync_search_trg on public.vendor_info;
create trigger vendor_info_sync_search_trg
before insert or update on public.vendor_info
for each row execute function public.vendor_info_sync_search();

-- 기존 행 백필
update public.vendor_info
set "자산번호" = nullif(_raw->>'자산번호', ''),
    "순번" = case when _raw->>'순' ~ '^\d+$' then (_raw->>'순')::int else null end
where _raw is not null;

-- 인덱스 (ilike는 trigram, 순번은 btree)
create index if not exists vendor_info_asset_trgm on public.vendor_info using gin ("자산번호" gin_trgm_ops);
create index if not exists vendor_info_vendor_trgm on public.vendor_info using gin ("_업체명" gin_trgm_ops);
create index if not exists vendor_info_seq_idx on public.vendor_info ("순번");
