# OKR 분기 → 월 → 주차: 사용자 2차 피드백 4건 (설계안 2차)

- 작성: 기획실 한설계(feature-planner), 2026-10-20
- 바탕: 1차 설계안 `docs/tasks/okr-quarter-month-week.md`(고치지 않음), 커밋 da5e0f9 코드 읽기(`src/okr.ts`, `src/OkrHub.tsx`, `src/OkrQuarterView.tsx`, `src/OkrMonthRollup.tsx`, `src/OkrCells.tsx`, `src/okrUi.ts`, 테스트 3개)
- 상태: **설계안.** 코드는 아직 바꾸지 않았다. **표(DDL)는 바꾸지 않는다.** jsonb 안 키만 더한다(`okr_cycles.feedback`, `okr_reports.header.goals`).
- 쓰는 사람: 팀장(분기·월 통합집계, PC), 파트장(파트 종합, PC), 파트원(주차 기록, PC가 주이고 폰도 씀)

---

## 0. 한 줄 목표

통합집계 세 층(분기 → 월 → 파트)을 모두 **"팀원 집계"와 같은 틀**로 맞춘다. 행 = 9목표, 열 = 아래 단계의 판정 동그라미, 끝 열 = 이 단계의 종합 판정이다. 팀장 문서 칸(분기·월)과 파트가 쪼개 적는 칸(주차)은 **색**으로 나눈다. 주차 화면에서는 **목표도** 파트·파트원이 쪼개 적을 수 있게 한다.

| 화면 | 행 | 동그라미 열(아래 단계 종합) | 끝 열(이 단계 종합) |
|---|---|---|---|
| 파트 탭 [팀원 집계] (지금 있음) | 9목표 | 파트원 × 1~4(5)주 판정 | 파트 종합(월) |
| [10월] 통합집계 (바뀜) | 9목표 | A·B·C·D **파트 월 종합** | **CS 종합(월)** |
| [4분기] 통합집계 (바뀜) | 9목표 | 10·11·12월 **CS 종합** | **분기 종합** |
| [4분기] + 파트 탭 (새로) | 9목표 | 10·11·12월 **그 파트 월 종합** | 그 파트 분기 종합(자동, 보기만) |

---

## 1. 지금 코드가 그리는 것 (조사 결과)

| 위치 | 지금 | 피드백과 어긋나는 점 |
|---|---|---|
| `OkrMonthRollup.tsx:40-43` 핵심방향 | 회색 작은 글씨 "★ 핵심방향" + 노란 입력칸 1개(`RichCell colors={false}`) | 눈에 안 띈다(피드백 2) |
| `OkrMonthRollup.tsx:89` A~D 열 | `JudgmentBadge`(글자 배지). 값은 **파트 월 종합 행(member '')에 사람이 고른 판정만** 쓴다(`monthlyRollup`, okr.ts:724) | 동그라미가 아니다. 파트가 아직 판정을 고르지 않으면 빈칸이고, 주차 기록에서 나온 제안값도 없다. **CS 종합 열이 없다** |
| `OkrQuarterView.tsx:22-51` 분기 OKR 표 + `:53-77` 분기 진행 표 | 표가 둘이다. 진행 표는 9 × (3달 × A~D = 12칸) 배지 | 피드백 1: 표 하나로, 달마다 동그라미 하나(CS 종합) + 분기 종합 |
| `OkrHub.tsx:855-857` 분기 + 파트 탭 | "월을 고르세요 [10월][11월][12월]" 안내만 뜬다 | 피드백 3 |
| `OkrHub.tsx:238` `openQuarter` | `setTab("all")`로 탭을 통합집계로 되돌린다 | A파트를 보다가 [4분기]를 누르면 파트가 풀린다 |
| `OkrHub.tsx:841` 탭 머리 숫자 | 분기 화면에서도 `reports`(비어 있음)로 계산해 파트마다 "0/9"가 뜬다 | 뜻 없는 숫자 |
| `OkrMonthRollup.tsx:138` 팀원 집계 '파트 종합' 제안 / `OkrHub.tsx:709` [✨ 주차 합치기] 판정 | `worstInMonth`: 그 달 모든 주차 중 **가장 나쁜** 판정 | 팀장 결정: **마지막 기록 주차** |
| `OkrHub.tsx:1007` 파트 종합(월) 판정 칸의 제안 | `worstJudgment(row.actual)`: 실제결과 글에서 가장 나쁜 낱말을 찾는다 | [✨ 주차 합치기] 뒤 글에는 1~4주 판정 낱말이 다 들어 있어서, 4주에 완료여도 "→ 미흡"을 제안한다. **마지막 주차 제안과 부딪힌다** |
| `OkrHub.tsx:863` 월 통합집계 `ops={goalsFromQuarter ? null : goalOps}` / `OkrMonthRollup.tsx:25` `editable = !!ops && !fromQuarter` | 11·12월(goals_origin 'copy')은 병목·목표·달성기준이 **읽기 전용**이다. 10월(팀장 월 OKR 있음)은 고칠 수 있다 | 피드백 4: 월도 팀장 것이니 늘 고칠 수 있어야 한다 |
| `OkrQuarterView.tsx:41-43` | 분기 병목·목표·달성기준은 **누구나 고칠 수 있다**(권한 확인 없음) | 확인 완료. 그대로 둔다 |
| `OkrHub.tsx:991` TeamView 목표 칸 | 주차·월 모두 `RichCell readOnly` + `TD_FIXED`(하늘색) | 피드백 4: 주차에서는 고칠 수 있어야 한다 |
| `OkrHub.tsx:992-994` 달성기준 칸 | 월 파트 종합은 읽기, 주차(파트 '' · 파트원)는 `TD_EDIT`(흰색) + `onCriteria` | 색이 "편집 칸"임을 알리지 못한다 |
| `okr.ts:281` `overlayCriteria` / `:299` `putCriteria` | 덮어쓰기 칸 `header.goals`에서 **criteria만** 읽는다. 저장할 때 `{...shown, criteria}`로 **그때 보이던 objective까지 함께** 저장한다 | **중요:** 지금 서버의 덮어쓰기 칸(실측 37행)에는 **옛 objective 글이 이미 들어 있다**. objective를 그냥 읽기 시작하면 옛 8월·10월 목표 글이 되살아난다 → 표시 플래그가 꼭 필요하다(3-3) |
| `okr.ts:329` `normalizeGoals` | no·pillar·bottleneck·objective·criteria·html만 남기고 **다른 키는 버린다** | 새 키를 최상위에 두면 옛 앱(PWA 캐시)이 읽고 다시 저장할 때 사라진다 |
| `okr.ts:293` `criteriaToCarry` | **화면에서 쓰지 않는다**(tests/okrCriteria.test.ts만 씀). 전주 불러오기는 `OkrHub.tsx:462 loadPrevCriteria`가 직접 계산한다 | 고치지 않는다 |

