# 서비스접수 › 경영·운영·영업 미니 업무공간 + 시트 열기 (설계안, 2026-10-24 기획실 한설계)

> 코드 수정 없음. 줄 번호는 커밋 edab3b2 기준.

## 1. 목표·사용자
- **한 줄 목표**: 타부서(경영지원·운영지원·영업팀)가 FIELD의 다른 탭을 오가지 않아도 되게, 서비스접수 탭의 부서 화면 하나 안에서 **일정리스트 / 접수리스트 / 미처리현황**을 모두 보고 담당자 배정과 완료 처리까지 하게 한다. 경영·영업 화면에는 **시트 열기** 단추를 둔다.
- **쓰는 사람**: 경영지원·운영지원·영업팀 사무 담당자. 주로 PC에서 쓰고 폰(390px)으로도 본다. CS 팀장은 확인만 한다.

## 2. 조사 결과·재사용 지점
| 지금 있는 것 | 위치 | 어떻게 쓰나 |
|---|---|---|
| 부서 접수 양식 | `src/DeptReceptionScreen.tsx`(`DeptReception`), 표시는 `DeptReceptionForm.view.tsx` | 그대로 둔다(왼쪽 기둥) |
| 오른쪽 [접수리스트 \| 미처리 현황] 전환 | `ServiceReception.tsx:2010-2032`, 상태값은 `receptionRightView.ts`(`"list"\|"board"`) | 부서 화면일 때만 3칸으로 늘린다 |
| 부서 화면 목록 필터 | `ServiceReception.tsx:701`. 부서 화면에 들어오면 `setListFilter(PAGE_TYPE[page])` | 지금 목록을 그대로 접수리스트로 쓴다 |
| 처리 단추 5개(완료·내일로·날짜·보류·메모) | `DeptActionBar.tsx`, `deptReceptionFlow.runDeptAction:215` | 일정 카드에 그대로 붙인다 |
| 처리자 = `remote_meta.handler`(1명) | `deptReception.ts:58`, 바꾸는 곳은 `saveDeptHandlingForm:275`(상세 펼침에서만) | 배정 = 이 칸을 바꾸는 것 |
| 배정 시트 | `AssigneePicker.tsx`(names·value·max·onSave) | `max={1}`로 재사용(as_tickets 전용 코드가 없어 그대로 쓸 수 있음) |
| 미처리 합산 | `homeUnhandled.mergeUnhandled:69`·`rowsForTab:123`. 불러오는 순서는 `HomeUnhandledPanel.tsx:40-62` 안에 직접 들어 있음 | 부서 탭 숫자 = 홈과 같은 함수 |
| 예정일 지남 판정 | `deptReception.scheduledOverdue:380`, `deptReceptionFlow.nextWeekday:55` | 묶음 나누기에 쓴다 |
| 부서 달력 | `team_calendar_events`, `DeptCalendarPanel.tsx`·`deptCalendarView.ts` | 접수와 연결 안 된 부서 일정만 읽어서 보여 준다 |
| 열린 접수 | `deptReceptionApi.fetchOpenReceptions:237`(90일, 접수·진행중·보류·원격대기) | 일정·미처리의 원본 |

**이전 요청("경영·운영·영업을 일정리스트와 캘린더에도")은 이미 반영돼 있다.** `CsAsWorkspace.tsx:527-530`(`deptCal`·`listDept`), `:1716-1717`(캘린더 탭 부서 달력), `:1853`·`:1873`(일정리스트 팀 칩에 경영·운영·영업), `:1922-1924`(일정리스트 부서 칩 → `DeptCalendarPanel mode="list"`)에 있다. 다만 이 화면은 **달 단위 날짜 목록**만 보여 주고, 배정·완료 단추가 없으며, 일정이 없는(예정일 없는) 접수는 보이지 않는다. 미니 일정리스트는 처리하는 화면이고, 기존 화면은 달력으로 보는 화면이다. 그래서 둘을 합치지 않고 **기존 칩은 그대로 두며, 부서 칩 머리에 "배정·완료는 서비스접수 › 부서 › 일정리스트" 안내 한 줄만 추가**하는 것을 제안한다(열린 질문 Q4).

**시트 URL 출처**: 문서 ID는 `receptionSheetOpen.ts:56`의 `RECEPTION_SPREADSHEET_ID`, 탭 gid는 같은 파일 `:57`의 `SHEET_GID`(영업 174566767·경영 899183889, 엣지 `reception-sheet-open/state.ts:9-10`와 같음)에 있다. `ServiceReception.tsx:259-260`에도 같은 문서 주소가 따로 적혀 있다(복합기·원격용). **운영지원은 시트가 없다**(`docs/tasks/reception-dept-types.md:138`, `DEPT_SHEET_CATEGORY`) → 운영 화면에서는 단추를 숨긴다. 접수 시트 문서는 링크만 있으면 누구나 볼 수 있게 공개돼 있다(AGENTS 2026-10-23 C3). 링크 주소는 이미 코드에 있으므로 새로 생기는 위험은 없다.

