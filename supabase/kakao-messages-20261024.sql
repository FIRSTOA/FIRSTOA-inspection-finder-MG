-- ============================================================================
-- 카톡 원문 보관 표: kakao_messages + 적재 기록 표: kakao_import_log (2026-10-24 · 데이터실 표다빈)
-- 설계: docs/tasks/kakao-collect-expand.md 3-5(원문 보존) · docs/tasks/tab-search-kakao-history.md 3-2.
-- SQL Editor 에서 1회 실행. supabase/kakao-collect-rooms-20261024.sql 다음에(순서 상관은 없다 — FK 없음).
--
-- 왜: 업무 카톡방 글을 FIELD 표로 뽑을 때 양식이 아니거나 AI 가 놓친 글은 사라진다. 원문을 1글 = 1행으로 남겨
--     탭 검색에서 "카톡방을 위로 넘기지 않고" 찾게 한다. 지금은 원문 보관 표가 없다(라이브 404).
-- 무엇:
--   1) public.kakao_import_log — 엣지 kakao-ingest 가 조각 1개를 넣을 때마다 1행(본문 없음, 숫자·시각만).
--   2) public.kakao_messages   — 1글 = 1행. 넣기 전 가림 적용 본문만 저장. hash unique 로 같은 글 두 번 0.
--   3) 가림 트리거(넣기 전) — 엣지가 이미 가리지만 DB 에서 한 번 더(이중). 주민번호·카드·계좌·휴대폰 가운데 4자리.
--   4) 인덱스: (room, sent_at desc) · (author) · text_key pg_trgm GIN · import_id.
--   5) 권한:
--      · kakao_messages  : anon·authenticated 권한 0(SELECT 도 없음). 넣기·읽기는 엣지(service role)만
--                           — kakao-ingest(넣기), kakao-search(읽기, 제한 5가지). 공개 번들의 anon 키로 원문을 긁지 못하게.
--      · kakao_import_log: anon·authenticated SELECT 만(방 이름·숫자·시각 — 관리 탭 수집 카드가 읽음).
--      · UPDATE·DELETE 는 아무에게도 주지 않는다(보존 삭제는 cron = postgres 권한).
--
-- 라이브 실측(MCP 읽기, 2026-10-24):
--   · kakao_messages·kakao_import_log 없음. pg_trgm 1.6 이 public 스키마에 있음(logistics_raw_trgm 이 gin_trgm_ops 사용 중).
--   · PostgreSQL 17.6 — 정규식 뒤보기((?<!…)) 지원. 아래 가림 정규식은 SELECT 로 미리 돌려 봄:
--       '900101-1234567' → '900101-1******', '계좌 110-900101-1234567' 속은 안 건드림, 붙은 13자리 시리얼 안 건드림,
--       '010-1234-5678' → '010-****-5678', '1234-5678-9012-3456' → '****-****-****-3456'.
--   · show_trgm('건영테크') 정상(한글 3글자 조각 생성) — 업체명 부분 검색에 trgm 사용 가능.
--
-- 열 설계(지시: room · sent_at 시:분 · seq · author · text · hash · kind_guess · source_file · created_at + 설계 3-5 보완):
--   sent_at  = KST 시:분을 timestamptz 로(초 = 0). 카톡 내보내기에 초가 없다.
--   seq      = 같은 방·같은 분 안에서 n번째 글(1부터) — 화면 정렬용.
--   hash     = 엣지가 계산: md5(방 + KST 'yyyy-mm-dd HH:mm' + 작성자 + 본문 앞 500자 정규화 + '#' + n)
--              n = 같은 분·같은 작성자·같은 글의 n번째("네" 연타가 한 줄로 합쳐지지 않게). 가림 "전" 본문으로 계산해도
--              되고 "후"로 해도 되지만 엣지에서 한 가지로 고정할 것(바꾸면 전부 새 글로 들어감) — 권장: 가림 후.
--   text     = 가림 적용 뒤 본문, 20,000자 이하.
--   text_key = 생성 열: 소문자 + 숫자·영문·한글만(공백·기호 제거) — "(주)건영 테크" = "주건영테크". trgm 검색 대상.
--   kinds    = 넣을 때 kakao_collect_rooms.kinds 복사(겸용 방 = {점검,AS}). 검색 "종류 겹침" 조건.
--   is_bot   = 작성자가 app_config.KAKAO_BOT_NICKS 에 있음(FIELD 양식 발송분 — 화면에서 기본 숨김).
--   kind_guess = 정규식 추정 form:점검·form:AS·form:물류·form:불만접수·form:계약갱신·form:미수방문·form:초과조정·share·media·chat.
--   masked   = 가린 곳 개수(엣지 집계 + 트리거가 더 가렸으면 +1).
--
-- 보존(이 파일은 크론을 걸지 않는다 — 아래 주석의 제안을 사용자 결정(Q6) 뒤 따로 실행):
--   · kakao_messages : 3년(sent_at 기준). 하루 약 800글 추정 → 연 30만 행·0.25~0.3GB(trgm 포함).
--   · kakao_import_log: 90일.
--   · 노트북 02:30 백업(tools/worker/backup_tables.py)에서 kakao_messages 는 제외(노트북에 평문 원문이 남음).
--
-- 재실행 안전: create ... if not exists / create or replace / drop ... if exists. begin/commit 한 묶음.
-- 되돌리기: 맨 아래 주석.
-- ============================================================================