---

## 2. 화면 틀

### 2-1. [10월] 통합집계 (OkrMonthRollup)

```
┌ 핵심방향 띠 (짙은 남색, 3-2) ──────────────────────────────────────────────┐
│ ◎ 10월은 4분기 목표의 담당자·대상·측정 기준을 정하고 실행을 시작한다.   [고치기] │
│  ① 주간 실행 ──▶ ② 월말 확인 ──▶ ③ 분기 정리                              │
│  주간에는 실행하고   월말에는 목표 대비 숫자와…   분기 말 지식과 교훈으로…        │
└──────────────────────────────────────────────────────────────────────────┘
[A파트 카드][B][C][D]  (그대로)
범례: ■ 팀장 문서  ■ 파트가 쪼개 적는 칸  ■ 결과 입력  ● 확정  ○ 제안(주차 기록에서)

| 병목1 | 병목현상 | 목표 | A | B | C | D | CS 종합 | 조치·확인 필요 파트 | 10월 결과 및 11월 개선계획 |
|       | (팀장색 편집)|(팀장색 편집)| ● | ○ | ● | — | [미흡 ▾] 자동 | C · 이민구 | (노랑) |
                         달성기준 ▾(펼치면 팀장색 편집)
```
- A~D 칸 = **파트 월 종합 판정 동그라미**(지름 14px 정도, 등급 색). 파트가 고른 판정이면 **채운 점(●)**, 아직 안 골랐으면 주차 기록의 마지막 주차 판정을 **속 빈 점(○, 등급 색 테두리)**으로 보인다. 둘 다 없으면 "—". 점을 누르면 그 달 그 파트의 [파트 종합]이 열린다.
- **CS 종합** = `JudgmentPicker`. 값이 없으면 자동값(A~D 중 가장 나쁜 것, 제안 포함)을 보인다. 사람이 고르면 그 값을 쓰고, 아래 작은 글씨로 "자동 ○○ · 되돌리기"를 단다. 저장 위치는 3-1.
- '조치·확인 필요 파트'는 **지금처럼 확정 판정만** 센다(제안은 넣지 않는다. 제안까지 넣으면 아직 판정하지 않은 파트가 조치 대상으로 잡힌다).
- 11·12월처럼 팀장 월 OKR이 아직 없을 때(fromQuarter): 띠 문구를 "팀장 11월 OKR 대기, 4분기 OKR을 보여줍니다. **고치면 11월 OKR로 저장됩니다**"로 바꾸고 **칸은 고칠 수 있게** 한다(3-4).

### 2-2. [4분기] 통합집계 (OkrQuarterView, 표 하나로 합침)

```
[팀장 분기 OKR 붙여넣기] [지난 분기] [직전 목표로 되돌리기]            범례(같음)
| 병목1 | 병목현상 | 목표 | 10월 | 11월 | 12월 | 4분기 종합 |
|       | (팀장색 편집) | (팀장색 편집) |  ●  |  ○  |  —  | [미흡 ▾] 자동 |
                 달성기준(실행) ▾ (펼치면 팀장색 편집)
```
- 달 칸 = 그 달 **CS 종합**(사람이 고른 값이 있으면 ●, 자동값이면 ○). 누르면 그 달 [통합집계]로 간다.
- 달 머리에 "조치 n"(지금 `quarterProgress.months[].actionTeams`)은 그대로 둔다.
- **분기 종합** = 마지막으로 값이 있는 달의 CS 종합(자동). 사람이 고르면 덮어쓴다(분기 행 `feedback[no].judgment`).
- 지금의 "분기 진행 표"(9 × 12칸)는 **없앤다.** 파트별 칸은 파트 탭(2-3)으로 옮겨 간다.

### 2-3. [4분기] + 파트 탭 (새 화면 `QuarterTeamView`)

```
A파트 · 4분기
| 병목1 | 병목현상(읽기) | 목표(읽기, 분기) | 10월 | 11월 | 12월 | A파트 분기 종합 |
|       |               |                 |  ●   |  ○   |  —   | ● (자동, 보기만) |
```
- 달 칸 = 그 달 **A파트 월 종합**(● 확정 / ○ 마지막 주차 제안). 누르면 `openMonthView(y, m, "A", "")`로 **그 달 A파트 [파트 종합]**을 연다.
- 달 머리 [10월]을 누르면 그 달 A파트 탭(작성자가 파트원이면 자기 박스)이 열린다.
- 분기 종합은 자동값만 보인다(마지막 기록 달의 파트 월 종합). 따로 저장하지 않는다(열린 결정 D4).
- 사람 박스 줄(파트 종합 / 팀원 집계 / 이름)은 이 화면에 두지 않는다. 박스는 달 화면에만 있다.

### 2-4. [10월] 파트 탭: 주차(파트 '' · 파트원) 화면

