-- 자동 일정 짜기 — 워킨맵(그 분기 방문 대상) 기준 추천
-- 점검(kind=quarter)·재계약(renewal)·매월(monthly) 모두 워킨맵에만 있는 곳에서 찾는다.
-- 앵커(그날 마지막 필수 일정) 좌표에서 가까운 순 + 마지막 점검 경과일 기준.
-- v2(2026-08-15): 점검이력을 거래처 코드로 먼저 잇고(이름 키는 폴백 — 미매칭 948→359곳),
--                 최근 2회 점검(매수·토너·여분·폐통·특이사항)과 임대리스트 기기 목록을 함께 반환.
create or replace function safe_date_(v text) returns date language plpgsql immutable as $$
declare m text; begin
  m := substring(coalesce(v,'') from '\d{4}[-./]\d{1,2}[-./]\d{1,2}');
  if m is null then return null; end if;
  begin return replace(replace(m, '.', '-'), '/', '-')::date; exception when others then return null; end;
end $$;

-- 워킨맵 이름에서 등급과 업체명을 분리: "14SS㈜이오플랜본사1매월마감" → SS / ㈜이오플랜본사
create or replace function workin_grade_(nm text) returns text language sql immutable as $$
  select coalesce(upper((regexp_match(coalesce(nm,''), '^\s*[\d/\-#]*\s*(V|SS|S|NN|N)(?=[^A-Za-z]|$)'))[1]), '');
$$;
-- 워킨맵 이름은 "숫자+등급+업체명+특이사항/마감구분"이 붙어 있고 줄바꿈(_x000d_)까지 섞인다.
-- 점검 이력(jeomgeom._업체명)과 맞추려면 업체명만 남겨야 매칭된다 (카운터문자 파서와 같은 규칙).
create or replace function workin_vendor_(nm text) returns text language sql immutable as $$
  with t as (select regexp_replace(regexp_replace(coalesce(nm,''), '_x000d_|\r|\n', ' ', 'g'), '\s+', ' ', 'g') as v),
  a as (select btrim(regexp_replace(v, '^\s*[\d/\-#]*\s*(V|SS|S|NN|N)(?=[^A-Za-z])', '')) as v from t),
  b as (select split_part(v, '/', 1) as v from a),  -- 특이사항은 / 뒤에 붙는다
  c as (select regexp_replace(v, '(매월마감|분기마감|매주마감|월말마감|단순마감|매년마감|매월방문|매주방문|격주방문|월말방문|마감|매년).*$', '') as v from b),
  c2 as (select regexp_replace(v, '[\s\-·,()]+$', '') as v from c),
  -- "블루닷 주식회사(bluedot Inc.)" — 영문 괄호 꼬리(닫힘 유실 포함)와 뒤에 붙은 법인표기를 벗겨야 이력 키가 맞는다 (src/ids.ts workinVendorName과 거울)
  d as (select regexp_replace(v, '\s*\([A-Za-z0-9 .,&\-]*\)?\s*$', '') as v from c2),
  e as (select regexp_replace(v, '\s*(주식회사|유한회사|\(주\)|㈜)\s*$', '') as v from d)
  select btrim(regexp_replace(v, '[\s\-·,()]+$', '')) from e;
$$;
-- 업체명 매칭 키: 공백·괄호·㈜ 등 표기 차이를 없애고 앞 8글자만 — 워킨맵과 점검이력을 이어준다
-- 법인표기(주식회사 등)는 위치 불문 제거 — 워킨맵 "주식회사 엘엠디" vs 점검 "엘엠디"가 같은 키가 되도록 (미스 436곳 중 다수 원인)
create or replace function vendor_key_(v text) returns text language sql immutable as $$
  select left(regexp_replace(lower(regexp_replace(regexp_replace(coalesce(v,''), '\([^)]*\)?', ' ', 'g'), '주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인|\(주\)|㈜', ' ', 'g')), '[^가-힣a-z0-9]', '', 'g'), 8);
$$;
grant execute on function safe_date_(text), workin_grade_(text), workin_vendor_(text), vendor_key_(text) to anon, authenticated;

