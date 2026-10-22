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
