-- ============================================================================
-- 시트 접수 행 보관 표: reception_sheet_rows (2026-10-28 · 데이터실 표다빈)
-- 설계: docs/tasks/reception-list-sheet-rows-2026-10-28.md 4절 "2단계"(사용자 결정 Q2 = (가) 10월 31일 전에 넣는다).
-- SQL Editor 에서 1회 실행. **10월 31일(금) 밤 전에** 실행할 것 — 원격·AS접수용 탭은 달이 바뀌면 지난달 행이 사라진다.
--   앱·엣지보다 먼저 실행해도 된다(표만 생기고 아무도 안 씀. 아래 크론은 지금 엣지에 보내도 평소 미처리 계산 1회일 뿐).
--
-- 왜: 접수리스트에 "시트에만 적힌 접수"(영업·경영·원격·IT·CS 중 앱 접수와 짝 없는 것)를 "시트" 칩으로 보인다.
--     원격 탭·AS접수용 탭은 매달 비워지므로 엣지 reception-sheet-open 이 시트를 읽을 때마다 이 표에 upsert 해 둔다
--     ("이번 달 것만, 이제부터 쌓아 나가자"). service_receptions 에는 넣지 않는다(설계 3절 B 안 = 전 화면 숫자 회귀).
-- 무엇:
--   1) public.reception_sheet_rows — 시트 접수 1행 = 1행. 고유 키 (source, month, seq). 가린 값만 저장(전화 열 제외·maskPhones).
--   2) 인덱스: 접수일 · (source, cls, 접수일) · reception_id(이어진 것만).
--   3) 권한: anon·authenticated = SELECT 만. 쓰기(INSERT·UPDATE)는 service_role(엣지)만. DELETE·TRUNCATE 는 아무에게도 없음.
--   4) pg_cron 2개 — ops.call_edge('reception-sheet-open', {"snapshot":true}) 매시 17분 + 매일 23:50 KST.
--      (카톡 발송 아님 → 시간 제한 규칙 대상 아님. 비밀값은 ops.call_edge 가 vault 'field_cron_jwt' 에서 꺼낸다.)
-- 기존 표·행 변경 없음. service_receptions 에 FK 도 걸지 않는다(그 표에 잠금·삭제 제약이 새로 생기지 않게).
--
-- 라이브 실측(MCP 읽기, 2026-10-28):
--   · public.reception_sheet_rows 없음. cron 에 reception% 작업 없음.
--   · service_receptions.id = uuid, receipt_date = date. RLS 켜짐, 정책 "service_receptions anon read/insert/update"(roles anon, using true).
--   · ops.call_edge(p_fn, p_body, p_timeout_ms, p_tag) 있음(security definer, vault field_cron_jwt) — 다른 크론 11개가 같은 방식.
--   · pg_default_acl(public 표) = postgres·service_role 만 arwdDxtm → 새 표에 anon 권한 자동으로 안 붙음(아래에서 명시).
--   · 지금 엣지는 body 에 모르는 키(snapshot)가 오면 평소 미처리 응답을 계산한다(index.ts 218행) — 크론을 먼저 걸어도 무해.
--
-- 엣지 upsert 규칙(구현 A 가 지킬 것 — 표만으로는 강제 못 함):
--   POST /rest/v1/reception_sheet_rows?on_conflict=source,month,seq
--     Prefer: resolution=merge-duplicates,return=minimal   (service role 키)
--   · 싣는 열: source, month, seq, sheet_row, kind, receipt_date, receipt_time, author, handler, state, cls,
--              vendor, first_no, field, region, summary, content, raw, fingerprint, reception_id, link_rule,
--              last_seen_at(=이번 읽기 시각), gone_at(=null)
--     first_seen_at 은 싣지 않는다(처음 넣을 때 기본값 now(), 다음부터는 그대로 — PostgREST 는 실은 열만 고친다).
--     한 번에 보내는 객체들은 모두 같은 키를 가져야 한다(PostgREST 일괄 upsert 규칙). 500행씩 나눠 보낸다.
--   · month = 엣지가 추정한 receipt_date 의 'YYYY-MM'(시트 년월 칸 '2610' 이 아니라 inferMissingYears 뒤 날짜 기준).
--   · seq = 시트 A열 순번 글자 그대로. 순번이 빈 행은 'h:' || md5(source|receipt_date|author|상호 앞 6자) 앞 12자.
--   · 사라진 행: 같은 source·month 에서 last_seen_at < 이번 읽기 시작 시각 이고 gone_at is null 인 행만 PATCH gone_at=now().
--     단 그 source 의 그 달 행이 "한꺼번에" 안 보이면(탭이 비워짐 = 달 바뀜) gone_at 을 찍지 않는다. 삭제(DELETE)는 하지 않는다.
--   · 시트 읽기가 실패했거나 머리 검증이 실패한 탭(errors)은 upsert·gone 처리 둘 다 건너뛴다.
-- 되돌리기: 맨 아래 주석(크론 2개 해제 + drop table 한 줄).
-- ============================================================================

