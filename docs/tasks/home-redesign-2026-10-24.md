# 홈 전면 개편 지시서 (2026-10-24, 팀장 클로드 책임)

사용자 지시(2026-10-24 아침, 사진 8장 + 11개 항목): "홈이 무거우면 다른 방법을 세워라 … 팀장이 되어 전적으로 책임지고 최고의 홈 UI를 디자인·구조 전면 개편." 설계안 확인 없이 진행(사용자 "실시!").
속도 원인은 같은 날 오전 82c0179 로 이미 고침(1초 시계·계산 캐시·첫 로드 2단계). 이 지시서는 **구조·디자인** 개편이다.

## 원칙
1. 숫자는 하나의 함수(workCount·kpiCompute). 이 개편에서 셈법을 바꾸는 것은 ⑥ 오버홀 제외 범위와 ⑦ OKR 주 단위뿐.
2. 홈 = **KPI 달성표가 주인공**. 나머지는 미처리(해야 할 일)와 운영 상태뿐. 장식·중복 위젯은 없앤다.
3. 첫 화면은 가벼운 원본으로 먼저 그린다(firstLoadPhases 유지). 폰 390px 에서 가로 스크롤 없음.
4. App.tsx 무변경. 새 표는 SQL 실행 전엔 "준비 중"으로 동작.

## 없애는 것 (사용자 1·2·4·6·11)
- 관제 덱 머리(큰 시계·날짜·인사말·알약 4개) → **한 줄 머리**로 교체: `10월 24일(토) · 44주차 · 4분기 · 갱신 방금` + 오른쪽 [편집] (Home.tsx). LiveClock·useClock(1초) 삭제, 홈 본체 시각은 60초 유지.
- 위젯 삭제: 점검(이번 주 spark K1)·AS(이번 주 spark K3)·PC·복합기 확장성(exp)·초과사용 제안 방문(K10)·재계약 확인 지남(K12 — 미처리 카드 한 줄로 흡수)·"미처리 요약"(unhandled, 숨김 상태였음).
- 운영·시스템 블록: "데이터 자산" Metric 삭제. IMPACT 절약 추정은 유지하되 블록 맨 아래로.
- HomeWidgetId 는 `today | K2 | table | unhandledPanel | receptionPanel | K19` 6개만 남긴다. 옛 저장 배치(home_kpi_layout_v1)에 남은 id 는 readHomeLayout 이 버린다(이미 그렇게 동작 — 테스트로 고정). 배치 버전은 올리지 않는다.

