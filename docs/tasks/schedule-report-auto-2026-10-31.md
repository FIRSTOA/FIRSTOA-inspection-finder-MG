# 중간보고 자동 발송 (12:00·14:00, C팀 먼저) — 설계안

2026-10-31 · 기획실 한설계(feature-planner) · 조사만·코드 0
사용자 원문: "12시, 2시에 알아서 일정보고가 가능하도록 가능할까? 일단 C팀만. 지금은 내가 일정리스트에서 [중간보고] 눌러서 AI 생성 후 복사·붙여넣기하고 있거든, 스케줄방에다가. '강남C 스케줄'이야."

---

## 1. 목표와 쓰는 사람

**한 줄 목표**: 평일 12:00·14:00(KST)에 C팀 중간보고를 서버가 스스로 만들어 카톡방 `강남C 스케줄` 에 올린다 — 지금 사람이 [📋 중간보고] → AI 생성 → 복사 → 붙여넣기 하던 것과 **글자 모양이 같은 글**로.

| 누가 | 어디서 | 무엇을 |
|---|---|---|
| C팀 파트장·팀장(지금 손으로 보내는 사람) | PC·폰 일정리스트 | 손 복사를 멈춘다. 자동 발송 결과를 보고 창에서 확인, 필요하면 [지금 보내기] |
| C팀 현장 기사 | 카톡 `강남C 스케줄` | 읽기만(변화 없음) |
| 관리자(사용자) | PC 관리 탭 | 스위치 2개·방 매핑 1줄. 첫날 테스트방 검증 뒤 실제 방 |

---

## 2. 현재 흐름 (조사 결과)

### 2-1. 본문을 만드는 코드 — 전부 `src/CsAsWorkspace.tsx` 컴포넌트 **안**
| 무엇 | 위치 | 비고 |
|---|---|---|
| 규칙 기반 초안 | `CsAsWorkspace.tsx:1309 buildMidReport(team, day)` | 클로저 — `tickets`·`todayYmd`·`tomorrowYmd`·`reportOrder` 를 컴포넌트 상태에서 씀 |
| AI 다듬기 + 조립 | `CsAsWorkspace.tsx:1397 composeMidReport(team, day)` | 같은 필터를 **복사본으로 한 번 더** 적음(주석 "그쪽 규칙이 바뀌면 여기도 함께") → payload 를 만들어 `report-polish` 호출 → 줄을 끼워 같은 틀로 재조립. 실패·개수 불일치면 초안 |
| 보고 순서(명단) | `CsAsWorkspace.tsx:559 teamAssignees`(useMemo) · `:574 reportOrder` | 팀장 → 자기 팀(명단 순) → CSS(E) 지원 → 다른 팀 CS. 원본 `cs_members`(src/authors.ts:65 `bookOf`) |
| 머리 시각 | `CsAsWorkspace.tsx:113 reportStamp()` | **브라우저 현지 시각** — 서버(UTC)에서 그대로 쓰면 9시간 틀림 |
| 오늘·내일 | `:115 getTodayYmd`(브라우저 현지) · `:116 getTomorrowYmd = planDate.nextBusinessDay` | 금요일의 익일일정 = 월요일, 공휴일 건너뜀 |
| 순수 도우미(이미 밖) | `src/reportAssignee.ts` — `groupReportTickets`·`reportHeadOf`·`hasReportMember`·`extractIssue`·`extractCategory`·`escapeRegExp` | `tests/reportAssignee.test.ts` 가 사고 사례로 지킴. `src/assignees.ts parseAssignees` 하나에 의존 |
| 업체명 다듬기 | `src/ids.ts:58 historyCoreName`(순수, ids.ts 안) · `fieldTicketVendor`·`logisticsTicketInfo` 는 **이미** `_shared/ticket-title.ts` | |
| 영업일 | `src/planDate.ts` `KR_HOLIDAYS`·`isBusinessDay`·`nextBusinessDay` | `./visits kstDate` 를 import — 그대로는 엣지에서 못 씀 |
| AI | `supabase/functions/report-polish/index.ts` — INSTRUCTION(프롬프트) + `OPENAI_REPORT_MODEL`(기본 gpt-5.5, effort low) + `recordOpenAiUsage("report-polish")` | 최대 40줄, 개수 다르면 502 |
| 화면 | 단추 `:1974`, 보고 창 `:2391~2419`(팀 칩·textarea·[다시 생성]·[복사]) | |

