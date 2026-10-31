-- ============================================================================
-- 워킨맵 장소에 연도(year) 칸 — 범위 키 (team, quarter, kind) → (team, year, quarter, kind)  (2026-11-01 · 데이터실 표다빈)
-- 설계: docs/tasks/workin-year-rollover-2026-10-31.md §3-1 (+ 팀장 결정: 동기화 RPC 허용 칸에 year 를 **넣는다**)
-- SQL Editor 에서 통째로 1회 실행. 두 번 실행해도 안전(아래 "2회 실행" 줄 참고).
-- **밤(KST 22시 이후) 실행 권고** — 4) 백필이 전 행 updated_at 을 바꿔 열린 화면들이 다음 폴링에 전량(약 8MB)을 다시 받는다.
-- **순서: 이 SQL → 엣지 workinmap-sync(year 쓰기) → 앱.** 앱을 먼저 올리면 year=eq. 조회가 400(빈 목록).
--   이 SQL 은 옛 앱·옛 엣지와 호환: year 를 안 보내도 BEFORE 트리거가 채운 뒤 NOT NULL 을 검사한다.
--
-- 무엇(이 파일이 바꾸는 것 전부 — 그 밖의 기존 표·칸·정책·권한은 건드리지 않는다):
--   1) workin_map_places.year smallint 추가(nullable 로 먼저)
--   2) 함수 workin_nearest_year_(p_q, p_at) — KST 지금 (연,분기)에서 분기 번호 p_q 의 가장 가까운 해(동점이면 지난 쪽)
--   3) BEFORE INSERT/UPDATE 트리거 workin_map_places_year — year 가 비면 (수정이면 이전 값) → ext_year → 가까운 해
--   4) 백필 year = coalesce(ext_year, 2026)
--   5) NOT NULL · check 2020~2100 · 인덱스 workin_map_scope_idx 를 (team, year, quarter, kind) 로 교체(이름 유지)
--   6) workin_sync_review.kind 에 'stale_done'(지난 분기 완료색 의심) 추가 — check 교체(넓히기만)
--   7) 자동 일정 RPC suggest_workin_candidates 에 p_year int default null 추가(맨 끝 인자) + current_date(UTC) → KST
--   8) workin_sync_update_places 허용 칸·NOT NULL 칸에 'year' 추가 + update 줄 1개
--   (조건부 ext_id 유일 키 (ext_work_id, ext_id) 전환은 **넣지 않음** — 라이브 M4 = 0, 아래 실측)
--
-- ── 라이브 실측 (2026-10-31 밤, MCP execute_sql 읽기 전용) ──────────────────────
--   workin_map_places 7,983행(파일 workin-sync-20261031.sql 머리 주석의 7,895 는 그 전 값). year 칸 없음. 열 24개.
--   트리거: workin_map_places_updated_at (BEFORE INSERT OR UPDATE → set_workin_updated_at: 무조건 new.updated_at := now())
--           workin_sync_enqueue (AFTER UPDATE OF label, visible, memos, WHEN ext_id not null and 셋 중 하나 실제 변경)
--   인덱스: workin_map_scope_idx (team, quarter, kind) · workin_map_places_ext_id_uq (ext_id) where not null ·
--           workin_map_places_ext_work_idx (ext_work_id) where not null · pkey
--   check: quarter 1~4 · kind quarter|monthly|renewal · team A~E|T
--   정책: "workin_map_places anon all" (ALL, anon, true/true). 표 권한 anon·authenticated = arwd (새 칸도 표 권한으로 덮임 → 추가 grant 불필요)
--   pg_default_acl(public, 함수) = anon·authenticated EXECUTE 자동 → 새 함수는 기본으로 anon 실행 가능(그래서 아래에서 revoke/grant 명시)
--   DB TimeZone = UTC (current_date 는 UTC 날짜 — KST 0~9시엔 하루 전)
--   ext_year: 값 있는 3,983행 전부 2026(M2 = 0행), null 4,000행(3분기 3,586·E팀 381·1·2분기 잔여 5·D 매월 1·4분기 연결 범위 안 앱 전용 27) → 백필 기본값 2026 맞음
--   M1 범위: 1분기 A 3행(monthly·quarter·renewal 각 1) · 2분기 B 2행(monthly·renewal) — 전부 2026-07-19 이민구 시험 행, 미연결
--            3분기 A·B·C·D 3,586행(전부 미연결·ext_year null) · 4분기 4,392행(연결 3,983 = ext_year 2026 · 미연결 409 = E 381·D 매월 1·연결 범위 안 앱 전용 행)
--            → 1월 W1 고장 대상(27년 1분기 범위가 "비지 않음"): A 팀 quarter·monthly·renewal (각 1행)
--   M4 같은 ext_id 가 다른 ext_work_id 에: places 내 ext_id 중복 0(유일 인덱스) · 로그 _link 3,895건 중 before 값 있음(이동) 0 ·
--      로그/확인 큐에서 ext_id 하나가 work_id 2개 이상 = 0 · 연결 행의 (team,quarter,kind,ext_year) ↔ workin_sync_works 불일치 0.
--      단 **지금까지 pull 한 워크는 4분기 11개뿐**(3분기·2분기 워크는 last_pulled_at null) → "워킨맵이 복사 워크에서 _id 를 재사용하나"는
--      DB 만으로 증명 불가. 27년 1분기(또는 T 리허설) 첫 pull 때 다시 볼 것. 그때까지 ext_id 유일 인덱스는 그대로(재사용이면 insert 23505 로 드러남).
--   workin_sync_review: kind check 9종(unmatched·ambiguous·new·missing·downgrade·conflict·field_diff·loop·format),
--      지금 행 downgrade 218·conflict 68·missing 22·field_diff 8·new 6·ambiguous 4 → 새 check 에 전부 포함.
--   suggest_workin_candidates(8인자) 라이브 = auto-schedule.sql 과 본문 같음, 라이브에만 `set search_path = public` 이 붙어 있음(이 파일은 그것 유지).
--   workin_sync_update_places 라이브 = workin-sync-20261031.sql 본문과 같음(라이브는 CRLF), security definer, service_role 만 EXECUTE.
--
-- 2회 실행: add column if not exists · create or replace · drop trigger/constraint if exists · 백필 where year is null(2회째 0행) ·
--          set not null(이미면 무동작) · 인덱스는 정의에 year 가 없을 때만 교체 · suggest 옛 8인자 drop if exists 후 9인자 create or replace.
-- updated_at 영향: 4) 백필 UPDATE 에 BEFORE 트리거 set_workin_updated_at 이 붙어 **7,983행 updated_at = 실행 시각**.
--   workin_sync_enqueue 는 "UPDATE OF label, visible, memos" 라 year·updated_at 만 바꾸는 이 UPDATE 에는 **발동하지 않는다** → 되밀기 큐 0.
--   (원하면 4) 의 대안 B 로 updated_at 을 안 바꿀 수 있다 — 아래 주석. 기본은 A: 단순, 밤 실행.)
-- ============================================================================

