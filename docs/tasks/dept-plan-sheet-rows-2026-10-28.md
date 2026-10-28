# 부서 [일정리스트]·[달력]에 시트 접수 줄 보이기 (2026-10-28 밤, 기획실 한설계)

> 조사·설계만. 코드 0 · SQL 0. 실측: 2026-10-28 밤 reception_sheet_rows·service_receptions·team_calendar_events anon REST GET, 코드 기준 커밋 784449c.

## 0. 사용자 요청
"서비스접수 탭의 경영·운영·영업 [일정리스트]와 [달력]에 시트 건이 안 들어간다. 동기화가 안 된다."

## 1. 한 줄 목표와 쓰는 사람
- 경영·영업 부서 화면의 [일정리스트]와 [달력]이 앱 접수·부서 일정 + **시트에만 적힌 접수(2026-10-01 이후, 앱과 이어지지 않은 행)**를 "시트" 표시를 달고 같이 보여 준다. 읽기만 하고 DB에 쓰지 않는다.
- 쓰는 사람: 경영지원·영업팀 담당자, CS 부파트장. PC 위주(접수 화면 오른쪽 기둥), 폰은 보기·단추만.
- **운영지원은 바뀌지 않는다** — 운영 접수 시트가 없다(reception-list-sheet-rows 11절 Q1). 운영 화면은 지금 그대로.

## 2. 실측

### 2-1. 지금 무엇으로 나누나
| 곳 | 원본 | 날짜 기준 | 파일:함수 |
|---|---|---|---|
| 일정리스트 [금일/익일/예정] | fetchOpenReceptions(90) 중 이 부서 + team_calendar_events 중 reception_id 없는 부서 일정(오늘~90일) | 접수 = **remote_meta.schedule_date(예정일)**, 일정 = 캘린더 date. 금일 = 오늘, 익일 = 오늘 뒤~다음 영업일, 예정 = 그 뒤. **지난 날짜·예정일 없음은 어느 묶음에도 안 넣음**(10-25 사용자 "미처리현황과 중복 빼라") | src/deptPlan.ts deptPlanBuckets |
| 달력 | **team_calendar_events 만**(접수 표를 안 읽음). 앱 접수는 deptReceptionApi.upsertDeptCalendar 가 예정일로 이 표에 1건씩 올려서 보인다 | 캘린더 date | src/DeptCalendarPanel.tsx load(자기 조회). 쓰는 곳은 DeptWorkspacePanel 하나뿐 |
| 미처리 현황(같은 화면 다른 탭) | ReceptionBoardPanel → loadSheetOpen(엣지 미처리 모드) | 시트 열린 행 90일 | **시트 열린 줄은 이미 여기 나온다** |

→ 시트 줄은 일정리스트·달력 어디에도 들어갈 길이 없다(버그가 아니라 원본이 없음). 10-28 에는 접수리스트에만 시트 줄을 붙였다.

### 2-2. 영업·경영 시트에 예정일 칸이 있나 — **없다**
- supabase/functions/field-sheet-sync/dept-sheet-spec.ts 열 목록(영업 33열·경영 57열)에서 날짜 칸은 접수일(B)·년월(C)·접수시간(D)·계약일·종료일·교체일뿐이다. "방문주기"(경영 48열)는 주기를 적는 글자 칸이라 날짜가 아니다. 예정일·방문일·처리일 칸은 없다.
- 그래서 **시트 줄의 날짜는 접수일 하나뿐**이다.
- 앱 부서 접수도 예정일 기본값이 접수일이다(10월 부서 접수 17건 중 schedule_date = receipt_date 14건, 다른 날 1건(영업 10-27 → 10-29), 빈칸 2건). 시트 줄을 "예정일 = 접수일인 접수"로 보면 앱 규칙과 같다.

