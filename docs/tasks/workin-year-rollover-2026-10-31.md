# 워킨맵 연도 칸·분기 전환 규칙 (2027년 1분기 대비)

- 작성: 2026-10-31 밤, 기획실 한설계(feature-planner). **조사·설계만, 코드 0.** MCP 없이 코드·SQL 파일·docs 로 조사 — DB 값은 §2-5 실측 SQL 로 팀장이 확인.
- 기준 커밋: 867ccd3 (워킨맵 동기화 P1 가동 뒤).
- 마감: **12월 안**. 실제 마감은 2027-01-01 이 아니라 **워킨맵에 "27년 1분기" 워크가 처음 생기는 날**(보통 분기 말 2~3주 전 → 12월 중순 추정). 그날 06:10 old 회차가 그 워크를 가져온다(§2-3 ⑥).

---

## 1. 한 줄 목표와 쓰는 사람

`workin_map_places` 에 **연도(year)** 를 넣어 범위 키를 (team, **year**, quarter, kind) 로 바꾼다. 해가 바뀌어도 "27년 1분기"와 "26년 1분기"가 섞이지 않고, 지난 분기 행은 지우지 않고 보관해 연도+분기 필터로 본다.

| 쓰는 사람 | 기기 | 어디서 |
|---|---|---|
| 현장 기사(A~E) | 폰 | 워킨맵 화면 필터, FIELD 점검 전송 뒤 자동 완료(색칠), 업체 카드 "n분기 점검 필요" |
| 팀장·관리자 | PC | 홈 KPI(K2 점검 진행·K35 재계약), 워킨맵 진행률·주차분석, 엑셀 불러오기, 자동 일정, 재계약 준비, 해피콜 분기 안내 |
| 시스템 | 서버 | 엣지 workinmap-sync(가져오기), data-ask(AI 질의) |

---

## 2. 실측·조사 결과

### 2-1. 지금 연도가 있는 곳 / 없는 곳

| 위치 | 연도 |
|---|---|
| `workin_map_places` | **없음.** `quarter smallint 1~4` 뿐. `ext_year smallint`(동기화 짝지은 행만, nullable) — supabase/workin-sync-20261031.sql:97 |
| 인덱스 | `workin_map_scope_idx (team, quarter, kind)` — workin-map-shared.sql:22, visits.sql:166 |
| `workin_sync_works` | **있음** `year` + `workin_sync_works_scope_idx (team, year, quarter, kind) where status='target'` |
| 엣지 `parseWorkName` | 워크 이름 `yy년 n분기` → year (plan.ts:39~69). 테스트 워크는 이름 날짜 `26.10.31` → year |
| 앱 `currentQuarter()` | src/workinPlaces.ts:47 — 분기 번호만. 같은 식이 각 파일에 복사돼 있음(아래 전수) |

### 2-2. 분기 번호를 비교하는 곳 전수 (연도 없이 quarter 만 봄)

**프런트 (src/)**

| # | 파일:위치 | 하는 일 | 해가 바뀌면 생기는 일 |
|---|---|---|---|
| F1 | WalkingMap.tsx:149~171 `loadPreferences` / :1819~1823 저장 | 필터 저장(localStorage `savedIn: "YYYY-Q"`), 분기 바뀌면 현재 분기로 | 연도 없음 → 필터에 year 추가 필요(savedIn 형식은 그대로 둬도 됨) |
| F2 | WalkingMap.tsx:2035·2550 목록 필터 `place.quarter !== quarterFilter` | 목록·지도·엑셀 내보내기 범위 | 26년 1분기 + 27년 1분기가 한 목록에 섞임 |
| F3 | WalkingMap.tsx:1949~1989 재계약 매칭 `prevQuarter`·`baseYear = new Date().getFullYear()` | 분기점검 행에 "재계약 n분기 워킨맵" 배지 | 1분기에 prevQuarter=4 → 작년 4분기여야 하는데 연도 구분 못 함 |
| F4 | WalkingMap.tsx:1995·2252·2280·2320 진행률·주차분석·좌표 없는 곳 | `progressYear = new Date().getFullYear()` 고정 | 지난해 분기를 골라도 올해 날짜로 계산 |
| F5 | WalkingMap.tsx:2490~2540 엑셀 불러오기 `[교체]` | `deleteRows(team, quarter, kind)` | **27년 1분기 교체가 26년 1분기 행을 지운다(보관 깨짐)** |
| F6 | WalkingMap.tsx:563 `toDbPlace`, :580 `blankPlace`, :3347 초안 분기 select | 행 저장 | year 를 안 보냄 |
| F7 | WalkingMap.tsx:79 places 캐시 `cs_workin_map_places_v2` | 첫 화면 캐시 | 캐시 행엔 year 없음 |
| F8 | workinSync.ts:15~26 `syncedCountInScope`·`canReplaceScope` | 동기화 범위 교체 금지 | 27년 4분기 교체가 26년 4분기 연결 행 때문에 막힘(반대로 26년 행 지우는 것도 못 가림) |
| F9 | workinProgress.ts:32 `workinProgressQuery(q)`, :54 `workinRenewalQuery(q)` | 홈 K2·K35 원본 쿼리 | 작년 같은 분기 행이 합쳐져 진행률 왜곡 |
| F10 | kpi/kpiData.ts:191·193 (`ranges.quarterNo`) | 위 쿼리 호출 | 〃 |
| F11 | kpi/periodCursor.ts:6·21~25 "분기는 **올해 안**" | 지난 분기 넘겨 보기 상한 | **1월엔 q−1=0 → 작년 4분기를 볼 수 없다**(연도 칸이 없어서 둔 제한) |
| F12 | kpi/kpiCompute.ts:85~87 `quarterNo`·`quarter.from` | 범위 | quarter.from 에 연도 있음 → year 꺼낼 수 있음 |
| F13 | App.tsx:3603·3614 FIELD 업체 카드 | `quarter=eq.q&kind=eq.quarter` | 작년 같은 분기 행이 "완료/필요" 판단에 섞임 |
| F14 | App.tsx:4091~4244 `syncWorkinMapAfterInspection` | **자동 완료(색칠)**: 이번 분기 + 다음 분기(`nextQuarter = q===4 ? 1 : q+1`) 행 `quarter=in.(q,nq)` | 12월: nq=1 → **26년 1분기 잔여 행**이 선반영 대상(잘못 G5)이 되거나, 27년 1분기 행과 겹쳐 "후보 2곳 · 자동 반영 제외" |
| F15 | vendorFlags.ts:98~118 | 재계약 prev/cur/next 분기, 분기점검 cur | 1분기·4분기에 연도 넘김 오판 |
| F16 | visitAdviceData.ts:68·237~238 `quarterOf(today)` | 방문 판단 안내글 워킨맵 사실 | 작년 같은 분기 섞임 |
| F17 | QuarterNotice.tsx:32~57 | 해피콜 분기 안내 대상(`quarterKey`엔 연도 있음, 쿼리엔 없음) | 작년 같은 분기 번호까지 문자 대상 |
| F18 | recontract/api.ts:379~406 `fetchRenewalScope(q)`, recontract/AnalyzeView.tsx:757 | 재계약 준비 | 작년 같은 분기 섞임, `baseYear` 고정 |
| F19 | AutoSchedule.tsx:79·135·144·174·238·514, autoScheduleCandidate.ts:94 `pickAnchorHit` | 자동 일정(분기 고르기 1~4) | 다음 해 분기 미리보기 불가, 앵커가 작년 행을 고를 수 있음 |
| F20 | entity360.ts:534~549 `summarizeWorkin`·`latestQ` | 통합 검색 워킨맵 요약 | "가장 최근 분기" = 번호 최대(4) → 27년 1분기보다 26년 4분기를 최신으로 봄 |
| F21 | ContactChangeHistory.tsx:117~136, ServiceReception.tsx:1387~1395 | 주소·전화 바뀜 → 이름 첫 매칭 1행 PATCH(`order=id.asc`) | 가장 **오래된** 행(작년)을 고침. 지금도 3·4분기 중복에서 같은 문제 |

