# 필드 탭 검색: 맨 위 검색칸 대신 🔍 아이콘 + FIELD 기록·카톡 대화 한 목록 (설계안, 2026-10-25)

작성: 기획실 한설계(feature-planner). 조사만 했고 코드는 0줄. 상위 설계는 docs/tasks/tab-search-kakao-history.md(1·2단계)이고, 이 문서는 그 화면 배치와 결과 목록만 바꾼다.
제안자: 사용자(2026-10-25 밤) 2건. (1) 맨 위 가로 검색칸은 빼고 탭마다 상단에 🔍 아이콘을 둔다. (2) [FIELD 기록|카톡 대화] 두 칸을 없애고 한 목록으로 합치되, 표에 이미 있는 카톡 글은 숨긴다.

---

## 1. 한 줄 목표와 쓰는 사람

- 목표: 필드 탭에서 이 업체의 지난 기록을 찾는 길을 **헤더 🔍 하나**로 줄이고, 결과는 **한 목록**(구조 기록 + 표에 없는 카톡 대화만)으로 보여 준다.
- 쓰는 사람: 현장 기사(폰 390px, 대부분 이 사람), CS 관리자(PC). 고객은 쓰지 않는다.
- 왜: 지금은 점검·AS 탭 한 화면에 업체 검색 입구가 셋이다. 헤더 🔍(VendorSearch), 헤더 🗂️ 이력(UnifiedHistory), 맨 위 검색칸(TabSearchBar). 결과도 두 칸으로 나뉘어 있어 사용자가 헷갈린다고 했다.

## 2. 지금 상태 (조사 결과)

| 입구 | 위치 | 보이는 탭 | 하는 일 |
|---|---|---|---|
| 🔍 거래처검색 | src/App.tsx 5291~5294 헤더 아이콘 줄 | inspection·air-purifier·blank-report | searchOpen → 팝업 6036~6075. 청정기는 AirSearch, 나머지는 VendorSearch |
| 🗂️ 통합이력 | App.tsx 5287~5288 | 모든 탭 | UnifiedHistory 팝업(업체 전체 업무) |
| 맨 위 검색칸 | App.tsx 5532 TabSearchBar (lazy, 102줄) | tabKeyOf(mode, pcSubTab) 가 null 이 아닌 모든 탭 | entity360 후보 → runTabSearch → 그 탭 표만 타임라인 → [FIELD 기록/카톡 대화] 칸 |

- VendorSearch(src/VendorSearch.tsx 370줄)는 api.searchVendors로 업체를 찾고, getInspForms로 **점검 최근 6건과 AS 최근 4건**을 카드로 보여 준다(미리보기·[불러오기], 지역·종류 칩). 기기 식별(getVendorIdentifiers)도 같이 한다. 그보다 오래된 기록과 방문기록(visit_logs)은 보여 주지 않는다.
- TabSearch의 점검·AS 탭 결과에는 jeomgeom·visit_logs·as_records가 전부 들어 있고, 오늘(10-25) [불러오기]가 붙었다(loadableFormText, 같은 handleLoadForm). 그래서 **점검·AS 최근 10건이 두 입구에 똑같이 나온다**. 사용자가 말한 중복이 이것이다.
- 카톡 칸 KakaoPane(TabSearch.view.tsx 128~185)은 자기 검색어를 따로 갖고, 칸을 누를 때만 엣지 kakao-search를 부른다. 엣지는 기본으로 is_bot=false라서 **FIELD가 봇으로 올린 양식 글은 이미 빠져 있다**. 남는 중복은 사람이 카톡방에 직접 쓴 양식 글이고, 이 글은 GAS 구조 적재(kakao-collect-expand 3-2)로 jeomgeom·as_records·logistics_records·bulman·recontract·misu에 _원문과 함께 들어간다.
- kakao_messages.kind_guess 값은 _shared/kakao-parse.ts guessKind가 붙인다. 종류는 form:점검·form:AS·form:물류·form:불만접수·form:계약갱신·form:미수방문·form:초과조정·share(FIELD 링크)·media(사진 자리)·chat이다. "라벨: 값" 줄이 3개 이상이어야 form:*가 된다.
- 스위치 KAKAO_SEARCH_ENABLED는 꺼져 있다(기본). kakao_messages SQL이 실행됐는지는 AGENTS에 "실행 대기"로 남아 있다. 그래서 **카톡 중복률은 실측할 수 없다**(6절 R2).

## 3. 기존 코드 재사용·확장 지점