-- 0) 사전 점검: ext_year 가 범위(2020~2100) 밖이면 백필이 check 에 막히므로 미리 멈춘다(라이브 0행)
do $$
declare bad int;
begin
  select count(*) into bad from public.workin_map_places where ext_year is not null and ext_year not between 2020 and 2100;
  if bad > 0 then
    raise exception 'workin-year: ext_year 범위 밖 %행 — 먼저 확인할 것', bad;
  end if;
end $$;

-- 1) 열 (nullable 로 먼저 → 백필 → NOT NULL)
alter table public.workin_map_places add column if not exists year smallint;
comment on column public.workin_map_places.year is
  '연도(권위 값). 범위 키 = (team, year, quarter, kind). 비면 트리거 workin_map_places_year 가 채움(이전 값 → ext_year → workin_nearest_year_). ext_year 는 짝지은 워크 연도(감사용). 2026-11-01';

-- 2) 가까운 해: KST 지금 (y, cq) 기준 y-1·y·y+1 중 (해*4+분기) 거리가 가장 작은 해, 동점이면 지난 쪽
--    12월에 1분기 → 다음 해 · 1월에 4분기 → 작년 · 3분기에 1분기(동점) → 올해 · 분기 1~4 밖이면 null
create or replace function public.workin_nearest_year_(p_q int, p_at timestamptz default now())
returns smallint language sql stable
set search_path = pg_catalog
as $$
  select (c.y + v.d)::smallint
  from (select extract(year    from (p_at at time zone 'Asia/Seoul'))::int as y,
               extract(quarter from (p_at at time zone 'Asia/Seoul'))::int as cq) c,
       (values (-1), (0), (1)) v(d)
  where p_q between 1 and 4
  order by abs(((c.y + v.d) * 4 + p_q) - (c.y * 4 + c.cq)), v.d
  limit 1
