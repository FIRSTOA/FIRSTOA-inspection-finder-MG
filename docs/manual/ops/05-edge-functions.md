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
| schedule-report | 새(2026-10-31, 배포 대기) | cron `schedule-report-12`·`-14`(평일 KST 12:00·14:00), 앱 [지금 보내기]·미리 보기 | 팀 중간보고 글(화면 [📋 중간보고]와 같은 함수)을 만들어 `outbox` 로 `room_map 스케줄\|팀` 방에 넣음. 기록 `schedule_report_log` | OPENAI(OPENAI_REPORT_MODEL) |
| workinmap-sync | 새(2026-10-31, 배포 대기) | cron `workinmap-sync-pull`(KST 09·12·15·18)·`-pull-old`(06:10)·`-push`(매분), 앱 관리 탭 [워킨맵 동기화] | 예전 워킨맵(workinmap.com) → `workin_map_places` 가져오기(색·ON/OFF·메모·새 장소), 확인 큐·변경 로그. 되밀기는 P2 전(건너뜀) | WORKINMAP_n_EMAIL·WORKINMAP_n_PASSWORD(n=1,2) |
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

## 자동 중간보고 — schedule-report (2026-10-31)
설계 `docs/tasks/schedule-report-auto-2026-10-31.md`, SQL `supabase/schedule-report-20261031.sql`. 소스 `supabase/functions/schedule-report/index.ts`(흐름) + `logic.ts`(순수 분기, `tests/scheduleReportEdge.test.ts`). 글은 `_shared/report/mid-report.ts`·`polish.ts`(화면과 같은 한 벌).

**입력**: `POST { slot: "12"|"14"|"now", team?: "A".."E", dryRun?: true, actor?: "이름" }` — 크론은 `{slot}` 만(팀 = `SCHEDULE_REPORT_TEAMS`), 앱은 `{slot:"now", team, actor}` 또는 `dryRun`.
**응답**: `{ ok, kstDate, results: [{ team, slot, status, reason, room, realRoom, test, text, lines, polished, outboxId, logId, chars }] }`. status = `queued`·`dry`·`skipped`·`failed`. 한 팀이라도 failed 면 HTTP 500(ops.edge_call_health 에 잡힘).
**인증**: Bearer 가 이 프로젝트의 anon/service_role JWT(ref·role·만료 검사 — reception-sheet-open 과 같은 방식). 크론 vault `field_cron_jwt`(anon)·앱 anon 그대로 통과, 무인증·다른 프로젝트 403.

**순서(팀마다, 한 팀 실패가 다음 팀을 막지 않음)**
1. 12/14: `schedule_report_log` 에 claim 행 → 부분 unique 위반(409/23505)이면 `already`(그 차수는 하루 한 번). on_conflict 는 쓰지 않는다.
2. 판정: `SCHEDULE_REPORT_AUTO` 꺼짐 `off`(now 는 무관) → `FIELD_KAKAO_SEND_ENABLED` 꺼짐 `kakao_off` → 주말·공휴일 `holiday` → 10시 전 `before10` → now 는 19시 뒤 `after19`. dryRun 은 판정 없이 글만.
3. now: 같은 팀 now 가 10분 안에 queued/claim 이면 `too_soon`.
4. 12/14: 같은 날 [복사] 기록(slot copy)이 차수 60분 전~지금이면 `manual_copied`.
5. 재료: `as_tickets`(그 팀·오늘~다음 영업일 전부 + 그 뒤 120일 중 note 에 '연기') · `cs_members`(active). 오늘 대상 0건이면 `empty`.
6. 방: `room_map` 종류 `스케줄`·지역 = 팀. 없으면 `no_room` — 테스트 모드여도 보내지 않는다.
7. AI: `polishReportLines`(40초, 비용 태그 `schedule-report`). 실패·개수 불일치면 규칙 초안(reason `ai_fallback: …`, polished=false).
8. `SCHEDULE_REPORT_TEST`(없으면 켜짐) 또는 전역 `TEST_MODE`(없으면 켜짐 취급) → `TEST_ROOM` 으로, 글 머리 `[테스트 · 원래는 강남C 스케줄]`, `real_room` 에 원래 방.
9. `outbox` insert → 로그 queued(outbox_id·text·lines·polished·ai_model·draft_hash). 배달 확인은 `kakao_delivery_log.outbox_id`. 넣은 뒤 로그 갱신만 실패하면 결과는 queued + reason `log_update_failed`(응답 500).
- 14시도 변동이 없어도 전체 글을 보낸다(사용자 결정 Q1, draft_hash 는 기록만). 글에 "(진행중인 업무는 * 표시)" 줄·특이사항 칸 없음(Q2).

