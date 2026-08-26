-- 지역 빈칸 채우기 (2026-08-26) — region-cleanup-20260826.sql 실행 후 남은 24건 중 근거가 있는 17건.
-- 빈칸이 생긴 경위: 사람이 양식의 "지역:" 칸을 비운 채 저장했고, 옛 파서가 다음 줄("키맨/접수자: …")을 지역으로 삼켜
--   값이 있는 것처럼 통과했다. 정리 SQL이 그 라벨 문자열을 지웠고, 원문에도 지역이 없어 빈칸으로 남았다.
-- 근거 우선순위: ① 임대리스트 "관리 담당자"(AV열, 그 업체의 담당 팀 = 정답)  ② 없으면 작성자 소속팀(방문자 기준 추정)
-- 실행: Supabase SQL Editor. 백업은 이미 _backup_region_20260826에 있다.

-- jeomgeom: 14건
update public.jeomgeom set 지역='A' where id='16201' and coalesce(지역,'')='';  -- 이동화행정사무소 · 작성자 김정민 소속팀
update public.jeomgeom set 지역='C' where id='16233' and coalesce(지역,'')='';  -- 비티엔터테인먼트 · 임대리스트 관리담당자="수도권C"
update public.jeomgeom set 지역='A' where id='16384' and coalesce(지역,'')='';  -- 서안안전컨설팅 · 작성자 심태현 소속팀
update public.jeomgeom set 지역='B' where id='16408' and coalesce(지역,'')='';  -- 제이앤솔루션 · 임대리스트 관리담당자="수도권B"
update public.jeomgeom set 지역='A' where id='16748' and coalesce(지역,'')='';  -- 풀리오 · 임대리스트 관리담당자="수도권A"
update public.jeomgeom set 지역='A' where id='16896' and coalesce(지역,'')='';  -- 얄라코리아 · 임대리스트 관리담당자="수도권A"
update public.jeomgeom set 지역='A' where id='16954' and coalesce(지역,'')='';  -- 미딕스코리아 · 임대리스트 관리담당자="수도권A"
update public.jeomgeom set 지역='B' where id='16998' and coalesce(지역,'')='';  -- 테스토코리아(유) · 임대리스트 관리담당자="수도권B"
update public.jeomgeom set 지역='B' where id='17012' and coalesce(지역,'')='';  -- 주식회사 픽스커뮤니케이션즈 · 임대리스트 관리담당자="수도권B"
update public.jeomgeom set 지역='C' where id='17030' and coalesce(지역,'')='';  -- 주식회사 무암 (Mooam) · 작성자 이민구 소속팀
update public.jeomgeom set 지역='D' where id='16273' and coalesce(지역,'')='';  -- 주식회사 에이징(AZING Co.,Ltd · 임대리스트 관리담당자="수도권D"
update public.jeomgeom set 지역='C' where id='16360' and coalesce(지역,'')='';  -- 법무법인 행복 · 작성자 박영현 소속팀
update public.jeomgeom set 지역='A' where id='16434' and coalesce(지역,'')='';  -- 나는청소년 · 임대리스트 관리담당자="수도권A"
update public.jeomgeom set 지역='B' where id='16938' and coalesce(지역,'')='';  -- 미디어와이즈엔터컴 · 임대리스트 관리담당자="수도권B"

-- as_records: 3건
update public.as_records set 지역='C' where id='26852' and coalesce(지역,'')='';  -- 주식회사 무암 (Mooam) · 작성자 이민구 소속팀
update public.as_records set 지역='C' where id='26853' and coalesce(지역,'')='';  -- 주식회사 무암 (Mooam) · 작성자 이민구 소속팀
update public.as_records set 지역='C' where id='26854' and coalesce(지역,'')='';  -- 주식회사 무암 (Mooam) · 작성자 이민구 소속팀

-- 남은 7건은 채울 근거가 없다: 옛 시트 적재 때 파싱이 깨진 행으로 업체명 자리에 "부서명 :20층" 같은 값이 들어가 있다.
-- 통계·검색에서 빼려면 아래 주석을 풀어 숨김 처리(행은 남고 화면에서만 제외):
-- update public.as_records set _hidden=true where id='13937';  -- 부서명 :20층 (유주영)
-- update public.as_records set _hidden=true where id='13946';  -- 부서명 :1층L5700 (유주영)
-- update public.as_records set _hidden=true where id='13857';  -- 부서명 :1503호 ((알 수 없음))
-- update public.as_records set _hidden=true where id='13882';  -- 부서명 :4층 (유주영)
-- update public.as_records set _hidden=true where id='13904';  -- 부서명 :B (유주영)
-- update public.as_records set _hidden=true where id='13935';  -- 부서명 :지하2층 하우스키핑사무실 (유주영)
-- update public.as_records set _hidden=true where id='13869';  -- 부서명 :2206호 ((알 수 없음))

-- 확인: blank 가 7(숨김 처리하면 그대로) 로 줄어야 한다
select t, count(*) filter (where coalesce(지역,'')='') as blank, count(*) as total
  from (select 'jeomgeom' t, 지역 from public.jeomgeom union all select 'as_records', 지역 from public.as_records) x
 group by t;
