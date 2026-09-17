-- 카톡봇 심박 시간 창 조정 (2026-09-17)
--
-- 결정: 평일 KST 10시~19시(퇴근)까지만 심박을 보낸다. 19시 이후·주말엔 봇 줄도 올리지 않는다.
--   그 사이 세션이 죽으면 다음 날 그 방 첫 대화나 10시 심박 때 살아난다("안 되면 다음날 오겠지").
-- 배경: 22시 심박이 E 초과방에 가서 "뭐야 이게" — 업무 시간 밖 봇 메시지는 원치 않음.
-- pg_cron은 UTC: 01~10시 UTC = 10~19시 KST. 요일 1-5 = 월~금.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'kakao-bot-heartbeat'),
  schedule := '0 1-10 * * 1-5'
);

-- 확인
select jobid, jobname, schedule, active from cron.job where jobname = 'kakao-bot-heartbeat';
