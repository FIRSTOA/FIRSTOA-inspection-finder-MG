-- ============================================================================
-- 워킨맵(workinmap.com) ↔ FIELD 양방향 동기화 — 표·칸·트리거·크론 한 장 (2026-10-31 · 데이터실 표다빈)
-- 설계: docs/tasks/workinmap-sync-2026-10-31.md **v2 절**(v2-3 데이터 설계) + 아래 "사용자 결정(2026-10-31 밤)".
-- SQL Editor 에서 통째로 1회 실행. 두 번 실행해도 안전
--   (add column if not exists · create ... if not exists · drop policy/trigger if exists · app_config 없을 때만 · 같은 이름 cron 덮어씀).
-- **순서: 이 SQL → 엣지 workinmap-sync 배포 → secrets(WORKINMAP_1_*·WORKINMAP_2_*) → 관리 탭 dry → 스위치.**
--   크론 3개는 만들어지지만 스위치(WORKINMAP_SYNC_ENABLED / WORKINMAP_PUSH_ENABLED)가 false 인 동안은
--   HTTP 호출 자체를 하지 않는다(명령 안 where 조건). 그래서 엣지보다 먼저 실행해도 404 가 쌓이지 않는다.
--
-- 사용자 결정(2026-10-31 밤, 설계 v2 뒤 추가 — 표에 준 영향):
--   ① 가져오기 "싹 다": 워킨맵이 장소 정체(이름·주소·전화·좌표·코멘트)의 원본. 새 장소 자동 추가, 사라진 장소는 지우지 않고
--      ext_missing_at 로 표시. 이름·주소 변경도 반영하되 **바꾸기 전 값은 workin_sync_log 에 남긴다**(복구 쿼리 맨 아래).
--      → v2 B5 "기존 행 이름·주소는 확인 큐로만" 을 대체. log 는 append-only(누구도 update·delete 못 함).
--   ② 되밀기(P2)는 색·숨김 + 메모 **추가만**(합집합). 메모는 memos jsonb 배열의 원소 1개 = 항목 1개로 다룬다.
--      outbox 에는 새 항목 1개 = 1행(item_key = md5(공백 정리한 항목))으로 쌓여 항목 단위로 비교·중복 차단된다.
--   ③ 주기(사용자 최종 2026-10-31 밤): 이번 분기 워크 **하루 4회 KST 09·12·15·18시** · 지난 분기 워크 하루 1회 · 되밀기 큐 1분(큐가 있을 때만).
--      (처음 설계 3분 → 사용자 "양방향이 확실하면 9·12·3·6시만으로 충분" — 워킨맵 서버 호출 수도 1/60 로 줄어 차단 위험 낮음. 관리 탭 [지금 동기화]로 수동 가능)
--   ④ 테스트 워크 "26.10.31 동기화 테스트"(이름 규칙 밖) → app_config.WORKINMAP_TEST_WORK 로 지정, 팀 'T' 로 매핑.
--      → workin_map_places.team check 에 'T' 를 더한다(**기존 표에서 열 추가 외에 바꾸는 유일한 곳**. 넓히기만 함, 기존 7,895행 영향 없음).
--   ⑤ 계정 2개(secrets WORKINMAP_1_EMAIL/PASSWORD · WORKINMAP_2_EMAIL/PASSWORD — 사용자가 대시보드에 직접), 라벨은 app_config.
--
-- 무엇:
--   1) workin_map_places 열 7개 추가(전부 nullable): ext_id · ext_work_id · ext_account_no · ext_year · ext_last_update ·
--      ext_synced_at · ext_missing_at.  updated_by 는 이미 있음(text not null default '') → 건너뜀.
--      인덱스: ext_id 부분 unique(where not null) · ext_work_id 부분(사라진 장소 찾기).
--   2) 새 표 6개
--      workin_sync_accounts  계정별 토큰 캐시 — RLS 켜고 정책 없음, anon·authenticated 권한 0, service_role 만.
--      workin_sync_works     계정·워크 매핑(해석 결과·상태·장소 수·마지막 가져오기) — anon select + override_skip 만 update.
--      workin_sync_outbox    되밀기 큐(place·field·value·시각·상태·시도·오류) — anon select. 넣기는 트리거(security definer)만.
--      workin_sync_log       장소별 변경 로그(방향·필드·before·after·시각·누가) — anon select. 쓰기는 service_role insert 만(append-only).
--      workin_sync_review    확인 큐(짝 못 찾음·후보 2개+·완료 내려감 등) — anon select + 처리 칸 3개만 update(미처리 행만).
--      workin_sync_lease     실행 겹침 방지 임대(pull 이 길어져 수동 실행·push 와 겹칠 때) — service_role 만, 함수 2개로 사용.
--   3) 트리거 workin_sync_enqueue — workin_map_places AFTER UPDATE(label·visible·memos 실제 변경 + ext_id 있음)
--      → WORKINMAP_PUSH_ENABLED='true' 일 때만 outbox 에 넣는다(꺼져 있으면 큐가 쌓이지 않음).
--      동기화 자신이 쓴 변경은 건너뜀(핑퐁 방지 — 판정은 아래 [핑퐁 판정]). 트리거 오류는 경고만 남기고 앱 저장은 절대 막지 않는다.
--   4) app_config 기본값 8키(없을 때만).
--   5) pg_cron 3개 — ops.call_edge('workinmap-sync', ...) . 키는 ops.call_edge 가 vault 'field_cron_jwt' 에서(SQL 에 키 없음).
--      workinmap-sync-pull     '0 0,3,6,9 * * *'        = KST 09·12·15·18시       {action:"pull"}               150초
--      workinmap-sync-pull-old '10 21 * * *'           = KST 06:10 하루 1회        {action:"pull",scope:"old"}   300초
--      workinmap-sync-push     '* * * * *'             = 매분(밤 포함)             {action:"push"}               55초
--        pull 2개는 WORKINMAP_SYNC_ENABLED='true' 일 때만, push 는 WORKINMAP_PUSH_ENABLED='true' 이고 보낼 행(pending·next_at 지남)이
--        있을 때만 HTTP 를 쏜다. (P2 전엔 push 스위치 꺼짐 → 호출 0.)
--
-- [핑퐁 판정] 트리거가 "동기화가 쓴 변경"으로 보고 건너뛰는 경우(둘 중 하나):
--   (a) 요청 헤더 x-workin-sync: 1  (엣지가 PostgREST 호출마다 붙인다 — 가장 확실)
--   (b) NEW.updated_by = '워킨맵 동기화' 이고 호출 역할이 anon/authenticated 가 아님(service_role·SQL Editor)
--   왜 updated_by 하나로만 판정하지 않나: 앱의 일부 쓰기(src/ContactChangeHistory.tsx:136, src/ServiceReception.tsx:1395 —
--   주소·전화·memos PATCH)는 updated_by 를 보내지 않는다. 동기화가 한 번 쓴 행은 updated_by='워킨맵 동기화' 가 남아 있으므로,
--   updated_by 만 보면 그 뒤 사람이 바꾼 메모가 영영 되밀리지 않는다. (b) 는 anon 역할이면 동기화로 보지 않아 이 구멍을 막는다.
--
-- 라이브 실측(MCP 읽기, 2026-10-31 밤 — "DB 에서 본 값"):
--   · public.workin_map_places 7,895행. 열 17개: id bigint pk · number int · team text · quarter smallint · kind text · label text(def 'G12') ·
--     visible bool · name · comment · phone · address · address_detail · latitude · longitude · memos jsonb(def '[]') ·
--     updated_by text not null default '' · updated_at timestamptz. ext_* 열 없음.
--   · 제약: team_check (A,B,C,D,E) · kind_check (quarter,monthly,renewal) · quarter_check 1~4 · pkey(id). 인덱스: pkey · workin_map_scope_idx(team,quarter,kind).
--   · RLS 켜짐, 정책 1개 "workin_map_places anon all"(ALL to anon using true check true). anon·authenticated·service_role 전부 sel/ins/upd/del 있음.
--   · 트리거 1개 workin_map_places_updated_at BEFORE INSERT OR UPDATE → set_workin_updated_at()(updated_at := now()). 이 파일의 AFTER 트리거와 충돌 없음.
--   · memos: 전 행 jsonb 배열, 원소는 전부 문자열(비문자 0), 최대 18항목. updated_by='워킨맵 동기화' 인 행 0.
--   · 지금 있는 (team:kind): A·B·C·D 각 monthly/quarter/renewal, E quarter/renewal. 'T' 없음.
--   · ops.call_edge(text, jsonb, integer, text) 있음(security definer). vault field_cron_jwt 1개(2026-10-24 03:38 UTC 생성).
--     같은 방식 크론 16개(schedule-report-12/14 포함). cron 에 workin% 없음. 엣지 workinmap-sync 아직 없음(목록 27개에 없음).
--   · public.workin_sync_* 표 없음. app_config 에 WORKIN% 키 없음. app_config(key text pk, value text), 트리거 app_config_audit·app_config_guard
--     (guard 는 anon/authenticated 가 app_config_lock 키를 바꿀 때만 막음 — lock 0행. SQL Editor insert 는 로그만 남음).
--   · pg_default_acl(public, 소유 postgres): 표 = postgres·service_role 전권, **anon·authenticated 없음** → 아래 명시 grant.
--     시퀀스 = anon·authenticated·service_role rwU. **함수 = anon·authenticated EXECUTE 자동** → 새 함수는 아래에서 revoke.
--   · DB TimeZone = UTC, Postgres 17.6.
-- 파일에 적힌 값과 다른 점:
--   · 설계 v2-3 은 파일명을 supabase/workin-sync.sql, 트리거를 P2 별도 SQL 로 적었다 → 지시(2026-10-31 밤)대로 한 장에 트리거까지.
--     대신 트리거는 PUSH 스위치가 false 면 아무것도 넣지 않으므로 P1 동안 큐가 쌓이지 않는다(설계의 "P1 동안 큐 0" 목적은 그대로).
--   · 설계 v2-B1 의 주기(10분+밤 1시간)는 사용자 결정 ③(하루 4회 09·12·15·18 · 하루 1회 · 1분)으로 바뀜.
--   · 지시서 열 이름 "ext_account" → 설계 본문(B2·C2)과 맞춰 **ext_account_no**, ext_year 는 설계대로 smallint.
--
-- 바꾸지 않는 것: workin_map_places 의 기존 열·정책·트리거·인덱스(열 추가와 team check 'T' 넓히기만), app 코드, 다른 크론·표.
-- 되돌리기: 맨 아래 주석.
-- ============================================================================

