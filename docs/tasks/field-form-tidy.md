# 필드 탭 양식 정돈 — App.tsx 양식 패널 분리 (설계안)

2026-10-24 · 기획실 한설계(feature-planner) · 조사만, 코드 0 · 기준 커밋 745c7aa · 선행: docs/tasks/ui-tidy-audit-2026-10-24.md A1~A5(2차로 미룬 항목)

## 1. 목표와 쓰는 사람
점검·AS·청정기 양식을 App.tsx 밖 새 파일로 **글자 하나 바꾸지 않고 옮긴 뒤**, 새 파일 안에서 3중 상자를 "한 장의 종이"로 정돈한다. 쓰는 사람은 현장 기사(폰, 390px 기준)이고, PC로 쓰는 관리자는 오른쪽 미리보기와 함께 본다.

## 2. 조사 결과 (재사용·확장 지점)
**핵심 발견: 일이 생각보다 작다.** 필드 탭 양식 10종 중 8종은 이미 따로 떨어진 파일이다(PcForm·CopierExpansionForm·LogisticsForm·ReplacementForm·ContactChangeForm·PraiseForm·MisuVisitForm·CategoryForm). App.tsx 안에 남은 양식은 2개뿐이다.
- `ProcessingFormPanel`(App.tsx:3530~3982, 점검·AS 공용, 약 450줄)과 `AirPurifierFormPanel`(3984~4107). 둘 다 **이미 `App()` 바깥의 최상위 함수**이고, props 계약(`ProcessingFormPanelProps` 26개, `AirPurifierFormPanelProps` 5개)으로 상태를 받는다. 상태는 App에 있고 화면은 콜백만 부른다.
- 그래서 "블록을 `<X … />` 한 줄로 교체"할 필요도 없다. 호출부(6908~6948)는 **그대로 두고**, 정의를 지운 뒤 import 1줄만 넣으면 된다.
- 작성자 상태(`handleSetAuthor`), 사진(`photos`·`handlePhotoSelect`), 전송(`handleSendAll`·`openSendPicker`), `resetAfterSend`(5835), `recordFieldOperations`(5360), `TabSearchBar`(6807, +2줄)는 모두 `App()` 본문에 있다. 패널 이사와는 얽히지 않는다.
- 패널이 끌고 가야 하는 것(App.tsx 안, 줄 번호는 745c7aa 기준)
  | 대상 | 위치 | 다른 곳에서도 쓰나 | 이사 방법 |
  |---|---|---|---|
  | 타입 `PerItemForm`·`SharedForm`·`AirPurifierForm`·`DeviceInfo`, `EMPTY_DEVICE_INFO` | 2031·2066·2183·3069~3070 | App 본문·파서가 씀(27·28·10회) | 새 파일에서 export하고 App이 import한다 |
  | 상수 `HANTIN_OPTIONS`~`YESNO_OPTIONS`·`TONER_COLORS` | 2951~2965 | 패널만 씀 | 함께 옮긴다 |
  | `SpareToken`·`SPARE_TOKENS`·spare 순수 함수 7개 | 2294~2357 | App 본문 4323~4332도 씀 | 순수 모듈로 옮기고 App이 import한다 |
  | `SpareQuickEditor` | 2358 | 패널만 씀 | 옮긴다 |
  | `NumSelect` | 2967~3068 | 패널만 씀(11곳) | 옮긴다 |
  | `DevicePicker` | 3072~3188 | 패널만 씀 | 옮긴다 |
  | `AuthorPicker`·`AuthorPickerModal`·`SsoRow`·`PickerRow`·`EXTERNAL_GROUP` | 3189~3528 | `AuthorPickerModal`을 App 6356(상단 사용자 고르기)도 씀 | 옮긴 뒤 export하고 App이 import한다 |
  | `CounterOcrButton` + 모듈 변수 `ocrFlag` | 3559~3598 | 패널만 씀 | 변수와 함께 옮긴다 |
- 따를 패턴: `DeptReceptionForm.view.tsx:118`의 "한 장의 종이"(머리띠 없이 섹션 라벨과 구분선으로 나눔), `MisuVisitForm`/`.view` 로직·표시 분리, `src/ui/card.ts`의 `UI.card`·`UI.section`·`UI.label`·`UI.input`·`UI.btn`/`btnGhost`. 앞서 App.tsx에서 함수를 옮긴 선례로 `fieldModes.ts`·`inspectionBlocks.ts`·`ids.ts`가 있다.
- 검사 위험: `tests/catSendReset.test.ts`는 App.tsx **원문 문자열**을 읽는다(`if (isCat) {…sendCategoryForm(`, `const resetAfterSend = () => {`). 이번 이사는 그 블록을 건드리지 않지만, 들여쓰기·줄을 바꾸면 깨진다.