begin;

-- 1) 적재 기록 ------------------------------------------------------------------
create table if not exists public.kakao_import_log (
  id           bigint generated always as identity primary key,
  room         text not null,                          -- 방 이름(파일 첫 줄)
  source       text not null default 'gas-drive'
                 check (source in ('gas-drive', 'app-upload', 'phone-export')),
  file_name    text,                                   -- 드라이브 파일 이름(경로 없음)
  chunk_index  integer,                                -- 0부터
  chunk_count  integer,
  from_at      timestamptz,                            -- 이 조각의 첫 글 시각
  to_at        timestamptz,                            -- 이 조각의 마지막 글 시각(다음 증분 기준 = 방별 max(to_at))
  read_count   integer not null default 0,             -- 파서가 읽은 글 수
  inserted     integer not null default 0,
  duplicated   integer not null default 0,
  masked       integer not null default 0,
  status       text not null default 'ok' check (status in ('ok', 'partial', 'error')),
  error        text,                                   -- 짧은 오류 문구(본문 넣지 말 것)
  created_at   timestamptz not null default now()
);
comment on table public.kakao_import_log is
  '카톡 원문 적재 기록(조각 1개=1행, 본문 없음). 엣지 kakao-ingest(service role)만 적재, anon 은 읽기만. 2026-10-24 supabase/kakao-messages-20261024.sql';

create index if not exists kakao_import_log_room_to_idx  on public.kakao_import_log (room, to_at desc);
create index if not exists kakao_import_log_created_idx  on public.kakao_import_log (created_at desc);