-- 반환 컬럼이 늘어 drop 후 재생성 (return type 변경은 replace 불가)
drop function if exists suggest_workin_candidates(text, text, text[], double precision, double precision, int, int);
create function suggest_workin_candidates(
  p_team text,
  p_kind text default 'quarter',        -- quarter=점검 / renewal=재계약 / monthly=매월
  p_grades text[] default '{}',         -- 비우면 전체 등급
  p_lat double precision default null,  -- 앵커 좌표 (없으면 거리 정렬 생략)
  p_lng double precision default null,
  p_min_days int default 60,
  p_limit int default 100
) returns table (
  id bigint, place_name text, vendor text, grade text, label text, addr text,
  lat double precision, lng double precision, comment text,
  last_date text, days_since int, distance_km numeric, quarter_ok boolean, never_visited boolean,
  code text,                                        -- 거래처 코드 (workin_vendor_code)
  prev_date text, last_pages text, prev_pages text, -- 최근·전전 점검 매수 (사용량 비교용)
  last_toner text, last_spare text, last_waste text, -- 최근 점검 토너잔량·여분·폐통
  last_serial text, prev_serial text,                -- 최근·전전 자산기번 (기기 교체 감지)
  last_special text,                                 -- 최근 점검 특이사항
  device_count int, devices text                     -- 임대리스트 기기 대수·목록(기종 자산번호)
) language sql stable as $$
  with places as (
    select w.id, w.name as place_name, workin_vendor_(w.name) as vendor, workin_grade_(w.name) as grade,
           vendor_key_(workin_vendor_(w.name)) as pkey,  -- 키를 한 번만 계산 (조인마다 regexp 재계산 금지 — 19초→밀리초)
           coalesce(w.label, '') as label,
           coalesce(nullif(w.address, ''), '') || case when coalesce(w.address_detail,'') <> '' then ' ' || w.address_detail else '' end as addr,
           w.latitude as lat, w.longitude as lng,
           coalesce(w.comment, '') as comment,  -- "모델 / 시리얼" — 등록 시 기번·시리얼로 파싱
           coalesce(wc.code, '') as code
    from workin_map_places w
    left join workin_vendor_code wc on wc.place_id = w.id
    where w.visible is not false
      and (p_team = '' or w.team = p_team)
      and (p_kind = '' or w.kind = p_kind)
      -- G5(점검 완료)·G12(이관)는 이번 분기 방문 대상이 아니다 — 추천에서 제외
      and coalesce(w.label, '') not in ('G5', 'G12')
      -- 현재 분기 대상만 (워킨맵은 분기마다 갱신된다)
      and (w.quarter is null or w.quarter = extract(quarter from current_date)::int)
  ),
  -- 점검 이력 원장: 거래처 코드(별칭 번역)와 이름 키를 같이 들고 간다
  hist as (
    -- 코드 부착 두 갈래: 이름 별칭 + **기번→코드** — 기록 이름이 "청연"처럼 짧거나 표기가 달라도 기번이 정확하면 이어진다
    select coalesce(a.code, l.code, '') as hcode, vendor_key_(j."_업체명") as hk, j.id as jid,
           substring(j."작성일" from '\d{4}-\d{2}-\d{2}') as d,
           j."매수" as pages, j."토너잔량" as toner, j."여분" as spare, j."폐통" as waste,
           j."자산기번" as serial, j."특이사항" as special
    from jeomgeom j
    left join vendor_match_alias a on a.akey = vendor_match_key_(j."_업체명")
    left join lease_ident_code l on l.ident = regexp_replace(lower(coalesce(j."자산기번", '')), '[^a-z0-9]', '', 'g')
    where coalesce(j."_hidden", false) = false and substring(j."작성일" from '\d{4}-\d{2}-\d{2}') is not null
  ),
  by_code as (
    select hcode,
      (array_agg(d order by d desc, jid desc))[1] as d1, (array_agg(d order by d desc, jid desc))[2] as d2,
      (array_agg(pages order by d desc, jid desc))[1] as p1, (array_agg(pages order by d desc, jid desc))[2] as p2,
      (array_agg(toner order by d desc, jid desc))[1] as t1,
      (array_agg(spare order by d desc, jid desc))[1] as s1,
      (array_agg(waste order by d desc, jid desc))[1] as w1,
      (array_agg(serial order by d desc, jid desc))[1] as sr1, (array_agg(serial order by d desc, jid desc))[2] as sr2,
      (array_agg(special order by d desc, jid desc))[1] as sp1
    from hist where hcode <> '' group by 1
  ),
  by_key as (
    select hk,
      (array_agg(d order by d desc, jid desc))[1] as d1, (array_agg(d order by d desc, jid desc))[2] as d2,
      (array_agg(pages order by d desc, jid desc))[1] as p1, (array_agg(pages order by d desc, jid desc))[2] as p2,
      (array_agg(toner order by d desc, jid desc))[1] as t1,
      (array_agg(spare order by d desc, jid desc))[1] as s1,
      (array_agg(waste order by d desc, jid desc))[1] as w1,
      (array_agg(serial order by d desc, jid desc))[1] as sr1, (array_agg(serial order by d desc, jid desc))[2] as sr2,
      (array_agg(special order by d desc, jid desc))[1] as sp1
    from hist where length(hk) >= 3 group by 1
  ),
  -- 임대리스트(vendor_info) 기기: **임대중만** 센다(임대종료·소송 제외). 품목으로 복합기/PC/기타 구분,
  -- 복합기는 모델·자산번호까지 나열. 마스터코드(기번→lease_ident_code) 층 + 이름 키 층 두 갈래.
  -- (vendor_info.코드는 내부 번호라 workin 코드와 체계가 다르다 — 직접 조인 금지)
  dev_base as (
    select lower(regexp_replace(coalesce(v."기번",''), '[^0-9A-Za-z]', '', 'g')) as ident,
           vendor_key_(v."_업체명") as dk,
           case when coalesce(v."품목",'') ~ '복합기|프린터|플로터' then '복합기'
                when coalesce(v."품목",'') ~* '모니터' then '모니터'  -- "PC모니터"를 PC로 합치면 대수가 부풀어 보인다
                when coalesce(v."품목",'') ~* 'pc|데스크|노트북|태블릿|소프트웨어' then 'PC'
                else '기타' end as cat,
           btrim(coalesce(nullif(v."모델명",''), v."기종", '') || ' ' || coalesce(v."자산번호",'')) as item
    from vendor_info v
    where coalesce(v."_hidden", false) = false and v."임대여부" = '임대중'
  ),
  dev_code as (
    select l.code as dcode, count(*)::int as cnt,
      left(array_to_string(array_remove(array[
        case when count(*) filter (where b.cat = '복합기') > 0 then '복합기 ' || (count(*) filter (where b.cat = '복합기')) end,
        case when count(*) filter (where b.cat = 'PC') > 0 then 'PC ' || (count(*) filter (where b.cat = 'PC')) end,
        case when count(*) filter (where b.cat = '모니터') > 0 then '모니터 ' || (count(*) filter (where b.cat = '모니터')) end,
        case when count(*) filter (where b.cat = '기타') > 0 then '기타 ' || (count(*) filter (where b.cat = '기타')) end
      ], null), ' · ') || coalesce(' ｜ ' || nullif(string_agg(b.item, ' · ' order by b.item) filter (where b.cat = '복합기'), ''), ''), 240) as list
    from dev_base b join lease_ident_code l on l.ident = b.ident
    group by 1
  ),
  dev_key as (
    select b.dk, count(*)::int as cnt,
      left(array_to_string(array_remove(array[
        case when count(*) filter (where b.cat = '복합기') > 0 then '복합기 ' || (count(*) filter (where b.cat = '복합기')) end,
        case when count(*) filter (where b.cat = 'PC') > 0 then 'PC ' || (count(*) filter (where b.cat = 'PC')) end,
        case when count(*) filter (where b.cat = '모니터') > 0 then '모니터 ' || (count(*) filter (where b.cat = '모니터')) end,
        case when count(*) filter (where b.cat = '기타') > 0 then '기타 ' || (count(*) filter (where b.cat = '기타')) end
      ], null), ' · ') || coalesce(' ｜ ' || nullif(string_agg(b.item, ' · ' order by b.item) filter (where b.cat = '복합기'), ''), ''), 240) as list
    from dev_base b
    where length(b.dk) >= 3
    group by 1
  ),
  -- 접두 일치 폴백 후보: 워킨맵 이름에 메모 꼬리(2층·추가·공장 등)가 붙어 정확 일치가 깨진 곳 —
  -- 앞 3글자 동일(해시 조인)로 먼저 거르고, 업체당 가장 구체적인(긴) 이력 키 하나만 남긴다
  pre as (
    select p2.id as pid, k.*, row_number() over (partition by p2.id order by length(k.hk) desc) as rn
    from places p2
    join by_key k on left(k.hk, 3) = left(p2.pkey, 3)
                 and (k.hk like p2.pkey || '%' or p2.pkey like k.hk || '%')
    where length(p2.pkey) >= 3
  ),
  scored as (
    select p.*,
      -- 코드 일치 > 이름 키 일치 > 접두 일치 순으로 **한 층의 값 전체**를 쓴다 (층 섞임 금지 — 매수 비교가 어긋난다)
      case when bc.hcode is not null then bc.d1 when bk.hk is not null then bk.d1 else bp.d1 end as last_date,
      case when bc.hcode is not null then bc.d2 when bk.hk is not null then bk.d2 else bp.d2 end as prev_date,
      case when bc.hcode is not null then bc.p1 when bk.hk is not null then bk.p1 else bp.p1 end as last_pages,
      case when bc.hcode is not null then bc.p2 when bk.hk is not null then bk.p2 else bp.p2 end as prev_pages,
      case when bc.hcode is not null then bc.t1 when bk.hk is not null then bk.t1 else bp.t1 end as last_toner,
      case when bc.hcode is not null then bc.s1 when bk.hk is not null then bk.s1 else bp.s1 end as last_spare,
      case when bc.hcode is not null then bc.w1 when bk.hk is not null then bk.w1 else bp.w1 end as last_waste,
      case when bc.hcode is not null then bc.sr1 when bk.hk is not null then bk.sr1 else bp.sr1 end as last_serial,
      case when bc.hcode is not null then bc.sr2 when bk.hk is not null then bk.sr2 else bp.sr2 end as prev_serial,
      case when bc.hcode is not null then bc.sp1 when bk.hk is not null then bk.sp1 else bp.sp1 end as last_special,
      coalesce(dc.cnt, dk2.cnt, 0) as device_count, coalesce(dc.list, dk2.list, '') as devices,
      case when p_lat is null or p.lat is null then null
           else round((sqrt(power((p.lat - p_lat) * 111.0, 2) + power((p.lng - p_lng) * 88.0, 2)))::numeric, 2)
      end as distance_km,
      case when workin_grade_(p.place_name) in ('SS','V')
           then current_date >= date_trunc('quarter', current_date)::date + 40 else true end as quarter_ok
    from places p
    left join by_code bc on p.code <> '' and bc.hcode = p.code
    left join by_key bk on bk.hk = p.pkey and length(p.pkey) >= 3
    -- 접두 일치 폴백: 코드·정확 키 둘 다 실패한 곳만 채택 (rn=1 = 가장 구체적인 이력 키)
    left join pre bp on bp.pid = p.id and bp.rn = 1 and bc.hcode is null and bk.hk is null
    left join dev_code dc on p.code <> '' and dc.dcode = p.code
    left join dev_key dk2 on dk2.dk = p.pkey and length(p.pkey) >= 3
  )
  , filtered as (
    select id, place_name, vendor, grade, label, addr, lat, lng, comment,
           last_date,
           case when last_date is null then 9999 else (current_date - last_date::date) end as days_since,
           distance_km, quarter_ok,
           (last_date is null) as never_visited,
           code, prev_date, last_pages, prev_pages, last_toner, last_spare, last_waste,
           last_serial, prev_serial, last_special, device_count, devices
    from scored
    where (p_kind <> 'quarter' or (case when last_date is null then 9999 else (current_date - last_date::date) end) >= p_min_days)
      and (cardinality(p_grades) = 0 or grade = any(p_grades))
  )
  -- 상한은 등급별로 — 밀집한 SS·V(G6)가 p_limit를 다 차지해 몇 km 밖의 S 거래처가 통째로 잘리던 실사고(2026-08-25).
  -- 등급마다 가까운 p_limit곳을 뽑고 전체를 다시 거리순으로 돌려준다.
  select id, place_name, vendor, grade, label, addr, lat, lng, comment,
         last_date, days_since, distance_km, quarter_ok, never_visited,
         code, prev_date, last_pages, prev_pages, last_toner, last_spare, last_waste,
         last_serial, prev_serial, last_special, device_count, devices
  from (
    select f.*, row_number() over (partition by f.grade order by f.distance_km asc nulls last, f.days_since desc) as grade_rank
    from filtered f
  ) ranked
  where grade_rank <= p_limit
  order by distance_km asc nulls last, days_since desc
  limit p_limit * 6;
$$;
grant execute on function suggest_workin_candidates(text, text, text[], double precision, double precision, int, int) to anon, authenticated;
notify pgrst, 'reload schema';
