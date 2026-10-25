# OKR 병목(목표) 행 추가·삭제 — 설계안 (2026-10-25, 기획실 한설계, 조사만·코드 0)

사용자: "OKR 탭에 행 추가·삭제도 가능해야 하지 않나? 병목이 3개만 있으리란 법은 없으니."

## 1. 목표와 쓰는 사람
- 한 줄: OKR 표의 **"병목현상 행"(= 목표 1줄, goal no 1개)** 을 Pillar 묶음마다 3개 넘게 늘리고 줄이게 한다. 지난 판정 기록은 잃지 않는다.
- 쓰는 사람: 팀장·파트장(PC). 파트원(주차 화면)은 행을 만들지 않는다.

## 2. "행"과 "3개"의 정체 (코드로 확정)
- 행 = `okr_cycles.goals[]` 한 원소 `{no, pillar, bottleneck, objective, criteria}`. 표에서는 Pillar 띠(검은 막대) 아래 "병목현상 | 목표 | 달성기준 …" 한 줄.
- "3개" = **Pillar 3개 × 병목 3개 = 9줄** 틀. 출처 2곳:
  - `src/okr.ts:328 defaultGoalTemplate` / `blankGoalsLike` — [3 × 3 빈 틀] 단추.
  - 팀장 문서 붙여넣기(`parseOkrPaste`)·SQL 적재(docs/okr/*.json) — 문서가 3×3 이라 3×3.
  - 배열 길이 자체엔 고정 없음(가변). 즉 "막힌" 건 데이터가 아니라 **화면**이다.
- 화면별 지금 상태:
  | 화면 | 추가 | 삭제 |
  |---|---|---|
  | [4분기] 분기 OKR 표(OkrQuarterView) — **[4분기] 누르면 처음 보이는 화면** | 없음 | 없음(머리 주석 "목표 삭제는 통합집계(월)에서만") |
  | [10월] 등 월 통합집계(OkrMonthRollup) | 있음 — Pillar 띠 오른쪽 끝 회색 작은 글씨 "＋ 병목"(`OkrCells.tsx:30`, 검은 띠 위 slate-400 이라 거의 안 보임) | 있음 — 병목현상 칸 오른쪽 위 회색 "×"(`OkrMonthRollup.tsx:102`) |
  | 파트 탭 [팀원 집계]·파트 종합·파트원 주차(TeamView) | 없음(editable=false, 읽기) | 없음 |
- 후보에서 제외: `GrowthHub.tsx:127` 은 붙여넣기 안내 그림 샘플 3줄(무관). `visits.ts:167 emptyBottlenecks` 는 **주간 현황판** 개인 메모의 "병목 3칸"(weekly_notes.bottlenecks, 고정 3) — OKR 탭이 아니다. 사용자가 이걸 말한 거면 별건(열린 질문 Q1).
- 결론: 사용자가 본 건 **분기 OKR 표(추가·삭제 단추 없음)** 이거나 월 통합집계의 숨은 "＋ 병목"을 못 찾은 것. 둘 다 고친다.

## 3. 기존 재사용·확장 지점
- `src/OkrHub.tsx:575 goalOps`(onGoal·onPillar·onInsert·onRemove + reorder) — 월 통합집계 전용. 분기 화면에도 같은 모양 ops 를 넘긴다.
- `src/okr.ts:259 renumberGoals`, `:271 remapReports`, `remapFeedback` — **지금 삽입·삭제는 1부터 재번호 + 그 달 기록 전부 옮겨 쓰기**.
- `src/OkrCells.tsx PillarBar`(＋ 병목), `OkrMonthRollup.tsx:102`(×).
- 홈 `src/kpi/kpiCompute.ts:787 okrWeekResult` → `okr.ts:187 achievementRate` 는 판정 있는 행만 센다 → 빈 새 행은 홈 % 에 영향 0.

## 4. 데이터 설계 (SQL 0 — goals 는 jsonb)
- **재번호 금지로 바꾼다.** 새 행 no = 그 사이클 goals 의 max(no)+1. 화면 순서는 배열 순서(삽입 위치)로, no 는 판정 연결 키로만. → `reorder`/`remapReports` 를 추가·삭제에서 더 안 부른다(서버 다중 쓰기 제거).
  - 이유: 분기 표는 월 판정을 **no 로** 붙인다(`okr.ts:896 quarterRollup` rowOf `x.no === g.no`). 지금처럼 월에서 지우고 재번호하면 그 뒤 행이 분기 표에서 한 칸씩 어긋난다(현재 잠재 버그). 다른 달·다른 사이클 기록은 remap 대상도 아니다.
  - 표시 "병목현상 n" 은 이미 같은 Pillar 안 순서로 계산(`bottleneckLabel`)하므로 no 가 띄엄띄엄이어도 화면은 1·2·3·4.
- 삭제 규칙:
  - 빈 행(병목현상·목표·달성기준 모두 빈칸, 판정 없음) → 확인 없이 바로 빼기.
  - 글만 있음 → 확인창 1번 후 빼기.
  - **어느 기록이든 그 no 에 실제결과·판정이 있으면 → 삭제 대신 "보관"**: `OkrGoal.hidden: true`(새 선택 필드). 표에서 숨기고 맨 아래 "보관된 병목 n개 [보기·되살리기]". 판정 데이터는 그대로라 지난 주차·홈 % 불변.
  - `normalizeGoals`(`okr.ts:335`)가 모르는 필드를 버리므로 hidden 을 통과시키게 한 줄 고친다.
- 집계 함수(monthlyRollup·quarterRollup·okrWeekTeamRows·overlayGoals·주차 화면)는 `visibleGoals = goals.filter(g => !g.hidden)` 로. 단 **지난 주차 홈 %** 는 그 주에 판정된 행을 계속 세야 하므로 okrWeekResult 는 hidden 도 포함(판정 없는 행은 어차피 0 영향) — 홈 숫자 변화 0.
- 권한: 지금처럼 제한 없음(메모리 2026-10-20 "일단은 아니"). goals_origin 'leader'·'copy' 달을 손대면 기존 settle() 처럼 'manual' + goals_prev 보관(되돌리기 가능).
- 분기 ↔ 월: 분기 표에서 추가하면 분기 goals 에만. 11·12월(복사본)은 분기를 따라 보이므로 자동 반영. 10월(팀장 월 OKR)은 따로 — 열린 질문 Q2.

## 5. 화면 흐름
1. [4분기] 또는 [10월] 통합집계를 연다.
2. 각 Pillar 띠 아래 마지막 행 밑에 **[＋ 병목 추가] 줄**(표 폭 전체, 점선, 잘 보이게). 띠 위 숨은 "＋ 병목"은 이 줄로 대체.
3. 누르면 그 Pillar 끝에 빈 행(no=max+1)이 생기고 병목현상 칸에 커서.
4. 행 삭제 = 병목현상 칸 오른쪽 위 ×(분기 표에도). 빈 행 즉시 / 글 있음 확인 / 판정 있음 "보관할까요? 지난 판정은 남습니다".
5. 표 맨 아래 "보관된 병목 n개" 접힘 → [되살리기].
6. 파트·주차 화면은 새 행이 자동으로 보이고(읽기), 판정 칸은 빈칸.

## 6. 작업 분해 (겹치지 않게)
- ui-designer(윤화면): [＋ 병목 추가] 줄·보관 접힘 모양 시안 — `src/OkrCells.tsx`(새 `AddGoalRow`·`ArchivedGoals` 컴포넌트, PillarBar 의 ＋ 병목 제거). 약 50줄.
- db-schema: 할 일 없음(SQL 0). 표다빈 확인만 — goals jsonb 에 hidden 추가로 옛 앱이 저장 시 hidden 을 지우는지(옛 normalizeGoals) 배포 순서 판단.
- 구현(구현서, 1명): `src/okr.ts` — `nextGoalNo`, `addGoal(goals, pillar)`, `removeOrArchiveGoal(goals, no, hasRecords)`, `visibleGoals`, normalizeGoals hidden 통과(약 40줄). `src/OkrHub.tsx` goalOps onInsert/onRemove 를 재번호 없는 새 함수로 교체 + 분기 화면용 ops(quarter cycle 에 write) + "판정 있음" 판단을 그 달만이 아니라 분기 progress 의 모든 보고서로(약 40줄 바뀜). `src/OkrQuarterView.tsx`·`src/OkrMonthRollup.tsx` 에 AddGoalRow·×·보관 접힘 연결 + visibleGoals(각 약 20줄). 매뉴얼 docs/manual/user/11(OKR 장) 갱신.
- qa-checker(검수아): `tests/okrGoalRows.test.ts` 새로 — ① 추가 no=max+1·기존 no 불변 ② 판정 있는 행 삭제 → hidden, 보고서 rows 불변 ③ quarterRollup 이 hidden 뺀 행만·나머지 no 맞물림 ④ okrWeekResult 전후 % 동일 ⑤ normalizeGoals 왕복 hidden 유지 ⑥ legacy(2026-09 이하) 경로 무변경. build·test 통과.

## 7. 위험
- R1 옛 재번호 데이터: 이미 월에서 지우고 재번호한 달이 있으면 분기 표와 어긋나 있다. 배포 전 MCP 로 10월 goals no 와 분기 goals no 비교(읽기)만 하고, 어긋나면 보고.
- R2 배포 중 열려 있던 옛 앱이 goals 를 저장하면 hidden 이 지워져 보관 행이 다시 보인다(데이터 손실은 없음, 표시만). 공지 "새로고침".
- R3 행이 늘면 홈 OKR % 분모가 커질 수 있음(새 행에 판정이 붙기 시작하면) — 의도된 동작이나 주간 비교 때 "행 수 바뀜" 표시 여부는 Q3.

## 8. 열린 질문 (한 번에)
- Q1 "병목 3개"가 OKR 표가 맞나요, 아니면 주간 현황판 개인 메모의 "병목 3칸"인가요? (후자면 emptyBottlenecks 가변화로 별건)
- Q2 분기 표에서 행을 추가하면 10월(팀장 월 OKR)에도 같이 넣을까요? 제안: 아니오, 분기와 11·12월만(10월은 10월 화면에서 따로).
- Q3 Pillar 를 4개 이상으로 늘리는 것(Pillar 행 추가)도 필요한가요? 제안: 이번엔 아니오.
- Q4 행 순서 바꾸기(위·아래 이동)도? 제안: 이번엔 아니오.

## 9. 하지 않을 것
- 2026-09 이하 legacy 화면(isLegacyMonthId), 주간 현황판 병목 3칸, Pillar 개수 변경, 권한 제한, SQL, 팀장 문서 붙여넣기 파서 변경(붙여넣기는 지금처럼 통째 교체 + goals_prev).