begin;

-- 0) 가드 — 크론이 기댈 도우미가 없으면 아무것도 만들지 않고 중단 ------------------------
do $$
begin
  if to_regprocedure('ops.call_edge(text, jsonb, integer, text)') is null then
    raise exception 'ops.call_edge 가 없습니다 — supabase/hardening-cron-vault-20261024.sql 먼저 실행';
  end if;
  if not exists (select 1 from vault.secrets where name = 'field_cron_jwt') then
    raise exception 'vault field_cron_jwt 가 없습니다 — supabase/hardening-cron-vault-20261024.sql 먼저 실행';
  end if;
  if to_regclass('public.workin_map_places') is null then
    raise exception 'public.workin_map_places 가 없습니다 — supabase/workin-map-shared.sql 먼저';
  end if;
end $$;

-- 1) workin_map_places — 열 추가만(전부 nullable, 기존 행은 null 로 남음) ---------------------
alter table public.workin_map_places add column if not exists ext_id          text;         -- 워킨맵 장소 _id
alter table public.workin_map_places add column if not exists ext_work_id     text;         -- 워킨맵 워크 _id
alter table public.workin_map_places add column if not exists ext_account_no  smallint;     -- 계정 번호(1=C·D, 2=A·B) — 되밀 때 이 계정 토큰
alter table public.workin_map_places add column if not exists ext_year        smallint;     -- 워크 이름에서 읽은 연도(앱에는 quarter 만 있음)
alter table public.workin_map_places add column if not exists ext_last_update timestamptz;  -- 마지막으로 맞춘 때의 워킨맵 last_update
alter table public.workin_map_places add column if not exists ext_synced_at   timestamptz;  -- 마지막으로 양쪽이 같다고 확인한 시각
alter table public.workin_map_places add column if not exists ext_missing_at  timestamptz;  -- 워킨맵에서 사라진 것을 처음 본 시각(지우지 않음)
-- updated_by 는 이미 있음(라이브 실측) — 추가하지 않는다.

comment on column public.workin_map_places.ext_id is '워킨맵 장소 _id(동기화 짝). 부분 unique. 2026-10-31 workin-sync-20261031.sql';
comment on column public.workin_map_places.ext_missing_at is '워킨맵에서 사라진 것을 처음 본 시각. 행은 지우지 않는다(사용자 결정 2026-10-31).';

-- team check 에 'T'(동기화 테스트 워크) 더하기 — 이미 'T' 가 있으면 건너뜀(재실행 안전) --------------
do $$
declare d text;
begin
  select pg_get_constraintdef(oid) into d
    from pg_constraint
   where conrelid = 'public.workin_map_places'::regclass and conname = 'workin_map_places_team_check';
  if d is null or position('''T''' in d) = 0 then
    alter table public.workin_map_places drop constraint if exists workin_map_places_team_check;
    alter table public.workin_map_places add constraint workin_map_places_team_check
      check (team in ('A', 'B', 'C', 'D', 'E', 'T'));               -- 넓히기만: 기존 행 전부 통과
  end if;
