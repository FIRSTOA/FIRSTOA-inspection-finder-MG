# 카톡 수집 근접 중복 = "고친 글" 판정과 처리

작성: 기획실 한설계 · 2026-10-27 · 조사·설계만(코드 0, SQL 0)
근거: 사용자 요구(2026-10-27) "앱에 올렸는데 내용을 잘못 적어서 사람이 카톡에 다시 올린 경우가 있다. 올린 지 얼마 안 돼 바로 올린 것, 글자가 일부만 다르고 다 비슷하면 그런 경우다."
읽은 것: docs/tasks/kakao-collect-expand.md(3-2·3-3·3-5·부록 B), docs/tasks/tab-search-kakao-history.md 3-2, apps-script/first-data/src/ Kakao.gs·Drive.gs·Logistics.gs·CollectRules.gs·Config.gs·Supabase.gs·WebApp.gs, src/inspectParser.ts·src/api.ts·src/KakaoCollectAdmin.tsx·src/kakaoCollectApi.ts, supabase/kakao-messages-20261024.sql·rls-hardening.sql·schema-snapshot-20261019.sql.
표기: [사실] 코드에서 확인 · [추정] · [확인 필요]

---

## 1. 목표와 쓰는 사람
**카톡에서 "방금 올린 글을 고쳐 다시 올린 것"을 새 기록으로 세지 않는다. 앞 글이 카톡 수집분이면 그 기록을 고친 글로 바꾸고, 앞 글이 FIELD 앱 기록이면 덮지도 새로 넣지도 않고 관리자 확인 대기로 돌린다.**
- 실제 판정은 GAS 수집(1시간마다)이 사람 손 없이 한다.
- 확인 대기는 CS 관리자·팀장이 PC 관리 탭 › [카톡 수집] 카드에서 처리한다.
- 현장 기사는 바뀌는 것이 없다. 조회·탭 검색에서 같은 건이 두 줄로 안 보이게 될 뿐이다.

