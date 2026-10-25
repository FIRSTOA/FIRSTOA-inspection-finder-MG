# OKR 행의 소유 층(공통·파트 전용·개인 전용) — 설계안 (2026-10-25 저녁, 기획실 한설계, 조사만·코드 0)

사용자: "행을 추가하면 모든 A~D 파트에 같이 생성된다는데? 파트별로 다를 수 있고 파트 안에서도 개인별로 다를 수 있는데 이렇게 하면 어떻게 해."
앞 설계: docs/tasks/okr-rows-add-remove-2026-10-25.md(오전, 공통 행 + 보관) · 오후 4 작업(파트 탭 추가 = 공통 행, "공통 비면 공통 저장").

## 1. 목표와 쓰는 사람
- 한 줄: OKR 병목·목표 **행마다 주인(층)** 을 둔다 — 공통(팀장 문서, A~D 전부)·파트 전용(그 파트만)·개인 전용(그 사람만). 추가한 화면이 곧 주인이다.
- 쓰는 사람: 팀장(통합집계·분기, PC) = 공통 행, 파트장(파트 종합, PC) = 파트 전용 행, 파트원(주차, PC·폰) = 개인 전용 행.

## 2. 지금 구조에서 확인한 사실 (코드)
- 행 = `okr_cycles.goals[]` 원소(`src/okr.ts:44 OkrGoal`). 파트·개인은 `okr_reports.header.goals` 로 **같은 번호 칸의 글만 덮는다**(`okr.ts:972 overlayGoals` 는 `base.map` — 바탕에 없는 번호는 버림). 즉 층은 지금 "행을 만들 수 없는" 구조다.
- 파트 탭 추가도 `OkrHub.tsx:900 rowOps: freshGoalOps` → `write(goalCycle.goals)` = 공통 행. 확인창 문구 `okrGoalConfirm.ts:6` "모든 파트(A~D)·주차 화면에 같은 행". 사용자가 본 게 이것.
- 판정은 번호(no)로만 붙는다: 월 파트 종합 report(member 빈칸)·주차 개인 report(member 이름)의 rows[].no.
- 홈: `kpiData.ts:195` goals = `monthScreenGoals(달, 분기).goals` 전부 → `kpiCompute.ts:741 okrWeekTeamRows` 가 **모든 행 × 그 팀** 으로 판정 행을 만들고 `achievementRate`(판정 없는 행은 분모 제외)로 % 를 낸다. `:765 okrWeekMemberRows` 도 모든 행 × 그 사람.
  → 번호가 전역에서 안 겹치면 다른 파트 전용 행은 그 팀 판정이 없으므로 **% 에는 지금도 0 영향**. 다만 `okrKpi extra.goals`(행 수)·파트 탭 `count n/총`(`OkrHub.tsx:964`)·카드 "판정 n/총" 분모는 틀어진다.
- 주차 개인 report 는 **주마다 따로**(cycle_id = `2026-10-W3`). 개인 행을 그 report 에 두면 다음 주에 사라진다.

## 3. 데이터 설계 — 두 안 비교, 추천 A (SQL 0)
| | A. `okr_cycles.goals` 원소에 `scope` | B. `okr_reports.header.goals` 에 행 |
|---|---|---|
| 저장 위치 | 그 달 월 행(goalCycle) 하나 | 파트 = 월 파트 종합 report, 개인 = **주차** report(주마다) |
| 번호 전역 유일 | 한 배열 + 분기·세 달 max 로 바로 | 4파트 × 인원 × 주차 report 를 모두 읽어야 max |
| quarterRollup·monthlyRollup | 공통만 거르는 필터 1개 | 영향 없음(애초에 안 보임) — 대신 파트 카드에 넣으려면 report 마다 따로 읽기 |
| 홈 okrWeekResult | goals 한 벌을 팀·사람별로 거르기 | 주차 report 마다 header.goals 를 바탕에 붙이는 새 사슬 |
| 11·12월 복사(blankGoalsLike) | 분기엔 층 행이 없으니 영향 0(층 행은 달마다) | 영향 0 |
| 팀장 문서 붙여넣기(통째 교체) | **층 행을 지키는 규칙 필요**(3-2) | 영향 0 |
| 개인 행이 주마다 이어지나 | 그 달 모든 주차에 그대로 | 매주 다시 만들거나 전주 불러오기 확장 |
| overlayGoals(덮어쓰기 사슬) | 그대로(층 행도 바탕에 있으니 달성기준·목표 덮어쓰기 가능) | base.map 구조를 바꿔야 함(바탕에 없는 행 붙이기) |