end $$;

create unique index if not exists workin_map_places_ext_id_uq
  on public.workin_map_places (ext_id) where ext_id is not null;      -- 짝짓기 1순위·같은 장소 이중 연결 차단
create index if not exists workin_map_places_ext_work_idx
  on public.workin_map_places (ext_work_id) where ext_work_id is not null;   -- 워크 단위 "사라진 장소" 비교

-- 2) 새 표 ----------------------------------------------------------------------

-- 2-1) 계정 토큰 캐시 — 비밀값. 화면은 엣지 {action:"status"} 로만(토큰 칸 뺀 응답).
create table if not exists public.workin_sync_accounts (
  account_no     smallint primary key check (account_no between 1 and 9),   -- secrets WORKINMAP_<n>_EMAIL 의 n
  label          text not null default '',                 -- 표시용(app_config.WORKINMAP_ACCOUNT_LABELS 복사)
  id_token       text,                                     -- Firebase ID 토큰(1시간)
  refresh_token  text,
  expires_at     timestamptz,
  fail_count     integer not null default 0 check (fail_count >= 0),   -- 비밀번호 로그인 연속 실패
  paused         boolean not null default false,           -- 3회 실패 → true, 관리 탭 [다시 시도]가 엣지로 해제
  last_login_at  timestamptz,
  last_ok_at     timestamptz,
  last_error     text not null default '' check (char_length(last_error) <= 500),   -- 이메일·토큰 넣지 말 것
  updated_at     timestamptz not null default now()
);
comment on table public.workin_sync_accounts is
  '워킨맵 계정별 토큰 캐시(비밀). RLS 켜고 정책 없음, anon·authenticated 권한 0 — 엣지 workinmap-sync(service role)만. 2026-10-31 workin-sync-20261031.sql';

-- 2-2) 워크 매핑
create table if not exists public.workin_sync_works (
  account_no          smallint not null check (account_no between 1 and 9),
  work_id             text not null,                       -- 워킨맵 워크 _id
  name                text not null default '',
  team                text check (team in ('A', 'B', 'C', 'D', 'E', 'T')),   -- 해석 결과(T = WORKINMAP_TEST_WORK)
  year                smallint,
  quarter             smallint check (quarter between 1 and 4),
  kind                text check (kind in ('quarter', 'monthly', 'renewal')),
  status              text not null default 'unparsed'
                        check (status in ('target', 'excluded', 'unparsed', 'duplicate')),   -- duplicate = 다른 계정에 이미 붙은 공유 워크
  place_count         integer not null default 0 check (place_count >= 0),   -- 워크 목록이 알려 준 장소 수(950↑ 노란 표시)
  override_skip       boolean not null default false,      -- 사람이 이 워크만 끄기(유일한 손 편집 칸)
  override_by         text not null default '' check (char_length(override_by) <= 40),
  first_pulled_at     timestamptz,                         -- null = 아직 첫 회차 전(첫 회차엔 새 장소 자동 추가 안 함, v2 B3)
  last_pulled_at      timestamptz,
  last_work_modified  timestamptz,                         -- 워크 목록의 수정일(지난 분기 워크 재GET 판단)
  last_error          text not null default '' check (char_length(last_error) <= 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (account_no, work_id)
);
comment on table public.workin_sync_works is
  '워킨맵 워크 ↔ 앱 범위(team·year·quarter·kind) 해석 결과. 엣지가 upsert(on_conflict=account_no,work_id). anon 은 읽기 + override_skip/override_by 만. 2026-10-31';

create index if not exists workin_sync_works_scope_idx
  on public.workin_sync_works (team, year, quarter, kind) where status = 'target';

-- 2-3) 되밀기 큐
create table if not exists public.workin_sync_outbox (
  id          bigint generated always as identity primary key,
  place_id    bigint not null,                             -- workin_map_places.id (FK 없음 — 앱이 행을 지워도 큐 기록은 남김)
  ext_id      text not null,
  account_no  smallint,                                    -- 보낼 계정(ext_account_no 복사)
  work_id     text,
  kind        text,                                        -- quarter|monthly|renewal — 엣지가 WORKINMAP_PUSH_FIELDS 로 필드 한정
  field       text not null check (field in ('label', 'visible', 'memo')),
  value       jsonb not null,                              -- label "G5" · visible true/false · memo "새 항목 1개(원문)"
  item_key    text not null default '',                    -- memo: md5(공백 정리한 항목) — 항목 단위 비교·중복 차단. label/visible: ''
  actor       text not null default '',                    -- 앱에서 바꾼 사람(NEW.updated_by)
  created_at  timestamptz not null default now(),          -- 처음 큐에 들어온 시각
  changed_at  timestamptz not null default now(),          -- 같은 칸 합치기로 마지막 갱신된 시각 — 양보 판정(워킨맵 last_update 와 비교)은 이 값
  status      text not null default 'pending'
                check (status in ('pending', 'done', 'yielded', 'failed', 'skipped')),
  attempts    integer not null default 0 check (attempts >= 0),
  next_at     timestamptz not null default now(),          -- 재시도 백오프(10분·30분·2시간)
  last_error  text not null default '' check (char_length(last_error) <= 500),
  done_at     timestamptz
);
comment on table public.workin_sync_outbox is
  '앱→워킨맵 되밀기 큐. 넣기 = 트리거 workin_sync_enqueue(PUSH 스위치 켜졌을 때만), 처리 = 엣지 workinmap-sync {action:push}. memo 는 추가할 항목 1개 = 1행. 2026-10-31';

create unique index if not exists workin_sync_outbox_pending_field_uq
  on public.workin_sync_outbox (place_id, field) where status = 'pending' and field <> 'memo';   -- 같은 칸 대기 1행(G1→G3→G5 는 G5 한 번)
create unique index if not exists workin_sync_outbox_pending_memo_uq
  on public.workin_sync_outbox (place_id, item_key) where status = 'pending' and field = 'memo';  -- 같은 메모 항목 대기 1행
create index if not exists workin_sync_outbox_due_idx
  on public.workin_sync_outbox (next_at) where status = 'pending';                              -- 크론 "보낼 것 있나"·엣지 꺼내기
create index if not exists workin_sync_outbox_place_idx
  on public.workin_sync_outbox (place_id, created_at desc);

