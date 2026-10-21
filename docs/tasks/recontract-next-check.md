# 재계약 다음 확인일 — 달력 팝업 + 보낸 뒤 "일정 생성?" (설계안)

작성: 2026-10-22 기획실 한설계 (feature-planner). 할 일 목록 `docs/tasks/todo-2026-10-21.md` C2(7).
상태: **설계안 — 사용자 승인 대기.** 코드·SQL 없음. 사용자 수면 중이라 열린 결정은 팀장 제안값을 붙여 둠(§7).

요청 원문: "필드에서 재계약 입력 시 다음 확인일을 손수 기재가 아닌, 익일로 넘길 때 나오는 달력같이 팝업시키고 날짜 선택 후 보내기 누르면 카톡방 보낸 후 「다음 확인일로 일정 생성하시겠습니까?」까지 해서 제목·내용·장소 있으면 들어가게 해서 네이버 캘린더·일정리스트·웹캘린더 모두 동기화되어 생성되도록."

---

## 0. 지금 구조 (조사 결과, 2026-10-22)

| 무엇 | 지금 | 근거 |
|---|---|---|
| 재계약 양식 | `CATEGORY_SCHEMAS.recontract` — 9섹션. "다음 액션" 섹션에 `T("다음확인일", "다음 확인일")` = **그냥 글자 칸**. 불만(bulman)에도 같은 칸 있음 | src/categoryForms.ts:65~91 (bulman 59) |
| 그리는 곳 | `CategoryForm.tsx` `renderField` — text 는 input, select 는 `ChoiceInput` 칩. 날짜 타입 없음 | src/CategoryForm.tsx:92~125 |
| 보내기 | App.tsx `handleSendAllInner` → `isCat` 분기(5733) → `sendCategoryForm()` → `recontract` 표 insert(`_dupKey` md5 중복 차단) → `queueRooms` 로 재계약 지역 방 outbox → `recordVisit`·`recordOperation` → 토스트. **isCat 분기는 `resetAfterSend()` 전에 return 해서 재계약 양식이 보낸 뒤에도 그대로 남는다**(주석은 "비운다"인데 실제로 안 비움 — 기존 동작, 이번 범위 밖) | src/App.tsx:5733~5759·5800, src/api.ts:1028~1088 |
| `recontract` 표 | 1,199행(웹앱 출처 10행). GAS 는 **카톡 증분 적재**(미수처럼 밤마다 통째 교체되는 미러 아님 — 안전). `다음확인일` text 열. 실제 값: "목요일", "차주 중", "전자계약서 작성 확인", "26-9-29 화요일", "8월12일~14일", "" — **날짜 아닌 글이 섞여 있음** | supabase/visits.sql:190, apps-script/first-data/src/Supabase.gs:18, REST 실측 |
| 다음확인일 읽는 곳 | 재계약 준비(`src/recontract/api.ts:498·526` `normalizeYmd`)·조회 카탈로그(`lookupCatalog.ts:165`). YYYY-MM-DD 로 저장하면 둘 다 그대로 읽힘 | |
| "익일로 넘길 때 나오는 달력" | (1) FIELD 전송 뒤 `ticketDeferPrompt` "언제로 미룰까요?" — 하단 시트, [익일][1주 뒤] 2칸 + date 칸 + [직접선택] (App.tsx:6665~6700 인라인) (2) 일정리스트 "익일 일정 변경" — [익일][1주][1달][3달] 2x2 + date + 적용 (CsAsWorkspace.tsx:2680~2715 인라인) (3) 부서 접수 `DeptActionBar` [내일로][날짜 고르기] (openNativePicker). **셋 다 화면 안에 박힌 코드라 그대로 가져다 쓸 부품은 없다** → 같은 모양의 작은 공용 시트를 새로 만든다 | |
| 날짜 도우미 | `nextBusinessDay()`(주말·공휴일 건너뜀, planDate.ts:43), `kstDate()`(visits.ts:37), `openNativePicker()`(datePicker.ts) | |
| 일정리스트·웹캘린더 | **같은 원본 `as_tickets`.** 일정리스트(screen asReception)와 캘린더 탭(`CsCalendar`)이 둘 다 `CsAsWorkspace.tsx` 에서 그 표를 읽는다. ICS 구독(`api/calendar-ics.js`)도 as_tickets → **as_tickets 1행 = 일정리스트·웹캘린더·ICS 3곳** | App.tsx:94·6583, CsAsWorkspace.tsx:286 |
| 네이버 캘린더 | `naver-calendar-push` 엣지 함수(등록·CalDAV 수정/이동/완료). `stableKey` 를 주면 UID 가 `firstoa-r-<key>` 로 고정 → **두 번 불러도 같은 일정 덮어씀(멱등)**. 60초 40건 쓰기 상한. 토글 `app_config.NAVER_CALENDAR_ENABLED`. 네이버 → 웹은 `naver-calendar-sync` 크론이 `naver_calendar_events` 로 당겨오고, as_tickets.naverUid 와 같은 건 웹캘린더에서 숨겨 **중복 표시 없음** | supabase/functions/naver-calendar-push/index.ts:383~400, CsAsWorkspace.tsx:764 |
| "3면 동기화" 선례 | 캘린더 간소 추가 `submitSimpleAdd` — as_tickets upsert → naver-calendar-push(기본 익일통합as) → 받은 uid 를 as_tickets.naverUid 에 저장. 완료하면 기존 흐름이 팀 완료 캘린더로 이동·체크 | CsAsWorkspace.tsx:1069~1112 |
| 접수 → 일정 선례 | `ServiceReception.createTicketFromReception` — 같은 receptionId 일정 있으면 중복 확인, 팀 시각(A09·B12·C15·D18·E21), stableKey=접수 id, 네이버는 토글 켜졌을 때만·실패해도 일정은 유지 | ServiceReception.tsx:1176~1250 |
| **재계약 일정 선례** | 워킨맵 재계약 방문 등록 — scheduleType "AS", calendarTitle "재계약 업체명", issue "재계약 방문 (워킨맵에서 등록)", source "workin", 같은 달 같은 업체 열린 AS 일정 있으면 안 넣음. 네이버는 안 올림 | WalkingMap.tsx:2115~2142 |
| as_tickets 제약 | team ∈ A·B·C·D·E·기타, scheduleType ∈ AS·익일AS·물류·휴가·매월점검·납품철수교체휴가교육 (라이브) | supabase/as-tickets-constraints.sql |
| 팀 캘린더 매핑 | `NAVER_TEAM_CALENDAR_A~E·IT` = 팀 **완료** 캘린더(AS 완료 시 이동 대상). 새로 만드는 AS 계열 일정은 기본 익일통합as(NAVER_MAIN_CAL) | CsAsWorkspace.tsx:93·598, SystemAdmin.tsx:258 |
| 카톡 시각 규칙 | 야간 22~08 발송 금지는 outbox 소비 쪽(노트북 중계·봇폰)이 지킴. 웹앱은 outbox 에 넣기만 → **일정 생성은 카톡과 무관, 밤에도 바로 만든다** | AGENTS.md 2026-10-22 기록 |

