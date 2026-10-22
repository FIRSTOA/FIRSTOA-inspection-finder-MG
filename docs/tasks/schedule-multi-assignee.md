# 일정 담당자 여러 명 배정 (설계안)

작성: 기획실 한설계 (feature-planner) · 2026-10-22 · 조사만, 코드 0줄
요청 원문: "일정 배정 시 2명 이상도 되게. 여러 명인 경우에도 1명한테만 줘야 하니까 불편하네. 2명 선택하면 두 명에게 일정이 들어가게."

## 1. 한 줄 목표와 쓰는 사람
- 목표: 일정(as_tickets) 1건에 담당자를 2명 이상 걸고, 걸린 사람 모두의 "내 일정"·중간보고·푸시에 그 일정이 들어가게 한다.
- 쓰는 사람: 배정은 팀장·부파트장(PC 일정리스트 / 폰 내 일정 지도), 받는 쪽은 현장 기사(폰, 내 일정·푸시).

## 2. 현재 구조 (조사 결과)
- 원본은 `as_tickets.assignee text not null default ''` 한 칸, 사람 1명 이름(supabase/as-tickets.sql). 배열·연결표 없음.
- 배정 경로는 두 곳뿐이고 둘 다 같은 함수로 모인다: 일정리스트 [배정] 팝업 `CsAsWorkspace.tsx:applyAssign`(약 1012행, 이름 하나 누르면 즉시 저장·닫힘), 내 일정 지도 행 메뉴 `MyPlan.tsx` 칩 → `onAssign(t, name)` → 같은 `applyAssign`(1937행).
- 생성 경로는 모두 1명 고정: 워킨맵 `WalkingMap.tsx:2135`(본인), 자동일정 `AutoSchedule.tsx:298,308`, 재계약 `recontractSchedule.ts:assigneeForRecontract`, 직접 추가 `CsAsWorkspace.tsx:1058`, 서비스접수→일정 `ServiceReception.tsx:1231`(빈 칸), 네이버 수입 `naver-calendar-sync:364`(빈 칸).
- 부서 일정(DeptCalendarPanel, team_calendar_events)은 as_tickets 와 별개 표이고 담당자 칸이 없다. 이번 범위 밖.
- 담당자를 "같다(===)"로 비교하는 곳이 여러 군데라, 쉼표 문자열을 그냥 넣으면 일정이 사라지는 곳이 생긴다(아래 표).

