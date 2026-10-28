# 05. 엣지 함수 (Supabase Edge Functions, Deno)

> 소스: `supabase/functions/<이름>/index.ts`, 공용 코드 `supabase/functions/_shared/`.
> **[라이브]** 2026-10-22 MCP `list_edge_functions` — 25개 전부 ACTIVE, 저장소 폴더 25개와 이름이 1:1 로 일치.
> 웹앱이 부를 때는 `src/supabase.ts` 의 `invokeEdgeFunction(name, body)` (anon 키로 Authorization).

## 목록
| 함수 | 버전[라이브] | 누가 부르나 | 하는 일 | 쓰는 시크릿(01 장) |
|---|---|---|---|---|
| field-sheet-sync | 26 | 앱(저장 직후) + cron `field-sheet-retry` 2분 | FIELD 기록 → 구글 시트 기입(확장성 IT·복합기, 담당자변경, 불만, 칭찬, 서비스접수 복합기·원격·영업·경영). 큐 `field_sheet_sync_jobs`, 5회 재시도 | GOOGLE_SERVICE_ACCOUNT, OPENAI |
| reception-sheet-open | 1 | 앱(스위치 `RECEPTION_SHEET_OPEN_ENABLED`) | 접수 시트(영업·경영·원격/IT 탭) 상태를 읽어 미처리 판정, 60초 캐시, 전화번호 미반환 | GOOGLE_SERVICE_ACCOUNT |
| contact-sheet-pull | 9 | cron 3분·매일 10:00·월 09:30 | 담당자변경 시트(키맨체크) → `contact_changes` 역방향, 새 변경을 방에 공유(10시 전 보류) | GOOGLE_SERVICE_ACCOUNT |
| weekly-keyman-poster | 50 | cron 월 10:30(안전망), 앱 | 주간 키맨·주소 변경 포스터. 노트북이 이미 보낸 주는 `app_config.KEYMAN_POSTER_SENT` 로 건너뜀 | GOOGLE_SERVICE_ACCOUNT, KEYMAN_POSTER_FOLDER |
| naver-calendar-push | 27 | 앱(일정 등록·수정·삭제) | 네이버 캘린더 등록 + CalDAV 조회·수정·삭제·이동 | NAVER_* |
| naver-calendar-sync | 27 | cron 매분(내부 20초×3) | 네이버 → `as_tickets`·`naver_calendar_events` 회수, 완료 → `service_receptions` 완료 | NAVER_* |
| customer-message-send | 18 | cron 매분(예약 발송)·매일 23:50(이력 가져오기), 앱 | 솔라피 문자·알림톡 발송/이력 | SOLAPI_*, CUSTOMER_MESSAGE_WEBHOOK_URL |
| counter-inbox-ingest | 3 | cron 2분, 봇·앱 | 봇이 넣은 마감방 목록(`counter_sms_inbox`) → 팀 카운터 목록 반영 + 웹푸시 | — |
| counter-ocr | 3 | 앱(스위치 FIELD_OCR) | 카운터·토너 사진 읽기 | OPENAI |
| push-send | 2 | cron 파수꾼·다른 함수 | 웹푸시 발송(`push_subscriptions`) | VAPID_* |
| photo-drive-archive | 5 | cron 매시 25분 | 오래된 사진을 드라이브로 옮기고 Storage 비움. GAS `photoarchive` 에 관리 토큰을 붙여 부름(2026-10-24, 재배포 필요) | FIELD_ADMIN_TOKEN |
| gas-admin | 새(2026-10-24, 배포 대기) | 앱 관리 탭 [카톡 수집] | GAS 관리 동작 중계: ingestnow·retryheld·kakaoclear 만. 토큰을 붙여 GAS 를 부름 | FIELD_ADMIN_TOKEN |
| photo-archive-organize | 10 | 앱 | 사진 앨범 정리 | (확인 필요) |
| record-edit | 1 | 앱 조회 탭 | 기록 수정·숨김 대행(anon 은 원장 표 update 권한 없음) | service role |
| report-view | 2 | 고객(문자 링크) | 고객용 리포트 공개 페이지. **verify_jwt = false**(유일) | — |
| geocode | 6 | 앱 | 주소 → 좌표(카카오 → OSM) | KAKAO_REST_KEY |
| place-search | 9 | 앱(맛동여지도) | 장소 자동 채우기 | KAKAO_REST_KEY, OPENAI |
| entity-ask / data-ask | 6 / 12 | 앱 통합검색 | 업체 질문 / 전체 데이터 질문(AI). 사용량은 `ai_usage` 에 기록 | OPENAI |
| kakao-ingest | 새(2026-10-24, 배포 대기) | GAS `KakaoRaw.gs`(드라이브 수신함 처리 뒤) | 카톡 내보내기 TXT 조각(≤500KB) → `kakao_messages`(가림·분류 추정·hash 중복 무시) + `kakao_import_log`. 헤더 `x-ingest-token` 검사 | FIELD_INGEST_TOKEN |
| kakao-search | 새(2026-10-24, 배포 대기) | 앱 탭 검색 [카톡 대화] | `kakao_messages` 읽기 대행(anon 권한 0 인 표). 스위치 `KAKAO_SEARCH_ENABLED` 꺼지면 빈 결과 | — |
| report-polish, golden-card-transform, growth-note-transform, guide-tag, playbook-draft, okr-assist, quarter-result-quantify | 2~14 | 앱 | 각종 AI 문장 다듬기·태깅·초안 | OPENAI |

