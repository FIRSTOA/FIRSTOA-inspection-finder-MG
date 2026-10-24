# FIELD 위험·품질 점검 (2026-10-24, 개발실 오류진)

조사만 했다. 코드·DB 는 고치지 않았다(DB 는 SELECT 만). 숫자는 2026-10-24 10:5x KST 라이브 DB(MCP) 와 미커밋 작업 트리 기준.
표기: [증거 · 영향 · 고치는 방법 · 크기 S/M/L · 즉시/다음]

## 1쪽 요약 — 상위 10

| # | 항목 | 증거 | 영향 | 고치는 방법 | 크기 | 언제 |
|---|---|---|---|---|---|---|
| 1 | 네이버 수입 일정 업체명 = 제목 앞 80자 | supabase/functions/naver-calendar-sync/index.ts:360 `vendor: ev.title.slice(0, 80)`, issue 는 "" ; as_tickets source=naver 739건 중 vendor 정확히 80자 274건, 60자 이상 553건, vendor_code 빈칸 739/739 | 물류 거래처명 오염의 근본 원인. 아직 진행 중: logistics_records 14/79건, photo_albums 15건(최근 10-23)에 제목 통째("…/퍼스트/운영팀/…") 저장. 오늘 고친 App.tsx:4732 는 note 를 보조로 쓸 뿐이라, 제목 앞 80자가 메모로 채워진 건(id 85 "⭐오후 4시반 이후…")은 못 막음 | 파서 입력을 `calendarTitle`(200자)로: App.tsx:4732 와 CsAsWorkspace onLogistics 페이로드(1945·2010·2087·2311)에 calendarTitle 추가. 동기화의 vendor 는 fieldTicketVendor 로 업체부만 저장. 기존 29건 정리 SQL 은 /sql-handoff | M | 즉시 |
| 2 | 완료 처리 시 일정 메모 덮어쓰기 | src/App.tsx:4844 `selectRows(...).catch(() => [])` → 4864 `appendTicketNote(rows[0]?.note, sentText)` → 4869 PATCH | 조회가 한 번 실패하면 기존 note(접수 원문·이전 전송 양식 누적)가 지워지고 이번 양식만 남음. 조용한 데이터 유실 | catch 빼고 실패 시 토스트 후 중단(또는 서버에서 이어붙이는 RPC). 실패 재현 테스트 추가 | S | 즉시 |
| 3 | app_config 를 anon 이 쓸 수 있음 — SSO 스위치 포함 | pg_policies: app_config "anon write" ALL true/true. 키: SSO_REQUIRED·FIELD_KAKAO_SEND_ENABLED·TEST_MODE·FIELD_SHEET_SYNC_ENABLED·SHEET_WRITE_LOCK, KPI_TARGETS(kpiDefs.ts:305) | 공개 번들에 든 anon 키만 있으면 로그인 강제를 끄거나, 카톡 발송을 켜고 끄거나, 홈 KPI 목표를 바꿀 수 있음 | 쓰기는 엣지 함수(관리자 확인)로만 하고 anon 은 SELECT 만. docs/tasks/anon-permissions-design.md 1단계로 묶기 | M | 다음(설계 필요) |
| 4 | cron 12개 명령에 JWT 박힘 + pg_net 5초 타임아웃 36% | cron.job 3,4,5,8,9,10,12,17,18,21,22,23 명령에 `Bearer eyJ…`(디코드 role=anon, service_role 아님). net._http_response 최근 6시간 1,027건 중 366건 status null·timed_out(5000ms) | 키를 바꾸면 cron 이 전부 깨짐(10/19 사례 반복 위험). 타임아웃이 나도 cron 기록은 "succeeded" 라 감시가 못 봄 | `vault.decrypted_secrets` 에서 키를 읽는 형태로 교체 + `timeout_milliseconds := 30000`. /sql-handoff | M | 다음 |
| 5 | RLS 꺼진 표 4개(anon SELECT/INSERT/UPDATE) — worker_jobs 포함 | advisor rls_disabled_in_public: room_activity, counter_sms_inbox, worker_heartbeat, worker_jobs. has_table_privilege(anon, worker_jobs, INSERT)=true. tools/worker/worker.py:10·145 일감 ping/backup/relay/poster/kakao_photo | anon 키로 노트북 실행기에 일감 삽입 → 카톡 중계·포스터 발송 가능. 심박 위조로 감시 무력화 가능 | RLS 켜고 정책 명시(worker_jobs INSERT 는 kind 화이트리스트, heartbeat 쓰기는 실행기 키만). sql-review 먼저 | M | 다음 |
| 6 | 접수→일정 중복 검사가 실패하면 그냥 생성 | src/ServiceReception.tsx:1217, 1223 `.catch(() => [])` (주석: "티켓 2개 → 상태 뒤집힘 사고 방지") | 조회가 실패하면 중복 방지가 꺼진 채 일정이 하나 더 생김 — 주석이 막으려던 바로 그 사고 | catch 제거, 실패 시 "확인 못 함 — 다시 시도"로 중단 | S | 즉시 |
| 7 | cron.job_run_details 293MB(DB 877MB 의 33%) | 행 71,085(10/9~), 평균 명령 518B → 실제 ~40MB, 나머지는 bloat. purge-cron-log(24) 는 DELETE 만 함 | 용량·백업 부담. 1분 주기 cron 2개(3·8)가 하루 2,880행 | 매분 job 기록 줄이기(cron.log_run 끄기 또는 주기 완화) + 한 번 `VACUUM FULL cron.job_run_details`(사용자 실행) | S | 다음 |
| 8 | 화면이 숨어 있어도(KeepAlive) 도는 조회 | Home 아래 src/LiveSendBoard.tsx:69(15초, 요청 6개, kakao_delivery_log limit 2000 포함), FeedbackBoard.tsx:80(60초). 무조건 실행되는 focus 핸들러: CsAsWorkspace.tsx:450(refreshTickets), :597(엣지 naver-calendar-sync 호출), ServiceReception.tsx:710(693 과 중복 로드), DeptRequests.tsx:89, CounterSms.tsx:99 | 홈을 한 번 연 사람은 다른 화면에 있어도 분당 ~30요청. 엣지 로그 24h 동안 naver-calendar-sync 5,722회(cron 몫 1,440 → 클라이언트 ~4,300) | 각 컴포넌트에 useScreenActive 게이트 추가(LiveSendBoard·FeedbackBoard·focus 5곳). ServiceReception 710 은 693 과 합치기 | S | 즉시 |
| 9 | AI·비용 엣지 함수를 anon 키로 호출 가능 | list_edge_functions: verify_jwt=true 이지만 anon JWT 로 통과 — entity-ask, data-ask, report-polish, okr-assist, counter-ocr, playbook-draft 등. record-edit(쓰기)도 같음 | 키를 가진 누구나 AI 비용을 만들거나 레코드를 수정할 수 있음 | 함수 안에서 SSO 세션 토큰 검증(그룹웨어 세션) 또는 호출 횟수 제한(ai_usage 기준) | M | 다음 |
| 10 | 고객 리포트·자동 일정이 실패를 0건으로 보여 줌 | src/CustomerReport.tsx:179,182,189,231,343-347 `.catch(() => [])` ; src/AutoSchedule.tsx:120,167 | 고객에게 나가는 리포트가 "AS 0건·점검 0건"으로 만들어질 수 있음. 자동 일정은 빈 계획 | 조회 실패 시 리포트 생성 중단 + 빨간 줄. 부분 실패 표시 | S | 즉시 |

