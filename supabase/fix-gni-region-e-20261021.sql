-- 2026-10-21 지앤아이(이의수) 점검·AS — C로 잘못 저장·오발송 처리된 건을 E(CSS)로 되살린다.
-- 원인: 접수 리포트 방문담당자 "지방"을 미양식 변환이 못 읽어 기본 C로 채움(코드 수정: src/region.ts tableVisitRegion).
-- 실측(2026-10-21 MCP): E로 다시 보낸 기록은 DB 어디에도 없다(jeomgeom·as_records·visit_logs·activity_events 0건).
--   → 카톡 E방에 직접 붙여넣은 것으로 보이며, FIELD 화면(E 점검 목록)에는 그래서 안 보인다.
-- 실행 전 확인: FIELD로 E를 다시 전송할 거면 이 SQL은 실행하지 말 것(중복 생긴다). 둘 중 하나만.
-- 대상: jeomgeom 34088, as_records 37456, visit_logs 8e227dbb-…, activity_events dbd80eae-… / 2ce3b5d4-…

begin;

update public.jeomgeom
   set "지역" = 'E', "_hidden" = false, "_hidden_at" = null, "_hidden_by" = ''
 where id = 34088 and "_업체명" = '지앤아이' and "작성일" = '2026-10-21' and "지역" = 'C';

update public.as_records
   set "지역" = 'E', "_hidden" = false, "_hidden_at" = null, "_hidden_by" = ''
 where id = 37456 and "_업체명" = '지앤아이' and "작성일" = '2026-10-21' and "지역" = 'C';

update public.visit_logs
   set status = 'active', cancelled_at = null, cancelled_by = null
 where id = '8e227dbb-f708-4ebf-ae3f-a92f9e4149b4' and status = 'cancelled';

update public.activity_events
   set team = 'E', status = 'active'
 where id in ('dbd80eae-01f3-47eb-a036-4432eee89f39', '2ce3b5d4-4d22-4798-beb3-ba7496bf170d')
   and team = 'C' and status = 'cancelled';

-- 확인: 각 1행·1행·1행·2행이어야 한다
select 'jeomgeom' t, id::text, "지역", coalesce("_hidden", false)::text from public.jeomgeom where id = 34088
union all select 'as_records', id::text, "지역", coalesce("_hidden", false)::text from public.as_records where id = 37456
union all select 'visit_logs', id::text, '', status from public.visit_logs where id = '8e227dbb-f708-4ebf-ae3f-a92f9e4149b4'
union all select 'activity_events', id::text, team, status from public.activity_events where id in ('dbd80eae-01f3-47eb-a036-4432eee89f39', '2ce3b5d4-4d22-4798-beb3-ba7496bf170d');

commit;

-- 되돌리기: 위 update 의 반대(지역 'C', _hidden true, status 'cancelled', team 'C')
