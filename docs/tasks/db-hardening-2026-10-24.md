# DB 권한·운영 정비 — 설계안 (2026-10-24, 데이터실 표다빈)

권한나 검사(2026-10-24): 실행 금지 없음. 고친 뒤 실행 3곳 반영 — cron-vault 가드 3개(소유자·대상 12개·키 1종류), rls 사진 일감 방 btrim + COUNTER_KAKAO_ROOM, cleanup 보관 폴더 out 필수·region 표 포함·타임아웃 주석.

근거: docs/tasks/risk-audit-2026-10-24.md "다음" 항목 3·4·5·7·9 + 부록 A10·D·E.
DB 에는 아무것도 쓰지 않았다(MCP 는 SELECT 만). SQL 은 사용자가 SQL Editor 에서 실행 — 그 전에 권한나(sql-review) 검사 → /sql-handoff.

| 파일 | 다루는 것 | 실행 |
|---|---|---|
| `supabase/hardening-app-config-log-20261024.sql` | (A) app_config 변경 이력 + 잠금 키 표(기본 비어 있음) | 아무 때나, 통째로 |
| `supabase/hardening-cron-vault-20261024.sql` | (B) cron 12개 JWT → vault, 타임아웃 늘림, 응답 감시 | 평일 낮, 통째로 |
| `supabase/hardening-rls-worker-tables-20261024.sql` | (C) RLS 꺼진 표 4개 정책 | 평일 낮, 통째로 |
| `supabase/hardening-cleanup-20261024.sql` | (D) cron 로그 보존 7일, 옛 백업 표 내려받기 → (주석) DROP | 1~2 블록 아무 때나, 3 블록은 백업 확인 뒤 |
| `supabase/hardening-vacuum-cron-log-20261024.sql` | (D) VACUUM FULL 한 줄 | 저녁, **혼자** |
| (E) | AI·record-edit 엣지 함수 호출자 확인 | 보고만 — 코드 작업 |

## 0. 라이브 실측 (2026-10-24 11시 KST, MCP) — "DB 에서 본 값"

- `pg_default_acl` public 표: anon 없음 → 10/19 anon-permissions 1단계는 **실행돼 있다**. (파일 머리엔 "실행 대기"로 적혀 있음 — 파일 값과 다름)
- app_config: 23행, RLS 켜짐, 정책 `app_config anon write` ALL using(true) check(true). anon S·I·U = true, D = false. 트리거 없음.
- 4개 표 worker_jobs·worker_heartbeat·room_activity·counter_sms_inbox: RLS 꺼짐, 정책 0, anon S·I·U = true, D·TRUNCATE = false. worker_jobs 0행, heartbeat 1행(worker@D6110), room_activity 40행, inbox 18행.
- cron: 활성 13 + 비활성 1(11). JWT 박힌 job 12개(3,4,5,8,9,10,12,17,18,21,22,23), **서로 다른 키 1개**, payload role=anon. vault.secrets 0개.
- net._http_response(최근 6시간) 1,027건: 200 661 · timed_out 366. 타임아웃은 매분 :00 에 몰림 → 매분 job(3·8).
  엣지 로그 24h: naver-calendar-sync 5,632회 평균 5.8초·최대 48초, customer-message-send 최대 7.3초, field-sheet-sync 최대 16.5초.
  **pg_net 의 timed_out = DB 가 기다리기를 멈춘 것, 함수 실패 아님**(엣지 로그에서 함수는 끝까지 돈다). 진짜 사각은 "함수가 500 을 내도 cron 은 succeeded" 쪽.
- net._http_response 에는 URL·job 이름이 없다 → 지금 구조로는 어느 cron 이 실패했는지 못 가린다.
- cron.job_run_details: 총 293MB = heap 286MB + 인덱스 7.6MB, 살아 있는 데이터 43MB(64,287행, 10/9~), 지운 행 누적 239,331. purge-cron-log(24) 14일 보존. cron.log_run = postmaster 설정(SQL 로 못 끔). postgres 는 MAINTAIN 권한 있음.
- 백업 표: `_backup_dupe_20260827_jeomgeom` 55MB 31,771행 · `_as` 42MB 21,513행(8/26 이후 변경 0, 지금 표에 없는 행 9,146 + 7,886 — 그때 지운 중복은 여기에만 있음, 노트북 백업 목록에 없음, anon 이 S·I·U·D 가능) · `_backup_region_20260826` 1.5MB · `_backup_cleanup_20261019` 344kB · `okr_*_bak_20261020` 376kB.
- 엣지 함수 24개 중 verify_jwt=false 는 report-view 하나. 나머지는 anon JWT 로 통과.