$$;
comment on function public.workin_nearest_year_(int, timestamptz) is
  '분기 번호 → KST 지금에서 가장 가까운 해(동점 = 지난 쪽). 앱 nearestYearFor 와 같은 규칙. 2026-11-01 workin-year-20261101.sql';
-- suggest_workin_candidates(security invoker)가 anon 으로 부르므로 anon 실행 필요
grant execute on function public.workin_nearest_year_(int, timestamptz) to anon, authenticated;

-- 3) 채움 트리거: year 가 빌 때만(WHEN) — 옛 앱·엑셀·엣지가 year 를 안 보내도 저장된다
create or replace function public.workin_fill_year_() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.year is null then
    new.year := coalesce(case when tg_op = 'UPDATE' then old.year end,
                         new.ext_year,
                         public.workin_nearest_year_(new.quarter));
  end if;
  return new;
end $$;
-- 트리거 전용: 직접 호출 막기(트리거 발동은 EXECUTE 권한과 무관 — 만들 때만 검사)
revoke execute on function public.workin_fill_year_() from public, anon, authenticated;

drop trigger if exists workin_map_places_year on public.workin_map_places;
create trigger workin_map_places_year
  before insert or update on public.workin_map_places
  for each row when (new.year is null)
  execute function public.workin_fill_year_();
-- (BEFORE 트리거는 이름 순: workin_map_places_updated_at → workin_map_places_year. 서로 다른 칸이라 순서 무관)

-- 4) 백필 — 지금 행은 전부 2026 해(ext_year 있으면 그 값, 라이브 전부 2026)
--    A(기본): updated_at 이 실행 시각으로 바뀜(트리거). 밤 실행.
update public.workin_map_places set year = coalesce(ext_year, 2026) where year is null;
--    B(대안, updated_at 보존 — 쓰려면 위 A 한 줄을 주석으로 막고 아래 3줄의 주석을 푼다. 한 트랜잭션이라 실패해도 트리거가 꺼진 채 남지 않는다):
-- alter table public.workin_map_places disable trigger workin_map_places_updated_at;
-- update public.workin_map_places set year = coalesce(ext_year, 2026) where year is null;
-- alter table public.workin_map_places enable trigger workin_map_places_updated_at;
--    B 를 쓰면 옛 앱 캐시 행엔 year 가 안 들어오지만, 새 앱은 캐시 키 v3 로 첫 전량 조회를 하므로(설계 W3) 문제없다.

-- 5) 제약·인덱스
alter table public.workin_map_places alter column year set not null;
alter table public.workin_map_places drop constraint if exists workin_map_places_year_check;
alter table public.workin_map_places add constraint workin_map_places_year_check check (year between 2020 and 2100);

-- 범위 인덱스: 이름은 그대로 두고 정의만 교체(옛 SQL workin-map-shared.sql·visits.sql 의 "create index if not exists workin_map_scope_idx"
-- 를 다시 돌려도 이름이 있어 옛 정의가 되살아나지 않게). 이미 year 가 들어 있으면 건너뜀.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'workin_map_scope_idx'
      and indexdef like '%(team, year, quarter, kind)%'
  ) then
    drop index if exists public.workin_map_scope_idx;
    create index workin_map_scope_idx on public.workin_map_places (team, year, quarter, kind);
  end if;
end $$;

-- 6) 확인 큐 종류 'stale_done' — 워킨맵 라벨 G5/G12 인데 장소 last_update 가 범위 분기 시작(KST) 전(설계 R5).
--    처리: [완료 맞음] = resolution 'kept' · [G1 로] = 'applied' (기존 resolution 값으로 충분 — resolution check 는 안 바꿈)
alter table public.workin_sync_review drop constraint if exists workin_sync_review_kind_check;
alter table public.workin_sync_review add constraint workin_sync_review_kind_check check (kind in (
  'unmatched', 'ambiguous', 'new', 'missing', 'downgrade', 'conflict', 'field_diff', 'loop', 'format',
  'stale_done'));   -- 2026-11-01 추가: 지난 분기 완료색 의심

