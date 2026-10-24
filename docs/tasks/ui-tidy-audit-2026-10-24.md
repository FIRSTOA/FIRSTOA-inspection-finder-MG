# UI 정리 감사 (2026-10-24) — 디자인실 윤화면

범위: 읽기 전용 감사. 코드는 건드리지 않았다. 숫자·로직·데이터 흐름은 그대로 두고 마크업·클래스만 고친다는 전제.
기준: 모바일 390px 우선, Tailwind v4 유틸만, 새 CSS 파일·라이브러리 없음.
줄 번호는 2026-10-24 기준 `src/` 파일.

---

## 1. 핵심 진단 (2쪽 분량)

사용자가 느끼는 "박스가 따로 노는" 느낌의 원인은 네 가지다.

**(가) 한 주제가 여러 카드로 쪼개져 있다.**
- 조회 화면은 맨 위에 카드가 4~5장 연달아 놓인다. 묶음 목록 카드, 현재 항목 줄 카드, KPI 3카드, 기준 설명 글, 검색·결과 카드 순이다. (`DataLookup.tsx:324,328,345,367,391`)
- 미수·초과 보드도 같은 구조다. KPI 3카드, 필터 카드, 결과 카드를 한 쌍씩 복제했다. (`MisuOverageBoards.tsx:326,332,355` / `452,458,484`)
- 운영현황은 한 주제인데 카드가 5장이다. 필터, KPI 4카드, 업무 구성, 팀별, 인원별 순이다. (`OperationsDashboard.tsx:219,256,263,278,290`)
- 내 일정은 지도 상자와 목록 상자가 따로 있고, 그 위에 컨트롤 줄이 2개 더 있다. (`MyPlan.tsx:704-735`)
- 필드 탭 양식은 3중 상자다. 바깥 `rounded-2xl` 섹션 안에 `rounded-xl border-slate-300 shadow-sm` 카드 3개가 있고, 그 안에 다시 회색 박스가 있다. (`App.tsx:3616,3618,3620,3749,3829,3831`)

**(나) 카드 모양 토큰이 화면마다 다르다.** 공용 상수가 없고 파일마다 복사해서 쓴다. 현재 실태는 다음과 같다.

| 항목 | 현재 변형 | 문제 |
|---|---|---|
| 모서리 | `rounded-xl` 대부분, `rounded-2xl`(TeamRanking:103,129 · ReceptionBoard:416 · App:6815 · 필드 양식 3616), `rounded-lg`(상세 내부) | 같은 급 카드가 2종 |
| 테두리 | `border-slate-200` / `border-slate-300`(App:3618, ReceptionBoard:377) / `border-2`(CsAsWorkspace:2101,2144) | 접수 입력창 한 파일 안에서도 200과 300이 섞임(ServiceReception:1647 vs 1788) |
| 그림자 | `shadow-sm` 있음(조회·관리·운영) / 없음(ServiceReception:1603,1634 · DeptReception) | 같은 흰 카드인데 뜬 정도가 다름 |
| 카드 머리 | 다크 `#1E252F` + `#151A23` 2단띠(관리·카운터·IT·인원), 연회색 `bg-slate-50/70`(운영·조회·시스템), 머리 없음(TeamRanking) | 머리 종류 3종. 연회색 투명도도 `/40 /50 /60 /70` 혼재 |
| 카드 제목 | `text-base lg:text-lg`(관리·WorkDashboard) vs `text-sm lg:text-[15px]`(Operations) vs `text-[14px]`(TeamRanking:105) | 3종 |
| 글자 최소 | `text-[9px]` `[10px]`이 CounterSms 12곳, WalkingMap 8곳, MyPlan 6곳 등 합 30곳 | 폰에서 읽기·누르기 불가 |
| 화면 간격 | `space-y-2`(MyPlan) `3`(운영) `4`(조회) `5`(CsAs) `6`(WorkDashboard) | 화면 이동 때 리듬이 달라짐 |
| 로딩·빈·에러 | `p-8` `p-10` `p-12` `py-20`, `rounded-xl/2xl/lg` 혼재(ReceptionBoard:136, OperationsDashboard:249-250, MisuOverageBoards:273,289-291,353-354) | 화면마다 8가지 변형 |
| 단추 | `h-9` `py-1`(약 26px) `py-1.5` `py-2.5` `py-3.5`, `font-medium` vs `font-black`(App:7166 vs 7185), 파란 단추에 색 그림자 있음/없음 | min-h-11 규칙 미달이 많음 |
| 칩 | 선택 색이 `slate-900`·`blue-600`·`white(어두운 띠)`로 3종. 같은 줄에 두 가지가 섞임(DataLookup:397 slate-900 vs 414 blue-600) | 누른 것의 의미가 안 읽힘 |
| 입력 높이 | `h-9` `h-10` `py-1.5` `py-2` `py-2.5` 혼재 | 한 폼 안에서 높이가 들쭉날쭉 |

