# FIELD 사용 매뉴얼 (목차)

퍼스트전산 CS팀 웹앱 **FIELD**(주소: firstoa-inspection-finder-mg.vercel.app)를 쓰는 사람을 위한 설명서입니다.
개발 지식이 없어도 읽을 수 있게 썼습니다. 화면 이름·단추 이름은 앱에 적힌 글자를 그대로 옮겼습니다.
모르는 부분은 짐작해서 쓰지 않고 **(확인 필요)** 로 표시했습니다.

- 마지막 정리: 2026-10-22 · 기준 커밋 `cf0134e`(점검·AS 건수 통일·보낸 뒤 양식 비우기까지 반영)
- 앱 안에도 그림이 들어간 옛 설명서가 있습니다: 왼쪽 메뉴 맨 아래 **사용설명서** (`/guide/*.html`, 2026-08-26 기준). 단추 하나하나를 그림으로 보고 싶으면 그쪽을, **8월 이후 바뀐 내용은 이 매뉴얼이 우선**입니다.

## 누가 무엇을 읽나

| 읽는 사람 | 먼저 읽을 장 | 그다음 |
|---|---|---|
| 새로 온 직원 | 00 공통 규칙 → 01 로그인 → 03 FIELD 점검·AS | 07 일정리스트·캘린더 → 06 서비스접수 |
| CS 현장 직원(폰) | 03·04·05 FIELD | 07 일정리스트, 12 워킨맵, 13 카운터 문자 |
| 접수 담당·지원 부서 | 06 서비스접수 | 07 일정리스트·캘린더, 02 홈(미처리) |
| 팀장·파트장 | 02 홈 → 10 주간현황판·팀 현황·순위표 → 11 OKR | 08 조회, 14 관리 |
| 관리자(설정 바꾸는 사람) | 14 관리 탭 | ops/ (운영·이관 문서) |

## 목차 — 사용자용 (`user/`)

| 장 | 파일 | 한 줄 |
|---|---|---|
| 00 | [user/00-common-rules.md](user/00-common-rules.md) | 모든 화면 공통: 카톡 나가는 시간, 오발송 삭제, 테스트 모드, 작성자, 전파 약할 때 |
| 01 | [user/01-login.md](user/01-login.md) | 그룹웨어 계정으로 로그인, 7일 유지, 로그아웃·계정 바꾸기 |
| 02 | [user/02-home.md](user/02-home.md) | 홈 = 실시간 운영 현황판(미처리·전송 현황·지표·피드백·업데이트) |
| 03 | [user/03-field-inspection-as.md](user/03-field-inspection-as.md) | FIELD 점검·AS·청정기: 양식 불러오기 → 채우기 → 카톡방 전송 → 일정 정리 |
| 04 | [user/04-field-logistics-expansion.md](user/04-field-logistics-expansion.md) | FIELD 물류, 확장성(IT·복합기) — 같은 날 재전송 확인창 |
| 05 | [user/05-field-more-forms.md](user/05-field-more-forms.md) | FIELD 더보기: 담당자/주소 변경·불만·미수(방문이력 작성기)·초과조정·재계약(다음 확인일·일정 만들기)·교체양식·칭찬 |
| 06 | [user/06-service-reception.md](user/06-service-reception.md) | 서비스접수: 복합기 AS·원격·IT + 경영지원·운영지원·영업팀, 미처리 현황, 부서명 검색 |
| 07 | [user/07-schedule-calendar.md](user/07-schedule-calendar.md) | 일정리스트(금일·익일·예정·미처리·내 일정·중간보고)와 캘린더 |
| 08 | [user/08-lookup-records.md](user/08-lookup-records.md) | 조회 › 기록 조회: 6묶음, 기간 칩, 오발송 삭제·삭제 취소, CSV, 미수 방문 이력 |
| 09 | [user/09-search360.md](user/09-search360.md) | 조회 › 통합 검색: 업체·기번 검색과 질문하기 |
| 10 | [user/10-weekly-team-ranking.md](user/10-weekly-team-ranking.md) | 주간현황판: 내 현황·팀 현황·순위표와 건수 셈법 |
| 11 | [user/11-okr.md](user/11-okr.md) | OKR: 분기 → 월 → 주차, 통합집계·파트 종합·팀원 집계·주차, 핵심방향 |
| 12 | [user/12-walking-map.md](user/12-walking-map.md) | 워킨맵: 분기 점검 지도, 색(G1~G12), FIELD 전송 후 자동 색칠, 진행률 |
| 13 | [user/13-counter-sms.md](user/13-counter-sms.md) | 카운터 문자전송: 팀 마감 목록 → 내 폰 문자앱, 이중 발송 방지 |
| 14 | [user/14-admin.md](user/14-admin.md) | 관리: 인원·담당자·주소 변경·동기화 현황·전송·카톡방(스위치)·알림 |
| 15 | [user/15-other-screens.md](user/15-other-screens.md) | 그 밖의 화면(자동 일정·재계약 준비·맛동여지도·공지·학습·해피콜 등) 안내 |