같이 볼 것: 테스트 사각(부록 F) 최상위인 WalkingMap 3,518줄·CsAsWorkspace 2,709줄은 1·2·8번이 걸린 파일이다. 고칠 때 재현 테스트를 먼저 붙인다.

---

## 부록 A. 데이터 품질

| 항목 | 증거(쿼리 결과) | 영향 | 고치는 방법 | 크기 | 언제 |
|---|---|---|---|---|---|
| A1 as_tickets vendor 길이 | 1,669건 중 vendor=80자 276(naver 274·기타 2), 60자 이상 569, 최대 92(수동 입력). calendarTitle 80자 이상 601. vendor 빈칸 0 | 요약 1번. 일정 검색과 중간보고 payload(CsAsWorkspace.tsx:1376 vendor 를 AI 에 그대로 전달) 품질 | 요약 1번 | M | 즉시 |
| A2 as_tickets vendor_code 빈칸 | naver 739/739, 직접 122/772, workin 7, manual 8 | 통합이력·업체 연결(openTicketHistory CsAsWorkspace.tsx:469)이 이름 추정에 기댐 | 동기화 때 fieldTicketVendor → vendor_match_alias 로 code 채우기 | M | 다음 |
| A3 logistics_records 거래처명 오염 | 79건 중 '/퍼스트·(일반)' 패턴 14건, 80자 4건(id 19·27·69·85), 최근 2026-10-23 | 물류 KPI·거래처 이력 매칭 실패 | 1번 수정 후 14건 정리 SQL(sql-handoff) | S | 즉시 |
| A4 photo_albums vendor 오염 | 3,090건 중 같은 패턴 15건, 80자 4, 빈칸 5, 최대 100자(as 쪽은 주소·메모가 섞임) | 사진 앨범의 업체별 묶음 누락 | 앨범 생성(create_photo_album) 호출부에서 정리된 업체명 넘기기 | S | 다음 |
| A5 service_receptions vendor 길이 | 922건(삭제 제외) 중 60자 이상 43, 최대 104 | 접수→일정 vendor 로 그대로 흘러감(ServiceReception.tsx:1223 vendor=eq 중복 검사도 빗나감) | 접수 저장 때 업체명과 부서 메모 분리 안내 | S | 다음 |
| A6 recontract 업체명 두 칸 | 실제 1,200행(list_tables 추정치 11 은 통계가 오래됨). 업체명 null 이고 _업체명만 있는 행 1,189, 둘 다 있는 행 11 | kpiCompute.ts:256 은 _업체명 우선 fallback 이라 KPI 는 정상. "업체명"만 읽는 새 코드가 생기면 99% 누락 | 주석/타입에 "_업체명 기준" 명시, 또는 생성 열로 통일 | S | 다음 |
| A7 cs_members 빈칸 | 활성 59명: 팀 빈칸 19(경영지원 7·IT 8·임원 2·CSS 1·영업 1), 직책 빈칸 47 | kpiCompute.ts:167 이 "빈값=프로"로 설계돼 있어 CS팀(팀 빈칸 0)엔 영향 없음. CSS 1명은 팀 빈칸이라 A~E 집계에서 빠짐 | CSS/운영지원 1명 팀 지정 확인(관리 탭) | S | 확인만 |
| A8 _hidden 상태 | jeomgeom 8, as_records 8, bulman 4, contact_changes 1, logistics 1, misu 0, recontract 0 | 이상 없음 | — | — | — |
| A9 _dupKey 중복 | jeomgeom·as_records·bulman·contact_changes·supply_requests·visit_logs·misu·logistics·recontract 모두 중복 0·null 0, 고유 인덱스 18개 있음 | 이상 없음. lease_status·vendor_info·overage 는 전체 교체 미러라 고유 인덱스가 없음(의도) | — | — | — |
| A10 백업 표 잔류 | _backup_dupe_20260827_jeomgeom 55MB, _as 42MB, region 1.5MB, cleanup_20261019, okr_*_bak_20261020 | 97MB 차지, 노트북 백업(214,186행)과 겹침 | 노트북 백업 파일 확인 후 DROP(sql-handoff) | S | 다음 |

