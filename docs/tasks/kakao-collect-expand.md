# 카톡 수집 확장 — 물류·불만·미수·재계약 + E방 + 매크로 제한 + 원문 보존

작성: 기획실 한설계 · 2026-10-24 · 조사·설계만(코드 0)
근거: docs/tasks/kakao-ingest-status-2026-10-24.md(감시연 현황), docs/tasks/tab-search-kakao-history.md(탭 검색 2단계), apps-script/first-data/src/(Drive.gs·Kakao.gs·Config.gs·WebApp.gs·Supabase.gs·Master.gs·WebappSave.gs), tools/kakao-pc/export_rooms.py, tools/worker/worker.py, Supabase REST 읽기 실측(10/24 오후).
표기: [사실] 코드·실측 · [추정] · [확인 필요]

---

## 1. 목표와 쓰는 사람
**업무 카톡방(점검·AS·물류·불만·미수·재계약, E 포함) 글이 매일 자동으로 FIELD 표와 원문 보관함에 들어와, 카톡방을 위로 넘겨 보지 않아도 조회·탭 검색에서 보이게 한다.**
- 쓰는 사람: CS 관리자·팀장(PC — 관리 탭 수집 카드, 조회 탭), 현장 기사(폰 — 탭 검색 결과만). 수집은 노트북 매크로 → 드라이브 → GAS/엣지가 자동으로 한다.
- 사용자 결정(10/24): 대상은 점검·AS + 물류·불만·미수·재계약(+초과조정), E방 포함. 매크로 켜기·아침 요약은 대기.

## 2. 조사에서 새로 확인한 것 [사실]
| # | 사실 | 근거 | 설계 영향 |
|---|---|---|---|
| F1 | Supabase room_map(발송용, PK category+region)에는 E방이 이미 두 줄씩 있다: "충청외E 극지방 as" = AS/E **와** 점검/E, "충청외극지방 E/초과사용 계약종료체크" = 재계약/E **와** 초과조정/E. 물류 행은 없다(발송은 코드 고정 `FIXED_ROOM.logistics = "완료방(납품,철수,교체)"`, src/api.ts:770) | REST 실측 26행 | 겸용 방은 "방 1개 = 처리 여러 개"로 나타내야 함 |
| F2 | GAS `_room_map`은 방 이름이 키라 방 하나에 분류 하나뿐이다(WebApp.gs:252 setRoomMapRow_). E 겸용 방을 나타낼 수 없다 | 코드 | 수집 매핑을 새 표로 |
| F3 | 매크로에는 `--category` 옵션이 이미 있다. 그런데 실행기 job_kakao_export 가 옵션 없이 부른다 → room_map 전체(마감·부품·자가 포함)를 저장 → 그 파일은 GAS에서 "확인필요"로 빠진다 | export_rooms.py:524, worker.py:82 | 매크로 대상도 새 표에서 |
| F4 | **미수 카톡분은 밤 미러에서 지워지지 않는다.** Master.gs:35 가 마스터 "미수" 탭의 `카톡*` 행을 보존해 시트 행과 같이 다시 넣는다(카톡:미수 8,086/8,294행). 지워지는 것은 FIELD 앱이 Supabase에 바로 넣은 `웹앱:미수` 행이다(→ misu_visits 로 해결 중). 남은 문제는 밤마다 id 가 새로 바뀌고 `_hidden` 이 풀리는 것(mirror_hidden SQL 10/22 초안 — 실행 여부 확인 필요)과 적재 뒤 최대 하루 늦게 보이는 것 | Master.gs:29~141, Supabase.gs:26 | 미수는 경로 유지 + 즉시 적재만 추가 |
| F5 | 물류 표 logistics_records 79행은 전부 `웹앱:물류`(07-27~10-23). FIELD 물류 양식은 라벨형(`작성자:`·`구분:`·`거래처명(지점/현장명 必) :`·`품목:`…, src/logistics.ts:7). 앱 `_dupKey` = md5(작성일·작성자·구분·거래처명·품목·수량·특이사항을 세로줄로 이음), src/md5.ts 는 GAS MD5 와 바이트까지 같다 | REST·코드 | 라벨형은 규칙 파서로 같은 키를 계산할 수 있음 |
| F6 | FIELD 가 보낸 불만·재계약·초과조정·미수·물류·점검·AS 글은 **봇 계정이 방에 올린다** → 카톡 수집이 그 글을 다시 뽑으면 앱 저장분과 두 번 들어간다(AI 추출이라 `_dupKey`도 다름). 점검 표에 봇 공유 글 약 20행이 섞인 것도 같은 원인 | api.ts sendCategoryForm, 감시연 #5 | **봇이 쓴 글은 구조 적재에서 건너뜀**(원문 보관은 함) |
| F7 | 날짜 표기 혼재 실측: bulman 날짜 `2025-04-02`·`2024-06-26 00:00:00`·`2024. 7. 12`·ISO Z / recontract 계약종료일 `26-11-15`·`26.12.26`·`26,11,30`·`26년10월22일`(앱 입력분도) / overage_adjust 방문일 `2026년 6월 10일`·`26-06-12 금요일`·`6월 19일` / misu 입력일 `2025.12.10`·`2026. 3. 10.` | REST 1,000행 표본 | 쓸 때 정규화 + 읽을 때 정규화 함수 하나 |
| F8 | 카톡 증분 키 msgHash_ 는 날짜만 쓴다(시:분 없음). 원문 보관 표는 없다(kakao_messages·kakao_collect_rooms·kakao_import_log 모두 404) | Kakao.gs:525, REST | tab-search 3-2 그대로 + 보완 |
| F9 | GAS 수집 트리거는 매일 07시, 매크로는 06:30~08:00 → 07시 넘어 저장된 파일은 하루 늦게 적재된다 | Drive.gs:23, worker.py:36 | 트리거를 1시간마다로(기존 함수 setDriveIngestInterval) |
| F10 | 노트북 PC 카톡은 10/21 재로그인 → PC 저장 파일에는 그 뒤 대화만 있을 것이다 [추정]. 드라이브 수집은 9/9 이후 0건 → **9/10~10/21 은 폰 내보내기 1회로만 메울 수 있다** | 감시연 결론 2, tab-search 5-1 | 사용자에게 받을 것 Q5 |

