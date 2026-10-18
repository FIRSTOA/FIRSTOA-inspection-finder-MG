-- DB 정비 (2026-10-19) — Supabase SQL Editor 에서 통째로 1회 실행
-- 2026-10-19 MCP 실측 감사(Supabase 자체 진단 포함)에서 나온 "기능엔 영향 없지만 쌓여 있던 것"을 치운다.
-- 데이터 행은 하나도 건드리지 않는다(cron 실행 로그 제외). 두 번 실행해도 안전.
-- 되돌리기: 인덱스·정책은 아래 주석의 원래 정의로 다시 만들면 된다. cron 로그는 복구 대상이 아니다.
-- 실행 시각: 아무 때나. (outbox 를 건드리지 않으므로 카톡 발송과 무관)
-- 검사(권한나 2026-10-19): 조건부 → 라이브 확인 완료. records_all 참조 객체 0, 지우는 인덱스 6개 모두 제약(constraint)에 딸리지 않음,
--   남기는 *_uniq·seq_uidx 5개 전부 UNIQUE, 지우는 정책의 역할은 모두 {anon} 이고 남는 ALL 정책이 같은 동작을 덮음(pg_policies 실측).
--   cron 로그 delete 가 에디터 시간 제한에 걸리면 오류만 나고 데이터는 그대로다 → 그때는 interval 을 '60 days'→'30 days'→'14 days' 로 나눠 반복.

-- ---------------------------------------------------------------------------
-- 1) cron 실행 로그 283,674행 293MB(DB 912MB 중) — 8/2 이후 한 번도 안 지워짐.
--    14일치만 남기고 지우고, 앞으로는 날마다 KST 03:10 에 14일 지난 것을 자동으로 지운다.
delete from cron.job_run_details where end_time < now() - interval '14 days';
select cron.unschedule(jobid) from cron.job where jobname = 'purge-cron-log';
select cron.schedule('purge-cron-log', '10 18 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);

-- ---------------------------------------------------------------------------
-- 2) 똑같은 인덱스가 둘씩 있던 것 6쌍 — 하나만 남긴다(남기는 쪽: *_uniq, as_records_vendor_idx, vendor_info_seq_uidx).
--    되돌리기: create unique index bulman_dupkey_idx on public.bulman ("_dupKey"); (나머지도 같은 꼴)
drop index if exists public.bulman_dupkey_idx;
drop index if exists public.overage_adjust_dupkey_idx;
drop index if exists public.pc_expansion_dupkey_idx;
drop index if exists public.recontract_dupkey_idx;
drop index if exists public.as_vendor_idx;            -- as_records("_업체명") = as_records_vendor_idx 와 동일
drop index if exists public.vendor_info_seq_idx;      -- vendor_info("순번") = vendor_info_seq_uidx 와 동일

-- ---------------------------------------------------------------------------
-- 3) 이름 충돌로 만들어지지 못했던 인덱스 — ticket-vendor-code.sql 이 vendor_info_seq_idx 라는 이름을 (_raw->>'순') 에 쓰려 했지만
--    같은 이름이 이미 ("순번") 에 있어 조용히 건너뛰었다. 그래서 AS 일정 저장 때마다 임대리스트 2만 행을 훑는다(추정).
create index if not exists vendor_info_raw_seq_idx on public.vendor_info ((btrim(_raw->>'순')));
-- Supabase 진단: okr_cycles.parent_id 외래키에 인덱스 없음
create index if not exists okr_cycles_parent_idx on public.okr_cycles (parent_id);

