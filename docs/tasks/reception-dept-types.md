# 서비스접수 지원 3종 추가 + 미처리 현황판 — 설계안 (2차)

- 작성: 기획실 한설계(feature-planner). 1차 2026-10-19, **2차 2026-10-19**(사용자 답 Q1~Q9 + 팀장 결정 5건 반영)
- 근거: 2026-10-19 ERP 회의 결정("미처리 일정을 잡으려면 최초 접수가 한곳에 쌓여야 한다")
- 상태: **2차 설계안 — 팀장 확인 후 구현 시작**. 남은 열린 질문은 7절에 있다(작은 것만).

2차에서 바뀐 것 한눈에:
- [부서] 탭 → 접수 종류 6개 **두 줄 묶음 선택기**(윗줄 현장 3종 · 아랫줄 지원 3종)
- 서비스접수 맨 위에 **미처리 현황판**(6종 전부, 대표용). 홈 관제 덱에 "미처리 접수 N건" 카드
- 지원 3종 카드·펼침에 **[완료] [내일로] [날짜 고르기] [보류] [메모]** 단추(일정리스트에 넣지 않음)
- **업체로 접수**(기기 없는 건) 추가 — vendor_master 검색
- 접수자는 그룹웨어 로그인 이름·팀 자동, 처리자는 지역 기본값
- 시트 사람 기재 병행 → 순번은 쓸 때마다 마지막 행 기준(한계 명시)
- 작업 분해: 1차 병렬 4명 → 2차 구현서 C·D → 검수아

용어: **현장 3종** = 복합기 AS·원격이관·IT(기존). **지원 3종** = 경영지원·운영지원·영업지원(신규).

---

## 1. 목표와 쓰는 사람

**한 줄 목표**: 지원 3종 접수도 FIELD 서비스접수에서 받아 `service_receptions` 한 표에 쌓고, 현장 3종까지 합친 **6종의 미처리 건을 서비스접수 맨 위 현황판 한 곳에서** 본다. 순만 넣으면 거래처 정보가 자동으로 채워지고, 영업·경영은 부서 시트에도 한 줄을 적는다.

| 누가 | 무엇을 | 기기 |
|---|---|---|
| 대표·팀장 | 현황판 숫자 띠와 오래된 카드(노랑·빨강) 확인. 홈 관제 덱 카드로 바로 들어옴 | PC, 가끔 폰 |
| 접수자(전화·카톡 받는 사람: 영업팀·CS·운영지원·경영지원 직원) | 종류 선택 → 순 또는 업체 → 접수유형·분야·내용 → 저장 | 주로 사무실 PC. 폰은 3+3 선택기 |
| 처리자(영업 지역 담당, 경영 마감 담당, 운영지원) | 현황판 카드에서 [완료]·[내일로]·[보류]·[메모] | PC |

**접수자와 처리자의 구분(한 줄)**: 접수자 = 그 접수를 받아 적은 사람(그룹웨어 로그인 이름·팀이 자동으로 들어감) / 처리자 = 그 건을 끝낼 책임자(지역 기본값이 미리 골라져 있고 바꿀 수 있음).

- 접수자 결정 규칙(지원 3종 폼에만 적용, 현장 3종 폼은 그대로): 관리 설정 `SSO_REQUIRED`가 켜져 있으면 `getSsoSession().user.name`·`department`로 고정하고 바꿀 수 없다. 꺼져 있으면 지금처럼 서비스접수 머리의 작성자 선택 값을 쓴다(그룹웨어 세션이 있으면 그 이름이 기본값). 팀은 `remote_meta.author_team`에 남긴다.

고객은 쓰지 않는다(고객 QR 접수는 보류 중인 별개 건).

---

## 2. 기존 코드 재사용·확장 지점

| 무엇 | 파일:함수/위치 | 어떻게 쓰나 |
|---|---|---|
| 임대리스트 검색(순·업체명·자산번호·기번) | `src/api.ts:searchLeaseList` (241행) | "기기로 접수"에서 그대로 호출 |
| 거래처 마스터 검색 | `vendor_master`(code·name·aliases·device_count). `src/entity360.ts` 183·197·209행이 같은 조회를 함 | "업체로 접수"에서 `name ilike` / `aliases` 검색. 등급·지역은 `vendor_info`에서 `_업체명 in (aliases)` 행을 모아 최빈값 |
| 접수 저장 | `src/api.ts:saveServiceReception` | **지원 3종은 쓰지 않는다**(저장 뒤 지역 팀 A~E 웹푸시가 나가서 경영 접수가 현장 CS에게 울림). 새 API에서 `insertRowReturning` 직접 호출, 푸시 없음 |
| 처리값 병합 | RPC `merge_reception_handling`, `src/api.ts:mergeReceptionHandling` | 완료·보류·예정일·메모를 `remote_meta`에 원자 병합 + status |
| 현장 3종 상태 판정 | `src/ServiceReception.tsx`의 `listStateOf`(1398행 부근: 원격·IT는 remote_meta.start/end/result, 복합기는 status) | 현황판은 같은 규칙을 **새 순수 모듈 `src/receptionState.ts`에 옮겨 적고** 테스트로 똑같은지 확인한다. ServiceReception의 기존 함수는 고치지 않는다 |
| 시트 잡 큐 | `src/supabase.ts:enqueueFieldSheetSyncJob`, 표 `field_sheet_sync_jobs`, 엣지 함수 `field-sheet-sync`(재시도 `retry_pending`) | 새 category `reception_sales`·`reception_mgmt` |
| 시트 기입 엔진 | `supabase/functions/field-sheet-sync/sheets-api.ts` | 내부 도우미에 `export`만 붙이고 `FIELD_SHEETS`에 2줄. **기존 `appendViaSheetsApi`·`fieldValue`·`fillLeaseValues`는 손대지 않는다.** 새 경로는 새 파일 |
| 갱신 잡 패턴 | `src/api.ts:sendReceptionCopierCompleteJob` (`_updateRow`·`_updateKey*`·`_updateOnly`·`_findKey*`) | 지원 3종 완료·보류의 시트 진행상황 갱신이 같은 모양 |
| 시트 진단 | `sheets-api.ts:peekSheet` + `FIELD_SHEETS` | 구현 1단계 실측 |
| 그룹웨어 세션 | `src/sso.ts:getSsoSession`, `ssoRequiredCached` | 접수자 자동 |
| 명부 | `src/authors.ts` | 사내 요청자·처리자 고르기 |
| 부서 달력 | `src/TeamCalendar.tsx`(props `team`, `author`) | **수정 없이** `team="영업지원"` 식으로 재사용. 표 `team_calendar_events`는 네이버·일정리스트와 동기화되지 않는 표 |
| 카톡 방 | `getRoomMap`, `enqueueOutbox`, `getConfig`(TEST_MODE) | 새 키 조회만. 매핑 없으면 보내지 않음 |
| 홈 관제 덱 | `src/Home.tsx` 344~350행 상태 알약 격자, `go(screen)` | 새 카드 1줄 + import 1줄 |

**새 파일로 만드는 이유**: `ServiceReception.tsx`는 이미 2,120줄이고 현장 3종 분기가 폼 곳곳에 흩어져 있다. 지원 3종은 필드·시트·처리 흐름이 다르다. 그래서 선택기·현황판·폼·상세·처리 단추·홈 카드는 모두 새 파일로 만들고, ServiceReception에는 6절 C2의 번호 목록만큼만 손댄다.

---

## 3. 데이터 설계

### 3-1. `service_receptions`에 그대로 쌓는다(새 표 없음, 새 컬럼 없음)

