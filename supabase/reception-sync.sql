-- 서비스접수 개선 7종 (1회 실행)
-- ① 임대리스트 시리얼(기번) 검색 ② 접수 소프트삭제 ③ 일정↔접수 상태 동기화
-- ④ 접수현황 순·자산기번 ⑤~⑦은 프론트 코드만

-- ① vendor_info에 기번 승격 + 검색 인덱스 (자산번호·순번과 동일 패턴)
alter table public.vendor_info add column if not exists "기번" text;
create or replace function public.vendor_info_sync_search() returns trigger as $$
begin
  new."자산번호" := nullif(new._raw->>'자산번호', '');
  new."순번" := case when new._raw->>'순' ~ '^\d+$' then (new._raw->>'순')::int else null end;
  new."기번" := nullif(coalesce(nullif(new._raw->>'시리얼번호(기번)', ''), nullif(new._raw->>'기번', '')), '');
  return new;
end;
$$ language plpgsql;
update public.vendor_info
set "기번" = nullif(coalesce(nullif(_raw->>'시리얼번호(기번)', ''), nullif(_raw->>'기번', '')), '')
where _raw is not null;
create index if not exists vendor_info_serial_trgm on public.vendor_info using gin ("기번" gin_trgm_ops);

-- ②④ 접수 테이블: 소프트삭제 플래그 + 순번·주소 저장, 상태값 제약 해제(완료/익일 동기화용)
alter table public.service_receptions add column if not exists deleted boolean not null default false;
alter table public.service_receptions add column if not exists lease_no text not null default '';
alter table public.service_receptions add column if not exists address text not null default '';
alter table public.service_receptions drop constraint if exists service_receptions_status_check;

-- ③ 일정 티켓에 접수 연결 키
alter table public.as_tickets add column if not exists "receptionId" text not null default '';

-- 증상 사진 (2026-07-26 추가): 서비스접수 사진 URL 배열
alter table public.service_receptions add column if not exists photos jsonb not null default '[]'::jsonb;

-- 주소 수정 접수 표시 (2026-07-26 추가): 임대리스트와 다른 주소로 접수된 건 플래그
alter table public.service_receptions add column if not exists address_changed boolean not null default false;