쓰는 사람: **CS 현장 기사·파트장, 폰**(재계약 방문 직후 차 안). 일정 확인은 팀장·기사(PC 일정리스트·네이버 앱).

---

## 1. 한 줄 목표

재계약 양식의 "다음 확인일"을 **달력 시트에서 골라** 넣고, 보내기가 성공하면 "**다음 확인일로 일정을 만들까요?**"를 물어 [만들기] 한 번에 **일정리스트·웹캘린더(as_tickets) + 네이버 캘린더**에 같은 일정 1건을 만든다.

---

## 2. 기존 코드 재사용 / 확장 지점

| 파일:함수 | 어떻게 |
|---|---|
| `src/categoryForms.ts` `FieldType`, `CATEGORY_SCHEMAS.recontract` | `FieldType` 에 "date" 추가, 재계약의 `다음확인일` 만 날짜 칸으로. **불만(bulman) 다음확인일은 그대로 글자 칸**(범위 밖) |
| `src/categoryForms.ts` `buildCatText` | 날짜 칸 값이 YYYY-MM-DD 면 카톡 줄은 `2026-10-29(목)` 처럼 요일을 붙여 보냄(표에는 YYYY-MM-DD 원값) |
| `src/CategoryForm.tsx` `renderField` | 날짜 타입이면 버튼형 칸(값 있으면 `10/29(목)` + [지우기], 없으면 "날짜 고르기") → 새 `DatePickSheet` 열기. 옛 글자값(예 "차주 중")은 그 글자를 그대로 보여 주고 시트에서 덮어쓰기 가능 |
| `src/CategoryForm.tsx` (새 효과 1개) | 창 이벤트 `field:category-sent` 를 듣고 재계약일 때 `RecontractScheduleSheet` 를 띄움. 마운트 때 localStorage 의 "대기 중인 일정 제안"도 확인(보낸 뒤 화면을 떠났다 와도 다시 물음) |
| `src/api.ts` `sendCategoryForm` | insert 성공 + 방 큐 넣은 **뒤** 한 줄: `emitCategorySent({ schemaKey, form, author, dupKey, text, testMode })`. 반환값·기존 흐름 불변. (**지금 다른 팀원이 api.ts 를 고치는 중 — 그 커밋 뒤에 손댄다**) |
| `planDate.ts` `nextBusinessDay`, `visits.ts` `kstDate`, `datePicker.ts` `openNativePicker` | 시트의 빠른 선택 날짜 계산·네이티브 달력 열기 |
| `api.ts` `leaseAddressOf(vendor)` | 장소 기본값(임대리스트 실납품 주소). 못 찾으면 빈칸 → 확인창에서 손으로 |
| `supabase.ts` `upsertRow`·`updateRows`·`selectRows`·`invokeEdgeFunction`·`getConfig` | as_tickets 저장·naverUid 저장·중복 조회·네이버 등록·토글 확인 (래퍼만 사용) |
| `naver-calendar-push` (엣지 함수, 수정 없음) | stableKey·title·date·time·location·description 그대로 호출 |
| 기존 하단 시트 모양(App.tsx:6640 클래스) / `FormModal.tsx` | 두 시트의 겉모양을 맞춤(윤화면 결정) |
| `src/ids.ts` `vendorMatchKey`·`fieldTicketVendor` | 같은 업체 열린 재계약 일정 찾기(중복 방지) |