| 접수 값 | 컬럼 | 기기로 접수 | 업체로 접수 |
|---|---|---|---|
| 종류 | `type` = `경영지원`·`운영지원`·`영업지원` (**CHECK 변경**) | 같음 | 같음 |
| 접수유형 | `route` = `카카오`·`전화`·`메일`·`사내` | 사내면 이름은 `remote_meta.via` | 같음 |
| 접수분야 | `field` | 칩 또는 직접 입력 | 같음 |
| 순 | `lease_no`, `first_no` | 같은 값 둘 다 | **빈 값** |
| 업체명 | `vendor` | 임대리스트 `_업체명` | vendor_master의 aliases 중 **임대리스트 표기 그대로인 첫 이름**(통합검색 360이 `vendor in (…)` 정확 일치로 찾기 때문). 마스터 이름은 `remote_meta.vendor_master_name` |
| 등급·지역 | `grade`, `region` | 임대리스트 그 행 | 그 업체의 vendor_info 행들에서 **최빈값** |
| 기기 | `asset_no`, `serial`, `model` | 임대리스트 그 행 | **빈 값** |
| 주소 | `address` | 임대리스트 그 행 | vendor_info 첫 행 주소 |
| 업체담당자·전화 | `receiver_name`, `receiver_phone` | 사람 입력 | 같음 |
| 접수내용 | `symptom` (필수) | | |
| 목록 제목 | `title` = `접수분야 · 접수내용 첫 줄 30자` | | |
| 특이사항 | `notes` (DB만) | | |
| 카톡 양식 | `report_text` (안 보내도 기록) | | |
| 상태 | `status` = `접수`·`진행중`·`보류`·`완료`·`취소` (status CHECK는 이미 풀려 있음) | | |
| 완료 | `completed_at`, `completed_by` | | |
| 시트 행 | `sheet_row` | | |
| 부서 고유 값 | `remote_meta` (jsonb) | 아래 키 | |

`remote_meta` 키(지원 3종 공통 규약, `src/deptReception.ts`의 `DeptMeta` 타입으로 고정):

| 키 | 뜻 |
|---|---|
| `unit` | `device`(기기로 접수) / `vendor`(업체로 접수) |
| `vendor_code` | 업체로 접수일 때 vendor_master.code(10자리) |
| `vendor_master_name`, `device_count` | 업체로 접수일 때 마스터 이름·보유 대수(접수 당시) |
| `author_team` | 접수자 팀(그룹웨어 department, 없으면 빈 값) |
| `handler` | 처리자 |
| `via` | 사내 요청자 이름(route=사내) |
| `outside` | 외근요청 |
| `contract_kind` | 계약서구분 전자/수기(경영) |
| `progress` | 진행 메모 칩(영업 시트 "승인여부" 열 값) |
| `memo_log` | [메모] 단추로 남긴 메모. `MM/DD HH:mm 이름: 내용` 줄을 위에 쌓는다 |
| `handled` | 처리내용 |
| `schedule_date` | 예정일(YYYY-MM-DD). 있으면 부서 달력 일정이 있다 |
| `calendar_id` | `team_calendar_events.id` |
| `postpone_count` | [내일로]·[날짜 고르기] 횟수(현황판에 "미룸 n" 표시) |
| `sheet_seq`, `sheet_state` | 시트 A열 순번 / `queued`·`synced`·`failed`·`none` |
| `kakao` | `sent`·`no_room`·`test` |

### 3-2. SQL — 새 파일 `supabase/reception-dept-types.sql` (표다빈 작성 → 권한나 sql-review → /sql-handoff)

1. **service_receptions.type CHECK**: 라이브 제약 이름을 MCP로 먼저 조회. drop 후 `('원격이관','복합기 AS','IT','경영지원','운영지원','영업지원')`. 옛 값 `IT AS`를 되살리지 않는다.
2. **service_receptions.route CHECK**: 라이브에 남아 있는지 MCP로 확인. 있으면 `('카카오','전화','메일','사내')`로 넓히고 `not valid`로 붙인다. 없으면 건너뜀.
3. **field_sheet_sync_jobs.category CHECK**: 라이브 8개 + `reception_sales`, `reception_mgmt` = 10개. `field-sheet-sync.sql` 재실행 금지.
4. **team_calendar_events**: team CHECK에 `경영지원`·`운영지원`·`영업지원` 추가(웹캘린더 팀 필터 요구 충족). 새 컬럼 `reception_id text not null default ''` + 부분 인덱스 `(reception_id) where reception_id <> ''`. 기존 컬럼은 바꾸지 않는다.
5. 인덱스: 새로 만들지 않는다. 현황판 조회(최근 90일 + 미완료)는 기존 `service_receptions_date_idx (receipt_date desc, created_at desc)`로 충분(월 약 450 + 300건).
6. `notify pgrst, 'reload schema';`
7. 머리 주석: 날짜·목적·재실행 안전(drop if exists → add)·라이브 제약 이름 조회 쿼리.

RLS·grant는 기존 그대로(새 표 없음).

**켜기 스위치(유지)**: 관리 설정 `DEPT_RECEPTION_ENABLED`가 `true`가 아니면 선택기 **아랫줄(지원 3종)을 숨긴다**. 현황판은 꺼져 있어도 현장 3종만으로 보인다. SQL 실행 확인 뒤 관리자가 켠다.

### 3-3. 시트 동기화

| 항목 | 영업지원 | 경영지원 |
|---|---|---|
| category | `reception_sales` | `reception_mgmt` |
| 문서 | 접수 시트 문서 `1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g`로 가정(**1단계 peek로 확인**) | 같음 |
| sheetId(gid) | 174566767 | 899183889 |
| 머리행(1부터 셈) | **5행**(1~4행은 안내문·"순 입력" 조회 도우미) | **5행**(A5 "-", B5 "날짜"). 3행은 도우미 머리, 4행은 도우미 값 줄. 1차 분석 메모의 "3행 머리"는 틀림 |
| 머리행 서명(공백 제거) | `진행중/처리완료/보류/취소` + `승인여부` | `진행중/처리완료/보류/취소` + `계약서구분` |
| 원본 열 번호 행 | **6행, FORMULA 렌더로 읽기**(표시값이 `₩ 14`·`1900. 1. 8`·`62개월`이라 `Number(표시값)`이면 NaN으로 조용히 빠짐) | 같음. `#N/A` 칸은 건너뜀 |
| DATA_START | 7 | 7 |
| 마커 열(마지막 행 찾기) | B 접수일 · D 접수시간 · E 접수자 | B 날짜 · D 접수시간 · E 접수자 |
| 새 행 위치 | **쓸 때마다** 마커 열의 마지막 값 아래 첫 행(기존 `reception_copier`의 행 재사용과 같은 방식). `maxRows`를 넘으면 행 삽입 + 위 행 수식 복사 | 같음 |
| 순번(A열) | **쓸 때마다** 잠금 안에서 "데이터 구간 A열 숫자 최댓값 + 1". 사람이 시트에 직접 적은 줄도 그 순간의 마지막 행으로 반영된다. 대상 칸이 수식이면 쓰지 않음 | 같음. A5 머리가 "-"라 **열 번호 1**로 다룸 |
| 접수 때 진행 칸(G) | `진행중` | `진행중`(Q8 답) |
| 중복 방지 지문 | 접수일·접수시간·접수자·순·접수내용 중 실제 쓰는 값 3개 이상이 최근 80행의 한 행과 모두 같으면 그 행 반환(기존 `FP_HEADERS` 규칙) | 같음 |
| 잡 dupKey | `dept:<receptionId>:append` | 같음 |
| 실패 시 | Sheets API 직행만. **GAS 폴백 없음**(GAS는 모르는 category면 던지지만, 폴백 대신 실패 기록 → `retry_pending` 재시도) | 같음 |
| 운영지원 | 시트 없음. 잡 없음. `sheet_state=none` | |

**사람 기재 병행의 한계(Q2 답 반영)**: 시트에 사람이 직접 적는 줄은 앞으로도 생긴다.
- 앱은 쓸 때마다 그 순간의 마지막 행 아래에 쓰므로 사람 줄을 덮지 않는다. 다만 사람이 **같은 순간에** 같은 빈 행에 적고 있으면 겹칠 수 있다. 잠금은 앱끼리만 막는다. 같은 위험이 복합기 접수 시트에도 있었고 그대로 받아들인다.
- **시트에만 적힌 접수는 DB에 없으므로 미처리 현황판에 나오지 않는다.** 현황판 머리에 "시트에 직접 적은 건은 여기 안 나옵니다" 안내를 한 줄 둔다.
- 시트 → DB 가져오기는 범위 밖이다(8절 후속 후보).

