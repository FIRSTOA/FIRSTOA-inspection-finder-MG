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
| photo-drive-archive | 5 | cron 매시 25분 | 오래된 사진을 드라이브로 옮기고 Storage 비움 | (확인 필요) |
| photo-archive-organize | 10 | 앱 | 사진 앨범 정리 | (확인 필요) |
| record-edit | 1 | 앱 조회 탭 | 기록 수정·숨김 대행(anon 은 원장 표 update 권한 없음) | service role |
| report-view | 2 | 고객(문자 링크) | 고객용 리포트 공개 페이지. **verify_jwt = false**(유일) | — |
| geocode | 6 | 앱 | 주소 → 좌표(카카오 → OSM) | KAKAO_REST_KEY |
| place-search | 9 | 앱(맛동여지도) | 장소 자동 채우기 | KAKAO_REST_KEY, OPENAI |
| entity-ask / data-ask | 6 / 12 | 앱 통합검색 | 업체 질문 / 전체 데이터 질문(AI). 사용량은 `ai_usage` 에 기록 | OPENAI |
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
