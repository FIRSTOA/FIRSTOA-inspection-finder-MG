# 08. 구글 시트와 Apps Script(GAS)

> 근거: `apps-script/README.md`, `apps-script/first-data/src/*.gs`, `supabase/functions/field-sheet-sync/sheets-api.ts`, `supabase/functions/reception-sheet-open/`, `src/itSheet.ts`, `src/receptionSheetOpen.ts`, `supabase/field-sheet-sync-setup.md`.
> 스프레드시트 ID 는 이 문서에 옮겨 적지 않는다 — 아래 "ID 가 적힌 파일"을 본다(몇몇 문서는 링크 공개라 고객 정보가 있다).

## 1. 방향별 정리

### 시트 → Supabase (시트가 원본, GAS First-DATA 가 밀어 넣음)
| 시트 | Supabase 표 | 방식·시각(KST) | GAS 함수 |
|---|---|---|---|
| 임대리스트 | `vendor_info` | 증분 upsert, 월요일 05시대 | `syncLeaseToSupabase` (SupabaseSync.gs, 트리거 `installLeaseSupabaseTrigger`) |
| PC확장성 / 복합기확장성 / 미수 / 초과 | `pc_expansion` / `mfp_expansion` / `misu` / `overage` | **전체 교체**(전 행 삭제 → 500행씩 insert), 매일 00시대(00:30 경) | `syncNonLeaseOnly` → `syncAllToMaster` → `supabaseReplaceAll_` (Menu.gs, Index.gs, Supabase.gs) |
| 임대현황표 | `lease_status` | 전체 교체, 월요일 04시대 | `syncLeaseStatusOnly` |
| 업체정보 | (마스터 탭, vendor_info 는 위 증분 경로) | 월요일 02시대 | `syncBizInfoOnly` |
| 미수 CS 체크 | `misu_cs_checks` | 매시 | `syncMisuCsToSupabase` |
| 카톡 양식(점검·AS·재계약·초과조정·해지방어·경영지원·불만) | `jeomgeom`, `as_records`, `recontract`, `overage_adjust`, `churn_defense`, `mgmt_support`, `bulman` | 증분, `_dupKey` 중복 무시 | `appendKakaoRecords_` (Kakao.gs, Supabase.gs) |

전체 교체 표의 함정(숨김 풀림·id 바뀜)과 숨김 장부 `mirror_hidden` 은 03 장 2-1.
GAS 의 Supabase 쓰기 키는 스크립트 속성 `SUPABASE_SERVICE_KEY`(없으면 anon → anon 은 DELETE 불가라 전체 교체가 조용히 멈춘다, 2026-08 실사고).

### FIELD → 시트 (FIELD 가 원본, 엣지 `field-sheet-sync` 가 기입)
- 앱이 저장하면 `field_sheet_sync_jobs` 에 작업을 넣고 엣지가 **서비스 계정(`GOOGLE_SERVICE_ACCOUNT`)으로 Sheets API** 를 직접 호출해 행을 추가·갱신. 실패는 cron `field-sheet-retry`(2분)가 5회까지 재시도.
- 스위치(app_config): `FIELD_SHEET_SYNC_ENABLED`, `FIELD_KAKAO_SEND_ENABLED`, `FIELD_SHEET_TEST_MODE`(켜면 실제 탭 대신 `웹앱_테스트_종류` 탭), `SHEET_WRITE_LOCK`.
- 기존 시트의 수식·AI 열은 덮지 않고, 앱이 넣는 열만 채운다. 영업·경영 접수 탭은 머리 이름이 아니라 **열 번호 고정**(dept-sheet-spec.ts).
- 대상(카테고리 → 탭 gid, `sheets-api.ts` FIELD_SHEETS):

| 카테고리 | 문서 | 탭 gid |
|---|---|---|
| expansion_it | 확장성 IT 문서 | 1571265600 |
| expansion_copier | 확장성 복합기 문서 | 746760933 |
| contact_change | 담당자변경 문서 | 1289086745 |
| complaint | 같은 문서 | 419415178 |
| praise | 같은 문서 | 0 |
| reception_copier / reception_copier_new | 서비스접수 문서 | 1181394897 |
| reception_remote | 서비스접수 문서(원격, IT 포함) | 916322987 |
| reception_sales | 서비스접수 문서(해지방어접수 = 영업팀) | 174566767 |
| reception_mgmt | 서비스접수 문서(경영지원접수) | 899183889 |