## 부록 B. 조용히 삼키는 실패

src 안의 `catch → [] / undefined / {}` 는 153곳이다. 파일별 상위: ServiceReception 19, MyPlan 10, CustomerReport 10, CsAsWorkspace 6, App 6, OkrHub 5, DataLookup 5, CounterSms 5.

사용자에게 알리지 않은 채 결과가 틀어지는 곳 상위 10:

| # | 위치 | 무엇이 틀어지나 | 고치는 방법 | 크기 |
|---|---|---|---|---|
| B1 | App.tsx:4844 | 일정 note 덮어쓰기(요약 2) | 실패 시 중단 | S |
| B2 | ServiceReception.tsx:1217,1223 | 중복 일정 생성(요약 6) | 실패 시 중단 | S |
| B3 | App.tsx:4870 `setServiceReceptionStatus(...).catch(() => {})` | 일정은 완료인데 접수는 미처리로 남음 → 홈 미처리 숫자가 부풀려짐 | 실패 토스트 + 재시도 큐 | S |
| B4 | App.tsx:4939 `spawnMonthlyCloneIfMissing(row).catch(() => {})` | 매월 반복 일정의 다음 달 분이 조용히 안 생김 | 실패 토스트 | S |
| B5 | ServiceReception.tsx:651, 1388 `deleteRows("as_tickets", …).catch` | 원격이관·접수 삭제 뒤에도 일정이 남아 고아 일정이 됨 | 실패 토스트 | S |
| B6 | DataLookup.tsx:687-693 (방문·활동 취소 연쇄 4곳) | 기록은 숨겼는데 visit_logs/activity_events 는 살아 있어 KPI 방문수에 계속 잡힘 | Promise.allSettled 뒤 실패 건수 표시 | S |
| B7 | CustomerReport.tsx:179-231, 343-347 | 고객 리포트 0건(요약 10) | 실패 시 생성 중단 | S |
| B8 | OkrHub.tsx:172-173 `saveOkrCycle/Report(...).catch(() => undefined)` 루프 | 로컬→서버 올리기가 일부 실패해도 안 보임 → 다른 기기에서 OKR 이 빈칸 | 실패 건수 표시 | S |
| B9 | MyPlan.tsx:99,114,120,126,136,141 plan_memos upsert | 내 계획 메모·순서 저장 실패가 안 보임(새로고침하면 사라짐) | 실패 토스트 1회 | S |
| B10 | AutoSchedule.tsx:120,167 | 자동 일정 후보 0건이 "대상 없음"처럼 보임 | 오류 줄 표시 | S |

