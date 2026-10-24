# 03. 데이터베이스 (Supabase `kkdiihazgzesbqxjytqv`)

> **[라이브]** = 2026-10-22 Supabase MCP(읽기 전용)로 직접 조회한 값. **[파일]** = 저장소 SQL·문서에 적힌 값.
> 행 수는 `pg_class.reltuples` 추정치(대략). 정확한 수는 `select count(*)`.

## 1. 한눈에 [라이브]
- public 표 90개(백업 표 포함), 뷰 1개(`all_vendor_tabs`), public 함수 59개.
- 확장: pg_cron 1.6.4, pg_net 0.20.4, pg_trgm 1.6, pgcrypto, uuid-ossp, supabase_vault(비어 있음), pg_stat_statements.
- Storage 버킷 3개 — `photos`, `reports`, `promo-materials` **모두 public**. 사진은 월 1.3GB 정도 늘고, 오래된 사진은 엣지 `photo-drive-archive`(cron 매시 25분)가 드라이브로 옮긴다.
- 큰 표: `jeomgeom` 103MB, `as_records` 80MB, `vendor_info` 55MB, `_backup_dupe_20260827_jeomgeom` 55MB, `lease_status` 47MB, `_backup_dupe_20260827_as` 42MB.

## 2. 원본 구분 — 가장 중요한 표

### 2-1. 구글 시트가 원본인 표 (FIELD 에서 고쳐도 시트가 이긴다)
| 표 | 시트 → DB 방식 | 시각(KST) | 근거 |
|---|---|---|---|
| `vendor_info` (임대리스트, ~23,300행) | GAS `syncLeaseToSupabase` **증분 upsert** | 월요일 05시대(실측 `_등록시각` 05:55) | apps-script/first-data/src/SupabaseSync.gs, supabase/vendor-info-dept.sql 주석 |
| `pc_expansion`, `mfp_expansion`, `misu`, `overage` | GAS `supabaseReplaceAll_` **전 행 삭제 → 다시 넣기** | 매일 00시대(`syncNonLeaseOnly`, 00:30 경) | apps-script/first-data/src/Supabase.gs, Menu.gs |
| `lease_status` (임대현황표) | 같은 전체 교체 | 월요일 04시대(`syncLeaseStatusOnly`) | Menu.gs |
| `misu_cs_checks` | GAS `syncMisuCsToSupabase` | 매시 | Supabase.gs |

**통째 교체 표의 주의점**
- 매일 밤 행 `id` 가 새로 매겨진다. id 로 다른 표에서 참조하면 안 된다(`_dupKey` 를 쓴다).
- FIELD 에서 이 표에 쓴 것(숨김, 웹앱 미수 기록 등)은 밤에 사라진다. 실제로 옛 미수 탭 기록이 0건 남아 `misu_visits`(FIELD 원본)를 새로 만들었다.
- 숨김 유지 장치: `mirror_hidden(table_name, dup_key)` 장부 + 트리거 `mirror_hidden_track`(숨김 바뀌면 기록)·`mirror_hidden_apply`(다시 넣을 때 숨김 복원). **[라이브] 4표(pc/mfp/misu/overage) 모두 트리거 있음** = `supabase/mirror-hidden-ledger-20261022.sql` 실행됨. `lease_status` 에는 없음. 시트에서 그 행 내용을 고치면 `_dupKey` 가 바뀌어 숨김이 풀린다(의도).
- 교체는 service_role 키(GAS 스크립트 속성)로 한다. 2026-08-17 RLS 강화 뒤 anon DELETE 가 막혀 미러가 8일간 조용히 멈춘 사고가 있었다.

### 2-2. 카톡·FIELD 증분 표 (`_dupKey` 중복 무시 insert)
`jeomgeom`(점검), `as_records`(AS), `recontract`, `overage_adjust`, `churn_defense`, `mgmt_support`, `bulman`(불만). GAS 카톡 파서와 FIELD 가 같은 `_dupKey` 규칙으로 넣는다. **한글 컬럼**(`업체명`, `_업체명`, `시리얼넘버`, `자산기번`, `작성일`, `_hidden` …) — PostgREST 에서 큰따옴표·URL 인코딩 주의.

