# 미수 방문이력 개편 — CS 방문이력 작성기 + 조회 › 미수 업체별 이력 (설계안)

작성: 2026-10-22 기획실 한설계 (feature-planner). 기준 문서: `docs/tasks/misu-visit-standard.md`(법무팀 확정안 전사).
상태: **설계안 — 사용자 승인 대기.** 코드·SQL 은 아직 없음.

---

## 0. 지금 구조 (조사 결과 · 실측 2026-10-22, anon REST 읽기)

| 무엇 | 지금 | 근거 |
|---|---|---|
| 필드 › 미수 탭 | 공용 스키마 폼. `src/categoryForms.ts` `CATEGORY_SCHEMAS.misu`(입력일·작성자·지역·업체명·담당자·등급 / 미수금액·보증금미입금·미수개월·방문내용·고객반응 / 약속일·후속담당자·특이사항) → `src/CategoryForm.tsx` 가 그림 → `src/App.tsx` `isCat` 경로 → `src/api.ts` `sendCategoryForm()` 이 `misu` 표 insert + 지역 미수방 outbox | categoryForms.ts:26, App.tsx:4464·5732, api.ts:1027 |
| 카톡 출력 | `buildCatText()` — `/미수 방문` + `■ 섹션` + `라벨: 값` 줄. 사진은 App 공용 사진함 → 앨범(`createAlbum`, sourceType `misu`) 링크를 끝에 붙임 | categoryForms.ts:107, App.tsx:5186·5667 |
| 방 매핑 | `room_map` 미수 A·B·C·D 4개만. **E 없음, `미수|*` 없음** → `regionRoom()` 폴백이 `TEST_ROOM` → **E 지역 미수는 테스트방으로 샌다** | api.ts:766·788·1070, room_map 실측 |
| `misu` 표 | 8,283행 = `카톡:미수(A~D)` 8,086행(입력일 2023-11 ~ **2026-06-23 에서 멈춤**) + `시트:수도권A~E_담당` 197행(관리부 현재 미수 목록). **웹앱 출처(`웹앱:미수`) 0행** | REST count |
| `misu` 표 적재 방식 | First-DATA GAS `SUPABASE_SHEET_TABLE['미수']` = **전체교체 미러(delete id>=0 + insert)**, 매일 0시(`syncNonLeaseOnly`). created_at 전부 2026-10-21 00:2x KST | apps-script/first-data/src/Supabase.gs:26·110, Menu.gs:32 |
| **결론** | **필드 미수 탭이 `misu` 에 넣은 행은 그날 밤 미러가 지운다.** 웹앱 미수 기록이 DB에 하나도 없는 이유. 방문집계(visit_logs work_kinds) 에도 misu 0건 — 탭이 사실상 안 쓰였거나 흔적이 다 사라졌다 | 위 실측 |
| 관리부 시트 행(_raw) | `거래처코드`(10자리), `임순`(임대리스트 순번), `CS`·`CS담당`·`CS체크`, `경영체크`·`전략체크`(날짜별 독촉 메모), `체크여부`·`마지막 체크일`·`문자발송여부` | misu 시트 행 샘플 |
| `misu_cs_checks` | 관리부가 시트에서 CS체크한 업체(198행, checked 33). `cs1`/`cs2`(CS-1회/2회) 열 있으나 **33곳 모두 비어 있음**. GAS 1시간 동기화, 웹앱 읽기 전용 | supabase/misu-cs-check.sql, REST |
| 조회 › 미수 | `src/lookupCatalog.ts:109` `custom:"misu"` → `src/DataLookup.tsx:280` → `src/MisuOverageBoards.tsx` `MisuBoard`. **시트 출처 행만** 읽음(`_출처 like 시트*`) → 업체 한 줄(팀·지역·개월·잔액·입력일) + [CS체크 목록] + 상세 모달(`SheetDetailModal`). 누가 언제 방문했는지 볼 곳 없음 | MisuOverageBoards.tsx:180~365 |
| 재사용 부품 | 업체 검색 `searchVendorMaster()`·`vendorInfoByCode()`(deptReceptionApi.ts), 업체 미수 배지 `getVendorFlagsBatch()`(vendorFlags.ts), 사진 `prepareImageForUpload()`(imageUpload.ts)·`uploadPhoto()`·`createAlbum()`(supabase.ts), 사진 보기 `PhotoViewer.tsx`, 초안 사진 보관 `photoStore.ts`, 작성자 `authorLocked()`·`getSsoSession()`(sso.ts), 자체 제출 폼 패턴 `PraiseForm`(bindSubmit/onReadyChange), 지역 `normRegion()`(region.ts) | |

