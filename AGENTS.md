# AGENTS.md — FIRSTOA-inspection-finder-MG 공통 작업 메모

이 파일은 Claude Code, Codex, Aside(어사이드) 등 모든 AI 에이전트와 사람이 **같이 읽고 같이 고치는** 메모입니다.
작업을 끝내면 아래 "작업 기록"에 한 줄씩 남기세요. 다른 에이전트가 이어받을 때 이 파일부터 읽습니다.

## 프로젝트 한 줄
퍼스트전산 CS팀 내부 웹앱 FIELD. React 19 · TypeScript · Vite · Tailwind v4. 백엔드는 Supabase(`kkdiihazgzesbqxjytqv`) + 일부 Google Apps Script. 배포는 Vercel(`firstoa-inspection-finder-mg.vercel.app`).

## 폴더 지도
- `src/` 프런트. 큰 화면은 `*Hub.tsx`, `*Form.tsx`, `*Board.tsx`. 공용: `supabase.ts`(REST 래퍼), `PortalSelect.tsx`, `toast.tsx`, `confirmModal.tsx`, `imageUpload.ts`(사진 업로드).
- `supabase/*.sql` 테이블·RLS·크론 정의. **파일 1개 = 기능 1개**, 파일 머리에 날짜와 목적 주석. SQL Editor에서 1회 실행하는 방식.
- `supabase/functions/*` 엣지 함수(Deno). 공용은 `_shared/`.
- `tools/worker/` 노트북 24시간 실행기(Python). `worker_jobs` 큐를 잡아 실행. 심박 `worker_heartbeat`.
- `tools/kakao-pc/` PC 카톡 발송 중계(`outbox_relay.py`), 포스터 전송.
- `api/` Vercel 서버리스(네이버 캘린더 연동).
- `apps-script/`, `gas-and-bot/` GAS·메신저봇R 스크립트.

## 핵심 테이블 (자주 쓰는 것)
- `jeomgeom`(점검), `as_records`(AS): 한글 컬럼. `업체명`, `_업체명`(정규화), `시리얼넘버`, `자산기번`, `모델명`, `지역`, `작성일`, `_hidden`.
- `vendor_info`(임대리스트 원본, 읽기 전용): `_업체명`, `기번`, `시리얼번호(기번)`, `자산번호`, `모델명`, `기종`, `계약일`, `종료일`. 컬럼명에 괄호·슬래시 있어 PostgREST select는 큰따옴표 필요.
- `vendor_master`(거래처 코드 마스터), `service_receptions`(서비스접수), `outbox`(카톡 발송 대기: `room`, `text`), `room_activity`(방별 마지막 발송), `counter_sms_inbox`(마감방 문자 → 자동 반영), `worker_jobs`, `worker_heartbeat`.

## 카톡 발송 규칙
카톡으로 보내려면 `outbox`에 `{room, text}` 1행 insert. 메신저봇R이 7초 폴링으로 가져가고, 못 가져가면 노트북 `outbox_relay.py`가 PC 카톡으로 대신 보냄. 방 이름은 `room_activity.room`과 **정확히** 일치해야 함. 테스트는 `테스트 전용방`.

## 작업 규칙 (모든 에이전트 공통)
1. 다른 기능 파일은 건드리지 않는다. 새 기능은 새 파일 + 진입점(사이드바/라우트) 최소 수정.
2. 기존 테이블 컬럼은 바꾸지 않는다. 새 테이블은 `supabase/<기능>.sql`로 추가하고 RLS·grant 포함.
3. `npm run build`가 통과해야 끝. 테스트가 있으면 `npm test`.
4. 끝나면 이 파일 "작업 기록"에 날짜·요약·건드린 파일을 적는다.
5. 비밀값(키, 비밀번호)은 코드에 넣지 않는다. anon key는 이미 `src/supabase.ts`에 있음.

