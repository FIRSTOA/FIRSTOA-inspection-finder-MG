# 예전 워킨맵(workinmap.com) ↔ 웹앱 워킨맵 동기화 — 설계안

2026-10-31 · 기획실 한설계(feature-planner) · 조사만, 코드 0, SQL 0
사용자 원문 요지: 예전에 쓰던 워킨맵(https://www.workinmap.com/work2/6aaa410a66d17921d76c9c65)과 지금 웹앱 워킨맵을 맞추고 싶다. 워킨맵에서 색칠하면 웹앱에도 색칠되고, 내용을 고쳐도 같이 바뀌게. 가능한가?

**결론**: 실시간 양방향은 권하지 않는다. 그 지도 데이터는 **로그인해야만** 읽힌다(실측). 공개 API가 아니라서 서버가 자동으로 읽으려면 사용자의 워킨맵 계정 비밀번호를 우리 서버에 맡겨야 한다.
- **지금 바로, 안전하게 되는 것**: 워킨맵에서 엑셀을 내려받아 웹앱 [엑셀 불러오기]에 넣을 때 **"바뀐 것만 반영"**(색·지도에서 ON/OFF·메모만)하는 방식(방안 C). 계정이 필요 없다.
- **조건이 맞으면 되는 것**: 워킨맵에서 웹앱으로 한 방향, 10~30분마다 자동으로 가져오기(방안 A). 계정을 맡겨야 하고, 그쪽 내부 API가 바뀌면 바로 멈춘다.
- **권하지 않는 것**: 웹앱에서 고친 것을 워킨맵에 다시 써 넣는 양방향(방안 B).

---

## 1. 목표와 쓰는 사람

**한 줄 목표**: 워킨맵 앱(폰)에서 바꾼 색(G 라벨)과 메모가 웹앱 `workin_map_places`의 같은 거래처에 반영되게 한다. 웹앱이 따로 쌓은 것(FIELD 자동 완료 G5, 완료 이력 메모, 거래처 코드 연결)은 잃지 않는다.

| 누가 | 어디서 | 무엇을 |
|---|---|---|
| 현장 기사(예전 습관대로 워킨맵 앱 쓰는 사람) | 폰 워킨맵 앱 | 색칠·메모. 웹앱 쪽은 따로 할 일 없음 |
| 관리자(사용자) | PC 웹앱 워킨맵 | C: 주기적으로 엑셀 받아서 [바뀐 것만 반영]. A: 처음 한 번 짝짓기를 확인하고, 그 뒤엔 결과 알림만 본다 |
| 팀원 전체 | 폰·PC 웹앱 | 반영된 색을 본다. 지금처럼 FIELD 전송으로 G5가 자동으로 바뀌는 것도 그대로 |

---

## 2. 실측(읽기 전용, 2026-10-31)

### 2-1. 그 지도의 데이터가 어떻게 들어오나
| 항목 | 실측 |
|---|---|
| 페이지 | `work2/<id>` HTML은 로그인 없이 200이다. 하지만 이건 빈 껍데기다. 장소 데이터는 들어 있지 않다(`currentWorkId = "6aaa410a66d17921d76c9c65"`만 박혀 있음) |
| 로그인 | Firebase Auth 4.6.2(`workinmap.firebaseapp.com`). 웹 로그인 화면은 `signInWithEmailAndPassword`(이메일+비밀번호)만 쓴다. 로그인이 안 되어 있으면 장소를 읽지 않는다(`authChanged(user)` → user 없으면 아무 일도 안 함) |
| 장소 읽기 | `work2.js getCurrentWork()` → **`GET https://api.solgit.co/api/v2/works/<workId>`** + 헤더 `Authorization: Bearer <Firebase ID 토큰>`. Firebase Realtime DB(`workinmap.firebaseio.com`)는 설정에만 있다. 이 화면 코드는 장소를 거기서 읽지 않는다 |
| **토큰 없이 시도한 결과** | 그 지도 하나만 GET으로 1회 요청했다. HTTP 200에 본문은 `{"error_code":109,"message":"토큰 인증에 실패했습니다.","status":401}`. **결론: 로그인이 필요하다.** 다른 경로·루트·다른 지도는 탐색하지 않았다 |
| 목록 | `GET /api/v2/users/info?nosync=true&type=workList4`(내 워크 목록), `GET /api/v2/users/class`(등급) |
| 쓰기 경로(참고만, 호출 안 함) | 색·숨김 일괄 `PUT /api/v2/places/props {place_list, label_color, hide}`, 숨김 `PUT /api/v2/places/modify`, 사진 포함 수정 `POST /api/v2/places/modify2`(multipart), 추가 `POST /api/v2/places/add2`, 이동 `/api/v2/places/move` |
| 토큰 수명 | 페이지가 1시간마다 `getIdToken()`을 다시 부른다. Firebase ID 토큰은 1시간이 지나면 만료된다 |
| 약관 | `/terms`·`/policy`·`/agreement`는 404다. 자동 접근이나 API 이용 조항은 **확인하지 못했다**. 공개 API 문서도 찾지 못했다 |

### 2-2. 응답 모양(화면 코드가 쓰는 필드에서 추정. 실제 응답은 못 봄)
`work = { _id, name, places: [...] }`. 장소 하나에 쓰이는 필드는 다음과 같다.
- `_id`: 장소 고유 id. **워킨맵 쪽 영구 키**다.
- `name`, `comment`, `number`(전화번호), `address.address`, `address.detail_addr`
- `label_color`: 0~11 숫자. 0 orange, 1 yellow, 2 pink, 3 purple, 4 blue, 5 leaf, 6 lavender, 7 tree, 8 soil, 9 sky, 10 khaki, 11 gray
- `hide`(지도에서 OFF), `error`(주소 오류)
- `memo`(옛 형식, `:::`로 이어 붙임), `memo2: [{content, last_update, edited}]`(메모 한 줄마다 시각이 있다)
- `last_update`(장소 수정 시각. 목록 정렬 기준), `resource_images`(사진)
- 좌표 필드 이름은 화면 코드에서 확인하지 못했다(지도 스크립트 안에 있음)

### 2-3. 엑셀(FileSaver) 경로
- 워크 목록 화면에 "엑셀파일 다운로드"가 있다. 최대 10개 워크를 zip으로 받는다. 로그인이 필요하다.
- 공개 업로드 샘플(`/downloadLink/work_sample_190413.xlsx`, 실측)의 머리줄은 이렇다: **번호 · 라벨 · 지도에서 · 이름 · 코멘트 · 전화번호 · 주소 · 상세주소 · 위도 · 경도 · 메모1~5…**. 라벨은 `G1, G2…` 글자로 적는다("엑셀의 셀 색깔은 인식 못 함").
- 웹앱 `src/WalkingMap.tsx`의 `excelBaseHeaders`(88행)는 이 머리줄과 **열 이름·순서가 똑같다**(전화번호 뒤 공백만 다름. trim해서 같다). 필수 머리 검사(번호·라벨·지도에서·이름·위도·경도)도 그 형식 그대로다. 파일 이름에서 `수도권A`·`3분기`·`매월/재계약`을 읽어 팀·분기·업무를 추정하는 것(2457~2459행)도 워킨맵 워크 이름을 그대로 쓴 흔적이다.
- 그래서 **workin_map_places는 처음부터 워킨맵 엑셀 내려받기 → [엑셀 불러오기]로 채운 것으로 본다.** 이건 코드에서 추정한 것이다. 문서에 "언제 어느 파일로 옮겼다"는 기록은 없다. AGENTS.md·docs에 workinmap.com/solgit 언급은 0건이다.
- **다운로드 파일에 워킨맵 `_id` 열이 있는지는 미확인이다**(샘플은 업로드용이라 없음). 확인하려면 사용자가 받은 파일의 머리줄 한 장이면 된다.

### 2-4. 우리 쪽 모델
| 항목 | 내용 | 위치 |
|---|---|---|
| 표 | `workin_map_places`(id bigint, number, team A~E, quarter 1~4, kind quarter/monthly/renewal, label 기본 G12, visible, name, comment, phone, address, address_detail, latitude, longitude, memos jsonb, updated_by, updated_at = 서버 시각 트리거). RLS는 anon 전권 | `supabase/workin-map-shared.sql` |
| 행 수 | 9/12 감사 때 4,557행. 3분기 3,376곳은 좌표가 없다(10-28 기록) | `docs/walkingmap-audit-2026-09-12.md`, AGENTS.md |
| id | **불러올 때마다 `Date.now()+index`로 새로 만든다**(2470행). 워킨맵 `_id`를 담을 칸이 없다 | `WalkingMap.tsx handleExcelImport` |
| 불러오기 모드 | `replace`(기본: 팀·분기·업무 범위를 통째로 교체) / `append` | `WalkingMap.tsx:1400`, `applyExcelImport` |
| replace의 부작용 | id가 바뀌어서 ① `workin_vendor_code.place_id` 연결이 끊긴다(감사 #25) ② 앱에서 붙인 `[G5 완료] 날짜` 이력 메모가 사라진다 ③ FIELD가 자동으로 바꾼 G5를 엑셀의 옛 색이 덮는다 | `vendor-master.sql:103~`, `WalkingMap.tsx withLabelHistory` |
| 웹앱이 이 표를 쓰는 곳 | 워킨맵 화면 손 편집 / **FIELD 점검방 전송 → G5·매월 G2/G3/G5 자동 + 이력 메모**(`App.tsx` 4239 부근) / 키맨·주소 변경(`ContactChangeHistory.tsx:136`, `ServiceReception.tsx:1395`) / 이관 G12 | |
| 색 대응 | 앱 G1~G12 ↔ 워킨맵 `label_color` 0~11(엑셀 `Gn` = n-1로 추정). G1~G7·G12는 색이 같은 계열이다. **G8~G11은 앱 색 순서(갈색·황토·하늘·짙은초록)와 워킨맵 목록 순서(tree·soil·sky·khaki)가 어긋날 수 있다.** 엑셀 한 행으로 확인이 필요하다 | `WalkingMap.tsx:111~122`, `work2.js:1` |
| 증분 반영 | 화면은 30초마다 `updated_at=gt.` 증분을 받는다. 서버가 행을 고쳐도 트리거가 updated_at을 올려 주므로 **화면 쪽 코드는 손대지 않아도 반영된다** | `WalkingMap.tsx pollSharedPlaces`, `placesSync.ts` |

### 2-5. 짝짓기 키(양쪽 장소를 무엇으로 맞추나)
1. **워킨맵 `_id`**: 가장 확실하다. A는 API 응답에 있으므로 이걸 쓴다. C는 엑셀에 있을 때만 쓸 수 있다.
2. **같은 범위(팀·분기·업무) 안의 `번호` + 이름 정규화가 같은 것**: 우리 `number`는 그 워크 엑셀의 번호를 그대로 받았다. 워킨맵에서 장소를 지우거나 추가하면 번호가 밀릴 수 있어서 이름 확인을 꼭 같이 한다.
3. **이름 정규화(`vendorMatchKey`) + 주소 정규화(`addressGroupKey`)**: 위 둘이 없을 때 쓴다. 같은 건물에 지점이 여럿이면 후보가 2개 이상 나온다. 그때는 자동으로 하지 않고 "확인 필요" 목록으로 보낸다.

---

## 3. 방안 비교

| | A) 워킨맵→앱 한 방향 자동(엣지 크론) | B) 양방향(앱 변경을 워킨맵에 되밀기) | C) 엑셀 받아서 "바뀐 것만 반영" | D) 노트북 실행기가 브라우저로 로그인해서 읽기 |
|---|---|---|---|---|
| 가능? | **기술적으로 가능**(계정이 있을 때). Firebase REST `signInWithPassword`(페이지에 공개된 apiKey 사용) → ID 토큰 → `GET /api/v2/works/<id>` | 기술적으로 가능. 하지만 비추천 | **가능. 지금 바로** | 가능하지만 불안정 |
| 필요한 것 | 워킨맵 계정(이메일·비밀번호)을 Supabase secrets에 등록. 워크 id ↔ (팀·분기·업무) 대응표. `ext_id` 칸 SQL | A 전부 + 쓰기 API 형식 역추적(multipart) | 사용자가 주기적으로 엑셀 다운로드. 앱 코드만(SQL은 선택) | 노트북에 브라우저 자동화(지금 tools/worker에는 playwright 없음), 로그인 세션 유지 |
| 반영 지연 | 10~30분(크론 주기) | 같음 | 사용자가 넣을 때만 | 실행기 주기 |
| 위험 | ① **비공식 API**: 경로·응답이 예고 없이 바뀌면 멈춘다(실패 알림 필수) ② 계정 비밀번호를 우리 서버에 보관 ③ 약관 미확인 ④ 워킨맵 계정 등급(프리 100곳/워크, 프리미엄 1,000곳)과 호출량 ⑤ FIELD 자동 G5와 충돌 → 규칙 필요 | A의 위험 전부 + **남의 서비스에 쓰기**: 잘못 매칭되면 고객 지도 데이터를 망가뜨리고 되돌릴 수 없다. 앱 색 뜻(업무별로 다름)이 워킨맵 한 워크에 섞인다. 두 쪽이 동시에 고치면 무한 왕복 | 사람이 잊으면 늦다. 파일에 `_id`가 없으면 번호·이름으로 맞춰야 해서 오매칭 여지가 있다(미리보기로 막음) | 카톡 PC처럼 화면 자동화는 렉·로그아웃·캡차에 약하다. 노트북 1대에 의존 |
| 공수 | 중(엣지 1개 + SQL 1개 + 대응표 화면 + 미리보기/충돌 목록) 약 2~3일 | 대(A + 되밀기·충돌 해결·재시도) 약 5일 이상 | 소~중(불러오기 모드 1개 + 차이 미리보기) 약 1일 | 중 + 유지 비용이 계속 든다 |
| 판단 | **2단계 후보**(계정 제공과 위험 수락이 있을 때) | **하지 않음** | **1단계 추천** | 하지 않음(A가 되면 D는 필요 없음) |