쓰는 사람: **작성 = CS 현장 기사(폰, 방문 직후 현장/차 안)**. **조회 = CS 팀장·파트장, 관리부, 법무팀(PC 위주)**.

---

## 1. 한 줄 목표

CS 기사가 미수 업체 방문 직후 **버튼만 눌러** 법무 기준 5가지를 빠짐없이 채운 방문이력을 남기고(필드 › 미수), 팀장·관리부·법무가 **업체별로 누가·언제·몇 차·무엇을 남겼는지와 소송이관 준비 여부**를 한 화면에서 본다(조회 › 미수).

---

## 2. 기존 코드 재사용 / 확장 지점

| 파일:함수 | 어떻게 |
|---|---|
| `src/App.tsx` Mode `"misu"`, 더보기 버튼(6746) | **그대로.** 진입은 같은 탭 |
| `src/App.tsx` `isCat`(4464) | `"misu"` 를 뺀다(불만·재계약·초과조정은 그대로). 5줄 안팎 — §6 참고 |
| `src/App.tsx` 칭찬 자체 제출 패턴(5134·6980·7073·7180) | 같은 패턴으로 `misuSubmitRef`/`misuReady`. 미수 모드에선 공용 사진함 버튼 숨김(사진은 폼 안 4슬롯) |
| `src/App.tsx` `recordVisit`·`recordOperation`(5277·5328) | 폼이 `onSent(text)` 콜백으로 App 에 넘기면 App 이 기존처럼 방문집계·운영현황 기록 |
| `src/categoryForms.ts` `CATEGORY_SCHEMAS.misu` | **이번엔 지우지 않는다**(호출 경로만 끊김, 1 릴리스 후 정리). 다른 3종 무변경 |
| `src/api.ts` `sendCategoryForm` misu 분기(1042) | 손대지 않음 |
| `src/api.ts` `REGION_ROOMS.misu` + `getRoomMap()` | 새 API 가 `room_map["미수|<지역>"]` → `REGION_ROOMS.misu` 순으로 방 결정. **테스트방 폴백 금지**(없으면 저장만, "방 미정" 안내). REGION_ROOMS 가 export 아니면 새 API 에 같은 4개 상수를 두지 말고 room_map 만 쓴다 |
| `src/deptReceptionApi.ts` `searchVendorMaster` / `vendorInfoByCode` | 미수 목록에 없는 업체 검색용 |
| `src/supabase.ts` `uploadPhoto` / `createAlbum` / `insertRow` / `selectRows` / `selectAllRows` / `enqueueOutbox` / `getConfig` | 사진 슬롯 업로드·앨범·저장·조회·카톡. **새 REST 래퍼 금지**(규칙) |
| `src/imageUpload.ts` `prepareImageForUpload` | 슬롯 사진 축소 + 600px 미만 경고(접수 사진 화질 교훈) |
| `src/MisuOverageBoards.tsx` `MisuBoard` | 세 번째 보기 **[방문 이력]** 추가 + [전체 현황] 줄에 방문 상태 칩. `SheetDetailModal`·`OverageBoard` 무변경 |
| `src/DataLookup.tsx` | **손대지 않음**(다른 팀원 작업 중). `MisuBoard` 이름·export 를 유지하므로 연결 그대로 |
| `tools/worker/backup_tables.py` 표 목록 | `misu_visits` 한 단어 추가(02:30 백업 대상) |