## 에이전트 팀 (역할)
`.claude/agents/` 에 역할 10개. 팀장은 Claude Code 본체(클로드, Fable 5.1). 역할 파일 머리에 이름·부서·캐릭터·모델이 있고, 보고 첫 줄에 `[부서 이름]`을 붙인다. 홈 화면 "AI 에이전트 팀" 카드(src/agentTeam.ts)가 같은 목록을 보여 주므로 역할을 늘리거나 이름을 바꾸면 그 파일도 같이 고친다.
- 기획실 한설계 feature-planner(opus): 설계·작업 분해, 코딩 안 함.
- 디자인실 윤화면 ui-designer(sonnet): 화면 틀·일관성.
- 데이터실 표다빈 db-schema(opus): 테이블·RLS·크론.
- 개발실 구현서 developer(sonnet): 설계안 범위대로 구현, 큰 기능은 여러 명 동시. 오류진 debugger(opus): 원인 추적·재발 방지.
- 품질실 검수아 qa-checker(sonnet): 빌드·테스트·범위·회귀 검사.
- 검사실 배포준 field-deploy-check(haiku): 배포 전 tsc 종료코드→테스트→빌드→비밀값, 배포 후 라이브 번들 확인. 권한나 sql-review(sonnet): SQL Editor 실행 전 권한·삭제·기존 표 변경·비밀키 검사. 방지훈 kakao-pc-rules(sonnet): tools/kakao-pc 금지 단축키·안전 순서 강제.
- 운영실 감시연 ops-monitor(haiku): 심박·outbox·방 배달·백업·일감 실패를 읽기 전용으로 조회해 보고. "잘 돌아가?" 질문에 먼저.
Claude Code는 CLAUDE.md 규칙대로 자동 호출. Codex 등 다른 도구는 같은 역할 파일을 읽고 순서대로 흉내 내면 된다: 기획 → 디자인/DB → 구현 → QA → 배포 검사.

## 현재 진행 중 (2026-10-18)
- **이메일 카운터**: 복합기가 `count@firstoa.co.kr`로 보내는 카운터 메일(네이버 hee2gwang·hee3gwang 수신)을 어사이드가 매일 10시 정리해 `outbox`로 카톡 전송 중(DB 저장은 아직 없음). FIELD 저장·조회와 노트북 IMAP 수집은 **대표 승인 후 네이버 계정 IMAP 설정이 되면** 다시 지시서를 쓴다. 2026-10-18 지시서 3건은 사용자 지시로 삭제(기록은 git ce02b75).
- **고객용 QR AS 접수**: 보류(위와 같음).
- **홈 AI 에이전트 팀 카드**: 설계안 docs/tasks/agent-team-card.md (2026-10-19, feature-planner). 정적 데이터 src/agentTeam.ts + src/AgentTeamCard.tsx, Home.tsx 2줄, DB 없음. 열린 질문(운영 부서 구성·debugger 소속·위치) 사용자 답 대기.
- **카톡 발송 안정화**: `tools/kakao-pc/open_room.py` 렉 감지·재시작 패치 적용됨(2026-10-18). 노트북 반영은 bootstrap 한 줄 재실행.
- **서비스접수 지원 3종(경영·운영·영업) + 미처리 현황판**: 설계안 2차 docs/tasks/reception-dept-types.md (2026-10-19, feature-planner, 사용자 답 Q1~Q9·팀장 결정 반영). 두 줄 종류 선택기(현장3·지원3), 서비스접수 맨 위 6종 미처리 현황판 + 홈 관제 덱 카드, 지원 3종 완료·내일로·날짜·보류·메모 단추(일정리스트 안 씀), 업체로 접수(vendor_master), 영업·경영 시트 동기화 reception_sales·reception_mgmt(새 경로 dept-sheets.ts). SQL reception-dept-types.sql 미작성. 1차 병렬(표다빈·윤화면·구현서A·B) → 2차(구현서C·D) → 검수아.

