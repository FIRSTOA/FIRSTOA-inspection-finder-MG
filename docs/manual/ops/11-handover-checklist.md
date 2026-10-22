# 11. 넘겨받는 사람의 첫날 체크리스트

> 순서대로 하면 하루 안에 "무엇이 어디서 돌고, 내가 무엇을 만질 수 있는지"가 확인된다.
> 각 항목 옆 괄호는 이 매뉴얼의 장. 체크하면서 막힌 것은 "(확인 필요)" 목록으로 남긴다.

## A. 읽기 (1시간)
- [ ] `docs/manual/ops/00-overview.md` 시스템 지도와 데이터 흐름 그림 (00)
- [ ] 저장소 `AGENTS.md` 전체 — 특히 "현재 진행 중"과 최근 "작업 기록" 20줄 (09)
- [ ] `CLAUDE.md` — AI 로 계속 작업한다면 (09)
- [ ] `docs/tasks/` 목록 — 진행 중 설계안과 사용자 답 대기 항목

## B. 계정 받기 (01)
- [ ] GitHub 조직 `FIRSTOA` 멤버 + 저장소 쓰기 권한
- [ ] Vercel 팀 멤버(`firstoa-inspection-finder-mg` 프로젝트 보임)
- [ ] Supabase 프로젝트 `kkdiihazgzesbqxjytqv` 멤버(SQL Editor·Edge Functions·Secrets 보임)
- [ ] 회사 구글 계정: 시트 문서들·`내 드라이브\FIRSTOA-백업`·GAS 프로젝트 4종 편집 권한
- [ ] 노트북 D6110 원격 접속 방법과 윈도우 계정
- [ ] 업무폰(봇) 위치·잠금 해제 방법, 카톡 봇 계정 비밀번호 보관 방식
- [ ] OpenAI·솔라피·카카오 개발자·네이버 개발자 콘솔 접근(키 재발급이 필요할 때)
- [ ] 그룹웨어 담당자(경영지원팀) 연락처 — SSO 허용목록·로그인 문제

## C. 개발 환경 (02)
- [ ] `git clone` → `npm ci` → `npx tsc -b` · `npx vitest run` · `npx vite build` 전부 통과(대문자 `C:\` 경로)
- [ ] `npm run dev` 로 로컬 화면 확인
- [ ] `npx vercel ls` 로 배포 목록이 보임(Vercel CLI 로그인)
- [ ] `npx supabase login` (PowerShell) → 엣지 함수 1개를 `--use-api` 로 배포할 수 있는지(변경 없이 재배포해도 됨) (05)
- [ ] 작은 문구 수정 1건으로 배포 → 라이브 확인 → `git revert` 까지 한 바퀴 (02)

## D. 살아 있는지 확인 — 읽기만 (03, 10)
SQL Editor 에서 10 장 "기본 점검 쿼리"를 돌려 아래를 본다.
- [ ] `worker_heartbeat` 최신 행 = `worker@D6110`, 1분 안
- [ ] `outbox` 대기 0 (낮 기준)
- [ ] `room_activity` 에 오늘 `bot_send` 와 `pc_send`
- [ ] `cron.job` 14개, 실패 기록 없음 (`kakao-bot-heartbeat` 는 꺼진 것이 현재 정상)
- [ ] 엣지 함수 25개 ACTIVE
- [ ] 어제 02:30 백업 폴더가 구글 드라이브에 있음(`FIRSTOA-백업\<어제 날짜>\manifest.json`)
- [ ] 어젯밤 시트 미러가 돌았음(`pc_expansion` 등의 최신 `_등록시각`)
- [ ] 권한 상태 쿼리(03 장 5절)를 한 번 돌려 결과를 저장해 둔다 — 나중에 비교 기준

## E. 현장 장비 직접 보기 (06, 07)
- [ ] 노트북: 작업 스케줄러 `FIRSTOA Worker` Running, 카톡 PC 봇 계정 로그인, 중계 대상 방 창이 열려 있음
- [ ] 노트북: 자격 증명 관리자에 `FIRSTOA_KAKAO` 존재(값은 보지 않는다), 자동 로그인 설정
- [ ] 업무폰: 메신저봇R 봇 "점검AS" 켜짐, 테스트 전용방에서 "봇테스트" → "봇 살아있음 OK"
- [ ] 업무폰 스크립트가 `gas-and-bot/supabase-outbox-poller.js` 최신판과 같은지(시작 로그의 판 날짜)

## F. 비밀값 인수 (01)
- [ ] 엣지 시크릿 이름 목록이 01 장 3절과 맞는지(값은 보지 않음)
- [ ] GAS 스크립트 속성 `SUPABASE_SERVICE_KEY` 를 가진 프로젝트의 **소유자·트리거 소유자**가 누구인지 → 필요하면 이전
- [ ] 전임자가 떠나면: Supabase·Vercel·GitHub 멤버 정리, 외부 API 키 재발급, 네이버 재연동 계획

## G. 저장소 밖에만 있는 지식 옮기기
- [ ] 전임자의 Claude Code 자동 메모리(개발 PC `%USERPROFILE%\.claude\projects\...\memory\*.md`)에 있는 운영 메모 중 필요한 것을 저장소 문서로 옮김 — 예: 실행 대기 SQL 목록, 카톡 PC 실측 규칙, 사용자 결정 이력
- [ ] 소스가 저장소에 없는 GAS(퍼스트전산 DB통합시트 부착 스크립트)의 사본 확보 (08)
- [ ] 폰 봇의 질의 봇들(happycall 등)이 지금도 쓰이는지 확인 (07)

## H. 지금 열려 있는 일 (2026-10-22 기준, AGENTS.md)
- [ ] 실행 대기 SQL: `supabase/vendor-info-dept.sql`(부서명 검색 생성 컬럼, 미실행 확인됨), `site-company.sql`(보류 초안), `okr-month-tidy-20261021.sql`·`fix-gni-region-e-20261021.sql`(실행 여부 확인 필요) (03 장 6절)
- [ ] 미정 카톡방 매핑: 미수|E, 불만|E, IT접수|*, 경영·운영·영업 접수 방 (07)
- [ ] 보안 과제: RLS 꺼진 표 4개(봇·실행기용) + `naver_oauth`, 공개 Storage 버킷, 쓰기 엣지 함수 공개 호출, SSO 2단계(JWT + RLS) 미착수 (03 장 5절)
- [ ] 서비스접수 시트 문서 링크 공개 여부 결정 (08)
- [ ] 사용자 답 대기 설계안: `docs/tasks/` 의 열린 결정(D·Q 번호)들

## I. 첫 주 안에
- [ ] 배포 1회, SQL handoff 1회(작은 것), 노트북 반영 1회를 직접 해 본다 (02, 04, 06)
- [ ] 10 장 사고 사례 중 하나를 골라 재현 없이 "어디를 보면 되는지"만 따라가 본다
- [ ] 이 매뉴얼에서 틀린 곳·바뀐 곳을 고친다(매뉴얼도 코드처럼 커밋)
