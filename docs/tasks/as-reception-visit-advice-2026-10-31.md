# AS 접수 뒤 "방문 판단 안내글" 자동 게시 — 설계안

2026-10-31 · 기획실 한설계(feature-planner) · 조사만, 코드 0
팀장(이민구) 원문 요지: AS 접수가 되면(법인폰 봇이 올리는 접수 글 포함) 접수 글과 **별도로** "방문 판단 안내글"을 하나 더 그 팀 AS방에 보내 중복 방문을 막는다.
실사례: 청오에스떠블유(써브웨이)에 11-02 물류 일정이 있었는데, 그걸 모르고 10-30 급하지 않은 AS를 처리하러 다녀왔다.

---

## 1. 목표와 쓰는 사람

**한 줄 목표**: 복합기 AS 접수 글이 팀 AS방에 올라간 직후, 같은 방에 "이 업체는 점검이 필요한지 + 앞으로 잡힌 일정"을 한 글로 올린다. 이걸 보고 방문을 묶거나 미룬다.

| 누가 | 어디서 | 무엇을 |
|---|---|---|
| 접수자(CS 사무·파트장) | PC 서비스접수 | 지금처럼 [접수+전송]만 누른다. 추가로 할 일 없음(설정을 켠 뒤 자동) |
| 팀 기사·파트장 | 폰 카톡 팀 AS방 | 안내글을 읽고 "같이 묶을지·점검을 같이 할지" 정한다(판단은 사람) |
| 관리자(사용자) | PC 관리 탭 | 스위치 1개 + 기준값 2개. 첫날은 테스트방에서 확인 |

"법인폰 봇 자동 접수"는 따로 있는 경로가 아니다(조사 결과 2-1). 앱 접수 글을 outbox에 넣으면 법인폰 메신저봇(대화명 `Ai법인폰`)이 방에 올리는 구조라서, **앱의 전송 지점 = 봇이 올리는 접수 글 전부**다.

---

## 2. 조사 결과

### 2-1. AS 접수가 만들어지고 방으로 나가는 경로
| 단계 | 위치 | 비고 |
|---|---|---|
| 접수 저장 | `src/api.ts:424 saveServiceReception` → `service_receptions` insert | **앱만** 쓴다. GAS·봇·엣지는 이 표에 insert하지 않는다(reception-sheet-open은 상태 PATCH, naver-calendar-sync는 상태 동기화뿐) |
| AS방 전송 | `src/api.ts:460 sendServiceReception("AS", region, text)` → `room_map["AS|<팀>"]` → `src/supabase.ts:357 enqueueOutbox` | TEST_MODE면 `TEST_ROOM`. 방 매핑이 없으면 실패를 돌려준다(조용히 새지 않음) |
| 호출 지점 ① | `src/ServiceReception.tsx:1123 handleSaveAndSend` | [저장+AS방 전송]. 성공하면 `status=전송완료, sent_room=<방>` |
| 호출 지점 ② | `src/ServiceReception.tsx:1209 stepKakao` | 단계 버튼 [카톡 전송]·[⚡ 전체] |
| 호출 지점 ③ | `src/ServiceReception.tsx:1317 transferToCs` | IT→CS 방문이관. AS방으로 가는 방문 건이라 같은 안내글 대상 |
| 다른 AS방 글(대상 아님) | `CsAsWorkspace.tsx:1192`, `App.tsx:4787`, `ticketCompletion.ts:131` | 완료·사유 보고 글이라 접수가 아니다. 안내글을 붙이지 않는다 |
| 배달 | 메신저봇 7초 폴링 → 못 가져가면 노트북 `outbox_relay.py` | 배달되면 outbox 행이 지워지고 `kakao_delivery_log`에 남는다 |
| 카톡 수집 | `kakao-ingest`·GAS `Kakao.gs` | `KAKAO_BOT_NICKS`(Ai법인폰) 글은 양식 파서에서 뺀다. 안내글이 점검·AS 기록으로 잘못 적재되지 않는다 |

결론: 안내글을 끼울 곳은 **위 3개 호출 지점의 "전송 성공" 바로 뒤** 한 줄(같은 함수 `queueVisitAdvice(receptionId, room)`)이다. DB 트리거는 쓰지 않는다. 판정에 필요한 업체 매칭이 TS(통합검색 360)에 있어서 SQL로 다시 짜면 두 벌이 되기 때문이다. 엣지 신설도 1단계에서는 하지 않는다(3-5절).

