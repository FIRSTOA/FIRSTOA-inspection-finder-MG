# OKR 파트 탭에 분기 넣기 — 파트별 분기 목표 + 월 진행 (설계안)

- 작성: 기획실 한설계(feature-planner), 2026-11-01 · 조사만, 코드 0 · SQL 0
- 요청(이민구, C파트, 팀장 지시 전달): "OKR에 ABCD 파트에 10,11,12만 있는데 팀장님이 분기도 넣으래. 파트별로 분기를 월로 어떻게 진행하고 있는지 알아야 한다네. 통합집계는 팀장님이 보는 집계고, 파트별로 분기도 작성해야 하나봐."
- 쓰는 사람: 파트장·파트원(작성, PC 위주), 팀장(파트 탭을 열어 확인)
- 근거: src/okr.ts, src/OkrHub.tsx, src/OkrQuarterView.tsx, supabase/functions/_shared/ask/okr-rules.ts, supabase/okr.sql·okr-quarter.sql, docs/tasks/okr-quarter-month-week.md, docs/tasks/okr-feedback-2.md(2차 2-3·3차 1), git 7d377c5·f386159, tests/okrQuarter.test.ts·okrHub.render.test.tsx

---

## A. 지금 구조 (사실)

1. 표: `okr_cycles`(kind quarter `2026-Q4` / month `2026-10` parent_id=`2026-Q4` / week `2026-10-W1` parent_id=달) + `okr_reports`(기본키 cycle_id × team × member, member ''=파트 종합). okr_reports 에는 kind 제한이 없다 → `cycle_id='2026-Q4'` 행도 표 변경 없이 저장된다(FK 대상 Q4 행은 2026-10-20 SQL 로 이미 있음).
2. 분기 목표 ↔ 월 목표의 연결 키는 **목표 번호 `no`** 하나다(행 사이 부모 키 없음). 기간 연결은 month.parent_id = 분기 id. `quarterRollup`(src/okr.ts:721)이 분기 goals 번호마다 같은 번호의 월 판정을 찾는다.
3. 상단 칩: 통합집계 탭 = [4분기][10월][11월][12월], **A~D 파트 탭 = [10월][11월][12월]만**(`filterItemsForTab`, okr.ts:588). 분기 화면에서 파트 탭을 누르면 그 분기 지금 달의 [파트 종합]으로 튕긴다(`goQuarter` OkrHub.tsx:341, `openTeamFresh` :877, `quarterNowMonth`).
4. 파트 탭의 분기 화면은 **원래 있었다**: 2차(f386159, 10-21) `QuarterTeamView` = 그 파트 9목표 × 10·11·12월 파트 월 종합 점 + 파트 분기 종합(자동). 같은 날 3차(7d377c5) **사용자 지시로 삭제**. 테스트가 "없다"를 지킨다(tests/okrHub.render.test.tsx:89).
5. 분기 데이터는 **통합집계 [4분기] 표(OkrQuarterView)에만** 보인다: 분기 goals(팀장 글, 편집 가능) × 10·11·12월 각 A·B·C·D·CS 점 + 분기 종합 + 개선계획(분기 행 feedback). A~D 파트 카드(`quarterTeamCard`, 판정 n/27).
6. 파트별 분기 값은 **계산만 있고 저장 칸이 없다**: `quarterRollup().rows[].byTeam[파트] = { byMonth: 월별 파트 월 종합(●확정/○마지막 주차 제안), quarter: 마지막 기록 달 값 }`. 파트가 분기 실제결과·판정·개선계획을 적을 곳은 없다.
7. 통합 분기 = **합·평균이 아니다**. 분기 종합(CS) 자동값 = 월 CS 종합들 중 마지막 값(`quarterCsJudgment`), 월 CS 종합 = 그 달 A~D 중 가장 나쁜 것(`monthCsJudgment`). 팀장이 고르면 분기 행 `feedback[no].judgment` 가 덮는다. 분기 목표 글은 팀장이 따로 쓴다(파트 것을 모으지 않음). 카드 % 만 10·11·12월 파트 칸을 합산(27칸).
8. 행 주인 층(scope)은 **월 행에만**(okr-rules.ts:42 주석, 매뉴얼 user/11 "전용 줄은 분기 표에 만들 수 없습니다").
9. 8·9월 = `OKR_LEGACY_UNTIL "2026-09"` 옛 화면, 3분기는 분기 행 없음(legacy) → 이 작업은 `legacy` 분기에서 손대지 않는다.

## B. 요청 해석 후보 (사용자가 고를 것)