begin;

-- 1) 표 ----------------------------------------------------------------------
create table if not exists public.reception_sheet_rows (
  id             bigint generated always as identity primary key,
  source         text not null check (source in ('sales', 'mgmt', 'remote', 'copier')),
                                                     -- 시트 탭: sales=해지방어접수(영업) · mgmt=경영지원접수 · remote=원격(원격이관+IT) · copier=AS접수용(CS)
  month          text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),   -- 접수일의 'YYYY-MM'
  seq            text not null check (char_length(seq) between 1 and 40),          -- 시트 A열 순번(빈 칸이면 'h:'+해시)
  sheet_row      integer check (sheet_row > 0),      -- 마지막으로 본 시트 행 번호(밀릴 수 있음 — 키 아님)
  kind           text not null check (btrim(kind) <> ''),   -- 영업팀·경영지원·원격이관·IT·복합기 AS(앱 접수 type 과 같은 말)
  receipt_date   date not null,                      -- 접수일(KST 달력 날짜)
  receipt_time   time,                               -- 접수시간(CS D열·원격 D열, 없으면 null)
  author         text not null default '',           -- 접수자(영업·경영·CS E열, 원격 J열)
  handler        text not null default '',           -- 처리자
  state          text not null default '',           -- 시트 상태 칸 원문(가린 뒤). CS 는 BD "처리완료" 메모
  cls            text not null check (cls in ('open', 'hold', 'done', 'record')),  -- 미처리·보류·완료·기록(CS)
  vendor         text not null default '' check (char_length(vendor) <= 80),
  first_no       text,                               -- 퍼스트순(CS F열) — CS 잇기 (날짜·퍼스트순·접수자)
  field          text not null default '' check (char_length(field) <= 60),        -- 접수분야
  region         text not null default '',
  summary        text not null default '' check (char_length(summary) <= 120),     -- 한 줄 요약(가림, 40자+…, CS 는 "제목 — 내용")
  content        text check (char_length(content) <= 1000),                        -- 내용 원문(가림, 600자)
  raw            jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(raw) = 'object' and octet_length(raw::text) <= 32000),
                                                     -- 행 원문 {머리 이름: 값} — 전화 열(PRIVATE_HEADER) 제외·maskPhones 뒤 값만
  fingerprint    text,                               -- md5(receipt_date|author|상호 앞 6자) — 순번 재번호(행 밀림) 감지용
  reception_id   uuid,                               -- 이어진 앱 접수(service_receptions.id). 없으면 null. FK 일부러 없음
  link_rule      text,                               -- 이은 규칙: job · sheet_row · copier1(날짜+퍼스트순+접수자) · copier2 · copier3
  first_seen_at  timestamptz not null default now(), -- 처음 본 시각(upsert 때 싣지 않음)
  last_seen_at   timestamptz not null default now(), -- 마지막으로 시트에서 본 시각
  gone_at        timestamptz,                        -- 시트에서 사라진 시각(달 바뀜 비움은 찍지 않음). 다시 보이면 null
  constraint reception_sheet_rows_key unique (source, month, seq)
);
comment on table public.reception_sheet_rows is
  '시트에 적힌 접수 행 보관(1행=1시트 접수, 2026-10-01부터). 엣지 reception-sheet-open(service role)만 upsert, anon 은 읽기만. 삭제 없음 — 사라진 행은 gone_at. 2026-10-28 supabase/reception-sheet-rows-20261028.sql';

-- 2) 인덱스 (월 약 2,000행·연 약 25,000행) ----------------------------------------
--   (source, month, seq) 는 unique 제약이 인덱스를 겸한다(엣지의 source·month 단위 gone 처리도 이것으로).
create index if not exists reception_sheet_rows_date_idx      on public.reception_sheet_rows (receipt_date desc);
create index if not exists reception_sheet_rows_src_cls_idx   on public.reception_sheet_rows (source, cls, receipt_date desc);
create index if not exists reception_sheet_rows_reception_idx on public.reception_sheet_rows (reception_id) where reception_id is not null;

