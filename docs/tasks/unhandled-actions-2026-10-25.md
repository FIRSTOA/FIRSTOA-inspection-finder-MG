# 미처리 행 단추 체계 통일 — [완료]·[보류]·[배정] + CS 접수 이름 통일 + [시트 열기] 이동 (2026-10-25, 기획실 한설계)

사용자 요구(2026-10-25 원문 요지)
- (3) "미처리에서 [시트에서 열기] 단추는 뭐야? 거긴 **[완료]** 가 있어야지 — 완료 치면 시트에서 처리완료, **보류**도. [시트 열기]는 접수 저장 단추 옆에."
- (4) "원격도 시트에 하는 거니까 영업·운영·경영과 **동일하게**. 복합기 AS 는 **CS 접수로 이름 통일**. 물류·CS 접수 건은 완료 누르면 **캘린더(네이버)·웹 일정리스트·웹 캘린더 다 완료**."

코드 0줄. 이 문서는 설계안이다. SQL 0장, App.tsx 0줄.

---

## 1. 한 줄 목표와 쓰는 사람

**미처리 목록 어디서 보든(홈 미처리 · 서비스접수 부서 미니 업무공간 · 접수 현황판) 한 줄을 누르면 그 자리에서 [완료]·[보류]·[배정]을 끝내고, 그 결과가 원본(시트 상태 열 / 일정·네이버)에 바로 적히게 한다.**

- 쓰는 사람: 관리자·부서 담당(경영·운영·영업 — PC 위주), CS 팀장·파트장(홈 — PC·폰 반반), 원격·IT 담당(PC).
- 폰: 홈 미처리 상세는 FormModal(아래서 올라오는 시트) — 단추 min-h-11.

## 2. 지금 상태(실측)와 기존 코드 재사용 지점

### 2-1. 지금 무엇이 문제인가
| 위치 | 지금 단추 | 문제 |
|---|---|---|
| `src/HomeUnhandledPanel.tsx` `UnhandledDetail` (210~240) | [닫기] + [서비스접수에서 열기]/[AS 일정리스트에서 열기], 물류는 열기 없음 | 처리하려면 다른 화면으로 가야 함 |
| `src/DeptWorkspacePanel.tsx` `unhandledActions` (203~213) | 시트 행 = **[시트에서 열기 (n행)]** 링크만, 앱 행 = `DeptActionBar` | 사용자가 지적한 단추. 머리 주석 9행 "시트 행은 FIELD 에서 처리할 수 없어" — 이 전제를 바꾼다 |
| `src/SheetRowCard.tsx` (접수 현황판 `ReceptionBoardPanel` 109행) | [시트에서 열기] | 같은 문제, 같은 방식으로 고친다 |
| `supabase/functions/reception-sheet-open/index.ts` 15행 | "시트는 절대 쓰지 않는다(D6)" | 이 함수는 읽기 전용 유지. **쓰기는 field-sheet-sync 잡 경로**로(3-2) |

### 2-2. 출처별 행 모양(`src/homeUnhandled.ts` `mergeUnhandled`)
| key | source | kind | 원본 | 지금 처리 수단 |
|---|---|---|---|---|
| `s:sales:<행>` / `s:mgmt:<행>` | reception | 영업팀 / 경영지원 | 해지방어접수·경영지원접수 탭 G열 "진행중/처리완료/보류/취소" | 없음(시트 직접) |
| `s:remote:<행>` | reception | 원격이관 / IT(L열 IT) | 원격 탭 G열 "처리여부" | 없음(시트 직접) |
| `r:<id>` (영업·경영·운영) | reception | 부서 3종 | service_receptions (+영업·경영 시트) | `deptReceptionFlow.runDeptAction` done/hold/assign — 시트 갱신 `pushSheetUpdate` 포함 |
| `r:<id>` (원격·IT) | reception | 원격이관/IT | service_receptions.remote_meta + 원격 탭 | ServiceReception.tsx 안 `saveHandling`/`syncRemoteSheet`(컴포넌트 안 — 밖에서 못 부름) |
| `t:<id>` | ticket | CS접수 / 물류 | as_tickets (+네이버 미러) | CsAsWorkspace `applyDone`/`toggleDone`/`update`(컴포넌트 안) · App.tsx `finishTicket`(4842, FIELD 전송 뒤 완료) |