```
범례: ■ 팀장 문서  ■ 이번 주 쪼개 적는 칸  ■ 결과 입력
| 병목현상(읽기, 팀장색) | 이번 주 목표(편집색)                          | 이번 주 달성기준(편집색) | 실제결과(노랑) | 판정 | …
|                       | 월: 대상 직무 담당자 100% (회색 작은 글, 고쳤을 때만) |
|                       | 이번 주: 담당자 초안 5건 작성                   |
[↩ 10월 2주차 목표·달성기준 불러오기] [↩ 10월 2주차 실제결과 불러오기]
```
- 목표 칸: 파트 '' 주차에서 고치면 그 주 파트원 모두의 기본이 되고, 파트원이 고치면 그 사람 칸에만 남는다. **달성기준과 같은 사슬**이다.
- 고친 목표는 칸 위에 **월 목표를 회색 작은 글로** 함께 보인다. 주차 목표를 고쳐도 팀장 월 목표가 화면에서 사라지지 않게 하려는 것이다.
- 목표 칸을 비우면 덮어쓰기를 지우고 월 목표로 돌아간다. 달성기준은 지금 규칙 그대로 둔다(빈 글도 덮어쓰기로 남는다).
- 병목현상은 주차에서도 **읽기**만 한다(열린 결정 D3).
- 월 [파트 종합] 화면(`monthPart`)의 병목·목표·달성기준은 팀장색 **읽기**로 지금과 같다. 판정 칸 제안은 **마지막 주차 판정**으로 바꾼다(1절 마지막 어긋남).

### 2-5. 색 체계 (ui-designer가 정한다. 아래는 요구만)

| 칸 | 뜻 | 쓰는 곳 |
|---|---|---|
| **팀장 문서색** (새 상수 `TD_LEADER` / `TD_LEADER_EDIT`) | 팀장이 정한 분기·월 병목현상·목표·달성기준 | 분기 표, 월 통합집계(편집), 파트 종합·주차의 병목현상(읽기), 파트 종합의 목표·달성기준(읽기) |
| **쪼개기색** (새 상수 `TD_SPLIT`) | 파트·파트원이 이번 주로 쪼개 적는 목표·달성기준 | 주차 화면 목표·달성기준 |
| 결과 노랑 (`TD_WRITE`, 그대로) | 실제결과·사유·개선계획·근거·피드백 | 그대로 |

- 옛 상수 `TD_FIXED`(sky-50)는 **8·9월 옛 화면이 쓰므로 바꾸지 않는다.** 새 경로만 새 상수를 쓴다.
- 범례는 `OkrLegend` 한 줄(작은 사각 3개 + 점 2개). 새 구조 통합집계·파트 탭 표 위에 둔다. 옛 화면에는 두지 않는다.
- 판정 등급 색은 `JUDGMENT_INFO.dot`을 그대로 쓴다. 팀장색·쪼개기색은 등급 색(초록·호박·주황·장미·회색)과 겹치지 않게 고른다. 제안: 팀장 = 남색 계열(indigo-50), 쪼개기 = 청록 계열(teal-50).

---

## 3. 데이터 설계 (표 변경 없음)

### 3-1. CS 종합·분기 종합 덮어쓰기 → `okr_cycles.feedback[no].judgment`

- `OkrFeedback = { action?; memo; memoHtml?; judgment?: string }` (okr.ts:42에 키 하나 더함)
- 월 CS 종합 = 월 행(`2026-10`)의 `feedback["1"].judgment`, 분기 종합 = 분기 행(`2026-Q4`)의 `feedback["1"].judgment`
- **`okr_reports` team 'CS' 행을 쓰지 않는 이유**: `actionTeams`(okr.ts:155)는 member '' 행을 모두 파트로 센다. 'CS' 행이 미흡이면 조치 필요 파트에 "CS파트"가 끼어든다. `listOkrResultIndex`의 달 점, `perTeam` 카드, 동기화 `takeRows`도 모두 손봐야 한다. 지금 `cycle.feedback[no].memo`(개선계획 칸)와 같은 곳에 두면 저장·동기화·3자 병합 경로를 그대로 탄다.
- **3자 병합 보강**: `mergeFeedback`(okr.ts:412)은 **번호 단위 통째**로 병합한다. 팀장이 CS 종합을 고르는 사이 다른 사람이 같은 번호 메모를 고치면 한쪽이 사라진다. → 번호 안에서 **칸(memo·memoHtml·judgment·action) 단위로** 병합하게 바꾼다. 옛 데이터에서도 결과는 같다(칸 하나만 있으므로).

### 3-2. 핵심방향 단계 보기: 저장 변화 없음

`direction` 글을 그대로 두고, 보여 줄 때만 나눈다(순수 함수 `directionSteps`). 편집은 [고치기]를 누르면 지금의 RichCell 평문 칸이 열리는 식이다.

### 3-3. 주차 목표 덮어쓰기 → `okr_reports.header.goals[]`에 objective + 표시

- 지금 덮어쓰기 칸에는 **옛 objective 글이 남아 있으므로**(1절), "이 칸의 objective는 사람이 고친 것"이라는 표시가 있어야 objective를 읽는다.
- **표시 위치(팀장 제안): `html` 안의 `objectiveSet: "1"`.** `normalizeGoals`(okr.ts:330)와 옛 앱은 `html` 객체를 **통째로 보존**한다. 그래서 옛 PWA 캐시 앱이 결과 칸만 고쳐 저장해도 표시가 살아남는다. 최상위 키(`set`)에 두면 옛 앱이 읽고 다시 저장하는 순간 지워진다(열린 결정 D2).
  - 남는 위험: 옛 앱에서 **그 주차 달성기준을 고치면** `putCriteria`가 칸을 `{...shown, criteria}`로 통째로 바꾸므로 objective 표시가 사라진다. 배포 직후 며칠 동안의 일이라 받아들인다(회귀 R7).
- 타입: `OkrGoal.html?: { objective?: string; criteria?: string; objectiveSet?: "1" }`
- 사슬은 그대로다: 월 공통(effectiveGoals) → 주차 파트(member '') → 주차 파트원. 고친 번호의 칸만 저장한다.
- 옛 화면(≤ 2026-09, SQL 전)은 `overlayCriteria`를 **그대로** 부른다. 새 경로(`newMonth`)만 `overlayGoals`를 쓴다. 옛 데이터에는 표시가 없으므로 둘의 결과가 같지만, 경로를 나눠서 옛 화면은 한 글자도 바뀌지 않게 한다.

### 3-4. 11·12월(fromQuarter) 편집 = 첫 편집 때 월 OKR로 굳힌다