### 2-2. 보고에 쓰는 데이터 (`as_tickets` 만 — 네이버 원본 표는 안 씀)
- 열: `team, date, status, scheduleType, source, vendor, calendarTitle, note, issue, model, assignee`
- 대상: `team = 보고팀` · vendor 에 휴가/연차 없음 · scheduleType 이 휴가·매월점검 아님 · source 가 autoplan 아님
- **금일 처리예정**: date = 오늘 · status 가 완료 아님 → 사람별 묶음(`groupReportTickets`, 2명 배정이면 두 묶음에 한 줄씩), 이름 없는 물류는 뺌, 명단 밖 사람만 걸린 건 뺌(물류 인원 몫), 끝에 `#미배정`
- **익일일정**: date = 다음 영업일 · 미완료 · 물류면 명단 사람이 걸린 것만
- **연기 꼬리**: date > 내일 · 미완료 · note 에 `(M/D로 연기)` → `… → 11/4`
- 실측(anon 읽기, 10/26~10/30): C팀 하루 as_tickets 13~22행(AS 수기·네이버·물류·매월점검 섞임) → 보고 줄 대략 8~20개, report-polish 40줄 한도 안.

### 2-3. 지금 글 모양 (오늘 보고 — 자동 발송도 이것과 같아야 함)
```
12:00 중간보고
(진행중인 업무는 * 표시)

-------------------
금일 처리예정

#신정훈
•업체 기종 내용

#이름
•…

-------------------
익일일정

•…
•… → 11/4

-------------------
특이사항
```

### 2-4. 카톡·크론·기록 — 재사용할 길
- 발송: `outbox {room, text}` 1행 → 메신저봇 7초 폴링, 120초 남으면 노트북 `outbox_relay.py` 가 PC 카톡으로. 배달되면 outbox 행이 지워지고 트리거가 `kakao_delivery_log(outbox_id, sender bot|pc, sent_at)` 에 남김 → **outbox id 만 기억하면 "배달됨 12:00:41 · 봇" 을 화면에 보일 수 있다.**
- 방 찾기: `room_map(category, region, room)`. 지금 30행, **스케줄 종류 없음**. 앱 목록 `src/SystemAdmin.tsx:42 ROOM_CATEGORIES` 에도 없음.
- TEST_MODE: 엣지 선례 `weekly-keyman-poster/index.ts:694~701`(TEST_MODE 없으면 true 취급, 테스트방이면 머리에 `[테스트 · 원래는 ○○]`). **실측 지금 TEST_MODE = false** → 전역 테스트 모드를 켜면 모든 방이 테스트방으로 가므로, 이 기능 하나만 테스트방으로 보낼 **전용 스위치가 필요**하다.
- 실패 감시(기존): `kakao-bot-watchdog` 매시 20분 — outbox 에 30분 넘게 남은 글이 있으면 관리자 웹푸시. cron→엣지 호출은 `ops.edge_calls`·`ops.edge_call_health`(ops-monitor 가 봄).
- 크론 선례: `supabase/reception-sheet-rows-20261028.sql:100` — `cron.schedule(이름, 식, $$select ops.call_edge(함수, body, 타임아웃, 태그);$$)`. vault `field_cron_jwt` 는 **anon JWT** — 즉 이 엣지는 anon 키만 있으면 누구나 부를 수 있다(reception-sheet-open 과 같은 처지 → 칸막이 필요, 5-3).
- 기록 표: `report_send_log` 는 **있지만 점검리포트(고객 문자) 전용**(vendor not null·phone·image_url, 통합검색 catalog 가 "점검리포트 보낸 기록"으로 읽음) → 섞으면 통합검색 답이 오염된다. **새 표**로 간다(4절).
- 방 실측: `room_activity` 43방 중 `강남C 스케줄` **없음**, `kakao_collect_rooms` 24방에도 없음 → 봇 폰이 그 방 알림을 한 번도 못 받았을 수 있다(위험 R1).

---

## 3. 재사용·확장 지점 (순수부를 `_shared` 로 — okr-rules 와 같은 재수출 방식)

