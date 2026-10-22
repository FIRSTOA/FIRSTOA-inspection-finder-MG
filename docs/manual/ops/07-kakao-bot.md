# 07. 업무폰 카톡 봇 (메신저봇R)

> 근거: `gas-and-bot/supabase-outbox-poller.js`(머리 주석 ①~⑨), `gas-and-bot/poller-harness.cjs`, `.claude/skills/room-add/SKILL.md`, AGENTS.md "카톡 발송 규칙".
> **[라이브]** 2026-10-22 `room_map` 26행, `outbox` 대기 0행.

## 카톡 발송 구조
```
앱·엣지·cron  ──insert {room, text}──▶  outbox 표
                                          │
          ┌───────────────────────────────┤
          ▼ 7초 폴링                      ▼ 2분 넘게 남아 있으면(1분 주기)
  업무폰 메신저봇R "점검AS"          노트북 outbox_relay.py → 카톡 PC (06 장)
  bot.send(room) → 실패 시 세션답장
          │ 성공분만 DELETE (무유실)
          ▼
     카톡 방  ──▶ room_activity (bot_send / pc_send, 방별 마지막 활동)
```
- 카톡으로 보내는 유일한 방법 = `outbox` 에 `{room, text}` 1행 insert. 앱에서는 `src/supabase.ts` 의 `enqueueOutbox(room, text)`.
- `room` 은 카톡방 이름과 **글자 하나까지(띄어쓰기·괄호·쉼표 포함)** 같아야 한다. 방 이름은 코드에 쓰지 않고 `room_map(category, region, room)` 에서 찾는다.
- 시험은 `테스트 전용방`(app_config `TEST_ROOM`, `TEST_MODE`).

## 봇 스크립트 (기준본 = 저장소 파일)
- 폰 실물과 같은 기준본: **`gas-and-bot/supabase-outbox-poller.js`** (봇 이름 "점검AS"). 고치면 폰에 **통짜로 붙여넣어 교체**한다(부분 수정 금지).
- 하는 일:
  - 7초마다 `outbox` 를 created_at 순으로 가져와 보내고, 성공분만 `DELETE`(⑥ 보냈는데 삭제만 실패한 글은 기억해 두 번 안 보냄)
  - `bot.send` 실패 시 그 방에서 받은 최근 메시지 세션으로 답장. 세션 없는 방은 10분에 1번만 재시도(④)
  - 12시간 지난 "[봇점검]" 심박 글은 보내지 않고 지움(⑤)
  - 방 활동을 30분에 1번 `room_activity` 에 보고(⑦)
  - 마감방(room_map 업무 종류 "마감")에 관리부가 올린 카운터 목록을 `counter_sms_inbox` 에 넣고 엣지 `counter-inbox-ingest` 호출(⑧). 그 방의 알림이 폰에서 켜져 있어야 글이 들어온다
  - **야간 22:00~08:00 KST 발송 금지**(⑨, 2026-10-22): 꺼내지도 않고 서버에 남김 → 08:00 이후 첫 폴링에 보냄. "봇테스트" 응답과 마감 목록 수집은 밤에도 동작
  - 방에서 "봇테스트" → "봇 살아있음 OK" 응답(상시 헬스체크)
  - WakeLock(화면 꺼져도 폴링 유지), 스레드 자물쇠(두 스레드가 동시에 JS 를 돌리면 GraalJS 내부 오류로 봇이 꺼지던 문제, 2026-09-29)
- 설정 상수(파일 맨 위): `SUPABASE_URL`, `SUPABASE_ANON`(공개값), `POLL_INTERVAL = 7000`, `QUIET_START_HOUR = 22`, `QUIET_END_HOUR = 8`.

### 교체 절차
1. 코드 수정 → **시험 하네스**로 논리 확인(Node 에서 메신저봇R 흉내):
   ```
   node gas-and-bot/poller-harness.cjs gas-and-bot/supabase-outbox-poller.js
   ```
   시나리오 7개(세션 있음/없음, 10분 재시도, 봇테스트, ack 실패 재발송 방지, 야간 금지)가 모두 통과해야 한다.