- 지금 `goalOps.write`(OkrHub.tsx:510)는 `current = commonGoals`(fromQuarter면 분기 goals)에 수정분을 얹어 **월 행에 저장**하고 `goals_origin 'copy' → 'manual'`로 바꾼다. 막혀 있는 곳은 `ops={goalsFromQuarter ? null : goalOps}`와 `editable` 두 줄뿐이다.
- 보강: 'copy'에서 처음 저장할 때 `goals_prev`에 지금 월 goals(8월 복사본)를 남긴다([직전 목표로 되돌리기] 가능).
- 분기 goals의 **달성기준까지 그대로** 굳힌다. 지금 fromQuarter일 때 파트원 주차 사슬의 바탕이 이미 분기 goals(effectiveGoals)이므로, 굳혀도 파트원 화면은 바뀌지 않는다. [분기 OKR로 시작]처럼 달성기준을 비우면 주차 화면 바탕이 갑자기 빈다.

### 3-5. 분기 화면에 필요한 주차 기록

- 제안값(○)을 그리려면 세 달의 주차 기록이 필요하다. 3달 × 최대 5주 = 15번 조회하는 대신, **분기를 열 때 한 번** `cycle_id=in.(…)`으로 읽는다(새 함수 `getOkrReportsIn`). id는 `weekIdFor`(옛 셈법 행 매핑, OkrHub.tsx:138)로 만들고, 읽은 뒤 정식 id(`…-Wn`)로 바꿔 둔다(`loadWeekBook`과 같은 방식).
- 15초 동기화 틱에서는 다시 읽지 않는다(지금 `progress`와 같음, 속도 기준).

---

## 4. 바꿀 파일·함수와 새 시그니처

### 4-1. `src/okr.ts` (순수 함수, 구현서 A)

```ts
// 판정 출처: 'set' 사람이 고른 것 · 'suggest' 아래 단계에서 계산한 제안 · '' 없음
export type OkrJudgedCell = { judgment: OkrJudgment | ""; source: "set" | "suggest" | "" };
export type OkrRolledJudgment = { judgment: OkrJudgment | ""; auto: OkrJudgment | ""; manual: boolean };

// 그 달 주차 기록 중 이 파트의 '마지막 기록 주차' 판정 — 그 번호에 판정이 있는 가장 늦은 주차를 찾고,
// 그 주차 안에서 파트원 판정이 여럿이면 가장 나쁜 것(worstOfJudgments). 파트 행(member '')은 보지 않는다(worstInMonth와 같은 범위).
export function lastJudgmentInMonth(weekReports: OkrReport[], team: string, no: number): OkrJudgment | "";

// 파트 월 종합 칸 — 월 report(member '') 판정이 있으면 set, 없으면 lastJudgmentInMonth를 suggest
export function partMonthJudgment(monthReports: OkrReport[], weekReports: OkrReport[], team: string, no: number): OkrJudgedCell;

// CS 종합(월) — auto = A~D 칸(확정·제안 모두) 중 가장 나쁜 것, override(feedback[no].judgment)가 있으면 그것
export function monthCsJudgment(cells: Record<OkrTeam, OkrJudgedCell>, override?: string): OkrRolledJudgment;

// 마지막 값(빈 것 건너뜀) — 분기 종합(달 CS 종합 3개)·파트 분기 종합(파트 월 종합 3개)에 같이 쓴다
export function lastOfJudgments(values: Array<OkrJudgment | "">): OkrJudgment | "";
export function quarterCsJudgment(byMonth: Array<OkrJudgment | "">, override?: string): OkrRolledJudgment;

// monthlyRollup 확장(인자 하나 더, 옛 호출은 그대로 동작) — 행에 dots·cs 추가
export type OkrRollupRow = { /* 지금 칸 그대로 */ dots: Record<OkrTeam, OkrJudgedCell>; cs: OkrRolledJudgment };
export function monthlyRollup(cycle: OkrCycle, reports: OkrReport[], quarter?: OkrCycle | null, weekReports?: OkrReport[]): OkrRollupRow[];

// 분기 통합집계(quarterProgress 대체) — 묶음 × 달 CS 종합 + 분기 종합, 파트별 칸(파트 탭용)도 같이
export type OkrQuarterRollup = {
  months: Array<{ id: string; month: number; actionTeams: number }>;
  rows: Array<{
    no: number; pillar: string; bottleneck: string; objective: string; criteria: string;
    byMonth: Record<string, OkrRolledJudgment>;   // [달id] CS 종합
    quarter: OkrRolledJudgment;                    // 분기 종합(quarter.feedback[no].judgment 덮어쓰기)
    byTeam: Record<OkrTeam, { byMonth: Record<string, OkrJudgedCell>; quarter: OkrJudgment | "" }>; // 파트 탭
  }>;
};
export function quarterRollup(quarter: OkrCycle | null, monthCycles: OkrCycle[], monthReports: Record<string, OkrReport[]>, weekReportsByMonth: Record<string, OkrReport[]>): OkrQuarterRollup;

// 덮어쓰기 사슬 — overlayCriteria에 목표를 더한 것. objective는 html.objectiveSet === "1"인 칸만 읽는다.
export function overlayGoals(base: OkrGoal[], over?: OkrGoal[]): OkrGoal[];
// 덮어쓰기 칸 하나 고치기 — 같은 번호 칸이 있으면 그 칸에 field만 바꿔 얹는다(putCriteria처럼 통째로 바꾸지 않는다: 다른 칸의 표시를 지키려고).
// objective가 빈 글이면 objective 덮어쓰기를 지운다(objective·html.objective·objectiveSet). criteria는 빈 글도 남긴다(지금 규칙).
export function putGoalField(list: OkrGoal[] | undefined, shown: OkrGoal, field: "objective" | "criteria", text: string, html?: string): OkrGoal[];
// 전주 목표·달성기준 가져오기 — 달성기준은 지금 loadPrevCriteria 규칙 그대로(빈 것 제외, 전부).
// 목표는 같은 달 안의 전주일 때만, 그리고 전주 칸에 objectiveSet이 있던 번호만 표시와 함께 가져온다(달이 바뀌면 월 목표가 바뀌므로 넘기지 않는다).
export function prevGoalsToCarry(prevEffective: OkrGoal[], sameMonth: boolean): OkrGoal[];

// 핵심방향 단계 보기 — 첫 줄은 머리글. 나머지 줄은 ", 월말" 같은 경계에서 잘라 주간/월말/분기 낱말로 단계를 고른다. 못 고른 조각은 rest.
export function directionSteps(text: string): { headline: string; steps: Array<{ key: "week" | "month" | "quarter"; label: string; text: string }>; rest: string[] };

// 여러 기간 기록 한 번에(분기 화면 주차 기록) — cycle_id=in.(…)
export async function getOkrReportsIn(cycleIds: string[]): Promise<OkrReport[]>;
```
- 바꾸는 것: `OkrFeedback`에 `judgment?`, `OkrGoal.html`에 `objectiveSet?`, `mergeFeedback`을 칸 단위 병합으로. `normalizeGoals`는 그대로 둔다(html을 통째로 보존하므로 손댈 필요 없음).
- `overlayGoals`가 objective를 덮을 때 결과 goal의 `html.objectiveSet`도 남긴다. 화면이 "고친 목표인지" 알아 월 목표를 회색으로 함께 보일 수 있게 하려는 것이다.
- **그대로 두는 것**: `overlayCriteria`, `putCriteria`, `criteriaToCarry`(옛 화면과 tests/okrCriteria.test.ts), `worstInMonth`(쓰는 곳은 없어지지만 이번엔 지우지 않는다). `quarterProgress`는 테스트를 `quarterRollup`으로 바꾼 뒤 쓰는 곳이 0이면 구현서 A가 지운다.
- `directionSteps` 예(10월 핵심방향 전사본): headline = "10월은 4분기 목표의 … 시작한다." / steps = [week "주간에는 실행하고", month "월말에는 목표 대비 숫자와 미달 원인을 확인하여 11월 전략을 정한다.", quarter "분기 말 지식과 교훈으로 … 남긴다."]. 단계가 하나도 안 잡히면 화면은 지금처럼 문단으로 보인다.