**SQL·엣지**

| # | 위치 | 하는 일 |
|---|---|---|
| S1 | supabase/auto-schedule.sql:83 `suggest_workin_candidates(p_quarter)` | `w.quarter = coalesce(p_quarter, extract(quarter from current_date))` — 연도 없음, `current_date` 는 UTC |
| S2 | supabase/vendor-master.sql:147~172 | 보이는 행 전체로 거래처 코드 매칭(분기 무관) — 영향 작음(행만 늘어남) |
| E1 | workinmap-sync/sync.ts:195~196 `loadLocal` scope `and(ext_id.is.null,team,quarter,kind)` | **27년 1분기 워크가 26년 1분기 미연결 행을 짝 후보로 끌어옴(이름 같으면 덮어씀)** |
| E2 | sync.ts:243 `maxRows`(team,quarter,kind) → `scopeEmpty` | 26년 같은 분기 행이 1개라도 있으면 "처음 들여오기" 아님 → 새 장소가 첫 회차 확인 큐로 가거나 **50곳 넘으면 too_many_new 중단** |
| E3 | sync.ts:198~203 다른 워크의 ext_id 로 행 찾기 | 워킨맵이 워크 복사 때 장소 _id 를 유지한다면 새 워크가 작년 행을 "이동"으로 가져감(분기 칸은 안 바뀜) — §2-5 M4 로 확인 |
| E4 | plan.ts:977~986 `appOnlyHideAllowed` | 범위에 연도가 없어 "같은 범위 최고 연도 워크 1개" 우회 규칙 |
| E5 | plan.ts:1300~1311 새 장소 insert | `team, quarter, kind` + `ext_year` — year 없음 |
| E6 | _shared/ask/tools-field.ts:182~185 `recontractProgress` | `quarter=eq.q` |
| E7 | _shared/ask/catalog.ts:95 | AI 표 설명에 연도 없음 |

### 2-3. 행이 들어오고 남는 방식(코드 기준)

① **엑셀 [교체]** (WalkingMap.tsx:2490~2540): 파일 행에 새 id(`Date.now()+i`)를 주고 upsert → 그 다음 `team·quarter·kind` 범위에서 **새 목록에 없는 id 를 전부 삭제**. 즉 같은 분기 번호의 옛 행은 지워지고, **다른 분기 번호 행은 그대로 남는다** → 3분기 행이 4분기 교체 뒤에도 남아 있는 이유. 라벨·메모는 **파일 값 그대로**(색 초기화 규칙 없음).
② **엑셀 [추가]**: 그냥 append. 같은 범위에 중복 가능.
③ **동기화 새 장소 insert**(plan.ts:1300~1317): 라벨 = 워킨맵 값 그대로, G5/G12 면 `[G5 완료] <워킨맵 last_update 날짜> (워킨맵)` 메모를 붙임.
④ **동기화 짝 행 PATCH**(plan.ts:1217): 색이 바뀌면 같은 형식 메모(날짜 = 워킨맵 장소 last_update). 완료 하향은 확인 큐(keepAppDone).
⑤ **FIELD 자동 완료**(App.tsx:4235~4244): `[G5 완료] YYYY-MM-DD` (다음 분기면 ` (n분기 선반영)` 꼬리).
⑥ **동기화 크론 범위**(sync.ts:446~452): `current` = 올해·이번 분기 워크만, `old`(06:10) = 그 밖 전부 — **다음 분기 워크(예: 12월에 만든 27년 1분기)도 old 회차가 처음 가져온다.** 그날이 실질 마감.
⑦ 앱 화면은 지난 분기 행을 **지우지 않는다**. 사람이 [교체] 할 때만 같은 번호 분기가 지워진다.

### 2-4. 지난 분기 G5 가 4분기 행에 섞인 9곳 — 가능한 경로

