-- 거래처 코드 단일화 1단계 — 거래처 마스터 + 워킨맵 코드 매핑
--
-- 원칙:
--  * 임대리스트(vendor_info)는 읽기만 한다. 원본의 어떤 값도 바꾸지 않는다.
--  * 키는 2층: 거래처 코드(업체 층, 임대리스트 "거래처 코드" = 사업자번호 형태)
--               ← 자산번호/시리얼(기기 층)
--  * 이름 퍼지 매칭은 "코드 번역" 시점에 한 번만 쓰고 결과를 저장한다.
--    (지금처럼 조회 때마다 실시간 매칭하지 않는 것이 목표)
--
-- 재실행: select refresh_vendor_master();  select map_workin_vendor_codes();
--         (임대리스트 재동기화나 워킨맵 분기 갱신 후 다시 돌리면 된다)

create table if not exists vendor_master (
  code text primary key,                 -- 임대리스트 "거래처 코드"
  name text not null,                    -- 대표 거래처명 (기기 수 최다 표기)
  aliases jsonb not null default '[]',   -- 임대리스트에 등장한 이름 변형(정리본)
  device_count int not null default 0,   -- 임대리스트 행 수(≒ 기기·계약 수)
  updated_at timestamptz not null default now()
);
alter table vendor_master enable row level security;
drop policy if exists "vendor_master anon read" on vendor_master;
create policy "vendor_master anon read" on vendor_master for select to anon using (true);
grant select on vendor_master to anon, authenticated;

-- 이름 → 코드 번역용 키 테이블 (vendor_key_ 8자 키가 유일할 때만 자동 매칭에 쓴다)
create table if not exists vendor_alias_key (
  akey text not null,
  code text not null,
  primary key (akey, code)
);
alter table vendor_alias_key enable row level security;
drop policy if exists "vendor_alias_key anon read" on vendor_alias_key;
create policy "vendor_alias_key anon read" on vendor_alias_key for select to anon using (true);
grant select on vendor_alias_key to anon, authenticated;

create or replace function refresh_vendor_master() returns json language plpgsql as $$
declare n_master int; n_alias int;
begin
  delete from vendor_alias_key;
  delete from vendor_master;

  insert into vendor_master (code, name, aliases, device_count)
  select code,
         mode() within group (order by trader) as name,
         (select jsonb_agg(distinct x) from unnest(array_agg(trader) || array_agg(cleaned)) x where coalesce(x,'') <> '') as aliases,
         count(*) as device_count
  from (
    select btrim(_raw->>'거래처 코드') as code,
           btrim(_raw->>'거래처명') as trader,
           workin_vendor_(_raw->>'업체명') as cleaned
    from vendor_info
    where coalesce(btrim(_raw->>'거래처 코드'), '') <> ''
  ) t
  group by code;
  get diagnostics n_master = row_count;

  insert into vendor_alias_key (akey, code)
  select distinct vendor_key_(alias), code
  from vendor_master, jsonb_array_elements_text(aliases) alias
  where length(vendor_key_(alias)) >= 3;
  get diagnostics n_alias = row_count;

  return json_build_object('vendors', n_master, 'alias_keys', n_alias);
end $$;

-- 워킨맵 지점 → 거래처 코드 매핑 (근거를 method에 남긴다: serial > asset > name)
create table if not exists workin_vendor_code (
  place_id bigint primary key,
  code text not null,
  method text not null,     -- 'serial' | 'asset' | 'name'
  matched text,             -- 매칭 근거 값(정규화된 시리얼/자산번호 또는 이름 키)
  updated_at timestamptz not null default now()
);
alter table workin_vendor_code enable row level security;
drop policy if exists "workin_vendor_code anon read" on workin_vendor_code;
create policy "workin_vendor_code anon read" on workin_vendor_code for select to anon using (true);
grant select on workin_vendor_code to anon, authenticated;

create or replace function map_workin_vendor_codes() returns json language plpgsql as $$
declare n_serial int; n_asset int; n_name int; n_total int; n_unmatched int;
begin
  delete from workin_vendor_code;

  -- 기기 식별자(정규화) → 코드. 코드가 갈리는 식별자는 자동 매칭에서 제외한다.
  create temp table _lease_ids on commit drop as
  select ident, min(code) as code
  from (
    select regexp_replace(lower(coalesce(_raw->>'시리얼번호(기번)','')), '[^0-9a-z]', '', 'g') as ident,
           btrim(_raw->>'거래처 코드') as code
    from vendor_info where coalesce(btrim(_raw->>'거래처 코드'),'') <> ''
    union all
    select regexp_replace(lower(coalesce(_raw->>'자산번호','')), '[^0-9a-z]', '', 'g'),
           btrim(_raw->>'거래처 코드')
    from vendor_info where coalesce(btrim(_raw->>'거래처 코드'),'') <> ''
  ) t
  where length(ident) >= 4
  group by ident
  having count(distinct code) = 1;

  -- 1순위: 워킨맵 comment("모델 / 시리얼")의 시리얼이 임대리스트 식별자와 일치
  insert into workin_vendor_code (place_id, code, method, matched)
  select w.id, l.code, 'serial', s.ident
  from workin_map_places w
  cross join lateral (
    select regexp_replace(lower(btrim(split_part(coalesce(w.comment,''), '/', 2))), '[^0-9a-z]', '', 'g') as ident
  ) s
  join _lease_ids l on l.ident = s.ident
  where w.visible is not false and length(s.ident) >= 4;
  get diagnostics n_serial = row_count;

  -- 2순위: comment 앞부분(모델 칸)에 자산번호를 적어둔 지점 — 동일 식별자 풀로 잡는다
  insert into workin_vendor_code (place_id, code, method, matched)
  select w.id, l.code, 'asset', s.ident
  from workin_map_places w
  cross join lateral (
    select regexp_replace(lower(btrim(split_part(coalesce(w.comment,''), '/', 1))), '[^0-9a-z]', '', 'g') as ident
  ) s
  join _lease_ids l on l.ident = s.ident
  where w.visible is not false and length(s.ident) >= 4
    and not exists (select 1 from workin_vendor_code x where x.place_id = w.id);
  get diagnostics n_asset = row_count;

  -- 3순위: 이름 키(vendor_key_ 8자)가 별칭 테이블에서 코드 하나로만 이어질 때
  insert into workin_vendor_code (place_id, code, method, matched)
  select w.id, min(a.code), 'name', vendor_key_(workin_vendor_(w.name))
  from workin_map_places w
  join vendor_alias_key a on a.akey = vendor_key_(workin_vendor_(w.name))
  where w.visible is not false
    and length(vendor_key_(workin_vendor_(w.name))) >= 3
    and not exists (select 1 from workin_vendor_code x where x.place_id = w.id)
  group by w.id
  having count(distinct a.code) = 1;
  get diagnostics n_name = row_count;

  select count(*) into n_total from workin_map_places where visible is not false;
  n_unmatched := n_total - n_serial - n_asset - n_name;
  return json_build_object('total', n_total, 'by_serial', n_serial, 'by_asset', n_asset,
                           'by_name', n_name, 'unmatched', n_unmatched);
end $$;

notify pgrst, 'reload schema';