**수식 열 처리 — 복합기(`reception_copier`) 방식(값 고정), Q7 "문제만 없으면 됨"으로 진행**
- 코드로 확인한 사실(`sheets-api.ts` 437~491행, 728~733행): 복합기 접수는 행을 쓴 뒤 `fillLeaseValues`가 `임대리스트!A2:A`에서 퍼스트순을 아래에서 위로 찾는다. 그리고 접수 탭 **6행의 원본 열 번호**대로 대상 열에 **값을 덮어쓴다**. 못 찾으면 수식이 남는다("수식 폴백"). 앱에서 고친 값(`leaseFix`)이 원본보다 우선한다.
- 지원 2종도 같은 방식. 이유: (1) 접수 당시 계약 상태를 기록으로 남김 (2) 임대리스트 행이 바뀌어도 지난 행이 따라 바뀌지 않음 (3) 두 시트의 6행이 복합기 탭과 같은 구조.
- 6행 번호가 **없는** 자동 열(영업: 지역·기본매수·초과장당금액·주소 / 경영: 지역·자동연장여부·기본매수·초과장당금액)은 대상 행에 수식이 있으면 그대로 둔다. 없으면 앱이 보낸 값을 쓴다(1단계 실측으로 확정).
- **기기로 접수인데 순이 없을 때(신규)** 그리고 **업체로 접수**: `fillLeaseValues`를 건너뛰고 **순 칸은 비운다**. 업체명(P)·지역(O)·등급(N)·주소(영업 AG / 경영 AQ)만 앱 값으로 쓰고, 나머지 자동 열은 비운다.
- **테스트 1행**(Q7 답): 1단계에서 한 번 쓰고, 열 위치를 확인한 뒤 **바로 지운다**. 지운 행 번호와 시각을 문서 끝 "실측 기록"에 남긴다.

#### 영업지원 시트(gid 174566767) 열 매핑 — 머리 5행, 번호 6행, 데이터 7행~

구분: **사람**=앱 입력값 / **앱계산**=앱이 계산 / **자동(n)**=6행 번호 n으로 임대리스트 값 고정 / **자동(수식)**=수식 유지, 없으면 앱 값 / **처리**=처리 단추로 갱신 / **비움**=앱이 쓰지 않음

| 열 | 머리 | 채움(5,838행) | 구분 | 앱의 어느 값 |
|---|---|---|---|---|
| A | 순번 | 100% | 앱계산 | 쓸 때마다 최댓값+1 → `sheet_seq` |
| B | 접수일 | 100% | 앱계산 | KST `M월 d일` |
| C | 년월 | 100% | 앱계산 또는 수식 | `yyMM`. "9912" 값이 섞여 있어 수식일 수 있음 → 수식이면 비움 |
| D | 접수시간 | 100% | 앱계산 | `HH:mm` |
| E | 접수자 | 100% | 사람(자동) | 접수자 이름(로그인) |
| F | 처리자 | 99% | 사람(기본값)·처리 | `handler` |
| G | 진행중/처리완료/보류/취소 | 100% | 앱계산·처리 | 접수 `진행중` → [완료] `처리완료` / [보류] `보류` / 취소 `취소` |
| H | 승인여부 | 42% | 처리 | `progress`(선행방올림·안내완·견적서 발송완·부재중 + 직접) |
| I | 외근요청/여부 | 2% | 사람(선택) | `outside` |
| J | 2차/담당자 | 62% | 비움(실측) | 수식이면 유지 |
| K | 2차/체크여부 | 5% | 비움 | |
| L | 순 | 97% | 사람 | `lease_no` (업체로 접수·신규는 빈 칸) |
| M | 임대여부 | 90% | 자동(31) | |
| N | 등급 | 71% | 자동(19) | 업체 접수 → `grade` |
| O | 지역 | 96% | 자동(수식) | 업체 접수·신규 → `region` |
| P | 업체명 | 100% | 자동(79) | 업체 접수·신규 → `vendor` |
| Q | 접수유형 | 97% | 사람 | `route`, 사내면 `via` 이름 |
| R | 접수분야 | 100% | 사람 | `field` |
| S | 자산번호 | 89% | 자동(35) | |
| T | 미수개월수 | 20% | 자동(62) | |
| U | 업체담당자 | 68% | 사람 | `receiver_name` |
| V | 전화번호 | 80% | 사람 | `receiver_phone` |
| W | 접수내용 | 97% | 사람 | `symptom` |
| X | 처리내용 | 25% | 처리 | `handled` |
| Y | 모델명 | 89% | 자동(38) | |
| Z | 기본금액 | 89% | 자동(14) | |
| AA | 연평균 | 77% | 자동(15) | |
| AB | 계약일 | 89% | 자동(8) | |
| AC | 종료일 | 72% | 자동(9) | |
| AD | 남은개월 | 72% | 자동(11) | |
| AE | 기본매수 | 89% | 자동(수식) | |
| AF | 초과장당금액 | 89% | 자동(수식) | |
| AG | 주소 | 89% | 자동(수식) | 업체 접수·수식 없음 → `address` |

#### 경영지원 시트(gid 899183889) 열 매핑 — 머리 5행, 번호 6행, 데이터 7행~

이 시트는 **머리 이름이 겹친다**(T "자산번호"와 BB "자산번호"). 그래서 지원 2종은 **열 번호 고정 매핑 + 5행 머리 검증**으로 한다. 하나라도 기대와 다르면 쓰지 않고 `열 밀림 감지: <열> 기대 <이름>, 실제 <이름>`으로 실패한다.

| 열 | 머리(5행) | 채움(1,759행) | 구분 | 앱의 어느 값 |
|---|---|---|---|---|
| A | - (순번) | 100% | 앱계산 | 쓸 때마다 최댓값+1 → `sheet_seq` |
| B | 날짜 | 100% | 앱계산 | `M월 d일` |
| C | 년월 | 100% | 앱계산 또는 수식 | `yyMM`(수식이면 비움) |
| D | 접수시간 | 100% | 앱계산 | `HH:mm` |
| E | 접수자 | 100% | 사람(자동) | 접수자 이름 |
| F | 처리자 | 83% | 사람(기본값)·처리 | `handler`(C지역 기본값 비움) |
| G | 진행중/처리완료/보류/취소 | 77% | 앱계산·처리 | 접수 `진행중` → 처리 단추로 갱신 |
| H | (빈 머리) | – | 비움 | 절대 쓰지 않음 |
| I | PC판촉여부 | 0% | 비움 | |
| J | 외근요청여부 | 0% | 사람(선택) | `outside` |
| K | 순 | 99% | 사람 | `lease_no` (업체 접수·신규는 빈 칸) |
| L | 담당자(마감담당) | 97% | 자동(25) | |
| M | 임대여부 | 97% | 자동(31) | |
| N | 등급 | 81% | 자동(19) | 업체 접수 → `grade` |
| O | 지역 | 98% | 자동(수식) | 업체 접수·신규 → `region` |
| P | 업체명 | 100% | 자동(79) | 업체 접수·신규 → `vendor` |
| Q | 접수유형 | 98% | 사람 | `route`/`via`(경영은 대부분 사내 이름) |
| R | 접수분야 | 98% | 사람 | `field` |
| S | 계약서구분 | 3% | 사람(선택) | `contract_kind` |
| T | 자산번호 | 96% | 자동(35) | |
| U | 미수개월(수) | 22% | 자동(62) | |
| V | 일반전화 | 40% | 자동(28) | |
| W | 업체담당자 | 43% | 사람 | `receiver_name` |
| X | 전화번호 | 54% | 사람 | `receiver_phone` |
| Y | 접수내용 | 99% | 사람 | `symptom` |
| Z | 처리내용 | 55% | 처리 | `handled` |
| AA·AB·AC | 발송·작성·반영여부 | 0% | 비움 | |
| AD | 특이사항 | 40% | 자동(18) | 앱의 특이사항은 여기 쓰지 않음 |
| AE | 확장성 | 96% | 자동(80) | |
| AF | 모델명 | 96% | 자동(38) | |
| AG | 품목 | 97% | 자동(33) | |
| AH | 제조사 | 97% | 자동(34) | |
| AI | 기종 | 97% | 자동(38) | |
| AJ | 기본임대료 | 97% | 자동(14) | |
| AK | 평균임대료 | 87% | 자동(15) | |
| AL | 계약일 | 96% | 자동(8) | |
| AM | 종료일 | 79% | 자동(9) | |
| AN | 남은개월수 | 79% | 자동(11) | |
| AO | 자동연장여부 | 79% | 자동(수식) | |
| AP | 교체일 | 96% | 자동(32) | |
| AQ | 주소 | 97% | 자동(51) | 업체 접수 → `address` |
| AR | 기기상태 | 96% | 자동(30) | |
| AS | 관리/담당자 | 97% | 자동(48) | |
| AT | 시/도 | 97% | 자동(52) | |
| AU | 시/구 | 97% | 자동(53) | |
| AV | 방문주기 | 0% | 비움 | 6행 `#N/A` |
| AW | 납품담당 | 97% | 자동(44) | |
| AX | 키맨 | 96% | 자동(27) | |
| AY | 추가조건 | 39% | 자동(58) | |
| AZ | 장비소유주 | 96% | 자동(46) | |
| BA | 기번 | 96% | 자동(36) | |
| BB | 자산기번(자산번호) | 96% | 자동(35) | |
| BC | 위탁/유지보수및기타사항 | 7% | 자동(45) | |
| BD | 기본매수 | 92% | 자동(수식) | 6행 `#N/A` → 수식 유지 |
| BE | 초과장당금액 | 91% | 자동(수식) | |