## 남는 위젯과 새 모양
### ① 금일 현황 띠(today) — 그대로. 단 맨 왼쪽에 "오늘" 날짜 작은 글자.
### ② 분기 점검 진행(K2) — **팀별만** (사용자 2)
- CS 전체 줄·전체 큰 숫자 삭제. 팀 5줄(A·B·C·D·CSS) 각각: `팀 | 완료/대상 | % 막대(점선 = 기간 경과) | 필요 n/일·인 → 지금 n/일·인`(그 팀 인원 기준, workinPace 를 팀별로).
- 말일/말일 10일 전 두 기준은 머리 칩으로 전환(기본 말일). 발밑 "숫자 기준" 한 줄 유지, [워킨맵 →].
- 크기 2x1 기본(4x1 가능).
### ③ KPI 달성표(table) — **주인공** (사용자 3·4)
- 기본 크기 4x2(전체 폭), 카드 머리 크게 "KPI 달성표 · 이번 주" + 기간 칩(주/월/분기) + [주요 목표 n]/[전체 지표 n].
- 행: 지표명(단위·목표 근거 작은 글자) | 상태 알약(달성·순항·부족·미착수 — 페이스 대비: 실적/목표 ≥ 기간 경과 비율이면 순항) | CS 전체 큰 숫자 `실적/목표` + 막대(페이스 점선) | A·B·C·D·CSS 칸(숫자 + 얇은 막대, 색 = 상태).
- **행 펼치기(사용자 4 "접기쪽에 표현")**: 펼치면 그 지표의 ⓐ 팀별 가로 막대(실적/목표/%) ⓑ 개인 칩(이름 실적/목표, 달성 초록·부족 빨강, 팀별 묶음, 실적 내림차순) ⓒ 숫자 기준 한 줄 + [화면 열기 →]. PC확장성·초과 박스가 하던 일을 여기서 한다.
- 목표 없는 지표(전체 지표 보기)는 실적만 크게, 추세 화살표(지난 기간 대비).
- 원본 연결 필요(IT 실습·퀴즈, SQL 전)는 회색 알약 "준비 중 · SQL 실행 대기" — 숫자 0 금지.
- 폰(md 미만): 표 대신 **지표 카드 목록**(지표명·상태·CS 숫자·막대, 탭하면 펼침). 지금처럼 숨기지 않는다.
### ④ 미처리 — 카드 하나로 합산 (사용자 5·6)
- receptionPanel(미처리 접수 카드)을 **"미처리 전체 n건"** 카드로: 큰 숫자 = 접수 미처리 + 물류 미처리 + 재계약 확인 지남. 아래 줄: `접수 27 · 물류 44 · 재계약 확인 지남 0`. 그 아래 접수 종류별(복합기 AS·원격·IT·경영·운영·영업) 작은 칸은 유지, 가장 오래된 건 한 줄 유지. 크기 2x1.
- 재계약 확인 지남 정의(사용자 6 "뭘까"): 재계약 표에서 업체별 마지막 기록의 "다음확인일"이 오늘보다 지났는데 최종상태가 갱신완료·종료가 아닌 곳. 카드 안 ⓘ 설명에 이 문장을 그대로.
- unhandledPanel(팀 탭 미처리 일정)은 그대로 2x2.
### ⑤ OKR(K19) — **주 단위** (사용자 7)
- period 기본 "week": 이번 주 okr_cycles(kind week) 보고서의 판정으로 달성률. 칩 [이번 주]/[이번 달]. 아래 작은 **주별 막대 4개**(이번 달 1~n주차 달성률) — 프로들이 주만 쓰므로 주가 목표.
- 셈법은 okr achievementRate·judgmentCounts 그대로, 입력 cycle 만 주간으로. 이번 주 보고서가 없으면 "이번 주 OKR 미작성 n팀" 표시(0% 아님).
### ⑥ 오버홀(K33) 제외 범위 (사용자 8)
- 집계·목표 인원 모두에서 `cs_members.title ∈ {팀장, 파트장, 부파트장}` 제외. kpiCompute 의 팀장 제외 규칙을 "직책자 제외"로 확장하되 **오버홀에만**(다른 KPI 는 팀장만 제외, 기존 그대로). 사용자 데이터 할 일: cs_members 에 파트장 호칭이 비어 있음(지금 부파트장 3명·팀장 1명만) → 관리 탭 인원에서 파트장 4명 호칭 입력 필요(코드가 아니라 데이터).
### ⑦ IT 퀴즈·실습 원본 (사용자 3)
- 새 표 2개(SQL: supabase/it-learning-logs-20261024.sql, sql-review 뒤 /sql-handoff):
  - `it_quiz_attempts(id, author, kst_date, level, total, score, created_at)` — IT 학습 › 기술 퀴즈 완료 화면에서 1행 insert(ItLearningHistory.tsx, 작성자 = 기기 선택 작성자, 없으면 저장 안 하고 안내).
  - `it_practice_logs(id, author, kst_date, title, memo, photo_url, created_at)` — IT 학습 탭 상단 [실습 기록] 작은 양식(제목 한 줄 필수·메모·사진 1장 선택). 자동 기록은 불가(사용자도 인지) → 1분 입력으로 최소화.
  - RLS: anon select/insert 만, update/delete 없음. 되돌리기 주석.