| 무엇 | 파일:함수 | 이번 처리 |
|---|---|---|
| 헤더 아이콘 줄 | App.tsx 5291 🔍 단추 조건 | 조건을 tabKeyOf(mode, pcSubTab)로 넓힌다(1줄) |
| 검색 팝업 틀 | App.tsx 6036~6075 | 새 파일 src/field/FieldSearchSheet.tsx로 옮기고 App에는 1줄만 남긴다 |
| 점검·AS 업체 찾기·불러오기 | VendorSearch(그대로) | 그대로 둔다. 아래에 "더 지난 이력" 칸만 붙인다 |
| 청정기 | AirSearch(그대로) | 그대로 두고 아래에 TAB_SPECS.air 이력 칸을 붙인다 |
| 탭 표 수집·줄 만들기 | src/tabSearch.ts runTabSearch·toLines·filterByChip·lastEvents·coverageOf | 그대로 쓴다. 카톡 병합 순수 함수를 새로 추가한다 |
| 상태·조회 연결 | src/TabSearchBar.tsx | 훅 useTabSearch로 뽑아(새 파일 src/useTabSearch.ts) 팝업이 쓴다. TabSearchBar.tsx는 지운다 |
| 결과 줄 표시 | src/TabSearch.view.tsx 결과 줄·펼침·[불러오기] | 줄 컴포넌트는 그대로 쓴다. 맨 위 가로 입력·두 칸 탭·KakaoPane은 지운다 |
| 카톡 조회 | tabSearch.searchKakao(엣지 kakao-search) | 그대로 쓴다. 검색어는 picked.name이 아니라 entity.core로 넣는다(4-2) |
| 불러오기 | App handleLoadForm(t, {silent:true}) | 그대로 쓴다(VendorSearch와 타임라인이 같은 함수) |

## 4. 데이터 설계

SQL은 0이다. 새 표와 새 열은 만들지 않는다. 엣지 kakao-search 응답도 **필수 변경이 없다**. 필요한 열 id·room·sent_at·seq·author·text·kind_guess·is_bot이 이미 다 온다. hash는 프런트에서 쓸 데가 없어 받지 않고, 줄 키는 kakao:{id}로 한다.

### 4-1. TabLine 확장(tabSearch.ts)
- source?: "field" | "kakao" 를 추가한다. 없으면 field로 본다(기존 테스트 호환).
- 카톡 줄 값은 다음과 같다.
  - table kakao_messages, kind "카톡", tone 회색.
  - date는 KST 날짜(kakaoTimeLabel 앞 10자). time은 시:분.
  - title은 본문 첫 줄 60자. author는 대화명. detail은 방 이름. raw는 본문 전체(이미 가림).
  - loose: 업체 키가 일치하지 않으면 true(4-3).

### 4-2. 카톡 검색어
- 지금 KakaoPane은 picked.name("(주)건영테크")을 그대로 넣는다. 엣지가 text_key(기호를 뺀 글) 부분 일치로 찾으므로 "주건영테크"로 찾게 되고, 카톡에 "건영테크"라고만 쓴 글은 **빠진다**.
- 그래서 entity.core(coreNameOf, 법인 표기를 뺀 핵심 이름)로 바꾼다. core가 2자 미만이면 카톡은 부르지 않는다.

### 4-3. 중복 판정: 후보 비교와 추천

비교 전제: 봇 글(FIELD 발송분)은 엣지에서 이미 빠진다. 따라서 남는 중복은 사람이 쓴 양식 글이 GAS로 표에 들어간 경우뿐이다.

| 후보 | 규칙 | 정밀도(숨긴 것이 진짜 중복인가) | 재현율(중복을 다 숨기나) | 문제 |
|---|---|---|---|---|
| ① kind_guess | form:*·share·media면 숨김 | 중간 | 높음 | 파싱에 실패해 "확인필요"로 남은 양식 글, 즉 **표에 없는 글까지 숨긴다**. 사용자가 원한 "표에 없는 것만 추가"와 반대다 |
| ② 같은 방·날·업체·작성자 | 같은 날 같은 업체 표 기록이 있으면 숨김 | **낮음** | 중간 | "내일 10시 방문 예정" 같은 진짜 대화가 그날 양식 1건 때문에 사라진다. 카톡 대화명("퍼스트 김OO 프로")과 FIELD 작성자 이름이 달라 작성자 비교도 믿을 수 없다 |
| ③ 본문 앞 80자 일치 | 정규화(소문자, 숫자·영문·한글만, **숫자도 제거**해 가림 010-****-5678 차이 흡수) 앞 80자가 표 줄 raw(_원문)의 정규화 앞 80자와 같으면 숨김 | **매우 높음** | 중간~높음 | 사람이 고쳐 쓴 글, 앞머리에 인사를 붙인 글은 놓친다. 표 6종 모두 _원문이 있어 비교 대상은 있다 |