참고: kpi/kpiData.ts:129-137 `run()` 은 실패를 fail(s, e) 로 기록해 화면에 보이므로 정상이다. supabase.ts:75·251·362 의 `res.json().catch(() => [])` 는 성공 응답 본문 해석용이라 위험이 낮다.

## 부록 C. 폴링·조회 비용

KeepAlive 화면(App.tsx:5305-5440): home, lookup, weekly, calendar, asReception, serviceReception, inbox, customerReport, happycall, itHistory, counterSms, autoSchedule. useScreenActive 를 쓰는 파일은 CostTile, CsAsWorkspace, CustomerEngagement, DeptWorkspacePanel, Home, HomeKpiBoard, ServiceReception, TeamCalendar 뿐이다.

| 위치 | 주기 | 숨김 중 멈춤? | 비고 |
|---|---|---|---|
| LiveSendBoard.tsx:69 (Home) | 15초, 요청 6 | 아니오(브라우저 탭 숨김만 확인) | 홈이 숨어 있어도 분당 24요청. kakao_delivery_log limit 2000 |
| OkrHub.tsx:451 | 15초 | screen==="okr" 일 때만 마운트돼서 괜찮음 | 15초는 짧음 — 30~60초 권장 |
| App.tsx:3767 자동 재전송 | 20초 | 전역(의도) | autoResend 를 켰을 때만 |
| CustomerEngagement.tsx:129 | 30초 | 예 | — |
| RoomDeliveryBoard.tsx:40 (SystemAdmin) | 30초 | KeepAlive 아님 | — |
| WalkingMap.tsx:1809 | 30초 | KeepAlive 아님(조건부 마운트) | 1753·1810-1811 visibilitychange 가 두 번 등록됨(refresh 중복) |
| CsAsWorkspace.tsx:596 | 45초 | 예 | 597 focus → 엣지 naver-calendar-sync 호출, 게이트 없음 |
| CsAsWorkspace.tsx:451 | 60초 | 예 | 450 focus 게이트 없음 |
| FeedbackBoard.tsx:80 (Home) | 60초 | 아니오 | — |
| Home.tsx:91, HomeKpiBoard.tsx:149, ReceptionBoardPanel:96, ServiceReception:692, TeamCalendar:41, DeptWorkspacePanel:130 | 60초 | 예(부모나 자기 게이트) | ServiceReception.tsx:710 focus 는 게이트 없음 + 693 과 중복 |
| OverduePanel.tsx:31 | 60초 | — | src 어디서도 import 안 됨(죽은 파일) |
| useInboxBadge.ts:43 | 120초 | 전역(의도) | — |
| main.tsx:48 5분 + App.tsx:3259 10분 | 새 빌드 확인이 2중 | 전역 | 하나로 합치기 |
| OperationsDashboard.tsx:150-151 (lookup·weekly 안) | focus/visibility | 아니오 | KeepAlive 두 곳에 들어 있어 focus 한 번에 2번 로드될 수 있음 |
| DeptRequests.tsx:89 (inbox), CounterSms.tsx:99, StockBoard.tsx:68, SupplyBoard.tsx:110 | focus | 아니오 | — |

