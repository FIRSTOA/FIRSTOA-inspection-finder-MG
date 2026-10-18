# anon 키 권한 줄이기 — 설계안 (2026-10-19, 데이터실 표다빈)

SQL 초안: `supabase/anon-permissions-20261019.sql` (아직 사용자에게 건네지 않음 — sql-review → /sql-handoff 순서)
범위: DB 권한만. 앱·봇·실행기 코드는 이 작업에서 고치지 않는다(2단계 선행 조건 1건만 따로 표시).

## 1. 왜 필요한가 (3줄)
1. 앱 안에 들어 있는 anon 키는 누구나 볼 수 있는 공개 키인데, 지금 DB가 새 표를 만들 때마다 이 키에 "지우기·통째로 비우기"까지 전부 자동으로 준다.
2. 그래서 RLS(행 잠금)가 꺼진 14개 표는 키만 있으면 외부에서 전체 삭제가 되고, RLS가 켜진 표도 TRUNCATE(통째로 비우기)는 RLS를 무시한다 — 87개 표 중 86개가 그 상태다.
3. 앱·봇·실행기가 실제로 쓰는 동작만 남기고 나머지를 빼면, 키가 새도 할 수 있는 일이 "앱 화면에서 할 수 있는 일"로 줄어든다.

> 한계: 앱이 로그인 없이 anon 하나로 쓰는 한, 앱이 하는 쓰기(예: as_tickets 삭제)는 키를 가진 누구나 할 수 있다. 근본 해결은 SSO 를 Supabase 로그인(JWT)으로 잇고 사람별 RLS를 거는 것(그룹웨어 SSO 2단계)이나, 쓰기를 엣지 함수로 옮기는 것. 이 설계안은 그 전에 "쓰지도 않는 위험한 권한"부터 걷어 내는 단계다.

## 2. 실측 (2026-10-19, Supabase MCP 읽기 전용)
- `pg_default_acl`: 소유자 postgres · 스키마 public · 표(r) → `anon=arwdDxtm, authenticated=arwdDxtm` (전권). 함수(f)·시퀀스(S)·storage 스키마도 같은 방식으로 anon 에 열려 있음(이번 범위 밖, 후속).
- public 표 87개 중 86개가 anon TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 보유 (예외: naver_oauth — anon 권한 없음).
- 아래 19개 표는 전부 anon·authenticated `S,I,U,D,T,R,Tg(,M)` 전권. PostgreSQL 17.6.
- RLS 꺼짐 14개: ai_usage, supply_requests, supply_events, worker_heartbeat, worker_jobs, feedback_items, plan_memos, room_activity, counter_sms_batches, counter_sms_targets, counter_sms_inbox, copier_playbook, vendor_notes, push_subscriptions.
- RLS 켜짐 5개의 기존 정책: outbox `anon all`(전부 true) · app_config/room_map `anon read` + `anon write(*)` · as_tickets/contact_changes 명령별 4개(전부 true).
- 이 표들을 건드리는 DB 쪽 실행자: 크론 kakao-bot-heartbeat(outbox insert)·kakao-bot-watchdog(outbox delete)·worker-watchdog(worker_heartbeat update)·counter-inbox-ingest(엣지 호출) — 모두 postgres/service_role 이라 영향 없음. 트리거 `outbox_delivery_log → log_outbox_delivery()` 는 SECURITY DEFINER 라 anon 이 outbox 를 지울 때 room_activity 기록은 소유자 권한으로 계속 된다.
- 이 표들을 읽는 뷰 없음. anon 이 실행할 수 있는 SECURITY INVOKER 함수 중 TRUNCATE 하는 것 없음.
- 앱 요청 헤더는 항상 `Bearer <anon>`(src/supabase.ts) — Supabase 로그인 세션을 쓰지 않으므로 authenticated 역할은 현재 아무도 안 쓴다. 대비용으로 anon 과 같게 맞춘다.

## 3. 표별 권한 — 누가 무엇을 쓰나 (코드 grep 근거) · 현재 → 목표

S=SELECT I=INSERT U=UPDATE D=DELETE, "전권"=S,I,U,D,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN

| 표 | 웹앱(src/) | 봇(gas-and-bot) | 실행기·카톡PC(tools/) | 기타 | 현재 anon | 1단계 목표 | RLS 1단계 | 2단계 |
|---|---|---|---|---|---|---|---|---|
| ai_usage | S (CostTile, Search360) | – | 백업 S | 엣지 data-ask/entity-ask 가 **service_role** 로 I | 전권, RLS off | **S** | 켬(select 정책) | – |
| supply_requests | S,I,U (SupplyBoard, supplyRequests, SupplyBackfill) — 삭제는 stage='취소' UPDATE | – | 백업 S | – | 전권, off | S,I,U | 켬 | – |
| supply_events | S,I,U (SupplyBoard:301 이벤트 되돌리기 UPDATE) | – | – | – | 전권, off | S,I,U | 켬 | – |
| feedback_items | S,I,U (FeedbackBoard) — 삭제는 deleted_at | – | 백업 S | 피드백 루틴(docs/feedback-pipeline-runner.md) anon S,U | 전권, off | S,I,U | 켬 | – |
| plan_memos | S,I,U (MyPlan, AutoSchedule upsert author,ticket_id) | – | 백업 S | – | 전권, off | S,I,U | 켬 | – |
| counter_sms_batches | S,I,U,D (CounterSms:431,460) | – | 백업 S | counter-inbox-ingest(service_role) | 전권, off | S,I,U,D | 켬 | – |
| counter_sms_targets | S,I,U,D (CounterSms:302,459) | – | 백업 S | 〃 | 전권, off | S,I,U,D | 켬 | – |
| copier_playbook | S,I,U,D (CopierNotes:503) | – | 백업 S | – | 전권, off | S,I,U,D | 켬 | – |
| vendor_notes | S,I,U,D (UnifiedHistory:429,466,471 중복 정리) | – | 백업 S | – | 전권, off | S,I,U,D | 켬 | – |
| push_subscriptions | S(prefs만),I,U,D (push.ts upsert·해지·prefs) | – | 백업 S(전 컬럼) | push-send 엣지 **service_role** S,D | 전권, off | S,I,U,D | 켬 | **SELECT 를 열쇠 2컬럼(p256dh·auth) 뺀 컬럼만** |
| worker_heartbeat | S (LiveSendBoard, counterSmsPhoto) | – | **I,U upsert on_conflict=name** (worker.py:41) | 크론 worker-watchdog(postgres) U alerted_at | 전권, off | S,I,U | **그대로 off** | RLS 켬 + U 컬럼(name,host,version,note,last_seen) |
| worker_jobs | I (SupplyBoard:210, counterSmsPhoto:152) | – | **S + PATCH**(status,claimed_at,claimed_by,finished_at,result,error) | – | 전권, off | S,I,U | **off** | RLS 켬 + U 컬럼 6개 |
| room_activity | S (Home, LiveSendBoard, RoomDeliveryBoard) | **I,U upsert merge-duplicates**(30분마다) | 카톡PC outbox_relay **I,U upsert** | 트리거 log_outbox_delivery(definer) | 전권, off | S,I,U | **off** | RLS 켬 + U 컬럼(room,last_at,source) |
| counter_sms_inbox | S, U(applied_at,applied_by,batch_id,note) (CounterSms:193) | **I** (마감방 목록) | – | counter-inbox-ingest(service_role) | 전권, off | S,I,U | **off** | RLS 켬 + U 컬럼 4개 |
| outbox | I (SupplyBoard, counterSmsPhoto), S (Home 등 화면) | **S, DELETE(ack)** | 실행기 I(사진 폴백), 카톡PC **S, DELETE** | 크론 I·D(postgres) | 전권, RLS on(anon all) | **S,I,D** (UPDATE 쓰는 곳 없음) | 이미 켬 | – |
| app_config | S, I,U (SystemAdmin, authors) — 삭제 없음 | – | 백업 S | 엣지 S(service_role) | 전권, on | S,I,U | 이미 켬 | – |
| room_map | S,I,U,D (SystemAdmin:145) | **S** (마감방 이름, 10분마다) | 백업 S | – | 전권, on | S,I,U,D | 이미 켬 | – |
| as_tickets | S,I,U,D (CsAsWorkspace, ServiceReception 등) | – | 백업 S | api/calendar-ics.js S | 전권, on | S,I,U,D | 이미 켬 | – |
| contact_changes | S,I,U,D (ContactChangeHistory:98) | – | 백업 S | 엣지 contact-sheet-pull(service_role) | 전권, on | S,I,U,D | 이미 켬 | – |

공통: 19개 모두 TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 회수, SELECT 유지(노트북 02:30 백업이 anon 으로 전 표를 읽기 때문). authenticated 는 anon 과 같게.
그 밖의 public 표 67개(원장 표 등): 이번엔 **TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 만** 회수(S/I/U/D 는 손대지 않음).

