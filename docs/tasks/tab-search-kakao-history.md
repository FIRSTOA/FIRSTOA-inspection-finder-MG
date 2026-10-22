# 탭별 검색 + 카톡방 대화 이력 (카톡방 체제를 FIELD 검색으로)

작성: 기획실 한설계 · 2026-10-22 · 조사·설계만(코드 변경 없음)
근거 보고서: docs/tasks/automation-feasibility-2026-10.md D2(카톡 DB) — 이 설계는 그 결론(업무방 한정·anon 읽기 차단·보관 기간·직원 고지)을 그대로 따른다.
표기: [사실] 저장소·코드에서 확인 · [웹] 일반 지식(확인 권장) · [추정] · [확인 필요]

---

## 1. 한 줄 목표와 쓰는 사람

**필드 각 탭 맨 위 검색칸에 업체명·자산번호·시리얼을 치면, 그 탭 업무의 "언제 무엇"이 FIELD 기록 + 그 탭 카톡방 원문으로 한 줄 타임라인에 나온다.**
"여기 언제 점검 갔지?" → 점검 탭 검색, "AS 언제 터졌더라?" → AS, "언제 납품·철수됐지?" → 물류. 지금 카톡방을 위로 스크롤하던 일을 대신한다.

- 쓰는 사람: 현장 기사(폰, 이동 중 한 손 — 주 사용자), CS 관리자·팀장(PC, 전화 응대 중).
- 카톡 원문 적재는 노트북(서버 PC)과 봇폰이 자동으로. 사람은 처음 한 번(과거분)과 빈 구간이 생겼을 때만 "대화 내보내기".

---

## 2. 이미 있는 것 — 재사용·확장 지점

### 2-1. 필드 탭 목록 [사실, src/App.tsx 6719~6760]
위 줄: 점검·AS(복합기/청정기) · 물류 · 확장성(IT/복합기(기타)) · 더보기(담당자/주소 변경 · 불만 · 미수 · 초과조정 · 재계약 · 교체양식 · 칭찬).

### 2-2. 이미 있는 검색 — 겹치지 않게 역할을 나눈다
| 이미 있는 것 | 파일:함수 | 하는 일 | 이번 기능과의 관계 |
|---|---|---|---|
| 통합 검색 360 | src/entity360.ts resolveCandidates·buildEntity·gather·toEvents, 화면 src/Search360.tsx(조회 탭) | 검색어 → 거래처 코드 → 이름 변형·기번·자산번호 묶음(Entity) → 약 30개 표 병렬 수집 → 사건(EventItem) 목록 | **핵심 재사용.** 탭 검색 = 같은 Entity·같은 SourceDef 를 "그 탭 표만" 골라 돌리는 것. 이름 표기 차이·두 코드 체계(마스터 10자리/임대 5자리)가 이미 풀려 있다. |
| 통합이력 팝업(🗂️) | src/UnifiedHistory.tsx, src/api.ts getVendorHistoryDetail (App.tsx 6561, 모든 필드 탭 머리 단추) | 한 업체의 모든 종류 이력 | 탭 검색은 "이 탭 종류만, 시간순, 카톡 포함". 1단계는 별도, 합칠지는 D7. |
| 거래처검색(🔍) | src/VendorSearch.tsx (점검·AS 탭만) | 지난 양식을 불러와 변환기에 넣기 | 목적이 다름(작성 보조). 건드리지 않음. |
| 조회 탭 기록 조회 | src/DataLookup.tsx + src/lookupCatalog.ts | 표별 목록·기간·팀 필터 | 타임라인 "더 보기" 링크 대상으로만. |
| 미수 방문 이력 | src/MisuVisitHistory.view.tsx | 업체별 타임라인 + 옛 카톡 기록 회색 | 카톡 줄 표시(회색·출처)를 이 스타일에 맞춘다. |

**확장 지점(최소)**
- src/entity360.ts `gather(e)` → `gather(e, opts?: { only?: string[] })` 선택 인자 1개. 없으면 지금과 동일(통합 검색 360 무회귀). 탭 검색이 같은 수집 로직(정확/원문 기번/느슨→승격)을 그대로 쓰게 하는 유일한 수정.
- SOURCES 에 없는 원본(misu_visits 등)은 SOURCES 를 고치지 않고 새 파일 src/tabSearch.ts 안에 SourceDef 로 덧붙인다.
- src/App.tsx: 필드 헤더 탭 줄 아래 `<TabSearchBar mode={mode} pcSubTab={pcSubTab} />` 1줄 + lazy import 1줄(진입점 2줄 규칙 안).