### 2-3. FIELD 가 원본인 표 (주요)
| 표 | 내용 |
|---|---|
| `service_receptions` | 서비스접수. type CHECK 6종 [라이브]: 원격이관·복합기 AS·IT·경영지원·운영지원·영업팀 |
| `as_tickets` | 일정리스트(네이버 캘린더와 양방향) |
| `outbox` | 카톡 발송 대기 `{room, text}`. 보내면 지워진다(평소 0행) |
| `room_map` | 업무 종류·지역 → 카톡방 이름 (26행) |
| `room_activity` | 방별 마지막 발송·수신(봇·노트북) |
| `app_config` | 기능 스위치·설정(관리 탭). 키 23개 [라이브] — 아래 7절 |
| `misu_visits` | 미수 방문이력(1방문 1행, 수정 불가) |
| `visit_logs`, `activity_events` | 방문 기록·활동 이벤트(팀 현황·순위표) |
| `okr_cycles`, `okr_reports` | OKR |
| `it_quiz_attempts` | IT 학습 › 기술 퀴즈 완료 1회 = 1행 — 홈 KPI(K34) 원본. **SQL 실행 대기**(아래) |
| `it_practice_logs` | IT 학습 [실습 기록] 1건 = 1행 — 홈 KPI(K21) 원본. **SQL 실행 대기**(아래) |
| `supply_requests`, `supply_events` | 부품·자가 신청 |
| `counter_sms_*` | 마감 문자(카운터) |
| `photo_albums`, `photo_assets` | 사진 앨범 |
| `vendor_master`, `vendor_alias_key`, `vendor_match_alias`, `lease_ident_code`, `workin_vendor_code` | 거래처 코드·별칭 |
| `worker_heartbeat`, `worker_jobs` | 노트북 실행기 심박·일감 |
| `naver_oauth`, `naver_caldav_state`, `naver_calendar_events`, `naver_write_log` | 네이버 연동 |
| `field_sheet_sync_jobs` | FIELD → 시트 기입 큐(실패 재시도) |
| `push_subscriptions` | 웹푸시 구독 |

> 위 표 상당수는 저장소에 CREATE 문이 없었다. 라이브 정의를 `supabase/schema-snapshot-20261019.sql` 에 기록해 두었다(복구 참고용, 실행 대상 아님).

### 2-4. IT 학습 기록 표 2개 (2026-10-24, SQL 실행 대기)
파일 `supabase/it-learning-logs-20261024.sql`(표·인덱스·권한·RLS·되돌리기 주석, **두 번 실행해도 안전**). 2026-10-24 라이브 조회로 두 표 모두 **아직 없음**을 확인했다. IT파트 시트는 남의 데이터라 건드리지 않고, 우리 쪽 "푼 기록·실습 기록"만 새 표에 남긴다.

| 표 | 열 |
|---|---|
| `it_quiz_attempts` | `id` uuid PK · `author` text 필수(공백 불가) · `kst_date` date(기본 오늘 KST) · `level` text · `total` int >0 · `score` int 0~total · `created_at` timestamptz |
| `it_practice_logs` | `id` uuid PK · `author` text 필수 · `kst_date` date · `title` text 필수(공백 불가) · `memo` text · `photo_url` text(사진 1장, 공개 URL) · `created_at` |

- 인덱스: 표마다 `(kst_date, author)`.
- 권한: anon·authenticated **select·insert 만**(update·delete 없음 = 남기기만). RLS 켬, 정책은 표마다 read/insert 2개. → 앱은 `insertRow` 만 쓴다(`upsertRows` 는 UPDATE 권한이 없어 실패).
- 앱 코드 `src/itLogs.ts`: 표가 없으면(404·PGRST205·42P01) `ItLogsMissingError` → IT 학습 화면은 "표 준비 중" 안내, 홈 KPI 는 "준비 중 · SQL 실행 대기". 그래서 **앱을 먼저 배포해도 된다**(안전한 순서: 앱 배포 → SQL 실행 → 확인).
- 실행: /sql-handoff 절차(04장). 확인 쿼리·anon 시험·되돌리기(`drop table`, 기록이 쌓였으면 먼저 내보내기)는 SQL 파일 맨 아래 주석.
- 백업 목록(`tools/worker/backup_tables.py`)에 넣을지는 표가 만들어진 뒤 판단.