1단계에서 실제로 줄어드는 것:
- **DELETE 회수 10개 표**: ai_usage, supply_requests, supply_events, feedback_items, plan_memos, worker_heartbeat, worker_jobs, room_activity, counter_sms_inbox, app_config.
- **UPDATE 회수 2개**: ai_usage, outbox. **INSERT 회수 1개**: ai_usage.
- 동적 표 이름 호출(api.ts:1065 insertRow(s.table) = 점검·AS 양식 표, counterSmsContacts.ts = counter_sms_contact_rules)도 확인 — 위 19개 표와 무관.
- **RLS 켜는 표 10개**: ai_usage, supply_requests, supply_events, feedback_items, plan_memos, counter_sms_batches, counter_sms_targets, copier_playbook, vendor_notes, push_subscriptions.
- **TRUNCATE 등 회수**: public 표 86개 전부.
- **기본 권한**: 새 표 자동 전권 중단.

## 4. 1단계 / 2단계를 나눈 기준
- 1단계 = "코드 어디에도 없는 동작"만 빼고, RLS 는 웹앱만 쓰는 표에만 켠다. grep 이 맞다면 구조적으로 아무것도 끊기지 않는다.
- 2단계 = 봇·실행기 경로에 RLS·컬럼 제한을 거는 것. 정책 하나만 빠져도 폰 봇·노트북은 조용히 실패(봇은 로그만, 실행기는 "권한 없음" 로그)하고 현장에서 늦게 알게 되므로, 1단계 뒤 하루 이상 지켜본 다음 시험 블록(T)으로 anon 흉내를 내서 확인 후 실행.
  - worker_heartbeat · worker_jobs · room_activity · counter_sms_inbox: upsert(merge-duplicates)는 RLS 에서 select·insert·update 정책이 모두 있어야 하고, 컬럼 UPDATE 제한은 PostgREST 가 보낸 컬럼 전부(키 포함)를 SET 하므로 한 컬럼만 빠져도 실패한다.
  - push_subscriptions 열쇠 숨기기: ① 백업(backup_tables.py)이 `select=*` 로 읽어 그 표가 실패로 찍히므로 백업 목록에서 빼는 코드 수정이 먼저(실행기 코드 → /laptop-update), ② 구독 upsert 의 `ON CONFLICT DO UPDATE SET p256dh = excluded.p256dh` 가 컬럼 SELECT 없이 되는지 확인 필요. 안 되면 SECURITY DEFINER RPC 로 바꾸는 앱 작업이 먼저. 참고: 열쇠만으로는 푸시를 보낼 수 없다(VAPID 비밀키가 엣지 함수에만 있음) — 급하지 않다.

## 5. 끊길 수 있는 것과 확인 방법 (실행 직후 10분 + 다음 날 아침)
SQL 맨 끝의 확인 쿼리로 권한 표가 기대값과 같은지 먼저 본다(TRUNCATE 남은 표 0, 기본 권한 줄에 anon 없음).

| 흐름 | 확인 방법 (읽기) | 정상 |
|---|---|---|
| 봇 심박·발송 | `select room, last_at, source from room_activity order by last_at desc limit 5;` | 30분 안의 `bot_seen`/`bot_send` 줄이 계속 생김 |
| outbox 흐름 | `select count(*), min(created_at) from outbox where text not like '%[봇점검]';` | 몇 분 안에 0 으로 비워짐(봇 7초 폴링, 2분 넘으면 카톡PC 중계) |
| 실행기 심박 | `select name, host, last_seen, note from worker_heartbeat;` | last_seen 이 1~2분 안 (LOOP 60초) |
| 실행기 일감 | `select id, kind, status, error, finished_at from worker_jobs order by id desc limit 5;` | queued 가 오래 남지 않음, error 에 permission 없음 |
| 마감 목록 수집 | 앱 카운터 문자 탭 "관리부 목록 도착" / `select max(received_at) from counter_sms_inbox;` | 마감방 글이 오면 늘어남 |
| 백업 | 다음 날 노트북 `tools/worker/logs/backup-<날짜>.txt` | 19개 표 모두 ✓ |
| 웹앱 | 관리 탭 카톡 발송 현황, 부품 신청 출고·반납, 피드백 등록, 내 일정 메모, 카운터 문자 목록 맞추기, 족보·업체 메모 저장, 푸시 켜기/끄기 | 오류 토스트 없음 |
| 화면에서 바로 | 관리 탭 '카톡 발송 현황'(LiveSendBoard)은 room_activity·worker_heartbeat 를 함께 보여 준다 | 봇·실행기 모두 초록 |

