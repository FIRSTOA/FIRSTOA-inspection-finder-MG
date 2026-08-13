-- SQL 판정 함수 자동 테스트 — 실행법:
--   psql (풀러 접속) -f supabase/tests/judgments.sql
-- 전부 통과하면 마지막에 "OK: SQL 판정 테스트 전부 통과" NOTICE가 뜨고,
-- 하나라도 어긋나면 exception으로 즉시 실패한다.
-- 케이스 출처: 재계약 212건 미분류(2109/27SS…), 워킨맵 # 접두 190곳(20#SS…),
--              _x000d_ 줄바꿈 혼입, 마감 꼬리표, 날짜 표기 혼재.

do $$
declare v text;
begin
  -- workin_grade_ : 등급 분리
  if workin_grade_('14SS㈜이오플랜본사1매월마감') <> 'SS' then raise exception 'grade: 14SS 형식'; end if;
  if workin_grade_('2109/27SS한성알앤씨매월마감') <> 'SS' then raise exception 'grade: 2109/27SS 재계약 형식 (212건 사고)'; end if;
  if workin_grade_('20#SS한불엠앤에스㈜1층 리셉션매월마감') <> 'SS' then raise exception 'grade: 20#SS 형식 (# 접두 190곳)'; end if;
  if workin_grade_('2609/17#V파인솔루션 주식회사506호매월마감') <> 'V' then raise exception 'grade: /17#V 형식'; end if;
  if workin_grade_('5N스타웍스 파트너스매월마감') <> 'N' then raise exception 'grade: 5N 형식'; end if;
  if workin_grade_('정도테크') <> '' then raise exception 'grade: 등급 없는 이름은 빈 값'; end if;

  -- workin_vendor_ : 업체명 분리
  v := workin_vendor_('14SS㈜이오플랜본사1매월마감');
  if v <> '㈜이오플랜본사1' then raise exception 'vendor: 마감 꼬리 제거 실패 → %', v; end if;
  v := workin_vendor_('20#SS한불엠앤에스㈜1층 리셉션매월마감');
  if v <> '한불엠앤에스㈜1층 리셉션' then raise exception 'vendor: # 접두 제거 실패 → %', v; end if;
  v := workin_vendor_('2109/27SS한성알앤씨매월마감');
  if v <> '한성알앤씨' then raise exception 'vendor: 재계약 접두 제거 실패 → %', v; end if;
  v := workin_vendor_(e'30V조선왕릉동부지구관리소_x000d_\n아이디 : admin_x000d_분기마감');
  if v like '%x000d%' or v not like '조선왕릉%' then raise exception 'vendor: _x000d_ 정리 실패 → %', v; end if;
  v := workin_vendor_('10V보림토건/엘베 없음 매월마감');
  if v <> '보림토건' then raise exception 'vendor: / 특이사항 분리 실패 → %', v; end if;

  -- safe_date_ : 날짜 표기 혼재
  if safe_date_('2026.08.14') <> date '2026-08-14' then raise exception 'date: 점 표기'; end if;
  if safe_date_('작성일 2026/08/01 오후') <> date '2026-08-01' then raise exception 'date: 슬래시+부가 텍스트'; end if;
  if safe_date_('기록 없음') is not null then raise exception 'date: 날짜 아님은 null'; end if;

  -- vendor_key_ : 매칭 키 (앞 8자)
  if vendor_key_('㈜더채움자산운용') <> vendor_key_('더채움자산운용') then raise exception 'key: ㈜ 표기 차이 (더채움 사고)'; end if;
  if vendor_key_('한성 알앤씨') <> vendor_key_('한성알앤씨') then raise exception 'key: 공백 차이'; end if;
  if length(vendor_key_('아주아주아주아주긴업체명입니다')) <> 8 then raise exception 'key: 8자 제한'; end if;

  raise notice 'OK: SQL 판정 테스트 전부 통과';
end $$;