**App.tsx 변경: 0줄.** 성공 신호를 api.ts → 창 이벤트로 받고, 시트는 CategoryForm 안에서 그린다(CategoryForm 은 재계약 모드인 동안 늘 떠 있음).
대안(이벤트가 싫으면): App.tsx isCat 분기에 "성공이고 재계약이면 offerRecontractSchedule 호출" 1줄 — CLAUDE.md 허용(1~3줄)이지만 0줄 안을 제안.

---

## 3. 데이터 설계

**새 표 없음. SQL 없음**(D1 제안값 = scheduleType "AS" 일 때).

### 3-1. recontract 표 (기존 열만)
- `다음확인일`: 앞으로 웹앱 입력은 YYYY-MM-DD. 옛 글자값은 손대지 않음. [미정·글로 쓰기]로 넣은 글자는 예전처럼 글자.

### 3-2. as_tickets 1행 (재계약 확인 일정)

| 열 | 값 |
|---|---|
| id | `rc-` + recontract._dupKey 앞 20자 — **같은 재계약 건은 항상 같은 id** → upsert 라 두 번 눌러도 1건 |
| team | 양식 지역(A~E) → 없으면 작성자 팀(authors book) → 그래도 없으면 확인창에서 고르게(빈 채 저장 금지) |
| date | 다음확인일 YYYY-MM-DD |
| time | 팀 시각 A 09:00·B 12:00·C 15:00·D 18:00·E 21:00 (웹캘린더 팀 필터·네이버 팀 추정이 이 시각으로 돌아감) |
| vendor | 업체명 |
| contact | 담당자/연락처 칸 |
| address | 확인창 "장소" (기본 leaseAddressOf) |
| model | 기종/위치 칸 |
| grade | 등급 |
| issue | "재계약 확인 (FIELD 재계약에서 등록)" — 워킨맵 재계약 방문("재계약 방문 (워킨맵에서 등록)")과 같은 머리말 규칙 |
| calendarTitle | 확인창 "제목" (기본 "[재계약 확인] 업체명") |
| note | 확인창 "내용" (기본 = 3-3) |
| assignee | 후속담당자 칸이 명단에 있는 이름이면 그 이름, 아니면 작성자 |
| status | 배정 |
| scheduleType | AS (D1 제안값) |
| source | recontract |
| receptionId | 빈 값 |
| naverUid | 네이버 등록 성공 시 응답 uid (firstoa-r-rc-…) |

