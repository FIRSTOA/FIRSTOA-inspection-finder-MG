-- 자동 일정 짜기 — 워킨맵(그 분기 방문 대상) 기준 추천
-- 점검(kind=quarter)·재계약(renewal)·매월(monthly) 모두 워킨맵에만 있는 곳에서 찾는다.
-- 앵커(그날 마지막 필수 일정) 좌표에서 가까운 순 + 마지막 점검 경과일 기준.
create or replace function safe_date_(v text) returns date language plpgsql immutable as $$
declare m text; begin
  m := substring(coalesce(v,'') from '\d{4}[-./]\d{1,2}[-./]\d{1,2}');
  if m is null then return null; end if;
  begin return replace(replace(m, '.', '-'), '/', '-')::date; exception when others then return null; end;
end $$;

-- 워킨맵 이름에서 등급과 업체명을 분리: "14SS㈜이오플랜본사1매월마감" → SS / ㈜이오플랜본사
create or replace function workin_grade_(nm text) returns text language sql immutable as $$
  select coalesce(upper((regexp_match(coalesce(nm,''), '^\s*[\d/\-]*\s*(V|SS|S|NN|N)(?=[^A-Za-z])'))[1]), '');
$$;
-- 워킨맵 이름은 "숫자+등급+업체명+특이사항/마감구분"이 붙어 있고 줄바꿈(_x000d_)까지 섞인다.
-- 점검 이력(jeomgeom._업체명)과 맞추려면 업체명만 남겨야 매칭된다 (카운터문자 파서와 같은 규칙).
create or replace function workin_vendor_(nm text) returns text language sql immutable as $$
  with t as (select regexp_replace(regexp_replace(coalesce(nm,''), '_x000d_|\r|\n', ' ', 'g'), '\s+', ' ', 'g') as v),
  a as (select btrim(regexp_replace(v, '^\s*[\d/\-]*\s*(V|SS|S|NN|N)(?=[^A-Za-z])', '')) as v from t),
  b as (select split_part(v, '/', 1) as v from a),  -- 특이사항은 / 뒤에 붙는다
  c as (select regexp_replace(v, '(매월마감|분기마감|매주마감|월말마감|단순마감|매월방문|매주방문|격주방문|월말방문|마감).*$', '') as v from b)
  select btrim(regexp_replace(v, '[\s\-·,()]+$', '')) from c;
$$;
-- 업체명 매칭 키: 공백·괄호·㈜ 등 표기 차이를 없애고 앞 8글자만 — 워킨맵과 점검이력을 이어준다
create or replace function vendor_key_(v text) returns text language sql immutable as $$
  select left(regexp_replace(lower(coalesce(v,'')), '[^가-힣a-z0-9]', '', 'g'), 8);
$$;
grant execute on function safe_date_(text), workin_grade_(text), workin_vendor_(text), vendor_key_(text) to anon, authenticated;

create or replace function suggest_workin_candidates(
  p_team text,
  p_kind text default 'quarter',        -- quarter=점검 / renewal=재계약 / monthly=매월
  p_grades text[] default '{}',         -- 비우면 전체 등급
  p_lat double precision default null,  -- 앵커 좌표 (없으면 거리 정렬 생략)
  p_lng double precision default null,
  p_min_days int default 60,
  p_limit int default 100
) returns table (
  id bigint, place_name text, vendor text, grade text, label text, addr text,
  lat double precision, lng double precision,
  last_date text, days_since int, distance_km numeric, quarter_ok boolean, never_visited boolean
) language sql stable as $$
  with places as (
    select w.id, w.name as place_name, workin_vendor_(w.name) as vendor, workin_grade_(w.name) as grade,
           coalesce(w.label, '') as label,
           coalesce(nullif(w.address, ''), '') || case when coalesce(w.address_detail,'') <> '' then ' ' || w.address_detail else '' end as addr,
           w.latitude as lat, w.longitude as lng
    from workin_map_places w
    where w.visible is not false
      and (p_team = '' or w.team = p_team)
      and (p_kind = '' or w.kind = p_kind)
      -- G5(점검 완료)·G12(이관)는 이번 분기 방문 대상이 아니다 — 추천에서 제외
      and coalesce(w.label, '') not in ('G5', 'G12')
      -- 현재 분기 대상만 (워킨맵은 분기마다 갱신된다)
      and (w.quarter is null or w.quarter = extract(quarter from current_date)::int)
  ),
  insp as (
    -- 점검 이력을 업체별 최근 1건으로 먼저 줄인다 (1.7만행 → 6.6천행)
    select vendor_key_("_업체명") as k, max(substring("작성일" from '\d{4}-\d{2}-\d{2}')) as d
    from jeomgeom where coalesce("_hidden", false) = false group by 1
  ),
  scored as (
    select p.*,
      i.d as last_date,
      case when i.d is null then 9999 else (current_date - i.d::date) end as days_since,
      case when p_lat is null or p.lat is null then null
           else round((sqrt(power((p.lat - p_lat) * 111.0, 2) + power((p.lng - p_lng) * 88.0, 2)))::numeric, 2)
      end as distance_km,
      case when workin_grade_(p.place_name) in ('SS','V')
           then current_date >= date_trunc('quarter', current_date)::date + 40 else true end as quarter_ok
    from places p
    left join insp i on i.k = vendor_key_(p.vendor) and length(vendor_key_(p.vendor)) >= 3
  )
  select id, place_name, vendor, grade, label, addr, lat, lng, last_date, days_since, distance_km, quarter_ok,
         (last_date is null) as never_visited
  from scored
  where (p_kind <> 'quarter' or days_since >= p_min_days)             -- 경과일 기준은 점검에만 적용
    and (cardinality(p_grades) = 0 or grade = any(p_grades))
  order by distance_km asc nulls last, days_since desc
  limit p_limit;
$$;
grant execute on function suggest_workin_candidates(text, text, text[], double precision, double precision, int, int) to anon, authenticated;
notify pgrst, 'reload schema';