- 옛 경로: GAS 웹앱 `apps-script/field-sheet-sync.gs` + 시크릿 `FIELD_SHEETS_WEBHOOK_URL/SECRET` (설정법은 `supabase/field-sheet-sync-setup.md`). 지금 어느 카테고리가 이 경로를 쓰는지 (확인 필요).

### 시트 → FIELD 읽기만
| 무엇 | 경로 | 비고 |
|---|---|---|
| 담당자변경 시트(키맨체크 탭) → `contact_changes` | 엣지 `contact-sheet-pull`(cron 3분·매일 10:00·월 09:30) | 1행 배너·2행 머리·3행 예시 구조. 날짜 없는 행은 건너뜀 |
| 서비스접수 미처리(시트 G열 상태, IT 는 원격 L열) | 엣지 `reception-sheet-open` (gid 174566767·899183889·916322987) | 관리 탭 `RECEPTION_SHEET_OPEN_ENABLED`(기본 꺼짐). 켜면 시트 처리완료 → DB 접수 완료(최대 50건) |
| IT 학습·처리이력 (IT파트 시트) | 브라우저가 공개 CSV 직접 읽기(`src/itSheet.ts`) | 탭 gid: IT기술력DB 911433900, PC DB 1901723905, 영업상담DB 1803405393, 교육자료링크 532178897. **남의 팀 데이터 — Supabase 로 옮기지 않는다** |
| 통합시트 GAS 조회 | `src/api.ts` `GAS_GET_URL`(GAS 웹앱 /exec) | 시트 부착 스크립트, **소스 저장소에 없음** |

## 2. GAS 프로젝트 목록 (apps-script/README.md)
| 소스 | GAS 프로젝트 | 하는 일 | 반영 방법 |
|---|---|---|---|
| `apps-script/first-data/` | First-DATA (독립) | 시트↔Supabase 동기화, 카톡 양식 파싱, 사진 아카이브, 퀴즈 등 | **clasp push** |
| `apps-script/field-sheet-sync.gs` | FIELD 시트 동기화(웹앱) | FIELD → 시트 기입(옛 경로) | 편집기에 붙여넣기 → 새 버전 배포 |
| `apps-script/customer-message-webhook.gs` | 고객 메시지 웹훅(웹앱) | 메신저봇 → 카톡 메시지 수신, 5분 트리거 | 붙여넣기 → 새 버전 배포 |
| `apps-script/it-tech-api-adapter.gs` | 퍼스트전산 PC_DB(웹앱) | IT 학습·처리이력 API 어댑터 | 붙여넣기 → 새 버전 배포 |
| (소스 없음) | 퍼스트전산 DB통합시트 부착 GAS | `GAS_GET_URL` 이 호출 | 시트 → 확장 프로그램 → Apps Script |

**GitHub 에 올려도 GAS 에 자동 반영되지 않는다.**

### First-DATA 배포 (clasp)
```bash
cd apps-script/first-data
npx clasp login     # 최초 1회
npx clasp pull      # 먼저 pull — 편집기에서 손으로 고친 것이 덮이지 않게. git diff 로 확인 후 흡수
npx clasp push
```
웹앱 배포를 바꿨다면 "배포 관리 → 기존 배포 편집 → 새 버전"(URL 유지). 새 배포를 만들면 URL 이 바뀌어 앱·봇이 끊긴다.