-- 7) 자동 일정 RPC: p_year 추가(맨 끝, 기본 null = p_quarter 의 가장 가까운 해) · 오늘 = KST
--    인자가 늘면 새 오버로드가 생기므로 옛 8인자를 먼저 지운다(남겨 두면 PostgREST PGRST203 "후보 둘").
--    동작 차이(옛 앱 = p_year 없이 호출):
--      · 고른 분기의 **가까운 해** 행만 본다 — 지금(4분기)에 1분기 → 27년 1분기(26년 1분기 시험 행 3개는 더 안 섞임)
--      · quarter_ok 의 해도 같은 값. 옛 규칙("지금보다 작은 분기면 다음 해")과 다른 곳은 "두 분기 앞뒤" 동점뿐
--        (예: 4분기에 2분기 → 옛 27년, 새 26년). 새 앱은 p_year 를 직접 넘긴다.
--      · days_since·quarter_ok 의 오늘 = KST 날짜(옛: UTC current_date, KST 0~9시엔 하루 전)
drop function if exists public.suggest_workin_candidates(text, text, int, text[], double precision, double precision, int, int);
create or replace function public.suggest_workin_candidates(
  p_team text,
  p_kind text default 'quarter',        -- quarter=점검 / renewal=재계약 / monthly=매월
  p_quarter int default null,           -- 대상 분기(없으면 현재 KST 분기). 9월에 4분기 워킨맵을 미리 올려두고 짜는 경우(2026-09-12)
  p_grades text[] default '{}',         -- 비우면 전체 등급
  p_lat double precision default null,  -- 앵커 좌표 (없으면 거리 정렬 생략)
  p_lng double precision default null,
  p_min_days int default 60,
  p_limit int default 100,
  p_year int default null               -- 대상 연도(없으면 workin_nearest_year_(대상 분기)) — 2026-11-01 workin-year
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
) language sql stable
set search_path = public
as $$
  -- 대상 (연, 분기)와 오늘(KST) — 한 행
  with tgt as (
    select s.tq, coalesce(p_year, workin_nearest_year_(s.tq)::int) as ty, s.today
    from (select coalesce(p_quarter, extract(quarter from (now() at time zone 'Asia/Seoul'))::int) as tq,
                 (now() at time zone 'Asia/Seoul')::date as today) s
  ),
  places as (
    select w.id, w.name as place_name, workin_vendor_(w.name) as vendor, workin_grade_(w.name) as grade,
           vendor_key_(workin_vendor_(w.name)) as pkey,  -- 키를 한 번만 계산 (조인마다 regexp 재계산 금지 — 19초→밀리초)
           coalesce(w.label, '') as label,
           coalesce(nullif(w.address, ''), '') || case when coalesce(w.address_detail,'') <> '' then ' ' || w.address_detail else '' end as addr,
           w.latitude as lat, w.longitude as lng,
           coalesce(w.comment, '') as comment,  -- "모델 / 시리얼" — 등록 시 기번·시리얼로 파싱
           coalesce(wc.code, '') as code
    from workin_map_places w
    cross join tgt
    left join workin_vendor_code wc on wc.place_id = w.id
    where w.visible is not false
      and (p_team = '' or w.team = p_team)
      and (p_kind = '' or w.kind = p_kind)
      -- G5(점검 완료)·G12(이관)는 이번 분기 방문 대상이 아니다 — 추천에서 제외
      and coalesce(w.label, '') not in ('G5', 'G12')
      -- 고른 (연, 분기) 대상만 — 같은 분기 번호가 해마다 있으니 연도까지 본다(2026-11-01)
      and w.quarter = tgt.tq
      and w.year = tgt.ty
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
           -- 대상 분기 시작 + 40일 이후만 권장. 다음 분기를 미리 짤 때는 아직 초반이라 '보류 권장'이 뜬다
           -- 대상 해 = tgt.ty (p_year 또는 가까운 해 — 12월에 1분기 미리 = 다음 해)
           then tgt.today >= make_date(tgt.ty, (tgt.tq - 1) * 3 + 1, 1) + 40 else true end as quarter_ok
    from places p
    cross join tgt
    left join by_code bc on p.code <> '' and bc.hcode = p.code
    left join by_key bk on bk.hk = p.pkey and length(p.pkey) >= 3
    -- 접두 일치 폴백: 코드·정확 키 둘 다 실패한 곳만 채택 (rn=1 = 가장 구체적인 이력 키)
    left join pre bp on bp.pid = p.id and bp.rn = 1 and bc.hcode is null and bk.hk is null
    left join dev_code dc on p.code <> '' and dc.dcode = p.code
    left join dev_key dk2 on dk2.dk = p.pkey and length(p.pkey) >= 3
  )
  , filtered as (
    select s.id, s.place_name, s.vendor, s.grade, s.label, s.addr, s.lat, s.lng, s.comment,
           s.last_date,
           case when s.last_date is null then 9999 else (tgt.today - s.last_date::date) end as days_since,
           s.distance_km, s.quarter_ok,
           (s.last_date is null) as never_visited,
           s.code, s.prev_date, s.last_pages, s.prev_pages, s.last_toner, s.last_spare, s.last_waste,
           s.last_serial, s.prev_serial, s.last_special, s.device_count, s.devices
    from scored s
    cross join tgt
    where (p_kind <> 'quarter' or (case when s.last_date is null then 9999 else (tgt.today - s.last_date::date) end) >= p_min_days)
      and (cardinality(p_grades) = 0 or s.grade = any(p_grades))
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
grant execute on function public.suggest_workin_candidates(text, text, int, text[], double precision, double precision, int, int, int) to anon, authenticated;

-- 8) 동기화 "있는 행만 갱신" RPC — 허용 칸·NOT NULL 칸에 year (팀장 결정 2026-11-01: 동기화가 짝 행의 연도를 워크 연도로 맞출 수 있게)
--    본문은 workin-sync-20261031.sql 의 것 그대로 + year 3곳(allowed · required_cols · update 줄). 권한도 같게 다시 적는다.
create or replace function public.workin_sync_update_places(p_rows jsonb)
returns integer language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  p        jsonb;
  bad      text;
  n        integer;
  total    integer := 0;
  allowed  constant text[] := array[
    'id', 'name', 'comment', 'phone', 'address', 'address_detail', 'latitude', 'longitude',
    'label', 'visible', 'memos', 'year',
    'ext_id', 'ext_work_id', 'ext_account_no', 'ext_year', 'ext_last_update', 'ext_synced_at', 'ext_missing_at',
    'updated_by', 'updated_at'];
  required_cols constant text[] := array[
    'name', 'comment', 'phone', 'address', 'address_detail', 'latitude', 'longitude',
    'label', 'visible', 'memos', 'year', 'updated_by', 'updated_at'];
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'workin_sync_update_places: p_rows 는 JSON 배열이어야 합니다' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'workin_sync_update_places: 한 번에 1000행까지 (%행)', jsonb_array_length(p_rows) using errcode = '22023';
  end if;

  for p in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(p) <> 'object' then
      raise exception 'workin_sync_update_places: 원소가 객체가 아닙니다 (%)', left(p::text, 80) using errcode = '22023';
    end if;
    select string_agg(k, ',') into bad from jsonb_object_keys(p) as k where k <> all (allowed);
    if bad is not null then
      raise exception 'workin_sync_update_places: 허용하지 않는 칸 %', bad using errcode = '22023';
    end if;
    select string_agg(k, ',') into bad from jsonb_object_keys(p) as k where k = any (required_cols) and jsonb_typeof(p -> k) = 'null';   -- (변수명 notnull 은 예약어라 42601 — 2026-10-31 실행 실패로 교체)
    if bad is not null then
      raise exception 'workin_sync_update_places: NOT NULL 칸에 null (id %, 칸 %)', p ->> 'id', bad using errcode = '23502';
    end if;
    if p ? 'memos' and jsonb_typeof(p -> 'memos') <> 'array' then
      raise exception 'workin_sync_update_places: memos 는 배열이어야 합니다 (id %)', p ->> 'id' using errcode = '22023';
    end if;
    continue when not (p ? 'id') or jsonb_typeof(p -> 'id') = 'null';   -- id 없음 = 건너뜀(insert 금지)

    update public.workin_map_places w set
      name            = case when p ? 'name'            then p ->> 'name'                               else w.name end,
      comment         = case when p ? 'comment'         then p ->> 'comment'                            else w.comment end,
      phone           = case when p ? 'phone'           then p ->> 'phone'                              else w.phone end,
      address         = case when p ? 'address'         then p ->> 'address'                            else w.address end,
      address_detail  = case when p ? 'address_detail'  then p ->> 'address_detail'                     else w.address_detail end,
      latitude        = case when p ? 'latitude'        then (p ->> 'latitude')::double precision       else w.latitude end,
      longitude       = case when p ? 'longitude'       then (p ->> 'longitude')::double precision      else w.longitude end,
      label           = case when p ? 'label'           then p ->> 'label'                              else w.label end,
      visible         = case when p ? 'visible'         then (p ->> 'visible')::boolean                 else w.visible end,
      memos           = case when p ? 'memos'           then p -> 'memos'                               else w.memos end,
      year            = case when p ? 'year'            then (p ->> 'year')::smallint                   else w.year end,
      ext_id          = case when p ? 'ext_id'          then p ->> 'ext_id'                             else w.ext_id end,
      ext_work_id     = case when p ? 'ext_work_id'     then p ->> 'ext_work_id'                        else w.ext_work_id end,
      ext_account_no  = case when p ? 'ext_account_no'  then (p ->> 'ext_account_no')::smallint         else w.ext_account_no end,
      ext_year        = case when p ? 'ext_year'        then (p ->> 'ext_year')::smallint               else w.ext_year end,
      ext_last_update = case when p ? 'ext_last_update' then (p ->> 'ext_last_update')::timestamptz     else w.ext_last_update end,
      ext_synced_at   = case when p ? 'ext_synced_at'   then (p ->> 'ext_synced_at')::timestamptz       else w.ext_synced_at end,
      ext_missing_at  = case when p ? 'ext_missing_at'  then (p ->> 'ext_missing_at')::timestamptz      else w.ext_missing_at end,
      updated_by      = case when p ? 'updated_by'      then p ->> 'updated_by'                         else w.updated_by end,
      updated_at      = case when p ? 'updated_at'      then (p ->> 'updated_at')::timestamptz          else w.updated_at end
    where w.id = (p ->> 'id')::bigint;
    get diagnostics n = row_count;
    total := total + n;                                    -- 없는 id 는 0 — 되살리지 않는다
  end loop;
  return total;
