---
name: sql-handoff
description: Supabase SQL 을 사용자에게 건네는 절차 — 파일 1개, sql-review 검사, 실행 안내, 실행 대기 목록 기록. 새 표·권한·크론·데이터 정리 SQL 을 만들었을 때, 또는 /sql-handoff.
---
# /sql-handoff — SQL 을 사용자에게 건네기

전제: 앱은 anon 키만 쓴다. 표·제약·크론·권한은 사용자가 **Supabase SQL Editor 에서 직접 1회 실행**한다(Supabase MCP 가 읽기 전용으로 연결돼 있어도 쓰기는 이 절차). 내가 anon REST 로 데이터를 옮기거나 지우는 스크립트는 권한 분류기가 막는다.

## 순서
1. **파일**: `supabase/<기능>.sql` 1파일 = 기능 1개. 머리에 날짜·목적·"SQL Editor 에서 1회 실행"·되돌리는 방법 주석. `create ... if not exists`, `drop policy if exists`, `cron.unschedule ... where exists` 패턴으로 **두 번 실행해도 안전**하게.
2. **금지 재료**: service_role 키·비밀번호·외부 API 키. 크론 http 헤더의 anon 키는 기존 `*-cron.sql` 패턴을 따른다(공개값).
3. **검사**: sql-review(검사실 권한나, model sonnet)에게 파일 경로를 주고 판정을 받는다. "실행 금지"면 건네지 않고 고친다. 조건부면 조건을 사용자 안내에 그대로 옮긴다.
4. **커밋**: 파일을 저장소에 올린다(/deploy 절차, 투입: 권한나 …).
5. **사용자 안내(한국어, 짧게)**: 무엇이 왜 필요한지 2줄 → "파일을 통째로 SQL Editor 에 붙여 실행" → 맨 아래 확인 쿼리에서 무엇이 보이면 성공인지 → 되돌리기 한 줄. 긴 SQL 은 파일 링크, 짧으면 채팅에 그대로(사용자는 파일 열기보다 복붙을 선호).
6. **기록**: 메모리 `firstoa-pending-sql.md` 에 "실행 대기" 항목 추가(실행 전엔 무엇이 안 되는지 포함). 사용자가 "했음"이라고 하면 같은 항목을 "실행 완료(날짜)"로 바꾸고, 가능하면 anon REST 로 표 존재(200/404)를 확인한다.

## 주의
- 실행 시각이 결과에 영향을 주는 SQL(예: outbox 삭제가 room_activity 트리거를 울림)은 피해야 할 시각을 안내에 적는다.
- 카톡 자동 발송을 만드는 크론은 KST 10시 이후·평일만(출근 전 알림 금지 규칙).
- 다른 프로젝트 ref(kkdiihazgzesbqxjytqv 가 아닌 것)가 들어간 SQL 은 즉시 실행 금지.