---

## (A) app_config anon 쓰기

지금 쓰는 곳: 관리 탭 `SystemAdmin.tsx:124 saveConfig`(스위치·TEST_ROOM·네이버 캘린더·오버홀 탭·KPI_TARGETS — KpiTargetsEditor 도 이 함수), **`authors.ts:285-289` TEAM_GROUPS 저장(작성자 선택 창 — 관리자 아닌 사람도 씀)**. 엣지(service_role): field-sheet-sync SHEET_WRITE_LOCK(2분마다), weekly-keyman-poster KEYMAN_POSTER_SENT, naver-calendar-push NAVER_CALENDAR_ID.

| | ① 트리거 감사 로그 (+선택 잠금 키) | ② 쓰기는 엣지 함수만 | ③ RLS 에서 요청 헤더 비밀 검사 |
|---|---|---|---|
| 무엇 | AFTER 트리거가 app_config_log 에 키·전값·새값·역할·UA·IP 기록. 선택: app_config_lock 에 적은 키는 anon 거절 | 새 엣지 `config-save`(service_role) 만 쓰고 anon INSERT·UPDATE 회수. 키 화이트리스트·값 검사·로그 | 정책 `using (admin_token_ok())` — `request.headers` 의 x-admin-token 을 vault 값과 비교(SECURITY DEFINER) |
| 막는가 | 막지 않음(사후 추적). 잠금 키만 막음 | anon 직접 쓰기는 막음. **하지만 함수 자체가 anon JWT 로 불리므로 호출자 확인(E-3)이 없으면 우회 경로가 하나 바뀔 뿐** | 비밀을 아는 기기만 씀 |
| 코드 | 0 | 새 엣지 1개 + SystemAdmin.saveConfig 6줄 + authors.ts 저장 3줄 (+E-3 세션 토큰 헤더) | supabase.ts 헤더 1줄 + 관리자 기기에 토큰 입력 칸 + TEAM_GROUPS 예외 정책 |
| 단점 | 위조된 UA·IP 는 못 거름. 잠근 키는 관리 탭 스위치로 못 바꿈(SQL 로) | 작업 M. 관리 탭 저장 경로가 엣지 장애에 묶임 | 공용 비밀번호 1개(사람 구분 없음), 브라우저 저장소 평문, 회전 때 전 관리자 재입력, PostgREST 헤더 GUC 의존, 일반 사용자 TEAM_GROUPS 가 깨지지 않게 키별 예외 필요 |
| 크기 | S | M | S~M |

**권장: ① 지금 + ② 다음(E-3 세션 토큰과 한 묶음).** ③ 은 E-3 전에 급히 막아야 할 때의 임시안 — 기본은 비추천.
②로 갈 때 범위(코드 작업, 이번 SQL 없음): `supabase/functions/config-save/index.ts`(새), `src/SystemAdmin.tsx` saveConfig, `src/authors.ts` saveGroups, 마지막에 SQL `revoke insert, update on public.app_config from anon, authenticated;` + 정책 `app_config anon write` → select 전용으로. ①의 로그 트리거는 그대로 쓸모 있음(actor_role=service_role 로 찍힘 — 그래서 ② 함수는 요청자 이름을 같이 넘겨 별도 열에 적도록 설계).

①이 기록하지 않는 것: SHEET_WRITE_LOCK(잠금 행, 2분마다 소음), 값이 안 바뀐 UPDATE. 처음 실행 때 현재 23개 값을 snapshot 으로 한 번 적는다.
앱에서 보는 법(관리 탭 "변경 이력"을 붙인다면): `selectRows("app_config_log", "select=changed_at,op,key,old_value,new_value,actor_role,via,user_agent&order=changed_at.desc&limit=50")` — client_ip 는 열 권한이 없으므로 `select=*` 금지.

## (B) cron 의 박힌 JWT 와 5초 타임아웃