### assignee 를 읽는 곳 전수 (grep 결과)
| 위치 | 하는 일 | 지금 비교 | 여러 명일 때 그대로 두면 |
|---|---|---|---|
| CsAsWorkspace.tsx `update()` 930행 | 배정 바뀌면 네이버 제목 `이름-제목` 갱신 | 문자열 다름 | 동작함(제목 머리가 목록 문자열) |
| CsAsWorkspace.tsx `update()` 934~941행 | 새 배정자에게 웹푸시 `targets:[assignee]` | 문자열 | **"김A,이B" 라는 이름은 없어 아무도 못 받음** |
| CsAsWorkspace.tsx `update()` 988행 | 접수 완료 처리자(done.by)·시트 BD열 | 표시 | 이름 목록이 그대로 들어감(허용 가능) |
| CsAsWorkspace.tsx `buildMidReport` 1259~1313행 + `reportAssignee.ts:matchReportAssignee` | 중간보고·익일스케줄 `#이름` 묶음 | `order.includes(이름)`, `=== name` | **명단에 없는 문자열이 되어 금일에도 미배정에도 안 들어가 보고에서 사라짐 (가장 큰 회귀)** |
| CsAsWorkspace.tsx 1350~1364행 (두 번째 보고 생성기) | 같음 | 같음 | 같음 |
| CsAsWorkspace.tsx `statusOf` 1555행 | 미배정/배정 요약 바 | 빈 칸 여부 | 동작함 |
| CsAsWorkspace.tsx 1565, 1959, 1963, 2040행 | 일정리스트 사람별 묶음·정렬 | 문자열 키 | "김A,이B" 별도 묶음이 생김(사라지진 않음) |
| CsAsWorkspace.tsx `displayTitleOf` 282행 | 목록·캘린더·네이버 제목 머리 | 표시 | "김A,이B-제목" |
| CsAsWorkspace.tsx `historyQueryOf` 452행 | 제목에서 이름 떼고 업체 이력 검색 | startsWith | 이름 못 뗌, 다음 단계(MEMBER_NAMES 첫 낱말)로 폴백, 영향 작음 |
| CsAsWorkspace.tsx 1999, 2212, 2372~2375행 | 카드 알약·배정 팝업 | 표시·=== | 팝업에서 현재 배정이 강조 안 됨 |
| MyPlan.tsx 70, 214행 | **내 일정 필터** `t.assignee === author`, 팀별 건수 | === | **두 번째 사람 내 일정에 안 들어감 (요청 핵심)** |
| MyPlan.tsx 221~224, 299, 372, 384, 406, 440, 476, 682, 700~720, 772행 | 팀 보기: 사람 칩·색·묶음·번호·동선 선 | 문자열 키 | "김A,이B" 가 가짜 사람 1명으로 보임 |
| MyPlan.tsx 501~508, 786~787행 | 행 메뉴 배정 칩 | === | 단일 선택만 됨 |
| AutoSchedule.tsx 85행 | "내 것만" 서버 필터 `assignee=eq.본인` | eq | 여러 명 건이 빠짐 |
| OverduePanel.tsx 73, HomeUnhandledPanel.tsx 88, homeUnhandled.ts 101, receptionBoardData.ts 242, ReceptionBoard.tsx 196 | 지난 미처리 표시 | 표시 | 동작함(폭 w-14 에서 잘림) |
| api/calendar-ics.js 79행 | ICS 설명 `팀/담당` | 표시 | 동작함 (사람별 필터 없음) |
| naver-calendar-sync/index.ts 321~322행 | 네이버 제목에서 `assignee-` 머리 떼기 | startsWith(`${assignee}-`) | **네이버 제목 머리와 저장 문자열이 한 글자라도 다르면 calendarTitle 에 이름이 붙어 들어가고, 다음 표시에서 이름이 두 번 붙는다** |
| entity360.ts 65행, data-ask/index.ts 50·192행 | 통합검색·AI 질의 | 표시·집계 | 검색은 동작, AI 사람별 집계는 "김A,이B"를 "그 외"로 셈 |
| tools/worker/backup_tables.py | 백업 | 없음 | 무관 |

- 푸시: `push-send` 는 `targets: string[]`(이름 배열)를 이미 받는다. 여러 명에게 보내는 데 함수 수정 불필요.
- 홈 미처리(homeUnhandled)·OverduePanel 은 assignee 로 거르지 않고 표시만 한다.
- 카톡: 일정 쪽에서 outbox 로 직접 보내는 곳은 없음(중간보고는 복사 후 사람이 붙여넣기).

## 3. 저장 방식 비교와 추천

| | (A) assignee 에 쉼표 목록 | (B) assignees text[] 새 열 + assignee=첫 사람 | (C) 사람마다 행 복제 |
|---|---|---|---|
| SQL | 없음 | 필요(열 추가 1줄, sql-review 후 사용자 실행 대기) | 없음 |
| 옛 코드·옛 폰 캐시 | 옛 화면은 "김A,이B"를 한 덩어리로 보여줄 뿐 데이터는 안 깨짐. 옛 화면에서 재배정하면 1명으로 덮어씀(의도와 같음) | 생성 5경로·네이버 수입·옛 화면이 assignee 만 쓰므로 **두 칸이 어긋남**(assignee=이B, assignees=[김A]). 모든 쓰기 경로에 동기화 규칙 필요 | 네이버 일정 1개에 행 2개(naverUid 중복). 완료·연기·날짜 이동·삭제를 행끼리 맞춰야 함 |
| 읽는 곳 고칠 양 | 위 표의 "===" 지점을 공용 함수로 교체 | 같음 + 두 칸 동기화 | 완료 동기화·접수 상태 집계·네이버 미러 전부 |
| 서버 필터 | `ilike.*이름*` 후 화면에서 정확 비교 | `assignees=cs.{이름}` 정확 | eq 그대로 |
| 회귀 위험 | 중(보고·내 일정은 테스트로 막음) | 중상(원본 두 개) | 상(2026-09-16 네이버 이중 요청 사고와 같은 종류) |