### 4-2. `src/OkrHub.tsx` (구현서 C) — 연결만, 표 그리기는 하위 파일

| 함수·줄 | 바꿀 것 |
|---|---|
| `teamGoalsOf`·`personGoalsOf` (:434-435) | `newMonth`면 `overlayGoals`, 아니면 `overlayCriteria`(옛 그대로) |
| `setCriteria` (:447) | 새 경로는 `putGoalField(..., "criteria", …)`, 옛 경로는 `putCriteria` 그대로. 새 `setObjective(team, who, no, text, html)` → `putGoalField(..., "objective", …)` |
| `loadPrevCriteria` (:462) | 새 경로: 달성기준 entries는 지금 그대로 + `prevGoalsToCarry(prevEffective, 전주가 같은 달인지)`의 목표 칸을 같은 번호에 얹는다(prevEffective도 새 경로에선 `overlayGoals`로). 확인창 문구 "목표·달성기준". 옛 경로는 그대로 |
| `mergeWeeks` (:709) | `worstInMonth` → `lastJudgmentInMonth` |
| `goalOps.write` (:510) | 'copy'에서 처음 굳힐 때 `goals_prev` 같이 저장 |
| 월 통합집계 렌더 (:860-863) | `ops={goalOps}`(fromQuarter여도), 새 props `onCsJudgment(no, j)` → `updateCycle({ feedback: … judgment })`, `onPickTeam(team)` → `openTeamFresh(team)` 뒤 member '' |
| `openQuarter` (:235) | `setTab("all")`을 빼고 지금 탭을 유지한다. 세 달 주차 id를 `weekIdFor`로 모아 `getOkrReportsIn` 한 번 → `progress`에 `weekReports: Record<달id, OkrReport[]>`(정식 id로 바꿈) 추가 |
| 분기 렌더 (:850-857) | `tab === "all"` → `OkrQuarterView`에 `rollup={quarterRollup(...)}`, `onQuarterJudgment(no, j)` → `updateCycle`(분기 행 feedback), `onPickMonth(monthId)` → `openMonthView(…, "all", "")`. 파트 탭 → `QuarterTeamView`(같은 rollup, `team`, `onPick(monthId)` → `openMonthView(y, m, team, "")`, `onPickMonthHead(monthId)` → `openMonthView(y, m, team, 기본 사람)`). "월을 고르세요" 블록은 지운다 |
| 탭 머리 숫자 (:841) | `isQuarterView`면 숫자·미흡 표시를 그리지 않는다 |
| `freshTeam` (:759) / TeamView 호출 (:865-870) | `FreshTeam`에 세 가지를 더한다. `suggestOf(no)`: 월 파트 종합 판정 제안, `lastJudgmentInMonth(monthWeekRows, team, no)`. `onObjective(no, text, html)`. `monthGoalOf(no)`: 주차에서 고친 목표 위에 월 목표를 보일 때 쓰며 `commonGoals`에서 찾는다 |
| `TeamView` (:907-1032) | **fresh일 때만**: 병목현상·목표·달성기준 칸 클래스를 새 상수로. 주차(level week)에서 목표 칸 `RichCell` 편집 + `onObjective`. 월 파트 종합 판정 제안 = `fresh.suggestOf`(없으면 지금 `worstJudgment`). 표 위 `OkrLegend`. 안내 문구 "(목표는 통합집계에서만)" → 새 경로 문구로. 버튼 라벨 "목표·달성기준 불러오기"(fresh week만). **fresh가 없을 때(옛 화면)의 JSX는 한 줄도 바꾸지 않는다** |

### 4-3. `src/OkrMonthRollup.tsx` (구현서 B)

- `OkrMonthRollup`: 핵심방향 → `<OkrDirection>`(ui-designer 부품). A~D 칸 → `JudgmentDot`(채움/속 빔) + 누르면 `onPickTeam`. **CS 종합 열 추가**(`JudgmentPicker` + 자동값 줄). 범례. `editable = !!ops`(fromQuarter 조건을 빼고 띠 문구만 바꿈). 칸 클래스를 새 상수로. 새 props: `onCsJudgment(no, judgment)`, `onPickTeam(team)`. `monthlyRollup(cycle, reports, quarter, weekRows)`로 4번째 인자를 넘긴다. 열 폭 키 `okr_cols_summary_v3`(열이 하나 늘어남).
- `MonthTeamSummary`: 제안 `worstInMonth` → `lastJudgmentInMonth`. 나머지는 그대로.