## 3. 데이터 설계: SQL 0
- 새 표·새 칸을 만들지 않는다. 배정은 `service_receptions.remote_meta.handler`를 바꾸고, 바뀐 처리자는 기존 `pushSheetUpdate`로 시트에 반영한다.
- **일정 묶음**(새 순수 함수 `deptPlanBuckets(rows, calEvents, today)`): 대상은 그 부서의 열린 DB 접수 + `team_calendar_events` 중 `reception_id`가 비어 있는 부서 일정이다.
  - 금일 = 예정일이 오늘 · 익일 = 예정일이 `nextWeekday(today)` · 예정 = 그보다 뒤 · **미처리 = 예정일이 지났거나 비어 있는 열린 접수**(접수일 오래된 순).
  - 접수와 연결 안 된 부서 일정은 날짜 묶음에만 넣고 읽기 전용으로 둔다(제목 앞 ✅ = 완료). 누르면 기존 부서 달력 편집 창이 열린다.
- **미처리현황 숫자** = `mergeUnhandled(...)` → `rowsForTab(rows, "경영"|"운영"|"영업")`. 불러오는 순서는 `HomeUnhandledPanel` 안의 코드를 새 `src/unhandledLoad.ts`(`loadUnhandledRows()`)로 꺼내 홈과 부서 화면이 함께 쓴다. 그래야 숫자가 하나로 맞는다.
- 시트 스위치(`RECEPTION_SHEET_OPEN_ENABLED`)가 켜져 있으면 영업·경영 미처리에 **시트 행**(DB id 없음)이 섞인다. 시트 행은 FIELD에서 배정하거나 완료할 수 없으므로 일정리스트에는 넣지 않는다. 미처리현황에서 `SheetRowCard` [시트에서 열기]로만 보낸다. 화면에는 "시트 건 n은 시트에서 처리"라고 표시한다.

## 4. 화면 흐름 (부서 화면일 때만, 현장 3종은 바뀌지 않음)
1. 서비스접수 → 종류 선택기에서 경영·운영·영업 중 하나를 고른다(지금과 같음). 머리 오른쪽에 **[시트 열기 ↗]**(경영·영업만)가 생긴다.
2. 오른쪽 전환 막대가 **[일정리스트 n | 접수리스트 | 미처리현황 n]** 3칸이 된다. 부서 화면에 처음 들어오면 기본은 일정리스트다. 기억 키는 새로 만든다(`reception_right_dept_v1`).
3. 일정리스트: 묶음 칩 **[금일 n][익일 n][예정 n][미처리 n]**, 처음 고른 칩 = 미처리가 있으면 미처리, 없으면 금일. 카드 한 장에는 업체 · 분야 · 내용 1줄 · 예정일 · 처리자 알약이 들어간다.
4. 처리자 알약(비어 있으면 "미배정"·빨강)을 누르면 `AssigneePicker`(max 1)가 뜬다. 후보는 부서 기본 처리자 + 명단이다. 저장하면 카드가 먼저 바뀌고, 실패하면 원래대로 돌아간다.
5. 카드 아래에 `DeptActionBar compact`를 붙인다. [완료]는 카드를 묶음에서 뺀다. [내일로]·[날짜]는 카드를 맞는 묶음으로 옮긴다.
6. 접수리스트 = 지금 목록 그대로(부서 필터가 이미 걸려 있음). 미처리현황 = 그 부서의 `mergeUnhandled` 행 목록이다. DB 행에는 단추 줄을, 시트 행에는 [시트에서 열기]를 붙이고, 머리에 "홈 미처리와 같은 숫자"라고 적는다.
7. 폰 390px: 2xl 미만에서는 양식이 위, 전환 막대가 아래다(지금 배치). 묶음 칩 4개는 한 줄에 들어가고, 단추 줄은 줄바꿈된다. 시트 열기 단추는 아이콘과 "시트"만 표시한다.