## 2. 조사에서 확인한 것 [사실] — 팀장 판단 ①②③ 보정 포함
| # | 사실 | 근거 | 설계 영향 |
|---|---|---|---|
| N1 | 앱이 저장한 점검·AS 행의 `_출처`는 **`카톡:웹앱`** 이다("카톡:"으로 시작하지만 앱 기록). 카톡 수집분은 `카톡:점검(A)`·`카톡:AS(B)`. 다른 양식은 `웹앱:물류`·`웹앱:불만` 처럼 쓴다 | src/inspectParser.ts SRC_LABEL, src/api.ts:1032·1070, Kakao.gs:155 | **앱 기록 판정 = `_출처` 가 `카톡:웹앱` 이거나 `웹앱:` 으로 시작.** 이걸 놓치면 앱 기록을 카톡분으로 알고 덮어 버린다 |
| N2 | 팀장 ③ 보정: 점검·AS 의 **기록 키는 msgHash 가 아니라 `_dupKey` = md5(업체명 + 표시 칸 21개 값)** 이다. msgHash_(방+날짜+작성자+본문)는 "이미 읽은 글" 지문(`_kakao_seen`)일 뿐. 결론은 같다 — 한 글자만 달라도 키가 달라 2건 | Config.gs:306 dupKey_, Drive.gs:311 | 근접 판정은 키와 별도로 해야 한다 |
| N3 | 팀장 ② 보정: 물류 ±1일 규칙은 **`웹앱*` 출처 행하고만** 비교한다. 그래서 (가) 카톡→카톡 고침 = 두 글 다 들어감(2건 — 틀린 글만 남는 게 아님) (나) 앱→카톡 고침 = **고친 글이 조용히 버려지고 틀린 앱 기록만 남음**(로그엔 skippedNear 숫자만) | Logistics.gs:145~174 | 물류 ±1일 결과를 "조용히 버림" 대신 확인 대기로 |
| N4 | 팀장 ① 그대로: 봇(`Ai법인폰`) 글은 구조 적재에서 빠지고 사람 글은 새 기록이 된다 → 앱 기록 + 사람 고친 글 = 2건 | Drive.gs:310, Kakao.gs:79 | 사람 글을 앞의 봇 글·앱 기록과 이어 봐야 한다 |
| N5 | `parseKakaoMessages_` 는 **시:분을 버린다**(3형식 모두 시각을 캡처하지 않음). 결과는 `{date, author, text}` 뿐 | Kakao.gs:1116~1168 | 메시지 객체에 `time` 하나 추가. **msgHash_ 는 건드리지 않는다**(바꾸면 `_kakao_seen` 지문 전체가 무효 → 전 파일 재처리) |
| N6 | 드라이브 파일은 매번 **처음부터 끝까지** 파싱하고 이미 본 글은 지문으로 건너뛴다. 즉 오늘 새 글 M 을 처리할 때 **어제 처리한 앞 글 P 도 같은 messages 배열 안에 있다** | Drive.gs:231·291~334 | 앞 글을 DB 가 아니라 **같은 파일 안에서** 찾는다(시각도 같이) |
| N7 | `kakao_import_log` 에는 사유 칸이 없다. status 는 check(ok·partial·error), 쓰기는 엣지 kakao-ingest(service role)만, anon 은 select 만 | supabase/kakao-messages-20261024.sql:51~67 | **재사용 불가**(바꾸려면 SQL). 확인 대기는 GAS 숨김 시트로(SQL 0) |
| N8 | 관리 카드의 "확인필요"는 **확인필요 폴더의 파일 수**(방 이름 못 맞춘 파일)다. 기록 단위 확인 상태는 없다 | CollectRules.gs summarizeCollectStatus_, KakaoCollectAdmin.tsx:187~ | 새 묶음 "수정 확인 n" 을 따로 둔다. 기존 "확인필요" 숫자와 섞지 않는다 |
| N9 | jeomgeom·as_records 에 `_edit_log jsonb` 가 있고 조회 상세가 `{at, by, changes:{칸:[옛값,새값]}}` 를 보여 준다. anon 은 일부 열만 update 가능(_dupKey·내용·작성일 불가) | supabase/rls-hardening.sql:71~80, DataLookup.tsx:611 | 고친 글 반영은 GAS `supabaseWriteKey_()`(스크립트 속성 SUPABASE_SERVICE_KEY)로 PATCH, 이력은 `_edit_log` 에 한 줄 |
| N10 | logistics_records 에는 `_hidden` 3종은 있으나 `_edit_log` 는 스냅샷에 없다 [확인 필요 — MCP 로 열 목록] | schema-snapshot-20261019.sql:910~913 | 물류는 이력을 `_kakao_review` 시트에만 남긴다 |
| N11 | 점검·AS 는 마스터 시트 탭에도 같이 쓰고, 다음 회차 "있는 키" 판정을 그 시트(`loadDupKeys_`)로 한다 | Kakao.gs:149~190 | Supabase 행을 바꾸면 **시트 행도 같이** 바꿔야 다음 회차에 고친 글이 또 들어가지 않는다 |
| N12 | kakao_messages 는 가린 본문 해시로 dedup → 틀린 글·고친 글은 원문 보관에 **이미 둘 다 남는다**. supersedes 열은 없다 | kakao-messages-20261024.sql:76~94 | 원문 쪽은 손대지 않는다(열 추가는 SQL 이라 Q5) |
| N13 | 발송 시간 규칙: 실제 방은 22~08시 발송 보류 → 밤에 앱 저장한 글은 **다음 날 아침에 봇이 올린다** | AGENTS 2026-10-27 새벽 3 기록 | 시간 기준은 앱 `_등록시각` 하나로는 부족 — **방에 봇 글이 올라간 시각**도 같이 본다 |

## 3. 핵심 설계

### 3-1. 근접 중복 = "수정" 판정 규칙 (순수 함수, GAS 새 파일 NearDup.gs)
1단계 본체는 **양식 글(점검·AS·물류 라벨형)**. AI 방(불만·재계약·미수)은 3-5 의 축소판만.

