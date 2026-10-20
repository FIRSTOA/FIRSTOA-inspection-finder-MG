-- OKR 달 정리 2건 (2026-10-21, 클로드): ① 10월 핵심방향을 새 저장 형식(머리글 / 주간: / 월말: / 분기:)으로 ② 11·12월 복사본 goals 비우기
-- 목적: OkrDirection 띠가 2026-10-21부터 "주간: …" 줄 접두 형식을 읽는다(src/OkrDirection.tsx 머리 주석).
--       옛 형식(접두 없는 3문장)은 머리글 + 문단으로만 보이고 타임라인(주간 실행→월말 확인→분기 정리)이 안 그려진다.
-- SQL Editor 에서 1회 실행. 두 번 실행해도 같은 값(멱등). 앱 [고치기]로 손으로 나눠도 같은 결과.
-- 글자 변경: 팀장 원문 "주간에는 실행하고, 월말에는 …" 한 문장을 두 줄로 나누면서 "실행하고" → "실행한다."(끝맺음만).
-- 되돌리기: 백업 표(okr_cycles_bak_20261020)는 direction 열이 생기기 전 사진이라 쓸 수 없다. docs/okr/2026-10-okr.json 의 direction 원문(3문장, 136자)을
--   update public.okr_cycles set direction = E'<원문>' where id = '2026-10'; 로 되돌린다. 또는 앱 [고치기]에서 그대로 다시 적는다.
-- 확인: select direction from public.okr_cycles where id = '2026-10';  → 4줄, 2~4번째 줄이 "주간:" "월말:" "분기:" 로 시작

update public.okr_cycles
   set direction = E'10월은 4분기 목표의 담당자·대상·측정 기준을 정하고 실행을 시작한다.\n주간: 주간에는 실행한다.\n월말: 월말에는 목표 대비 숫자와 미달 원인을 확인하여 11월 전략을 정한다.\n분기: 분기 말 지식과 교훈으로 정리할 수 있도록 개선 전 상태와 판단 근거를 남긴다.',
       updated_at = now(),
       updated_by = 'okr-month-tidy-20261021.sql'
 where id = '2026-10' and kind = 'month';

-- ② 11·12월: 옛 10월 goals 복사본(goals_origin 'copy', 사용자 2026-10-21 "다 지워줘")을 비운다.
--    앱(2026-10-21 판)은 copy 달·goals '[]' 달을 빈 9행 틀(Pillar 만)로 보여 주고, 팀장 월 OKR 붙여넣기 또는 [분기 OKR로 시작]으로 채운다.
--    비우기 전 goals 는 goals_prev 에 보관(이미 있으면 첫 값 유지). 그 달 okr_reports 는 없음(2026-10-21 실측 0행). 멱등.
-- 확인: select id, goals_origin, jsonb_array_length(goals), jsonb_array_length(goals_prev) from public.okr_cycles where id in ('2026-11','2026-12');
--   → copy / 0 / 9 (두 행)
-- 되돌리기: update public.okr_cycles set goals = goals_prev where id in ('2026-11','2026-12') and goals_origin = 'copy' and jsonb_array_length(goals) = 0;
update public.okr_cycles
   set goals_prev = case when jsonb_array_length(goals) > 0 then coalesce(goals_prev, goals) else goals_prev end,
       goals      = '[]'::jsonb,
       updated_at = now(),
       updated_by = 'okr-month-tidy-20261021.sql'
 where id in ('2026-11', '2026-12') and kind = 'month' and goals_origin = 'copy';