**처리 단추 → 시트 갱신**(기존 `sendReceptionCopierCompleteJob`의 갱신 잡 패턴): `_updateOnly=1`, `_updateRow=sheet_row`, 키 확인은 **A열(열 번호 1) = sheet_seq**. 행이 밀렸으면 A열에서 sheet_seq를 아래에서 위로 찾고, 못 찾으면 실패로 끝낸다. **새 행은 절대 만들지 않는다.**
- [완료]: G `처리완료`, F 처리자, X/Z 처리내용(있으면)
- [보류]: G `보류`
- [메모](영업만): H 진행 메모
- [내일로]·[날짜 고르기]: 시트에 예정일 칸이 없어 **시트 갱신 없음**(DB·달력만)

---

## 4. 화면 흐름

서비스접수 탭을 열면 위에서 아래로 이렇게 보인다.

    [A] 미처리 현황판 (주인공 — 대표가 보는 곳)
    [B] 접수 종류 선택기 (두 줄 묶음 6개)
    [C] 왼쪽: 선택한 종류의 접수 폼   |   오른쪽: 접수리스트(기존)

### 4-1. [A] 미처리 현황판 — 새 파일 `src/ReceptionBoard.tsx`

대상: 6종 전부. 최근 90일 안에 접수된 것 중 `receptionState.ts` 판정으로 "열린" 건(접수·진행중·보류). 60초 주기와 창 복귀 때 새로 읽고, 숨은 탭에서는 쉰다(기존 속도 규칙).

(a) **숫자 띠**(맨 위 한 줄, 폰은 가로 스크롤)
- 6종 × `접수 n · 진행중 n · 보류 n` 작은 칸 6개(현장 3 | 지원 3, 묶음 사이 구분선)
- `오늘 들어온 건 N`(6종 합계, receipt_date = 오늘 KST)
- `이번 주 완료율 NN%` = 이번 주(월요일~오늘) 접수 중 완료된 건 ÷ 이번 주 접수 건. 분모가 0이면 "-"
- 지원 3종 스위치가 꺼져 있으면 지원 칸은 숨긴다

(b) **종류별 열**(PC 6열, 태블릿 3열 2줄, 폰은 종류 칩 + 한 열)
- 카드는 **오래된 순**(receipt_date, created_at 오름차순)
- 경과일 = 오늘 − 접수일(달력일). **3일 이상 노랑 테두리, 7일 이상 빨강 테두리**
- **예정일이 지난 건**(지원 3종 `schedule_date` < 오늘)은 열 맨 위 "예정일 지남" 묶음으로 따로 모으고 빨간 꼬리표
- 카드 내용: 업체명 · 접수분야 · 접수자 · 처리자 · `경과 n일` · 예정일(있으면) · 보류면 "보류" 꼬리표 · 미룸 횟수
- 열 머리에 건수. 열마다 처음 20장만 보이고 "더 보기"

(c) **종류를 누르면 그 종류만**: 숫자 띠의 칸이나 열 머리를 누르면 그 종류 열만 넓게 보인다. 다시 누르면 전체로 돌아간다. 이 선택은 아래 선택기 [B]와 목록 필터도 같은 종류로 맞춘다.

카드 동작:
- **현장 3종 카드**: 새 단추를 달지 않는다. 카드를 누르면 **기존 흐름으로 연결만** 한다. 복합기 AS는 아래 접수리스트에서 그 행을 펼치고(완료는 일정리스트에서 하던 대로), 원격·IT는 그 탭으로 바꾼 뒤 대기열의 그 건을 펼친다.
- **지원 3종 카드**: 카드 아래 단추 줄 `[완료] [내일로] [날짜 고르기] [보류] [메모]`(새 파일 `DeptActionBar.tsx`, 목록 펼침과 같은 부품). 일정리스트(`as_tickets`)에는 넣지 않는다.

| 단추 | DB (`merge_reception_handling`) | 부서 달력(team_calendar_events) | 시트(영업·경영) |
|---|---|---|---|
| [완료] | status `완료`, `completed_at/by`, 처리내용 입력칸(선택) → `handled` | 일정 있으면 제목 앞에 체크 표시 | G `처리완료` + F + X/Z |
| [내일로] | `schedule_date` = 다음 영업일(토·일 건너뜀), `postpone_count`+1, status가 `접수`면 `진행중` | 있으면 날짜 이동, 없으면 새로 만듦 | 없음 |
| [날짜 고르기] | `schedule_date` = 고른 날, `postpone_count`+1 | 같음 | 없음 |
| [보류] | status `보류`(다시 누르면 `진행중`) | 변화 없음 | G `보류` |
| [메모] | `memo_log` 위에 한 줄 추가. 영업은 진행 메모 칩도 고를 수 있음 → `progress` | 변화 없음 | 영업만 H |

모든 단추는 누른 뒤 카드가 낙관적으로 바뀌고, 실패하면 되돌리면서 빨간 토스트를 띄운다. 같은 카드는 저장이 끝날 때까지 단추를 잠근다(두 번 누름 방지).

### 4-2. [B] 접수 종류 선택기 — 새 파일 `src/ReceptionTypePicker.tsx`

기존 탭 줄(`[복합기 AS] [원격] [IT]`)을 **같은 자리에서 두 줄 묶음으로 바꾼다.**

    현장 | [(아이콘) 복합기 AS 3] [(아이콘) 원격 1] [(아이콘) IT 2]
    지원 | [(아이콘) 경영지원 4] [(아이콘) 운영지원 0] [(아이콘) 영업지원 7]

- 버튼마다 아이콘 · 이름 · **열린 건수 배지**(현황판과 같은 숫자). 아이콘 모양은 디자인실이 lucide에서 고른다.
- 폰은 3+3 두 줄 그대로(한 줄에 세 칸).
- 현장 3종은 **순서·이름·누를 때 동작이 지금과 같다**(폼 유형 전환 + 목록 필터 전환 + localStorage `reception_page_v1` 기억). 바뀌는 것은 모양과 배지 숫자의 뜻이다(기간 건수 → 열린 건수).
- `DEPT_RECEPTION_ENABLED`가 꺼져 있으면 아랫줄 전체를 숨긴다.

### 4-3. [C] 지원 3종 접수 폼 — 새 파일 `src/DeptReception.tsx` (세 종류가 한 폼을 함께 씀)

1. **접수자 줄**(맨 위 한 줄, 읽기 전용): `접수자 이정현 · 영업팀` — 1절 규칙. 로그인 필수가 꺼져 있으면 기존 작성자 선택 값.
2. **접수 단위 전환**: `[기기로 접수] [업체로 접수]`
   - **기기로 접수**: 입력 하나("순 또는 업체명·자산번호·기번"). 숫자만 치고 Enter를 누르면 순 정확 일치, 글자면 후보 목록(`searchLeaseList`). `순번 없음(신규)` 토글을 켜면 업체명(필수)·지역 칩(A~E·지방·미정)을 직접 입력.
   - **업체로 접수**(기기 없는 서비스 불만·청구 문의 등): `vendor_master` 이름·별칭 검색 → 고르면 카드에 `마스터 이름 · 코드 · 보유 n대 · 등급(최빈) · 지역(최빈) · 대표 주소`. 순 칸은 없음.