### 2-3. 카톡 쪽에 이미 있는 것 [사실]
- **방 매핑**: room_map(category, region, room), 관리 탭 편집, src/supabase.ts getRoomMap() → "점검|C" 키. 실측 26행(AS 5·점검 5·재계약 5·미수 4·불만 3·자가·부품·초과조정·마감 각 1 — 2026-10-22 보고서).
  코드 고정 방(src/api.ts FIXED_ROOM·REGION_ROOMS): 물류 "완료방(납품,철수,교체)", PC/IT "PC/IT/피씨/확장성고객등록및영업", 복합기 확장성 "영업확장성미션 : …", 담당자 "신)담당자/명의/주소변경등 특이사항", 불만 "신)AB불만고객"·"신)CD불만고객방", 미수 A~D 4방, 초과·재계약 "강북A/초과사용 계약종료체크" 등 5방(**초과조정과 재계약이 같은 방**).
- **TXT 파서**: apps-script/first-data/src/Kakao.gs parseKakaoMessages_ — 세 형식(대괄호형 `[이름] [오후 3:24] 내용` + 날짜 띠, PC 점 날짜형 `2024. 1. 5. 오후 3:24, 이름 : 내용`, 년월일형) + 여러 줄 이어 붙이기 + 입장/퇴장 안내 제외. msgHash_ = MD5(방|날짜|작성자|본문)으로 재업로드 시 새 글만.
  **한계**: 시각(시:분)을 버리고 날짜만 남긴다 → 새 파서는 시:분을 살려야 봇 수집분과 중복 판정이 된다.
- **봇 수집 통로**: gas-and-bot/supabase-outbox-poller.js ⑧ — onMessage 는 자물쇠 안에서 큐(_listQueue)에만 넣고, 폴링 스레드 flushLists 가 POST(두 스레드 동시 JS 금지 규칙). **한계**: POST 실패 시 그 글은 버려진다(큐를 먼저 비움). 카톡 전량 수집엔 재시도 버퍼가 필요.
- **노트북 실행기**: tools/worker/worker.py scheduled() 에 시계 작업(백업·중계·포스터)을 붙이는 틀, state.json 으로 하루 1회 보장, 심박 note.
- **엣지 함수 공통 사실**: 지금 어떤 엣지 함수도 SSO 를 서버에서 검증하지 않는다(SSO 토큰은 5분짜리, 확인 직후 버림 — src/sso.ts 머리 주석). → "읽기는 엣지 함수 경유"만으로는 완전한 차단이 아니다(7절 R1).

---

## 3. 데이터 설계

### 3-1. 탭별 검색 대상 (1단계 = FIELD 기록만, SQL 0)
room_map 키는 "종류 / 지역"으로 적는다(실제 키는 `종류|지역`).

| 탭 | FIELD 원본 표 (entity360 SourceDef 재사용) | 카톡방 (2단계 이후) | 한 줄 표시 예 |
|---|---|---|---|
| 점검·AS › 복합기 — [점검] 칩 | jeomgeom, visit_logs(점검) | room_map 점검 / A~E | 2026-09-14 점검 · 이민구 · 매수 12,340 · 토너 K 30% |
| 점검·AS › 복합기 — [AS] 칩 | as_records, service_receptions, as_tickets(일정) | room_map AS / A~E | 2026-08-02 AS · 용지걸림 롤러 교체 · 김OO |
| 점검·AS › 청정기 | jeomgeom·as_records 중 청정기(구현 때 AirSearch 기준 확인 — D10) | 위와 동일 | |
| 물류 | logistics_records, lease_status(납품·교체), vendor_info(계약일·종료일 — 기기 줄) | 물류 / * 없으면 "완료방(납품,철수,교체)" | 2025-03-10 납품 · SL-X7400 · 자산 F1234 |
| 확장성 › IT | pc_expansion | "PC/IT/피씨/확장성고객등록및영업" | |
| 확장성 › 복합기(기타) | mfp_expansion | "영업확장성미션 : …" | |
| 담당자/주소 변경 | contact_changes | "신)담당자/명의/주소변경등 특이사항" | |
| 불만 | bulman | 불만 / * (AB·CD 방) | |
| 미수 | misu_visits(SQL 실행 후 — 표가 없으면 404 를 조용히 건너뜀), misu | 미수 / A~D | |
| 초과조정 | overage_adjust, overage | 초과사용 계약종료체크 5방 | |
| 재계약 | recontract, churn_defense(해지방어) | 초과사용 계약종료체크 5방(초과조정과 같은 방) | |
| 교체양식 | lease_status(교체), logistics_records(교체) | 완료방 | |
| 칭찬 | 없음 — 검색칸 숨김 | — | |