-- 2-4) 장소별 변경 로그(append-only — 복구용)
create table if not exists public.workin_sync_log (
  id            bigint generated always as identity primary key,
  place_id      bigint,                                    -- 새 장소 insert 도 id 를 정한 뒤 기록. FK 없음(로그는 행보다 오래 산다)
  ext_id        text,
  account_no    smallint,
  work_id       text,
  direction     text not null check (direction in ('pull', 'push', 'review', 'restore')),
                                                           -- pull=워킨맵→앱 · push=앱→워킨맵 · review=확인 큐 처리 · restore=로그로 되돌림
  field         text not null check (field in (
                  'label', 'visible', 'memo', 'name', 'comment', 'phone', 'address', 'address_detail',
                  'latitude', 'longitude', 'number',
                  '_insert', '_missing', '_unmissing', '_link', '_unlink')),
                                                           -- _insert 는 after_value 에 행 전체 · _link 는 ext_id 짝짓기
  before_value  jsonb,                                     -- 바꾸기 전 값(memo 추가는 null) — 복구 원본
  after_value   jsonb,                                     -- 바꾼 뒤 값(memo 는 추가한 항목 1개)
  actor         text not null default '워킨맵 동기화' check (char_length(actor) <= 40),
  note          text not null default '' check (char_length(note) <= 300),   -- 예: 'dry', 'yield', 오류 요약
  created_at    timestamptz not null default now()
);
comment on table public.workin_sync_log is
  '워킨맵 동기화가 바꾼 칸 1개 = 1행(before/after). 지우지 않는다(update·delete 권한 아무에게도 없음). 이름·주소 덮어쓰기 복구 원본. 2026-10-31';

create index if not exists workin_sync_log_place_idx on public.workin_sync_log (place_id, created_at desc);
create index if not exists workin_sync_log_time_idx  on public.workin_sync_log (created_at desc);

-- 2-5) 확인 큐
create table if not exists public.workin_sync_review (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in (
                 'unmatched',   -- 짝 못 찾음(후보 0)
                 'ambiguous',   -- 후보 2개 이상
                 'new',         -- 첫 회차라 자동 추가하지 않은 새 장소
                 'missing',     -- 워킨맵에서 사라짐
                 'downgrade',   -- 완료(G5/G12·매월 순위) 내려감 — 자동 반영 안 함
                 'conflict',    -- 양쪽 같은 칸 동시 변경
                 'field_diff',  -- (예비) 칸 차이 수동 확인
                 'loop',        -- 1시간 6회 넘는 왕복
                 'format')),    -- 응답 형식 이상(워크 단위)
  place_id     bigint,
  ext_id       text,
  account_no   smallint,
  work_id      text,
  field        text not null default '',                   -- conflict·downgrade·field_diff 의 칸 이름(같은 장소 다른 칸은 따로)
  detail       jsonb not null default '{}'::jsonb,         -- 후보 목록·전/후 값·워킨맵 장소 요약
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  text check (char_length(resolved_by) <= 40),
  resolution   text check (resolution in ('linked', 'added', 'hidden', 'kept', 'applied', 'ignored'))
);
comment on table public.workin_sync_review is
  '워킨맵 동기화 확인 큐. 엣지가 insert(23505 = 이미 열려 있음), 관리자 화면은 미처리 행의 resolved_at/resolved_by/resolution 만 바꾼다. 2026-10-31';

create unique index if not exists workin_sync_review_open_uq
  on public.workin_sync_review (kind, field, coalesce(work_id, ''), coalesce(ext_id, ''), coalesce(place_id, 0))
  where resolved_at is null;                                 -- 같은 건 미처리 1행(매 회차가 같은 줄을 또 만들지 않음)
create index if not exists workin_sync_review_open_idx
  on public.workin_sync_review (created_at desc) where resolved_at is null;   -- "확인 필요 n" 배지