**후보 짝 (P = 앞 글, M = 뒤 글)** — 아래를 모두 만족해야 짝이다.
1. 같은 방, 같은 처리 종류(kind). E 겸용 방은 점검 차례·AS 차례를 따로 본다.
2. 시간 차 `M.abs − P.abs` 가 **0 이상 N분 이하**(제안 N = 30). `abs = 날짜 일수 × 1440 + 시 × 60 + 분` 이라 **자정 넘김(23:50 → 00:10 = 20분)이 저절로 된다**. 시각을 못 읽은 글은 짝을 만들지 않는다(= 별건, 지금 동작).
3. 업체 키 같음: `vendorMatchKey`(GAS 사본 = Logistics.gs `logisticsVendorKey_` 를 NearDup.gs 공용 `vendorKey_` 로 옮김). 키가 빈 이름(기호뿐)은 원래 이름이 똑같을 때만.
4. 작성자 같음: 양식의 `작성자:` 값(없으면 카톡 대화명에서 `님` 뗀 것). **P 가 봇 글이면** P 의 `작성자:` 라벨 값과 비교(봇 대화명이 아니라 앱에서 고른 작성자).
5. **기기 식별 충돌 없음**(3-1-1).
6. 본문 유사
   - 라벨형: 같은 파서로 두 글을 칸으로 나눈 뒤 칸마다 비교(앞뒤 공백·연속 공백 정리, 영문 소문자). **바뀐 칸 수 ≤ 2** **그리고** 값만 이어 붙인 글(라벨 빼고)의 겹침 **≥ 0.8**. 비교한 칸(둘 중 하나라도 값 있는 칸)이 4개 미만이면 짝 아님(거의 빈 양식).
     - 라벨까지 넣고 재면 양식 틀 때문에 아무 두 양식이나 0.8 을 넘는다 → **값만** 잰다.
   - 자유 글: 공백·기호 빼고 소문자 → **글자 2개 묶음(bigram) 겹침 = 2 × 공통 ÷ (A 개수 + B 개수)**(다중집합, 해시 한 번이라 GAS 에서 글 수천 개도 가볍다) **≥ 0.8**. 정규화 뒤 20자 미만 글은 짝 아님("네 알겠습니다" 연타 방지).

**3-1-1. 기기 식별 규칙 (오판으로 진짜 두 건을 합치지 않게)**
| 경우 | 판정 |
|---|---|
| 점검·AS: P·M 둘 다 시리얼(또는 자산기번)이 있고 **같다** | 같은 기기 → 수정 후보 |
| 한쪽만 비었고 다른 쪽이 채움(고친 글이 시리얼을 더함) | 같은 기기 → 수정 후보(바뀐 칸 1로 셈) |
| 둘 다 있고 **다르다**(한 글자 차이도) | **별건**. 같은 업체 연속 시리얼(…1234/…1235) 2대 AS 가 흔해 오타 고침과 구별할 수 없다. 대신 확인 대기 "식별자만 다른 비슷한 글"(넣기는 둘 다) |
| 시리얼·자산기번이 둘 다 **비었다** | 자동 수정 안 함. 둘 다 넣고 확인 대기 "식별자 없는 비슷한 글" |
| 물류: `구분` 다름(교체 = 철수 + 납품 두 글) | **별건**, 확인 대기도 안 함 |
| 물류: `구분` 같고 `품목` 같음(또는 한쪽 빈칸) | 수정 후보 |
| 물류: `구분` 같고 `품목` 다름 | 별건 + 확인 대기 |

**3-1-2. 사슬(세 번 이상)**: 짝을 앞에서부터 이어 사슬을 만든다(고리마다 **바로 앞 글**과 N분 이내). 사슬 전체 길이는 120분까지(끝없이 이어지는 것 방지). **사슬의 마지막 글만 기록이 되고 나머지는 "덮인 글"**. 사슬은 매번 파일 전체 messages 로 다시 계산하므로 같은 파일을 다시 돌려도 결과가 같다(지문 초기화 `seenreset` 뒤에도 덮인 글은 다시 안 들어감).

### 3-2. 판정 결과별 처리
| P(앞 글) | 조건 | 처리 |
|---|---|---|
| 사람 글, 그 기록이 **카톡 수집분**(`_출처` 가 `카톡:` 으로 시작하고 `카톡:웹앱` 아님) | 수정 판정 | **(a) 같은 행을 고친 글로 바꾼다** |
| 봇 글(= 앱이 올린 글), 또는 P 로 찾은 행의 `_출처` 가 앱(N1) | 수정 판정 | **(b) 앱 기록 그대로, M 은 넣지 않음, 확인 대기 1줄** |
| 파일 안에 P 없음, 그런데 앱 출처 행 중 `_등록시각` 이 M 앞 N분 이내 + 조건 3~6 | 수정 판정 | (b) 와 같음 — 봇 발송(밤 보류)보다 사람이 먼저 올린 경우 |
| 3-1-1 에서 확인 대기로 떨어진 것 | — | 둘 다 넣고 확인 대기 1줄(합칠지는 관리자) |
| 그 밖 | — | 지금 동작 그대로(별건) |