설계:
1. vault 비밀 `field_cron_jwt` — **지금 cron 명령에서 꺼내 넣는다**(SQL 파일에 키 글자 없음). payload role 이 anon 이 아니면 중단.
2. 비노출 스키마 `ops`(anon·authenticated 사용권 회수, PostgREST 노출 안 됨)에 `ops.call_edge(함수, body, timeout_ms, tag)` — SECURITY DEFINER, vault 에서 키를 읽어 `net.http_post` 후 요청 id 를 `ops.edge_calls` 에 적는다. 실행권은 postgres(=cron)만. **서비스 키 아님.**
3. `cron.alter_job` 으로 12개 명령 교체(이름으로 찾음, 일정·활성 그대로). 원래 명령은 `ops.cron_command_backup` 에 처음 것만 저장 → 되돌리기 1줄.
4. 타임아웃: 3 customer-message-dispatch 5→30초, 4 field-sheet-retry 5→30초, 5 photo-drive-archive 5→150초, 8 naver-calendar-sync 5→60초. 나머지는 원래 값.
5. 감시: 새 cron `edge-call-collect`(5분, HTTP 없음)가 net._http_response(6시간 뒤 사라짐) 결과를 ops.edge_calls 에 옮겨 적고 7일 지난 것 삭제. 뷰 `ops.edge_call_status`(호출별 ok / http_error / no_wait / net_error / lost / pending), `ops.edge_call_health`(cron 별 1h·24h 요약, last_ok_at).
   ops-monitor 조회 한 줄: `select * from ops.edge_call_health order by bad_1h desc, tag;` — bad_1h>0 이거나 last_ok_at 이 일정보다 오래되면 이상.
6. 키 회전: 대시보드 Vault 에서 field_cron_jwt 값만 바꾸면 12개가 같이 바뀐다.

주의(파일에 적힌 값 ≠ 라이브): supabase/ 의 cron SQL 10개(contact-sheet-pull-cron, counter-inbox-ingest-cron, customer-message-cron-seoul, field-sheet-retry-cron, kakao-bot-heartbeat-cron, naver-sync-cron, photo-archive-cron, weekly-keyman-poster-cron, worker-heartbeat, worker-watchdog-current-host)에 옛 방식 키 글자가 그대로 있다. 이 SQL 실행 뒤 그 파일을 다시 실행하면 키가 다시 박힌다 → 후속: 그 파일 머리에 "구판 — 재실행 금지, ops.call_edge 사용" 주석(코드 작업 S).
선택(이번 범위 밖): 앱 관리 탭에서 보려면 public 에 요약 뷰 + anon grant 를 따로 만든다. 경보를 원하면 edge-call-collect 끝에 `bad_1h ≥ N` 일 때 push-send 호출을 붙인다(카톡 시간 규칙과 무관한 웹푸시).

## (C) RLS 꺼진 표 4개

코드 확인 결과(파일·줄은 SQL 머리 주석):

| 표 | 쓰는 쪽 | 열어 둔 것 | 막는 것 |
|---|---|---|---|
| worker_jobs | 앱 anon INSERT(kakao_photo) · 노트북 anon SELECT·PATCH · 사람 SQL Editor(ping/backup/relay/poster) | SELECT 전부 · INSERT 는 kind=kakao_photo, queued, 방이 room_map·COUNTER_KAKAO_ROOM·TEST_ROOM 중 하나(btrim 비교) · UPDATE 는 queued/running 행의 상태 6열만 | 다른 종류 일감·아무 방, payload 고치기, 끝난 일감 되살리기 |
| worker_heartbeat | 노트북 anon upsert · 앱 SELECT · cron(postgres) alerted_at | name like 'worker@%', last_seen ≤ now()+15분, 5열 | 미래 시각으로 경보 끄기, alerted_at 지우기 |
| room_activity | 봇 upsert 'message' · 카톡 PC upsert 'pc_send' · 트리거(소유자) 'bot_send' | source ∈ {message, pc_send}, last_at ≤ now()+1시간, 3열 | anon 이 'bot_send' 위조 |
| counter_sms_inbox | 봇 INSERT · 앱 PATCH 처리 표시 · 엣지 service_role | INSERT 는 처리 전 상태만(4열) · UPDATE 는 처리 4열 | 글 내용 고치기, 처리 완료로 넣기 |

anon-permissions-20261019.sql 의 2단계(주석)는 이 파일로 **대체**한다(그쪽은 정책이 모두 true 라 범위가 넓다).
한계: 공개 키인 한 "노트북만 심박을 쓴다"는 증명 못 함. 진짜로 막으려면 후속 — 실행기 전용 비밀 `x-worker-token` 헤더(worker.py·outbox_relay.py 의 rest 헤더 1줄 + 정책 조건 `worker_token_ok()` + vault). 노트북 반영은 /laptop-update.

실행 직후 10분 관찰:

| 흐름 | 확인 | 정상 |
|---|---|---|
| 실행기 심박 | `select name, last_seen, note from worker_heartbeat;` | 1~2분 안 |
| 봇 활동 | `select room, last_at, source from room_activity order by last_at desc limit 5;` | 새 message 줄 |
| 카톡 PC 중계 | 같은 표 pc_send | 중계가 있었으면 갱신 |
| 사진 일감 | 카운터 문자 [📷 사진 전송] 1건(테스트방) → `select id, status, error from worker_jobs order by id desc limit 3;` | done |
| 마감 목록 | 마감방 글 → `select max(received_at) from counter_sms_inbox;` | 늘어남 |
| 백업(다음 날) | 노트북 backup 로그 | 실패 0개 |