**원격·IT 가 영업·경영과 다른 점(통일 대상)**: (1) 앱 접수 처리 함수가 ServiceReception 컴포넌트 안에만 있다 (2) 시트 행(사람이 직접 쓴 원격 접수)에 쓰는 경로가 없다. 운영지원은 시트가 없다(DB만 — 그대로).

### 2-3. 재사용·확장 지점
- `src/deptReceptionFlow.ts` `runDeptAction(row, done|hold|assign)` — 앱 출처 부서 행은 **그대로** 쓴다(완료 → DB·부서 달력 체크·시트 G열 처리완료).
- `supabase/functions/field-sheet-sync/dept-sheets.ts` 갱신 경로(91~124) + `dept-sheet-spec.ts` `buildUpdateValues`(317)는 **빈 값은 안 쓴다** → status 만 보내면 G열만 처리완료가 된다. 즉 영업·경영 시트 행은 엣지 수정 없이도 "상태만 갱신"이 된다(순번 없으면 E열 접수자 확인 폴백). 단 아래 3-2 처럼 세 탭을 한 경로로 묶는 쪽을 추천.
- `supabase/functions/field-sheet-sync/sheets-api.ts` 원격 갱신(582~611): **그대로 쓰면 위험** — `fieldValue` 가 갱신 때도 base 값(접수일·접수·접수자, 384~388)을 늘 쓴다. 사람이 쓴 시트 행에 보내면 접수일이 오늘로 덮인다. → "상태만" 모드가 필요.
- `supabase/functions/reception-sheet-open/state.ts` `SHEET_LAYOUTS`(99~115) — 탭별 상태 열·처리자 열·순번 열·상호 열 정의가 이미 있다. **쓰기도 이 표를 쓴다**(읽는 열 = 쓰는 열, 한 곳).
- `src/deptReceptionApi.ts` `enqueueDeptSheetJob`(112) — 잡 쌓기 + 즉시 호출(60초) + 재시도 대기 방식 그대로 본뜬다.
- CS 일정 완료: `CsAsWorkspace.tsx` `syncNaverAfterAction`(1200)·`toggleDone`(1262)·`update` 의 접수 동기화(1026~1055)·`DoneReasonModal`(2673), `api.ts` `setServiceReceptionStatus`(452)·`mergeReceptionHandling`(1224)·`sendReceptionCopierCompleteJob`(1228), `actionBlock.ts` `buildActionBlock`(81), `CsAsWorkspace.tsx` `buildMonthlyCloneRow`(171, export 됨).
- 시트 링크: `receptionSheetOpen.ts` `deptSheetUrl`·`sheetRowUrl`, `DeptWorkspacePanel.tsx` `DeptSheetLink`(68).

## 3. 데이터 설계 (새 표 없음 · SQL 0)

### 3-1. 시트별 상태 열·허용 값(실측)
| 탭 | gid | 머리/데이터 | 상태 열 | 처리자 열 | 행 확인 키 | 상호 열 | 허용 값 |
|---|---|---|---|---|---|---|---|
| 해지방어접수(영업) | 174566767 | 5 / 7~ | G "진행중/처리완료/보류/취소" | F | A 순번 + E 접수자 | P(16) | 진행중·처리완료·보류·취소 |
| 경영지원접수 | 899183889 | 5 / 7~ | G 같음 | F | A + E | P(16) | 같음 |
| 원격(원격·IT) | 916322987 | 1 / 5~ | G "처리여부" | K(11) | A(수식일 수 있음 — 표시값 비교) + B 접수일 | R(18) | 앱 선택지: 처리완료·접수취소·재접수·자체해결·AS이관·중복접수·방문이관. **보류 없음 → Q1** |