**추천: (A) 쉼표 목록.**
- SQL 없이 바로 배포·되돌리기 가능(값을 1명으로 되돌리면 옛 동작 그대로).
- 원본이 한 칸이라 어긋날 일이 없다. (B)는 assignee 만 아는 쓰기 경로가 6곳이라 하나만 빠뜨려도 "배정했는데 안 보임"이 다시 생긴다.
- 일정이 한 행이므로 완료·연기·네이버 미러·접수 상태 집계(siblings 최고 단계 규칙) 로직을 하나도 안 건드린다. (C)는 이것들을 다시 짜야 한다.
- 수용하는 단점: 서버에서 정확한 사람 필터가 안 됨. 쓰는 곳은 AutoSchedule 1곳뿐이라 `ilike` 로 넓게 받고 화면에서 `hasAssignee` 로 정확히 거른다.

### 저장 형식 (규칙 하나로 고정)
- 저장: `김A,이B` (쉼표 구분, 공백 없음, 선택 순서 유지, 첫 사람 = 대표, 중복 제거). 1명이면 지금과 글자 하나 다르지 않다.
- 읽기: 공용 함수가 쉼표·전각 쉼표·슬래시·가운뎃점과 앞뒤 공백을 모두 구분자로 받는다(손으로 고친 값 방어). 이름 안에 이 문자가 든 명단은 현재 없다고 보지만 db-schema 가 실측 확인.
- 화면 표시: 칩 여러 개 또는 `김A·이B`. 좁은 칸(w-14 등)은 `김A 외 1`.
- 네이버 제목 머리: **저장 문자열 그대로** `김A,이B-제목`. 화면용 가운뎃점으로 바꾸면 naver-calendar-sync 의 머리 떼기(startsWith)가 실패해 이름이 두 번 붙는다. 그래서 엣지 함수는 안 고친다(열린 결정 D5).

## 4. 기존 코드 재사용·확장 지점
- 새 파일 `src/assignees.ts` (순수 함수, 테스트 대상)
  - `parseAssignees(v: string): string[]` 구분자 분해·trim·중복 제거
  - `joinAssignees(names: string[], max?: number): string` 쉼표 결합, 최대 인원 자르기
  - `hasAssignee(v: string, name: string): boolean` 정확 일치(부분 문자열 아님: "이수" 와 "이수진" 구분)
  - `formatAssignees(v: string, opts?: { short?: boolean }): string` `김A·이B` 또는 `김A 외 1`
  - `addedAssignees(before: string, after: string): string[]` 푸시 대상(새로 추가된 사람만)
- `src/reportAssignee.ts`: `matchReportAssignees(ticket, order): string[]` 추가(배정 칸이 있으면 parse 결과, 없으면 기존 제목 추정 1명). 기존 `matchReportAssignee` 는 첫 사람을 돌려주게 남겨 호환.
- `src/CsAsWorkspace.tsx`
  - `applyAssign(ticket, value: string)` 시그니처 그대로(값이 목록 문자열이 될 뿐). MyPlan `onAssign` 연결(1937행) 무수정.
  - `update()` 푸시: `targets: addedAssignees(before.assignee, changed.assignee)`.
  - 보고 생성기 두 곳(1259~1313, 1350~1364행): 금일 대상 = 담당자 중 명단에 있는 사람이 하나라도 있으면, 사람별 묶음 = 그 사람이 목록에 있으면. 2명 일정은 두 사람 묶음에 각각 한 줄. 미배정 = 목록이 비었을 때만.
  - 일정리스트 사람별 묶음(1959·1963·2040행): 묶음 키 = 목록 문자열 그대로(`김A·이B` 묶음 1개, 카드 중복 없음). 정렬은 첫 사람 기준.
  - 배정 팝업(2367~2385행): 새 컴포넌트 `AssigneePicker` 로 교체.
- `src/MyPlan.tsx`
  - 내 일정 필터(214행)·팀별 건수(70행): `hasAssignee(t.assignee, author)`.
  - 팀 보기 사람 칩·건수(221, 682~683행): 사람별로 펼쳐 셈(2명 일정은 두 사람 건수에 각각 +1). 지도 핀 색·번호·동선·목록 묶음(224, 299, 372, 384, 406, 440, 476, 700~720행)은 **첫 사람** 기준(핀이 두 개 생기면 지도가 거짓이 됨), 줄 알약에는 `formatAssignees(short)`.
  - 행 메뉴(501~508, 786~787행): 누르면 즉시 저장·닫힘 대신 눌러서 켜고 끄기 + [확인]. 지도 오버레이 메뉴는 DOM 직접 생성이라 같은 토글 규칙을 그 안에서 구현.
