-- ============================================================================
-- 카톡 배달 기록 표: kakao_delivery_log (2026-10-24 · 데이터실 표다빈)
-- 왜: 홈 LiveSendBoard 의 "봇 n · 노트북 n" 은 room_activity(방마다 마지막 활동 1행)라 "방 수"만 센다.
--     사용자 결정 "배달 기록 표 만들어" — 오늘 몇 "건"을 누가(폰 봇/노트북) 어느 방에 무슨 건(구분·업체)으로
--     보냈는지 목록을 보이려면 배달 1건 = 1행 기록이 필요하다.
-- 무엇:
--   · 새 표 public.kakao_delivery_log — 배달 1건 = 1행. anon·authenticated 는 SELECT 만.
--   · 새 트리거 outbox_delivery_record (AFTER DELETE ON outbox) — 적재는 트리거만 한다.
--   · 기존 표·열·트리거(outbox_delivery_log → room_activity) 는 건드리지 않는다. 앱·봇·노트북 코드 수정 없음.
--
-- 라이브 실측(MCP 읽기, 2026-10-24) — "파일에 적힌 값"이 아니라 DB 에서 본 값:
--   · 대기열 표 = public.outbox (id uuid · room text · text text · created_at timestamptz). status·sent_at·보낸 주체 열 없음.
--     "보냄" = 행 DELETE(ack). 봇: DELETE /outbox?id=in.(...)  노트북: DELETE /outbox?id=eq.<id> (보낸 뒤에만 지운다).
--     → 지시서의 "status 가 sent 로 바뀔 때 AFTER UPDATE" 는 불가 — AFTER DELETE 로 잡는다(기존 room_activity 트리거와 같은 길).
--   · 기존 트리거 outbox_delivery_log AFTER DELETE → log_outbox_delivery() → room_activity 'bot_send'(주체 구분 못함).
--   · room_activity.source 값: bot_send 9 · message 30 · pc_send 1 (노트북은 지운 뒤 따로 pc_send 를 upsert).
--   · 최근 24시간 edge 로그 DELETE /rest/v1/outbox 요청: User-Agent
--       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/137..." 103회 = 봇(jsoup 기본 UA, 앱은 outbox 를 지우지 않음)
--       "Python-urllib/3.12" 19회 = 노트북 outbox_relay.py(urllib)
--     → 하루 배달 규모 대략 120~200건(봇 요청 1회에 여러 행 가능). 90일 보존 시 ~2만 행.
--
-- 보낸 주체(sender) 판정 — 코드 수정 없이 PostgREST 가 트랜잭션에 넣어 주는 request.headers 의 user-agent 로:
--     python-urllib*  → 'pc'  (tools/kakao-pc/outbox_relay.py rest_call)
--     그 밖의 HTTP     → 'bot' (gas-and-bot/supabase-outbox-poller.js httpDelete, jsoup)
--     헤더 없음        → 기록 안 함 (SQL Editor·pg_cron 청소: kakao-bot-watchdog 의 6시간 지난 [봇점검] 삭제 등 = 배달 아님)
--   그리고 봇이 "12시간 지난 🤖 심박"을 보내지 않고 지우는 경우도 배달이 아니므로 뺀다.
--   한계: 앞으로 다른 HTTP 클라이언트가 outbox 를 지우면 'bot' 으로 잡힌다. 그때는 그 클라이언트의 UA 를 위 판정에 추가.
--
-- kind·vendor — outbox 에는 글(text)뿐이라 글에서 꺼낸다(없으면 null):
--   kind   : 🤖 …[봇점검] → '봇점검' / 글의 "구분: X" 첫 값(쉼표 앞) / 없으면 room_map 에서 그 방의 category
--   vendor : 글의 "업체명: X" 또는 "업체: X" 첫 줄 값(여러 업체 묶음 글이면 첫 업체만), 80자
--   본문(text)은 저장하지 않는다(주민번호 등 노출 방지 — 2026-10 가림 작업과 같은 기준).
--   vendor 는 저장 전에 주민번호(\d{6}-?\d{7})·전화번호(0\d{1,2}-?\d{3,4}-?\d{4}) 패턴을 지운 뒤 80자로 자른다(권한나 권고 A).
--
-- 안전: 트리거는 어떤 오류가 나도 삼키고 old 를 돌려준다 — 기록 실패가 봇 ack(DELETE)를 실패시키면 중복 발송이 난다.
-- 실행: Supabase SQL Editor 에서 1회 실행. 두 번 실행해도 안전(if not exists / or replace / drop ... if exists).
--       앱보다 먼저 실행해도 된다(표만 생기고 기록이 쌓이기 시작). 이전 배달 이력은 복원 불가(outbox 는 지워졌음).
-- 확인(실행 뒤 봇이 1건 보낸 다음):
--   select sender, count(*) from public.kakao_delivery_log group by 1;
--   → 0행이면 request.headers 가 안 넘어오는 것 — 데이터실에 알릴 것(판정을 바꿔야 함).
-- 되돌리기: 맨 아래 주석.
-- ============================================================================

begin;