### 3-3. 내용(note·네이버 description) 기본 문장
```
[재계약 확인] {업체명} · 다음 확인일 {YYYY-MM-DD(요일)}
갱신 상태: {갱신상태} / 위험도: {갱신위험도} / 고객 반응: {고객반응현황}
계약 종료일: {계약종료일} · 월 렌탈료: {월렌탈료}
제안 조건: {제안조건}
갱신 방향: {갱신방향}
내부 협의: {내부협의}
후속 담당: {후속담당자} · 기한: {기한}
관리 포인트: {관리포인트}
— 작성 {작성자} {작성일} (FIELD 재계약)
```
빈 값 줄은 뺀다. 아래에 "— 전송 원문 —" + 카톡 전송본 전체를 붙임(D5 제안값).

### 3-4. 대기 중인 제안 (기기 안, localStorage)
키 `recontract_schedule_offer_v1` = { dupKey, form, author, text, at } 1건. emit 시점에 함께 씀. [만들기] 성공·[안 만들기]·24시간 경과 시 지움. 네트워크로 일정 저장이 실패하면 남겨서 다시 물음.

---

## 4. 화면 흐름 (폰 기준)

1. **필드 › 재계약** 양식 "다음 액션"의 **다음 확인일** 칸을 누른다 → 아래에서 시트 "다음 확인일"이 올라옴.
2. 시트: 빠른 칩 2x3 **[익일 10/23(목)] [+3일] [+1주] [+2주] [+1달] [+3달]**(익일만 nextBusinessDay 영업일 보정, 나머지는 달력 그대로) + 아래 **날짜 칸**(누르면 폰 기본 달력, openNativePicker, 오늘 이전 막음) + [이 날짜로]. 칩을 누르면 바로 들어가고 닫힘. [미정·글로 쓰기] = 예전처럼 글자 입력(비상구 — "차주 중" 같은 값).
3. 양식 칸에 `10/29(목)` 표시. 미리보기·카톡 줄은 `다음 확인일: 2026-10-29(목)`.
4. **보내기** → 지금과 같이 저장 + 재계약방 큐 → 성공 토스트.
5. 성공이고 다음확인일이 날짜면 바로 확인 시트 **"다음 확인일로 일정 만들까요?"**
   - 날짜(10/29 목, 바꾸기 가능), 팀 칩(A~E, 미리 선택), **제목**·**장소**·**내용**(미리 채움, 고칠 수 있음)
   - 안내 한 줄: "일정리스트·캘린더·네이버 캘린더에 함께 만들어집니다"(네이버 토글 꺼짐이면 "네이버는 꺼져 있어 일정리스트·캘린더에만")
   - [일정 만들기] / [안 만들기]
   - 다음확인일이 비었거나 글자값이면 묻지 않는다.