## 작업 기록
- 2026-10-21 (Claude Code) OKR 8차: 주차(파트원) 바탕에서 "그 달 파트 종합" 층 제거 — 주차 = 월 공통(팀장) → 그 주 파트 행 → 본인. 파트 종합 달성기준은 파트 종합에만(사용자 "이민구 4주차에 왜 파트 종합 달성기준이 들어가 있냐"). monthParts 상태·조회 2곳 삭제. 이어서 주차 화면은 지운 달성기준을 빈 채 유지(overlayGoals keepEmptyCriteria=true; 파트 종합은 7차대로 비우면 통합집계 것). 파일: src/OkrHub.tsx, src/okr.ts, tests/okrQuarter.test.ts.
- 2026-10-21 (Claude Code) OKR 7차: 달성기준 규칙 — 파트 종합·주차에서 비우면 위 층(통합집계 달성기준)이 다시 보임(목표·병목현상은 비운 채 유지 그대로; overlayGoals), 팀원 집계 알약 인원 수 = 이름 목록 수(달 화면에서 0명 되던 버그), [4분기] 표 달성기준을 목표 칸 아래 [달성기준 ▾] 접기로 + 달 열을 2단 머리(10/11/12월 → A B C D CS 점, 파트 점 누르면 그 달 파트 종합), 열 너비 조절 1:1 복원(colStyle: 마지막 열만 폭 없이 남는 폭을 먹음, 표 끝 여백 없음 유지), OKR 화면 좌우 여백 0(워킨맵과 동일) → 바로 뒤 커밋에서 사용자 "너무 붙는다"로 12px(px-3)로. 테스트 627. 파일: src/okr.ts, App.tsx(1줄), OkrHub.tsx, OkrQuarterView.tsx, OkrMonthRollup.tsx, okrUi.ts, tests 2개.
- 2026-10-21 (Claude Code) OKR 6차: 머리 구조 개편(새 src/OkrHeader.tsx — 짙은 띠는 "CS팀 OKR"+연도·분기·월 칩만, 흰 카드 안 탭 → 경로 줄(okrCrumbs: "C파트 › 이민구 › 10월 3주차 (10/19~23)", 오른쪽 동기화·저장 상태) → 사람 알약([팀원 집계][파트 종합]|파트원) → 주차 칩(파트원 선택 때만, 연한 톤) → 표; 큰 제목·기간 알약 제거, 옛 화면 경로 무변경), 핵심방향 단계 제목 편집 + 저장 형식 `1. 제목: 본문`(옛 `주간:`·접두 없는 글 호환, 빈 단계는 보기에서 숨김), RichCell 색 단추를 칸 글 흐름 밖으로(pr-16 제거 — 글 밀림 해결), OKR 화면 창 너비 꽉 채움(App.tsx 한 줄 lg:max-w-none), 통합집계·분기 표 width 100%(끝 여백 제거), 붙여넣기·분기로 시작·되돌리기·가져오기 단추 제거(사용자 "일단은 빼", [3×3 빈 틀]만), 분기 파트 카드 = 10·11·12월 합계(전체 27). 테스트 627. 참고: 표 100% 폭에선 열 드래그가 비례 확대돼 마우스보다 덜 움직임(경미). OkrPasteModal 은 열 길 없는 코드로 남김. 파일: src/OkrHeader.tsx(새), OkrHub.tsx, OkrDirection.tsx, RichCell.tsx, App.tsx(1줄), OkrMonthRollup.tsx, OkrQuarterView.tsx, okr.ts, okrUi.ts, tests 2개.
- 2026-10-21 (Claude Code) OKR 4·5차 피드백: "팀장 문서" 배지 삭제, **층별 독립 규칙**(파트 종합·파트원 주차의 병목·목표·달성기준은 각자 header.goals 에만 저장, 통합집계 goals 와 동기화 안 함, 처음 열 때만 위 층이 기본, 비우면 빈 채 유지 — html.*Set 표시, 표시 없는 옛 칸은 objective·bottleneck 무시·criteria 글 있을 때만), 새 경로 안내 줄·"월: …" 삭제, "제안" 글자 삭제(○ 점만), 사람 박스 [팀원 집계]→[파트 종합]→파트원, 병목현상 RichCell(굵게·글자색) + "병목 n" 라벨·No 열 삭제, 핵심방향 띠 재설계(윤화면: 머리글/주간:/월말:/분기: 줄 접두 형식, 칸 4개 입력, 타임라인 UI, 옛 글은 머리글+문단), [4분기] 통합집계에 분기 핵심방향 띠 + A~D 파트 카드(quarterTeamCard: 마지막 기록 달·파트장 최근 달, TeamCard 공용화), 11·12월 copy/'[]' 달은 빈 9행 틀(monthScreenGoals). SQL supabase/okr-month-tidy-20261021.sql(10월 direction 새 형식 + 11·12월 goals 비움, goals_prev 보관, 권한나 통과) 실행 대기. 테스트 624. 파일: src/okr.ts, okrUi.ts, OkrCells.tsx, OkrDirection.tsx, OkrHub.tsx, OkrMonthRollup.tsx, OkrQuarterView.tsx, tests 2개.
- 2026-10-21 (Claude Code) OKR 3차 피드백 8건(사용자 지시, 설계 없이): 파트 탭(A~D)에선 상단 필터에 [4분기] 숨김(filterItemsForTab, 분기 화면에서 파트 탭 → quarterNowMonth 달의 파트 종합; QuarterTeamView 삭제), 범례(OkrLegend) 삭제, 색은 병목현상·목표만(TD_LEADER_EDIT) 달성기준은 노랑(TD_SPLIT/TH_SPLIT 삭제), 주차 칩은 파트원 선택 때만(showsWeekChips — 파트 종합 = 그 달 하나), 팀원 집계 번호 열 삭제, ✨ 주차 합치기·새 경로 ↩ 불러오기 단추 삭제(옛 화면 단추 유지), 주차 열 머리 "목표"·"달성기준"으로 통일, 병목현상·목표 모든 층 편집(파트 종합 → 월 공통 goals, 주차 → header.goals bottleneckSet/objectiveSet), [4분기] 표에 "조치·확인 필요 달"(alertMonths)·"4분기 결과 및 다음 분기 개선계획"(분기 feedback memo) 열. 테스트 621. 파일: src/okr.ts, src/okrUi.ts, src/OkrCells.tsx, src/OkrHub.tsx, src/OkrMonthRollup.tsx, src/OkrQuarterView.tsx, tests 2개, docs/tasks/okr-feedback-2.md(3차 절).
- 2026-10-21 (Claude Code) OKR 2차 피드백 4건(설계안 docs/tasks/okr-feedback-2.md, 열린 결정 D1~D7 팀장 제안값으로 확정): ① 통합집계를 "팀원 집계" 틀로 — 월 = 9목표 × A~D 파트 ●/○ + CS 종합(사람 덮어쓰기는 okr_cycles.feedback[no].judgment, 되돌리기 ""), 분기 = 9목표 × 10·11·12월 CS 종합 + 분기 종합(분기 진행 표 제거), 분기+파트 탭 = QuarterTeamView(월 선택 안내 제거, 점 누르면 그 달 파트 종합). 판정 제안 기준 = 마지막 기록 주차(lastJudgmentInMonth; 주차 합치기·파트 종합·팀원 집계 동일). ② 핵심방향 OkrDirection 띠(머리글 + 주간 실행→월말 확인→분기 정리 단계, lookbehind 없는 정규식). ③ 색: 팀장 문서 칸 TD_LEADER, 파트·파트원이 주차로 쪼개 적는 칸 TD_SPLIT + 범례 OkrLegend. ④ 주차 화면 목표·달성기준 편집(putGoalField → okr_reports.header.goals, 목표는 html.objectiveSet="1" 표시가 있을 때만 덮음 — 서버 옛 37행의 objective 되살아남 방지), 11·12월 copy 달 편집 허용(첫 편집 때 goals_prev 보관·manual). 팀원 집계에 병목현상 글 열 추가. mergeFeedback 칸 단위 병합, getOkrReportsIn(분기 주차 한 번에). 옛 화면(8·9월) 무변경. 테스트 615. 파일: src/okr.ts, src/okrUi.ts, src/OkrCells.tsx, src/OkrDirection.tsx(새), src/OkrMonthRollup.tsx, src/OkrQuarterView.tsx, src/OkrHub.tsx, tests/okrQuarter.test.ts, tests/okrHub.render.test.tsx.
- 2026-10-20 (Claude Code) OKR 분기→월→주차 구조 개편(팀장 모델: 분기 OKR 통합집계 → 월 OKR 파트종합 → 주차 파트원). 상단 필터 [4분기][10월][11월][12월], 분기 표(병목현상·목표·달성기준)·분기 진행 표, 월 통합집계(핵심방향·A~D 판정·조치 파트·개선계획), 파트 종합 + 파트원 주차 칩, 팀장 문서 붙여넣기 모달(goals_prev 되돌리기), 주차 합치기. 8·9월·10월 주차 기록은 옛 경로 보존, SQL 실행 전엔 옛 화면 + 대기 띠(probeOkrQuarterSchema). 팀장 문서 전사본 docs/okr/*.json, 설계안 docs/tasks/okr-quarter-month-week.md. SQL supabase/okr-quarter.sql(백업 표 okr_cycles_bak_20261020·okr_reports_bak_20261020, 되돌리기 okr-quarter-rollback.sql) — 앱 배포 뒤 사용자 실행. 파일: src/okr.ts, src/OkrHub.tsx, src/OkrQuarterView.tsx, src/OkrMonthRollup.tsx, src/OkrPasteModal.tsx, src/OkrCells.tsx, src/okrUi.ts, tests/okrQuarter.test.ts, tests/okrHub.render.test.tsx.
- 2026-10-18 (Aside) AGENTS.md 신설. `docs/tasks/` 에 병렬 작업 지시서 3건 추가.
- 2026-10-18 (Aside) `.claude/agents/` 역할 5개 + `CLAUDE.md` 팀장 규칙 추가.
- 2026-10-18 (Claude Code) 검사기 역할 3개 추가(field-deploy-check·sql-review·kakao-pc-rules). `docs/tasks/` 지시서 3건 삭제(사용자 지시 — 이메일 카운터는 네이버 계정 승인 뒤 재개). 파일: .claude/agents/*.md, AGENTS.md.
- 2026-10-19 (Claude Code) 에이전트 팀 전반 점검(feature-planner+debugger) 후 4건 수정: ① 옛 뭄바이 프로젝트 키가 박힌 supabase/customer-message-cron.sql 삭제(대체는 customer-message-cron-seoul.sql) ② CsAsWorkspace 티켓 바꿀 때 제목 편집칸이 안 닫히던 도달 불가 코드 ③ "오늘/이번달"을 UTC로 자르던 9곳을 kstDate()로(DeptRequests·CopierNotes·ReadingHub·SelfDev·authors·ContactChangeHistory·entity360) ④ CounterSms 반영 표시·목록 삭제가 실패해도 화면은 성공처리하던 것을 실패 안내로. 남은 것(점검 결과): lint 72에러, RichCell innerHTML 소독, selectRows 타임아웃, 운영 DB RLS 실상태 확인, App.tsx 분할.
- 2026-10-19 (Claude Code) 에이전트 팀 10명 체제: 개발실 developer(구현서)·운영실 ops-monitor(감시연) 채용, 8개 역할에 이름·부서·캐릭터·모델(opus/sonnet/haiku) 배정, CLAUDE.md 호출표·모델 정책 갱신. 홈 화면 "AI 에이전트 팀" 카드(src/agentTeam.ts·AgentTeamCard.tsx·tests/agentTeam.test.ts, Home.tsx +2줄) — 구현은 구현서(sonnet)가 지시서 docs/tasks/agent-team-card.md 대로. 실행기 파수꾼 오알림 원인(데스크톱 옛 심박 행)은 supabase/worker-watchdog-current-host.sql 실행 대기. 카톡봇 심박은 같은 계정이라 유지(kakao-bot-heartbeat-off.sql 보류).
- 2026-10-19 (Claude Code) 홈 개편: ⑤ 전체 기능 그리드·⑦ 온보딩 4단계 제거(사용자 "자리만 차지"), 릴리스 카드 전체 너비(구현서). "AI 에이전트 팀" 카드를 입체 조직도로 재작성(윤화면·opus): 팀장→부서 7 연결선, PC 마우스 기울기(ref·perspective), 흐름 레일 빛 점(index.css @keyframes agent-flow-run), 모델 비율 범례, motion-reduce 대응. agentTeam.ts 에 accent·stage·AGENT_FLOW_STEPS 추가. tests/agentTeamCard.render.test.tsx(서버 렌더 스모크) 추가. 파일: src/Home.tsx, src/AgentTeamCard.tsx, src/agentTeam.ts, src/index.css, tests/.
- 2026-10-19 (Claude Code) 홈 관제 덱에 "FIELD AI 에이전트 팀" 알약(직원 10명 · 오늘 N명 투입, 누르면 아래 카드로 스크롤+1.5초 하이라이트). 카드를 "FIELD AI 에이전트 팀 · CS팀이 꾸린 AI 직원 10명"으로 브랜딩, 역할→직원·출근 표현, 직원별 오늘/이번 주 한 일 표시. 한 일은 scripts/gen-patch-notes.mjs 가 빌드 때 git 커밋에서 자동 생성(src/agentWorkLog.ts, 본문 `투입: 이름, 이름` 줄 우선, 명단 나열 커밋 2개 제외). CLAUDE.md 에 커밋 본문 `투입:` 규칙. 운영실 감시연 조회: 관제 덱 "시트 동기화 실패 2"는 10/14·10/15 reception_copier 찾기 갱신 실패(퍼스트순 3544·17885 행 없음) 잔존 기록, 대기 0. 파일: src/Home.tsx, src/AgentTeamCard.tsx, src/agentWorkLog.ts, scripts/gen-patch-notes.mjs, CLAUDE.md.
- 2026-10-19 (Claude Code) 스킬 4개 신설(.claude/skills/): /deploy·/room-add·/sql-handoff·/laptop-update. Supabase MCP 읽기 전용(.mcp.json, 호스팅 OAuth, project_ref 고정) — 사용자가 터미널 `/mcp` 로 로그인해야 활성. CLAUDE.md 에 스킬·MCP 절. 관제 덱 "FIELD AI 에이전트 팀" 알약을 누를 수 있는 티(자주색 테두리·빛·[보기] 화살표)로. 알약 스크롤 버그(overflow-hidden 판 안쪽이 밀리던 것)·카드 글자 흐림(translateZ)·하이라이트 강화는 앞 커밋 3개.
- 2026-10-19 (Claude Code) Supabase MCP 읽기 전용 연결 실측 + DB 감사(표다빈 역할: supabase/*.sql 77개 vs 라이브 대조). 코드·DB 변경 없음. 결과 요약은 메모리 firstoa-supabase-audit-2026-10-19. 핵심: pg_default_acl 이 anon 에 전권, RLS 꺼진 표 14개, 재실행 위험 SQL(field-sheet-sync·as-tickets·admin-policies·photo-storage-policy·vendor-master·service-receptions), 저장소에 CREATE 없는 원장 표 13개·RPC 4개, cron 로그 293MB.
- 2026-10-19 (Claude Code) DB 감사 후속: 실행 대기 SQL 3장 `supabase/cleanup-data-20261019.sql`(찌꺼기 정리)·`db-maintenance-20261019.sql`(cron 로그·중복 인덱스/정책·records_all·search_path)·`anon-permissions-20261019.sql`(기본 권한 차단·19표 grant 축소·RLS 10표, 설계안 docs/tasks/anon-permissions-design.md) — 전부 sql-review 통과. 기록용 `schema-snapshot-20261019.sql`(저장소에 CREATE 없던 표 13·함수 4·뷰 2·컬럼 41·cron 2). 옛 SQL 7개 머리에 재실행 금지 경고. 역할 파일 db-schema·ops-monitor·debugger 에 Supabase MCP 읽기 도구 추가, sql-review·db-schema 에 "새 표는 grant 직접" 규칙.
- 2026-10-19 (Claude Code) 서비스접수 지원 3종(경영·운영·영업) + 미처리 현황판 + 홈 카드 + 부서 시트 동기화(엣지 field-sheet-sync dept-sheets). 설계안 docs/tasks/reception-dept-types.md. 새 파일 src/ReceptionTypePicker·ReceptionBoard·HomeReceptionCard·DeptReceptionForm.view·DeptReceptionScreen·DeptReceptionDetail·DeptActionBar·ReceptionBoardPanel·HomeReceptionPanel·receptionBoardData·deptReception·deptReceptionApi·deptReceptionFlow, supabase/functions/field-sheet-sync/dept-sheet-spec·dept-sheets. 수정 ServiceReception.tsx(분기만)·Home.tsx(+2)·CustomerReport·lookupCatalog·supabase.ts·sheets-api.ts·index.ts. 실행 대기 SQL supabase/reception-dept-types.sql(권한나 통과) + 관리 탭 DEPT_RECEPTION_ENABLED 켜기. 카톡 방(경영접수|*·운영접수|*·영업접수|*) 미정.
- 2026-10-19 (Claude Code) 미처리 현황판 2차: 오른쪽 접수리스트 기둥 [접수리스트|미처리 현황] 전환(src/receptionRightView.ts), compact 현황판, 일정 미처리(as_tickets, OverduePanel 규칙) 7번째 열·홈 카드, App.tsx 1줄(onOpenSchedule → 일정리스트), SystemAdmin 스위치 DEPT_RECEPTION_ENABLED 추가.
- 2026-10-19 (Claude Code) 서비스접수 피드백 3차: "영업팀" 이름(값 변경, 실행 대기 supabase/reception-dept-types-rename.sql), ReceptionListFilters 분할 막대, counts=mergedRows·머리 숫자=listRows, 물류 미처리만(scheduleType in 물류·납품철수교체휴가교육), aggregateVendor leasingCount/totalCount, 현황판 타일 유지 버그, App.tsx 작성자 화살표 1줄, 접수리스트 머리 정리.
- 2026-10-19 (Claude Code) 서비스접수 마크업 재설계(ReceptionTypePicker 한 줄 탭, ServiceReception 폼 종이 한 장·오른쪽 패널, ReceptionBoard compact 구분선, DeptReceptionForm.view) — 로직 무변경. docs/proposals/field-system-2026-10-19.md(팀장용 시스템 제안, 아티팩트 링크).
- 2026-10-19 (Claude Code) 피드백 4차: naver-calendar-sync 완료 동기화 → service_receptions 완료 PATCH(원인 수정, 엣지 재배포), receptionBoardData 자가 치유·noTicket, App.tsx AuthorPicker 2곳 SSO 고정 시 글자만, DeptReceptionScreen 업체 모드·달력 제거, CsAsWorkspace 부서 3팀(deptCal/listDept) + 새 파일 DeptCalendarPanel.tsx·deptCalendarView.ts, 물류 안내 문구, 접수분야 wrap.
- 2026-10-19 (Claude Code) 피드백 5차: DeptCalendarPanel 편집·삭제·추가(team_calendar_events CRUD, 접수 schedule_date 동기화), DeptReceptionDetail [수정][삭제], DeptReceptionForm.view 거래처 블록 = 복합기(DeptCandidateList/Row·selectedSummary·custKind), DeptReceptionScreen 연결, ServiceReception 1줄(onDeleted). vitest 는 대문자 C:\ 경로에서 돌릴 것(소문자 /c/ 는 이중 로드 오류).
- 2026-10-19 (Claude Code) 피드백 6차: src/datePicker.ts openNativePicker(예정일 4곳), DeptCalendarPanel 시간 칸 제거.
- 2026-10-19 (Claude Code) 피드백 7차: 작성자 select 제거(SSO 고정 시) 5곳, OverduePanel 종류 칩·물류 안내·색(+src/overdueLogic.ts).
- 2026-10-19 (Claude Code) 홈 미처리 통합: src/homeUnhandled.ts(mergeUnhandled: 열린 접수 6종 + 물류 일정 전부 + receptionId 없는 AS 일정) + HomeUnhandledPanel.tsx, Home.tsx 2줄. OverduePanel.tsx 는 미사용으로 남음.
- 2026-10-19 (Claude Code) 원격대기 규칙: deptReception.isStaleRemote(7일 초과 제외) → receptionBoardData·homeUnhandled. 실행 대기 SQL supabase/remote-receptions-close-20261019.sql(54건 일괄 완료).