### 2-2. 이미 있는 재료(새로 짜지 않는다)
| 필요한 값 | 이미 있는 곳 | 쓰는 법 |
|---|---|---|
| 업체 → 거래처 코드(10자리) | RPC `resolve_ticket_vendor_code(p_reception, p_serial, p_asset, p_vendor)` (`supabase/ticket-vendor-code.sql`, anon 실행 가능) | 순서: 접수 순번(lease_no) → 시리얼 6자+ → 자산기번 정규형 → 업체명 키가 하나로만 이어질 때. 추측하지 않는다 |
| 코드 → 이름 변형·기번·자산번호 묶음 | `src/entity360.ts:263 buildEntity` | 통합검색 360과 같은 매칭 |
| 표별 기록 모으기 | `src/entity360.ts:386 gather(e, { only })` | only = `vendor_info, jeomgeom, as_records, as_tickets, workin_map_places, supply_requests, visit_logs` |
| 마지막 점검·AS, 기기 목록(기기별 마지막 점검·AS) | `src/entity360.ts:587 deriveState` → `lastInspect`, `devices[]`, `workin`, `supplies` | `lastAs`는 **이번 접수 자체**(접수·일정)를 포함하므로 그대로 쓰지 않는다(4-2) |
| 워킨맵 등록 | `gatherWorkin` = `workin_vendor_code.code` → `workin_map_places` | quarter·kind(quarter/monthly/renewal)·label(G5=점검 완료, G12=이관) |
| 여분 넉넉한지 | `src/spareAdvice.ts:59 usageSpareAdvice(latest, previous, model)` | 기준은 이미 정해져 있다: A3 = 여분 2세트·폐통 2, A4 = 2세트(월 3,000매 이상이면 3세트). `needsList`가 비면 "여분 충분" |
| 최근 점검 2회(기기 우선) | `src/api.ts:548 getRecentInspections(vendor, serial, asset)` | 접수 폼이 이미 부른다(자가사용내역) |
| 물류 일정 종류 | `_shared/ticket-title.ts:77 logisticsTicketInfo(calendarTitle).category` | 납품·철수·교체만 구분한다. 세팅·회수·이전은 4-4의 표시 규칙으로 |
| 영업일 | `src/planDate.ts nextBusinessDay` | 야간 접수의 보류 시각 |

### 2-3. 앞으로 잡힌 일정은 사실상 `as_tickets` 한 표
- 네이버 수입 일정(`source=naver`), 물류(`납품철수교체휴가교육`·`물류`), AS·익일AS, 매월점검, 재계약 다음 확인 일정(`source=recontract`)이 **모두 as_tickets**에 있다. `vendor_code`는 insert 트리거가 채운다(못 정하면 비움).
- `logistics_records`는 **끝난** 물류 기록이라 "추가일정"에는 쓰지 않는다.
- `team_calendar_events`(팀 메모 달력)는 업체 칸이 없는 자유 글이라 1단계에서는 뺀다(8절).

### 2-4. 실사례 표본(청오에스떠블유): 코드로 확인한 것과 못 한 것
- 실제 표기는 **"청오에스떠블유 주식회사"**(더블유 아님)이고, 지점이 **써브웨이 본사·써브웨이 답십리역점**으로 나뉜다(`supabase/fix-ticket-vendor-20261024.sql:207~208`).
- 납품 일정 2건이 네이버에서 수입돼 있다: `nv-20260929T061120Z-200@naver107`(답십리역점, "⭐1번 일정⭐ … 납품(일반)"), `nv-20260929T061333Z-147@naver110`(본사, "⭐2번 일정⭐ …"). 10-24 정리 전에는 업체명 칸이 "⭐1번 일정⭐, 허영재,CSS 1명 동행…"이라 **업체로 찾을 수 없었다**. 10-30 접수 때 아무도 일정을 못 본 원인 중 하나로 보인다(추정).
- 같은 업체에 `nv-20261002T065436Z-225@naver111` "점검요청 V D470 … 분기마감"도 있다. 예시 글의 "AS 점검방문요청"이 이 종류다.
- **확인 못 한 것**: 위 일정들의 date·status·vendor_code, 10-30 접수 행, 마지막 점검일과 AS일. 이 세션에서는 Supabase MCP 도구를 쓸 수 없었고, anon REST 직접 조회는 권한 판단기가 막았다. 구현 전에 팀장이 MCP로 아래 읽기 전용 질의를 돌려 표본을 확정한다(qa-checker 테스트 표본으로도 쓴다).

