# OKR 엑셀 내려받기 — 설계안 (2026-10-28, 기획실 한설계)

> 조사·설계만(코드 0, SQL 0). 요청: 팀장 "OKR 을 엑셀로도 받게". 사용자 질문: "분기·파트종합·주 각각? 통으로 탭 나눠?"
> 결론: **파일 하나 + 탭 5개**(요약 · 분기 통합집계 · 월 통합집계 · 파트 종합 · 주차 기록). 층마다 열이 달라 탭은 **층 단위**로 나누고, 같은 층 안의 파트·사람·주차는 **열 + 자동 필터**로 나눈다(파트당·사람당 탭은 만들지 않음 — 질문 Q1).

## 1. 한 줄 목표와 쓰는 사람
- 목표: OKR 화면 어디서든 [엑셀] 한 번 → 보고 있는 분기의 분기·월·파트 종합·개인 주차 기록과 달성률 요약을 `.xlsx` 한 파일로 받는다. 숫자는 화면·홈 KPI 와 같다.
- 쓰는 사람: 팀장(보고·회의 자료, PC), 파트장(자기 파트 필터, PC). 권한 제한 없음(OKR 결정 그대로). 폰은 "받아지기만" 하면 된다(열람은 PC 전제).

## 2. 기존 코드 재사용·확장 지점
| 무엇 | 파일:함수 | 쓰임 |
|---|---|---|
| exceljs 쓰기 패턴 | src/WalkingMap.tsx:exportExcel (2547~2599행) | `await import("exceljs/dist/exceljs.min.js")` 지연 로드(번들 분리), 머리행 굵게·남색 채움·가운데, `views:[{state:"frozen", ySplit:1}]`, `autoFilter`, 고정 열 너비, `writeBuffer → Blob → a.download`. 타입은 src/exceljs-browser.d.ts 그대로. 저장소 안 exceljs 사용처는 이 한 곳뿐 |
| 기간·행 읽기 | src/okr.ts: listOkrCycles · getOkrCycle · getOkrReports · monthsOfQuarter · quarterCycleId · weeksOfMonth · okrWeeksInMonth · listOkrResultIndex | 화면과 같은 로더 |
| 분기 표 | okr.ts:quarterRollup | 분기 탭 = 화면 OkrQuarterView 와 같은 값(byMonth CS 종합·분기 종합·manual 여부·byTeam) |
| 월 통합집계 | okr.ts:monthlyRollup(cycle, monthReports, quarter, weekReports) · alertMonths | 월 탭 = 화면 OkrMonthRollup 과 같은 값(dots set/suggest, cs, actionTeams, memo). 공통 행만 |
| 화면 목표 바탕 | okr.ts:monthScreenGoals · goalsForView · visibleGoals · overlayGoals · goalLayer | 파트 종합/주차 탭의 "그 탭에 보이는 행"과 달성기준 덮어쓰기 사슬(OkrHub 466~486행 teamGoalsOf·personGoalsOf 와 같은 순서) |
| 판정 정규화 | okr.ts:normalizeJudgment (미달성→미흡, 달성→완료) | 모든 판정 칸 |
| 달성률(새 정의) | src/kpi/kpiCompute.ts: okrMemberShares · okrShareAverage · okrTeamMembers · okrWeekMemberRows · judgmentCounts | 요약 탭. 팀 = 팀원별 평균, 미작성 0%, 판정 0 이면 null("미작성") — 홈 K19 와 같은 함수 그대로 호출(셈 새로 짜지 않음) |
| 명단 | src/authors.ts:fetchMembers + kpiCompute.ts:rosterFromMembers(members, {from: 월초, to: 월말}) | okrTeamMembers 의 roster(미작성자도 0% 로 잡히게) |
| 주차 id 옛 셈법 | OkrHub.tsx 안 `weekIdFor`(159행, 컴포넌트 안 클로저) | **화면은 이 규칙, 홈(kpiData 207행)은 정식 id(weekCycleId)만 읽는다** — 위험 R1. okr.ts 에 같은 규칙의 순수 함수 `resolveWeekCycleId(y,m,w,cycles,resultIds)` 를 **추가만**(OkrHub 는 이번에 안 고침) |

주의: `getOkrReportsIn` 은 header(목표 덮어쓰기·작성자)를 뺀 가벼운 조회라 **주차 탭에는 못 쓴다**(달성기준 덮어쓰기·header.author 필요). 주차는 `getOkrReports(weekId)` 를 주차마다 병렬(OkrHub loadWeekBook 과 같은 방식, 분기 약 14회). 요약 % 는 같은 결과를 재사용.