### 4-4. `src/OkrQuarterView.tsx` (구현서 B)

- `OkrQuarterView`: 두 표를 **하나로**: `병목 n | 병목현상 | 목표 | 달×3 | 분기 종합`. 달성기준(실행)은 행 아래 접기(월 통합집계와 같은 "달성기준 ▾"). props `progress` → `rollup: OkrQuarterRollup`, 새 `onQuarterJudgment(no, j)`, `onPickMonth(monthId)`. 열 폭 키 `okr_cols_quarter_v2`.
- 새 export `QuarterTeamView({ team, goals, rollup, onPick, onPickMonthHead })`: 2-3 틀(읽기 전용, 팀장색).

### 4-5. ui-designer(윤화면) 부품

- `src/okrUi.ts`: `TD_LEADER`, `TD_LEADER_EDIT`, `TD_SPLIT` 상수(옛 `TD_FIXED*`는 그대로).
- `src/OkrCells.tsx`: `JudgmentDot({ cell: OkrJudgedCell, size?, onClick?, title? })`(채움/속 빔/없음), `OkrLegend({ split?: boolean })`.
- 새 `src/OkrDirection.tsx`: `OkrDirection({ text, monthLabel, onChange })`. `directionSteps`로 머리글 + 3단계 화살표 줄을 그리고, [고치기]를 누르면 RichCell(colors=false) 편집으로 바뀐다. 남색 띠, 과녁 모양 표시, 단계 사이 화살표. 폰(682px)에서는 단계를 세로로 쌓는다. `motion-reduce` 대응. 이모지 없이(디자인 원칙).

---

## 5. 작업 분해 (겹치지 않게)

| 순서 | 담당 | 파일(이 사람만 건드림) | 할 일 |
|---|---|---|---|
| 1 | 개발실 **구현서 A** (sonnet) | `src/okr.ts`, `tests/okrQuarter.test.ts` | 4-1 전부 + 단위 테스트(6절 T1~T9). `quarterProgress` 테스트를 `quarterRollup` 테스트로 바꿈 |
| 1 (동시) | 디자인실 **윤화면** (sonnet) | `src/okrUi.ts`, `src/OkrCells.tsx`, 새 `src/OkrDirection.tsx` | 4-5. 타입(`OkrJudgedCell`)·`directionSteps`는 A가 만든다. 시그니처는 이 문서대로 고정하고, A가 끝난 뒤 맞춘다 |
| 2 | 개발실 **구현서 B** (sonnet) | `src/OkrMonthRollup.tsx`, `src/OkrQuarterView.tsx` | 4-3, 4-4 |
| 2 (동시) | 개발실 **구현서 C** (**opus**: 1,148줄 화면, 옛/새 경로 두 갈래) | `src/OkrHub.tsx`, `tests/okrHub.render.test.tsx` | 4-2. B의 props 이름은 이 문서대로 고정 |
| 3 | 품질실 **검수아** | (고치지 않음) | build·test + 7절 회귀 |
| — | 데이터실 표다빈 | 없음 | **이번엔 부르지 않는다**(DDL·SQL 없음) |

구현서는 B와 C 두 명이 동시에 일하고, A가 먼저 끝나야 한다. 모두 세 명이다.

---

## 6. 테스트 (영향과 추가)

- `tests/okrCriteria.test.ts`: **바꾸지 않는다.** 그대로 통과해야 한다(옛 함수 그대로).
- `tests/okrQuarter.test.ts` (A):
  - T1 `lastJudgmentInMonth`: W1 미착수 · W2 미흡 · W4 완료 → 완료. 같은 주에 두 사람(완료·미흡) → 미흡. 파트 행은 무시. 판정이 없으면 "".
  - T2 `partMonthJudgment`: 월 행 판정이 있으면 set, 없으면 suggest.
  - T3 `monthCsJudgment`: A 완료(set) · B 미흡(suggest) → auto 미흡. override "완료"면 judgment 완료, manual true.
  - T4 `quarterCsJudgment`/`lastOfJudgments`: [미흡, 완료, ""] → 완료.
  - T5 `quarterRollup`: 9행, byMonth·quarter·byTeam 값, months의 actionTeams(지금 quarterProgress 기대값 10월 2 · 11월 1 그대로).
  - T6 `overlayGoals`/`putGoalField`: **옛 objective 글이 든 덮어쓰기 칸(표시 없음)은 objective를 무시한다**(회귀 핵심). 표시가 있으면 objective를 덮어쓴다. 파트 → 개인 사슬. 빈 objective는 덮어쓰기를 지운다. criteria만 고칠 때 같은 칸의 objectiveSet을 지킨다.
  - T7 `prevGoalsToCarry`: 같은 달이면 표시 있는 목표만 넘기고, 다른 달이면 목표는 넘기지 않는다.
  - T8 `directionSteps`: 10월 전사본 → headline + 3단계. 단계 낱말이 없는 글 → steps가 비고 rest에 글.
  - T9 `mergeFeedback` 칸 단위: 내가 judgment, 서버가 memo를 고치면 둘 다 남는다.
- `tests/okrHub.render.test.tsx` (C):
  - [4분기]: "분기 진행" 문자열과 "10월 … 조치 1" 정규식 기대를 새 틀로 바꾼다("4분기 종합"이 보이고, "조치 1"은 달 머리에 남는다).
  - [4분기] 파트 탭: `QuarterTeamView`가 "A파트"와 10·11·12월 머리를 그리고, "월을 고르세요"가 없다.
  - [10월] 통합집계: "CS 종합", 범례, 핵심방향 단계 낱말("주간 실행"·"월말 확인"·"분기 정리"), fromQuarter여도 "고치면 11월 OKR로 저장" 문구.
  - 주차 TeamView(level week): 목표 칸이 읽기 전용이 아님(편집 칸 클래스), "목표·달성기준 불러오기".
  - **옛 화면 기대(">병목<span", "9월 달성기준 불러오기", "병목현상" 없음)는 그대로 둔다.**

---

## 7. 회귀 확인 (검수아)

