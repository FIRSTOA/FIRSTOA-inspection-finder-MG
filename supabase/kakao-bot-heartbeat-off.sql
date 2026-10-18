-- ★ 실행 보류 (2026-10-19 결정): 노트북 카톡 PC가 봇 폰과 같은 계정이라 PC가 대신 보낸 글로는 봇 세션이
--   되살아나지 않는다. 심박(예방)은 그대로 둔다. 이 파일은 나중에 계정이 분리되면 쓰려고 남겨 둔 것.
--
-- 카톡봇 심박([봇점검] 문구) 끄기
--
-- 배경: 심박은 조용한 방의 봇 알림 세션이 죽지 않게 하루 한 줄 보내던 장치였다.
--   노트북 실행기(outbox_relay)가 "봇이 2분 안에 못 가져간 글"을 PC 카톡으로 대신 보내고,
--   그 글이 올라가면 봇 폰에 알림이 떠 세션이 되살아나므로 심박 없이도 전달은 된다.
--   대가: 조용한 방의 그날 첫 글은 봇 대신 PC가 2~3분 늦게 보낸다(노트북·카톡 PC가 살아 있어야 함).
-- 되돌리기: select cron.alter_job((select jobid from cron.job where jobname = 'kakao-bot-heartbeat'), active := true);
--   (지운 심박 글은 다음 정각에 조용한 방에 자동으로 다시 생기므로 복구 불필요)
-- 실행 시각: 평일 KST 정각 직후 15분은 피한다(그 안에 만든 심박 글을 지우면 발송 현황에 '봇이 보냄'으로 잘못 찍힘).

select cron.alter_job((select jobid from cron.job where jobname = 'kakao-bot-heartbeat'), active := false);

-- 이미 outbox 에 쌓인 심박 글이 있으면 같이 지운다(없으면 0행)
delete from outbox where text like '%[봇점검]';

-- 확인: active 가 false 여야 한다
select jobid, jobname, schedule, active from cron.job where jobname = 'kakao-bot-heartbeat';