**추천: ③을 주 규칙으로 하고 ①을 문지기로 쓴다.** 숨기는 조건은 아래 둘 중 하나다.
1. kind_guess가 share나 media면 항상 숨긴다(링크·사진 자리라 내용이 없다).
2. kind_guess가 form:*이고, 다음 중 하나가 같은 탭 결과에 있으면 숨긴다.
   - (a) 앞 80자가 일치하는 표 줄.
   - (b) **같은 KST 날짜 ±1일이고, 정확 일치(loose=false)이고, 같은 종류**인 표 줄. 종류 대응은 form:점검→jeomgeom·visit_logs, form:AS→as_records, form:물류→logistics_records·as_tickets·activity_events, form:불만접수→bulman, form:계약갱신→recontract, form:미수방문→misu·misu_visits, form:초과조정→overage_adjust.
- chat은 **절대 숨기지 않는다**. 카톡끼리 같은 방·같은 사람·같은 본문이 ±2분 안이면 한 줄로 접는다(원 설계 R5).
- 숨긴 줄은 버리지 않는다. 목록 맨 아래에 "표에 이미 있는 카톡 글 n건 숨김 [보기]"를 두고, [보기]를 누르면 회색 줄로 펼친다. 판정이 틀려도 사용자가 되찾을 수 있다.
- 남는 카톡 줄 배지는 "카톡"이고, 줄 아래 작은 글씨로 "표에 없는 대화 · 방 이름"을 단다. form:*인데 남은 줄은 "표에 안 들어간 양식 글"로 표시한다. 이건 GAS 파싱 누락 신호라 운영에도 쓸모가 있다.

병합 함수 위치는 **src/tabSearch.ts mergeKakaoLines(tab, lines, hits, e) → { lines, hidden }** 이다. React가 없는 순수 함수라서 테스트로 고정한다. 보조 함수 kakaoToLine(hit, e), dupKey80(text), KAKAO_FORM_TABLES도 같은 파일에 둔다.

## 5. 화면 흐름

1. 필드 어느 탭이든 헤더 오른쪽 아이콘 줄에 **🔍 검색**이 있다. 테스트 탭처럼 tabKeyOf가 null인 탭에는 없다. 위치는 지금 점검 탭과 같은 자리다.
2. 🔍을 누르면 아래에서 시트가 올라온다(PC는 가운데 팝업, 틀은 지금 거래처검색과 같다). 머리 제목은 "{탭 이름} 이력 검색"이고 안내는 spec.question이다.
3. 탭별로 갈린다.
   - **점검·AS·빈 리포트**: 지금 VendorSearch 그대로다(업체 고르기 → 최근 점검 6·AS 4 카드 → 미리보기·[불러오기]). 업체를 고르면 그 아래에 "더 지난 이력" 목록이 자동으로 이어진다. 이 목록은 visit_logs와 카드에 없는 jeomgeom·as_records, 그리고 카톡이다. 카드와 같은 기록은 _원문 글이 같으면 뺀다(InspForm에 id가 없어서 글로 비교한다).
   - **청정기**: AirSearch 그대로 두고 아래에 air 이력 목록을 붙인다.
   - **그 밖의 탭**: 검색칸 → 업체 후보(entity360, 최대 5곳) → 고르면 한 목록이 나온다. 맨 위 한 줄은 "마지막 납품 …" 요약이고, 칩은 점검·AS처럼 spec에 있을 때만 보인다.
4. 목록은 **날짜 내림차순 한 줄씩** 나온다. 같은 날이면 FIELD 줄이 먼저다. FIELD 기록은 흰 바탕에 종류 배지, 카톡 줄은 회색 바탕에 "카톡" 배지다. 줄을 누르면 펼쳐져 원문·같은 업체 최근 n건이 보인다. 점검·AS 기록 줄에는 [불러오기]가 있다.
5. 맨 아래에는 "찾아본 곳"(coverage), "표에 이미 있는 카톡 글 n건 숨김 [보기]", 카톡 상태 한 줄이 있다(5-1).
6. [불러오기]를 누르면, 입력 중인 글이 있을 때만 덮어쓰기를 확인하고, 양식에 넣은 뒤 시트를 닫고 양식 카드로 스크롤한다(지금 TabSearchBar.loadLine과 VendorSearch 동작을 하나로 맞춤).
7. 시트를 닫았다 다시 열면 같은 탭에서는 마지막 업체와 결과가 남아 있다(상태는 App이 아니라 FieldSearchSheet가 탭별로 기억). 탭을 바꾸면 비운다.

