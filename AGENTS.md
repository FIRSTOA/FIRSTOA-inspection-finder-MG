# AGENTS.md — FIRSTOA-inspection-finder-MG 공통 작업 메모

이 파일은 Claude Code, Codex, Aside(어사이드) 등 모든 AI 에이전트와 사람이 **같이 읽고 같이 고치는** 메모입니다.
작업을 끝내면 아래 "작업 기록"에 한 줄씩 남기세요. 다른 에이전트가 이어받을 때 이 파일부터 읽습니다.

## 프로젝트 한 줄
퍼스트전산 CS팀 내부 웹앱 FIELD. React 19 · TypeScript · Vite · Tailwind v4. 백엔드는 Supabase(`kkdiihazgzesbqxjytqv`) + 일부 Google Apps Script. 배포는 Vercel(`firstoa-inspection-finder-mg.vercel.app`).

## 폴더 지도
- `src/` 프런트. 큰 화면은 `*Hub.tsx`, `*Form.tsx`, `*Board.tsx`. 공용: `supabase.ts`(REST 래퍼), `PortalSelect.tsx`, `toast.tsx`, `confirmModal.tsx`, `imageUpload.ts`(사진 업로드).
- `supabase/*.sql` 테이블·RLS·크론 정의. **파일 1개 = 기능 1개**, 파일 머리에 날짜와 목적 주석. SQL Editor에서 1회 실행하는 방식.
- `supabase/functions/*` 엣지 함수(Deno). 공용은 `_shared/`.
- `tools/worker/` 노트북 24시간 실행기(Python). `worker_jobs` 큐를 잡아 실행. 심박 `worker_heartbeat`.
- `tools/kakao-pc/` PC 카톡 발송 중계(`outbox_relay.py`), 포스터 전송.
- `api/` Vercel 서버리스(네이버 캘린더 연동).
- `apps-script/`, `gas-and-bot/` GAS·메신저봇R 스크립트.

## 핵심 테이블 (자주 쓰는 것)
- `jeomgeom`(점검), `as_records`(AS): 한글 컬럼. `업체명`, `_업체명`(정규화), `시리얼넘버`, `자산기번`, `모델명`, `지역`, `작성일`, `_hidden`.
- `vendor_info`(임대리스트 원본, 읽기 전용): `_업체명`, `기번`, `시리얼번호(기번)`, `자산번호`, `모델명`, `기종`, `계약일`, `종료일`. 컬럼명에 괄호·슬래시 있어 PostgREST select는 큰따옴표 필요.
- `vendor_master`(거래처 코드 마스터), `service_receptions`(서비스접수), `outbox`(카톡 발송 대기: `room`, `text`), `room_activity`(방별 마지막 발송), `counter_sms_inbox`(마감방 문자 → 자동 반영), `worker_jobs`, `worker_heartbeat`.

## 카톡 발송 규칙
카톡으로 보내려면 `outbox`에 `{room, text}` 1행 insert. 메신저봇R이 7초 폴링으로 가져가고, 못 가져가면 노트북 `outbox_relay.py`가 PC 카톡으로 대신 보냄. 방 이름은 `room_activity.room`과 **정확히** 일치해야 함. 테스트는 `테스트 전용방`.

## 작업 규칙 (모든 에이전트 공통)
1. 다른 기능 파일은 건드리지 않는다. 새 기능은 새 파일 + 진입점(사이드바/라우트) 최소 수정.
2. 기존 테이블 컬럼은 바꾸지 않는다. 새 테이블은 `supabase/<기능>.sql`로 추가하고 RLS·grant 포함.
3. `npm run build`가 통과해야 끝. 테스트가 있으면 `npm test`.
4. 끝나면 이 파일 "작업 기록"에 날짜·요약·건드린 파일을 적는다.
5. 비밀값(키, 비밀번호)은 코드에 넣지 않는다. anon key는 이미 `src/supabase.ts`에 있음.

## 에이전트 팀 (역할)
`.claude/agents/` 에 역할 8개.
- 일하는 역할 5: ui-designer(화면 틀·일관성), debugger(원인 추적·재발 방지), feature-planner(설계·작업 분해, 코딩 안 함), qa-checker(빌드·테스트·범위·회귀 검사), db-schema(테이블·RLS·크론).
- 프로젝트 맞춤 검사기 3: field-deploy-check(배포 전 tsc 종료코드→테스트→빌드→비밀값, 배포 후 라이브 번들 문구 확인), sql-review(사용자가 SQL Editor에서 실행하기 전 권한·삭제·기존 표 변경·비밀키 검사), kakao-pc-rules(tools/kakao-pc 코드의 금지 단축키·안전 순서 강제).
Claude Code는 CLAUDE.md 규칙대로 자동 호출. Codex 등 다른 도구는 같은 역할 파일을 읽고 순서대로 흉내 내면 된다: 기획 → 디자인/DB → 구현 → QA → 배포 검사.

## 현재 진행 중 (2026-10-18)
- **이메일 카운터**: 복합기가 `count@firstoa.co.kr`로 보내는 카운터 메일(네이버 hee2gwang·hee3gwang 수신)을 어사이드가 매일 10시 정리해 `outbox`로 카톡 전송 중(DB 저장은 아직 없음). FIELD 저장·조회와 노트북 IMAP 수집은 **대표 승인 후 네이버 계정 IMAP 설정이 되면** 다시 지시서를 쓴다. 2026-10-18 지시서 3건은 사용자 지시로 삭제(기록은 git ce02b75).
- **고객용 QR AS 접수**: 보류(위와 같음).
- **카톡 발송 안정화**: `tools/kakao-pc/open_room.py` 렉 감지·재시작 패치 적용됨(2026-10-18). 노트북 반영은 bootstrap 한 줄 재실행.

## 작업 기록
- 2026-10-18 (Aside) AGENTS.md 신설. `docs/tasks/` 에 병렬 작업 지시서 3건 추가.
- 2026-10-18 (Aside) `.claude/agents/` 역할 5개 + `CLAUDE.md` 팀장 규칙 추가.
- 2026-10-18 (Claude Code) 검사기 역할 3개 추가(field-deploy-check·sql-review·kakao-pc-rules). `docs/tasks/` 지시서 3건 삭제(사용자 지시 — 이메일 카운터는 네이버 계정 승인 뒤 재개). 파일: .claude/agents/*.md, AGENTS.md.
- 2026-10-19 (Claude Code) 에이전트 팀 전반 점검(feature-planner+debugger) 후 4건 수정: ① 옛 뭄바이 프로젝트 키가 박힌 supabase/customer-message-cron.sql 삭제(대체는 customer-message-cron-seoul.sql) ② CsAsWorkspace 티켓 바꿀 때 제목 편집칸이 안 닫히던 도달 불가 코드 ③ "오늘/이번달"을 UTC로 자르던 9곳을 kstDate()로(DeptRequests·CopierNotes·ReadingHub·SelfDev·authors·ContactChangeHistory·entity360) ④ CounterSms 반영 표시·목록 삭제가 실패해도 화면은 성공처리하던 것을 실패 안내로. 남은 것(점검 결과): lint 72에러, RichCell innerHTML 소독, selectRows 타임아웃, 운영 DB RLS 실상태 확인, App.tsx 분할.