## 3. 핵심 설계

### 3-1. 수집 매핑을 하나로 — 권장: 새 표 `kakao_collect_rooms` (room_map 에 열을 더하지 않음)
| | A. room_map 에 `collect` 열 추가 | **B. 새 표 kakao_collect_rooms (권장)** |
|---|---|---|
| 겸용 방 | 행이 (종류,지역) 단위라 E방이 이미 두 줄 → 표현은 됨 | `kinds text[]` 로 한 줄에 {점검,AS} |
| 물류 | 물류 행을 더해야 하는데 **발송 경로가 그 행을 먼저 집는다**(api.ts:475 — 물류/전체 키가 있으면 FIXED_ROOM 보다 우선) — 이름 오타 하나가 물류 발송을 깬다 | 발송과 무관 |
| 규칙 | AGENTS 규칙 2(기존 표 컬럼 변경 금지) 위반. 봇·앱·매크로 3곳이 같은 표를 읽음 | 새 표 + RLS, 기존 표 무변경 |
| 단점 | — | 방 이름을 두 표에 적는다(발송·수집). 관리 탭 [발송 매핑에서 불러오기] 단추로 덜어 준다 |

**kakao_collect_rooms**: `room text pk` · `kinds text[] not null`(점검·AS·물류·불만·미수·재계약 중에서, 재계약이면 초과조정 캡처는 자동) · `region text`(A~E·AB·CD·*) · `enabled bool`(전체 끄기) · `export bool`(노트북 매크로 대상) · `structured bool`(GAS 양식/AI 적재) · `keep_raw bool`(원문 보관) · `note` · `updated_at`·`updated_by`. 시드는 부록 A(20방 + 물류 자리).
- 읽는 곳 3곳: **GAS getRoomMap()**(Supabase REST 읽기, 실패하면 `_room_map` 시트로 대신), **export_rooms.py load_rooms()**(export=true 만), **kakao-ingest**(keep_raw=true 만). `_room_map` 시트는 비상용으로 남기고 관리 탭 편집은 새 표로 한다.
- 봇 대화명은 `app_config.KAKAO_BOT_NICKS`(쉼표 목록, 기본 "Ai법인폰" — Q3 확인 필요).