Vercel 서버리스(`api/`, 엣지 함수 아님): `naver-connect.js`·`naver-callback.js`(네이버 OAuth 연결), `naver-add.js`, `naver-calendars.js`, `calendar-ics.js`(ICS 구독, `CALENDAR_ICS_TOKEN`). Vercel 배포와 함께 나간다.

## 배포
Docker 없이 API 로 올린다. 개발 PC 에서 Supabase CLI 로그인(`npx supabase login`, PowerShell 에서 — Git Bash 에선 로그인 창이 깨진 적 있음) 후:
```
npx supabase functions deploy <함수이름> --project-ref kkdiihazgzesbqxjytqv --use-api
```
- `_shared/` 를 고쳤으면 그것을 import 하는 함수를 **모두** 다시 배포한다(`grep -rl "_shared/<파일>" supabase/functions`).
- `report-view` 처럼 공개 함수는 `--no-verify-jwt` 가 필요하다(현재 설정 유지, 확인 필요: 배포 때 플래그를 빠뜨리면 공개 링크가 401).
- 배포는 git 푸시와 별개다. 커밋 메시지·AGENTS.md 에 "엣지 재배포 필요/완료"를 적는다.
- 확인: 대시보드 → Edge Functions → 해당 함수 버전 번호가 올라갔는지, Logs 에 오류가 없는지. AI 는 MCP `list_edge_functions` 로 버전을 본다.

## 시크릿 넣기
대시보드 → Edge Functions → Secrets 에서 추가(권장). CLI `npx supabase secrets set NAME=... --project-ref kkdiihazgzesbqxjytqv` 는 이 개발 PC 셸에서 실패한 적이 있다.

## 시험
- Deno 테스트 파일이 있는 함수: `field-sheet-sync/dept-sheets_test.ts` 등 — `deno test` (Deno 설치 필요, 확인 필요).
- 일부 함수는 dry 모드가 있다. 예: weekly-keyman-poster `{"action":"run","dry":true,"region":"C"}`, customer-message-send `import_history` 의 `dry`.
- 로그: 대시보드 → Edge Functions → Logs, 또는 MCP `query_logs`(source `function_edge_logs`).

## 주의
- 엣지 함수는 `SUPABASE_SERVICE_ROLE_KEY` 로 DB 를 쓰므로 RLS 를 우회한다. 입력 검증은 함수 안에서 한다.
- **쓰기 엣지 함수가 anon 키로 누구나 호출 가능**한 상태는 2026-10-10 감사에서 "결정 대기"로 남아 있다(메모 근거, 확인 필요).
- 카톡을 만드는 함수(공유·포스터)는 KST 10시 전 보류 가드를 지킨다.
- naver-calendar-sync 가 수입하는 일정의 업체명(`as_tickets.vendor`)은 2026-10-24부터 제목에서 뽑은 **고객사만**(`_shared/ticket-title.ts` 의 `importedTicketVendor`, 웹앱 `src/ids.ts` 와 같은 파서), 전체 제목은 `calendarTitle`(200자) — 제목 파서를 고치면 이 함수도 다시 배포한다. 그 전에 들어온 일정은 vendor 에 제목 앞 80자가 남아 있다.

