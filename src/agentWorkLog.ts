// 자동 생성 파일 — scripts/gen-patch-notes.mjs 가 빌드 때 git 기록에서 갱신한다. 직접 수정 금지.
// 커밋 제목·본문에 역할 이름(한설계·구현서…)이나 역할 key(feature-planner…)가 적혀 있으면 그 직원의 "한 일"로 잡는다.
export type AgentWorkItem = { date: string; hash: string; agent: string; summary: string };
export const AGENT_WORK_LOG: AgentWorkItem[] = [
  {
    "date": "2026-10-19",
    "hash": "7a54c3a988",
    "agent": "developer",
    "summary": "그룹웨어 로그인 고정이면 작성자 고르기 전부 제거: 서비스접수 머리띠 select + 양식 4곳(카테고리·담당자변경·복합기확장성·PC) 이름 글자만"
  },
  {
    "date": "2026-10-19",
    "hash": "81b565bad9",
    "agent": "developer",
    "summary": "부서 접수·달력: 예정일 입력 어디를 눌러도 달력 열림(showPicker) + 부서 일정 모달 시간 칸 제거"
  },
  {
    "date": "2026-10-19",
    "hash": "6efc6eeccd",
    "agent": "ui-designer",
    "summary": "서비스접수 피드백 5차: 부서 일정 수정·삭제·추가(캘린더·일정리스트) + 부서 접수 수정·삭제 + 거래처 선택을 복합기와 동일하게"
  },
  {
    "date": "2026-10-19",
    "hash": "6efc6eeccd",
    "agent": "developer",
    "summary": "서비스접수 피드백 5차: 부서 일정 수정·삭제·추가(캘린더·일정리스트) + 부서 접수 수정·삭제 + 거래처 선택을 복합기와 동일하게"
  },
  {
    "date": "2026-10-19",
    "hash": "6efc6eeccd",
    "agent": "qa-checker",
    "summary": "서비스접수 피드백 5차: 부서 일정 수정·삭제·추가(캘린더·일정리스트) + 부서 접수 수정·삭제 + 거래처 선택을 복합기와 동일하게"
  },
  {
    "date": "2026-10-19",
    "hash": "6794f0a0a2",
    "agent": "ui-designer",
    "summary": "서비스접수 피드백 4차: 네이버 완료→접수 완료 동기화(원인 수정) + 자가 치유 + 부서 달력을 캘린더·일정리스트 팀 칩으로 + 상단 이름 글자만 + 업체 모드 제거"
  },
  {
    "date": "2026-10-19",
    "hash": "6794f0a0a2",
    "agent": "developer",
    "summary": "서비스접수 피드백 4차: 네이버 완료→접수 완료 동기화(원인 수정) + 자가 치유 + 부서 달력을 캘린더·일정리스트 팀 칩으로 + 상단 이름 글자만 + 업체 모드 제거"
  },
  {
    "date": "2026-10-19",
    "hash": "6794f0a0a2",
    "agent": "qa-checker",
    "summary": "서비스접수 피드백 4차: 네이버 완료→접수 완료 동기화(원인 수정) + 자가 치유 + 부서 달력을 캘린더·일정리스트 팀 칩으로 + 상단 이름 글자만 + 업체 모드 제거"
  },
  {
    "date": "2026-10-19",
    "hash": "3a49c3afba",
    "agent": "ui-designer",
    "summary": "서비스접수 화면 구조 재설계: 한 줄 종류 탭 + 종이 한 장 폼 + 오른쪽 패널 한 장 (로직 무변경) + 팀장용 시스템 제안서"
  },
  {
    "date": "2026-10-19",
    "hash": "3a49c3afba",
    "agent": "qa-checker",
    "summary": "서비스접수 화면 구조 재설계: 한 줄 종류 탭 + 종이 한 장 폼 + 오른쪽 패널 한 장 (로직 무변경) + 팀장용 시스템 제안서"
  },
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
