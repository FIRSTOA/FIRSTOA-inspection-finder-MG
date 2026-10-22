# 02. 배포 — 코드를 라이브에 올리기

> 근거: `.claude/skills/deploy/SKILL.md`(AI 용 절차서), `package.json`, `vercel.json`, CLAUDE.md. 이 장은 같은 절차를 사람용으로 옮긴 것.

## 구조
- 기준 코드 = **GitHub `origin/main`**. Vercel 이 `main` 푸시마다 자동으로 빌드·배포한다.
- 라이브 주소: https://firstoa-inspection-finder-mg.vercel.app
- 빌드 명령 `npm run build` = `prebuild`(패치노트 생성 `scripts/gen-patch-notes.mjs` + `vitest run`) → `tsc -b` → `vite build`.
  즉 **테스트가 하나라도 실패하면 Vercel 빌드도 실패**한다.
- 빌드가 커밋 메시지로 `src/patchNotes.ts`·`src/agentWorkLog.ts` 를 다시 만든다(추적 파일, 같이 커밋).
- 커밋 **제목 = 사용자에게 보이는 패치노트**. 한국어로 "무엇이 어떻게 바뀌었나".
- 엣지 함수·SQL·GAS·봇·노트북은 이 배포와 **따로** 반영된다(05·04·08·07·06 장).

## 개발 PC 준비
- Node 24(Vercel 설정 nodeVersion 24.x), `npm ci`.
- 작업 폴더: `C:\Users\MYCOM\inspection-finder-MG`. 두 번째 복사본 `C:\Users\MYCOM\OneDrive\문서\New project\FIRSTOA-inspection-finder-MG` 은 `git pull --ff-only` 로만 맞춘다(다른 기기와 동기화될 수 있음).
- 작업 전 `git fetch origin && git status -sb` 로 뒤처지지 않았는지 확인(뒤처진 복사본을 최신으로 착각한 사고가 있었다).
- 테스트는 대문자 `C:\` 경로에서 돌린다(소문자 `/c/` 경로에서 vitest 가 모듈을 두 번 읽는 오류).

## 순서 (하나라도 실패하면 멈추고 고친 뒤 처음부터)
1. **상태 확인** `git status --short` — 의도 밖 파일이 섞였으면 정리.
2. **검사** (종료 코드를 숨기지 말 것 — `| tail` 로 파이프하면 실패가 성공처럼 보인 실사고가 있다)
   ```
   npx tsc -b
   npx vitest run
   npx vite build
   ```
   로컬 확인에는 `npm run build` 대신 위 세 줄을 쓴다(`npm run build` 는 patchNotes.ts 를 다시 만든다).
   비밀값 검사: 바뀐 파일에 service_role 키·비밀번호·외부 API 키가 없는지.
3. **작업 기록** — `AGENTS.md` "작업 기록"에 날짜·요약·파일 한 줄. 평가용 `docs/eval/2026-Q4-worklog.md` "날짜별 기록"에 한 항목(한 일·왜·효과 숫자·근거).
4. **커밋** — 제목 한국어. 본문 bullet. 본문 마지막 줄 규칙:
   ```
   투입: 이름, 이름
   Co-Authored-By: ...
   ```
   `투입:` 줄은 홈 "FIELD AI 에이전트 팀" 카드의 '한 일'로 자동 집계된다(09 장). 사람이 직접 고쳤으면 사람 이름을 적어도 된다.
5. **푸시** `git push origin main`.
6. **라이브 확인**
   - 1~3분 뒤 라이브 페이지를 새로고침(index.html 은 no-cache 설정, `vercel.json`).
   - 이번 변경의 고유 문구가 번들에 있는지 확인. 화면마다 lazy 청크가 따로라 `dist/assets` 에서 `grep -l "문구"` 로 청크 이름을 먼저 찾고 라이브의 같은 이름 청크를 본다.
   - 반영 전이면 60초 간격으로 최대 5회.
   - 두 번째 복사본 `git pull --ff-only` 로 HEAD 를 맞춘다.
7. **보고** — 바뀐 것 / 안 바뀐 것 / 사용자가 확인할 것.

## 금지
- `git push --force`, `git reset --hard`, `--no-verify`.
- SQL 파일을 새로 만든 배포에서 검사 없이 "실행하세요" 안내 → 04-sql-handoff.md 를 따른다.
- 앱이 새 표를 쓰는 기능이면 **앱 먼저 배포 → SQL 실행** 순서인지, 반대인지 설계안에 적힌 대로(예: OKR 은 앱 먼저). 앱은 표가 없으면 안내 띠를 띄우게 만들어 두는 것이 이 프로젝트의 관례다.

## Vercel 이 배포를 안 했을 때 (다시 밀기)
증상: 푸시했는데 라이브가 옛 화면. 확인·조치 순서:
1. `npx vercel ls` — 최신 배포가 Ready / Error / Queued 중 무엇인지.
2. **Error** 면 빌드 로그 확인. 대개 테스트 실패(prebuild 에 vitest 포함) → 고쳐서 다시 푸시.
   `git_info_fail` 처럼 Vercel 쪽 git 가져오기 실패(일시적)면 같은 소스를 재배포:
   `npx vercel redeploy <실패한 배포 URL> --non-interactive --no-wait`
3. **아예 배포가 안 생김**(건너뜀) 이면: Vercel 대시보드 → Deployments 에서 최신 커밋 확인 → 없으면 대시보드 "Redeploy" 또는 빈 커밋으로 다시 밀기 `git commit --allow-empty -m "배포 다시 밀기"` → push. (Vercel 의 Ignored Build Step 설정 여부는 확인 필요)
4. **대기열이 느릴 때** 빠른 경로(폴더가 프로젝트에 링크돼 있어야 함, `.vercel/`):
   ```
   npx vercel build --prod
   npx vercel deploy --prebuilt --prod --yes
   ```
   이때도 `git push` 는 평소대로 해서 origin/main 과 라이브가 같은 커밋이 되게 한다.

## 되돌리기
- 가장 안전: 문제 커밋을 `git revert <해시>` → 푸시(새 배포).
- 급할 때: Vercel 대시보드 → Deployments → 직전 정상 배포 → "Promote to Production"(즉시). 그 뒤 반드시 git 도 revert 해서 맞춘다(안 맞추면 다음 푸시에 문제 코드가 다시 나간다).

## AI 로 배포할 때
Claude Code 에서 "배포해줘" 또는 `/deploy` 라고 하면 위 순서를 검사 역할(검수아·배포준)과 함께 자동으로 한다(09 장).