3. **자동 채움 미리보기 카드**(읽기 전용): 업체명·등급·지역·임대여부·자산번호·모델명·계약일~종료일·남은개월·미수개월·기본금액·주소(경영은 마감담당·일반전화·확장성 추가). "이 값은 시트에 자동 기입됩니다" 한 줄.
4. **사람 입력**(필수에 빨간 점):
   - 접수유형 칩(필수) `카카오 · 전화 · 메일 · 사내 요청`(사내 요청 → 명부 자동완성으로 이름). 경영은 기본 `사내 요청`.
   - 접수분야 칩(필수) + `직접 입력` — 아래 확정 목록.
   - 업체담당자 / 전화번호(선택, 숫자만 쳐도 하이픈).
   - 접수내용(필수, 여러 줄) / 특이사항(선택, DB만).
   - 처리자(지역 기본값, 바꿀 수 있음).
   - 외근요청 토글(기본 꺼짐).
   - 경영만: 계약서구분 `전자 · 수기`(접수분야에 "계약"이 들어가면 펼침).
   - 예정일(선택) → 부서 달력.
5. **필수 점검 줄**: `업체 · 접수유형 · 접수분야 · 접수내용 · 접수자`.
6. **저장** 한 버튼: DB 저장 → (영업·경영) 시트 잡 → (예정일) 달력 → (방 매핑 있으면) 카톡. 결과 줄 예: `저장됨 · 영업시트 5840행 · 카톡 방 미정`. 저장 중 잠금, 같은 화면의 같은 건은 다시 저장하지 않음(`savedRowId`).
7. 저장 뒤 폼을 비우고 현황판·목록에 바로 나타난다.

**접수분야 칩(Q9 확정 — 2026년 빈도 상위)**

| 영업지원 | 경영지원 | 운영지원(Q3 답) |
|---|---|---|
| 신규/추가 렌탈 | 청구관련 | 소모품 |
| 렌탈문의 | 계약서요청 | 배송/택배 |
| 현장/단기 렌탈 | 계약관련 | 설치 |
| 현장/단기 철수 | 사업자변경 | 기타 |
| 해지문의 | 수기계약서 | + 직접 입력 |
| 해지/위약금 | 세금계산서 | |
| 반출문의 | 보증금 | |
| 계약문의 | CMS출금 | |
| 재계약/연장 | 사용량 | |
| 교체문의·기기교체/사양변경 | 매수상향 | |
| 요금관련/초과료 | 거래명세서 | |
| 매수상향/조정 | 용지주문 | |
| 견적문의 | 정산 | |
| 기타 + 직접 입력 | 기타 + 직접 입력 | |

**처리자 기본값(Q4 답 — 시트 2행 안내)**

| 지역 | 영업지원 | 경영지원 | 운영지원 |
|---|---|---|---|
| 수도권A | 이찬우 | 이윤아 | (비움) |
| 수도권B | 박민 | 박수민 | (비움) |
| 수도권C | 이정현 | **(비움)** — 최영지·박지은 중 접수자가 고름 | (비움) |
| 수도권D·E(지방) | 김수인 | 김슬기 | (비움) |
| 미정·신규 | 박진영 | (비움) | (비움) |

상수는 `src/deptReception.ts` 한 곳에 둔다. 담당이 바뀌면 그 파일만 고친다.

### 4-4. 접수리스트(오른쪽, 기존)

- "전체"에 지원 3종이 함께 나온다. 필터 칩 줄에 **`지원 N` 칩 하나**를 더한다(3종 합계). 선택기에서 지원 종류를 고르면 목록 필터도 그 종류로 바뀐다.
- 행 배지 `경영`·`운영`·`영업`(기존 blue·cyan·violet과 겹치지 않는 색).
- 상태 점: 보류는 진행중 칸, 취소는 완료 칸으로 센다.
- 지원 3종 행을 펼치면 기존 버튼 대신 **`DeptReceptionDetail`**(새 파일): 자동값 요약, 접수내용, 메모 기록, 처리내용 칸, 같은 `DeptActionBar`, 시트 상태(`시트 미반영` + [다시 보내기]), 카톡 상태(`방 미정`).

### 4-5. 홈 관제 덱 카드 — 새 파일 `src/HomeReceptionCard.tsx`

- 관제 덱 상태 알약 격자(Home.tsx 344~350행)에 한 칸 추가: `미처리 접수 N건`, 보조 글자로 `7일↑ n건`(빨강이 있으면 빨간 점).
- 누르면 `go("serviceReception")`으로 서비스접수 탭에 들어간다(현황판이 맨 위에 있음).
- 숫자는 현황판과 **같은 함수**(`receptionState.ts`)로 센다. 홈을 열 때 한 번, 그다음 5분마다 읽고 숨은 탭에서는 쉰다.
- Home.tsx 수정은 import 1줄 + 카드 1줄.

### 4-6. 경계선 — 현장 3종은 바꾸지 않는다

- 복합기 AS·원격·IT의 폼, 필수 항목, 저장(`persist`), 시트 잡, 카톡, 일정리스트 연동, 목록 펼침 내용, 완료 흐름은 **바꾸지 않는다.**
- 바뀌는 것은 두 가지뿐이다. (1) 탭 줄이 두 줄 선택기로 바뀌고 배지가 열린 건수로 바뀐다. (2) 맨 위에 현황판이 생기고, 그 카드를 누르면 기존 화면으로 연결된다.
- ServiceReception.tsx 수정은 6절 C2의 번호 목록으로 한정한다.
- 이미 있는 버그 하나를 함께 고친다: `byAuthor`가 `else entry.remote += 1`이라 지원 접수가 원격 건수로 잘못 잡힌다.

---

## 5. 웹 달력과 카톡

### 5-1. 웹 달력 — `team_calendar_events` 팀 값 확장(Q5 답: 예정일 넣은 접수만)

- 만드는 조건: 폼의 예정일, [내일로], [날짜 고르기]. 값: `team=영업지원`(등), `date=예정일`, `time=""`, `title=[영업] 업체명 · 접수분야`, `memo=접수내용 앞 200자 + 처리자`, `author=접수자`, `reception_id=접수 id`.
- 예정일이 바뀌면 같은 `reception_id` 일정을 갱신한다(없으면 만듦). 완료하면 제목 앞에 체크 표시를 붙인다(일정은 남김). 접수를 지우면 일정도 지운다.
- 보는 곳: 지원 폼 아래 접이식 `부서 달력`(기존 `TeamCalendar` 재사용). 팀 값에 3종이 생겨 "웹캘린더 팀 필터" 요구도 채운다. 네이버로는 가지 않는다.
- 비권고 대안: `as_tickets`에 scheduleType 추가(일정리스트·네이버 미러·현장 배정에 섞임).

### 5-2. 카톡 — 구조만

- room_map 키 예약: `경영접수|*`, `운영접수|*`, `영업접수|*`. **이번에는 매핑 행을 넣지 않는다.**
- `sendDeptReceptionKakao(dept, text)`: TEST_MODE면 테스트방, 매핑이 있으면 `enqueueOutbox` 후 `kakao=sent`, 없으면 **보내지 않고** `kakao=no_room` → 화면에 회색 `방 미정`. 다른 방으로 대신 보내는 폴백은 없다.
- 방이 정해지면 /room-add 절차로 한 줄만 넣으면 된다. 지난 건은 소급해 보내지 않는다.
- 사람이 저장할 때 보내는 것이라 "자동 메시지 KST 10시 이후" 규칙 대상이 아니다. 누락 알림(자동)은 범위 밖이고, 만들 때 그 규칙을 적용한다.

---

## 6. 작업 분해

### 순서

    0. 팀장 확인(사용자 답 반영본)
    1차 병렬 ─ 표다빈 SQL │ 윤화면 화면 틀 │ 구현서 A 시트 동기화 │ 구현서 B 순수 로직·API
    2차 병렬 ─ 구현서 C 화면 연결(폼·상세·단추·선택기·ServiceReception) │ 구현서 D 현황판·홈 카드
    3. 검수아 qa-checker → 배포준 field-deploy-check → 배포(엣지 함수 포함)
    4. 사용자 SQL 실행 → MCP로 확인 → 관리자가 DEPT_RECEPTION_ENABLED=true