## 5. 작업 분해 (같은 파일을 두 사람이 고치지 않게)
| 담당 | 할 일 | 파일 |
|---|---|---|
| 데이터실 표다빈 | **없음**(SQL 0). 구현 뒤 MCP로 `remote_meta.handler` 실제 값의 분포만 읽기 전용으로 조회 | — |
| 디자인실 윤화면 | 일정 카드·묶음 칩·처리자 알약 표시 틀(props만, 데이터 호출 없음) | 새 `src/DeptPlanList.view.tsx` |
| 개발실 구현서 A | 순수 로직: `deptPlanBuckets`, `deptSheetUrl(dept)`(운영 = null, `SHEET_GID` 재사용), `runDeptAction`에 `kind:"assign"` 추가(freshRow 위에서 handler만 바꾸고 시트 갱신) + 테스트 | 새 `src/deptPlan.ts`, `receptionSheetOpen.ts`(export 1개), `deptReceptionFlow.ts`(assign 분기), 새 `tests/deptPlan.test.ts` |
| 개발실 구현서 B | 불러오기 공용화(`unhandledLoad.ts`) + 홈 패널이 이것을 부르도록(동작 무변경) + 데이터를 묶는 `DeptWorkspacePanel.tsx`(일정·미처리 탭 본체, 60초·숨은 탭 정지는 `useScreenActive` 관행대로) | 새 `src/unhandledLoad.ts`, 새 `src/DeptWorkspacePanel.tsx`, `HomeUnhandledPanel.tsx`(불러오기 부분만) |
| 개발실 구현서 C (A·B 끝난 뒤) | 연결만: 부서 화면에서 전환 막대 3칸·시트 열기 단추·새 패널 끼우기 | `ServiceReception.tsx`(2010-2032 부근 + 머리 단추, 20줄 이내), `receptionRightView.ts`("plan" 추가) |
| 품질실 검수아 | build·test, 홈 "경영/운영/영업" 탭 숫자 = 미처리현황 숫자(스위치 켬·끔 둘 다), 현장 3종 화면 무변경, 배정이 시트 처리자 칸에 반영되는지, 390px 화면 | — |
| 마무리 | `docs/manual/user/06-service-reception.md` 새 절, `07-schedule-calendar.md` 안내 한 줄 | — |

**건드리지 말 것**: `DeptReceptionScreen.tsx`·`DeptReceptionForm.view.tsx`(양식), `ReceptionBoard*.tsx`·`receptionBoardData.ts`(전체 현황판), `CsAsWorkspace.tsx`·`DeptCalendarPanel.tsx`(Q4 답 전까지), `homeUnhandled.ts`의 함수 내용, 엣지 함수, `App.tsx`(0줄).

## 6. 위험·열린 질문 (사용자에게 한 번에)
- **Q1** 미처리 = "예정일 지남 + 예정일 없음"으로 할까요? (제안: 예. 예정일 없는 접수가 사라지지 않게)
- **Q2** 처리자는 1명으로 둘까요? 시트 처리자 칸이 1칸이라서입니다. (제안: 1명)
- **Q3** 배정 후보 명단: 경영·운영·영업 직원이 CS 명단(`useMembers`)에 없을 수 있습니다. 부서별 이름 목록을 관리 탭 설정(`DEPT_MEMBERS_경영` 등)으로 둘까요, 고정값으로 둘까요? (제안: 설정 키. SQL 0, app_config에 넣음)
- **Q4** 일정리스트 탭의 부서 칩은 남기고 안내 한 줄만 추가할까요? 아니면 칩을 빼고 미니로 옮길까요? (제안: 남김. 캘린더는 달 보기용)
- **Q5** 시트 스위치를 켜면 영업·경영 미처리 숫자(시트 기준 124·178)가 일정리스트 미처리(DB 기준)보다 훨씬 큽니다. "시트 건은 시트에서 처리" 안내만으로 괜찮을까요?
- **Q6** 배정하면 카톡이나 푸시로 알릴까요? (제안: 1단계에서는 알리지 않음)
- 위험: 같은 접수를 두 사람이 동시에 배정할 수 있다. `freshRow`를 다시 읽어서 마지막에 저장한 쪽이 이기고, 메모·이력은 지워지지 않는다. 네트워크가 끊기면 카드를 원래대로 돌리고 빨간 토스트를 띄운다(`DeptActionBar` 관행).

## 7. 하지 않을 것
부서 접수를 as_tickets·네이버 캘린더로 보내기, 운영지원 시트 새로 만들기, 시트 행을 FIELD에서 직접 완료하기(시트 쓰기), 처리자 여러 명, 부서별 권한(로그인 부서로 화면 잠그기), 현장 3종 화면 개편.

## 팀장 결정 (2026-10-24, 설계안 질문 답)
- Q1 예정일 없는 열린 접수도 미처리에 포함. Q2 처리자 1명. Q3 부서 직원 = cs_members dept 기준(없으면 자유 입력). **Q4 일정리스트 부서 칩 유지 + 머리 안내 한 줄(CsAsWorkspace.tsx +1줄 허용)**. Q5 안내 문구로 충분. Q6 알림 1차 없음.
- unhandledLoad.ts 는 만들지 않음 — 홈 미처리 원본이 이미 kpiData.loadUnhandledRows → homeUnhandled.mergeUnhandled 하나로 바뀌어(같은 날 홈 작업, 팀장 허용) 부서 미처리현황도 그 함수를 호출. receptionBoardData.ts·homeUnhandled.ts 변경은 그 홈 작업의 것.