### GAS 트리거 (코드에 있는 설치 함수 기준 — 실제 등록 상태는 각 프로젝트 → 트리거 화면에서 확인 필요)
- `syncNonLeaseOnly` 매일 0시대, `syncBizInfoOnly` 월 2시대, `syncLeaseStatusOnly` 월 4시대, `syncLeaseToSupabase` 월 5시대, `syncMisuCsToSupabase` 매시, `warmVendorIndexCache` 4시간, `ingestFromDriveFolder` 매시, `dispatchDueMessages`(고객 메시지) 5분. (6시 검색 인덱스 트리거는 Supabase RPC 로 옮기며 은퇴 — Menu.gs 주석)
- 0/2/4/5시 창은 동시 실행(GAS 30분 한도)을 피하려고 띄워 둔 것. 이 시간대에 큰 SQL 을 돌리지 않는다.
- GAS 는 **소유자 계정 권한으로** 돈다. 담당자가 바뀌면 프로젝트 소유권·트리거 소유자를 옮겨야 한다(트리거는 만든 사람 것).

### First-DATA 웹앱 관리 토큰 (2026-10-24, 설계 docs/tasks/kakao-collect-expand.md 3-7)
- GET 으로 부르면 데이터·트리거를 바꾸는 동작 13개(`ingestnow`·`retryheld`·`kakaoclear`·`celltrim`·`dedupe`·`seenreset`·`cursorreset`·`roommapset`·`roommapdel`·`rebuildindex`·`indexfinalize`·`indexonly`·`photoarchive`)와 `contactpeek`(아무 시트 ID 의 머리글·5행을 돌려줌)은 `&token=<값>` 이 있어야 한다. 값은 스크립트 속성 **`FIELD_ADMIN_TOKEN`**.
- 속성이 없거나 값이 틀리면 `{ok:false, status:403, error:"forbidden…"}` 을 돌려준다(GAS 웹앱은 HTTP 상태를 못 바꿔 본문으로 알림). **속성을 안 넣으면 위 동작이 전부 막힌다**(잠긴 쪽으로 실패).
- 읽기 동작(`ping`·`search`·`detail`·`adminstatus`·`uploadlog`·`roommap`·`collectstatus`·`collectrooms`·`cursorlist`·`cellreport`·`lastruns` 등)과 봇 `pull`/`ack`, `doPost` 는 그대로 공개.
- 판정 규칙은 `CollectRules.gs`(`ADMIN_TOKEN_ACTIONS`·`checkAdminToken_`), 테스트 `tests/gasCollect.test.ts`.
- 넣는 순서(설계 R5): ① 스크립트 속성 `FIELD_ADMIN_TOKEN` 에 긴 임의 값 → ② clasp push + 기존 배포 새 버전 → ③ 같은 값을 Supabase 시크릿(gas-admin·photo-drive-archive 엣지용)에 → ④ 앱 배포. ②~④ 사이에는 관리 탭 [지금 수집 실행]·[끝난 작업 정리]·방 매핑 편집과 사진 드라이브 이관 cron 이 거부된다.
- 토큰을 바꾸면 스크립트 속성과 Supabase 시크릿을 같이 바꾼다. 토큰은 코드·저장소에 적지 않는다.

