# 홈 KPI 달성표·팀 카드: 지난 기간 넘겨 보기 (2026-10-26)

설계: 기획실 한설계. 조사만 했고 코드는 바꾸지 않았다. 기준 커밋은 f82fe35, 행 수는 2026-10-26 anon REST 로 count=exact 를 조회한 실측값이다.
사용자 요청(2026-10-26): "이번 주·이번 달·분기 이렇게 나오는데 저번 주 건? 저저번 주 건?"

## 1. 목표와 쓰는 사람
- 한 줄 목표: 홈 KPI 달성표와 팀 카드 5장을 지난 주·지난 달·지난 분기로 넘겨 보고, 단추 한 번으로 "오늘"로 돌아온다.
- 쓰는 사람: 팀장·파트장(PC, 주간 회의 때 "저번 주 몇 대였지?"), 파트원(폰, 자기 팀 카드). 읽기만 하고 쓰기는 없다.

## 2. 기존 코드 재사용·확장 지점

### 2-1. 핵심 발견: 지난 7주와 지난달은 이미 메모리에 있다
kpiData.loadKpiBundle 의 조회 범위는 from = kpiLoadFrom(ranges) = min(분기 시작, 지난주 월요일, **지난달 1일**, **weeks8[0] = 7주 전 월요일**)이고, to 는 분기 말이다(kpiCompute.ts:98).
오늘(10/26) 기준 from 은 **2026-09-01** 이다. 그래서 날짜로 거르는 원본은 이미 다음 범위를 읽어 둔 상태다.
- 지난 1~7주(9/7 주 ~ 10/19 주) 전부
- 지난달(9월) 전체
- 이번 분기 전체

연말(12/31)에는 from 이 10/1 이 된다. 이때도 weeks8 과 지난달 1일은 늘 포함되므로 "지난 7주 + 지난 1달"은 언제나 들어 있다.
그러므로 **주(8주 = 이번 + 지난 7주)와 지난 1달은 추가 조회 없이** 이미 읽은 묶음의 기간만 바꿔 다시 세면 된다. 추가 조회가 필요한 것은 2~5달 전과 지난 분기들뿐이다.

### 2-2. 재사용·확장 지점
| 파일:함수 | 지금 | 바꿀 것 |
|---|---|---|
| kpi/kpiCompute.ts kpiRanges(today) | 모든 범위가 today 기준 | 그대로 둔다. 새 kpiRangesAt(today, anchor) 추가: kpiRanges(anchor) 에 today·todayRange 는 진짜 오늘, 경과율 3개는 elapsedRate(범위, today)를 넣는다. 끝난 기간은 경과율이 100 으로 고정된다. **anchor = today 이면 kpiRanges(today) 와 깊이 같아야 한다**(테스트) |
| kpi/kpiCompute.ts kpiProgress·kpiTargetFor | rangeOfPeriod(ranges, period)·c.today | 변경 없음. 범위만 바뀐 ranges 를 넣으면 지난 기간 목표·실적이 나온다. toDate 는 min(range.to, today) 라서 끝난 기간이면 full 과 같다 |
| kpi/kpiCompute.ts kpiCount K29 | weekCompletionRate(rows, ctx.today): 오늘이 든 주로 고정 | weekCompletionRate(rows, r.from)(넘긴 범위의 월요일). 이번 주에서는 결과가 같다 |
| kpi/kpiCompute.ts workinPace | start = max(today, q.from) | 끝난 분기(today > q.to)이면 필요량 칸을 null 로 두고 완료/대상만 낸다 |
| kpi/kpiData.ts loadKpiBundle | opts.today 만 받음 | opts.anchor·opts.window(from,to) 추가. window 가 있으면 날짜로 거르는 원본은 그 범위만 읽는다. okr·workin·receptionWeek 는 anchor 기준으로 읽는다(3절) |
| kpi/kpiData.ts receptionWeek | receipt_date ≥ 이번 주 월요일 | ≥ weeks8[0].from(8주 치, 행 작음). 지난 주 K29 를 추가 조회 없이 낸다 |
| kpi/kpiData.ts okr | today 의 달·주차 | anchor 의 달·주차(currentWeekOf(anchor 주의 월요일)) |
| kpi/homeKpiModel.ts tableRowsFor·cachedView | 묶음 객체마다 WeakMap 캐시 | 변경 없음. 지난 기간은 ranges 만 바꾼 "파생 묶음"을 따로 만들어 넘긴다(새 객체라 캐시가 섞이지 않는다) |
| kpi/homeKpiModel.ts prevRangeOf | 지난주 같은 요일까지 | 끝난 기간에서는 직전 기간 전체(kpiRanges(anchor) 가 그렇게 낸다). 직전 기간이 읽은 범위 밖이면 null("대비" 숨김) |
| kpi/teamBoard.ts teamBoardView | (b, period, …) | 파생 묶음을 받는다. 열린 건(미처리)·OKR 칸은 4절 규칙을 따른다 |
| kpi/homeKpiSnapshot | 이번 주·말일 기준만 캐시 | 조건에 offset 0 추가. 지난 기간은 localStorage 에 쓰지 않는다 |
| HomeKpiBoard.tsx | period 상태 | cursor = {period, offset} 상태 + 지난 기간 추가 묶음 메모리 캐시 |
| kpi/KpiWidgets.view.tsx KpiTableBody 기간 칩 | [이번 주][이번 달][분기] | [주][월][분기] + 스테퍼(5절) |
| okr.ts okrWeeksInMonth·currentWeekOf | 주차 번호 | 주 라벨 "10월 3주차"에 같은 번호를 쓴다(OKR 화면과 같은 번호) |