새 파일: `src/misuVisit.ts`(순수 로직), `src/misuVisitApi.ts`, `src/MisuVisitForm.tsx`, `src/MisuVisitForm.view.tsx`, `src/MisuVisitHistory.tsx`, `src/MisuVisitHistory.view.tsx`, `supabase/misu-visits.sql`, `tests/misuVisit.test.ts`.

---

## 3. 데이터 설계 — 새 표 `misu_visits`

### 왜 `misu` 확장이 아니라 새 표인가
1. `misu` 는 **매일 0시 전체 삭제 후 재적재되는 시트 미러**다. 여기에 넣는 방문이력은 그날 밤 사라진다(지금 웹앱 0행이 증거). 법적 증거 기록을 둘 수 없다.
2. 기존 컬럼은 바꾸지 않는다(AGENTS.md 규칙 2). 새로 필요한 열(차수·반환요구·근거·슬롯 사진·판단)이 20개가 넘는다.
3. 방문 1건 = 1행, **수정 대신 보완 기록 추가**(증거 보존)라는 성격이 미러 표와 다르다.

### 표 `public.misu_visits` (SQL 파일 `supabase/misu-visits.sql`, 머리 주석에 날짜·목적)

| 열 | 형 | 비고 |
|---|---|---|
| id | uuid PK | **클라이언트가 폼 열 때 생성**(재전송 시 같은 id → 중복 저장 방지, insert 는 on_conflict=id ignore) |
| created_at | timestamptz default now() | 작성(저장) 시각 = "언제 남겼나" |
| visited_at | timestamptz not null | 방문 일시(기본 = 지금, 수정 가능) |
| visit_round | text not null, check in ('1차 안내','2차 경고','추가') | 이전 기록 수로 자동 제안 |
| author | text not null | SSO 이름(잠금 시) 또는 작성자 선택값 |
| author_sub | text default '' | SSO `user.sub`(있으면) — 사람 식별 |
| author_team | text default '' | A~E |
| vendor | text not null | 화면 이름 |
| company_code | text default '' | 거래처코드 10자리(미수 시트 `거래처코드` / vendor_master.code) |
| site_code | text default '' | 임대리스트 5자리(있으면) |
| lease_seq | text default '' | 임대리스트 순번(미수 시트 `_raw.임순`) |
| region | text default '' | A~E |
| misu_months, misu_balance | text default '' | 방문 당시 미수 개월·잔액 스냅샷(시트에서 자동) |
| contact_name | text default '' | 응대자 이름 |
| contact_title | text default '' | 직위(대표/원장/점장/실장/경리/직원/기타) |
| contact_is_rep | boolean null | 대표자 본인인가 |
| rep_phone | text default '' | 대표자 연락처(대표 아님일 때) |
| rep_phone_status | text default '' | 확보 / 거부 / 모름 |
| no_contact | boolean default false | 아무도 없음(문 잠김 등) |
| open_status | text default '', check in ('영업중','문 잠김','폐업 확인','') | |
| evid_mail | text default '' | 우편물 적치(예: 3주치) |
| evid_sign | text default '' | 간판(유지/철거) |
| evid_neighbor | text default '' | 옆 가게 진술(인용) |
| closed_estimate | text default '' | 폐업 추정 등 |
| dun_methods | text[] default '{}' | 구두 안내 / 안내문 봉함 전달 / 안내문 봉함 투입 |
| dun_reply | text default '' | 상대 답변(인용) |
| promise_date | text default '' | 납부 약속일 |
| return_requested | boolean default false | 기기 반환 요구 여부 |
| return_to | text default '' | 누구에게(이름/직위) |
| return_reply | text default '' | 답변(인용) |
| return_method | text default '' | 반환 방법 안내(반송 주소 안내/회수 일정 협의…) |
| photos | jsonb default '[]' | 슬롯 배열: slot = outside / door / device / notice, url, w, h |
| photo_skips | jsonb default '{}' | 슬롯별 촬영 불가 사유 |
| album_id | text default '' | 모아보기 앨범 |
| judgment | text default '', check in ('계속 독촉','철수','소송이관','') | |
| judgment_reason | text default '' | 사유 한 줄 |
| rules_ack | jsonb default '{}' | 4원칙 확인 체크 + 시간 외 방문 사유 |
| missing | text[] default '{}' | 경고로 통과한 미충족 필수 항목 — 조회 '보완 필요' 근거 |
| supplement_of | uuid null | 보완 기록이면 원 기록 id |
| text_body | text default '' | 카톡으로 나간 원문 |
| room | text default '' | 보낸 방(없으면 빈 값) |
| _hidden, _hidden_by, _hidden_at | 기존 표와 같은 숨김 3열 | 삭제 대신 숨김 |