| 후보 | 뜻 | 이게 맞다면 화면은 |
|---|---|---|
| ① 보기만 | 파트별로 분기 목표가 달마다 어떻게 됐는지 **보기** | A파트 탭에 [4분기] 칩이 생기고, 누르면 "A파트 4분기" 표 = 팀장 분기 목표 9줄 × 10·11·12월 A파트 판정 점 + A파트 분기 종합(자동). 적는 칸 없음(10-21 2차 화면 되살림) |
| ② 보기 + 파트 분기 작성 **(권장)** | ①에 더해 파트가 분기 결과를 **적는다** | ①의 표 오른쪽에 노란 칸: 분기 실제결과 · 분기 판정(자동값 위에 덮어쓰기) · 사유 · 다음 분기 개선계획 · 근거자료. 달성기준은 [달성기준 ▾] 접기에서 파트가 분기용으로 고쳐 적을 수 있음. 병목·목표는 팀장 글 그대로(읽기) |
| ③ 파트마다 다른 분기 목표 | 파트가 분기 **목표 자체**(병목현상·목표)를 자기 파트용으로 따로 세운다 | ②의 화면에서 병목현상·목표 칸도 파트가 고칠 수 있고(그 파트에만 저장, 통합집계 팀장 글은 그대로), 11·12월 파트 종합의 기본 글도 파트 분기 글을 따라감 → 연결 규칙이 늘어 큼 |

## C. 권장안 — ② (표 변경 0, legacy 영향 0)

### C-1. 저장 위치 (새 표·새 열 없음)
- 파트 분기 기록 = `okr_reports` 행 **(cycle_id `2026-Q4`, team `A`~`D`, member '')**. 월 파트 종합과 같은 꼴:
  - `rows[no]` = 분기 실제결과·판정·사유·개선계획·근거(`OkrResultRow` 그대로)
  - `header.goals` = 파트가 분기용으로 고친 달성기준(`putGoalField(..., "criteria")`, 층별 독립 규칙 그대로)
  - `header.leader/author/submitted` = 그대로
- 파트 분기 종합 판정 = `rows[no].judgment` 가 있으면 그것(●), 없으면 `byTeam[파트].quarter`(마지막 기록 달, ○).
- 다른 소비자 영향: 홈 KPI(kpiData)·엑셀(okrExcelExport)·묻기(tools-okr loadBundle)는 cycle_id 를 달·주차 id 로만 골라 읽음 → Q4 행은 안 섞임(숫자 불변). `listOkrResultIndex` 에 "2026-Q4" 가 끼지만 달·주차 id 비교에만 쓰여 무해.

### C-2. 화면 흐름
1. A파트 탭 → 상단 칩이 [4분기][10월][11월][12월] (통합집계와 같아짐).
2. [4분기] → 흰 카드 경로 줄 "A파트 › 4분기", 사람 알약·주차 칩 없음.
3. 머리: 달별 진행 띠 "10월 7/9 · 11월 2/9 · 12월 —" (A파트 월 종합 판정 수, 미흡·미착수 수 빨강) — 누르면 그 달 A파트 [파트 종합].
4. 표(9목표, Pillar 막대): 병목현상(읽기) | 목표(읽기)+[달성기준 ▾] | 10월 ● | 11월 ○ | 12월 — | A파트 4분기 종합(자동/덮어쓰기) | 분기 실제결과 | 사유 | 다음 분기 개선계획 | 근거자료. 월 점을 누르면 그 달 A파트 [파트 종합].
5. 판정이 완료·해당없음이 아니면 사유·개선계획 필수(월 `needsReasonPlan` 규칙 그대로).
6. 통합집계 [4분기] 표는 그대로. 단, A~D 점 아래 파트 분기 판정을 보탤지는 E-Q2.

### C-3. 바꿀 파일
| 파일 | 바꿀 것 |
|---|---|
| src/okr.ts | `filterItemsForTab` → 모든 탭에 분기 칩(legacy 분기는 그대로). 새 순수 함수 `partQuarterRows(rollup, team, quarterReport)` → 행마다 {byMonth 점, auto, judgment(사람 값 우선), row}, `partQuarterMonthStrip(rollup, team)` → 달별 n/총·경고 수 |
| src/OkrPartQuarterView.tsx (신규) | C-2 화면. 칸 = RichCell·JudgmentPicker·JudgmentDot·PillarBar(OkrCells) 재사용, 열 폭 키 `okr_cols_partq_v1` |
| src/OkrHub.tsx | `openQuarter`: Q4 reports 도 읽어 `setReports`(지금은 `[]`). `goQuarter`·`openTeamFresh` 의 파트 탭 튕기기 제거. `renderBody`: `isQuarterView && tab !== "all"` → OkrPartQuarterView(`updateResult`·`setCriteria`·`patchReport` 그대로 — cycleId 가 분기 id). 탭 머리 n/총을 분기 화면에선 Q4 파트 행 기준. 분기 목표 행 삭제 전 기록 확인(:667~683)에 Q4 reports 포함 |
| src/okrUi.ts | `okrCrumbs`: 분기 + 파트 탭 = ["A파트", "4분기"] |
| tests/okrQuarter.test.ts | filterItemsForTab 기대값 변경(:412-413), partQuarterRows·strip 테스트 |
| tests/okrHub.render.test.tsx | :89 "QuarterTeamView 없다" → "파트 분기 화면 있다"로 교체 |
| docs/manual/user/11-okr.md | 파트 탭 [4분기] 절 추가, "[4분기] 칩은 통합집계 탭에서만" 문구 고침 |