- 방은 **지역 구분 없이 그 종류 전부**를 본다(업체가 팀을 옮겼어도 옛 기록이 나오게). 지역은 알약으로 표시만.
- 건수를 세지 않는다. 타임라인만(건수 원본 문제 — src/workCount.ts — 에 끼어들지 않음).

### 3-2. 새 표 (2단계부터, SQL 필요 — supabase/kakao-messages.sql, 표다빈 작성 → 권한나 검사 → /sql-handoff)
**kakao_messages** — 1글 = 1행
| 컬럼 | 형 | 설명 |
|---|---|---|
| id | bigint identity pk | |
| room | text not null | 카톡방 이름 그대로 |
| room_kind | text | 점검·AS·물류·확장성IT·확장성복합기·담당자·불만·미수·초과재계약 — 넣을 때 kakao_collect_rooms 로 판정 |
| region | text | A~E, 없으면 null |
| sent_at | timestamptz not null | 봇 = 받은 시각(초), 내보내기 = 분 단위 |
| sender | text | 카톡 대화명 |
| body | text not null | 본문(주민번호·카드번호 모양은 트리거로 가림, 최대 20,000자) |
| body_key | text generated | 소문자·공백/기호 제거 — 업체명 띄어쓰기 차이 흡수. **pg_trgm GIN 인덱스**(통합 검색 ilike timeout 교훈) |
| source | text check in ('bot','export') | |
| is_bot | bool default false | 봇 계정이 보낸 글(= FIELD 양식 발송분, FIELD 기록과 중복이라 기본 숨김) |
| has_media | bool | "사진"·"동영상"·"파일:" 자리 글 |
| dedup | text unique | md5(정규화 방 + KST yyyy-mm-dd HH:mm + sender + 본문 앞 500자 정규화) |
| import_id | bigint null | kakao_import_log 참조(어느 파일에서 왔나) |
| created_at | timestamptz default now() | |

인덱스: (room_kind, sent_at desc), body_key gin_trgm_ops, (room, sent_at).

**kakao_collect_rooms** — 수집 허용 방(room_map 컬럼은 바꾸지 않는다 — AGENTS 규칙 2)
room text pk · room_kind · region · enabled bool · bot_nick text(그 방의 봇 대화명 — is_bot 판정) · note. 관리 탭에서 켜고 끔. 시드 = 3-1 표의 방들(약 25개).

**kakao_import_log** — 내보내기 파일 적재 기록(본문 없음)
id · file_name · room · from_at · to_at · read_count · inserted · duplicated · masked · source_device(노트북/앱) · status · error · created_at.

**권한 (D2 결론 그대로)**
- kakao_messages: RLS 켬. **anon = INSERT 만**(with check: source in ('bot','export'), length(body) ≤ 20000). SELECT·UPDATE·DELETE 없음. 넣기는 `Prefer: return=minimal` + `on_conflict=dedup` + `resolution=ignore-duplicates`. SELECT 권한 없이 ON CONFLICT DO NOTHING 이 PostgREST 에서 되는지 표다빈이 실측 [확인 필요] — 안 되면 넣기도 엣지 kakao-ingest 경유(봇 포함).
- 읽기: 새 엣지 함수 **kakao-search** 만(service role) + 7절 R1 제한.
- kakao_collect_rooms·kakao_import_log: anon SELECT 허용(방 이름·숫자만), 쓰기는 room_map 과 같은 방식.
- 보관: pg_cron 매일 03:40 `delete … where sent_at < now() - interval '<D3>'`.
- 노트북 02:30 백업(tools/worker/backup_tables.py)에는 기본 **제외**(노트북에 평문 원문이 남음) — D9.
- 트리거(넣기 전): 주민번호 `\d{6}-?[1-4]\d{6}` → 가림, 카드번호 16자리 → 가림. 전화·주소는 업무상 필요해 그대로(D4).

