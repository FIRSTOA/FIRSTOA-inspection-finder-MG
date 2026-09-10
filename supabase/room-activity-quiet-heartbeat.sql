-- 심박을 "조용한 방만"으로 (2026-09-10)
--
-- ★★ 같은 날 저녁 결정 변천: "한 번도 안 보내면 좋겠다" → 비활성 → 구조상 무발송 유지는
--    불가함을 설명(알림-답장 세션은 메시지가 재료) → 최종: "그냥 10시로" — 재활성하되
--    시간 창을 KST 10~22시로(schedule '0 1-13 * * *'). 아침 8시 일제 알림 소음 해소.
--    봇 패치(reportSeen) 전에는 매일 10:00 한 번 리듬, 패치 후에는 대화 있는 방 제외.
--    파수꾼(#12)은 계속 유지 — 30분 넘게 잠긴 메시지를 웹푸시로 알림.
--
-- 문제: 심박이 room_map 모든 방에 매일 08:00 한 줄씩 → 활발한 방까지 봇 메시지가 떠서
--       시끄럽다는 컴플레인(대표님). 대화가 도는 방은 세션이 저절로 갱신되므로 심박이 필요 없다.
-- 설계: 방별 마지막 활동(room_activity)을 기록하고, 20시간 넘게 조용한 방에만 심박을 보낸다.
--   활동 기록 2경로:
--     ① 봇이 메시지를 배달하면(outbox 행 삭제 = ack) 트리거가 자동 기록 — 봇 수정 없이 동작
--     ② 봇 onMessage가 사람 메시지를 30분 스로틀로 보고(gas-and-bot/supabase-outbox-poller.js)
--   ②가 붙기 전에는 ①만으로 "하루 1번 08:00" 기존 리듬이 유지된다(회귀 없음).
--   ②가 붙으면 사람 대화가 있는 방은 심박 대상에서 빠진다 → 활발한 방은 봇 줄 0.
-- 크론: 매시(KST 08~22시 창) 검사 — 하루 1번 검사로는 주말 만료 타이밍(20h)을 놓친다.
--   야간(KST 22~08시)엔 안 보낸다(새벽 알림 방지). 시간 창 밖에서 만료돼도 아침 8시에 잡힌다.

-- ① 방별 마지막 활동
create table if not exists room_activity (
  room text primary key,
  last_at timestamptz not null default now(),
  source text
);
grant select, insert, update on room_activity to anon;   -- 봇(anon)이 직접 upsert — outbox와 같은 신뢰 모델

-- ② 배달 = 활동: 봇이 ack(삭제)한 신선한 행만 기록 (파수꾼의 6시간 뒷북 청소는 15분 가드로 제외)
create or replace function log_outbox_delivery() returns trigger
language plpgsql security definer as $fn$
begin
  if old.created_at > now() - interval '15 minutes' then
    insert into room_activity (room, last_at, source) values (old.room, now(), 'bot_send')
    on conflict (room) do update set last_at = excluded.last_at, source = excluded.source;
  end if;
  return old;
end
$fn$;
drop trigger if exists outbox_delivery_log on outbox;
create trigger outbox_delivery_log after delete on outbox
for each row execute function log_outbox_delivery();

-- ③ 씨앗: 오늘 08:00 심박이 이미 나갔으므로 그 시각으로 초기화 → 내일 08:00부터 기존 리듬 그대로
insert into room_activity (room, last_at, source)
select distinct room, date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' + interval '8 hours', 'seed'
from room_map where coalesce(trim(room), '') <> ''
on conflict (room) do nothing;

-- ④ 심박 크론 교체: 매일 08:00 전방위 → 매시(KST 08~22) "20시간 무활동 방만"
select cron.alter_job(
  (select jobid from cron.job where jobname = 'kakao-bot-heartbeat'),
  schedule := '0 23,0-13 * * *',
  command := $q$
  insert into outbox (room, text)
  select r.room,
    '🤖 ' || to_char(now() at time zone 'Asia/Seoul', 'MM/DD') || ' 카톡봇 대기 중 [봇점검]'
  from (select distinct room from room_map where coalesce(trim(room), '') <> '') r
  left join room_activity a on a.room = r.room
  where coalesce(a.last_at, timestamptz '-infinity') < now() - interval '20 hours'
    and not exists (select 1 from outbox o where o.room = r.room)
$q$
);

select jobid, jobname, schedule, active from cron.job order by jobid;