비슷한 기능 확인: 조회 탭(DataLookup)에는 이미 기간 선택이 있다. 그러나 홈 숫자는 kpiProgress 하나로 세야 하므로 조회 탭 상태를 가져오지 않고 위처럼 ranges 만 바꾼다.

## 3. 데이터 설계: SQL 0

### 3-1. 원본별 지금 조회 범위(실측)
| 원본(source) | 표·위치 | 날짜 조건(지금) | 규모(실측·추정) | 지난 주(−1~−7) | 지난달 −1 | 2~5달 전·지난 분기 |
|---|---|---|---|---|---|---|
| field (HEAVY) | jeomgeom·as_records, 작성일 | from~to | 9월 1,049행(726+323), 10월 916행, 1행 약 1.8KB(_원문 포함). Q3 4,971행 ≈ 9MB | 메모리 | 메모리 | **추가 조회** |
| events (HEAVY) | activity_events, activity_date | from~to | 10월 1,103행, Q3 2,280행 ≈ 4.1MB. K28 교체양식에만 쓴다 | 메모리 | 메모리 | 추가 조회(교체양식만 거르는 최적화 후보 R3) |
| expansion (HEAVY) | 확장성 표들 | from~to | 작음 | 메모리 | 메모리 | 추가 조회 |
| visits (HEAVY) | visit_logs, work_date | from~to | 10월 1,111행, Q3 2,070행, 열 6개라 1행 약 120B | 메모리 | 메모리 | 추가 조회 |
| workin (HEAVY) | workin_map_places, quarter=eq.N(**연도 칸 없음**) | 이번 분기만 | q4 4,014행, q3 3,375행(3열이라 1행 약 50B) | 해당 없음(K2 는 분기 지표) | 해당 없음 | 지난 분기는 quarter=N 추가 조회. **올해 안만 맞다** |
| recontract (HEAVY) | recontract, 기간 없이 전량 | 전량 | 약 1,200행 | 메모리 | 메모리 | 메모리 |
| overage·logistics·contact·bulman | 양식 표 | from~to(일부는 created_at ≥ from−14일) | 작음 | 메모리 | 메모리 | 추가 조회 |
| misu·itQuiz·itPractice·praise·customerPraise | 각 표 | from~to / created_at ≥ from | 작음 | 메모리 | 메모리 | 추가 조회 |
| blog (LATE) | 구글 시트 CSV 전체 | 전량, 1.25MB | 메모리 | 메모리 | 메모리 | 메모리(작년분이 시트에 있는지는 확인 필요) |
| overhaul (LATE) | 시트 탭 "리스트(26년)" 전량 | 전량 | 작음 | 메모리 | 메모리 | 올해만. 작년 분기는 탭이 달라 "기록 없음" |
| receptionWeek | service_receptions, receipt_date ≥ 이번 주 월요일 | **이번 주만** | 작음 | 8주로 넓히면 메모리 | 해당 없음(K29 는 주 지표) | 해당 없음 |
| okr | okr_cycles(15행)·okr_reports | 이번 달·이번 주차 달 | 수십 KB | 같은 달이면 메모리, **다른 달 주차면 작은 추가 조회** | 작은 추가 조회 | 작은 추가 조회 |
| keyman (K18) | contact_changes, 최근 7일 | last7 | 작음 | "지금" 표시(4절) | 같음 | 같음 |
| unhandled (K16·K17)·K12 | 엣지 함수·as_tickets | 열린 건 | 해당 없음 | "지금" 표시 | 같음 | 같음 |
| roster | cs_members 활성(joined_on·left_on 칸은 있으나 지금 모두 null, 비활성 0명) | 해당 없음 | 작음 | 그대로 | 그대로 | 그대로(4-3) |