| 경로 | 흔적(메모 꼬리) | 판정 |
|---|---|---|
| P1 엑셀 [교체]: 워킨맵에서 4분기 워크를 **3분기 워크 복사로** 만들어 색·메모가 같이 왔고 그 엑셀을 들여옴 | 앱 형식 `[G5 완료] 2026-0x-xx`(꼬리 없음) 또는 워킨맵 메모, `updated_by` = 들여온 사람 | 문제 경로(유력) |
| P2 동기화 PATCH/insert: 워킨맵 4분기 워크의 장소가 복사 때 G5 를 가진 채 → 앱에 G5 + 메모 날짜 = 워킨맵 last_update(9월 이전) | `[G5 완료] 2026-0x-xx (워킨맵)` + `workin_sync_log` field=label after G5 | 문제 경로(가능) |
| P3 FIELD 9월 선반영 | `(4분기 선반영)` 꼬리 | **정상**(분기 말 선점검) |
| P4 사람이 장소 편집에서 분기를 3→4 로 바꿈 | `updated_by` = 사람, 로그 없음 | 드묾 |

→ 브리프의 "새 장소 insert 는 워킨맵 값 그대로라 9곳은 엑셀 교체 경로일 것" 은 **절반만 맞다.** 동기화 insert/PATCH 도 워킨맵이 들고 있는 낡은 G5 를 그대로 가져오므로(P2), 9곳을 M3 SQL 로 분류해야 한다. 공통 원인은 "**워킨맵 워크를 지난 분기 복사로 만드는 습관**"일 가능성이 크다(열린 질문 Q3).

### 2-5. 팀장이 돌릴 실측 SQL (읽기 전용, MCP execute_sql)

```sql
-- M1 범위별 행 수(연도 백필 전 기준) — 지난 분기 행이 어떻게 남았나
select team, quarter, kind, count(*) n,
       count(*) filter (where visible is not false) vis,
       count(*) filter (where ext_id is not null) linked,
       count(*) filter (where label in ('G5','G12')) done,
       min(updated_at)::date first_upd, max(updated_at)::date last_upd,
       array_agg(distinct ext_year) filter (where ext_year is not null) ext_years
from workin_map_places group by 1,2,3 order by 2,1,3;

-- M2 ext_year 가 2026 이 아닌 행(백필 기본값 검증)
select ext_year, team, quarter, kind, count(*) from workin_map_places
where ext_year is not null and ext_year <> 2026 group by 1,2,3,4;

-- M3 4분기 완료색인데 이번 분기 완료 메모가 없는 행 분류(9곳)
with r as (
  select id, team, kind, label, name, updated_by, updated_at, ext_id, memos,
    (select string_agg(x, ' | ') from jsonb_array_elements_text(memos) x
      where x ~ '^\[(G5 완료|G12 이관)\]') done_memos,
    (select max(substring(x from '\d{4}-\d{2}-\d{2}')) from jsonb_array_elements_text(memos) x
      where x ~ '^\[(G5 완료|G12 이관)\]') last_done
  from workin_map_places where quarter = 4 and kind = 'quarter' and label in ('G5','G12'))
select id, team, name, label, updated_by, updated_at::date, ext_id is not null linked, last_done, done_memos,
  case when done_memos ~ '선반영' then 'P3 선반영(정상)'
       when done_memos ~ '\(워킨맵\)' then 'P2 동기화'
       when last_done is null then '완료 메모 없음'
       else 'P1/P4 엑셀·수동' end cls
from r where last_done is null or last_done < '2026-10-01' order by cls, team, id;

-- M3-b 위 행들의 동기화 로그(색이 언제 어디서 G5 가 됐나)
select l.place_id, l.field, l.before_value, l.after_value, l.note, l.created_at
from workin_sync_log l
where l.field in ('label','_insert') and l.place_id in (
  select id from workin_map_places w where quarter = 4 and kind = 'quarter' and label in ('G5','G12')
  and not exists (select 1 from jsonb_array_elements_text(w.memos) x where x ~ '^\[G5 완료\] 2026-1[0-2]'))
order by l.place_id, l.created_at;

-- M4 워킨맵이 워크 복사 때 장소 _id 를 재사용하나(다른 워크에 붙어 있던 ext_id 를 옮긴 적)
select count(*) moved from workin_sync_log
where field = '_link' and before_value is not null and jsonb_typeof(before_value) <> 'null';
-- 워크 목록: 3분기 워크가 있는지, 이름 규칙
select account_no, name, team, year, quarter, kind, status, place_count, last_pulled_at::date
from workin_sync_works order by year, quarter, team, kind;

-- M5 1·2분기 잔여 행 내용(브리프: A 1·B 1 monthly 등)
select id, team, quarter, kind, label, name, updated_by, updated_at::date
from workin_map_places where quarter in (1,2) order by quarter, team, kind, id;

-- M6 같은 이름이 여러 분기에 있는 곳(주소·전화 자동 수정이 오래된 행을 고치는 F21 규모)
select count(*) from (select name from workin_map_places group by name having count(distinct quarter) > 1) t;
```

**미리 적어 둘 판단**: M4 가 0 이면 E3 위험 없음(워킨맵은 복사 때 새 _id). 0 이 아니면 §3-4-4 의 ext_id 유일 키를 (ext_work_id, ext_id) 로 바꾸는 안을 켠다. M1 에서 1·2분기 범위가 비어 있지 않은 (팀, 업무) 가 바로 1월 W1 고장 대상이다.

---

## 3. 설계

### 3-1. 데이터 (db-schema 확정, 아래는 초안)

`supabase/workin-year-20261101.sql` (새 파일 1장, 재실행 안전):