### 충돌 규칙(A·C 공통)
- **완료 쪽은 내려가지 않는다**: 앱 행이 G5·G12(완료·이관)이고 워킨맵이 완료가 아니면 앱 값을 유지하고 "충돌"로 표시한다. FIELD 전송 G5가 워킨맵의 옛 색에 덮이는 것을 막기 위해서다. 매월점검은 G1<G2<G3<G5 순위에서 올라가는 것만 받는다(`App.tsx`의 `monthlyRank`와 같은 규칙).
- 그 밖의 색은 **워킨맵이 이긴다.** 단, 마지막 동기화 이후 앱에서도 바뀌었으면(updated_at > 지난 동기화 시각, updated_by ≠ 동기화) 자동 반영하지 않고 "확인 필요"로 둔다.
- **메모는 합치기만 한다**: 워킨맵에 새로 생긴 줄은 덧붙이고, 앱에만 있는 줄(`[G5 완료] …`, 키맨 변경 이력)은 지우지 않는다. 워킨맵에서 지운 메모는 앱에서 지우지 않는다.
- **지도에서 ON/OFF(hide)**는 워킨맵이 이긴다.
- **이름·주소·전화·좌표**: 기본은 반영하지 않는다. 앱의 주소 변경 이력과 주민번호 가림 보호(`workinPrivacy.ts`)가 있기 때문이다. 바뀐 것은 목록으로만 보여 준다.
- **워킨맵에만 있는 새 장소**: 자동으로 추가하지 않고 "새 장소 n곳"으로 보여 준다. 사용자가 [추가]를 눌러야 들어간다.
- **워킨맵에서 사라진 장소**: 앱에서 지우지 않고 "워킨맵에 없음"으로 표시만 한다.

---

## 4. 추천안

**1단계 = C "바뀐 것만 반영" 모드(계정 불필요, 지금 가능)**
1. 사용자가 워킨맵 웹 워크 목록에서 해당 워크의 엑셀을 받는다.
2. 웹앱 워킨맵 → [엑셀 불러오기] → 팀·분기·업무는 지금처럼 파일 이름으로 추정한다. 모드는 **[바뀐 것만 반영]**(새 기본값). 지금의 [교체]·[추가]도 남겨 둔다.
3. 미리보기: 짝지은 곳 n / 색 바뀜 n / 메모 추가 n / **충돌 n**(완료가 내려가는 경우 등) / 새 장소 n / 워킨맵에 없음 n / 짝 못 찾음 n.
4. [반영]을 누르면 기존 행의 `label`·`visible`·`memos`만 PATCH한다. **id는 유지**되므로 거래처 코드 연결과 이력이 그대로 남는다. 고친 행은 `updated_by = "워킨맵 엑셀"`.
5. 다른 기기 화면은 30초 증분 폴링으로 반영된다(추가 코드 없음).

**2단계 = A 한 방향 자동(사용자가 계정 제공과 위험을 받아들이면)**
- 엣지 `workinmap-pull`(크론 10~30분, KST 08~20시만)을 만든다. secrets `WORKINMAP_EMAIL`/`WORKINMAP_PASSWORD`로 로그인하고, refresh token은 캐시한다. 대응표 `app_config.WORKINMAP_WORKS = [{workId, team, quarter, kind}]`에 있는 워크만 GET한다. 1단계와 **같은 규칙**(차이 계산·충돌 규칙)으로 PATCH한다.
- 실패(401·형식 변경·0곳 응답)가 나면 **아무것도 쓰지 않고** 관리 탭 상태 + 관리자 알림을 남긴다. 0곳 응답을 "전부 삭제"로 해석하지 않는다.
- 자동으로 넣지 못한 "확인 필요" 목록이 쌓이면 워킨맵 화면에서 처리한다.