-- 2-6) 실행 임대(겹침 방지) — pull 이 길어져 수동 실행·다음 회차와 겹치거나 push 와 같은 계정 토큰을 동시에 갱신하는 것을 막는다
create table if not exists public.workin_sync_lease (
  key         text primary key,                            -- 'pull' · 'pull-old' · 'push' · 'account-1' 등 엣지가 정함
  holder      text not null default '',                    -- 실행 id(엣지가 만든 uuid)
  until       timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.workin_sync_lease is '워킨맵 동기화 실행 임대. service_role 만, 함수 workin_sync_take_lease/workin_sync_release_lease 로. 2026-10-31';

-- 2-7) "있는 행만 갱신" RPC — 엣지가 200행 묶음 upsert(on_conflict=id)를 쓰면, 읽은 직후 앱에서 지운 행이
--      기본값(빈 이름·G12)으로 되살아난다. 이 함수는 update 만 한다(없는 id 는 건너뜀, insert 없음).
--   호출: rpc('workin_sync_update_places', { p_rows: [{id, ...바뀐 칸}] })  → 갱신된 행 수(integer)
--   규칙:
--   · 원소 JSON 에 **키가 있는 칸만** 바꾼다(p ? 'name'). 키가 없으면 그 칸은 그대로.
--   · JSON null 은 값으로 넣는다 — 단 nullable 칸(ext_* 7개)만 가능. NOT NULL 칸(name·comment·phone·address·address_detail·
--     latitude·longitude·label·visible·memos·updated_by·updated_at — 라이브 실측 전부 NOT NULL)에 null 을 주면 묶음 전체를 예외로 중단(부분 저장 없음).
--   · 허용 칸 밖의 키(오타 포함)·객체가 아닌 원소·숫자가 아닌 id 도 묶음 전체 예외. id 키 없는 원소는 건너뜀.
--   · memos: 라이브 열 타입이 **jsonb**(배열, text[] 아님)라 변환하지 않고 jsonb 배열 그대로 넣는다(배열이 아니면 예외).
--     (요청서의 "jsonb→text[] 변환"은 열이 text[] 일 때의 얘기 — 실측상 해당 없음)
--   · updated_at: 키를 줘도 BEFORE 트리거 set_workin_updated_at 이 now() 로 덮는다(기존 동작 유지 — 증분 폴링 updated_at=gt. 이 이 행을 잡도록).
--   · number(장소 번호)는 허용 칸에 없음(요청 목록 밖). 새 장소 insert 는 이 함수가 아니라 엣지의 insertRows(행 전체)로.
--   핑퐁 방지(트리거 workin_sync_enqueue 와의 관계) — 이 함수는 request.headers·request.jwt.claims 를 건드리지 않는다:
--   · PostgREST 는 요청마다 request.headers·request.jwt.claims 를 트랜잭션 GUC 로 넣는다. security definer 는 current_user 만
--     postgres 로 바꿀 뿐 GUC 는 그대로라, 이 함수 안의 update 가 부른 트리거도 호출자의 값을 그대로 본다.
--   · 그래서 엣지가 service role 키 + 헤더 `x-workin-sync: 1` 로 rpc 를 부르면 (a) 헤더로 건너뛰고, 헤더를 빠뜨려도
--     role=service_role 이므로 원소에 updated_by='워킨맵 동기화' 를 넣으면 (b) 로 건너뛴다. → **원소마다 updated_by 도 넣을 것.**
--   · SQL Editor(postgres, GUC 없음)에서 부르면 role 이 비어 있어 (b) 조건 "anon·authenticated 아님"에 해당 — updated_by 가 '워킨맵 동기화' 면 건너뜀.
create or replace function public.workin_sync_update_places(p_rows jsonb)
returns integer language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  p        jsonb;
  bad      text;
  n        integer;
  total    integer := 0;
  allowed  constant text[] := array[
    'id', 'name', 'comment', 'phone', 'address', 'address_detail', 'latitude', 'longitude',
    'label', 'visible', 'memos',
    'ext_id', 'ext_work_id', 'ext_account_no', 'ext_year', 'ext_last_update', 'ext_synced_at', 'ext_missing_at',
    'updated_by', 'updated_at'];
  notnull  constant text[] := array[
    'name', 'comment', 'phone', 'address', 'address_detail', 'latitude', 'longitude',
    'label', 'visible', 'memos', 'updated_by', 'updated_at'];
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'workin_sync_update_places: p_rows 는 JSON 배열이어야 합니다' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'workin_sync_update_places: 한 번에 1000행까지 (%행)', jsonb_array_length(p_rows) using errcode = '22023';
  end if;

  for p in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(p) <> 'object' then
      raise exception 'workin_sync_update_places: 원소가 객체가 아닙니다 (%)', left(p::text, 80) using errcode = '22023';
    end if;
    select string_agg(k, ',') into bad from jsonb_object_keys(p) as k where k <> all (allowed);
    if bad is not null then
      raise exception 'workin_sync_update_places: 허용하지 않는 칸 %', bad using errcode = '22023';
    end if;
    select string_agg(k, ',') into bad from jsonb_object_keys(p) as k where k = any (notnull) and jsonb_typeof(p -> k) = 'null';
    if bad is not null then
      raise exception 'workin_sync_update_places: NOT NULL 칸에 null (id %, 칸 %)', p ->> 'id', bad using errcode = '23502';
    end if;
    if p ? 'memos' and jsonb_typeof(p -> 'memos') <> 'array' then
      raise exception 'workin_sync_update_places: memos 는 배열이어야 합니다 (id %)', p ->> 'id' using errcode = '22023';
    end if;
    continue when not (p ? 'id') or jsonb_typeof(p -> 'id') = 'null';   -- id 없음 = 건너뜀(insert 금지)

    update public.workin_map_places w set
      name            = case when p ? 'name'            then p ->> 'name'                               else w.name end,
      comment         = case when p ? 'comment'         then p ->> 'comment'                            else w.comment end,
      phone           = case when p ? 'phone'           then p ->> 'phone'                              else w.phone end,
      address         = case when p ? 'address'         then p ->> 'address'                            else w.address end,
      address_detail  = case when p ? 'address_detail'  then p ->> 'address_detail'                     else w.address_detail end,
      latitude        = case when p ? 'latitude'        then (p ->> 'latitude')::double precision       else w.latitude end,
      longitude       = case when p ? 'longitude'       then (p ->> 'longitude')::double precision      else w.longitude end,
      label           = case when p ? 'label'           then p ->> 'label'                              else w.label end,
      visible         = case when p ? 'visible'         then (p ->> 'visible')::boolean                 else w.visible end,
      memos           = case when p ? 'memos'           then p -> 'memos'                               else w.memos end,
      ext_id          = case when p ? 'ext_id'          then p ->> 'ext_id'                             else w.ext_id end,
      ext_work_id     = case when p ? 'ext_work_id'     then p ->> 'ext_work_id'                        else w.ext_work_id end,
      ext_account_no  = case when p ? 'ext_account_no'  then (p ->> 'ext_account_no')::smallint         else w.ext_account_no end,
      ext_year        = case when p ? 'ext_year'        then (p ->> 'ext_year')::smallint               else w.ext_year end,
      ext_last_update = case when p ? 'ext_last_update' then (p ->> 'ext_last_update')::timestamptz     else w.ext_last_update end,
      ext_synced_at   = case when p ? 'ext_synced_at'   then (p ->> 'ext_synced_at')::timestamptz       else w.ext_synced_at end,
      ext_missing_at  = case when p ? 'ext_missing_at'  then (p ->> 'ext_missing_at')::timestamptz      else w.ext_missing_at end,
      updated_by      = case when p ? 'updated_by'      then p ->> 'updated_by'                         else w.updated_by end,
      updated_at      = case when p ? 'updated_at'      then (p ->> 'updated_at')::timestamptz          else w.updated_at end
    where w.id = (p ->> 'id')::bigint;
    get diagnostics n = row_count;
    total := total + n;                                    -- 없는 id 는 0 — 되살리지 않는다
  end loop;
  return total;
end $$;
revoke all on function public.workin_sync_update_places(jsonb) from public, anon, authenticated;
grant execute on function public.workin_sync_update_places(jsonb) to service_role;
comment on function public.workin_sync_update_places(jsonb) is
  '워킨맵 동기화 전용: 있는 행만 갱신(키 있는 칸만, insert 없음), 갱신 행 수 반환. service_role 만. 2026-10-31 workin-sync-20261031.sql';

-- 3) 권한 (2026-10-19 이후 새 표에 anon 기본 권한 없음 · service_role 은 기본 전권이라 먼저 걷고 필요한 것만) ----------
revoke all on public.workin_sync_accounts, public.workin_sync_works, public.workin_sync_outbox,
              public.workin_sync_log, public.workin_sync_review, public.workin_sync_lease
  from anon, authenticated, service_role;

-- 3-1) accounts: anon·authenticated 0, service_role 만(delete 없음)
grant select, insert, update on public.workin_sync_accounts to service_role;

-- 3-2) works: 화면 읽기 + 끄기 칸만
grant select on public.workin_sync_works to anon, authenticated;
grant update (override_skip, override_by) on public.workin_sync_works to anon, authenticated;
grant select, insert, update on public.workin_sync_works to service_role;

-- 3-3) outbox: 화면 읽기만. 넣기는 트리거(security definer, 소유자 postgres)
grant select on public.workin_sync_outbox to anon, authenticated;
grant select, update on public.workin_sync_outbox to service_role;       -- 엣지는 상태만 바꾼다(insert·delete 없음)

-- 3-4) log: 화면 읽기만. 엣지 insert 만. update·delete 아무에게도 없음
grant select on public.workin_sync_log to anon, authenticated;
grant select, insert on public.workin_sync_log to service_role;