-- 1) 표 ----------------------------------------------------------------------
create table if not exists public.kakao_delivery_log (
  id          uuid primary key default gen_random_uuid(),
  sent_at     timestamptz not null default now(),                 -- 배달(=outbox 행 삭제) 시각
  sender      text not null check (sender in ('bot', 'pc')),      -- bot=폰 메신저봇R, pc=노트북 카톡 PC 중계
  room        text not null,                                      -- outbox.room 그대로
  kind        text,                                               -- 구분(점검·AS·자가·부품·봇점검 …), 모르면 null
  vendor      text,                                               -- 업체명(첫 업체), 모르면 null
  outbox_id   uuid not null,                                      -- 지워진 outbox 행 id (FK 없음 — 원 행은 이미 없다)
  queued_at   timestamptz,                                        -- outbox.created_at (쌓인 시각 → 지연 계산용)
  created_at  timestamptz not null default now(),
  constraint kakao_delivery_log_outbox_id_key unique (outbox_id)  -- 같은 outbox 행은 1번만
);
comment on table public.kakao_delivery_log is
  '카톡 배달 1건 = 1행. outbox AFTER DELETE 트리거(outbox_delivery_record)만 적재. 앱은 읽기만. 2026-10-24 supabase/kakao-delivery-log-20261024.sql';

-- 2) 인덱스 (오늘·기간 조회) -----------------------------------------------------
create index if not exists kakao_delivery_log_sent_at_idx on public.kakao_delivery_log (sent_at desc);

-- 3) 트리거 함수 ----------------------------------------------------------------
create or replace function public.record_kakao_delivery() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_hdr    text;
  v_ua     text;
  v_sender text;
  v_kind   text;
  v_vendor text;
begin
  begin
    v_hdr := nullif(current_setting('request.headers', true), '');
    if v_hdr is null then
      return old;                                   -- SQL Editor·cron 청소 = 배달 아님
    end if;
    -- 봇이 12시간 지난 심박을 보내지 않고 지운 것 = 배달 아님(supabase-outbox-poller.js "심박 폐기")
    if old.text like '🤖%' and old.created_at < now() - interval '12 hours' then
      return old;
    end if;

    v_ua := coalesce(v_hdr::json ->> 'user-agent', '');
    v_sender := case when v_ua ilike 'python-urllib%' then 'pc' else 'bot' end;

    if old.text like '🤖%[봇점검]%' then
      v_kind := '봇점검';
    else
      v_kind := nullif(btrim(substring(old.text from '(?n)^[ \t]*구분[ \t]*[:：][ \t]*([^,\n]+)')), '');
      if v_kind is null then
        select min(m.category) into v_kind from room_map m where m.room = old.room;
      end if;
    end if;
    v_vendor := substring(old.text from '(?n)^[ \t]*업체명?[ \t]*[:：][ \t]*([^\n]+)');
    v_vendor := regexp_replace(v_vendor, '\d{6}-?\d{7}', '', 'g');               -- 주민번호 지움
    v_vendor := regexp_replace(v_vendor, '0\d{1,2}-?\d{3,4}-?\d{4}', '', 'g');   -- 전화번호 지움
    v_vendor := left(nullif(btrim(v_vendor), ''), 80);

    insert into kakao_delivery_log (sent_at, sender, room, kind, vendor, outbox_id, queued_at)
    values (now(), v_sender, coalesce(old.room, ''), left(v_kind, 40), v_vendor, old.id, old.created_at)
    on conflict (outbox_id) do nothing;
  exception when others then
    null;                                           -- 기록 실패가 ack 를 막으면 중복 발송 — 반드시 삼킨다
  end;
  return old;
end
$fn$;
revoke all on function public.record_kakao_delivery() from public, anon, authenticated;

drop trigger if exists outbox_delivery_record on public.outbox;
create trigger outbox_delivery_record after delete on public.outbox
for each row execute function public.record_kakao_delivery();

-- 4) 권한 (2026-10-19 이후 새 표에 anon 기본 권한 없음) — 읽기만. 쓰기는 트리거(security definer)만.
revoke all on public.kakao_delivery_log from anon, authenticated;
grant select on public.kakao_delivery_log to anon, authenticated;

-- 5) RLS ---------------------------------------------------------------------
alter table public.kakao_delivery_log enable row level security;

drop policy if exists "kakao_delivery_log read" on public.kakao_delivery_log;
create policy "kakao_delivery_log read" on public.kakao_delivery_log
  for select to anon, authenticated using (true);

commit;

-- ============================================================================
-- 보존(제안만 — 실행하지 않음): 90일 지난 행 매일 03:40 KST 삭제. 비밀값 없는 순수 SQL 크론.
--   select cron.schedule('kakao-delivery-log-purge', '40 18 * * *',
--     $$delete from public.kakao_delivery_log where sent_at < now() - interval '90 days'$$);
--   (하루 ~200행이라 1년 둬도 7만 행 — 급하지 않다. 수동이면 위 delete 한 줄을 가끔 실행.)
--
-- 되돌리기(SQL Editor, 순서대로) — 기존 room_activity 트리거(outbox_delivery_log)는 그대로 남는다:
--   begin;
--   drop trigger if exists outbox_delivery_record on public.outbox;
--   drop function if exists public.record_kakao_delivery();
--   drop table if exists public.kakao_delivery_log;
--   -- select cron.unschedule('kakao-delivery-log-purge');  -- 보존 크론을 걸었을 때만
--   commit;
--
-- 프런트(src/supabase.ts 래퍼만):
--   const since = encodeURIComponent(kstDayStartIso());   // LiveSendBoard 의 KST 0시
--   const today = await selectRows<{ sender: "bot" | "pc" }>("kakao_delivery_log", `select=sender&sent_at=gte.${since}&limit=5000`);  // 건수 = filter(sender).length
--   const pcList = await selectRows<{ sent_at: string; room: string; kind: string | null; vendor: string | null }>("kakao_delivery_log", `select=sent_at,room,kind,vendor&sender=eq.pc&sent_at=gte.${since}&order=sent_at.desc&limit=50`);
-- ============================================================================
