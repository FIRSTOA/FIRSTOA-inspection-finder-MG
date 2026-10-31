-- ============================================================================
-- 중간보고 자동 발송(12:00·14:00 KST, C팀 먼저): schedule_report_log + app_config 3키 + 크론 2개 (2026-10-31 · 데이터실 표다빈)
-- 설계: docs/tasks/schedule-report-auto-2026-10-31.md 4장(데이터)·5장(엣지 계약)·6장(크론) + 맨 아래 "결정(2026-10-31 사용자)".
-- SQL Editor 에서 통째로 1회 실행. 두 번 실행해도 안전(if not exists · drop policy if exists · app_config 없을 때만 · 같은 이름 cron 덮어씀).
-- **순서: 엣지 schedule-report 배포 → 이 SQL → 관리 탭 room_map '스케줄 | C | 강남C 스케줄' → 스위치.**
--   엣지보다 먼저 실행하면 평일 12·14시 크론이 없는 함수를 불러 404(ops.edge_call_health 에 http_error) — 카톡은 0건이라 해는 없다.
--
-- 왜: 지금은 사람이 일정리스트 [📋 중간보고] → AI 생성 → 복사 → '강남C 스케줄' 에 붙여넣기. 서버가 같은 글을 정시에 넣는다.
-- 무엇:
--   1) public.schedule_report_log — 발송 시도 1회 = 1행(claim → queued|dry|skipped|failed, 사람이 [복사] = copied).
--      같은 날·팀·차수(12|14)는 한 번만: 부분 unique 인덱스 (kst_date, team, slot) where slot in ('12','14') and status <> 'dry'.
--      엣지가 맨 처음 claim 행을 넣고 23505(unique 위반)이면 'already' 로 끝낸다(크론 재시도·수동 호출이 겹쳐도 한 번).
--   2) 권한: anon·authenticated = select + **[복사] 기록 insert 만**(열 5개 · slot='copy' · status='copied'). 나머지 쓰기는 엣지(service role).
--      update·delete 는 아무에게도 안 준다(service_role 도 delete 없음).
--   3) app_config 3키(없을 때만): SCHEDULE_REPORT_AUTO=false · SCHEDULE_REPORT_TEST=true · SCHEDULE_REPORT_TEAMS=C.
--   4) pg_cron 2개 — 평일 UTC 03:00(=KST 12:00)·05:00(=KST 14:00) ops.call_edge('schedule-report', {"slot":"12"|"14"}, 90000).
--      공휴일·10시 전·스위치 꺼짐·방 없음은 엣지가 판단해 log 에 skipped(reason) 로 남긴다. 키는 ops.call_edge 가 vault 'field_cron_jwt' 에서.
-- 바꾸지 않는 것: room_map(사용자가 관리 탭·/room-add), report_send_log(점검리포트 전용), outbox·as_tickets·cs_members, 다른 크론.
--
-- 사용자 결정 반영(표에는 영향 없음 — 엣지가 지킬 것):
--   Q1 14시에 변동이 없어도 요약 글 전체를 그대로 보낸다(draft_hash 는 기록만, 'unchanged' 로 건너뛰지 않는다).
--   Q2 "(진행중인 업무는 * 표시)" 줄과 특이사항 칸은 뺀다.
--   Q3 봇 폰 = 노트북 카톡 같은 계정, '강남C 스케줄' 방 초대 완료(10-31). 첫날 테스트방(SCHEDULE_REPORT_TEST=true) → 다음 영업일 실제 방.
--
-- 라이브 실측(MCP 읽기, 2026-10-31 — "DB 에서 본 값"):
--   · public.schedule_report_log 없음. cron 에 schedule-report% 없음. app_config 에 SCHEDULE_REPORT_* 없음.
--   · ops.call_edge(text, jsonb, int, text) 있음 · vault field_cron_jwt 1개 — 같은 방식 크론 11개(reception-sheet-snapshot 등).
--   · outbox.id = uuid(gen_random_uuid) → outbox_id uuid. kakao_delivery_log.outbox_id uuid(배달 확인 잇기).
--   · room_map 에 '스케줄' 종류 없음(30행). TEST_MODE=false · TEST_ROOM=테스트 전용방 · FIELD_KAKAO_SEND_ENABLED=true.
--   · app_config 트리거 2개(app_config_audit·guard) — SQL Editor(postgres) insert 는 로그에 남고 잠금 대상 아님.
--   · DB TimeZone = UTC. pg_default_acl 이 anon 에 새 표 권한을 주지 않는다(아래 명시 grant).
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
end $$;