-- 3-5) review: 화면 읽기 + 처리 칸 3개만
grant select on public.workin_sync_review to anon, authenticated;
grant update (resolved_at, resolved_by, resolution) on public.workin_sync_review to anon, authenticated;
grant select, insert, update on public.workin_sync_review to service_role;

-- 3-6) lease: service_role 만(함수 경유)
grant select, insert, update on public.workin_sync_lease to service_role;
--   identity 열(generated always) → anon 시퀀스 권한 불필요. (기본 ACL 이 시퀀스 rwU 를 주지만 insert 권한이 없어 쓸 데 없음)

-- 4) RLS ------------------------------------------------------------------------
alter table public.workin_sync_accounts enable row level security;   -- 정책 없음 = anon·authenticated 0행(권한도 0)
alter table public.workin_sync_works    enable row level security;
alter table public.workin_sync_outbox   enable row level security;
alter table public.workin_sync_log      enable row level security;
alter table public.workin_sync_review   enable row level security;
alter table public.workin_sync_lease    enable row level security;   -- 정책 없음(service_role 은 RLS 우회)

drop policy if exists "workin_sync_works read" on public.workin_sync_works;
create policy "workin_sync_works read" on public.workin_sync_works
  for select to anon, authenticated using (true);
drop policy if exists "workin_sync_works skip" on public.workin_sync_works;
create policy "workin_sync_works skip" on public.workin_sync_works
  for update to anon, authenticated using (true) with check (true);   -- 열 grant 가 override_skip·override_by 로 좁힘

drop policy if exists "workin_sync_outbox read" on public.workin_sync_outbox;
create policy "workin_sync_outbox read" on public.workin_sync_outbox
  for select to anon, authenticated using (true);

drop policy if exists "workin_sync_log read" on public.workin_sync_log;
create policy "workin_sync_log read" on public.workin_sync_log
  for select to anon, authenticated using (true);

drop policy if exists "workin_sync_review read" on public.workin_sync_review;
create policy "workin_sync_review read" on public.workin_sync_review
  for select to anon, authenticated using (true);
drop policy if exists "workin_sync_review resolve" on public.workin_sync_review;
create policy "workin_sync_review resolve" on public.workin_sync_review
  for update to anon, authenticated
  using (resolved_at is null)                                         -- 미처리 행만
  with check (resolved_at is not null and resolution is not null);    -- 처리 표시로만 바꿀 수 있음(되돌리기 불가)
-- 어느 새 표에도 delete 정책·권한 없음.

-- 5) 도우미 함수 -------------------------------------------------------------------

-- 5-1) 메모 항목 정규화(공백 정리) — 엣지도 같은 규칙: trim → 연속 공백 1칸 → md5 (item_key)
create or replace function public.workin_memo_key(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')
$$;
revoke all on function public.workin_memo_key(text) from public, anon, authenticated;
grant execute on function public.workin_memo_key(text) to service_role;

-- 5-2) 실행 임대 — 엣지 rpc('workin_sync_take_lease', {p_key,p_holder,p_ttl_seconds}) → true 면 진행
create or replace function public.workin_sync_take_lease(p_key text, p_holder text, p_ttl_seconds integer)
returns boolean language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare ok boolean := false;
begin
  insert into public.workin_sync_lease as l (key, holder, until, updated_at)
  values (p_key, p_holder, now() + make_interval(secs => greatest(10, least(coalesce(p_ttl_seconds, 300), 1800))), now())
  on conflict (key) do update
     set holder = excluded.holder, until = excluded.until, updated_at = now()
   where l.until < now() or l.holder = excluded.holder
  returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function public.workin_sync_release_lease(p_key text, p_holder text)
returns void language sql set search_path = pg_catalog, public, pg_temp as $$
  update public.workin_sync_lease set until = now(), updated_at = now() where key = p_key and holder = p_holder;
$$;
revoke all on function public.workin_sync_take_lease(text, text, integer) from public, anon, authenticated;
revoke all on function public.workin_sync_release_lease(text, text) from public, anon, authenticated;
grant execute on function public.workin_sync_take_lease(text, text, integer) to service_role;
grant execute on function public.workin_sync_release_lease(text, text) to service_role;

-- 6) 되밀기 큐 트리거 ---------------------------------------------------------------
create or replace function public.workin_sync_enqueue()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_on    boolean;
  v_hdr   text;
  v_role  text;
  v_line  text;
  v_norm  text;
  v_keys  text[];
begin
  begin
    -- 스위치 꺼짐 → 아무것도 넣지 않음(큐 쌓임 방지)
    select value = 'true' into v_on from public.app_config where key = 'WORKINMAP_PUSH_ENABLED';
    if not coalesce(v_on, false) then
      return null;
    end if;

    -- [핑퐁 판정] 머리 주석 참고
    begin
      v_hdr  := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-workin-sync';
      v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    exception when others then
      v_hdr := null; v_role := null;
    end;
    if coalesce(v_hdr, '') = '1' then
      return null;
    end if;
    if new.updated_by = '워킨맵 동기화' and coalesce(v_role, '') not in ('anon', 'authenticated') then
      return null;
    end if;

    -- 색
    if old.label is distinct from new.label then
      insert into public.workin_sync_outbox (place_id, ext_id, account_no, work_id, kind, field, value, item_key, actor)
      values (new.id, new.ext_id, new.ext_account_no, new.ext_work_id, new.kind, 'label', to_jsonb(new.label), '', left(new.updated_by, 40))
      on conflict (place_id, field) where status = 'pending' and field <> 'memo'
      do update set value = excluded.value, actor = excluded.actor, ext_id = excluded.ext_id,
                    account_no = excluded.account_no, work_id = excluded.work_id, kind = excluded.kind,
                    changed_at = now(), next_at = now(), attempts = 0, last_error = '';
    end if;

    -- 숨김
    if old.visible is distinct from new.visible then
      insert into public.workin_sync_outbox (place_id, ext_id, account_no, work_id, kind, field, value, item_key, actor)
      values (new.id, new.ext_id, new.ext_account_no, new.ext_work_id, new.kind, 'visible', to_jsonb(new.visible), '', left(new.updated_by, 40))
      on conflict (place_id, field) where status = 'pending' and field <> 'memo'
      do update set value = excluded.value, actor = excluded.actor, ext_id = excluded.ext_id,
                    account_no = excluded.account_no, work_id = excluded.work_id, kind = excluded.kind,
                    changed_at = now(), next_at = now(), attempts = 0, last_error = '';
    end if;

    -- 메모: OLD 에 없던 항목만(공백 정리 후 비교). 지운 항목은 보내지 않는다(합집합).
    if old.memos is distinct from new.memos and jsonb_typeof(new.memos) = 'array' then
      select coalesce(array_agg(public.workin_memo_key(t)), '{}')
        into v_keys
        from jsonb_array_elements_text(case when jsonb_typeof(old.memos) = 'array' then old.memos else '[]'::jsonb end) as t;
      for v_line in
        select t.v from jsonb_array_elements_text(new.memos) with ordinality as t(v, ord)   -- 원소는 실측상 전부 문자열(아닌 값은 글자로 바뀜)
         order by t.ord
      loop
        v_norm := public.workin_memo_key(v_line);
        continue when v_norm = '' or v_norm = any(v_keys);
        insert into public.workin_sync_outbox (place_id, ext_id, account_no, work_id, kind, field, value, item_key, actor)
        values (new.id, new.ext_id, new.ext_account_no, new.ext_work_id, new.kind, 'memo', to_jsonb(v_line), md5(v_norm), left(new.updated_by, 40))
        on conflict (place_id, item_key) where status = 'pending' and field = 'memo' do nothing;
        v_keys := v_keys || v_norm;                          -- 같은 저장 안의 중복 항목 1번만
      end loop;
    end if;
  exception when others then
    -- 동기화 큐 때문에 앱 저장이 실패하면 안 된다 — 경고만(postgres 로그)
    raise warning 'workin_sync_enqueue 실패(place %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.workin_sync_enqueue() from public, anon, authenticated;

