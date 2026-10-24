-- ============================================================================
-- cron 실행 로그 보존 줄이기 + 옛 백업 표 정리 준비 — 2026-10-24 · 데이터실 표다빈
-- SQL Editor 에서 1~2 블록을 통째로 1회 실행(채울 것 없음). 두 번 실행해도 안전. 3 블록(DROP)은 기본 주석 — 노트북 백업 확인 뒤 따로.
-- 설계: docs/tasks/db-hardening-2026-10-24.md (D). 이 파일 다음에 hardening-vacuum-cron-log-20261024.sql(한 줄, 따로 실행).
--
-- 왜: docs/tasks/risk-audit-2026-10-24.md 요약 7·부록 A10·E6. DB 877MB 중
--   · cron.job_run_details 293MB — 실제 살아 있는 데이터 43MB(64,287행, 10/9~), 나머지는 지운 행이 남긴 빈 자리(bloat).
--     purge-cron-log(job 24, 매일 03:10 KST)가 14일 지난 것을 DELETE 하지만 DELETE 는 파일 크기를 줄이지 않는다.
--     하루 약 5,000행(매분 job 3·8 각 1,440 + 2분 job 4·21 각 720 + 3분 job 9 480 …).
--   · _backup_dupe_20260827_jeomgeom 55MB(31,771행) · _backup_dupe_20260827_as 42MB(21,513행) — 8/27 카톡 중복 정리 직전 사본
--     (supabase/dedupe-kakao-20260827.sql). 8/26 이후 한 번도 안 바뀜. 지금 표에 없는 행(=그때 지운 중복) 9,146 + 7,886 행은
--     이 사본에만 있다. 노트북 매일 백업 목록(tools/worker/backup_tables.py TABLES)에는 안 들어 있다.
--     또 public 스키마라 anon 이 SELECT·INSERT·UPDATE·DELETE 할 수 있다(카톡 원문 노출).
--   · _backup_region_20260826 1.5MB(30,051행, 열 t·id·지역) — 8/26 지역 정리 전 값.
-- 권한나 검사(2026-10-24): 실행 금지 없음, 고친 뒤 실행 — 반영함: 2번 블록 out(별도 보관 폴더) 필수 가드, 덮어쓰기 경고,
--   tables 에 _backup_region_20260826 추가, 사본 표 인덱스 없음 → statement_timeout 가능성 주석, DROP 가드에 30,051 행 추가.
-- 라이브 실측(MCP 읽기, 2026-10-24): 위 숫자 전부. cron.log_run 은 postmaster 설정이라 SQL 로 끌 수 없음(Supabase 지원 요청 사항).
--   postgres 는 cron.job_run_details 에 MAINTAIN 권한 있음(VACUUM FULL 가능, PG 17).
-- ============================================================================

-- 1) cron 로그 보존 14일 → 7일 (사용자 결정 기본값. 14일을 유지하려면 이 블록을 건너뛴다) ----------------
--    실행 순간 7일 넘은 행(약 3만 행)을 지운다. 되돌리기: 아래 명령에서 '7 days' → '14 days' 로 다시 alter_job (지운 로그는 복구 안 됨).
select cron.alter_job(jobid, command := $c$delete from cron.job_run_details where end_time < now() - interval '7 days'$c$)
  from cron.job where jobname = 'purge-cron-log';
delete from cron.job_run_details where end_time < now() - interval '7 days';