## field-sheet-sync — 상태만 갱신(statusOnly, 2026-10-25)
미처리 행의 [완료]·[보류]·[배정]이 접수 시트(해지방어접수=영업팀·경영지원접수·원격)에 상태를 적는 경로다(설계 docs/tasks/unhandled-actions-2026-10-25.md 3-2). 잡은 `field_sheet_sync_jobs` 에 기존 category(reception_sales·reception_mgmt·reception_remote) 그대로, payload 는 `{statusOnly:true, sheetRow, seq, vendorHead, status?, handler?}`(최상위 또는 payload.data). 엣지(`field-sheet-sync/sheet-status.ts`, 순수 규칙 `_shared/sheet-status.ts`, 열 위치는 `reception-sheet-open/state.ts` SHEET_LAYOUTS)는 잠금을 잡고 G열 머리를 확인한 뒤, 그 행의 **순번(A)과 상호(영업·경영 P, 원격 R) 앞 6자가 둘 다 맞을 때만** 상태 G열과 처리자 칸(영업·경영 F, 원격 K)을 쓴다. 행 번호가 밀렸으면 순번으로 아래→위 검색, 그래도 못 찾으면 쓰지 않고 잡을 바로 failed(HTTP 409, last_error 에 기대/실제 순번·상호). 이미 같은 값이면 쓰지 않고 synced. 허용 값은 영업·경영 진행중·처리완료·보류·취소, 원격 처리완료·접수취소·재접수·자체해결·AS이관·중복접수·방문이관(원격에는 보류 없음 — 앱이 보류 단추를 숨긴다); 그 밖의 값은 잡 failed + HTTP 400. 접수일·접수·접수자를 비롯한 다른 칸, 새 행은 절대 쓰지 않는다(기존 원격 갱신 경로는 접수일을 오늘로 덮으므로 이 잡에서는 쓰지 않음). FIELD_SHEET_SYNC_ENABLED 가 꺼져 있거나 FIELD_SHEET_TEST_MODE 가 켜져 있으면 held. 잠금 대기·API 오류 같은 일시 실패만 기존처럼 재시도 크론이 이어 받는다. 테스트: tests/sheetStatusWrite.test.ts.

## 카톡 원문 보관 — kakao-ingest · kakao-search (2026-10-24)
설계: docs/tasks/kakao-collect-expand.md 3-5, docs/tasks/tab-search-kakao-history.md 3-2. 표: supabase/kakao-messages-20261024.sql(kakao_messages·kakao_import_log), supabase/kakao-collect-rooms-20261024.sql(수집 방). 공용 파서: `_shared/kakao-parse.ts`(테스트 tests/kakaoParse.test.ts).

**흐름**: 노트북 매크로 → 드라이브 수신함 → GAS `ingestFromDriveFolder`(Drive.gs) → `kakaoRawForward_`(KakaoRaw.gs) → 엣지 kakao-ingest → `kakao_messages`. 앱 탭 검색 [카톡 대화] → 엣지 kakao-search → `kakao_messages`.