```sql
-- 1) 열 (nullable 로 먼저)
alter table public.workin_map_places add column if not exists year smallint;

-- 2) 가까운 연도 규칙: 분기 번호만 들어오면 (지금 KST 연·분기) 에서 가장 가까운 해(동점이면 지난 쪽)
--    12월에 1분기 → 다음 해, 1월에 4분기 → 작년, 4분기 중 2분기 → 올해(동점 → 과거)
create or replace function public.workin_nearest_year_(q int, at timestamptz default now())
returns smallint language sql stable as $$
  with c as (select extract(year from (at at time zone 'Asia/Seoul'))::int y,
                    extract(quarter from (at at time zone 'Asia/Seoul'))::int cq)
  select (select yy from c, generate_series(c.y - 1, c.y + 1) yy
          order by abs((yy * 4 + q) - (c.y * 4 + c.cq)), yy limit 1)::smallint;
$$;

-- 3) 채움 트리거: year 가 비면 (update 면 이전 값) → ext_year → 가까운 연도
create or replace function public.workin_fill_year_() returns trigger language plpgsql as $$
begin
  if new.year is null then
    new.year := coalesce(case when tg_op = 'UPDATE' then old.year end, new.ext_year, public.workin_nearest_year_(new.quarter));
  end if;
  return new;
end $$;
drop trigger if exists workin_map_places_year on public.workin_map_places;
create trigger workin_map_places_year before insert or update on public.workin_map_places
  for each row execute function public.workin_fill_year_();

-- 4) 백필: 지금 행은 전부 2026(ext_year 있으면 그 값) — M1·M2 결과로 확인 뒤
update public.workin_map_places set year = coalesce(ext_year, 2026) where year is null;

-- 5) 제약·인덱스
alter table public.workin_map_places alter column year set not null;
alter table public.workin_map_places drop constraint if exists workin_map_places_year_check;
alter table public.workin_map_places add constraint workin_map_places_year_check check (year between 2020 and 2100);
create index if not exists workin_map_scope_y_idx on public.workin_map_places (team, year, quarter, kind);
drop index if exists public.workin_map_scope_idx;

-- 6) 함수 권한: 새 함수는 anon EXECUTE 자동(pg_default_acl) → fill 은 트리거 전용이라 revoke
revoke execute on function public.workin_fill_year_() from public, anon, authenticated;

-- 7) 확인 큐 종류 추가 'stale_done'(지난 분기 완료색 의심, §3-3 R5)
--    workin_sync_review_kind_check drop/add(기존 값 + 'stale_done')

-- 8) 자동 일정 RPC suggest_workin_candidates 에 p_year int default null 추가(drop 후 create, grant 다시)
--    조건 w.year = coalesce(p_year, workin_nearest_year_(coalesce(p_quarter, 현재 KST 분기)))
--    current_date(UTC) → KST 로

-- 9) (조건부, M4 > 0 일 때만) ext_id 유일 인덱스 → (ext_work_id, ext_id)
```

sql-review 에 넘길 점:
- 4) 백필 UPDATE 는 `set_workin_updated_at` 로 **전 행 updated_at 이 바뀐다** → 열린 화면들이 증분 폴링으로 7,9xx 행(약 8MB)을 한 번 다시 받음. **밤(22시 이후) 실행.** `workin_sync_enqueue` 는 label/visible/memos 실제 변경에만 반응하므로 되밀기 큐 0(트리거 조건 재확인).
- NOT NULL 은 BEFORE 트리거 뒤에 검사되므로 **옛 앱(year 안 보냄)도 계속 저장된다** → SQL 을 앱보다 먼저 실행해도 안전(배포 순서 SQL → 엣지 → 앱).
- `workin_sync_update_places` RPC 의 허용 칸 목록(workin-sync-20261031.sql:301)에는 **year 를 넣지 않는다**(동기화 PATCH 가 행의 연도를 못 바꾸게, insert 만 year 를 씀).
- `ext_year` 는 남긴다(= 짝지은 워크의 연도, 감사용). 권위 값은 `year`.
- RLS·권한: 기존 "workin_map_places anon all" 그대로. 새 표 없음.
- 되돌리기: 트리거·함수 drop, 인덱스 원복, `drop column year`(앱이 year 를 읽기 시작한 뒤엔 앱 먼저 되돌릴 것).

### 3-2. 앱 공용 규칙 (src/workinPlaces.ts 한 곳, 구현 A 가 이 이름 그대로)

```
type YearQuarter = { year: number; quarter: Quarter }
currentYQ(now?)          // KST 기준(지금 currentQuarter 는 기기 시계 getMonth) — kstDate 로
shiftYQ(yq, n)           // 4분기 +1 → 다음 해 1분기, 1분기 −1 → 작년 4분기
nearestYearFor(q, now?)  // SQL workin_nearest_year_ 와 같은 규칙(엑셀 파일명에 연도 없을 때 기본값)
yqLabel(yq, short?)      // "26년 4분기" / 짧게 "26·4Q"
yqKey(yq)                // "2026-4" (savedIn 과 같은 모양)
scopeFilter(yqs[])       // PostgREST 조각: 1개면 year=eq.Y&quarter=eq.Q, 여럿이면 or=(and(year.eq.2026,quarter.eq.4),and(year.eq.2027,quarter.eq.1))
placeYear(row)           // row.year ?? row.ext_year ?? nearestYearFor(row.quarter) — 캐시·옛 응답 대비
sameYQ(row, yq)          // placeYear(row) === yq.year && row.quarter === yq.quarter
```
`workinProgressQuery(yq)`·`workinRenewalQuery(yq)` 는 scopeFilter 를 쓴다(인자 형이 바뀜 → 호출부 kpiData 2곳·tests).

### 3-3. 분기 전환 규칙

**R1 새 분기 행은 앱이 만들지 않는다.** 워킨맵 담당이 워킨맵에 `수도권C 27년 1분기 점검` 워크를 만들면 → 06:10 old 회차(또는 1/1 이후 current 회차)가 워크를 찾고 → 범위 (C, 2027, 1, quarter) 가 비어 있으므로 `scopeEmpty` = true → **처음 들여오기(firstImport)로 전부 insert, 50곳 상한 없음**(plan.ts:1135~1136 기존 규칙). 새 행 `year` = 워크 연도.
- 엣지 E1·E2 를 연도로 고치지 않으면: 26년 같은 분기 잔여 행 때문에 `scopeEmpty` = false → 첫 회차 → 새 장소가 전부 확인 큐(또는 50곳 넘어 **too_many_new 중단**) → **1월 첫 주 점검률 0**. 이 작업에서 제일 급한 고장점.
- E 팀(동기화 대상 아님)·엑셀 운영 범위는 기존대로 엑셀 [교체]/[추가] — 단 범위에 연도 포함(R4).