**(a) 카톡 수집분 갱신 — 점검·AS**
1. P 의 키 = 같은 파서·같은 dupKey_ 로 다시 계산(결정적). 그 키로 Supabase 행을 찾는다. 못 찾으면(파서가 그사이 바뀐 경우) `작성일` = P 날짜 · `_출처` 카톡분 · `_원문` = P 본문으로 한 번 더(그 날짜 행을 읽어 메모리에서 비교). 그래도 없으면 M 을 그냥 넣는다(지금 동작).
2. **M 키가 이미 표에 있으면**(재실행) 아무것도 안 한다.
3. PATCH `?_dupKey=eq.<P키>`: 표시 칸 전부 = M 값, `_원문` = M 본문, `_dupKey` = M 키, `_등록시각` = 지금, `_edit_log` += `{at, by:"카톡 고친 글", changes:{바뀐 칸:[P값, M값]}, from_dupKey:P키, msg_at:"YYYY-MM-DD HH:mm"}`. 키는 `supabaseWriteKey_()`.
4. 마스터 시트 탭에서 `_dupKey` 열이 P 키인 행을 찾아 같은 값으로 덮는다(N11).
5. `_kakao_review` 에 `state=auto` 한 줄(자동 반영 기록 = 되돌릴 근거, 3-4).
6. **실패하면** M 을 새 행으로 넣고(유실보다 중복이 낫다) 확인 대기 `자동 수정 실패 → 별건으로 넣음`.
- 물류: 같은 순서, 표는 logistics_records 만(시트 없음). `_edit_log` 열이 없으면(N10) 3번에서 그 칸만 뺀다.
- (c) 세 번 이상: 사슬 마지막 글로 위 1~6. 이미 M 으로 바뀐 행이 다음 회차에 R 로 또 바뀌는 것도 같은 경로(앞 키 = M 키).

**(b) 앱 기록과 겹칠 때 — 덮지 않음·넣지 않음**
- `_kakao_review` 에 `state=open` 한 줄: 방·종류·업체·앱 행 키·앱 `_등록시각`·봇 글 시각·M 시각·M 작성자·바뀐 칸 목록(최대 5, 옛값→새값 각 60자)·M 본문 앞 300자·M 키.
- M 의 지문은 `_kakao_seen` 에 **넣는다**(다음 회차에 같은 확인 대기가 또 생기지 않게). 확인 대기 줄은 M 키로 중복 방지.
- 앱 행 조회가 실패하면(네트워크): 점검·AS 는 지금 동작(넣기) + `_upload_log` 상태 `검토: 앱 기록 조회 실패`. 물류는 지금처럼 그 회차 물류 적재를 멈춘다(Logistics.gs 기존 규칙 — 방어 없이 넣지 않음).

### 3-3. 시각과 봇 글 잇기
- `parseKakaoMessages_` 3형식 모두 `(오전|오후)? H:MM` 을 캡처해 **`time: 'HH:mm'`(24시간)** 를 메시지에 더한다. 규칙은 엣지 `_shared/kakao-parse.ts` 와 같게: 오후 1~11시 → +12, **오전 12:xx → 00:xx**, 오후 12:xx → 12:xx, 오전/오후 표시 없으면 그대로.
- **표에 분 단위 시각을 새로 저장하지 않는다**(SQL 0). 필요한 시각은 모두 같은 파일 안에 있고(N6), 원문 보관 kakao_messages.sent_at 이 이미 분 단위, 앱 행은 `_등록시각`(초)이 있다.
- 봇 글 ↔ 앱 기록 잇기: 봇 글 본문을 같은 파서로 읽어 키를 만들면 **앱 `_dupKey` 와 같다**(앱도 같은 식 — src/inspectParser.ts dupKey). 밤 보류로 날짜가 넘어가 작성일이 달라지면 키가 어긋날 수 있다 → 그때는 (업체 키·구분·작성자 같음 + 앱 `_등록시각` 이 봇 글 앞 14시간 이내)로 잇는다.
- 앱 행 읽기: 이번 회차 새 양식 글 날짜의 최소~최대 ±1일, `_출처=eq.카톡:웹앱`(점검·AS) / `_출처=like.웹앱*`(물류), 필요한 열만(표시 칸·`_업체명`·`_출처`·`_등록시각`·`_dupKey`). 회차당 표마다 1번.

