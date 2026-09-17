-- E지역(지방·충청외) 활성화 (2026-09-17)
--
-- 앱 코드는 같은 날 E를 전 화면(워킨맵·자동일정·조회·현황·양식 지역 선택 등)에 넣었다.
-- DB 쪽은 두 가지가 막고 있었다:
--   ① workin_map_places.team 체크 제약이 A~D만 허용 → E 워킨맵 저장이 실패한다
--   ② room_map에 E 방이 AS|E 하나뿐 → 점검 양식·재계약/초과 양식·월요 키맨 브리핑이 E로 못 나간다
-- as_tickets는 이미 E·기타 팀 행이 들어가 있어(제약 없음) 건드리지 않는다.
-- 봇(메신저봇)이 아래 방들의 멤버여야 실제로 게시된다.

-- ① 워킨맵 팀 제약 확장
alter table public.workin_map_places drop constraint if exists workin_map_places_team_check;
alter table public.workin_map_places add constraint workin_map_places_team_check check (team in ('A', 'B', 'C', 'D', 'E'));

-- ② E 카톡방 매핑 (있으면 건너뜀 — 관리 탭에서 바꾼 값을 덮지 않는다)
insert into public.room_map (category, region, room)
select v.category, v.region, v.room
from (values
  ('점검',     'E', '충청외E 극지방 as'),                    -- 점검 양식 + 월요 키맨·주소 브리핑 (E는 AS방과 같은 방을 쓴다)
  ('재계약',   'E', '충청외극지방 E/초과사용 계약종료체크'),   -- 재계약 양식
  ('초과조정', 'E', '충청외극지방 E/초과사용 계약종료체크')    -- 초과사용 조정 양식
) as v(category, region, room)
where not exists (
  select 1 from public.room_map r where r.category = v.category and r.region = v.region
);

-- 미수|E · 불만|E 는 방 이름이 확인되면 같은 방식으로 추가:
-- insert into public.room_map (category, region, room) values ('미수', 'E', '<방 이름>'), ('불만', 'E', '<방 이름>');

-- 확인
select category, region, room from public.room_map where region = 'E' order by category;