-- 2) 원문 ----------------------------------------------------------------------
create table if not exists public.kakao_messages (
  id           bigint generated always as identity primary key,
  room         text not null,
  kinds        text[] not null default '{}',           -- kakao_collect_rooms.kinds 복사
  region       text,                                   -- kakao_collect_rooms.region 복사
  sent_at      timestamptz not null,                   -- KST 시:분(초 0)
  seq          smallint not null default 1 check (seq >= 1),
  author       text not null default '',               -- 카톡 대화명
  text         text not null check (char_length(text) <= 20000),   -- 가림 적용 뒤 본문
  text_key     text generated always as (lower(regexp_replace(text, '[^0-9A-Za-z가-힣]', '', 'g'))) stored,
  is_bot       boolean not null default false,
  kind_guess   text,
  masked       smallint not null default 0,
  hash         text not null,
  source       text not null default 'gas-drive'
                 check (source in ('gas-drive', 'app-upload', 'phone-export', 'bot')),
  source_file  text,
  import_id    bigint references public.kakao_import_log (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint kakao_messages_hash_key unique (hash)
);
comment on table public.kakao_messages is
  '카톡 업무방 원문(1글=1행, 가림 적용 뒤). anon 권한 0 — 넣기 kakao-ingest·읽기 kakao-search 엣지(service role)만. 보존 3년 제안. 2026-10-24 supabase/kakao-messages-20261024.sql';

create index if not exists kakao_messages_room_sent_idx  on public.kakao_messages (room, sent_at desc, seq);
create index if not exists kakao_messages_author_idx     on public.kakao_messages (author);
create index if not exists kakao_messages_text_key_trgm  on public.kakao_messages using gin (text_key gin_trgm_ops);
create index if not exists kakao_messages_import_idx     on public.kakao_messages (import_id);   -- 기록 삭제 시 set null 용

-- 3) 가림 트리거(넣기·고치기 전, 이중 방어) ------------------------------------------
--   규칙은 supabase/functions/_shared/privacy.ts maskRrn 과 같은 기준 + 설계 3-5 추가분.
--   · 주민번호: 하이픈(공백) 나뉜 꼴은 항상. 붙은 13자리는 "주민·생년월일" 이름표 바로 뒤만(기기 시리얼 오가림 방지).
--   · 카드: 4-4-4-4(같은 구분자)는 항상, 붙은 16자리는 "카드" 이름표 뒤만. 끝 4자리만 남김.
--   · 계좌: "계좌(번호)" 이름표 뒤(은행명 허용) 숫자열 → 끝 3자리만 남김.
--   · 휴대폰: 01x 가운데 3~4자리 → ****  ← 사용자 결정 Q6 전 제안값. 빼려면 아래 v := … 휴대폰 줄 하나를 지우고 재실행.
create or replace function public.kakao_messages_mask() returns trigger
language plpgsql set search_path = public as $fn$
declare
  v text := new.text;
begin
  if v is null or v !~ '[0-9]{3}' then
    return new;                                       -- 숫자 덩어리가 없으면 할 일 없음
  end if;
  -- 주민번호(나뉜 꼴)
  v := regexp_replace(v,
    '(?<![0-9])(?<![0-9][-‐‑–—])((?:19|20)[0-9]{6}|[0-9]{6})(?:[ ]*[-‐‑–—][ ]*|[ ])([1-4])[0-9]{6}(?![0-9])(?![-‐‑–—][0-9])',
    '\1-\2******', 'g');
  -- 주민번호(이름표 + 붙은 13자리)
  v := regexp_replace(v,
    '((?:주민(?:등록)?[ ]*(?:번호)?|생년월일)[ ]*[:：=]?[ ]*)((?:19|20)[0-9]{6}|[0-9]{6})([0-9])[0-9]{6}(?![0-9])',
    '\1\2-\3******', 'g');
  -- 카드(4-4-4-4)
  v := regexp_replace(v,
    '(?<![0-9])[0-9]{4}([ -])[0-9]{4}\1[0-9]{4}\1([0-9]{4})(?![0-9])',
    '****\1****\1****\1\2', 'g');
  -- 카드(이름표 + 붙은 16자리)
  v := regexp_replace(v,
    '(카드[ ]*(?:번호)?[ ]*[:：=]?[ ]*)[0-9]{12}([0-9]{4})(?![0-9])',
    '\1************\2', 'g');
  -- 계좌(이름표 뒤)
  v := regexp_replace(v,
    '(계좌[ ]*(?:번호)?[ ]*[:：=]?[ ]*(?:[가-힣A-Za-z]+[ ]*)?)([0-9][0-9 -]{5,})([0-9]{3})(?![0-9])',
    '\1***\3', 'g');
  -- 휴대폰 가운데(Q6 제안값)
  v := regexp_replace(v,
    '(?<![0-9])(01[016789])([ .-]?)[0-9]{3,4}([ .-]?)([0-9]{4})(?![0-9])',
    '\1\2****\3\4', 'g');

  if v is distinct from new.text then
    new.text   := v;
    new.masked := least(coalesce(new.masked, 0) + 1, 32767);
  end if;
  return new;
end
$fn$;
revoke all on function public.kakao_messages_mask() from public, anon, authenticated;

drop trigger if exists kakao_messages_mask on public.kakao_messages;
create trigger kakao_messages_mask before insert or update of text on public.kakao_messages
for each row execute function public.kakao_messages_mask();