**R2 지난 분기 행은 그대로 보관.** 지우지도 숨기지도 않는다. 화면 필터 "26년 3분기"로 본다. 분기마다 약 4,800행 늘어남(W5).

**R3 FIELD 자동 완료의 다음 분기 선반영 = (연, 분기) 쌍.**
- `cur = currentYQ()`, `next = shiftYQ(cur, 1)` → 12월이면 next = (2027, 1).
- 조회: `scopeFilter([cur, next])` + kind quarter|monthly. 비교: `sameYQ(row, cur)` / `sameYQ(row, next)`.
- 규칙 ①②(이번 분기 미완료면 이번 분기만, 완료·이관·미등재면 다음 분기 선반영, 매월은 이번 분기만)는 그대로.
- 메모 꼬리: 연도가 넘어가면 ` (27년 1분기 선반영)`, 같은 해면 지금처럼 ` (4분기 선반영)`. M3 의 `선반영` 판정과 호환.
- 26년 1분기 잔여 행은 next 에 절대 걸리지 않는다(연도 다름). 27년 1분기 워크가 아직 없으면 지금처럼 "다음 분기 등재 없음 → 이번 분기 상태로 보고".
- FIELD 업체 카드(F13)는 `scopeFilter([cur])`.

**R4 범위 키에 연도를 넣는 곳(교체·막기·숨김).**
- 엑셀 [교체] 삭제 2곳: `team=eq&year=eq&quarter=eq&kind=eq`. 교체 확인창 개수·`restoreMaskedImport` 기존 행 범위도 연도 포함.
- 엑셀 패널에 **연도 칸**: 파일명 `(\d{2})\s*년` 이 있으면 그 값, 없으면 `nearestYearFor(분기)`.
- `canReplaceScope`·`syncedCountInScope`: `ImportScope` 에 year → 26년 4분기 연결 행이 27년 4분기 교체를 막지 않는다.
- 엣지 `appOnlyHideAllowed`: 같은 (team, **year**, quarter, kind) 대상 워크가 1개일 때만 → "최고 연도" 우회 삭제(단순화). 계약종료+재계약 두 워크가 같은 범위면 여전히 false.

**R5 지난 분기 완료색이 새 분기로 섞여 오는 것 막기.**
- (엑셀) 미리보기에서 "G5/G12 인데 완료 메모 날짜가 이 범위 분기 시작일 전이고 `선반영` 꼬리가 없는 곳 n곳"을 센다 → 확인창 체크 **"지난 분기 색으로 보고 G1 로 들여오기"**(기본값 Q4) → 바꾼 행 메모에 `[지난 분기 색 초기화] G5→G1 (엑셀 YYYY-MM-DD)`.
- (동기화 insert·PATCH) 워킨맵 라벨이 G5/G12 이고 그 장소 `last_update` 가 범위 분기 시작일(KST) 전이면 → **자동으로 내리지 않는다**: insert 는 워킨맵 값 그대로(불변 조건 "워킨맵 G5 절대 안 줄음" — 앱이 G1 로 넣으면 P2 되밀기가 워킨맵을 내림), PATCH 도 반영하되, 둘 다 확인 큐 `stale_done`(처리 필요 종류에 추가)에 올림 → 관리 카드 [완료 맞음] / [지난 분기 색 — G1 로](사람 결정이라 되밀기 허용).
  - 9월에 워킨맵에서 미리 칠한 정상 G5 도 큐에 올 수 있다 — [완료 맞음] 한 번. 분기 초 1회성.
- (지금 9곳) M3 분류 뒤 P1·P2 만 정리. **워킨맵 쪽에서 색을 고쳐야** 다음 pull 에서 G5 로 돌아오지 않는다(keepAppDone 은 앱 완료만 지킴). Q3.

**R6 지난 분기 넘겨 보기 상한.** `periodCursor` 분기 상한 "올해 안"을 없애고 BACK_LIMIT 3(= 최근 4개 분기)만. 1월에도 26년 4분기를 본다. 워킨맵 원본은 `ranges.quarter.from` 의 연도로 조회.

### 3-4. 엣지 workinmap-sync 변경 (구현 D)

1. `loadLocal` scope: `and(ext_id.is.null,team.eq.T,year.eq.Y,quarter.eq.Q,kind.eq.K)`.
2. `maxRows`(scopeMaxNumber·scopeEmpty): `year=eq.Y` 추가.
3. 새 장소 insert 행: `year: parse.year`(+ ext_year 그대로).
4. ext_id 로 다른 워크에서 찾은 행(sync.ts:198~203): 그 행의 (team, year, quarter, kind) 가 이 워크와 다르면 **짝 후보에서 뺀다**(옮기지 않음) → fresh. M4 > 0 이면 insert 가 ext_id 유일 인덱스에 막히므로 3-1 의 9) 를 같이 켠다.
5. `appOnlyHideAllowed` 단순화(R4).
6. stale_done 판정(R5): 순수 함수 `isStaleDone(label, lastUpdate, parse)` — 범위 분기 시작 KST = `Date.UTC(year, (q-1)*3, 1) - 9h`.
7. 짝 행의 `year` 가 `parse.year` 와 다르면 링크하지 않고 로그 note `year_mismatch`(1·4가 맞으면 안 일어나야 함 — 경보용).

### 3-5. AI·검색(작음)

- tools-field.ts `recontractProgress`: `args.year`(기본 = 가까운 연도) 추가, 쿼리에 year.
- catalog.ts:95 표 설명에 "year(연도). 같은 분기 번호가 해마다 있으니 year+quarter 로 거를 것" 한 줄.
- entity360 `summarizeWorkin`: 키에 year, 정렬·`latestQ` 를 `year*10+quarter` 로.

---

## 4. 화면 흐름