```sql
-- 표본 확인(읽기 전용)
select id, created_at, receipt_date, type, vendor, grade, region, model, asset_no, serial, lease_no, status, sent_room
  from service_receptions where vendor like '%청오에스%' order by created_at desc limit 10;
-- 아래 <> 칸은 위 결과로 채운다
select resolve_ticket_vendor_code('<접수id>', '<serial>', '<asset_no>', '<vendor>');
select id, date, team, status, "scheduleType", source, vendor, vendor_code, left("calendarTitle", 80) as t, "receptionId"
  from as_tickets
 where (vendor like '%청오에스%' or "calendarTitle" like '%청오에스%' or vendor_code = '<코드>')
   and date >= '2026-10-20' order by date;
select max(substring("작성일" from '\d{4}-\d{2}-\d{2}')) from jeomgeom where "_업체명" like '%청오에스%' and coalesce(_hidden, false) = false;
select max(substring("작성일" from '\d{4}-\d{2}-\d{2}')) from as_records where "_업체명" like '%청오에스%' and coalesce(_hidden, false) = false;
select w.id, w.team, w.quarter, w.kind, w.label, w.name
  from workin_vendor_code c join workin_map_places w on w.id = c.place_id where c.code = '<코드>';
select "_업체명", "모델명", "자산번호", "기번", "임대여부" from vendor_info where "_업체명" like '%청오에스%' and coalesce(_hidden, false) = false;
```

- 합격 기준: 10-30 접수 시각으로 계산하면 추가일정 첫 줄에 **2026-11-02(월) 납품**(지점 이름 포함)이 나와야 한다. 날짜나 종류가 다르면 표본을 고쳐 적고, 그래도 안 나오면 매칭(4-4)을 고친다.

---

## 3. 데이터 설계

### 3-1. 새 표 `visit_advice_log` (안내글 1건 = 1행, 같은 접수에 두 번 안 보내는 열쇠)
| 열 | 형 | 뜻 |
|---|---|---|
| reception_id | uuid **primary key** | service_receptions.id. 중복 insert는 `on conflict do nothing`으로 조용히 무시한다 |
| room | text not null | 접수 글이 실제로 나간 방(`sent_room`과 같다). TEST_MODE였으면 테스트방 |
| text | text not null | 완성된 안내글(최대 600자, 4-5) |
| verdict | text | 필요 · 불필요 · 판단필요 · 판단불가 |
| facts | jsonb | 판정에 쓴 값(코드·마지막 점검/AS·경과일·워킨맵·기기 수·여분 판정·일정 id 목록). 나중에 "왜 이렇게 나왔나"를 볼 때 쓴다. 전화·주소는 넣지 않는다 |
| due_at | timestamptz not null | 이 시각 이후에 보낸다(3-3) |
| status | text not null default 'queued' | queued · sent · skipped(접수 취소·삭제·오래 밀림) |
| outbox_id | outbox id 형과 같게, null 허용 | 넣은 outbox 행(배달 확인은 kakao_delivery_log로) |
| author | text | 접수자 |
| created_at / sent_at | timestamptz | |

- RLS: anon은 **select + insert만**(insert는 `status = 'queued' and sent_at is null`일 때만). update·delete 없음. 상태 바꾸기는 아래 flush 함수(security definer)만 한다.
- 파일 `supabase/visit-advice-20261031.sql`. 재실행해도 안전하게(`if not exists`, 정책은 drop 후 create). 사용자에게 건네기 전 sql-review.

### 3-2. 보내는 함수와 크론(엣지 없음)
- `public.flush_visit_advice()` security definer. 하는 일:
  1. `due_at <= now() and status = 'queued'`인 행을 고른다(`for update skip locked`, 한 번에 20행).
  2. 접수가 지워졌거나(`deleted`) 처리여부가 `접수취소`·`중복접수`면 `skipped`.
  3. app_config `VISIT_ADVICE_ENABLED`가 꺼져 있으면 행을 그대로 둔다. due_at에서 6시간 넘게 지난 queued는 `skipped`(스위치를 켤 때 옛 글이 몰려 나가지 않게).
  4. outbox insert → `status = 'sent', sent_at = now(), outbox_id`.
- 크론 `visit-advice-flush`: `* 1-10 * * *`(UTC) = **KST 10:00~19:59 매분**. 순수 SQL이라 vault·엣지 호출이 없다.
- 매분 돌기 때문에 안내글은 접수 글(봇 7초 폴링)보다 **항상 뒤에** 올라간다. 순서가 뒤집히지 않는다.