읽기 판정(`state.ts sheetStateClass`): 보류 → hold(미처리에 남고 상태만 보류), 처리완료·취소 계열 → 목록에서 빠짐. 쓰는 값이 이 규칙과 맞물린다.

### 3-2. 쓰기 경로: field-sheet-sync "상태만 갱신" 잡 (기존 category 재사용 — SQL 0)
- 잡: `field_sheet_sync_jobs` 1행, category = 기존 reception_sales · reception_mgmt · reception_remote (CHECK 에 이미 있음 — reception-dept-types.sql 84~87), _dupKey = 잡 id, kakao_status disabled.
- payload.data 키: `_statusOnly=1`, `source`, `sheetRow`, `seq`, `vendor`(시트 원문), `author`(시트 E열), `state`(처리완료 / 보류 / 진행중, 선택), `handler`(선택), `by`(누른 사람).
- 엣지: 새 파일 `supabase/functions/field-sheet-sync/sheet-status.ts` `writeSheetStatus(job)` — `processJob_`(index.ts 255) 앞부분에서 `_statusOnly` 가 1 이면 이것만 탄다(부서·원격 기존 분기 앞, FIELD_SHEET_SYNC_ENABLED·TEST_MODE 검사 뒤). 하는 일:
  1. `SHEET_LAYOUTS[source]` 로 탭(gid)·머리 검증(상태 열 머리가 다르면 실패 — 조용히 틀리지 않게).
  2. 행 확인: 그 행의 순번·상호 열을 읽어 **순번 같음 AND 상호 앞 6자 포함**(state.ts `normVendor`, linkRows 와 같은 규칙). 순번이 비면 상호 + 접수자(영업·경영) / 상호 + 접수일(원격).
  3. 밀렸으면 순번으로 아래→위 검색해 같은 확인을 통과한 행 하나. **못 찾으면 실패, 새 행 금지, 다른 행 쓰기 금지.**
  4. 쓰는 칸: 상태 열(state 있을 때) + 처리자 열(handler 있을 때)만. `safeText` 적용. 다른 칸은 손대지 않는다.
  5. 이미 같은 값이면 쓰지 않고 성공(멱등 — 두 사람이 같이 눌러도 안전).
  6. 잠금(`acquireLock`) 공유 — 사람·앱 기입과 겹치지 않게. 결과 status synced + row, 실패는 기존 `recordFailure`(재시도 크론이 이어 받음).
- 기존 `appendDeptRow`·`appendViaSheetsApi` 는 손대지 않는다.
- reception-sheet-open 머리 주석 "시트는 절대 쓰지 않는다(D6)" → "이 함수는 읽기만. 미처리 단추의 시트 쓰기는 field-sheet-sync statusOnly(2026-10-25)" (주석만).

### 3-3. 즉시 빠지기(낙관적 제거) — 새 모듈 `src/unhandledPending.ts`
- reception-sheet-open 은 60초 캐시, 부서 시트 기입은 실측 37초 → 완료 직후 다시 읽으면 행이 되살아난다.
- `markPending(key, 동작·값·만료)` — sessionStorage + 창 이벤트 `unhandled-pending`. 완료 TTL 5분. 보류·배정은 행을 지우지 않고 status/assignee 를 덮어 보여 준다.
- `applyPending(rows)` 를 `src/kpi/kpiData.ts` `loadUnhandledRows`(73) 반환 직전 1곳에서 적용 → 홈 숫자·팀 탭·종류 칸·부서 미니 업무공간·현황판이 같이 줄어든다(숫자 한 벌 규칙 유지).
- 다음 조회에서 원본이 이미 빠져 있으면 pending 삭제. 잡이 **failed** 면 pending 삭제(행 되살아남) + 빨간 토스트. 재시도 대기면 pending 유지 + 회색 안내 "시트 반영 대기".