- **추천 A.** 붙여넣기 등 "통째 교체" 계열만 막으면 되고, 롤업·홈·주차 연속성·덮어쓰기 사슬은 거르는 함수 하나로 끝난다. B 는 개인 행이 주마다 끊기는 게 치명적.
- 모양: `OkrGoal.scope?: { team: OkrTeam; member?: string }` — 없음 = 공통, `{team}` = 파트 전용, `{team, member}` = 개인 전용(이름만이 아니라 팀까지 — 동명이인·이동 대비). `normalizeGoals`(`okr.ts:336`)가 scope 를 통과시키게(hidden 과 같은 한 줄).
- 사는 곳: **월 행만**. 분기 행(`2026-Q4`)에는 층 행을 만들지 않는다(분기 표 = 통합집계 전용).
- 번호: 전역 max+1 유지. `freshGoalOps.linkedNos`(`OkrHub.tsx:638`)를 달일 때 "분기 goals" → **"분기 goals + 그 분기 세 달 goals 전부(층 행 포함)"** 로 넓힌다. 그리고 **층 행은 101번부터**(공통은 지금처럼 1부터) — 팀장 문서 붙여넣기는 늘 1~9 번호라, 공통 행을 지워 max 가 내려간 뒤 생긴 층 행과 붙여넣기 번호가 부딪히는 경우를 원천 차단. 띠 안에서는 전역 max+1, 겹침 없음.
- 판정·기록: 그대로 rows[].no. 파트 전용 행 판정 = 그 파트 종합 report·그 파트원 주차 report, 개인 전용 행 = 그 사람 주차 report 에만 생긴다. 표 변경 없음.

### 3-1. 거르는 함수 (okr.ts, 새로)
- `goalLayer(g)` → "common" | "team" | "member"
- `goalsForView(goals, { team?, member? })` — 통합집계(둘 다 없음) = 공통만 / 파트 종합(team) = 공통 + 그 파트 전용 / 파트원(team, member) = 공통 + 그 파트 전용 + 본인 전용.
- `goalsForTeamTotal(goals, team)` = 공통 + 그 파트 전용 + **그 파트 사람들의 개인 전용 전부** — % 집계·팀원 집계용.
- `layerRowsOf(goals)` = scope 있는 행(통째 교체 때 보존할 것).
- `replaceCommonGoals(current, nextCommon)` = nextCommon + current 의 층 행(번호 그대로). 통째 교체는 전부 이걸 거친다.

### 3-2. 고칠 기존 함수 (공통만 보게)
- `monthlyRollup`(`okr.ts:807`) visibleGoals(effectiveGoals) 에 공통 필터 추가. quarterRollup 은 분기 goals 바탕이라 그대로, 분기가 비었을 때의 달 합치기(`:942`)만 공통 필터.
- `isLeaderGoals`(`:595`)·`goalsAreFromQuarter`(`:618`) — **공통 행 글만** 센다(파트 행에 글이 있다고 그 달이 "팀장 월 OKR 있음"으로 바뀌면 안 됨).
- `monthScreenGoals`(`:612`)·`effectiveGoals`(`:602`) — 분기 글·빈 틀을 대신 보여 줄 때도 그 달의 층 행은 뒤에 붙인다(공통 바탕 + layerRowsOf(cycle.goals)). 안 하면 11·12월(copy)에서 파트 행이 화면에서 사라진다.
- `applyPastedGoals`(`:755`)·`blankGoalsLike`(`:543`) — 층 행을 건드리지 않음. OkrHub 의 applyPaste(pasteBase `:691`)·[3 × 3 빈 틀](onTemplate `:926`·`:934`)·copyGoalsFrom(`:677`)·startFromQuarter(`:703`)·copyPrevQuarter(`:715`)는 replaceCommonGoals 로. restoreGoals 는 goals_prev 가 층 행까지 든 한 벌이라 그대로.