-- ---------------------------------------------------------------------------
-- 4) 같은 역할·같은 동작에 정책이 둘씩 겹치던 것 — 옛 이름 쪽을 지운다(남는 정책이 같은 권한을 이미 준다).
--    되돌리기: create policy "anon read albums" on public.photo_albums for select to anon using (true); (insert 도 같은 꼴)
drop policy if exists "anon read albums" on public.photo_albums;        -- = "photo albums anon read"
drop policy if exists "anon insert albums" on public.photo_albums;      -- = "photo albums anon insert"
drop policy if exists "happycall_messages anon update" on public.happycall_messages;  -- "… anon all" 에 포함
drop policy if exists "bulman anon insert" on public.bulman;            -- "anon all" 에 포함
drop policy if exists "bulman anon read" on public.bulman;
drop policy if exists "misu anon insert" on public.misu;
drop policy if exists "misu anon read" on public.misu;
drop policy if exists "mfp expansion anon insert" on public.mfp_expansion;
drop policy if exists "mfp expansion anon read" on public.mfp_expansion;
drop policy if exists "pc_expansion anon insert" on public.pc_expansion;
drop policy if exists "pc_expansion anon read" on public.pc_expansion;
drop policy if exists "overage_adjust anon insert" on public.overage_adjust;
drop policy if exists "overage_adjust anon read" on public.overage_adjust;
drop policy if exists "recontract anon insert" on public.recontract;
drop policy if exists "recontract anon read" on public.recontract;
drop policy if exists "anon read" on public.app_config;                 -- "app_config anon write"(ALL) 에 포함
drop policy if exists "anon read" on public.room_map;                   -- "room_map anon write"(ALL) 에 포함
-- ※ "… anon update hidden" 정책들은 그대로 둔다: 원장 표는 컬럼 GRANT(숨김 3컬럼)가 실제 울타리라 지우면 숨김 기능이 막힌다.

-- ---------------------------------------------------------------------------
-- 5) 안 쓰는 뷰 records_all — 코드 어디서도 안 부르고, 숨김(_hidden) 필터도 없어 숨긴 기록이 새어 나가는 통로였다.
--    되돌리기(원래 정의, 2026-10-19 라이브에서 복사):
--      create view public.records_all as
--        select '점검'::text as tab, id, "작성일","작성자","구분","레벨","등급","업체명","부서명","지역","키맨/접수자","모델명","시리얼넘버","자산기번",
--               "내용","처리내용","매수","토너잔량","폐통","여분","한틴이카유무","주차비지원유무","특이사항","_업체명","_출처","_원문","_등록시각","_dupKey",created_at
--          from public.jeomgeom
--        union all
--        select 'AS'::text, id, "작성일","작성자","구분","레벨","등급","업체명","부서명","지역","키맨/접수자","모델명","시리얼넘버","자산기번",
--               "내용","처리내용","매수","토너잔량","폐통","여분","한틴이카유무","주차비지원유무","특이사항","_업체명","_출처","_원문","_등록시각","_dupKey",created_at
--          from public.as_records;
--    (라이브 확인 2026-10-19: 이 뷰를 참조하는 다른 뷰·함수 0개 → cascade 불필요)
drop view if exists public.records_all;
-- all_vendor_tabs(통합검색이 쓰는 뷰)는 security_invoker 가 이미 켜져 있어 그대로.

-- ---------------------------------------------------------------------------
-- 6) Supabase 보안 진단 "search_path 미고정" 함수 22개 — 호출자가 search_path 를 바꿔 다른 함수를 끼워 넣는 것을 막는다.
--    동작은 바뀌지 않는다(전부 public 스키마만 쓴다).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'                                                   -- procedure·aggregate 제외
       and p.prolang <> (select oid from pg_language where lanname = 'c')   -- pg_trgm 내부 함수 제외
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- 확장 소유 함수 제외
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7) 8월 정리 때 남긴 백업 표 3개(99MB). 두 달이 지났고 정리 결과에 문제 보고가 없었다.
--    지우면 되돌릴 수 없으니 기본은 주석. 지우려면 주석을 풀어 실행.
-- drop table if exists public._backup_dupe_20260827_jeomgeom;
-- drop table if exists public._backup_dupe_20260827_as;
-- drop table if exists public._backup_region_20260826;

-- ---------------------------------------------------------------------------
-- 확인: 첫 줄 cron 로그가 수만 행 이하, 중복 인덱스 0, purge-cron-log 가 active, records_all 없음이면 성공.
select 'cron 로그 행' as 항목, count(*)::text as 값 from cron.job_run_details
union all select '중복 인덱스 쌍', count(*)::text from (
  select tablename, regexp_replace(indexdef, 'INDEX \S+ ON', 'INDEX ON') d, count(*) from pg_indexes
   where schemaname='public' group by 1,2 having count(*)>1) x
union all select 'purge-cron-log', coalesce((select 'active='||active||' '||schedule from cron.job where jobname='purge-cron-log'), '없음')
union all select 'records_all 뷰', (select count(*)::text from pg_views where schemaname='public' and viewname='records_all')
union all select 'vendor_info_raw_seq_idx', (select count(*)::text from pg_indexes where indexname='vendor_info_raw_seq_idx')
union all select 'search_path 미고정 함수', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace
   and p.prolang <> (select oid from pg_language where lanname='c')
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%'));