6. 같은 업체에 **열린 재계약 일정**(완료 아님, issue 가 "재계약"으로 시작 — 워킨맵 등록분 포함)이 있으면 만들기 전에 한 번 더: "이미 {날짜} 재계약 일정이 있습니다" [그 일정을 10/29로 옮기기] [새로 하나 더] [취소] (D4).
7. 결과 토스트: "일정을 만들었습니다 — 일정리스트·캘린더 ✓ / 네이버 ✓". 네이버만 실패면 경고 토스트 "네이버 등록 실패(일정리스트·캘린더는 정상)" + 시트에 [네이버 다시 시도].

PC 에서도 같은 시트가 가운데 창으로 뜸(기존 하단 시트 클래스 items-end sm:items-center 그대로).

---

## 5. 생성 순서와 실패 처리 (createRecontractSchedule)

1. 입력 검사: 날짜 YYYY-MM-DD·오늘 이후(오늘 포함), 제목 비지 않음, 팀 A~E.
2. 중복 조회: as_tickets 에서 완료 아님 + issue 가 "재계약"으로 시작 + 날짜 오늘-30일 이후 → vendorMatchKey 같은 행(자기 id 제외).
   - **옮기기**: 그 행 updateRows date·time·note(앞에 새 요약 덧붙임) → naverUid 있으면 caldav_update(uid, date, description) — CsAsWorkspace 와 같은 호출.
3. **새로 만들기**: upsertRow("as_tickets", row, "id") — id 고정이라 재시도·두 번 누름에도 1행.
   - 실패(네트워크): 오류 토스트 "일정 저장 실패 — 신호 확인 후 다시 시도", 제안은 localStorage 에 남김. 네이버는 부르지 않음(일정리스트가 원본, 네이버는 미러).
4. 토글 NAVER_CALENDAR_ENABLED 켜짐이면 naver-calendar-push 호출(stableKey = row.id, title, date, time, location, description; calId 생략 = 기본 익일통합as, D2).
   - 성공: as_tickets 그 행 naverUid 저장.
   - 실패(429 상한·CalDAV 미설정·네트워크): 일정은 그대로 두고 경고 + [네이버 다시 시도](같은 stableKey 라 재시도해도 네이버 1건).
5. 끝나면 제안 지움, 성공 토스트.

중복 방지 정리: 같은 재계약 건(같은 dupKey) → as_tickets id 고정 + 네이버 UID 고정 → **몇 번을 눌러도 1일정**. 같은 업체 다른 재계약 건 → 4-6 확인. 보내기 두 번(양식이 남아 있어 가능) → insert 는 dup, 이벤트는 다시 오지만 id 가 같아 같은 일정.

테스트 모드(TEST_MODE): 확인창은 띄우되 제목 앞 "[테스트]", 네이버는 부르지 않음(D6).

---

## 6. 작업 분해 (겹치지 않게)

### 디자인실 윤화면 (ui-designer)
- 새 `src/DatePickSheet.tsx` — 공용 날짜 시트(props: value, onPick(ymd), onText?(), onClose, chips). 기존 "언제로 미룰까요?" 시트와 같은 모양(하단 시트·2열 칩·보라 강조). **App.tsx·CsAsWorkspace 의 기존 미루기 시트는 바꾸지 않음**.
- 새 `src/RecontractScheduleSheet.view.tsx` — 확인 시트 겉모양만(날짜·팀 칩·제목·장소·내용 입력, 상태 줄, 단추 2개, 중복 3단추 단계, 네이버 재시도 줄). 상태·저장 로직 없음, props 로 받음.
- 건드리는 파일: 위 2개만.

### 데이터실 표다빈 (db-schema)
- D1 제안값("AS")이면 **SQL 0**. MCP 로 as_tickets 열 source·naverUid·calendarTitle·grade·contact 와 라이브 제약을 확인해 구현서에게 한 줄 회신.
- D1 을 "새 유형 재계약확인"으로 바꾸면: `supabase/as-tickets-recontract-type.sql`(scheduleType 제약에 추가) + 권한나 검토 + /sql-handoff. 이 경우 구현 범위가 CsAsWorkspace(유형·필터·색·분류)·overdueLogic(지금은 AS 가 아니면 전부 "물류"로 셈)까지 커짐.