## 3. 데이터 설계
없다. SQL 0, 표 0, 엣지 함수 0. 양식 → `applyProcessingFormV2`/`applyAirPurifierForm` → 카톡 본문으로 이어지는 경로는 App에 그대로 남는다. **보내는 글자는 바뀌지 않아야 한다.**

## 4. 화면 흐름 (정돈 뒤, 점검·AS)
1. 필드 탭에서 점검 또는 AS를 고른다(바뀌지 않음).
2. 카드 1장이 나온다. 머리 줄에 작성자·지역·구분·레벨이 있고, 회색 박스 대신 글자 라벨만 둔다.
3. 구분선 아래에 기기 선택, 처리내용, 매수, 잔량, 여분이 이어진다. 칸마다 `UI.label` 글자 라벨을 붙이고 회색 바탕은 없앤다.
4. 구분선과 함께 "추가 정보" 라벨을 두고 한틴이카·주차비·특이사항을 놓는다.
5. 구분선과 함께 "부품·자가·시간" 라벨을 두고, 부품신청·자가신청 접기와 도착·소요 시간을 놓는다.
6. 미리보기와 보내기 단추는 그대로다(PC는 오른쪽, 폰은 아래 고정). 단추 정돈은 S7에서 따로 한다.

## 5. 작업 분해 (단계표: 한 단계 = 커밋 1개, 앞 단계가 통과해야 다음으로)
S1~S5는 **순수 이사**다. 동작·글자·클래스가 바뀌면 안 된다. 바뀐 점은 `export` 키워드와 import 줄뿐이어야 한다. 화면을 실제로 고치는 일은 S6부터 한다.

| 단계 | 누가 | 새 파일(src/field/) | App.tsx 변경 | 무회귀 확인 |
|---|---|---|---|---|
| S0 | 검수아 | — | 0 | 정돈 전 캡처(폰 390·PC 1440, 점검·AS·청정기·기기 2대)를 docs/tasks/field-form-tidy/ 에 둔다. 기준선은 `npm test` 1092 통과 |
| S1 | 구현서 | `fieldFormModel.ts`(타입 4개·`EMPTY_DEVICE_INFO`·옵션 상수·`TONER_COLORS`·spare 순수 함수) | 정의를 지우고 import 1줄 | tsc 종료코드 0 + 전체 테스트(특히 inspectionBlocks·quickInput·formRegion·inspectionReport·supplyMode·catSendReset). 새 `tests/spareTokens.test.ts`로 `spareTokenCount`·`changeSpareToken`을 고정한다(지금은 테스트 없음) |
| S2 | 구현서 | `NumSelect.tsx`·`SpareQuickEditor.tsx`·`CounterOcrButton.tsx` | 지우고 import 1줄(S5 전까지 App 안 패널이 쓰므로. S5 뒤에는 이 import를 지운다) | 위와 같다. FIELD_OCR 스위치를 켠 기기에서 [매수 분석]이 보이는지 확인 |
| S3 | 구현서 | `AuthorPicker.tsx`(`AuthorPicker`·`AuthorPickerModal`·`SsoRow`) | 지우고 import 1줄 | sso·ssoExpiry 테스트. 수동으로 상단 사용자 단추 → 모달 → 이름 고르기 → 그룹 추가·이름 바꾸기, 잠금 기기에서 이름이 글자로만 나오는지 본다 |
| S4 | 구현서 | `AirPurifierFormPanel.tsx`(가장 단순한 양식을 먼저) | 지우고 import 1줄. 호출부 6942는 그대로 | 새 `tests/fieldFormPanels.render.test.tsx`(renderToString으로 청정기 머리 글자가 나오는지). 수동으로 청정기 보내기 → 보낸 뒤 양식이 비는지 본다 |
| S5 | 구현서 | `DevicePicker.tsx`·`ProcessingFormPanel.tsx` | 지우고 import 1줄. 호출부 6908은 그대로 | 렌더 스모크에 점검(showLevel)·AS(canManageDevices)·기기 2대를 넣는다. 수동으로 원본 붙여넣기 → 칸 수정 → 미리보기 글자가 S0과 같은지, 보낸 뒤 비우기를 확인한다. **여기까지 App.tsx가 약 1,200줄 줄어든다** |
| S6 | 윤화면 → 구현서 | `FieldFormShell.view.tsx`(카드 머리·`Section` 구분선+라벨·`Field` 라벨+입력 슬롯·단추 줄 공용, 로직 없음) | **0** | A1(3중 상자 → `UI.card` 1장 + `UI.section`), A3(알약 라벨 → `UI.label`), A5(`textInputClass` → `UI.input`)를 두 패널 파일 안에서만 적용한다. 캡처를 S0과 나란히 놓고, 미리보기 글자는 S0과 똑같아야 한다 |
| S7 | 윤화면 → 구현서 | `FieldGuideNote.view.tsx`·`FieldActionBar.view.tsx` | 6816~6824 → 1줄, 7051~7089와 7164~7193을 각각 1줄로 바꾼다(**사용자 승인 필요**, Q1) | A2(가이드 → `UI.note("info")`), A4(단추 2종). 미수 탭은 단추 줄을 숨기고 칭찬은 `praiseReady`를 쓰는지, 물류 "물류방 보내기" 글자가 남는지 확인한다 |
| S8 | 구현서 여러 명(파일별 병렬) | — | 0 | 이미 떨어진 양식 7개(Logistics·ContactChange·Replacement·Praise·Pc·CopierExpansion·Category)의 겉틀을 `FieldFormShell`로 맞춘다. MisuVisitForm은 이미 개편돼서 뺀다 |
| 끝 | 검수아 → 배포준 | — | — | build·test·범위 검사, 매뉴얼 docs/manual/user/03·04·05의 캡처와 문구를 고친다 |