**환경**: SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY(자동), OPENAI_API_KEY, 선택 OPENAI_REPORT_MODEL(report-polish 와 같음). 없으면 AI 없이 규칙 초안으로 보낸다.
**app_config**: SCHEDULE_REPORT_AUTO(기본 false)·SCHEDULE_REPORT_TEST(기본 true)·SCHEDULE_REPORT_TEAMS(기본 C)·TEST_MODE·TEST_ROOM·FIELD_KAKAO_SEND_ENABLED.

**배포·켜기 순서**
1. `npx supabase functions deploy schedule-report --project-ref kkdiihazgzesbqxjytqv --use-api` (`_shared/report/*`·`kr-holidays.ts` 가 바뀌었으면 `report-polish` 도 같은 명령으로 재배포).
2. SQL `supabase/schedule-report-20261031.sql` 실행(표·키 3개·크론 `schedule-report-12` `0 3 * * 1-5`, `schedule-report-14` `0 5 * * 1-5` — UTC).
3. 관리 탭 room_map `스케줄 | C | 강남C 스케줄`.
4. 미리 보기 확인: 앱에서 `invokeEdgeFunction("schedule-report", { slot: "now", team: "C", dryRun: true })` → results[0].text 가 화면 [📋 중간보고] 초안과 같은지.
5. `SCHEDULE_REPORT_AUTO` 켬(TEST 켜 둔 채) → 하루 테스트방 확인 → `SCHEDULE_REPORT_TEST` 끔.

**확인**: `select kst_date, team, slot, status, reason, room, test, polished, outbox_id from schedule_report_log order by created_at desc limit 10;` · `select * from ops.edge_call_health where tag like 'schedule-report-%';`

**되돌리기**: 급히 멈추기 = 관리 탭 `SCHEDULE_REPORT_AUTO` 끔(또는 "카톡 전송" 끔 = 전체 정지). 완전히 = `select cron.unschedule('schedule-report-12'); select cron.unschedule('schedule-report-14');` 후 함수 삭제(`npx supabase functions delete schedule-report --project-ref kkdiihazgzesbqxjytqv`). 이미 outbox 에 들어간 글은 봇이 보내기 전이면 outbox 행을 지워 막는다.

## 워킨맵 동기화 — workinmap-sync (2026-10-31, P1 가져오기)
설계 `docs/tasks/workinmap-sync-2026-10-31.md` v2, SQL `supabase/workin-sync-20261031.sql`. 소스 `supabase/functions/workinmap-sync/` — `index.ts`(Deno.serve·인증) · `sync.ts`(액션 실행, fetch 주입) · `plan.ts`(이름 규칙·짝짓기·규칙·가드, 순수) · `auth.ts`(Firebase 로그인·토큰 캐시) · `api.ts`(워킨맵 읽기). 앱 화면 `src/WorkinSyncAdmin.tsx`(관리 › 기타 설정), `src/workinSync.ts`(앱 쪽 순수 로직, `tests/workinSyncAdmin.test.tsx`).

**액션**(`POST JSON`, 인증 = 이 프로젝트 anon/service_role JWT — schedule-report 와 같은 규칙)
| action | 하는 일 |
|---|---|
| `status` | 계정(토큰 칸 없음)·워크 표·미처리 확인 큐 종류별 수·스위치·secrets 있는 계정 번호 |
| `login_test`, `account: n` | 계정 n 의 멈춤을 풀고 로그인만 한 번. 응답에 토큰·이메일 없음 |
| `works` | 계정별 워크 목록 → 이름 규칙 해석 → `workin_sync_works` upsert(사람 칸 override_skip 은 안 건드림) |
| `pull`, `scope: "current"\|"old"\|<워크 id 24자리>`, `dryRun?` | 이번 분기 / 지난 분기(목록 수정일 바뀐 것만) / 워크 하나. dryRun 이거나 `WORKINMAP_SYNC_ENABLED` 가 'true' 가 아니면 쓰지 않고 차이만. 쓸 때는 `workin_sync_log`(전/후) 먼저, 로그 실패한 묶음은 고치지 않음. 임대(`workin_sync_take_lease`)로 겹침 방지(겹치면 `skipped:"busy"`) |
| `push` | P2 전 — `{ ok:true, skipped:"push_disabled" }` |

