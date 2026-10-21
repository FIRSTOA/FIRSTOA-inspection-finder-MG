-- ============================================================================
-- vendor_info 에 "부서명" 생성 컬럼 + trgm 인덱스  (2026-10-22 · 데이터실 표다빈)
-- 설계: docs/tasks/reception-unhandled-sheet-and-dept-search.md C4 (서비스접수 검색에 부서명/현장명)
-- 상태: 실행 대기 · sql-review 전. sql-review 통과 후 /sql-handoff 로 건넨다.
-- 실행: Supabase SQL Editor 에서 1회 실행. 두 번 돌려도 안전(add column if not exists / create index if not exists).
--
-- 무엇을 하나
--   1. vendor_info."부서명" text — _raw->>'부서명/현장명'(임대리스트 Q열)에서 자동 계산되는 STORED 생성 컬럼.
--      앞뒤 공백·줄바꿈은 자르고, 빈칸·"-"·"_" 는 '' (빈 문자열)로 둔다. null 은 나오지 않는다. (pg_trgm 은 public 스키마 — 2026-10-23 확인)
--      키맨·품목·모델명·제조사 생성 컬럼(customer-report-send.sql 57행)과 같은 방식이라
--      GAS 주간 동기화가 _raw 만 바꿔도 따라온다. 트리거(vendor_info_sync_search)는 건드리지 않는다.
--      GAS(apps-script/first-data/src/SupabaseSync.gs)는 "부서명" 키를 보내지 않으므로 업서트가 깨지지 않는다.
--   2. 인덱스 vendor_info_dept_trgm — gin ("부서명" gin_trgm_ops). 앱 검색 "부서명=ilike.*검색어*" 용.
--   권한: 라이브 vendor_info 는 표 단위 grant(anon=ar, authenticated=arwd)라 새 컬럼 select 가 자동으로 따라온다.
--         열 단위 grant 는 _raw·_hidden 의 anon UPDATE 뿐(쓰기용) — 새 컬럼은 생성 컬럼이라 쓰기 grant 불필요.
--         RLS 정책("anon all")도 그대로. 이 파일은 grant/정책을 바꾸지 않는다.
--
-- 잠금·소요 시간 (꼭 읽기)
--   * STORED 생성 컬럼 추가 = 표 전체 다시 쓰기(23,288행, 힙 83MB, 전체 106MB) + 기존 인덱스 9개 재생성.
--     그동안 ACCESS EXCLUSIVE 잠금 → vendor_info 읽기(서비스접수 검색·조회·통합검색)도 멈춘다.
--     예상 5~20초. anon 의 statement_timeout 이 3초라 그 사이 검색은 "시간 초과"가 날 수 있다(다시 누르면 됨).
--   * 이어서 gin trgm 인덱스 생성 1~3초(SHARE 잠금: 읽기는 되고 쓰기만 대기).
--   * lock_timeout 5초: 오래 걸리는 조회가 잡고 있으면 줄 서지 않고 바로 실패한다(전체 롤백 → 잠시 뒤 다시 실행).
--   * 피할 시간: 월요일 05:50~06:30 KST(GAS 임대리스트 동기화 — 라이브 _등록시각 2026-10-19 05:55:01 확인),
--     그리고 밤 00:30 전후(팀장 메모의 GAS 미러 시각). 권장: 평일 저녁 19시 이후 또는 점심 시간.
-- ============================================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.vendor_info
  add column if not exists "부서명" text
  generated always as (
    case when btrim(coalesce(_raw ->> '부서명/현장명', ''), E' \t\r\n') in ('', '-', '_') then ''   -- 빈칸·"-"·"_"(110행)은 빈 값
         else btrim(_raw ->> '부서명/현장명', E' \t\r\n') end
  ) stored;

create index if not exists vendor_info_dept_trgm
  on public.vendor_info using gin ("부서명" public.gin_trgm_ops);

commit;

-- 새 컬럼 통계(플래너가 인덱스를 고를 수 있게) + PostgREST 스키마 새로고침
analyze public.vendor_info ("부서명");
notify pgrst, 'reload schema';