-- 3) 권한 (2026-10-19 이후 새 표에 anon 기본 권한 없음 — anon-permissions-20261019.sql) ----------
revoke all on public.reception_sheet_rows from anon, authenticated, service_role;
grant select on public.reception_sheet_rows to anon, authenticated;              -- 화면: 읽기만
grant select, insert, update on public.reception_sheet_rows to service_role;     -- 엣지: upsert(insert+update)만, delete 없음
--   identity 열이라 시퀀스 권한은 따로 필요 없음(generated always — 표 insert 권한으로 충분).

-- 4) RLS ---------------------------------------------------------------------
alter table public.reception_sheet_rows enable row level security;   -- service_role 은 RLS 를 우회한다(정책 불필요)

drop policy if exists "reception_sheet_rows read" on public.reception_sheet_rows;
create policy "reception_sheet_rows read" on public.reception_sheet_rows
  for select to anon, authenticated using (true);
-- insert/update/delete 정책은 만들지 않는다 = anon·authenticated 쓰기 0.

-- 5) 크론 (같은 이름이면 cron.schedule 이 덮어씀 — 재실행 안전) ------------------------
--   매시 17분(다른 크론과 분 겹침 피함) + 매일 23:50 KST(=14:50 UTC) — 말일 밤 마지막 보관.
select cron.schedule('reception-sheet-snapshot', '17 * * * *',
  $$select ops.call_edge('reception-sheet-open', '{"snapshot":true}'::jsonb, 60000, 'reception-sheet-snapshot');$$);
select cron.schedule('reception-sheet-snapshot-night', '50 14 * * *',
  $$select ops.call_edge('reception-sheet-open', '{"snapshot":true}'::jsonb, 60000, 'reception-sheet-snapshot-night');$$);

commit;

-- ============================================================================
-- 확인(실행 뒤):
--   select relrowsecurity from pg_class where oid = 'public.reception_sheet_rows'::regclass;                 -- true
--   select has_table_privilege('anon','public.reception_sheet_rows','select') sel,
--          has_table_privilege('anon','public.reception_sheet_rows','insert') ins,                          -- sel true · ins false
--          has_table_privilege('service_role','public.reception_sheet_rows','delete') sr_del;              -- false
--   select jobname, schedule from cron.job where jobname like 'reception-sheet-snapshot%';                  -- 2행
--   -- 엣지 snapshot 배포 뒤 다음 17분 지나서:
--   select source, month, count(*), count(*) filter (where gone_at is not null) gone, max(last_seen_at)
--     from public.reception_sheet_rows group by 1, 2 order by 1, 2;     -- 10월 합계 약 2,000(설계 2절) ± 당일 변동
--
-- 되돌리기(SQL Editor) — 기존 표는 하나도 건드리지 않았다:
--   select cron.unschedule('reception-sheet-snapshot'); select cron.unschedule('reception-sheet-snapshot-night');
--   drop table if exists public.reception_sheet_rows;   -- 보관한 지난달 시트 행이 영구 삭제됨(필요하면 먼저 CSV 내보내기)
--
-- 프런트(src/supabase.ts 래퍼만, 읽기만 — 쓰기는 엣지):
--   const rows = await selectRows<SheetArchiveRow>("reception_sheet_rows", `select=source,month,seq,sheet_row,kind,receipt_date,receipt_time,author,handler,state,cls,vendor,first_no,field,region,summary,reception_id,gone_at&receipt_date=gte.${from}&receipt_date=lte.${to}&reception_id=is.null&order=receipt_date.desc,receipt_time.desc.nullslast&limit=5000`);
--   const one  = await selectRows<SheetArchiveRow>("reception_sheet_rows", `select=*&source=eq.${source}&month=eq.${month}&seq=eq.${encodeURIComponent(seq)}&limit=1`);   // 펼침 상세(raw·content)
--   const open = await selectRows<{ source: string; cls: string }>("reception_sheet_rows", `select=source,cls&cls=in.(open,hold)&gone_at=is.null&receipt_date=lt.${thisMonthStart}`);  // 지난달 열린 채 남은 줄
-- ============================================================================
