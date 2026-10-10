-- 부품 신청·자가 신청(여분) 표 (2026-10-11)
-- 점검·AS 양식의 ※부품신청※ / ※자가신청※ 칸을 품목 단위로 쌓는다. 앱이 전송할 때 넣고, 관리 탭 [지난 기록 채우기]가 원문에서 과거분을 채운다.
-- 통합검색(상태 카드·타임라인)과 전체 데이터 질문("C팀 이번 달 여분 신청 몇 개")이 이 표를 읽는다.
-- 나중에 자가 반납·부품 반납·사용 후 부품 관리와 이을 자리(returned_at·return_note·return_by)를 미리 둔다.
-- Supabase SQL Editor 에서 1회 실행("Run without RLS").

create table if not exists public.supply_requests (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  request_date date not null,                 -- 보고 작성일
  kind text not null check (kind in ('부품', '자가')),
  vendor text not null default '',
  team text not null default '',
  author text not null default '',
  model text not null default '',             -- 보고의 첫 기기
  serial text not null default '',
  asset text not null default '',
  item text not null default '',              -- 품목(드럼·현상기·K 토너·픽업롤러 …)
  qty text not null default '',               -- 수량(글 그대로)
  status text not null default '',            -- 출고여부(선출고완료·출고부탁드립니다 …)
  warranty text not null default '',          -- 보증기간 내 여부(부품)
  counter text not null default '',           -- 교체 전 카운터 누적 매수(부품)
  expected text not null default '',          -- 사용 부품 예상 사용매수(부품)
  source_table text not null default '',      -- jeomgeom / as_records
  source_id text not null default '',         -- 원본 행 id(전송 때는 아직 몰라 비움, 채우기는 채움)
  raw text not null default '',               -- 그 칸 원문
  "_dupKey" text not null,                    -- md5(원본표|작성일|작성자|업체|종류|품목|수량) — 전송·채우기 어느 길이든 한 번만
  returned_at timestamptz,                    -- (예약) 반납·회수 처리 시각
  return_by text not null default '',         -- (예약) 처리자
  return_note text not null default ''        -- (예약) 사용 후 부품 상태·반납 메모
);
create unique index if not exists supply_requests_dup_idx on public.supply_requests("_dupKey");
create index if not exists supply_requests_vendor_idx on public.supply_requests(vendor);
create index if not exists supply_requests_date_idx on public.supply_requests(request_date desc);
create index if not exists supply_requests_kind_idx on public.supply_requests(kind, request_date desc);
grant select, insert, update on public.supply_requests to anon;
grant usage, select on sequence public.supply_requests_id_seq to anon;

-- 확인
select count(*) as rows from public.supply_requests;