end $$;
revoke all on function public.workin_sync_update_places(jsonb) from public, anon, authenticated;
grant execute on function public.workin_sync_update_places(jsonb) to service_role;
comment on function public.workin_sync_update_places(jsonb) is
  '워킨맵 동기화 전용: 있는 행만 갱신(키 있는 칸만, insert 없음), 갱신 행 수 반환. service_role 만. 2026-10-31 workin-sync-20261031.sql · 2026-11-01 year 칸 추가(workin-year-20261101.sql)';
-- year 를 바꿔도 workin_sync_enqueue(label·visible·memos 만) 는 발동하지 않는다 → 되밀기 없음. check 2020~2100 밖이면 묶음 전체 예외(23514).

-- (조건부, 넣지 않음) ext_id 유일 키를 (ext_work_id, ext_id) 로 — 라이브 M4 = 0. 27년 1분기 첫 pull 에서 23505 가 나면 그때 켠다:
-- drop index if exists public.workin_map_places_ext_id_uq;
-- create unique index if not exists workin_map_places_ext_work_id_uq on public.workin_map_places (ext_work_id, ext_id) where ext_id is not null;

notify pgrst, 'reload schema';

-- ============================================================================
-- 확인 쿼리 (실행 뒤, 읽기만)
-- ============================================================================
-- select count(*) total, count(*) filter (where year is null) null_year, array_agg(distinct year) years
--   from public.workin_map_places;                                                        -- null_year 0 · years {2026}
-- select indexdef from pg_indexes where schemaname='public' and indexname='workin_map_scope_idx';   -- (team, year, quarter, kind)
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname in ('workin_map_places_year_check','workin_sync_review_kind_check');   -- 2020~2100 · 목록 끝에 stale_done
-- select tgname, pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid='public.workin_map_places'::regclass and not tgisinternal;              -- updated_at · year(WHEN year is null) · enqueue
-- select public.workin_nearest_year_(1, '2026-12-15 10:00+09') a,   -- 2027
--        public.workin_nearest_year_(4, '2027-01-05 10:00+09') b,   -- 2026
--        public.workin_nearest_year_(1, '2026-08-01 10:00+09') c,   -- 2026 (동점 → 지난 쪽)
--        public.workin_nearest_year_(4, '2026-12-31 23:30+09') d,   -- 2026 (KST 기준, UTC 로는 같은 날 14:30)
--        public.workin_nearest_year_(5) e;                          -- null
-- select pg_get_function_identity_arguments(oid) from pg_proc
--   where proname='suggest_workin_candidates' and pronamespace='public'::regnamespace;    -- 1행, 끝이 p_year integer
-- select has_function_privilege('anon','public.workin_fill_year_()','execute') fill,                          -- false
--        has_function_privilege('anon','public.workin_nearest_year_(int, timestamptz)','execute') nearest,      -- true
--        has_function_privilege('anon','public.workin_sync_update_places(jsonb)','execute') upd,               -- false
--        has_function_privilege('anon','public.suggest_workin_candidates(text,text,int,text[],double precision,double precision,int,int,int)','execute') sug; -- true
-- select count(*) from public.suggest_workin_candidates('C', 'quarter', 4);              -- 실행 전 같은 호출과 같은 수(4분기 = 2026)
-- select count(*) from public.workin_sync_outbox where created_at > now() - interval '10 minutes';   -- 0 (백필이 되밀기 안 만듦)
-- 트리거 시험(되돌림):
-- begin;
--   insert into public.workin_map_places (id, team, quarter, kind, name) values (-1, 'T', 1, 'quarter', 'year 시험');
--   select year from public.workin_map_places where id = -1;     -- 지금(4분기) 기준 2027
--   update public.workin_map_places set year = null where id = -1;
--   select year from public.workin_map_places where id = -1;     -- 2027 (이전 값)
-- rollback;