**B(되밀기)는 하지 않는다.** 웹앱은 이미 FIELD 자동 완료·이력·거래처 코드가 붙은 원본이다. 양쪽을 다 원본으로 두면 매일 충돌이 난다. 웹앱 상태를 워킨맵에서도 보고 싶다면 웹앱 [현재 목록 내보내기] 엑셀을 워킨맵 [엑셀업로드]로 새 워크에 올리는 수동 경로가 이미 있다(형식이 같다).

---

## 5. 데이터 설계(1단계는 SQL 없이도 가능, 2단계부터 필요)
- `workin_map_places`에 칸 2개를 추가한다(nullable, 기존 행 영향 없음, `add column if not exists`로 재실행 안전).
  - `ext_id text` — 워킨맵 장소 `_id`. 부분 유니크 인덱스(`where ext_id is not null`).
  - `ext_synced_at timestamptz` — 마지막으로 워킨맵에서 반영한 시각. 충돌 판정("그 뒤 앱에서도 바뀌었나")에 쓴다.
- 1단계를 SQL 없이 하면 충돌 판정은 `updated_by`/`updated_at`과 메모 이력만으로 한다(정확도가 조금 떨어진다).
- 대응표는 `app_config` 키 1개(새 표 없음). 동기화 기록은 처음엔 엣지 로그와 관리 탭 표시로 충분하다.
- RLS: 표가 이미 anon 전권이라 새 정책은 없다. 엣지는 service role로 쓴다.

## 6. 화면 흐름(1단계)
1. 워킨맵 → [엑셀 불러오기] → 파일 선택
2. 범위(팀·분기·업무) 확인 + 모드 [바뀐 것만 반영] / [교체] / [추가]
3. 차이 미리보기(숫자 7칸, 펼치면 행별로 "G1→G5", "메모 +1줄", "충돌: 앱 G5 / 워킨맵 G2")
4. 충돌·새 장소·짝 못 찾음은 행마다 체크박스(기본은 체크 해제)
5. [반영] → PATCH(250행씩) → "n곳 반영 · 충돌 n 유지" 토스트

## 7. 작업 분해(서로 겹치지 않게)
| 역할 | 할 일 | 파일 |
|---|---|---|
| 구현(순수 함수) | `diffWorkinImport(existing, incoming, opts)` → {matched, labelChanges, memoAdds, conflicts, newPlaces, missing, unmatched}. 짝짓기 순서(ext_id → 범위+번호+이름 → 이름+주소, 후보 2개 이상이면 unmatched)와 충돌 규칙, `labelFromColorIndex`. 테스트 포함 | 새 `src/workinImportDiff.ts`, 새 `tests/workinImportDiff.test.ts` |
| ui-designer | 불러오기 모달의 모드 3개 + 차이 미리보기 화면(목업 이미지 먼저) | 새 `src/WorkinImportPreview.view.tsx` |
| 구현(연결) | `handleExcelImport`가 `_id` 열이 있으면 읽게 하고, `applyExcelImport`에 "바뀐 것만" 분기 추가(PATCH label·visible·memos만, id 유지) | `src/WalkingMap.tsx`(불러오기 두 함수만) |
| db-schema(2단계) | `ext_id`·`ext_synced_at` 추가 SQL + 머리 주석. sql-review 뒤 /sql-handoff | 새 `supabase/workin-map-ext-id.sql` |
| 구현(2단계) | 엣지 `workinmap-pull`(로그인·토큰 캐시·워크 GET·형식 검사·0곳이면 중단·같은 diff 규칙의 서버 사본) + 관리 탭 대응표 입력 | 새 `supabase/functions/workinmap-pull/`, `src/SystemAdmin.tsx`(설정 1칸) |
| qa-checker | 차이 계산 경계: 완료 하향 차단, 매월 순위, 메모 중복, 같은 건물 2지점, 가린 주민번호 값, 빈 파일, 열 순서가 다른 파일. build·test | 테스트만 |
| 매뉴얼 | user/12 "엑셀 불러오기" 절 갱신, ops/(2단계) 엣지·secrets·실패 대처 | `docs/manual/user/12-walking-map.md`, `docs/manual/ops/` 해당 장 |

App.tsx 0줄.

## 8. 위험·열린 질문
**사용자에게 물을 것(3개)**
1. **지금 워킨맵 앱에서 실제로 색칠·메모를 하는 사람이 있나요?** 있으면 그 사람들이 웹앱으로 옮겨 오는 것과 동기화 중 어느 쪽을 원하나요? 아무도 안 쓰면 마지막 엑셀을 한 번 [바뀐 것만 반영]으로 넣고 끝내는 게 가장 깔끔합니다.
2. **원본은 어느 쪽인가요?** 추천은 "웹앱이 원본, 워킨맵은 들어오는 쪽(한 방향)"입니다. 이 지도(6aaa…)가 어느 팀·분기·업무(분기점검/매월/재계약)인지도 알려 주세요.
3. **2단계 자동 가져오기를 원하면 워킨맵 로그인 계정(이메일·비밀번호)을 Supabase secrets에 직접 넣어 줄 수 있나요?** 비공식 API라서 예고 없이 멈출 수 있습니다. 그쪽 약관도 직접 확인해 주셔야 합니다. 주기는 10분/30분/하루 1회 중 어느 것이 좋은가요?

