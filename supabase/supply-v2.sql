-- 자가·부품 2차 (2026-10-11): 재고 표에 '자가' 종류 + 품목 사전(별칭·쓰는 기종·색), 신청 행에 표준 품목·단계, 사건 표(출고·수령·사용완료·반납·불량)
-- supply-requests.sql 다음에 실행. Supabase SQL Editor 에서 1회("Run without RLS").

-- 1) 재고 표 = 품목 사전. 기기·부품에 '자가'(토너·폐토너통 같은 소모품) 추가
alter table public.stock_items drop constraint if exists stock_items_kind_check;
alter table public.stock_items add constraint stock_items_kind_check check (kind in ('기기', '부품', '자가'));
alter table public.stock_items
  add column if not exists category text not null default '',        -- 토너 / 폐토너통 / 드럼 / 현상기 / 롤러 / 정착기 / 전사벨트 / 기타
  add column if not exists color text not null default '',           -- 토너 색 K / C / M / Y
  add column if not exists aliases text[] not null default '{}',     -- 양식 글에서 쓰이는 다른 이름(검정토너, BK, 폐통 …)
  add column if not exists models text[] not null default '{}',      -- 이 품목을 쓰는 기종(자가표). 세트 풀기에 쓴다
  add column if not exists unit text not null default '개';

-- 2) 신청 행에 표준 품목·단계
alter table public.supply_requests
  add column if not exists item_std text not null default '',        -- 사전에 맞춘 표준 이름(못 맞추면 빈값 = 미정의 품목)
  add column if not exists category text not null default '',
  add column if not exists color text not null default '',
  add column if not exists stock_item_id text not null default '',
  add column if not exists set_label text not null default '',       -- 원문이 "1세트"였으면 그 표기
  add column if not exists stage text not null default '신청';       -- 신청 → 출고 → 수령 → 사용완료 / 반납 / 불량
create index if not exists supply_requests_stage_idx on public.supply_requests(stage, request_date desc);

-- 3) 사건 표 — 신청 한 줄 뒤에 붙는 출고·수령·반납·불량 기록(수량 포함). 재고 추정과 운영지원 전달 자료의 근거
create table if not exists public.supply_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  request_id bigint not null references public.supply_requests(id) on delete cascade,
  type text not null check (type in ('출고', '수령', '사용완료', '반납', '불량', '메모')),
  qty int not null default 0,
  note text not null default '',          -- 불량 사유·반납 사유·망가진 부품 둔 곳 등
  author text not null default '',
  dept text not null default '',          -- CS팀 / 운영지원
  kakao_text text not null default ''     -- 방에 보낸 글(보냈으면)
);
create index if not exists supply_events_req_idx on public.supply_events(request_id, created_at);
grant select, insert, update on public.supply_events to anon;
grant usage, select on sequence public.supply_events_id_seq to anon;

-- 4) 기본 품목(브랜드 공통) — 운영지원이 정확한 목록을 주면 재고 탭에서 고치거나 늘린다. 이미 같은 이름이 있으면 건너뜀
insert into public.stock_items (kind, brand, name, category, color, aliases, qty, updated_by)
select v.kind, '', v.name, v.category, v.color, v.aliases, 0, '기본 품목'
from (values
  ('자가', '토너 K', '토너', 'K', array['K','k','검정','검정토너','블랙','블랙토너','BK','K토너','흑백토너','토너K']),
  ('자가', '토너 C', '토너', 'C', array['C','c','시안','청색','파랑','파랑토너','C토너','토너C','사이안']),
  ('자가', '토너 M', '토너', 'M', array['M','m','마젠타','빨강','적색','빨강토너','M토너','토너M','마젠다']),
  ('자가', '토너 Y', '토너', 'Y', array['Y','y','옐로우','노랑','황색','노랑토너','Y토너','토너Y','옐로']),
  ('자가', '폐토너통', '폐토너통', '', array['폐통','폐토너','폐토너박스','폐토너통','폐토너 통','웨이스트토너','WT']),
  ('부품', '드럼', '드럼', '', array['드럼','드럼유닛','DRUM','이미징유닛','이미징 유닛','감광드럼']),
  ('부품', '현상기', '현상기', '', array['현상기','현상유닛','DEV','현상 유닛','데브']),
  ('부품', '픽업롤러', '롤러', '', array['픽업롤러','픽업','급지롤러','픽업 롤러','피드롤러']),
  ('부품', '롤러', '롤러', '', array['롤러','롤라']),
  ('부품', '정착기', '정착기', '', array['정착기','퓨저','FUSER','휴저','정착유닛','퓨저유닛']),
  ('부품', '전사벨트', '전사벨트', '', array['전사벨트','ITB','전사','전사유닛','벨트']),
  ('부품', '클러치', '기타', '', array['클러치']),
  ('부품', '부싱', '기타', '', array['부싱','부쉬']),
  ('부품', '분리패드', '기타', '', array['분리패드','급지패드','패드'])
) as v(kind, name, category, color, aliases)
where not exists (select 1 from public.stock_items s where s.kind = v.kind and s.name = v.name);

-- 확인
select kind, count(*) from public.stock_items group by kind order by kind;