drop trigger if exists workin_sync_enqueue on public.workin_map_places;
create trigger workin_sync_enqueue
  after update of label, visible, memos on public.workin_map_places
  for each row
  when (new.ext_id is not null
        and (old.label is distinct from new.label
             or old.visible is distinct from new.visible
             or old.memos is distinct from new.memos))
  execute function public.workin_sync_enqueue();

-- 7) 설정 기본값 (없을 때만 — 관리 탭에서 바꾼 값은 재실행해도 그대로) -----------------------
insert into public.app_config (key, value) values
  ('WORKINMAP_SYNC_ENABLED',    'false'),   -- 가져오기 크론 스위치(꺼져 있으면 pull 크론이 HTTP 를 쏘지 않음). dry 는 관리 탭에서 따로
  ('WORKINMAP_PUSH_ENABLED',    'false'),   -- 되밀기 스위치(꺼져 있으면 트리거가 큐에 넣지 않고 push 크론도 안 쏨)
  ('WORKINMAP_PUSH_MEMO',       'false'),   -- 메모 추가 되밀기(modify2) 따로 켜기(설계 v2-D). 꺼져 있으면 엣지가 memo 행을 skipped 로
  ('WORKINMAP_PUSH_FIELDS',     '{"quarter":["label","visible","memo"],"monthly":["label","visible","memo"],"renewal":["label"]}'),
  ('WORKINMAP_EXCLUDE_WORKS',   '["영업확장성리스트_박P_워킨맵표현"]'),   -- 이름 또는 워크 id 배열(계정 공통)
  ('WORKINMAP_TEST_WORK',       '26.10.31 동기화 테스트'),               -- 이 이름(또는 id) 워크 = 팀 T
  ('WORKINMAP_ACCOUNT_LABELS',  '{"1":"CD 계정","2":"AB 계정"}'),
  ('WORKINMAP_API_KEY',         '')         -- Firebase 웹 키(공개값이지만 코드에 박지 않음). 사용자/관리 탭이 채움
on conflict (key) do nothing;

-- 8) 크론 (pg_cron 은 UTC. KST = UTC+9) --------------------------------------------
--   이번 분기: KST 09·12·15·18시 = UTC 0·3·6·9시 정각(사용자 결정 2026-10-31 밤)
select cron.schedule('workinmap-sync-pull', '0 0,3,6,9 * * *',
  $$select ops.call_edge('workinmap-sync', '{"action":"pull"}'::jsonb, 150000, 'workinmap-sync-pull')
     where exists (select 1 from public.app_config where key = 'WORKINMAP_SYNC_ENABLED' and value = 'true');$$);
--   지난 분기: 하루 1회 KST 06:10(= UTC 21:10)
select cron.schedule('workinmap-sync-pull-old', '10 21 * * *',
  $$select ops.call_edge('workinmap-sync', '{"action":"pull","scope":"old"}'::jsonb, 300000, 'workinmap-sync-pull-old')
     where exists (select 1 from public.app_config where key = 'WORKINMAP_SYNC_ENABLED' and value = 'true');$$);
--   되밀기: 매분, 스위치 켜짐 + 보낼 행이 있을 때만
select cron.schedule('workinmap-sync-push', '* * * * *',
  $$select ops.call_edge('workinmap-sync', '{"action":"push"}'::jsonb, 55000, 'workinmap-sync-push')
     where exists (select 1 from public.app_config where key = 'WORKINMAP_PUSH_ENABLED' and value = 'true')
       and exists (select 1 from public.workin_sync_outbox where status = 'pending' and next_at <= now());$$);

commit;