### 3-2. ① 기간별 따로 읽기 vs ② 처음부터 길게 읽기
| | ① 고를 때 추가 조회(캐시 키 = 기간) | ② 처음부터 6달·4분기 읽기 |
|---|---|---|
| 주 8개 | 추가 조회 0(이미 메모리) | 같음 |
| 지난달 | 추가 조회 0 | 같음 |
| 2~5달 전 | 한 번 누를 때 약 4MB(점검·AS 1,000행 1.9MB + 활동 1,100행 2MB + 방문 0.13MB + 작은 표). gzip 은 약 0.8MB로 추정 | 홈을 열 때마다·5분마다 + 약 13MB(5~8월 점검·AS 약 6,600행 + 활동 약 4,500행) |
| 지난 분기 | 한 번에 약 13.5MB(점검·AS 4,971행 9MB + 활동 2,280행 4.1MB + 방문·워킨맵 0.4MB). gzip 은 약 2.5MB로 추정 | 위에 포함 |
| 폰 | 누른 사람만 받는다 | 모든 홈 사용자가 4~5배를 받는다. 메모리 firstoa-field-performance 기준(첫 화면 < 1MB 노력)을 거스른다 |

**추천: ①을 쓰되 "메모리에 있으면 조회 0"을 먼저 따지는 혼합형.**
- coveredBy(mainRanges, sel): sel.from ≥ kpiLoadFrom(main.ranges) 이면 메인 묶음에서 파생 묶음(범위만 바꿈)을 만든다. 조회는 0, 숫자는 5분 갱신을 그대로 따라간다.
- 범위 밖이면 loadKpiBundle({ anchor, window: sel, sources: 날짜 원본 ∩ want }) 를 한 번 부른다. 대비용 직전 기간은 읽지 않는다(대비 숨김).
- 추가 묶음: 메모리 Map, 키 "period|from|to|today", 최대 3개(LRU). 자동 갱신 없음, [다시] 단추로만. localStorage 에 쓰지 않는다. 날짜가 바뀌면 버린다.
- 추가 조회 중에는 이미 메모리에 있는 원본(블로그·오버홀·재계약)부터 그리고, 무거운 원본 칸은 "…"로 둔다(지금 첫 로드 3단계와 같은 모양).
- 끝난 기간 묶음 안의 okr 는 anchor 달 기준으로 읽는다. 주가 메모리 범위 안이어도 달이 다르면(예: 9월 주차) okr 만 작은 추가 조회를 한다.

## 4. 경과율·상태·목표

### 4-1. 경과율·상태
- 끝난 기간은 kpiRangesAt 가 경과율을 100 으로 낸다. 이번 기간은 지금과 같은 값이다.
- 상태색은 고정 기준(kpiRowStatus, 50 미만 빨강 · 그 이상 파랑 · 100 초록) 그대로 쓴다. 막대의 경과 점선은 100% 위치에 그린다.
- "시작 전" 규칙(윤화면 설계 중)은 offset < 0 이면 적용하지 않는다. 끝난 기간에는 시작 전이 없다.
- 열린 건 지표(K12 재계약 지남, K16·K17 미처리, K18 키맨 7일)는 지난 기간에서 숫자는 지금 값 그대로 두고 회색 "지금" 칩을 붙인다. 상태색은 쓰지 않는다(status "none"). 지난 시점의 미처리 수는 남은 기록이 없어 복원할 수 없다.
- K29 접수 처리율: 그 주의 접수 건을 "지금 상태"로 센다. 툴팁에 "처리 여부는 지금 기준"이라고 적는다.
- K2 분기 점검 진행: 지난 분기는 quarter=N 행의 지금 상태를 마지막 결과로 보고 완료/대상%만 낸다. 필요량 n/일·기준일 칩은 숨긴다.

### 4-2. 목표(인당·영업일)
- 영업일은 bizDays(range) 가 날짜로 세므로(KR 공휴일과 설정 holidays) 기간마다 자동으로 맞는다.
- 목표 값(KPI_TARGETS)은 이력이 없어서 **지금 설정값**을 쓴다. 기준 툴팁에 "목표 = 지금 설정 기준"이라고 적는다.

### 4-3. 인원
- 지금은 활성 명단만 쓴다. cs_members 에 joined_on·left_on 칸이 있으므로 rosterAt(members, range) 를 둔다: joined_on ≤ range.to 이고 (left_on 없음 또는 ≥ range.from). 지금은 두 칸이 모두 null 이라 숫자 변화가 없고, 앞으로 퇴사·입사가 생길 때를 위한 대비다.
- 팀 이동은 이력 칸이 없어 지금 팀 기준이다(위험 R2).