### 3-2. GAS 처리 규칙 (Drive.gs ingestFromDriveFolder)
1. 방 이름 → kakao_collect_rooms 한 줄. 없거나 enabled=false 면 지금처럼 "확인필요"(원문도 넣지 않음).
2. `kinds` 를 차례로 돈다: 점검 → inspectform, AS → asform, 물류 → logisticsform(새로), 불만·미수·재계약 → AI 대기열. **E 겸용 방은 같은 글이 inspectform·asform 을 두 번** 지난다 — 각 파서가 `구분`으로 거르고(isInspectForm_/isASForm_), 지문 집합도 `점검|E`·`AS|E` 로 따로라 서로 막지 않는다. `구분: AS,점검` 글은 **두 표 모두**에 들어간다(FIELD 앱 저장 WebappSave.gs:56~89 와 같은 동작).
3. **봇 글 건너뛰기**: 작성자가 KAKAO_BOT_NICKS 에 있으면 구조 적재를 하지 않는다(F6). 원문 보관은 한다(is_bot=true).
4. keep_raw=true 면 같은 텍스트를 엣지 kakao-ingest 로 넘긴다(3-5).
5. 실행이 끝날 때마다 스크립트 속성 `kakao_last_ingest`(시각·파일 수·확인필요 수)를 저장 → 관리 카드가 읽음.
6. 트리거는 1시간마다(F9).

### 3-3. 물류 — 라벨형은 규칙 파서 먼저, 자유 글 AI 는 측정한 뒤
- 판정 [사실 F5]: FIELD 가 올리는 물류 글은 라벨형이다. 방에 사람이 직접 쓰는 글(자유 글 비율)은 **샘플이 없어 모른다** → 원문 보관(3-5)을 먼저 켜고 1주 뒤 SQL 로 "라벨형 vs 자유 글" 수를 세어 AI 여부를 정한다(Q8).
- 라벨형 판정: `구분:` 줄과 `거래처명…:` 줄이 둘 다 있는 글(점검·AS 양식은 `업체명`이라 겹치지 않음). 칸: 작성자(라벨 없으면 카톡 작성자)·구분·거래처명·품목·수량·소모품·셋팅여부·이메일카운터·한조·상태체크·여분토너·특이사항(빈 줄·사진 모아보기 줄 앞까지). 작성일 = 글 날짜.
- 적재: **Supabase logistics_records 에만**(마스터 시트 탭을 새로 만들지 않음 — 2026-08-27 셀 한도 사고). `_출처 = 카톡:물류`, `_원문`, `_업체명`, `_dupKey` = 앱과 **같은 식**(F5) → 같은 글이면 on_conflict 로 무시.
- 중복 이중 방어: 넣기 전에 그 날짜 ±1일 logistics_records(작은 표)를 읽어 **(구분 같음, 업체 키 vendorMatchKey 같음, 날짜 차 1일 이하)** 면 건너뛴다. ±1일은 밤에 쓴 글이 다음 날 아침에 발송되는 경우(발송 시간 규칙) 때문.
- 네이버 일정과 대조("누락 보완")는 이번 범위 밖 — 탭 검색 물류 탭이 이미 일정 + 기록을 합쳐 보여 준다(AGENTS 10/24 2차 ①). 대조 화면은 다음 단계.