### 5-1. 카톡 스위치가 꺼진 동안
- 카톡을 부르지 않는 게 아니다. 처음 1회 불러서 enabled:false가 오면 같은 세션 동안 다시 부르지 않는다(sessionStorage 기억).
- 목록은 FIELD 기록만 나오고, 맨 아래 회색 한 줄 "카톡 원문 검색은 꺼져 있습니다(관리자가 켬)"가 붙는다. 배지나 숨김 안내는 나오지 않는다.
- 그 탭에 카톡 방 종류가 없으면(spec.kakaoKinds 없음: IT·복합기 확장성·담당자 변경·칭찬) 카톡을 부르지 않고 안내도 내지 않는다.
- 카톡 조회가 실패해도(네트워크, 429, 500) FIELD 목록은 그대로 보인다. 맨 아래에 "카톡 대화를 못 불러왔습니다 [다시]" 한 줄만 둔다. 카톡은 FIELD 조회와 병렬로 돌리고, 늦게 오면 목록에 끼워 넣는다(요청 번호로 낡은 응답은 버림).

## 6. 위험

- **R1 같은 사무실 IP 분당 30회 제한.** 지금은 카톡을 칸을 누를 때만 부르지만, 합치면 **업체를 고를 때마다** 부른다. kakao-search의 rateLimited는 IP 단위라 사무실 PC들이 같은 공인 IP 하나를 함께 쓰면 30회/분에 걸려 429가 난다.
  - 대응 1: 프런트는 결과 캐시(같은 탭·같은 core는 5분)를 둔다.
  - 대응 2: 엣지 한도 키를 "ip|who"로 바꾸고 한도를 60으로 올린다(엣지 3줄, 선택). 원 설계 R1의 "통째 긁기 방지"는 검색어 필수와 200줄 상한이 여전히 지킨다.
- **R2 중복 판정을 실측할 수 없다.** kakao_messages가 비어 있거나 스위치가 꺼져 있어 정밀도·재현율 숫자가 없다. 그래서 숨긴 줄을 [보기]로 되찾게 하는 것이 안전장치다. 스위치를 켠 뒤 1주 동안 "숨김 n / 남김 n / form인데 남김 n"을 세어 규칙 (b)의 ±1일을 조정한다(세는 방법은 엣지 로그 한 줄, 선택).
- **R3 점검·AS 업체 찾기 엔진이 둘이다.** VendorSearch는 api.searchVendors(점검·AS 표 색인), 이력 목록은 entity360(임대리스트·마스터)으로 업체를 찾는다. VendorSearch에서 고른 이름으로 buildEntity(null, name)을 만들면 거래처 코드가 비어 코드 일치를 못 쓴다. 이름 일치만 남아 다른 업체 줄이 loose로 섞일 수 있다.
  - 대응: 이름 → resolveCandidates 첫 후보가 이름 키(sameVendorKey)로 같을 때만 그 후보를 쓰고, 아니면 null로 둔다.
- (참고) 🗂️ 이력(UnifiedHistory, 업체 전체 업무)과 🔍(이 탭 업무만)이 같은 아이콘 줄에 남는다. 이번 범위에서는 그대로 두고, 합칠지는 Q2로 묻는다.

## 7. 작업 분해 (서로 겹치지 않게)