### 3-3. 업체 매칭 — 넣을 때가 아니라 찾을 때
카톡 글에는 업체 칸이 없다. 넣을 때 맞추면 3천 곳 × 모든 글 비교 + 오매칭이 영구히 남는다 → **검색할 때** 맞춘다.
1. 탭 검색이 entity360 buildEntity 로 Entity(names·nameKeys·serials·assets·core)를 만든다(이미 있음).
2. kakao-search 에 `{ kinds, nameKeys, deviceKeys, core }` 를 보낸다(검색어 원문이 아니라 키 묶음).
3. 함수가 room_kind 안에서 body_key 부분 일치(trgm 인덱스)로 찾는다.
   - **정확**: nameKeys(vendorMatchKey — src/ids.ts 가 supabase/functions/_shared/counter-sms/vendorKey.ts 를 그대로 다시 내보냄 → 엣지에서도 같은 함수) 중 3자 이상 키 일치, 또는 기번·자산번호(identKey 4자 이상) 일치.
   - **이름 일부(확인 필요)**: core(예 "건영")만 걸린 글 — "이름 일부 일치" 표시, 기본 접힘. 통합 검색 360 의 exact/loose 원칙(조용히 섞지 않는다)과 같다.
4. 결과 최대 100줄, 최신순.

### 3-4. 저장량 추정 [추정 — 3단계 1주 실측으로 교체]
- 업무방 25개 × 하루 평균 40글 × 본문 평균 250바이트 ≈ 하루 0.25MB → 연 90MB. trgm 인덱스·행 머리 포함 2.5~3배 → **연 약 0.25~0.3GB**.
- 과거분(내보내기, 방마다 최대 3년 가정) 0.6~0.9GB 일회성.
- Supabase Pro 기본 DB 디스크 8GB [웹] 안. 사진·파일은 넣지 않는다(자리 글만).

---

## 4. 화면 흐름 (폰 기준, PC 는 같은 흐름 넓게)

1. 필드 탭(예: 물류)을 연다 → 탭 줄 바로 아래 **한 줄 검색칸** "이 업체 물류 이력 — 업체명·자산·시리얼". 기본 한 줄(입력 양식을 밀어내지 않음). 탭을 바꾸면 안내 글과 대상만 바뀐다.
2. 2자 이상 입력(300ms 디바운스) → 후보(resolveCandidates, 근거 칩 "기번 일치/업체명 일치") 최대 5개. 기번·자산번호로 후보가 1개면 바로 3단계.
3. 후보 선택 → **타임라인 시트**(폰 = 아래에서 올라오는 시트, PC = 오른쪽 "결과 미리보기" 자리 위 겹침):
   - 맨 위 요약 한 줄: "마지막 납품 2025-03-10 · 철수 없음 · 교체 1회(2026-02-04)" — 그 탭 종류의 마지막 사건.
   - 줄 = 날짜 · 종류 알약 · 한 줄 내용 · 작성자. **FIELD 기록 = 흰 바탕**, **카톡 원문 = 회색 바탕 + "카톡 · 완료방 · 2024-11-02 15:24 · 홍길동"**.
   - 점검·AS 탭은 칩 [전체][점검][AS][접수·일정]으로 거른다.
4. 줄을 누르면 펼침: FIELD 기록 = 원문 + "조회에서 열기", 카톡 = 같은 방 앞뒤 5글(±30분 문맥, kakao-search 2차 호출) — "그때 무슨 얘기였나".
5. 맨 아래: "모든 종류 보기 → 통합이력" 링크, 고지 한 줄 "카톡 원문은 수집 허용된 업무방만 · 봇 수집은 빠질 수 있음" + 방별 수집 기간("완료방: 2023-05 ~ 오늘").
6. (선택) 양식에 업체를 이미 고른 상태면 검색칸에 그 업체를 연한 제안으로("○○ 이력 보기") — **누를 때만 조회**(탭 전환마다 여러 표 조회 금지).