인덱스: `(company_code)`, `(vendor)`, `(visited_at desc)`, `(region, visited_at desc)`.

### RLS·권한 (sql-review → /sql-handoff)
- `enable row level security`. 정책: anon select true · anon insert with check true · anon update true(숨김·보완 표시용 — SSO 2단계 때 좁힘).
- **`revoke all on public.misu_visits from anon, authenticated;` 다음 `grant select, insert, update on public.misu_visits to anon, authenticated;`** — 기본 전권(DELETE·TRUNCATE) 이어받지 않게 명시(anon-permissions-design 방향과 같음).
- 기존 표 변경 없음. cron·함수·뷰 없음. 재실행 안전(`if not exists`, 정책은 drop if exists 후 create).

### 업체 하나로 모으는 키 (조회)
1. `company_code`(10자리) 같으면 같은 업체 — 미수 시트 행 `거래처코드` 와 직접 이음.
2. 없으면 `lease_seq`(임순) ↔ 시트 `_raw.임순`.
3. 그래도 없으면 정규화 이름(㈜ / (주) / 주식회사 / 공백 제거) — 화면에 "이름으로 이어짐" 표시.
(`customer-hierarchy.md` 의 3단 구조가 생기면 site_code·company_code 로 자동 승격. 지금은 키를 저장만 해 둔다.)

---

## 4. 화면 흐름

### 4-A. 필드 › 미수 = CS 방문이력 작성기 (폰 우선, 세로 단계형)

1. **업체 고르기** — 맨 위 "우리 팀 미수 목록"(시트 197곳 중 내 팀, CS체크된 곳 먼저) 칩·검색. 고르면 개월·잔액·거래처코드·임순 자동, **지난 방문 n건 · 마지막 차수** 표시 → 차수 자동 제안(없음→1차 안내, 1차 있음→2차 경고). 목록에 없으면 [다른 업체 찾기](vendor_master 검색).
2. **방문 일시·응대자** — 일시(기본 지금). [아무도 없음] 또는 이름 + 직위 칩(대표·원장·점장·실장·경리·직원·기타) + [대표 본인/아님]. 아님이면 대표 연락처 [확보 → 번호]/[거부]/[모름]. 이름이 비고 직위가 "직원"뿐이면 빨간 안내 "직원은 반려 — 이름까지".
3. **운영 여부** — [영업중]/[문 잠김]. 문 잠김이면 근거 3묶음(하나 이상 필수): 우편물 [없음/1주/2주/3주+/수북], 간판 [유지/철거], 옆 가게 [진술 없음/인용 입력 + 빠른 문구 "N개월째 안 열었다"]. 결론 칩 [폐업 추정/일시 휴무 추정/판단 보류].
4. **독촉 내용** — 전달 방법(복수): [구두 안내] [안내문 봉함 전달] [안내문 봉함 투입]. 상대 답변: ["대표에게 전달하겠다"] [납부 약속 → 날짜] [분할 요청] [거부] [무응답] + 인용 칸. 응대자가 대표·담당자가 아니면 "금액·채무는 말하지 않았음" 확인 체크(4원칙 ②).
5. **기기 반환 요구** — 2차면 펼친 채 필수. [요구함/안 함] → 누구에게(응대자 자동), 답변 ["대표 확인 후 회신"] [반환 거부] [반환 약속] [무응답], 반환 방법 안내 [반송 주소 안내] [회수 방문 일정 협의] [안내 못함]. 1차면 접혀 있고 선택.
6. **사진 4슬롯** — ① 외부(간판+호수) ② 출입문 ③ 기기 전체+S/N ④ 안내문 부착·투입. 슬롯마다 [찍기]/[앨범] 또는 [촬영 불가 → 사유 칩: 문 잠김/거부/기타]. 600px 미만 경고.
7. **현장 판단 → 미리보기 → 보내기** — [계속 독촉]/[철수]/[소송이관] + 사유 한 줄(빠른 문구). 아래에 **반려 안 되는 문장 미리보기**, **필수 5칸 ✓/✗**, 4원칙 확인 줄. [보내기] = 저장 → 카톡.