**크론**(SQL 8절, UTC): `workinmap-sync-pull` `0 0,3,6,9 * * *`(= KST 09·12·15·18) · `workinmap-sync-pull-old` `10 21 * * *`(= KST 06:10) — 둘 다 `WORKINMAP_SYNC_ENABLED='true'` 일 때만 HTTP 를 쏜다. `workinmap-sync-push` 매분 — `WORKINMAP_PUSH_ENABLED='true'` 이고 보낼 행이 있을 때만.
**스위치**(관리 탭 전송 스위치): `WORKINMAP_SYNC_ENABLED`(가져오기) · `WORKINMAP_PUSH_ENABLED`(되밀기, 주의) · `WORKINMAP_PUSH_MEMO`(메모 되밀기, 주의). 기타 키: `WORKINMAP_EXCLUDE_WORKS`·`WORKINMAP_TEST_WORK`·`WORKINMAP_ACCOUNT_LABELS`·`WORKINMAP_API_KEY`·`WORKINMAP_PUSH_FIELDS`(SQL 이 없을 때만 기본값을 넣음).
**앱 쪽 안전장치**: 웹앱 [엑셀 불러오기]의 "같은 목록 교체"는 그 팀·분기·업무에 `ext_id` 있는 장소가 하나라도 있으면 막힌다(`canReplaceScope`). 목록 줄 "동기화" 배지 = `ext_synced_at` 있음.

**켜는 순서**
1. SQL `supabase/workin-sync-20261031.sql` 실행(열 7개·표 6개·권한·트리거·키·크론 3개 — 스위치가 false 라 크론은 아무것도 안 쏨).
2. 배포: `npx supabase functions deploy workinmap-sync --project-ref kkdiihazgzesbqxjytqv --use-api`.
3. secrets(대시보드 Edge Functions › Secrets, 사용자가 직접): `WORKINMAP_1_EMAIL`·`WORKINMAP_1_PASSWORD`·`WORKINMAP_2_EMAIL`·`WORKINMAP_2_PASSWORD`. 코드·채팅·커밋에 값을 넣지 않는다.
4. 관리 탭 › 기타 설정 › 워킨맵 동기화 › 계정마다 **[로그인 시험]**.
5. **[워크 목록 갱신]** → 표의 범위(팀·연도·분기·업무)·상태가 맞는지, "이름 해석 안 됨"·"공유" 확인. 필요한 워크는 [건너뜀].
6. **워크 하나씩 [미리보기(dry)]** → 짝 수·새 장소·바뀔 곳·색 검증(처음 짝 색 다름이 많으면 멈추고 확인)·중단 사유.
7. 전송 스위치 **"워킨맵 가져오기"(WORKINMAP_SYNC_ENABLED) 켬** — [지금 동기화]가 열린다. 바로 써 보려면 워크 하나로 [지금 동기화].
8. 다음 **09시** 첫 자동 회차 뒤 확인.

**확인**: `select account_no, name, status, place_count, first_pulled_at, last_pulled_at, last_error from workin_sync_works order by 1,2;` · `select kind, count(*) from workin_sync_review where resolved_at is null group by 1;` · `select field, count(*) from workin_sync_log where created_at > now() - interval '1 day' group by 1;` · `select * from ops.edge_call_health where tag like 'workinmap-sync%';`
**되돌리기**: 급히 멈추기 = 스위치 "워킨맵 가져오기" 끔. 칸 복구 = `workin_sync_log.before_value`. 완전히 = SQL 파일 맨 아래 되돌리기 절(크론 unschedule·열/표 삭제).

## 2026-10-31 전체 디버깅에서 바뀐 엣지 3개 (재배포 필요)
- **contact-sheet-pull** — 담당자변경 공유가 `share.ts` 로 분리. ① 공유 전 `shared_at is null` 조건부 PATCH 로 먼저 잡아 10:00 에 `contact-sheet-pull-daily` 와 `contact-sheet-share` 가 같은 분에 돌아도 같은 글이 두 번 안 나감 ② outbox 넣기 실패면 잡기를 되돌려 다음 3분 실행이 다시 보냄 ③ 새 행이 없어도 공유를 돌림(10시 전 보류분이 다음 새 행까지 밀리던 것 해결) ④ 22시 이후는 보류(10시 전과 같음). 실측 근거: 10/22 09:39 D지역 건이 11:33 에야 공유됨.
- **kakao-ingest** — kakao_messages(27만 행, 가림 트리거·trgm 인덱스) 적재가 500행 묶음에서 8초 statement timeout(57014) 으로 0행 실패(10/29~31 강남C as 3·점검방 1). 이제 `_shared/rest-batch.ts` 로 250행씩 넣고 57014 면 그 묶음만 반으로 쪼개 재시도(최소 25행). hash 중복 무시라 다시 넣어도 중복 없음. GAS 쪽 57014 재시도(clasp push 대기)와 별개로 서버에서 먼저 막는다.
- **weekly-keyman-poster** — outbox 넣기 응답을 확인하지 않고 `queued=true`·KEYMAN_POSTER_SENT 를 찍던 것 → 실패면 그 지역 오류 + 502, SENT 미기록(노트북 안전망이 다시 시도). dry 경로(poster_send.py)는 그대로.
- 배포(프로젝트 폴더에서): `npx supabase functions deploy contact-sheet-pull` · `kakao-ingest` · `weekly-keyman-poster` (각각 `--project-ref kkdiihazgzesbqxjytqv`).
- 보고만 된 것(수정 안 함, 결정 대기): customer-message-send 발송 상한 조회 실패 시 통과(실패 시 막을지), photo-drive-archive GAS 호출 타임아웃 없음(7일 83회 150초 초과), weekly-keyman-poster 크론·수동 겹침 잠금 없음, OpenAI 호출 타임아웃 없는 함수 8개, weekly-keyman-poster run/dry 응답 text 에 키맨 전화 원문, 담당자변경 시트 '청현세무회계컨설팅' 행이 매일 자정 1건씩 재생성(날짜 칸 수식 추정 → 시트 담당이 값으로 고정).

