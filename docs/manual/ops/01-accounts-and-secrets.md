# 01. 계정과 비밀값 — 어디에 무엇이 있나

> **이 문서에는 값을 절대 적지 않는다.** 위치와 이름만 적는다. 값이 필요하면 해당 콘솔에서 직접 본다.
> 넘겨받을 때 "누가 로그인할 수 있는가"를 이 표 순서대로 확인하고, 사람이 바뀌면 비밀번호·토큰을 새로 발급한다.

## 1. 계정(콘솔) 목록

| 서비스 | 식별자(공개 정보) | 들어가는 곳 | 비고 |
|---|---|---|---|
| GitHub | 조직 `FIRSTOA`, 저장소 `FIRSTOA/FIRSTOA-inspection-finder-MG` | github.com | 노트북 bootstrap 이 토큰 없이 raw URL 로 받으므로 저장소는 공개로 보임 (확인 필요: 공개/비공개 여부). 데스크톱 git 사용자 이름은 `httq9302-svg` |
| Vercel | 프로젝트 `firstoa-inspection-finder-mg`, 팀 `firstoas-projects` | vercel.com | GitHub `main` 연결 자동 배포. 로컬 링크 정보는 `.vercel/`(gitignore) |
| Supabase | 프로젝트 ref `kkdiihazgzesbqxjytqv`, URL `https://kkdiihazgzesbqxjytqv.supabase.co`, 서울 리전(확인 필요) | supabase.com/dashboard | 요금제 Pro(Micro) — 메모 근거, (확인 필요) |
| Google (회사 계정) | 시트·드라이브·GAS 소유 계정 (확인 필요: 계정 주소) | drive / script.google.com | GAS 4종 + 시트 부착 1종, 백업 폴더 `내 드라이브\FIRSTOA-백업` |
| Google Cloud 서비스 계정 | 엣지 시크릿 `GOOGLE_SERVICE_ACCOUNT`(JSON) 안의 client_email | console.cloud.google.com (확인 필요: 프로젝트 이름) | 이 이메일이 FIELD 가 쓰는 시트마다 **편집자로 공유**돼 있어야 함 |
| 네이버 개발자센터 | 캘린더 앱 1개 | developers.naver.com | 토큰은 DB 표 `naver_oauth`(서버 전용). 연동 계정 = 팀 캘린더 주인 계정(확인 필요) |
| 솔라피(문자) | 발신번호 1개 | solapi.com | 엣지 `customer-message-send` |
| OpenAI | API 키 1개 | platform.openai.com | 엣지 AI 함수 12개 + GAS First-DATA |
| 카카오 개발자 | REST 키 1개 | developers.kakao.com | 엣지 `geocode`·`place-search` 의 주소/장소 검색 |
| 카카오톡 봇 계정 | 업무폰에 로그인된 카톡 계정 = 노트북 카톡 PC 계정 | 업무폰, 노트북 | 노트북 자동 로그인용 비밀번호는 윈도우 자격 증명(아래 5절) |
| 그룹웨어 | https://firstoa-groupware.vercel.app | 경영지원팀 소유 | FIELD 도메인 허용목록 등록은 그룹웨어 담당자가 함. 우리 쪽 비밀값 없음 |
| Anthropic / Claude Code | 개발 PC 에 로그인 | — | 09 장 |

## 2. Supabase anon 키 — 공개값이다
- anon 키는 브라우저 번들에 들어가므로 **비밀이 아니다**. 저장소의 아래 파일에 그대로 들어 있다:
  `src/supabase.ts`, `tools/worker/config.py`, `gas-and-bot/supabase-outbox-poller.js`, `apps-script/first-data/src/Supabase.gs`, 그리고 `supabase/*-cron.sql` 의 `Authorization: Bearer` 헤더.