### 2-3. 숫자(2026-10-28 밤, reception_sheet_rows 보관 표 = 매시 17분 스냅샷, gone_at 없음, 10월)
| | 10월 시트 행 | 이어진 행 | 열린(open/hold) 안 이어진 행 | 그중 **오늘(10-28)** | 그중 지난 날짜 | 처리자 빈칸 |
|---|---|---|---|---|---|---|
| 영업(sales) | 320(완료 277·열림 43) | 3 | **41** | **8** | 33 | 5 |
| 경영(mgmt) | 98(완료 28·열림 70) | 3 | **68** | **2** | 66 | **68(전부)** |
- 앱 쪽 비교: 10월 team_calendar_events 부서 일정은 **6건**뿐(전부 reception_id 있음, 10-26·10-28). 일정리스트·달력에 지금 보이는 것은 하루 몇 건인데, 시트에는 하루 영업 약 15~26행·경영 약 1~10행이 있다. 사용자가 "안 들어간다"고 느끼는 차이가 이것이다.
- ~~덤 발견: 10-27 부서 접수 7건에 캘린더 일정 없음~~ → 오류진 실측(2026-10-28 밤): 7건 모두 deleted=true 인 테스트 접수(무암, 테스트방 발송)이고 삭제 때 설계대로 일정도 같이 지워진 것. 버그 아님. deleted=false 접수는 예정일 있는 6건 전부 일정 1건씩 있음. **대조할 때 deleted=false 조건 필수.**

## 3. 추천안 — 가상 표시(쓰기 0, team_calendar_events 에 넣지 않음)
- **team_calendar_events 에 넣지 않는다.** 넣으면 ① 접수 연결 일정은 날짜 변경·삭제가 접수 예정일로 번지는 연쇄(deptReceptionFlow.saveDeptCalEdit/deleteDeptCalEdit)에 걸리는데, 시트 행에는 접수 id 가 없어 고아 일정이 된다 ② 시트에서 완료·삭제돼도 일정이 남아 별도 동기화가 필요하다 ③ 하루 수십 행이 부서 달력 원본에 쌓여 다른 화면과 숫자가 엉킨다. 접수리스트 때와 같은 이유로 A(가상 표시)가 맞다.
- 원본은 이미 있는 **엣지 reception-sheet-open 목록 모드 + 보관 표**(src/receptionSheetOpen.ts fetchSheetListRows)다. 이번 달 = 엣지(60초 캐시 공유라 Sheets API 호출이 늘지 않음), 지난달 = reception_sheet_rows. 앱과 이어진 행은 엣지·보관 표 둘 다 이미 뺀다.
- 목록 모드에 **출처 거르기 sources(선택)** 하나만 더한다. 부서 화면이 4개 탭 전부(월 약 2,000행·약 560KB)를 받지 않게 하려는 것이다. 없으면 지금처럼 전부 돌려준다(접수리스트 무변경). 옛 엣지가 이 값을 무시해도 프런트가 한 번 더 거른다.

### 3-1. 날짜 규칙
| 곳 | 넣는 시트 줄 | 날짜 | 묶음 |
|---|---|---|---|
| 일정리스트 | 이 부서 출처(영업팀 = sales, 경영지원 = mgmt)의 **열린(open/hold)** 줄 | 접수일 | 접수일 = 오늘 → **금일**. 지난 날짜는 넣지 않음(미처리 현황에 이미 있음 — 10-25 결정 "같은 행 두 곳에 두지 않는다" 유지, Q1). 미래 접수일(오타)도 넣지 않음 |
| 달력 | 이 부서 출처의 **열린 + 완료** 줄(Q2) | 접수일 | 그 날 칸. 완료는 회색 취소선(완료된 부서 일정과 같은 모양) |
- 2026-10-01 이전 칸에는 시트 줄이 없다(SHEET_LIST_START).
- "일정리스트 n" 탭 숫자(planTodoCount = 금일 안 끝난 것)에 오늘 열린 시트 줄을 **포함**한다(오늘 기준 영업 +8·경영 +2). 미처리 현황 숫자는 그대로다. 오늘 열린 시트 줄은 일정리스트 금일과 미처리 현황 두 곳에 다 보이는데, 앱 접수도 예정일이 오늘인 열린 접수는 두 곳에 다 보이므로 규칙이 같다.

