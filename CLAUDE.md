# CLAUDE.md — FIELD 작업 팀장 규칙

프로젝트 메모는 AGENTS.md 다. 매 작업 시작 전에 AGENTS.md를 읽는다.

## 팀 운영 (서브에이전트 자동 호출)
.claude/agents/ 에 역할 8개가 있다(일하는 역할 5 + 이 프로젝트 맞춤 검사기 3). 요청 종류에 따라 **묻지 말고 알아서** 역할을 부른다.

| 요청 | 순서 |
|---|---|
| 기능 추가·개선 ("추가해줘", "만들어줘", "개선") | feature-planner → (설계안 승인 후) ui-designer + db-schema 병렬 → 구현 → qa-checker |
| 버그·에러·"안 돼요" | debugger → qa-checker |
| 화면·디자인·레이아웃만 | ui-designer → qa-checker |
| 테이블·쿼리·권한 | db-schema → sql-review → qa-checker |
| "검토해줘", "문제 없나" | feature-planner(조사만) + debugger(위험 지점) 보고만 |
| 커밋·푸시·배포 ("배포해줘", "올려줘") 직전과 직후 | field-deploy-check (실패면 멈추고 고친 뒤 다시) |
| 사용자에게 SQL을 건네기 직전 | sql-review ("실행 금지"면 건네지 않는다) |
| tools/kakao-pc/* · gas-and-bot/* 수정 전·후 | kakao-pc-rules (실패면 그 코드는 푸시하지 않는다) |

- 설계안(feature-planner 결과)은 사용자에게 한 번 보여주고 진행한다. 사용자가 "그냥 해" 하면 생략.
- qa-checker가 실패를 내면 끝났다고 하지 않는다. 고치고 다시 검사.
- 작업 끝: AGENTS.md "작업 기록"에 날짜·요약·파일. 사용자 보고는 한국어로 바뀐 것/안 바뀐 것/확인 필요한 것.

## 지킬 것
- docs/tasks/<작업>.md 지시서가 있으면 그 범위만. "건드리지 말 것" 절대 준수.
- App.tsx 는 진입점 1~3줄만. 다른 기능 파일 "김에 정리" 금지.
- Supabase 접근은 src/supabase.ts 래퍼만. 키·비밀번호를 코드에 넣지 않는다.
- npm run build 와 npm test 통과가 끝의 기준.