에러 구분: `permission denied for column` = 열 grant 에 빠진 열, `new row violates row-level security policy` = 정책 조건.

## (D) cron 로그 bloat · 옛 백업 표

- 보존 14일 → **7일**(기본 제안, 결정 필요). 하루 ~5,000행 → 살아 있는 데이터 ~22MB.
- `VACUUM FULL cron.job_run_details` — 따로 한 줄 파일. 잠금이 걸리는 동안 시작하는 cron 은 기록을 못 써서 잠깐 기다림(예상 수 초~30초). 권장 시각: 평일 19:30~21:00 KST 또는 주말 낮. 293MB → 20~45MB 예상.
- 매분 job 기록 자체를 줄이는 근본책(cron.log_run off)은 postmaster 설정이라 SQL 로 못 함 → Supabase 지원 요청 또는 매분 job 2개(3·8)의 주기 완화(3·8 은 업무 영향 검토 필요, 이번 범위 밖).
- 옛 백업 표: `_backup_dupe_20260827_*` 2개 + `_backup_region_20260826` 을 노트북 일감 `backup` 으로 **별도 보관 폴더(payload out, 필수 — 비우면 그날 백업 manifest 를 덮어쓰고 14일 뒤 지워짐; 2026-10-24 worker.py 2026-10-24a 부터 폴더 이름만(`archive-20261024`) 적으면 백업 루트 아래로 풀어 노트북 경로를 몰라도 됨)** 에 먼저 내려받고, 그다음 **행 수 검증 가드가 있는 DROP 블록**(주석)을 실행. 사본 표는 인덱스가 없어 anon 페이지 조회가 statement_timeout 에 걸릴 수 있다(추정) — 실패해도 DROP 가드가 막고, 그때는 대시보드 CSV 내려받기로 대신(가드는 사람이 판단해 우회). region 표 DROP 은 같은 블록 안 주석 한 줄(결정). `_backup_cleanup_20261019`·`okr_*_bak_20261020` 은 최근 것이라 이번엔 남긴다.

## (E) AI·쓰기 엣지 함수 호출자 확인 — 보고만

현재: entity-ask·data-ask·report-polish·okr-assist·counter-ocr·playbook-draft 등과 record-edit 가 verify_jwt=true 지만 **공개 anon JWT 로 통과**. 앱의 SSO 세션은 localStorage JSON(그룹웨어 5분 토큰은 확인 직후 버림, sso.ts:5) → 서버가 확인할 수 있는 신원 증명이 지금 없다. record-edit 는 표·열 화이트리스트와 `_edit_log` 강제가 있지만 작성자 이름은 요청 본문 그대로다.

| 선택지 | 무엇 | 효과 | 범위(코드) | 크기 |
|---|---|---|---|---|
| E-1 호출 상한 | 함수 안에서 ai_usage 최근 1시간·하루 건수로 429 | AI 비용 폭주 차단. record-edit 는 못 막음 | `_shared/ai-guard.ts`(새) + AI 함수 6개에 2줄. SQL 0 | S |
| E-2 Origin 확인 | Origin 이 FIELD 도메인일 때만 | 브라우저 장난만 막음, curl 은 통과 | 함수마다 1줄 | S(효과 낮음) |
| E-3 FIELD 세션 토큰 | 새 엣지 `sso-exchange`: 그룹웨어 5분 토큰을 서버가 /sso/userinfo 로 확인 → HMAC 서명 세션 토큰(7일, 이름·역할) 발급. 앱은 `x-field-session` 헤더로 보냄, 민감 함수는 `_shared/field-session.ts` 로 검증 | 사람 단위 확인 — AI·record-edit·(A)② config-save 모두에 재사용, record-edit 작성자도 토큰 이름으로 | 새 엣지 1 + _shared 1 + `src/sso.ts` 콜백 교환·보관 + `src/supabase.ts` invokeEdgeFunction 헤더 1줄 + 대상 함수마다 2~3줄. 이미 로그인한 기기는 토큰이 없으니 "기록만" 유예기간 뒤 강제 | M |
| E-4 Supabase Auth 연결 | 그룹웨어 SSO → Supabase 세션(JWT) → 사람별 RLS | 근본. anon 쓰기 자체를 줄일 수 있음 | 큼(SSO 2단계) | L |