### 3-2. 중복
1. 엣지 잇기(sales·mgmt = 잡 sheet_row + 접수자)로 이어진 행은 이미 빠진다(앱 줄이 대신 보임).
2. **빈틈**: 앱 저장 직후 시트 잡은 써졌는데 잇기가 아직 안 된 1~2분 동안, 또는 잇기 실패 때 같은 접수가 앱 줄 + 시트 줄로 둘 다 보일 수 있다. 프런트 보조 막이를 둔다 — 같은 부서·같은 접수일·상호 앞 6자(normVendor)가 같은 앱 접수가 있으면 시트 줄을 숨긴다. 이번엔 부서 화면에만 넣는다(순수 함수).
3. 달력도 같은 규칙으로, 같은 날 같은 업체의 앱 일정 칩이 있으면 시트 칩을 숨긴다.

### 3-3. 처리 단추
- 일정리스트 시트 카드는 기존 **UnhandledActionBar(statusOnly — 시트 상태·처리자 칸만)** [완료][보류][배정]를 그대로 쓴다. SheetListDetail.tsx 의 urow 만드는 식을 순수 함수(sheetListRowState.ts sheetListUnhandledRow)로 빼서 접수리스트·부서 화면이 같이 쓴다. 순번이 빈 줄은 단추를 숨긴다(sheetListCanAct).
- 처리자 알약은 시트 처리자 칸 값을 보여 준다. 누르면 UnhandledActionBar 의 [배정]과 같은 길로 간다(새 길을 만들지 않음). 앱 접수용 AssigneePicker → runDeptAction 은 시트 줄에 쓰지 않는다.
- 보낸 뒤에는 카드에 "보냈습니다 — 1~2분 뒤 반영"(SheetListDetail after 문구와 같음)을 띄우고 카드를 흐리게 남긴다. 다음 읽기(60초)에서 시트가 완료면 금일에서 빠진다.
- 달력 시트 칩을 누르면 FormModal 안에 SheetListDetail(상세·[시트에서 열기]·열린 줄이면 단추)을 연다. 날짜 수정·삭제 칸은 없다(시트 줄은 접수일이 날짜라 바꿀 수 없음 — 안내 한 줄).

## 4. 화면 흐름
1. 영업팀(또는 경영지원) 화면 › [일정리스트] — 지금처럼 앱 접수·부서 일정을 읽고, 따로 시트 줄(오늘 하루, 이 부서 출처)을 읽는다. 시트가 늦거나 실패해도 앱 줄이 먼저 보이고, 실패는 맨 위 회색 한 줄 "시트 접수를 못 읽음 — 앱 접수만 표시"(빨간 오류 줄과 구분). 스위치 RECEPTION_SHEET_OPEN_ENABLED 가 꺼져 있으면 부르지 않는다(지금 그대로).
2. [금일] 묶음: 앱 접수·부서 일정 다음에 시트 줄을 접수시간 순으로 놓는다. 시트 카드 = 업체명 + **"시트" 칩(회색 테두리, 접수리스트와 같은 모양)** + 분야 / 둘째 줄 내용 40자 / 셋째 줄 "접수 10/28(화) 09:12 · 접수자 김OO" / 오른쪽 처리자 알약(빈칸이면 Q3) / 아래 [완료][보류][배정] 단추 줄. 카드 본문을 누르면 펼침 상세(SheetListDetail).
3. [익일]·[예정]에는 시트 줄이 없다(시트에 예정일 칸이 없음). 묶음 아래 회색 한 줄 "시트 접수는 예정일 칸이 없어 접수일(금일)로만 들어옵니다. 지난 시트 접수는 [미처리 현황]."
4. [달력] — 격자 범위(42칸)의 이 부서 시트 줄을 읽는다. 칸 점은 **속 빈 점(테두리만) = 시트**, 꽉 찬 점 = 앱 일정. 머리 "이달 n건" 옆에 "(시트 m)". 고른 날 목록에는 앱 일정 아래에 시트 칩(회색 테두리 + "시트" 글자, 완료는 취소선).
5. 시트 칩을 누르면 상세 창(SheetListDetail): 열 전부·[시트에서 열기]·열린 줄이면 [완료][보류][배정]. 안내 "시트에서 적은 접수라 날짜를 바꾸거나 지울 수 없습니다 — 시트에서 고치세요."
6. 운영지원 화면: 변화 없음.