- **ui-designer(윤화면)**: S6·S7의 `FieldFormShell`/`FieldActionBar` 겉모양만 맡는다(src/field/*.view.tsx). 패널 로직 파일은 건드리지 않는다.
- **db-schema(표다빈)**: 할 일 없음.
- **developer(구현서)**: S1~S5는 한 사람이 순서대로 한다(App.tsx를 동시에 고치면 충돌한다). S8만 파일 단위로 나눠 병렬로 한다.
- **qa-checker(검수아)**: 단계마다 build·test를 돌리고, 새 파일과 App 원본 블록을 diff해 export·import 말고는 차이가 없는지 본다(`git diff --color-moved=zebra`). 미리보기 글자를 S0과 비교한다.

## 6. 위험·열린 질문
- **이름 충돌**: App.tsx(7,584줄)가 import로 들일 이름(`NumSelect`·`AuthorPicker`·`SharedForm` 등)이 `App()` 안 지역 변수와 겹치면 지역 변수가 import를 가린다. 단계마다 `grep -n "\b이름\b" src/App.tsx`로 정의 1곳만 남았는지 보고 tsc로 확인한다. 지금 src/에는 같은 이름이 없다(실측).
- **순환 import**: 새 파일이 `./App`을 import하면 안 된다. 필요한 것은 반드시 `fieldFormModel.ts`로 내린다.
- **모듈 변수**: `ocrFlag`는 첫 조회를 한 번만 하려고 둔 캐시다. 파일이 둘로 갈리면 조회가 두 번 생길 수 있으니 반드시 `CounterOcrButton.tsx` 한 곳에만 둔다.
- **동시 작업**: 2026-10-24 현재 작업 트리에서 `src/authors.ts`·`src/ui/card.ts`가 다른 작업으로 고쳐지는 중이다(커밋 전). S3(AuthorPicker 이사)와 S6(UI 토큰)은 그 커밋이 들어간 뒤에 시작한다. App.tsx는 아직 아무도 고치지 않았다.
- **catSendReset 문자열 검사**: S7에서 App 단추 블록을 바꿀 때 isCat 분기와 resetAfterSend 원문은 건드리지 않는다.
- **A5 높이**: `UI.input`(h-10)으로 바꾸면 폰에서 양식이 약 15% 길어진다(감사 보고서). 받아들일지는 Q2.
- **열린 질문(사용자에게 한 번에)**
  - Q1. S7은 App.tsx를 세 군데 고친다(곳마다 블록 1개를 한 줄로 교체). "진입점 1~3줄" 규칙의 예외로 허용할까요? 제안: 허용. 안 되면 S7을 빼고 A2·A4는 남긴다.
  - Q2. 입력칸 높이를 다른 화면(h-10)과 맞출까요, 지금 폰 길이를 유지할까요? 제안: 매수·잔량 숫자칸만 지금 높이로 두고 나머지는 h-10.
  - Q3. 칸마다 지역색(`bgSoft`) 바탕을 없애면 지역 구분은 카드 머리 왼쪽 띠 한 줄만 남습니다. 괜찮을까요? 제안: 띠 한 줄.
  - Q4. S8(이미 분리된 7개 양식 겉틀 맞추기)도 이번에 할까요, 다음으로 미룰까요? 제안: S6이 끝나고 사용자가 폰으로 확인한 뒤에 한다.

## 7. 하지 않을 것
- 양식 상태를 App 밖으로 옮기는 일(훅·store로 빼기). 상태와 핸들러는 App에 그대로 둔다.
- 변환기·파서(`applyProcessingFormV2`·`parseItemDataFromText` 등, App.tsx 2001~2960)의 이사나 수정.
- 보내는 카톡 본문, 저장 표(jeomgeom·as_records), 전송 흐름, `recordFieldOperations`의 활동 기록 누락 문제(AGENTS.md 10-23 기록, 별건).
- 미수 작성기(MisuVisitForm)와 서비스접수 화면, App.tsx의 다른 화면 "김에 정리".
