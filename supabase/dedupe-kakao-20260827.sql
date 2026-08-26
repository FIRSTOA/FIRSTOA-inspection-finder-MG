-- 카톡 수집 중복행 정리 (2026-08-27)
-- 왜 생겼나: _dupKey는 "파싱된 필드값"으로 만든다. 그동안 파서를 고치면서(빈 칸이 다음 줄을 삼키던 버그 등)
--   같은 카톡 메시지가 다른 _dupKey가 되었고, 전체 파일 재업로드 때 기존 행과 중복으로 다시 들어왔다(약 11,000건).
-- 판정 기준: **_출처 + _원문이 같으면 같은 카톡 메시지** = 중복. 가장 먼저 들어온 행(created_at → id 순)만 남긴다.
-- 실행: Supabase SQL Editor에서 통째로 실행. 마지막 SELECT가 남은 중복 0을 보여주면 완료.
-- 되돌리기: 시작에 백업 테이블을 만든다(_backup_dupe_20260827_*). 필요 없어지면 drop 하면 된다.

create table if not exists public._backup_dupe_20260827_jeomgeom as
  select * from public.jeomgeom where _출처 like '카톡:%';
create table if not exists public._backup_dupe_20260827_as as
  select * from public.as_records where _출처 like '카톡:%';

-- 삭제 전 규모 확인
select '삭제 예정' as 구분, '점검' as 표, count(*) as 건수 from (
  select id, row_number() over (partition by _출처, _원문 order by created_at asc, id asc) rn
    from public.jeomgeom where _출처 like '카톡:%' and coalesce(_원문,'') <> ''
) t where rn > 1
union all
select '삭제 예정', 'AS', count(*) from (
  select id, row_number() over (partition by _출처, _원문 order by created_at asc, id asc) rn
    from public.as_records where _출처 like '카톡:%' and coalesce(_원문,'') <> ''
) t where rn > 1;

-- 점검: 같은 원문 중 첫 행만 남기고 삭제
delete from public.jeomgeom
 where id in (
   select id from (
     select id, row_number() over (partition by _출처, _원문 order by created_at asc, id asc) rn
       from public.jeomgeom where _출처 like '카톡:%' and coalesce(_원문,'') <> ''
   ) t where rn > 1
 );

-- AS: 동일
delete from public.as_records
 where id in (
   select id from (
     select id, row_number() over (partition by _출처, _원문 order by created_at asc, id asc) rn
       from public.as_records where _출처 like '카톡:%' and coalesce(_원문,'') <> ''
   ) t where rn > 1
 );

-- 확인: 남은 중복이 0이어야 한다
select _출처,
       count(*) as 전체,
       count(*) - count(distinct _원문) as 남은중복
  from public.jeomgeom where _출처 like '카톡:점검(%' group by _출처
union all
select _출처, count(*), count(*) - count(distinct _원문)
  from public.as_records where _출처 like '카톡:AS(%' group by _출처
 order by 1;