원칙: 본문을 **글자 그대로 옮기고** src 쪽 파일은 `_shared` 를 다시 내보낸다(src/okr.ts:15~19, src/ids.ts:176 과 같은 꼴). `_shared` 파일은 src 를 import 하지 않는다(Deno, 상대 경로 + `.ts`). 화면 동작 변화 0.

| 새 `_shared` 파일 | 옮겨 오는 것 | src 쪽 |
|---|---|---|
| `_shared/report/assignees.ts` | `parseAssignees`(+ 같은 파일의 순수 함수 전부) | `src/assignees.ts` = 재수출 |
| `_shared/report/assignee-rules.ts` | `src/reportAssignee.ts` 본문 전부 | `src/reportAssignee.ts` = 재수출(기존 테스트 그대로 통과) |
| `_shared/vendor-core.ts` | `historyCoreName` + `HISTORY_STOPWORD`·`CORP_PREFIX`·`beforeCorpMark` | `src/ids.ts` 에서 그 정의 삭제 + 재수출 1줄 |
| `_shared/kr-holidays.ts` | `KR_HOLIDAYS`·`isBusinessDay`·`nextBusinessDay`(KST 날짜는 자체 `kstYmd(d)` — visits 의존 제거) + `kstNow()` → {ymd, hh, mm} | `src/planDate.ts` = 재수출(`defaultPlanDate` 는 남음) |
| `_shared/report/team-order.ts` | `bookFromMembers(rows)`(authors.ts `bookOf` 본문) · `teamAssigneesOf(book)`(CsAsWorkspace:559 본문) · `reportOrderOf(team, teamAssignees, leaders)`(:574 본문) | authors.ts `bookOf` → 이걸 부름. CsAsWorkspace useMemo·reportOrder → 이걸 부름 |
| `_shared/report/mid-report.ts` (**핵심**) | `buildMidReportPlan({ tickets, order, todayYmd, tomorrowYmd, day, stamp, detailOf? })` → `{ pending, tomorrows, deferredLater, draft, payload, assemble(lines), diag, eligibleTodayCount, draftHash }` — buildMidReport·composeMidReport 의 **중복 필터를 하나로**. `lineOf`·`shortModel`·`cut`·`REPORT_SEP`·`isLogistics`·보고에 필요한 `normalizeTicketSchedule` 부분 포함 | CsAsWorkspace 의 두 함수는 이 계획을 받아 쓰는 몇 줄로 줄어듦. `reportDetailOf`(익일스케줄 연락처 줄)는 컴포넌트의 `phonesOf` 에 묶여 있으니 `detailOf` 콜백으로 넘김(서버는 안 넘김 — 오늘 보고엔 안 쓰임) |
| `_shared/report/polish.ts` | report-polish 의 `INSTRUCTION`·입력 자르기·응답 검증 → `polishReportLines(lines, { apiKey, model, fnTag })` | `report-polish/index.ts` 는 이걸 부르는 얇은 껍데기(프롬프트 한 벌 = 화면 AI·자동 AI 같은 글) |

- `stamp` 는 인자로: 화면은 지금처럼 `reportStamp()`(누른 시각), 서버는 차수 고정 `12:00`/`14:00`(크론이 12:00:03 에 돌아도 머리는 12:00), `now` 는 KST 현재 시각.
- 날짜도 인자로: 서버는 `kstNow().ymd`·`nextBusinessDay(ymd)` — 브라우저 현지 시각 의존을 엣지에 들이지 않는다.
- `draftHash` = 금일·익일 섹션의 **규칙 초안** 글자(시각 머리 제외)의 해시. AI 문장은 매번 조금씩 달라 비교에 못 쓴다 → 14시 "변동 없음" 판정은 초안끼리.

---

## 4. 데이터 설계