#### 버튼 → 문장 자동 생성 (법무 X→O 예시 형식 그대로)
- 응대자: `김○○ / 점장 / 대표자 아님 · 대표자 연락처 확보(010-0000-0000)`
- 운영 여부: `문 잠김 / 우편물 3주치 적치, 간판 유지, 옆 가게 "2개월째 안 열었다" → 폐업 추정`
- 미수 독촉: `점장에게 구두 안내, 안내문 봉함 후 전달. "대표에게 전달하겠다", 납부 약속 없음`
- 기기 반환: `점장에게 반환 요구 고지, 반송 주소 안내. "대표 확인 후 회신"`
- 사진: `외부 · 출입문 · 기기+S/N · 안내문 4장` (불가 슬롯은 `기기+S/N 촬영 불가(문 잠김)`)
- 현장 판단: `소송이관 — 2차 경고 후 무응답, 폐업 추정`

#### 검증 (전송 전)
| 항목 | 1차 안내 | 2차 경고 |
|---|---|---|
| ① 응대자 이름·직위(직원만 X), 대표 아니면 대표 연락처 상태 | 막음 | 막음 |
| ② 문 잠김이면 근거 1개 이상 | 막음 | 막음 |
| ③ 기기 반환 요구(누구에게·답변·방법) | 선택 | 막음 |
| ④ 사진 4슬롯(사진 또는 불가 사유) | 경고 | 막음(D2) |
| ⑤ 현장 판단 + 사유 | 막음 | 막음 |
| 방문 시각 08~21시 밖(KST) | 경고 + 사유 필수(D3) | 같음 |
| 안내문 전달·투입인데 봉함 확인 없음 | 막음 | 막음 |
| 자유 입력에 "신용불량", "구속" 같은 표현 | 경고 | 경고 |

"아무도 없음"이면 ①은 "응대자 없음(문 잠김)"으로 충족, 대신 ② 근거 필수. 경고로 통과한 항목은 `missing` 에 남아 조회에서 "보완 필요".

#### 카톡 출력 (지역 미수방)
~~~
/미수 방문 2차(경고)
업체: ○○학원 (거래처코드 2139567243 · 임순 3004)
미수: 5개월 · 2,140,050원
방문: 2026-10-22(수) 14:20 · 작성 이민구(C)

① 응대자: 김○○ / 점장 / 대표자 아님 · 대표자 연락처 확보(010-0000-0000)
② 운영 여부: 영업중
③ 미수 독촉: 점장에게 구두 안내, 안내문 봉함 후 전달. "대표에게 전달하겠다", 납부 약속 없음
④ 기기 반환: 점장에게 반환 요구 고지, 반송 주소 안내. "대표 확인 후 회신"
⑤ 사진: 외부 · 출입문 · 기기+S/N · 안내문 4장
⑥ 현장 판단: 소송이관 — 2차 경고 후 무응답

📷 사진 4장 모아보기:
https://firstoa-inspection-finder-mg.vercel.app/?album=…
~~~
- 방: `room_map["미수|<지역>"]`. 없으면(지금 E) **저장만, 카톡 안 보냄 + "E 미수방 미정" 안내**(D4). 테스트 모드면 테스트방. `FIELD_KAKAO_SEND_ENABLED` 따름.
- 사람이 직접 누른 전송이라 "자동 발송 10시 이후" 규칙 대상 아님(다른 양식과 같음).