### 3-4. 불만·미수·재계약
- 불만·재계약(+초과조정): 지금 경로(AI → 마스터 탭 + Supabase 증분)를 유지한다. 더하는 것은 봇 글 건너뛰기(3-2 ③)와 E 재계약 방 매핑.
- 미수: **misu 에 직접 넣지 않는다.** 마스터 "미수" 탭 경로가 밤 미러에서 카톡분을 지켜 주는 장치다(F4). 바꾸는 것 둘: ① `SUPABASE_TABLE` 에 미수 → misu 추가 → 적재 즉시 Supabase 에도 넣음(밤 전체 교체 때 같은 행이 다시 들어가므로 중복 없음, `_dupKey` unique) ② mirror_hidden SQL(10/22) 실행 여부를 확인해 안 됐으면 이 묶음에 포함. E 미수방은 이름을 받은 뒤(Q2).
- **날짜 정규화**: (a) 쓸 때 — GAS `normYmd_()` 를 `_dupKey` 계산 **뒤에** 적용(지역 정규화와 같은 자리, Kakao.gs:131~134 — 앞에서 하면 옛 키와 어긋나 재업로드 때 전부 중복). 대상 칸: 불만 날짜·방문일, 재계약 계약종료일·다음확인일, 초과조정 방문일, 미수 입력일·입금약속일. 못 읽으면 원래 글 그대로. (b) 읽을 때 — src/recontract/api.ts normalizeYmd 를 넓힌 공용 `src/dateNorm.ts`(`2026. 3. 10.`·`26년10월22일`·`26,11,30`·`6월 19일`(연도는 _등록시각에서)·`Wed Mar 25 2026`·ISO Z → KST). (c) 옛 데이터 일괄 UPDATE 는 **기본으로 하지 않는다**(Q7).

### 3-5. 원문 보존 — tab-search 3-2 를 그대로 쓰고 5곳 보완
tab-search-kakao-history.md 3-2(kakao_messages·kakao_import_log·trgm·dedup·3년 보관·백업 제외), 3-3(찾을 때 업체 매칭), 7절 R1(kakao-search 제한 5가지)을 그대로 쓴다. 보완:
1. `room_kind text` → **`kinds text[]`**(겸용 방). 넣을 때 kakao_collect_rooms 에서 복사한다.
2. **넣기는 엣지 kakao-ingest(service role)만** — anon 권한은 0(INSERT 도 없음). 원안의 "anon insert-only + on_conflict 실측" 문제가 사라진다. GAS 는 헤더 `x-ingest-token`(Supabase 시크릿 KAKAO_INGEST_TOKEN 과 GAS 스크립트 속성에 같은 값)으로 부른다.
3. **`guess text`(분류 추정)** — 넣을 때 정규식만 쓴다: form:점검·form:AS·form:물류·form:불만접수·form:계약갱신·form:미수방문·form:초과조정·share(봇 공유)·media(사진 자리)·chat. 관리 카드 숫자와 물류 자유 글 비율 측정(Q8)에 쓴다. AI 없음.
4. **시:분 파서** `_shared/kakao-parse.ts`(Kakao.gs 3형식 + `[오후 3:24]` 12시간제 → 24시간, `오전 12:xx` = 00시). dedup = md5(방 + KST `yyyy-mm-dd HH:mm` + 작성자 + 본문 앞 500자 정규화 + `#n`(같은 분·같은 글의 n번째)) — "네" 연타가 한 줄로 합쳐지지 않게.
5. **증분 전송**: GAS 가 kakao_import_log 에서 그 방의 마지막 `to_at` 하루 전 날짜 띠부터만 잘라 500KB 조각(날짜 띠 경계)으로 보낸다 → 매일 전체 저장 파일(수 MB)을 통째로 보내지 않고, 엣지 CPU 한도 안에 든다. 첫 회만 전체.
- **가림(넣기 전, 엣지 + DB 트리거 이중)**: 주민번호는 `_shared/privacy.ts` maskRrn 규칙 그대로(하이픈형은 항상, 붙은 13자리는 "주민" 이름표가 있을 때만 — 시리얼 오가림 방지), 카드번호 16자리, 계좌는 "계좌" 이름표 뒤 숫자. **휴대폰은 가운데 4자리 가림 `010-****-5678`(제안, Q6)** — 원문 검색의 키는 업체·기번이라 전화 원번호가 필요 없고, 연락처 원본은 거래처 표에 있다. `masked int`(가린 개수) 열.
- kakao-search: tab-search 3-3 그대로 + kinds 겹침 조건. 스위치 KAKAO_SEARCH_ENABLED 는 기본 꺼짐(직원 고지 뒤 켬).