좋은 선례는 이미 있다. 접수 입력창 ("한 장의 종이": `ServiceReception.tsx:1634`, `DeptReceptionForm.view.tsx:72-80`)은 카드 1장 + 얇은 구분선 + 작은 섹션 라벨로 만들어져 있다. 여기서 쓴 토큰(입력 `h-10`, 라벨 11px, 분할막대 `h-9`)을 공용으로 올리는 것이 가장 자연스럽다.

**(다) 따로 노는 박스.**
- IT 학습: 탭이 붙은 제목 카드와 `ItPracticeForm`(별도 카드)과 검색 카드가 한 흐름처럼 놓이지만 각자 둥근 테두리다. 실습 기록 폼이 탭과 무관하게 모든 탭 위에 걸려 있다. (`ItLearningHistory.tsx:207,229,239`)
- 관리: 허브 제목 카드 아래에 하위 화면이 자기 다크 머리를 또 가진다. 다크 띠가 한 화면에 최대 2번 겹쳐 나온다. (`AdminHub.tsx:78,83` + `MemberAdmin.tsx:239,255`)
- 카운터 문자: 문구 설정 탭에 색 다른 카드가 5장 연달아 나온다. 방 안내(초록/노랑), 지역 프로필, 문자 양식 details 2개, 기종 문구. (`CounterSms.tsx:708,718,728,744`)
- 접수 화면 오른쪽 패널: 날짜 이동, 기간 막대, 새로고침, 필터 칩이 위에 세 줄 쌓인 뒤에야 목록이 나온다. (`ServiceReception.tsx:2012-2058`)

**(라) 폰 390px 깨짐·가로 스크롤.**
- WorkDashboard 실적표 `minWidth: 1000`(:410), 주간 표 `minWidth: 720`(:555)이 폰에서 가로 스크롤이다. 카드로 접혀 있지 않다.
- MemberAdmin 표 `min-w-[760px]`(:313)도 폰에서 가로 스크롤이다.
- 운영현황 인원별 표 `min-w-[1320px]`(:313)는 `md:block`이라 태블릿 768~1320px에서 가로 스크롤이다. 폰은 카드로 접혀 있어 정상이다.
- CsAsWorkspace 표 `min-w-[1050/1100px]`(:2108,2150)도 폰은 `md:hidden` 카드(:1945)라 정상이다. 태블릿(md)에서만 가로 스크롤이다.
- 조회·미수 KPI 3칸이 1/3 폭에서 `text-lg`로 금액을 `truncate`한다. "잔액 합계 123,456,789원"이 잘린다. (`MisuOverageBoards.tsx:327`, `DataLookup.tsx:368`)
- MyPlan의 행 안 단추는 `py-1.5 text-[11px]`로 약 28px, 삭제는 `text-[10px] py-0.5`로 약 20px이다. 손가락 크기(44px) 미달이고 오탭 위험이 크다. (`MyPlan.tsx:779,794-799`)
- CounterSms 카드 안 단추는 `text-[9px] px-1.5 py-0.5`다. 완료·전송 취소·삭제가 서로 붙어 있어 오탭 위험이 있다. (`CounterSms.tsx:682-690`)

---

## 2. 공통 규칙 제안 (`src/ui/card.ts` 신규 1파일)

새 CSS 파일은 만들지 않고 Tailwind 클래스 문자열 상수만 모은다. 점진 적용이 목적이라 화면 하나씩 import해서 바꾼다. 기존 화면은 안 바꾸면 그대로 동작한다.

