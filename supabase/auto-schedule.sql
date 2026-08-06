-- 자동 일정 짜기 — 점검 후보 추천
-- 규칙(CS팀 실무): 마지막 점검 60일 초과가 기본. N·NN·S는 60일만 넘으면 언제든,
-- SS·V는 분기 중반(분기 시작 +40일)부터 권장 — 전분기에 다녀왔는데 너무 빨리 가면 부담.
-- 앵커(그날 마지막 필수 일정)의 구·동과 가까울수록 점수를 높여 동선을 묶는다.
create or replace function suggest_inspection_candidates(
  p_area text default '',        -- 담당지역(강남/강북/…) 부분일치, 비우면 전체
  p_anchor_gu text default '',   -- 앵커의 구 (예: 강남구)
  p_anchor_dong text default '', -- 앵커의 동 (예: 역삼동)
  p_min_days int default 60,
  p_limit int default 80
) returns table (
  vendor text, grade text, area text, gu text, addr text,
  last_date text, days_since int, quarter_ok boolean, never_visited boolean, score int
) language sql stable as $$
  with v as (
    select distinct on (t."_업체명")
      t."_업체명" as vendor,
      coalesce(nullif(upper(trim(t."등급")), ''), 'N') as grade,
      coalesce(t."_raw"->>'담당지역', '') as area,
      coalesce(nullif(t."시/구", ''), '') as gu,
      coalesce(t."_raw"->>'주소(실납품주소,도로명주소)', t."주소상세주소", '') as addr,
      coalesce(t."종료일", '') as end_date
    from vendor_info t
    where coalesce(t."_hidden", false) = false and t."_업체명" is not null and t."_업체명" <> ''
      -- 계약 종료가 지난 곳 제외. 시트 원본에 "2024-11-31" 같은 잘못된 날짜가 있어 안전 파서를 쓴다
      and coalesce(safe_date_(t."종료일"), current_date) >= current_date
    order by t."_업체명", t.id desc
  ),
  last_insp as (
    select "_업체명" as vendor, max(substring("작성일" from '\d{4}-\d{2}-\d{2}')) as d
    from jeomgeom where coalesce("_hidden", false) = false group by 1
  ),
  base as (
    select v.*, li.d as last_date,
      case when li.d is null then 9999 else (current_date - li.d::date) end as days_since,
      -- 분기 중반 판정: 이번 분기 시작 + 40일 지났는지 (SS·V 전용 조건)
      (current_date >= date_trunc('quarter', current_date)::date + 40) as mid_quarter
    from v left join last_insp li on li.vendor = v.vendor
  )
  select vendor, grade, area, gu, addr, last_date, days_since,
    case when grade in ('SS','V') then mid_quarter else true end as quarter_ok,
    (last_date is null) as never_visited,
    (least(days_since, 400) / 10)                                   -- 오래될수록 우선
      + case when p_anchor_gu <> '' and gu ilike '%'||p_anchor_gu||'%' then 50 else 0 end
      + case when p_anchor_dong <> '' and addr ilike '%'||p_anchor_dong||'%' then 40 else 0 end
      + case when grade in ('N','NN') then 12 when grade = 'S' then 8 else 0 end  -- 초과료 조정 여지
      + case when grade in ('SS','V') and not mid_quarter then -60 else 0 end     -- 분기 초반이면 후순위
      + case when last_date is null then -35 else 0 end                            -- 점검 이력 없음은 확인 필요 → 후순위
      as score
  from base
  where days_since >= p_min_days
    and (p_area = '' or area ilike '%'||p_area||'%' or gu ilike '%'||p_area||'%')
  order by score desc, days_since desc
  limit p_limit;
$$;
grant execute on function suggest_inspection_candidates(text, text, text, int, int) to anon, authenticated;
notify pgrst, 'reload schema';