### 3-6. 관리 탭 [카톡 수집] 카드
머리 한 줄: "마지막 적재 10/25 07:12 · 확인필요 2 · 오늘 들어온 방 14/20". 방별 줄(kakao_collect_rooms 순서): 방 · 처리 칩(점검/AS…) · **구조 적재 최근일**(GAS uploadlog 의 방별 마지막) · **원문 최근 글**(kakao_import_log.to_at) · 상태(오늘·어제 = 정상, 2~3영업일 = 노랑, 4영업일 이상 = 빨강, export=false 면 회색). 확인필요는 adminstatus 에 `drive.held`(개수)·`heldNames`(최대 10)를 더해 보여 준다. 편집: 방 추가·kinds 칩·export/structured/keep_raw 토글·[발송 매핑에서 불러오기]. 옛 "카톡 수집 방 매핑(GAS)" 칸은 이 카드로 바꾼다.

### 3-7. GAS GET 의 무인증 쓰기 막기
- 스크립트 속성 `FIELD_ADMIN_TOKEN`. 속성이 없으면 **거부**(잠긴 쪽으로 실패).
- 토큰이 필요한 동작: ingestnow·retryheld·kakaoclear·celltrim(행·열 삭제)·dedupe(행 삭제)·seenreset·cursorreset·roommapset·roommapdel·rebuildindex·indexfinalize·indexonly·photoarchive·**contactpeek**(아무 시트 ID 나 넣으면 머리글과 5행을 돌려줌 — 읽기지만 유출 통로).
- 그대로 두는 것(읽기·앱 공개): ping·search·detail·inspforms·adminstatus·uploadlog·cursorlist·cellreport·lastruns·roommap·booksearch·bookresolve·reportview·quizgen/quizbank·pull/ack(봇)·doPost.
- FIELD 화면은 토큰을 번들에 넣을 수 없다 → 새 엣지 **gas-admin**(토큰은 시크릿에, 허용 목록 ingestnow·retryheld·kakaoclear 만, 분당 5회)을 거쳐 부른다. 위험한 것(celltrim·dedupe·seenreset·cursorreset·rebuildindex)은 엣지 허용 목록에도 넣지 않는다 — 운영자가 GAS 편집기에서. photo-drive-archive 엣지는 토큰을 붙여 부른다.
- 한계: gas-admin 엣지도 anon 키로 부를 수 있다(SSO 서버 검증 없음, tab-search R1 과 같음). 그래도 공개 번들에 박힌 GAS 주소로 누구나 행 삭제를 부르던 구멍은 닫힌다.

### 3-8. 매크로 (export_rooms.py)
- `load_rooms()` 를 room_map → **kakao_collect_rooms(enabled·export=true)** 로 바꾼다. `--category` 는 kinds 와 겹치는지로 거른다. `--from-room-map` 옵션은 옛 동작 비상용.
- 방 20개 × (저장 + 3초)가 8분 상한을 넘을 수 있다 → **어제 성공하지 못한 방·가장 오래된 방 먼저**(state 파일에 방별 마지막 성공일). 키 동작·안전 순서는 그대로(방지훈 확인).
- 켜기(FIRSTOA_KAKAO_EXPORT=1)는 사용자 대기 그대로. 노트북에서 대상 방 창이 열려 있어야 한다(열린 창만 저장).