-- ============================================================================
-- 확인 쿼리 (실행 후 하나씩 돌려 본다)
-- ============================================================================
-- 1) 컬럼이 생성 컬럼으로 붙었는지 — 기대: attgenerated = 's', 식에 '부서명/현장명'
-- select a.attname, a.attgenerated, pg_get_expr(d.adbin, d.adrelid)
--   from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
--  where a.attrelid = 'public.vendor_info'::regclass and a.attname = '부서명';
--
-- 2) 값 분포 — 기대(2026-10-22 라이브 실측, 다음 월요일 동기화 뒤 조금 달라짐):
--    total 23288 · has_dept 17255 · empty 6033(“-” 5,912 + “_” 110 + 빈칸 11) · null 0   (2026-10-23 팀장 실측, 식 수정 뒤)
-- select count(*) total,
--        count(*) filter (where "부서명" <> '') has_dept,
--        count(*) filter (where "부서명" = '')  empty,
--        count(*) filter (where "부서명" is null) nulls
--   from public.vendor_info;
--
-- 3) 인덱스 존재 — 기대: 1행, USING gin ("부서명" gin_trgm_ops)
-- select indexname, indexdef from pg_indexes
--  where schemaname = 'public' and tablename = 'vendor_info' and indexname = 'vendor_info_dept_trgm';
--
-- 4) anon 이 읽을 수 있는지 — 기대: true
-- select has_column_privilege('anon', 'public.vendor_info', '부서명', 'select');
--
-- 5) 예시 검색 건수 — 기대: 평택P4 338 · 북SUP 504 · 본사 831
-- select count(*) filter (where "부서명" ilike '%평택P4%') pt4,
--        count(*) filter (where "부서명" ilike '%북SUP%')  nsup,
--        count(*) filter (where "부서명" ilike '%본사%')   bonsa
--   from public.vendor_info;
--
-- 6) 인덱스를 타는지 — 기대: Bitmap Index Scan on vendor_info_dept_trgm
--    (3글자 이상 검색어에서. 표가 작아 플래너가 Seq Scan 을 고를 수도 있다 → 아래 enable_seqscan off 로 쓸 수 있는지만 확인)
--    주의: "본사" 처럼 2글자는 trigram 을 못 뽑아 인덱스를 못 탄다. 그래도 평평한 text 컬럼 훑기라 _raw JSONB 훑기보다 훨씬 가볍다.
-- begin; set local enable_seqscan = off;
-- explain analyze select id, "_업체명", "부서명" from public.vendor_info where "부서명" ilike '%라스코%' limit 30;
-- rollback;


-- ============================================================================
-- 되돌리기 (필요할 때만, SQL Editor 에서)
-- ============================================================================
-- 앱은 "부서명" 컬럼이 없으면(400) _raw->>부서명/현장명 경로로 한 번 대신 찾도록 설계돼 있어 되돌려도 화면은 안 깨진다.
-- drop column 은 메타데이터만 바꿔 빠르다(짧은 ACCESS EXCLUSIVE). 데이터 원본(_raw)은 그대로다.
--
-- begin;
-- set local lock_timeout = '5s';
-- drop index if exists public.vendor_info_dept_trgm;
-- alter table public.vendor_info drop column if exists "부서명";
-- commit;
-- notify pgrst, 'reload schema';


-- ============================================================================
-- 프런트 사용 예 (src/supabase.ts 래퍼만)
-- ============================================================================
-- (api.ts searchLeaseList 와 같은 꼴: const enc = encodeURIComponent; const deptCol = enc("부서명");)
-- selectRows("vendor_info", `select=id,${enc("_업체명")},${deptCol},_raw&${deptCol}=ilike.*${enc(kw)}*&limit=30`)   -- 부서 단계 검색
-- selectRows("vendor_info", `select=id,${enc("_업체명")},${deptCol}&${enc("순번")}=eq.${seq}&limit=1`)               -- 결과 줄·요약 칸 부서 표시
-- 400(column does not exist)이면 1회 대체: `select=id,${enc("_업체명")},_raw&${enc("_raw->>부서명/현장명")}=ilike.*${enc(kw)}*&limit=30`