### 4-1. 새 표 `schedule_report_log` (1회 시도 = 1행)
| 열 | 형 | 뜻 |
|---|---|---|
| id | bigserial pk | |
| kst_date | date not null | 보고 날짜(KST) |
| team | text not null | `C` (A~E 확장) |
| slot | text not null | `12` · `14` · `now`(지금 보내기) · `copy`(사람이 [복사]) |
| status | text not null | `claim`(진행 중) · `queued`(outbox 넣음) · `dry` · `skipped` · `failed` · `copied` |
| reason | text default '' | 건너뛴 이유 `off`·`holiday`·`before10`·`empty`·`unchanged`·`no_room`·`kakao_off`·`already`·`manual_copied` 또는 오류 요약 |
| room | text default '' | 실제로 넣은 방(테스트방이면 테스트방) |
| real_room | text default '' | 원래 갈 방 |
| test | boolean default false | 테스트방 발송이었나 |
| outbox_id | uuid null | `kakao_delivery_log.outbox_id` 로 배달 확인 |
| text | text default '' | 보낸 본문(화면 "마지막 발송 보기"·감사용) |
| draft_hash | text default '' | 3절 |
| lines | int default 0 | 보고 줄 수 |
| polished | boolean default false | AI 성공 여부(false = 규칙 초안으로 보냄) |
| ai_model | text default '' | |
| actor | text default '' | `cron` · 지금 보내기/복사 누른 사람 이름 |
| created_at / updated_at | timestamptz default now() | |

- **중복 방지 열쇠**: `unique (kst_date, team, slot) where slot in ('12','14') and status <> 'dry'` 부분 인덱스 — 엣지가 맨 처음 `claim` 행을 넣고, 충돌하면 즉시 `skipped/already`. 크론 재시도·수동 호출이 겹쳐도 같은 차수는 한 번만 나간다.
- RLS on. **anon**: select 전부(본문은 이미 anon 이 읽는 as_tickets 수준) · insert 는 `with check (slot = 'copy' and status = 'copied')` 만, 열 단위 grant(kst_date, team, slot, status, actor). update·delete 없음. 나머지 쓰기는 엣지(service role).
- 인덱스: `(team, kst_date desc, created_at desc)`. 보관 정리 불필요(하루 2~4행 × 팀 수).

### 4-2. app_config 키 (관리 탭 스위치 — 기존 on/off 모양 그대로, `SystemAdmin.tsx SWITCHES`)
| 키 | 기본(없을 때) | 뜻 |
|---|---|---|
| `SCHEDULE_REPORT_AUTO` | **꺼짐** | 켜야 크론 발송. 꺼져 있어도 [지금 보내기]·dryRun 은 동작 |
| `SCHEDULE_REPORT_TEST` | **켜짐** | 켜져 있으면 이 기능 글만 `TEST_ROOM` 으로(머리 `[테스트 · 원래는 강남C 스케줄]`). 전역 `TEST_MODE=true` 여도 테스트방 |
| `SCHEDULE_REPORT_TEAMS` | `C` | 자동 대상 팀 목록(쉼표, 스위치 아님 — 설정 값). 다른 팀 확장 = 이 값 + room_map 1줄 |
- 전역 `FIELD_KAKAO_SEND_ENABLED = false` 면 자동 발송도 쉰다(`kakao_off`) — 관리 탭 "카톡 전송" 끄기가 전체 비상 정지로 통하게.

### 4-3. room_map 1줄 (사용자가 관리 탭에서 — /room-add)
`스케줄 | C | 강남C 스케줄` · 앱 `ROOM_CATEGORIES` 에 `스케줄` 추가(관리 탭 선택지). 다른 팀은 방 이름이 정해지면 `스케줄|A` 등 같은 방식.

---

## 5. 엣지 계약 — 새 함수 `schedule-report`

### 5-1. 요청·응답
```
POST /functions/v1/schedule-report
{ "slot": "12" | "14" | "now",      // now = 화면 [지금 보내기]
  "team"?: "C",                      // 없으면 SCHEDULE_REPORT_TEAMS 전부(크론은 생략)
  "dryRun"?: true,                   // 만들기만 — outbox·claim 없음(log 는 status=dry)
  "actor"?: "이름" }                 // now·dryRun 때 누른 사람
-> { ok: true, kstDate, results: [ { team, slot, status, reason?, room?, realRoom?, test, text?, lines, polished, outboxId?, logId } ] }
```

