-- ============================================================================
-- 카톡 수집 방 표: kakao_collect_rooms + 봇 대화명 설정 (2026-10-24 · 데이터실 표다빈)
-- 설계: docs/tasks/kakao-collect-expand.md 3-1·부록 A. SQL Editor 에서 1회 실행.
--
-- 왜: 카톡 수집(노트북 매크로 → 드라이브 → GAS/엣지)이 "어느 방을 무엇으로 처리하나"를 세 곳이 따로 안다.
--     · GAS _room_map 시트 = 방 이름이 키라 방 1개에 분류 1개뿐 → E 겸용 방(점검+AS, 재계약+초과조정)을 못 적는다.
--     · 매크로 export_rooms.py 는 발송용 room_map 전체(마감·부품·자가 포함)를 저장 → GAS 에서 "확인필요"로 빠진다.
--     · 발송용 room_map 에 물류 행을 더하면 발송 경로(api.ts FIXED_ROOM 보다 우선)가 그 행을 먼저 집는다.
--     → 수집 전용 새 표 하나로 모은다. room_map·_room_map 은 건드리지 않는다(AGENTS 규칙 2).
-- 무엇:
--   1) 새 표 public.kakao_collect_rooms — 방 1개 = 1행, kinds text[] 로 겸용 방 표현.
--   2) 시드 24행 = 수집 21 + 수집 안 함 3(부록 A + 사용자 답 2026-10-24). 이미 있는 방은 건드리지 않는다(on conflict do nothing).
--   3) app_config.KAKAO_BOT_NICKS = 'Ai법인폰' (없을 때만 넣음) — 봇이 올린 FIELD 양식 글을 구조 적재에서 거르는 기준.
--   4) 권한: anon·authenticated 는 SELECT 만. 쓰기는 service role(엣지·SQL Editor)만. DELETE 없음.
--
-- 라이브 실측(MCP 읽기, 2026-10-24) — 파일 값이 아니라 DB 에서 본 값:
--   · kakao_collect_rooms 없음(이 파일이 처음 만든다). public 의 kakao_* 표는 kakao_delivery_log 하나.
--   · room_map 26행. E: ('AS','E')·('점검','E') = "충청외E 극지방 as", ('재계약','E')·('초과조정','E') = "충청외극지방 E/초과사용 계약종료체크".
--     물류 행 없음. 불만 A·B = "신)AB불만고객", CD = "신)CD불만고객방". 마감 C·부품 *·자가 * 각 1행.
--   · app_config 열 = key(pk) · value. KAKAO_BOT_NICKS 없음. app_config 에 트리거 없음(app_config_log·lock SQL 은 아직 미실행).
--
-- 사용자 답(2026-10-24): 물류 방 = "완료방(납품,철수,교체)" 하나(enabled=true) · E 불만·E 미수 방은 대기(시드 안 넣음)
--   · 봇 대화명 = "Ai법인폰" · 수집 = 점검·AS·물류·불만·미수·재계약(+초과조정, E방 포함).
-- 마감·부품·자가 방: 행은 두되 enabled·export·structured·keep_raw 모두 false(관리 카드에서 회색 = "수집 안 함" 표시용).
--
-- 재실행 안전: create ... if not exists / insert ... on conflict do nothing / drop policy if exists. begin/commit 한 묶음.
-- 되돌리기: 맨 아래 주석.
-- ============================================================================

begin;

-- 1) 표 ----------------------------------------------------------------------
create table if not exists public.kakao_collect_rooms (
  room        text primary key,                       -- 카톡 방 제목 그대로(내보내기 파일 첫 줄 "○○ 님과 카카오톡 대화"의 ○○)
  kinds       text[] not null,                        -- 처리 종류. 겸용 방은 여러 개({점검,AS})
  region      text,                                   -- A~E · AB · CD · *(전 지역). 모르면 null
  enabled     boolean not null default true,          -- false = 이 방 전체 끄기(GAS 는 "확인필요"로)
  export      boolean not null default true,          -- 노트북 매크로(export_rooms.py) 저장 대상
  structured  boolean not null default true,          -- GAS 양식 파서·AI 로 FIELD 표에 적재
  keep_raw    boolean not null default true,          -- 원문 보관(kakao_messages, 엣지 kakao-ingest)
  sort_order  integer not null default 100,           -- 관리 카드 줄 순서(작을수록 위)
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  constraint kakao_collect_rooms_room_chk  check (btrim(room) <> '' and room = btrim(room)),
  constraint kakao_collect_rooms_kinds_chk check (
    cardinality(kinds) >= 1
    and kinds <@ array['점검','AS','물류','불만','미수','재계약','초과조정','마감','부품','자가']::text[]
  )
);
comment on table public.kakao_collect_rooms is
  '카톡 수집 대상 방(방 1개=1행, kinds 로 겸용). 읽는 곳: GAS getRoomMap·export_rooms.py load_rooms·엣지 kakao-ingest. 발송용 room_map 과 별개. 2026-10-24 supabase/kakao-collect-rooms-20261024.sql';