-- 4) 권한 (2026-10-19 이후 새 표에 anon 기본 권한 없음) --------------------------------
revoke all on public.kakao_messages   from anon, authenticated;          -- 원문: 권한 0
revoke all on public.kakao_import_log from anon, authenticated;
grant select on public.kakao_import_log to anon, authenticated;           -- 기록: 읽기만

-- 5) RLS ---------------------------------------------------------------------
alter table public.kakao_messages   enable row level security;            -- 정책 없음 = anon 은 0행(권한도 없음)
alter table public.kakao_import_log enable row level security;

drop policy if exists "kakao_import_log read" on public.kakao_import_log;
create policy "kakao_import_log read" on public.kakao_import_log
  for select to anon, authenticated using (true);

commit;

-- ============================================================================
-- 확인(실행 뒤):
--   select relname, relrowsecurity from pg_class where relname in ('kakao_messages','kakao_import_log');   -- 둘 다 true
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'kakao_messages' and grantee in ('anon','authenticated');                         -- 0행이어야 정상
--   -- 가림 시험(넣지 않고 함수만 보려면 begin; insert …; select text from …; rollback; 으로):
--   begin;
--   insert into public.kakao_messages (room, sent_at, author, text, hash)
--     values ('테스트 전용방', now(), '시험', '주민 900101-1234567 / 010-1234-5678 / 시리얼 8001104123456', 'test-'||gen_random_uuid());
--   select text, masked from public.kakao_messages where room = '테스트 전용방' order by id desc limit 1;
--   --  → '주민 900101-1****** / 010-****-5678 / 시리얼 8001104123456', masked 1
--   rollback;
--   -- anon 차단 확인(앱 콘솔 또는 curl, anon 키): GET /rest/v1/kakao_messages?select=id&limit=1 → 401/403(permission denied)
--
-- 보존 크론(제안만 — 실행하지 않음. 사용자 Q6(보관 3년) 답 뒤에 따로 1회 실행. 비밀값 없는 순수 SQL 크론):
--   select cron.schedule('kakao-messages-purge', '40 18 * * *', $$                                -- 매일 03:40 KST
--     delete from public.kakao_messages   where sent_at    < now() - interval '3 years';
--     delete from public.kakao_import_log where created_at < now() - interval '90 days';
--   $$);
--   (import_log 를 지워도 kakao_messages.import_id 는 null 이 될 뿐 원문은 남는다 — FK on delete set null.)
--
-- [결정 대기] kakao_messages 를 anon 이 직접 읽게 할지 — 이 파일은 설계 3-5·QA 기준대로 0 으로 둔다.
--   열어야 한다면(권장 안 함 — 공개 번들의 anon 키로 원문 전량 조회 가능):
--     grant select on public.kakao_messages to anon, authenticated;
--     create policy "kakao_messages read" on public.kakao_messages for select to anon, authenticated using (true);
--
-- 되돌리기(SQL Editor, 순서대로) — 기존 표는 하나도 건드리지 않았다:
--   begin;
--   -- select cron.unschedule('kakao-messages-purge');   -- 보존 크론을 걸었을 때만
--   drop table if exists public.kakao_messages;          -- 트리거·인덱스 같이 지워짐(원문 영구 삭제 — 필요하면 먼저 내보내기)
--   drop function if exists public.kakao_messages_mask();
--   drop table if exists public.kakao_import_log;
--   commit;
--
-- 프런트(src/supabase.ts 래퍼만). kakao_messages 는 앱이 직접 읽지 않는다 — 엣지 kakao-search 경유:
--   const last = await selectRows<{ room: string; to_at: string }>("kakao_import_log", "select=room,to_at&status=neq.error&order=to_at.desc.nullslast&limit=500");   // 방별 최근 = 첫 등장
--   const errs = await selectRows<ImportLog>("kakao_import_log", `select=created_at,room,file_name,status,error&status=eq.error&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=20`);
--   const hits = await invokeEdgeFunction<KakaoHit[]>("kakao-search", { kinds: ["물류"], nameKeys, deviceKeys, core });
-- ============================================================================