### 카톡 드라이브 수집 경로 (Drive.gs `ingestFromDriveFolder`)
- 방 이름 → 수집 경로는 **Supabase `kakao_collect_rooms`**(anon 읽기, 5분 캐시 `kakao_collect_rooms_v1`)에서 읽는다. 표가 없거나(404)·비었거나·조회 실패면 옛 `_room_map` 시트로 대신한다(이때 원문 보관은 꺼짐). 어느 쪽을 썼는지는 `?action=collectrooms` 의 `source`(`supabase`/`sheet`)와 실행 로그 "매핑 …" 에 나온다.
- `_room_map` 시트·`getRoomMap()` 은 **발송 방 고르기(WebappSave.gs)용으로 그대로** 남아 있다 — 수집 표를 고쳐도 발송은 바뀌지 않는다.
- 방 하나에 `kinds` 가 여러 개면 같은 파일을 점검 → AS → 물류 → 불만 → 미수 → 재계약 순으로 처리한다. E 겸용 방({점검,AS})은 점검 파서와 AS 파서를 둘 다 지나 `구분: AS,점검` 글이 두 표에 1행씩 들어간다. `초과조정` kind 는 표시용 — 재계약 처리 때 "초과업체조정" 양식을 같이 잡는다.
- `enabled=false`·미등록 방 파일은 `확인필요` 폴더로. `structured=false` 면 구조 적재 없이 원문만, `keep_raw=true` 면 구조 적재가 파일 끝까지 끝난 뒤 원문을 엣지 kakao-ingest 로 넘긴다(KakaoRaw.gs). 수집 로그에 종류마다 한 줄, 원문은 `원문` 카테고리 줄.
- **봇 글 제외**: app_config `KAKAO_BOT_NICKS`(쉼표 목록, 없으면 `Ai법인폰`, 10분 캐시) 작성자의 글은 점검·AS 양식 파서·물류 파서·AI 대기열·초과조정 캡처에서 뺀다(FIELD 가 보낸 글을 봇이 방에 올린 것 — 앱이 이미 표에 넣음). 이름은 공백·끝 "님"·대소문자만 무시하고 정확히 같아야 한다. 원문 보관에는 그대로 간다. 지문(_kakao_seen)에 남기지 않으므로 대화명을 고치면 다음 수집에서 다시 판정된다.
- **미수 방 0시대 건너뜀**: kinds 에 미수가 있는 파일은 KST 00:00~00:59 에는 처리하지 않고 수신함에 둔 채 01:05 쯤 이어서 처리한다(수집 로그 "건너뜀(미수: 0시대 미러와 겹쳐 건너뜀)"). 밤 미러 `syncNonLeaseOnly` 가 misu 를 500행 묶음·on_conflict 없이 다시 넣는 시간과 겹치면 23505 로 묶음이 실패하기 때문(미수 즉시 적재를 켜는 날 대비). 단, 이미 AI 대기열에 들어간 미수 작업(kakaoWorker)은 이 규칙을 따르지 않는다.
- 날짜 정규화(불만·재계약·초과조정·미수의 날짜 칸)는 `_dupKey` 계산 뒤 `normalizeKakaoDates_(cat, obj, 글 날짜)`(DateNorm.gs, 칸 목록도 그곳) 한 줄. AI 추출분은 어느 글에서 나왔는지 몰라 묶음(40글)의 가장 늦은 글 날짜를 기준일로 쓴다.
- 수집 트리거는 1시간마다 권장 — 편집기에서 `setDriveIngestHourly` 를 한 번 실행(매크로 06:30~08:00 저장분이 07시 트리거를 놓쳐 하루 밀리던 것, 설계 F9).
- 상태 보기: `?action=adminstatus` 의 `drive.held`·`drive.heldNames`(최대 10)·`drive.lastIngest`, `?action=collectstatus` → `{rooms:[{room, kinds, region, enabled, export, structured, keep_raw, last_import_at, last_raw_at, held}], held_total, held_names, unregistered, last_run, source}`. `last_import_at` 은 수집 로그(`_upload_log` 최근 2,000줄)의 그 방 마지막 구조 적재("새 메시지 없음" 포함), `last_raw_at` 은 GAS 쪽 원문 전송 성공 시각, 방별 `held` 는 마지막 적재 뒤에 쌓인 확인필요·실패 줄 수, `unregistered` 는 확인필요로 나온 미등록 방 이름. 마지막 실행 요약은 스크립트 속성 `kakao_last_ingest`.

## 3. ID 가 적힌 파일
- `supabase/functions/field-sheet-sync/sheets-api.ts` (FIELD_SHEETS)
- `supabase/functions/reception-sheet-open/index.ts`, `src/receptionSheetOpen.ts`
- `supabase/functions/contact-sheet-pull/index.ts`
- `src/itSheet.ts` (IT 시트)
- `apps-script/first-data/src/Config.gs`, `Menu.gs`, `Master.gs` (First-DATA 가 읽는 시트들)

## 4. 시트 쪽에서 할 일 (넘겨받는 사람)
- 서비스 계정 이메일이 위 문서들에 **편집자**로 공유돼 있는지 확인. 빠지면 field-sheet-sync 가 403 → `field_sheet_sync_jobs` failed 가 쌓인다(홈 "시트 동기화 실패 N").
- 시트의 머리 줄·열 순서를 바꾸면 고정 열 매핑(영업·경영 접수)이 엉뚱한 칸에 쓴다. 바꾸기 전에 개발자와 상의.
- 서비스접수 문서가 **링크 공개** 상태(고객 연락처를 누구나 CSV 로 받을 수 있음)라는 지적이 있다 — 공개 범위 결정 필요(AGENTS.md 2026-10-23).

