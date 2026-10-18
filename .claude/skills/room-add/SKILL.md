---
name: room-add
argument-hint: "[업무종류] [지역] [방 이름]"
description: 카톡방 매핑(room_map) 추가·변경 절차 — 업무 종류|지역 → 방 이름. "이 방으로 보내게 해줘", "방 추가", "방 이름 바꿔", /room-add 에 사용. 밀린 공유가 바로 나갈 수 있다는 주의까지 포함.
---
# /room-add — 카톡방 매핑 추가·변경

## 구조
- 표 `room_map(category, region, room)`. category = 업무 종류, region = 지역(A~E 또는 `*` 전 지역 공통), room = **카톡방 이름과 글자 하나까지 똑같아야** 한다(봇·노트북 중계·앱이 모두 이 이름으로 방을 찾는다).
- 업무 종류 목록(src/SystemAdmin.tsx ROOM_CATEGORIES): 점검·AS·미수·재계약·불만·초과조정·자가·부품·물류·PC·복합기·IT접수·마감·반납·불량토너·불량부품.
- E 지역은 화면에 "CSS팀"으로 보인다. 마감|팀 은 카운터 사진이 올라가고 봇이 관리부 목록을 읽는 방.
- 테스트는 `테스트 전용방`.

## 순서
1. **현재 상태 조회**(읽기): `rest/v1/room_map?select=category,region,room&order=category.asc,region.asc` (anon 키는 src/supabase.ts). 이미 있는 짝이면 "변경", 없으면 "추가".
2. **방 이름 확인**: 사용자가 준 이름을 그대로 쓴다. 띄어쓰기·괄호·쉼표까지. 애매하면 `room_activity?select=room&order=last_at.desc` 에서 봇이 실제로 본 방 이름을 찾아 맞춘다.
3. **넣는 방법 2가지** — 둘 중 하나:
   - (권장) 사용자가 FIELD **관리 탭 → 카톡방 매핑**에서 업무 종류·지역·방 이름을 넣고 저장(SystemAdmin.tsx). 앱 캐시는 저장 즉시 무효화된다.
   - SQL: `insert into room_map (category, region, room) values ('점검','E','충청외E 극지방 as') on conflict (category, region) do update set room = excluded.room;` → 반드시 /sql-handoff 절차(sql-review)로 건넨다. 내가 anon REST 로 room_map 을 쓰는 것은 권한 분류기가 막는다 — 시도하지 않는다.
4. **사용자에게 미리 알릴 것 (꼭)**:
   - "그동안 그 방이 없어 건너뛰던 공유(예: 시트 변경 알림)가 매핑 직후 **한꺼번에** 나갈 수 있습니다." (2026-09-17 E방에 3건 즉시 공유된 사례)
   - "새 방에는 다음 정시(평일 KST 10~19시)에 봇 심박 '🤖 MM/DD 카톡봇 대기 중 [봇점검]' 한 줄이 갑니다." (room_activity 없음 → 20시간 무활동 취급)
   - 봇 폰이 그 방에 들어가 있어야 하고, 노트북 중계를 쓰려면 카톡 PC 에서 그 방을 별도 창으로 열어 둔다(실행기는 열린 창에만 붙여 넣는다).
5. **확인**: `outbox` 에 테스트 글 1건을 `테스트 전용방`이 아닌 새 방으로 보내는 건 사용자 동의 뒤에만. 보낸 뒤 `room_activity` 에 그 방의 `bot_send`/`pc_send` 가 찍히면 성공.
6. **기록**: AGENTS.md 작업 기록 + 메모리 firstoa-pending-sql 의 "남은 설정" 항목 갱신(아직 방 이름이 미정인 매핑 목록이 거기 있다).