**파일 소유표 — 한 파일은 한 사람만 만진다**

| 파일 | 소유 | 새/수정 |
|---|---|---|
| `supabase/reception-dept-types.sql` | 표다빈 | 새 |
| `supabase/functions/field-sheet-sync/dept-sheet-spec.ts` | 구현서 A | 새 |
| `supabase/functions/field-sheet-sync/dept-sheets.ts` | 구현서 A | 새 |
| `supabase/functions/field-sheet-sync/sheets-api.ts` | 구현서 A | 수정(export만 + FIELD_SHEETS 2줄) |
| `supabase/functions/field-sheet-sync/index.ts` | 구현서 A | 수정(라우팅) |
| `tests/deptSheetSpec.test.ts` | 구현서 A | 새 |
| `src/deptReception.ts` | 구현서 B | 새 |
| `src/receptionState.ts` | 구현서 B | 새 |
| `src/deptReceptionApi.ts` | 구현서 B | 새 |
| `src/supabase.ts` | 구현서 B | 수정(FieldSheetSyncCategory 1줄) |
| `tests/deptReception.test.ts`, `tests/receptionState.test.ts` | 구현서 B | 새 |
| `src/ReceptionTypePicker.tsx` | 윤화면(표시 틀, 1차 완료) | 새 |
| `src/DeptReceptionForm.view.tsx` | 윤화면(표시 틀, 1차 완료) | 새 |
| `src/DeptReception.tsx` | 구현서 C(감싸개) | 새 |
| `src/DeptReceptionDetail.tsx` | 구현서 C | 새 |
| `src/DeptActionBar.tsx` | 구현서 C | 새 |
| `src/ServiceReception.tsx` | 구현서 C | 수정(C2 번호 목록만) |
| `src/CustomerReport.tsx` | 구현서 C | 수정(1곳) |
| `src/lookupCatalog.ts` | 구현서 C | 수정(1줄) |
| `src/ReceptionBoard.tsx` | 윤화면(표시 틀, 1차 완료) | 새 |
| `src/ReceptionBoardPanel.tsx` | 구현서 D(감싸개) | 새 |
| `src/HomeReceptionCard.tsx` | 윤화면(표시 틀, 1차 완료) | 새 |
| `src/HomeReceptionPanel.tsx` | 구현서 D(감싸개) | 새 |
| `src/Home.tsx` | 구현서 D | 수정(import 1줄 + 카드 1줄) |
| `tests/receptionUi.render.test.tsx` | 윤화면 | 새(1차 완료) |

표시 틀(윤화면)과 로직 감싸개(C·D)는 서로 다른 파일이다. 2차에서 틀 파일을 고칠 일이 생기면 직접 고치지 않고 윤화면에게 돌려보낸다. 1차 산출물 중 tests/receptionUi.render.test.tsx는 윤화면 소유다.

### 1차 병렬

**데이터실 표다빈 (db-schema)**
- `supabase/reception-dept-types.sql`(3-2절 1~7). 먼저 MCP로 type·route·category·team 제약의 실제 이름과 정의를 조회한다.
- 건드리지 않음: 다른 SQL 파일(`service-receptions.sql`·`field-sheet-sync.sql`은 재실행 금지).

**디자인실 윤화면 (ui-designer)**
- 표시 틀 4개(ReceptionTypePicker·DeptReceptionForm.view·ReceptionBoard·HomeReceptionCard)를 props만 받는 표시 전용으로 만든다(1차에서 이미 만들어짐). 상세·단추(DeptReceptionDetail·DeptActionBar)는 모양 지침만 C에게 넘긴다.
- 현황판: 숫자 띠, 6열/3열/폰 칩, 경과 노랑·빨강, "예정일 지남" 묶음, "시트에 직접 적은 건은 안 나옵니다" 안내.
- 선택기: 두 줄 3+3, 아이콘·이름·배지, 폰 682px 확인. 지원 배지 3색.
- 건드리지 않음: ServiceReception.tsx, Home.tsx(C·D 몫).