### 4-4. 스냅샷 캐시
- 이번 기간(offset 0)만 쓴다. 지금 조건(period week·말일 기준)에 offset 0 을 추가한다.

## 5. 화면 흐름
1. 달성표 머리: [주][월][분기]   ◀  이번 주  ▶   [오늘로]. ▶ 는 이번 기간에서 비활성이고, [오늘로]는 offset 0 일 때 숨긴다. 폰에서는 기간 칩 줄 아래에 스테퍼를 한 줄로 둔다.
2. ◀ 를 누르면 라벨이 바뀐다.
   - 주: "지난주 10/19~10/25" → "10월 2주차(10/12~10/18)" … 최대 7번 = 8주. 번호는 월요일이 속한 달의 okrWeeksInMonth 순번이다.
   - 월: "이번 달" → "9월" → … 최대 5번 = 6개월.
   - 분기: "4분기" → "3분기" … **올해 안**(Q1까지, 지금은 3번 = 4분기).
   - 끝난 기간이면 라벨 옆에 작은 "마감" 칩을 단다.
3. 주는 메모리에서 바로 바뀐다. 2달 전 이상·지난 분기는 "읽는 중…"을 띄우고, 무거운 칸은 "…", 블로그·오버홀·재계약은 바로 보인다. 실패한 칸은 "—" + [다시].
4. 팀 카드 5장도 같은 기간으로 바뀐다. 카드 띠에 "10월 2주차 기준"을 표시하고, 미처리 칸은 회색 "지금"을 단다. 홈 머리 큰 숫자 3개(미처리·OKR 이번 주·분기 점검)는 그대로 "지금"이다.
5. OKR 박스(추천: 한 방향 연동): 기간이 주이고 스테퍼를 움직이면 OKR 박스의 고른 주차도 그 주로 간다. OKR 박스의 1~5주 칩을 눌러도 스테퍼는 움직이지 않는다. 다른 달 주차를 고르면 OKR 박스 칩이 그 달 주차로 바뀐다(3-2 의 okr 작은 추가 조회). 월·분기를 고르면 OKR 박스는 지금처럼 이번 주다.
6. [오늘로]를 누르면 offset 0 으로 돌아오고 캐시 값이 즉시 보인다. 커서는 저장하지 않으므로 홈을 다시 열면 늘 "이번 주"다.

## 6. 작업 분해(서로 겹치지 않게, SQL 0, App.tsx 0)
| 순서 | 담당 | 할 일 | 파일(추정 줄 수) |
|---|---|---|---|
| 1 | 구현 A(순수 함수, 먼저) | 새 src/kpi/periodCursor.ts: PeriodCursor{period,offset}·BACK_LIMIT{week:7,month:5,quarter:3}(분기는 올해 안으로 더 줄임)·anchorOf(today,cursor)(offset 0 = today, 그 밖 = 그 기간 말일)·cursorRange·cursorLabel(이번 주/지난주/n월 n주차(…)/n월/n분기)·step·coveredBy(mainRanges, range). kpiCompute 에 kpiRangesAt 추가, K29 를 r.from 으로, workinPace 끝난 분기 처리 | periodCursor.ts +120, kpiCompute.ts +25 |
| 2 | 구현 B(1 다음, C 와 병렬) | kpiData loadKpiBundle 에 anchor·window 추가, receptionWeek 를 weeks8[0].from 부터, okr 를 anchor 달·주차로, workin 을 ranges.quarterNo(anchor 분기)로. rosterFromMembers(members, range?) 를 joined/left 로 거르기. 지난 기간 원본 목록 PAST_SOURCES | kpiData.ts +45, kpiCompute.ts rosterFromMembers +6 |
| 2 | 구현 C(1 다음, B 와 병렬) | homeKpiModel bundleAt(b, cursor) 파생 묶음, 열린 건 "지금" 행 처리(status none + nowChip), prevRangeOf 의 읽은 범위 밖이면 null, quarterGoalView 끝난 분기 모드. teamBoard 의 파생 묶음·미처리 "지금". HomeKpiBoard 의 cursor 상태·추가 묶음 Map(LRU 3, 요청 토큰으로 늦게 온 응답 버림)·스냅샷 조건 offset 0·OKR 한 방향 연동 | homeKpiModel.ts +50, teamBoard.ts +15, HomeKpiBoard.tsx +60 |
| 2 | ui-designer(윤화면, 병렬) | KpiTableView 에 cursor?:{label,ended,canPrev,canNext,loading,onStep,onToday} 추가, 스테퍼·"마감" 칩·"지금" 칩·폰 한 줄 배치. TeamBoard.view 의 "n월 n주차 기준" 띠·"지금" 칩. 기존 [이번 주][이번 달][분기] 칩을 [주][월][분기]로 | KpiWidgets.view.tsx +60, TeamBoard.view.tsx +15 |
| — | db-schema | 없음. 실행할 SQL 없음 | — |
| 3 | qa-checker | 아래 테스트·빌드, 범위(다른 화면 미수정) 확인 | — |
| 끝 | 팀장 | docs/manual/user/02-home.md 에 "지난 기간 보기" 절, AGENTS 작업 기록, 평가 기록 | — |

