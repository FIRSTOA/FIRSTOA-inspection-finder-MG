-- ============================================================================
-- IT 학습 원본 표 2개: it_quiz_attempts · it_practice_logs (2026-10-24 · 데이터실 표다빈)
-- 왜: 홈 전면 개편 ⑦(docs/tasks/home-redesign-2026-10-24.md) — 홈 KPI 의 IT 퀴즈·실습 숫자에 원본이 없다.
--     IT 학습·처리이력은 IT파트 시트 읽기 전용이라(남의 데이터) 우리 쪽 "푼 기록·실습 기록"만 새 표에 남긴다.
-- 무엇:
--   · it_quiz_attempts  — IT 학습 › 기술 퀴즈 완료 화면에서 1회 = 1행 insert(ItLearningHistory.tsx).
--   · it_practice_logs  — IT 학습 탭 상단 [실습 기록] 양식(제목 필수·메모·사진 1장 선택) 1건 = 1행 insert.
--   기존 표 변경 없음. cron·엣지 함수·뷰·트리거 없음. 비밀값 없음.
-- 실행: Supabase SQL Editor 에서 1회 실행. 두 번 실행해도 안전(create ... if not exists / drop policy if exists / grant 멱등).
--       앱을 먼저 배포해도 된다 — 표가 없으면 insert 가 404/42P01 → 앱이 "표 준비 중" 안내로 처리할 것.
--
-- 라이브 실측(MCP 읽기, 2026-10-24):
--   · public.it_quiz_attempts / public.it_practice_logs — 없음(같은 이름 표 0개) → 새로 만든다.
--   · gen_random_uuid() — PostgreSQL 17.6 내장(pg_catalog) 있음. pgcrypto 1.3 도 extensions 스키마에 있으나
--     여기서는 표준 내장 함수를 쓴다(확장 의존 없음).
--
-- 권한(2026-10-19 이후 새 표에 anon 기본 권한이 자동으로 붙지 않음 — anon-permissions-20261019.sql)
--   anon·authenticated: SELECT · INSERT 만. UPDATE·DELETE·TRUNCATE 없음(기록은 남기기만, 고치거나 지우지 않는다).
--   → 앱 저장은 insertRow. upsertRows(merge-duplicates)는 UPDATE 권한이 없어 실패한다 — 쓰지 말 것.
-- 되돌리기: 맨 아래 주석.
-- ============================================================================

begin;

-- 1) 표 ----------------------------------------------------------------------
create table if not exists public.it_quiz_attempts (
  id          uuid primary key default gen_random_uuid(),
  author      text not null check (btrim(author) <> ''),          -- 기기 선택 작성자(없으면 앱이 저장 안 함)
  kst_date    date not null default (now() at time zone 'Asia/Seoul')::date,  -- 푼 날(KST)
  level       text,                                               -- 퀴즈 난이도/단계(선택)
  total       int  not null check (total > 0),                    -- 문항 수
  score       int  not null check (score >= 0 and score <= total),-- 맞힌 수
  created_at  timestamptz not null default now()
);
comment on table public.it_quiz_attempts is 'IT 학습 › 기술 퀴즈 완료 1회 = 1행(홈 KPI 원본). 수정·삭제 없음. 2026-10-24 docs/tasks/home-redesign-2026-10-24.md ⑦';

create table if not exists public.it_practice_logs (
  id          uuid primary key default gen_random_uuid(),
  author      text not null check (btrim(author) <> ''),
  kst_date    date not null default (now() at time zone 'Asia/Seoul')::date,  -- 실습한 날(KST)
  title       text not null check (btrim(title) <> ''),           -- 한 줄 제목(필수)
  memo        text,
  photo_url   text,                                               -- 사진 1장(선택, uploadPhoto 결과 공개 URL)
  created_at  timestamptz not null default now()
);
comment on table public.it_practice_logs is 'IT 학습 [실습 기록] 1건 = 1행(홈 KPI 원본). 수정·삭제 없음. 2026-10-24 docs/tasks/home-redesign-2026-10-24.md ⑦';