### 5-2. 순서 (팀마다, 한 팀 실패가 다음 팀을 막지 않음)
1. **인증**: 이 프로젝트 JWT(anon/service)만 — reception-sheet-open(98fab54)과 같은 내용 검사(ref·role·exp).
2. **설정 읽기**: app_config `SCHEDULE_REPORT_AUTO·_TEST·_TEAMS·TEST_MODE·TEST_ROOM·FIELD_KAKAO_SEND_ENABLED`. slot 12/14 인데 AUTO 꺼짐 → `skipped/off`(log 남김 — "왜 안 왔지?"의 답이 표에 있게).
3. **시간 규칙(KST)**: 영업일 아님 → `holiday`. 10시 전 → `before10`(자동 글 규칙). `now` 는 10:00~19:00 만.
4. **차수 잡기**: slot 12/14 → `claim` 행 insert, 충돌이면 `already` 로 끝. `now` → 같은 팀 `now` 가 10분 안에 있으면 거절(연타·외부 호출 막기).
5. **사람이 이미 보냈나**: 같은 날·팀의 `copy` 행이 차수 시각 60분 전 ~ 지금 사이에 있으면 `manual_copied` 로 건너뜀(R4).
6. **재료 읽기**(service role): `cs_members?active=eq.true` → `bookFromMembers` → `reportOrderOf(team)`; `as_tickets?team=eq.C&date=gte.오늘&date=lte.오늘+120일`.
7. **본문 계획**: `buildMidReportPlan({ day: "today", stamp, todayYmd, tomorrowYmd: nextBusinessDay(오늘) })`.
   - 오늘 보고 대상 일정(완료 포함) 0건 → `empty`(안 보냄). 전부 완료면 보냄(금일 "없음" + 익일일정).
   - slot 14 이고 같은 날 12 행의 `draft_hash` 와 같으면 → **Q1 답대로**(기본안: 한 줄 `14:00 중간보고 — 12시 이후 변동 없음`).
8. **AI 다듬기**: `polishReportLines(payload, { fnTag: "schedule-report" })` — 40초 제한, 실패·개수 불일치·빈 줄이면 규칙 초안(`polished=false`). 화면과 같은 프롬프트·같은 모델.
9. **방 정하기**: `room_map 스케줄|C`. 없으면 `no_room`(테스트 모드여도 실제 매핑이 없으면 안 보냄 — 매핑 누락을 테스트방이 덮지 않게). TEST 켜짐이면 room = TEST_ROOM, 머리에 `[테스트 · 원래는 강남C 스케줄]` 한 줄.
10. **넣기**: `outbox` insert(`Prefer: return=representation`) → id. dryRun 이면 생략.
11. **기록**: log 행 update(status queued|dry|skipped|failed, room, real_room, test, outbox_id, text, draft_hash, lines, polished, ai_model).
- 함수 예외 → log `failed` + 응답 500 → `ops.edge_call_health` 에 http_error(ops-monitor 가 봄). 배달 지연(outbox 30분+)은 기존 `kakao-bot-watchdog` 웹푸시가 그대로 잡는다 — **새 알림 경로는 만들지 않음**.

### 5-3. 보안 메모
- anon 키로 누구나 부를 수 있지만: 12/14 는 하루 한 번(unique), `now` 는 10분 1회 + 10~19시, 보내는 곳은 room_map 의 정해진 방뿐(요청에 방·본문 칸 없음). 최악 = 같은 보고가 몇 번 더 감.
- 응답 `text` 에는 업체명·내용만(오늘 보고엔 연락처 줄이 없다).

### 5-4. 비용
- report-polish 1회 = 줄 10~20개 → 추정 $0.02~0.05(배포 뒤 `_shared/ai-usage` 기록으로 실측).
- 하루 2회 × 영업일 22일 × 1팀 ≈ **월 $1~2.2**. 5팀이면 ≈ 월 $5~11. 14시 "변동 없음"은 AI 를 안 부름.
- 비용 태그를 `schedule-report` 로 따로 둬 화면 수동 생성(`report-polish`)과 나눠 셈.

---

## 6. 크론 (표다빈이 SQL 파일화 — `supabase/schedule-report-20261031.sql`)