### 3-3. 보낼 시각(due_at): 접수할 때 브라우저가 정한다
| 접수 시각(KST) | due_at |
|---|---|
| 10:00~19:59 | 지금(1분 안에 나감) |
| 00:00~09:59 | 오늘 10:00(오늘이 영업일이 아니면 다음 영업일 10:00) |
| 20:00~23:59 | 다음 영업일 10:00 |

`VISIT_ADVICE_HOURS`(기본 `10-20`)로 바꿀 수 있다. 계산은 순수 함수 `adviceDueAt(now, hours)`로 두고 테스트한다. 보류됐다가 아침에 나가는 글은 첫 줄 끝에 `(10/30 21:40 접수분)`을 붙인다.

### 3-4. 설정(app_config, 관리 탭)
| 키 | 기본 | 뜻 |
|---|---|---|
| VISIT_ADVICE_ENABLED | false | 전체 스위치. 꺼져 있으면 브라우저가 행을 만들지 않는다 |
| VISIT_ADVICE_MIN_DAYS | 60 | 점검 경과 기준일(분기점검) |
| VISIT_ADVICE_MONTHLY_DAYS | 25 | 매월점검 지점의 기준일 |
| VISIT_ADVICE_HOURS | 10-20 | 보내는 시간대 |
| VISIT_ADVICE_PAST_DAYS | 30 | 날짜가 지났는데 완료 안 된 일정을 며칠 전까지 "추가일정"에 넣을지 |

여분 기준은 새 설정을 만들지 않고 `spareAdvice.ts` 기준을 그대로 쓴다(워킨맵·접수 폼과 같은 판정).

### 3-5. 왜 엣지가 아닌가(1단계)
매칭(entity360)이 브라우저 코드라서 엣지로 옮기려면 `_shared`로 떼어 내는 큰 작업이 된다(selectRows 의존). 접수자는 [전송] 뒤에도 화면에 남아 있고, 수집은 1~2초면 끝난다. 브라우저가 수집에 실패하면 "판단불가 — 자료 조회 실패" 글이라도 queue에 넣는다(조용히 빠지지 않게). 2단계에서 entity360 순수부를 `_shared`로 옮기면, 크론이 "전송완료인데 log 없는 접수"를 주워 담는 보충 경로를 붙일 수 있다(8절).

---

## 4. 데이터 식과 판단 규칙

### 4-1. 업체·지점 정하기
1. `code = resolve_ticket_vendor_code(접수id, serial, asset_no, vendor)`.
2. **지점 행** = 임대리스트에서 `_raw->>'순' = lease_no`인 행의 `_업체명`(지점 표기 포함, 예: "청오에스떠블유 주식회사(써브웨이 본사)")과 `_업체명`이 같은 `임대중` 행 전부. lease_no가 없으면 asset_no·serial이 일치하는 행의 `_업체명`.
3. `buildEntity({code, leaseCode, name: 지점명})` → `gather(e, {only})`.
4. **지점 기준 우선, 회사 기준 대체**: 점검·AS 기록은 지점 기기(기번·자산번호) 일치 또는 지점명 키(`vendorMatchKey`) 일치를 먼저 쓴다. 하나도 없을 때만 회사(코드) 전체 기록을 쓰고 값 뒤에 `(회사 기준)`을 붙인다.
5. 코드도 지점 행도 없으면 **판단불가** 글(4-5 ④).

### 4-2. 값 정의
| 줄 | 식 |
|---|---|
| 마지막점검일 | jeomgeom `작성일` 최댓값(`_hidden` 아님, 오늘 이하) |
| 마지막AS일 | 다녀온 AS의 최댓값 = max(as_records `작성일`, as_tickets AS·익일AS **완료** 행의 날짜, visit_logs work_kinds에 as). **이번 접수와 이번 접수로 만든 일정(`receptionId = 이 접수`)은 뺀다.** 접수(service_receptions)는 "다녀온 것"이 아니라 넣지 않는다 |
| 방문경과일 | 오늘(KST) − 마지막점검일. 점검 기록이 없으면 "기록 없음" |
| 4분기 워킨맵 | 이번 분기(오늘 기준) `workin_map_places` 중 code 일치 + 지점명 키 일치(없으면 code만) + `visible`. 표시는 `있음(C팀 분기점검)`, `있음(매월점검)`, `있음(G5 이번 분기 점검 완료)`, `없음`. kind=renewal(재계약)만 있으면 `없음(재계약만)` |
| 기기 대수 | 지점 행 중 품목이 복합기·프린터·플로터인 `임대중` 행 수(suggest_workin_candidates의 dev_base와 같은 분류) |
| AS 본 대수 | 마지막AS일 하루의 as_records 행에서 서로 다른 기번·자산기번 수 |
| 여분 판정 | 지점 기기별 최근 점검 2회 → `usageSpareAdvice`. 모든 기기의 `needsList`가 비면 `여분 충분`, 아니면 `여분 부족 n대`, 점검 기록이 없으면 `여분 모름` |
| 자가신청 | supply_requests(지점) 중 마지막점검일 뒤 건수 |