### 3-4. 확인 대기 저장소 — GAS 숨김 시트 `_kakao_review` (SQL 0)
열 13개(narrowSheet_ 로 그 열만): `id`(M 키) · `ts`(판정 시각) · `state`(open·auto·applied·separate·kept·undone·failed) · `room` · `kind` · `table` · `vendor` · `prev_key` · `prev_src`(app·kakao) · `times`("앱 10/27 14:02 · 봇 14:03 · 고친 글 14:09") · `diff`(JSON 바뀐 칸) · `text`(M 본문 앞 300자) · `resolved_by`.
- 같은 id 가 있으면 새 줄을 만들지 않는다. 180일 지난 닫힌 줄은 정리(시트 셀 한도 사고 교훈).
- `_upload_log` 에는 회차마다 종류별 한 줄만: 상태 `검토: 고친 글 자동 반영 n · 확인 대기 n`. **상태가 `확인필요`·`실패` 로 시작하지 않게** 해서 방별 held 셈(collectLogKind_)을 건드리지 않는다.
- 관리 카드 머리 한 줄: `collectstatus` 응답에 `review_open`(숫자만 — 토큰 없는 공개 읽기라 본문은 싣지 않음).
- 목록·처리(본문이 들어 있으므로 **토큰 필요**): GAS `nearduplist`(open 최근 50 + auto 최근 20), `neardupresolve(id, choice)`. 두 동작을 CollectRules.gs `ADMIN_TOKEN_ACTIONS` 와 엣지 gas-admin 허용 목록에 더한다.
  - `apply`: 앱 기록을 고친 글로 바꿈(3-2 (a) 3·4 와 같은 PATCH, `_edit_log.by = "카톡 고친 글(관리자 확인)"`).
  - `separate`: M 을 새 행으로 넣음(지금 동작과 같음).
  - `keep`: 아무것도 안 하고 닫음.
  - `undo`(auto 줄만): `_edit_log` 마지막 줄의 옛 값으로 되돌리고 P 키 복원(시트도). 되돌린 뒤 M 은 별건으로 넣을지 묻지 않고 넣는다(둘 다 남김).

### 3-5. AI 방(불만·재계약·미수)은 축소판
- 같은 회차 안 사슬: `kakaoEnqueue` 가 대기열에 넣기 **전**에 사슬을 계산해 **마지막 글만** AI 로 보낸다(AI 비용도 준다). 덮인 글은 지문만 남긴다.
- 봇 글 바로 뒤 사람 고친 글(자유 글 겹침 ≥ 0.8 · 같은 작성자 라벨 · N분 이내): AI 로 보내지 않고 확인 대기 1줄(`table` = 그 종류 표).
  - 봇 글은 지금 `filterKakaoMessages_` 에서 먼저 빠지므로 사슬 계산은 **그 필터 앞** messages 로 한다.
  - 자유 글에는 업체 칸이 없다 → 조건 3(업체 키)은 AI 방에서 빼고, 대신 겹침 기준을 0.8 그대로 + 20자 이상으로 지킨다.
- 어제 이미 AI 로 들어간 글 뒤에 고친 글이 오면: 자동 갱신하지 않는다(AI 결과 키를 다시 만들 수 없음). 고친 글은 지금처럼 들어가고 확인 대기 1줄 — 단추는 1단계에서 `keep` 만, 앞 기록 숨기기는 다음 단계.

## 4. 화면 흐름 (관리자 PC, 관리 탭 › 전송·연동 › [카톡 수집])
1. 머리 한 줄 끝에 `· 수정 확인 3`(0 이면 안 보임). 기존 `확인필요 n`(파일)과 다른 색·다른 말.
2. 누르면 카드 아래 [수정 확인] 묶음이 펼쳐진다(엣지 gas-admin → nearduplist).
3. 줄마다: 방 · 종류 칩 · 업체 · 시각 줄("앱 14:02 → 고친 글 14:09, 7분") · 바뀐 칸(옛값 취소선 → 새값) 최대 3개 + [더 보기].
4. 단추 셋: [고친 글로 바꾸기] [따로 넣기] [그대로 두기]. 누르면 확인창 1번 → 결과 토스트 → 줄이 사라진다.
5. 묶음 아래 접힌 "자동 반영 최근 20" — 같은 줄 모양, 단추는 [되돌리기] 하나.
6. 폰 폭에서는 줄이 카드로 접히고 단추는 아래 한 줄(관리 탭은 주로 PC 지만 깨지지 않게).