#### 실패 처리
- 순서: **사진 업로드 → `misu_visits` insert(id 고정) → outbox → onSent(방문집계)**. 저장 실패면 카톡 안 보냄(기록 없는 카톡 금지).
- 네트워크 끊김: 폼 상태 localStorage 초안 자동 보관(사진은 `photoStore` IndexedDB), 다시 열면 이어 쓰기. 같은 id 재시도 → 두 번 눌러도 1건.
- 사진 일부 실패: 올라간 슬롯 URL 유지, 실패 슬롯만 재시도.
- 미수 목록(시트) 못 불러오면 검색으로 진행, "미수 목록 불러오기 실패" 배지.
- 표 실행 전 배포: 42P01/404 를 잡아 "방문이력 표 준비 중 — 저장·전송 안 됨"으로 막음.

### 4-B. 조회 › 미수 — [방문 이력] (PC 우선, 폰도 동작)

1. `MisuBoard` 상단 토글이 **[전체 현황] [CS체크 목록] [방문 이력]** 3개. [전체 현황] 각 줄에도 방문 상태 칩 1개.
2. **[방문 이력] 업체 목록**: 미수 시트 업체 ∪ 방문 기록 있는 업체. 줄마다 업체·팀·개월·잔액 + **상태 칩** + 마지막 방문(날짜·차수·작성자).
3. **필터**: 팀(A~E) · 지역 · 기간(30일/90일/전체/직접) · 현장 판단 · 상태 칩 · 작성자 · 업체 검색. 정렬: 마지막 방문일/잔액/개월.
4. **업체 펼치기 → 타임라인**(최신 위): `2차 경고 · 10-22 14:20 방문 · 이민구(C) · 작성 10-22 14:35` + 판단 칩 + ①~⑥ 문장 + 사진 4 썸네일(`PhotoViewer`) + [카톡 원문] 접기 + 보완 기록은 "↳ 보완" 들여쓰기 + 숨김(작성자 본인 당일).
5. 타임라인 위 **"소송이관 준비" 체크리스트**: ⓐ 1차 안내 기록 ⓑ 2차 경고 기록 ⓒ 2차에 반환 요구 3요소(누구에게·답변·방법) ⓓ 각 방문 응대자 이름·직위(+대표 연락처 상태) ⓔ 2차 사진 4슬롯 ⓕ 판단 소송이관/철수 + 사유 ⓖ 08~21시 위반 없음. 전부 ✓ 면 **[법무 전달용 복사]**(관리부가 소송방 게시할 때 붙여넣는 요약 텍스트).
6. 아래 회색 **"이전 기록(카톡·관리부 메모)"**: `misu` 의 `카톡:미수` 행(입력일·입력자·원문) + 시트 `_raw` 의 경영체크·전략체크·CS체크 메모. 업체 펼칠 때만 그 업체 것만 조회. 체크리스트엔 안 셈(D10).

#### 상태 칩 (업체당 하나, 위가 우선)
`소송이관 준비 완료` > `보완 필요`(missing 있음) > `반환요구 기록 있음` > `2차 완료` > `1차만` > `방문 기록 없음`.

---

## 5. 관리부·법무 연결 — FIELD 가 맡는 범위

| 단계 | 담당 | FIELD |
|---|---|---|
| 1 유선 독촉(1~3개월) | 관리부 | **범위 밖.** 시트 메모를 이전 기록으로 보여 줄 뿐 |
| 2 1차 안내 → 2차 경고 방문(4개월~) | **CS** | **이번 범위 — 작성기 + 이력** |
| 3 최종고지(해지·반환 요구·이관 예정 통보) | 관리부 | 범위 밖 |
| 4 방문접수 → 철수접수 | CS 접수 완료 확인 후 관리부가 선행방 | **확인 근거만**: 조회의 '2차 완료/준비 완료' 칩이 "CS 방문접수 끝났나"의 답. 선행방 철수접수 자동 생성 안 함 |
| 5 소송방 이관(관리부 게시, 법무 3영업일) | 관리부·법무 | 범위 밖. [법무 전달용 복사]까지만 |

관리부 미수 시트 CS-1회/CS-2회 칸 자동 기입은 **이번엔 안 함**(남의 데이터는 보는 창으로 — 2026-10-03 원칙). 필요하면 관리부 동의 후 GAS 별도 작업(D5).

---