### 4-3. 점검여부 판정표(위에서부터 먼저 맞는 것)
| # | 조건 | 결과 | 글에 붙는 말 |
|---|---|---|---|
| 0 | 업체·지점을 못 찾음 / 자료 조회 실패 | **판단불가** | "임대리스트에서 못 찾음" 또는 "자료 조회 실패 — 직접 확인" |
| 1 | 이번 분기 워킨맵 없음(재계약만 포함) | **불필요** | (이번 분기 점검 대상 아님) |
| 2 | 워킨맵 라벨 G5(점검 완료)·G12(이관) | **불필요** | (워킨맵 G5 점검 완료) |
| 3 | 경과일 < 기준(분기 60·매월 25) | **불필요** | 방문경과일 N일 (최소60일경과 기준) |
| 4 | 경과 ≥ 기준(또는 점검 기록 없음) + 워킨맵 있음 + **마지막AS일이 마지막점검일보다 뒤** | **판단필요** | 근거 줄(아래) |
| 5 | 경과 ≥ 기준(또는 기록 없음) + 워킨맵 있음 + 점검 뒤 AS 없음 | **필요** | 방문경과일 N일 (최소60일경과 기준) |

- 판단필요 근거 줄(한 줄): `근거: 기기 3대 · AS 1대 봄(07-21) · 여분 충분 · 자가신청 0건`
- 사람이 판단하도록 "판단필요" 아래에 참고 한 줄을 붙인다(판정 자체는 바꾸지 않는다).
  - 기기 1대 + AS가 그 기기 + 여분 충분 → `참고: 1대·여분 충분 — AS 때 점검까지 했으면 생략 가능`
  - 기기 2대 이상 + AS 본 대수 < 기기 대수 → `참고: AS는 N대만 봄 — 나머지 기기 점검 필요 가능성 큼`

### 4-4. 추가일정
- 대상: `as_tickets` 중
  - (vendor_code = code) **또는** (vendor_code가 비어 있고 `vendorMatchKey(vendor)`가 entity.nameKeys에 있음) **또는** (지점 기번·자산번호가 serial·asset과 일치)
  - date ≥ 오늘 − `VISIT_ADVICE_PAST_DAYS` 이고 status ≠ 완료
  - scheduleType ≠ 휴가, vendor에 휴가·연차 없음
  - `receptionId` ≠ 이번 접수(이번 접수로 만든 일정 제외)
- 정렬: 날짜, 시간 순. 최대 5줄, 넘으면 `외 N건 — 일정리스트 확인`.
- 줄 모양: `1.2026-11-02(월) 납품 — 써브웨이 본사`
  - 종류: AS·익일AS → `AS`(issue 앞 12자를 괄호로) · 매월점검 → `매월점검` · 물류 계열 → calendarTitle에서 `납품|철수|교체|회수|이전|설치|세팅|셋팅` 중 처음 나온 낱말(없으면 `물류`) · source=recontract → `재계약 확인`
  - 지점 표기: 그 일정의 업체명이 이번 접수 지점과 다르면 ` — <괄호 안 지점명 또는 업체명 앞 16자>`
  - 날짜가 지났는데 미완료: 줄 끝에 `(지남·미완료)`
- 이름으로만 이어진 일정(vendor_code 없음)은 줄 끝에 `(이름 일치)`를 붙여 오탐을 사람이 거를 수 있게 한다.

