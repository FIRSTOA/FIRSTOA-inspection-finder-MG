-- 지역 값 정리 (2026-08-26) — jeomgeom·as_records의 지역을 A~E 한 글자로 통일한다.
-- 배경: 카톡 수집분에 "수도권D"·"경기 화성시"·"강서b"·라벨 오삼킴("키맨/접수자: …")이 지역 칸에 그대로 들어가 있었다
--       (비정상 178+202건, 표기 변형 3,871+3,261건). 원문(_원문)은 건드리지 않으므로 되돌릴 수 있고, 시작에 백업 테이블을 만든다.
-- 실행: Supabase SQL Editor에서 통째로 실행 (자동 실행은 데이터 변경 차단으로 막힘). 마지막 SELECT가 bad_left=0이면 완료.
-- 되돌리기: update public.jeomgeom j set 지역=b.지역 from public._backup_region_20260826 b where b.t='jeomgeom' and b.id=j.id::text; (as_records도 동일)

create table if not exists public._backup_region_20260826 as
  select 'jeomgeom'::text as t, id::text as id, 지역 from public.jeomgeom
  union all select 'as_records', id::text, 지역 from public.as_records;

-- jeomgeom: 1) 경기권 지명 → D, 지방 → E, "강서B"·"수도권c" 류 → 글자
update public.jeomgeom set 지역='D' where coalesce(지역,'')<>'' and 지역 !~ '^[A-E]$' and 지역 ~ '(경기|평택|수원|화성|오산|성남|인천|용인|안양|부천|고양|일산|파주|김포|하남|과천|안산|시흥|의정부|남양주|포승|광명|구리|광주시|이천|안성|양주|동탄)';
update public.jeomgeom set 지역='E' where coalesce(지역,'')<>'' and 지역 !~ '^[A-E]$' and 지역 ~ '(지방|충청|충남|충북|경상|경남|경북|전라|전남|전북|강원|제주|대전|대구|부산|울산|세종)';
update public.jeomgeom set 지역=upper(substring(지역 from '^\s*(?:강서|강남|강북|강동|서울)?\s*(?:수도권)?\s*([A-Ea-e])\s*(?:지역|팀)?\s*$'))
  where 지역 ~ '^\s*(?:강서|강남|강북|강동|서울)?\s*(?:수도권)?\s*[A-Ea-e]\s*(?:지역|팀)?\s*$' and 지역 !~ '^[A-E]$';
-- jeomgeom: 2) 남은 비정상(키맨/접수자:…, N, D450, 수도권AB 등): 원문의 "지역: X" 글자 → 없으면 수집 출처의 팀 글자 → 없으면 빈칸
update public.jeomgeom set 지역 = coalesce(
    upper(substring(_원문 from '(?:^|\n)\s*지역\s*[:：]\s*(?:수도권)?\s*([A-Ea-e])\s*(?:\r?\n|$)')),
    substring(_출처 from '\(([A-E])\)$'),
    '')
  where coalesce(지역,'')<>'' and 지역 !~ '^[A-E]$';

-- as_records: 같은 4단계
update public.as_records set 지역='D' where coalesce(지역,'')<>'' and 지역 !~ '^[A-E]$' and 지역 ~ '(경기|평택|수원|화성|오산|성남|인천|용인|안양|부천|고양|일산|파주|김포|하남|과천|안산|시흥|의정부|남양주|포승|광명|구리|광주시|이천|안성|양주|동탄)';
update public.as_records set 지역='E' where coalesce(지역,'')<>'' and 지역 !~ '^[A-E]$' and 지역 ~ '(지방|충청|충남|충북|경상|경남|경북|전라|전남|전북|강원|제주|대전|대구|부산|울산|세종)';
update public.as_records set 지역=upper(substring(지역 from '^\s*(?:강서|강남|강북|강동|서울)?\s*(?:수도권)?\s*([A-Ea-e])\s*(?:지역|팀)?\s*$'))
  where 지역 ~ '^\s*(?:강서|강남|강북|강동|서울)?\s*(?:수도권)?\s*[A-Ea-e]\s*(?:지역|팀)?\s*$' and 지역 !~ '^[A-E]$';
update public.as_records set 지역 = coalesce(
    upper(substring(_원문 from '(?:^|\n)\s*지역\s*[:：]\s*(?:수도권)?\s*([A-Ea-e])\s*(?:\r?\n|$)')),
    substring(_출처 from '\(([A-E])\)$'),
    '')
  where coalesce(지역,'')<>'' and 지역 !~ '^[A-E]$';

-- 확인: bad_left 가 0이어야 한다
select t,
       count(*) filter (where 지역 !~ '^[A-E]$' and coalesce(지역,'')<>'') as bad_left,
       count(*) filter (where coalesce(지역,'')='') as blank,
       count(*) as total
  from (select 'jeomgeom' t, 지역 from public.jeomgeom union all select 'as_records', 지역 from public.as_records) x
 group by t;