## 목차 — 운영·이관 (개발·관리자용, `ops/`)

서버·SQL·노트북 실행기·카톡 봇 같은 운영 이야기는 사용자용 장에 넣지 않고 여기에만 둡니다.

| 장 | 파일 |
|---|---|
| 00 | [ops/00-overview.md](ops/00-overview.md) — 전체 구조 |
| 01 | [ops/01-accounts-and-secrets.md](ops/01-accounts-and-secrets.md) — 계정·비밀값 |
| 02 | [ops/02-deploy.md](ops/02-deploy.md) — 배포 |
| 03 | [ops/03-database.md](ops/03-database.md) — 데이터베이스 |
| 04 | [ops/04-sql-handoff.md](ops/04-sql-handoff.md) — SQL 건네기·실행 |
| 05 | [ops/05-edge-functions.md](ops/05-edge-functions.md) — 엣지 함수 |
| 06 | [ops/06-laptop-worker.md](ops/06-laptop-worker.md) — 노트북 실행기 |
| 07 | [ops/07-kakao-bot.md](ops/07-kakao-bot.md) — 카톡 봇·PC 중계 |
| 08 | [ops/08-google-sheets.md](ops/08-google-sheets.md) — 구글 시트 |
| 09 | [ops/09-agent-team.md](ops/09-agent-team.md) — AI 에이전트 팀 |
| 10 | [ops/10-troubleshooting.md](ops/10-troubleshooting.md) — 문제 해결 |
| 11 | [ops/11-handover-checklist.md](ops/11-handover-checklist.md) — 인수인계 점검표 |

## 갱신 규칙 — "작업마다 해당 장을 고친다"

1. 화면·단추·숫자 세는 법·카톡 동작이 바뀌는 작업을 하면, **같은 작업 안에서** 해당 장을 고칩니다. 별도 작업으로 미루지 않습니다.
2. 장 맨 아래 "마지막 갱신" 줄에 날짜와 근거 커밋(짧은 해시)을 바꿔 적습니다.
3. 단추 이름은 앱 글자를 그대로 복사합니다. 이름을 바꾸면 이 매뉴얼도 같이 바꿉니다.
4. 확실하지 않은 내용은 쓰지 않거나 **(확인 필요)** 로 남기고, 확인되면 표시를 지웁니다.
5. 새 화면이 생기면 `user/` 에 새 장을 만들고 위 목차 표에 한 줄 추가합니다. 화면이 없어지면 장을 지우지 말고 맨 위에 "없어진 화면(날짜)"이라고 적습니다.
6. 운영·서버·SQL 이야기는 `ops/` 에만 씁니다.
7. 앱 안의 옛 설명서(`public/guide/*.html`)를 고칠 여력이 없으면, 이 매뉴얼만 고치고 해당 장에 "옛 설명서와 다른 점"을 적어 둡니다.