## 4. 화면 규칙과 흐름
| 어디서 [＋ 병목 추가] | 생기는 행 | 확인창 문구 |
|---|---|---|
| 분기 표 | 공통(분기) | 지금 그대로(ADD_QUARTER_GOAL_MESSAGE) |
| 월 통합집계 | 공통(그 달) | "새 공통 병목 행을 추가할까요?\nA~D 모든 파트와 파트원 주차 화면에 같은 행이 생깁니다." |
| 파트 탭 › 파트 종합 | 그 파트 전용 | "A파트 전용 병목 행을 추가할까요?\nA파트 종합과 A파트원 주차 화면에만 생깁니다. 다른 파트·통합집계 표에는 보이지 않습니다." |
| 파트 탭 › 파트원(주차) | 그 사람 전용 | "홍길동 님 전용 병목 행을 추가할까요?\n홍길동 님의 10월 모든 주차에만 생깁니다. 다른 사람 화면엔 없고, 파트 종합에는 접혀 보입니다." |
| 팀원 집계 | 추가 단추 없음 | — |

흐름
1. 파트장이 A파트 탭 › [파트 종합]을 연다 → Pillar 묶음 끝 [＋ 병목 추가](옆 글 "A파트 전용").
2. 확인창 → 행 생김(번호 101+, 병목현상 칸 위 작은 칩 "A파트 전용"), 커서가 병목현상 칸으로.
3. 글을 적으면 그 행 자체(`okr_cycles.goals`)에 저장 — 덮어쓰기 아님(주인이니까).
4. A파트원이 자기 주차를 열면 그 행이 보이고 판정을 적는다. 파트원은 자기 주차에서 [＋ 병목 추가] = "내 전용".
5. 통합집계(월) 표에는 공통 행만, 표 아래 회색 접힘 "파트 전용 n행 · 개인 전용 m행 [보기]" — 펼치면 파트·이름별 목록(읽기, 누르면 그 파트 종합/그 사람 주차로 이동).
6. 파트 종합 표에는 공통 + A 전용, 그 파트 사람들의 개인 전용 행은 표 아래 접힘 "개인 전용 m행(홍길동 2·김철수 1) [보기]"(판정은 % 에 들어감).
7. 팀원 집계(MonthTeamSummary)는 goalsForTeamTotal — 개인 전용 행은 그 사람 칸에만 값, 다른 사람 칸은 빗금(해당 아님).

덮어쓰기 사슬(아래 층이 달성기준·목표 글을 고치는 overlayGoals)은 공통·파트 전용 행에 그대로 동작한다(파트원이 A 전용 행의 달성기준을 자기 것으로 고치기 가능).

## 5. 삭제·보관 — 그 층에서만
- × 단추는 **지금 화면의 층이 주인인 행에만**: 통합집계 = 공통 행, 파트 종합 = 그 파트 전용 행, 파트원 = 본인 전용 행. 파트 탭의 공통 행에는 × 없음(오후 4 작업의 "행 삭제(모든 파트 공통)" 제거). 파트원 화면의 파트 전용 행에도 × 없음.
- 빈 행/글만/기록 있음(보관) 세 갈래·확인창은 오전 설계 그대로(confirmRemoveGoalRow). 기록 확인 범위(recordsOf)도 지금과 같이 그 달 월·주차 기록 전부(번호가 전역 유일이라 충분).
- 보관된 층 행은 그 층 표 아래 "보관된 병목"에만 보이고 그 층에서 되살린다.