## 6. 작업 분해 (파일이 겹치지 않게, 총 6명)

**1차 병렬 (3명)**
| 역할 | 할 일 | 건드릴 파일 |
|---|---|---|
| 데이터실 표다빈 (db-schema) | `misu_visits` 표·인덱스·RLS·revoke/grant(S,I,U)·머리 주석. 실행은 sql-review(권한나) → /sql-handoff. 실행 대기 목록에 기록 | `supabase/misu-visits.sql` (새) |
| 디자인실 윤화면 (ui-designer) | 작성기 7단계(폰 375px, 단계 접기, 칩·슬롯·검증 표시 — 빨강은 '막음'에만) + 조회 목록·타임라인·체크리스트. **props 만 받는 view 컴포넌트**(DeptReceptionForm.view 패턴) | `src/MisuVisitForm.view.tsx`, `src/MisuVisitHistory.view.tsx` (새) |
| 개발실 구현서 A | 순수 로직: 타입, 빈 폼, 차수 제안, **문장 생성기**, 검증(막음/경고 표), KST 08~21시 판정, 금지 표현 검사, 카톡 텍스트, 업체 키 정규화·묶기, 체크리스트·상태 칩 계산 + 테스트 | `src/misuVisit.ts`, `tests/misuVisit.test.ts` (새) |

**2차 병렬 (2명, 1차 끝난 뒤)**
| 역할 | 할 일 | 건드릴 파일 |
|---|---|---|
| 구현서 B | 저장·조회 API(supabase.ts 래퍼만, id 고정 insert, 방 결정, outbox, 슬롯 사진 업로드·앨범, 미수 시트 목록 읽기), 작성기 컨테이너(상태·초안·제출·onSent), App 연결 | `src/misuVisitApi.ts`, `src/MisuVisitForm.tsx` (새), `src/App.tsx`(아래 줄만) |
| 구현서 C | 조회 컨테이너(misu_visits + misu 시트·카톡 행 + misu_cs_checks 합치기, 필터, 복사), `MisuBoard` 에 [방문 이력] 토글·상태 칩 연결, 백업 목록 | `src/MisuVisitHistory.tsx` (새), `src/MisuOverageBoards.tsx`(MisuBoard 함수 안만), `tools/worker/backup_tables.py`(목록 1단어) |

`src/App.tsx` 수정(구현서 B만, 5줄 안팎 — "진입점 1~3줄" 규칙 예외, 팀장 승인 필요):
1. `isCat` 에서 `mode === "misu"` 제거.
2. `{mode === "misu" && <MisuVisitForm … bindSubmit onReadyChange onSent />}` 한 줄(lazyScreen 지연 로드).
3·4. 보내기 버튼 2곳의 `mode === "praise"` 조건에 misu 추가(같은 ref 패턴).
5. 미수 모드에서 공용 사진함 버튼 숨김 조건 1곳.
`photoAlbumContext`·`recordOperation` 의 misu 분기는 그대로.

**3차**: 품질실 검수아 (qa-checker) — `npm run build`·`npm test`, §7 회귀 목록, 폰 375px 확인, 테스트 모드 카톡 출력 1건.

**건드리지 말 것**: `src/DataLookup.tsx`, `src/region.ts`, `src/sso.ts`, `src/ssoBoot.ts`, `src/PcForm.tsx`, `src/CopierExpansionForm.tsx`, `src/CategoryForm.tsx`, `src/categoryForms.ts`, `src/api.ts`, `apps-script/**`, `gas-and-bot/**`, `tools/kakao-pc/**`, 기존 `supabase/*.sql`.

---

## 7. 회귀 위험

