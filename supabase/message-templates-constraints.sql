-- message_templates.context CHECK (2026-08-17 확장 — 적용 완료)
-- 분기점검 안내(quarter_notice) 공용 문구 추가. ⚠ 이 제약이 좁으면 공용 문구 저장이 조용히 실패한다
-- (실사고 — as_tickets CHECK와 같은 패턴). 새 문구 맥락을 추가할 땐 여기부터.
alter table message_templates drop constraint if exists message_templates_context_check;
alter table message_templates add constraint message_templates_context_check
  check (context = any (array['happycall','promotion','quarter_notice', 'report']));
