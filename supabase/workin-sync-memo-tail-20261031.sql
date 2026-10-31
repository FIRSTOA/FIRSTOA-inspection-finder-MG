-- ============================================================================
-- 워킨맵 동기화 — 메모 비교 키에서 날짜 꼬리 떼기 · 2026-10-31
-- 왜: 가져오기가 앱에 덧붙이는 메모에 " (워킨맵 2026-10-20)" 날짜 꼬리를 단다(사용자 "메모가 추가될 때 웹앱에는 날짜가 표시되도록").
--     되밀기 큐 트리거(workin_sync_enqueue)의 항목 비교 키(workin_memo_key → item_key md5)도 꼬리를 뗀 본문으로 비교해야
--     같은 메모가 꼬리만 달라 새 항목으로 잡히지 않는다.
-- 규칙(엣지 supabase/functions/workinmap-sync/plan.ts memoCompareKey 와 같은 순서 — 바꾸면 둘 다):
--   1) btrim → 연속 공백(줄바꿈 포함) 1칸   (기존과 같음)
--   2) 끝의 날짜 꼬리 떼기: 괄호 안 "이름(공백·괄호 없는 1~20자) + 공백 + YYYY-MM-DD" — 여러 개 이어져도 전부.
--      예 " (워킨맵 2026-10-20)" · " (앱 2026-10-21)" · "(홍길동 2026-10-22)". "[G5 완료] 2026-10-20 (워킨맵)" 은 꼬리 아님(날짜 없음).
--   3) 뗀 결과가 비면(꼬리뿐인 메모) 1) 값 그대로.
-- 바꾸는 것: 함수 public.workin_memo_key 하나(시그니처·권한 같음). 표·트리거·다른 함수는 그대로.
-- 실행: 사용자(SQL Editor). 재실행 안전(create or replace).
-- 확인:
--   select public.workin_memo_key('키맨 홍길동 (워킨맵 2026-10-20)');            -- 키맨 홍길동
--   select public.workin_memo_key('a (워킨맵 2026-10-20) (앱 2026-10-21)');      -- a
--   select public.workin_memo_key('[G5 완료] 2026-10-20 (워킨맵)');              -- [G5 완료] 2026-10-20 (워킨맵)
--   select public.workin_memo_key(' (워킨맵 2026-10-20)');                       -- (워킨맵 2026-10-20)
-- ============================================================================

create or replace function public.workin_memo_key(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  with k as (select regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g') as v)
  select coalesce(
           nullif(btrim(regexp_replace(k.v, '(\s*\([^()[:space:]]{1,20}\s+[0-9]{4}-[0-9]{2}-[0-9]{2}\))+\s*$', '')), ''),
           k.v)
    from k
$$;
revoke all on function public.workin_memo_key(text) from public, anon, authenticated;
grant execute on function public.workin_memo_key(text) to service_role;
comment on function public.workin_memo_key(text) is
  '메모 항목 비교 키: 공백 정리 + 끝 날짜 꼬리 " (이름 YYYY-MM-DD)" 떼기(엣지 plan.ts memoCompareKey 와 같은 규칙). 2026-10-31 workin-sync-memo-tail-20261031.sql';

-- 되돌리기(꼬리 떼기 전 원래 함수 — supabase/workin-sync-20261031.sql 5-1 과 같음):
--   create or replace function public.workin_memo_key(p text)
--   returns text language sql immutable set search_path = pg_catalog as $$
--     select regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')
--   $$;
--   revoke all on function public.workin_memo_key(text) from public, anon, authenticated;
--   grant execute on function public.workin_memo_key(text) to service_role;