```sql
-- 평일만 부르고, 공휴일은 엣지가 건너뜀(KR_HOLIDAYS). pg_cron 은 UTC: 03:00 = KST 12:00, 05:00 = KST 14:00
select cron.schedule('schedule-report-12', '0 3 * * 1-5',
  $$select ops.call_edge('schedule-report', '{"slot":"12"}'::jsonb, 90000, 'schedule-report-12');$$);
select cron.schedule('schedule-report-14', '0 5 * * 1-5',
  $$select ops.call_edge('schedule-report', '{"slot":"14"}'::jsonb, 90000, 'schedule-report-14');$$);
```
- 같은 파일에: 4-1 표·인덱스·RLS·grant, 4-2 app_config 3키 `on conflict (key) do nothing`(AUTO=false·TEST=true·TEAMS=C), 앞머리 가드(`ops.call_edge` 없으면 중단). room_map 은 넣지 않음(사용자가 관리 탭).
- 재실행 안전(같은 이름 cron.schedule 덮어씀, `if not exists`). 되돌리기: `cron.unschedule('schedule-report-12')`·`('schedule-report-14')`.
- 타임아웃 90초: AI 수 초~30초 + 표 읽기. pg_net 이 먼저 포기해도 함수는 끝까지 돈다(성공 여부는 log 로 판정).
- **순서**: 엣지 배포 → SQL 실행 → 관리 탭 room_map → 스위치(AUTO 켬, TEST 켜 둔 채) → 하루 테스트방 검증 → TEST 끔.

---

## 7. 화면 흐름 (일정리스트 → [📋 중간보고] 창)

1. 일정리스트 머리 [📋 중간보고] 옆에 작은 글씨: C팀 자동이 켜져 있으면 `자동 12·14시`(폰은 `자동`).
2. [📋 중간보고] 창 팀 칩 줄 아래에 **자동 발송 띠**(그 팀이 SCHEDULE_REPORT_TEAMS 에 있을 때만):
   - `자동 발송 12:00·14:00 → 강남C 스케줄` (테스트 중이면 `→ 테스트 전용방(시험 중)` 주황)
   - 오늘 결과 두 칸: `12:00 ✓ 배달 12:00:41 봇` / `14:00 대기` / `건너뜀: 일정 없음` / `실패: …` (log + `kakao_delivery_log` 를 outbox_id 로 잇기, outbox 에 아직 있으면 `보내는 중`)
   - [마지막 발송 보기] → 실제 보낸 본문을 textarea 에 띄움(읽기)
3. [지금 보내기](띠 안, 보이는 사람 = 팀장 + 그 팀 명단): 누르면 dryRun 미리 보기 → 확인 창 "강남C 스케줄 에 지금 보냅니다" → `now` 호출 → 띠 갱신.
4. 기존 [복사] 는 그대로 + 복사 성공 때 `copy` 행 1건 기록(조용히, 실패 무시). 자동이 켜진 팀이면 복사 단추 위에 한 줄 `12:00·14:00 은 자동으로 갑니다 — 붙여 넣으면 두 번 올라갑니다`.
5. 관리 탭: 스위치 2개(자동 중간보고 / 자동 중간보고 테스트방) + 방 매핑 종류 `스케줄`.

(디자인은 목업 이미지로 먼저 보여 준다 — 사용자 규칙.)

---

## 8. 작업 분해 (겹치지 않게)

