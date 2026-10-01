-- OKR 주차 기록 번호 옮기기 (2026-10-01) — Supabase SQL Editor에서 한 번 실행
-- 주차 규칙이 "그 주가 시작하는 월요일이 든 달"로 바뀌면서(앱 ae69892) 서버에 남은 주차 id를 새 셈법에 맞춘다.
--   2026-09-W1 (8/31~9/4)  → 2026-08-W5   (8월 5주차)
--   2026-09-W2 (9/7~9/11)  → 2026-09-W1   (9월 1주차)
--   2026-09-W5 (9/28~10/2) → 2026-09-W4   (9월 4주차 = 이번 주)
--   2026-12-W1 (11/30~12/4)→ 2026-11-W5   (11월 5주차, 2026-11 달 행이 없으면 10월 목표를 복사해 만든다)
--   2026-10-W1 에 10/1 오전(옛 셈법으로 "10월 1주차"가 이번 주였을 때) 적힌 결과 → 2026-09-W4로 합친다. 10-W1 행 자체는 남긴다(이제 10/5~10/9).
-- 같은 사람 행이 양쪽에 있으면 번호별로 합친다: 한쪽이 비면 채워진 쪽, 둘 다 있으면 먼저 것 뒤에 나중 것을 덧붙인다(판정은 먼저 것 유지).
-- 실행 전 상태 백업: 이 파일과 같은 날짜의 okr_backup_before_week_renumber_*.json (작업 PC scratchpad).

begin;

create or replace function okr_merge_rows(a jsonb, b jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(x order by (x->>'no')::int), '[]'::jsonb) from (
    select case
      when bb.r is null then aa.r
      when aa.r is null then bb.r
      when coalesce(aa.r->>'actual','') = '' and coalesce(aa.r->>'judgment','') = '' then bb.r
      when coalesce(bb.r->>'actual','') = '' and coalesce(bb.r->>'judgment','') = '' then aa.r
      else (aa.r - 'html') || jsonb_build_object(
        'actual',   trim(both E'\n' from coalesce(aa.r->>'actual','')   || case when coalesce(bb.r->>'actual','')   <> '' and coalesce(bb.r->>'actual','')   <> coalesce(aa.r->>'actual','')   then E'\n' || (bb.r->>'actual')   else '' end),
        'reason',   trim(both E'\n' from coalesce(aa.r->>'reason','')   || case when coalesce(bb.r->>'reason','')   <> '' and coalesce(bb.r->>'reason','')   <> coalesce(aa.r->>'reason','')   then E'\n' || (bb.r->>'reason')   else '' end),
        'plan',     trim(both E'\n' from coalesce(aa.r->>'plan','')     || case when coalesce(bb.r->>'plan','')     <> '' and coalesce(bb.r->>'plan','')     <> coalesce(aa.r->>'plan','')     then E'\n' || (bb.r->>'plan')     else '' end),
        'evidence', trim(both E'\n' from coalesce(aa.r->>'evidence','') || case when coalesce(bb.r->>'evidence','') <> '' and coalesce(bb.r->>'evidence','') <> coalesce(aa.r->>'evidence','') then E'\n' || (bb.r->>'evidence') else '' end),
        'judgment', case when coalesce(aa.r->>'judgment','') = '' then coalesce(bb.r->>'judgment','') else aa.r->>'judgment' end)
    end as x
    from (select r from jsonb_array_elements(coalesce(a, '[]'::jsonb)) r) aa
    full join (select r from jsonb_array_elements(coalesce(b, '[]'::jsonb)) r) bb on (aa.r->>'no') = (bb.r->>'no')
  ) m
$$;

-- 옛 주차 → 새 주차로 옮기기(기록은 겹치면 병합). 새 주차 행이 없으면 옛 행을 복사해 만든다.
create or replace function okr_move_week(old_id text, new_id text, y int, m int, w int, s date, e date, keep_old boolean default false) returns void language plpgsql as $$
begin
  insert into okr_cycles (id, kind, title, year, month, week_no, start_date, end_date, parent_id, goals, feedback, updated_at, updated_by)
  select new_id, 'week', format('CS팀 %s월 %s주차 OKR 실행결과', m, w), y, m, w, s, e, format('%s-%s', y, lpad(m::text, 2, '0')), goals, feedback, now(), updated_by
  from okr_cycles where id = old_id and not exists (select 1 from okr_cycles where id = new_id);
  -- 같은 사람 행이 양쪽에 있으면 새 쪽에 합치고 옛 행은 지운다
  update okr_reports d set rows = okr_merge_rows(d.rows, o.rows), updated_at = now()
  from okr_reports o where o.cycle_id = old_id and d.cycle_id = new_id and d.team = o.team and d.member = o.member;
  delete from okr_reports o using okr_reports d where o.cycle_id = old_id and d.cycle_id = new_id and d.team = o.team and d.member = o.member;
  -- 나머지는 그대로 옮긴다
  update okr_reports set cycle_id = new_id where cycle_id = old_id;
  if not keep_old then delete from okr_cycles where id = old_id; end if;
end $$;

-- 11월 달 행(11월 5주차의 부모) — 없으면 10월 목표를 복사해 만든다
insert into okr_cycles (id, kind, title, year, month, week_no, start_date, end_date, parent_id, goals, feedback, updated_at, updated_by)
select '2026-11', 'month', 'CS팀 11월 OKR 실행결과', 2026, 11, null, '2026-11-01', '2026-11-30', null, goals, '{}'::jsonb, now(), 'migration'
from okr_cycles where id = '2026-10' and not exists (select 1 from okr_cycles where id = '2026-11');

select okr_move_week('2026-09-W1', '2026-08-W5', 2026, 8, 5, '2026-08-31', '2026-09-04');
select okr_move_week('2026-09-W2', '2026-09-W1', 2026, 9, 1, '2026-09-07', '2026-09-11');
select okr_move_week('2026-09-W5', '2026-09-W4', 2026, 9, 4, '2026-09-28', '2026-10-02');
select okr_move_week('2026-12-W1', '2026-11-W5', 2026, 11, 5, '2026-11-30', '2026-12-04');
-- 10/1 오전에 옛 셈법으로 적힌 이번 주 결과 → 9월 4주차로 합치기(10-W1 행은 남긴다)
select okr_move_week('2026-10-W1', '2026-09-W4', 2026, 9, 4, '2026-09-28', '2026-10-02', true);
update okr_cycles set start_date = '2026-10-05', end_date = '2026-10-09' where id = '2026-10-W1';

drop function okr_move_week(text, text, int, int, int, date, date, boolean);
drop function okr_merge_rows(jsonb, jsonb);

commit;

-- 확인: 주차 행과 기록 수
select c.id, c.week_no, c.start_date, c.end_date, (select count(*) from okr_reports r where r.cycle_id = c.id) as reports
from okr_cycles c where c.kind = 'week' order by c.id;