| 담당 | 할 일 | 파일 | 규모 |
|---|---|---|---|
| ui-designer 윤화면 | 시트 머리·검색칸·후보·목록 한 줄(FIELD 흰 / 카톡 회색·배지)·숨김 안내·스위치 꺼짐 줄 시안, 390px 기준. 점검·AS의 "카드 + 더 지난 이력" 구분선 | 시안만(이 문서 부록으로 회신). 코드 파일은 건드리지 않는다 | 작음 |
| db-schema 표다빈 | **할 일 없음**(SQL 0) | — | — |
| 구현 A 구현서(로직) | ① TabLine.source·time ② kakaoToLine·dupKey80·KAKAO_FORM_TABLES·mergeKakaoLines ③ 카톡 검색어 kakaoQueryOf(e) = core ④ 테스트 | src/tabSearch.ts(+약 90줄), tests/tabSearchMerge.test.ts(새, 약 20케이스) | 중 |
| 구현 B 구현서(화면) | ① TabSearchBar 상태를 useTabSearch(tab) 훅으로 옮김(+카톡 병렬 조회·세션 off 기억·5분 캐시) ② 새 FieldSearchSheet(팝업 틀 + 탭별 분기: inspection→VendorSearch+이력, air→AirSearch+이력, 나머지→검색칸+이력) ③ TabSearch.view에서 맨 위 가로 입력·두 칸 탭·KakaoPane을 빼고 목록 컴포넌트를 TabSearchResults로 export ④ TabSearchBar.tsx 삭제 ⑤ (선택) kakao-search 한도 키·60 | src/useTabSearch.ts(새, 약 140줄), src/field/FieldSearchSheet.tsx(새, 약 150줄), src/TabSearch.view.tsx(약 −90 +20), src/TabSearchBar.tsx(삭제), supabase/functions/kakao-search/index.ts(선택 3줄) | 중 |
| 구현 B, App.tsx 3곳 | (a) 5291 🔍 조건 → !!tabKeyOf(mode, pcSubTab) (b) 6036~6075 팝업 블록을 FieldSearchSheet 한 줄로(props: open·onClose·mode·pcSubTab·seed=searchSeed·accent·onLoadForm=handleLoadForm·onVendor·hasDraft·onError) (c) 5532 TabSearchBar 줄과 102 lazy import 삭제 | src/App.tsx | 순감 약 −35줄 |
| qa-checker 검수아 | npm run build·npm test. 회귀 확인: 워킨맵 F에서 업체명으로 검색 팝업 시작(searchSeed), 청정기 AirSearch, 사진·원본 아이콘 그대로, tabSearch*.test 3개 통과(KakaoPane 관련 기대는 merge 테스트로 옮김), 390px에서 아이콘 줄이 넘치지 않음(점검 탭 4개), 테스트 탭에 🔍 없음, 스위치 off 응답 모킹 시 FIELD 목록만 + 안내 1줄 | — | — |
| 매뉴얼(구현 B 끝에) | user/00-common-rules.md 48줄 "맨 위 검색칸" → "헤더 🔍", user/03-field-inspection-as.md 16줄, user/04·05 해당 탭 줄, ops/05-edge-functions.md(한도를 바꾼 경우) | docs/manual/* | 작음 |

mergeKakaoLines 테스트 목록:
- share·media 숨김.
- form 글 80자 일치 숨김, 숫자 가림 차이 흡수.
- form 글 ±1일·같은 종류 숨김. 다른 종류나 loose 줄로는 안 숨김.
- chat은 같은 날 양식이 있어도 유지.
- ±2분 같은 글 접기.
- 날짜 정렬(같은 날 FIELD 먼저).
- hits가 비면 원래 lines 그대로.

순서: 구현 A와 디자인 시안을 병렬로 → 구현 B(A의 함수 사용) → QA. A는 tabSearch.ts와 테스트만, B는 그 밖이라 파일이 겹치지 않는다.

## 8. 사용자에게 물을 것 (2개)

- **Q1 점검·AS 🔍 팝업의 "더 지난 이력"에 카톡까지 넣을까요?** 넣으면 팝업 하나로 양식 카드, 지난 기록, 카톡이 다 보인다. 대신 팝업이 길어진다. 제안: 넣되 접힌 상태로 둔다("더 지난 이력 n건 ▸").
- **Q2 🗂️ 이력(업체 전체 업무)과 🔍(이 탭 업무)을 그대로 둘까요?** 제안: 이번에는 둘 다 둔다. 헷갈린다는 말이 다시 나오면 🗂️을 🔍 시트 안 [모든 업무] 칩으로 넣는 것을 다음 단계로 한다.

## 9. 하지 않을 것

- SQL·표 변경, kakao_messages 열 추가, 엣지 응답 모양 변경.
- 스위치 KAKAO_SEARCH_ENABLED 켜기(직원 고지 뒤 사용자 결정).
- VendorSearch 내부(업체 찾기 엔진·카드·지역 칩) 수정, UnifiedHistory 수정·통합.
- 통합 검색 360(조회 화면) 쪽 변경. 카톡 합치기는 필드 🔍에서만 한다.
- 양식 패널(src/field/*Panel, FieldFormShell)에 아이콘 넣기. 팀장 안은 양식 제목 옆이었지만 헤더 아이콘 줄 한 곳으로 통일한다. FieldFormShell에는 제목 칸이 없어서 패널 파일 10여 개를 고쳐야 하고, 지금 🔍 자리와 달라 또 다른 입구가 생긴다.