2. 카톡 규칙 검사(검사실 방지훈) 통과 → 커밋·푸시(02 장).
3. 업무폰 메신저봇R → 봇 "점검AS" 편집 → 전체 삭제 → GitHub raw URL 의 파일 내용을 **통째로** 붙여넣기 → 저장·컴파일.
   (raw 주소: `https://raw.githubusercontent.com/FIRSTOA/FIRSTOA-inspection-finder-MG/main/gas-and-bot/supabase-outbox-poller.js`)
4. 로그에 `[봇] Supabase outbox 폴링 시작 (2026-10-22판 …)` 같은 시작 줄이 찍히는지, 테스트 전용방에서 "봇테스트" 응답이 오는지 확인.

### 폰 설정 (확인 필요 — 폰 실물 기준)
- 메신저봇R 앱 배터리 최적화 제외, 카톡 알림 켜짐(봇은 알림 답장 통로를 쓴다 → **글자만 보낼 수 있고 사진은 못 보낸다**. 사진은 노트북 카톡 PC 가 보낸다).
- 봇 폰이 그 방에 들어가 있어야 보낼 수 있다.

## 같은 폴더의 다른 봇
- `messengerbot-poller.js` — 옛 GAS `_kakao_outbox` 폴링 방식(지금 쓰는지 확인 필요, 기준은 supabase-outbox-poller.js).
- `happycall-query-bot.js`, `CD불만고객-query-bot.js`, `PCIT고객등록-query-bot.js`, `부품리페어-query-bot.js`, `오버홀완료-query-bot.js`, `특이사항-query-bot.js` — 특정 방에서 `?`·`/` 로 시작하는 질문을 외부 웹훅(Make.com)에 넘겨 답장하는 질의 봇. FIELD DB 와는 무관(확인 필요: 현재 폰에서 켜져 있는지).

## 방 매핑 (room_map) 추가·변경 — /room-add
- 업무 종류(관리 탭 ROOM_CATEGORIES): 점검·AS·미수·재계약·불만·초과조정·자가·부품·물류·PC·복합기·IT접수·마감·반납·불량토너·불량부품. 지역 A~E 또는 `*`(공통). E 는 화면에 "CSS팀".
- 방법(권장): FIELD **관리 탭 → 카톡방 매핑**에서 저장(캐시 즉시 무효화). 또는 SQL:
  `insert into room_map (category, region, room) values ('점검','E','방 이름') on conflict (category, region) do update set room = excluded.room;` → 04 장 절차.
- 방 이름이 애매하면 `select room, source, last_at from room_activity order by last_at desc;` 에서 봇이 실제로 본 이름을 복사.
- **미리 알릴 것**: ① 그동안 방이 없어 건너뛰던 공유가 매핑 직후 한꺼번에 나갈 수 있다(2026-09-17 E방 3건) ② 심박 cron 이 켜져 있으면 새 방에 다음 정시 "🤖 MM/DD 카톡봇 대기 중 [봇점검]" 한 줄이 간다(**[라이브] 지금 심박 cron 은 꺼져 있음**) ③ 노트북 중계를 쓰려면 카톡 PC 에서 그 방을 별도 창으로 열어 둔다.
- [라이브] 아직 없는 매핑 예: 미수|E, 불만|E, IT접수|*, 경영접수|*·운영접수|*·영업접수|* (메모·AGENTS.md 근거 "방 이름 미정"). 없는 매핑은 기능별로 "안 보냄" 또는 지역 AS 방으로 대체된다 — 기능 코드 확인.

## 시각 규칙
- 사람 조작 없이 나가는 자동 메시지는 **KST 10시 이후**(출근 전 알림 금지). 봇 심박은 평일 10~19시만.
- 야간 22:00~08:00 은 봇·노트북 모두 발송 보류(서버에 남음).

## 상태 보기 (읽기 전용 SQL)
```sql
select count(*), min(created_at) from outbox;                                  -- 대기 수·가장 오래된 글
select room, source, last_at from room_activity order by last_at desc limit 20; -- 최근 배달 경로
```
`outbox` 가 쌓이고 `bot_send` 가 멈췄으면 봇 폰을 의심(10 장).