엣지 호출량(24h, function_edge_logs): naver-calendar-sync 5,722 · customer-message-send 1,720 · reception-sheet-open 1,486(홈 미처리, homeKpiModel.ts:144 기준 평균 1.2초) · field-sheet-sync 774 · contact-sheet-pull 479.
고치는 방법: 위 표에서 "아니오"인 줄에 useScreenActive 게이트를 단다(S, 즉시). cron 이 매분 naver 를 당기므로 화면 focus 때 당기는 간격은 5분으로 늘린다(S).

## 부록 D. 보안

| 항목 | 증거 | 영향 | 고치는 방법 | 크기 | 언제 |
|---|---|---|---|---|---|
| D1 anon 이 쓸 수 있는 표 중 설정·목표·숫자에 영향 주는 것 | pg_policies ALL true: app_config, okr_cycles, okr_reports, quarterly_plans, self_goals, cs_members(팀·직책 → KPI 집계), room_map(카톡 라우팅), message_templates, golden_cards, weekly_notes, counter_sms_settings, outbox(카톡 발송 큐). INSERT/UPDATE: plan_memos, report_recipients, push_subscriptions(DELETE 포함), it_quiz_attempts·it_practice_logs(홈 KPI 원본, INSERT 만) | 홈 KPI(퀴즈·실습 위조 삽입, cs_members 팀 변경), 카톡 발송·방 라우팅 변경 | anon-permissions-design.md 단계 적용. 최소한 app_config·room_map·cs_members 쓰기 차단 | L | 다음 |
| D2 RLS 꺼진 표 4개 | 요약 5. naver_oauth 는 RLS 가 꺼져 있지만 anon 권한이 없음(has_table_privilege 모두 false) — 실제 노출 아님 | — | 요약 5 | M | 다음 |
| D3 SECURITY DEFINER 함수를 anon 이 실행 | advisor: create_photo_album, get_photo_album, merge_reception_handling, log_outbox_delivery | merge_reception_handling 은 RLS 를 우회해 접수 상태를 바꿈 | log_outbox_delivery 는 트리거 전용 → REVOKE EXECUTE. 나머지는 의도 확인 | S | 다음 |
| D4 엣지 함수 공개 호출 | 요약 9. verify_jwt=false 는 report-view 하나(코드 확인: reports 버킷 png 경로 정규식·escape — 안전) | AI 비용·record-edit | 요약 9 | M | 다음 |
| D5 주민번호 원문 저장 | vendor_master.code 63건이 `^\d{6}-[1-4]\d{6}$` 형식(개인 고객 코드 = 주민번호로 추정), vendor_info._raw 85건, as_tickets.vendor_code 2건, misu 1, workin_map_places 1. vendor_master 는 anon SELECT 허용 | 화면은 maskCode/maskRrn 으로 가린다(VendorCodeAdmin.tsx:113, MisuVisitForm.view.tsx:11, DataLookup·Search360·entity360·tabSearch·UnifiedHistory·WalkingMap 등). 하지만 anon 키만 있으면 REST 로 원문을 조회할 수 있다. 이번 grep 범위(privacy 를 import 하는 13파일)에서 가림이 빠진 화면은 못 찾음. deptReception*.tsx 는 vendor_master 를 읽지만 code 를 그리는 줄은 없음 | DB 쪽에서 가린다: code 를 가린 표시용 view 를 anon 에 노출하고 원 표는 anon SELECT 회수. 추측 표시: "개인 고객 코드=주민번호"는 형식만 보고 판단한 것 | M | 다음 |
| D6 pg_trgm 이 public 스키마에 있음 | advisor WARN | 낮음 | extensions 스키마로 이동 | S | 다음 |