테스트(새 tests/kpiPeriodCursor.test.ts, 약 20개):
- 지난 주 범위: today 2026-10-26(월) → −1 = 10/19~10/25, −7 = 9/7~9/13, −8 은 막힘. 일요일·월요일·분기 첫날에도 맞는다.
- 월·분기 범위: 1월에서 −1 = 작년 12월, 분기 상한은 올해 안.
- **anchor 불변**: kpiRangesAt(t, t) 가 kpiRanges(t) 와 깊이 같다. offset 0 일 때 tableRowsFor(파생 묶음) 가 지금 tableRowsFor(b) 와 행 단위로 같다(합성 묶음).
- 끝난 기간이면 경과율 100, 목표 toDate = full, 상태가 고정 기준이다.
- 조회 범위: coveredBy 가 −1~−7주와 지난달은 true, 2달 전과 지난 분기는 false. window 를 주면 loadFieldRows 가 그 from·to 로 불린다(가짜 로더).
- K29 를 r.from 으로 바꿔도 이번 주 값은 같다. K19 는 9월 주차(다른 달)를 고르면 okr 를 anchor 달로 읽는다.
- 대비: −7주에서는 직전 주가 읽은 범위 밖이라 trend 가 없다.
- 늦게 온 응답 무시: 커서를 두 번 빨리 바꾸면 마지막 것만 반영된다.

## 7. 위험(3)
- R1 연도 칸 없는 원본: workin_map_places 는 quarter 숫자만, 오버홀은 연도별 시트 탭이다. 작년 분기로 넘어가면 K2·K33 이 틀리거나 비게 된다. 그래서 분기 스테퍼를 올해 안으로 제한한다. 1월에는 지난 분기 보기가 사실상 막히고, 그때는 K2·K33 에 "기록 없음"을 보여 준다.
- R2 이력 없는 기준: 목표 설정·명단 팀·처리 상태(K29·K2)는 모두 지금 값이다. 9월에 팀을 옮긴 사람의 실적은 지금 팀 칸에 잡힌다. 툴팁에 "지금 기준"을 명시해 0 이나 거짓 정확도로 보이지 않게 한다.
- R3 지난 분기 용량: 한 번에 약 13.5MB(gzip 약 2.5MB 추정)라 폰에서 수 초가 걸린다. 완화책은 (a) 분기를 누를 때만 읽기 + "읽는 중" (b) events 를 교체양식 category 만 거르는 조회(별도 함수 인자 1개, K28 결과 같음 테스트) (c) LRU 3. (b)는 2단계 후보로 둔다.

## 8. 사용자 질문(2)
- Q1 OKR 박스를 달성표 스테퍼와 묶을까? 제안: 주 기간일 때만 한 방향(스테퍼 → OKR 박스)으로 묶고, OKR 박스 주차 칩은 OKR 박스만 바꾼다.
- Q2 분기 넘기기를 올해 안(지금은 1~4분기)으로 제한해도 될까? 작년 분기는 워킨맵·오버홀이 연도를 구분하지 못해 일부 칸이 비어 보인다. 제안: 올해 안.

## 9. 하지 않을 것
- 금일 현황 띠, 미처리 칸(목록·탭), 홈 머리 큰 숫자 3개는 늘 "지금"이다.
- 지난 시점의 미처리 수·재계약 지남 수를 복원하지 않는다(이력 없음).
- 목표 설정 이력, 팀 이동 이력 표는 만들지 않는다(SQL 0).
- 조회 탭·주간현황판·순위표의 기간 선택은 건드리지 않는다.
- 커서를 기기에 저장하지 않는다. 지난 기간 값은 localStorage 캐시에 넣지 않는다.
- 사용자 지정 날짜 범위(달력으로 아무 기간 고르기)는 만들지 않는다.