### 개발실 구현서 (developer) — 2명 병렬
- **구현서 A (순수 로직, 테스트 먼저)**
  - 새 `src/recontractSchedule.ts`: nextCheckChips(today), formatYmdKo(ymd), isYmd(v), teamForRecontract(form, author, book), buildRecontractSummary(form, author, ymd, text), recontractTicketId(dupKey), buildRecontractTicket(input)(3-2 행), 제안 저장/읽기/지우기(localStorage), createRecontractSchedule(input, choice)(5절 — supabase.ts 래퍼만).
  - 새 `src/categorySentEvent.ts`: emitCategorySent(detail)·onCategorySent(fn) (이벤트 이름 상수 하나, emit 때 대기 제안도 저장).
  - `src/categoryForms.ts`: FieldType "date", 재계약 다음확인일만 날짜, buildCatText 날짜 요일 표기.
  - `src/api.ts` sendCategoryForm: 성공 뒤 emitCategorySent 1~2줄 + import 1줄. **다른 팀원 api.ts 작업 커밋 뒤에.**
  - 테스트: `tests/recontractSchedule.test.ts`(칩 날짜·금요일 익일=월요일·id 결정성·팀 결정·요약 빈 줄 제외·테스트 모드 제목), `tests/categoryFormsDate.test.ts`(재계약 날짜 표기, 불만은 글자 그대로).
- **구현서 B (화면 연결)**
  - 새 `src/RecontractScheduleSheet.tsx`(상태·저장 호출, 겉모양은 윤화면 view).
  - `src/CategoryForm.tsx`: 날짜 칸 렌더 + DatePickSheet 연결, onCategorySent 구독 + 마운트 시 대기 제안 확인 → RecontractScheduleSheet.
  - 테스트: `tests/recontractScheduleSheet.render.test.tsx`(칩 → 값, 성공 이벤트 → 시트 뜸, 글자값이면 안 뜸, [안 만들기] → 제안 지움).