## 3. 데이터 설계
- **새 표·열·SQL 없음.** 읽기만: `okr_cycles`(분기 1 + 월 3 + 주 id 확인용 목록), `okr_reports`(월 3 × 파트 종합 행 + 주차 전부, select=*), 명단(fetchMembers).
- 조회량: Q4 기준 cycles 약 20행, reports 월 12행 + 주차 약 14주 × (파트 4 + 개인 약 16) ≈ 300행. 누를 때마다 GET 20회 안팎, 1~3초 예상.
- 흐름: 브라우저 안에서 끝(Supabase 읽기 → 순수 변환 → exceljs → 다운로드). GAS·outbox·worker 없음.

### 3-1. 범위
- 기본 = **화면 위 필터의 연도·분기**(지금 보는 분기. 월·주차 화면에 있어도 그 달이 든 분기 전체).
- 다른 분기는 필터를 바꿔 다시 누른다. "전체 기간"(분기 여러 개)은 1차에서 하지 않는다 — 8·9월은 옛 구조(OKR_LEGACY_UNTIL=2026-09, 분기 행·층 행 없음)라 같은 열로 못 담는다(Q2).
- 옛 구조 분기(2026 Q3 이전)를 보고 있으면 단추를 숨긴다(Q3).

### 3-2. 파일명
`OKR_2026Q4_2026-10-28.xlsx` = `OKR_{연}Q{분기}_{KST 오늘}.xlsx`. 날짜는 KST(UTC 날짜 실수 재발 방지 — 2026-10-19 감사 항목). 기존 KST 날짜 함수 재사용.

### 3-3. 탭(시트)과 열 — 시트 이름 31자 이하, 대괄호·콜론·별표·물음표·슬래시 없음
모든 탭 공통: 1행 머리(굵게·남색 채움·흰 글자·가운데), 1행 고정, autoFilter, 긴 글 열은 줄바꿈(wrapText)+위 정렬, 판정 칸은 판정별 채움색(미흡·미착수 연한 빨강, 부분달성 연한 노랑, 완료 연한 초록, 해당없음 회색 — 색값은 디자인실). 글은 평문(행의 html 글자색은 버림).

**탭 1 `요약`** (맨 앞)
- 위 블록(2열): 기간("2026년 4분기 (10~12월)") · 만든 시각(KST) · 만든 사람(작성자 선택값) · 셈 규칙 한 줄("개인 = 완료·해당없음 ÷ 판정 있는 목표, 팀 = 팀원 평균(미작성 0%), 판정 0 = 미작성 — 홈 KPI 와 같음").
- 팀 표: `파트 | 10월 % | 11월 % | 12월 % | 미흡 | 미착수 | 인원` + 끝 행 `CS 4파트(A~D)`. 월 % = 그 달 주차 전부로 okrShareAverage(okrMemberShares(w, team, roster, 그 달 주차 ids)) → 홈 K19 월 값과 같은 숫자. 판정이 하나도 없는 달 = "미작성"(0 아님). 아직 안 온 달 = "-".
- 개인 표: `파트 | 이름 | 10월 % | 11월 % | 12월 % | 작성 주차 n/지난 주차 | 미흡 | 미착수`. 사람 = okrTeamMembers(명단 ∪ 보고자, 팀장 제외). 판정 0 이면 0 + 옆에 "미작성".
- 분기 % 열은 넣지 않는다 — 홈에 분기 정의가 없음(Q4).
- % 칸은 숫자형(0~100 정수, 표시 서식만 %) — 팀장이 엑셀에서 다시 계산할 수 있게.

**탭 2 `분기 통합집계`** — quarterRollup 그대로, 화면 분기 표와 같은 행(보관 행 제외)
- 열: `번호 | Pillar | 병목현상 | 목표 | 달성기준 | 10월 CS | 11월 CS | 12월 CS | 분기 종합 | 분기 종합 출처(자동/직접) | 조치·확인 필요 달 | 결과·개선계획(메모)`.
- 메모 = quarter.feedback[no].memo. 조치 달 = alertMonths.

