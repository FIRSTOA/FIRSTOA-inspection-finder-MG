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