**개발실 구현서 A — 시트 동기화 (opus 권장)**
- 1단계 실측(쓰기 전 반드시): peek와 FORMULA 읽기로 (1) 문서 ID (2) 5·6행 (3) 마지막 행 아래 빈 행의 수식 (4) 영업 A·C·J·O·AE~AG, 경영 A·C·O·AO·BD·BE의 수식 여부를 확인한다. 이어서 테스트 1행을 쓰고 열 위치를 확인한 뒤 **바로 지운다**. 결과는 문서 끝 "실측 기록"에 남긴다.
- `dept-sheet-spec.ts`(순수 TS): 열 사양(col, expectHeader, kind, key), 서명, DATA_START, 지문 열, 처리 단추→G값 변환, 업체 접수·신규일 때 쓰는 열(N·O·P·주소).
- `dept-sheets.ts`: `appendDeptRow` / `updateDeptRow`. 잠금 → 5행 머리 검증 → 지문 → 쓸 때마다 마지막 행 + 순번 계산 → 값 기입(수식 칸 건너뜀) → 6행 FORMULA로 임대리스트 값 고정(순이 있을 때만) → row·sheet·seq 반환. 갱신은 `_updateOnly` + A열 seq 확인 + 아래→위 찾기, 새 행 금지.
- `sheets-api.ts`: 도우미에 export, `FIELD_SHEETS` 2줄. 그 밖은 바꾸지 않는다.
- `index.ts`: 두 category를 `dept-sheets.ts`로 보내고, GAS 폴백은 하지 않는다.
- `tests/deptSheetSpec.test.ts`: 열 수·머리 이름, 경영 자산번호 중복을 번호로 구분, 6행 서식값(원화·날짜·#N/A), 순번 계산(사람 줄이 섞인 A열), 업체 접수 시 쓰는 열.

**개발실 구현서 B — 순수 로직·API (sonnet)**
- `src/deptReception.ts`: `DEPT_TYPES`, `DeptType`, `isDeptType`, `deptShort`, `DEPT_TONE`, `DEPT_ICON` 이름, `DEPT_SHEET_CATEGORY`, `DEPT_FIELD_CHIPS`(4-3 확정 표), `DEPT_PROGRESS_CHIPS`, `DEPT_ROUTES`, `defaultHandler(dept, region)`(4-3 표), `DeptMeta`, `buildDeptTitle`, `buildDeptReport`, `pickLease`, `nextBusinessDay(kstDate)`, `resolveReceiver(ssoRequired, session, fallbackAuthor)` → name·team·locked.
- `src/receptionState.ts`: `openStateOf(row)`(6종 공통 판정 — 현장 3종은 ServiceReception `listStateOf`와 **같은 규칙**, 지원은 보류 포함), `ageDays(row, today)`, `ageTone(days)`(3일 이상 노랑, 7일 이상 빨강), `isOverdue(row, today)`, `boardSummary(rows, today)` → 종류별 접수·진행중·보류 건수 + 오늘 건수 + 이번 주 완료율, `groupForBoard(rows)`(오래된 순, 예정일 지남 묶음).
- `src/deptReceptionApi.ts`: `saveDeptReception(input)`(푸시 없음), `getBoardRows(days=90)`(6종 열린 건 + 완료율 재료), `searchVendorMaster(q)`, `vendorAggregate(code)`(aliases로 vendor_info를 모아 등급·지역 최빈값, 대표 주소, 보유 대수), `deptAction(row, kind, payload)`(완료·내일로·날짜·보류·메모 → merge RPC + 달력 + 시트 갱신 잡), `enqueueDeptSheetAppend`, `retryDeptSheet`, `upsertDeptCalendar`, `removeDeptCalendar`, `sendDeptReceptionKakao`. Supabase 접근은 `src/supabase.ts` 래퍼만.
- `src/supabase.ts`: `FieldSheetSyncCategory`에 두 값.
- 테스트: `tests/deptReception.test.ts`(처리자 기본값·C지역 비움, 다음 영업일, 접수자 결정 3경우, 제목·양식), `tests/receptionState.test.ts`(현장 3종 판정이 기존 `listStateOf`와 같은지 표로 대조, 경과 색, 예정일 지남, 완료율 분모 0).

**고정 인터페이스 — 표시 틀(윤화면, 1차에서 이미 만들어짐)과 로직 감싸개(C·D)를 나눈다**

윤화면의 틀은 **props만 받는 표시 전용**이다(저장·조회 없음). 로직은 감싸개 파일이 맡고, 틀 파일은 2차에서 고치지 않는다. 고쳐야 하면 윤화면에게 돌려보낸다.

    [표시 틀 — 윤화면 소유, 이미 있음]
    ReceptionTypePicker.tsx     props: value, onChange(종류), counts(종류별 열린 건수), deptEnabled
                                내보냄: ReceptionType, RECEPTION_TYPES, RECEPTION_TYPE_META(이름·아이콘·색 — 다른 화면도 이것을 씀)
    DeptReceptionForm.view.tsx  props: dept, mode(device/vendor), 검색·후보 슬롯, 미리보기, 사람 입력 값, required, onSave/saving/result
    ReceptionBoard.tsx          props: rows, today, onSelectType, renderActions(row), loading, error, todayCount, weekDoneRate
    HomeReceptionCard.tsx       props: counts, oldest, onClick, loading, error

    [로직 감싸개 — 2차]
    DeptReception.tsx           (C) props: dept, fallbackAuthor, onSaved(row)   — DeptReceptionForm.view를 감싸 검색·저장 연결
    DeptReceptionDetail.tsx     (C) props: row, onChanged(row)
    DeptActionBar.tsx           (C) props: row, compact, onChanged(row)          — 완료·내일로·날짜·보류·메모
    ReceptionBoardPanel.tsx     (D) props: deptEnabled, focusType, onFocusType, onOpenRow(row), onCounts(counts)
                                    — 데이터를 읽어 ReceptionBoard에 넘기고, renderActions에 지원 카드면 DeptActionBar(compact)
    HomeReceptionPanel.tsx      (D) props: onOpen()                              — 숫자를 읽어 HomeReceptionCard에 넘김

### 2차 병렬

**개발실 구현서 C — 폼·상세·단추·선택기 연결 (sonnet)**
- C1. `DeptReception.tsx`(DeptReceptionForm.view 감싸개), `DeptReceptionDetail.tsx`, `DeptActionBar.tsx`를 만들어 B의 로직을 연결한다. ReceptionTypePicker는 고치지 않고 ServiceReception에서 그대로 쓴다.
- C2. `src/ServiceReception.tsx` — **아래 번호 목록 밖은 손대지 않는다**:
  1. import 추가(ReceptionTypePicker·ReceptionBoardPanel·DeptReception·DeptReceptionDetail + deptReception 공용 함수)
  2. `page` 타입을 6값으로(copier·remote·it·mgmt·ops·sales), localStorage 복원도 6값 허용
  3. `PAGE_TYPE`·`goPage`: 지원 page면 `setType`을 부르지 않고 목록 필터만 그 종류로
  4. `openCounts` state 1줄(현황판 onCounts가 채움) + 현황판 포커스 state 1줄
  5. 기존 탭 줄 블록(1591행 부근, border-b 탭 div 하나)을 ReceptionTypePicker(value·onChange·counts·deptEnabled)로 교체
  6. 머리 섹션 바로 아래에 ReceptionBoardPanel 1개 삽입 + onOpenRow 처리: 복합기면 목록 필터·setOpenRowId, 원격·IT면 goPage 후 setOpenRowId, 지원이면 그 종류 page로
  7. 왼쪽 영역: 지원 page면 DeptReception, 아니면 기존 JSX
  8. `TYPE_TONE`에 지원 3색
  9. `listFilter` 유니온·칩 배열에 "지원", `typeFilteredRows`에 지원 분기
  10. `counts.dept` + `byAuthor` 지원 칸(else→remote 오집계 수정)
  11. 행 배지 글자: 지원이면 deptShort
  12. `listStateOf` 맨 앞에 지원 분기 한 줄
  13. 행 펼침: 지원이면 DeptReceptionDetail, 아니면 기존
- C3. `src/CustomerReport.tsx`: 고객 보고서 조회 1곳에 type을 현장 3종으로 묶는 조건(Q6 답).
- C4. `src/lookupCatalog.ts`: 접수 chipFilter에 3종(1줄).
- 건드리지 않음: App.tsx, api.ts, CsAsWorkspace, TeamCalendar, Home.tsx(D 몫), entity360. Q6 답대로 통합검색의 열린 접수 숫자에는 포함한다. 지금 코드가 이미 status에 "완료"가 없으면 열린 것으로 세므로 고칠 것이 없다. 취소도 열린 것으로 잡히는 점은 받아들인다.

**개발실 구현서 D — 현황판·홈 카드 (sonnet)**
- D1. `src/ReceptionBoardPanel.tsx`(ReceptionBoard 감싸개): getBoardRows로 읽고 boardSummary로 숫자 띠·오늘 건수·완료율을 만들어 넘긴다. renderActions는 지원 카드면 C의 DeptActionBar(compact), 현장 카드면 없음(카드 클릭이 onOpenRow). onCounts로 선택기 배지 숫자를 올려 준다. 60초 주기 + 창 복귀 + 숨은 탭 쉼(useScreenActive).
- D2. `src/HomeReceptionPanel.tsx`(HomeReceptionCard 감싸개): getBoardRows + boardSummary로 종류별 건수와 가장 오래된 1건, 5분 주기, 클릭 시 onOpen.
- D3. `src/Home.tsx`: import 1줄 + 관제 덱 상태 알약 격자 안에 HomeReceptionPanel 1줄(onOpen은 go("serviceReception")).
- 건드리지 않음: ServiceReception.tsx(C 몫), DeptActionBar(C 몫 — import만), 표시 틀 4개(윤화면 몫).

### 3. 품질실 검수아 (qa-checker)

- `npm run build`, `npm test` 통과.
- 범위: `git diff --stat`이 소유표 밖을 건드리지 않았는지. ServiceReception.tsx diff가 C2 1~13번뿐인지(기존 분기 줄의 삭제·변경 0). Home.tsx는 2줄.
- 현장 3종 회귀: 복합기 AS 기존·신규, 원격 접수→처리, IT 접수→CS 이관의 저장 payload가 전과 같은지. 선택기에서 현장 3종의 순서·전환·기억이 같은지. 목록 칩 숫자(복합기·IT·원격)가 같은지. byAuthor 원격 숫자는 지원 건만큼 줄어드는데, 이것은 의도한 수정이다.
- 현황판: 6종 숫자가 목록과 맞는지, 3일/7일 색, 예정일 지남 묶음, 종류 누르기 → 선택기·목록 연동, 현장 카드 → 기존 행이 펼쳐지는지, 이번 주 완료율 계산.
- 지원 3종: 기기로 접수(순) / 신규 / **업체로 접수**(DB에 lease_no·asset_no·serial 빈 값, remote_meta.vendor_code, 등급·지역 최빈값). 운영은 시트 잡 없음. 예정일 → team_calendar_events. 단추 5개의 DB·달력·시트 결과가 4-1 표대로인지. 방 미정 표시.
- **통합검색 360**: 업체로 접수한 건이 그 업체 이름으로 찾을 때 "접수"에 나오는지, "열린 접수" 숫자에 들어가는지.
- 접수자: 로그인 필수 켜짐 → 이름·팀 고정, 꺼짐 → 기존 선택 값.
- 홈: 카드 숫자 = 현황판 합계, 클릭 → 서비스접수.
- 실패 경로: 스위치 꺼짐(아랫줄 숨김), CHECK 미실행인데 켜짐("SQL 실행 필요" 안내), 네트워크 끊김(폼 유지·단추 되돌림), 두 번 누름(1건만), 시트 잡 실패 → "시트 미반영" + [다시 보내기].
- 시트: 구현서 A의 테스트 1행이 지워졌는지 확인.

**검사실 권한나(sql-review)**: SQL 검사 통과 후 /sql-handoff. **검사실 배포준**: 배포 전후 검사(엣지 함수 field-sheet-sync 배포 포함).

### 위험과 막는 방법

| 위험 | 결과 | 막는 방법 |
|---|---|---|
| CHECK SQL 실행 전에 지원 종류가 열림 | 저장 400, 시트 잡 insert 실패(조용한 실패) | 스위치. enqueue 실패는 sheet_state=failed + 빨간 표시. check constraint 오류면 "SQL 실행 필요" |
| 시트 열 밀림 | 엉뚱한 열에 기입 | 열 번호 고정 + 5행 머리 검증, 다르면 중단 |
| 경영 머리 중복·도우미 머리행 | 틀린 열·행 | 서명으로 5행 고정, 번호 매핑 |
| 6행 서식 문자열 | 값 고정이 조용히 빠짐 | FORMULA 렌더 + 테스트 |
| 사람 기재 병행 | 같은 빈 행에 동시에 쓰면 겹침, 시트에만 있는 건은 현황판에 없음 | 쓸 때마다 마지막 행 계산(잠금 안), 현황판 안내 문구, 시트→DB 가져오기는 후속 |
| 재시도 중복 행 | 같은 접수 두 줄 | dupKey + 지문 + GAS 폴백 없음 |
| 현장 3종 회귀 | 현장 접수 장애 | ServiceReception 13항목 한정, 기존 sheets-api 로직 무수정, payload 대조 |
| 현황판 판정이 목록과 다름 | 대표가 보는 숫자가 틀림 | receptionState.ts를 listStateOf와 표로 대조하는 테스트 |
| 현황판 조회 부하(60초 × 접속자) | 느려짐 | 열린 건 + 90일만, 필요한 컬럼만, 숨은 탭 쉼. 홈 카드는 5분 |
| 지원 접수가 현장 웹푸시로 울림 | CS 혼란 | saveServiceReception 안 씀 |
| 고객 보고서에 청구 문의 | 고객 노출 | CustomerReport 필터(C3) |
| 업체로 접수가 360에서 안 잡힘 | 기록 누락처럼 보임 | vendor에 임대리스트 표기(alias) 저장 + QA 확인 항목 |

---

## 7. 남은 열린 질문(작은 것 — 답이 없으면 괄호 안 기본값으로 간다)

1. [내일로]의 "다음 영업일"에 공휴일도 건너뛸까요? (기본: 토·일만 건너뜀)
2. 이번 주 완료율의 정의: "이번 주에 접수된 건 중 완료"(기본) vs "이번 주에 완료한 건 ÷ 이번 주 열린 건 전체"
3. 업체로 접수할 때 마스터 별칭이 여러 개면 DB vendor에 어느 이름을 넣을까요? (기본: 임대리스트 행이 가장 많은 별칭)
4. 현황판을 볼 수 있는 사람을 제한할까요? (기본: 제한 없음 — 앱이 익명 키 단일 모델)

---

## 8. 하지 않을 것 (범위 밖)

- 네이버 캘린더 전송(어떤 경로로도 안 함). 지원 3종을 일정리스트(as_tickets)에 넣는 것.
- 카톡 방 매핑 등록·실발송(구조만), 누락 알림 카톡, 미처리 자동 독촉.
- 현장 3종의 폼·필드·시트·카톡·일정 연동·완료 흐름 변경, 현장 카드에 새 단추 달기, ServiceReception.tsx 정리·분할.
- **시트 → DB 가져오기**(사람이 시트에 직접 적은 접수·처리 내용 끌어오기)와 과거 시트 행(영업 5,838·경영 1,759) 이관 — **후속 후보**로만 기록.
- 운영지원 시트 신설.
- 부서별 열람 권한(2단계 RLS 때).
- 부서 통계 대시보드·보고서(현황판 숫자 띠 외).
- apps-script/field-sheet-sync.gs(GAS)에 새 category 추가.

---

## 실측 기록 (구현서 A가 1단계에서 채움)

- 문서 ID 일치: (미기록)
- 영업 5·6행, 빈 행 수식 여부, A/C/J/O/AE~AG 수식 여부: (미기록)
- 경영 5·6행, 빈 행 수식 여부, A/C/O/AO/BD/BE 수식 여부: (미기록)
- 테스트 1행: 쓴 행 번호·시각 / 지운 시각: (미기록)

### 실측 기록 1 — CSV 사본 기준 (구현서 A, 2026-10-19). 시트 API(FORMULA·maxRows) 실측은 아직 안 함
- 근거: 같은 문서 `1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g`에서 받은 CSV 사본(영업 gid 174566767 5,844행×33열 / 경영 gid 899183889 1,765행×57열). 문서 ID 일치는 CSV 출처로만 확인 — 서비스 계정 편집 권한은 미확인.
- 영업 5행: A 순번 … AG 주소(33열, 설계안 표와 같음). 6행 번호: M31·N19·P79·S35·T`62개월`·Y38·Z`₩ 14`·AA`₩ 15`·AB`1900. 1. 8`·AC`1900. 1. 9`·AD`11 개월`. O·AE·AF·AG는 6행 번호 없음.
- 경영 5행: A `-` … BE 초과장당금액(57열). AG·AH 머리 앞에 공백(` 품목`·` 제조사`), J는 `외근요청여부⏎(외근요청)`, BA는 `시리얼번호(기번)`, H는 빈 머리. 6행 번호: L25·M31·N19·P79·T35·U62·V28·AD18·AE80·AF38·AG33·AH34·AI38·AJ14·AK15·AL`1900. 1. 8`·AM`1900. 1. 9`·AN11·AP32·AQ51·AR30·AS48·AT52·AU53·AV`#N/A`·AW44·AX27·AY58·AZ46·BA36·BB35·BC45·BD`#N/A`. O·AO·BE는 번호 없음.
- **설계안 표 정정**: 6행 `1900. 1. 8`·`1900. 1. 9`는 시트 날짜 일련번호로 **9·10**이다(1899-12-30=0). 설계안의 "계약일 8·종료일 9"는 하나씩 작다(9·10·11 연속이 남은개월 11과도 맞는다). 코드는 6행을 UNFORMATTED_VALUE로 읽어 실제 숫자를 쓰므로 이 차이에 영향받지 않는다.
- 6행 읽기 방식 변경: 설계안의 "FORMULA 렌더" 대신 **UNFORMATTED_VALUE**. 6행 칸이 `=MATCH(…)` 같은 수식이면 FORMULA 렌더는 수식 문자열을 돌려줘 번호를 못 얻는다. UNFORMATTED는 값 칸이든 수식 칸이든 숫자를 돌려준다. 서식 표시값(₩ 14·62개월·1900. 1. 8)도 해석하는 대비 코드를 넣었다.
- 순번: 영업 A열 1~5838, 경영 1~1759, 둘 다 빈칸·건너뜀 없이 1씩 증가(값인지 수식인지는 CSV로 모름). 다음 순번 5839·1760.
- 년월(C): 모든 행이 B와 같은 달(불일치 0). `9912`는 영업 2행·경영 15행, 전부 B가 `12월 30일`(날짜 0)인 행 → **C는 B를 읽는 수식(TEXT(B,"yymm")류)일 가능성이 높다**. 코드는 대상 칸이 수식이면 C를 쓰지 않고, 값 칸이면 yyMM을 쓴다.
- 마지막 데이터 행: 영업 5,844행, 경영 1,765행. CSV에 그 아래 행이 없어서 **빈 행에 수식이 미리 깔려 있는지·maxRows가 얼마인지는 CSV로 알 수 없다**(구글 CSV는 끝 빈 행을 자른다). 코드는 maxRows를 넘으면 행 삽입 + 위 30행 안의 열별 최근 수식 복사.
- 접수시간 D 표시는 `9:19`(앞 0 없음)·`오후 1:05:00` 섞임. 앱은 `HH:mm`으로 쓰고, 지문 비교 때 앞 0을 무시한다.
- 진행상황 G: 영업 처리완료 5,543·진행중 201·빈칸 14 / 경영 처리완료 1,320·빈칸 408·처리중 9 등 자유 표기.
- 남은 실측(시트 API로만): (1) A·C·J·O·AE~AG(영업), A·C·O·AO·BD·BE(경영) 대상 행 수식 여부 (2) maxRows와 빈 행 수식 (3) 6행이 값인지 수식인지 (4) 서비스 계정 편집 권한. 테스트 1행 쓰기·지우기는 팀장 지시로 하지 않았다(배포 뒤 팀장 판단).