-- 1) 표 ----------------------------------------------------------------------
create table if not exists public.schedule_report_log (
  id          bigint generated always as identity primary key,
  kst_date    date not null,                                    -- 보고 날짜(KST 달력)
  team        text not null check (team in ('A', 'B', 'C', 'D', 'E')),
  slot        text not null check (slot in ('12', '14', 'now', 'copy')),   -- 12·14 = 크론 차수, now = [지금 보내기], copy = 사람이 [복사]
  status      text not null check (status in ('claim', 'queued', 'dry', 'skipped', 'failed', 'copied')),
  reason      text not null default '' check (char_length(reason) <= 300),
                                                                -- off·holiday·before10·empty·no_room·kakao_off·already·manual_copied 또는 오류 요약
  room        text not null default '',                         -- 실제로 넣은 방(테스트면 테스트방)
  real_room   text not null default '',                         -- 원래 갈 방(room_map 스케줄|팀)
  test        boolean not null default false,                   -- 테스트방 발송이었나
  outbox_id   uuid,                                             -- kakao_delivery_log.outbox_id 로 배달 확인
  text        text not null default '' check (char_length(text) <= 6000),   -- 보낸 본문(연락처 줄 없음 — 오늘 보고)
  draft_hash  text not null default '',                         -- 규칙 초안(금일·익일, 시각 머리 제외) 해시 — 기록·비교용
  lines       integer not null default 0 check (lines >= 0),
  polished    boolean not null default false,                   -- AI 다듬기 성공(false = 규칙 초안으로 보냄)
  ai_model    text not null default '',
  actor       text not null default '' check (char_length(actor) <= 40),    -- cron · 지금 보내기/복사 누른 사람
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.schedule_report_log is
  '중간보고 자동 발송 1회 시도 = 1행. 12·14 차수는 (kst_date,team,slot) 부분 unique 로 하루 한 번. 엣지 schedule-report(service role)가 쓰고, anon 은 읽기 + [복사] 기록(copy/copied) insert 만. 2026-10-31 supabase/schedule-report-20261031.sql';

-- 2) 인덱스 -------------------------------------------------------------------
create unique index if not exists schedule_report_log_slot_uq
  on public.schedule_report_log (kst_date, team, slot)
  where slot in ('12', '14') and status <> 'dry';                -- 중복 발송 막는 열쇠(dryRun 미리보기는 몇 번이든)
create index if not exists schedule_report_log_team_idx
  on public.schedule_report_log (team, kst_date desc, created_at desc);   -- 화면 "오늘 결과 띠"·[복사] 60분 안 확인

-- 3) 권한 (2026-10-19 이후 새 표에 anon 기본 권한 없음) -------------------------------
revoke all on public.schedule_report_log from anon, authenticated, service_role;
grant select on public.schedule_report_log to anon, authenticated;
grant insert (kst_date, team, slot, status, actor) on public.schedule_report_log to anon, authenticated;   -- [복사] 기록만(정책이 더 좁힘)
grant select, insert, update on public.schedule_report_log to service_role;                              -- 엣지: claim insert → 결과 update. delete 없음
--   identity 열이라 시퀀스 권한 불필요(generated always).

-- 4) RLS ---------------------------------------------------------------------
alter table public.schedule_report_log enable row level security;   -- service_role 은 RLS 우회

drop policy if exists "schedule_report_log read" on public.schedule_report_log;
create policy "schedule_report_log read" on public.schedule_report_log
  for select to anon, authenticated using (true);

drop policy if exists "schedule_report_log copy insert" on public.schedule_report_log;
create policy "schedule_report_log copy insert" on public.schedule_report_log
  for insert to anon, authenticated
  with check (
    slot = 'copy' and status = 'copied'
    and kst_date between (now() at time zone 'Asia/Seoul')::date - 1 and (now() at time zone 'Asia/Seoul')::date + 1
  );
-- update·delete 정책 없음 = anon·authenticated 는 못 고치고 못 지운다.

-- 5) 설정 기본값 (없을 때만 — 관리 탭에서 바꾼 값은 재실행해도 그대로) -----------------------
insert into public.app_config (key, value) values
  ('SCHEDULE_REPORT_AUTO',  'false'),   -- 켜야 크론 발송. 꺼져 있어도 [지금 보내기]·dryRun 은 동작
  ('SCHEDULE_REPORT_TEST',  'true'),    -- 켜져 있으면 이 기능 글만 TEST_ROOM 으로(머리 [테스트 · 원래는 강남C 스케줄])
  ('SCHEDULE_REPORT_TEAMS', 'C')        -- 자동 대상 팀(쉼표). 다른 팀 = 이 값 + room_map 스케줄|팀 1줄