- 빈 결과: "FIELD 기록 없음 · 카톡 원문 없음(이 방은 2025-09부터 수집)"처럼 **어디까지 봤는지**를 말한다.
- 네트워크 실패: 표별 실패는 줄 하나("물류 기록을 못 불러왔습니다 · 다시"), 나머지는 그대로(gather 의 ok:false 사용). 카톡 검색 실패·스위치 꺼짐이면 FIELD 기록만 + "카톡 원문 꺼짐".
- 탭 전환·새 검색 시 이전 조회는 버린다(늦게 온 결과가 덮어쓰지 않게 요청 번호 비교).

---

## 5. 카톡 수집 3안 비교와 추천

| | A. 사람 내보내기 + 노트북 폴더 감시 | B. 봇 실시간 수집 | C. 둘 다 (과거 = A, 앞으로 = B) |
|---|---|---|---|
| 과거 대화 | **된다**(내보낸 사람 폰에 남은 만큼) | 안 된다(되감기 없음) | 된다 |
| 앞으로 | 사람이 주기적으로 다시 내보내야 함 | **자동·수 초 지연** | 자동 |
| 빠지는 구간 | 내보낸 시점 이후 전부 | 봇폰 꺼짐·봇 죽음·알림 꺼진 방 | B 의 빈 구간을 A 로 메움(매일 점검이 빈 구간을 알려 줌) |
| 사람 손 | 방마다 메뉴 몇 번(방 25개) | 0 | 처음 1회 + 빈 구간 생길 때만 |
| 위험 | 내보내기 파일이 사람 폰·메일에 남음 | 봇폰 1대 의존 증가, 스크립트 교체(방지훈 검사) | 두 경로 중복 → dedup 키로 해결 |
| 개발 | 파서(TS) + 엣지 kakao-ingest + 노트북 폴더 감시 | 봇 ⑩ + 재시도 버퍼 | 둘 다 |

**추천: C.** "매일 자동 + 실시간 가능하면"을 둘 다 만족하는 건 C 뿐. 단 **순서는 A 먼저** — 과거 이력이 "언제 납품됐지?"에 바로 답이 되고, 실시간은 앞으로 쌓여야 의미가 생긴다.

### 5-1. 노트북이 카톡 PC 메뉴를 눌러 "자동 내보내기" — 하지 않는다(위험)
- [사실] 카톡 PC 자동화 규칙(.claude/agents/kakao-pc-rules.md, 메모리 firstoa-kakao-pc-automation): 새 좌표는 probe 스크린샷으로 눈으로 확인 전 금지, 맨 앞 창 확인 없이 키 금지, 창이 쌓이면 카톡이 죽음. 내보내기는 한 번도 검증 안 된 **채팅방 메뉴 → 대화 내용 → 내보내기 → 윈도 저장 창** 경로다.
- [웹/추정] 같은 메뉴에 **"채팅방 나가기"**가 있다. 좌표가 한 칸만 어긋나도 봇이 업무방에서 나가고, 다시 초대받기 전까지 그 방 발송·수집이 모두 끊긴다. 10/21 처럼 카톡 PC 자동 업데이트로 화면이 바뀌면 그날 바로 터진다.
- [웹/확인 필요] PC 카톡 내보내기는 **그 PC 에 남은 대화만** 나온다. 노트북 봇 계정은 10/21 재로그인 — 과거분이 거의 없을 수 있어 자동화해도 얻는 게 적다.
- 결론: 노트북은 **"내보낸 파일을 받아 적재"까지만** 자동화(폴더 감시). 카톡 클릭 자동화 없음 → kakao-pc-rules 와 충돌 없음.