## 5. 함수 계약 (구현서 A·B 동시 작업용)
GAS NearDup.gs (순수 함수 — tests 가 .gs 를 그대로 읽는 방식, tests/gasCollect.test.ts 와 같게):
- `kakaoTime24_(ampm, h, m) → 'HH:mm'` · `kakaoAbsMin_(date, time) → number 또는 null`
- `vendorKey_(name) → string` (logisticsVendorKey_ 이사 — Logistics.gs 는 이 이름을 부르게 1줄)
- `bigramDice_(a, b) → 0~1` (정규화 포함, 20자 미만이면 0)
- `formDiff_(kind, fieldsA, fieldsB) → {changed:[칸], compared:n, valueDice, id:'same'|'added'|'differ'|'blank'}`
- `nearDupChains_(messages, opts) → [{idx:[메시지 번호…], last, kind, reason}]` — opts = {kind, windowMin:30, spanMin:120, parse(text)→칸 객체 또는 null, isBot(author)}
- `decideNearDup_(chain, ctx) → {action:'update'|'review'|'insert'|'skip', prevIdx, review}` — ctx = {appRows, findRowByKey}

GAS 부르는 쪽:
- `applyNearDupForms_(cat, route, allMessages, freshIdx) → {skipIdx, updates, reviews}` — Drive.gs `ingestFormsResumable_` 가 첫 배치 전에 한 번 부르고, skipIdx 는 추출에서 뺀다(지문은 남김).
- `nearDupUpdateRow_(table, prevKey, newRow, diff) → {ok, error}` (service key PATCH + 시트 행 덮기)
- `reviewAppend_(entry)` · `reviewList_(limit)` · `reviewResolve_(id, choice, who)` · `reviewOpenCount_()`
- WebApp.gs: `collectstatus` 에 `review_open`, 새 action `nearduplist`·`neardupresolve`(토큰).

엣지 gas-admin: 허용 목록 `ingestnow, retryheld, kakaoclear, nearduplist, neardupresolve`. neardupresolve 는 `id`(32자 hex)·`choice`(apply·separate·keep·undo)만 통과, 그 밖은 400.

앱 src/kakaoCollectApi.ts: `type NearDupItem = {id, state, room, kind, table, vendor, prevSrc:'app'|'kakao', times, diff:{col, old, new}[], text}` · `loadNearDups()` · `resolveNearDup(id, choice)`.

