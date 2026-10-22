# 04. SQL 실행 절차 — 사람이 SQL Editor 에서

> 근거: `.claude/skills/sql-handoff/SKILL.md`, `.claude/agents/sql-review.md`, `.claude/agents/db-schema.md`, CLAUDE.md.

## 왜 사람이 실행하나
- 앱·노트북·봇은 anon 키만 갖고 있어서 표·제약·cron·권한을 만들 수 없다.
- AI(Claude Code)의 Supabase MCP 는 **읽기 전용**이다(`.mcp.json` 의 `read_only=true`). AI 가 anon REST 로 데이터를 옮기거나 지우는 것도 권한 분류기가 막는다.
- 그래서 **모든 DDL·데이터 정리는 사람이 Supabase 대시보드 → SQL Editor 에서 1회 실행**한다. 엣지 함수 배포(05 장)는 CLI 로 가능하지만 SQL 은 아니다.

## 파일 규칙
1. `supabase/<기능>.sql` 1파일 = 기능 1개.
2. 머리 주석: 날짜 · 목적(왜) · "SQL Editor 에서 1회 실행" · 피해야 할 시각 · 되돌리는 방법.
3. **두 번 실행해도 안전하게**: `create table if not exists`, `add column if not exists`, `drop policy if exists` 후 `create policy`, cron 은 `select cron.unschedule(jobid) from cron.job where jobname = '...'` 후 `cron.schedule`.
4. 새 표는 반드시 RLS + 정책 + **grant 를 직접** 적는다(2026-10-19 부터 기본 권한이 anon 에 안 붙는다, 03 장 5절).
   쓰기 권한은 필요한 동작만. update/delete 는 기본 막는다.
5. 기존 표의 컬럼은 바꾸지 않는다(이름·타입 변경 금지). 새 표·뷰·override 표로 푼다.
6. 금지 재료: service_role 키, 비밀번호, 외부 API 키. cron 헤더의 anon 키는 기존 `*-cron.sql` 패턴(공개값).
7. 다른 프로젝트 ref(`kkdiihazgzesbqxjytqv` 가 아닌 것)가 들어 있으면 즉시 실행 금지 — 옛 뭄바이 프로젝트 키가 든 파일을 지운 적 있다.
8. 데이터를 지우거나 덮는 SQL 은 먼저 백업 표를 만든다(예: `_backup_cleanup_20261019`, `okr_cycles_bak_20261020`).
9. 끝에 **확인 쿼리**(무엇이 보이면 성공인지)와 **되돌리기 블록**(주석)을 둔다.

## 실행 전 검사
- AI 팀에서는 검사실 **권한나(sql-review)** 가 판정한다: 권한·삭제·기존 표 변경·비밀키·다른 프로젝트 ref·재실행 안전성. "실행 금지"면 건네지 않는다. 조건부면 조건을 안내에 그대로 옮긴다.
- 사람이 직접 볼 때 최소 확인:
  - [ ] `drop table`, `truncate`, 조건 없는 `delete`/`update` 가 없나
  - [ ] `grant ... to anon` 이 필요한 동작만인가 (delete 가 꼭 필요한가)
  - [ ] cron 이 카톡을 만들면 KST 10시 이후·평일인가
  - [ ] 실행 시각 제약: 월 05:50~06:30(임대리스트 동기화), 밤 00:30 전후(시트 미러 교체), 02:30(노트북 백업)은 피한다. 권한 변경은 **평일 낮**(바로 이상을 볼 수 있게)
  - [ ] `outbox` 를 지우는 SQL 은 `room_activity` 트리거를 울린다 — 시각 주의

## 실행 순서
1. 파일을 저장소에 커밋·푸시(02 장). 실행한 SQL 과 저장소가 같아야 나중에 추적된다.
2. 대시보드 → SQL Editor → New query → 파일 **통째로** 붙여넣기 → Run.
   - 큰 파일은 파일 링크로, 짧은 것은 채팅에 그대로 받아 붙여넣는 편이 실수가 적다.
3. 맨 아래 확인 쿼리 결과를 기대값과 비교.
4. 앱에서 해당 기능을 한 번 써 본다(관리 탭 스위치가 필요하면 그때 켠다).
5. 권한을 바꾼 SQL 이면 10분 안에: 노트북 심박(`worker_heartbeat.last_seen`), 봇 발송(`outbox` 가 비워지는지), 다음 날 02:30 백업 로그를 확인.

## 기록
- `AGENTS.md` 작업 기록에 "실행 대기 SQL: 파일명"을 적고, 실행하면 "실행 완료(날짜)"로 바꾼다.
- 실행 여부가 애매하면 라이브에서 확인한다(표·컬럼·cron·트리거 존재). 예:
  ```sql
  select to_regclass('public.misu_visits');                         -- null 이면 미실행
  select jobname, schedule, active from cron.job where jobname = 'weekly-keyman-poster';
  select column_name from information_schema.columns where table_name = 'vendor_info' and column_name ilike '%dept%';
  ```
  (03 장 6절에 2026-10-22 기준 상태표가 있다.)

## 되돌리기
- 파일 끝 되돌리기 블록을 SQL Editor 에서 실행.
- 권한: 한 표만 막혔으면 grant 한 줄(`grant select, insert on public.<표> to anon, authenticated;`).
- 데이터: 백업 표에서 `insert ... select` 로 복구. 노트북 백업(jsonl.gz, 14일)도 있다.
- cron: `select cron.unschedule('<이름>');` 또는 `update cron.job set active = false where jobname = '<이름>';`
- 큰 사고: Supabase 대시보드 Backups(PITR 여부 확인 필요).

## 템플릿
```sql
-- 2026-MM-DD <기능> — <왜>
-- SQL Editor 에서 1회 실행. 두 번 실행해도 안전.
-- 피할 시각: …   되돌리기: 맨 아래 주석.
create table if not exists public.example_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author text not null default '',
  body text not null default ''
);
alter table public.example_items enable row level security;
drop policy if exists example_items_read on public.example_items;
create policy example_items_read on public.example_items for select to anon, authenticated using (true);
drop policy if exists example_items_insert on public.example_items;
create policy example_items_insert on public.example_items for insert to anon, authenticated with check (true);
grant select, insert on public.example_items to anon, authenticated;
-- 확인: select count(*) from public.example_items;  → 0 이면 성공
-- 되돌리기: drop table if exists public.example_items;
```