## 4. 화면 흐름 (관리자 PC)
1. 관리 탭 › 전송·연동 › [카톡 수집] 칩.
2. 머리 한 줄에서 빨강·노랑을 본다 → 방 줄을 누르면 최근 수집 기록 5줄(uploadlog·import_log).
3. 확인필요가 있으면 [확인필요 n] → 방 이름 목록 → 이름이 다르면 [이 이름으로 추가](kinds 고름) → [다시 넣기](retryheld, gas-admin 경유).
4. 새 물류 방: [방 추가] → 이름 붙여 넣기 → 물류 칩 → 저장. 다음 날 매크로가 저장하고 GAS 가 적재한다.
5. 결과: 조회 탭 물류 표에 `카톡:물류` 행, 탭 검색에 카톡 원문 줄(스위치를 켠 뒤).

## 5. 작업 분해 (파일이 겹치지 않게)
| 단계 | 누가 | 할 일 | 파일 |
|---|---|---|---|
| 0 | 사용자(노트북) | `--probe` → 한 방 `--export --rooms` → 파일 첫 줄 확인. 폰에서 방마다 1회 내보내기(9/10~10/21 공백) | — |
| 1 | 표다빈 db-schema | kakao_collect_rooms(+시드, RLS: anon select·insert·update, delete 없음), kakao_messages·kakao_import_log·kakao_search_log(3-5 보완, kakao_messages 는 anon 권한 0, 가림 트리거, trgm, 03:40 보관 cron), logistics_records `_dupKey` unique 여부 MCP 확인(없으면 생성 — 앱 insertRow 의 "기존 기록" 판정이 이미 이것을 기대함), mirror_hidden 실행 여부 확인, 되돌리기 | supabase/kakao-collect-rooms-YYYYMMDD.sql, supabase/kakao-messages-YYYYMMDD.sql |
| 1 | 권한나 sql-review → /sql-handoff | 기존 표 무변경·anon 범위·되돌리기 | 읽기만 |
| 2 | 구현서 A (GAS 라우팅·보안) | getRoomMap Supabase 읽기 + 시트 대체, kinds 반복(E 두 번), 봇 글 건너뛰기, 토큰 검사, adminstatus held·heldNames·kakao_last_ingest, 트리거 1시간. **부르기만**: `ingestLogisticsForms_`(B), `kakaoRawForward_`(C), `normYmd_`(B) | WebApp.gs, Drive.gs, Kakao.gs(appendKakaoRecords_ 정규화 한 자리·봇 필터) |
| 2 | 구현서 B (GAS 물류·미수·날짜) | 물류 라벨 파서·앱과 같은 `_dupKey`·±1일 중복 방어·Supabase 단독 insert, normYmd_, SUPABASE_TABLE 미수 1줄 | Logistics.gs(새), DateNorm.gs(새), Supabase.gs(1줄) |
| 2 | 구현서 C (원문 보존) | `_shared/kakao-parse.ts`(+가린 fixture 테스트), 엣지 kakao-ingest(토큰·조각·가림·guess·dedup·import_log)·kakao-search(tab-search 3-3·R1), GAS 쪽 전송 함수(증분·500KB 조각) | supabase/functions/_shared/kakao-parse.ts, supabase/functions/kakao-ingest/, supabase/functions/kakao-search/, apps-script/first-data/src/KakaoRaw.gs(새), tests/kakaoParse.test.ts |
| 2 | 구현서 D (매크로) | load_rooms → kakao_collect_rooms, 순서 회전, selftest 보강 | tools/kakao-pc/export_rooms.py, tools/worker/README.md |
| 3 | 윤화면 ui-designer | 수집 카드 표시(머리 한 줄·방 줄·상태 색·폰 카드) | src/KakaoCollectAdmin.view.tsx(새) |
| 3 | 구현서 E (앱) | 카드 상태·편집, gas-admin 엣지, dateNorm 공용(조회 화면 연결은 다음) | src/KakaoCollectAdmin.tsx(새), src/kakaoCollectApi.ts(새), src/dateNorm.ts(새), supabase/functions/gas-admin/(새), src/SystemAdmin.tsx(collect 칩 안 교체 2~3줄), supabase/functions/photo-drive-archive(토큰 1줄) |
| 검사 | 방지훈 kakao-pc-rules | export_rooms.py 단축키·안전 순서 무변경, GAS 수집 경로 변경 검토 — **실패면 푸시하지 않음** | 읽기만 |
| 검사 | 검수아 qa-checker | build·test, 같은 파일 두 번 = 증가 0, E방 `AS,점검` 글 = 두 표 1행씩, 봇 글 0행, 앱 물류 글 재수집 = 0행, 토큰 없는 ingestnow 거부, 주민번호·전화 가림, anon 으로 kakao_messages select/insert 거부 | 읽기만 |