- R1 8월([3분기] → [8월]): A~D 파트 종합 9행 결과·판정, 통합집계(옛 SummaryView) 열·색이 그대로다(`TD_FIXED` 하늘색 유지).
- R2 9-W4 C·D 팀원 기록, 9월 달성기준 덮어쓰기가 그대로 보인다. 옛 화면 버튼 라벨도 그대로다.
- R3 10-W1~W3 파트원 기록: 목표 칸에 **옛 objective 글이 되살아나지 않는다**(덮어쓰기 칸 37행, 표시 없음). 달성기준 덮어쓰기(10-W3 A 김정민 7칸 등)는 그대로다.
- R4 주차 목표를 고침 → 새로고침 → 다른 창에서 15초 뒤 보인다. 파트 '' 주차에서 고친 목표가 파트원 칸의 기본이 되고, 파트원이 고친 것은 그 사람에게만 남는다.
- R5 [✨ 주차 합치기]: 판정이 빈 칸만 마지막 주차 판정으로 채운다. 월 파트 종합 판정 칸 제안도 같은 값이다.
- R6 CS 종합을 고름 → 새로고침 → 유지된다. 같은 번호 개선계획 메모를 다른 창에서 동시에 고쳐도 둘 다 남는다.
- R7 옛 앱 캐시: 옛 앱이 결과 칸만 고쳐 저장해도 `objectiveSet` 표시가 남는다(html 보존). 옛 앱이 달성기준을 고치면 표시가 사라지는 것은 알려진 한계다.
- R8 11월(goals_origin copy): 통합집계에서 목표를 고침 → 월 행 goals_origin manual, goals_prev = 옛 복사본, [직전 목표로 되돌리기]가 보인다. 11-W5 이민구 달성기준 덮어쓰기는 그대로다.
- R9 SQL 전(probeOkrQuarterSchema false) 화면이 그대로다(새 경로를 타지 않음).
- R10 A파트 탭에서 [4분기] → A파트 분기 화면 → 11월 점을 누르면 11월 A파트 [파트 종합]이 열린다. [10월]을 누르면 탭이 A파트로 남는다.
- R11 폰(682px): 핵심방향 단계가 세로로 쌓이고, 분기·월 표는 가로 스크롤된다.

---

## 8. 열린 결정 (팀장 제안값 포함, 한 번에)

| # | 질문 | 팀장 제안값 |
|---|---|---|
| D1 | '마지막 기록 주차'를 파트 단위로 볼까(가장 늦게 적힌 주차 하나, 그 주 안에서 가장 나쁜 것), 사람 단위로 볼까(사람마다 마지막 주차 → 그중 가장 나쁜 것)? | **파트 단위**(팀장 결정 문구 그대로). 사람 단위로 보면 4주에 안 적은 사람의 3주 판정이 남아서 결과를 끌어내린다 |
| D2 | 주차 목표 덮어쓰기 표시를 어디에 둘까 | **`html.objectiveSet`**(옛 캐시 앱이 저장해도 살아남음). 최상위 `set`이 더 깔끔하지만, 옛 앱이 결과만 고쳐 저장해도 지워진다 |
| D3 | 주차 화면에서 병목현상도 쪼개 적게 할까 | **아니오**. 병목현상은 팀장이 정의한 문제이고, 주차는 목표·달성기준만 쪼갠다. 필요하면 같은 방식(`bottleneckSet`)으로 나중에 더한다 |
| D4 | 파트 분기 종합(파트 탭 분기 화면 끝 열)을 사람이 덮어쓰게 할까 | **자동만**(마지막 기록 달). 저장할 자리를 새로 만들어야 하고 엑셀 양식에도 없다 |
| D5 | CS 종합 자동값에 파트 '제안'(○)까지 넣을까 | **넣는다**(판정을 안 고른 파트가 있어도 CS 종합이 빈칸이 되지 않게). 대신 ●/○로 출처를 보인다. 조치 필요 파트는 확정만 센다 |
| D6 | 상단 필터 구조 [4분기][10월][11월][12월]를 바꿀까 | **그대로**. 문제는 구조가 아니라 "분기 × 파트" 칸이 막다른 길이었던 것이다(2-3으로 해결). 분기·월 사이를 오갈 때 탭(통합집계·A~D)을 유지하면 필터 = 기간 축, 탭 = 범위 축으로 두 축이 깔끔하게 맞는다. 주차를 상단으로 올리는 안은 1차 결정대로 하지 않는다 |
| D7 | 편집 권한(1차 Q3) | **지금처럼 누구나**, 색으로만 구분. 잠금은 범위 밖(10절) |

---

## 9. 위험

1. **옛 objective 글 되살아남**(가장 큼): 표시 없이 objective를 읽으면 37행의 옛 글이 주차 화면 목표로 뜬다. → T6·R3로 막는다.
2. **판정 제안이 둘로 갈림**: 월 파트 종합 판정 칸 제안(글 기반 `worstJudgment`)과 주차 합치기 제안(마지막 주차)이 다르면 사람이 헷갈린다. → fresh 월 파트 종합은 `suggestOf` 하나로 맞춘다.
3. **3자 병합 손실**: feedback의 judgment와 memo가 같은 번호 객체에 있다. → 칸 단위 병합(T9).
4. **분기 화면 조회 늘어남**: `in.(…)` 한 번 + 지금의 7번. 틱마다 다시 읽지 않는다.
5. **11·12월 첫 편집으로 굳힘**: 누가 실수로 글자 하나를 고쳐도 월 OKR이 'manual'이 되어 "팀장 OKR 대기" 띠가 사라진다. 팀장이 나중에 붙여넣으면 덮이고(goals_prev 보존) 되돌리기도 있으므로 받아들인다. 띠 문구로 미리 알린다.
6. **열 폭 저장 키**: 열 수가 바뀌는 표는 키를 올린다(`okr_cols_summary_v3`, `okr_cols_quarter_v2`). `useColWidths`는 길이가 다르면 기본값을 쓰지만, 같은 길이로 우연히 맞으면 엉뚱한 열에 폭이 붙는다.

---

## 10. 하지 않을 것