- 로더 `src/itLogs.ts`: `loadItQuizAttempts(from,to)`, `loadItPracticeLogs(from,to)` → `{author, date}[]`; 표 없으면(404/42P01) `missing`. K34 = 주당 시도 수(인당 목표 2), K21 = 주당 실습 수(인당 목표 1). kpiDefs status unlinked → ready, loads ["itQuiz"] / ["itPractice"](FAST_SOURCES 에 넣음).
### ⑧ 오늘 전송 흐름(LiveSendBoard) (사용자 9)
- 머리 숫자를 **"봇 n건 · 노트북 n건"** 으로(지금은 작은 칸). 아래 방 목록 각 줄 끝에 누가 배달했는지 아이콘(📱/💻) + 건수. 15초 폴링 유지.
### ⑨ 시트 동기화 실패 n (사용자 10) — 코드 변경 없음
- 감시연 조사: 실패 2건 = 10/19 15:22 접수 복합기 퍼스트순 14951 "행 없음"(업데이트 전용 작업, 시트에서 그 행이 지워진 듯). 재시도 5회 끝. 7일 창 지나면 자동 0. 홈 칩에 "n일 전 · 자세히는 관리 탭" 작은 글자만 추가.

## 파일 담당 (동시 작업, 파일 겹치지 않게)
- **윤화면(ui-designer)**: src/kpi/KpiWidgets.view.tsx(③ 달성표 새 모양·행 펼치기·폰 카드 목록, ② 팀별 진행 뷰, ④ 합산 카드 뷰 — 뷰 타입 변경은 아래 모델 타입에 맞춤), src/kpi/HomeKpiGrid.view.tsx(크기 4x2 추가). 뷰 타입(KpiTableRow 에 `status`, `people`, `teamBars`; KpiQuarterGoalView 팀별만; KpiUnhandledTotalView 신설)은 윤화면이 KpiWidgets.view.tsx 안에 선언하고 구현서A 가 채운다.
- **구현서A(developer, opus)**: src/kpi/homeKpiModel.ts(위젯 6개·기본 배치·뷰 빌더), src/HomeKpiBoard.tsx, src/Home.tsx(한 줄 머리·데이터 자산 삭제·시계 삭제), src/kpi/kpiCompute.ts(⑥ 직책자 제외·⑤ 주간 OKR·② 팀별 페이스·③ status/people), src/kpi/kpiDefs.ts(K12 widget 제거·K19 week·K21/K34 ready 로더 이름), src/kpi/kpiData.ts(itQuiz/itPractice 원본 — src/itLogs.ts 의 함수 시그니처만 믿고 호출), src/LiveSendBoard.tsx(⑧), src/HomeReceptionPanel.tsx(④ 합산). 테스트: tests/homeKpiBoard.test.tsx·kpiCompute.test.ts 갱신 + 옛 배치 id 버림 테스트.
- **구현서B(developer)**: src/itLogs.ts(로더 + insert 함수, 표 없음 → missing), src/ItLearningHistory.tsx(퀴즈 완료 insert, [실습 기록] 양식 — 작은 컴포넌트 src/ItPracticeForm.tsx 로 분리), tests/itLogs.test.ts. 사진은 기존 업로드 래퍼(src/supabase.ts uploadPhoto 류) 재사용.
- **표다빈(db-schema)**: supabase/it-learning-logs-20261024.sql(표 2개·RLS·인덱스(author, kst_date)·되돌리기) + cs_members 호칭 현황 한 줄.
- 끝: 검수아 QA → 배포준 → 커밋 `투입:` → 라이브 확인 → 매뉴얼 user/02(전면 교체)·user/13(IT 학습: 퀴즈 기록·실습 기록)·14(관리: 호칭 입력) → AGENTS.md·eval.

## 건드리지 말 것
- src/App.tsx, src/api.ts, src/workCount.ts, src/expansionSource.ts, HomeUnhandledPanel.tsx(이번엔 그대로), supabase/functions/*.
