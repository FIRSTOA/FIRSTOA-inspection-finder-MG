-- 맛동여지도(2026-08-25): 주차 가능한 맛집을 팀이 함께 쌓는 공유 지도. 워킨맵과 같은 익명 공유 모델.
create table if not exists public.food_places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  address_detail text not null default '',
  lat double precision,
  lng double precision,
  gu text not null default '',                 -- 주소에서 뽑은 구·시 (필터용)
  parking text not null default '모름' check (parking in ('가능','유료','발렛','노상','불가','모름')),
  parking_memo text not null default '',       -- "건물 지하 2시간 무료", "골목 한 자리" 등
  menu text not null default '',               -- 추천 메뉴
  price text not null default '',              -- 1인 기준 가격대
  rating int not null default 0 check (rating between 0 and 5),
  tags text[] not null default '{}',           -- 혼밥·단체·빨리나옴·조용함 …
  memo text not null default '',
  author text not null default '',
  team text not null default '',
  likes int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists food_places_gu_idx on public.food_places(gu);
alter table public.food_places enable row level security;
drop policy if exists food_places_anon_all on public.food_places;
create policy food_places_anon_all on public.food_places for all to anon using (true) with check (true);
grant select, insert, update, delete on table public.food_places to anon, authenticated;
notify pgrst, 'reload schema';