comment on column public.kakao_collect_rooms.kinds is
  '점검·AS·물류·불만·미수·재계약·초과조정(+수집 안 하는 마감·부품·자가). 초과조정은 재계약 방에서 GAS 가 자동 캡처하는 것을 표시만 한다 — 별도 패스를 또 돌리지 말 것';

-- 인덱스: 행이 수십 개라 pk 외에 두지 않는다.

-- 2) updated_at 자동 갱신(service role 이 고칠 때) ---------------------------------
create or replace function public.kakao_collect_rooms_touch() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;
revoke all on function public.kakao_collect_rooms_touch() from public, anon, authenticated;

drop trigger if exists kakao_collect_rooms_touch on public.kakao_collect_rooms;
create trigger kakao_collect_rooms_touch before update on public.kakao_collect_rooms
for each row execute function public.kakao_collect_rooms_touch();

-- 3) 시드 24행 -----------------------------------------------------------------
--   출처: GAS _room_map(18방: 코드 시드 15 + 운영 중 추가 AB불만·강북A 미수·경기D 미수) + room_map E 2방 + 물류 1방.
--   방 이름은 라이브 room_map 의 room 값과 글자 그대로 같다(복사). 이미 있는 방은 건드리지 않는다.
insert into public.kakao_collect_rooms (room, kinds, region, enabled, export, structured, keep_raw, sort_order, note) values
  -- 점검
  ('강북A 점검방',                        array['점검'],              'A',  true,  true,  true,  true,  10, null),
  ('강서B 점검방',                        array['점검'],              'B',  true,  true,  true,  true,  11, null),
  ('강남C 점검방',                        array['점검'],              'C',  true,  true,  true,  true,  12, null),
  ('경기D 점검방',                        array['점검'],              'D',  true,  true,  true,  true,  13, null),
  -- AS
  ('강북A as',                            array['AS'],                'A',  true,  true,  true,  true,  20, null),
  ('강서B as',                            array['AS'],                'B',  true,  true,  true,  true,  21, null),
  ('강남C as',                            array['AS'],                'C',  true,  true,  true,  true,  22, null),
  ('경기D as',                            array['AS'],                'D',  true,  true,  true,  true,  23, null),
  ('충청외E 극지방 as',                   array['점검','AS'],         'E',  true,  true,  true,  true,  24, 'E 겸용 — 같은 글이 점검·AS 파서를 각각 지난다(구분으로 거름)'),
  -- 물류
  ('완료방(납품,철수,교체)',              array['물류'],              '*',  true,  true,  true,  true,  30, '사용자 확인 2026-10-24. 발송은 api.ts FIXED_ROOM.logistics(이 표와 무관)'),
  -- 불만
  ('신)AB불만고객',                       array['불만'],              'AB', true,  true,  true,  true,  40, null),
  ('신)CD불만고객방',                     array['불만'],              'CD', true,  true,  true,  true,  41, null),
  -- 미수
  ('강북A 미수 보증금미입금 보고방',      array['미수'],              'A',  true,  true,  true,  true,  50, null),
  ('강서B 미수 보증금미입금 보고방',      array['미수'],              'B',  true,  true,  true,  true,  51, null),
  ('강남C 미수 보증금 보고방',            array['미수'],              'C',  true,  true,  true,  true,  52, null),
  ('경기D 미수 보증금 미입금보고방',      array['미수'],              'D',  true,  true,  true,  true,  53, null),
  -- 재계약(+초과조정 자동 캡처)
  ('강북A/초과사용 계약종료체크',         array['재계약','초과조정'], 'A',  true,  true,  true,  true,  60, null),
  ('강서B/초과사용 계약종료체크',         array['재계약','초과조정'], 'B',  true,  true,  true,  true,  61, null),
  ('강남C/초과사용 계약종료체크',         array['재계약','초과조정'], 'C',  true,  true,  true,  true,  62, null),
  ('경기D/초과사용 계약종료체크',         array['재계약','초과조정'], 'D',  true,  true,  true,  true,  63, null),
  ('충청외극지방 E/초과사용 계약종료체크', array['재계약','초과조정'], 'E',  true,  true,  true,  true,  64, 'E 겸용(room_map 재계약/E·초과조정/E)'),
  -- 수집 안 함(관리 카드 회색 표시용) — 매크로 저장 대상에서 빠진다
  ('강남,지방(수도권C,D,E)일반마감방',    array['마감'],              'C',  false, false, false, false, 90, '수집 안 함(마감 문자는 counter_sms_inbox 경로)'),
  ('부품요청',                            array['부품'],              '*',  false, false, false, false, 91, '수집 안 함'),
  ('자가(토너 폐통) 여분토너요청방',      array['자가'],              '*',  false, false, false, false, 92, '수집 안 함')