### 3-4. UnhandledRow 에 시트 확인 재료 추가
`homeUnhandled.ts` `UnhandledRow` 에 선택 칸 `sheet?: { source, row, seq, author, vendor }` — `mergeUnhandled` 시트 루프(98~107)에서 채운다(SheetOpenRow 에 seq·author 가 이미 있음). 엣지 응답 모양은 그대로. (vendor 는 엣지가 40자로 자르므로 확인은 앞 6자 포함 규칙.)

### 3-5. "복합기 AS" → "CS 접수" (추천: **표시 라벨만**, 값 유지)
- 값 service_receptions.type = 복합기 AS 는 CHECK 제약·엣지(data-ask)·필터 쿼리(CustomerReport 189, entity360)·시트 GID 맵(ServiceReception 262)·과거 행·테스트가 문자열로 묻는다(grep: src 21파일·tests 11파일·supabase 5파일). 값을 바꾸면 SQL(제약 교체 + UPDATE) + 앱 동시 배포가 필요하고, 배포 틈에 접수 저장이 CHECK 로 실패한다(10/19 영업팀 개명 때와 같은 위험).
- 홈 미처리는 이미 kind CS접수(as_tickets 기준)로 바뀌어 있다. 남은 건 **서비스접수 쪽 글자**뿐.
- 바꿀 곳(표시만): `ReceptionTypePicker.tsx` 29 label → CS 접수 · `ReceptionListFilters.tsx` 20 복합기 → CS · `lookupCatalog.ts` 231 칩 글자 · `UnifiedHistory.tsx` 957 칩 글자(값 그대로, label 맵) · `ServiceReception.tsx` 화면 문구(종류 머리·확인창·"복합기 접수 폼" 토스트 등 — 값 비교 줄은 그대로) · `ReceptionBoardPanel.tsx` 81 토스트.
- 공용 함수 1개: `ReceptionTypePicker.tsx` 에 `receptionTypeLabel(type)` export — 목록·배지가 이것만 부른다.
- 안 바꾸는 것: DB 값, 카톡 양식 본문, 시트, 테스트의 값 문자열, 고객용 `CustomerReport.tsx` 87 "AS 방문".

## 4. 화면 흐름

1. 홈 미처리(또는 부서 미니 업무공간·접수 현황판)에서 줄을 누른다 → 상세 팝업.
2. 팝업 아래 단추가 출처에 따라 바뀐다(단추 줄 = 새 공용 `UnhandledActionBar`):
   - 시트 행·앱 부서 행·원격/IT 행: **[완료] [보류] [배정]** (+ 본문에 작은 글자 링크 "시트 n행 ↗" — 확인용, 단추 아님)
   - CS 접수(일정) 행: **[완료]** + 보조 [일정리스트에서 열기]
   - 물류 행: **[완료]** (네이버는 Q2)
3. [완료] —
   - 시트·부서·원격 행: 확인창 1번("○○ 를 처리완료로 바꿉니다. 시트 G열에도 적힙니다") → 즉시 목록에서 빠짐 → 토스트 "시트 반영 중…" → "시트 n행 처리완료 ✓" / 실패면 줄이 되살아나고 빨간 토스트.
   - CS 접수 행: 일정리스트와 **같은 완료 창**(방문/전화 + 처리 내용, Q3) → 즉시 빠짐 → 네이버 결과 토스트.
4. [보류] — 확인 없이 바로. 줄은 남고 상태가 보류(다시 누르면 진행중). 원격·IT 는 Q1.
5. [배정] — AssigneePicker(1명; 부서 명단 / 원격·IT 는 원격 담당 명단) → 처리자 칸 갱신(시트 F·K열 또는 DB handler).
6. 실패·오프라인 — 연결 실패면 "인터넷 연결을 확인해 주세요", 엣지 오류는 문구 그대로. 처리 중 그 줄 단추 잠금(두 번 누름 방지).
7. 서비스접수 › 경영·영업 접수 폼: **[접수 저장] 왼쪽에 [시트 열기 ↗]**(그 부서 시트 탭, `deptSheetUrl`). 머리의 `DeptSheetLink`(ServiceReception 1621)는 뺀다. 운영지원은 시트 없음 → 단추 없음. 복합기·원격 폼은 이미 [접수] 옆에 있음(ServiceReception 1940) — 그대로.