1. 워킨맵 화면 진입 → 필터 기본 = **올해·이번 분기**(KST). 머리 칩 `C 26·4Q 전체`.
2. [조건] 메뉴 → 첫 줄 **연도 칩**(데이터에 있는 연도 + 올해, 최근 3개) → 둘째 줄 분기 1~4. 그 연도에 행이 없는 분기는 흐리게.
3. 목록·지도·진행률·주차분석·엑셀 내보내기(`CS워킨맵_C팀_26년4분기_분기점검.xlsx`)가 고른 (연, 분기) 기준. 진행률 머리 "26년 4분기 팀별 진행률 · 남은 영업일 n일"(지난 분기면 "끝남").
4. 엑셀 불러오기 패널 → 팀·**연도**·분기·업무(파일명에서 추정) → 미리보기에 "지난 분기 색 의심 n곳" 체크 → [교체]/[추가].
5. FIELD 점검 전송 → 자동 완료 결과 패널 "분기점검 27년 1분기: 선반영"(연도 넘을 때만 연도 표기).
6. 관리 › 기타 설정 › 워킨맵 동기화 카드 → 확인 큐 "지난 분기 완료색 의심" 줄 → [완료 맞음] / [G1 로].
7. 홈 KPI 분기 ◀ — 1월에도 26년 4분기로 넘어감.

디자인: 2·4·6 단계는 윤화면이 목업 이미지 먼저(메모리 규칙 "디자인은 항상 목업으로").

---

## 5. 작업 분해 (겹치지 않게, 파일 단위)

