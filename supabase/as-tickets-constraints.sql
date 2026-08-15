-- as_tickets CHECK 제약 (2026-08-15 확장 — 적용 완료)
-- 네이버 완전 통합으로 team에 E(오후9시)·기타(비정시), scheduleType에 납품철수교체휴가교육이 추가됐다.
-- ⚠ 이 제약이 좁으면 네이버 자동 수입이 조용히 실패한다 (실사고: 납품 일정 수입 전멸 → 예정 6건 미스터리)
alter table as_tickets drop constraint if exists as_tickets_team_check;
alter table as_tickets add constraint as_tickets_team_check check (team = any (array['A','B','C','D','E','기타']));
alter table as_tickets drop constraint if exists "as_tickets_scheduleType_check";
alter table as_tickets add constraint "as_tickets_scheduleType_check" check ("scheduleType" = any (array['AS','익일AS','물류','휴가','매월점검','납품철수교체휴가교육']));