**위험·확인 필요(우리가 확인할 것)**
- 다운로드 엑셀에 `_id` 열이 있는지: 받은 파일 머리줄 하나로 확인한다. 없으면 번호+이름으로 맞춘다.
- G8~G11의 색 순서가 양쪽에서 같은지: 워킨맵에서 G8~G11을 칠한 장소 하나씩을 엑셀로 받아 비교한다.
- 워킨맵 한 워크는 최대 100곳(프리)/1,000곳(프리미엄)이다(업로드 샘플 안내문). 우리 범위 하나(예: C팀 3분기 분기점검)가 워크 하나와 1:1인지 모른다. 여러 워크를 한 범위로 합쳐야 할 수도 있다.
- 지금의 [교체] 불러오기는 id를 새로 만들어 거래처 코드 연결·완료 이력을 날린다(감사 #25, 기존 문제). 1단계에서 기본 모드를 "바뀐 것만"으로 바꾸면 이 사고도 같이 줄어든다.
- 계정 비밀번호를 서버에 두는 것 자체가 보안 부담이다(유출되면 워킨맵 데이터 전체를 쓸 수 있는 권한). 가능하면 읽기 전용 공유 계정을 따로 만드는 것을 권한다. 그런 기능이 워킨맵에 있는지는 미확인이다.

## 9. 하지 않을 것
- 워킨맵 쪽에 쓰기(방안 B), 로그인 시도, 비밀번호 추측, 다른 워크·루트 경로 탐색
- 노트북 브라우저 자동화(방안 D)
- 이름·주소·전화·좌표 자동 덮어쓰기, 워킨맵에 없다는 이유로 앱 행 삭제
- 사진(`resource_images`) 가져오기
- Firebase Realtime DB 경로 직접 읽기(화면 코드가 쓰지 않음)
- 워킨맵 화면 디자인 변경(불러오기 모달 밖), App.tsx 수정

---

## v2 (2026-10-31 저녁, 사용자 결정 반영)

기획실 한설계 · 조사·설계만(코드 0, SQL 0, 워킨맵 로그인·쓰기 시도 0). v1은 위에 그대로 둔다. **v2가 v1의 "B 하지 않음" 판단을 대체한다.** 사용자가 위험을 알고 양방향을 골랐기 때문이다.

### v2-0. 바뀐 전제(사용자 결정)
| # | 결정 | 설계에 주는 영향 |
|---|---|---|
| 1 | 직원들은 계속 **기존 워킨맵(workinmap.com)에서 색칠한다.** 계약종료 워크는 다른 부서도 쓰므로 옮겨 올 수 없다. 그래서 지금 웹앱의 점검률·계약률이 틀린다 | 현장 기준 원본은 워킨맵이다. 웹앱은 가져오기만 돼도 수치를 맞출 수 있다(v2-E) |
| 2 | **양방향**으로 한다. 대상은 `영업확장성리스트_박P_워킨맵표현`을 뺀 **모든 지역 워크**(분기점검·매월점검·계약종료, 지난 분기 포함). 새 워크도 자동으로 대상에 넣는다 | 대응표를 손으로 만들지 않는다. 워크 이름 규칙으로 자동 해석한다(v2-A3) |
| 3 | 워킨맵 계정(이메일·비밀번호)을 준다 | Supabase secrets에 둔다. 코드·커밋·채팅에는 넣지 않는다 |
| 4 | 워크 목록을 실측했다(아래). 가장 큰 워크가 937곳이라 유료 1,000곳 한도 안이다 | 한도 근접 경고를 둔다(v2-D) |
| 5 | (추가) **계정이 2개다.** 링크 계정에는 C·D 워크가, 다른 계정에는 A·B 워크가 있다. 둘 다 동기화한다 | 계정 N개 구조. 워크마다 소속 계정을 기억하고, 되밀기는 그 계정의 토큰으로 한다 |

### v2-1. 이번 조사에서 새로 확인한 것(공개 정적 JS만 읽음. 2026-10-31)
`/v2/js/work2.js`, `map-min.js`, 페이지 HTML 안의 스크립트를 읽었다. API는 호출하지 않았다.

| 항목 | 실측 | 설계 판단 |
|---|---|---|
| API 주소 | `URL_API_BASE = "https://api.solgit.co"`. 모든 호출에 `Authorization: Bearer <Firebase ID 토큰>`이 붙는다 | v1과 같다 |
| Firebase apiKey | `common.js`에 공개되어 있다(웹 클라이언트 키. 비밀이 아니다) | 엣지는 이 키로 Firebase REST 로그인을 한다. 그래도 코드에 박지 않고 app_config에 둔다(바뀌면 설정만 고치면 됨) |
| **색·숨김 일괄 변경** | `PUT /api/v2/places/props`, JSON 본문 `{ place_list: [placeId…], label_color?: 0~11, hide?: bool }`(`work2.js changePlaceListProp`) | **되밀기의 주 경로.** 바꾸는 필드만 보낸다. 이름·주소·좌표는 건드리지 않는다. 같은 색 여러 곳을 한 번에 보낼 수 있다 |
| 숨김 하나 | `PUT /api/v2/places/modify`, JSON `{ place_id, hide }` | props로 충분하다. 보조로만 쓴다 |
| **장소 전체 수정** | `POST /api/v2/places/modify2`, **multipart** 칸 `data` = JSON 문자열. JSON 내용은 `{ place_id, name, comment, address:{address, detail_addr}, position:{latitude, longitude}, label_color, number, memo2:[{_id?, content}], del_resource_id_list:[] }`(`readPlaceInput`/`savePlaceEdit`. `memo`·`resource_images`는 지우고 보냄. 새 메모 줄은 `_id`를 빼고 보냄) | **장소 전체를 덮어쓰는 방식**이다. 메모 하나를 바꾸려 해도 이름·주소·좌표·전화를 같이 보내야 한다. 그래서 메모 되밀기만 이 경로를 쓴다. 바로 전에 읽은 값을 **한 글자도 바꾸지 않고** 그대로 다시 보내는 "읽고-고치고-쓰기"만 허용한다(v2-C2) |
| 화면 입력 이스케이프 | 웹 화면은 저장 전에 `escapeHTML()`을 한다. 서버에 저장된 값은 이미 이스케이프된 문자열이다 | 되밀 때 다시 이스케이프하지 않는다. 받은 문자열을 그대로 돌려준다. 새 메모 줄만 화면과 같은 규칙(`escapeHTML`, `:::` 제거)으로 만든다 |
| 응답 | 성공하면 `{ok:1, affected_work_list…}`. 실패하면 `error_code`(109 토큰, 221 프리미엄 전용, 332·334 사진 한도) | `ok!==1`이면 실패로 기록한다 |
| **색 순서** | `work2.js` 1~3행: `_colorNameList = [orange, yellow, pink, purple, blue, leaf, lavender, tree, soil, sky, khaki, gray]`, 주석 색값 `#2eb747(leaf) #c078ff(lavender) #825c3d(tree) #c4a075(soil) #00abff(sky) #1e7041(khaki) #383838(gray)` | 앱 `mapLabels`(`WalkingMap.tsx:110~123`)의 G6 `#25b44b`, G7 `#b56ef3`, G8 `#896347`, G9 `#c6a273`, G10 `#139fe4`, G11 `#1f744a`, G12 `#343434`와 **순서대로 같은 계열**이다. 이름(tree=갈색, khaki=짙은 초록)이 헷갈리게 붙었을 뿐이다. 따라서 **`Gn` ↔ `label_color = n-1`** 로 둔다. v1의 G8~G11 우려는 거의 해소됐다. **사용자 팔레트 캡처(2026-10-31 저녁)**: 3열×4행 = 주황·노랑(앰버)·분홍빨강 / 보라·진파랑·초록 / 연보라(라벤더)·갈색·황갈(탄) / 하늘·진초록·진회색. 이 순서가 앱 G1~G12와 같다. 사용자 말로는 "기존 워킨맵 색에는 뜻이 없고, 우리가 정해 쓰던 뜻을 웹앱에 설명처럼 넣은 것"이다. 그래서 `label_color 0~11 = G1~G12`를 **가설로 확정**하고, 구현 dry에서 실제 숫자↔색을 1회 검증한다(P1-3 dry 항목) |

### v2-A. 로그인·토큰·워크 목록

**A1. 계정 보관(계정 N개)**
- Supabase secrets에 **번호를 붙인 키 2벌**로 둔다. `WORKINMAP_1_EMAIL`·`WORKINMAP_1_PASSWORD`(C·D 계정), `WORKINMAP_2_EMAIL`·`WORKINMAP_2_PASSWORD`(A·B 계정). 엣지는 n=1..9를 차례로 읽다가 비어 있으면 멈춘다. 그래서 계정이 하나 더 생겨도 키만 추가하면 된다.
  - JSON 한 칸(`WORKINMAP_ACCOUNTS=[{label,email,password}]`)도 가능하다. 다만 비밀번호에 큰따옴표나 역슬래시가 있으면 대시보드에 넣다가 깨지기 쉽다. 그래서 **번호 키를 권한다.**
- 계정 라벨(화면 표시용, 비밀 아님)은 `app_config.WORKINMAP_ACCOUNT_LABELS = {"1":"CD 계정","2":"AB 계정"}`에 둔다. 비어 있으면 "계정1/계정2"로 보인다.
- **사용자가 직접 등록한다**(대시보드 Edge Functions > Secrets). 우리는 값을 보지도 받지도 않는다. 기존 `FIELD_ADMIN_TOKEN` 관리 방식과 같다.

**A2. 토큰 흐름(계정마다 따로)**
1. 처음: `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<apiKey>` 본문 `{email, password, returnSecureToken:true}` → `idToken`(1시간), `refreshToken`.
2. 그다음 실행: `refreshToken`이 있으면 `POST https://securetoken.googleapis.com/v1/token?key=<apiKey>`(`grant_type=refresh_token`) → 새 `id_token`. 만료 5분 전이면 미리 갱신한다. 비밀번호 로그인은 refresh가 실패했을 때만 한다. 10분 주기로 매번 비밀번호 로그인을 하면 이상 로그인으로 막힐 수 있어서다.
3. `refreshToken`·`idToken`·만료 시각은 새 표 `workin_sync_accounts`(v2-3)에 **계정 번호별로** 캐시한다. 이 표는 **RLS를 켜고 정책을 두지 않는다**(anon 읽기·쓰기 불가, 엣지 service role만 접근). anon 기본 권한이 전권이라는 10-19 감사 지적이 있어서, 표를 만들 때 anon·authenticated 권한 revoke도 같이 한다.
4. API가 `error_code 109`(토큰 인증 실패)를 주면 그 계정만 토큰을 비우고 비밀번호로 1회 재로그인한다. 그래도 실패하면 **그 계정 워크만 이번 회차를 건너뛰고** 상태를 "로그인 실패"로 남긴다. 다른 계정은 계속 진행한다.
5. 비밀번호 로그인이 연속 3회 실패하면(비밀번호 변경, 계정 잠김) 그 계정은 자동 재시도를 멈추고 관리자 알림 1회를 보낸다. 계속 두드려서 잠김이 심해지는 것을 막기 위해서다. 관리 탭에서 [다시 시도]를 누르면 풀린다.

**A3. 워크 목록 → 대상 선정(이름 규칙)**
- 계정마다 `GET /api/v2/users/info?nosync=true&type=workList4` → 워크 `{_id, name, 생성일, 수정일, 장소 수}` 목록. 응답 필드 이름은 dry로 실측한다.
- **이름 해석 규칙**(순수 함수 `parseWorkName(name)` → `{team, year, quarter, kind} | null`). 위에서부터 차례로 적용한다.
  1. 제외 목록에 있으면 → 제외. `app_config.WORKINMAP_EXCLUDE_WORKS`(이름 또는 워크 id 배열, **계정 공통**). 기본값 `["영업확장성리스트_박P_워킨맵표현"]`.
  2. 팀: 정규식 `(수도권|계약종료|재계약)\s*([A-E])` 다음 글자가 `_`·공백·`(`·끝 → A~E. 없으면 해석 불가.
  3. 연도·분기: `(\d{2})\s*년\s*([1-4])\s*분기` → year = 2000+yy, quarter. 없으면 해석 불가. 괄호 안 날짜 `(26.10.26)`은 `년`이 없어서 걸리지 않는다.
  4. 업무: `계약종료|재계약` → `renewal`. 아니면 `매월` → `monthly`. 아니면 `점검` → `quarter`. 셋 다 없으면 해석 불가. `매월점검`이 `점검`보다 먼저 걸리도록 순서를 고정한다. 계약종료 이름의 `(10월,11월,01월)`에는 `매월`이 없어서 안전하다.
  5. **해석 불가 워크는 동기화하지 않는다.** 관리 탭 "해석 못 한 워크" 목록에 보여 준다. 새 워크라도 이름 규칙에 맞을 때만 자동으로 대상이 된다. 엉뚱한 워크가 섞이는 것보다 빠지는 쪽이 안전하다.
- **실측 이름으로 검증**(테스트 고정값으로 넣는다). A·B 계정 워크는 2026-10-31 저녁 사용자가 붙여 넣은 것으로, C·D와 같은 규칙이다. **A·B 계정에는 매월점검 워크가 없다**(매월점검은 C만 있다). 그래서 A·B는 quarter·renewal만 나온다.

| 워크 이름(사용자 붙여넣기) | team | year | quarter | kind | 판정 |
|---|---|---|---|---|---|
| 수도권C_26년4분기점검(26.10.26) | C | 2026 | 4 | quarter | 대상 |
| 계약종료C_26년4분기(10월,11월,01월)(2609… | C | 2026 | 4 | renewal | 대상 |
| 수도권D_26년4분기점검(26.10.26) | D | 2026 | 4 | quarter | 대상 |
| 수도권C_26년4분기매월점검(26.09.29) | C | 2026 | 4 | monthly | 대상 |
| 계약종료D_26년4분기… | D | 2026 | 4 | renewal | 대상 |
| 계약종료C·D 2·3분기, 수도권C·D 3분기점검·매월점검 | C/D | 2026 | 2·3 | 같은 규칙 | 대상(**정확한 이름 실측 필요.** 같은 형식이라고 가정) |
| 영업확장성리스트_박P_워킨맵표현 | — | — | — | — | 제외(제외 목록. 팀 패턴도 없어서 이중으로 걸림) |
| 수도권A_26년4분기점검(26.10.26) — 881곳 | A | 2026 | 4 | quarter | 대상(A·B 계정 실측) |
| 수도권B_26년4분기점검(26.10.26) — 891곳 | B | 2026 | 4 | quarter | 대상 |
| 계약종료B_26년4분기(10월,11월,01월)(2609… — 117곳 | B | 2026 | 4 | renewal | 대상 |
| 계약종료A_26년4분기… — 79곳 | A | 2026 | 4 | renewal | 대상 |
| 수도권B_26년3분기점검(26.08.31) — 876곳 | B | 2026 | 3 | quarter | 대상 |
| 수도권A_26년3분기점검(26.08.31) — 794곳 | A | 2026 | 3 | quarter | 대상 |
| 계약종료A_26년2분기(5월,6월,7월)(260527) — 48곳 | A | 2026 | 2 | renewal | 대상. 괄호 안 `5월,6월,7월`에 `매월`이 없다 |
| 계약종료A_26년3분기(8월,9월,10월)_260527 — 52곳 | A | 2026 | 3 | renewal | 대상. 팀 글자 뒤가 `_`이고, 꼬리 `_260527`은 `년`이 없어서 연도로 읽히지 않는다 |
| 계약종료B_26년3분기… — 33곳 / 계약종료B_26년2분기… — 74곳 | B | 2026 | 3 / 2 | renewal | 대상 |

- **워크 매핑 표**: 엣지가 해석 결과를 새 표 `workin_sync_works`(v2-3)에 upsert한다. 키는 `(account_no, work_id)`. 칸은 이름, team·year·quarter·kind, 장소 수, 상태(대상/제외/해석불가), 마지막 가져오기 시각, 마지막 오류. 사람이 손으로 고칠 수 있는 칸은 `override_skip`(이 워크만 끄기) 하나뿐이다.
- 한 범위(team·quarter·kind)에 워크가 둘 이상일 수 있다(예: 같은 분기 점검 워크를 둘로 나눈 경우). 그래서 장소마다 `ext_work_id`를 저장하고, 범위 단위로 통째로 덮어쓰는 일은 하지 않는다.
- 같은 워크 id가 두 계정 목록에 다 나오면(공유 워크) 처음 본 계정 하나로만 붙이고 경고를 남긴다.

### v2-B. 워킨맵 → 앱 가져오기(pull, 크론)

**B1. 주기**: 10분마다, **KST 07~21시**(직원이 칠하는 시간). 밤에는 1시간마다 1회. 이 작업은 카톡을 보내지 않으므로 카톡 시간 규칙과는 상관없다. 실패 알림만 관리자 푸시로 보낸다. 워크는 두 계정을 합쳐 25개 남짓이다(C·D 약 13, A·B 10. 큰 것은 937·891·881·876·794·751곳). 이번 분기 워크 9개만 매 회차 GET하므로 1회에 GET 열 번 안팎이면 끝난다. 지난 분기 워크는 워크 목록의 수정일이 마지막 가져오기 이후로 바뀌었을 때만 다시 GET한다(호출량 절감).

**B2. 짝짓기(장소 ↔ 행)**
1. `ext_id`(워킨맵 장소 `_id`)가 같으면 바로 짝이다. 두 번째 실행부터는 거의 전부 여기서 끝난다.
2. 처음 1회(`ext_id`가 빈 행): 같은 범위(team·quarter·kind) 안에서 ① `number`가 같고 이름 정규화(`vendorMatchKey`)도 같음 → ② 이름 정규화 + 주소 정규화(`addressGroupKey`)가 같고 후보가 1개. 이 순서로 짝짓고 `ext_id`·`ext_work_id`·`ext_account_no`·`ext_year`를 채운다.
3. 후보가 2개 이상이거나 0개면 **확인 큐**(`workin_sync_review`, kind=`unmatched`)로 보낸다. 관리자가 워킨맵 화면에서 [이 행과 짝] / [새 장소로 추가] / [무시]를 고른다.
4. 첫 짝짓기는 **dry로 먼저 돌리고 결과 숫자를 사용자가 확인한 뒤** 실제로 쓴다(P1-3).

**B3. 새 장소(워킨맵에만 있음)**: **v2에서는 자동으로 추가한다**(사용자가 "구조를 완전히 비슷하게"를 원함. v1과 다른 점). 단, 다음 조건을 둔다.
- 처음 짝짓기 회차(그 워크의 첫 pull)에서는 추가하지 않고 확인 큐로만 보낸다. 짝을 못 찾은 기존 행과 같은 곳이 이중으로 생기는 사고를 막기 위해서다. 두 번째 회차부터 새로 생긴 장소는 자동으로 추가한다.
- 추가 행: `id`는 앱과 같은 방식(`Date.now()+i`, 충돌하면 +1 재시도), `team/quarter/kind`는 워크 해석값, `number`는 범위 최대값+1. name·comment·phone(워킨맵 `number`)·address·address_detail·좌표·label·visible·memos는 워킨맵 값을 쓴다. `updated_by`는 `워킨맵 동기화`, ext_* 칸도 채운다.
- 한 회차에 한 워크에서 새 장소가 50곳을 넘으면 **추가하지 않고 멈춘 뒤 알림**을 보낸다(워크 복사나 잘못된 워크가 대상이 된 경우 방어).

**B4. 사라진 장소(앱에는 있는데 워킨맵에서 없어짐)**: 지우지 않는다. `ext_missing_at`을 기록하고 확인 큐(kind=`missing`)에 넣는다. 관리자가 [숨김(visible=false)] / [그대로]를 고른다. 숨기면 홈 K2는 `visible=not.is.false`로 거르므로 수치에서 빠진다. **응답이 0곳이거나 평소 장소 수의 50% 미만이면 그 워크는 "형식 이상"으로 보고, 이번 회차에 아무것도 쓰지 않는다.**

**B5. 필드별 규칙(짝지은 행)**

| 앱 칸 | 워킨맵 칸 | 가져오기 규칙 |
|---|---|---|
| label `G1~G12` | `label_color` 0~11 | `G(n+1)`. 아래 B6 충돌에 해당하지 않으면 워킨맵 값으로 바꾼다. **G5/G12로 바뀌면 `[G5 완료] YYYY-MM-DD (워킨맵)` 이력 메모를 붙인다**(날짜는 워킨맵 `last_update`의 KST 날짜). 주차분석(`completionDate`)이 이 메모를 읽으므로 앱 `withLabelHistory`와 같은 머리를 쓴다 |
| visible | `hide` | `visible = !hide`. 워킨맵이 이긴다(충돌 규칙은 같음) |
| memos(문자열 배열) | `memo2[{_id, content, last_update}]` | **합치기만 한다.** 워킨맵 줄 중 앱에 없는 내용(공백 정리 후 비교)만 뒤에 붙인다. 앱에만 있는 줄은 지우지 않는다. 워킨맵에서 지운 줄도 앱에서는 지우지 않는다. 등급 줄(`V/SS/S/NN/N`)과 `계약종료…` 줄도 그대로 남으므로 `renewalGrade`·`contractEnd`가 계속 읽을 수 있다 |
| name·comment·phone·address·address_detail·좌표 | 같은 이름 칸 | **기존 행은 덮어쓰지 않는다.** 다르면 확인 큐(kind=`field_diff`)에 "워킨맵에서 주소 바뀜: 전→후" 식으로 올리고, 관리자가 [반영]을 누를 때만 바꾼다. 앱의 주소 변경 이력(`ContactChangeHistory`)과 주민번호 가림(`workinPrivacy.ts`)을 지키기 위해서다. 새 장소(B3)만 처음에 그대로 넣는다 |
| 사진 | `resource_images` | 가져오지 않는다 |

**B6. 충돌 판정(시각 기준)**
- 행마다 기준 시각 두 개를 둔다. `ext_synced_at`(마지막으로 양쪽이 같다고 확인한 시각)과 `ext_last_update`(그때의 워킨맵 `last_update`).
- 워킨맵이 바뀜 = `place.last_update > ext_last_update`. 앱이 바뀜 = `updated_at > ext_synced_at` 이면서 `updated_by`가 `워킨맵 동기화`가 아님.
- 워킨맵만 바뀜 → 가져온다. 앱만 바뀜 → 되밀기 큐가 처리한다(v2-C). **둘 다 바뀜** → 바뀐 칸이 겹치지 않으면 둘 다 살린다. 같은 칸(예: label)이면 **더 늦은 시각이 이긴다.** 단, 이기는 쪽이 **완료를 내리는 경우**(앱 G5/G12 → 워킨맵 G1~G4, 또는 매월 순위 하락)는 자동으로 하지 않고 확인 큐(kind=`conflict`)로 보낸다. FIELD 점검방 전송이 자동으로 만든 G5를 지키기 위해서다.
- 되밀기 큐에 대기 중인 칸은 가져오기에서 건너뛴다(밀어 넣는 중인 값을 옛 값으로 되돌리지 않도록).

### v2-C. 앱 → 워킨맵 되밀기(push)

**C1. 무엇을 큐에 넣나(앱 코드 변경 0)**
- `workin_map_places`에 **AFTER UPDATE 트리거**를 단다. 큐 `workin_sync_outbox`에 넣는 조건은 셋을 모두 만족할 때다. `ext_id`가 있고, `updated_by`가 `워킨맵 동기화`가 아니고, `label`·`visible`·`memos` 중 하나가 실제로 바뀌었다.
  - 이렇게 하면 앱의 모든 쓰는 곳이 코드 수정 없이 자동으로 큐에 들어간다. 워킨맵 화면 손 편집, **FIELD 점검방 전송의 자동 G5·매월 G2/G3/G5**(`App.tsx`), 키맨·주소 변경, 이관 G12가 모두 해당한다.
  - 같은 장소·같은 칸에 대기 중인 행이 이미 있으면 새로 넣지 않고 값만 최신으로 덮는다(합치기). 10분 사이에 G1→G3→G5로 바뀌면 G5 한 번만 보낸다.
- 메모는 "새로 생긴 줄"(OLD.memos에 없고 NEW.memos에 있는 줄)만 큐에 넣는다. 지운 줄은 보내지 않는다.

**C2. 어떻게 보내나**
- **색·숨김**: `PUT /api/v2/places/props`에 `{place_list, label_color}` 또는 `{place_list, hide}`를 보낸다. 같은 계정·같은 색끼리 묶고, 묶음은 최대 100곳이다. 장소 소속 계정은 `ext_account_no`로 고르고 그 계정의 토큰을 쓴다.
- **메모 추가**: `POST /api/v2/places/modify2`(multipart `data`)로 보낸다. **같은 회차의 pull에서 방금 받은 그 장소 객체**에서 name·comment·address·position·label_color·number·기존 memo2(`_id` 포함)를 그대로 복사한다. memo2 끝에 새 줄 `{content}`(`_id` 없음)만 덧붙이고 `del_resource_id_list: []`로 보낸다. 받은 지 60초가 넘은 객체는 쓰지 않고 다시 GET한다. 화면 코드가 보내는 모양을 그대로 따른다. 정확한 칸(특히 `place_id` 위치, `label_color`가 문자열인지 숫자인지)은 **P2 실측 전까지 추정**이다.
- **보내기 직전 충돌 검사**: 그 장소의 워킨맵 `last_update`가 큐 행 생성 시각보다 늦으면 워킨맵이 더 최근이다. 그러면 **앱이 양보한다.** 큐 행을 `yielded`로 닫고 로그를 남긴다. 그다음 pull이 워킨맵 값을 앱에 가져온다. 단, 양보하면 완료가 내려가는 경우는 확인 큐로 보낸다(B6과 같은 규칙).
- 성공하면 큐 행을 `done`으로 닫는다. 그리고 그 행의 `ext_synced_at`을 지금 시각으로, `ext_last_update`를 응답(또는 직후 GET)의 `last_update`로 맞춘다. 이 갱신은 `updated_by`를 `워킨맵 동기화`로 해서 트리거가 다시 큐에 넣지 않게 한다.
- 실패하면 `attempts`를 1 올리고 10분·30분·2시간 뒤에 다시 시도한다. 5회 실패하면 `failed`로 두고 관리자 알림을 보낸다. 109(토큰 오류)는 재로그인 뒤 1회 즉시 재시도한다. 221·332·334처럼 등급·한도 오류는 재시도하지 않는다.

**C3. 절대 하지 않는 것(되밀기)**
- 장소 삭제(`/places/delete`), 추가(`/places/add`·`add2`), 이동(`/places/move`), 복사, 사진 삭제. 엣지 코드에 이 경로 문자열 자체를 두지 않는다(테스트로 고정).
- 이름·주소·좌표·전화·코멘트를 바꾸는 쓰기. modify2에서도 받은 값을 그대로 돌려줄 뿐이다. 보내기 직전에 받은 값과 보낼 값의 이 칸들이 바이트 단위로 같은지 검사하고, 다르면 보내지 않는다.

**C4. 핑퐁(왕복) 방지**
- 동기화가 쓴 행은 `updated_by`를 `워킨맵 동기화`로 둔다. 트리거는 이 값이면 큐에 넣지 않는다.
- pull은 값이 실제로 다를 때만 앱에 PATCH한다. 같으면 쓰지 않으므로 updated_at도 오르지 않는다.
- push가 성공하면 `ext_last_update`를 워킨맵의 새 시각으로 맞춘다. 그러면 다음 pull이 그 변경을 "워킨맵이 바뀜"으로 보지 않는다.
- 안전장치로, 같은 장소가 한 시간에 6번 넘게 왕복하면 그 장소의 동기화를 멈추고 확인 큐(kind=`loop`)로 보낸다.

**C5. 계약종료 워크(다른 부서 공유)**: 우리 변경이 다른 부서 화면에도 보인다. 그래서 되밀기 대상 필드는 **색·숨김·메모 추가로 한정**한다. 기본값은 다음과 같다(질문 Q3).
- `renewal` 워크: **색만 되밀고, 숨김·메모는 되밀지 않는다.** 우리 쪽 `[G5 완료]`나 키맨 이력 같은 메모가 다른 부서 지도를 어지럽히지 않게 하기 위해서다.
- `quarter`·`monthly` 워크: 색·숨김·메모를 모두 되민다(메모는 스위치를 켰을 때만).
- 설정 `app_config.WORKINMAP_PUSH_FIELDS = {"quarter":["label","visible","memo"],"monthly":["label","visible","memo"],"renewal":["label"]}`로 바꿀 수 있다.

### v2-D. 위험·한계(솔직하게)
| 위험 | 크기 | 대응 |
|---|---|---|
| **비공식 API.** solgit 내부 경로라 예고 없이 바뀔 수 있다 | 큼 | 응답 형식을 검사한다(필수 칸 `_id`·`label_color`·`places` 배열). 어긋나면 그 워크는 **쓰지 않고 중단**하고 알림을 1회 보낸다. 관리 탭에 마지막 성공 시각을 표시한다. 멈추면 v1 방안 C(엑셀 [바뀐 것만 반영])로 손으로 대체한다 |
| **약관.** 자동 접근 조항을 확인하지 못했다(약관 페이지 404) | 중 | 사용자가 워킨맵(솔깃) 측 약관을 확인하거나 문의한다. 호출량은 사람이 화면을 쓰는 수준(10분에 십여 회)으로 제한한다 |
| **계정 비밀값 보관.** 유출되면 두 계정의 워크 전체를 쓰고 지울 수 있다 | 큼 | secrets에만 둔다. refresh token 표는 RLS + revoke로 막는다. 엣지는 cron 또는 관리자 토큰(`FIELD_ADMIN_TOKEN`)으로만 호출할 수 있다. 로그에 이메일·토큰을 찍지 않는다. 워킨맵에 하위 계정이나 권한 공유 기능이 있으면 전용 계정을 권한다(미확인) |
| 토큰 만료·비밀번호 변경 | 중 | A2(refresh → 재로그인 → 3회 실패 시 정지·알림) |
| **1,000곳 한도**(유료 워크당) | 중 | 지금 가장 큰 워크는 C 4분기 점검 937곳(63곳 여유)이다. A·B는 B 4분기 891곳, B 3분기 876곳, A 4분기 881곳이다. 앱은 워킨맵에 장소를 추가하지 않으므로 우리 때문에 늘지는 않는다. 워크 장소 수가 950곳을 넘으면 관리 탭에 노란 표시를 한다 |
| **다른 부서 계약종료 워크에 우리 변경이 들어감** | 중 | C5. 기본은 색만 되민다. 색 뜻(G5 = 재계약 완료 등)이 부서 간에 같은지 확인한다(Q3) |
| 핑퐁 루프 | 중 | C4 |
| 잘못 짝지은 행에 되밀기 → 남의 장소 색이 바뀜 | 큼 | 첫 짝짓기는 dry 확인 뒤에만 한다. 후보가 2개 이상이면 자동으로 짝짓지 않는다. P2 처음 1주는 `quarter` 워크만 되밀고 renewal은 끈다 |
| 연도 칸 없음 | 중 | `workin_map_places`에는 `quarter`(1~4)만 있고 연도가 없다. 그래서 26년 2분기와 27년 2분기가 같은 범위로 섞인다. 워크 이름에서 연도를 읽어 `ext_year`에 저장한다. 앱 화면은 지금처럼 분기만 쓴다. 27년 2분기 워크가 생기기 전(2027-04)에 앱 쪽 연도 처리가 필요하다(이번 범위 밖, 기록만) |
| E팀(CSS) | 작음 | 두 계정에 E 워크가 있는지 모른다. 규칙은 A~E를 다 받는다. 없으면 E는 지금처럼 앱 단독이다 |
| 동시 편집 경합(modify2로 읽고 쓰는 사이에 직원이 같은 장소를 고침) | 작음 | 60초 안의 객체만 쓰고, 보내기 직전에 `last_update`를 비교한다. 그래도 몇 초의 틈은 남는다. 그래서 메모 되밀기는 따로 켜는 스위치(`WORKINMAP_PUSH_MEMO`, 기본 꺼짐)로 두고 P2가 안정된 뒤 켠다 |

### v2-E. 수치(점검률·계약률)는 어디서 계산되나 — 가져오기만 해도 맞나

| 수치 | 계산 위치 | 쓰는 칸 | pull만으로 맞나 |
|---|---|---|---|
| 분기 점검 진행률(팀별) | `src/workinProgress.ts teamWorkinProgress`: 분기점검 1곳 = 1단위(G5·G12 완료), 매월 1곳 = 3단위(G2=1·G3=2·G5/G12=3). 워킨맵 화면 `WalkingMap.tsx teamProgress`(2255행)와 홈 KPI K2(`src/kpi/kpiData.ts` 191행, 쿼리 `workinProgressQuery`는 `visible=not.is.false`)가 같은 함수를 쓴다 | team·quarter·kind·label·visible | **맞다.** 색(label)과 숨김(visible)이 워킨맵과 같아지고, 새 장소 추가로 분모도 같아진다. 남는 차이는 B4 "사라진 장소"뿐이고, 숨김 처리하면 홈 K2에서 빠진다. 단, 워킨맵 화면 진행률(`teamProgress`)은 visible로 거르지 않으므로 두 화면의 분모가 다를 수 있다(이미 있던 차이. 이번 범위 밖, 기록만) |
| 재계약(계약률) | 홈 K35 `renewalProgress`: G7 라벨을 빼고 G5 = 완료. 워킨맵 화면 `teamProgress`: `renewalGrade(place)`가 `V`인 곳을 빼고 G5 = 완료 | label, memos(등급 줄), name 접두 | **색은 맞아진다.** 다만 **두 화면의 제외 규칙이 다르다**(홈 = G7 라벨, 지도 = V 등급). 그래서 동기화 뒤에도 홈과 지도의 계약률이 서로 다를 수 있다. 이것은 동기화 문제가 아니다. "숫자가 틀리다"는 말이 나오면 이 둘을 구분해서 설명한다(통일은 별도 작업) |
| 주차분석 | `WalkingMap.tsx weeklyAnalysis`(2275행): 완료 날짜를 `[G5 완료] YYYY-MM-DD` 메모에서 읽는다(`completionDate` 277행) | label, memos | **B5의 이력 메모를 붙여야 맞다.** 워킨맵에서 칠한 완료에는 날짜 메모가 없으므로 pull이 `last_update` 날짜로 붙인다. 첫 pull 때 이미 완료였던 곳은 날짜를 알 수 없으니 지금처럼 "추적 전 완료"로 잡힌다 |
| 진행률 연도 | `progressYear = new Date().getFullYear()` | quarter만 | 지난 분기(2·3분기) 워크도 같은 해라 맞다. 해가 바뀌면 위의 연도 위험이 생긴다 |

결론: **P1(가져오기)만 해도 점검률은 워킨맵과 맞아진다.** 계약률은 색은 맞지만, 홈과 지도 사이의 정의 차이는 남는다.

### v2-2. 쓰는 사람
| 누가 | 어디서 | 무엇을 |
|---|---|---|
| 현장 직원 | 폰 워킨맵 앱(기존) | 지금처럼 색칠·메모. 바뀌는 것 없음 |
| 팀원·관리자 | 폰·PC 웹앱 | 10분 안에 반영된 색과 수치를 본다. 웹앱에서 고친 색은 10분 안에 워킨맵에도 칠해진다(P2) |
| 관리자(사용자) | PC 웹앱 관리 탭 + 워킨맵 화면 | 계정 상태, 워크 목록(대상/제외/해석불가), 확인 큐 처리, 실패 알림 |
| 다른 부서 | 워킨맵 계약종료 워크 | 우리 쪽 색 변경이 보인다(C5) |

### v2-3. 데이터 설계(SQL `supabase/workin-sync.sql`, 재실행 안전)
- `workin_map_places`에 칸 추가(전부 nullable, `add column if not exists`):
  `ext_id text`(부분 유니크 `where ext_id is not null`), `ext_work_id text`, `ext_account_no smallint`, `ext_year smallint`, `ext_last_update timestamptz`, `ext_synced_at timestamptz`, `ext_missing_at timestamptz`.
- 트리거 `workin_sync_enqueue`(AFTER UPDATE, C1 조건). 기존 BEFORE 트리거 `set_workin_updated_at`과 순서가 충돌하지 않는다. **P2 SQL에서 만든다.**
- 새 표 4개
  - `workin_sync_accounts(account_no smallint pk, label, id_token, refresh_token, expires_at, fail_count, paused, last_ok_at, last_error)`: **RLS 켜고 정책 없음 + anon·authenticated revoke.** 화면은 엣지 `{action:"status"}`로만 상태를 본다(응답에서 토큰 칸은 뺀다).
  - `workin_sync_works(account_no, work_id, name, team, year, quarter, kind, place_count, status 'target'|'excluded'|'unparsed', override_skip, last_pulled_at, last_work_modified, last_error, pk(account_no, work_id))`: anon은 읽기만.
  - `workin_sync_outbox(id bigserial, place_id bigint, ext_id, account_no, field 'label'|'visible'|'memo', value jsonb, created_at, status 'pending'|'done'|'yielded'|'failed'|'skipped', attempts, next_at, last_error, done_at)`: anon은 읽기만. 넣기는 트리거(security definer)만 한다. 대기 중 중복 방지용 부분 유니크 `(place_id, field) where status='pending' and field<>'memo'`.
  - `workin_sync_review(id bigserial, kind 'unmatched'|'new'|'missing'|'field_diff'|'conflict'|'loop', place_id, ext_id, work_id, detail jsonb, created_at, resolved_at, resolved_by, resolution)`: anon은 읽기 + resolved 칸만 갱신(관리자 화면에서 처리).
- `app_config` 키: `WORKINMAP_API_KEY`(Firebase 웹 키), `WORKINMAP_ACCOUNT_LABELS`, `WORKINMAP_EXCLUDE_WORKS`, `WORKINMAP_PUSH_FIELDS`, `WORKINMAP_SYNC_ENABLED`(기본 false), `WORKINMAP_PUSH_ENABLED`(기본 false), `WORKINMAP_PUSH_MEMO`(기본 false).
- cron `workinmap-sync`: 10분(KST 07~21시) + 1시간(밤). 엣지 호출은 기존 cron 방식(`supabase/contact-sheet-pull-cron.sql` 패턴)을 따른다.
- 9/12 감사 #25(교체 불러오기가 id를 새로 만듦): 동기화를 켠 범위에서는 [엑셀 불러오기 → 교체]를 막아야 한다. 막지 않으면 ext_id가 통째로 사라진다(앱 변경 1곳, P1-4).

### v2-4. 화면 흐름(관리자)
1. 관리 탭 > 연동 > **워킨맵 동기화** 카드: 계정 2줄(라벨·마지막 성공·상태·[다시 시도]), 스위치 3개(가져오기/되밀기/메모 되밀기).
2. [워크 목록]: 계정별 워크 표(이름, 해석 결과 팀/연/분기/업무, 장소 수, 상태, 끄기). 해석 불가와 제외는 회색으로 보인다.
3. [dry 실행]: 워크별로 "짝지음 n / 새 장소 n / 짝 못 찾음 n / 사라짐 n / 색 바뀔 곳 n / 완료 하향 충돌 n" 숫자만 보여 주고, 아무것도 쓰지 않는다.
4. 숫자를 확인하고 [가져오기 켜기]를 누르면 10분 뒤부터 반영된다.
5. 워킨맵 화면 상단에 "확인 필요 n" 배지가 뜬다. 누르면 확인 큐 목록이 나오고, 행마다 [짝 고르기]/[추가]/[숨김]/[반영]/[무시]를 고른다.
6. P2: [되밀기 dry]로 "보낼 색 n·숨김 n·메모 n, 양보 n"을 확인한 뒤 [되밀기 켜기]를 누른다.

### v2-F. 단계·작업 분해

**P1 가져오기(한 방향, 수치 복구)**: 약 3일

| 순서 | 역할 | 할 일 | 파일(서로 겹치지 않게) |
|---|---|---|---|
| P1-1 | db-schema(표다빈) | `workin-sync.sql`: ext_* 칸, 표 4개, RLS/revoke, app_config 기본 키. **트리거는 P2 SQL로 미룬다**(P1 동안 큐가 쌓이지 않게). sql-review → /sql-handoff | 새 `supabase/workin-sync.sql` |
| P1-2 | 구현 A(순수 함수, sonnet) | `parseWorkName`, `labelFromColor`/`colorFromLabel`, `matchPlaces`(ext_id → 번호+이름 → 이름+주소), `planPull`(B5·B6 규칙 → patch/insert/review 목록), 메모 합치기·이력 메모. Deno와 브라우저가 같이 쓰는 순수 TS. 테스트: v2-A3 실측 이름 표 전부, 완료 하향 차단, 매월 순위, 메모 중복, 같은 건물 2지점, 0곳·50% 미만 응답 중단, 새 장소 50곳 상한 | 새 `supabase/functions/_shared/workinmap/plan.ts`, 새 `tests/workinmapPlan.test.ts` |
| P1-3 | 구현 B(엣지, opus 권장) | `workinmap-sync`의 `{action:"works"\|"pull"\|"dry"\|"status"}`: 계정 n개 로그인·refresh 캐시(A2), workList4 → `workin_sync_works` upsert, 대상 워크 GET → `planPull` → 250행씩 PATCH/insert(`updated_by`는 `워킨맵 동기화`), review 넣기, 형식 검사·중단·알림. 호출은 cron 또는 `FIELD_ADMIN_TOKEN`만. 로그에서 비밀값 가림. 첫 실행은 반드시 `dry`. dry 결과에 **색 숫자 검증**(label_color 0~11 분포와, 앱에서 이미 알고 있는 장소 몇 곳의 G값 대조)을 넣어 G1~G12 가설을 1회 확인한다 | 새 `supabase/functions/workinmap-sync/index.ts`, `auth.ts`, `api.ts` |
| P1-4 | ui-designer(윤화면) → 구현 C | 관리 탭 동기화 카드(v2-4의 1~5)와 확인 큐 목록. 목업 이미지를 먼저 만든다 | 새 `src/WorkinSyncAdmin.tsx`, `src/SystemAdmin.tsx`(카드 진입 1~2줄). `src/WalkingMap.tsx`는 두 곳만 고친다: "확인 필요" 배지, 그리고 동기화 범위에서 [교체] 불러오기 막기 |
| P1-5 | db-schema | cron SQL(P1 dry 확인 뒤) | 새 `supabase/workin-sync-cron.sql` |
| P1-6 | qa-checker(검수아) | build·test, plan 경계 검사. dry 결과 숫자를 워킨맵 화면 숫자와 대조한다(C 4분기 점검 937곳의 G5 수). 홈 K2와 워킨맵 진행률이 같은지 본다(visible 차이 주의). 엣지 응답에 토큰·이메일이 없는지 확인한다 | 테스트만 |
| | 매뉴얼 | user/12에 "워킨맵 동기화" 절 추가, ops/에 새 장 "워킨맵 동기화 운영"(secrets 등록·멈췄을 때·dry·엑셀 수동 대체) | `docs/manual/user/12-walking-map.md`, `docs/manual/ops/` 새 장 |

**P2 되밀기**: 약 3일 + 1주 관찰

| 순서 | 역할 | 할 일 | 파일 |
|---|---|---|---|
| P2-1 | db-schema | 트리거 `workin_sync_enqueue` + outbox 부분 유니크. sql-review → /sql-handoff | 새 `supabase/workin-sync-push.sql` |
| P2-2 | 구현 A | `planPush`(outbox 묶기, 양보 판정, 계약종료 필드 한정, modify2 본문 조립 + 불변 칸 바이트 비교). 테스트: 같은 칸 합치기, 양보, 완료 하향 양보 → review, 금지 경로 문자열이 코드에 없음, 왕복 6회 차단 | 새 `supabase/functions/_shared/workinmap/push.ts`, 새 `tests/workinmapPush.test.ts` |
| P2-3 | 구현 B | 엣지에 `{action:"push"}`·`{action:"push-dry"}` 추가. `pull` 뒤 같은 회차에서 push를 실행한다(방금 받은 객체 사용). props 묶음 → modify2(메모 스위치를 켰을 때만). 재시도 백오프 | `supabase/functions/workinmap-sync/*` |
| P2-4 | 구현 C | 관리 카드에 되밀기 스위치·push-dry 결과·실패 목록 | `src/WorkinSyncAdmin.tsx`만 |
| P2-5 | qa-checker | **실측**: 테스트용 워크 1개(사용자가 워킨맵에 "동기화테스트" 워크를 만들고 장소 3곳을 넣음)에서만 props·modify2를 실제로 1회 보내 형식을 확인한다. 그 뒤 quarter 워크만 1주, 그다음 renewal(색만) 순서로 넓힌다 | 테스트 + 기록 |

App.tsx 0줄(FIELD 자동 G5는 DB 트리거가 잡는다).

### v2-G. 사용자에게 물을 것(3개)
1. **C·D 계정의 2·3분기 워크 정확한 이름을 주세요**(A·B는 받았음, 색 팔레트도 받았음). 이름 규칙 테스트 고정값으로 넣습니다. 이 목록이 없어도 규칙상 같은 형식이면 자동으로 대상에 들어갑니다. 다만 해석에 실패한 워크는 관리 탭 "해석 못 한 워크"에 뜹니다.
2. **주기·제외·테스트 워크**: 10분(07~21시) + 밤 1시간이면 될까요? 제외 워크는 `영업확장성리스트_박P_워킨맵표현` 하나뿐인가요? A·B 계정에 다른 부서 전용 워크가 있으면 이름을 알려 주세요. P2 실측용 "동기화테스트" 워크를 하나 만들어 줄 수 있나요?
3. **계약종료 워크에 우리 쪽 변경을 어디까지 되밀까요?** 추천은 "색만"입니다(메모·숨김은 다른 부서 지도에 섞입니다). 다른 부서도 G5를 '재계약 완료' 뜻으로 쓰는지도 확인이 필요합니다. 그렇지 않다면 계약종료는 가져오기만 합니다.

(계정은 사용자가 Supabase secrets `WORKINMAP_1_EMAIL`/`WORKINMAP_1_PASSWORD`, `WORKINMAP_2_EMAIL`/`WORKINMAP_2_PASSWORD`에 직접 넣는다. 채팅으로 보내지 않는다. 약관 확인도 사용자 몫이다.)

### v2-H. 하지 않을 것
- 워킨맵 장소 삭제·추가·이동·복사, 사진 업로드·삭제, 워크 생성·이름 변경
- 앱에서 바꾼 이름·주소·좌표·전화·코멘트를 워킨맵에 쓰기, 그리고 워킨맵의 같은 칸으로 기존 앱 행을 자동으로 덮어쓰기(확인 큐로만 처리)
- 어느 쪽이든 "없어졌다"는 이유로 지우기
- 이름을 해석하지 못한 워크와 영업확장성리스트 워크의 동기화
- 노트북 브라우저 자동화, Firebase Realtime DB 직접 접근
- 홈·지도의 계약률 정의 통일, 연도 칸의 화면 반영(기록만)
- App.tsx 수정, 워킨맵 화면 디자인 변경(배지와 [교체] 막기 외)