- 동기화: 15초 틱이 이미 `getOkrReports(c0.id)` 로 열린 기간(분기)의 reports 를 다시 읽는다(:450) → 추가 조회 없음. 월 진행 점은 분기를 열 때 읽은 `progress`(세 달 + 주차) 그대로(틱마다 다시 안 읽음, 지금과 같음).
- 8·9월 영향 없음: 3분기는 `legacy` 라 `goQuarter` 가 옛 화면으로 보내는 길 그대로. `isLegacyMonthId` 경로·SummaryView·옛 TeamView 수정 없음.

### C-4. 위험
1. **10-21 사용자 결정 뒤집기**: 3차에서 사용자가 "파트 탭엔 월만"이라 지웠다. 이번엔 팀장 지시라 되돌리는 것 — E-Q1 로 한 번 확인.
2. 되돌리기 SQL(okr-quarter-rollback.sql)의 `delete from okr_cycles where kind='quarter'` 는 FK `on delete cascade` 로 **파트 분기 기록까지 지운다**. 롤백 파일 머리 주석에 경고 한 줄 추가 필요(실행 SQL 아님, 주석만).
3. 분기 목표 행 보관·삭제: 파트 분기 기록이 있는 번호를 지울 때 보관으로 가야 함(C-3 OkrHub 삭제 전 확인 범위).
4. 엑셀·홈·묻기에 파트 분기 기록이 **안 나온다**(범위 밖, 후속 후보).
5. 폰: 분기 표는 열이 많아 가로 스크롤(월 화면과 같음). PC 권장.

## D. 작업 분해

| # | 담당 | 파일 | 할 일 | 예상 줄 |
|---|---|---|---|---|
| 1 | 디자인실 윤화면(ui-designer) | 목업 이미지(캔버스) | C-2 표 1장 + 달별 진행 띠, 월 화면 파트 종합과 같은 색 규칙(병목·목표 남보라, 입력 노랑) — 사용자 규칙 "디자인은 항상 목업" | 0 |
| 2 | 개발실 구현서 A(sonnet) | src/okr.ts, src/okrUi.ts, tests/okrQuarter.test.ts | filterItemsForTab·partQuarterRows·partQuarterMonthStrip·okrCrumbs + 테스트 | +60 / 테스트 +70 |
| 3 | 개발실 구현서 B(opus 권장, OkrHub 1,396줄) | src/OkrPartQuarterView.tsx(신규), src/OkrHub.tsx, tests/okrHub.render.test.tsx | 화면·연결(C-3), 2 끝난 뒤 | +180 / OkrHub ±45 / 테스트 ±25 |
| 4 | 품질실 검수아(qa-checker) | — | build·test, 회귀: 8월·9월 옛 화면, 10월 파트 종합·주차, 통합집계 [4분기] 점·카드 숫자 불변, A파트 [4분기]에 적고 새로고침·다른 창 15초 뒤 보임, 홈 K19 숫자 불변 | 0 |
| 끝 | 팀장 | docs/manual/user/11-okr.md, AGENTS 작업 기록, docs/eval worklog | 매뉴얼 장 갱신 | +20 |

db-schema(표다빈)·sql-review: **할 일 없음**(SQL 0). 합계 약 400줄(테스트 포함).

## E. 결정 필요 (사용자에게 한 번에)

- **Q1. 어느 후보인가요?** ① 보기만 / ② 보기 + 파트 분기 결과 작성(권장) / ③ 파트마다 분기 목표 자체를 따로. (10/21에 "파트 탭엔 월만"으로 지웠던 것을 되살리는 것이라 확인합니다.)
- **Q2. 파트가 고른 분기 판정을 통합집계 [4분기] 표에도 반영할까요?** (가) 아니오 — 통합 분기 종합은 지금처럼 월 CS 종합의 마지막 값(권장, 변경 최소) (나) 예 — 통합 표 A~D에 "분기" 점 열을 더하고, CS 분기 종합 자동값을 파트 분기 판정 중 가장 나쁜 것으로.
- **Q3. 파트 분기 칸 이름**: 마지막 노란 칸을 "4분기 결과 및 다음 분기 개선계획"(통합집계와 같은 말)로 할까요, 월 파트 종합처럼 "실제결과·사유·개선계획·근거자료" 4칸으로 나눌까요? (권장: 월 파트 종합과 같은 4칸 — 팀장 엑셀 파트 시트 양식)

## 하지 않을 것
- 새 표·새 열·SQL. okr_cycles goals 에 파트 전용 분기 행(scope) 만들기(③을 고르기 전까지).
- 8·9월 옛 화면, 통합집계 [4분기] 표·[10월] 통합집계 수정(Q2 (나) 제외).
- 엑셀 내려받기·홈 K19·통합검색 묻기에 파트 분기 넣기(후속).
- 파트원 개인 분기 기록(member 이름 + 분기) — 요청은 "파트별".
- App.tsx.
