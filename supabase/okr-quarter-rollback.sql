-- 되돌리기: supabase/okr-quarter.sql (2026-10-20, 데이터실 표다빈)
--
-- 무엇을 되돌리나
--   1) 2026-10 goals 를 goals_prev(교체 직전 goals)로 복원, direction '' , goals_origin '' , parent_id null
--   2) 2026-11·12 의 goals_origin 'copy' → '' , parent_id null (goals 는 원래 안 바꿨음)
--   3) 분기 행(kind 'quarter') 삭제 → 그다음 kind CHECK 를 ('month','week') 로 원복
--      (순서 중요: quarter 행이 남아 있으면 CHECK 추가가 실패한다)
--   새 열 3개(direction·goals_origin·goals_prev)와 백업 표 2개는 남긴다(맨 아래 주석 참고).
--
-- 주의
--   - 앱 배포도 함께 옛 버전으로 돌릴 때만 실행. 새 앱이 쓰는 열은 남기므로 새 앱이 그대로여도 깨지지는 않지만
--     분기 화면은 비게 된다.
--   - 분기 행에 okr_reports 가 붙어 있으면(okr_reports.cycle_id 는 on delete cascade) 삭제 때 그 기록까지 지워진다.
--     그래서 아래 DO 블록이 그런 기록이 있으면 멈춘다 — 그 경우 기록을 먼저 확인할 것.
--   - [경고 2026-11-01] 파트 탭 [4분기] 기능부터 파트가 분기 결과를 okr_reports(cycle_id '2026-Q4', team A~D)에 적는다 — 분기 행을 지우면 cascade 로 이 파트 분기 기록까지 모두 지워진다.
--   - goals_prev 가 비어 있으면(이 SQL 전 앱이 따로 덮은 경우 등) 백업 표 okr_cycles_bak_20261020 의 goals 로 복원.
--   - okr_reports 는 okr-quarter.sql 이 바꾸지 않았다. 필요하면 okr_reports_bak_20261020 에서 행 단위로 복원.
--
-- 확인 쿼리 (기대값)
--   select kind, count(*) from okr_cycles group by kind;          → month 5 / week 9 (quarter 없음)
--   select id, parent_id, goals_origin, length(direction) from okr_cycles where kind = 'month' order by id;
--                                                                  → parent_id 모두 null, goals_origin '', 0
--   select c.id, c.goals = b.goals from okr_cycles c join okr_cycles_bak_20261020 b using (id) where c.kind = 'month';
--                                                                  → 모두 true (이후 앱에서 고친 달이 없다면)

begin;

do $$ begin
  if exists (select 1 from public.okr_reports r join public.okr_cycles c on c.id = r.cycle_id where c.kind = 'quarter') then
    raise exception '분기 행에 okr_reports 기록이 있다 — 삭제하면 같이 지워지므로 멈춤. 먼저 확인할 것';
  end if;
end $$;

-- 1) 10월 goals 복원 (goals_prev 우선, 없으면 백업 표)
update public.okr_cycles c set
  goals        = coalesce(c.goals_prev, b.goals, c.goals),
  goals_prev   = null,
  direction    = '',
  goals_origin = '',
  parent_id    = null,
  updated_at   = now(),
  updated_by   = 'okr-quarter-rollback.sql'
from public.okr_cycles_bak_20261020 b
where c.id = '2026-10' and b.id = c.id;

-- 2) 11·12월 표시 원복
update public.okr_cycles set goals_origin = '', parent_id = null
 where id in ('2026-11', '2026-12') and kind = 'month';

-- 다른 행이 분기를 가리키면 끊는다 (FK 는 on delete set null 이라 삭제만으로도 null 이 되지만 명시)
update public.okr_cycles set parent_id = null
 where parent_id in (select id from public.okr_cycles where kind = 'quarter');

-- 3) 분기 행 삭제 → CHECK 원복 (이 순서로)
delete from public.okr_cycles where kind = 'quarter';
alter table public.okr_cycles drop constraint if exists okr_cycles_kind_check;
alter table public.okr_cycles add constraint okr_cycles_kind_check check (kind in ('month', 'week'));

commit;

notify pgrst, 'reload schema';

-- (선택) 열까지 지우려면 — 새 앱이 이 열을 읽고 쓰므로 앱도 옛 버전일 때만:
-- alter table public.okr_cycles drop column if exists direction, drop column if exists goals_origin, drop column if exists goals_prev;
-- notify pgrst, 'reload schema';
-- (선택) 백업 표는 확인이 끝난 뒤에만:
-- drop table if exists public.okr_cycles_bak_20261020; drop table if exists public.okr_reports_bak_20261020;
