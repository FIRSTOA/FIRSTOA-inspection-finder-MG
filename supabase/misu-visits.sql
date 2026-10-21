-- ============================================================================
-- 미수 방문이력 표 misu_visits (2026-10-22 · 데이터실 표다빈)
-- 목적: 필드 › 미수 = 'CS 방문이력 작성기'가 저장하는 방문 1건 = 1행. 조회 › 미수 [방문 이력]이 읽는다.
--       기존 misu 표는 매일 0시 시트 전체교체 미러라 웹앱 기록이 지워진다 → 새 표(D1).
-- 설계안: docs/tasks/misu-redesign.md §3 · 기준: docs/tasks/misu-visit-standard.md(법무팀)
-- 실행: Supabase SQL Editor 에서 1회 실행. 두 번 실행해도 안전(if not exists / drop policy if exists / grant 멱등).
--       앱(작성기)을 먼저 배포해도 된다 — 표가 없으면 앱이 404/42P01 을 잡아 "표 준비 중"으로 저장·전송을 막는다.
-- 기존 표 변경 없음. cron·엣지 함수·뷰 없음. 비밀값 없음.
--
-- 권한(2026-10-19 이후 새 표에 anon 기본 권한이 자동으로 붙지 않음 — anon-permissions-20261019.sql A)
--   anon·authenticated: SELECT · INSERT · UPDATE(숨김 3열만). DELETE·TRUNCATE 없음.
--   → 방문 기록 본문은 저장 후 고칠 수 없다(D8: 수정 대신 '보완 기록' 새 행 + supplement_of).
--   → 앱 저장은 insertRow(같은 id 재전송 → 409 → "dup"). upsertRows(merge-duplicates)는 UPDATE 권한이 없어 실패한다 — 쓰지 말 것.
--   → created_at(작성 시각)은 트리거가 서버 시각으로 고정 — 클라이언트가 보내도 무시된다(증거 기록).
-- ============================================================================

-- 1) 표 ----------------------------------------------------------------------
create table if not exists public.misu_visits (
  id                uuid primary key,                        -- 폼 열 때 클라이언트가 crypto.randomUUID() 로 만든 값(재전송 시 같은 id → 중복 1건)
  created_at        timestamptz not null default now(),      -- 저장 시각(서버 고정, 트리거)
  visited_at        timestamptz not null,                    -- 방문 일시(기본 = 지금, 수정 가능)
  visit_round       text not null,                           -- '1차 안내' | '2차 경고' | '추가'
  author            text not null,                           -- SSO 이름 또는 작성자 선택값
  author_sub        text not null default '',                -- SSO user.sub
  author_team       text not null default '',                -- A~E
  vendor            text not null,                           -- 화면 업체명
  company_code      text not null default '',                -- 거래처코드 10자리
  site_code         text not null default '',                -- 임대리스트 5자리
  lease_seq         text not null default '',                -- 임순(misu._raw.임순)
  region            text not null default '',                -- A~E
  misu_months       text not null default '',                -- 방문 당시 미수 개월 스냅샷
  misu_balance      text not null default '',                -- 방문 당시 미수 잔액 스냅샷
  contact_name      text not null default '',                -- 응대자 이름
  contact_title     text not null default '',                -- 직위
  contact_is_rep    boolean,                                 -- 대표자 본인인가(null = 모름/응대자 없음)
  rep_phone         text not null default '',                -- 대표자 연락처
  rep_phone_status  text not null default '',                -- '확보' | '거부' | '모름' | ''
  no_contact        boolean not null default false,          -- 아무도 없음
  open_status       text not null default '',                -- '영업중' | '문 잠김' | '폐업 확인' | ''
  evid_mail         text not null default '',                -- 우편물 적치
  evid_sign         text not null default '',                -- 간판
  evid_neighbor     text not null default '',                -- 옆 가게 진술
  closed_estimate   text not null default '',                -- 폐업 추정 등 결론
  dun_methods       text[] not null default '{}',            -- 구두 안내 / 안내문 봉함 전달 / 안내문 봉함 투입
  dun_reply         text not null default '',                -- 상대 답변(인용)
  promise_date      text not null default '',                -- 납부 약속일
  return_requested  boolean not null default false,          -- 기기 반환 요구 여부
  return_to         text not null default '',                -- 누구에게
  return_reply      text not null default '',                -- 답변(인용)
  return_method     text not null default '',                -- 반환 방법 안내
  photos            jsonb not null default '[]'::jsonb,      -- [{slot:'outside'|'door'|'device'|'notice', url, w, h}]
  photo_skips       jsonb not null default '{}'::jsonb,      -- {slot: 촬영 불가 사유} (D2)
  album_id          text not null default '',                -- 모아보기 앨범
  judgment          text not null default '',                -- '계속 독촉' | '철수' | '소송이관' | ''
  judgment_reason   text not null default '',                -- 사유 한 줄
  rules_ack         jsonb not null default '{}'::jsonb,      -- 4원칙 확인 + 시간 외 방문 사유(D3)
  missing           text[] not null default '{}',            -- 경고로 통과한 미충족 항목
  supplement_of     uuid,                                    -- 보완 기록이면 원 기록 id
  text_body         text not null default '',                -- 카톡 원문
  room              text not null default '',                -- 보낸 방(없으면 '' — E 방 미정 등, D4)
  _hidden           boolean not null default false,
  _hidden_by        text not null default '',
  _hidden_at        timestamptz,
  constraint misu_visits_round_chk     check (visit_round in ('1차 안내','2차 경고','추가')),
  constraint misu_visits_open_chk      check (open_status in ('영업중','문 잠김','폐업 확인','')),
  constraint misu_visits_judgment_chk  check (judgment in ('계속 독촉','철수','소송이관','')),
  constraint misu_visits_phone_chk     check (rep_phone_status in ('확보','거부','모름','')),
  constraint misu_visits_author_chk    check (btrim(author) <> ''),
  constraint misu_visits_vendor_chk    check (btrim(vendor) <> ''),
  constraint misu_visits_photos_chk    check (jsonb_typeof(photos) = 'array'),
  constraint misu_visits_skips_chk     check (jsonb_typeof(photo_skips) = 'object'),
  constraint misu_visits_ack_chk       check (jsonb_typeof(rules_ack) = 'object'),
  constraint misu_visits_supplement_fk foreign key (supplement_of) references public.misu_visits(id)
);