## 부록 E. 운영

| 항목 | 증거 | 영향 | 고치는 방법 | 크기 | 언제 |
|---|---|---|---|---|---|
| E1 cron 목록 | 활성 13·비활성 1(11 kakao-bot-heartbeat). 최근 3일 job_run_details 실패 0 | 겉보기엔 정상 | — | — | — |
| E2 cron 성공이 함수 성공은 아님 | net._http_response 1,027건 중 366건 timed_out(5초) | 감시 사각(요약 4) | timeout 30초 + 응답 감시 쿼리를 ops-monitor 에 추가 | S | 다음 |
| E3 비밀 토큰 박힌 cron | 3,4,5,8,9,10,12,17,18,21,22,23 (모두 anon 키, 23 worker-watchdog 도 포함) | 키를 바꾸면 전부 고쳐야 함 | vault 로 이동(요약 4) | M | 다음 |
| E4 kakao-bot-watchdog(12) 명령 첫 줄이 DELETE | `delete from outbox where text like '%[봇점검]' and created_at < now()-6h` | 의도된 정리. 문서에 있는지만 확인 | — | — | — |
| E5 심박·백업 | worker_heartbeat worker@D6110 last_seen 10:52 KST(조회 시각과 같음), note "백업 완료 2026-10-24 · 표 62개 · 214,186행 · 32.6MB · 실패 0개". alerted_at 10-21 21:40 KST(그때 15분 넘게 끊긴 적 1회) | 정상 | — | — | — |
| E6 DB 크기 | 877MB. 상위: cron.job_run_details 293MB, jeomgeom 103MB, as_records 81MB, vendor_info 55MB, _backup_dupe_jeomgeom 55MB, lease_status 47MB, _backup_dupe_as 42MB, storage.objects 37MB | 1/3 이 cron 로그 bloat, 1/9 가 옛 백업 | 요약 7 + A10 | S | 다음 |

## 부록 F. 테스트 사각 (tests/ 에서 한 번도 import 안 되는 src 파일, 줄 수)

| 파일 | 줄 | 비고 |
|---|---|---|
| src/WalkingMap.tsx | 3,518 | 1753/1810 visibility 중복 등록 |
| src/CsAsWorkspace.tsx | 2,709 | 요약 1·8, 물류/AS FIELD 연결 |
| src/GrowthHub.tsx | 1,213 | |
| src/MyPlan.tsx | 1,183 | B9 |
| src/UnifiedHistory.tsx | 1,031 | 주민번호 가림 경로 |
| src/CopierNotes.tsx | 1,003 | |
| src/recontract/AnalyzeView.tsx | 969 | |
| src/FoodMap.tsx | 883 | |
| src/CustomerReport.tsx | 836 | B7 (고객에게 나감) |
| src/MisuVisitForm.view.tsx | 766 | |

데이터 파일 patchNotes.ts 1,254줄·agentWorkLog.ts 839줄은 뺐다. 그다음은 SelfDev 735, WorkDashboard 703, SystemAdmin 604. 판정 방법: tests/*.ts(x) 의 `../src/…` 경로 124개와 대조했다. 테스트한 파일이 간접으로 끌어오는 import 는 셈에 넣지 않았다.