| 순서 | 담당 | 할 일 | 건드릴 파일(이것만) |
|---|---|---|---|
| 0 | 팀장 | §2-5 M1~M6 실행, 결과를 §8 에 붙임(M4 로 3-1 9)·3-4-4 결정) | 없음(읽기) |
| 1 | db-schema(표다빈) → sql-review(권한나) | §3-1 SQL 확정. 백필 기본값을 M1·M2 로 검증, 리뷰 큐 kind, RPC p_year, (M4>0) 인덱스. /sql-handoff, 밤 실행 | supabase/workin-year-20261101.sql(새). auto-schedule.sql 은 머리 주석 한 줄("p_year 는 workin-year 파일")만 |
| 2 | ui-designer(윤화면) | 목업: 조건 메뉴 연도 칩·머리 칩·엑셀 패널 연도·지난 분기 색 체크·확인 큐 stale_done 줄·자동 일정 분기 선택("26년 4분기 / 27년 1분기") | 목업 이미지만(코드 0) |
| 3a | 구현 A(구현서, sonnet) — **먼저 머지** | §3-2 헬퍼, `workinProgressQuery/RenewalQuery(yq)`, `canReplaceScope`/`syncedCountInScope` year, entity360 요약 2함수 | src/workinPlaces.ts, src/workinProgress.ts, src/workinSync.ts(ImportScope·두 함수만), src/entity360.ts(summarizeWorkin·latestQ 만) |
| 3b | 구현 B(구현서, **opus** — 3,500행 파일) | WalkingMap: 필터 year 상태·저장(prefs 에 `year` 추가, savedIn 형식 유지), F2~F7, 엑셀 연도·삭제 범위·R5 미리보기, `toDbPlace`/`blankPlace`/초안 연도 select, 캐시 키 v3(v2 삭제), 진행률·주차·재계약 매칭 baseYear = 고른 year | src/WalkingMap.tsx 만 |
| 3c | 구현 C(구현서, sonnet) | App.tsx F13·F14(R3), vendorFlags F15, visitAdviceData F16, QuarterNotice F17, recontract F18, AutoSchedule F19(+p_year, 분기 선택 = 이번·다음·그 뒤 2개 (연,분기)), kpi F10~F12·R6, F21(같은 이름 행 중 최신 (연,분기) 우선 — 이번·다음 분기 행 모두 고침) | src/App.tsx(쿼리·비교식·문구만, 아래 Q5), src/workinAutoComplete.ts(새, Q5 승인 시), src/vendorFlags.ts, src/visitAdviceData.ts, src/QuarterNotice.tsx, src/recontract/api.ts, src/recontract/AnalyzeView.tsx, src/AutoSchedule.tsx, src/autoScheduleCandidate.ts, src/kpi/kpiData.ts, src/kpi/kpiCompute.ts, src/kpi/periodCursor.ts, src/ContactChangeHistory.tsx, src/ServiceReception.tsx(1387~1395 만) |
| 3d | 구현 D(오류진 또는 구현서, opus) | §3-4 엣지 + §3-5 AI + 확인 큐 stale_done 라벨·처리 단추 | supabase/functions/workinmap-sync/{sync,plan}.ts, supabase/functions/_shared/ask/{tools-field,catalog}.ts, src/WorkinSyncAdmin.tsx·src/WorkinSyncReviewLine.tsx(stale_done 줄), src/workinSync.ts(리뷰 라벨 맵·REVIEW_ACTION_KINDS 만 — 3a 와 다른 줄) |
| 4 | qa-checker(검수아) | 아래 테스트 + build/test + 가짜 날짜 시나리오 | tests/* |
| 5 | 팀장 | 매뉴얼 docs/manual/user/12-walking-map.md(연도 필터·분기 전환·지난 분기 색), ops DB 장(year 열·트리거·백필), AGENTS·worklog, 엣지 배포 | docs/* |

3a 의 함수 이름·형(§3-2)을 지시서에 박아 두면 3b·3c·3d 는 동시에 시작 가능.

**테스트(qa)**
- 새 tests/workinYear.test.ts: `shiftYQ`(4→다음 해 1, 1→작년 4), `nearestYearFor`(12월 q1→+1, 1월 q4→−1, 동점 과거), `scopeFilter` 문자열, `placeYear` 폴백, `sameYQ`.
- workinmapSync.test.ts: 26년 1분기 미연결 행이 있어도 27년 1분기 워크 = firstImport·전부 insert·옛 행 짝 안 됨, insert 행 year, appOnlyHideAllowed(연도 다른 같은 분기 워크 = true), isStaleDone(9월 last_update + 4분기 범위 = true, 10월 = false), 다른 범위 ext_id 행 옮기지 않음.
- 자동 완료 선택 규칙(Q5 승인 시 src/workinAutoComplete.ts): 12월 next=(2027,1), 26년 1분기 행 무시, 같은 해 꼬리 "(4분기 선반영)"·넘을 때 "(27년 1분기 선반영)".
- kpiPeriodCursor.test.ts: 1월에 분기 ◀ 3번 가능. kpiDataWindow: 쿼리에 year.
- canReplaceScope: 연도 다른 연결 행은 막지 않음.
- 가짜 날짜 시나리오: 2026-12-20(선반영 next = 27·1Q), 2027-01-05(필터 기본 27·1Q, KPI ◀ 26·4Q, 엑셀 [교체] 27·1Q 가 26·1Q 행을 안 지움).
- 실환경 리허설: 테스트 워크(T) 이름을 `…27.01.05` 날짜로 하나 더 만들어 (T, 2027, 1) 범위 dry → 실제 pull(T 는 KPI·숨김 영향 없음).

**공수(대략)**: SQL 0.5일 · 엣지 1일 · 헬퍼 0.5일 · WalkingMap 1.5일 · 나머지 소비처 1.5일 · 테스트·QA 1일 · 매뉴얼 0.3일 = **약 6일**.

**일정(12월 안)**

| 날짜 | 단계 |
|---|---|
| 11/3 주 | 0 실측 · 설계 승인(Q1~Q6) · 1 SQL 작성/리뷰 |
| 11/10 주 | SQL 밤 실행(앱보다 먼저, 호환) · 3a·3d 머지 · 엣지 배포 |
| 11/17 주 | 3b·3c · QA · 배포 |
| 11/24~12/5 | T 워크 27년 리허설 · 9곳 정리 · 매뉴얼 |
| **12/5 까지** | 엣지 연도 수정 라이브(27년 1분기 워크 생기기 전, Q6 로 조정) |
| 1/4(월, 첫 영업일) | 확인: 필터 기본 27·1Q, KPI, 06:10 회차 로그(insert 수·stop 0), 자동 완료 1건 |

---

## 6. 위험·열린 질문

**위험**
- W1 (가장 큼) 엣지를 안 고친 채 27년 1분기 워크가 생기면: 26년 같은 분기 잔여 행 때문에 범위가 "비지 않음" → 새 장소 전부 확인 큐 또는 too_many_new 중단 → 1월 점검률 0, 잔여 행 이름이 같으면 덮어씀. → 12/5 마감.
- W2 엑셀 [교체] 를 연도 없이 두면 27년 같은 분기 교체가 26년 행을 지움(보관 깨짐, 복구 불가).
- W3 localStorage: 필터 prefs 는 `year` 만 더하고 `savedIn`("YYYY-Q") 형식 그대로 → 옛 값 호환(year 없으면 올해). places 캐시 `cs_workin_map_places_v2` 엔 year 없음 → 키 v3 로 올리고 v2 삭제(첫 전량 조회가 어차피 돔). 놓쳐도 `placeYear` 폴백이 2차 방어.
- W4 백필 UPDATE 가 전 행 updated_at 을 바꿈 → 열린 기기들이 다음 폴링에 전량(약 8MB) 다시 받음. 밤 실행.
- W5 행 증가: 분기마다 약 4,800행, 워킨맵 화면은 `select=*` 전량을 받는 구조 → 27년 말 2만+행. **이번 범위 밖**, 다음 후보: 화면 조회를 "고른 (연,분기) + 이번·다음 분기"로(placesSync 증분 규칙 수정). M1 로 크기 확인.
- W6 R5 stale_done 이 분기 초 확인 큐를 늘림(정상 선반영 포함). 1회성.
- W7 기기 시계: 지금 분기 계산이 `new Date().getMonth()`(기기 시간대). 헬퍼는 KST(kstDate) 로 통일.
- W8 vendor-master 코드 매칭(S2)·MyPlan·CustomerReport 이름 검색은 연도 무관 전량 — 중복이 늘 뿐 고장은 아님(이번엔 안 고침).
- W9 재계약 4분기 대상 달 = 11·12·**1월**(renewalQuarterMonths) — `projectedContractEnd` 가 baseYear+1 로 이미 처리. 지난해 분기를 볼 때 baseYear 를 고른 연도로 넘겨야 함(3b·3c).
- W10 SQL 은 앱보다 먼저(옛 앱 호환). 거꾸로(앱 먼저) 배포하면 `year=eq.` 쿼리가 400 → 화면 빈 목록. /deploy 순서에 적을 것.

**사용자에게 물을 것(한 번에)**
- Q1 화면 연도 표기 "26년 4분기"(본문)·"26·4Q"(칩) 괜찮은가? 연도 칩은 최근 3년이면 되나?
- Q2 지난 분기 행은 그대로 보관(숨김 없음)으로 확정? 아니면 1년 지난 분기는 목록에서 기본 숨김?
- Q3 워킨맵 담당자가 새 분기 워크를 **지난 분기 워크를 복사해** 만드나? 그렇다면 색·메모를 비우고 만들어 달라고 안내할 수 있나(근본 해결). 9곳 정리는 워킨맵에서 색을 고쳐야 다시 안 돌아온다.
- Q4 엑셀 불러오기 "지난 분기 색 의심" 행 기본값: G1 로 바꿔 들여오기(체크 켬) vs 그대로(끔)?
- Q5 App.tsx 자동 완료의 행 선택 규칙을 새 파일 src/workinAutoComplete.ts 로 빼서 테스트를 붙여도 되나? (동작 불변, App.tsx 는 호출 줄만)
- Q6 27년 1분기 워킨맵 워크는 보통 언제 만드나(12월 몇째 주)? 엣지 마감일을 그에 맞춤.

---

## 7. 하지 않을 것 (범위 밖)

- 워킨맵 화면 전량 조회를 범위 조회로 바꾸는 속도 작업(W5) — 다음 작업.
- 지난 분기 행 삭제·자동 숨김·보관 표 이전.
- 워킨맵(workinmap.com) 쪽 워크 자동 생성·복사(우리는 워크를 만들지 않는다).
- 되밀기 P2 변경(연도와 무관 — ext_work_id 로 이미 워크 단위).
- `quarter_notice_log`·`workin_sync_works` 표 변경(이미 연도 있음).
- vendor-master 코드 매칭·MyPlan·CustomerReport 이름 검색의 연도 거르기(W8).
- 홈 KPI 디자인 변경(연도는 기간 라벨에만).

---

## 8. 실측 결과 (팀장이 M1~M6 실행 뒤 붙임)

실측: 2026-10-31 밤, 데이터실 표다빈(MCP execute_sql 읽기 전용). "라이브" = DB 에서 읽은 값, "파일" = 저장소 SQL 에 적힌 값.

- **표 크기**: workin_map_places 7,983행(라이브). 파일 workin-sync-20261031.sql 머리 주석은 7,895(그 전 값). DB TimeZone = UTC.
- **M1 범위별**
  | 분기 | 범위 | 행 | 비고 |
  |---|---|---|---|
  | 1 | A quarter·monthly·renewal 각 1 | 3 | 2026-07-19 이민구 시험 행, 미연결 (quarter 1행은 G5) |
  | 2 | B monthly·renewal 각 1 | 2 | 〃 |
  | 3 | A·B·C·D quarter/renewal(+C monthly) | 3,586 | 전부 미연결(ext_id null), 마지막 수정 9/22~9/30, 완료 G5/G12 3,314 |
  | 4 | A~D 연결 범위 + E 381·D monthly 1(미연결) | 4,392 | 연결 3,983(= ext_year 있는 행, 전부 2026) |
  → 1월 W1 고장 대상(27년 1분기 범위가 "비지 않음"): **A 팀 quarter·monthly·renewal**(각 1행). 2분기(4월) 대상: B monthly·renewal. 3분기(7월): A~D 전부.
- **M2** ext_year ≠ 2026: **0행**. ext_year null 4,000행 → 백필 `coalesce(ext_year, 2026)` 그대로 맞음.
- **M3** 4분기 분기점검 G5/G12 중 10월 완료 메모 없는 행 = **350**(브리프 "9곳"보다 훨씬 많음):
  P3 선반영(정상) 52(A 8·B 38·D 6) · P1/P4 엑셀·수동 1(B) · **완료 메모 없음 297**(A 95·B 48·C 139·E 15, G12 19 포함, E 외 전부 연결 행).
  - M3-b: 이 350행 중 workin_sync_log 에 label 변경 기록이 있는 행 **0** → 동기화가 G5 로 바꾼 게 아니라 **연결 전부터 앱에 G5 였다**(엑셀 [교체]로 들여온 색, 또는 메모 없이 사람이 칠한 색). P2(동기화) 경로는 지금 데이터에선 0.
  - 297행은 "지난 분기 색"인지 "메모 없이 칠한 이번 분기 완료"인지 DB 만으로 못 가른다 → 워킨맵 쪽 해당 장소 last_update·FIELD 10월 점검 실적과 대조 필요(팀장/한설계).
- **M4 (같은 ext_id 가 다른 ext_work_id 에?)**: places 내 ext_id 중복 0(유일 인덱스) · `_link` 로그 3,895건 중 before 값 있는 것(=다른 행/워크에서 옮김) **0** · 로그·확인 큐에서 ext_id 하나가 work_id 2개 이상 **0** · 연결 행의 (team, quarter, kind, ext_year) ↔ workin_sync_works 불일치 0 · 연결됐는데 works 에 없는 워크 0.
  **단서**: 지금까지 pull 한 워크는 4분기 11개(A~D 10 + T)뿐, 3분기·2분기 워크 12개는 last_pulled_at null → "워킨맵이 복사 워크에서 장소 _id 를 재사용하나"는 DB 로 증명 불가. **결정: §3-1 9) ext_id 유일 키 전환은 켜지 않는다.** 27년 1분기(또는 T 리허설) 첫 pull 에서 insert 23505 가 나면 그때 켠다(SQL 파일에 주석으로 준비). 엣지 3-4-4(다른 범위 ext_id 행은 옮기지 않음)는 그대로 구현.
- **워크 목록(workin_sync_works)**: 26년 2분기 renewal 4 · 3분기 9 · 4분기 10 + T 1 · excluded 2(영업확장성리스트) · unparsed 2(PC 영업 FORM). 이름 규칙 `수도권X_26년n분기점검(날짜)`·`계약종료X_26년n분기(월,월,월)(날짜)`. 27년 워크 아직 없음.
- **M5** 1·2분기 잔여 5행: id 1(A q1 quarter G5 "14SS (주)이오플랜 본사 1 매월마감") · 5(A q1 monthly G2) · 9(A q1 renewal G11 "제주 지점 휴면관리") · 2(B q2 monthly G3) · 6(B q2 renewal G6). 전부 이민구 2026-07-19 시험 행 → 백필 2026. 지워도 되는지는 사용자 확인(이번 SQL 은 안 지움).
- **M6** 같은 이름이 2개 이상 분기에 있는 이름 **2,233개**(F21 주소·전화 자동 수정이 오래된 행을 고치는 규모).
- **확인 큐 지금 kind**: downgrade 218 · conflict 68 · missing 22 · field_diff 8 · new 6 · ambiguous 4 → stale_done 추가 check 에 전부 포함(기존 행 안전).
- **함수(라이브)**: suggest_workin_candidates 8인자, 본문 = auto-schedule.sql 과 같고 라이브에만 `set search_path = public`. workin_sync_update_places = workin-sync-20261031.sql 과 같음(service_role 만). pg_default_acl(함수) = anon·authenticated EXECUTE 자동 → 새 트리거 함수는 revoke 필요(SQL 에 반영).
- **SQL 확정본**: supabase/workin-year-20261101.sql (설계 초안과 다른 점: 인덱스는 새 이름 대신 **workin_map_scope_idx 이름 유지·정의 교체**(옛 SQL 재실행 시 옛 정의 부활 방지) · 트리거에 `WHEN (new.year is null)` · 동기화 RPC 허용 칸·NOT NULL 칸에 year **넣음**(팀장 결정) · nearest 인자 이름 p_q/p_at(`at` 은 AT TIME ZONE 과 헷갈림) · suggest p_year 는 맨 끝 인자 · 백필 대안 B(updated_at 보존) 주석).