**탭 3 `월 통합집계`** — 세 달을 한 탭에(`월` 열), monthlyRollup(공통 행만 — 화면과 같음)
- 열: `월 | 번호 | Pillar | 병목현상 | 목표 | 달성기준 | A | B | C | D | CS 종합 | CS 출처(자동/직접) | 조치 필요 파트 | 결과·개선계획(메모)`.
- A~D 칸: 확정이면 판정 그대로, 제안(마지막 주차, 화면 ○)이면 `부분달성(제안)` — 엑셀엔 ○/● 가 없으니 글로 구분.
- 월 OKR 이 아직 없는 달(monthScreenGoals pending) = "n월 OKR 아직 없음" 1행.

**탭 4 `파트 종합`** — 한 탭, `파트` 열로 나눔(파트당 탭 아님 — Q1)
- 행 = 달 × 파트 × (그 파트 종합 탭에 보이는 행 = goalsForView({team}) = 공통 + 그 파트 전용, 보관 행 제외). 달성기준 = overlayGoals(월 공통 → 파트 종합 report.goals), 전용 행은 행 자체.
- 열: `월 | 파트 | 번호 | 행 구분(공통/파트 전용) | Pillar | 병목현상 | 목표 | 달성기준 | 실제결과 | 판정 | 사유 | 개선계획 | 근거자료 | 파트장 | 작성자 | 마지막 수정`.
- 파트장·작성자 = report.header.leader·author, 마지막 수정 = updated_at(KST) + updated_by. 기록 없는 파트-달은 목표만 두고 결과 칸 비움.
- 개인 전용 행은 넣지 않는다(화면 파트 종합 탭에도 없음).

**탭 5 `주차 기록`** — 한 탭, 개인 주차 전부(사람당 탭 아님)
- 행 = 달 × 주차 × 파트 × 사람 × (그 사람 탭에 보이는 행 = goalsForView({team, member}) = 공통 + 그 파트 전용 + **본인 전용**). 개인 전용 행은 그 사람 블록에만 들어가고, 요약 %에도 그 사람 분모로 들어간다(okrWeekMemberRows 와 같음).
- 달성기준 = 화면 주차 사슬 overlayGoals(월 공통 → 그 주 파트 행 report.goals → 본인 report.goals, keepEmptyCriteria=true), 전용 행은 행 자체(selfRows 규칙).
- 열: `월 | 주차("10월 3주 10/19~23") | 파트 | 이름 | 번호 | 행 구분(공통/파트 전용/개인 전용/보관) | Pillar | 병목현상 | 목표 | 달성기준 | 실제결과 | 판정 | 사유 | 개선계획 | 근거자료 | 마지막 수정`.
- 순서: 월 → 주차 → 파트 → 이름(가나다) → 화면 행 순서(goalsForView 의 Pillar·층 순).
- **보관 행(hidden)**: 화면에선 숨지만 홈 % 분모엔 들어간다(okrWeekMemberRows 는 visibleGoals 를 안 거침). 엑셀은 "보관" 표시로 **포함**해 요약 % 와 맞춰 볼 수 있게(Q5).
- **미작성**: 명단에 있는데 그 주 report 가 아예 없는 사람 = 판정 칸 "미작성" 1행만(목표 행을 다 펼치지 않음). report 는 있는데 판정 빈 행은 판정 칸 비움. 오늘 이후 시작 주차는 넣지 않는다(Q6).
- 주 단위 파트 행(주 report 의 파트 종합 행)은 화면에서 파트원 주차의 바탕일 뿐 따로 보는 화면이 없어 행으로 넣지 않는다.

**1차 제안(팀장)과 다른 점**: [파트별 A~D] 4탭 → `파트 종합` 1탭(파트 열), [주차(개인)] → `주차 기록` 1탭(이름 열). 이유 — 같은 층이면 열이 똑같아 쪼갤 이유가 없고, 팀장은 필터·피벗으로 자르며, 탭 수가 5개로 고정(사람 수·입퇴사에 따라 탭이 늘거나 이름이 흔들리지 않음). 파트장은 필터 한 번으로 "우리 파트만".

## 4. 화면 흐름
1. OKR 짙은 띠(OkrTopBand) 오른쪽, 연도·분기 선택 옆에 **[엑셀]** 단추 1개. 어느 탭·층에서 눌러도 같은 파일(보는 분기 전체).
2. 누르면 "만드는 중…"(비활성). 저장 대기 칸이 있으면 먼저 flushPending(막 적은 글이 빠지지 않게).
3. 읽기(분기·월·주차·명단 병렬) → 순수 변환 → exceljs 쓰기.
4. 다운로드 `OKR_2026Q4_2026-10-28.xlsx` + 토스트 "엑셀을 내려받았습니다 (주차 기록 n행)".
5. 실패: 토스트 "엑셀을 만들지 못했습니다: 이유" — 반쪽 파일 금지. 명단만 실패하면 보고자만으로 셈하고 요약 위 블록에 "명단을 못 읽어 보고자만 셈" 한 줄(kpiData 와 같은 처리).