## 5. 작업 분해(파일 단위, 겹치지 않게)

| 역할 | 할 일 | 건드릴 파일 |
|---|---|---|
| ui-designer(윤화면) | 금일 시트 카드·속 빈 점·달력 시트 칩·회색 실패 줄·익일/예정 안내 문구 목업(캔버스 아트보드, PC 오른쪽 기둥 폭·폰 390px). 코드 0 | 목업만 |
| db-schema(표다빈) | **할 일 없음**(SQL 0). 보관 표 anon select 에 source 거르기를 더해도 기존 인덱스로 충분한지 확인만 | 없음 |
| 구현 A(엣지, sonnet) | 목록 모드 list.sources(선택, SheetListSource 배열) — getParsed 뒤에 거르고, errors 도 그 출처 것만. 알 수 없는 값은 무시. (선택) SHEET_LAYOUTS sales·mgmt 에 timeCol 4(D 접수시간) — 정렬·표시용, 미처리 숫자 영향 없음 | supabase/functions/reception-sheet-open/index.ts, state.ts |
| 구현 B(프런트 순수) | receptionSheetOpen.ts fetchSheetListRows 에 선택 인자 sources(엣지 본문 + 보관 표 source=in.(…) + 결과 한 번 더 거르기). 새 src/deptPlanSheet.ts: deptSheetSource(dept)(영업팀→sales·경영지원→mgmt·운영지원→null), hideLinkedLike(sheet, appRows)(3-2 보조 막이), sheetPlanItems(rows, today)(열린·오늘만). deptPlan.ts: PlanItem 에 kind "sheet"(key·date·sheet: SheetListRow) 추가, deptPlanBuckets 에 선택 인자 sheet(기존 호출 무변경), planTodoCount 에 시트 열린 줄 포함. sheetListRowState.ts 에 sheetListUnhandledRow(row, handler) 추출 | src/receptionSheetOpen.ts, (새) src/deptPlanSheet.ts, src/deptPlan.ts, src/sheetListRowState.ts |
| 구현 C(화면) | DeptWorkspacePanel: 시트 줄 상태 2개(금일용 today~today, 달력용 격자 범위 — view 가 cal 일 때만 읽음), 같은 60초 폴링·숨은 화면 쉼, 운영지원은 부르지 않음, 회색 안내 줄. DeptPlanList.view: kind "sheet" 카드(UnhandledActionBar·펼침 SheetListDetail), 익일·예정 안내 한 줄. DeptCalendarPanel: 선택 prop sheetRows(달력 자체 조회는 그대로), 속 빈 점·시트 칩·상세 FormModal. SheetListDetail: urow 식을 sheetListUnhandledRow 로 교체(동작 무변경) | src/DeptWorkspacePanel.tsx, src/DeptPlanList.view.tsx, src/DeptCalendarPanel.tsx, src/SheetListDetail.tsx |
| qa-checker(검수아) | 6절 표본·빌드·테스트, 회귀(운영지원 화면·접수리스트 시트 줄·미처리 현황 숫자 불변), 엣지 배포 뒤 sources 실호출 | (새) tests/deptPlanSheet.test.ts, 기존 deptPlan 테스트에 추가 |
| 문서 | docs/manual/user/06-service-reception.md 부서 일정리스트·달력 절에 "시트 줄" 한 단락, AGENTS.md 작업 기록, eval worklog | 매뉴얼·기록 |

- App.tsx 0줄. ServiceReception.tsx 0줄(DeptWorkspacePanel 호출부 그대로).
- 순서: A·B 병렬 → C → QA. 엣지가 옛 버전이어도 B 의 프런트 거르기로 동작한다(응답만 큼). 엣지 배포가 늦어도 화면을 먼저 내도 된다.