### 4-5. 글 양식(확정안)
① 일반(예시 그대로, 콜론 뒤 띄어쓰기 없음)
```
청오에스떠블유 주식회사(써브웨이 본사) V
D470/31V0123/ABC12345
마지막점검일:2026-08-12
마지막AS일:2026-07-21
4분기 워킨맵:있음(C팀 분기점검)
점검여부: 판단필요 방문경과일 79일 (최소60일경과 기준)
근거: 기기 2대 · AS 1대 봄(07-21) · 여분 충분 · 자가신청 0건
참고: AS는 1대만 봄 — 나머지 기기 점검 필요 가능성 큼
추가일정:
1.2026-11-02(월) 납품 — 써브웨이 답십리역점
2.2026-11-03(화) AS(점검방문요청)
추가일정이 있으므로 같이 묶어서 진행할 수 있는지 확인이 필요합니다
```
(위 날짜·기번은 모양 예시다. 실제 값은 2-4 질의로 확정한다.)

② 추가일정 없음 → `추가일정:없음`, 마지막 줄 없음.
③ 보류했다가 아침에 발송 → 첫 줄 끝에 ` (10/30 21:40 접수분)`.
④ 판단불가 →
```
<접수 업체명> <등급>
<기종/자산기번/시리얼>
방문 판단: 임대리스트에서 못 찾음 — 마지막 점검·추가일정을 직접 확인해 주세요
```
- 머리 줄 = 접수의 vendor + grade(접수 글과 같은 표기). 기종/자산기번/시리얼은 빈 칸을 빼고 `/`로 잇는다.
- 600자를 넘으면 추가일정을 줄이고 `외 N건`을 붙인다. 테스트로 막는다.
- 전화·주소·키맨은 넣지 않는다(접수 글에 이미 있음).

---

## 5. 화면 흐름
1. 접수자가 서비스접수에서 [저장+AS방 전송](또는 [카톡 전송]·[CS 방문이관])을 누른다. 지금과 같다.
2. 전송이 성공하면 브라우저가 뒤에서 `queueVisitAdvice(접수id, 방)`을 부른다. 화면을 막지 않는다(실패해도 접수 결과 메시지는 그대로).
3. 결과 메시지 끝에 한 마디를 붙인다: `+ 방문 판단 글 대기(1분 안)` / `+ 방문 판단 글 10:00 예정` / `방문 판단 글 실패(접수는 정상)`.
4. 크론이 1분 안에 같은 방에 안내글을 넣고, 봇이 접수 글 바로 뒤에 올린다.
5. (선택, 2단계) 접수 폼 "AS 이력" 옆에 같은 판단을 미리 보여 주는 작은 칸 `방문 판단`. 전송 **전에** 접수자가 보고 "11/2 납품과 묶자"를 메모에 적을 수 있다. 같은 순수 함수를 쓴다.
6. (선택, 2단계) 서비스접수 리스트 행을 펼치면 `visit_advice_log.text`를 보여 주고 [다시 계산] 단추(새 글은 보내지 않음).

---

## 6. 작업 분해(겹치지 않게)

| 역할 | 할 일 | 건드릴 파일 |
|---|---|---|
| db-schema(표다빈) | `visit_advice_log` 표·RLS(anon select·insert만)·`flush_visit_advice()`·크론 `* 1-10 * * *`·app_config 기본값 5개(없을 때만 insert). 재실행 안전, 되돌리기 SQL 주석 | `supabase/visit-advice-20261031.sql`(새 파일) |
| sql-review(권한나) | 위 파일 검사(outbox insert는 security definer 안에서만, anon update/delete 없음, 기존 표 변경 없음) | 읽기만 |
| 구현 A: 순수 규칙(구현서) | `judgeVisit(facts, cfg)` · `formatVisitAdvice(facts, verdict, opts)` · `scheduleKindLabel(ticket)` · `adviceDueAt(now, hours)` · `pickUpcoming(tickets, ctx)`. import는 planDate·spareAdvice·ids(vendorMatchKey)만 | `src/visitAdvice.ts`(새 파일) |
| 구현 B: 자료 모으기 + queue(구현서 2) | `collectVisitFacts(receptionId)`: 접수 행 → RPC 코드 → 지점 행 → entity360 buildEntity·gather(only) → 4-2 값. `queueVisitAdvice(receptionId, room)`: 스위치 확인 → 모으기 → 판정·양식 → `visit_advice_log` insert(`Prefer: resolution=ignore-duplicates`). 실패해도 판단불가 행을 남긴다. entity360.ts는 **고치지 않고** 내보낸 함수만 쓴다 | `src/visitAdviceData.ts`(새 파일) |
| 구현 C: 연결(구현 B가 끝난 뒤, 같은 사람) | ServiceReception.tsx 세 곳(1123·1209·1317 전송 성공 뒤)에 `void queueVisitAdvice(id, room).then(...)` 한 줄씩 + 결과 메시지 꼬리. 관리 탭 스위치·기준값 입력칸 | `src/ServiceReception.tsx`(3곳만), `src/SystemAdmin.tsx`(설정 줄만) |
| ui-designer(윤화면) | 1단계는 결과 메시지 꼬리 문구와 관리 탭 칸 배치만. 2단계 "방문 판단" 칸은 **목업 이미지로 먼저**(사용자 규칙) | 목업만 |
| qa-checker(검수아) | 아래 테스트 + build/test + 범위 검사(entity360·api.ts sendServiceReception·봇·relay 미변경) | `tests/visitAdvice.test.ts`(새 파일) |
| 문서 | 매뉴얼 06(서비스접수)에 "방문 판단 글" 절, ops 03(DB)에 표·크론, AGENTS.md 작업 기록, eval worklog | `docs/manual/user/06-service-reception.md`, `docs/manual/ops/03-database.md` |