- 보안은 키가 아니라 **권한(grant)과 RLS** 가 담당한다(03 장 5절). 로그인(SSO)은 화면 잠금일 뿐 데이터 보호가 아니다.
- anon 키를 교체(JWT secret 재발급)하면 위 5곳 + 업무폰 봇 + 노트북 + GAS + cron 전부를 바꿔야 한다. 하지 말 것(필요하면 계획부터).
- **service_role 키는 절대 저장소·프런트·노트북에 두지 않는다.** 지금 있는 곳: 엣지 함수 기본 환경(`SUPABASE_SERVICE_ROLE_KEY`, Supabase 가 자동 주입), GAS 스크립트 속성 `SUPABASE_SERVICE_KEY`.

## 3. Supabase 엣지 함수 시크릿 (이름만)
위치: Supabase 대시보드 → Edge Functions → Secrets (또는 `npx supabase secrets list --project-ref kkdiihazgzesbqxjytqv`).
Vault(`vault.secrets`) 는 **[라이브] 비어 있음** — 시크릿은 전부 엣지 시크릿에 있다.

| 이름 | 쓰는 함수 | 비고 |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | 거의 전부 | Supabase 자동 주입 |
| `GOOGLE_SERVICE_ACCOUNT` | field-sheet-sync, contact-sheet-pull, reception-sheet-open, weekly-keyman-poster | 서비스 계정 JSON 통째 |
| `FIELD_SHEETS_WEBHOOK_URL`, `FIELD_SHEETS_WEBHOOK_SECRET` | field-sheet-sync | 옛 GAS 웹훅 경로(지금은 Sheets API 직접, 남은 사용 여부 확인 필요) |
| `FIELD_SHEET_AI_MODEL` | field-sheet-sync | 모델 이름 |
| `OPENAI_API_KEY` | counter-ocr, data-ask, entity-ask, field-sheet-sync, golden-card-transform, growth-note-transform, guide-tag, okr-assist, place-search, playbook-draft, quarter-result-quantify, report-polish | |
| `OPENAI_MODEL`, `OPENAI_ASK_MODEL`, `OPENAI_GOLDEN_MODEL`, `OPENAI_GUIDE_TAG_MODEL`, `OPENAI_OKR_MODEL`, `OPENAI_PLAYBOOK_MODEL`, `OPENAI_REPORT_MODEL`, `OPENAI_RESULT_MODEL`, `OPENAI_VISION_MODEL` | 각 AI 함수 | 모델 선택(없으면 코드 기본값) |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `NAVER_REFRESH_TOKEN`, `NAVER_CALENDAR_ID` | naver-calendar-push/sync | refresh token 은 지금 `naver_oauth` 표 우선(supabase/naver-calendar-setup.md 운영 메모) |
| `NAVER_CALDAV_ID`, `NAVER_CALDAV_APP_PASSWORD`, `NAVER_CALDAV_DEFAULT_CALENDAR` | naver-calendar-push/sync | 네이버 2단계 인증 + 애플리케이션 비밀번호 |
| `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER` | customer-message-send | |
| `CUSTOMER_MESSAGE_WEBHOOK_URL` | customer-message-send | GAS 고객 메시지 웹훅 |
| `KAKAO_REST_KEY` | geocode, place-search | |
| `VAPID_KEYS_JWK`, `VAPID_SUBJECT` | push-send | 웹푸시 키쌍. 바꾸면 기존 구독(push_subscriptions) 무효 |
| `KEYMAN_POSTER_FOLDER` | weekly-keyman-poster | 드라이브 폴더 |
| `APP_URL` | (확인 필요) | 앱 주소 |