- **건드리지 말 것**: src/App.tsx, src/CsAsWorkspace.tsx, src/ServiceReception.tsx, src/WalkingMap.tsx, src/overdueLogic.ts, 엣지 함수, supabase/*.sql, 그리고 지금 다른 팀원이 고치는 PcForm·CopierExpansionForm·DataLookup·OperationsDashboard·workCount·expansion* 파일.

### 품질실 검수아 (qa-checker)
- npm run build·npm test 통과, **App.tsx diff 0줄**, 범위 밖 파일 diff 없음.
- 시나리오: (1) 칩 6개 날짜(금요일 기준 익일 = 월요일) (2) 날짜 고르고 보내기 → 카톡 줄 "(목)" 표기·표 값 YYYY-MM-DD (3) [만들기] 두 번 → as_tickets 1행·같은 id (4) [안 만들기] → 다시 안 물음 (5) 네트워크 끊고 [만들기] → 실패 토스트·제안 유지·재진입 시 다시 물음 (6) 네이버 토글 꺼짐 → 문구 바뀜·호출 없음 (7) 같은 업체 열린 재계약 일정 있음 → 3단추 (8) 글자값("차주 중") → 확인창 안 뜸 (9) 불만 양식 다음확인일은 여전히 글자 칸 (10) 테스트 모드 → [테스트] 제목·네이버 미호출.
- 라이브 확인(배포 뒤, 테스트 모드): 일정리스트·캘린더 탭에 보이는지. 실제 1건 확인 때는 네이버 익일통합as 에 같은 제목이 생기고 웹캘린더에 N 칩으로 **두 번** 보이지 않는지(naverUid 연결) — 확인 뒤 그 일정 삭제.

---

## 7. 위험 · 열린 결정 (사용자 답 대기 — 제안값으로 진행 가능)

| # | 질문 | 팀장 제안값 | 이유 |
|---|---|---|---|
| D1 | 일정 유형(scheduleType) | **"AS"** (워킨맵 재계약 방문과 같은 규칙, SQL 0·CsAsWorkspace 수정 0) | 새 유형은 SQL + 일정리스트 필터·색·캘린더 분류·미처리 판정까지 6곳 수정. 지금은 선례대로 |
| D2 | 네이버 어느 캘린더에 | **기본 익일통합as**(접수·수기 일정과 같은 곳). 완료하면 기존 흐름대로 팀 완료 캘린더로 이동 | 전용 캘린더를 원하면 관리 탭에 NAVER_RECONTRACT_CALENDAR 키 하나 추가(빈 값=기본) — 2차 |
| D3 | 빠른 칩 구성 | **익일·+3일·+1주·+2주·+1달·+3달** + 날짜 칸 + [미정·글로 쓰기] | 요청 +1주/+2주/+1달에 "익일 넘김 달력"의 익일과 재계약 주기(3달)를 더함 |
| D4 | 같은 업체 열린 재계약 일정이 있을 때 | **[옮기기] 첫 단추**, [새로 하나 더]·[취소] | 워킨맵 "같은 달 같은 업체 중복 금지"와 맞춤 |
| D5 | 내용에 카톡 원문 전체를 붙일지 | **요약 + 원문 전체** | 접수 → 일정도 보고양식 전문을 note 에 넣는 관행 |
| D6 | 테스트 모드에서 | **확인창은 띄우되 [테스트] 제목, 네이버 미호출** | 실제 네이버 캘린더 오염 방지 |
| D7 | 일정 시각 | **팀 시각(A09·B12·C15·D18·E21)** | 웹캘린더 팀 필터·네이버 팀 추정이 시각 규칙. 종일로 하면 팀 미표시 |
| D8 | 불만(bulman) 다음확인일도 같이 바꿀지 | **이번엔 재계약만**, 같은 부품으로 2차 | 요청 범위 |

위험
- **R1 미처리 집계**: "AS" 유형이라 확인일이 지나도 완료 안 하면 홈 "미처리 일정"·지난 일정 패널에 AS일정으로 잡힘(워킨맵 재계약 방문과 같은 현상). "확인 끝나면 완료" 공지 필요.
- **R2 FIELD 완료 묻기**: 같은 업체로 AS/점검 양식을 보낼 때(오늘 -14일~+2일 창 안이면) "일정을 정리할까요?"가 이 재계약 일정을 집을 수 있음(App.tsx offerTicketMatchAfterSend, AS·익일AS 대상). [그대로 두기]로 넘김 — 수용 제안.
- **R3 api.ts 동시 작업**: 다른 팀원이 api.ts 수정 중. 이벤트 한 줄은 그 커밋 뒤에.
- **R4 이벤트 유실**: 보낸 직후 다른 화면으로 가면 CategoryForm 이 내려가 이벤트를 못 받음 → emit 때 localStorage 대기 제안도 써서 다음 진입 때 다시 물음(24시간). 신호 약함 자동 재전송(15분)으로 나중에 성공해도 같은 길.
- **R5 네이버 쓰기 상한**(60초 40건): 한 번에 1건이라 사실상 무관. 429 면 [네이버 다시 시도].
- **R6 기존 동작 발견**: isCat 양식은 보낸 뒤 비워지지 않음(App.tsx 5759 return 이 resetAfterSend 앞). 이번엔 고치지 않음 — App.tsx 수정이라 별건으로 팀장 판단.

---

## 8. 하지 않을 것

- 불만·초과조정 양식의 다음확인일(D8 — 2차).
- 일정을 고치거나 지울 때 재계약 기록 쪽으로 되돌려 반영(만든 뒤에는 일정리스트가 원본).
- 새 scheduleType·새 표·SQL(D1 제안값 기준).
- App.tsx·CsAsWorkspace 의 기존 미루기 시트를 공용 시트로 교체(통일은 나중 후보).
- "내일 재계약 확인" 카톡 알림 자동 발송 — 요청 없음.
- 옛 다음확인일 글자값을 날짜로 일괄 변환.
- isCat 양식 보낸 뒤 비우기(R6).