테스트(최소):
1. 판정표 6줄(0~5) 각각 + G5·G12 + 매월 25일 기준 + 점검 기록 없음.
2. 마지막AS일에서 이번 접수·이번 접수로 만든 일정이 빠지는지.
3. 추가일정: 휴가·완료 제외, 지난 날짜 미완료 표시, 5줄 넘으면 `외 N건`, vendor_code 없는 이름 일치에 `(이름 일치)`.
4. 종류 낱말: "…-납품(일반)/" → 납품, "철수" → 철수, 낱말 없음 → 물류, recontract → 재계약 확인.
5. 청오 표본(2-4 질의로 확정한 값을 고정): 10-30 접수 시각 기준 첫 줄 `2026-11-02(월) 납품`.
6. due_at: 09:30 → 같은 날 10:00 / 14:00 → 즉시 / 금요일 21:00 → 월요일 10:00 / 공휴일 건너뜀.
7. 글 길이 600자 이하, 콜론 표기가 예시와 같은지(`마지막점검일:`).

순서: db-schema ∥ 구현 A → 구현 B → 구현 C → qa-checker → sql-handoff(사용자 실행) → 테스트방 하루 → 스위치 켬.

주의: `src/ServiceReception.tsx`에는 지금 커밋 안 된 수정이 있다(git status M). 구현 C는 그 작업이 커밋된 뒤에 한다(같은 파일 동시 수정 금지).

---

## 7. 위험과 열린 질문

### 위험
| # | 위험 | 대응 |
|---|---|---|
| R1 | 동명·다지점 오탐: 코드(사업자 단위)로 모으면 청오처럼 본사·답십리역점 일정이 섞인다 | 점검·AS는 지점 기준 우선(4-1), 추가일정은 다른 지점이면 지점명을 붙여 보여 준다. 질문 Q3 |
| R2 | 네이버 수입 물류 일정의 업체명이 깨져 있으면(10-24 이전 청오 사례) 코드로도 이름으로도 안 걸린다 | calendarTitle에 지점 기번이 있으면 잡히지만 보장은 없다. 판단불가가 아니라 "추가일정 없음"으로 보일 수 있다는 한계를 매뉴얼에 적는다. 10-24 업체명 정리(fix-ticket-vendor)가 이미 한 번 메웠다 |
| R3 | 글이 길어 스팸처럼 보임(팀마다 하루 AS 접수가 많다) | 600자 상한, 추가일정 5줄. 질문 Q1(할 일 있을 때만 보내기) |
| R4 | 야간·이른 접수 | 3-3 보류. 보류 중 접수가 취소·삭제되면 skipped |
| R5 | 브라우저가 수집 중 닫힘 → 글 누락 | 2단계 보충 크론. 1단계는 결과 메시지로 실패를 보이고, 판단불가 행이라도 남긴다 |
| R6 | 판정이 틀려 기사가 점검을 빠뜨림 | 글은 "판단 안내"이고 결정은 사람이 한다. "판단필요"는 근거를 같이 보인다. 첫 2주는 facts jsonb로 판정을 되짚는다 |
| R7 | TEST_MODE 중 접수 → 안내글도 테스트방 | 접수 글이 나간 방(`sent_room`)을 그대로 쓰므로 자동으로 맞는다. 켜고 끄는 사이의 보류 글은 접수 당시 방으로 간다(의도) |
| R8 | 카톡 수집이 안내글을 기록으로 오인 | 봇 대화명 글은 파서가 뺀다. PC 중계(노트북 카톡 계정)로 나간 글은 그 계정 이름이 `KAKAO_BOT_NICKS`에 있는지 배포 전 ops-monitor가 확인한다 |
| R9 | 실사례 표본 미확인(이 세션에서 DB 조회 불가) | 2-4 질의를 구현 전에 MCP로 돌린다 |

