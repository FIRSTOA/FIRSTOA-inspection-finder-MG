# 홈 3차 — "팀 보드" 구현 지시서 (2026-10-25, 사용자 선택)

사용자(2026-10-25): "3안 팀 보드를 조금만 개선하면 될 것 같은데? 좋다" + "해당 목표 지표 누르면 상세하게 나오는 접기 부분도 맘에 들거든" + 앞서 "페이지에 여백이 없었으면", "OKR 도 그런 식(개인 드롭다운)이 아니라 그냥 C팀 누르면 이름 쭉".
목업: https://claude.ai/artifact/5aJDdddJM3jccr6tPPWvKQ 의 **H3(홈 3안 · 팀 보드)** + **B((나) 상태 타일)**. 설계 원칙·팀 색: docs/tasks/home-design-3-2026-10-24.md.
최종 결정(2026-10-25): 무채색안(H4) 보여 준 뒤 사용자 "색이 있는 게 낫겠다 진행해" → **팀 색 5가지(H3) 로 간다.** 단 원칙은 지킨다: 팀 색은 띠·배지·점에만, 본문 숫자·막대·타일 배경은 상태색만(색이 시끄럽다는 지적의 원인은 카드 본문까지 팀 색을 입힌 것 → 카드 본문은 무채색, 위 띠 4px + 팀명 글자만 팀 색).
공용 팀 색 모듈: `src/kpi/teamColors.ts`(팀장 작성, 둘 다 import 해서 쓴다 — 바꾸지 말 것).

## 화면 구성(위→아래, 여백 없이 틈 8px)
1. **머리 한 줄**(지금 띠 유지, 더 얇게): 날짜 · 분기 · 말일까지 영업일 · 기간 칩 · 오른쪽에 **큰 숫자 3개** "미처리 435 · OKR 72% · 분기 점검 68%" · 갱신 · [편집].
2. **팀 카드 5장**(A·B·C·D·CSS, 팀 색 위 띠 4px): 팀명·인원·지역 + 상태 알약(그 팀 주요 목표 판정 요약: 부족이 하나라도 있으면 부족, 전부 달성이면 달성, 아니면 순항) · 큰 숫자 3개(미처리·OKR 이번 주·정기점검 %) · 미니 KPI 타일 4개(블로그·오버홀·재계약·IT 퀴즈, 상태색 배경 + %) · **주의 한 줄**(실데이터: 가장 낮은 % 지표 + OKR 미작성 n명 + 가장 오래된 미처리 n일). CSS 팀은 OKR "—"(A~D 만). **카드를 누르면** 아래 달성표·미처리·OKR 이 그 팀으로 필터(다시 누르면 전체).
3. **KPI 달성표**(상태 타일): 머리줄 팀 색 띠 + 배지, 팀 칸 = 상태색 옅은 배경 타일 + 큰 % 18px + 아래 `실적/목표` 11px, CS 전체 실적 28px(폰 24) + % 알약 13px + 막대 h-2.5. 목표 없는 지표는 회색 타일 큰 숫자. **행 펼치기(RowDetail: 팀 막대→개인 칩→기준) 그대로 유지**(사용자가 좋아함). 폰: 카드 아래 5칸 미니 타일 띠.
4. **미처리 | OKR 반반**(2x2 유지):
   - 미처리: 팀 탭에 팀 색 점(min-h-11), 목록 줄 팀 글자는 배지, "오래된 순" 유지.
   - OKR: 범위 칩이 `전체 72% · A 83% · B 67% · C 50% · D 89%`(칩 안에 %), **팀 칩을 누르면 그 팀원 이름이 쭉**: 이름 · 막대 · % · 완료/부분/미흡/미착수 개수, 이번 주 보고 미작성은 빨간 점선 줄 "이번 주 보고 미작성 · 지난주 n%". 전체 칩이면 팀 4줄(팀 배지·막대·%·미작성 n명). **개인 드롭다운 삭제.** 주별 막대·링은 왼쪽 작은 칸에 유지(주/월 칩 유지).
5. 운영·시스템(접힘)·피드백·푸터는 그대로.

## 페이지 여백
- App.tsx 5256줄 컨테이너: `screen === "home"` 일 때 `max-w-none px-0 pt-0`(walkingMap 과 같은 꼴) — **App.tsx 는 이 한 줄만**(팀장 예외, CLAUDE.md "진입점 1~3줄" 규칙의 예외로 기록).
- Home.tsx/HomeKpiBoard.tsx 안쪽 px-4/sm:px-6 → px-2, 위젯 틈 gap 2 → 8px.

## 작업 분해 (파일이 겹치지 않게 — 같은 파일은 Edit 로 해당 함수만, Write 로 통째 금지)
| 담당 | 파일 | 내용 |
|---|---|---|
| 구현서P (opus) | src/kpi/KpiWidgets.view.tsx, src/kpi/homeKpiModel.ts 의 `okrView`·`OkrViewModel` 만, tests/homeKpiBoard.test.tsx 의 okr·table 테스트, docs/manual/user/02-home.md 달성표·OKR 절 | 3·4-OKR 항목. KpiOkrView/KpiOkrScope 타입을 "팀 칩 + 팀원 목록" 모양으로 바꾸고(member 드롭다운 제거, `people: Array<{name, pct, counts, missing, prevPct}>` 추가), OkrBody 재작성, TeamCell→타일, 머리줄 팀 색, CsSummary 크기, 폰 5칸 띠. 숫자 계산 함수(okrWeekResult·okrWeekMembers·kpiCount)는 바꾸지 않음 — 뷰 모델에서 조합만. |
| 구현서Q (opus) | 새 src/kpi/teamBoard.ts(모델)·src/kpi/TeamBoard.view.tsx, src/HomeKpiBoard.tsx(팀 카드 띠를 HomeKpiGrid 위에 그림 + 팀 필터 상태를 위젯에 전달), src/kpi/HomeUnhandledPanel.tsx(팀 탭 점·배지·팀 필터 수신), src/Home.tsx(머리 띠 큰 숫자 3개·px), src/App.tsx(한 줄), tests/teamBoard.test.ts, docs/manual/user/02-home.md 팀 카드 절 | 1·2·4-미처리·여백 항목. 팀 카드 숫자는 이미 있는 번들(kpiCount/tableRows/unhandledParts/okrView)에서만 조합 — 새 조회 없음. |

팀 필터 전달 계약(둘이 공유): HomeKpiBoard 가 `teamFilter: TeamKey | null` 상태를 갖고, KpiTableView 에 `teamFilter?: TeamKey | null`(P: 그 팀 칸만 강조·다른 팀 칸 흐리게 opacity-40, 전체 열은 그대로), KpiOkrView 초기 scope 를 그 팀으로, HomeUnhandledPanel 에 `team` prop. P 는 `teamFilter` prop 을 받기만 하면 되고(없으면 지금처럼), Q 가 넘긴다.

## 바꾸지 않을 것
숫자 로직·원본 함수(countForms·kpiCount·okrWeekResult·mergeUnhandled), 위젯 4개 구성·배치 저장 v3, 이동 단추 없음(SHOW_OPEN_LINKS=false), 금일 현황 숨김, 상태 판정·상태색, 행 펼치기 RowDetail, 운영·시스템/피드백/푸터.

## 끝 기준
tsc 0 · vitest 전부 · build · 바뀐 파일 eslint 0 · 폰 390px 가로 스크롤 없음(코드로 확인) · 숫자 불변 테스트 그대로 통과.
