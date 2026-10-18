---
name: deploy
description: FIELD 배포 한 번에 — 작업 기록·검사·커밋(투입 줄)·푸시·라이브 확인·두 번째 복사본 동기화. 사용자가 "배포해줘", "올려줘", /deploy 라고 하면 이 순서대로.
---
# /deploy — FIELD 배포 절차

저장소 C:\Users\MYCOM\inspection-finder-MG, 기준 origin/main, Vercel 자동 배포(firstoa-inspection-finder-mg.vercel.app). 두 번째 복사본 "C:\Users\MYCOM\OneDrive\문서\New project\FIRSTOA-inspection-finder-MG" 은 ff-only 로만.

## 순서 (하나라도 실패하면 거기서 멈추고 고친 뒤 처음부터)
1. **상태 확인**: `git status --short`. 의도 밖 파일이 섞였으면 먼저 정리. `src/patchNotes.ts`·`src/agentWorkLog.ts` 는 빌드가 자동 생성하는 추적 파일이라 같이 올린다.
2. **QA**: 코드가 바뀐 작업이면 qa-checker(품질실 검수아, model sonnet)를 먼저. 실패면 배포하지 않는다.
3. **배포 전 검사**: field-deploy-check(검사실 배포준, model haiku) — tsc 종료코드 → vitest → vite build → 비밀값 → 범위(docs/tasks 지시서). "실패"면 멈춘다. 지시서가 낡아 범위 위반으로 막히면 지시서에 "N차(사용자 지시)" 절을 덧붙이고 재검사.
4. **작업 기록**: AGENTS.md "작업 기록"에 날짜·요약·파일 한 줄(아직 안 적었으면).
5. **커밋**: 제목은 한국어로 "무엇이 어떻게 바뀌었나". 본문에 bullet, **마지막 두 줄은 반드시**
   ```
   투입: 이름, 이름        ← 이번 작업에 투입된 직원(한설계·윤화면·표다빈·구현서·오류진·검수아·배포준·권한나·방지훈·감시연). 팀장만 했으면 "투입: 클로드"
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   ```
   (`투입:` 줄은 홈 "FIELD AI 에이전트 팀" 카드의 '한 일'로 자동 집계된다.)
6. **푸시**: `git push origin main`.
7. **배포 후 검사**: field-deploy-check 에게 "배포 후 항목만" — 라이브 번들에 이번 변경의 고유 문구가 있는지(반영 전이면 60초 간격 최대 5회), 두 번째 복사본 `pull --ff-only` 로 HEAD 일치.
8. **보고**(한국어): 바뀐 것 / 안 바뀐 것 / 사용자가 확인할 것(브라우저로 못 봤으면 그렇다고). 커밋 해시 1개.

## 금지
- `--no-verify`, `push --force`, `reset --hard`. 두 번째 복사본에 강제 동작.
- 검사를 `| tail` 로 파이프해 종료코드를 숨기는 것(실사고).
- SQL 파일을 새로 만든 배포면 sql-review 없이 사용자에게 "실행하세요"라고 하지 않는다 → /sql-handoff.