### 2-5. 카톡 배달 기록 표 (2026-10-24, SQL 실행 대기)
파일 `supabase/kakao-delivery-log-20261024.sql`(두 번 실행해도 안전, 되돌리기 주석). 발송 대기열 `outbox`(id·room·text·created_at)는 봇/노트북이 보낸 뒤 행을 **지우는** 구조라, `outbox` 에 AFTER DELETE 트리거 `outbox_delivery_record` → `record_kakao_delivery()`(security definer, 오류는 삼켜 발송 ack 를 막지 않음)를 붙여 `kakao_delivery_log(id, sent_at, queued_at, sender bot|pc, room, kind, vendor, outbox_id unique)` 에 1행씩 남긴다. sender 는 요청 헤더 User-Agent 로 판정(노트북 python-urllib → pc, 그 외 HTTP → bot, 헤더 없는 SQL/cron 삭제는 기록 안 함, 12시간 지난 🤖 심박 폐기 제외). **본문은 저장하지 않고** kind("구분:" 첫 값 또는 room_map.category)·vendor("업체(명):" 첫 줄, 주민번호·전화번호 제거, 80자)만. 권한: anon/authenticated select 만, RLS 켬, 쓰기는 트리거만. 기존 트리거 `outbox_delivery_log`(room_activity)와 봇·노트북 코드는 그대로. 실행 뒤 확인: 봇이 1건 보낸 뒤 `select sender,count(*) from kakao_delivery_log group by 1` — 0행이면 request.headers 가 안 넘어오는 것(데이터실). 홈 전송 현황(LiveSendBoard)은 이 표가 있으면 "봇 n건 · 노트북 n건"+노트북 배달 목록, 없으면 방 수만. 보존 90일 cron 은 파일 아래 주석 제안(미실행).