순서: 0·1 병렬 → 2(A·B·C·D 동시, 부록 B 함수 계약만 맞춤) → 3 → 검사 → GAS 새 버전 배포(같은 배포 ID) → 1주 관찰 뒤 물류 AI 결정(Q8).

## 6. 위험·열린 질문
**위험**
- R1 봇 대화명이 틀리면 FIELD 양식이 두 번 들어가거나(덜 거름) 사람 글이 빠진다(더 거름). → 시험방에서 하루 확인한 뒤 켠다.
- R2 PC 저장 파일에 과거분이 없으면(F10) 9/10~10/21 공백은 폰 내보내기 전까지 계속 비어 있다.
- R3 AI 비용: 미수 B·C 는 6월 이후 미적재 → 첫 회 대기열이 크다(gpt-5.4-mini, 40글씩) [추정 수천 글].
- R4 kakao-search 는 업체 이름을 아는 사람이 하나씩 긁는 것을 막지 못한다(tab-search R1). 스위치는 고지 뒤.
- R5 토큰 도입 순서: 스크립트 속성 → GAS 배포 → 엣지 시크릿 → 앱 배포. 순서가 틀리면 관리 탭 [지금 수집]이 잠깐 거부된다(피해는 그것뿐).
- R6 GAS 6분 한도: 원문 전송이 더해진다 → 증분 전송(3-5 ⑤)으로 하루치만 보낸다.

**사용자에게 받을 것 (한 번에)**
| # | 질문 | 제안값 |
|---|---|---|
| Q1 | 물류 방 이름(카톡 방 제목 그대로). "완료방(납품,철수,교체)"가 맞나? 다른 물류 방도 있나? | 완료방 1개로 시작, 받는 대로 관리 탭에 추가 |
| Q2 | E 불만방·E 미수방이 있나? 이름은? | 없으면 E 는 점검·AS 겸용 방과 재계약 방만 |
| Q3 | 봇 대화명(폰 봇·노트북 PC 카톡에 보이는 이름) | "Ai법인폰" 하나(같은 계정이라 추정) |
| Q4 | 노트북 PC 카톡이 대상 20방에 모두 들어가 있고 창으로 열어 둘 수 있나 | 열어 두기(매크로는 열린 창만) |
| Q5 | 9/10~10/21 공백: 방마다 폰에서 1회 내보내기를 해 줄 사람 | 팀별 1명, 드라이브 수신함에 저장 |
| Q6 | 원문 가림: 주민번호·카드 전부, 휴대폰 가운데 4자리 / 보관 3년 / 직원 고지 | 제안대로 |
| Q7 | 옛 데이터 날짜를 일괄로 고칠까(UPDATE) | 안 함 — 새 글은 쓸 때, 옛 글은 화면에서 정규화 |
| Q8 | 물류 자유 글 AI 추출 | 원문을 1주 쌓은 뒤 비율을 보고 결정 |
| Q9 | 관리 탭 [지금 수집]을 엣지 경유로 바꾸는 것 | 승인 |
| Q10 | 미수 즉시 적재(밤 미러를 기다리지 않음) | 승인 |