### 5-2. A 자세히 — 사람 내보내기 → 노트북 자동 적재
1. 방마다 **그 방에 가장 오래 있던 사람의 폰**에서 "대화 내보내기 → 텍스트만" [확인 필요: 메뉴 이름]. 보낼 곳 = 회사 구글 드라이브 폴더(노트북에 드라이브 동기화가 있으면 그 폴더가 곧 감시 폴더) 또는 메일·USB 로 노트북 `C:\FIRSTOA\kakao-export\inbox\`.
2. 노트북 실행기 새 시계 작업 kakao_import(10분마다): inbox 의 .txt/.zip → 파일 머리(방 이름·저장 날짜) → 메시지 시작 줄 경계로 1MB 조각 → 엣지 **kakao-ingest**(파서는 엣지 쪽 TS 하나 — 앱 업로드와 같은 파서) → 결과 kakao_import_log → 파일을 `done\`(7일 뒤 삭제) 또는 `failed\`.
3. 방 이름을 못 읽으면 적재하지 않고 `failed\` + 관리 탭 "방 지정 필요". kakao_collect_rooms 에 없는 방(개인방·잡담방)은 **버림**(D1).
4. 같은 파일·겹치는 기간을 다시 넣어도 dedup 으로 새 글만(Kakao.gs msgHash_ 와 같은 생각 + 시:분).
5. 보조: 관리 탭 [카톡 TXT 올리기](같은 kakao-ingest) — 노트북이 꺼졌을 때.

### 5-3. B 자세히 — 봇 실시간
- gas-and-bot/supabase-outbox-poller.js ⑩: onMessage 는 kakao_collect_rooms 방 글만 _msgQueue 에 push(자물쇠 안, 통신 없음 — ⑧ 패턴), 폴링 스레드가 50글씩 묶어 POST(on_conflict=dedup). **실패하면 큐에 되돌림**(⑧ 과 다름). 큐 상한 2,000글, 넘으면 오래된 것부터 버리고 로그 "유실 n글".
- 방 목록은 ⑧ 처럼 10분 캐시.
- 봇이 보낸 글은 onMessage 에 오지 않는다 [추정] → FIELD 양식 중복 없음. 내보내기 파일의 봇 글은 bot_nick 로 is_bot=true.
- 야간 22~08시 금지는 **발송** 규칙이라 수집과 무관(수집은 24시간).
- 방지훈 검사 + poller-harness 시나리오 추가 + 봇폰 스크립트 통짜 교체 필요.

### 5-4. "매일 자동 체크"
- 노트북 매일 09:30 kakao_daily_check(조회만): 방별 어제 글 수·마지막 수집 시각, 봇 심박 끊긴 구간 → **"빈 구간 — 이 방 내보내기 필요: 완료방 10/21 14:00~16:30"** 목록을 worker_heartbeat note + 관리 탭 카드 "카톡 수집 현황"에. 평일인데 업무방 글 0 이면 노란 줄.
- 카톡으로 알리지는 않는다(관리 탭·운영실 감시연 조회 대상에 추가).
- 실시간: B 가 켜지면 글은 수 초 안에 DB 에 들어가고 화면은 검색할 때 읽는다. 실시간 구독은 불필요(범위 밖).

---

## 6. 작업 분해 (겹치지 않게)

### 1단계 — 탭 검색(FIELD 기록만) · SQL 0 · 카톡 0 · 바로 시작 가능
| 역할 | 할 일 | 파일 |
|---|---|---|
| ui-designer 윤화면 | 한 줄 검색칸 위치(짙은 헤더 띠 안/아래 — 폰에서 양식이 덜 밀리는 쪽), 후보 줄, 타임라인 줄(흰 = FIELD, 회색 = 카톡 자리 미리), 폰 시트·PC 겹침, 빈/실패 문구 | src/TabSearch.view.tsx(새, 표시만) |
| 구현 구현서 A | 탭→표 매핑(3-1), 결과 병합·정렬·요약 줄 순수 로직, misu_visits 등 추가 SourceDef, 테스트 | src/tabSearch.ts(새), tests/tabSearch.test.ts(새), src/entity360.ts gather 선택 인자 1개 |
| 구현 구현서 B | 상태·조회 연결(후보 → buildEntity → gather only), 디바운스·2자 미만 무조회·요청 번호로 늦은 결과 버림, App.tsx 진입 | src/TabSearch.tsx(새), src/App.tsx(+2) |
| qa-checker 검수아 | build·test, 통합 검색 360 무회귀(gather 인자 없을 때 동일), 탭 12개 × 대상 표, 폰 360px, 칭찬 탭 숨김 | 읽기만 |

### 2단계 — 카톡 과거 적재(A) · SQL 1장 · 샘플 TXT 받은 뒤
| 역할 | 할 일 | 파일 |
|---|---|---|
| db-schema 표다빈 | kakao_messages·kakao_collect_rooms·kakao_import_log·kakao_search_log, 가림 트리거, trgm 인덱스, 보관 cron, anon insert-only 실측, 시드(방 약 25개), 되돌리기 | supabase/kakao-messages.sql(새) |
| sql-review 권한나 | anon SELECT 없음, 기존 표 무변경, 되돌리기 | 읽기만 |
| 구현 구현서 C | 파서 TS(Kakao.gs 3형식 + 시:분 + 파일 머리 + 안드로이드/아이폰/PC fixture) | supabase/functions/_shared/kakao-parse.ts(새), tests/kakaoParse.test.ts, tests/fixtures/kakao-*.txt(가린 샘플) |
| 구현 구현서 D | 엣지 kakao-ingest(조각·방 판정·dedup insert·import_log), kakao-search(키 묶음 검색·±30분 문맥·R1 제한·검색 기록) | supabase/functions/kakao-ingest/, supabase/functions/kakao-search/ |
| 구현 구현서 E | 노트북 kakao_import·kakao_daily_check 시계 작업, 폴더 생성, VERSION | tools/worker/kakao_import.py(새), tools/worker/worker.py(scheduled 2줄), tools/worker/README.md |
| 구현 구현서 B(이어서) | 타임라인에 카톡 줄 합치기, 관리 탭 "카톡 수집 현황"·[TXT 올리기]·수집 방 켜기 | src/TabSearch.tsx, src/kakaoHistory.ts(새), src/KakaoCollectAdmin.tsx(새), src/SystemAdmin.tsx 진입 1줄 |
| qa-checker | 같은 파일 두 번 적재 = 증가 0, 주민번호 가림, anon select 거부, 노트북 꺼진 상태 앱 업로드, 스위치 꺼짐 = FIELD 만 | 읽기만 |

### 3단계 — 봇 실시간(B) · SQL 0(2단계 표 사용)
| 역할 | 할 일 | 파일 |
|---|---|---|
| 구현 | ⑩ 수집 큐·재시도·상한 | gas-and-bot/supabase-outbox-poller.js, gas-and-bot 의 poller-harness 시나리오 |
| kakao-pc-rules 방지훈 | 스레드 규칙(onMessage 통신 금지)·⑧⑨ 무회귀 | 읽기만 |
| qa-checker | harness 통과, 1주 시험(테스트 전용방 + 1~2개 방) → 하루 글 수·용량 실측으로 3-4 교체 | 읽기만 |

---

## 7. 위험·열린 질문

### 위험
- **R1 읽기 차단의 실제 강도.** anon SELECT 를 막아도 kakao-search 엣지는 anon 키로 누구나 부를 수 있다(SSO 서버 검증 없음 — 2-3). 그래서 함수가 ① 키 묶음 필수(이름 키 3자 이상 또는 기번 4자 이상 — "전체 목록" 불가) ② 한 번 100줄·문맥 ±5글 ③ IP 당 분당 30회 ④ kakao_search_log(앱이 보낸 작성자 이름·검색 키·줄 수) ⑤ 관리 탭 스위치 KAKAO_SEARCH_ENABLED(기본 꺼짐). **업체 이름을 아는 사람이 하나씩 긁는 것은 막지 못한다.** 완전한 차단은 SSO 2단계(서버 검증 세션) 이후 — 그 전에 켤지 = D2.
- **R2 개인정보.** 업무방에도 고객 이름·전화·주소, 개인 고객 주민번호, 직원 사적 대화가 섞인다. 수집 목적·보관 기간·열람 범위 결정과 직원 고지(D5)가 먼저. 대표·법무 판단 [확인 필요].
- **R3 봇폰 단일 장애점 증가**, 비공식 자동화의 카카오 제재 위험(이미 봇을 쓰므로 새 위험은 아님) [웹].
- **R4 오매칭.** 짧은 업체명("한빛"·"대성")은 다른 글에 섞인다 → "이름 일부 일치" 기본 접힘, 정확 = 3자 이상 전체 키 일치.
- **R5 중복.** 봇 시각(받은 시각)과 내보내기 시각(분)이 분 경계에서 어긋나면 같은 글이 두 줄 → 화면에서 같은 방·같은 사람·같은 본문 ±2분은 한 줄로 접는다(저장은 둘 다).
- **R6 내보내기 형식 차이**(PC/안드로이드/아이폰/버전) — 샘플 없이는 파서 확정 불가.
- **R7 노트북에 원문 파일이 남음** → done 7일 뒤 삭제, 백업 제외(D9).
- **R8 1단계 조회량.** 탭 검색 1회 = 2~4개 표 × (정확·원문·느슨) 최대 12요청. 통합 검색 360(약 30표)보다 가볍지만 원문 ilike 가 느린 표(jeomgeom·as_records)는 기존처럼 실패해도 정확 결과는 유지(rawSkipped).

### 열린 결정 (팀장 제안값 — 사용자 답은 한 번에)
| # | 질문 | 팀장 제안값 |
|---|---|---|
| D1 | 어느 방까지 수집? | 3-1 표의 업무방(약 25개)만. 잡담방·개인방·고객방 제외, 추가는 관리 탭에서 켜기 |
| D2 | SSO 2단계 전에 카톡 검색을 켤까? | 적재는 진행, **검색 스위치는 직원 고지(D5) 뒤 켬**. R1 제한 5가지 필수 |
| D3 | 보관 기간 | **3년**(임대 계약 기간과 맞춤 — "언제 납품됐지"가 계약 단위 질문). 법무가 더 짧게 하라면 따름 |
| D4 | 가릴 것 | 주민번호·카드번호만 자동 가림, 전화·주소는 그대로 |
| D5 | 직원 고지 | "업무 카톡방 글을 회사 시스템에 저장·검색한다(목적·기간·열람 범위)"를 팀장 명의로 1회 공지 |
| D6 | 누가 읽나 | 지금: FIELD 쓰는 CS팀 전원(현 권한 체계상 이것뿐). SSO 2단계 뒤 "팀장 + 본인 팀 방" |
| D7 | 통합이력(🗂️)과 합칠까 | 1단계는 따로(탭 검색 = 그 탭 종류만), 써 본 뒤 결정 |
| D8 | 과거분 내보내기는 누가·어디서 | 방마다 가장 오래 있던 사람 폰에서, 드라이브 폴더로. 1회 약 1시간(25방) [추정] |
| D9 | 노트북 02:30 백업에 kakao_messages 포함? | 제외(Supabase 자체 백업만) |
| D10 | 청정기 탭 거르는 기준 | 구현 때 AirSearch 기준 확인, 못 거르면 점검·AS 와 같은 결과 |

### 사용자에게 받을 것
1. **카톡 "대화 내보내기" TXT 샘플** — 안드로이드 1개, (있으면) 아이폰 1개, PC 1개. 아무 업무방 1~2일치, 이름·번호는 지워도 됨. **파일 첫 5줄은 지우지 말 것**(방 이름·저장 날짜).
2. 폰 메뉴 이름(채팅방 메뉴 → "대화 내보내기"/"대화 내용 내보내기") — 안내문을 그 이름으로 쓴다.
3. 노트북(D6110)에 구글 드라이브 동기화가 있는지(없으면 메일·USB 안내).
4. D1~D10 답("제안대로"면 그대로 진행).
5. 봇 계정이 3-1 표의 방에 모두 있는지 — 특히 "영업확장성미션 : …"·"신)담당자/명의/주소변경등 특이사항"(봇이 보내는 방이라 있을 것으로 추정).

---

## 8. 하지 않을 것 (범위 밖)
- 노트북이 카톡 PC 메뉴를 눌러 **자동 내보내기** — 5-1(채팅방 나가기 오클릭·검증 안 된 좌표).
- 사진·동영상·파일 수집(자리 글만 표시).
- 카톡 글을 AI 로 점검·AS 행으로 바꿔 기존 표에 넣기(Kakao.gs AI 추출 경로는 건드리지 않음 — 원문은 원문으로만).
- 넣을 때 업체를 미리 맞춰 저장(3-3 — 찾을 때 맞춘다).
- 실시간 화면 구독(Realtime).
- 개인방·잡담방·고객 1:1 방.
- 통합 검색 360(조회 탭)·entity-ask 에 카톡 연결 — 다음 단계(같은 kakao-search 를 쓰면 됨).
- 건수·순위 집계에 카톡 글 넣기.
- room_map 컬럼 변경, Kakao.gs 수정, VendorSearch·UnifiedHistory 수정.