## 3. 백업
- 노트북 실행기가 매일 02:30 KST 에 약 60표를 jsonl.gz 로 `내 드라이브\FIRSTOA-백업\<날짜>\` 에 남긴다(14회차 보관, `tools/worker/backup_tables.py`). 10-21 회차: 표 62개·210,972행·실패 0(AGENTS.md).
- 새 표를 만들면 백업 대상 목록(`tools/worker/backup_tables.py`)에 추가할지 판단한다.
- Supabase 자체 백업(PITR/일 백업) 설정은 (확인 필요 — 대시보드 → Database → Backups).
- DB 안 백업 표: `_backup_cleanup_20261019`, `_backup_dupe_20260827_as/_jeomgeom`, `_backup_region_20260826`, `okr_cycles_bak_20261020`, `okr_reports_bak_20261020`. 지워도 되는지는 사용자 결정(약 100MB).

## 4. cron 목록 [라이브, 2026-10-22] — 시각은 UTC, 괄호는 KST
| jobid | 이름 | 일정 | 하는 일 | 상태 |
|---|---|---|---|---|
| 3 | customer-message-dispatch | 매분 | 엣지 customer-message-send(예약 문자 발송) | 켜짐 |
| 4 | field-sheet-retry | 2분마다 | 엣지 field-sheet-sync(시트 기입 재시도) | 켜짐 |
| 5 | photo-drive-archive | 매시 25분 | 엣지 photo-drive-archive(오래된 사진 → 드라이브) | 켜짐 |
| 8 | naver-calendar-sync | 매분(내부 20초×3) | 엣지 naver-calendar-sync | 켜짐 |
| 9 | contact-sheet-share | 3분마다 | 엣지 contact-sheet-pull(담당자변경 시트 → 앱, 공유는 함수가 10시 전 보류) | 켜짐 |
| 10 | weekly-keyman-poster | `30 1 * * 1` (월 10:30) | 엣지 weekly-keyman-poster — 노트북 포스터(월 10시)의 서버 안전망 | 켜짐 |
| 11 | kakao-bot-heartbeat | `0 1-10 * * 1-5` (평일 10~19시 정각) | 조용한 방에 "[봇점검]" 한 줄 | **꺼짐**(active=false) |
| 12 | kakao-bot-watchdog | 매시 20분 | 6시간 지난 [봇점검] 글 삭제 + 봇 이상 시 push-send | 켜짐 |
| 17 | contact-sheet-pull-daily | `0 1 * * *` (매일 10:00) | 엣지 contact-sheet-pull | 켜짐 |
| 18 | contact-sheet-pull-before-briefing | `30 0 * * 1` (월 09:30) | 같은 함수, 저장만(share:false) | 켜짐 |
| 21 | counter-inbox-ingest | 2분마다 | 엣지 counter-inbox-ingest(마감 목록 반영) | 켜짐 |
| 22 | solapi-import | `50 14 * * *` (매일 23:50) | 엣지 customer-message-send 발송 이력 가져오기 | 켜짐 |
| 23 | worker-watchdog | 10분마다 | 최신 심박 실행기 1대가 15분 끊기면 웹푸시(2시간 1회) | 켜짐 |
| 24 | purge-cron-log | `10 18 * * *` (매일 03:10) | `cron.job_run_details` 14일 지난 것 삭제 | 켜짐 |

- cron 의 엣지 호출 헤더에는 **anon 키**(공개값)가 들어 있다. Vault 는 쓰지 않는다. 새 cron 은 기존 `supabase/*-cron.sql` 패턴을 따른다.
- 카톡을 만드는 cron 은 **KST 10시 이후·평일** 규칙(출근 전 알림 금지).
- 확인 쿼리: `select jobid, jobname, schedule, active from cron.job order by jobname;` / 최근 실패: `select jobid, status, return_message, start_time from cron.job_run_details where status <> 'succeeded' order by start_time desc limit 20;`

## 5. 권한 구조 (anon 키로 무엇을 할 수 있나)
앱·봇·노트북·GAS(일부)는 모두 **anon 역할**로 들어온다. 데이터 보호는 grant + RLS 두 겹.

1. **기본 권한 회수 (2026-10-19)** — `supabase/anon-permissions-20261019.sql` 실행됨. [라이브] `pg_default_acl` 의 public 표(r) 항목에 anon·authenticated 가 없다 → **새 표는 anon 이 아무것도 못 한다.** 새 표 SQL 에 반드시:
   ```sql
   alter table public.<표> enable row level security;
   grant select, insert on public.<표> to anon, authenticated;   -- 필요한 동작만
   create policy ... to anon, authenticated ...;
   ```
   안 적으면 앱이 401/42501 로 실패한다. DELETE 는 코드가 실제로 지우는 표에만.
   (주의: public 의 함수(f)·시퀀스(S) 기본 권한은 아직 anon 에 붙는다 [라이브].)
2. **RLS** — [라이브] RLS 꺼진 표 5개: `counter_sms_inbox`, `naver_oauth`, `room_activity`, `worker_heartbeat`, `worker_jobs`. `naver_oauth` 는 anon grant 가 없어 안전, 나머지 4개는 봇·실행기가 쓰는 표라 grant 로만 막혀 있다(2단계 과제, anon-permissions 파일 주석).
3. **표별 anon 권한 예** [라이브]: `jeomgeom`·`as_records`·미러 표 = select·insert 만(수정·삭제 불가 → 숨김·수정은 엣지 `record-edit` 가 대행). `outbox` = select·insert·delete(봇이 보낸 뒤 지움). `mirror_hidden` = 아무 권한 없음(트리거만 씀).
4. 로그인(SSO)은 화면 잠금일 뿐, DB 는 anon 키를 아는 누구나 위 권한만큼 접근 가능하다. 실질 보호 강화(엣지에서 JWT 발급 + RLS)는 미착수.

권한 확인 쿼리:
```sql
select c.relname, c.relrowsecurity rls,
  has_table_privilege('anon', c.oid, 'SELECT') sel, has_table_privilege('anon', c.oid, 'INSERT') ins,
  has_table_privilege('anon', c.oid, 'UPDATE') upd, has_table_privilege('anon', c.oid, 'DELETE') del
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;
```

## 6. SQL 파일과 실행 이력
- 규칙: `supabase/<기능>.sql` 1파일 = 1기능, 머리에 날짜·목적·"SQL Editor 에서 1회 실행"·되돌리기. 사람이 SQL Editor 에서 실행(04 장).
- **실행 이력의 공식 기록은 `AGENTS.md` "작업 기록"** 과 각 파일 머리 주석이다. 실행 여부가 애매하면 라이브에서 표·컬럼·cron 존재를 확인한다(아래 표처럼).

| 파일 | 상태 [라이브로 확인한 근거] |
|---|---|
| anon-permissions-20261019.sql | 실행됨 (public 표 기본 권한에 anon 없음) |
| cleanup-data-20261019.sql / db-maintenance-20261019.sql | 실행됨 (`_backup_cleanup_20261019` 표, `purge-cron-log` cron) |
| reception-dept-types.sql + reception-dept-types-rename.sql | 실행됨 (type CHECK 에 '영업팀', `DEPT_RECEPTION_ENABLED` 키) |
| okr-quarter.sql | 실행됨 (`okr_*_bak_20261020` 표). **재실행 금지** — 앱에서 고친 OKR 을 덮는다 |
| okr-month-tidy-20261021.sql | (확인 필요) |
| kakao-delivery-log-20261024.sql | **미실행(실행 대기)** — `kakao_delivery_log` 없음·`outbox` 트리거 1개 추가(2026-10-24 권한나 통과) |
| it-learning-logs-20261024.sql | **미실행(실행 대기)** — `it_quiz_attempts`·`it_practice_logs` 없음(2026-10-24 확인) |
| misu-visits.sql | 실행됨 (`misu_visits` 표) |
| mirror-hidden-ledger-20261022.sql | 실행됨 (`mirror_hidden` 표 + 트리거 8개) |
| keyman-poster-cron-1030.sql | 실행됨 (jobid 10 일정 `30 1 * * 1`) |
| worker-watchdog-current-host.sql | 실행됨 (jobid 23, 심박 행 1개 `worker@D6110`) |
| kakao-bot-heartbeat-off.sql | 심박 cron 이 꺼져 있음(active=false) — 이 파일로 껐는지 (확인 필요) |
| vendor-info-dept.sql | **미실행** (vendor_info 에 dept 생성 컬럼 없음). 앱은 `_raw` 경로로 동작. 월 05:50~06:30·밤 00:30 전후 피해서 실행 |
| site-company.sql | **미실행 초안** (거래처 3단 구조, 보류) |
| fix-gni-region-e-20261021.sql | (확인 필요) — 재전송과 택1 |
| remote-receptions-close-20261019.sql | 실행됨(메모 근거, 원격대기 0) |

**재실행 위험 파일**(머리에 경고 있음): admin-policies, as-tickets, field-sheet-sync, kakao-bot-heartbeat-off, okr-quarter, photo-storage-policy, reception-dept-types(-rename), service-receptions, weekly-keyman-poster-cron. 이 파일들은 다시 돌리면 정책·일정·데이터를 옛 값으로 덮는다.

## 7. app_config 키 [라이브 23개]
`COUNTER_KAKAO_ROOM, DEPT_RECEPTION_ENABLED, FIELD_KAKAO_SEND_ENABLED, FIELD_SHEET_SYNC_ENABLED, FIELD_SHEET_TEST_MODE, KAKAO_BOOK_KEY, KEYMAN_POSTER_SENT, NAVER_CALENDAR_ENABLED, NAVER_CALENDAR_ID, NAVER_SYNC_CALENDARS, NAVER_TEAM_CALENDAR_A~E, NAVER_TEAM_CALENDAR_IT, PHOTO_DRIVE_FOLDER, RECEPTION_SHEET_OPEN_ENABLED, SHEET_WRITE_LOCK, SSO_REQUIRED, TEAM_GROUPS, TEST_MODE, TEST_ROOM`
- 대부분 FIELD **관리 탭**(src/SystemAdmin.tsx)에서 바꾼다. 스위치는 기본 꺼짐으로 만들고, 표·설정이 없으면 앱이 조용히 예전처럼 동작하는 것이 관례.
- 코드가 읽지만 키가 없으면 기본값을 쓰는 것: `AI_PRICE_*`, `SMS/LMS/MMS_PRICE_KRW`, `AI_USD_KRW`, `FIELD_OCR` 등(메모 근거, 확인 필요).

## 8. 프런트에서 DB 부르기
`src/supabase.ts` 래퍼만 쓴다(키·URL 이 거기 한 곳).
```ts
const rows = await selectRows<RoomMapRow>("room_map", "select=category,region,room&order=category.asc");
await upsertRows("vendor_notes", [row], "id");              // 세 번째 인자 = on_conflict 컬럼
const r = await rpc<Result>("함수이름", { p_arg: 1 });
```
그 밖에 `insertRow`, `selectAllRows`(1,000행 페이지 넘김 — 1,000행 잘림 사고 있었음), `countRows`, `invokeEdgeFunction`, `enqueueOutbox`(카톡 보내기), `getConfig`/`getRoomMap`(캐시) 이 있다. 시그니처는 `src/supabase.ts` 가 기준.

## 9. 이름 규칙
- 새 표 컬럼은 영문 snake_case. 기존 한글 컬럼은 바꾸지 않는다(새 표·뷰·override 표로 해결).
- 시간은 `timestamptz`, 날짜 표시는 Asia/Seoul. 코드의 "오늘"은 `kstDate()`(UTC 로 자르던 사고 있음).
- 중복 방지는 unique 제약(`_dupKey`, 고정 id).