권장: **E-1 지금(S)**, **E-3 다음** — (A)② 와 같은 토큰을 쓰므로 한 작업으로 묶는다. E-4 는 그룹웨어 SSO 2단계 과제로 남김.

---

## 실행 순서 (각 파일은 서로 독립 — 하루에 하나씩이면 원인 가리기 쉽다)

1. 권한나(sql-review) 검사 → /sql-handoff 로 사용자에게 전달, 실행 대기 목록에 기록.
2. `hardening-app-config-log-20261024.sql` — 아무 때나. 확인: 관리 탭 TEST_ROOM 한 글자 바꿨다 되돌리기 → log 2줄(anon, rest).
3. `hardening-cron-vault-20261024.sql` — 평일 낮. 확인 쿼리 → 3분 뒤 `ops.edge_call_health` 에서 매분 job 이 ok.
4. `hardening-rls-worker-tables-20261024.sql` — 평일 낮, 위 (C) 10분 관찰, 다음 날 백업 로그.
5. `hardening-cleanup-20261024.sql` 1~2 블록 → 백업 일감 done·실패 0개 → 파일 두 개 보관 폴더로 → 3 블록(DROP) 주석 풀어 실행.
6. 그날 저녁 `hardening-vacuum-cron-log-20261024.sql` (그 한 문장만).
7. 다음 작업(코드): E-1, 그다음 E-3 + (A)② 묶음, cron SQL 10개 머리 주석, ops-monitor 역할에 `ops.edge_call_health` 조회 추가.

## 되돌리기 요약

| 파일 | 되돌리기 |
|---|---|
| app-config-log | 트리거 2개·함수 3개·표 2개 drop (파일 끝 블록). app_config 는 바뀐 것이 없음 |
| cron-vault | `select cron.alter_job(b.jobid, command := b.command) from ops.cron_command_backup b join cron.job j on j.jobid = b.jobid;` + edge-call-collect unschedule |
| rls-worker-tables | 4개 표 `disable row level security` + `grant select, insert, update` (파일 끝 블록) |
| cleanup | 보존: purge 명령 '7 days' → '14 days' 로 다시 alter_job. 지운 로그·DROP 한 표는 복구 불가(표는 내려받은 json 으로 수작업) |
| vacuum | 필요 없음 |

## 사용자 결정 필요

1. (A) 잠글 키 — 없음(기본) / `SSO_REQUIRED` 만 / 더(FIELD_KAKAO_SEND_ENABLED·TEST_MODE). 잠그면 관리 탭 스위치로 못 바꾸고 SQL 로만.
2. (A)②·E-3 묶음 작업 진행 여부(코드 M) — 하면 기획실 설계부터.
3. (B) 타임아웃 값(30·30·150·60초) 그대로 괜찮은지.
4. (C) 사진 일감 방 제한(room_map 에 있는 방 + COUNTER_KAKAO_ROOM + 테스트방, 앞뒤 공백 무시)과 심박 이름 규칙(`worker@` 로 시작) 괜찮은지. 다른 노트북을 쓰게 되면 이름이 `worker@<PC이름>` 이라 그대로 통과.
5. (D) cron 로그 보존 7일 vs 14일.
6. (D) `_backup_dupe_20260827_*` 2개 DROP(내려받은 뒤) 승인, `_backup_region_20260826` 도 지울지.
7. (D) VACUUM FULL 실행 시각.
8. (E) E-1 상한 숫자(제안: 사람 구분 없이 함수별 시간당 60회·하루 400회. ai_usage 실측: 기록 있는 날 11일, 하루 최대 31건 — 넉넉한 값).


## 2026-10-24 13:10 실행 결과 (팀장 MCP 확인)
- ①②③⑤ 실행 완료. ④ 1블록 완료(purge 7일, cron 로그 34,975행). ④ 2블록 일감은 노트북이 바로 집었으나 **표 3개 모두 0행·실패** — 원인: 옛 백업 표 3개는 RLS 켜짐·정책 0·anon grant 없음(10/19 anon-permissions 하드닝 뒤 상태), 실행기는 anon 으로 읽으므로 빈 결과. 이 설계의 전제("anon 이 SELECT 할 수 있어 카톡 원문 노출")는 이미 해소돼 있었다.
- 결정(팀장): 3블록 DROP 은 **보류** — 노출 위험은 없고 97MB 용량만 남음. 지우려면 사람이 대시보드 Table Editor 에서 CSV 3개를 내려받은 뒤 3블록 가드(일감 done·실패 0개)를 수동 판단으로 우회해 실행. 실행기 backup 일감은 anon 이 볼 수 없는 표에는 쓸 수 없다(README 에 적음).