## 6. 작업 분해 (파일이 겹치지 않게)
| 단계 | 누가 | 할 일 | 파일 | 크기 |
|---|---|---|---|---|
| 0 | 팀장 | MCP 로 logistics_records 에 `_edit_log` 열 있는지, GAS 스크립트 속성 SUPABASE_SERVICE_KEY 존재 확인 | 읽기만 | 5분 |
| 1 | 구현서 A (GAS, opus 권장 — 오판 비용이 큼) | 3-1~3-5 전부: NearDup.gs(새) 순수 함수 + `_kakao_review` 시트 함수, Kakao.gs `parseKakaoMessages_` time 추가(msgHash_ 무변경)·`kakaoEnqueue` 사슬 필터, Drive.gs `ingestFormsResumable_` 에 applyNearDupForms_ 연결, Logistics.gs ±1일 결과를 "조용히 버림" → 확인 대기 + 사슬 적용·vendorKey_ 이사, CollectRules.gs ADMIN_TOKEN_ACTIONS 2개, WebApp.gs collectstatus review_open·두 action, 7절 표본 테스트 + 기존 gasLogistics·gasCollect 통과 | apps-script/first-data/src/NearDup.gs(새)·Kakao.gs·Drive.gs·Logistics.gs·CollectRules.gs·WebApp.gs, tests/gasNearDup.test.ts(새) | L — GAS 약 400줄 + 테스트 25개 안팎 |
| 1 | 구현서 B (앱·엣지) | gas-admin 허용 목록 2개·choice 검사, 카드에 [수정 확인] 묶음(머리 한 줄 숫자·목록·단추 3·되돌리기·확인창). GAS 가 아직 옛 버전이면(동작 모름 응답) 묶음 숨김 | supabase/functions/_shared/gas-admin.ts, supabase/functions/gas-admin/index.ts(허용 목록 쓰는 곳만), src/kakaoCollectApi.ts, src/KakaoNearDupPanel.tsx(새), src/KakaoCollectAdmin.tsx(묶음 끼우기 2~3줄), tests/kakaoNearDup.test.ts(새 — 응답 → 표시 변환) | M |
| 2 | 방지훈 kakao-pc-rules | gas-and-bot·tools/kakao-pc 는 안 건드리지만 GAS 수집 경로가 바뀌므로 수집 규칙 검토 | 읽기만 | |
| 3 | 검수아 qa-checker | build·test, 7절 표본, 같은 파일 두 번 = 변화 0, `seenreset` 뒤 재처리 = 행 수 그대로, 토큰 없는 nearduplist 403, collectstatus 에 본문 없음 | 읽기만 | |
| 4 | 팀장 | GAS clasp push·새 버전(같은 배포 ID) → 엣지 gas-admin 재배포 → 앱 배포. 순서가 틀려도 묶음이 숨겨질 뿐 | — | |
- 윤화면 ui-designer: 기존 카드 줄 모양을 재사용하므로 생략 가능. 사용자 "디자인은 항상 목업" 규칙상 묶음 모양을 새로 보여 줘야 한다고 팀장이 보면 구현서 B 전에 목업 1장.
- 표다빈 db-schema: 불필요(SQL 0). Q5 가 "예"면 그때 표다빈 + 권한나.
- 매뉴얼: docs/manual/user/14-admin.md(카톡 수집 카드 › 수정 확인), docs/manual/ops/08-google-sheets.md(`_kakao_review` 시트·자동 반영 규칙·되돌리기), docs/manual/ops/10-troubleshooting.md("고친 글이 안 들어가요" 항목).

## 7. 테스트 표본 (tests/gasNearDup.test.ts)
| # | 표본 | 기대 |
|---|---|---|
| T1 앱→카톡 고침 | 봇 `Ai법인폰` 14:03 점검 양식(업체 ㈜가나다, 시리얼 ABC123, 매수 1200) + 앱 행(`카톡:웹앱`, `_등록시각` 14:02) / 14:09 사람(작성자 라벨 같음) 같은 양식에 매수 1250 | M 넣지 않음, review open 1줄(prev_src app, diff 매수 1200→1250), 앱 행 무변경 |
| T2 카톡→카톡 고침 | 사람 10:00 AS 양식 내용 "급지불량" / 10:12 같은 사람 내용 "급지 불량, 롤러 교체" | 행 1개, `_dupKey`=M 키·`_원문`=M, `_edit_log` 1줄, review auto 1줄 |
| T3 30분 넘음 | T2 와 같은 두 글, 10:00 / 10:31 | 별건 2행 |
| T4 업체 다름 | 10:00 가나다상사 / 10:05 가나다물산(키 다름), 나머지 같음 | 별건 2행 |
| T5 라벨 2칸 변경 | 점검 양식에서 토너잔량·특이사항 2칸만 바뀜, 7분 차 | 수정(T2 처리). 3칸 바뀌면 별건 |
| T6 자유 글 0.8 | 불만 방 같은 작성자 40자 글, 한 문장 고침(겹침 0.86) 5분 차 | 대기열에 마지막 글만. 겹침 0.6 이면 둘 다 |
| T7 기기 2대 | 같은 업체·같은 작성자 AS 2글 4분 차, 시리얼 …1234 / …1235 | 별건 2행 + review open("식별자만 다름") |
| T8 자정 넘김 | 23:52 / 00:07(다음 날 날짜 띠) | 15분 → 수정 |
| T9 사슬 3 | 10:00 → 10:10 → 10:25 | 마지막(10:25) 1행. 재실행·지문 초기화 뒤에도 1행 |
| T10 시각 파싱 | `[홍길동] [오전 12:05]`→00:05, `2026. 10. 27. 오후 12:30, 홍 : …`→12:30, `2026년 10월 27일 오후 3:12, 홍 : …`→15:12. msgHash_ 결과는 고치기 전과 같음 | |
| T11 물류 교체 | 같은 업체 철수 10:00 / 납품 10:03 | 별건 2행, review 없음 |