## 6. 테스트 표본
- deptSheetSource: 영업팀→sales, 경영지원→mgmt, 운영지원→null(시트 읽기 안 함).
- sheetPlanItems(today 2026-10-28): open 10-28 → 금일, hold 10-28 → 금일(보류 칩), done 10-28 → 빠짐, open 10-27 → 빠짐(미처리 현황 몫), open 10-30(오타 미래) → 빠짐, 2026-09-30 → 빠짐.
- deptPlanBuckets(시트 인자 없음) 결과가 지금과 1:1(회귀). 시트 인자 있음: 금일 = 앱·일정 뒤 시트(접수시간 순), 시트 key 가 앱(r:)·일정(e:) key 와 충돌 없음.
- planTodoCount: 금일 앱 1 + 시트 열린 2 → 3.
- hideLinkedLike: 같은 날·상호 앞 6자 같음 → 시트 숨김, 날짜 다름 → 둘 다 보임, 다른 부서 앱 접수 → 영향 없음.
- 달력: 10월 격자에서 영업 시트 줄(이어진 3 제외 약 317, 완료 포함)이 날짜별로 묶임, 9/28~9/30 칸 0.
- fetchSheetListRows(sources sales): 엣지가 sources 를 무시한 옛 응답(mgmt·remote 섞임)이어도 결과는 sales 만. 보관 표 쿼리 문자열에 source=in.(sales).
- 엣지: sources 없음 = 지금 응답과 같음(접수리스트 회귀), sources mgmt = mgmt 만·errors 도 mgmt 것만, 알 수 없는 값 무시.
- 실측(배포 뒤): 영업 금일 시트 줄 수 = 그날 시트 영업 열린·안 이어진 행 수, 경영도 같음.

## 7. 위험
- R1 **경영 시트 처리자 칸이 10월 68행 전부 빈칸** — 금일 경영 시트 카드가 모두 "미배정"(빨강)으로 보일 수 있다. 경영이 처리자 칸을 안 쓰는 관행이면 빨강이 소음이 된다(Q3).
- R2 이중 표시: 3-2 막이로 줄이지만, 같은 날 같은 업체 별건 2개(앱 1·시트 1)면 시트 쪽이 숨는다. 드물고, 접수리스트에는 둘 다 보인다.
- R3 반영 지연: statusOnly 는 잡이라 1~2분 + 엣지 캐시 60초. 보낸 카드는 흐리게 두고, UnhandledActionBar 가 진행 중 두 번 누르기를 이미 막는다.
- R4 달력 범위가 이번 달 이전이면 보관 표(매시 17분)라 최대 1시간 늦다. 지난달은 바뀔 일이 드물어 허용.
- R5 응답 크기: 엣지 sources 배포 전에는 달력 한 번에 월 전체 약 560KB(gzip 약 100KB). 엣지 A 를 먼저 배포하면 영업 약 90KB·경영 약 30KB.
- R6 (해소) 10-27 부서 일정 누락은 삭제된 테스트 접수였음 — 앱 접수 일정 생성은 정상(오류진 2026-10-28).

## 8. 사용자 질문(최대 3)
- **Q1** 지난 날짜의 열린 시트 접수(오늘 기준 영업 33·경영 66)는 [미처리 현황]에 이미 나옵니다. 일정리스트에는 **오늘 접수된 시트 줄만** 넣을까요(기본안, 10-25 "같은 걸 두 곳에 두지 말자"와 같음), 아니면 [금일] 아래 접힌 "밀린 시트 n"으로도 보일까요?
- **Q2** 달력에 **완료된 시트 접수도** 회색 취소선으로 보일까요(기본안 — 영업은 하루 15~26개 점), 아니면 열린 것만 보일까요?
- **Q3** 경영지원 시트는 10월 처리자 칸이 전부 비어 있습니다. 경영 시트 줄 처리자 알약을 빨간 "미배정"으로 보일까요(배정 유도), 회색 "처리자 없음"으로 조용히 둘까요?

## 9. 하지 않을 것
- team_calendar_events·service_receptions 에 시트 행 넣기. 시트에 예정일 칸 만들기·쓰기.
- 시트 줄 날짜 바꾸기·지우기(시트에서 한다). 상태·처리자 외 칸 편집.
- 운영지원(시트 없음), 원격·IT·CS(copier) 시트 줄을 부서 화면에 넣기.
- 미처리 현황·홈·현황판 숫자 규칙 변경. 캘린더 탭(네이버·as_tickets) 변경.
- ~~10-27 부서 일정 누락 원인 조사~~ 끝(버그 아님).