-- ============================================================================
-- 확인(실행 뒤):
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='workin_map_places' and column_name like 'ext\_%' order by 1;        -- 7행
--   select pg_get_constraintdef(oid) from pg_constraint where conname='workin_map_places_team_check';             -- ... 'T'
--   select count(*) from public.workin_map_places;                                                                -- 7,895(그대로)
--   select c.relname, c.relrowsecurity from pg_class c where c.relname like 'workin_sync_%' and c.relkind='r' order by 1;   -- 6행 전부 true
--   select t, has_table_privilege('anon', t, 'select') sel, has_table_privilege('anon', t, 'insert') ins,
--          has_table_privilege('anon', t, 'update') upd, has_table_privilege('anon', t, 'delete') del
--     from unnest(array['public.workin_sync_accounts','public.workin_sync_works','public.workin_sync_outbox',
--                       'public.workin_sync_log','public.workin_sync_review','public.workin_sync_lease']) t;
--     -- accounts f f f f · works t f f(열 update 는 has_column_privilege 로) f · outbox t f f f · log t f f f · review t f f f · lease f f f f
--   select has_column_privilege('anon','public.workin_sync_works','override_skip','update'),                      -- true
--          has_column_privilege('anon','public.workin_sync_review','resolution','update'),                       -- true
--          has_function_privilege('anon','public.workin_sync_take_lease(text,text,integer)','execute'),           -- false
--          has_function_privilege('anon','public.workin_sync_update_places(jsonb)','execute'),                    -- false
--          has_function_privilege('service_role','public.workin_sync_update_places(jsonb)','execute');            -- true
--   select tgname, tgenabled from pg_trigger where tgrelid='public.workin_map_places'::regclass and not tgisinternal;   -- 2개(updated_at·workin_sync_enqueue)
--   select key, value from public.app_config where key like 'WORKINMAP%' order by key;                            -- 8행, 스위치 3개 false
--   select jobname, schedule, active from cron.job where jobname like 'workinmap-sync%' order by 1;                 -- 3행
--   -- 스위치 켠 뒤:
--   select * from ops.edge_call_health where tag like 'workinmap-sync%';
--   select status, field, count(*) from public.workin_sync_outbox group by 1, 2 order by 1, 2;
--   select kind, count(*) from public.workin_sync_review where resolved_at is null group by 1;
--
-- 이름·주소 복구(사용자 결정 ①) — 로그 1행 되돌리기 예시(SQL Editor, 먼저 select 로 확인):
--   select id, place_id, field, before_value, after_value, created_at from public.workin_sync_log
--    where place_id = <장소 id> and direction = 'pull' order by created_at desc;
--   update public.workin_map_places set address = (select before_value #>> '{}' from public.workin_sync_log where id = <로그 id>),
--          updated_by = '복구'                                                    -- '워킨맵 동기화' 가 아님 → PUSH 켜져 있어도 이름·주소는 큐 대상 아님
--    where id = <장소 id>;
--   insert into public.workin_sync_log (place_id, field, direction, before_value, after_value, actor, note)
--   select place_id, field, 'restore', after_value, before_value, '복구', 'log ' || id from public.workin_sync_log where id = <로그 id>;
--   (주의: 다음 pull 이 워킨맵 값으로 다시 덮는다 — 워킨맵이 원본. 워킨맵 쪽도 고치거나 그 워크를 override_skip.)
--
-- 되돌리기(SQL Editor, 위에서 아래 순서) — 기존 표에서는 열 7개·인덱스 2개·트리거 1개·team check 'T' 만 걷으면 원래대로:
--   select cron.unschedule('workinmap-sync-pull'); select cron.unschedule('workinmap-sync-pull-old'); select cron.unschedule('workinmap-sync-push');
--   drop trigger if exists workin_sync_enqueue on public.workin_map_places;
--   drop function if exists public.workin_sync_enqueue();
--   drop function if exists public.workin_sync_take_lease(text, text, integer);
--   drop function if exists public.workin_sync_release_lease(text, text);
--   drop function if exists public.workin_memo_key(text);
--   drop function if exists public.workin_sync_update_places(jsonb);
--   -- ↓ log 를 지우면 이름·주소 복구 원본이 사라진다. 먼저 내보내기(대시보드 Table Editor → Export CSV)
--   drop table if exists public.workin_sync_outbox, public.workin_sync_review, public.workin_sync_works,
--                        public.workin_sync_accounts, public.workin_sync_lease, public.workin_sync_log;
--   drop index if exists public.workin_map_places_ext_id_uq; drop index if exists public.workin_map_places_ext_work_idx;
--   alter table public.workin_map_places drop column if exists ext_id, drop column if exists ext_work_id,
--     drop column if exists ext_account_no, drop column if exists ext_year, drop column if exists ext_last_update,
--     drop column if exists ext_synced_at, drop column if exists ext_missing_at;     -- 짝(ext_id) 정보가 사라짐 → 다시 켜면 첫 짝짓기부터
--   -- team 'T' 되돌리기: T 행(테스트 워크에서 들어온 것)을 먼저 확인·처리한 뒤에만
--   --   select count(*) from public.workin_map_places where team = 'T';   -- 0 이어야
--   --   alter table public.workin_map_places drop constraint workin_map_places_team_check,
--   --     add constraint workin_map_places_team_check check (team in ('A','B','C','D','E'));
--   delete from public.app_config where key like 'WORKINMAP\_%';   -- 선택
--   급히 멈추기만: update public.app_config set value = 'false' where key in ('WORKINMAP_SYNC_ENABLED','WORKINMAP_PUSH_ENABLED');
--     (크론은 다음 회차부터 HTTP 0, 트리거는 즉시 큐 넣기 중단. 이미 쌓인 pending 은 그대로 남아 다시 켜면 나감 —
--      버리려면 update public.workin_sync_outbox set status='skipped', last_error='수동 중단' where status='pending';)
--
-- 엣지 규칙(구현 B — 표만으로는 강제 못 함):
--   · PostgREST 호출마다 헤더 `x-workin-sync: 1` + service role 키. 앱 행을 쓸 때 updated_by = '워킨맵 동기화'.
--   · pull 이 이름·주소·전화·좌표·코멘트·label·visible 을 바꿀 때 **PATCH 전에** workin_sync_log 에 칸마다 before/after 1행
--     (로그 insert 실패면 그 행 PATCH 하지 않음 — 복구 원본 없이 덮어쓰지 않는다). 메모는 추가 항목마다 1행(before null).
--   · 새 장소 insert: field '_insert', after_value = 넣은 행 전체. 사라짐: ext_missing_at 기록 + field '_missing' + review(missing).
--   · works upsert: on_conflict=account_no,work_id (override_skip·override_by·first_pulled_at 은 보내지 않아 사람 값 유지).
--   · review insert 가 409(23505, workin_sync_review_open_uq)면 "이미 열린 건" — 무시. on_conflict 쓰지 않는다(식 인덱스).
--   · outbox 꺼내기: status=eq.pending&next_at=lte.<now>&order=id.asc&limit=…  → 처리 뒤 PATCH status/attempts/next_at/last_error/done_at.
--     양보 판정은 changed_at 과 워킨맵 last_update 비교. memo 항목 비교 키 = md5(trim + 연속 공백 1칸) — workin_memo_key 와 같은 규칙.
--   · 겹침 방지: rpc workin_sync_take_lease({p_key:'pull', p_holder:<uuid>, p_ttl_seconds:170}) false 면 바로 끝, 끝나면 release.
--
-- 프런트(src/supabase.ts 래퍼만 — 관리 탭 카드·확인 큐·장소 이력):
--   const works = await selectRows<WorkinSyncWork>("workin_sync_works", "select=account_no,work_id,name,team,year,quarter,kind,place_count,status,override_skip,last_pulled_at,last_error&order=account_no.asc,name.asc");
--   const open  = await selectRows<WorkinSyncReview>("workin_sync_review", "select=id,kind,field,place_id,ext_id,work_id,detail,created_at&resolved_at=is.null&order=created_at.desc&limit=200");
--   await updateRows("workin_sync_review", `id=eq.${id}&resolved_at=is.null`, { resolved_at: new Date().toISOString(), resolved_by: userKey, resolution: "ignored" });
--   (장소 이력) selectRows("workin_sync_log", `select=created_at,direction,field,before_value,after_value,actor&place_id=eq.${placeId}&order=created_at.desc&limit=50`)
--   (워크 끄기) updateRows("workin_sync_works", `account_no=eq.${n}&work_id=eq.${encodeURIComponent(workId)}`, { override_skip: true, override_by: userKey })
-- ============================================================================