## 6. 홈 OKR 영향 (kpiCompute)
- 지금 okrWeekTeamRows(w.goals, …, team) 는 모든 행을 그 팀으로 돈다 → **% 는 이미 맞다**(남의 전용 행엔 판정이 없어 분모에서 빠짐). 틀어지는 건 "행 수" 표시, 그리고 행 주인을 나중에 바꾼 경우 남은 엇갈린 기록이 끼는 것.
- 바꿀 것: okrWeekTeamRows 에 goalsForTeamTotal(goals, team) 한 줄, okrWeekMemberRows 에 goalsForView(goals, {team, member}) 한 줄, okrTeamRows(월 K19)·okrKpi extra.goals 도 팀별 거르기. 보관 행(hidden)은 지금처럼 포함(지난 주 % 불변).
- ALL(CS 4파트) % = 네 팀 행 합 — 팀마다 행 수가 달라도 "판정 있는 칸 중 완료·해당없음" 그대로.
- 통합집계 파트 카드·파트 탭 count n/총도 goalsForTeamTotal(홈과 같은 분모). 통합집계 **표**는 공통만이라 카드 숫자와 표 줄 수가 다를 수 있어 카드에 "(전용 n행 포함)" 작은 글.

## 7. 오후 규칙("공통 칸이 비면 공통 행에 저장") — **폐기**
- 그 규칙(okrGoalConfirm.ts:36 goalEditTarget + OkrHub.tsx:630 commonEditRef·:873 writeTeamGoal 의 common 분기)은 "파트 탭에서 추가한 행 = 공통 행"이라서 필요했다. 이제 파트 탭에서 추가하면 그 층이 주인이라 이유가 사라진다. 남겨 두면 팀장이 아직 안 채운 공통 행에 파트장이 적은 글이 A~D 전부에 퍼진다 — 사용자가 이번에 싫다고 한 바로 그 동작.
- 새 규칙(2갈래): 그 행이 **지금 층 소유**면 → okr_cycles.goals 의 그 행을 직접 고친다(onGoal) · 위 층 행(공통, 또는 파트원이 보는 파트 전용)이면 → 그 층 header.goals 덮어쓰기(4차 그대로). 파트 탭에서 공통 행 자체를 고치는 길은 없앤다.
- 정리할 데이터: 오늘 오후 파트 탭에서 만든 행은 이미 **공통 행**으로 저장돼 있다. 배포 전 MCP 로 okr_cycles(2026-10, 2026-Q4).goals 의 no 10 이상 행을 읽어 목록을 사용자에게 보이고 Q1 로 묻는다. 옮기기는 scope 만 붙이면 되고(번호·기록 그대로) 일회성 SQL 1장(sql-review 거침) 또는 화면에서 지우고 다시 추가.

## 8. 작업 분해 (겹치지 않게)
| 담당 | 파일 | 할 일 | 크기 |
|---|---|---|---|
| ui-designer 윤화면 | src/OkrCells.tsx | LayerChip("A파트 전용"/"내 전용"/"홍길동"), LayerRowsFold(통합집계용·파트 종합용 문구), AddGoalRow note 문구 | 약 50줄 |
| db-schema 표다빈 | 없음(SQL 0) | MCP 읽기: 2026-10·2026-Q4 goals 번호와 오후 추가 행 목록, 옛 앱 저장 창(R2) 판단, Q1 답 나오면 scope 붙이는 SQL 1장 | 확인만 |
| 구현서 A | src/okr.ts, src/okrGoalConfirm.ts | scope 타입·normalizeGoals 통과·3-1 함수 5개·addGoalRow(…, scope?)(층 행 101+)·3-2 고침·mergeGoals 추가 합집합+번호 재발급(R1)·addGoalMessage(layer, who)·goalEditTarget 를 own/layer 로(sticky 제거) | 약 110줄 |
| 구현서 B | src/OkrHub.tsx, src/OkrMonthRollup.tsx | freshGoalOps → 층을 받는 ops(view): onAdd scope·linkedNos 분기+세 달·onRemove 주인 층만; teamGoalsOf/personGoalsOf 에 goalsForView, 팀원 집계·탭 count 에 goalsForTeamTotal; writeTeamGoal 2갈래·commonEditRef 삭제; 통째 교체 5곳 replaceCommonGoals; TeamView × 는 ownsRow 일 때만 + 칩·접힘; OkrMonthRollup 표 = 공통만 + 접힘 | 약 90줄 바뀜 |
| 구현서 C | src/kpi/kpiCompute.ts | okrWeekTeamRows·okrWeekMemberRows·okrTeamRows·okrKpi 행 거르기 | 약 15줄 |
| 구현(같이) | docs/manual/user/11, docs/eval/2026-Q4-worklog.md | "행의 주인" 절, 평가 기록 | — |
| qa-checker 검수아 | tests/okrGoalLayers.test.ts(새로), tests/okrGoalRows.test.ts(⑦⑧ 고쳐 씀) | 아래 6건 + build·test | — |