## 2026-10-31 오후 2차 — 타임아웃·상한·중복 (재배포 필요 13개)
- **customer-message-send**: 발송 상한(시간당·하루) 건수 조회가 실패하면 예전엔 0건으로 쳐서 그냥 나갔다 → 이제 **막는다**(503 "발송 한도 확인 실패 — 잠시 후 다시"). 설정값 조회 실패는 기본값(시간당 40 등)으로 진행. `limits.ts` 분리.
- **photo-drive-archive**: GAS 호출 140초 타임아웃(504), GAS 본문 `ok:false`/`error` → 502, 본문 4xx 는 그대로, status 조회 실패 500. **배포 직후 ops 기록에 실패가 늘어 보일 수 있다 — 숨어 있던 실패가 드러나는 것.** `rules.ts` 분리.
- **OpenAI 타임아웃**(`_shared/ai-timeout.ts`): counter-ocr·guide-tag·playbook-draft·golden-card-transform·okr-assist·quarter-result-quantify 60초, entity-ask 90초 → 504 "AI 응답이 늦어 중단했습니다 — 다시 시도". growth-note-transform 은 원래대로 규칙 변환 폴백(200, reason). 남은 곳: data-ask·field-sheet-sync·place-search(다음).
- **naver-calendar-sync**: CalDAV REPORT·PROPFIND·내려받기 30초 타임아웃. 삭제 안전장치용 조회(listAccountCalendarIds·probe)는 일부러 안 붙임(시간 초과가 삭제로 이어지면 안 됨). **남은 위험**: 그 두 조회가 실패를 "없음"으로 읽어 네이버 장애 때 티켓 삭제 가능 — 별도 작업 권고.
- **contact-sheet-pull**(`dedupe.ts`): 업체+구분+변경전+변경후+접수자 가 같은 행이 날짜만 다르게 있으면 안 넣는다(청현세무 날짜 수식 행 13건 재발 방지). 응답 `dedupedByContent` 에 합산.
- **field-sheet-sync**(`dept-sheet-spec.ts verifyDeptHeaders`): 순번을 시트가 매기는 부서 시트(영업·경영)는 A5 머리가 비었거나 "순 입력"이어도 통과(열 밀림은 B열에서 잡힘). 2026-10-30 영업 접수 1건 failed 원인.
- 배포 한 번에(PowerShell, 프로젝트 폴더에서):
```
foreach ($f in "customer-message-send","photo-drive-archive","counter-ocr","entity-ask","guide-tag","playbook-draft","golden-card-transform","growth-note-transform","okr-assist","quarter-result-quantify","naver-calendar-sync","contact-sheet-pull","field-sheet-sync") { npx supabase functions deploy $f --project-ref kkdiihazgzesbqxjytqv }
```
- SQL(사용자 실행, 권한나 통과): `supabase/cleanup-20261031.sql` — 청현세무 쓰레기 12행 삭제(최근 1행은 dedupe 기준으로 남김) + `log_outbox_delivery()` EXECUTE 를 public·anon·authenticated 에서 회수(트리거는 소유자 권한이라 계속 동작).
- **naver-calendar-sync 삭제 가드 보강(2026-10-31 저녁, 사용자 "진행해")**: 네이버에서 사라진 일정이 웹앱 티켓에 걸려 있으면 계정 다른 캘린더에 살아 있는지 확인하는데, 예전엔 그 확인(PROPFIND·GET)이 실패하면 "없음"으로 읽어 티켓을 지울 수 있었다(8월 사고 계통). 이제 `guard.ts decideGoneTicket`: 목록 조회 실패(null) 또는 확인 중 하나라도 오류/타임아웃 → **보류**(deferred, state 행 유지 → 다음 1분 실행이 다시 봄), 다른 캘린더에 있음 → 옮김, 전부 404 → 삭제. 두 조회에 30초 타임아웃. 응답에 `deferred` 추가. 재배포 필요.
