-- 키맨 포스터 서버 안전망 cron 을 월요일 10:00 → 10:30 KST 로 (2026-10-21, 클로드)
-- 왜: 노트북 실행기(tools/worker/worker.py POSTER_HOUR)가 월요일 8시 → 10시로 바뀜(사용자 "8시 공지를 10시로", 출근 전 카톡 금지 규칙).
--     서버 cron(ifMissing: PC 가 이번 주에 안 보냈을 때만 링크 글을 보냄)이 같은 10:00 이면
--     PC 와 경쟁해 사진 누락 또는 링크·사진 중복이 생긴다(검사실 방지훈 검토). PC 가 먼저 사진을 보내고 표시한 뒤 서버가 확인하도록 30분 뒤로.
-- 일정만 바꾼다(cron.alter_job) — 요청 내용·키는 그대로(다시 적지 않음).
-- SQL Editor 에서 1회 실행. 두 번 실행해도 같은 결과.
-- 되돌리기: select cron.alter_job((select jobid from cron.job where jobname = 'weekly-keyman-poster'), schedule := '0 1 * * 1');
-- 확인: select jobname, schedule, active from cron.job where jobname = 'weekly-keyman-poster';  → 30 1 * * 1 / true

select cron.alter_job(
  (select jobid from cron.job where jobname = 'weekly-keyman-poster'),
  schedule := '30 1 * * 1'   -- UTC 월 01:30 = KST 월 10:30
);