- `src/AutoSchedule.tsx:85`: `assignee=ilike.*이름*` 로 받고 `hasAssignee` 로 다시 거름.
- 표시만 하는 곳(OverduePanel·HomeUnhandledPanel·ReceptionBoard): `formatAssignees(short)` 로 잘림만 정리. calendar-ics 는 그대로(표시만).

## 5. 데이터 설계
- 새 표·새 열 없음. `as_tickets.assignee` 의미만 "이름 1명"에서 "쉼표로 구분한 이름 목록(첫 사람 = 대표)"으로 넓힌다.
- RLS·grant 변경 없음. **SQL 필요 없음.**
- 문서용으로 `supabase/as-tickets.sql` 머리에 주석 한 줄 권장(실행하는 변경 아님): "2026-10 이후 assignee 는 쉼표 목록 가능".

## 6. 화면 흐름
1. 일정리스트(또는 캘린더 상세)에서 [배정] 누르면 바닥 시트 "담당자 배정".
2. 팀 명단 칩(지금과 같은 2열)을 누르면 켜짐/꺼짐. 켜진 칩에 순서 번호(1, 2) — 1번이 대표.
3. 맨 위 줄에 "선택: 김A · 이B (2명)" 와 [모두 해제]. 최대 인원을 넘으면 남은 칩이 잠기고 안내 한 줄.
4. [배정 저장]을 누르면 저장·닫힘. 1명만 고르면 지금과 똑같이 저장. 아무도 안 고르고 저장하면 미배정.
5. 저장 직후: 새로 추가된 사람에게만 푸시, 네이버 제목 `김A,이B-제목` 갱신, 두 사람 내 일정에 바로 보임.
6. 완료는 둘 중 누가 눌러도 일정 1건이 완료(행이 하나뿐). 접수 시트 BD열 처리자는 담당자 목록 전체(D8).
7. 내 일정 지도 행 메뉴도 같은 방식(토글 + [확인]).

## 7. 작업 분해 (파일 겹침 없음)
| 역할 | 할 일 | 건드릴 파일 |
|---|---|---|
| ui-designer (윤화면) | 다중 선택 칩 시트 컴포넌트: 켜짐/꺼짐·순서 번호·최대 인원 잠금·[모두 해제]·[배정 저장]. 폰 바닥 시트·PC 가운데 창. props `names: string[]`, `value: string`, `max: number`, `title`, `onSave(value: string)`, `onClose()`. 기존 팝업(CsAsWorkspace 2367~2385행)의 색·크기 그대로. | 새 `src/AssigneePicker.tsx` 만 |
| db-schema (표다빈) | SQL 없음. **읽기 전용 실측**(MCP): as_tickets.assignee 에 쉼표·슬래시·가운뎃점이 든 행 수, cs_members.name 에 그 문자가 든 이름 유무, assignee 최대 길이. 결과를 이 문서 9절에. `supabase/as-tickets.sql` 머리 주석 한 줄. | 이 문서 9절, `supabase/as-tickets.sql`(주석만) |
| developer A (구현서) | `assignees.ts` 함수 5개 + 테스트, `reportAssignee.ts` `matchReportAssignees`, CsAsWorkspace 의 applyAssign·푸시·보고 생성기 2곳·리스트 묶음·배정 팝업을 AssigneePicker 로 교체 | 새 `src/assignees.ts`, `src/reportAssignee.ts`, `src/CsAsWorkspace.tsx`, 새 `tests/assignees.test.ts`, `tests/reportAssignee.test.ts` |
| developer B (구현서) | MyPlan 내 일정 필터·팀 보기 펼침·행 메뉴 토글, AutoSchedule 서버 필터, 표시 칸 짧게 | `src/MyPlan.tsx`, `src/AutoSchedule.tsx`, `src/OverduePanel.tsx`, `src/HomeUnhandledPanel.tsx`, `src/ReceptionBoard.tsx` |
| qa-checker (검수아) | build·test, 아래 회귀 시나리오 | 읽기만 |

순서: developer A 가 `assignees.ts` 를 먼저 올린다(시그니처는 4절로 고정). B 는 그 시그니처로 병행. ui-designer 결과는 A 가 CsAsWorkspace 에 끼우고, B 는 MyPlan 지도 메뉴(DOM 직접 생성이라 컴포넌트 재사용 불가)에 같은 규칙만 따른다.