on conflict (key) do nothing;

-- 6) 크론 (평일만. 공휴일은 엣지가 KR_HOLIDAYS 로 건너뜀. pg_cron 은 UTC) -------------------
select cron.schedule('schedule-report-12', '0 3 * * 1-5',
  $$select ops.call_edge('schedule-report', '{"slot":"12"}'::jsonb, 90000, 'schedule-report-12');$$);
select cron.schedule('schedule-report-14', '0 5 * * 1-5',
  $$select ops.call_edge('schedule-report', '{"slot":"14"}'::jsonb, 90000, 'schedule-report-14');$$);

commit;

-- ============================================================================
-- 확인(실행 뒤):
--   select relrowsecurity from pg_class where oid = 'public.schedule_report_log'::regclass;                  -- true
--   select has_table_privilege('anon','public.schedule_report_log','select') sel,                            -- true
--          has_table_privilege('anon','public.schedule_report_log','update') upd,                            -- false
--          has_table_privilege('anon','public.schedule_report_log','delete') del,                            -- false
--          has_table_privilege('service_role','public.schedule_report_log','delete') sr_del;                 -- false
--   select jobname, schedule, active from cron.job where jobname like 'schedule-report-%' order by 1;        -- 2행
--   select key, value from public.app_config where key like 'SCHEDULE_REPORT%' order by key;                 -- AUTO false · TEAMS C · TEST true
--   -- 첫 평일 12:00 지나서:
--   select * from ops.edge_call_health where tag like 'schedule-report-%';                                   -- ok 1
--   select kst_date, team, slot, status, reason, room, test, polished, outbox_id from public.schedule_report_log
--    order by created_at desc limit 10;                                                                        -- AUTO 꺼짐이면 skipped/off
--
-- 되돌리기(SQL Editor) — 기존 표는 하나도 건드리지 않았다:
--   select cron.unschedule('schedule-report-12'); select cron.unschedule('schedule-report-14');
--   drop table if exists public.schedule_report_log;          -- 발송 기록이 지워짐(이미 outbox 로 간 글은 그대로)
--   delete from public.app_config where key in ('SCHEDULE_REPORT_AUTO','SCHEDULE_REPORT_TEST','SCHEDULE_REPORT_TEAMS');   -- 선택
--   급히 멈추기만: update public.app_config set value = 'false' where key = 'SCHEDULE_REPORT_AUTO';   (관리 탭 스위치와 같음)
--
-- 엣지 규칙(구현 A — 표만으로는 강제 못 함):
--   · claim: POST /rest/v1/schedule_report_log  {kst_date, team, slot:'12'|'14', status:'claim', actor:'cron'}  Prefer: return=representation
--     → 409/23505 면 이 차수는 이미 시도됨 = 'already'(새 행 넣지 않고 응답만). on_conflict 를 쓰지 않는다(부분 인덱스라 PostgREST 가 못 고름).
--   · 결과: PATCH ?id=eq.<claim id> {status, reason, room, real_room, test, outbox_id, text, draft_hash, lines, polished, ai_model, updated_at: now}
--   · AUTO 꺼짐(off)도 claim 뒤 skipped/off 로 남긴다 → 그날 그 차수는 다시 시도되지 않는다(스위치를 12:00 뒤에 켜면 14시부터).
--   · now: claim 없이 바로 insert(slot 'now'). 10분 연타 막기는 같은 팀 slot 'now' 최근 행 조회로.
--
-- 프런트(src/supabase.ts 래퍼만):
--   const today = await selectRows<ScheduleReportLog>("schedule_report_log", `select=id,slot,status,reason,room,test,outbox_id,polished,created_at&team=eq.C&kst_date=eq.${kstYmd}&order=created_at.desc`);
--   await insertRow("schedule_report_log", { kst_date: kstYmd, team: "C", slot: "copy", status: "copied", actor: author });   // [복사] 기록(실패 무시)
--   const last = await selectRows<{ text: string }>("schedule_report_log", `select=text&team=eq.C&status=eq.queued&order=created_at.desc&limit=1`);   // [마지막 발송 보기]
-- ============================================================================