```ts
// src/ui/card.ts — 공통 클래스 묶음(문자열만, 로직 없음)
export const UI = {
  // 카드 1종: 테두리 한 겹, 그림자 없음(뜬 것은 팝오버·모달만)
  card: "overflow-hidden rounded-xl border border-slate-200 bg-white",
  // 카드 머리 1종: 제목 + 설명 + 오른쪽 단추. 화면 맨 위 한 번만 다크 머리(heroHead)
  head: "flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 lg:px-5",
  title: "text-sm font-black text-slate-950 lg:text-[15px]",
  desc: "mt-0.5 text-[11px] font-semibold text-slate-400",
  heroHead: "bg-[#1E252F] px-4 py-3 lg:px-5 lg:py-4",        // 화면당 1개
  heroBar: "flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5", // 선택: 다크 상태줄
  body: "p-4 lg:p-5",
  section: "border-t border-slate-100 p-4 lg:p-5",           // 카드 안 구분은 카드 아니고 선
  gap: "space-y-4",                                          // 화면 세로 간격 통일

  // 칩 1종: 선택 = slate-900 하나로 통일
  chip: (on: boolean) => `inline-flex min-h-9 items-center rounded-full px-3 text-[12px] font-black transition ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`,
  chipDark: (on: boolean) => `inline-flex min-h-9 items-center rounded-full px-3 text-[12px] font-black transition ${on ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/20"}`,

  // 단추 2종: 파랑(주 동작) / 흰 테두리(보조). 위험은 보조 + 글자색(rose)
  btn: "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40 lg:min-h-9",
  btnGhost: "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 lg:min-h-9",

  // 입력 1종 (border-slate-300 로 통일), 라벨 1종
  input: "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10",
  label: "text-[11px] font-semibold text-slate-500",

  // 배지 1종 + 상태색(정상 초록·주의 노랑·실패 빨강·비활성 회색)
  badge: "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-black",
  tone: { ok: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700", bad: "bg-rose-50 text-rose-700", off: "bg-slate-100 text-slate-500" },

  // 안내줄(알림 띠) 1종
  note: (t: "ok" | "warn" | "bad" | "info") => `rounded-lg border px-4 py-2.5 text-xs font-bold ${ { ok: "border-emerald-200 bg-emerald-50 text-emerald-800", warn: "border-amber-200 bg-amber-50 text-amber-800", bad: "border-rose-200 bg-rose-50 text-rose-700", info: "border-blue-100 bg-blue-50 text-blue-700" }[t] }`,
};
```

규칙 요약은 이렇다.
1. 카드는 `UI.card` 1종뿐이다. 카드 안의 그룹은 **카드를 또 두르지 않고** `border-t` 구분선과 작은 섹션 라벨로 나눈다. `rounded-2xl`은 라이트 화면에서 금지다(홈 다크 카드와 모달만 예외).
2. 한 화면의 다크 머리는 1개(`heroHead`)다. 하위 화면(MemberAdmin·SystemAdmin 등)은 연회색 `head`를 쓴다.
3. 글자는 11px 미만을 금지한다(배지 포함). 탭 영역은 폰 `min-h-11`, PC 표 안에서만 `lg:min-h-9`를 허용한다.
4. 선택 상태 색은 `slate-900`(밝은 바탕)과 `white`(다크 바탕) 둘이다. `blue-600`은 "주 동작 단추"에만 쓴다.
5. 상태 박스(로딩·빈·에러)는 `StateBox` 1컴포넌트(`src/ui/StateBox.tsx`, 아이콘은 lucide)로 만들어 `kind="loading|empty|error"`로 쓴다. 문구는 존댓말이다. 이건 2차 작업이다.
6. 같은 주제의 KPI 숫자 3~4개는 **카드 3~4장이 아니라 카드 1장 안의 `grid divide-x` 한 줄**로 둔다. 폰에서는 `text-base`, 금액은 `truncate` 대신 `text-sm`으로 줄인다.
7. 로컬에서 이미 만든 토큰(`DeptReceptionForm.view.tsx:72-80` seg·input·label·section)은 `ui/card.ts`로 올리고 원본은 import로 대체한다. 동작은 변하지 않는다.

---

## 3. 1차로 손댈 화면 5개 (추천 순서)

선정 기준은 사용자 체감, 회귀 위험이 낮을 것, 숫자·로직과 거리가 먼 것이다. 위쪽일수록 먼저 한다.

| 순서 | 화면 | 이유 | 손볼 것 | 위험 |
|---|---|---|---|---|
| 1 | **조회** (`DataLookup` + `MisuOverageBoards`) | 사용자가 가장 자주 여는 화면이고, 카드 4~5장이 연달아 있어 "따로 논다"의 대표 사례다. 같은 구조가 미수·초과·재고에 복제돼 있어 한 번 고치면 효과가 가장 크다. | KPI 3카드와 필터를 결과 카드 머리로 합친다. PC는 묶음 목록과 현재 항목 줄을 한 카드로 합친다. 칩 선택색을 통일한다. | 낮음~중 |
| 2 | **주간현황판 운영·순위** (`OperationsDashboard` + `TeamRanking`) | 카드 5장을 2~3장으로 줄일 수 있다. `rounded-2xl`과 제목 크기를 정리하고, 태블릿 가로 스크롤을 `lg`로 올린다. 숫자는 그대로다. | KPI와 업무 구성을 한 카드로 합친다. 설명 3줄은 접이식 "계산 기준"으로 옮긴다. | 낮음 |
| 3 | **카운터 문자** (`CounterSms`) | 9px 글자와 20px 높이 단추가 가장 많고, 설정 탭에 카드 5장이 연달아 있다. 폰에서 오탭 위험이 큰 화면이다. | 카드 안 단추를 `min-h-9`·11px 이상으로 올린다. 설정 탭을 카드 1장 + `details` 섹션으로 정리한다. 머리를 다크 1단으로 줄인다. | 중(발송 단추 근처라 클릭 영역 변경 주의) |
| 4 | **관리** (`AdminHub` + `MemberAdmin` + `SystemAdmin`) | 다크 머리가 겹치고, 시스템 카드 5장이 같은 형태(머리+본문)다. 공용 `card/head`를 시험 적용하기 가장 좋은 곳이다. | `AdminHub`만 다크 머리를 유지한다. 하위는 연회색 `head`로 바꾼다. 인원 표는 폰에서 카드로 접는다. | 낮음 |
| 5 | **IT 학습** (`ItLearningHistory`) | 구조가 단순하고 위험이 가장 낮다. 공용 상수를 처음 검증하는 샌드박스로 좋다. | 제목·탭·실습 폼·검색을 한 카드 안으로 정리한다. 퀴즈 카드 안의 `rounded-lg` 박스를 구분선으로 바꾼다. | 낮음 |

**1차에서 일부러 뺀 것과 이유는 다음과 같다.**
- **필드 탭 양식** (`App.tsx` `ProcessingFormPanel`): 3중 상자는 분명한 문제지만 App.tsx는 진입점 1~3줄만 건드리는 규칙이다. 양식은 입력·저장 로직과 한 파일에 얽혀 있다. 먼저 양식 패널을 별도 파일로 떼는 지시서(`docs/tasks/`)가 필요하다. 2차로 미룬다.
- **서비스접수**(`ServiceReception`)는 이미 "한 장의 종이" 구조라 상대적으로 정돈돼 있다. 입력창 토큰만 공용으로 올리고, 오른쪽 패널 위 3줄 컨트롤 정리는 2차로 한다.
- **내 일정**(`MyPlan`), **워킨맵 패널**, **일정리스트**(`CsAsWorkspace`)는 지도·드래그 같은 동작 로직과 가까워 회귀 위험이 높다. 단추 높이와 배지 크기만 먼저 올리고 구조 합치기는 2차로 한다.

작업 순서 제안: `src/ui/card.ts`만 먼저 추가한다(기존 코드 변경 없음). 이후 화면 하나씩 바꾸고, 화면마다 qa-checker로 390px 확인을 거친다. 숫자·정렬·필터·저장·전송 로직은 건드리지 않는다.

---

# 부록: 화면별 표

난이도는 상(구조·상태 변경), 중(마크업 이동), 하(클래스 치환)이다. 회귀 위험은 같은 3단계다.

## A. 필드 탭 (`App.tsx` 읽기만)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| A1 | ① 3중 상자: 바깥 `rounded-2xl` 섹션, 안쪽 `rounded-xl border-slate-300 shadow-sm` 카드 3개(기본·추가·부품/자가/시간), 그 안에 다시 `bgSoft`·`bg-slate-50` 박스 | App.tsx:3616-3620, 3748-3749, 3828-3831 | 바깥 섹션의 배경과 둥근 틀을 없앤다. 카드 3개는 `UI.card` 1종으로 쓰고, 안쪽 회색 박스는 구분선과 라벨로 바꾼다. | 중 | 중 |
| A2 | ② 가이드 박스가 `rounded-2xl bg-slate-50 p-4`로 큼. 다른 안내 박스와 다르다 | App.tsx:6815 | `UI.note("info")` 한 줄. 상세 문구는 접이식. | 하 | 하 |
| A3 | ⑤ 항목 라벨이 알약(`rounded-full bg-slate-200 px-3 text-[13px]`)이라 누르는 칩처럼 보임 | App.tsx:3622,3626,3636,3641,4000,4007,4017 | `UI.label` 글자 라벨로 바꾼다. 칩은 눌리는 것에만 쓴다. | 하 | 하 |
| A4 | ⑤ 하단 단추 높이·굵기 혼재(`py-2.5 font-medium` vs `py-3.5 font-black`) | App.tsx:7051-7053, 7166-7185 | 보조 `btnGhost`, 주 `btn` 2종으로 통일. | 하 | 하 |
| A5 | ② 입력 `border-slate-300` + `px-2 py-1.5`가 다른 화면(`h-10`)과 높이가 다름 | App.tsx:3613 (`textInputClass`) | `UI.input`으로 대체 | 하 | 중(폰 높이가 커져 한 화면 길이 증가) |

## B. 서비스접수 (`ServiceReception` · `DeptReception*` · `ReceptionBoard*`)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| B1 | ② 같은 파일에서 입력 테두리 `slate-200`(거래처 검색)과 `slate-300`(내용 입력)이 섞임 | ServiceReception.tsx:1647,1651 vs 1788-1828 | `UI.input` 하나로 통일 | 하 | 하 |
| B2 | ④ 분할막대·날짜 이동·기간 막대가 `h-9`(36px)로 손가락 높이 미달 | ServiceReception.tsx:1653,1738,1751,1764,2012,2038,2044 | 폰에서 `min-h-11`, `lg:h-9`로 높임 | 하 | 중(한 줄에 들어가는 개수가 줄 수 있음) |
| B3 | ① 오른쪽 패널 위에 날짜 이동, 기간 막대, 새로고침, 필터 칩이 세 줄 쌓인 뒤에 목록이 시작함 | ServiceReception.tsx:2034-2058 | 날짜 이동과 기간 막대를 한 줄로 묶고, 새로고침과 안내 아이콘은 줄 끝에 둔다. | 중 | 중 |
| B4 | ③ 상태바(다크) 카드와 종류 선택기가 같은 카드이지만 접수 가능/시계 줄과 거리가 있음 | ServiceReception.tsx:1603-1627 | 유지 가능. `heroHead`·`heroBar` 토큰으로만 치환 | 하 | 하 |
| B5 | ③ 미처리 현황판 `rounded-2xl`(비 compact)과 컬럼 카드의 테두리 색이 다름(`slate-300` vs `slate-200`) | ReceptionBoard.tsx:416, 377, 398 | `rounded-xl`, 테두리 `slate-200`으로 통일 | 하 | 하 |
| B6 | ⑤ 로딩·에러 박스가 `rounded-2xl p-8`·`p-4`로 다른 화면과 다름 | ReceptionBoard.tsx:136-137 | `StateBox` | 하 | 하 |
| B7 | ② `DeptReceptionForm.view.tsx:72-80`의 토큰이 로컬에만 있음 | DeptReceptionForm.view.tsx:72-80 | `ui/card.ts`로 올리고 import 대체 | 하 | 하 |

## C. 조회 (`DataLookup` · `MisuOverageBoards`)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| C1 | ① 맨 위에 카드 4~5장: PC 묶음 목록, 모바일 선택 카드, PC 현재 항목 줄, KPI 3카드, 검색·결과 | DataLookup.tsx:324,328,345,367,391 | PC는 목록과 현재 항목 줄을 한 카드(`border-t`)로 합친다. KPI 3칸은 검색 카드 머리 안 `grid divide-x` 한 줄로 옮긴다. | 중 | 중 |
| C2 | ① 미수·초과 보드가 KPI 3카드, 필터 카드, 결과 카드를 두 번 복제함 | MisuOverageBoards.tsx:326-332,355 / 452-458,484 | 필터 줄(팀 칩·검색)을 결과 카드 머리로 옮기고 KPI는 한 줄 요약 띠로 둔다. 두 보드가 같은 컴포넌트 조각을 공유하게 한다. | 중 | 중 |
| C3 | ④ KPI 3칸 폭이 좁아 큰 금액이 `truncate`로 잘림 | MisuOverageBoards.tsx:327, DataLookup.tsx:368 | 폰 `text-base`, 금액은 `text-sm`, `break-keep` | 하 | 하 |
| C4 | ⑤ 선택색이 같은 줄에서 `slate-900`(기간)과 `blue-600`(정렬)로 다름 | DataLookup.tsx:397,401,414 | `UI.chip` 하나로 통일 | 하 | 하 |
| C5 | ④ ◀ ▶ 주 이동 단추가 `px-2 py-1 text-[12px]`로 작음 | DataLookup.tsx:405,407,408 | `min-h-9 min-w-9`(폰 `min-h-11`) | 하 | 하 |
| C6 | ③ 기준 설명 글이 카드 밖에서 `-mt-1`로 떠 있음 | DataLookup.tsx:374-388 | 결과 카드 머리 아래 `desc` 한 줄 또는 접이식 "계산 기준"으로 | 하 | 하 |
| C7 | ① 상세 팝업 안에 `rounded-lg border p-3` 박스가 연달아 | DataLookup.tsx:544,569,582 | 박스 대신 `section`(구분선) | 중 | 중 |
| C8 | ⑤ 빈·에러·로딩이 `p-10`·`p-4`·`p-3`, `rounded-lg/xl` 혼재 | MisuOverageBoards.tsx:273,289-291,353-354,482-483 | `StateBox` | 하 | 하 |
| C9 | ③ 탭 알약, 팀 칩, 검색창이 카드 밖에 뿔뿔이 놓임 | MisuOverageBoards.tsx:264,279,289 | 탭 알약은 화면 머리 한 줄로 두고, 팀 칩과 검색은 결과 카드 머리 안으로 | 중 | 중 |

## D. 주간현황판 (`WorkDashboard` · `OperationsDashboard` · `TeamRanking`)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| D1 | ① 운영현황 카드 5장(필터, KPI 4, 업무 구성, 팀별, 인원별) | OperationsDashboard.tsx:219,256,263,278,290 | KPI와 업무 구성을 한 카드로 합친다(위 `divide-x` 숫자 4칸, 아래 구성). 팀별과 인원별은 `xl` 2열 유지. | 중 | 하 |
| D2 | ③ 필터 카드 머리에 설명 3줄(`<br/>`)이 있어 폰에서 약 8줄 | OperationsDashboard.tsx:222 | 접이식 "계산 기준 보기"로 옮김(문구 그대로) | 하 | 하 |
| D3 | ④ 인원별 표 `min-w-[1320px]`가 `md`부터 보여 태블릿에서 가로 스크롤 | OperationsDashboard.tsx:312-313 | `md:block`을 `lg:block`, 카드는 `md:hidden`을 `lg:hidden`으로 | 하 | 하 |
| D4 | ⑤ 입력 `h-9` 네이티브 `select`와 `PortalSelect` 혼용(높이·모양 차) | OperationsDashboard.tsx:231-234 vs 242-245 | `PortalSelect` 하나로 통일 | 하 | 중(값 변경 핸들러 형태 차이) |
| D5 | ④ 실적·목표·달성 표가 `minWidth:1000`, 주간 표가 `minWidth:720`이라 폰에서 가로 스크롤 | WorkDashboard.tsx:410, 555 | 폰 전용으로 종류별 카드 2열(실적/목표/달성 세로)을 보여 주고 PC는 표 유지. 목표 입력칸의 키보드 이동(`data-cell`)이 있어 입력칸은 같은 컴포넌트를 재사용한다. | 상 | 상 |
| D6 | ② 간격·패딩 `space-y-6`, `gap-6`, `p-5`가 다른 화면(`space-y-3/4`, `p-4`)과 다름 | WorkDashboard.tsx:437-452, 439, 444 | `UI.gap`, `UI.body` | 하 | 하 |
| D7 | ① 일간 화면에서 큰 카드(`p-5`) 안에 작은 타일 6개가 각각 `rounded-xl border` | WorkDashboard.tsx:439-441 | 타일은 테두리 없이 `grid divide-x divide-y`로 | 하 | 하 |
| D8 | ② 카드 제목 3종(`text-base lg:text-lg` / `text-sm lg:text-[15px]` / `text-[14px]`) | WorkDashboard.tsx:631, OperationsDashboard.tsx:265, TeamRanking.tsx:105 | `UI.title` | 하 | 하 |
| D9 | ② 순위 카드와 한 사람 카드가 `rounded-2xl`이고 머리가 없음 | TeamRanking.tsx:103,129 | `UI.card` + `head`, 한 사람 카드는 순위표 아래 `section`으로 합침 | 중 | 하 |
| D10 | ④ 기간·팀 알약이 `py-1`(약 28px) | TeamRanking.tsx:97-98, OperationsDashboard.tsx:225,239 | `UI.chip` (`min-h-9`) | 하 | 하 |
| D11 | ⑤ 로딩·에러·저장 안내 박스 크기가 다름 | WorkDashboard.tsx:430-433, OperationsDashboard.tsx:249-250 | `StateBox`, `UI.note` | 하 | 하 |

## E. 일정 (`MyPlan` · `CsAsWorkspace` · `OverduePanel`)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| E1 | ① 컨트롤 줄 2개, 지도 상자, 목록 상자가 모두 따로 놓임 | MyPlan.tsx:704-735 | 컨트롤 두 줄과 지도·목록을 한 카드로 묶고 사이는 `divide-y`로 나눈다. 지도 높이(`h-[36vh]`)는 그대로 둔다. | 중 | 중(지도 크기 재계산(`invalidateSize`) 필요 여부 확인) |
| E2 | ④ 행 안 단추가 `py-1.5 text-[11px]`(약 28px), 삭제가 `text-[10px] py-0.5`(약 20px) | MyPlan.tsx:779, 794-799 | 폰 `min-h-11`(또는 행을 눌러 열기), 삭제는 아이콘 `min-h-9`로 하고 위치를 `상세` 단추 쪽으로 | 하 | 중 |
| E3 | ⑤ 배지 6종이 `text-[9px]`~`[10px]`이고 색이 제각각 | MyPlan.tsx:758-760, 783-788 | `UI.badge` + `UI.tone`(11px) | 하 | 하 |
| E4 | ① 상세 안 `rounded-xl border p-3` 카드가 5개 연속 | MyPlan.tsx:922,938,948,962,975,981 | `section` 구분선으로 합침 | 중 | 중 |
| E5 | ③ 일정리스트 팀 그룹과 완료 그룹이 `border-2`(파랑/초록/빨강)로 눈에 띄고 폭이 다름 | CsAsWorkspace.tsx:2101, 2144 | `border` 1px, 머리 색만 구분 | 하 | 하 |
| E6 | ④ 목록 표가 `min-w-[1050/1100px]`라 태블릿(md)에서 가로 스크롤. 폰은 카드(:1945)라 정상 | CsAsWorkspace.tsx:2108, 2150, 1806 | 표는 `lg:block`, 카드는 `lg:hidden`으로 | 하 | 중(카드 쪽 정보량이 표보다 적은지 확인) |
| E7 | ② 필터 패널이 별도 다크 `rounded-xl`이고 아래 그룹 카드와 간격(`space-y-4`/`5`)이 다름 | CsAsWorkspace.tsx:1611, 1850 | `UI.heroBar`와 `UI.gap` | 하 | 하 |
| E8 | ③ 미처리 패널은 홈 다크 카드(`rounded-2xl`)를 그대로 가져옴 | OverduePanel.tsx:14, 43 | 홈 다크 카드는 의도라 유지한다. 칩 높이와 내부 목록 `text-[10px]`만 11px로 올림 | 하 | 하 |

## F. 워킨맵 사이드 패널 (`WalkingMap`)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| F1 | ③ 사이드 목록 머리가 PC 다크 띠와 모바일 상단바 포털로 같은 내용을 두 번 그림 | WalkingMap.tsx:2602-2631 | 문구는 하나의 변수로 공유하고 모양만 분기 | 중 | 중 |
| F2 | ① 검색창 줄, 분기 필터 상자, 엑셀 단추 2개, 좌표 단추가 한 패널 머리에 줄줄이 | WalkingMap.tsx:2632-2666 | 엑셀 불러오기·내보내기를 `⋯` 메뉴나 `details`로 접는다. 필터 상자는 테두리 없이 배경 구분만 둔다. | 중 | 중 |
| F3 | ④ `text-[9px]` 계열 8곳, 단추 `py-2 px-2.5 text-[11px]` | WalkingMap.tsx:2636,2640,2644,2653 | `UI.chip`/`btn`의 최소 크기로 | 하 | 중 |
| F4 | ② 팝업과 시트가 `rounded-xl shadow-2xl`, 입력은 `rounded-xl`(3477-3508)로 `rounded-lg` 입력과 다름 | WalkingMap.tsx:3477-3508 | 입력 `rounded-lg`로 통일 | 하 | 하 |

## G. 카운터 문자 (`CounterSms`)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| G1 | ④ 카드 안 단추가 `text-[9px] px-1.5 py-0.5`(약 18px)이고 완료·전송취소·삭제가 붙어 있음 | CounterSms.tsx:682-690 | 폰 `min-h-9` 이상, 간격 `gap-2`, 삭제는 한 칸 떨어뜨린다. | 하 | 중(발송 상태 버튼이라 클릭 영역 변경 점검) |
| G2 | ⑤ 배지 `text-[9px]`가 한 카드에 4~6개(CMS·목록·또 올라옴·완료·보냄) | CounterSms.tsx:656-668 | `UI.badge` 11px로 하고 색은 `tone`(주의=노랑, 실패=빨강, 정상=초록)으로 통일. 수가 많으면 상태 줄 하나로 요약. | 중 | 하 |
| G3 | ① 설정 탭에 카드 5장 연달아(방 안내, 지역 프로필, 문자 양식 details 2개, 기종 문구) | CounterSms.tsx:708,718,728,744 | 카드 1장 안에 `section` 4개(`details`)로 묶는다. | 중 | 하 |
| G4 | ③ 머리에 다크 2단(제목+단추 3, 팀 칩)과 안내문이 긴 문단 | CounterSms.tsx:518-551 | 1단 다크 머리로 하고 안내문은 `desc` 한 줄 + 접이식 | 중 | 하 |
| G5 | ③ 관리부 목록 자동 반영 박스와 결과 카드 사이 간격·모서리가 다름(`rounded-xl border p-3` vs 카드) | CounterSms.tsx:559, 622 | `UI.note` 계열로 통일 | 하 | 하 |
| G6 | ⑤ 상태 점 색(초록/인디고/노랑/빨강 복수 사용)이 앱 상태 색 규칙과 다름. 완료=인디고 | CounterSms.tsx:652-668 | 완료 = 초록 계열, 보냄 = 파랑 계열로 의미를 정하고 한 줄 범례 | 하 | 하(색 의미 변경이라 사용자 확인) |

## H. 관리 (`AdminHub` · `MemberAdmin` · `SystemAdmin`)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| H1 | ③ 허브 다크 머리와 상태줄이 있고, 하위 화면(`MemberAdmin`)이 또 다크 머리+툴바를 가짐 | AdminHub.tsx:78,83 + MemberAdmin.tsx:239,255 | 하위는 연회색 `head`로 하고 툴바만 다크 유지는 금지 | 중 | 하 |
| H2 | ① `SystemAdmin` 카드 5장이 같은 형식인데 각자 머리 패딩이 `px-5 py-4` | SystemAdmin.tsx:179,271,315,380,433 | `UI.card`/`head`로 5장을 같은 모양으로(합치지는 않고 접이식 `details` 선택 가능) | 하 | 하 |
| H3 | ④ 인원 표가 `min-w-[760px]`라 폰에서 가로 스크롤 | MemberAdmin.tsx:312-313 | 폰은 이름·부서·직책 카드 행으로 접고 `md:` 이상에서 표 | 중 | 중 |
| H4 | ④ 인원 행의 ✎ 수정·삭제가 "마우스를 올리면" 나타남 → 폰에서 못 누름 | MemberAdmin.tsx:242 안내문, 290-291 | 폰에서는 항상 보이게(`lg:opacity-0 lg:group-hover:opacity-100`) | 하 | 하 |
| H5 | ⑤ 단추가 `px-2 py-1 text-[11px]`로 작음 | MemberAdmin.tsx:290-291 | `btnGhost` | 하 | 하 |
| H6 | ② 방 매핑 삭제 아이콘 `p-1.5`(약 26px) | SystemAdmin.tsx:303-304 | `min-h-9 min-w-9` | 하 | 하 |

## I. IT 학습 (`ItLearningHistory`)

| # | 문제 | 파일:줄 | 고치는 방법 | 난이도 | 위험 |
|---|---|---|---|---|---|
| I1 | ③ 제목·탭 카드, 실습 폼, 연결 설정, 검색 카드가 각각 따로 둥근 상자 | ItLearningHistory.tsx:207,229,231,239 | 제목+탭+검색을 한 카드로, 실습 폼은 "기록하기" 접이식 섹션으로 옮김(탭 무관 상시 노출 해소) | 중 | 중 |
| I2 | ① 퀴즈 카드 안에 `rounded-lg` 박스(문제 영역·해설·오답노트)가 층층이 | ItLearningHistory.tsx:269,273,275 | 해설·주의는 `UI.note`, 오답노트는 구분선 목록으로 | 중 | 하 |
| I3 | ② 폼 입력이 `h-10`·`p-2.5`와 카드 모서리 `rounded-full`·`rounded-lg`를 섞어 씀 | ItLearningHistory.tsx:233-236, 285-286 | `UI.input`, `btn` | 하 | 하 |
| I4 | ③ 알림이 `fixed right-4 top-20`이라 폰에서 가장자리에 붙음. `toast.tsx`가 있음 | ItLearningHistory.tsx:205 | 공용 `toast.tsx`로 교체(문구 그대로) | 하 | 중(알림 호출부 전부 교체 필요) |
| I5 | ⑤ 탭 밑줄이 `after:h-[3px] bg-blue-600`으로 AdminHub와 같음(양호) | ItLearningHistory.tsx:222 | 그대로. `UI.tab` 토큰으로만 올림 | 하 | 하 |

---

## 확인하지 못한 것 (후속 확인 필요)

1. **실제 390px 렌더**: 이번 감사는 소스 읽기만 했다. 가로 스크롤과 잘림(C3, D5, H3)은 실제 폰 화면에서 `qa-checker`가 확인해야 한다.
2. **`DeptReceptionDetail` · `ReceptionBoardPanel`** 안쪽 마크업은 상세히 읽지 않았다. 카드 모서리 수만 확인했다(각 6, 1곳).
3. **`StockBoard` · `SupplyBoard`**(조회 안의 전용 보드)는 대상 목록에 없어 읽지 않았다. 같은 KPI·필터 복제 패턴이 있을 수 있다.
4. 필드 탭의 다른 양식(점검·물류·확장성 등)은 `ProcessingFormPanel`과 `AirPurifierFormPanel`만 확인했다. 같은 패턴이 반복된다고 보이지만 나머지는 읽지 않았다.