comment on table public.misu_visits is 'CS 미수 방문이력(필드 › 미수 작성기). 1방문=1행, 수정 대신 보완 기록(supplement_of). 설계 docs/tasks/misu-redesign.md';

-- 2) 작성 시각 서버 고정 -------------------------------------------------------
create or replace function public.misu_visits_set_created_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists misu_visits_created_at on public.misu_visits;
create trigger misu_visits_created_at
  before insert on public.misu_visits
  for each row execute function public.misu_visits_set_created_at();

-- 트리거 전용 함수 — REST(/rpc)로 부를 일 없음
revoke all on function public.misu_visits_set_created_at() from public, anon, authenticated;

-- 3) 인덱스 (업체 키 · 방문일 · 작성자) -------------------------------------------
create index if not exists misu_visits_company_idx
  on public.misu_visits (company_code, visited_at desc) where company_code <> '';
create index if not exists misu_visits_lease_seq_idx
  on public.misu_visits (lease_seq) where lease_seq <> '';
create index if not exists misu_visits_vendor_idx
  on public.misu_visits (vendor);
create index if not exists misu_visits_visited_idx
  on public.misu_visits (visited_at desc);
create index if not exists misu_visits_region_visited_idx
  on public.misu_visits (region, visited_at desc);
create index if not exists misu_visits_author_visited_idx
  on public.misu_visits (author, visited_at desc);

-- 4) 권한 -------------------------------------------------------------------
revoke all on public.misu_visits from anon, authenticated;
grant select, insert on public.misu_visits to anon, authenticated;
grant update (_hidden, _hidden_by, _hidden_at) on public.misu_visits to anon, authenticated;

-- 5) RLS ---------------------------------------------------------------------
alter table public.misu_visits enable row level security;

drop policy if exists "misu_visits read" on public.misu_visits;
create policy "misu_visits read" on public.misu_visits
  for select to anon, authenticated using (true);

drop policy if exists "misu_visits insert" on public.misu_visits;
create policy "misu_visits insert" on public.misu_visits
  for insert to anon, authenticated with check (_hidden = false);

-- 숨김 표시용(한 방향). 열은 grant 로 숨김 3열만 열려 있고, 숨김 해제(_hidden=false 로 되돌리기)·숨긴 행 덮어쓰기는 막는다
--   (권한나 검토 2026-10-22: 증거 표라 숨김을 풀거나 _hidden_by 를 바꿔치기 못 하게). 해제가 필요하면 관리자가 SQL Editor 에서.
--   '작성자 본인 당일'은 앱이 거른다(SSO 2단계 때 정책으로 좁힘).
drop policy if exists "misu_visits hide" on public.misu_visits;
create policy "misu_visits hide" on public.misu_visits
  for update to anon, authenticated using (_hidden = false) with check (_hidden = true);

-- ============================================================================
-- 확인 쿼리 (실행 뒤 SQL Editor 에서)
-- ============================================================================
-- select count(*) as cols from information_schema.columns where table_schema='public' and table_name='misu_visits';  -- 45
-- select relacl, relrowsecurity from pg_class where oid = 'public.misu_visits'::regclass;
--   -- 기대: anon=ar/postgres, authenticated=ar/postgres (d·D 없음), relrowsecurity = true
-- select grantee, column_name, privilege_type from information_schema.column_privileges
--   where table_name='misu_visits' and privilege_type='UPDATE' and grantee in ('anon','authenticated');  -- 숨김 3열 × 2
-- select policyname, cmd, roles from pg_policies where tablename='misu_visits';  -- read/insert/hide 3개
-- select indexname from pg_indexes where tablename='misu_visits';  -- pkey + 6개
--
-- anon 동작 시험(아무것도 남기지 않음):
-- begin;
--   set local role anon;
--   insert into public.misu_visits (id, visited_at, visit_round, author, vendor, created_at)
--     values ('00000000-0000-0000-0000-000000000001', now(), '1차 안내', '시험', '시험업체', '2000-01-01');
--   select created_at > now() - interval '1 minute' as created_at_forced from public.misu_visits where vendor='시험업체';  -- true
--   update public.misu_visits set _hidden = true, _hidden_by = '시험', _hidden_at = now() where vendor='시험업체';  -- 1행
--   -- 아래 두 줄은 각각 permission denied(42501)가 나와야 정상 — 확인하려면 한 줄씩 따로 시험
--   -- update public.misu_visits set judgment = '철수' where vendor='시험업체';
--   -- delete from public.misu_visits where vendor='시험업체';
-- rollback;

-- ============================================================================
-- 되돌리기 (필요할 때만. 표에 실제 방문 기록이 있으면 먼저 백업 — 법적 증거 자료)
-- ============================================================================
-- select count(*) from public.misu_visits;   -- 0 이 아니면 멈추고 백업부터
-- drop table if exists public.misu_visits;   -- 정책·인덱스·트리거·제약이 함께 지워진다
-- drop function if exists public.misu_visits_set_created_at();