## 5. 작업 분해 (겹치지 않게)
| 역할 | 할 일 | 건드릴 파일 |
|---|---|---|
| ui-designer(윤화면) | 단추 자리·모양(짙은 띠 계열, 폰에서 띠 줄바꿈 깨지지 않게), 엑셀 서식 명세(머리 색, 판정 채움 5색, 제안 표시, 열 너비 표 — 한글 1자≈2폭, 긴 글 열 40~50 + 줄바꿈, 고정 열 여부) → 이 문서 부록 A로 추가. 목업 1장(요약 탭 첫 화면) | 이 문서(부록)만 |
| db-schema(표다빈) | SQL 없음. MCP 로 Q4 okr_cycles 에 "같은 start_date, 정식 아닌 id" 주차 행이 있는지만 조회해 R1 근거를 부록 B로 | 이 문서(부록)만 |
| 구현 A(구현서) — 순수 | ① okr.ts 끝에 resolveWeekCycleId **추가만**(OkrHub weekIdFor 와 같은 규칙). ② 새 src/okrExcel.ts: buildOkrWorkbookData(input) → { fileName, sheets: [{ name, columns: [{header, width, kind}], rows: 2차원 배열(글·숫자·빈칸), notes }] } 순수 함수. 입력 = 분기 cycle, 월 cycles 3, 월 reports, 주차 reports(정식 id 로 맞춘 것), 달별 roster, today, by. 탭 빌더 5개(summarySheet·quarterSheet·monthSheet·partSheet·weekSheet) 각각 export. kpiCompute·okr 함수 import 만 | src/okr.ts(추가만), src/okrExcel.ts(새) |
| 구현 B(구현서) — 읽기·쓰기·단추 | ① 새 src/okrExcelExport.ts: loadOkrExcelInput(year, q)(로더 병렬, 주차 id 정식화, 하나라도 실패하면 throw) + downloadOkrExcel(year, q, by)(exceljs 지연 import, 서식 적용, 다운로드 — revokeObjectURL 은 setTimeout 뒤로). ② OkrHeader.tsx OkrTopBand 에 선택 prop onExport·exporting + 단추. ③ OkrHub.tsx 는 OkrTopBand 호출부 prop + flushPending 후 호출하는 핸들러 몇 줄만(다른 정리 금지). ④ docs/manual/user/11-okr.md "엑셀 내려받기" 절 | src/okrExcelExport.ts(새), src/OkrHeader.tsx, src/OkrHub.tsx(호출부만), docs/manual/user/11-okr.md |
| qa-checker(검수아) | build·test, 새 테스트 검토·보강, 실제 Q4 파일로 요약 10월 % 가 홈 K19(10월) 와 같은지 대조, PC 엑셀·안드로이드 크롬·아이폰 사파리에서 받아지는지 | tests/okrExcel.test.ts(새) |

구현 A·B 는 파일이 안 겹쳐 동시 진행 가능(B 는 A 의 입력·출력 타입을 먼저 받음). App.tsx 0줄. SQL 0.

### 테스트(tests/okrExcel.test.ts, 순수 함수 표본)
- 표본: 월 goals = 공통 3행(no 1~3) + C 파트 전용 1행(101, scope {team:"C"}) + 개인 전용 1행(102, scope {team:"C", member:"이민구"}) + 보관 공통 1행(4, hidden). C 파트 report 있는 2명(이민구·홍길동) + 명단에만 있는 1명(미작성자). 주차 2개.
- 기대
  1. 주차 탭: 이민구 행 = 1,2,3,101,102 + 4("보관"), 홍길동 행엔 102 없음, 미작성자는 주차마다 "미작성" 1행.
  2. 파트 종합 탭: C 행 = 1,2,3,101(102 없음, 4 없음), 다른 파트에 101 없음.
  3. 판정 혼합(완료·부분달성·미흡·미착수·해당없음·"달성"·"미달성"·빈칸) → 정규화 글자(완료·미흡)와 채움 종류.
  4. 요약 % = 같은 입력으로 kpiCompute.okrShareAverage(okrMemberShares(...)) 를 직접 부른 값과 같다 — 미작성자 0% 가 평균을 끌어내리는지 포함. 판정 0 인 달은 "미작성"(0 아님).
  5. 월 탭: 제안 칸 = "(제안)" 꼬리, 확정 칸 꼬리 없음, 공통 행만(101·102 없음).
  6. 파일명 (2026, 4, "2026-10-28") → OKR_2026Q4_2026-10-28.xlsx, 시트 이름 31자 이하·금지 글자 없음.