**kakao-ingest**
- 요청: `{ room, text, file_name?, chunk_index?, chunk_count?, source? }` → `{ ok, read, inserted, skipped, masked, from_at, to_at, import_id }`. `{ mode: "last", room }` → `{ last_to_at }`(GAS 증분 기준).
- 인증: 헤더 `x-ingest-token` = 시크릿 `FIELD_INGEST_TOKEN`. 시크릿이 비면 503 으로 모두 거부. Authorization 은 anon 키(기본 JWT 검사 그대로 — `--no-verify-jwt` 쓰지 않음).
- 방이 `kakao_collect_rooms`(enabled·keep_raw)에 없으면 403 + 적재 기록 status=error. 글 0건이면 422.
- 가림(넣기 전): 주민번호(privacy.ts 규칙)·카드번호 전부·계좌(끝 4자리만)·휴대폰 가운데 4자리. DB 트리거가 한 번 더 가린다.
- 중복 키 `hash` = SHA-256(방 | KST 날짜 시:분 | 작성자 | 가린 본문 앞 500자 | #같은 분 같은 글 n번째). 같은 파일을 다시 보내도 새 글 0.
- `is_bot` = 작성자가 app_config `KAKAO_BOT_NICKS`(쉼표 목록, 기본 "Ai법인폰")에 있음.

**kakao-search**
- 요청: `{ q, kinds?, room?, from?, to?, limit?(≤200, 기본 100), include_bot? }` → `{ ok, enabled, rows[{ id, room, sent_at, seq, author, text, kind_guess, is_bot }], limit, truncated }`.
- 제한: 스위치 `KAKAO_SEARCH_ENABLED`='true' 일 때만, 검색어 정규화 2자 이상(최대 3낱말 AND), IP 당 분당 30회, 봇 글 기본 제외. 검색 기록은 엣지 로그 한 줄(`kakao-search {...}`) — 표(kakao_search_log)는 아직 없음.
- `text_key`(DB 생성 열, pg_trgm) 부분 일치 — 띄어쓰기·기호 차이 무시.

**처음 켜는 순서**(순서가 틀리면 GAS 전송만 잠깐 실패한다)
1. SQL 2장 실행(kakao-collect-rooms → kakao-messages, /sql-handoff).
2. 긴 임의 문자열을 하나 만들어 Supabase 시크릿 `FIELD_INGEST_TOKEN` 과 GAS 스크립트 속성 `FIELD_INGEST_TOKEN` 에 **같은 값**으로 넣는다(코드·문서에 값을 적지 않는다).
3. 배포: `npx supabase functions deploy kakao-ingest --project-ref kkdiihazgzesbqxjytqv --use-api` / 같은 명령으로 `kakao-search`.
4. GAS 새 버전 배포(KakaoRaw.gs 포함). 편집기에서 `testPushRawMessages`(파일 ID·방 이름 넣고)로 한 방 시험 → `kakao_import_log` 에 status ok 1행.
5. 직원 고지 뒤 app_config `KAKAO_SEARCH_ENABLED` = `true`.

**문제가 생기면**: `kakao_import_log` 의 status=error·error 열(방 목록에 없음·글 0건·넣기 실패)을 먼저 본다. 401 = 토큰 불일치, 503 = 시크릿 없음, 413 = 조각이 500KB 초과(GAS 조각 450KB 설정 확인).
- `_shared/kakao-parse.ts` 를 고치면 두 함수 모두 다시 배포. 가림 규칙을 바꾸면 그 규칙에 걸리는 글은 다음 적재 때 새 글로 한 번 더 들어간다(hash 가 가린 글 기준).

## GAS 관리 동작 중계 — gas-admin (2026-10-24)
설계: docs/tasks/kakao-collect-expand.md 3-7. 소스 `supabase/functions/gas-admin/index.ts`, 규칙 `_shared/gas-admin.ts`(테스트 tests/kakaoCollectAdmin.test.ts).

**왜**: first-data GAS 웹앱의 쓰기 동작(행 삭제·트리거·수집 실행 등 13개 + contactpeek)이 2026-10-24부터 관리 토큰(GAS 스크립트 속성 `FIELD_ADMIN_TOKEN`)을 요구한다. 토큰은 앱 번들에 넣을 수 없으므로 앱은 이 함수를 부르고, 이 함수가 시크릿의 토큰을 붙여 GAS 를 부른다.

- 요청 `POST { action }` — `ingestnow`(드라이브 수집 즉시 실행) · `retryheld`(확인필요 파일 되돌리기) · `kakaoclear`(끝난 작업 정리) **만**. 그 밖은 400. 위험한 동작(celltrim·dedupe·seenreset·cursorreset·rebuildindex 등)은 일부러 열지 않는다 — GAS 편집기에서 직접.
- 응답: GAS JSON 그대로(토큰 글자는 `***` 로 가림). GAS 가 토큰을 거부하면 HTTP 200 + 본문 `{ok:false, status:403}` 이 그대로 간다 → 앱은 "GAS 가 거부했습니다(관리 토큰)" 표시.
- 상태 코드: 503 = 시크릿 `FIELD_ADMIN_TOKEN` 없음(잠긴 쪽으로 실패) · 400 = 허용 안 된 동작 · 429 = IP 당 분당 5회 초과(인스턴스 안, 대략적) · 502 = GAS 응답이 JSON 아님 · 504 = GAS 140초 무응답(ingestnow 는 GAS 쪽에서 계속 돌 수 있음).
- 엣지 로그 한 줄: `gas-admin {"action","ip","gasStatus","ok"}`(토큰 없음).
- 한계: anon 키로 누구나 부를 수 있다(SSO 서버 검증 없음). 공개 번들에 박힌 GAS 주소로 행 삭제를 부르던 구멍을 닫는 것이 목적이고, 남은 세 동작은 데이터를 지우지 않는다.

**처음 켜는 순서**(설계 6절 R5 — 틀리면 관리 탭 [지금 수집]이 잠깐 거부될 뿐)
1. 긴 임의 문자열 하나를 GAS 스크립트 속성 `FIELD_ADMIN_TOKEN` 에 넣는다(값은 코드·문서에 적지 않는다).
2. GAS 새 버전 배포(같은 배포 ID).
3. Supabase 시크릿 `FIELD_ADMIN_TOKEN` 에 **같은 값**(대시보드 → Edge Functions → Secrets).
4. 배포: `npx supabase functions deploy gas-admin --project-ref kkdiihazgzesbqxjytqv --use-api` 그리고 `photo-drive-archive` 도 같은 명령으로 재배포(토큰을 붙이게 바뀜 — 안 하면 매시 사진 이관이 GAS 403 으로 실패).
5. 앱 배포 → 관리 탭 [카톡 수집] → [끝난 작업 정리] 같은 가벼운 단추로 확인.

**문제가 생기면**: "GAS 가 거부했습니다(관리 토큰)" = 두 곳 값이 다르거나 GAS 를 새 버전으로 배포하지 않음. 503 = Supabase 시크릿 없음. photo-drive-archive cron 결과에 `forbidden` = 같은 원인.

## data-ask "무엇이든 묻기" (2026-10-29)
- 도구: 기본(query_rows·tally·vendor_team·team_members·app_guide) + `_shared/ask/tools-index.ts` 의 ASK_TOOLS 14개(okr_member_report·okr_team_report·person_activity·inspection_gap·recontract_progress·misu_followup·unhandled_now·schedule_view·vendor_lookup·photo_summary·it_sheet·kakao_search·ops_status·kpi_explain).
- 읽을 수 있는 표 57개(`_shared/ask/catalog.ts`), 금지 표(FORBIDDEN_TABLES)·금지 칸(전화·raw·토큰) 제외. 응답 전부 askMask(주민·카드·계좌·휴대폰 가운데).
- 환경변수(선택): ASK_MAX_USD(기본 1.5, 질문당), ASK_DAILY_USD(기본 20, 분석 모드 하루 — ai_usage 오늘 합), OPENAI_ASK_ANALYSIS_EFFORT(기본 medium). 분석 왕복 16·데이터 9, 140초에 마무리.
- 글자 날짜 표(misu.입력일·bulman.날짜·overage_adjust.방문일)는 형식이 섞여 있어 서버 order/gte 를 쓰지 않고 읽은 뒤 ymdOf 로 거른다(catalog dateText).
- **kpiDefs.ts 를 고치면** `node tools/build-ask-kpi-defs.mjs` 로 `_shared/ask/kpi-defs.json` 을 다시 만들고 data-ask 재배포(어긋나면 테스트가 잡음).
- OKR 순수 규칙은 `_shared/ask/okr-rules.ts` 가 원본, src/okr.ts·kpiCompute.ts 는 재수출(앱·엣지 같은 계산).