on conflict (room) do nothing;
-- (E 불만·E 미수 방: 사용자 대기 — 이름을 받으면 관리 탭 또는 아래 한 줄로 추가)
--   insert into public.kakao_collect_rooms (room, kinds, region) values ('<방 이름>', array['불만'], 'E') on conflict (room) do nothing;

-- 4) 봇 대화명 — 없을 때만 넣는다(관리 탭에서 바꾼 값을 재실행이 되돌리지 않게) ------------------
insert into public.app_config (key, value) values ('KAKAO_BOT_NICKS', 'Ai법인폰')
on conflict (key) do nothing;

-- 5) 권한 (2026-10-19 이후 새 표에 anon 기본 권한 없음) — 읽기만 ---------------------
revoke all on public.kakao_collect_rooms from anon, authenticated;
grant select on public.kakao_collect_rooms to anon, authenticated;

-- 6) RLS ---------------------------------------------------------------------
alter table public.kakao_collect_rooms enable row level security;

drop policy if exists "kakao_collect_rooms read" on public.kakao_collect_rooms;
create policy "kakao_collect_rooms read" on public.kakao_collect_rooms
  for select to anon, authenticated using (true);

commit;

-- ============================================================================
-- 확인(실행 뒤):
--   select room, kinds, region, enabled, export from public.kakao_collect_rooms order by sort_order;   -- 24행
--   select count(*) filter (where enabled and export) from public.kakao_collect_rooms;                -- 21(매크로 대상)
--   select value from public.app_config where key = 'KAKAO_BOT_NICKS';                                 -- Ai법인폰
--   -- 발송 매핑과 이름이 같은지(물류 제외 0행이어야 정상):
--   select c.room from public.kakao_collect_rooms c where c.enabled and not exists
--     (select 1 from public.room_map m where m.room = c.room) and not ('물류' = any(c.kinds));
--
-- [결정 대기] 관리 탭에서 방 추가·토글을 하려면 쓰기 길이 필요하다. 이 파일은 지시대로 anon SELECT 만 준다.
--   (가) 관리 탭 편집도 엣지(gas-admin 같은 service role)로 → 이 파일 그대로.
--   (나) room_map 과 같은 방식(anon insert·update, delete 없음)으로 연다 → 아래 블록을 따로 1회 실행:
--     grant insert, update on public.kakao_collect_rooms to anon, authenticated;
--     drop policy if exists "kakao_collect_rooms insert" on public.kakao_collect_rooms;
--     create policy "kakao_collect_rooms insert" on public.kakao_collect_rooms for insert to anon, authenticated with check (true);
--     drop policy if exists "kakao_collect_rooms update" on public.kakao_collect_rooms;
--     create policy "kakao_collect_rooms update" on public.kakao_collect_rooms for update to anon, authenticated using (true) with check (true);
--
-- 되돌리기(SQL Editor, 순서대로) — room_map·_room_map 시트는 처음부터 건드리지 않았으므로 그대로다:
--   begin;
--   drop table if exists public.kakao_collect_rooms;                 -- 트리거·정책은 표와 같이 지워진다
--   drop function if exists public.kakao_collect_rooms_touch();
--   delete from public.app_config where key = 'KAKAO_BOT_NICKS' and value = 'Ai법인폰';   -- 시드 값 그대로일 때만
--   commit;
--
-- 프런트(src/supabase.ts 래퍼만):
--   const rooms = await selectRows<CollectRoom>("kakao_collect_rooms", "select=room,kinds,region,enabled,export,structured,keep_raw,note&order=sort_order.asc,room.asc");
--   const logi  = await selectRows<CollectRoom>("kakao_collect_rooms", `select=room&enabled=is.true&kinds=cs.${encodeURIComponent("{물류}")}`);
--   const nicks = await selectRows<{ value: string }>("app_config", "select=value&key=eq.KAKAO_BOT_NICKS");   // 쉼표 목록
-- ============================================================================