## 5. 동작 규칙 — 단추 → 함수 (새 모듈 `src/unhandledActions.ts` 한 곳)

`runUnhandledAction(row, action, opts)` — action 은 done / hold / assign, 돌려주는 값은 warnings 목록.

| 행 | 완료 | 보류 | 배정 |
|---|---|---|---|
| 시트 행 + receptionId + 부서(영업·경영) | `runDeptAction` done (DB→달력→시트. 시트 잡 따로 안 씀 — 이중 기입 금지) | `runDeptAction` hold | `runDeptAction` assign |
| 시트 행 + receptionId + 원격/IT | `remoteHandling.complete(id)` = `mergeReceptionHandling`(result 처리완료, handler, 상태 완료) + statusOnly 잡 | 같은 식 보류 | handler 만 |
| 시트 행(앱 접수 없음) | statusOnly 잡 state 처리완료 | state 보류(이미 보류면 진행중) | statusOnly 잡 handler |
| 앱 부서 행 r:(영업·경영·운영) | `runDeptAction` done (운영은 DB만) | `runDeptAction` hold | `runDeptAction` assign |
| 앱 원격/IT 행 r: | `remoteHandling.complete` + sheet_row 있으면 statusOnly 잡 | 같은 식 | handler |
| CS 접수 t: | `ticketCompletion.completeTicket(id, 사유, 방문/전화, 누른 사람)` | (범위 밖) | (범위 밖) |
| 물류 t: | 같은 함수, 네이버는 Q2 | — | — |

### 5-1. CS 접수·물류 완료 = 일정리스트와 같은 규칙 (새 모듈 `src/ticketCompletion.ts`)
일정리스트 완료가 하는 일 전부를 DB 기준(화면 상태 없이) 한 함수에:
1. as_tickets 최신 행 읽기(메모 덮어쓰기 방지 — App.tsx finishTicket 4844 와 같은 이유) → status 완료 + note 에 `buildActionBlock` 블록 PATCH. **실패면 throw**(나머지 안 함).
2. 연결 접수: 같은 receptionId 형제 일정 최고 단계로 `setServiceReceptionStatus`(CsAsWorkspace 1031~1040 규칙 → 순수 `receptionStatusFromSiblings`).
3. 접수 시트 BD열 "완료 M/D HH:mm 이름": 연결 접수가 복합기 AS + lease_no 면 `sendReceptionCopierCompleteJob`(1043~1053 → 순수 `copierDoneText`).
4. 네이버: 순수 `naverCompleteAction(ticket)` → IT = 제자리 caldav_check, 그 외 = caldav_move(팀 완료 캘린더), 물류 = Q2. 블록이 있으면 caldav_get → caldav_update(설명 잇기) 먼저, 그다음 이동(2026-09-16 겹침 사고 순서).
5. 매월 반복이면 다음 달 일정 1행(`buildMonthlyCloneRow`, 같은 시리즈 없을 때만).
6. 완료 창의 방문/전화 → visit_logs 1행(같은 날 같은 업체 있으면 건너뜀, 1244~1252 규칙).
7. 처리 내용이 있으면 팀 AS방 카톡(`sendServiceReception`; 물류는 안 보냄 — 1186~1194 규칙).
8. 2~7 실패는 warnings(토스트), 완료는 유지. 끝나면 창 이벤트 `tickets-changed` → 떠 있는 일정리스트(KeepAlive)가 다시 읽는다.
- "웹 일정리스트·웹 캘린더"는 둘 다 as_tickets 를 그리므로 1번으로 같이 완료된다(별도 표 없음).
- **CsAsWorkspace 는 판정 순수 함수 3개를 같은 것으로 부르게 바꾼다**(naverCompleteAction·receptionStatusFromSiblings·copierDoneText) — 규칙이 두 벌로 갈라지지 않게. 낙관적 화면 갱신(setTickets) 구조는 그대로.
- `DoneReasonModal`(CsAsWorkspace 2673~2710)을 `src/DoneReasonModal.tsx` 로 옮겨 export — 홈 팝업이 같은 창을 띄운다(CsAsWorkspace 는 import 만 바뀜).
- App.tsx `finishTicket`(4842~)은 **이번에 손대지 않는다**(진입점 1~3줄 규칙). 세 번째 사본이므로 후속 과제.