## 4. Vercel 환경 변수 (이름만)
위치: Vercel → 프로젝트 → Settings → Environment Variables. 코드에서 읽는 이름:
- 서버리스 `api/`: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `NAVER_REFRESH_TOKEN`, `NAVER_CALENDAR_ID`, `CALENDAR_ICS_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- 빌드 시 프런트: `VITE_AI_TRANSFORM_URL`, `VITE_IT_TECH_API_URL` (없으면 코드 기본값, 확인 필요)
- 실제로 등록돼 있는지는 (확인 필요) — `npx vercel env ls` 로 이름 목록을 본다.

## 5. 노트북(D6110) 에 있는 것
| 이름 | 위치 | 내용 | 만드는 법 |
|---|---|---|---|
| `FIRSTOA_KAKAO` | 윈도우 자격 증명 관리자 → Windows 자격 증명 → 일반 자격 증명 | 카톡 봇 계정 아이디·비밀번호 | `tools\kakao-pc\save_kakao_cred.ps1` 를 사람이 실행해 입력(화면·파일·로그에 안 남음). 실행하면 자동 로그인 실패 횟수(`kakao_login_state.json`)도 초기화 |
| 환경 변수 `FIRSTOA_BACKUP_ROOT` / `FIRSTOA_RELAY` / `FIRSTOA_POSTER` / `FIRSTOA_WORKER_NAME` / `FIRSTOA_SUPABASE_URL` | 사용자 환경 변수(선택) | 백업 폴더·기능 끄기 | 06 장 |
| 윈도우 자동 로그인 | `netplwiz` | 노트북 계정 비밀번호 | 정전 뒤 재부팅 대비 |
| 백업 파일 | `내 드라이브\FIRSTOA-백업\<날짜>\` | **고객 정보 포함** | git 에 올리지 말 것 |

## 6. GAS 스크립트 속성 (이름만)
위치: 각 Apps Script 프로젝트 → 프로젝트 설정 → 스크립트 속성.
- First-DATA: `SUPABASE_SERVICE_KEY`(service_role — 미러 전체 교체·임대리스트 증분에 필요), `OPENAI_API_KEY`, `KAKAO_JOB`(작업 상태용, 확인 필요), `LEASE_SUPABASE_SYNC_LAST`(마지막 동기화 시각)
- FIELD 시트 동기화 웹앱(`apps-script/field-sheet-sync.gs`): `FIELD_SYNC_SECRET` (= 엣지 `FIELD_SHEETS_WEBHOOK_SECRET` 과 같은 값)
- 주의: `apps-script/first-data/src/WebappSave.gs` 의 `WEBAPP_BOT_TOKEN` 은 코드 상수(옛 점검 저장 경로) — 지금 쓰는지 (확인 필요).

## 7. 개발 PC 에 있는 로그인 토큰 (출력·복사 금지)
- Supabase CLI: `npx supabase login` 결과가 윈도우 자격 증명 관리자에 저장. 엣지 함수 배포 가능, `supabase secrets set` 은 이 셸에서 실패한 적 있음(대시보드에서 넣을 것).
- Vercel CLI: `%APPDATA%\com.vercel.cli\` 의 auth 파일.
- clasp(GAS 배포): `npx clasp login` 결과 `~/.clasprc.json` (확인 필요).
- Supabase MCP(Claude Code): `.mcp.json` — 읽기 전용, OAuth 로그인은 Claude Code 에서 `/mcp`.
- `.env.local` 에는 Vercel CLI 가 만든 OIDC 토큰만 있다(gitignore).

## 8. 사람이 바뀔 때 갈아야 할 것 (우선순위)
1. Supabase 대시보드 멤버, Vercel 팀 멤버, GitHub 조직 멤버 정리
2. GAS 스크립트 속성 `SUPABASE_SERVICE_KEY` 를 가진 구글 계정 소유권 이전(GAS 는 소유자 계정으로 실행됨)
3. OpenAI·솔라피·카카오 키 재발급 → 엣지 시크릿 교체
4. 네이버 연동 재발급(10-troubleshooting.md "네이버만 안 올라감")
5. 노트북 `FIRSTOA_KAKAO` 재저장(카톡 비밀번호를 바꿨다면)