| 누가 | 할 일 | 건드릴 파일 | 건드리지 말 것 |
|---|---|---|---|
| **구현 B — 순수부·테스트** (먼저, opus 권장: 글자 그대로 옮기기) | ① 바꾸기 **전에** 지금 화면 함수로 골든 픽스처 고정(C팀 10/27~10/30 as_tickets 모양 6세트: 2명 배정·미배정·물류·연기 꼬리·휴가·autoplan·금요일→월요일·공휴일 전날) ② 3절 `_shared` 파일 + src 재수출 ③ `buildMidReportPlan` 이 옛 buildMidReport 와 **글자 하나 다르지 않음**(골든) ④ `kstNow`·`nextBusinessDay` 를 UTC 시간대에서 돌리는 테스트 ⑤ draftHash 테스트 | 새 `supabase/functions/_shared/report/{assignees,assignee-rules,team-order,mid-report,polish}.ts`·`_shared/vendor-core.ts`·`_shared/kr-holidays.ts` · `src/assignees.ts`·`src/reportAssignee.ts`·`src/ids.ts`(historyCoreName 부분만)·`src/planDate.ts`·`src/authors.ts`(bookOf 만) · `src/CsAsWorkspace.tsx` 의 **buildMidReport·composeMidReport·teamAssignees·reportOrder 본문만** · 새 `tests/midReportShared.test.ts` | 보고 창 JSX, 다른 일정 기능 |
| **구현 A — 엣지** (B 뒤) | 새 `schedule-report/index.ts`(5절), `report-polish/index.ts` 를 `_shared/report/polish.ts` 껍데기로(요청·응답 모양 그대로) | `supabase/functions/schedule-report/index.ts`(새) · `supabase/functions/report-polish/index.ts` | `_shared` 순수부 내용(B 소유) |
| **데이터실 표다빈 — SQL** (병렬) | 6절 파일 1장: 표·인덱스·RLS·grant·app_config 3키·크론 2개·가드·확인 쿼리 → 권한나 sql-review → /sql-handoff | `supabase/schedule-report-20261031.sql`(새) | room_map 쓰기, 기존 표 |
| **디자인실 윤화면** (병렬) | 7절 띠·[지금 보내기]·결과 칸 목업 이미지(PC·폰), 기존 보고 창 톤 | 목업 → 새 `src/ScheduleReportAutoBar.view.tsx`(표시만) | 보고 창 나머지 |
| **구현 C — 화면** (A·디자인 뒤) | 새 `src/scheduleReportAuto.ts`(log·delivery 읽기, `copy` 기록, now/dry 호출) + `src/ScheduleReportAutoBar.tsx`(상태) · CsAsWorkspace 보고 창에 띠 1줄 + [복사] 성공 뒤 1줄 + 머리 글씨 1줄 · SystemAdmin `SWITCHES` 2줄·`ROOM_CATEGORIES` 에 `스케줄` | `src/scheduleReportAuto.ts`·`src/ScheduleReportAutoBar.tsx`(새) · `src/CsAsWorkspace.tsx`(JSX 3곳만) · `src/SystemAdmin.tsx`(배열 2곳) | App.tsx(0줄) |
| **품질실 검수아** | 빌드·테스트, 골든 일치, `dryRun` 실호출로 C팀 오늘 초안 = 화면 [중간보고] 초안 대조, 테스트방 1회 실발송 → delivery_log 확인, 주말·10시 전·empty·already·no_room·unchanged 경로 | — | |
| **사용자 — /room-add** | 관리 탭 카톡방 매핑 `스케줄 · C · 강남C 스케줄`, 봇 폰·노트북 카톡이 그 방에 있는지 확인(R1), 스위치 켜기 | 관리 탭 | |
| **문서**(팀장) | `docs/manual/user/07-schedule-calendar.md` 새 절, `ops/05-edge-functions.md`(새 엣지·크론)·`ops/07-kakao-bot.md`(새 방), AGENTS 작업 기록, eval worklog | | |

순서: B → (A ∥ 표다빈 ∥ 윤화면) → C → 검수아 → 배포(엣지 2개: schedule-report 새, report-polish 재배포) → SQL → 방 매핑 → 테스트방 1일 → 실제 방.

---

## 9. 다른 팀 확장 구조
- 코드 변경 0: `SCHEDULE_REPORT_TEAMS` 에 팀 추가 + `room_map 스케줄|A` 등 방 이름. 크론은 그대로 2개(엣지가 팀을 돌고, 팀별 claim 이라 한 팀 실패가 다른 팀을 막지 않음).
- A·B 가 한 방을 같이 쓰면 room_map region A·B 를 같은 방으로(불만 방 `신)AB불만고객` 선례) — 단 보고 글은 팀마다 1개씩 나감.
- 팀마다 시각이 다르면 2단계에서 팀별 시각 키 — 지금은 안 만든다.
- 익일스케줄(퇴근 전)도 같은 계획 함수 `day: "next"` 로 자동화 가능 — 연락처·주소 줄이 카톡에 자동으로 나가는 문제가 있어 이번 범위 밖.

---

## 10. 위험

