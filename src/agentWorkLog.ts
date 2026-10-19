// 자동 생성 파일 — scripts/gen-patch-notes.mjs 가 빌드 때 git 기록에서 갱신한다. 직접 수정 금지.
// 커밋 제목·본문에 역할 이름(한설계·구현서…)이나 역할 key(feature-planner…)가 적혀 있으면 그 직원의 "한 일"로 잡는다.
export type AgentWorkItem = { date: string; hash: string; agent: string; summary: string };
export const AGENT_WORK_LOG: AgentWorkItem[] = [
  {
    "date": "2026-10-19",
    "hash": "34eb62746d",
    "agent": "ui-designer",
    "summary": "서비스접수 피드백 3차: 영업팀 이름 + 필터 분할 막대 + 숫자 기준 정리 + 물류 미처리만 + 임대중 대수 + 현황판 타일 버그 + 작성자 UI 정리"
  },
  {
    "date": "2026-10-19",
    "hash": "34eb62746d",
    "agent": "developer",
    "summary": "서비스접수 피드백 3차: 영업팀 이름 + 필터 분할 막대 + 숫자 기준 정리 + 물류 미처리만 + 임대중 대수 + 현황판 타일 버그 + 작성자 UI 정리"
  },
  {
    "date": "2026-10-19",
    "hash": "34eb62746d",
    "agent": "sql-review",
    "summary": "서비스접수 피드백 3차: 영업팀 이름 + 필터 분할 막대 + 숫자 기준 정리 + 물류 미처리만 + 임대중 대수 + 현황판 타일 버그 + 작성자 UI 정리"
  },
  {
    "date": "2026-10-19",
    "hash": "e009c9c0a0",
    "agent": "ui-designer",
    "summary": "미처리 현황판 2차: 오른쪽 접수리스트 기둥으로 이동(접수리스트|미처리 현황 전환) + 일정 미처리(물류·AS·납품) 합치기 + 관리 탭 스위치"
  },
  {
    "date": "2026-10-19",
    "hash": "e009c9c0a0",
    "agent": "developer",
    "summary": "미처리 현황판 2차: 오른쪽 접수리스트 기둥으로 이동(접수리스트|미처리 현황 전환) + 일정 미처리(물류·AS·납품) 합치기 + 관리 탭 스위치"
  },
  {
    "date": "2026-10-19",
    "hash": "e009c9c0a0",
    "agent": "field-deploy-check",
    "summary": "미처리 현황판 2차: 오른쪽 접수리스트 기둥으로 이동(접수리스트|미처리 현황 전환) + 일정 미처리(물류·AS·납품) 합치기 + 관리 탭 스위치"
  },
  {
    "date": "2026-10-19",
    "hash": "ea68d6a479",
    "agent": "feature-planner",
    "summary": "서비스접수 전사 확대: 경영지원·운영지원·영업지원 3종 + 미처리 현황판 + 홈 카드 + 부서 시트 자동 기입"
  },
  {
    "date": "2026-10-19",
    "hash": "ea68d6a479",
    "agent": "ui-designer",
    "summary": "서비스접수 전사 확대: 경영지원·운영지원·영업지원 3종 + 미처리 현황판 + 홈 카드 + 부서 시트 자동 기입"
  },
  {
    "date": "2026-10-19",
    "hash": "ea68d6a479",
    "agent": "db-schema",
    "summary": "서비스접수 전사 확대: 경영지원·운영지원·영업지원 3종 + 미처리 현황판 + 홈 카드 + 부서 시트 자동 기입"
  },
  {
    "date": "2026-10-19",
    "hash": "ea68d6a479",
    "agent": "developer",
    "summary": "서비스접수 전사 확대: 경영지원·운영지원·영업지원 3종 + 미처리 현황판 + 홈 카드 + 부서 시트 자동 기입"
  },
  {
    "date": "2026-10-19",
    "hash": "ea68d6a479",
    "agent": "qa-checker",
    "summary": "서비스접수 전사 확대: 경영지원·운영지원·영업지원 3종 + 미처리 현황판 + 홈 카드 + 부서 시트 자동 기입"
  },
  {
    "date": "2026-10-19",
    "hash": "ea68d6a479",
    "agent": "field-deploy-check",
    "summary": "서비스접수 전사 확대: 경영지원·운영지원·영업지원 3종 + 미처리 현황판 + 홈 카드 + 부서 시트 자동 기입"
  },
  {
    "date": "2026-10-19",
    "hash": "ea68d6a479",
    "agent": "sql-review",
    "summary": "서비스접수 전사 확대: 경영지원·운영지원·영업지원 3종 + 미처리 현황판 + 홈 카드 + 부서 시트 자동 기입"
  },
  {
    "date": "2026-10-19",
    "hash": "57639e1498",
    "agent": "sql-review",
    "summary": "카톡봇 심박 끄기 SQL 머리 주석 갱신(2026-10-19 사용자 결정으로 다시 끄기, 권한나 실행 가능)"
  },
  {
    "date": "2026-10-19",
    "hash": "d5e3a5cd66",
    "agent": "db-schema",
    "summary": "DB 감사 후속: 정리·정비·권한 SQL 3장 + 스키마 기록 + 옛 SQL 재실행 경고 + 역할 파일에 MCP 읽기 도구"
  },
  {
    "date": "2026-10-19",
    "hash": "d5e3a5cd66",
    "agent": "field-deploy-check",
    "summary": "DB 감사 후속: 정리·정비·권한 SQL 3장 + 스키마 기록 + 옛 SQL 재실행 경고 + 역할 파일에 MCP 읽기 도구"
  },
  {
    "date": "2026-10-19",
    "hash": "d5e3a5cd66",
    "agent": "sql-review",
    "summary": "DB 감사 후속: 정리·정비·권한 SQL 3장 + 스키마 기록 + 옛 SQL 재실행 경고 + 역할 파일에 MCP 읽기 도구"
  },
  {
    "date": "2026-10-19",
    "hash": "a528847ad4",
    "agent": "ui-designer",
    "summary": "홈: 관제 덱 \"FIELD AI 에이전트 팀\" 알약 + 카드 브랜딩·직원 표현 + 직원별 오늘/이번 주 한 일(커밋 기록 자동 집계)"
  },
  {
    "date": "2026-10-19",
    "hash": "a528847ad4",
    "agent": "developer",
    "summary": "홈: 관제 덱 \"FIELD AI 에이전트 팀\" 알약 + 카드 브랜딩·직원 표현 + 직원별 오늘/이번 주 한 일(커밋 기록 자동 집계)"
  },
  {
    "date": "2026-10-19",
    "hash": "a528847ad4",
    "agent": "qa-checker",
    "summary": "홈: 관제 덱 \"FIELD AI 에이전트 팀\" 알약 + 카드 브랜딩·직원 표현 + 직원별 오늘/이번 주 한 일(커밋 기록 자동 집계)"
  },
  {
    "date": "2026-10-19",
    "hash": "a528847ad4",
    "agent": "field-deploy-check",
    "summary": "홈: 관제 덱 \"FIELD AI 에이전트 팀\" 알약 + 카드 브랜딩·직원 표현 + 직원별 오늘/이번 주 한 일(커밋 기록 자동 집계)"
  },
  {
    "date": "2026-10-19",
    "hash": "a528847ad4",
    "agent": "ops-monitor",
    "summary": "홈: 관제 덱 \"FIELD AI 에이전트 팀\" 알약 + 카드 브랜딩·직원 표현 + 직원별 오늘/이번 주 한 일(커밋 기록 자동 집계)"
  },
  {
    "date": "2026-10-19",
    "hash": "87fb08fc0d",
    "agent": "ui-designer",
    "summary": "홈 개편: 전체 기능 그리드·온보딩 4단계 제거 + \"AI 에이전트 팀\" 카드를 입체 조직도로"
  },
  {
    "date": "2026-10-19",
    "hash": "87fb08fc0d",
    "agent": "developer",
    "summary": "홈 개편: 전체 기능 그리드·온보딩 4단계 제거 + \"AI 에이전트 팀\" 카드를 입체 조직도로"
  },
  {
    "date": "2026-10-19",
    "hash": "87fb08fc0d",
    "agent": "qa-checker",
    "summary": "홈 개편: 전체 기능 그리드·온보딩 4단계 제거 + \"AI 에이전트 팀\" 카드를 입체 조직도로"
  },
  {
    "date": "2026-10-19",
    "hash": "87fb08fc0d",
    "agent": "field-deploy-check",
    "summary": "홈 개편: 전체 기능 그리드·온보딩 4단계 제거 + \"AI 에이전트 팀\" 카드를 입체 조직도로"
  },
  {
    "date": "2026-10-19",
    "hash": "360e30a29e",
    "agent": "sql-review",
    "summary": "카톡봇 심박 끄기 SQL(실행은 사용자 결정 뒤) — sql-review 통과, 되돌리기 한 줄 명시"
  },
  {
    "date": "2026-10-19",
    "hash": "a7a66d0c37",
    "agent": "sql-review",
    "summary": "실행기 파수꾼 SQL: 데스크톱 옛 심박 행 삭제 + 가장 최근 실행기 한 대만 감시 (2시간마다 오던 \"실행기 멈췄어요\" 푸시 원인)"
  },
  {
    "date": "2026-10-19",
    "hash": "9d0a598298",
    "agent": "feature-planner",
    "summary": "점검 후 수정 4건: 옛 프로젝트 키 박힌 cron SQL 삭제 + 티켓 바꿀 때 제목 편집칸 안 닫히던 버그 + \"오늘/이번달\" UTC 컷 9곳 KST로 + 마감방 문자 반영/삭제 실패를 성공처럼 보이던 것 안내로"
  },
  {
    "date": "2026-10-19",
    "hash": "9d0a598298",
    "agent": "debugger",
    "summary": "점검 후 수정 4건: 옛 프로젝트 키 박힌 cron SQL 삭제 + 티켓 바꿀 때 제목 편집칸 안 닫히던 버그 + \"오늘/이번달\" UTC 컷 9곳 KST로 + 마감방 문자 반영/삭제 실패를 성공처럼 보이던 것 안내로"
  },
  {
    "date": "2026-10-19",
    "hash": "9d0a598298",
    "agent": "qa-checker",
    "summary": "점검 후 수정 4건: 옛 프로젝트 키 박힌 cron SQL 삭제 + 티켓 바꿀 때 제목 편집칸 안 닫히던 버그 + \"오늘/이번달\" UTC 컷 9곳 KST로 + 마감방 문자 반영/삭제 실패를 성공처럼 보이던 것 안내로"
  },
  {
    "date": "2026-10-19",
    "hash": "9d0a598298",
    "agent": "field-deploy-check",
    "summary": "점검 후 수정 4건: 옛 프로젝트 키 박힌 cron SQL 삭제 + 티켓 바꿀 때 제목 편집칸 안 닫히던 버그 + \"오늘/이번달\" UTC 컷 9곳 KST로 + 마감방 문자 반영/삭제 실패를 성공처럼 보이던 것 안내로"
  }
];
