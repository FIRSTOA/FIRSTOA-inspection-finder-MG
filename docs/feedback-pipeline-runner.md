# 피드백 보드 → 자동 개발 파이프라인 (설계·루틴 프롬프트)

홈 피드백 보드(`src/FeedbackBoard.tsx`, 테이블 `feedback_items`)에서 개발자가 **[개발 시작]**을 누른 항목(`status=confirmed`)을
Claude Code **클라우드 루틴**이 주기적으로 가져가 브랜치에 구현·테스트·푸시하고 결과를 보드에 되돌려 쓴다.

## 상태 흐름
`new 접수 → triaged 개발자 확인 → confirmed 개발 대기 → in_progress 개발 중 → review 미리보기 확인 → deploy 배포 요청 → done 반영 완료`
`rejected 반려`(사유 = dev_comment) · 삭제는 `deleted_at`(소프트). `auto_deploy=true`면 review를 건너뛰고 main까지 바로.

## 전제 조건 (사람이 한 번)
1. **GitHub를 Claude 계정에 연결** — https://claude.ai/connect-github (연결 전에는 클라우드에서 저장소를 복제할 수 없어 루틴을 만들 수 없다)
2. 루틴 환경: Default(`env_01Lt4kuwQcSyk3VJP45Ni6Vq`, anthropic_cloud). 최소 주기 1시간.
3. 루틴은 anon 키로 Supabase REST를 읽고 쓴다(feedback_items는 anon select/insert/update 허용). service_role은 절대 넣지 않는다.
4. Vercel은 브랜치를 푸시하면 미리보기가 자동 생성된다: `https://firstoa-inspection-finder-mg-git-<브랜치를 소문자·하이픈으로>-firstoas-projects.vercel.app/` (배포 보호 켜져 있어 Vercel 로그인 필요).

## 루틴 설정(초안)
- 이름: `feedback-dev-runner` · cron `0 * * * *`(매시, UTC) · 모델 claude-sonnet-5(비용) 또는 claude-opus-5(품질) — 개발 작업이라 opus 권장
- sources: `https://github.com/FIRSTOA/FIRSTOA-inspection-finder-MG` · allowed_tools: Bash, Read, Write, Edit, Glob, Grep

## 루틴 프롬프트(그대로 넣는다)
```
너는 퍼스트전산 CS 웹앱(FIRSTOA-inspection-finder-MG, React+TS+Vite, Supabase) 저장소의 자동 개발 루틴이다. 매 실행마다 아래를 정확히 따른다.

0. 준비: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` 가 있으면 실행. `npm ci`. 저장소 CLAUDE.md·docs/walkingmap-audit-2026-09-12.md를 읽는다.
   Supabase REST 상수: URL https://kkdiihazgzesbqxjytqv.supabase.co, anon 키는 src/supabase.ts의 SUPABASE_ANON 값을 그대로 사용(헤더 apikey·Authorization: Bearer).

1. 큐 읽기: GET /rest/v1/feedback_items?status=in.(confirmed,deploy)&deleted_at=is.null&order=confirmed_at.asc&limit=3
   - 없으면 "큐 비어 있음"으로 끝낸다.

2. status=deploy 항목(배포 요청): 해당 branch를 origin/main에 merge(충돌 시 중단·result_note에 기록·status=review 유지) → `npm run build`·`npx vitest run` 통과 시 push origin main → PATCH status=done, done_at=now, result_note 뒤에 " · main 반영 완료 <해시>" 추가.

3. status=confirmed 항목(개발 대기): 한 실행에 최대 2건, 오래된 것부터.
   a. PATCH status=in_progress, started_at=now, run_log="시작 <시각>".
   b. 브랜치 `feedback/<id>`를 origin/main에서 생성. dev_prompt(개발자 지시)를 요구사항으로, content(직원 원문)·screen·dev_comment를 맥락으로 삼아 구현한다.
      규칙: 기존 코드 스타일·주석 밀도 유지 / 판정·파서 수정 시 tests/에 테스트 추가 / DB 스키마·크론·엣지 함수·비밀키는 건드리지 않고 필요하면 result_note에 "사람 작업 필요: …"로 남긴다 / 지시가 애매하거나 두 가지로 해석되면 구현하지 말고 status=triaged로 되돌리고 dev_comment 뒤에 "[루틴 질문] …"을 덧붙인다.
   c. `npm run build`와 `npx vitest run`이 통과해야 한다. 실패하면 고치고, 3회 안에 못 고치면 status=triaged, result_note="자동 개발 실패: <이유 요약>", run_log에 에러 요지.
   d. 커밋 메시지: "<한 줄 요약> — 피드백 #<id> (<author>)" + 본문에 무엇을 왜 바꿨는지 2~4줄 + 마지막 줄 "Co-Authored-By: Claude <noreply@anthropic.com>". push origin feedback/<id>.
   e. 미리보기 URL = https://firstoa-inspection-finder-mg-git-feedback-<id>-firstoas-projects.vercel.app/
   f. auto_deploy=false: PATCH status=review, branch, commit_ref=<해시>, preview_url, result_note="<사용자가 읽을 2~3문장: 무엇이 어떻게 바뀌는지, 확인 방법>", run_log=<요약>.
      auto_deploy=true: 2번 절차로 곧장 main에 합치고 push → status=done, done_at, commit_ref, result_note.

4. 절대 하지 않을 것: main에 빌드 실패 커밋 / 지시 밖의 큰 리팩터링 / 테스트 삭제 / .env·키 노출 / feedback_items 외 다른 테이블 데이터 변경.
5. 끝날 때 한 줄 요약을 출력한다: 처리 N건(성공 a·질문 b·실패 c), 배포 d건.
```

## 이 세션(로컬)에서 수동으로 돌리기
GitHub 연결 전에는 팀장님이 "개발 대기 처리해줘"라고 하면 내가 위 절차를 이 세션에서 그대로 수행한다(같은 프롬프트).