| # | 위험 | 대책 |
|---|---|---|
| R1 | **`강남C 스케줄` 이 room_activity·수집 방 어디에도 없음** — 봇 폰이 그 방에 없거나 알림이 꺼져 있으면 봇은 못 보내고 노트북 중계만 남음 | 매핑 전 사용자 확인(Q3). 매핑 직후 다음 정시(평일 10~19시)에 봇 심박 `[봇점검]` 한 줄이 그 방에 감(room_activity 없음 = 무활동 취급) — 미리 알림. 테스트방 하루 → 실제 방 첫날 12:00 delivery_log 확인 |
| R2 | 화면 보고와 자동 보고 글이 달라짐(옮기다 한 글자 어긋남 — reportAssignee 정규식 사고 선례) | 골든 픽스처를 **옮기기 전에** 고정, 글자 단위 비교. 화면·엣지가 같은 파일을 import |
| R3 | 서버 시간대(UTC)로 오늘·익일·머리 시각이 9시간 밀림 | 날짜·시각은 전부 `kstNow` 인자로. UTC 환경 테스트 |
| R4 | 사람이 이미 붙인 뒤 자동이 또 감 / 복사만 하고 안 붙였는데 자동이 건너뜀 | 기본: `copy` 기록이 60분 안이면 건너뜀 + 보고 창 경고 문구. 정착 뒤엔 사람은 안 붙이는 게 원칙(팀 공지) |
| R5 | anon 으로 외부 호출 | 5-3 (하루 1회 unique·now 10분·방 고정) |
| R6 | AI 실패·느림 | 규칙 초안 폴백(지금 화면과 같은 규칙), 90초 타임아웃, log `polished=false` |
| R7 | 2027 공휴일은 예비값 | 연말 확정(planDate 주석 그대로) — 이제 한 곳만 고치면 화면·서버 둘 다 |
| R8 | 자동 글엔 `(진행중인 업무는 * 표시)`·`특이사항` 칸을 사람이 못 채움 | Q2 |
| R9 | 12시 직전 완료를 안 눌러 끝난 건이 처리예정에 남음 | 지금 수동도 같음. 띠에 "11:55 까지 완료 눌러 주세요" 안내(선택) |
| R10 | report-polish 재배포 중 화면 [중간보고] AI 가 잠깐 실패 | 화면은 이미 초안 폴백. 응답 모양 그대로 유지(구현 A) |

---

## 11. 질문 (3개 — 기본안 있음, "알아서" 면 기본안)

- **Q1. 14시 보고 때 12시 이후 바뀐 게 없으면?** (a) 그래도 전체 보고를 다시 보냄 · **(b) 기본안: `14:00 중간보고 — 12시 이후 변동 없음` 한 줄** · (c) 아무것도 안 보냄. "바뀜" = 완료 처리·새 일정·배정·연기로 규칙 초안 글자가 달라진 것.
- **Q2. 자동 글의 `(진행중인 업무는 * 표시)` 줄과 `특이사항` 칸은?** 사람이 손으로 채우던 칸이라 자동 글에선 늘 빔. **기본안: `(진행중…)` 줄은 빼고 `특이사항` 은 `없음`.** (지금 모양 그대로 둘지)
- **Q3. 봇 폰(업무폰)과 노트북 카톡이 `강남C 스케줄` 방에 들어가 있나요?** 기록상 봇이 그 방을 본 적이 없습니다. 기본안: 들어가 있으면 첫날은 테스트방으로 12·14시 확인 → 다음 영업일부터 실제 방. [지금 보내기]는 팀장 + C팀 명단 사람만.

---

## 12. 하지 않을 것 (범위 밖)
- 익일스케줄(퇴근 전) 자동 발송 — 전화번호·주소 줄이 자동으로 카톡에 나가는 문제, 따로 결정.
- A·B·D·E 팀 켜기(구조만 준비, 방 이름 미정).
- 카톡방 글을 읽어 사람이 이미 올렸는지 판정(수집 방 추가·원문 파싱) — `copy` 기록으로만.
- 보고 문구·AI 프롬프트 변경(같은 글이 목표). `*` 진행중 자동 표시(현장 진행 상태 데이터 없음).
- `report_send_log` 재사용(점검리포트 전용, 통합검색 오염).
- 전역 TEST_MODE 로 시험(다른 방 전부가 테스트방으로 감 — 지금 false).
- App.tsx 변경, 새 알림 경로(기존 watchdog·ops 감시 재사용).