-- 2) 옛 백업 표 3개를 노트북 **별도 보관 폴더**로 내려받는 일감 — 실행기가 1분 안에 집는다 ---------------------
--    out_dir 는 기본값 'archive-20261024' 그대로 — 실행기(worker.py 2026-10-24 이후)가 평소 백업 루트(구글 드라이브\FIRSTOA-백업) 아래
--      그 이름 폴더로 푼다(노트북 경로를 몰라도 됨). 절대경로를 적어도 된다(역슬래시 한 번). 옛 실행기면 tools\workerrchive-20261024 에 생긴다.
--    **out 을 비우면** 실행기 기본 백업 루트의 오늘 날짜 폴더에 쓰고 그날 02:30 백업의 manifest.json 을 덮어쓴다. 또 그 폴더는
--      14일 뒤 자동 삭제(KEEP=14)된다 → 반드시 별도 폴더로. 날짜(YYYY-MM-DD) 이름이 아닌 폴더는 매일 정리 대상이 아니다
--      (tools/worker/backup_tables.py prune). 비우면 아래 가드가 일감을 넣지 않고 멈춘다.
--    결과: worker_jobs.result 에 "백업 완료 … 표 3개 · 83,335행 · 실패 0개". 파일은 <보관 폴더>\<오늘 날짜>\ 아래.
--    주의(추정): 사본 표들은 인덱스가 없다(팀장 사전 조회). 실행기는 anon 으로 order=id.asc&offset=… 1,000행씩 읽으므로
--      페이지마다 전체 정렬 → anon statement_timeout 에 걸려 "실패 1개 이상"이 될 수 있다. 그래도 3번 블록 가드가 DROP 을 막는다.
--      그때는 (표 하나씩 다시 넣으면 3번 가드의 "한 일감에 실패 0개" 조건이 안 맞으므로) 사람이 대시보드 Table Editor 에서 CSV 내려받기로 대신한다.
--    _backup_region_20260826 은 id 가 표 안에서 겹칠 수 있어(열 t·id·지역) offset 페이지가 행을 빠뜨리거나 겹칠 수 있다 — 행 수를 확인.
do $$
declare
  out_dir text := 'archive-20261024';   -- 그대로 두면 됨(백업 루트 아래 이 이름 폴더). 다른 곳에 두려면 절대경로(역슬래시 한 번)
begin
  if out_dir like '<%' or btrim(out_dir) = '' then
    raise exception '보관 폴더 경로를 넣지 않았습니다 — out_dir 를 노트북의 실제 절대경로로 바꾼 뒤 다시 실행';
  end if;
  if exists (select 1 from public.worker_jobs where created_by = 'hardening-20261024' and kind = 'backup' and status in ('queued', 'running', 'done')) then
    raise notice '이미 넣은 백업 일감이 있음 — 건너뜀';
    return;
  end if;
  insert into public.worker_jobs (kind, payload, created_by)
  values ('backup',
          jsonb_build_object('tables', '_backup_dupe_20260827_jeomgeom,_backup_dupe_20260827_as,_backup_region_20260826', 'out', out_dir),
          'hardening-20261024');
end $$;

-- 확인
select '보존 명령' as 항목, (select command from cron.job where jobname = 'purge-cron-log') as 값
union all select 'cron 로그 행', count(*)::text from cron.job_run_details
union all select '백업 일감', coalesce((select status || ' · ' || coalesce(result, error, '') from public.worker_jobs
                                         where created_by = 'hardening-20261024' order by id desc limit 1), '없음');
-- 1~2분 뒤 다시: select id, status, result, error from public.worker_jobs where created_by = 'hardening-20261024';

-- ---------------------------------------------------------------------------
-- 3) DROP — 기본 주석. 위 백업 일감이 done·"실패 0개" 이고 보관 폴더에 json 파일 세 개가 있는 것을 확인한 뒤에만, 주석을 풀어 이 블록만 실행.
--    되돌릴 수 없다(복구 = 내려받은 json 을 다시 올리는 수작업). 행 수가 실측과 다르면 아무것도 지우지 않고 멈춘다.
-- do $$
-- begin
--   if not exists (select 1 from public.worker_jobs where created_by = 'hardening-20261024' and kind = 'backup'
--                   and status = 'done' and result like '%실패 0개%') then
--     raise exception '노트북 백업 일감이 아직 done·실패 0개가 아님 — 중단';
--   end if;
--   if (select count(*) from public._backup_dupe_20260827_jeomgeom) <> 31771
--      or (select count(*) from public._backup_dupe_20260827_as) <> 21513
--      or (select count(*) from public._backup_region_20260826) <> 30051 then
--     raise exception '백업 표 행 수가 2026-10-24 실측(31,771 / 21,513 / 30,051)과 다름 — 중단';
--   end if;
--   drop table public._backup_dupe_20260827_jeomgeom;
--   drop table public._backup_dupe_20260827_as;
--   -- 지역 정리 전 값(1.5MB)도 지우기로 결정했으면 다음 줄 주석도 푼다(위 백업 일감에 포함됨 — json 행 수 30,051 확인 뒤)
--   -- drop table if exists public._backup_region_20260826;
-- end $$;
-- 확인: select count(*) from pg_class where relname like '\_backup\_dupe\_20260827%';   → 0

-- 이 파일은 새 표를 만들지 않는다(프런트 사용 예 없음). 기록 확인은 MCP/SQL 로:
--   select jobid, count(*) from cron.job_run_details where start_time > now() - interval '1 day' group by 1 order by 2 desc;