## 8. 위험
- R1 **오판으로 진짜 두 건을 합침** — 가장 큰 위험. 막는 장치: 작성자 같음, 기기 식별 규칙(3-1-1 — 다르면 별건, 둘 다 없으면 자동 금지), 값만 잰 겹침 + 바뀐 칸 수 이중 조건, 자동 반영은 전부 `_kakao_review` auto 줄 + `_edit_log` 로 [되돌리기] 가능.
- R2 **같은 기기를 30분 안에 같은 종류로 두 번 올림**(점검 직후 같은 기기 재점검 등) — 수정으로 합쳐진다. 드물다고 보고 [되돌리기]로 대응 [추정].
- R3 파서가 바뀌면 P 키를 다시 만들어도 표 행과 안 맞는다 → `_원문` 대조로 한 번 더 찾고, 그래도 없으면 지금 동작(넣기).
- R4 GAS 6분 한도: 사슬 계산은 양식 글만, 업체 키로 묶은 뒤 같은 묶음 안에서만 비교 → 가볍다. 앱 행 조회는 회차당 표마다 1번.
- R5 확인 대기가 쌓이고 아무도 안 본다 → 그동안 앱 기록(틀린 값)만 남는다. 지금(2건)보다 나쁘지 않지만 머리 한 줄 숫자로 드러내고 2주 뒤 자동 반영 여부를 다시 정한다(Q2).
- R6 봇 대화명 설정이 틀리면 봇 글이 사람 글로 보인다 → P 로 찾은 행의 `_출처` 가 앱이면 (b)로 가게 3-2 첫 두 줄에서 출처로 한 번 더 막는다(앱 기록을 자동으로 덮는 일은 없음).
- R7 원문 보관(kakao_messages)·탭 검색 카톡 대화에는 틀린 글·고친 글이 둘 다 보인다. 정상 — 원문은 원문(Q5).
- R8 드라이브 파일이 방 전체가 아니라 일부 기간만 담기면(PC 재로그인 뒤, kakao-collect-expand F10) 파일 맨 앞 글의 P 가 파일 밖에 있을 수 있다 → 그 경우는 앱 행 `_등록시각` 기준(3-2 셋째 줄)만 작동, 카톡→카톡은 2건으로 남는다.

## 9. 사용자에게 받을 것 (한 번에)
| # | 질문 | 제안값 |
|---|---|---|
| Q1 | "바로 다시 올린 것"의 시간 한도 | 30분(고리마다 앞 글 기준), 사슬 전체 2시간 |
| Q2 | 앱 기록과 겹친 고친 글: 확인 대기로 둘지, 처음부터 앱 기록을 자동으로 고칠지 | 확인 대기로 시작 → 2주 뒤 대기 건수·[고친 글로 바꾸기] 비율을 보고 자동 전환 결정 |
| Q3 | 다른 사람이 고쳐 올린 글(예: 팀장이 대신 정정) | 별건으로 넣되 같은 조건이면 확인 대기 |
| Q4 | 시리얼·자산기번이 둘 다 빈 비슷한 두 글 | 자동으로 합치지 않고 둘 다 넣은 뒤 확인 대기 |
| Q5 | 원문 보관(kakao_messages)에 "고친 글이 덮은 앞 글" 표시 열을 더할까(SQL 1장) | 안 함 — 구조 기록만 고친다 |
| Q6 | [수정 확인] 단추를 누를 수 있는 사람 | 관리 탭에 들어오는 사람 전부(지금 관리 탭 권한 그대로) |
| Q7 | 앱에서 두 번 저장한 경우(앱→앱)도 같은 규칙으로 볼까 | 이번 범위 밖, 따로 조사 |

## 10. 하지 않을 것
- SQL·표·열 변경(kakao_import_log·kakao_messages 포함), 이미 2건으로 들어간 과거분 일괄 정리.
- 앱 기록을 묻지 않고 덮어쓰기(Q2 결정 전).
- FIELD 앱 화면에 "방금 보낸 글 고치기" 기능 — 근본 해결이지만 별건.
- 앱→앱 이중 저장(Q7), AI 방 어제분 자동 갱신·숨기기(3-5 마지막 줄).
- 봇·노트북(gas-and-bot/*, tools/kakao-pc/*) 변경, 발송 규칙 변경.
- 탭 검색 카톡 대화 목록에서 덮인 글 흐리게 보이기(Q5 뒤).