- 표 구조 변경·SQL(없음). `okr_reports`에 'CS' 행을 만들지 않는다.
- 편집 권한 잠금(팀장·파트장 확인). 색과 범례만.
- 주차 단계 이름(1주 계획 → 2주 20% → 3주 중간점검 → 4주 마무리)을 칩·점에 박아 넣기. 이 단계는 팀장 문서의 **내용** 규칙이지 화면 규칙이 아니다(주차 수도 달마다 4~5개로 다름).
- 8·9월 옛 화면(`SummaryView`, 옛 `TeamSummary`, 옛 TeamView 경로) 수정.
- okr-assist 엣지 함수 수정, ✨ 도구 다시 켜기(`SHOW_OKR_TOOLS`).
- 분기 개선계획 메모 열(분기 통합집계 끝 메모 칸). 필요하면 다음 차례에 `quarter.feedback[no].memo`로 더한다.
- App.tsx, 다른 기능 파일.

---

## 3차(2026-10-21 사용자 지시)

1. 상단 필터 [n분기]는 통합집계 탭에서만, 파트 탭(A~D)은 [10월][11월][12월]만(`filterItemsForTab`). 분기 화면에서 파트 탭을 누르면 그 분기 지금 달(`quarterNowMonth`: 오늘이 든 달, 아니면 첫 달)의 그 파트 [파트 종합]으로 간다. `QuarterTeamView` 삭제.
2. 범례(`OkrLegend` "팀장 문서·결과 입력·●○") 모든 화면에서 삭제, export 도 삭제.
3. 색은 병목현상·목표 열만(`TD_LEADER_EDIT`/`TH_LEADER` 남보라). 달성기준은 노랑 입력칸(`TD_WRITE`/`TH_WRITE`). `TD_SPLIT`·`TH_SPLIT`(청록) 삭제.
4. 주차 칩([1주][2주]…)은 파트원 이름을 골랐을 때만(`showsWeekChips`). 파트 종합 = 그 달 하나(칩·"n월 종합" 칩 없음), 팀원 집계에도 없음.
5. 팀원 집계(`MonthTeamSummary`) 첫 "병목 n" 번호 열 삭제(열 폭 키 `okr_cols_teamsum_v4_…`). 병목현상 글·목표 열은 유지.
6. 새 구조 경로의 [✨ 주차 합치기]·[↩ n주차 목표·달성기준 불러오기]·[↩ n주차 실제결과 불러오기] 단추 삭제. 옛 화면 단추, 판정 "→ 제안", [📋 팀장 문서 붙여넣기]·[직전 목표로 되돌리기]·[분기 OKR로 시작]은 유지.
7. 주차 열 머리 = 파트 종합과 같게(병목현상·목표·달성기준…, "(n월 전략)"은 파트 종합만). 병목현상·목표 편집: 통합집계·파트 종합(월)은 월 공통 goals(goalOps), 주차는 header.goals 덮어쓰기(`putGoalField` "bottleneck" → `html.bottleneckSet`, `overlayGoals`가 표시 있는 칸만 덮음). 파트 종합 달성기준은 그 파트 월 report header.goals.

---

## 4차(2026-10-21 사용자 지시)

1. "팀장 문서" 배지(분기 표 제목 옆)와 띠 문구 삭제. 복사본 달(copy) 띠만 "n월 OKR이 아직 없어 4분기 OKR을 보여줍니다. 고치면 n월 OKR로 저장됩니다".
2. 층별 독립: 통합집계(월 cycle goals, 통합집계에서만 편집) / 파트 종합(그 파트 월 report header.goals) / 파트원 주차(자기 header.goals)는 서로 동기화하지 않는다. 칸·field 마다 자기 글이 없을 때만 위 층 글이 기본(파트원 주차의 기본 = 그 달 파트 종합 `monthParts`). `putGoalField` 는 빈 글도 표시(`bottleneckSet`·`objectiveSet`·새 `criteriaSet`)와 함께 저장 → 비우면 빈 채 유지. 표시 없는 옛 칸: objective·bottleneck 무시, criteria 는 글이 있을 때만 덮음.
3. 새 구조 안내 줄 두 개("…파트 것이 기본으로 보이고…", "…파트 제출 — 통합집계에 반영됩니다…")와 목표 칸 위 회색 "월: …" 삭제. 옛 화면 안내 줄은 그대로.
4. 판정 칸의 "제안" 글자 삭제(팀원 집계 "제안 완료" → "완료"). 제안은 ○ 점으로만. "→ 완료" 단추는 그대로.
5. 파트 탭 사람 박스: [팀원 집계] → [파트 종합] → 파트원 순.
6. 병목현상 칸 굵게 + 글자색(RichCell, `html.bottleneck`). 칸 안 "병목 n" 라벨과 월 통합집계·분기 표의 No 열 삭제(목표 삭제 ×는 월 통합집계 병목현상 칸 오른쪽 위). 열 폭 키 `okr_cols_summary_v4`, `okr_cols_quarter_v4`.
7. [4분기] 통합집계 머리 구색을 월과 같게: 핵심방향 띠(OkrDirection "4분기 핵심방향", 분기 행 `direction`, 월과 같은 updateCycle 저장) + A~D 파트 카드(`TeamCard`를 OkrCells로 빼서 월·분기 공용).
8. 분기 파트 카드 값 = `quarterTeamCard`: 목표마다 그 파트 월 판정 중 마지막 기록 달(`byTeam.quarter`)로 판정 n/총·달성 %·미흡·미착수 수, 파트장 = 분기 달 중 가장 최근 파트 월 report `header.leader`. 카드를 누르면 그 파트 탭(지금 달 파트 종합).
9. (5차, 사용자 "11·12월 다 지워줘") 월 OKR이 아직 없는 달(goals_origin copy·goals 비어 있음·글 없음)은 분기 글 대신 분기 Pillar만 있는 빈 틀(`monthScreenGoals`, 분기 없으면 빈 3×3) — 통합집계·파트 종합·주차 모두 이 바탕. 안내는 "n월 OKR이 아직 없습니다 — [📋 팀장 n월 OKR 붙여넣기] 또는 [분기 OKR로 시작]". 빈 틀에 적으면 manual로 굳음(예전 그대로). `effectiveGoals`는 그대로(화면 층만).