| 위험 | 대응 |
|---|---|
| 불만·재계약·초과조정 폼이 `isCat` 변경으로 깨짐 | misu 만 빠짐. QA 가 3종 테스트 모드 전송 각 1건 |
| `categoryForms.misu`·`sendCategoryForm` misu 분기가 남아 혼동 | 호출 경로 없음. 1 릴리스 뒤 정리 |
| 기존 미수 기록 손실 | **웹앱 미수 기록은 이미 0행**(미러가 지움) — 옮길 것 없음. `misu` 표·미러·[전체 현황]·[CS체크 목록]·워킨맵/일정리스트 미수 배지(vendorFlags, WalkingMap) 무변경 |
| E 지역이 테스트방으로 새던 문제 | 새 경로는 테스트방 폴백 금지. 옛 경로(api.ts)는 손대지 않음 |
| 표 실행 전 배포 | 404/42P01 → "표 준비 중, 저장·전송 안 됨"(카톡만 나가는 일 없게) |
| App.tsx 동시 수정(SSO·지역 작업 중) | 구현서 B 는 위 5줄만, 작업 직전 `git diff src/App.tsx` 확인 후 최소 패치 |
| 조회 속도 | misu_visits 는 기간 필터 조회, 카톡 옛 행은 업체 펼칠 때 그 업체만(`_업체명` 인덱스 있음) |
| 개인정보(대표 연락처)가 카톡방·표에 남음 | 현행 미수방 관행과 같음 — D11 |

---

## 8. 열린 결정 (사용자에게 한 번에) — 팀장 제안값

| # | 질문 | 제안 |
|---|---|---|
| D1 | 방문이력을 새 표 `misu_visits` 에(기존 `misu` 는 매일 밤 시트로 통째 덮어써져 웹앱 기록이 남지 않음) | **새 표** |
| D2 | 2차 경고에서 사진 4장이 안 채워지면 | **막음, 단 슬롯별 '촬영 불가 사유'를 고르면 통과**. 1차는 경고만 |
| D3 | 방문 시각이 08~21시 밖이면 | **경고 + 사유 필수**(전송 허용, 기록에 표시). 법무가 "막아라"면 막음 |
| D4 | E 지역 미수 카톡방 이름 | 방 이름 주면 `room_map` 추가(/room-add). **그 전엔 E 는 저장만, 카톡 안 보냄** |
| D5 | 관리부 시트 CS-1회/CS-2회 칸 자동 기입 | **이번엔 안 함**(남의 시트). 관리부 요청 시 GAS 별도 |
| D6 | '소송이관 준비 완료' 기준 = §4-B 5번 ⓐ~ⓖ | **이대로**, 법무팀 한 번 확인 |
| D7 | 업체 고르기 출발점 | **관리부 미수 목록(시트) 먼저**, 없으면 거래처 검색. 차수 자동 제안 |
| D8 | 잘못 쓴 기록 수정 | **수정 불가, '보완 기록' 새로 추가**(원 기록에 연결). 숨김은 작성자 본인 당일만 |
| D9 | 조회 열람 범위 | **지금처럼 앱 사용자 전체**(권한 분리는 SSO 2단계) |
| D10 | 옛 카톡 미수 기록 8,086건(2023-11~2026-06)을 타임라인에 | **회색 '이전 기록'으로 함께**, 체크리스트엔 안 셈 |
| D11 | 대표자 연락처를 카톡 미수방에 그대로 | **그대로**(현행 관행). 가리라면 끝 4자리만 |
| D12 | 독촉 안내 버튼 문구 | **법무팀 표준문안**을 받아 칩 문구로. 받기 전엔 §4-A 4번 칩으로 시작 |

---

## 9. 하지 않을 것 (범위 밖)

- 관리부 단계(1·3·5) 화면, 선행방 철수접수 자동 생성, 소송방 게시 자동화.
- 관리부 미수 시트·GAS 미러 수정(`misu` 적재 방식 변경 포함), `misu_cs_checks` 쓰기.
- `misu` 표 컬럼 변경·옛 행 이관, `categoryForms.misu` 삭제(후속).
- 통합 검색 360·통합이력(UnifiedHistory)·data-ask 에 `misu_visits` 연결(후속 후보).
- 카톡 미수방 수집(`카톡:미수` 행이 2026-06-23 이후 없음 — 봇/GAS 수집 멈춤으로 보임, 별도 확인 과제: ops-monitor → debugger).
- 거래처 3단 구조(site_company) 구축 — 키 열만 저장.
- 위치(GPS) 기록, 고객 서명, 문자/알림톡 자동 발송.