## 7. 하지 않을 것
- 아침 요약 알림, 매크로 스위치 켜기(사용자 대기).
- 마감·부품·자가·칭찬·담당자변경·확장성·해지방어·경영지원 방 수집.
- 봇 실시간 수집(tab-search 3단계), 카톡 PC 메뉴 클릭 자동화.
- 물류 자유 글 AI 추출(Q8 뒤), 네이버 일정과 물류 대조 화면.
- room_map 열 변경·발송 경로 변경, 옛 날짜 일괄 UPDATE, 점검 표에 이미 섞인 봇 공유 글 약 20행 정리(오류진 별건).
- A~D 방에서 `AS,점검` 글을 두 표에 넣도록 바꾸기(E 만 겸용 처리).
- 탭 검색 화면에 카톡 줄 합치기(tab-search 2단계 구현서 B 몫 — 이 설계는 표·엣지까지).

---

## 부록 A. kakao_collect_rooms 시드 (room_map·GAS 시드·감시연 표 대조)
| 방 | kinds | region | export | 비고 |
|---|---|---|---|---|
| 강북A 점검방 / 강서B 점검방 / 강남C 점검방 / 경기D 점검방 | {점검} | A/B/C/D | O | |
| 강북A as / 강서B as / 강남C as / 경기D as | {AS} | A/B/C/D | O | |
| 충청외E 극지방 as | {점검,AS} | E | O | 겸용 — 두 번 처리 |
| 신)AB불만고객 | {불만} | AB | O | GAS 코드 시드엔 없음(감시연 표엔 있음) |
| 신)CD불만고객방 | {불만} | CD | O | |
| 강북A 미수 보증금미입금 보고방 / 강서B 미수 보증금미입금 보고방 / 강남C 미수 보증금 보고방 / 경기D 미수 보증금 미입금보고방 | {미수} | A/B/C/D | O | |
| 강북A·강서B·강남C·경기D /초과사용 계약종료체크 | {재계약} | A~D | O | 초과조정 자동 캡처 |
| 충청외극지방 E/초과사용 계약종료체크 | {재계약} | E | O | |
| 완료방(납품,철수,교체) | {물류} | * | O | Q1 확인 전에는 enabled=false |
| (물류 방 이름 입력) | {물류} | | | Q1 |
| (E 불만·E 미수 방 이름 입력) | | E | | Q2 |

제외: 강남,지방(수도권C,D,E)일반마감방(마감)·부품요청·자가(토너 폐통) 여분토너요청방.

## 부록 B. 함수 계약 (구현서 A·B·C 동시 작업용)
- `ingestLogisticsForms_(route, text) → {ok, parsed, records, added, skipped}` (B, Logistics.gs) — route = {roomName, kinds, team}.
- `kakaoRawForward_(room, text) → {ok, sent, chunks, error}` (C, KakaoRaw.gs) — 실패해도 throw 하지 않고 구조 적재를 막지 않는다.
- `normYmd_(value, refDate?) → 'YYYY-MM-DD' 또는 원래 글` (B, DateNorm.gs) — `_dupKey` 계산 뒤에만 부른다.
- `isBotAuthor_(author) → bool` (A, Kakao.gs) — app_config KAKAO_BOT_NICKS 10분 캐시.
- 엣지 kakao-ingest 입력 `{room, file_name, chunk_index, chunk_count, text, source: gas-drive 또는 app-upload}`, 헤더 `x-ingest-token`. 출력 `{read, inserted, duplicated, masked, from_at, to_at}`.

## 부록 C. 구현이 끝날 때 고칠 매뉴얼
docs/manual/user/14(관리 탭 카톡 수집 카드), ops/06(노트북 매크로 대상 표), GAS 장(토큰·트리거 1시간), ops/04(DB 새 표 3개), ops/10(개인정보 가림 규칙).