## 6. 작업 분해 (서로 파일이 안 겹치게)

| 담당 | 할 일 | 파일(예상 증감) | 테스트 |
|---|---|---|---|
| **db-schema 표다빈** | SQL 없음 확인만: MCP 로 field_sheet_sync_jobs_category_check 에 reception_sales·mgmt·remote 있는지, anon insert 정책, merge_reception_handling RPC 의 status 허용값(원격 보류 가능한지) 조회 → 결과를 이 문서 3-1 아래 한 줄로 | 이 문서만 | — |
| **ui-designer 윤화면** | `UnhandledActionBar` 틀(완료=초록 실선, 보류=회색 외곽, 배정=처리자 알약, 폰 3등분 min-h-11), 팝업 footer 배치, "시트 n행 ↗" 글자 링크 위치, 처리 중·실패 표시, 접수 폼 [시트 열기] 위치 | `src/UnhandledActionBar.view.tsx`(새 ~90), `src/DeptReceptionForm.view.tsx`(254 옆 +6) | `tests/unhandledActionBar.render.test.tsx`(새) |
| **구현서 A (opus)** | 엣지 statusOnly | `supabase/functions/field-sheet-sync/sheet-status.ts`(새 ~110: 순수 `planStatusWrite` + `writeSheetStatus`), `index.ts`(processJob_ +8), `reception-sheet-open/index.ts`(주석 2줄) | `tests/sheetStatusWrite.test.ts`(새 — 순번 일치·밀림 검색·상호 불일치 거절·머리 변경 거절·빈 순번 폴백·같은 값이면 안 씀·빈 값 미기입·= 시작 글자 고정) |
| **구현서 B (sonnet)** | 프런트 시트·원격·부서 분기 + 낙관 제거 | `src/unhandledActions.ts`(새 ~160), `src/sheetStatusApi.ts`(새 ~60, enqueue+invoke 60초), `src/unhandledPending.ts`(새 ~60), `src/remoteHandling.ts`(새 ~50), `src/homeUnhandled.ts`(UnhandledRow.sheet +8), `src/kpi/kpiData.ts`(applyPending +3) | `tests/unhandledActions.test.ts`(5절 표 전 칸, 연결 행 이중 기입 없음), `tests/unhandledPending.test.ts`, `tests/homeUnhandled.test.ts`(sheet 칸) |
| **구현서 C (opus)** | CS·물류 완료 공용화 | `src/ticketCompletion.ts`(새 ~200: completeTicket + 순수 3개), `src/DoneReasonModal.tsx`(새, 이동 ~45), `src/CsAsWorkspace.tsx`(모달 삭제·import, 인라인 판정 3곳 → 순수 함수, 순감 약 -40) | `tests/ticketCompletion.test.ts`(IT 제자리·팀 이동·물류 Q2·형제 최고 단계·BD 문구·반복 생성 조건·visit 중복 건너뜀·1단계 실패면 나머지 안 함) |
| **구현서 D (sonnet)** — A·B·C 뒤 | 화면 연결 + 이름 통일 | `src/HomeUnhandledPanel.tsx`(UnhandledDetail footer → ActionBar, 열기는 보조), `src/DeptWorkspacePanel.tsx`(unhandledActions 시트 링크 → ActionBar, 머리 주석 9행), `src/SheetRowCard.tsx`(링크 → ActionBar), `src/ServiceReception.tsx`(1621 DeptSheetLink 제거 + 표시 문구만), `src/ReceptionTypePicker.tsx`(label + receptionTypeLabel), `src/ReceptionListFilters.tsx`·`src/lookupCatalog.ts`·`src/UnifiedHistory.tsx`·`src/ReceptionBoardPanel.tsx`(글자) | `tests/homeUnhandledDetail.test.tsx`(출처별 단추), `tests/receptionUi.render.test.tsx`(라벨) |
| **qa-checker 검수아** | 빌드·테스트·범위(App.tsx 0줄, 값 비교 줄 불변 grep), 실제 시트 1행으로 완료 → G열 확인 → 되돌리기(FIELD_SHEET_TEST_MODE 켜져 있으면 held 됨 주의) | — | 전체 |
| 마무리(팀장) | docs/manual 홈 미처리 장·서비스접수 장 갱신, AGENTS 작업 기록, eval worklog | docs/manual/user/02-home.md 외 | — |