-- 2) 인덱스 (날짜 범위 + 작성자) ------------------------------------------------
create index if not exists it_quiz_attempts_date_author_idx on public.it_quiz_attempts (kst_date, author);
create index if not exists it_practice_logs_date_author_idx on public.it_practice_logs (kst_date, author);

-- 3) 권한 -------------------------------------------------------------------
revoke all on public.it_quiz_attempts from anon, authenticated;
revoke all on public.it_practice_logs from anon, authenticated;
grant select, insert on public.it_quiz_attempts to anon, authenticated;
grant select, insert on public.it_practice_logs to anon, authenticated;

-- 4) RLS ---------------------------------------------------------------------
alter table public.it_quiz_attempts enable row level security;
alter table public.it_practice_logs enable row level security;

drop policy if exists "it_quiz_attempts read" on public.it_quiz_attempts;
create policy "it_quiz_attempts read" on public.it_quiz_attempts
  for select to anon, authenticated using (true);

drop policy if exists "it_quiz_attempts insert" on public.it_quiz_attempts;
create policy "it_quiz_attempts insert" on public.it_quiz_attempts
  for insert to anon, authenticated with check (true);

drop policy if exists "it_practice_logs read" on public.it_practice_logs;
create policy "it_practice_logs read" on public.it_practice_logs
  for select to anon, authenticated using (true);

drop policy if exists "it_practice_logs insert" on public.it_practice_logs;
create policy "it_practice_logs insert" on public.it_practice_logs
  for insert to anon, authenticated with check (true);

commit;

-- ============================================================================
-- 확인 쿼리 (실행 뒤 SQL Editor 에서)
-- ============================================================================
-- select c.relname, c.relacl, c.relrowsecurity from pg_class c
--   where c.oid in ('public.it_quiz_attempts'::regclass, 'public.it_practice_logs'::regclass);
--   -- 기대: anon=ar/postgres, authenticated=ar/postgres (w·d·D 없음), relrowsecurity = true
-- select tablename, policyname, cmd, roles from pg_policies
--   where tablename in ('it_quiz_attempts','it_practice_logs') order by 1,2;   -- 표마다 read/insert 2개
-- select indexname from pg_indexes where tablename in ('it_quiz_attempts','it_practice_logs');  -- 표마다 pkey + 1개
--
-- anon 동작 시험(아무것도 남기지 않음):
-- begin;
--   set local role anon;
--   insert into public.it_quiz_attempts (author, level, total, score) values ('시험', '초급', 10, 7);
--   insert into public.it_practice_logs (author, title) values ('시험', '시험 실습');
--   select kst_date from public.it_quiz_attempts where author = '시험';   -- 오늘(KST)
--   -- 아래는 각각 permission denied(42501)가 나와야 정상 — 한 줄씩 따로 시험
--   -- update public.it_quiz_attempts set score = 10 where author = '시험';
--   -- delete from public.it_practice_logs where author = '시험';
-- rollback;
--
-- 프런트(src/supabase.ts 래퍼만):
--   await insertRow("it_quiz_attempts", { author, kst_date: kstToday, level, total, score });
--   await insertRow("it_practice_logs", { author, kst_date: kstToday, title, memo, photo_url });
--   await selectRows("it_quiz_attempts", `select=author,kst_date,total,score&kst_date=gte.${from}&kst_date=lte.${to}&order=kst_date.desc`);

-- ============================================================================
-- 되돌리기 (필요할 때만. 기록이 쌓였으면 먼저 내보내기)
-- ============================================================================
-- select (select count(*) from public.it_quiz_attempts) q, (select count(*) from public.it_practice_logs) p;  -- 0 아니면 백업부터
-- drop table if exists public.it_quiz_attempts;   -- 정책·인덱스·제약이 함께 지워진다
-- drop table if exists public.it_practice_logs;