### 사용자에게 물을 것(3개)
- **Q1. 언제 보낼까요?** (가) 복합기 AS 접수마다 항상 (나) 할 일이 있을 때만: 점검 필요·판단필요·추가일정 있음·판단불가. "불필요 + 추가일정 없음"이면 보내지 않음. → 추천 (나). 하루 글 수가 줄고, 예시 같은 "불필요 + 추가일정 있음"은 그대로 나간다.
- **Q2. "최근 AS를 다녀온 경우"의 범위**: 추천은 "마지막 점검 **이후**에 다녀온 AS가 있으면 판단필요(기간 무관)"입니다. 아니면 "최근 N일 안의 AS만"으로 할까요? 여분은 새 숫자를 정하지 않고 워킨맵·접수 폼과 같은 기준(A3 2세트·폐통 2, A4 2세트)으로 "충분/부족"만 표시합니다. 괜찮을까요?
- **Q3. 추가일정에 같은 회사 다른 지점 일정도 넣을까요?** (청오: 써브웨이 본사와 답십리역점) → 추천은 "넣되 지점명을 붙여 표시". 같은 지점만 넣으면 오탐은 줄지만 이번 같은 사례를 놓칠 수 있습니다.

---

## 8. 하지 않을 것(범위 밖)
- 판정을 근거로 일정을 자동으로 만들거나 묶기(판단은 사람).
- IT·지원 3종(경영·운영·영업)·원격이관 접수에 안내글 붙이기(복합기 AS와 CS 방문이관만).
- 접수 글(`sendServiceReception`) 본문·방 결정 바꾸기, outbox 표에 열 추가, 메신저봇·`outbox_relay.py` 수정.
- entity360.ts·spareAdvice.ts·ticket-title.ts 고치기(가져다 쓰기만).
- team_calendar_events(팀 메모 달력)·네이버 원본 직접 조회, 카톡 원문(kakao_messages)에서 일정 찾기.
- 엣지 함수 신설·entity360의 `_shared` 이관(2단계 후보).
- 접수 폼 "방문 판단" 미리보기 칸, 리스트 행 보기(5절 5·6, 2단계. 목업 승인 뒤).

## 결정 (2026-10-31 사용자)
- Q1: **할 일이 있을 때만** 보낸다(필요·판단필요·추가일정 있음·못 찾음). 단 **누락이 절대 없어야 한다** → 접수 뒤 브라우저가 닫혀도 보충 크론(flush + 미생성 접수 재계산)이 반드시 한 번은 판정하고, 자료 수집 실패는 건너뛰지 말고 "판단불가(자료 못 읽음)" 글로 보낸다.
- Q2: 판단필요 기준 "최근 AS" = 마지막 점검 이후 다녀온 AS 전부(기간 무관). 여분은 충분/부족만.
- Q3: 다른 지점 일정도 넣되 지점명 표시.
- 추가: **점검여부가 '불필요'여도 경과일을 항상 적는다** — 예 `점검여부: 불필요 (경과 59일 / 기준 60일, 워킨맵 있음)`. 59일처럼 기준 직전이면 사람이 보고 판단하게.
- 추가일정 뜻 = 그 업체(같은 사업자 다른 지점 포함)에 **앞으로 잡힌 방문 일정 전부**: AS·익일AS·물류(납품·철수·교체·세팅)·네이버에서 들어온 일정·매월점검·재계약, 날짜순. 하나라도 있으면 "같이 묶어서 진행할 수 있는지 확인이 필요합니다".
- 업체 매칭은 새 규칙이 아니라 필드 탭 이력·통합검색이 이미 쓰는 같은 함수(코드 5/10자리 → 이름 정규화) 재사용. 표본: 청오에스떠블유 10-30 접수 → 마지막점검 2026-08-04(87일)·마지막AS 10-23·워킨맵 있음·추가일정 11-02(월) 교체/기기상향(네이버 수입, 운영팀) → 판단필요 + 묶기 안내.