순서: 표다빈·윤화면·A·B·C 병렬 → D → 검수아. 엣지 배포(field-sheet-sync) 뒤 앱 배포.

## 7. 위험

1. **잘못된 시트 행에 쓰기** — 사람이 시트에서 행을 끼우거나 정렬하면 행 번호가 밀린다. 순번+상호 두 겹 확인, 밀리면 순번 검색, 못 찾으면 실패(쓰지 않음). 원격 A열이 수식이면 표시값이 바뀔 수 있어 상호 확인이 필수.
2. **되살아남·이중 처리** — 60초 캐시 + 37초 기입 사이에 다른 사람이 같은 줄을 또 누름. pending 은 내 브라우저만 가린다. 엣지는 같은 값이면 성공(멱등), 앱 연결 행은 DB 경로만(시트 잡 중복 안 씀).
3. **CS 완료 규칙 세 벌**(CsAsWorkspace·App.tsx finishTicket·새 ticketCompletion) — 판정 순수 함수 3개를 공유해 갈라짐을 줄이지만 App.tsx 사본은 남는다. 후속 과제로 명시.
(덧: 원격 G열 데이터 확인 규칙이 "거부"로 걸려 있으면 보류 쓰기가 실패할 수 있음 — Q1 과 같이 실측.)

## 8. 사용자에게 물을 것 (3개)

- **Q1 원격·IT 보류**: 원격 시트 처리여부 선택지에 보류가 없습니다. (가) 시트에 "보류"를 그대로 적는다(FIELD 는 이미 보류로 읽음, 시트 선택지에 추가 필요할 수 있음) (나) 원격·IT 는 [보류] 단추를 숨긴다. — 제안 (가).
- **Q2 물류 완료 때 네이버**: 지금 규칙(2026-08-26)은 "물류(납품철수교체) 캘린더는 영업부 소관 — 웹에서 완료해도 네이버는 안 건드림"입니다. "다 완료"로 바꾸면 (가) 네이버 그 일정에 제자리 완료 체크(이동 없음) (나) 지금처럼 웹만. — 제안 (가).
- **Q3 홈에서 CS 접수 [완료] 창**: 일정리스트와 같은 창(방문/전화 + 처리 내용 필수 → 팀 AS방 카톡·네이버 기록·방문 집계)을 띄울지, 확인 한 번으로 끝낼지. — 제안 같은 창(생략하면 주간 AS·방문 집계와 처리 기록이 빠짐).

## 9. 하지 않을 것

- service_receptions.type 값 변경·마이그레이션 SQL(라벨만).
- CS 접수(일정) 행의 [보류]·[배정]·[미루기] — 일정리스트에서(2단계).
- App.tsx `finishTicket` 정리(후속).
- 시트에서 사람이 바꾼 값을 앱이 되돌리는 동기화, 시트 행 삭제·새 행 추가.
- IT AS접수 탭(gid 693613284)·기타IT접수 탭 쓰기 — 미처리 판정이 원격 탭 L열 기준이므로 쓰기도 원격 탭만.
- 운영지원 시트 신설, 완료 알림 카톡 추가(CS 완료의 기존 팀 AS방 공유 외 없음).