ops-monitor 역할에 "실행 직후 상태 조회"를 맡기면 위 표를 한 번에 본다.
에러 문자열로 원인 구분: `permission denied for table X` = grant 문제(C), `new row violates row-level security policy` = 정책 문제(D/2단계).

## 6. 실행 순서
1. sql-review 검사 → /sql-handoff 로 사용자에게 파일 1개 전달, 실행 대기 목록에 기록.
2. 평일 낮(봇·실행기 모두 살아 있을 때, 사람이 화면을 볼 수 있을 때) SQL Editor 에서 파일 통째로 실행 — 1단계는 한 트랜잭션이라 중간 실패 시 전부 취소.
3. 맨 끝 확인 쿼리 결과를 기대값과 대조.
4. (선택) 시험 블록 T 의 주석을 풀어 실행 — 마지막이 rollback 이라 흔적 없음. 막혀야 하는 3줄은 하나씩 따로.
5. 5절 표로 10분 관찰, 다음 날 아침 백업 로그 확인.
6. 하루 이상 정상이면 2단계: 2-1·2-2 → 시험 블록 T 다시 → 관찰. 2-3 은 백업 목록 수정과 upsert 확인 뒤.
7. 이후 새 표를 만드는 모든 SQL 에 `grant ... to anon, authenticated` 를 명시(db-schema·sql-review 체크 항목에 추가 권장 — 안 적으면 앱에서 `permission denied`).

## 7. 되돌리기
SQL 파일의 "되돌리기" 블록 주석을 풀어 실행: 기본 권한 전권 복구 → naver_oauth 를 뺀 모든 표에 TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 복구 → 19개 표 전권 복구 → 10개 표 RLS 끄기. 실행 전 상태(2026-10-19 실측)와 정확히 같아진다(정책은 남지만 RLS 가 꺼지면 무시됨).
부분 되돌리기: 특정 표 하나만 막혔다면 그 표에만 `grant <빠진 동작> on public.<표> to anon, authenticated;` 한 줄.

## 8. 추정·미확인 (코드로 확정 못 한 것)
- GAS 시트 동기화(미수·임대리스트 등): 이 19개 표에는 쓰지 않음을 확인(apps-script/ grep 0건). 그 표들의 키가 service_role 인지는 확인 못 함 — 이번 1단계는 그 표들의 S/I/U/D 를 건드리지 않으므로 영향 없음(TRUNCATE 등만 회수). GAS 가 TRUNCATE 를 쓴다면 문제인데 REST 로는 TRUNCATE 를 할 수 없어 가능성 없음으로 판단.
- counter-inbox-ingest 엣지 함수: `SERVICE_ROLE_KEY || ANON_KEY` — 호스팅 환경엔 service_role 비밀이 항상 있으므로 service_role 로 추정. 만약 anon 으로 돈다면 counter_sms_* 쓰기는 1단계 grant 로 그대로 허용됨(inbox 는 DELETE 없음).
- 피드백 자동 개발 루틴(docs/feedback-pipeline-runner.md): 문서상 anon 으로 feedback_items S,U 만. 실제 실행 코드는 저장소에 없음(외부 루틴).
- 메신저봇R 실제 폰 스크립트: 저장소 gas-and-bot/supabase-outbox-poller.js 와 폰에 붙여 넣은 것이 같다고 가정(GET/POST/DELETE 만, PATCH 없음).
- scripts/backup-tables.mjs(데스크톱 WSL 옛 백업): 읽기만. 멈춰 있음.
- naver-calendar-sync 엣지 함수의 ANON 사용(266행): 이 19개 표 쓰기는 아님(grep 0건).

## 9. 범위 밖 후속 (이번 SQL 에 없음)
- 함수 기본 권한(새 함수 anon EXECUTE 자동), 시퀀스, storage 스키마 기본 권한도 같은 방식으로 열려 있음.
- anon 이 실행 가능한 SECURITY INVOKER 함수 refresh_vendor_master·map_workin_vendor_codes·refresh_lease_ident_code(DELETE 포함) — anon 실행 필요 여부 검토.
- 원장 표·기타 67개 표의 S/I/U/D 실제 필요량 점검(이번과 같은 방식으로 2차).