## 5. 카톡 물류 양식 적재·날짜 정규화 (First-DATA `Logistics.gs`·`DateNorm.gs`, 2026-10-24)
- **물류**: 드라이브 수집(`ingestFromDriveFolder`)이 kinds 에 물류가 있는 방의 저장 파일을 `ingestLogisticsForms_(route, text)` 로 넘긴다. FIELD 물류 양식(라벨형: `구분:` 줄 + `거래처명…:` 줄)만 읽어 Supabase `logistics_records` 에 넣는다. 마스터 시트 탭은 만들지 않는다.
  - `_출처` = `카톡:물류`(팀이 있으면 `카톡:물류(E)`), `_원문` = 카톡 글, `_업체명` = 거래처명.
  - `_dupKey` = md5(작성일|작성자|구분|거래처명|품목|수량|특이사항) — 앱 `sendLogisticsForm`(src/api.ts)과 같은 식이다. tests/gasLogistics.test.ts 가 앱 양식 3개로 키가 같은지 확인한다.
  - 이중 방어: 넣기 전에 그 날짜 ±1일 행을 읽어 **같은 `_dupKey`**(출처 무관) 이거나, **앱 저장분(`_출처` 가 `웹앱` 으로 시작)과 구분 같음 + 업체 키 같음 + 날짜 차 1일 이하** 면 건너뛴다. 막는 것은 "앱 저장 → 봇이 방에 공유한 글" 2중 적재뿐이다. 카톡 출처 행끼리는 `_dupKey` 일치만 보므로, 사람이 이틀 연속 같은 업체에 같은 구분 양식을 올리면 둘 다 들어간다(2026-10-24 결정).
  - 봇 계정 글(`isBotAuthor_`, app_config `KAKAO_BOT_NICKS`)은 건너뛴다 — 앱이 이미 저장한 글이다.
  - 자유 글(라벨 없는 글)은 넣지 않고 실행 로그에 `비양식 물류 글 N` 만 남긴다(AI 추출 여부는 1주 뒤 결정).
  - 넣은 뒤 `_dupKey` 로 다시 조회해 들어갔는지 확인한다. 모자라면 실패로 돌려주고 수집 기록(uploadlog)에 오류가 남는다. `logistics_records."_dupKey"` 유니크 인덱스가 없으면 이 단계에서 전부 실패한다.
- **날짜 정규화**: `normYmd_(값)` 이 `26-11-15`·`26,11,30`·`26년10월22일`·`2024. 5. 23`·`2024-06-26 00:00:00`·ISO Z(한국 날짜로)·`Thu Aug 24 2023 …` 를 `YYYY-MM-DD` 로 바꾼다. 못 읽거나(연도 없는 `6월 19일`, 기간 `26.11.15~27.11.14`, 없는 날) 하면 원래 글 그대로 둔다. 카톡 적재(`appendKakaoRecords_`)에서 **`_dupKey` 계산 뒤에** 불만(날짜·방문일)·재계약(계약종료일·다음확인일)·초과조정(방문일)·미수(입력일·입금약속일)에만 적용한다. 옛 행은 고치지 않는다.
- **미수 즉시 적재(대기)**: `Supabase.gs` `SUPABASE_TABLE` 의 `'미수': 'misu'` 줄은 주석으로 막아 두었다(사용자 결정 대기). 켜면 카톡 미수 글이 밤 미러를 기다리지 않고 바로 `misu` 에 들어간다. 켜기 전 주의: 밤 미러(`syncNonLeaseOnly` 0시대)는 `misu` 를 전부 지우고 다시 넣는데, 그 사이에 수집(매시)이 같은 `_dupKey` 를 먼저 넣으면 미러의 500행 묶음 하나가 중복 오류로 통째로 빠진다 → 켤 때 0시대에는 미수 적재를 건너뛰게 한다.