-- ============================================================================
-- 되돌리기 (앱·엣지가 year 를 읽고 쓰기 시작한 뒤라면 **앱·엣지를 먼저** 되돌릴 것 — 아니면 year=eq. 조회가 400)
-- ============================================================================
-- -- 8) 동기화 RPC: workin-sync-20261031.sql 의 "2-7)" 블록(create or replace function public.workin_sync_update_places … comment 까지)을 다시 실행
-- -- 7) 자동 일정 RPC: 9인자 지우고 auto-schedule.sql 의 drop·create·grant 부분 다시 실행
-- drop function if exists public.suggest_workin_candidates(text, text, int, text[], double precision, double precision, int, int, int);
-- --    (이어서 supabase/auto-schedule.sql 39~214행 실행 — 라이브에 있던 set search_path = public 은 그 파일에 없음, 필요하면
-- --     alter function public.suggest_workin_candidates(text,text,int,text[],double precision,double precision,int,int) set search_path = public;)
-- -- 6) 확인 큐: stale_done 행이 있으면 check 를 되돌릴 수 없으므로 먼저 정리
-- update public.workin_sync_review set resolved_at = now(), resolved_by = 'rollback', resolution = 'ignored' where kind = 'stale_done' and resolved_at is null;
-- delete from public.workin_sync_review where kind = 'stale_done';   -- (SQL Editor 에서만 — 앱 권한엔 delete 없음)
-- alter table public.workin_sync_review drop constraint if exists workin_sync_review_kind_check;
-- alter table public.workin_sync_review add constraint workin_sync_review_kind_check check (kind in
--   ('unmatched','ambiguous','new','missing','downgrade','conflict','field_diff','loop','format'));
-- -- 5)~1) 열·트리거·함수·인덱스
-- drop trigger if exists workin_map_places_year on public.workin_map_places;
-- drop function if exists public.workin_fill_year_();
-- drop index if exists public.workin_map_scope_idx;
-- create index workin_map_scope_idx on public.workin_map_places (team, quarter, kind);
-- alter table public.workin_map_places drop constraint if exists workin_map_places_year_check;
-- alter table public.workin_map_places drop column if exists year;   -- 연도 정보 사라짐(27년 행이 이미 있으면 26년과 다시 섞인다 — 그 전에만)
-- drop function if exists public.workin_nearest_year_(int, timestamptz);   -- 7) 을 먼저 되돌린 뒤(9인자 RPC 가 이 함수를 부름)
-- notify pgrst, 'reload schema';
-- ============================================================================
