-- 홈 피드백 보드 (2026-09-12) — 직원이 불편·버그·개선점을 적고, 개발자가 코멘트·개발 지시(프롬프트)를 달아 체크 → 컨펌.
-- 컨펌된 항목(status=confirmed)은 개발 파이프라인이 집어 간다(브랜치+미리보기 → 보드에 결과 코멘트 → 배포는 사람이 탭).
create table if not exists feedback_items (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  author text not null,
  category text not null default '불편',          -- 불편 / 버그 / 개선 / 기타
  screen text default '',                          -- 관련 화면(선택)
  content text not null,
  status text not null default 'new',              -- new 접수 → triaged 개발자 확인 → confirmed 개발 대기 → in_progress → done / rejected
  dev_prompt text default '',                      -- 개발자가 적는 구체 지시(자동 개발의 입력)
  dev_comment text default '',                     -- 작성자에게 보이는 답글
  checked boolean not null default false,          -- 컨펌 대상 체크
  votes int not null default 0,                    -- "나도 불편" +1
  confirmed_at timestamptz, done_at timestamptz,
  result_note text default '', commit_ref text default '', preview_url text default ''
);
create index if not exists feedback_items_status_idx on feedback_items (status, created_at desc);
grant select, insert, update on feedback_items to anon, authenticated;   -- 보드는 앱 안에서만 쓴다(outbox·room_activity와 같은 신뢰 모델)
grant usage, select on sequence feedback_items_id_seq to anon, authenticated;
notify pgrst, 'reload schema';

-- 2026-09-12 보강: 반려 사유·삭제(소프트)·개발 시작 옵션·실행 기록
alter table feedback_items add column if not exists deleted_at timestamptz;         -- 삭제(소프트) — 작성자 본인(접수 상태) 또는 개발자
alter table feedback_items add column if not exists auto_deploy boolean not null default false; -- 개발자 선택: 미리보기 없이 main까지
alter table feedback_items add column if not exists branch text default '';         -- 파이프라인이 만든 브랜치
alter table feedback_items add column if not exists run_log text default '';        -- 파이프라인 실행 기록(마지막 실행)
alter table feedback_items add column if not exists started_at timestamptz;
notify pgrst, 'reload schema';