QA 회귀 시나리오(필수)
1. 1명 배정: 저장 값·네이버 제목·푸시·중간보고가 지금과 글자 단위로 같다.
2. 2명 배정: 두 사람 내 일정 모두 표시, 중간보고에서 두 `#이름` 아래 각각 1줄, `#미배정`에 없음.
3. 명단 밖 사람 + 명단 사람 혼합: 명단 사람 묶음에만 나오고 사라지지 않음.
4. 네이버 동기화: 제목 `김A,이B-제목` 인 일정이 sync 뒤 calendarTitle 에 이름이 붙지 않음(이름 두 번 붙음 방지).
5. "이수" 와 "이수진" 이 있을 때 hasAssignee 가 섞이지 않음.
6. 한 명만 추가했을 때 푸시는 추가된 사람에게만.
7. 기존 tests/reportAssignee.test.ts 실사고 케이스 전부 통과.
8. 접수에서 온 일정 2명 배정 후 완료: 접수 상태 완료, BD열 처리자 표기.

## 8. 위험·열린 결정 (팀장 제안값 붙임, 한 번에 답 주세요)
- D1 최대 인원: **제안 3명.** 2인 1조가 대부분, 교육·대형 납품이 3명. 그 이상은 네이버 제목 머리가 너무 길어짐.
- D2 완료: **제안 = 한 명이 누르면 전체 완료.** 같은 현장을 같이 가는 경우가 대부분이고, 사람별 완료는 (C) 행 복제가 필요해 비용이 큼. 따로 가는 일이면 일정을 두 개 만들도록 안내.
- D3 중간보고·익일스케줄: **제안 = 각 사람 묶음에 한 줄씩(중복 표기).** 대안: 첫 사람에만 + "(김A·이B)" 꼬리. 보고는 사람별로 읽으므로 중복이 낫다고 봄.
- D4 일정리스트 사람별 묶음: **제안 = "김A·이B" 묶음 1개(카드 중복 없음).** 개인 화면(내 일정)은 각자에게 보임.
- D5 네이버 제목 표기: **제안 = `김A,이B-제목`(저장 문자열 그대로).** `김A·이B-` 를 원하면 naver-calendar-sync 머리 떼기 수정 + 엣지 배포가 추가됨.
- D6 배정 후보 범위: **제안 = 지금과 같음(그 팀 + CSS 지원 + 팀장).** 다른 팀 사람과 짝일 때 [다른 팀 보기] 펼침을 1차에 넣을지?
- D7 생성 경로(워킨맵·자동일정·재계약·직접 추가·서비스접수): **제안 = 이번엔 1명 그대로, 만든 뒤 [배정]에서 추가.** 생성 화면마다 다중 선택을 넣으면 파일 5개가 더 늘어남.
- D8 접수 시트 BD열 처리자: **제안 = 담당자 목록 전체(`완료 10/22 14:05 김A,이B`).** 대안: 완료를 누른 사람 1명.
- D9 AI 질의(data-ask) 사람별 집계: **제안 = 이번 범위 밖.** 필요해지면 설명 한 줄 추가 후 엣지 재배포.
- R1 위험: 옛 버전 화면(폰 캐시)에서 [배정]을 누르면 1명으로 덮어씀. 배포 후 새로고침 안내로 충분.
- R2 위험: 쉼표 목록을 PostgREST `or=(...)` 필터에 넣으면 따옴표가 필요. 지금 assignee 를 or 필터로 쓰는 곳은 없음. 새로 만들 때 주의.
- R3 위험: 중간보고 회귀가 가장 아프다(2026-08-25 "팀 보고 통째로 없음" 사고와 같은 자리). 테스트 없이 배포 금지.

## 9. db-schema 실측 기록 (표다빈이 채움)
- assignee 에 쉼표·슬래시·가운뎃점 포함 행 수: (미확인)
- cs_members.name 에 같은 문자 포함: (미확인)
- assignee 최대 길이: (미확인)

## 10. 하지 않을 것
- SQL·새 열·연결표(assignees 배열, ticket_assignees)는 만들지 않는다.
- 일정 행 복제(사람마다 1행)는 하지 않는다.
- 부서 일정(team_calendar_events, DeptCalendarPanel)·서비스접수 handler 칸은 건드리지 않는다.
- naver-calendar-sync / naver-calendar-push / push-send / data-ask 엣지 함수는 고치지 않는다(D5·D9 를 바꾸면 그때 별도).
- 생성 화면 5곳에 다중 선택을 넣지 않는다(D7).
- App.tsx 0줄.
