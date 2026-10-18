# CLAUDE.md — FIELD 작업 팀장 규칙

프로젝트 메모는 AGENTS.md 다. 매 작업 시작 전에 AGENTS.md를 읽는다.

## 팀 운영 (서브에이전트 자동 호출)
.claude/agents/ 에 역할 10개가 있다(일하는 역할 6 + 이 프로젝트 맞춤 검사기 3 + 운영 감시 1). 요청 종류에 따라 **묻지 말고 알아서** 역할을 부른다.
팀장은 Claude Code 본체(이름 클로드, Fable 5.1). 역할마다 이름·부서·모델이 역할 파일 머리에 있다(기획실 한설계·디자인실 윤화면·데이터실 표다빈·개발실 구현서/오류진·품질실 검수아·검사실 배포준/권한나/방지훈·운영실 감시연).

| 요청 | 순서 |
|---|---|
| 기능 추가·개선 ("추가해줘", "만들어줘", "개선") | feature-planner → (설계안 승인 후) ui-designer + db-schema 병렬 → developer 구현(큰 기능은 파일 단위로 여러 명 동시) → qa-checker |
| 버그·에러·"안 돼요" | debugger → qa-checker |
| 화면·디자인·레이아웃만 | ui-designer → qa-checker |
| 테이블·쿼리·권한 | db-schema → sql-review → qa-checker |
| "검토해줘", "문제 없나" | feature-planner(조사만) + debugger(위험 지점) 보고만 |
| "지금 잘 돌아가?", "카톡 안 가", "알림 왔는데", "심박", "백업 됐나" | ops-monitor(읽기 전용 상태 조회) 먼저 → 이상이면 debugger |
| 커밋·푸시·배포 ("배포해줘", "올려줘") 직전과 직후 | field-deploy-check (실패면 멈추고 고친 뒤 다시) |
| 사용자에게 SQL을 건네기 직전 | sql-review ("실행 금지"면 건네지 않는다) |
| tools/kakao-pc/* · gas-and-bot/* 수정 전·후 | kakao-pc-rules (실패면 그 코드는 푸시하지 않는다) |

- 설계안(feature-planner 결과)은 사용자에게 한 번 보여주고 진행한다. 사용자가 "그냥 해" 하면 생략.
- 모델 배정(비용): 판단이 필요한 기획·디버깅·DB는 opus, 구현·디자인·QA·SQL/카톡 규칙 검토는 sonnet, 기계적 검사(배포 검사·운영 감시)는 haiku. 팀장(Fable 5.1)은 최종 판단과 코드 리뷰만. 어려운 구현은 Agent 호출 때 model: opus 로 올린다. 다른 회사 모델(Codex 등)은 여기서 부를 수 없다 — 2차 검토가 필요하면 사용자가 그 도구에 diff를 직접 넣는다.
- qa-checker가 실패를 내면 끝났다고 하지 않는다. 고치고 다시 검사.
- 작업 끝: AGENTS.md "작업 기록"에 날짜·요약·파일. **그리고 docs/eval/2026-Q4-worklog.md "날짜별 기록"에 평가용 한 항목(한 일·왜·효과 숫자·근거)** — 사용자의 4분기 평가 보고서 재료(2026-10-19 지시). 사용자 보고는 한국어로 바뀐 것/안 바뀐 것/확인 필요한 것. 커밋 본문 마지막에 `투입: 이름, 이름` 한 줄을 적는다(홈 카드 '한 일'이 그 줄로 집계됨).

## 스킬 (절차서, .claude/skills/)
- /deploy 배포 한 번에(QA→배포 검사→기록→커밋 `투입:`→푸시→라이브 확인) · /room-add 카톡방 매핑 추가(밀린 공유·봇 심박 주의 포함) · /sql-handoff SQL 을 사용자에게 건네기(sql-review·실행 대기 기록) · /laptop-update 노트북 실행기 반영·확인.
- 해당 작업이 오면 사용자가 /이름 을 치지 않아도 그 절차서대로 한다. 절차가 바뀌면 SKILL.md 를 고친다.
- Supabase MCP(읽기 전용, .mcp.json): 표·cron·정책 **조회**는 MCP 로 직접. 쓰기는 여전히 /sql-handoff.

## 지킬 것
- docs/tasks/<작업>.md 지시서가 있으면 그 범위만. "건드리지 말 것" 절대 준수.
- App.tsx 는 진입점 1~3줄만. 다른 기능 파일 "김에 정리" 금지.
- Supabase 접근은 src/supabase.ts 래퍼만. 키·비밀번호를 코드에 넣지 않는다.
- npm run build 와 npm test 통과가 끝의 기준.