- 기존 tests/okrTeamAverage.test.ts·okrGoalLayersHome.test.ts·okrQuarter.test.ts 그대로 통과(셈 안 건드림 확인).

### 기록
- AGENTS.md 작업 기록, docs/eval/2026-Q4-worklog.md 한 항목(팀장 요청, 효과 = 보고 자료 손 복사 시간).

### 크기
**M** — 순수 변환 5탭 + 로더 + 서식 + 단추 + 테스트 6묶음 + 매뉴얼. SQL·권한·카톡 없음이라 위험은 낮음.

## 6. 위험·열린 질문
위험
- R1 주차 id 두 갈래: 화면은 weekIdFor(같은 시작 월요일의 옛 id 행이 있으면 그 행), 홈 KPI(kpiData)는 정식 id 만 읽는다. Q4 에 옛 id 주차 행이 남아 있으면 화면과 홈 % 가 이미 다를 수 있다. 엑셀은 **화면 규칙**으로 읽는다 → 홈과 다르면 홈 쪽 문제로 따로 보고. 표다빈 조회로 존재 여부 확인.
- R2 폰 다운로드: 기존 WalkingMap 은 click 직후 revokeObjectURL — 아이폰 사파리에서 빈 파일·무반응 가능. 새 코드는 revoke 를 늦춘다. 카톡 인앱 브라우저는 blob 다운로드가 막힐 수 있음 → "사파리·크롬으로 열어 주세요" 토스트(PC 전제 기능이라 그 이상 안 함).
- R3 exceljs 번들(약 900KB): 지연 import 라 OKR 첫 화면 크기 영향 없음(속도 기준 유지). OkrHub 에 정적 import 금지.
- R4 내려받는 중 다른 사람 편집: 서버 시점 값이 들어감. 내 미저장 글은 flushPending 으로 먼저 저장.
- R5 요약 명단 범위: 달마다 rosterFromMembers(range = 그 달) — 홈 지난달 보기와 같은 규칙.
- R6 주차 조회 약 14회 중 하나라도 실패하면 파일을 만들지 않는다(반쪽 파일이 숫자를 틀리게 보이게 함).

사용자에게 물을 것(한 번에)
- Q1 파트·사람을 탭으로 쪼갤까요, 열+필터로 둘까요? 제안: 탭 5개 고정(파트 종합 1탭·주차 기록 1탭, 파트/이름은 필터). 팀장이 "A파트 탭을 따로" 원하면 2차로 파트별 탭 추가.
- Q2 "전체 기간"(여러 분기)이 필요한가요? 제안: 1차는 보는 분기 하나.
- Q3 옛 구조(8·9월) 분기를 보고 있을 때 단추 숨김 vs 있는 만큼 내보내기? 제안: 숨김.
- Q4 요약에 "분기 %"를 넣을까요? 넣는다면 정의 — (가) 사람별 세 달 판정 합산 비율의 팀원 평균 (나) 세 달 % 단순 평균. 제안: 1차 생략.
- Q5 보관(지운) 행을 주차 기록에 "보관" 표시로 넣을까요? 제안: 넣음(홈 % 와 대조 가능).
- Q6 명단에 있으나 그 주 기록이 없는 사람을 "미작성" 1행으로 넣을까요? 제안: 넣음(지난 주차만).
- Q7 단추를 모두에게 보일까요(OKR 권한 제한 없음 결정 그대로)? 제안: 모두.

## 7. 하지 않을 것
- 엑셀 → OKR 가져오기(올리기). 기존 붙여넣기(OkrPasteModal)로 충분.
- 서버(엣지 함수·worker) 생성, 메일·카톡 자동 발송, 정기 내보내기.
- 셈법 변경(kpiCompute·okr.ts 집계 함수 수정 금지 — import 만, okr.ts 는 resolveWeekCycleId 추가만).
- OkrHub 의 weekIdFor 를 새 함수로 바꾸는 정리(별도 작업).
- 글자색(html)·RichCell 서식 재현, 인쇄 서식, PDF.
- 팀원 집계(사람 × 주차 점 매트릭스) 탭 — 주차 기록 탭 피벗으로 대신. 필요하면 2차.