테스트 6건
1. 파트 종합에서 추가 → scope {team:"A"}, no ≥ 101, 분기·세 달 번호와 겹치지 않음. 동시 추가(같은 번호 두 개)를 mergeGoals 가 합치고 하나를 새 번호로.
2. goalsForView: 통합집계 = 공통만, B파트 종합엔 A 전용이 안 보임, 파트원은 본인 전용만(같은 팀 다른 사람 것 안 보임).
3. monthlyRollup·quarterRollup 결과 행 = 공통만(층 행 추가 전후 같음).
4. okrWeekResult: A 전용 행에 A 판정 "미흡"을 넣으면 A·ALL % 만 바뀌고 B 는 그대로, member 범위는 본인 전용 포함·남의 전용 제외.
5. applyPastedGoals·replaceCommonGoals(3 × 3 빈 틀·분기로 시작·다른 달 가져오기)가 층 행과 그 번호를 지킨다. isLeaderGoals 는 층 행 글만 있으면 false.
6. normalizeGoals 왕복 scope 유지 + 오후 ⑦⑧(공통 비면 공통 저장)를 "own 이면 행 직접, 아니면 층 덮어쓰기"로 고쳐 씀.

## 9. 위험
- R1 동시 추가 번호 겹침: A·B 파트장이 같은 순간 추가하면 둘 다 max+1. 지금 mergeGoals(okr.ts:416)는 번호 구조가 다르면 "내 것"이 통째로 이겨 남의 새 행이 사라진다(공통 행만 있을 땐 팀장 혼자라 드물었지만 이제 4파트+파트원이 동시에 만든다). → 테스트 1과 함께 구현 A 에서 고친다(새 행은 기록이 없어 번호 재발급이 안전).
- R2 배포 중 열려 있던 옛 앱이 goals 를 저장하면 scope 가 지워져 **전용 행이 공통 행으로 바뀌어 A~D 전부에 보인다**(기록 손실 없음, hidden 때보다 눈에 띔). → 배포 직후 "OKR 새로고침" 공지, 다음 날 MCP 로 scope 개수 확인.
- R3 사람 이름이 키: 개인 전용 행 {team, member} 는 이름 문자열이다. 이름을 고치거나 파트를 옮기면 아무 화면에도 안 보이는 고아 행이 된다. → 통합집계 접힘 목록에 "주인 없음(명단에 없는 이름)" 묶음으로 드러내고 [보관] 단추.

## 10. 사용자에게 물을 것 (한 번에)
- Q1 오늘 오후 파트 탭에서 만든 행(지금 공통으로 저장됨) — 만든 파트 전용으로 옮길까요, 공통으로 둘까요? (배포 전 목록을 보여 드림)
- Q2 다음 달로 넘어갈 때 파트·개인 전용 행도 이어 갈까요? 제안: 자동 복사는 안 하고, 다음 차에 파트 종합·파트원 화면 [지난달 전용 행 가져오기] 단추.
- Q3 통합집계 파트 카드·홈 팀 % 에 전용 행 판정을 넣을까요? 제안: 넣는다(팀이 실제로 하는 일 전부). 아니면 "공통 행만"으로 파트끼리 같은 잣대.

## 11. 하지 않을 것
- 분기 표의 층 행, Pillar 개수 변경, 행 순서 이동, 권한 제한(누구나 자기 층에 추가 — 지금처럼), 표 변경 SQL, 2026-09 이하 옛 화면, 주간 현황판 "병목 3칸", 행 주인을 바꾸는 화면 단추(Q1 정리는 일회성), 다음 달 자동 이어 가기(Q2).
